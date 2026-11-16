import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Carta from './Carta'
import { gira } from './suoni'

// Spizzata a tutto schermo.
// Le carte sono chiuse una sopra l'altra, a faccia in su: si vede solo la prima.
// Con il pollice si spinge giù la carta davanti e spunta solo l'angolo in alto di quella sotto;
// poi la successiva, e così via. Un tocco fa scendere piano una carta alla volta.
export default function Spizzata({ ordine, viste, onVedi, onChiudi, punto }) {
  const n = ordine.length
  // Quante carte sono già spuntate dietro la prima (le carte si scoprono sempre in ordine)
  const primaNascosta = ordine.findIndex((c) => !viste.has(c))
  const r = primaNascosta === -1 ? n - 1 : Math.max(0, primaNascosta - 1)
  const finito = ordine.every((c) => viste.has(c))
  const [d, setD] = useState(0)            // quanto è scesa la carta davanti verso la prossima (0…1)
  const [tengo, setTengo] = useState(false)
  const [passo, setPasso] = useState(80)   // quanta parte di carta si scopre (in pixel)
  const scena = useRef(null)
  const dito = useRef(null)
  const anim = useRef(null)

  // La prima carta si vede subito
  useEffect(() => { if (n && !viste.has(ordine[0])) onVedi(ordine[0]) }, [n])
  useEffect(() => () => cancelAnimationFrame(anim.current), [])
  useEffect(() => {
    const misura = () => {
      const c = scena.current?.querySelector('.carta-gioco')
      if (c) setPasso(Math.round(c.offsetWidth * 0.36))
    }
    misura()
    window.addEventListener('resize', misura)
    return () => window.removeEventListener('resize', misura)
  }, [])
  // Blocca lo scorrimento della pagina sotto
  useEffect(() => {
    const prima = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prima }
  }, [])

  const animaA = (fine, durata, poi) => {
    cancelAnimationFrame(anim.current)
    const da = d, t0 = performance.now()
    const passoAnim = (ora) => {
      const t = Math.min(1, (ora - t0) / durata)
      const e = 1 - (1 - t) ** 3
      setD(da + (fine - da) * e)
      if (t < 1) anim.current = requestAnimationFrame(passoAnim)
      else poi?.()
    }
    anim.current = requestAnimationFrame(passoAnim)
  }
  const scopriProssima = (durata = 650) => {
    if (finito) return
    animaA(1, durata, () => { gira(); onVedi(ordine[r + 1]); setD(0) })
  }

  const gesti = finito ? {} : {
    onPointerDown: (e) => {
      if (e.target.closest('button')) return
      cancelAnimationFrame(anim.current)
      dito.current = { y: e.clientY, d0: d, mosso: false }
      setTengo(true)
      e.currentTarget.setPointerCapture?.(e.pointerId)
    },
    onPointerMove: (e) => {
      const t = dito.current
      if (!t) return
      const dy = e.clientY - t.y
      if (Math.abs(dy) > 6) t.mosso = true
      // corsa lunga: la carta scende piano sotto il pollice
      setD(Math.min(1, Math.max(0, t.d0 + dy / (passo * 1.8))))
    },
    onPointerUp: () => {
      const t = dito.current
      dito.current = null
      setTengo(false)
      if (!t) return
      if (!t.mosso) scopriProssima()
      else if (d >= 0.55) scopriProssima(180)
      else animaA(0, 220)
    },
    onPointerCancel: () => { dito.current = null; setTengo(false); animaA(0, 220) },
  }

  return createPortal(
    <div className="spizzata" role="dialog" aria-modal="true" aria-label="Spizza le tue carte" {...gesti}
      onClick={(e) => e.stopPropagation()}>
      <button type="button" className="spizzata-chiudi" onClick={onChiudi} aria-label="Torna al tavolo">✕</button>

      <p className="spizzata-aiuto" aria-live="polite">
        {finito ? 'Hai visto tutte le carte' : r === 0 && d === 0
          ? 'Spingi giù la carta con il pollice per vedere l’angolo della prossima'
          : `Carta ${Math.min(r + 2, n)} di ${n}`}
      </p>

      <div className={`spizzata-scena${tengo ? ' tengo' : ''}`} ref={scena}
        style={{ '--passo': `${passo}px`, height: `calc(var(--w) * 1.4 + ${(n - 1) * passo}px)` }}>
        {ordine.map((c, i) => {
          // Le carte già spuntate scendono a scaletta; quella davanti è la più bassa.
          // Le altre restano esattamente dietro, nascoste.
          const y = i <= r ? (r - i + d) * passo : 0
          return (
            <span key={c} className="spizzata-carta" style={{ zIndex: 20 - i, transform: `translate(-50%, ${y}px)` }}
              aria-hidden={!viste.has(c)}>
              <Carta c={c} indice />
            </span>
          )
        })}
      </div>

      <div className="spizzata-piede">
        {finito ? (
          <>
            <p className="spizzata-punto">{punto}</p>
            <button type="button" className="principale" onClick={onChiudi}>Fatto, torna al tavolo</button>
          </>
        ) : (
          <button type="button" className="spizzata-tutte" onClick={() => { gira(); onVedi(ordine) }}>
            Scopri tutte subito
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}
