-- 12_over_in_quattro.sql
-- Over consentito anche con 4 giocatori (decisione del 10/10).
-- Prima: chi faceva buio/controbuio/over non poteva avere il mazziere subito dopo,
-- quindi in 4 il terzo giocatore (quello prima del mazziere) non poteva mai fare l'over.
-- Ora quel vincolo vale per buio e controbuio, non per l'over.
-- Il mazziere continua a non poter fare nessun buio.

create or replace function public.puo_fare_buio(p_mano uuid, p_posto integer)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select p_posto is not null
     and p_posto <> m.mazziere
     and (m.buio_livello = 2
          or public.prossimo_posto(p_mano, p_posto, false) <> m.mazziere)
    from public.mani m where m.id = p_mano;
$function$;
