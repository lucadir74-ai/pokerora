-- 21_giro_telesina.sql
-- Regola della casa: la Telesina non la sceglie più il mazziere quando vuole.
-- Parte un "giro di Telesina" quando una mano all'italiana finisce al confronto con un punto vincente
-- dal full in su; il giro dura una mano per ogni giocatore seduto, così tutti fanno il mazziere una volta.
-- Durante il giro un altro full o più non cambia nulla. A ogni mano del giro il mazziere sceglie
-- se giocarla con la vela (solo se il tavolo la ammette). Da eseguire dopo il 19 e il 20.

alter table public.tavoli add column if not exists telesina_restanti int not null default 0;
alter table public.tavoli add column if not exists telesina_totale int not null default 0;
alter table public.mani add column if not exists obbligata boolean not null default false;  -- mano del giro di Telesina
alter table public.mani add column if not exists telesina_n int;   -- quale mano del giro (1, 2, ...)
alter table public.mani add column if not exists telesina_di int;  -- quante mani ha il giro

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
  v_tel boolean := false; v_avvio boolean := false; v_vela boolean; v_prima public.mani%rowtype; v_n_tel int;
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

CREATE OR REPLACE FUNCTION public.scegli_gioco(p_mano uuid, p_gioco text, p_vela boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.mani%rowtype; t public.tavoli%rowtype; v_utente uuid := auth.uid(); v_posto int;
begin
  select * into m from public.mani where id = p_mano for update;
  if not found then raise exception 'Mano non trovata.'; end if;
  select posto into v_posto from public.mani_giocatori where mano_id = p_mano and giocatore_id = v_utente;
  if not found then raise exception 'Non partecipi a questa mano.'; end if;
  if m.fase <> 'scelta' then raise exception 'Il gioco di questa mano è già stato scelto.'; end if;
  if m.turno is distinct from v_posto then raise exception 'Il gioco lo sceglie il mazziere.'; end if;
  select * into t from public.tavoli where id = m.tavolo_id;

  if m.obbligata and p_gioco <> 'telesina' then
    raise exception 'Siamo nel giro di Telesina: puoi scegliere solo se giocarla con la vela.';
  end if;

  if p_gioco = 'italiana' then
    update public.mani set fase = case when m.buio_possibile then 'buio' else 'apertura' end where id = p_mano;
    perform public.registra(p_mano, v_utente, 'gioco', null,
      public.nick(v_utente) || ' sceglie il poker all''italiana: si apre con almeno una coppia di '
      || public.nome_valore(m.requisito, true) || case when m.buio_possibile then '.' else ' e niente buio.' end);
    if m.buio_possibile then
      update public.mani set turno = public.prossimo_posto(p_mano, m.mazziere, false) where id = p_mano;
    else
      perform public.distribuisci(p_mano);
      update public.mani set turno = public.prossimo_posto(p_mano, m.mazziere, true) where id = p_mano;
    end if;
  elsif p_gioco = 'telesina' then
    if coalesce(p_vela, false) and coalesce(t.regole->>'vela', 'no') <> 'si' then
      raise exception 'A questo tavolo la vela non è ammessa.';
    end if;
    perform public.registra(p_mano, v_utente, 'gioco', null,
      public.nick(v_utente) || case when p_vela then ' gioca la Telesina con la vela.' else ' gioca la Telesina senza vela.' end);
    perform public.telesina_avvia(p_mano, coalesce(p_vela, false));
  else
    raise exception 'Gioco non valido.';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.gioca_bot(p_mano uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.mani%rowtype; t public.tavoli%rowtype; b public.mani_giocatori%rowtype;
  v_carte text[]; v int[]; v_cat int := 0; v_invito int; v_limite text; v_da_vedere int; v_tetto int;
  v_tipo text; v_importo int := 0; v_scarti text[] := '{}'; v_max int; v_fiches int;
  v_ho_diritto boolean; v_puo_rilanciare boolean; r float8 := random(); v_k int;
begin
  if not public.sono_alla_mano(p_mano) then raise exception 'Non sei seduto a questo tavolo.'; end if;
  select * into m from public.mani where id = p_mano for update;
  if not found or m.turno is null
     or m.fase not in ('scelta', 'buio', 'apertura', 'primo_giro', 'cambio', 'secondo_giro', 'telesina') then
    return false;
  end if;
  select g.* into b from public.mani_giocatori g
    join public.giocatori_automatici a on a.id = g.giocatore_id
   where g.mano_id = p_mano and g.posto = m.turno and g.stato = 'attivo';
  if not found then return false; end if;

  select * into t from public.tavoli where id = m.tavolo_id;
  select fiches into v_fiches from public.tavolo_giocatori where tavolo_id = m.tavolo_id and giocatore_id = b.giocatore_id;
  select carte into v_carte from public.mani_carte where mano_id = p_mano and giocatore_id = b.giocatore_id;
  if coalesce(cardinality(v_carte), 0) = 5 then
    v := public.valuta_mano(v_carte, m.bassa);
    v_cat := v[1];
  end if;
  v_invito := coalesce((t.regole->>'invito')::int, greatest(1, t.valore_posta / 100));
  v_limite := coalesce(t.regole->>'limite', 'apertura');
  v_da_vedere := greatest(m.puntata - b.versato_giro, 0);
  v_ho_diritto := m.buio_aperto and (m.buio_di = b.giocatore_id or b.giocatore_id = any(m.buio_coperti));
  v_puo_rilanciare := m.puntata > 0 and (not m.buio_aperto or v_ho_diritto);
  v_tetto := case
    when v_limite = 'piatto' or (v_limite = 'apertura' and m.fase = 'apertura')
         or (v_limite = 'apertura' and m.fase = 'telesina' and m.puntata = 0) then m.piatto + v_da_vedere
    when v_limite = 'fisso' then (t.regole->>'puntata_massima')::int
    else null end;

  if m.fase = 'buio' then
    if cardinality(m.buio_da_chiedere) > 0 then
      if r < 0.5 then v_tipo := 'copro'; v_importo := m.buio_importo - b.versato_giro; else v_tipo := 'noncopro'; end if;
    elsif r < 0.15 and public.puo_fare_buio(p_mano, b.posto) then
      v_tipo := 'buio';
      v_importo := case when m.buio_livello = 0 then m.piatto else m.buio_importo * 2 end;
    else
      v_tipo := 'nobuio';
    end if;
  elsif m.fase = 'scelta' then
    -- Mazziere automatico nel giro di Telesina: con o senza vela, a caso (se la vela è ammessa)
    v_tipo := case when coalesce(t.regole->>'vela', 'no') = 'si' and r < 0.5 then 'telesina_vela' else 'telesina' end;
  elsif m.fase = 'telesina' then
    -- Forza della mano: coppie, tris e poker tra tutte le sue carte; con 5 carte conta anche scala, colore e full
    v_k := (public.valuta_vista(v_carte))[1];
    if coalesce(cardinality(v_carte), 0) >= 5 and v_cat >= 5 then v_k := 5; end if;
    if m.puntata = 0 then
      if v_k >= 3 and r < 0.7 then v_tipo := 'punto'; v_importo := v_invito * 2;
      elsif v_k = 2 and r < 0.35 then v_tipo := 'punto'; v_importo := v_invito;
      else v_tipo := 'busso';
      end if;
    else
      if v_k >= 4 and r < 0.4 then v_tipo := 'rilancio'; v_importo := v_invito * 2;
      elsif v_k >= 2 then v_tipo := 'vedo';
      elsif v_da_vedere <= v_invito * 2 and r < 0.5 and m.giro <= 2 then v_tipo := 'vedo';
      else v_tipo := 'passo';
      end if;
    end if;
  elsif m.fase = 'apertura' then
    if public.puo_aprire(v_carte, m.requisito, m.bassa) then
      v_tipo := 'apro'; v_importo := greatest(v_invito * 2, m.piatto / 2);
    else
      v_tipo := 'passo';
    end if;
  elsif m.fase = 'primo_giro' then
    if v_ho_diritto and v_da_vedere = 0 then
      if v_cat >= 4 and r < 0.5 then v_tipo := 'rilancio'; v_importo := v_invito * 2; else v_tipo := 'vedo'; end if;
    elsif v_cat >= 4 and v_puo_rilanciare and r < 0.45 then
      v_tipo := 'rilancio'; v_importo := v_invito * 2;
    elsif v_cat >= 3 then
      v_tipo := 'vedo';
    elsif v_cat = 2 and (v_da_vedere <= greatest(m.piatto / 2, v_invito * 3) or r < 0.5) then
      v_tipo := 'vedo';
    elsif v_cat <= 1 and r < 0.25 and v_da_vedere <= v_invito * 3 then
      v_tipo := 'vedo';
    else
      v_tipo := 'passo';
    end if;
  elsif m.fase = 'cambio' then
    v_tipo := 'cambio';
    v_max := coalesce((t.regole->>'cambio_max')::int, 4);
    if v_cat >= 5 then
      v_scarti := '{}';
    elsif v_cat = 1 then
      select coalesce(array_agg(c), '{}') into v_scarti from (
        select c from unnest(v_carte) c
         order by public.valore_carta(c) desc, public.seme_carta(c) desc offset 1) x;
    else
      select coalesce(array_agg(c), '{}') into v_scarti from unnest(v_carte) c
       where (select count(*) from unnest(v_carte) d where public.valore_carta(d) = public.valore_carta(c)) = 1;
    end if;
    if cardinality(v_scarti) > v_max then
      select array_agg(c) into v_scarti from (
        select c from unnest(v_scarti) c order by public.valore_carta(c) asc limit v_max) x;
    end if;
  else
    if m.puntata = 0 then
      if v_cat >= 4 then v_tipo := 'punto'; v_importo := v_invito * 3;
      elsif v_cat = 3 and r < 0.7 then v_tipo := 'punto'; v_importo := v_invito * 2;
      elsif m.parol_possibile and v_cat <= 2 and r < 0.6 then v_tipo := 'parol';
      else v_tipo := 'busso';
      end if;
    else
      if v_cat >= 6 and r < 0.5 then v_tipo := 'rilancio'; v_importo := v_invito * 2;
      elsif v_cat >= 3 then v_tipo := 'vedo';
      elsif v_cat = 2 and v_da_vedere <= greatest(m.piatto / 3, v_invito * 2) then v_tipo := 'vedo';
      else v_tipo := 'passo';
      end if;
    end if;
  end if;

  if v_tipo in ('apro', 'punto', 'rilancio') then
    v_importo := greatest(v_invito, least(v_importo, coalesce(v_tetto, v_importo)));
  end if;
  if v_tipo = 'vedo' and v_da_vedere = 0 and not v_ho_diritto then
    v_tipo := case when m.fase in ('secondo_giro', 'telesina') then 'busso' else 'passo' end;
  end if;

  -- Fiches insufficienti: niente poste a metà mano. Buio e coperture saltano,
  -- puntate e rilanci si riducono o diventano un "vedo" (anche con tutte le fiches)
  if v_tipo in ('buio', 'copro') and v_fiches < v_importo then
    v_tipo := case when v_tipo = 'buio' then 'nobuio' else 'noncopro' end;
  elsif v_tipo in ('apro', 'punto') and v_fiches < v_importo then
    if v_fiches >= v_invito then v_importo := v_fiches;
    else v_tipo := case when v_tipo = 'apro' then 'passo' else 'busso' end;
    end if;
  elsif v_tipo = 'rilancio' and v_fiches < v_da_vedere + v_importo then
    if v_fiches - v_da_vedere >= v_invito then v_importo := v_fiches - v_da_vedere; else v_tipo := 'vedo'; end if;
  end if;

  begin
    perform public.bot_esegui(p_mano, b.giocatore_id, m.fase, v_tipo, v_importo, v_scarti);
  exception when others then
    perform public.bot_esegui(p_mano, b.giocatore_id, m.fase,
      case when m.fase = 'scelta' then 'telesina'
           when m.fase = 'buio' and cardinality(m.buio_da_chiedere) > 0 then 'noncopro'
           when m.fase = 'buio' then 'nobuio'
           when m.fase in ('secondo_giro', 'telesina') and m.puntata = 0 then 'busso' else 'passo' end, 0, '{}');
  end;
  return true;
end;
$function$;
