-- PokerOra · 03 · Telefono facoltativo all'iscrizione
-- Da eseguire una volta in Supabase → SQL Editor → New query → Run

alter table public.profili_privati alter column telefono drop not null;

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
    nullif(trim(coalesce(new.raw_user_meta_data->>'telefono', '')), '')
  );
  return new;
end;
$$;
