-- PokerOra · 02 · Tavoli, inviti, sala d'attesa e poste
-- Da eseguire una volta in Supabase → SQL Editor → New query → Run
-- Le tabelle si leggono solo se sei seduto al tavolo; tutte le modifiche
-- passano dalle funzioni qui sotto, che controllano le regole.

create table if not exists public.tavoli (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (length(trim(nome)) between 1 and 40),
  organizzatore  uuid not null references public.profili(id) on delete cascade,
  codice_invito  text not null unique,
  posti          int  not null check (posti between 4 and 6),
  valore_posta   int  not null check (valore_posta between 50 and 1000000),
  valuta         text not null default 'Vardis',
  regole         jsonb not null default '{
    "mazzo": "regola11",
    "apertura": "fanti",
    "colore_batte_full": true,
    "cambio_cinque": "3+2",
    "scala_ciclica": true
  }'::jsonb,
  stato          text not null default 'attesa' check (stato in ('attesa', 'in_corso', 'chiuso')),
  creato_il      timestamptz not null default now(),
  avviato_il     timestamptz,
  chiuso_il      timestamptz
);

create table if not exists public.tavolo_giocatori (
  tavolo_id     uuid not null references public.tavoli(id) on delete cascade,
  giocatore_id  uuid not null references public.profili(id) on delete cascade,
  posto         int  not null check (posto between 1 and 6),
  entrato_il    timestamptz not null default now(),
  primary key (tavolo_id, giocatore_id),
  unique (tavolo_id, posto)
);
create index if not exists tavolo_giocatori_giocatore on public.tavolo_giocatori (giocatore_id);

-- Registro delle poste: la n. 1 è quella iniziale, le successive sono poste aggiuntive
create table if not exists public.poste (
  id            bigint generated always as identity primary key,
  tavolo_id     uuid not null references public.tavoli(id) on delete cascade,
  giocatore_id  uuid not null references public.profili(id) on delete cascade,
  numero        int  not null check (numero >= 1),
  valore        int  not null,
  presa_il      timestamptz not null default now(),
  unique (tavolo_id, giocatore_id, numero)
);

alter table public.tavoli           enable row level security;
alter table public.tavolo_giocatori enable row level security;
alter table public.poste            enable row level security;

-- Sono seduto a questo tavolo? (security definer: evita il giro vizioso tra le regole)
create or replace function public.sono_al_tavolo(p_tavolo uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from public.tavolo_giocatori
    where tavolo_id = p_tavolo and giocatore_id = auth.uid()
  );
$$;

drop policy if exists "vedo i miei tavoli" on public.tavoli;
create policy "vedo i miei tavoli" on public.tavoli
  for select to authenticated using (public.sono_al_tavolo(id));

drop policy if exists "vedo chi siede ai miei tavoli" on public.tavolo_giocatori;
create policy "vedo chi siede ai miei tavoli" on public.tavolo_giocatori
  for select to authenticated using (public.sono_al_tavolo(tavolo_id));

drop policy if exists "vedo le poste dei miei tavoli" on public.poste;
create policy "vedo le poste dei miei tavoli" on public.poste
  for select to authenticated using (public.sono_al_tavolo(tavolo_id));

-- Codice invito di 6 caratteri, senza lettere ambigue (niente O/0, I/1)
create or replace function public.genera_codice()
returns text language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6);
$$;

-- Crea un tavolo: chi lo crea è l'organizzatore e siede al posto 1
create or replace function public.crea_tavolo(p_nome text, p_posti int, p_valore_posta int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_utente uuid := auth.uid();
  v_codice text;
  v_id     uuid;
begin
  if v_utente is null then raise exception 'Devi entrare con il tuo account.'; end if;
  loop
    v_codice := public.genera_codice();
    exit when not exists (select 1 from public.tavoli where codice_invito = v_codice);
  end loop;
  insert into public.tavoli (nome, organizzatore, codice_invito, posti, valore_posta)
  values (trim(p_nome), v_utente, v_codice, p_posti, p_valore_posta)
  returning id into v_id;
  insert into public.tavolo_giocatori (tavolo_id, giocatore_id, posto) values (v_id, v_utente, 1);
  return v_id;
end;
$$;

-- Anteprima dell'invito (prima di sedersi)
create or replace function public.info_invito(p_codice text)
returns table (
  tavolo_id uuid, nome text, organizzatore text, posti int, occupati int,
  valore_posta int, valuta text, stato text, gia_seduto boolean
)
language sql security definer set search_path = '' stable as $$
  select t.id, t.nome, p.nickname, t.posti,
         (select count(*)::int from public.tavolo_giocatori g where g.tavolo_id = t.id),
         t.valore_posta, t.valuta, t.stato,
         exists (select 1 from public.tavolo_giocatori g where g.tavolo_id = t.id and g.giocatore_id = auth.uid())
  from public.tavoli t
  join public.profili p on p.id = t.organizzatore
  where t.codice_invito = upper(trim(p_codice)) and auth.uid() is not null;
$$;

-- Siediti al tavolo dal codice invito
create or replace function public.entra_tavolo(p_codice text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_utente uuid := auth.uid();
  v_tavolo public.tavoli%rowtype;
  v_posto  int;
begin
  if v_utente is null then raise exception 'Devi entrare con il tuo account.'; end if;
  select * into v_tavolo from public.tavoli
   where codice_invito = upper(trim(p_codice)) for update;
  if not found then raise exception 'Invito non valido: controlla il link.'; end if;
  if exists (select 1 from public.tavolo_giocatori where tavolo_id = v_tavolo.id and giocatore_id = v_utente) then
    return v_tavolo.id;
  end if;
  if v_tavolo.stato <> 'attesa' then raise exception 'La partita a questo tavolo è già iniziata o chiusa.'; end if;
  select min(s) into v_posto from generate_series(1, v_tavolo.posti) s
   where s not in (select posto from public.tavolo_giocatori where tavolo_id = v_tavolo.id);
  if v_posto is null then raise exception 'Il tavolo è al completo.'; end if;
  insert into public.tavolo_giocatori (tavolo_id, giocatore_id, posto) values (v_tavolo.id, v_utente, v_posto);
  return v_tavolo.id;
end;
$$;

-- Alzati dal tavolo (solo in sala d'attesa; l'organizzatore chiude il tavolo invece)
create or replace function public.lascia_tavolo(p_tavolo uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tavolo public.tavoli%rowtype;
begin
  select * into v_tavolo from public.tavoli where id = p_tavolo for update;
  if not found then raise exception 'Tavolo non trovato.'; end if;
  if v_tavolo.organizzatore = auth.uid() then raise exception 'Sei l''organizzatore: puoi chiudere il tavolo.'; end if;
  if v_tavolo.stato <> 'attesa' then raise exception 'La partita è già iniziata.'; end if;
  delete from public.tavolo_giocatori where tavolo_id = p_tavolo and giocatore_id = auth.uid();
end;
$$;

-- L'organizzatore modifica nome, posti, posta e regole finché si è in sala d'attesa
create or replace function public.aggiorna_tavolo(
  p_tavolo uuid, p_nome text, p_posti int, p_valore_posta int, p_regole jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tavolo public.tavoli%rowtype;
  v_seduti int;
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
  update public.tavoli
     set nome = trim(p_nome), posti = p_posti, valore_posta = p_valore_posta,
         regole = v_tavolo.regole || coalesce(p_regole, '{}'::jsonb)
   where id = p_tavolo;
end;
$$;

-- Avvia la partita: almeno 4 giocatori, ognuno riceve la prima posta
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
end;
$$;

-- Prendi un'altra posta durante la partita (resta nel registro per il report)
create or replace function public.prendi_posta(p_tavolo uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_tavolo public.tavoli%rowtype;
  v_numero int;
begin
  select * into v_tavolo from public.tavoli where id = p_tavolo for update;
  if not found or not public.sono_al_tavolo(p_tavolo) then raise exception 'Non sei seduto a questo tavolo.'; end if;
  if v_tavolo.stato <> 'in_corso' then raise exception 'Si possono prendere poste solo a partita in corso.'; end if;
  select coalesce(max(numero), 0) + 1 into v_numero
    from public.poste where tavolo_id = p_tavolo and giocatore_id = auth.uid();
  insert into public.poste (tavolo_id, giocatore_id, numero, valore)
  values (p_tavolo, auth.uid(), v_numero, v_tavolo.valore_posta);
  return v_numero;
end;
$$;

-- Chiudi il tavolo (solo l'organizzatore)
create or replace function public.chiudi_tavolo(p_tavolo uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.tavoli set stato = 'chiuso', chiuso_il = now()
   where id = p_tavolo and organizzatore = auth.uid() and stato <> 'chiuso';
  if not found then raise exception 'Solo l''organizzatore può chiudere il tavolo.'; end if;
end;
$$;

revoke execute on function
  public.crea_tavolo(text, int, int), public.info_invito(text), public.entra_tavolo(text),
  public.lascia_tavolo(uuid), public.aggiorna_tavolo(uuid, text, int, int, jsonb),
  public.avvia_partita(uuid), public.prendi_posta(uuid), public.chiudi_tavolo(uuid)
from public, anon;
grant execute on function
  public.crea_tavolo(text, int, int), public.info_invito(text), public.entra_tavolo(text),
  public.lascia_tavolo(uuid), public.aggiorna_tavolo(uuid, text, int, int, jsonb),
  public.avvia_partita(uuid), public.prendi_posta(uuid), public.chiudi_tavolo(uuid)
to authenticated;

grant select on public.tavoli, public.tavolo_giocatori, public.poste to authenticated;

-- Aggiornamenti in tempo reale (sala d'attesa e poste)
do $$
begin
  alter publication supabase_realtime add table public.tavoli, public.tavolo_giocatori, public.poste;
exception when duplicate_object then null;
end $$;
