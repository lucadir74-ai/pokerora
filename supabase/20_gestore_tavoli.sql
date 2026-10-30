-- 20_gestore_tavoli.sql
-- Il gestore dell'app può vedere e chiudere tutti i tavoli aperti, anche quelli aperti da altri
-- (per esempio un tavolo di prova abbandonato con il turno fermo su chi non usa più l'app).

-- 1) Chi è gestore
create table if not exists public.gestori (
  giocatore_id uuid primary key references public.profili(id) on delete cascade
);
alter table public.gestori enable row level security;
revoke all on public.gestori from anon, authenticated;

-- ▶ Metti qui l'email con cui entri in PokerOra
insert into public.gestori (giocatore_id)
select id from auth.users where lower(email) = lower('LA_TUA_EMAIL')
on conflict do nothing;

create or replace function public.sono_gestore()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.gestori where giocatore_id = auth.uid());
$$;

-- 2) Elenco dei tavoli non chiusi, solo per il gestore
create or replace function public.tavoli_aperti_gestione()
returns table (tavolo_id uuid, tavolo_nome text, tavolo_stato text, organizzatore_nick text,
               seduti int, posti_totali int, creato timestamptz, ultima_attivita timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.sono_gestore() then raise exception 'Solo il gestore dell''app può vedere tutti i tavoli.'; end if;
  return query
  select t.id, t.nome::text, t.stato::text, public.nick(t.organizzatore),
         (select count(*)::int from public.tavolo_giocatori g where g.tavolo_id = t.id),
         t.posti::int, t.creato_il,
         coalesce((select max(a.creata_il) from public.mani_azioni a where a.tavolo_id = t.id), t.avviato_il, t.creato_il)
    from public.tavoli t
   where t.stato <> 'chiuso'
   order by t.creato_il desc;
end;
$$;

-- 3) Chiudere un tavolo: l'organizzatore, oppure il gestore
create or replace function public.chiudi_tavolo(p_tavolo uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.tavoli set stato = 'chiuso', chiuso_il = now()
   where id = p_tavolo and stato <> 'chiuso'
     and (organizzatore = auth.uid() or public.sono_gestore());
  if not found then raise exception 'Solo l''organizzatore (o il gestore dell''app) può chiudere il tavolo.'; end if;
end;
$$;

revoke execute on function public.sono_gestore(), public.tavoli_aperti_gestione() from public, anon;
grant execute on function public.sono_gestore(), public.tavoli_aperti_gestione() to authenticated;

-- Controllo: deve comparire il tuo nickname (se la tabella è vuota, l'email non era giusta)
select p.nickname as gestore from public.gestori g join public.profili p on p.id = g.giocatore_id;
