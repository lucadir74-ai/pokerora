-- PokerOra · 11 · Durata della partita, avviso e prolungamento
-- Da eseguire una volta in Supabase → SQL Editor → New query → Run
-- Non riscrive nessuna funzione esistente: il timer si aggancia con dei trigger,
-- così la logica attuale di nuova_mano, avvia_partita e aggiorna_tavolo resta com'è.
--
-- Regole:
--  · la durata si sceglie in sala d'attesa (regole.durata, in minuti; 0 = senza limite)
--  · all'avvio della partita si fissa l'orario di fine (fine_prevista)
--  · solo l'organizzatore può allungare, di 15, 30 o 60 minuti, quante volte vuole
--  · allo scadere non si interrompe la mano in corso: la partita si chiude a fine mano;
--    se c'è un piatto rimasto da una mano annullata, si gioca finché qualcuno non lo vince

alter table public.tavoli add column if not exists fine_prevista        timestamptz;
alter table public.tavoli add column if not exists prolungamenti        int not null default 0;
alter table public.tavoli add column if not exists ultimo_prolungamento int;
alter table public.tavoli add column if not exists chiuso_per_tempo     boolean not null default false;

-- ───────────── Durata: controllo in sala d'attesa e orario di fine all'avvio ─────────────
create or replace function public.timer_tavolo()
returns trigger language plpgsql set search_path = '' as $$
declare v_testo text; v_durata int;
begin
  if new.regole is distinct from old.regole and new.regole ? 'durata' then
    v_testo := new.regole->>'durata';
    if v_testo !~ '^\d+$' or v_testo::int not in (0, 60, 90, 120, 150, 180, 240) then
      raise exception 'Durata della partita non valida.';
    end if;
  end if;
  if old.stato = 'attesa' and new.stato = 'in_corso' then
    v_durata := case when (new.regole->>'durata') ~ '^\d+$' then (new.regole->>'durata')::int else 0 end;
    new.fine_prevista := case when v_durata > 0 then now() + make_interval(mins => v_durata) end;
  end if;
  return new;
end;
$$;

drop trigger if exists timer_tavolo on public.tavoli;
create trigger timer_tavolo before update on public.tavoli
  for each row execute function public.timer_tavolo();

-- ───────────── A tempo scaduto non si distribuiscono mani nuove ─────────────
-- (salvo che ci sia un piatto rimasto da vincere: la mano nasce con quel piatto)
create or replace function public.blocca_mano_fuori_tempo()
returns trigger language plpgsql set search_path = '' as $$
declare v_fine timestamptz;
begin
  select fine_prevista into v_fine from public.tavoli where id = new.tavolo_id;
  if v_fine is not null and now() >= v_fine and coalesce(new.piatto, 0) = 0 then
    raise exception 'Tempo scaduto: la partita si chiude.';
  end if;
  return new;
end;
$$;

drop trigger if exists blocca_mano_fuori_tempo on public.mani;
create trigger blocca_mano_fuori_tempo before insert on public.mani
  for each row execute function public.blocca_mano_fuori_tempo();

-- ───────────── Funzioni chiamate dall'app ─────────────

-- L'organizzatore allunga la partita di 15, 30 o 60 minuti (anche a tempo appena scaduto)
create or replace function public.prolunga_partita(p_tavolo uuid, p_minuti int)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_tavolo public.tavoli%rowtype; v_fine timestamptz;
begin
  select * into v_tavolo from public.tavoli where id = p_tavolo for update;
  if not found or v_tavolo.organizzatore <> auth.uid() then
    raise exception 'Solo l''organizzatore può allungare la partita.';
  end if;
  if v_tavolo.stato <> 'in_corso' then raise exception 'La partita non è in corso.'; end if;
  if v_tavolo.fine_prevista is null then raise exception 'Questa partita non ha un limite di tempo.'; end if;
  if p_minuti not in (15, 30, 60) then raise exception 'Si può allungare di 15, 30 o 60 minuti.'; end if;
  v_fine := greatest(v_tavolo.fine_prevista, now()) + make_interval(mins => p_minuti);
  update public.tavoli
     set fine_prevista = v_fine, prolungamenti = prolungamenti + 1, ultimo_prolungamento = p_minuti
   where id = p_tavolo;
  return v_fine;
end;
$$;

-- Chiude la partita se il tempo è scaduto e non c'è una mano (o un piatto) in sospeso.
-- La chiama l'app al posto della mano successiva; risponde false se si deve continuare.
create or replace function public.chiudi_per_tempo(p_tavolo uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_tavolo public.tavoli%rowtype; v_fase text;
begin
  select * into v_tavolo from public.tavoli where id = p_tavolo for update;
  if not found or not public.sono_al_tavolo(p_tavolo) then raise exception 'Non sei seduto a questo tavolo.'; end if;
  if v_tavolo.stato <> 'in_corso' or v_tavolo.fine_prevista is null or now() < v_tavolo.fine_prevista then
    return false;
  end if;
  if v_tavolo.piatto_riporto > 0 then return false; end if;
  if v_tavolo.mano_corrente is not null then
    select fase into v_fase from public.mani where id = v_tavolo.mano_corrente;
    if v_fase not in ('finita', 'annullata') then return false; end if;
  end if;
  update public.tavoli set stato = 'chiuso', chiuso_il = now(), chiuso_per_tempo = true where id = p_tavolo;
  return true;
end;
$$;

revoke execute on function public.prolunga_partita(uuid, int), public.chiudi_per_tempo(uuid) from public, anon;
grant  execute on function public.prolunga_partita(uuid, int), public.chiudi_per_tempo(uuid) to authenticated;
revoke execute on function public.timer_tavolo(), public.blocca_mano_fuori_tempo() from public, anon, authenticated;
