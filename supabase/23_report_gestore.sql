-- 23_report_gestore.sql
-- Report di audit per il gestore dell'app, su TUTTE le mani di TUTTI i tavoli.
-- Usa solo dati già salvati: mazzo_iniziale, sale, impronta_mazzo, carte_iniziali, carte.
-- Non modifica nessuna funzione del motore e non scrive niente: è sola lettura.
--
-- Cosa controlla
--  1. mazzo completo (nessuna carta mancante o ripetuta)
--  2. impronta annunciata = SHA-256 del mazzo iniziale (si provano alcuni formati di testo)
--  3. le carte iniziali coincidono con il mazzo dato "una alla volta" dalla sinistra del mazziere
--     (si conta anche l'ipotesi "a blocchi di 5", per capire come distribuisce davvero il motore)
--  4. nessuna carta finale in mano a due giocatori
--  5. per ogni giocatore, separando "al proprio tavolo" da "al tavolo di altri":
--     punto medio iniziale e, quando cambia 1 carta, quante volte il punto entra
--     contro quante volte dovrebbe entrare per pura fortuna (con z-score):
--       · doppia coppia → full: 4 carte buone su (carte del mazzo − 5)
--       · scala bilaterale (4 consecutive, carta alta) → scala: 8 carte buone su (carte del mazzo − 5)

create or replace function public.report_gestore(p_da timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if not public.sono_gestore() then
    raise exception 'Solo il gestore dell''app può vedere questo report.';
  end if;

  with
  mn as (
    select m.id, m.numero, m.mazziere, m.bassa, m.fase, coalesce(m.gioco, 'italiana') as gioco,
           m.impronta_mazzo, mz.mazzo_iniziale as mi, mz.sale, t.organizzatore,
           (15 - m.bassa) * 4 as nc
      from public.mani m
      join public.mani_mazzo mz on mz.mano_id = m.id
      join public.tavoli t on t.id = m.tavolo_id
     where mz.mazzo_iniziale is not null
       and (p_da is null or m.creata_il >= p_da)
  ),
  chk as (
    select mn.*,
      (cardinality(mi) = nc and (select count(distinct c) from unnest(mi) c) = nc) as completo,
      coalesce(impronta_mazzo in (
        encode(sha256(convert_to(array_to_string(mi, ' ') || '|' || coalesce(sale, ''), 'UTF8')), 'hex'),
        encode(sha256(convert_to(array_to_string(mi, ',') || '|' || coalesce(sale, ''), 'UTF8')), 'hex'),
        encode(sha256(convert_to(array_to_string(mi, '')  || '|' || coalesce(sale, ''), 'UTF8')), 'hex'),
        encode(sha256(convert_to(mi::text                 || '|' || coalesce(sale, ''), 'UTF8')), 'hex')
      ), false) as impronta_ok
    from mn
  ),
  gg as (
    select c.id as mano, c.mi, c.bassa, c.nc, c.organizzatore, c.fase, c.gioco,
           mg.giocatore_id, mg.cambio,
           row_number() over (partition by c.id order by (mg.posto <= c.mazziere), mg.posto) as rk,
           count(*) over (partition by c.id) as n,
           mc.carte, mc.carte_iniziali as ci
      from chk c
      join public.mani_giocatori mg on mg.mano_id = c.id
      join public.mani_carte mc on mc.mano_id = c.id and mc.giocatore_id = mg.giocatore_id
     where c.gioco = 'italiana'
  ),
  dist as (
    select gg.*,
      (select array_agg(x order by x) from unnest(ci) x)
        = (select array_agg(mi[rk + n * k] order by mi[rk + n * k]) from generate_series(0, 4) k) as uno_alla_volta,
      (select array_agg(x order by x) from unnest(ci) x)
        = (select array_agg(x order by x) from unnest(mi[(rk - 1) * 5 + 1 : rk * 5]) x) as a_blocchi
    from gg
    where cardinality(ci) = 5
  ),
  per_mano as (
    select mano, bool_and(uno_alla_volta) as uno, bool_and(a_blocchi) as blocchi from dist group by mano
  ),
  doppie as (
    select mano, count(*) - count(distinct c) as d
      from dist, unnest(carte) c group by mano
  ),
  st as (
    select d.*,
           (public.valuta_mano(ci, bassa))[1] as r0,
           (public.valuta_mano(carte, bassa))[1] as r1,
           array(select public.valore_carta(x) from unnest(ci) x where x = any(carte)
                  order by public.valore_carta(x)) as kv
      from dist d
     where d.fase = 'finita' and cardinality(d.carte) = 5
  ),
  st2 as (
    select st.*,
      (cambio = 1 and cardinality(kv) = 4 and r0 = 1
        and kv[4] - kv[1] = 3 and (select count(distinct v) from unnest(kv) v) = 4
        and kv[1] - 1 >= bassa and kv[4] + 1 <= 14) as sb
    from st
  ),
  agg as (
    select giocatore_id, (giocatore_id = organizzatore) as org,
      count(*) as mani,
      round(avg(r0)::numeric, 2) as punto_medio,
      count(*) filter (where cambio = 1 and r0 = 3) as dc_n,
      count(*) filter (where cambio = 1 and r0 = 3 and r1 >= 6) as dc_ok,
      round((sum(4.0 / (nc - 5)) filter (where cambio = 1 and r0 = 3))::numeric, 2) as dc_att,
      sum((4.0 / (nc - 5)) * (1 - 4.0 / (nc - 5))) filter (where cambio = 1 and r0 = 3) as dc_var,
      count(*) filter (where sb) as sb_n,
      count(*) filter (where sb and r1 >= 5) as sb_ok,
      round((sum(8.0 / (nc - 5)) filter (where sb))::numeric, 2) as sb_att,
      sum((8.0 / (nc - 5)) * (1 - 8.0 / (nc - 5))) filter (where sb) as sb_var
    from st2
    group by giocatore_id, (giocatore_id = organizzatore)
  )
  select jsonb_build_object(
    'mani_totali', (select count(*) from public.mani m where p_da is null or m.creata_il >= p_da),
    'verificabili', (select count(*) from chk),
    'mazzi_ok', (select count(*) from chk where completo),
    'impronte_ok', (select count(*) from chk where impronta_ok),
    'mani_distribuzione', (select count(*) from per_mano),
    'dist_una_alla_volta', (select count(*) from per_mano where uno),
    'dist_a_blocchi', (select count(*) from per_mano where blocchi),
    'mani_con_carte_doppie', (select count(*) from doppie where d > 0),
    'giocatori', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nickname', public.nick(a.giocatore_id), 'al_proprio_tavolo', a.org, 'mani', a.mani,
        'punto_medio', a.punto_medio,
        'dc_n', a.dc_n, 'dc_ok', a.dc_ok, 'dc_att', a.dc_att,
        'dc_z', case when coalesce(a.dc_var, 0) > 0
                     then round(((a.dc_ok - a.dc_att) / sqrt(a.dc_var))::numeric, 2) end,
        'sb_n', a.sb_n, 'sb_ok', a.sb_ok, 'sb_att', a.sb_att,
        'sb_z', case when coalesce(a.sb_var, 0) > 0
                     then round(((a.sb_ok - a.sb_att) / sqrt(a.sb_var))::numeric, 2) end
      ) order by a.mani desc)
      from agg a), '[]'::jsonb)
  ) into r;

  return r;
end;
$$;

revoke execute on function public.report_gestore(timestamptz) from public, anon;
grant execute on function public.report_gestore(timestamptz) to authenticated;
