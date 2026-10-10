-- PokerOra · 07 · Giocatori automatici per fare le prove
-- Da eseguire una volta in Supabase → SQL Editor → New query → Run
--
-- Crea 5 giocatori automatici (Bot_Gino, Bot_Rita, Bot_Tano, Bot_Lia, Bot_Ugo).
-- Non possono accedere (non hanno password), non compaiono nell'elenco degli iscritti,
-- e l'organizzatore li fa sedere dalla sala d'attesa.
-- Quando tocca a loro, l'app di uno dei giocatori veri chiede al server di farli giocare:
-- la mossa la decide e la esegue il server, con le stesse regole e controlli di tutti.

-- 1) Elenco dei giocatori automatici (tabella separata: nessuno può "diventare" bot)
create table if not exists public.giocatori_automatici (
  id      uuid primary key references public.profili(id) on delete cascade,
  ordine  int not null
);
alter table public.giocatori_automatici enable row level security;
drop policy if exists "bot visibili agli utenti loggati" on public.giocatori_automatici;
create policy "bot visibili agli utenti loggati" on public.giocatori_automatici
  for select to authenticated using (true);

-- 2) I cinque giocatori automatici (il profilo lo crea il trigger già esistente)
do $$
declare b record;
begin
  for b in select * from (values
    ('b0000000-0000-4000-8000-000000000001'::uuid, 'Bot_Gino', 1),
    ('b0000000-0000-4000-8000-000000000002'::uuid, 'Bot_Rita', 2),
    ('b0000000-0000-4000-8000-000000000003'::uuid, 'Bot_Tano', 3),
    ('b0000000-0000-4000-8000-000000000004'::uuid, 'Bot_Lia',  4),
    ('b0000000-0000-4000-8000-000000000005'::uuid, 'Bot_Ugo',  5)
  ) as x(id, nick, ordine)
  loop
    if not exists (select 1 from auth.users where id = b.id) then
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
      values (b.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              lower(b.nick) || '@bot.pokerora.invalid',
              jsonb_build_object('nickname', b.nick, 'nome', 'Giocatore', 'cognome', 'Automatico'),
              '{"provider":"email","providers":["email"]}'::jsonb, now(), now());
    end if;
    insert into public.giocatori_automatici (id, ordine) values (b.id, b.ordine) on conflict (id) do nothing;
  end loop;
end $$;

-- 3) L'organizzatore fa sedere un giocatore automatico (in sala d'attesa)
create or replace function public.aggiungi_bot(p_tavolo uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tavolo public.tavoli%rowtype; v_bot uuid; v_posto int;
begin
  select * into v_tavolo from public.tavoli where id = p_tavolo for update;
  if not found or v_tavolo.organizzatore <> auth.uid() then
    raise exception 'Solo l''organizzatore può aggiungere giocatori automatici.';
  end if;
  if v_tavolo.stato <> 'attesa' then raise exception 'La partita è già iniziata.'; end if;
  select a.id into v_bot from public.giocatori_automatici a
   where not exists (select 1 from public.tavolo_giocatori g where g.tavolo_id = p_tavolo and g.giocatore_id = a.id)
   order by a.ordine limit 1;
  if v_bot is null then raise exception 'Non ci sono altri giocatori automatici disponibili.'; end if;
  select min(s) into v_posto from generate_series(1, v_tavolo.posti) s
   where s not in (select posto from public.tavolo_giocatori where tavolo_id = p_tavolo);
  if v_posto is null then raise exception 'Il tavolo è al completo.'; end if;
  insert into public.tavolo_giocatori (tavolo_id, giocatore_id, posto) values (p_tavolo, v_bot, v_posto);
end;
$$;

-- 4) …e lo fa alzare
create or replace function public.togli_bot(p_tavolo uuid, p_bot uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tavolo public.tavoli%rowtype;
begin
  select * into v_tavolo from public.tavoli where id = p_tavolo for update;
  if not found or v_tavolo.organizzatore <> auth.uid() then
    raise exception 'Solo l''organizzatore può togliere giocatori automatici.';
  end if;
  if v_tavolo.stato <> 'attesa' then raise exception 'La partita è già iniziata.'; end if;
  if not exists (select 1 from public.giocatori_automatici where id = p_bot) then
    raise exception 'Si possono togliere solo i giocatori automatici.';
  end if;
  delete from public.tavolo_giocatori where tavolo_id = p_tavolo and giocatore_id = p_bot;
end;
$$;

-- 5) Esegue una mossa a nome del bot, usando le stesse funzioni dei giocatori veri
create or replace function public.bot_esegui(p_mano uuid, p_bot uuid, p_fase text, p_tipo text, p_importo int, p_scarti text[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_sub text := current_setting('request.jwt.claim.sub', true);
        v_claims text := current_setting('request.jwt.claims', true);
begin
  -- Per la durata della mossa il server "è" il bot: valgono tutti i controlli normali
  perform set_config('request.jwt.claim.sub', p_bot::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_bot, 'role', 'authenticated')::text, true);
  begin
    if p_fase = 'buio' then perform public.buio(p_mano, p_tipo = 'buio');
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
$$;

-- 6) Il bot decide e gioca. Lo chiama l'app di un giocatore vero quando tocca a un bot.
--    Strategia semplice e prudente: ogni tanto fa il buio, apre se può, vede con coppia
--    o meglio, rilancia con tris o meglio, al cambio tiene coppie e tris.
create or replace function public.gioca_bot(p_mano uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  m public.mani%rowtype; t public.tavoli%rowtype; b public.mani_giocatori%rowtype;
  v_carte text[]; v int[]; v_cat int := 0; v_invito int; v_limite text; v_da_vedere int; v_tetto int;
  v_tipo text; v_importo int := 0; v_scarti text[] := '{}'; v_max int; v_serve int; v_sono_buio boolean;
  v_puo_rilanciare boolean; r float8 := random();
begin
  if not public.sono_alla_mano(p_mano) then raise exception 'Non sei seduto a questo tavolo.'; end if;
  select * into m from public.mani where id = p_mano for update;
  if not found or m.turno is null
     or m.fase not in ('buio', 'apertura', 'primo_giro', 'cambio', 'secondo_giro') then
    return false;
  end if;
  select g.* into b from public.mani_giocatori g
    join public.giocatori_automatici a on a.id = g.giocatore_id
   where g.mano_id = p_mano and g.posto = m.turno and g.stato = 'attivo';
  if not found then return false; end if;     -- non tocca a un bot

  select * into t from public.tavoli where id = m.tavolo_id;
  select carte into v_carte from public.mani_carte where mano_id = p_mano and giocatore_id = b.giocatore_id;
  if coalesce(cardinality(v_carte), 0) = 5 then
    v := public.valuta_mano(v_carte, m.bassa);
    v_cat := v[1];
  end if;
  v_invito := coalesce((t.regole->>'invito')::int, greatest(1, t.valore_posta / 100));
  v_limite := coalesce(t.regole->>'limite', 'apertura');
  v_da_vedere := greatest(m.puntata - b.versato_giro, 0);
  v_sono_buio := m.buio_aperto and m.buio_di = b.giocatore_id;
  v_puo_rilanciare := m.puntata > 0 and (not m.buio_aperto or v_sono_buio);
  v_tetto := case
    when v_limite = 'piatto' or (v_limite = 'apertura' and m.fase = 'apertura') then m.piatto + v_da_vedere
    when v_limite = 'fisso' then (t.regole->>'puntata_massima')::int
    else null end;

  -- Decisione
  if m.fase = 'buio' then
    -- Ogni tanto fa il buio (o il controbuio), così si può provare anche quella parte
    if r < 0.15 then
      v_tipo := 'buio';
      v_importo := case when m.buio_livello = 0 then m.piatto else m.buio_importo * 2 end;
    else
      v_tipo := 'nobuio';
    end if;
  elsif m.fase = 'apertura' then
    if public.puo_aprire(v_carte, m.requisito, m.bassa) then
      v_tipo := 'apro'; v_importo := greatest(v_invito * 2, m.piatto / 2);
    else
      v_tipo := 'passo';
    end if;
  elsif m.fase = 'primo_giro' then
    if v_sono_buio and v_da_vedere = 0 then
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
      v_scarti := '{}';                                     -- servito
    elsif v_cat = 1 then                                    -- niente: tiene solo la carta più alta
      select coalesce(array_agg(c), '{}') into v_scarti from (
        select c from unnest(v_carte) c
         order by public.valore_carta(c) desc, public.seme_carta(c) desc offset 1) x;
    else                                                    -- tiene coppie, tris, poker
      select coalesce(array_agg(c), '{}') into v_scarti from unnest(v_carte) c
       where (select count(*) from unnest(v_carte) d where public.valore_carta(d) = public.valore_carta(c)) = 1;
    end if;
    if cardinality(v_scarti) > v_max then
      select array_agg(c) into v_scarti from (
        select c from unnest(v_scarti) c order by public.valore_carta(c) asc limit v_max) x;
    end if;
  else -- secondo giro
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

  -- Puntate dentro i limiti del tavolo
  if v_tipo in ('apro', 'punto', 'rilancio') then
    v_importo := greatest(v_invito, least(v_importo, coalesce(v_tetto, v_importo)));
  end if;
  if v_tipo = 'vedo' and v_da_vedere = 0 and not v_sono_buio then
    v_tipo := case when m.fase = 'secondo_giro' then 'busso' else 'passo' end;
  end if;

  -- Se mancano fiches, il bot prende un'altra posta come farebbe chiunque
  v_serve := case v_tipo when 'buio' then v_importo when 'vedo' then v_da_vedere when 'rilancio' then v_da_vedere + v_importo
                         when 'apro' then v_importo when 'punto' then v_importo else 0 end;
  while v_serve > 0 and (select fiches from public.tavolo_giocatori
                          where tavolo_id = m.tavolo_id and giocatore_id = b.giocatore_id) < v_serve loop
    perform public.aggiungi_posta(m.tavolo_id, b.giocatore_id);
    perform public.registra(p_mano, b.giocatore_id, 'posta', null,
      public.nick(b.giocatore_id) || ' prende un''altra posta.');
  end loop;

  -- Esegue; se per qualche motivo la mossa non è valida, ripiega sulla più semplice
  begin
    perform public.bot_esegui(p_mano, b.giocatore_id, m.fase, v_tipo, v_importo, v_scarti);
  exception when others then
    perform public.bot_esegui(p_mano, b.giocatore_id, m.fase,
      case when m.fase = 'buio' then 'nobuio'
           when m.fase = 'secondo_giro' and m.puntata = 0 then 'busso' else 'passo' end, 0, '{}');
  end;
  return true;
end;
$$;

-- 7) Permessi: le funzioni interne non le chiama nessuno da fuori
revoke execute on function public.bot_esegui(uuid, uuid, text, text, int, text[]) from public, anon, authenticated;
revoke execute on function public.gioca_bot(uuid) from public, anon;
revoke execute on function public.aggiungi_bot(uuid) from public, anon;
revoke execute on function public.togli_bot(uuid, uuid) from public, anon;
grant execute on function public.gioca_bot(uuid) to authenticated;
grant execute on function public.aggiungi_bot(uuid) to authenticated;
grant execute on function public.togli_bot(uuid, uuid) to authenticated;
