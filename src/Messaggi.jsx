import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import Testata from './Testata'
import { vai } from './rotte'
import { ora } from './tempo'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CAMPI = 'id, mittente, destinatario, testo, codice_invito, creato_il'
const giorno = (t) => new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })

// Conversazione privata con un altro iscritto, con invito ai propri tavoli
export default function Messaggi({ altroId, io }) {
  const [altro, setAltro] = useState(undefined)
  const [messaggi, setMessaggi] = useState([])
  const [tavoli, setTavoli] = useState([])
  const [scelto, setScelto] = useState('')
  const [testo, setTesto] = useState('')
  const [errore, setErrore] = useState('')
  const [invio, setInvio] = useState(false)
  const lista = useRef(null)
  const valido = UUID.test(altroId) && altroId !== io.id

  useEffect(() => {
    if (!valido) return setAltro(null)
    let attivo = true
    supabase.from('profili').select('id, nickname').eq('id', altroId).maybeSingle()
      .then(({ data }) => { if (attivo) setAltro(data ?? null) })
    supabase.from('messaggi_privati').select(CAMPI)
      .or(`mittente.eq.${altroId},destinatario.eq.${altroId}`)
      .order('id', { ascending: false }).limit(200)
      .then(({ data }) => { if (attivo) setMessaggi((data ?? []).reverse()) })
    supabase.rpc('segna_letti', { p_mittente: altroId })
    // I miei tavoli ancora in sala d'attesa, per poter invitare
    supabase.from('tavoli').select('id, nome, codice_invito').eq('stato', 'attesa')
      .order('creato_il', { ascending: false })
      .then(({ data }) => { if (attivo) setTavoli(data ?? []) })

    const canale = supabase
      .channel(`dm-${io.id}-${altroId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messaggi_privati', filter: `destinatario=eq.${io.id}` },
        ({ new: m }) => {
          if (m.mittente !== altroId) return
          setMessaggi((l) => l.some((x) => x.id === m.id) ? l : [...l, m].slice(-200))
          supabase.rpc('segna_letti', { p_mittente: altroId })
        })
      .subscribe()
    return () => { attivo = false; supabase.removeChannel(canale) }
  }, [altroId, io.id, valido])

  useEffect(() => {
    const el = lista.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messaggi.length])

  async function manda(contenuto, codice = null) {
    const t = contenuto.trim()
    if (!t || invio) return false
    setInvio(true)
    setErrore('')
    const { data, error } = await supabase.from('messaggi_privati')
      .insert({ destinatario: altroId, testo: t.slice(0, 500), codice_invito: codice })
      .select(CAMPI).single()
    setInvio(false)
    if (error) { setErrore('Messaggio non inviato. Riprova.'); return false }
    setMessaggi((l) => l.some((x) => x.id === data.id) ? l : [...l, data].slice(-200))
    return true
  }

  async function scrivi(e) {
    e.preventDefault()
    if (await manda(testo)) setTesto('')
  }

  async function invita() {
    const t = tavoli.find((x) => x.id === scelto)
    if (!t) return setErrore('Scegli prima il tavolo.')
    if (await manda(`Ti invito al mio tavolo “${t.nome}”.`, t.codice_invito)) setScelto('')
  }

  if (altro === undefined) return <main className="pagina"><Testata io={io} indietro="/giocatori" /></main>
  if (altro === null) {
    return (
      <main className="pagina">
        <Testata io={io} indietro="/giocatori" />
        <section className="carta"><p>Giocatore non trovato.</p></section>
      </main>
    )
  }

  return (
    <main className="pagina">
      <Testata io={io} indietro="/giocatori" />

      <section className="carta">
        <h2>{altro.nickname}</h2>
        <div className="chat">
          <ol className="chat-lista dm-lista" ref={lista} aria-live="polite">
            {messaggi.length === 0 && <li className="chat-vuota">Nessun messaggio. Scrivi tu per primo.</li>}
            {messaggi.map((m) => (
              <li key={m.id} className={m.mittente === io.id ? 'mio' : ''}>
                <span className="chat-chi">{m.mittente === io.id ? 'Tu' : altro.nickname}</span>
                <time>{giorno(m.creato_il)} {ora(m.creato_il)}</time>
                <p>{m.testo}</p>
                {m.codice_invito && m.mittente !== io.id && (
                  <button className="principale piccolo" onClick={() => vai(`/invito/${m.codice_invito}`)}>
                    Siediti al tavolo
                  </button>
                )}
              </li>
            ))}
          </ol>
          <form className="chat-scrivi" onSubmit={scrivi}>
            <input value={testo} maxLength={500} placeholder={`Scrivi a ${altro.nickname}…`} aria-label="Messaggio"
              onChange={(e) => setTesto(e.target.value)} />
            <button className="principale" disabled={invio || !testo.trim()}>Invia</button>
          </form>
        </div>
        {errore && <p className="errore" role="alert">{errore}</p>}
      </section>

      <section className="carta">
        <h2>Invita a un tavolo</h2>
        {tavoli.length === 0 ? (
          <p className="tenue">Non hai tavoli in sala d’attesa. Aprine uno da “I tuoi tavoli” e poi torna qui.</p>
        ) : (
          <div className="invita-riga">
            <select value={scelto} onChange={(e) => setScelto(e.target.value)} aria-label="Tavolo">
              <option value="">Scegli il tavolo…</option>
              {tavoli.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
            <button className="secondario" disabled={invio || !scelto} onClick={invita}>Invita</button>
          </div>
        )}
      </section>
    </main>
  )
}
