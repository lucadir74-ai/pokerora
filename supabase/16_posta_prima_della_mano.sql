-- PokerOra · 16 · Prima della distribuzione chi non ha fiches deve prendere una posta
-- Da eseguire una volta in Supabase → SQL Editor → New query → Run
--
-- Per giocare una mano servono almeno 2 inviti (più l'eventuale differenza dovuta dopo una parola):
-- chi ne ha meno non può fare niente durante la mano e bloccava il gioco. Ora la mano non parte
-- finché non prende un'altra posta (tra una mano e l'altra la posta arriva subito).
-- I giocatori automatici continuano a prenderla da soli.
-- È la stessa nuova_mano attiva su Supabase, con in più il controllo segnato qui sotto.

CREATE OR REPLACE FUNCTION public.nuova_mano(p_tavolo uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  t public.tavoli%rowtype;
  v_fase text;
  n int; v_bassa int; v_req int; v_mazziere int; v_invito int; v_numero int; v_dovuto int;
  v_id uuid; g record; v_buio boolean; v_senza text;
begin
  select * into t from public.tavoli where id = p_tavolo for update;
  if not found or not public.sono_al_tavolo(p_tavolo) then raise exception 'Non sei seduto a questo tavolo.'; end if;
  if t.stato <> 'in_corso' then raise exception 'La partita non è in corso.'; end if;
  if t.mano_corrente is not null then
    select fase into v_fase from public.mani where id = t.mano_corrente;
    if v_fase not in ('finita', 'annullata') then raise exception 'C''è già una mano in corso.'; end if;
  end if;

  select count(*) into n from public.tavolo_giocatori where tavolo_id = p_tavolo;
  v_bassa := case when coalesce(t.regole->>'mazzo', 'regola11') = 'completo' then 2
                  else 11 - least(greatest(n, 4), 6) end;
  v_req := 11 + t.livello_apertura;
  select coalesce(min(posto) filter (where posto > coalesce(t.mazziere, 0)), min(posto))
    into v_mazziere from public.tavolo_giocatori where tavolo_id = p_tavolo;
  v_invito := coalesce((t.regole->>'invito')::int, greatest(1, t.valore_posta / 100));

  -- ▶ NUOVO: chi non ha almeno 2 inviti (più l'eventuale debito della parola) deve prendere una posta
  select string_agg(public.nick(tg.giocatore_id), ', ' order by tg.posto) into v_senza
    from public.tavolo_giocatori tg
   where tg.tavolo_id = p_tavolo
     and not exists (select 1 from public.giocatori_automatici a where a.id = tg.giocatore_id)
     and tg.fiches < 2 * v_invito + coalesce((t.debiti_parol->>(tg.giocatore_id::text))::int, 0);
  if v_senza is not null then
    raise exception 'In attesa della posta di %.', v_senza;
  end if;
  -- ◀ fine della parte nuova

  select coalesce(max(numero), 0) + 1 into v_numero from public.mani where tavolo_id = p_tavolo;
  v_buio := coalesce(t.regole->>'buio', 'si') = 'si' and not t.dopo_parola and t.livello_apertura = 0;

  insert into public.mani (tavolo_id, numero, mazziere, bassa, requisito, fase, piatto)
  values (p_tavolo, v_numero, v_mazziere, v_bassa, v_req, case when v_buio then 'buio' else 'apertura' end, t.piatto_riporto)
  returning id into v_id;

  insert into public.mani_giocatori (mano_id, giocatore_id, posto, stato, deve_parlare)
  select v_id, giocatore_id, posto, 'attivo', true from public.tavolo_giocatori where tavolo_id = p_tavolo;
  insert into public.mani_carte (mano_id, giocatore_id)
  select v_id, giocatore_id from public.tavolo_giocatori where tavolo_id = p_tavolo;
  insert into public.mani_mazzo (mano_id, mazzo) values (v_id, public.mazzo_mescolato(v_bassa));

  perform public.registra(v_id, null, 'mano', null,
    'Mano ' || v_numero || ': mescola ' || public.nick((select giocatore_id from public.tavolo_giocatori
      where tavolo_id = p_tavolo and posto = v_mazziere))
    || '. Si apre con almeno una coppia di ' || public.nome_valore(v_req, true)
    || case when t.dopo_parola then ' e niente buio, perché la mano prima è finita con una parola.'
            when t.livello_apertura > 0 then ' e niente buio, perché il buio si fa solo quando si apre ai jack.'
            else '.' end);

  for g in select giocatore_id from public.mani_giocatori where mano_id = v_id loop
    v_dovuto := v_invito + coalesce((t.debiti_parol->>(g.giocatore_id::text))::int, 0);
    while (select fiches from public.tavolo_giocatori where tavolo_id = p_tavolo and giocatore_id = g.giocatore_id) < v_dovuto loop
      perform public.aggiungi_posta(p_tavolo, g.giocatore_id);
      perform public.registra(v_id, g.giocatore_id, 'posta', null,
        public.nick(g.giocatore_id) || ' prende un''altra posta per l''invito.');
    end loop;
    perform public.paga(v_id, p_tavolo, g.giocatore_id, v_dovuto);
  end loop;
  update public.mani_giocatori set versato_giro = 0 where mano_id = v_id;

  update public.tavoli
     set mazziere = v_mazziere, piatto_riporto = 0, debiti_parol = '{}'::jsonb, mano_corrente = v_id, dopo_parola = false
   where id = p_tavolo;

  if v_buio then
    update public.mani set turno = public.prossimo_posto(v_id, v_mazziere, false) where id = v_id;
  else
    perform public.distribuisci(v_id);
    update public.mani set turno = public.prossimo_posto(v_id, v_mazziere, true) where id = v_id;
  end if;
  return v_id;
end;
$function$;
