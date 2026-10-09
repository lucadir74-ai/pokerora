import { useEffect, useRef } from 'react'

// Finestra che scorre da destra. Si chiude con la X, toccando fuori o con Esc.
export default function Cassetto({ aperto, onChiudi, titolo, children }) {
  const chiudiRef = useRef(null)

  useEffect(() => {
    if (!aperto) return
    chiudiRef.current?.focus()
    const tasto = (e) => { if (e.key === 'Escape') onChiudi() }
    window.addEventListener('keydown', tasto)
    return () => window.removeEventListener('keydown', tasto)
  }, [aperto, onChiudi])

  return (
    <>
      <div className={`cassetto-velo${aperto ? ' aperto' : ''}`} onClick={onChiudi} aria-hidden="true" />
      <aside className={`cassetto${aperto ? ' aperto' : ''}`} role="dialog" aria-modal="true"
        aria-label={titolo} aria-hidden={!aperto} inert={aperto ? undefined : ''}>
        <div className="cassetto-testa">
          <h2>{titolo}</h2>
          <button ref={chiudiRef} className="cassetto-chiudi" onClick={onChiudi} aria-label="Chiudi">×</button>
        </div>
        <div className="cassetto-corpo">{children}</div>
      </aside>
    </>
  )
}
