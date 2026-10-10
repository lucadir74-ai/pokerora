-- PokerOra · 08 · Invitati del tavolo, visibili in sala d'attesa
-- Da eseguire una volta in Supabase → SQL Editor → New query → Run
--
-- Elenca chi ha ricevuto un invito a questo tavolo dalla chat di PokerOra e non si è
-- ancora seduto, con chi l'ha invitato e se ha già visto il messaggio.
-- La vede solo chi è seduto al tavolo. Gli inviti mandati con il link (WhatsApp, copia)
-- non si possono seguire: quella persona compare solo quando si siede.

create or replace function public.invitati_tavolo(p_tavolo uuid)
returns table (giocatore_id uuid, nickname text, invitato_da text, invitato_il timestamptz, letto boolean)
language sql stable security definer set search_path = '' as $$
  select distinct on (m.destinatario)
         m.destinatario, p.nickname, public.nick(m.mittente), m.creato_il, m.letto_il is not null
    from public.messaggi_privati m
    join public.tavoli t on t.codice_invito = m.codice_invito
    join public.profili p on p.id = m.destinatario
   where t.id = p_tavolo
     and public.sono_al_tavolo(p_tavolo)
     and not exists (select 1 from public.tavolo_giocatori g
                      where g.tavolo_id = p_tavolo and g.giocatore_id = m.destinatario)
   order by m.destinatario, m.creato_il desc;
$$;

revoke execute on function public.invitati_tavolo(uuid) from public, anon;
grant execute on function public.invitati_tavolo(uuid) to authenticated;
