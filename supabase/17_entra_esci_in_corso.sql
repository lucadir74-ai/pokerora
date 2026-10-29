-- PokerOra · 17 · Entrare e uscire a partita in corso
-- Da eseguire una volta in Supabase → SQL Editor → New query → Run. Si può rilanciare.
--
-- · Chi entra a partita in corso si siede al primo posto libero, riceve la prima posta e gioca dalla
--   mano successiva. Chi era uscito e rientra ritrova le sue fiches (senza una nuova prima posta).
-- · Chi esce tra una mano e l'altra esce subito; se c'è una mano in corso in cui gioca, esce appena finisce.
--   L'organizzatore può far uscire un giocatore (per esempio chi se n'è andato senza dirlo).
-- · Chi esce passa in tavolo_usciti con le sue fiches: le sue poste restano, e nel report compare con il saldo.

-- 1) Giocatori usciti dal tavolo
create table if not exists public.tavolo_usciti (
  tavolo_id     uuid not null references public.tavoli(id) on delete cascade,
  giocatore_id  uuid not null references public.profili(id) on delete cascade,
  posto         int  not null,
  fiches        int  not null default 0,
  uscito_il     timestamptz not null default now(),
  tolto_da      uuid references public.profili(id) on delete set null,
  primary key (tavolo_id, giocatore_id)
);
alter table public.tavolo_usciti enable row level security;
drop policy if exists "vedo gli usciti dei miei tavoli" on public.tavolo_usciti;
create policy "vedo gli usciti dei miei tavoli" on public.tavolo_usciti
  for select to authenticated using (public.sono_al_tavolo(tavolo_id));
revoke all on public.tavolo_usciti from anon, authenticated;
grant select on public.tavolo_usciti to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.tavolo_usciti;
exception when duplicate_object or undefined_object then null;
end $$;

-- 2) Uscita prenotata per fine mano
alter table public.tavolo_giocatori add column if not exists esce_a_fine_mano boolean not null default false;
alter table public.tavolo_giocatori add column if not exists esce_richiesta_da uuid;

-- 3) Uscita vera e propria (interna)
create or replace function public.esegui_uscita(p_tavolo uuid, p_giocatore uuid, p_da uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_fiches int; v_mano uuid;
begin
  select fiches into v_fiches from public.tavolo_giocatori where tavolo_id = p_tavolo and giocatore_id = p_giocatore;
  if not found then return; end if;
  insert into public.tavolo_usciti (tavolo_id, giocatore_id, posto, fiches, tolto_da)
  select tavolo_id, giocatore_id, posto, fiches,
         case when p_da is distinct from p_giocatore then p_da end
    from public.tavolo_giocatori where tavolo_id = p_tavolo and giocatore_id = p_giocatore
  on conflict (tavolo_id, giocatore_id) do update
    set posto = excluded.posto, fiches = excluded.fiches, uscito_il = now(), tolto_da = excluded.tolto_da;
  delete from public.tavolo_giocatori where tavolo_id = p_tavolo and giocatore_id = p_giocatore;
  select mano_corrente into v_mano from public.tavoli where id = p_tavolo;
  if v_mano is not null then
    perform public.registra(v_mano, p_giocatore, 'uscita', v_fiches,
      public.nick(p_giocatore)
      || case when p_da is distinct from p_giocatore then ' viene fatto uscire dall''organizzatore' else ' lascia il tavolo' end
      || ' con ' || v_fiches || ' V.');
  end if;
end $$;
revoke execute on function public.esegui_uscita(uuid, uuid, uuid) from public, anon, authenticated;

-- 4) Richiesta di uscita: subito tra una mano e l'altra, altrimenti a fine mano (interna)
create or replace function public.richiedi_uscita(p_tavolo uuid, p_giocatore uuid, p_da uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare t public.tavoli%rowtype; v_fase text; v_rimasti int;
begin
  select * into t from public.tavoli where id = p_tavolo for update;
  if not found then raise exception 'Tavolo non trovato.'; end if;
  if t.stato <> 'in_corso' then raise exception 'La partita non è in corso.'; end if;
  if p_giocatore = t.organizzatore then raise exception 'L''organizzatore non esce: può terminare la partita.'; end if;
  if not exists (select 1 from public.tavolo_giocatori where tavolo_id = p_tavolo and giocatore_id = p_giocatore) then
    raise exception 'Questo giocatore non è seduto al tavolo.';
  end if;
  select count(*) - 1 into v_rimasti from public.tavolo_giocatori
   where tavolo_id = p_tavolo and not esce_a_fine_mano;
  if v_rimasti < 2 then raise exception 'Al tavolo resterebbe un solo giocatore: termina la partita.'; end if;

  if t.mano_corrente is not null then
    select fase into v_fase from public.mani where id = t.mano_corrente;
  end if;
  if v_fase is not null and v_fase not in ('finita', 'annullata')
     and exists (select 1 from public.mani_giocatori where mano_id = t.mano_corrente and giocatore_id = p_giocatore) then
    update public.tavolo_giocatori set esce_a_fine_mano = true, esce_richiesta_da = p_da
     where tavolo_id = p_tavolo and giocatore_id = p_giocatore;
    perform public.registra(t.mano_corrente, p_giocatore, 'uscita_prenotata', null,
      public.nick(p_giocatore) || ' lascerà il tavolo a fine mano.');
    return 'a_fine_mano';
  end if;
  perform public.esegui_uscita(p_tavolo, p_giocatore, p_da);
  return 'uscito';
end $$;
revoke execute on function public.richiedi_uscita(uuid, uuid, uuid) from public, anon, authenticated;

-- 5) Alzarsi dal tavolo: in sala d'attesa come prima, a partita in corso con l'uscita
drop function if exists public.lascia_tavolo(uuid);
create function public.lascia_tavolo(p_tavolo uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_tavolo public.tavoli%rowtype;
begin
  select * into v_tavolo from public.tavoli where id = p_tavolo for update;
  if not found then raise exception 'Tavolo non trovato.'; end if;
  if v_tavolo.organizzatore = auth.uid() then raise exception 'Sei l''organizzatore: puoi chiudere il tavolo.'; end if;
  if v_tavolo.stato = 'attesa' then
    delete from public.tavolo_giocatori where tavolo_id = p_tavolo and giocatore_id = auth.uid();
    return 'uscito';
  end if;
  if v_tavolo.stato <> 'in_corso' then raise exception 'La partita è chiusa.'; end if;
  return public.richiedi_uscita(p_tavolo, auth.uid(), auth.uid());
end $$;
revoke execute on function public.lascia_tavolo(uuid) from public, anon;
grant execute on function public.lascia_tavolo(uuid) to authenticated;

-- 6) L'organizzatore fa uscire un giocatore (anche un giocatore automatico)
create or replace function public.togli_giocatore(p_tavolo uuid, p_giocatore uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.tavoli where id = p_tavolo and organizzatore = auth.uid()) then
    raise exception 'Solo l''organizzatore può far uscire un giocatore.';
  end if;
  return public.richiedi_uscita(p_tavolo, p_giocatore, auth.uid());
end $$;
revoke execute on function public.togli_giocatore(uuid, uuid) from public, anon;
grant execute on function public.togli_giocatore(uuid, uuid) to authenticated;

-- 7) A fine mano escono quelli che l'hanno chiesto (dopo la consegna delle poste in arrivo)
create or replace function public.uscite_a_fine_mano() returns trigger
language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  if new.fase in ('finita', 'annullata') and old.fase is distinct from new.fase then
    for g in select giocatore_id, esce_richiesta_da from public.tavolo_giocatori
              where tavolo_id = new.tavolo_id and esce_a_fine_mano loop
      perform public.esegui_uscita(new.tavolo_id, g.giocatore_id, coalesce(g.esce_richiesta_da, g.giocatore_id));
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists zz_uscite_a_fine_mano on public.mani;
create trigger zz_uscite_a_fine_mano after update of fase on public.mani
  for each row execute function public.uscite_a_fine_mano();

-- 8) Entrare al tavolo: anche a partita in corso
create or replace function public.entra_tavolo(p_codice text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_utente uuid := auth.uid();
  v_tavolo public.tavoli%rowtype;
  v_posto  int;
  v_fiches int;
begin
  if v_utente is null then raise exception 'Devi entrare con il tuo account.'; end if;
  select * into v_tavolo from public.tavoli
   where codice_invito = upper(trim(p_codice)) for update;
  if not found then raise exception 'Invito non valido: controlla il link.'; end if;
  if exists (select 1 from public.tavolo_giocatori where tavolo_id = v_tavolo.id and giocatore_id = v_utente) then
    return v_tavolo.id;
  end if;
  if v_tavolo.stato not in ('attesa', 'in_corso') then raise exception 'La partita a questo tavolo è chiusa.'; end if;
  select min(s) into v_posto from generate_series(1, v_tavolo.posti) s
   where s not in (select posto from public.tavolo_giocatori where tavolo_id = v_tavolo.id);
  if v_posto is null then raise exception 'Il tavolo è al completo.'; end if;

  if v_tavolo.stato = 'attesa' then
    insert into public.tavolo_giocatori (tavolo_id, giocatore_id, posto) values (v_tavolo.id, v_utente, v_posto);
    return v_tavolo.id;
  end if;

  -- Partita in corso: chi rientra ritrova le sue fiches, chi è nuovo riceve la prima posta
  select fiches into v_fiches from public.tavolo_usciti where tavolo_id = v_tavolo.id and giocatore_id = v_utente;
  if found then
    insert into public.tavolo_giocatori (tavolo_id, giocatore_id, posto, fiches) values (v_tavolo.id, v_utente, v_posto, v_fiches);
    delete from public.tavolo_usciti where tavolo_id = v_tavolo.id and giocatore_id = v_utente;
  else
    insert into public.tavolo_giocatori (tavolo_id, giocatore_id, posto, fiches) values (v_tavolo.id, v_utente, v_posto, 0);
    perform public.aggiungi_posta(v_tavolo.id, v_utente);
    select fiches into v_fiches from public.tavolo_giocatori where tavolo_id = v_tavolo.id and giocatore_id = v_utente;
  end if;
  if v_tavolo.mano_corrente is not null then
    perform public.registra(v_tavolo.mano_corrente, v_utente, 'entra', v_fiches,
      public.nick(v_utente) || ' si siede al tavolo con ' || v_fiches || ' V: gioca dalla prossima mano.');
  end if;
  return v_tavolo.id;
end $$;
