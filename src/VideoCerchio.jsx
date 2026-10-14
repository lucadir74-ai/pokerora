import { useCallback, useEffect, useRef, useState } from 'react'

// Il video di un giocatore in un cerchio (muto: l'audio passa da AudioRemoti)
export function VideoCerchio({ stream, specchio = false, className = '', titolo }) {
  const ref = useRef(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (v.srcObject !== stream) v.srcObject = stream ?? null
    v.play?.().catch(() => {})
  }, [stream])
  return (
    <video ref={ref} className={`video-cerchio${specchio ? ' specchio' : ''} ${className}`} autoPlay playsInline muted
      aria-label={titolo} />
  )
}

// L'audio degli altri giocatori. Se il browser blocca l'audio automatico, compare un tasto per sbloccarlo.
export function AudioRemoti({ flussi, stati }) {
  const [bloccato, setBloccato] = useState(false)
  const [prova, setProva] = useState(0)
  const blocca = useCallback(() => setBloccato(true), [])
  const ids = Object.keys(flussi).filter((id) => stati[id]?.mic)
  return (
    <>
      {ids.map((id) => (
        <AudioUno key={id} stream={flussi[id]} prova={prova} onBloccato={blocca} />
      ))}
      {bloccato && ids.length > 0 && (
        <button type="button" className="sblocca-audio" onClick={() => { setBloccato(false); setProva((n) => n + 1) }}>
          🔈 Tocca per sentire gli altri
        </button>
      )}
    </>
  )
}

function AudioUno({ stream, prova, onBloccato }) {
  const ref = useRef(null)
  useEffect(() => {
    const a = ref.current
    if (!a) return
    if (a.srcObject !== stream) a.srcObject = stream
    a.play?.().catch(() => onBloccato())
  }, [stream, prova, onBloccato])
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
