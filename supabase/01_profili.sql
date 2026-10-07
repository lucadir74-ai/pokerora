-- PokerOra · 01 · Profili utente
-- Da eseguire una volta in Supabase → SQL Editor → New query → Run

-- 1) Profilo pubblico: solo il nickname, visibile agli utenti loggati
create table if not exists public.profili (
  id         uuid primary key references auth.users(id) on delete cascade,
  nickname   text not null,
  creato_il  timestamptz not null default now(),
  constraint nickname_formato check (nickname ~ '^[A-Za-z0-9_.\-]{3,20}$')
);
create unique index if not exists profili_nickname_unico on public.profili (lower(nickname));

-- 2) Dati privati: nome, cognome, telefono — li vede solo il proprietario
create table if not exists public.profili_privati (
  id         uuid primary key references auth.users(id) on delete cascade,
  nome       text not null check (length(trim(nome)) > 0),
  cognome    text not null check (length(trim(cognome)) > 0),
  telefono   text not null unique check (telefono ~ '^\+[1-9][0-9]{6,14}$')
);

alter table public.profili enable row level security;
alter table public.profili_privati enable row level security;

drop policy if exists "profili leggibili dagli utenti loggati" on public.profili;
create policy "profili leggibili dagli utenti loggati" on public.profili
  for select to authenticated using (true);

drop policy if exists "modifico il mio profilo" on public.profili;
create policy "modifico il mio profilo" on public.profili
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "leggo i miei dati privati" on public.profili_privati;
create policy "leggo i miei dati privati" on public.profili_privati
  for select to authenticated using (id = auth.uid());

drop policy if exists "modifico i miei dati privati" on public.profili_privati;
create policy "modifico i miei dati privati" on public.profili_privati
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- 3) All'iscrizione crea in automatico profilo e dati privati
create or replace function public.crea_profilo_nuovo_utente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profili (id, nickname)
  values (new.id, new.raw_user_meta_data->>'nickname');

  insert into public.profili_privati (id, nome, cognome, telefono)
  values (
    new.id,
    trim(new.raw_user_meta_data->>'nome'),
    trim(new.raw_user_meta_data->>'cognome'),
    new.raw_user_meta_data->>'telefono'
  );
  return new;
end;
$$;

drop trigger if exists al_nuovo_utente on auth.users;
create trigger al_nuovo_utente
  after insert on auth.users
  for each row execute function public.crea_profilo_nuovo_utente();

-- 4) Controllo nickname libero (usabile anche prima del login)
create or replace function public.nickname_disponibile(p_nickname text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select not exists (
    select 1 from public.profili where lower(nickname) = lower(p_nickname)
  );
$$;

grant execute on function public.nickname_disponibile(text) to anon, authenticated;
