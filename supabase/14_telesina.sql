-- 14_telesina.sql
-- Telesina (detta anche Teresina) a scelta del mazziere, con la vela come opzione del tavolo.
-- Regole da Pagat (pagat.com/poker/variants/telesina.html).
-- Le funzioni modificate partono dalla versione in uso su Supabase (estratta il 30/10).

-- ───────────── Tabelle ─────────────
alter table public.mani add column if not exists gioco text not null default 'italiana';
alter table public.mani add column if not exists con_vela boolean not null default false;
alter table public.mani add column if not exists vela text;               -- la vela, visibile solo quando si gira
alter table public.mani add column if not exists giro int not null default 0;
alter table public.mani add column if not exists buio_possibile boolean not null default false;
alter table public.mani_giocatori add column if not exists scoperte text[] not null default '{}';  -- carte scoperte (Telesina)
alter table public.mani_mazzo add column if not exists vela text;          -- la vela coperta: non la legge nessuno

do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.mani'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%fase%'
  loop
    execute format('alter table public.mani drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.mani add constraint mani_fase_check check (fase in
  ('scelta', 'buio', 'apertura', 'primo_giro', 'cambio', 'secondo_giro', 'telesina', 'finita', 'annullata'));
alter table public.mani drop constraint if exists mani_gioco_check;
alter table public.mani add constraint mani_gioco_check check (gioco in ('italiana', 'telesina'));

-- ───────────── Funzioni ─────────────
CREATE OR REPLACE FUNCTION public.valuta_cinque(p_carte text[], p_bassa integer)
 RETURNS integer[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v int[]; s int[];
  colore boolean; scala boolean := false; asso_basso boolean := false;
  alta int; seme_alta int;
  r record;
  quad int; tris int;
  coppie int[] := '{}'; semi_coppie int[] := '{}'; singole int[] := '{}';
begin
  select array_agg(public.valore_carta(c) order by public.valore_carta(c) desc, public.seme_carta(c) desc),
         array_agg(public.seme_carta(c)  order by public.valore_carta(c) desc, public.seme_carta(c) desc)
    into v, s
    from unnest(p_carte) c;

  colore := (select count(distinct x) from unnest(s) x) = 1;

  if (select count(distinct x) from unnest(v) x) = 5 then
    if v[1] - v[5] = 4 then
      scala := true; alta := v[1]; seme_alta := s[1];
    elsif v[1] = 14 and v[2] = p_bassa + 3 and v[5] = p_bassa then
      -- l'asso vale come carta sotto la più bassa del mazzo
      scala := true; asso_basso := true; alta := v[2]; seme_alta := s[2];
    end if;
  end if;

  if scala and colore then
    return array[9, case when asso_basso then 1 when alta = 14 then 3 else 2 end, alta, seme_alta];
  end if;

  for r in
    select x as val, count(*) as n, max(y) as maxseme
      from unnest(v, s) as t(x, y)
     group by x
     order by count(*) desc, x desc
  loop
    if r.n = 4 then quad := r.val;
    elsif r.n = 3 then tris := r.val;
    elsif r.n = 2 then coppie := coppie || r.val; semi_coppie := semi_coppie || r.maxseme;
    else singole := singole || r.val;
    end if;
  end loop;

  if quad is not null then return array[8, quad] || singole; end if;
  if colore then return array[7] || v || s[1]; end if;
  if tris is not null and cardinality(coppie) = 1 then return array[6, tris, coppie[1]]; end if;
  if scala then return array[5, alta, seme_alta]; end if;
  if tris is not null then return array[4, tris] || singole; end if;
  if cardinality(coppie) = 2 then return array[3, coppie[1], coppie[2], singole[1], semi_coppie[1]]; end if;
  if cardinality(coppie) = 1 then return array[2, coppie[1]] || singole || semi_coppie[1]; end if;
  return array[1] || v || s[1];
end;
$function$;

-- Valuta la mano migliore: con 6 carte (5 + la vela) prende le migliori 5
CREATE OR REPLACE FUNCTION public.valuta_mano(p_carte text[], p_bassa integer)
 RETURNS integer[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when coalesce(cardinality(p_carte), 0) <= 5 then public.valuta_cinque(p_carte, p_bassa)
    else (select max(public.valuta_cinque(
                       array(select c from unnest(p_carte) with ordinality u(c, k) where k <> i order by k), p_bassa))
            from generate_series(1, cardinality(p_carte)) i)
  end
$function$;

-- Punto delle carte scoperte (Telesina): contano solo poker, tris, doppia coppia, coppia e carta alta.
-- [categoria (5 poker, 4 tris, 3 doppia coppia, 2 coppia, 1 carta alta), valori dei gruppi..., seme della carta più alta]
CREATE OR REPLACE FUNCTION public.valuta_vista(p_carte text[])
 RETURNS integer[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare r record; v_val int[] := '{}'; v_n int[] := '{}'; v_seme int; v_cat int;
begin
  if coalesce(cardinality(p_carte), 0) = 0 then return array[0]; end if;
  for r in
    select public.valore_carta(c) as val, count(*)::int as n, max(public.seme_carta(c)) as maxseme
      from unnest(p_carte) c group by 1 order by count(*) desc, 1 desc
  loop
    if v_seme is null then v_seme := r.maxseme; end if;
    v_val := v_val || r.val; v_n := v_n || r.n;
  end loop;
  v_cat := case when v_n[1] = 4 then 5
                when v_n[1] = 3 then 4
                when v_n[1] = 2 and cardinality(v_n) > 1 and v_n[2] = 2 then 3
                when v_n[1] = 2 then 2
                else 1 end;
  return array[v_cat] || v_val || v_seme;
end;
$function$;

CREATE OR REPLACE FUNCTION public.nome_vista(p integer[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p[1]
    when 5 then 'poker di ' || public.nome_valore(p[2], true)
    when 4 then 'tris di ' || public.nome_valore(p[2], true)
    when 3 then 'doppia coppia di ' || public.nome_valore(p[2], true) || ' e ' || public.nome_valore(p[3], true)
    when 2 then 'coppia di ' || public.nome_valore(p[2], true)
    else 'carta più alta: ' || public.nome_valore(p[2])
  end
$function$;

CREATE OR REPLACE FUNCTION public.nome_carta(c text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select public.nome_valore(public.valore_carta(c)) || ' di '
         || case right(c, 1) when 'C' then 'cuori' when 'Q' then 'quadri' when 'F' then 'fiori' else 'picche' end
$function$;

-- Il mazziere sceglie il gioco della mano (solo ai tavoli che ammettono la Telesina)
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
      public.nick(v_utente) || ' sceglie la Telesina' || case when p_vela then ' con la vela.' else '.' end);
    perform public.telesina_avvia(p_mano, coalesce(p_vela, false));
  else
    raise exception 'Gioco non valido.';
  end if;
end;
$function$;

-- Telesina: una carta coperta e una scoperta a testa (e la vela al centro, coperta)
CREATE OR REPLACE FUNCTION public.telesina_avvia(p_mano uuid, p_vela boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.mani%rowtype; g record; v_c text; v_n int := 0;
begin
  select * into m from public.mani where id = p_mano;
  update public.mani
     set gioco = 'telesina', con_vela = p_vela, vela = null, fase = 'telesina', giro = 1,
         puntata = 0, ultimo_rilancio = null, parol_possibile = false
   where id = p_mano;
  if p_vela then
    v_c := (public.pesca(p_mano, 1))[1];
    update public.mani_mazzo set vela = v_c where mano_id = p_mano;
  end if;
  -- Prima giro: la carta coperta
  for g in select giocatore_id from public.mani_giocatori where mano_id = p_mano order by (posto <= m.mazziere), posto loop
    update public.mani_carte set carte = carte || public.pesca(p_mano, 1)
     where mano_id = p_mano and giocatore_id = g.giocatore_id;
  end loop;
  -- Secondo giro: la carta scoperta
  for g in select giocatore_id from public.mani_giocatori where mano_id = p_mano order by (posto <= m.mazziere), posto loop
    v_c := (public.pesca(p_mano, 1))[1];
    update public.mani_carte set carte = carte || v_c where mano_id = p_mano and giocatore_id = g.giocatore_id;
    update public.mani_giocatori set scoperte = scoperte || v_c where mano_id = p_mano and giocatore_id = g.giocatore_id;
    v_n := v_n + 2;
  end loop;
  perform public.registra(p_mano, null, 'carta', v_n,
    'Una carta coperta e una scoperta a testa' || case when p_vela then ', e la vela coperta al centro.' else '.' end);
  perform public.telesina_inizia_giro(p_mano);
end;
$function$;

-- Telesina: inizio di un giro di puntate. Parla per primo chi ha il punto migliore tra le carte scoperte
CREATE OR REPLACE FUNCTION public.telesina_inizia_giro(p_mano uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.mani%rowtype; v_primo int; v_chi uuid; v_scoperte text[]; v_possono int; v_dentro int;
begin
  select * into m from public.mani where id = p_mano;
  update public.mani_giocatori set versato_giro = 0, deve_parlare = (stato = 'attivo' and not tutto_dentro)
   where mano_id = p_mano;
  select count(*) filter (where not tutto_dentro), count(*) filter (where tutto_dentro)
    into v_possono, v_dentro
    from public.mani_giocatori where mano_id = p_mano and stato = 'attivo';
  -- Nessuno può più puntare (o ne resta uno solo contro chi ha messo tutte le fiches): si va avanti
  if v_possono = 0 or (v_possono = 1 and v_dentro > 0) then
    update public.mani_giocatori set deve_parlare = false where mano_id = p_mano;
    perform public.telesina_fine_giro(p_mano);
    return;
  end if;
  select posto, giocatore_id, scoperte into v_primo, v_chi, v_scoperte
    from public.mani_giocatori
   where mano_id = p_mano and stato = 'attivo' and not tutto_dentro
   order by public.valuta_vista(scoperte) desc
   limit 1;
  update public.mani set puntata = 0, ultimo_rilancio = null, turno = v_primo where id = p_mano;
  perform public.registra(p_mano, null, 'fase', null,
    case when m.giro = 5 then 'Giro della vela' else m.giro || '° giro di puntate' end
    || ': parla per primo ' || public.nick(v_chi) || ' (' || public.nome_vista(public.valuta_vista(v_scoperte)) || ').');
end;
$function$;

-- Telesina: fine di un giro di puntate. Altra carta scoperta, poi la vela (se c'è), infine il confronto
CREATE OR REPLACE FUNCTION public.telesina_fine_giro(p_mano uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.mani%rowtype; g record; v_c text; v_n int := 0;
begin
  select * into m from public.mani where id = p_mano;
  if m.giro < 4 then
    for g in select giocatore_id from public.mani_giocatori
              where mano_id = p_mano and stato = 'attivo' order by (posto <= m.mazziere), posto loop
      v_c := (public.pesca(p_mano, 1))[1];
      update public.mani_carte set carte = carte || v_c where mano_id = p_mano and giocatore_id = g.giocatore_id;
      update public.mani_giocatori set scoperte = scoperte || v_c where mano_id = p_mano and giocatore_id = g.giocatore_id;
      v_n := v_n + 1;
    end loop;
    update public.mani set giro = giro + 1 where id = p_mano;
    perform public.registra(p_mano, null, 'carta', v_n,
      case when m.giro + 1 = 4 then 'Ultima carta scoperta a testa.' else 'Un''altra carta scoperta a testa.' end);
    perform public.telesina_inizia_giro(p_mano);
  elsif m.con_vela and m.vela is null then
    select vela into v_c from public.mani_mazzo where mano_id = p_mano;
    update public.mani set vela = v_c, giro = 5 where id = p_mano;
    perform public.registra(p_mano, null, 'vela', null, 'Si gira la vela: ' || public.nome_carta(v_c) || '.');
    perform public.telesina_inizia_giro(p_mano);
  else
    -- Al confronto la vela vale per tutti: ognuno usa le migliori 5 carte su 6
    if m.con_vela and m.vela is not null then
      update public.mani_carte c set carte = c.carte || m.vela
        from public.mani_giocatori x
       where c.mano_id = p_mano and x.mano_id = p_mano and x.giocatore_id = c.giocatore_id and x.stato = 'attivo';
    end if;
    perform public.confronto(p_mano);
  end if;
end;
$function$;

-- Mostra le carte dopo aver vinto perché gli altri hanno lasciato (anche in Telesina, con meno di 5 carte)
CREATE OR REPLACE FUNCTION public.mostra_carte(p_mano uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.mani%rowtype; v_utente uuid := auth.uid(); v_carte text[]; v_punto text;
begin
  select * into m from public.mani where id = p_mano for update;
  if not found then raise exception 'Mano non trovata.'; end if;
  if m.fase <> 'finita' or coalesce(m.esito->>'tipo', '') <> 'unico'
     or not (m.esito->'vincitori') ? v_utente::text then
    raise exception 'Puoi mostrare le carte solo se hai vinto perché gli altri hanno lasciato.';
  end if;
  -- Solo finché la mano è ancora quella sul tavolo
  if (select mano_corrente from public.tavoli where id = m.tavolo_id) is distinct from p_mano then
    raise exception 'La mano è già passata.';
  end if;
  if exists (select 1 from public.mani_giocatori where mano_id = p_mano and giocatore_id = v_utente and carte_mostrate is not null) then
    return;
  end if;
  select carte into v_carte from public.mani_carte where mano_id = p_mano and giocatore_id = v_utente;
  if m.gioco = 'telesina' then
    if coalesce(cardinality(v_carte), 0) = 0 then raise exception 'Carte non disponibili.'; end if;
  elsif coalesce(cardinality(v_carte), 0) <> 5 then
    raise exception 'Carte non disponibili.';
  end if;
  if cardinality(v_carte) >= 5 then v_punto := public.nome_punto(public.valuta_mano(v_carte, m.bassa)); end if;
  update public.mani_giocatori set carte_mostrate = v_carte, punto = v_punto
   where mano_id = p_mano and giocatore_id = v_utente;
  perform public.registra(p_mano, v_utente, 'mostra', null,
    public.nick(v_utente) || ' mostra le carte'
    || case when v_punto is not null then ': ' || lower(left(v_punto, 1)) || substr(v_punto, 2) else '' end || '.');
end;
$function$;


-- nuova_mano (versione in uso + Telesina)
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
  v_id uuid; g record; v_buio boolean; v_scelta boolean;
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
  select coalesce(max(numero), 0) + 1 into v_numero from public.mani where tavolo_id = p_tavolo;
  v_buio := coalesce(t.regole->>'buio', 'si') = 'si' and not t.dopo_parola and t.livello_apertura = 0;
  -- Telesina ammessa al tavolo: il gioco lo sceglie il mazziere prima della distribuzione
  v_scelta := coalesce(t.regole->>'giochi', 'italiana') = 'entrambi';

  insert into public.mani (tavolo_id, numero, mazziere, bassa, requisito, fase, piatto, buio_possibile)
  values (p_tavolo, v_numero, v_mazziere, v_bassa, v_req,
          case when v_scelta then 'scelta' when v_buio then 'buio' else 'apertura' end, t.piatto_riporto, v_buio)
  returning id into v_id;

  insert into public.mani_giocatori (mano_id, giocatore_id, posto, stato, deve_parlare)
  select v_id, giocatore_id, posto, 'attivo', true from public.tavolo_giocatori where tavolo_id = p_tavolo;
  insert into public.mani_carte (mano_id, giocatore_id)
  select v_id, giocatore_id from public.tavolo_giocatori where tavolo_id = p_tavolo;
  insert into public.mani_mazzo (mano_id, mazzo) values (v_id, public.mazzo_mescolato(v_bassa));

  perform public.registra(v_id, null, 'mano', null,
    'Mano ' || v_numero || ': mescola ' || public.nick((select giocatore_id from public.tavolo_giocatori
      where tavolo_id = p_tavolo and posto = v_mazziere))
    || case when v_scelta then ', che sceglie il gioco.' else '' end
    || case when v_scelta then '' else '. Si apre con almeno una coppia di ' || public.nome_valore(v_req, true)
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
     set mazziere = v_mazziere, piatto_riporto = 0, debiti_parol = '{}'::jsonb, mano_corrente = v_id, dopo_parola = false
   where id = p_tavolo;

  if v_scelta then
    update public.mani set turno = v_mazziere where id = v_id;
  elsif v_buio then
    update public.mani set turno = public.prossimo_posto(v_id, v_mazziere, false) where id = v_id;
  else
    perform public.distribuisci(v_id);
    update public.mani set turno = public.prossimo_posto(v_id, v_mazziere, true) where id = v_id;
  end if;
  return v_id;
end;
$function$;

-- azione (versione in uso + Telesina)
CREATE OR REPLACE FUNCTION public.azione(p_mano uuid, p_tipo text, p_importo integer DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.mani%rowtype; t public.tavoli%rowtype; io public.mani_giocatori%rowtype;
  v_utente uuid := auth.uid();
  v_invito int; v_limite text; v_tetto int; v_da_vedere int; v_carte text[]; v_nick text;
  v_sono_buio boolean; v_ho_diritto boolean; v_fiches int; v_pagato int;
begin
  select * into m from public.mani where id = p_mano for update;
  if not found then raise exception 'Mano non trovata.'; end if;
  select * into t from public.tavoli where id = m.tavolo_id;
  select * into io from public.mani_giocatori where mano_id = p_mano and giocatore_id = v_utente;
  if not found then raise exception 'Non partecipi a questa mano.'; end if;
  if m.fase not in ('apertura', 'primo_giro', 'secondo_giro', 'telesina') then raise exception 'In questa fase non si punta.'; end if;
  if io.stato <> 'attivo' then raise exception 'Sei uscito da questa mano.'; end if;
  if m.turno is distinct from io.posto then raise exception 'Non è il tuo turno.'; end if;
  if io.tutto_dentro and p_tipo <> 'passo' then
    raise exception 'Hai messo tutte le tue fiches: giochi per la parte che hai coperto.';
  end if;

  v_nick := public.nick(v_utente);
  v_invito := coalesce((t.regole->>'invito')::int, greatest(1, t.valore_posta / 100));
  v_limite := coalesce(t.regole->>'limite', 'apertura');
  v_da_vedere := m.puntata - io.versato_giro;
  v_sono_buio := m.buio_aperto and m.buio_di = v_utente;
  v_ho_diritto := m.buio_aperto and (m.buio_di = v_utente or v_utente = any(m.buio_coperti));
  select fiches into v_fiches from public.tavolo_giocatori where tavolo_id = t.id and giocatore_id = v_utente;

  if m.buio_aperto and not v_ho_diritto and p_tipo not in ('passo', 'vedo') then
    raise exception 'Dopo il buio puoi solo vedere o lasciare: rilancia solo chi ha fatto il buio o l''ha coperto.';
  end if;

  if p_tipo in ('apro', 'punto', 'rilancio') then
    if p_importo is null or p_importo < v_invito then
      raise exception 'La puntata minima è di % V.', v_invito;
    end if;
    v_tetto := case
      when v_limite = 'piatto' or (v_limite = 'apertura' and p_tipo = 'apro')
           or (v_limite = 'apertura' and m.fase = 'telesina' and p_tipo = 'punto') then m.piatto + v_da_vedere
      when v_limite = 'fisso' then (t.regole->>'puntata_massima')::int
      else null end;
    if v_tetto is not null and p_importo > v_tetto then
      raise exception 'La puntata massima ora è di % V.', v_tetto;
    end if;
    if (p_importo + (case when p_tipo = 'rilancio' then v_da_vedere else 0 end)) > v_fiches then
      raise exception 'Non hai abbastanza fiches: hai % V.', v_fiches;
    end if;
  end if;

  if m.fase = 'apertura' then
    if p_tipo = 'passo' then
      update public.mani_giocatori set deve_parlare = false where mano_id = p_mano and giocatore_id = v_utente;
      perform public.registra(p_mano, v_utente, 'passo', null, v_nick || ' passa.');
    elsif p_tipo = 'apro' then
      select carte into v_carte from public.mani_carte where mano_id = p_mano and giocatore_id = v_utente;
      if not public.puo_aprire(v_carte, m.requisito, m.bassa) then
        raise exception 'Per aprire serve almeno una coppia di % (o 4 carte di fila dello stesso seme senza asso).',
          public.nome_valore(m.requisito, true);
      end if;
      perform public.paga(p_mano, t.id, v_utente, p_importo);
      update public.mani set fase = 'primo_giro', apritore = v_utente, puntata = p_importo where id = p_mano;
      update public.mani_giocatori set deve_parlare = (giocatore_id <> v_utente and not tutto_dentro)
       where mano_id = p_mano and stato = 'attivo';
      perform public.registra(p_mano, v_utente, 'apro', p_importo, v_nick || ' apre con ' || p_importo || ' V.');
    else
      raise exception 'Prima dell''apertura puoi solo passare o aprire.';
    end if;
  else
    if v_sono_buio or (v_ho_diritto and p_tipo = 'rilancio') then
      update public.mani set buio_aperto = false where id = p_mano;
    end if;

    if p_tipo = 'passo' then
      update public.mani_giocatori
         set stato = 'fuori', deve_parlare = false, uscito_primo_giro = (m.fase = 'primo_giro')
       where mano_id = p_mano and giocatore_id = v_utente;
      perform public.registra(p_mano, v_utente, 'lascio', null, v_nick || ' lascia.');
    elsif p_tipo = 'vedo' then
      if v_da_vedere <= 0 then
        if v_ho_diritto then
          update public.mani_giocatori set deve_parlare = false where mano_id = p_mano and giocatore_id = v_utente;
          perform public.registra(p_mano, v_utente, 'chiudo', null,
            v_nick || case when v_sono_buio then ' chiude il giro.' else ' non rilancia.' end);
        else
          raise exception 'Non c''è nessuna puntata da vedere.';
        end if;
      elsif v_fiches < v_da_vedere then
        -- Non bastano le fiches: vede con tutto quello che ha e gioca per la parte coperta
        v_pagato := public.paga_fino(p_mano, t.id, v_utente, v_da_vedere);
        update public.mani_giocatori set deve_parlare = false, tutto_dentro = true
         where mano_id = p_mano and giocatore_id = v_utente;
        perform public.registra(p_mano, v_utente, 'vedo', v_pagato,
          v_nick || ' vede con tutte le sue fiches (' || v_pagato || ' V): gioca solo per la parte che ha coperto.');
      else
        perform public.paga(p_mano, t.id, v_utente, v_da_vedere);
        update public.mani_giocatori set deve_parlare = false where mano_id = p_mano and giocatore_id = v_utente;
        perform public.registra(p_mano, v_utente, 'vedo', v_da_vedere, v_nick || ' vede (' || v_da_vedere || ' V).');
      end if;
    elsif p_tipo = 'rilancio' then
      if m.puntata = 0 then raise exception 'Non c''è niente da rilanciare: punta.'; end if;
      perform public.paga(p_mano, t.id, v_utente, v_da_vedere + p_importo);
      update public.mani set puntata = puntata + p_importo, ultimo_rilancio = v_utente where id = p_mano;
      update public.mani_giocatori set deve_parlare = (giocatore_id <> v_utente and not tutto_dentro)
       where mano_id = p_mano and stato = 'attivo';
      perform public.registra(p_mano, v_utente, 'rilancio', p_importo, v_nick || ' rilancia di ' || p_importo || ' V.');
    elsif p_tipo = 'punto' then
      if m.fase not in ('secondo_giro', 'telesina') or m.puntata > 0 then raise exception 'C''è già una puntata: vedi o rilancia.'; end if;
      perform public.paga(p_mano, t.id, v_utente, p_importo);
      update public.mani set puntata = p_importo, ultimo_rilancio = v_utente, parol_possibile = false where id = p_mano;
      update public.mani_giocatori set deve_parlare = (giocatore_id <> v_utente and not tutto_dentro)
       where mano_id = p_mano and stato = 'attivo';
      perform public.registra(p_mano, v_utente, 'punto', p_importo, v_nick || ' punta ' || p_importo || ' V.');
    elsif p_tipo = 'busso' then
      if m.fase not in ('secondo_giro', 'telesina') or m.puntata > 0 then raise exception 'C''è già una puntata: vedi o rilancia.'; end if;
      update public.mani set parol_possibile = false where id = p_mano;
      update public.mani_giocatori set deve_parlare = false where mano_id = p_mano and giocatore_id = v_utente;
      -- NUOVO: il primo busso fa cadere la parola, quindi chi l'aveva detta torna a parlare
      if m.parol_possibile then
        update public.mani_giocatori g set deve_parlare = true
         where g.mano_id = p_mano and g.stato = 'attivo' and not g.tutto_dentro
           and g.giocatore_id <> v_utente
           and exists (select 1 from public.mani_azioni a
                        where a.mano_id = p_mano and a.giocatore_id = g.giocatore_id and a.tipo = 'parol');
      end if;
      perform public.registra(p_mano, v_utente, 'busso', null, v_nick || ' bussa.');
    elsif p_tipo = 'parol' then
      if m.fase <> 'secondo_giro' or m.puntata > 0 or not m.parol_possibile then
        raise exception 'Parola non è più possibile: qualcuno ha già bussato o puntato.';
      end if;
      update public.mani_giocatori set deve_parlare = false where mano_id = p_mano and giocatore_id = v_utente;
      perform public.registra(p_mano, v_utente, 'parol', null, v_nick || ' dice parola.');
    else
      raise exception 'Azione non valida.';
    end if;
  end if;

  perform public.avanza(p_mano);
end;
$function$;

-- avanza (versione in uso + Telesina)
CREATE OR REPLACE FUNCTION public.avanza(p_mano uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.mani%rowtype; v_attivi int; v_unico uuid; v_prossimo int;
begin
  select * into m from public.mani where id = p_mano;
  select count(*), min(giocatore_id::text)::uuid into v_attivi, v_unico
    from public.mani_giocatori where mano_id = p_mano and stato = 'attivo';

  if v_attivi = 1 and m.fase <> 'apertura' then
    perform public.chiudi_mano(p_mano, array[v_unico], 'unico');
    return;
  end if;

  v_prossimo := public.prossimo_posto(p_mano, m.turno, true);
  if v_prossimo is not null then
    update public.mani set turno = v_prossimo where id = p_mano;
    return;
  end if;

  if m.fase = 'apertura' then
    perform public.annulla_mano(p_mano, 'passano');
  elsif m.fase = 'primo_giro' then
    update public.mani_giocatori set versato_giro = 0, deve_parlare = (stato = 'attivo') where mano_id = p_mano;
    update public.mani set fase = 'cambio', puntata = 0,
           turno = public.prossimo_posto(p_mano, m.mazziere, true) where id = p_mano;
    perform public.registra(p_mano, null, 'fase', null, 'Si cambiano le carte.');
  elsif m.fase = 'secondo_giro' then
    if m.puntata = 0 and m.parol_possibile then
      perform public.annulla_mano(p_mano, 'parol');
    else
      perform public.confronto(p_mano);
    end if;
  elsif m.fase = 'telesina' then
    perform public.telesina_fine_giro(p_mano);
  end if;
end;
$function$;

-- gioca_bot (versione in uso + Telesina)
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
    -- Mazziere automatico: sceglie a caso tra i giochi ammessi
    v_tipo := case when r < 0.5 then 'italiana'
                   when coalesce(t.regole->>'vela', 'no') = 'si' and r < 0.75 then 'telesina_vela'
                   else 'telesina' end;
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
      case when m.fase = 'scelta' then 'italiana'
           when m.fase = 'buio' and cardinality(m.buio_da_chiedere) > 0 then 'noncopro'
           when m.fase = 'buio' then 'nobuio'
           when m.fase in ('secondo_giro', 'telesina') and m.puntata = 0 then 'busso' else 'passo' end, 0, '{}');
  end;
  return true;
end;
$function$;

-- bot_esegui (versione in uso + Telesina)
CREATE OR REPLACE FUNCTION public.bot_esegui(p_mano uuid, p_bot uuid, p_fase text, p_tipo text, p_importo integer, p_scarti text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_sub text := current_setting('request.jwt.claim.sub', true);
        v_claims text := current_setting('request.jwt.claims', true);
        v_coda uuid[];
begin
  perform set_config('request.jwt.claim.sub', p_bot::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_bot, 'role', 'authenticated')::text, true);
  begin
    if p_fase = 'scelta' then
      perform public.scegli_gioco(p_mano, case when p_tipo = 'italiana' then 'italiana' else 'telesina' end, p_tipo = 'telesina_vela');
    elsif p_fase = 'buio' then
      select buio_da_chiedere into v_coda from public.mani where id = p_mano;
      if cardinality(v_coda) > 0 and v_coda[1] = p_bot then
        perform public.copri_buio(p_mano, p_tipo in ('buio', 'copro'));
      else
        perform public.buio(p_mano, p_tipo = 'buio');
      end if;
    elsif p_fase = 'cambio' then perform public.cambia(p_mano, coalesce(p_scarti, '{}'));
    else perform public.azione(p_mano, p_tipo, coalesce(p_importo, 0));
    end if;
  exception when others then
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$function$;

-- aggiorna_tavolo (versione in uso + Telesina)
CREATE OR REPLACE FUNCTION public.aggiorna_tavolo(p_tavolo uuid, p_nome text, p_posti integer, p_valore_posta integer, p_regole jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tavolo public.tavoli%rowtype;
  v_seduti int;
  v_regole jsonb;
  v_invito int; v_massima int;
begin
  select * into v_tavolo from public.tavoli where id = p_tavolo for update;
  if not found or v_tavolo.organizzatore <> auth.uid() then
    raise exception 'Solo l''organizzatore può modificare il tavolo.';
  end if;
  if v_tavolo.stato <> 'attesa' then raise exception 'La partita è già iniziata: le regole sono bloccate.'; end if;
  select count(*) into v_seduti from public.tavolo_giocatori where tavolo_id = p_tavolo;
  if p_posti < v_seduti then
    raise exception 'Ci sono già % giocatori seduti: i posti non possono essere meno.', v_seduti;
  end if;
  v_regole := v_tavolo.regole || coalesce(p_regole, '{}'::jsonb);
  if v_regole ? 'invito' then
    v_invito := (v_regole->>'invito')::int;
    if v_invito < 1 or v_invito > p_valore_posta then raise exception 'L''invito deve essere tra 1 e il valore della posta.'; end if;
  end if;
  if coalesce(v_regole->>'limite', 'piatto') = 'fisso' then
    v_massima := (v_regole->>'puntata_massima')::int;
    if v_massima is null or v_massima < coalesce(v_invito, greatest(1, p_valore_posta / 100)) then
      raise exception 'Con il limite fisso indica una puntata massima almeno pari all''invito.';
    end if;
  end if;
  if coalesce((v_regole->>'cambio_max')::int, 4) not in (4, 5) then
    raise exception 'Il cambio massimo può essere di 4 o 5 carte.';
  end if;
  if coalesce(v_regole->>'giochi', 'italiana') not in ('italiana', 'entrambi') then
    raise exception 'Giochi ammessi non validi.';
  end if;
  if coalesce(v_regole->>'vela', 'no') not in ('si', 'no') then
    raise exception 'Valore della vela non valido.';
  end if;
  update public.tavoli
     set nome = trim(p_nome), posti = p_posti, valore_posta = p_valore_posta, regole = v_regole
   where id = p_tavolo;
end;
$function$;

-- ───────────── Permessi ─────────────
revoke execute on function public.valuta_cinque(text[], int), public.valuta_vista(text[]), public.nome_vista(int[]),
  public.nome_carta(text), public.telesina_avvia(uuid, boolean), public.telesina_inizia_giro(uuid),
  public.telesina_fine_giro(uuid) from public, anon, authenticated;
revoke execute on function public.scegli_gioco(uuid, text, boolean) from public, anon;
grant execute on function public.scegli_gioco(uuid, text, boolean) to authenticated;
