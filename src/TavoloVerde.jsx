import { useEffect, useRef, useState } from 'react'
import Carta from './Carta'
import { fmt } from './regole'

// Posizioni in percentuale del tavolo (x sulla larghezza, y sull'altezza)
const CENTRO = { x: 50, y: 46 }
const MAZZO = { x: 37, y: 46 }
const SCARTI = { x: 63, y: 46 }
const verso = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

// Senso orario visto dall'alto: io in basso, poi a sinistra, in alto, a destra
function posizioni(n, stretto) {
  const rx = stretto ? 36 : 43
  const ry = stretto ? 42 : 41
  return Array.from({ length: n }, (_, k) => {
    const a = ((90 + (k * 360) / n) * Math.PI) / 180
    return { x: 50 + rx * Math.cos(a), y: 47 + ry * Math.sin(a) }
  })
}

// Telefono in verticale: tavolo più alto che largo
function useStretto() {
  const q = '(max-width: 639px)'
  const [stretto, setStretto] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const f = () => setStretto(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return stretto
}

const TAGLI_DISCENDENTI = [100, 50, 20, 10, 5, 1]
function pila(importo, max = 7) {
  const dischi = []
  let resto = importo
  for (const t of TAGLI_DISCENDENTI) {
    while (resto >= t && dischi.length < max) { dischi.push(t); resto -= t }
  }
  return dischi.reverse()
}

function Pila({ importo }) {
  return (
    <span className="pila" aria-hidden="true">
      {pila(importo).map((t, i) => <span key={i} className={`disco f${t}`} style={{ '--i': i }} />)}
    </span>
  )
}

const BOLLE = {
  passo: () => 'Passo', lascio: () => 'Lascio', vedo: () => 'Vedo', busso: () => 'Busso', parol: () => 'Parola',
  buio: (i) => `Buio ${i}`, controbuio: (i) => `Controbuio ${i}`, over: (i) => `Over ${i}`,
  nobuio: () => 'Niente buio', chiudo: () => 'Chiudo',
  apro: (i) => `Apro ${i}`, punto: (i) => `Punto ${i}`, rilancio: (i) => `Rilancio +${i}`,
  cambio: (i) => (i === 0 ? 'Servito' : `Cambia ${i}`), vince: (i) => `Vince ${i}`,
}

function stile(pos, extra = {}) {
  return { left: `${pos.x}%`, top: `${pos.y}%`, ...extra }
}
// Spostamento (in unità del contenitore) da un punto a un altro, per le animazioni
const delta = (da, a) => ({ '--dx': (da.x - a.x).toFixed(2), '--dy': (da.y - a.y).toFixed(2) })

export default function TavoloVerde({ mano, posti, giocatori, io, carte, scelte, onScegli, azioni, conclusa, fumetti = {} }) {
  const [fantasmi, setFantasmi] = useState([])
  const prevCambio = useRef({})
  const stretto = useStretto()

  // Gli elementi già sul tavolo all'apertura della pagina non si animano;
  // tutto quello che arriva dopo (carte, puntate, piatto) sì.
  const visti = useRef(new Set())
  const [avviato, setAvviato] = useState(false)
  const haMano = !!mano
  useEffect(() => {
    if (!haMano || avviato) return
    const t = setTimeout(() => setAvviato(true), 300)
    return () => clearTimeout(t)
  }, [haMano, avviato])
  const gia = (chiave) => {
    if (!avviato) { visti.current.add(chiave); return ' gia' }
    return visti.current.has(chiave) ? ' gia' : ''
  }

  // Quando qualcuno cambia carte, le sue carte scartate volano sugli scarti
  useEffect(() => {
    if (!mano) return
    const prima = prevCambio.current
    const nuovi = []
    for (const p of posti) {
      const chiave = `${mano.id}-${p.giocatore_id}`
      if (chiave in prima && prima[chiave] == null && p.cambio > 0) {
        nuovi.push({ id: `${chiave}-scarto`, giocatore: p.giocatore_id, n: p.cambio })
      }
      prima[chiave] = p.cambio
    }
    if (nuovi.length) setFantasmi((f) => [...f.filter((x) => x.id.startsWith(mano.id)), ...nuovi])
  }, [posti, mano])

  if (!mano) {
    return <div className="tavolo-verde vuoto"><div className="panno"><p className="invito-mano">Il mazzo è pronto.</p></div></div>
  }

  // Io in basso, gli altri in senso orario
  const ordinati = [...posti].sort((a, b) => a.posto - b.posto)
  const mioIndice = Math.max(0, ordinati.findIndex((p) => p.giocatore_id === io.id))
  const giro = [...ordinati.slice(mioIndice), ...ordinati.slice(0, mioIndice)]
  const pos = posizioni(giro.length, stretto)
  const posDi = Object.fromEntries(giro.map((p, i) => [p.giocatore_id, pos[i]]))

  const nomeDi = (id) => giocatori.find((g) => g.giocatore_id === id)?.profili?.nickname ?? 'giocatore'
  const fichesDi = (id) => giocatori.find((g) => g.giocatore_id === id)?.fiches ?? 0

  // Ultima azione di ciascuno in questa mano (le azioni arrivano dalla più recente)
  const ultima = {}
  for (const a of azioni) {
    if (a.giocatore_id && !(a.giocatore_id in ultima) && BOLLE[a.tipo]) ultima[a.giocatore_id] = BOLLE[a.tipo](a.importo)
  }

  const inGiro = posti.reduce((s, p) => s + p.versato_giro, 0)
  const alCentro = mano.piatto - inGiro
  const vincitori = mano.esito?.vincitori ?? []
  const piattoVerso = conclusa && vincitori.length === 1 && posDi[vincitori[0]]
    ? verso(CENTRO, posDi[vincitori[0]], 0.34) : CENTRO
  const mostraPiatto = mano.fase !== 'finita' || vincitori.length === 1

  return (
    <div className="tavolo-verde">
      <div className="panno" aria-label={`Tavolo: mano ${mano.numero}, piatto ${fmt(mano.piatto)}`}>
        {/* Mazzo e scarti al centro */}
        <span className="mazzetto" style={stile(MAZZO)} aria-hidden="true"><span className="dorso" /><span className="dorso" /></span>
        <span className="mazzetto scarti" style={stile(SCARTI)} aria-hidden="true">
          {mano.fase !== 'apertura' && mano.fase !== 'primo_giro' && <span className="dorso storto" />}
        </span>

        {/* Di chi è il turno */}
        {!conclusa && mano.turno != null && (() => {
          const t = posti.find((p) => p.posto === mano.turno)
          if (!t) return null
          const mio = t.giocatore_id === io.id
          return (
            <span key={`${mano.id}-${mano.fase}-${mano.turno}`} className={`turno-centro${mio ? ' mio' : ''}`} style={stile({ x: 50, y: 33 })}>
              {mio ? 'Tocca a te' : `Tocca a ${nomeDi(t.giocatore_id)}`}
            </span>
          )
        })()}

        {/* Piatto */}
        {mostraPiatto && (
          <div className={`piatto-centro${conclusa && vincitori.length === 1 ? ' al-vincitore' : ''}`} style={stile(piattoVerso)}>
            <span key={alCentro} className={`pila-grande${gia(`${mano.id}-piatto-${alCentro}`)}`}><Pila importo={Math.max(alCentro, 0)} /></span>
            <span className="cifra">{fmt(conclusa ? mano.piatto : alCentro)}</span>
          </div>
        )}

        {giro.map((p, i) => {
          const s = pos[i]
          const sonoIo = p.giocatore_id === io.id
          const fuori = p.stato === 'fuori'
          const diTurno = mano.turno === p.posto && !conclusa
          const vince = conclusa && p.vincita > 0
          const puntataPos = verso(s, CENTRO, sonoIo ? 0.42 : 0.4)
          const cartePos = sonoIo ? { x: 50, y: stretto ? 79 : 72 } : verso(s, CENTRO, stretto ? 0.3 : 0.24)
          const scoperte = conclusa && p.carte_mostrate
          const primaDelleCarte = mano.fase === 'buio'

          // Dorsi degli altri: le prime (5 − cambio) sono le vecchie, poi le nuove arrivate dal mazzo
          const nuove = Math.max(0, (p.cambio ?? 0) - p.cambio_pendente)
          const vecchie = 5 - (p.cambio ?? 0)
          const dorsi = [
            ...Array.from({ length: vecchie }, (_, k) => `v${k}`),
            ...Array.from({ length: nuove }, (_, k) => `n${k}`),
          ]

          return (
            <div key={p.giocatore_id}>
              {/* Carte */}
              {primaDelleCarte ? null : sonoIo && !scoperte ? (
                <div className={`mano-mia${fuori ? ' piegata' : ''}`} style={stile(cartePos)}>
                  {carte.map((c, k) => (
                    <span key={`${mano.id}-${c}`} className={`volo${gia(`${mano.id}-${c}`)}`} style={{ ...delta(MAZZO, cartePos), '--ritardo': `${k * giro.length * 70 + 40}ms`, '--rot': `${(k - 2) * 3}deg` }}>
                      <Carta c={c} scelta={scelte.includes(c)} onClick={onScegli ? () => onScegli(c) : undefined} />
                    </span>
                  ))}
                </div>
              ) : scoperte ? (
                <div className={`mano-scoperta${vince ? ' vincente' : ''}${sonoIo ? ' mia' : ''}${!sonoIo && s.y > 50 ? ' sopra' : ''}`} style={stile(sonoIo ? cartePos : verso(s, CENTRO, 0.36))}>
                  {p.carte_mostrate.map((c, k) => (
                    <span key={c} className={`gira${gia(`${mano.id}-g-${c}`)}`} style={{ '--ritardo': `${k * 90}ms` }}><Carta c={c} piccola={!sonoIo} /></span>
                  ))}
                  <span className="punto-mostrato">{p.punto}</span>
                </div>
              ) : (
                <div className={`mano-coperta${fuori ? ' piegata' : ''}`} style={{ ...stile(cartePos), '--ang': `${(Math.atan2(CENTRO.y - s.y, CENTRO.x - s.x) * 180) / Math.PI - 90}deg` }}>
                  {dorsi.map((k, j) => (
                    <span key={`${mano.id}-${k}`} className={`volo dorso${gia(`${mano.id}-${p.giocatore_id}-${k}`)}`}
                      style={{ ...delta(MAZZO, cartePos), '--ritardo': k.startsWith('v') ? `${j * giro.length * 70 + i * 70}ms` : `${j * 60}ms`, '--rot': `${(j - 2) * 6}deg` }} />
                  ))}
                </div>
              )}

              {/* Carte scartate che volano agli scarti */}
              {fantasmi.filter((f) => f.giocatore === p.giocatore_id).map((f) => (
                <div key={f.id} className="fantasmi" style={stile(cartePos)}>
                  {Array.from({ length: f.n }, (_, k) => (
                    <span key={k} className="dorso via" style={{ ...delta(SCARTI, cartePos), '--ritardo': `${k * 60}ms` }} />
                  ))}
                </div>
              ))}

              {/* Puntata del giro davanti al posto */}
              {p.versato_giro > 0 && !conclusa && (
                <div key={`${mano.id}-${p.giocatore_id}-${p.versato_giro}`} className={`puntata-posto${gia(`${mano.id}-${p.giocatore_id}-p${p.versato_giro}`)}`} style={{ ...stile(puntataPos), ...delta(s, puntataPos) }}>
                  <Pila importo={p.versato_giro} />
                  <span className="cifra">{p.versato_giro}</span>
                </div>
              )}

              {/* Il posto */}
              <div className={`posto-tavolo${s.x < 35 ? ' lato-sx' : s.x > 65 ? ' lato-dx' : ''}${sonoIo ? ' io' : ''}${diTurno ? ' di-turno' : ''}${fuori ? ' fuori' : ''}${vince ? ' vince' : ''}`} style={stile(s)}>
                {fumetti[p.giocatore_id] ? (
                  <span key={`chat-${fumetti[p.giocatore_id].id}`} className="bolla chat-bolla">
                    {fumetti[p.giocatore_id].testo.length > 60 ? fumetti[p.giocatore_id].testo.slice(0, 58) + '…' : fumetti[p.giocatore_id].testo}
                  </span>
                ) : ultima[p.giocatore_id] && !(conclusa && !vince && !scoperte) && (
                  <span key={`${ultima[p.giocatore_id]}-${azioni[0]?.id}`} className="bolla">{ultima[p.giocatore_id]}</span>
                )}
                <span className="avatar" aria-hidden="true">{nomeDi(p.giocatore_id).slice(0, 1).toUpperCase()}</span>
                <span className="posto-testo">
                  <span className="posto-nick">{sonoIo ? 'Tu' : nomeDi(p.giocatore_id)}</span>
                  <span className="posto-fiches">{fmt(fichesDi(p.giocatore_id))}</span>
                </span>
                {p.posto === mano.mazziere && <span className="bottone-mazziere" title="Mazziere">M</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
