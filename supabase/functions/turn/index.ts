// Funzione Supabase "turn": chiede a Cloudflare credenziali TURN temporanee (valide 24 ore)
// e le restituisce all'app. Le chiavi di Cloudflare restano qui sul server, mai nel browser.
// Va creata nel pannello di Supabase (Edge Functions) con il nome "turn", lasciando attiva
// la verifica JWT: così possono usarla solo i giocatori che hanno fatto l'accesso.
// Segreti da impostare in Supabase (Edge Functions → Secrets):
//   CLOUDFLARE_TURN_KEY_ID     → il "Turn Token ID" di Cloudflare
//   CLOUDFLARE_TURN_KEY_TOKEN  → l'"API Token" di Cloudflare

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const risposta = (dati: unknown, stato = 200) =>
  new Response(JSON.stringify(dati), { status: stato, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const id = Deno.env.get('CLOUDFLARE_TURN_KEY_ID')
  const token = Deno.env.get('CLOUDFLARE_TURN_KEY_TOKEN')
  if (!id || !token) return risposta({ errore: 'Chiavi Cloudflare non impostate nei segreti' }, 500)

  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
    })
    if (!r.ok) return risposta({ errore: 'Cloudflare ha rifiutato la richiesta', stato: r.status }, 502)
    const d = await r.json()
    const lista = Array.isArray(d.iceServers) ? d.iceServers : d.iceServers ? [d.iceServers] : []
    // Cloudflare consiglia di togliere gli indirizzi sulla porta 53: nei browser non funzionano e rallentano
    const pulita = lista
      .map((s: { urls: string | string[] }) => ({
        ...s,
        urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)),
      }))
      .filter((s: { urls: string[] }) => s.urls.length)
    if (!pulita.length) return risposta({ errore: 'Cloudflare non ha restituito server' }, 502)
    return risposta(pulita)
  } catch {
    return risposta({ errore: 'Cloudflare non raggiungibile' }, 502)
  }
})
