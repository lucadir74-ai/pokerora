-- PokerOra · 18 · A partita in corso ci si aggiunge, fino a 6 giocatori
-- Da eseguire una volta in Supabase → SQL Editor → New query → Run. Va eseguito DOPO il 17.
--
-- Chi entra a partita in corso non deve aspettare che qualcuno esca: se i posti impostati
-- sono tutti occupati, il tavolo si allarga di un posto, fino al massimo di 6.

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
  -- A partita in corso il tavolo si allarga di un posto, fino al massimo di 6 giocatori
  if v_posto is null and v_tavolo.stato = 'in_corso' and v_tavolo.posti < 6 then
    v_posto := v_tavolo.posti + 1;
    update public.tavoli set posti = v_posto where id = v_tavolo.id;
  end if;
  if v_posto is null then raise exception 'Il tavolo è al completo: si gioca al massimo in 6.'; end if;

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

-- L'invito mostra i posti disponibili: a partita in corso il massimo è 6
create or replace function public.info_invito(p_codice text)
returns table(tavolo_id uuid, nome text, organizzatore text, posti integer, occupati integer,
              valore_posta integer, valuta text, stato text, gia_seduto boolean)
language sql stable security definer set search_path to '' as $function$
  select t.id, t.nome, p.nickname,
         case when t.stato = 'in_corso' then greatest(t.posti, 6) else t.posti end,
         (select count(*)::int from public.tavolo_giocatori g where g.tavolo_id = t.id),
         t.valore_posta, t.valuta, t.stato,
         exists (select 1 from public.tavolo_giocatori g where g.tavolo_id = t.id and g.giocatore_id = auth.uid())
  from public.tavoli t
  join public.profili p on p.id = t.organizzatore
  where t.codice_invito = upper(trim(p_codice)) and auth.uid() is not null;
$function$;
