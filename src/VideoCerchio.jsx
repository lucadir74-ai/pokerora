import { useCallback, useEffect, useRef, useState } from 'react'

// Il video di un giocatore in un cerchio (muto: l'audio passa da AudioRemoti)
export function VideoCerchio({ stream, specchio = false, className = '', titolo }) {
  const ref = useRef(null)
  // Se arriva una traccia nuova, si riassegna il flusso (alcuni telefoni non se ne accorgono da soli)
  const tracciaVideo = stream?.getVideoTracks()[0]?.id ?? ''
  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.srcObject = null
    v.srcObject = stream ?? null
    v.play?.().catch(() => {})
  }, [stream, tracciaVideo])
  return (
    <video ref={ref} className={`video-cerchio${specchio ? ' specchio' : ''} ${className}`} autoPlay playsInline muted
      aria-label={titolo} />
  )
}

// L'audio degli altri giocatori. I browser bloccano l'audio automatico finché non si tocca la pagina,
// e i telefoni (soprattutto iPhone) a volte lo mettono in pausa da soli, per esempio quando si accende il microfono.
// Per questo: si riprova a ogni tocco sulla pagina e ogni pochi secondi; se resta bloccato compare il tasto.
export function AudioRemoti({ audio }) {
  const contenitore = useRef(null)
  const [bloccato, setBloccato] = useState(false)

  const suonaTutti = useCallback(async () => {
    const el = contenitore.current
    if (!el) return
    const fermi = [...el.querySelectorAll('audio')].filter((a) => a.srcObject && a.paused)
    if (!fermi.length) { setBloccato(false); return }
    const esiti = await Promise.all(fermi.map((a) => a.play().then(() => true, () => false)))
    setBloccato(esiti.some((ok) => !ok))
  }, [])

  // Appena cambia l'elenco (qualcuno entra, esce o si ricollega) si prova a far partire l'audio
  useEffect(() => { suonaTutti() }, [audio, suonaTutti])

  useEffect(() => {
    const giro = setInterval(suonaTutti, 3000)
    const tocco = () => { suonaTutti() }
    const eventi = ['pointerdown', 'touchend', 'keydown']
    for (const e of eventi) document.addEventListener(e, tocco, { capture: true, passive: true })
    return () => {
      clearInterval(giro)
      for (const e of eventi) document.removeEventListener(e, tocco, { capture: true })
    }
  }, [suonaTutti])

  return (
    <>
      <span ref={contenitore} className="audio-remoti">
        {audio.map((a) => <AudioUno key={a.chiave} stream={a.stream} />)}
      </span>
      {bloccato && audio.length > 0 && (
        <button type="button" className="sblocca-audio" onClick={suonaTutti}>
          🔈 Tocca per sentire gli altri
        </button>
      )}
    </>
  )
}

function AudioUno({ stream }) {
  const ref = useRef(null)
  useEffect(() => {
    const a = ref.current
    if (a && a.srcObject !== stream) a.srcObject = stream
  }, [stream])
  return <audio ref={ref} autoPlay playsInline />
}

// Fotocamera e microfono: spenti all'inizio, si accendono con un tocco
export function TastiMedia({ video, className = '' }) {
  return (
    <span className={`tasti-media ${className}`}>
      <button type="button" className={`tasto-media${video.cam ? ' acceso' : ''}`} onClick={video.alternaCam}
        aria-pressed={video.cam} aria-label={video.cam ? 'Spegni la fotocamera' : 'Accendi la fotocamera'}
        title={video.cam ? 'Fotocamera accesa: tocca per spegnerla' : 'Fotocamera spenta: tocca per accenderla'}>
        {video.cam ? '📹' : '📷'}<span className="tasto-media-stato" aria-hidden="true">{video.cam ? '' : '✕'}</span>
      </button>
      <button type="button" className={`tasto-media${video.mic ? ' acceso' : ''}`} onClick={video.alternaMic}
        aria-pressed={video.mic} aria-label={video.mic ? 'Spegni il microfono' : 'Accendi il microfono'}
        title={video.mic ? 'Microfono acceso: tocca per spegnerlo' : 'Microfono spento: tocca per accenderlo'}>
        🎤<span className="tasto-media-stato" aria-hidden="true">{video.mic ? '' : '✕'}</span>
      </button>
    </span>
  )
}

// Dettagli tecnici del collegamento con un giocatore (si apre toccando la spia 📡)
export function DiagnosiVideo({ video, nome }) {
  const id = video.diagnosiDi
  if (!id) return null
  const righe = video.dettagli[id] ?? []
  const tipi = (o) => Object.entries(o ?? {}).map(([k, n]) => `${k} ${n}`).join(', ') || 'nessuno'
  return (
    <div className="diag-velo" onClick={() => video.mostraDiagnosi(null)}>
      <div className="diag-finestra" role="dialog" aria-label="Dettagli collegamento video" onClick={(e) => e.stopPropagation()}>
        <h3>Collegamento con {nome(id)}</h3>
        <p className="diag-nota">TURN: {video.turn ? 'configurato' : 'non configurato'}</p>
        {righe.length === 0 && <p>Nessun dispositivo di questo giocatore è collegato al video.</p>}
        {righe.map((r) => (
          <dl key={r.sessione} className="diag-dati">
            <div><dt>Chi chiama</dt><dd>{r.chiamo ? 'io' : 'lui'}</dd></div>
            <div><dt>Tentativo</dt><dd>{r.tentativi || '—'}</dd></div>
            <div><dt>Offerta</dt><dd>{r.offerta || '—'}</dd></div>
            <div><dt>Risposta</dt><dd>{r.risposta || '—'}</dd></div>
            <div><dt>Collegamento</dt><dd>{r.collegamento}</dd></div>
            <div><dt>ICE</dt><dd>{r.ice || '—'}</dd></div>
            <div><dt>Miei candidati</dt><dd>{tipi(r.miei)}</dd></div>
            <div><dt>Suoi candidati</dt><dd>{tipi(r.suoi)}</dd></div>
          </dl>
        ))}
        <p className="diag-nota">Fai uno screenshot di questa finestra e mandalo a chi ti aiuta con l’app.</p>
        <button type="button" className="principale" onClick={() => video.mostraDiagnosi(null)}>Chiudi</button>
      </div>
    </div>
  )
}
