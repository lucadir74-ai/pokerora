-- PokerOra · 04 · Motore di gioco del poker all'italiana
-- Da eseguire una volta in Supabase → SQL Editor → New query → Run
-- Regole di riferimento: pagat.com/poker/variants/italian.html
-- Il mazzo e le carte stanno solo sul server: ognuno legge solo le proprie.

-- ───────────── Fiches dei giocatori e stato del tavolo ─────────────
alter table public.tavolo_giocatori add column if not exists fiches int not null default 0;
alter table public.tavoli add column if not exists mazziere int;
alter table public.tavoli add column if not exists livello_apertura int not null default 0; -- 0 fanti, 1 donne, 2 re
alter table public.tavoli add column if not exists piatto_riporto int not null default 0;
alter table public.tavoli add column if not exists debiti_parol jsonb not null default '{}'::jsonb;
alter table public.tavoli add column if not exists mano_corrente uuid;

-- Tavoli già avviati prima di questo script: le fiches partono dalle poste prese
update public.tavolo_giocatori g
   set fiches = (select coalesce(sum(p.valore), 0) from public.poste p
                  where p.tavolo_id = g.tavolo_id and p.giocatore_id = g.giocatore_id)
 where g.fiches = 0;

-- ───────────── Tabelle della mano ─────────────
create table if not exists public.mani (
  id               uuid primary key default gen_random_uuid(),
  tavolo_id        uuid not null references public.tavoli(id) on delete cascade,
  numero           int  not null,
  mazziere         int  not null,
  bassa            int  not null,              -- carta più bassa del mazzo (2..7)
  requisito        int  not null,              -- coppia minima per aprire: 11 J, 12 Q, 13 K
  fase             text not null check (fase in ('apertura','primo_giro','cambio','secondo_giro','finita','annullata')),
  turno            int,                        -- posto di chi deve parlare
  apritore         uuid,
  ultimo_rilancio  uuid,
  puntata          int  not null default 0,    -- versamento più alto nel giro in corso
  piatto           int  not null default 0,
  parol_possibile  boolean not null default true,
  esito            jsonb,
  creata_il        timestamptz not null default now(),
  chiusa_il        timestamptz,
  unique (tavolo_id, numero)
);

create table if not exists public.mani_giocatori (
  mano_id            uuid not null references public.mani(id) on delete cascade,
  giocatore_id       uuid not null references public.profili(id) on delete cascade,
  posto              int  not null,
  stato              text not null default 'attivo' check (stato in ('attivo','fuori')),
  deve_parlare       boolean not null default false,
  versato_giro       int not null default 0,
  versato_mano       int not null default 0,
  cambio             int,
  cambio_pendente    int not null default 0,
  uscito_primo_giro  boolean not null default false,
  carte_mostrate     text[],
  punto              text,
  vincita            int not null default 0,
  primary key (mano_id, giocatore_id)
);

create table if not exists public.mani_carte (       -- le carte in mano: ognuno vede solo le sue
  mano_id       uuid not null references public.mani(id) on delete cascade,
  giocatore_id  uuid not null references public.profili(id) on delete cascade,
  carte         text[] not null default '{}',
  primary key (mano_id, giocatore_id)
);

create table if not exists public.mani_mazzo (       -- mazzo e scarti: non li legge nessuno
  mano_id  uuid primary key references public.mani(id) on delete cascade,
  mazzo    text[] not null,
  scarti   text[] not null default '{}'
);

create table if not exists public.mani_azioni (      -- registro della mano
  id            bigint generated always as identity primary key,
  tavolo_id     uuid not null references public.tavoli(id) on delete cascade,
  mano_id       uuid not null references public.mani(id) on delete cascade,
  giocatore_id  uuid references public.profili(id) on delete set null,
  tipo          text not null,
  importo       int,
  testo         text not null,
  creata_il     timestamptz not null default now()
);
create index if not exists mani_azioni_mano on public.mani_azioni (mano_id, id);

alter table public.mani            enable row level security;
alter table public.mani_giocatori  enable row level security;
alter table public.mani_carte      enable row level security;
alter table public.mani_mazzo      enable row level security;
alter table public.mani_azioni     enable row level security;

create or replace function public.sono_alla_mano(p_mano uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (select 1 from public.mani m where m.id = p_mano and public.sono_al_tavolo(m.tavolo_id));
$$;

drop policy if exists "vedo le mani dei miei tavoli" on public.mani;
create policy "vedo le mani dei miei tavoli" on public.mani
  for select to authenticated using (public.sono_al_tavolo(tavolo_id));
drop policy if exists "vedo i giocatori della mano" on public.mani_giocatori;
create policy "vedo i giocatori della mano" on public.mani_giocatori
  for select to authenticated using (public.sono_alla_mano(mano_id));
drop policy if exists "vedo solo le mie carte" on public.mani_carte;
create policy "vedo solo le mie carte" on public.mani_carte
  for select to authenticated using (giocatore_id = auth.uid());
drop policy if exists "vedo il registro della mano" on public.mani_azioni;
create policy "vedo il registro della mano" on public.mani_azioni
  for select to authenticated using (public.sono_al_tavolo(tavolo_id));
-- mani_mazzo: nessuna regola di lettura → invisibile a tutti

grant select on public.mani, public.mani_giocatori, public.mani_carte, public.mani_azioni to authenticated;
revoke all on public.mani_mazzo from anon, authenticated;

-- ───────────── Carte e punti ─────────────
-- Carta = valore + seme. Valori 2..9, T (10), J, Q, K, A. Semi: C cuori, Q quadri, F fiori, P picche.
create or replace function public.valore_carta(c text) returns int
language sql immutable set search_path = '' as $$ select strpos('23456789TJQKA', left(c, 1)) + 1 $$;

-- Ordine dei semi: Come Quando Fuori Piove
create or replace function public.seme_carta(c text) returns int
language sql immutable set search_path = '' as $$
  select case right(c, 1) when 'C' then 4 when 'Q' then 3 when 'F' then 2 else 1 end
$$;

create or replace function public.mazzo_mescolato(p_bassa int) returns text[]
language sql volatile set search_path = '' as $$
  select array_agg(substr('23456789TJQKA', v - 1, 1) || s order by gen_random_uuid())
  from generate_series(p_bassa, 14) v cross join unnest(array['C','Q','F','P']) s;
$$;

-- Valuta una mano di 5 carte. Il risultato si confronta come array: più alto = migliore.
-- 9 scala reale [9, tipo (1 minima, 2 media, 3 massima), carta alta, seme]
-- 8 poker · 7 colore · 6 full · 5 scala · 4 tris · 3 doppia coppia · 2 coppia · 1 carta alta
create or replace function public.valuta_mano(p_carte text[], p_bassa int) returns int[]
language plpgsql immutable set search_path = '' as $$
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
$$;

create or replace function public.nome_valore(p int, p_plurale boolean default false) returns text
language sql immutable set search_path = '' as $$
  select case p
    when 11 then case when p_plurale then 'fanti' else 'fante' end
    when 12 then case when p_plurale then 'donne' else 'donna' end
    when 13 then 're'
    when 14 then case when p_plurale then 'assi' else 'asso' end
    else p::text end
$$;

create or replace function public.nome_punto(p int[]) returns text
language sql immutable set search_path = '' as $$
  select case p[1]
    when 9 then 'Scala reale ' || (array['minima','media','massima'])[p[2]]
    when 8 then 'Poker di ' || public.nome_valore(p[2], true)
    when 7 then 'Colore'
    when 6 then 'Full di ' || public.nome_valore(p[2], true) || ' e ' || public.nome_valore(p[3], true)
    when 5 then case when p[2] = 14 then 'Scala all''asso' else 'Scala al ' || public.nome_valore(p[2]) end
    when 4 then 'Tris di ' || public.nome_valore(p[2], true)
    when 3 then 'Doppia coppia di ' || public.nome_valore(p[2], true) || ' e ' || public.nome_valore(p[3], true)
    when 2 then 'Coppia di ' || public.nome_valore(p[2], true)
    else 'Carta alta: ' || public.nome_valore(p[2])
  end
$$;

-- Si apre con una coppia almeno del requisito (o un punto superiore),
-- oppure con 4 carte consecutive dello stesso seme senza l'asso
create or replace function public.puo_aprire(p_carte text[], p_requisito int, p_bassa int) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v int[] := public.valuta_mano(p_carte, p_bassa);
begin
  if v[1] >= 3 then return true; end if;
  if v[1] = 2 and v[2] >= p_requisito then return true; end if;
  return exists (
    select 1 from unnest(p_carte) a
     where left(a, 1) <> 'A'
       and (select count(*) from unnest(p_carte) b
             where right(b, 1) = right(a, 1) and left(b, 1) <> 'A'
               and public.valore_carta(b) between public.valore_carta(a) and public.valore_carta(a) + 3) = 4
  );
end;
$$;

-- ───────────── Funzioni interne (non chiamabili dall'app) ─────────────
create or replace function public.registra(p_mano uuid, p_giocatore uuid, p_tipo text, p_importo int, p_testo text)
returns void language sql security definer set search_path = '' as $$
  insert into public.mani_azioni (tavolo_id, mano_id, giocatore_id, tipo, importo, testo)
  select m.tavolo_id, p_mano, p_giocatore, p_tipo, p_importo, p_testo from public.mani m where m.id = p_mano;
$$;

create or replace function public.nick(p_id uuid) returns text
language sql security definer set search_path = '' stable as $$
  select coalesce((select nickname from public.profili where id = p_id), 'giocatore')
$$;

create or replace function public.aggiungi_posta(p_tavolo uuid, p_giocatore uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_numero int; v_valore int;
begin
  select valore_posta into v_valore from public.tavoli where id = p_tavolo;
  select coalesce(max(numero), 0) + 1 into v_numero
    from public.poste where tavolo_id = p_tavolo and giocatore_id = p_giocatore;
  insert into public.poste (tavolo_id, giocatore_id, numero, valore)
  values (p_tavolo, p_giocatore, v_numero, v_valore);
  update public.tavolo_giocatori set fiches = fiches + v_valore
   where tavolo_id = p_tavolo and giocatore_id = p_giocatore;
  return v_numero;
end;
$$;

create or replace function public.paga(p_mano uuid, p_tavolo uuid, p_giocatore uuid, p_importo int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_importo <= 0 then return; end if;
  update public.tavolo_giocatori set fiches = fiches - p_importo
   where tavolo_id = p_tavolo and giocatore_id = p_giocatore and fiches >= p_importo;
  if not found then raise exception 'Non hai abbastanza fiches: prendi un''altra posta.'; end if;
  update public.mani_giocatori
     set versato_giro = versato_giro + p_importo, versato_mano = versato_mano + p_importo
   where mano_id = p_mano and giocatore_id = p_giocatore;
  update public.mani set piatto = piatto + p_importo where id = p_mano;
end;
$$;

-- Pesca dal mazzo; se finisce, si rimescolano gli scarti
create or replace function public.pesca(p_mano uuid, p_n int) returns text[]
language plpgsql security definer set search_path = '' as $$
declare v_mazzo text[]; v_scarti text[];
begin
  if p_n <= 0 then return '{}'; end if;
  select mazzo, scarti into v_mazzo, v_scarti from public.mani_mazzo where mano_id = p_mano for update;
  if coalesce(cardinality(v_mazzo), 0) < p_n then
    v_mazzo := v_mazzo || coalesce((select array_agg(c order by gen_random_uuid()) from unnest(v_scarti) c), '{}');
    v_scarti := '{}';
  end if;
  update public.mani_mazzo set mazzo = v_mazzo[p_n + 1:], scarti = v_scarti where mano_id = p_mano;
  return v_mazzo[1:p_n];
end;
$$;

-- Prossimo posto in senso orario dopo p_da (tra chi è ancora in gioco)
create or replace function public.prossimo_posto(p_mano uuid, p_da int, p_solo_chi_deve_parlare boolean)
returns int language sql security definer set search_path = '' stable as $$
  select posto from public.mani_giocatori
   where mano_id = p_mano and stato = 'attivo' and (not p_solo_chi_deve_parlare or deve_parlare)
   order by (posto <= p_da), posto
   limit 1;
$$;

create or replace function public.chiudi_mano(p_mano uuid, p_vincitori uuid[], p_tipo text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.mani%rowtype;
  g record;
  v_quota int; v_resto int; v_importo int; v_primo boolean := true;
begin
  select * into m from public.mani where id = p_mano;
  v_quota := m.piatto / cardinality(p_vincitori);
  v_resto := m.piatto - v_quota * cardinality(p_vincitori);
  for g in
    select giocatore_id, punto from public.mani_giocatori
     where mano_id = p_mano and giocatore_id = any(p_vincitori)
     order by (posto <= m.mazziere), posto
  loop
    v_importo := v_quota + case when v_primo then v_resto else 0 end;
    v_primo := false;
    update public.tavolo_giocatori set fiches = fiches + v_importo
     where tavolo_id = m.tavolo_id and giocatore_id = g.giocatore_id;
    update public.mani_giocatori set vincita = v_importo
     where mano_id = p_mano and giocatore_id = g.giocatore_id;
    perform public.registra(p_mano, g.giocatore_id, 'vince', v_importo,
      public.nick(g.giocatore_id) || ' vince ' || v_importo || ' V'
      || case when g.punto is not null then ' con ' || lower(left(g.punto, 1)) || substr(g.punto, 2) else '' end);
  end loop;
  update public.mani
     set fase = 'finita', turno = null, chiusa_il = now(),
         esito = jsonb_build_object('tipo', p_tipo, 'vincitori', to_jsonb(p_vincitori))
   where id = p_mano;
  update public.tavoli set livello_apertura = 0 where id = m.tavolo_id;
end;
$$;

create or replace function public.annulla_mano(p_mano uuid, p_tipo text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.mani%rowtype; v_livello int; v_debiti jsonb; v_rimasti int;
begin
  select * into m from public.mani where id = p_mano;
  if p_tipo = 'passano' then
    select (livello_apertura + 1) % 3 into v_livello from public.tavoli where id = m.tavolo_id;
    update public.tavoli set piatto_riporto = m.piatto, livello_apertura = v_livello where id = m.tavolo_id;
    perform public.registra(p_mano, null, 'annullata', m.piatto,
      'Nessuno apre: il piatto di ' || m.piatto || ' V resta per la prossima mano, che si apre con almeno una coppia di '
      || public.nome_valore(11 + v_livello, true) || '.');
  else
    -- Parol: chi era uscito al primo giro, se rientra, versa la differenza (addebitata alla prossima mano)
    select max(versato_mano) into v_rimasti from public.mani_giocatori where mano_id = p_mano and stato = 'attivo';
    select coalesce(jsonb_object_agg(giocatore_id::text, v_rimasti - versato_mano), '{}'::jsonb) into v_debiti
      from public.mani_giocatori where mano_id = p_mano and uscito_primo_giro and v_rimasti > versato_mano;
    update public.tavoli set piatto_riporto = m.piatto, livello_apertura = 2, debiti_parol = v_debiti
     where id = m.tavolo_id;
    perform public.registra(p_mano, null, 'annullata', m.piatto,
      'Tutti dicono parol: il piatto di ' || m.piatto || ' V resta e la prossima mano si apre con almeno una coppia di re.');
  end if;
  update public.mani set fase = 'annullata', turno = null, chiusa_il = now(),
         esito = jsonb_build_object('tipo', p_tipo) where id = p_mano;
end;
$$;

-- Confronto finale: si scoprono le carte di chi è rimasto in gioco
create or replace function public.confronto(p_mano uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.mani%rowtype;
  v_ids uuid[]; v_vals jsonb;
  v_cat int; v_tipi int[]; v_vincenti int[]; v_vincitori uuid[] := '{}'; v_tipo int; v_migliore int[];
begin
  select * into m from public.mani where id = p_mano;

  update public.mani_giocatori g
     set carte_mostrate = c.carte, punto = public.nome_punto(public.valuta_mano(c.carte, m.bassa))
    from public.mani_carte c
   where g.mano_id = p_mano and g.stato = 'attivo'
     and c.mano_id = p_mano and c.giocatore_id = g.giocatore_id;

  select max((public.valuta_mano(c.carte, m.bassa))[1]) into v_cat
    from public.mani_giocatori g join public.mani_carte c on c.mano_id = g.mano_id and c.giocatore_id = g.giocatore_id
   where g.mano_id = p_mano and g.stato = 'attivo';

  if v_cat = 9 then
    -- La minima batte la massima, la massima batte la media, la media batte la minima
    select array_agg(distinct (public.valuta_mano(c.carte, m.bassa))[2]) into v_tipi
      from public.mani_giocatori g join public.mani_carte c on c.mano_id = g.mano_id and c.giocatore_id = g.giocatore_id
     where g.mano_id = p_mano and g.stato = 'attivo' and (public.valuta_mano(c.carte, m.bassa))[1] = 9;
    select array_agg(x order by x) into v_tipi from unnest(v_tipi) x;
    v_vincenti := case
      when v_tipi = array[1,2,3] then array[1,2,3]   -- tutte e tre: si divide
      when v_tipi = array[1,3]   then array[1]
      when v_tipi = array[2,3]   then array[3]
      when v_tipi = array[1,2]   then array[2]
      else v_tipi end;
    foreach v_tipo in array v_vincenti loop
      select max(public.valuta_mano(c.carte, m.bassa)) into v_migliore
        from public.mani_giocatori g join public.mani_carte c on c.mano_id = g.mano_id and c.giocatore_id = g.giocatore_id
       where g.mano_id = p_mano and g.stato = 'attivo'
         and (public.valuta_mano(c.carte, m.bassa))[1] = 9 and (public.valuta_mano(c.carte, m.bassa))[2] = v_tipo;
      v_vincitori := v_vincitori || array(
        select g.giocatore_id
          from public.mani_giocatori g join public.mani_carte c on c.mano_id = g.mano_id and c.giocatore_id = g.giocatore_id
         where g.mano_id = p_mano and g.stato = 'attivo' and public.valuta_mano(c.carte, m.bassa) = v_migliore);
    end loop;
  else
    select max(public.valuta_mano(c.carte, m.bassa)) into v_migliore
      from public.mani_giocatori g join public.mani_carte c on c.mano_id = g.mano_id and c.giocatore_id = g.giocatore_id
     where g.mano_id = p_mano and g.stato = 'attivo';
    v_vincitori := array(
      select g.giocatore_id
        from public.mani_giocatori g join public.mani_carte c on c.mano_id = g.mano_id and c.giocatore_id = g.giocatore_id
       where g.mano_id = p_mano and g.stato = 'attivo' and public.valuta_mano(c.carte, m.bassa) = v_migliore);
  end if;

  perform public.registra(p_mano, null, 'confronto', null, 'Si scoprono le carte.');
  perform public.chiudi_mano(p_mano, v_vincitori, 'confronto');
end;
$$;

-- Dopo ogni azione: tocca al prossimo, oppure il giro è finito
create or replace function public.avanza(p_mano uuid)
returns void language plpgsql security definer set search_path = '' as $$
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
  end if;
end;
$$;

-- ───────────── Funzioni chiamate dall'app ─────────────

-- Partita avviata: ognuno riceve la prima posta in fiches
create or replace function public.avvia_partita(p_tavolo uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tavolo public.tavoli%rowtype;
  v_seduti int;
begin
  select * into v_tavolo from public.tavoli where id = p_tavolo for update;
  if not found or v_tavolo.organizzatore <> auth.uid() then
    raise exception 'Solo l''organizzatore può avviare la partita.';
  end if;
  if v_tavolo.stato <> 'attesa' then raise exception 'La partita è già iniziata.'; end if;
  select count(*) into v_seduti from public.tavolo_giocatori where tavolo_id = p_tavolo;
  if v_seduti < 4 then raise exception 'Servono almeno 4 giocatori: ora sono %.', v_seduti; end if;
  update public.tavoli set stato = 'in_corso', avviato_il = now() where id = p_tavolo;
  insert into public.poste (tavolo_id, giocatore_id, numero, valore)
  select p_tavolo, giocatore_id, 1, v_tavolo.valore_posta
    from public.tavolo_giocatori where tavolo_id = p_tavolo;
  update public.tavolo_giocatori set fiches = v_tavolo.valore_posta where tavolo_id = p_tavolo;
end;
$$;

create or replace function public.prendi_posta(p_tavolo uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_tavolo public.tavoli%rowtype;
begin
  select * into v_tavolo from public.tavoli where id = p_tavolo for update;
  if not found or not public.sono_al_tavolo(p_tavolo) then raise exception 'Non sei seduto a questo tavolo.'; end if;
  if v_tavolo.stato <> 'in_corso' then raise exception 'Si possono prendere poste solo a partita in corso.'; end if;
  return public.aggiungi_posta(p_tavolo, auth.uid());
end;
$$;

-- L'organizzatore modifica il tavolo in sala d'attesa (con controllo delle impostazioni di puntata)
create or replace function public.aggiorna_tavolo(
  p_tavolo uuid, p_nome text, p_posti int, p_valore_posta int, p_regole jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
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
  update public.tavoli
     set nome = trim(p_nome), posti = p_posti, valore_posta = p_valore_posta, regole = v_regole
   where id = p_tavolo;
end;
$$;

-- Distribuisce una nuova mano
create or replace function public.nuova_mano(p_tavolo uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t public.tavoli%rowtype;
  v_fase text;
  n int; v_bassa int; v_req int; v_mazziere int; v_invito int; v_numero int; v_dovuto int;
  v_id uuid; g record; i int;
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

  insert into public.mani (tavolo_id, numero, mazziere, bassa, requisito, fase, piatto)
  values (p_tavolo, v_numero, v_mazziere, v_bassa, v_req, 'apertura', t.piatto_riporto)
  returning id into v_id;

  insert into public.mani_giocatori (mano_id, giocatore_id, posto, stato, deve_parlare)
  select v_id, giocatore_id, posto, 'attivo', true from public.tavolo_giocatori where tavolo_id = p_tavolo;
  insert into public.mani_carte (mano_id, giocatore_id)
  select v_id, giocatore_id from public.tavolo_giocatori where tavolo_id = p_tavolo;
  insert into public.mani_mazzo (mano_id, mazzo) values (v_id, public.mazzo_mescolato(v_bassa));

  perform public.registra(v_id, null, 'mano', null,
    'Mano ' || v_numero || ': mescola ' || public.nick((select giocatore_id from public.tavolo_giocatori
      where tavolo_id = p_tavolo and posto = v_mazziere))
    || '. Si apre con almeno una coppia di ' || public.nome_valore(v_req, true) || '.');

  -- Invito (più l'eventuale differenza dovuta dopo un parol); se mancano fiches si prende una posta
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
     set mazziere = v_mazziere, piatto_riporto = 0, debiti_parol = '{}'::jsonb, mano_corrente = v_id
   where id = p_tavolo;

  -- 5 carte a testa, una alla volta, partendo dalla sinistra del mazziere
  for i in 1..5 loop
    for g in select giocatore_id from public.mani_giocatori where mano_id = v_id order by (posto <= v_mazziere), posto loop
      update public.mani_carte set carte = carte || public.pesca(v_id, 1)
       where mano_id = v_id and giocatore_id = g.giocatore_id;
    end loop;
  end loop;

  update public.mani set turno = public.prossimo_posto(v_id, v_mazziere, true) where id = v_id;
  return v_id;
end;
$$;

-- Passo, apro, vedo, rilancio, punto, busso, parol
create or replace function public.azione(p_mano uuid, p_tipo text, p_importo int default 0)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.mani%rowtype; t public.tavoli%rowtype; io public.mani_giocatori%rowtype;
  v_utente uuid := auth.uid();
  v_invito int; v_limite text; v_tetto int; v_da_vedere int; v_carte text[]; v_nick text;
begin
  select * into m from public.mani where id = p_mano for update;
  if not found then raise exception 'Mano non trovata.'; end if;
  select * into t from public.tavoli where id = m.tavolo_id;
  select * into io from public.mani_giocatori where mano_id = p_mano and giocatore_id = v_utente;
  if not found then raise exception 'Non partecipi a questa mano.'; end if;
  if m.fase not in ('apertura', 'primo_giro', 'secondo_giro') then raise exception 'In questa fase non si punta.'; end if;
  if io.stato <> 'attivo' then raise exception 'Sei uscito da questa mano.'; end if;
  if m.turno is distinct from io.posto then raise exception 'Non è il tuo turno.'; end if;

  v_nick := public.nick(v_utente);
  v_invito := coalesce((t.regole->>'invito')::int, greatest(1, t.valore_posta / 100));
  v_limite := coalesce(t.regole->>'limite', 'piatto');
  v_da_vedere := m.puntata - io.versato_giro;

  if p_tipo in ('apro', 'punto', 'rilancio') then
    if p_importo is null or p_importo < v_invito then
      raise exception 'La puntata minima è di % V.', v_invito;
    end if;
    v_tetto := case v_limite
      when 'piatto' then m.piatto + v_da_vedere
      when 'fisso'  then (t.regole->>'puntata_massima')::int
      else null end;
    if v_tetto is not null and p_importo > v_tetto then
      raise exception 'La puntata massima ora è di % V.', v_tetto;
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
      update public.mani_giocatori set deve_parlare = (giocatore_id <> v_utente)
       where mano_id = p_mano and stato = 'attivo';
      perform public.registra(p_mano, v_utente, 'apro', p_importo, v_nick || ' apre con ' || p_importo || ' V.');
    else
      raise exception 'Prima dell''apertura puoi solo passare o aprire.';
    end if;
  else
    if p_tipo = 'passo' then
      update public.mani_giocatori
         set stato = 'fuori', deve_parlare = false, uscito_primo_giro = (m.fase = 'primo_giro')
       where mano_id = p_mano and giocatore_id = v_utente;
      perform public.registra(p_mano, v_utente, 'lascio', null, v_nick || ' lascia.');
    elsif p_tipo = 'vedo' then
      if v_da_vedere <= 0 then raise exception 'Non c''è nessuna puntata da vedere.'; end if;
      perform public.paga(p_mano, t.id, v_utente, v_da_vedere);
      update public.mani_giocatori set deve_parlare = false where mano_id = p_mano and giocatore_id = v_utente;
      perform public.registra(p_mano, v_utente, 'vedo', v_da_vedere, v_nick || ' vede (' || v_da_vedere || ' V).');
    elsif p_tipo = 'rilancio' then
      if m.puntata = 0 then raise exception 'Non c''è niente da rilanciare: punta.'; end if;
      perform public.paga(p_mano, t.id, v_utente, v_da_vedere + p_importo);
      update public.mani set puntata = puntata + p_importo, ultimo_rilancio = v_utente where id = p_mano;
      update public.mani_giocatori set deve_parlare = (giocatore_id <> v_utente)
       where mano_id = p_mano and stato = 'attivo';
      perform public.registra(p_mano, v_utente, 'rilancio', p_importo, v_nick || ' rilancia di ' || p_importo || ' V.');
    elsif p_tipo = 'punto' then
      if m.fase <> 'secondo_giro' or m.puntata > 0 then raise exception 'C''è già una puntata: vedi o rilancia.'; end if;
      perform public.paga(p_mano, t.id, v_utente, p_importo);
      update public.mani set puntata = p_importo, ultimo_rilancio = v_utente, parol_possibile = false where id = p_mano;
      update public.mani_giocatori set deve_parlare = (giocatore_id <> v_utente)
       where mano_id = p_mano and stato = 'attivo';
      perform public.registra(p_mano, v_utente, 'punto', p_importo, v_nick || ' punta ' || p_importo || ' V.');
    elsif p_tipo = 'busso' then
      if m.fase <> 'secondo_giro' or m.puntata > 0 then raise exception 'C''è già una puntata: vedi o rilancia.'; end if;
      update public.mani set parol_possibile = false where id = p_mano;
      update public.mani_giocatori set deve_parlare = false where mano_id = p_mano and giocatore_id = v_utente;
      perform public.registra(p_mano, v_utente, 'busso', null, v_nick || ' bussa.');
    elsif p_tipo = 'parol' then
      if m.fase <> 'secondo_giro' or m.puntata > 0 or not m.parol_possibile then
        raise exception 'Parol non è più possibile: qualcuno ha già bussato o puntato.';
      end if;
      update public.mani_giocatori set deve_parlare = false where mano_id = p_mano and giocatore_id = v_utente;
      perform public.registra(p_mano, v_utente, 'parol', null, v_nick || ' dice parol.');
    else
      raise exception 'Azione non valida.';
    end if;
  end if;

  perform public.avanza(p_mano);
end;
$$;

-- Cambio delle carte: fino a 4 (3 subito e 1 a fine giro) o fino a 5 (3 + 2), secondo le regole del tavolo
create or replace function public.cambia(p_mano uuid, p_scarti text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.mani%rowtype; t public.tavoli%rowtype; io public.mani_giocatori%rowtype;
  v_utente uuid := auth.uid();
  v_mie text[]; v_max int; v_n int; v_subito int; v_prossimo int; v_inizio int; g record;
begin
  select * into m from public.mani where id = p_mano for update;
  if not found then raise exception 'Mano non trovata.'; end if;
  select * into t from public.tavoli where id = m.tavolo_id;
  select * into io from public.mani_giocatori where mano_id = p_mano and giocatore_id = v_utente;
  if not found or io.stato <> 'attivo' then raise exception 'Non sei in gioco in questa mano.'; end if;
  if m.fase <> 'cambio' then raise exception 'Non è il momento del cambio.'; end if;
  if m.turno is distinct from io.posto then raise exception 'Non è il tuo turno.'; end if;

  p_scarti := coalesce(p_scarti, '{}');
  v_max := coalesce((t.regole->>'cambio_max')::int, 4);
  v_n := cardinality(p_scarti);
  if v_n > v_max then raise exception 'Puoi cambiare al massimo % carte.', v_max; end if;
  select carte into v_mie from public.mani_carte where mano_id = p_mano and giocatore_id = v_utente for update;
  if not (p_scarti <@ v_mie) or (select count(distinct x) from unnest(p_scarti) x) <> v_n then
    raise exception 'Puoi scartare solo carte che hai in mano.';
  end if;

  v_subito := least(v_n, 3);
  update public.mani_carte
     set carte = array(select c from unnest(v_mie) c where c <> all(p_scarti)) || public.pesca(p_mano, v_subito)
   where mano_id = p_mano and giocatore_id = v_utente;
  update public.mani_mazzo set scarti = scarti || p_scarti where mano_id = p_mano;
  update public.mani_giocatori set deve_parlare = false, cambio = v_n, cambio_pendente = v_n - v_subito
   where mano_id = p_mano and giocatore_id = v_utente;
  perform public.registra(p_mano, v_utente, 'cambio', v_n,
    public.nick(v_utente) || case when v_n = 0 then ' è servito.' when v_n = 1 then ' cambia 1 carta.'
                                  else ' cambia ' || v_n || ' carte.' end);

  v_prossimo := public.prossimo_posto(p_mano, io.posto, true);
  if v_prossimo is not null then
    update public.mani set turno = v_prossimo where id = p_mano;
    return;
  end if;

  -- Tutti serviti: chi ha cambiato 4 o 5 carte riceve le ultime
  for g in select giocatore_id, cambio_pendente from public.mani_giocatori
            where mano_id = p_mano and cambio_pendente > 0 order by (posto <= m.mazziere), posto loop
    update public.mani_carte set carte = carte || public.pesca(p_mano, g.cambio_pendente)
     where mano_id = p_mano and giocatore_id = g.giocatore_id;
    update public.mani_giocatori set cambio_pendente = 0 where mano_id = p_mano and giocatore_id = g.giocatore_id;
  end loop;

  -- Secondo giro: parla chi ha rilanciato per ultimo, altrimenti l'apritore
  select posto into v_inizio from public.mani_giocatori
   where mano_id = p_mano and stato = 'attivo' and giocatore_id = coalesce(m.ultimo_rilancio, m.apritore);
  if v_inizio is null then v_inizio := public.prossimo_posto(p_mano, m.mazziere, false); end if;
  update public.mani_giocatori set versato_giro = 0, deve_parlare = (stato = 'attivo') where mano_id = p_mano;
  update public.mani set fase = 'secondo_giro', puntata = 0, parol_possibile = true, turno = v_inizio where id = p_mano;
  perform public.registra(p_mano, null, 'fase', null, 'Secondo giro di puntate.');
end;
$$;

-- ───────────── Permessi ─────────────
revoke execute on function
  public.registra(uuid, uuid, text, int, text), public.nick(uuid), public.aggiungi_posta(uuid, uuid),
  public.paga(uuid, uuid, uuid, int), public.pesca(uuid, int), public.prossimo_posto(uuid, int, boolean),
  public.chiudi_mano(uuid, uuid[], text), public.annulla_mano(uuid, text), public.confronto(uuid),
  public.avanza(uuid), public.mazzo_mescolato(int)
from public, anon, authenticated;

revoke execute on function
  public.nuova_mano(uuid), public.azione(uuid, text, int), public.cambia(uuid, text[]),
  public.avvia_partita(uuid), public.prendi_posta(uuid), public.aggiorna_tavolo(uuid, text, int, int, jsonb)
from public, anon;
grant execute on function
  public.nuova_mano(uuid), public.azione(uuid, text, int), public.cambia(uuid, text[]),
  public.avvia_partita(uuid), public.prendi_posta(uuid), public.aggiorna_tavolo(uuid, text, int, int, jsonb)
to authenticated;

-- Aggiornamenti in tempo reale
do $$
begin
  alter publication supabase_realtime add table public.mani_azioni;
exception when duplicate_object then null;
end $$;
