-- 22_richiesta_ingresso.sql
-- A partita in corso chi vuole aggiungersi tocca "Aggiungiti al tavolo": entra solo se un giocatore
-- seduto conferma. Il mazzo si adatta dalla mano successiva al numero di giocatori (già così:
-- nuova_mano conta i seduti a ogni mano); ora la cronaca lo annuncia quando cambia.
-- In sala d'attesa si entra direttamente, come prima. Da eseguire dopo il 21.

-- 1) Richieste di ingresso
create table if not exists public.richieste_ingresso (
  tavolo_id     uuid not null references public.tavoli(id) on delete cascade,
  giocatore_id  uuid not null references public.profili(id) on delete cascade,
  stato         text not null default 'attesa' check (stato in ('attesa', 'accettata', 'rifiutata')),
  creata_il     timestamptz not null default now(),
  decisa_da     uuid references public.profili(id) on delete set null,
  decisa_il     timestamptz,
  primary key (tavolo_id, giocatore_id)
);
alter table public.richieste_ingresso enable row level security;
drop policy if exists "vedo le richieste dei miei tavoli e le mie" on public.richieste_ingresso;
create policy "vedo le richieste dei miei tavoli e le mie" on public.richieste_ingresso
  for select to authenticated using (giocatore_id = auth.uid() or public.sono_al_tavolo(tavolo_id));
revoke all on public.richieste_ingresso from anon, authenticated;
grant select on public.richieste_ingresso to authenticated;
do $$ begin
  alter publication supabase_realtime add table public.richieste_ingresso;
exception when duplicate_object or undefined_object then null;
end $$;

-- 2) Sedersi a partita in corso (interna): la logica del file 18, usata quando la richiesta è accettata
create or replace function public.siedi_in_corso(p_tavolo uuid, p_utente uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tavolo public.tavoli%rowtype; v_posto int; v_fiches int;
begin
  select * into v_tavolo from public.tavoli where id = p_tavolo for update;
  if v_tavolo.stato <> 'in_corso' then raise exception 'La partita non è in corso.'; end if;
  if exists (select 1 from public.tavolo_giocatori where tavolo_id = p_tavolo and giocatore_id = p_utente) then return; end if;
  select min(s) into v_posto from generate_series(1, v_tavolo.posti) s
   where s not in (select posto from public.tavolo_giocatori where tavolo_id = p_tavolo);
  if v_posto is null and v_tavolo.posti < 6 then
    v_posto := v_tavolo.posti + 1;
    update public.tavoli set posti = v_posto where id = p_tavolo;
  end if;
  if v_posto is null then raise exception 'Il tavolo è al completo: si gioca al massimo in 6.'; end if;
  -- Chi rientra ritrova le sue fiches, chi è nuovo riceve la prima posta
  select fiches into v_fiches from public.tavolo_usciti where tavolo_id = p_tavolo and giocatore_id = p_utente;
  if found then
    insert into public.tavolo_giocatori (tavolo_id, giocatore_id, posto, fiches) values (p_tavolo, p_utente, v_posto, v_fiches);
    delete from public.tavolo_usciti where tavolo_id = p_tavolo and giocatore_id = p_utente;
  else
    insert into public.tavolo_giocatori (tavolo_id, giocatore_id, posto, fiches) values (p_tavolo, p_utente, v_posto, 0);
    perform public.aggiungi_posta(p_tavolo, p_utente);
    select fiches into v_fiches from public.tavolo_giocatori where tavolo_id = p_tavolo and giocatore_id = p_utente;
  end if;
  if v_tavolo.mano_corrente is not null then
    perform public.registra(v_tavolo.mano_corrente, p_utente, 'entra', v_fiches,
      public.nick(p_utente) || ' si siede al tavolo con ' || v_fiches || ' V: gioca dalla prossima mano.');
  end if;
end $$;
revoke execute on function public.siedi_in_corso(uuid, uuid) from public, anon, authenticated;

-- 3) Entrare con l'invito: in sala d'attesa direttamente, a partita in corso serve la conferma
create or replace function public.entra_tavolo(p_codice text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_utente uuid := auth.uid(); v_tavolo public.tavoli%rowtype; v_posto int;
begin
  if v_utente is null then raise exception 'Devi entrare con il tuo account.'; end if;
  select * into v_tavolo from public.tavoli where codice_invito = upper(trim(p_codice)) for update;
  if not found then raise exception 'Invito non valido: controlla il link.'; end if;
  if exists (select 1 from public.tavolo_giocatori where tavolo_id = v_tavolo.id and giocatore_id = v_utente) then
    return v_tavolo.id;
  end if;
  if v_tavolo.stato = 'in_corso' then
    raise exception 'La partita è già iniziata: tocca "Aggiungiti al tavolo" e aspetta che un giocatore confermi.';
  end if;
  if v_tavolo.stato <> 'attesa' then raise exception 'La partita a questo tavolo è chiusa.'; end if;
  select min(s) into v_posto from generate_series(1, v_tavolo.posti) s
   where s not in (select posto from public.tavolo_giocatori where tavolo_id = v_tavolo.id);
  if v_posto is null then raise exception 'Il tavolo è al completo.'; end if;
  insert into public.tavolo_giocatori (tavolo_id, giocatore_id, posto) values (v_tavolo.id, v_utente, v_posto);
  return v_tavolo.id;
end $$;

-- 4) "Aggiungiti al tavolo": chiede di sedersi a partita in corso
create or replace function public.chiedi_ingresso(p_codice text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_utente uuid := auth.uid(); v_tavolo public.tavoli%rowtype; v_seduti int;
begin
  if v_utente is null then raise exception 'Devi entrare con il tuo account.'; end if;
  select * into v_tavolo from public.tavoli where codice_invito = upper(trim(p_codice));
  if not found then raise exception 'Invito non valido: controlla il link.'; end if;
  if v_tavolo.stato <> 'in_corso' then raise exception 'La partita non è in corso.'; end if;
  if exists (select 1 from public.tavolo_giocatori where tavolo_id = v_tavolo.id and giocatore_id = v_utente) then
    return v_tavolo.id;
  end if;
  select count(*) into v_seduti from public.tavolo_giocatori where tavolo_id = v_tavolo.id;
  if v_seduti >= 6 then raise exception 'Il tavolo è al completo: si gioca al massimo in 6.'; end if;
  insert into public.richieste_ingresso (tavolo_id, giocatore_id) values (v_tavolo.id, v_utente)
  on conflict (tavolo_id, giocatore_id) do update
    set stato = 'attesa', creata_il = now(), decisa_da = null, decisa_il = null;
  if v_tavolo.mano_corrente is not null then
    perform public.registra(v_tavolo.mano_corrente, v_utente, 'richiesta', null,
      public.nick(v_utente) || ' chiede di aggiungersi al tavolo.');
  end if;
  return v_tavolo.id;
end $$;
revoke execute on function public.chiedi_ingresso(text) from public, anon;
grant execute on function public.chiedi_ingresso(text) to authenticated;

-- 5) Un giocatore seduto accetta o rifiuta
create or replace function public.rispondi_ingresso(p_tavolo uuid, p_giocatore uuid, p_accetta boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_utente uuid := auth.uid(); v_mano uuid;
begin
  if not exists (select 1 from public.tavolo_giocatori where tavolo_id = p_tavolo and giocatore_id = v_utente) then
    raise exception 'Solo chi è seduto al tavolo può rispondere.';
  end if;
  perform 1 from public.richieste_ingresso
   where tavolo_id = p_tavolo and giocatore_id = p_giocatore and stato = 'attesa' for update;
  if not found then raise exception 'La richiesta non c''è più: forse ha già risposto un altro giocatore.'; end if;
  if p_accetta then perform public.siedi_in_corso(p_tavolo, p_giocatore); end if;
  update public.richieste_ingresso
     set stato = case when p_accetta then 'accettata' else 'rifiutata' end, decisa_da = v_utente, decisa_il = now()
   where tavolo_id = p_tavolo and giocatore_id = p_giocatore;
  select mano_corrente into v_mano from public.tavoli where id = p_tavolo;
  if v_mano is not null and not p_accetta then
    perform public.registra(v_mano, v_utente, 'richiesta', null,
      public.nick(v_utente) || ' non fa sedere ' || public.nick(p_giocatore) || '.');
  end if;
end $$;
revoke execute on function public.rispondi_ingresso(uuid, uuid, boolean) from public, anon;
grant execute on function public.rispondi_ingresso(uuid, uuid, boolean) to authenticated;

-- 6) A che punto è la mia richiesta (per la pagina dell'invito)
create or replace function public.mia_richiesta(p_codice text)
returns text language sql stable security definer set search_path = '' as $$
  select r.stato from public.richieste_ingresso r join public.tavoli t on t.id = r.tavolo_id
   where t.codice_invito = upper(trim(p_codice)) and r.giocatore_id = auth.uid();
$$;
revoke execute on function public.mia_richiesta(text) from public, anon;
grant execute on function public.mia_richiesta(text) to authenticated;

-- 7) Nuova mano: annuncia il cambio di mazzo quando cambia il numero di giocatori
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
  v_tel boolean := false; v_avvio boolean := false; v_vela boolean; v_prima public.mani%rowtype; v_n_tel int; v_bassa_prima int;
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
  if t.mano_corrente is not null then select bassa into v_bassa_prima from public.mani where id = t.mano_corrente; end if;
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
  -- ▶ Giro di Telesina: parte quando una mano all'italiana finisce al confronto con un punto vincente
  --   dal full in su, e dura una mano per ogni giocatore seduto (tutti fanno il mazziere una volta)
  v_vela := coalesce(t.regole->>'vela', 'no') = 'si';
  if coalesce(t.regole->>'giochi', 'italiana') = 'entrambi' then
    if t.telesina_restanti = 0 and t.mano_corrente is not null then
      select * into v_prima from public.mani where id = t.mano_corrente;
      if v_prima.gioco = 'italiana' and v_prima.fase = 'finita' and coalesce(v_prima.esito->>'tipo', '') = 'confronto'
         and exists (select 1 from public.mani_giocatori x
                      where x.mano_id = v_prima.id and x.vincita > 0 and x.carte_mostrate is not null
                        and (public.valuta_mano(x.carte_mostrate, v_prima.bassa))[1] >= 6) then
        v_avvio := true;
        t.telesina_restanti := n;
        t.telesina_totale := n;
      end if;
    end if;
    v_tel := t.telesina_restanti > 0;
  end if;
  if v_tel then v_n_tel := t.telesina_totale - t.telesina_restanti + 1; end if;

  insert into public.mani (tavolo_id, numero, mazziere, bassa, requisito, fase, piatto, buio_possibile,
                           obbligata, telesina_n, telesina_di)
  values (p_tavolo, v_numero, v_mazziere, v_bassa, v_req,
          case when v_tel then 'scelta' when v_buio then 'buio' else 'apertura' end, t.piatto_riporto, v_buio,
          v_tel, v_n_tel, case when v_tel then t.telesina_totale end)
  returning id into v_id;

  insert into public.mani_giocatori (mano_id, giocatore_id, posto, stato, deve_parlare)
  select v_id, giocatore_id, posto, 'attivo', true from public.tavolo_giocatori where tavolo_id = p_tavolo;
  insert into public.mani_carte (mano_id, giocatore_id)
  select v_id, giocatore_id from public.tavolo_giocatori where tavolo_id = p_tavolo;
  insert into public.mani_mazzo (mano_id, mazzo) values (v_id, public.mazzo_mescolato(v_bassa));

  perform public.registra(v_id, null, 'mano', null,
    'Mano ' || v_numero || ': mescola ' || public.nick((select giocatore_id from public.tavolo_giocatori
      where tavolo_id = p_tavolo and posto = v_mazziere))
    || case when v_tel then '. '
              || case when v_avvio then 'La mano prima è finita con un punto dal full in su: parte il giro di Telesina. ' else '' end
              || 'Telesina, mano ' || v_n_tel || ' di ' || t.telesina_totale
              || case when v_vela then ': il mazziere sceglie se giocarla con la vela.' else '.' end
            else '' end
    || case when v_tel then '' else '. Si apre con almeno una coppia di ' || public.nome_valore(v_req, true)
    || case when t.dopo_parola then ' e niente buio, perché la mano prima è finita con una parola.'
            when t.livello_apertura > 0 then ' e niente buio, perché il buio si fa solo quando si apre ai jack.'
            else '.' end end);

  -- ▶ Se è cambiato il numero di giocatori (qualcuno è entrato o uscito), cambia anche il mazzo
  if v_bassa_prima is not null and v_bassa_prima <> v_bassa then
    perform public.registra(v_id, null, 'mazzo', null,
      'Ora siete in ' || n || ' al tavolo: il mazzo cambia, si gioca dal ' || public.nome_valore(v_bassa)
      || ' all''asso (' || ((15 - v_bassa) * 4) || ' carte).');
  end if;

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
     set mazziere = v_mazziere, piatto_riporto = 0, debiti_parol = '{}'::jsonb, mano_corrente = v_id, dopo_parola = false,
         telesina_restanti = case when v_tel then t.telesina_restanti - 1 else 0 end,
         telesina_totale = case when v_tel then t.telesina_totale else 0 end
   where id = p_tavolo;

  if v_tel and v_vela then
    update public.mani set turno = v_mazziere where id = v_id;   -- il mazziere sceglie: con o senza vela
  elsif v_tel then
    perform public.telesina_avvia(v_id, false);
  elsif v_buio then
    update public.mani set turno = public.prossimo_posto(v_id, v_mazziere, false) where id = v_id;
  else
    perform public.distribuisci(v_id);
    update public.mani set turno = public.prossimo_posto(v_id, v_mazziere, true) where id = v_id;
  end if;
  return v_id;
end;
$function$;
