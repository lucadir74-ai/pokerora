-- 13_busso_dopo_parola.sql
-- Regola della casa: se dopo una o più parole qualcuno bussa, la parola non vale più
-- e chi l'aveva detta torna a parlare (può puntare o bussare).
-- Unica modifica rispetto alla versione in uso: il ramo 'busso'.

CREATE OR REPLACE FUNCTION public.azione(p_mano uuid, p_tipo text, p_importo integer DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.mani%rowtype; t public.tavoli%rowtype; io public.mani_giocatori%rowtype;
  v_utente uuid := auth.uid();
  v_invito int; v_limite text; v_tetto int; v_da_vedere int; v_carte text[]; v_nick text;
  v_sono_buio boolean; v_ho_diritto boolean; v_fiches int; v_pagato int;
begin
  select * into m from public.mani where id = p_mano for update;
  if not found then raise exception 'Mano non trovata.'; end if;
  select * into t from public.tavoli where id = m.tavolo_id;
  select * into io from public.mani_giocatori where mano_id = p_mano and giocatore_id = v_utente;
  if not found then raise exception 'Non partecipi a questa mano.'; end if;
  if m.fase not in ('apertura', 'primo_giro', 'secondo_giro') then raise exception 'In questa fase non si punta.'; end if;
  if io.stato <> 'attivo' then raise exception 'Sei uscito da questa mano.'; end if;
  if m.turno is distinct from io.posto then raise exception 'Non è il tuo turno.'; end if;
  if io.tutto_dentro and p_tipo <> 'passo' then
    raise exception 'Hai messo tutte le tue fiches: giochi per la parte che hai coperto.';
  end if;

  v_nick := public.nick(v_utente);
  v_invito := coalesce((t.regole->>'invito')::int, greatest(1, t.valore_posta / 100));
  v_limite := coalesce(t.regole->>'limite', 'apertura');
  v_da_vedere := m.puntata - io.versato_giro;
  v_sono_buio := m.buio_aperto and m.buio_di = v_utente;
  v_ho_diritto := m.buio_aperto and (m.buio_di = v_utente or v_utente = any(m.buio_coperti));
  select fiches into v_fiches from public.tavolo_giocatori where tavolo_id = t.id and giocatore_id = v_utente;

  if m.buio_aperto and not v_ho_diritto and p_tipo not in ('passo', 'vedo') then
    raise exception 'Dopo il buio puoi solo vedere o lasciare: rilancia solo chi ha fatto il buio o l''ha coperto.';
  end if;

  if p_tipo in ('apro', 'punto', 'rilancio') then
    if p_importo is null or p_importo < v_invito then
      raise exception 'La puntata minima è di % V.', v_invito;
    end if;
    v_tetto := case
      when v_limite = 'piatto' or (v_limite = 'apertura' and p_tipo = 'apro') then m.piatto + v_da_vedere
      when v_limite = 'fisso' then (t.regole->>'puntata_massima')::int
      else null end;
    if v_tetto is not null and p_importo > v_tetto then
      raise exception 'La puntata massima ora è di % V.', v_tetto;
    end if;
    if (p_importo + (case when p_tipo = 'rilancio' then v_da_vedere else 0 end)) > v_fiches then
      raise exception 'Non hai abbastanza fiches: hai % V.', v_fiches;
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
      update public.mani_giocatori set deve_parlare = (giocatore_id <> v_utente and not tutto_dentro)
       where mano_id = p_mano and stato = 'attivo';
      perform public.registra(p_mano, v_utente, 'apro', p_importo, v_nick || ' apre con ' || p_importo || ' V.');
    else
      raise exception 'Prima dell''apertura puoi solo passare o aprire.';
    end if;
  else
    if v_sono_buio or (v_ho_diritto and p_tipo = 'rilancio') then
      update public.mani set buio_aperto = false where id = p_mano;
    end if;

    if p_tipo = 'passo' then
      update public.mani_giocatori
         set stato = 'fuori', deve_parlare = false, uscito_primo_giro = (m.fase = 'primo_giro')
       where mano_id = p_mano and giocatore_id = v_utente;
      perform public.registra(p_mano, v_utente, 'lascio', null, v_nick || ' lascia.');
    elsif p_tipo = 'vedo' then
      if v_da_vedere <= 0 then
        if v_ho_diritto then
          update public.mani_giocatori set deve_parlare = false where mano_id = p_mano and giocatore_id = v_utente;
          perform public.registra(p_mano, v_utente, 'chiudo', null,
            v_nick || case when v_sono_buio then ' chiude il giro.' else ' non rilancia.' end);
        else
          raise exception 'Non c''è nessuna puntata da vedere.';
        end if;
      elsif v_fiches < v_da_vedere then
        -- Non bastano le fiches: vede con tutto quello che ha e gioca per la parte coperta
        v_pagato := public.paga_fino(p_mano, t.id, v_utente, v_da_vedere);
        update public.mani_giocatori set deve_parlare = false, tutto_dentro = true
         where mano_id = p_mano and giocatore_id = v_utente;
        perform public.registra(p_mano, v_utente, 'vedo', v_pagato,
          v_nick || ' vede con tutte le sue fiches (' || v_pagato || ' V): gioca solo per la parte che ha coperto.');
      else
        perform public.paga(p_mano, t.id, v_utente, v_da_vedere);
        update public.mani_giocatori set deve_parlare = false where mano_id = p_mano and giocatore_id = v_utente;
        perform public.registra(p_mano, v_utente, 'vedo', v_da_vedere, v_nick || ' vede (' || v_da_vedere || ' V).');
      end if;
    elsif p_tipo = 'rilancio' then
      if m.puntata = 0 then raise exception 'Non c''è niente da rilanciare: punta.'; end if;
      perform public.paga(p_mano, t.id, v_utente, v_da_vedere + p_importo);
      update public.mani set puntata = puntata + p_importo, ultimo_rilancio = v_utente where id = p_mano;
      update public.mani_giocatori set deve_parlare = (giocatore_id <> v_utente and not tutto_dentro)
       where mano_id = p_mano and stato = 'attivo';
      perform public.registra(p_mano, v_utente, 'rilancio', p_importo, v_nick || ' rilancia di ' || p_importo || ' V.');
    elsif p_tipo = 'punto' then
      if m.fase <> 'secondo_giro' or m.puntata > 0 then raise exception 'C''è già una puntata: vedi o rilancia.'; end if;
      perform public.paga(p_mano, t.id, v_utente, p_importo);
      update public.mani set puntata = p_importo, ultimo_rilancio = v_utente, parol_possibile = false where id = p_mano;
      update public.mani_giocatori set deve_parlare = (giocatore_id <> v_utente and not tutto_dentro)
       where mano_id = p_mano and stato = 'attivo';
      perform public.registra(p_mano, v_utente, 'punto', p_importo, v_nick || ' punta ' || p_importo || ' V.');
    elsif p_tipo = 'busso' then
      if m.fase <> 'secondo_giro' or m.puntata > 0 then raise exception 'C''è già una puntata: vedi o rilancia.'; end if;
      update public.mani set parol_possibile = false where id = p_mano;
      update public.mani_giocatori set deve_parlare = false where mano_id = p_mano and giocatore_id = v_utente;
      -- NUOVO: il primo busso fa cadere la parola, quindi chi l'aveva detta torna a parlare
      if m.parol_possibile then
        update public.mani_giocatori g set deve_parlare = true
         where g.mano_id = p_mano and g.stato = 'attivo' and not g.tutto_dentro
           and g.giocatore_id <> v_utente
           and exists (select 1 from public.mani_azioni a
                        where a.mano_id = p_mano and a.giocatore_id = g.giocatore_id and a.tipo = 'parol');
      end if;
      perform public.registra(p_mano, v_utente, 'busso', null, v_nick || ' bussa.');
    elsif p_tipo = 'parol' then
      if m.fase <> 'secondo_giro' or m.puntata > 0 or not m.parol_possibile then
        raise exception 'Parola non è più possibile: qualcuno ha già bussato o puntato.';
      end if;
      update public.mani_giocatori set deve_parlare = false where mano_id = p_mano and giocatore_id = v_utente;
      perform public.registra(p_mano, v_utente, 'parol', null, v_nick || ' dice parola.');
    else
      raise exception 'Azione non valida.';
    end if;
  end if;

  perform public.avanza(p_mano);
end;
$function$;
