-- PokerOra · 10 · Il vincitore può mostrare le carte quando gli altri hanno lasciato
-- Da eseguire una volta in Supabase → SQL Editor → New query → Run
--
-- Quando tutti lasciano, chi resta vince senza mostrare le carte. Se vuole, può scoprirle
-- lo stesso (per far vedere che aveva il punto, o che era un bluff): non è obbligatorio.

create or replace function public.mostra_carte(p_mano uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.mani%rowtype; v_utente uuid := auth.uid(); v_carte text[];
begin
  select * into m from public.mani where id = p_mano for update;
  if not found then raise exception 'Mano non trovata.'; end if;
  if m.fase <> 'finita' or coalesce(m.esito->>'tipo', '') <> 'unico'
     or not (m.esito->'vincitori') ? v_utente::text then
    raise exception 'Puoi mostrare le carte solo se hai vinto perché gli altri hanno lasciato.';
  end if;
  -- Solo finché la mano è ancora quella sul tavolo
  if (select mano_corrente from public.tavoli where id = m.tavolo_id) is distinct from p_mano then
    raise exception 'La mano è già passata.';
  end if;
  if exists (select 1 from public.mani_giocatori where mano_id = p_mano and giocatore_id = v_utente and carte_mostrate is not null) then
    return;
  end if;
  select carte into v_carte from public.mani_carte where mano_id = p_mano and giocatore_id = v_utente;
  if coalesce(cardinality(v_carte), 0) <> 5 then raise exception 'Carte non disponibili.'; end if;
  update public.mani_giocatori
     set carte_mostrate = v_carte, punto = public.nome_punto(public.valuta_mano(v_carte, m.bassa))
   where mano_id = p_mano and giocatore_id = v_utente;
  perform public.registra(p_mano, v_utente, 'mostra', null,
    public.nick(v_utente) || ' mostra le carte: ' || lower(left(public.nome_punto(public.valuta_mano(v_carte, m.bassa)), 1))
    || substr(public.nome_punto(public.valuta_mano(v_carte, m.bassa)), 2) || '.');
end;
$$;

revoke execute on function public.mostra_carte(uuid) from public, anon;
grant execute on function public.mostra_carte(uuid) to authenticated;
