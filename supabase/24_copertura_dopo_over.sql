-- 24_copertura_dopo_over.sql
-- Ordine delle richieste prima delle carte:
--   1. buio            (se nessuno lo fa: si chiude, niente da coprire)
--   2. controbuio      (se nessuno lo fa: si chiude, c'è solo il buio)
--   3. over
--   4. copertura, solo adesso:
--      - over rifiutato (o impossibile): chi ha fatto il buio può coprire il controbuio
--      - over fatto: lo coprono prima chi ha fatto il controbuio, poi chi ha fatto il buio
-- Prima la copertura del controbuio veniva chiesta subito, prima dell'over.

CREATE OR REPLACE FUNCTION public.buio(p_mano uuid, p_faccio boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.mani%rowtype; io public.mani_giocatori%rowtype;
  v_utente uuid := auth.uid(); v_importo int; v_nome text; v_coda uuid[];
  v_buiante uuid; v_prossimo int; v_prossimo_id uuid;
begin
  select * into m from public.mani where id = p_mano for update;
  if not found then raise exception 'Mano non trovata.'; end if;
  select * into io from public.mani_giocatori where mano_id = p_mano and giocatore_id = v_utente;
  if not found then raise exception 'Non partecipi a questa mano.'; end if;
  if m.fase <> 'buio' then raise exception 'Il buio si può fare solo prima della distribuzione.'; end if;
  if m.turno is distinct from io.posto then raise exception 'Non è il tuo turno.'; end if;
  if cardinality(m.buio_da_chiedere) > 0 then raise exception 'Prima si decide se coprire.'; end if;

  v_nome := (array['buio','controbuio','over'])[m.buio_livello + 1];

  -- Chi ha fatto il primo buio di questa mano
  select giocatore_id into v_buiante
    from public.mani_azioni where mano_id = p_mano and tipo = 'buio' limit 1;

  if not p_faccio then
    perform public.registra(p_mano, v_utente, 'nobuio', null,
      public.nick(v_utente) || case when m.buio_livello = 0 then ' non fa il buio.' else ' non fa il ' || v_nome || '.' end);
    -- NUOVO: over rifiutato dopo un controbuio → solo ora chi ha fatto il buio può coprire il controbuio
    if m.buio_livello = 2 and v_buiante is not null then
      update public.mani set buio_da_chiedere = array[v_buiante] where id = p_mano;
      perform public.buio_prosegui(p_mano);
      return;
    end if;
    perform public.chiudi_buio(p_mano);
    return;
  end if;

  -- Niente secondo buio per chi ne ha già fatto uno (l'over spetta al terzo, non al buiante)
  if exists (select 1 from public.mani_azioni
              where mano_id = p_mano and giocatore_id = v_utente
                and tipo in ('buio', 'controbuio', 'over')) then
    raise exception 'Hai già fatto un buio in questa mano: non puoi fare il %.', v_nome;
  end if;

  if not public.puo_fare_buio(p_mano, io.posto) then
    raise exception 'Da questo posto non si può fare il %: il mazziere non può parlare per primo.', v_nome;
  end if;

  v_importo := case when m.buio_livello = 0 then m.piatto else m.buio_importo * 2 end;
  perform public.paga(p_mano, m.tavolo_id, v_utente, v_importo);

  -- NUOVO: dopo il controbuio non si chiede ancora la copertura (prima viene l'over).
  -- Dopo l'over coprono chi ha fatto il controbuio e poi chi ha fatto il buio.
  v_coda := case when m.buio_livello = 2 then array_remove(array[m.buio_di, v_buiante], null)
                 else '{}'::uuid[] end;

  update public.mani
     set buio_livello = buio_livello + 1, buio_importo = v_importo, buio_di = v_utente,
         buio_coperti = '{}', buio_da_chiedere = v_coda
   where id = p_mano;
  perform public.registra(p_mano, v_utente, v_nome, v_importo,
    public.nick(v_utente) || ' fa il ' || v_nome || ' (' || v_importo || ' V).');

  -- NUOVO: appena fatto il controbuio, se l'over non lo può fare nessuno
  -- (il prossimo è il mazziere o ha già fatto un buio) si passa subito alla copertura
  if m.buio_livello = 1 then
    v_prossimo := public.prossimo_posto(p_mano, io.posto, false);
    select giocatore_id into v_prossimo_id
      from public.mani_giocatori where mano_id = p_mano and posto = v_prossimo;
    if v_prossimo is null
       or not public.puo_fare_buio(p_mano, v_prossimo)
       or exists (select 1 from public.mani_azioni
                   where mano_id = p_mano and giocatore_id = v_prossimo_id
                     and tipo in ('buio', 'controbuio', 'over')) then
      update public.mani set buio_da_chiedere = array[m.buio_di] where id = p_mano;
    end if;
  end if;

  perform public.buio_prosegui(p_mano);
end;
$function$;

CREATE OR REPLACE FUNCTION public.copri_buio(p_mano uuid, p_copro boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.mani%rowtype; io public.mani_giocatori%rowtype;
  v_utente uuid := auth.uid(); v_diff int; v_cosa text;
begin
  select * into m from public.mani where id = p_mano for update;
  if not found then raise exception 'Mano non trovata.'; end if;
  select * into io from public.mani_giocatori where mano_id = p_mano and giocatore_id = v_utente;
  if not found then raise exception 'Non partecipi a questa mano.'; end if;
  if m.fase <> 'buio' or cardinality(m.buio_da_chiedere) = 0 or m.buio_da_chiedere[1] <> v_utente
     or m.turno is distinct from io.posto then
    raise exception 'Non tocca a te coprire.';
  end if;
  v_cosa := case m.buio_livello when 2 then 'il controbuio' else 'l''over' end;

  if p_copro then
    v_diff := m.buio_importo - io.versato_giro;
    perform public.paga(p_mano, m.tavolo_id, v_utente, v_diff);
    update public.mani
       set buio_coperti = buio_coperti || v_utente, buio_da_chiedere = buio_da_chiedere[2:]
     where id = p_mano;
    perform public.registra(p_mano, v_utente, 'copro', v_diff,
      public.nick(v_utente) || ' copre ' || v_cosa || ' (' || v_diff || ' V) e conserva il diritto di rilanciare.');
  else
    -- Chi non copre chiude la catena: chi viene dopo di lui non può più coprire
    update public.mani set buio_da_chiedere = '{}' where id = p_mano;
    perform public.registra(p_mano, v_utente, 'noncopro', null,
      public.nick(v_utente) || ' non copre ' || v_cosa || '.');
  end if;

  -- NUOVO: la copertura del controbuio arriva solo dopo che l'over è stato rifiutato,
  -- quindi non si torna a chiedere l'over: si chiude il buio e si danno le carte
  if m.buio_livello = 2 then
    perform public.chiudi_buio(p_mano);
  else
    perform public.buio_prosegui(p_mano);
  end if;
end;
$function$;
