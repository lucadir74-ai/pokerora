import { useEffect, useRef, useState } from 'react'
import { ora } from './tempo'

export default function Chat({ messaggi, invia, nomeDi, io }) {
  const [testo, setTesto] = useState('')
  const [errore, setErrore] = useState('')
  const [invio, setInvio] = useState(false)
  const lista = useRef(null)

  // Scorre in fondo quando arriva un messaggio
  useEffect(() => {
    const el = lista.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messaggi.length])

  async function manda(e) {
    e.preventDefault()
    if (!testo.trim() || invio) return
    setInvio(true)
    const err = await invia(testo)
    setInvio(false)
    setErrore(err ?? '')
    if (!err) setTesto('')
  }

  return (
    <div className="chat">
      <h3>Chat</h3>
      <ol className="chat-lista" ref={lista} aria-live="polite">
        {messaggi.length === 0 && <li className="chat-vuota">Nessun messaggio. Rompi il ghiaccio.</li>}
        {messaggi.map((m) => (
          <li key={m.id} className={m.giocatore_id === io.id ? 'mio' : ''}>
            <span className="chat-chi">{m.giocatore_id === io.id ? 'Tu' : nomeDi(m.giocatore_id)}</span>
            <time>{ora(m.creato_il)}</time>
            <p>{m.testo}</p>
          </li>
        ))}
      </ol>
      <form className="chat-scrivi" onSubmit={manda}>
        <input value={testo} maxLength={300} placeholder="Scrivi al tavolo…" aria-label="Messaggio"
          onChange={(e) => setTesto(e.target.value)} />
        <button className="principale" disabled={invio || !testo.trim()}>Invia</button>
      </form>
      {errore && <p className="errore" role="alert">{errore}</p>}
    </div>
  )
}
