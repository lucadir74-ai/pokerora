import { useState } from 'react'
import { mescola } from './suoni'

// Copertina d'apertura: si vede una volta per sessione, solo entrando dalla home
const CHIAVE = 'pokerora_copertina'

export function mostraCopertina() {
  try { if (sessionStorage.getItem(CHIAVE)) return false } catch {}
  const h = window.location.hash || ''
  // Niente copertina se arrivi da un link (invito, tavolo) o dal link per la password
  if (/access_token|type=recovery|error=/.test(h)) return false
  const [, pagina = ''] = (h || '#/').slice(1).split('/')
  return pagina === ''
}

// Scala reale massima di cuori, aperta a ventaglio
const CARTE = [
  { v: '10', s: '♥' }, { v: 'J', s: '♥' }, { v: 'Q', s: '♥' }, { v: 'K', s: '♥' }, { v: 'A', s: '♥' },
]
// Pile di fiches: colore, quante, posizione
const PILE = [
  { c: 'f5', n: 7, x: -34 }, { c: 'f100', n: 10, x: 0 }, { c: 'f10', n: 5, x: 34 },
]

export default function Copertina({ onEntra }) {
  const [esco, setEsco] = useState(false)

  function entra() {
    if (esco) return
    try { sessionStorage.setItem(CHIAVE, '1') } catch {}
    mescola()
    setEsco(true)
    setTimeout(onEntra, 450)
  }

  return (
    <main className={`copertina${esco ? ' esce' : ''}`}>
      <div className="cop-luce" aria-hidden="true" />

      <header className="cop-testa">
        <p className="cop-semi" aria-hidden="true">♠ ♥ ♦ ♣</p>
        <h1 className="cop-logo">Poker<span>Ora</span></h1>
        <p className="cop-motto">Poker all’italiana, al tavolo con gli amici</p>
      </header>

      <div className="cop-scena" aria-hidden="true">
        <div className="cop-ventaglio">
          {CARTE.map((c, i) => (
            <span key={c.v} className="cop-carta" style={{ '--i': i, '--a': `${(i - 2) * 13}deg` }}>
              <span className="cop-indice">{c.v}<br />{c.s}</span>
              <span className="cop-centro">{c.v === 'A' ? '♥' : c.v}</span>
              <span className="cop-indice basso">{c.v}<br />{c.s}</span>
            </span>
          ))}
        </div>
        <div className="cop-pile">
          {PILE.map((p, k) => (
            <span key={p.c} className="cop-pila" style={{ '--x': p.x, '--k': k }}>
              {Array.from({ length: p.n }, (_, i) => (
                <span key={i} className={`cop-disco ${p.c}`} style={{ '--i': i }} />
              ))}
            </span>
          ))}
          <span className="cop-gettone f100" style={{ '--k': 3 }}><span>100</span></span>
        </div>
      </div>

      <footer className="cop-piede">
        <button className="cop-entra" onClick={entra}>Entra</button>
        <p className="cop-nota">Si gioca in Vardis, non con soldi veri</p>
      </footer>
    </main>
  )
}
