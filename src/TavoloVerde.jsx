import { useEffect, useRef, useState } from 'react'
import Carta from './Carta'
import { fmt } from './regole'
import { valutaMano, nomePunto, puoAprire } from './punti'
import { gira } from './suoni'

// Una mia carta ancora coperta: si guarda toccandola o trascinando il dorso verso l'alto
function Spizza({ c, onVedi }) {
  const [alza, setAlza] = useState(0)
  const [tengo, setTengo] = useState(false)
  const inizio = useRef(null)
  const ref = useRef(null)
  const scopri = () => { gira(); onVedi() }
  return (
    <span ref={ref} className={`spizza${tengo ? '' : ' mollata'}`} role="button" tabIndex={0}
      aria-label="Carta coperta: tocca o trascina in su per guardarla"
      onPointerDown={(e) => {
        inizio.current = { y: e.clientY, mosso: false }
        setTengo(true)
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }}
      onPointerMove={(e) => {
        const i = inizio.current
        if (!i) return
        const d = i.y - e.clientY
        if (Math.abs(d) > 6) i.mosso = true
        setAlza(Math.min(1, Math.max(0, d / (ref.current?.offsetHeight || 80))))
      }}
      onPointerUp={() => {
        const i = inizio.current
        inizio.current = null
        setTengo(false)
        if (i && (!i.mosso || alza > 0.45)) scopri()
        setAlza(0)
      }}
      onPointerCancel={() => { inizio.current = null; setTengo(false); setAlza(0) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scopri() } }}>
      <span aria-hidden="true"><Carta c={c} /></span>
      <span className="copertura" style={{ transform: `translateY(${(-alza * 100).toFixed(1)}%)` }} />
    </span>
  )
}

// Carte già guardate in questa mano (restano scoperte anche se ricarichi la pagina)
function useViste(idMano) {
  const chiave = `pokerora_viste_${idMano}`
  const leggi = () => {
    try { return new Set(JSON.parse(sessionStorage.getItem(chiave) || '[]')) } catch { return new Set() }
  }
  const [viste, setViste] = useState(leggi)
  useEffect(() => { setViste(leggi()) }, [idMano])
  const salva = (nuove) => {
    try { sessionStorage.setItem(chiave, JSON.stringify([...nuove])) } catch {}
    return nuove
  }
  const vedi = (cc) => setViste((v) => salva(new Set([...v, ...[].concat(cc)])))
  return [viste, vedi]
}

// Posizioni in percentuale del tavolo (x sulla larghezza, y sull'altezza)
const CENTRO = { x: 50, y: 48 }
const MAZZO = { x: 36, y: 48 }
const SCARTI = { x: 64, y: 48 }
const verso = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

// Senso orario visto dall'alto: io in basso, poi a sinistra, in alto, a destra
function posizioni(n, stretto) {
  const rx = stretto ? 40 : 45
  const ry = stretto ? 44 : 45
  return Array.from({ length: n }, (_, k) => {
    const a = ((90 + (k * 360) / n) * Math.PI) / 180
    const x = 50 + rx * Math.cos(a)
    const y = 50 + ry * Math.sin(a)
    // Telefono: i posti laterali bassi salgono un po', per non coprire le mie carte
    return { x, y: stretto && (x < 20 || x > 80) && y > 62 ? 64 : y }
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

// ── Prospettiva disegnata ──
// Il tavolo è descritto "dall'alto" (x, y da 0 a 100) e proiettato sullo schermo:
// in fondo (y piccolo) è più stretto e gli oggetti sono un po' più piccoli.
const PROSPETTIVA = {
  largo: { fondo: 0.74, alto: 7, altezza: 84 },
  stretto: { fondo: 0.84, alto: 5, altezza: 88 },
}
function proietta(p, stretto) {
  const k = PROSPETTIVA[stretto ? 'stretto' : 'largo']
  const t = Math.min(Math.max(p.y, 0), 100) / 100
  const d = k.fondo + (1 - k.fondo) * t
  return { x: 50 + (p.x - 50) * d, y: k.alto + p.y * (k.altezza / 100), s: Math.pow(d, 0.9) }
}

// Contorno di un'ellisse del tavolo, proiettato, come percorso SVG
function ellisse(cx, cy, rx, ry, stretto, dy = 0) {
  const punti = Array.from({ length: 73 }, (_, i) => {
    const a = (i / 72) * Math.PI * 2
    const q = proietta({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }, stretto)
    return `${q.x.toFixed(2)},${(q.y + dy).toFixed(2)}`
  })
  return `M${punti.join('L')}Z`
}

function Fondo({ stretto }) {
  // Proporzioni del tavolo (larghezza / altezza): servono perché la trama del panno resti quadrata
  const rapporto = stretto ? 3 / 4.2 : 16 / 10.5
  const lato = stretto ? 34 : 22
  const bordo = ellisse(50, 50, 49, 49, stretto)
  const spessore = ellisse(50, 50, 49, 49, stretto, stretto ? 2.2 : 3.2)
  const panno = ellisse(50, 50, 43.5, 42.5, stretto)
  const filo = ellisse(50, 50, 42.3, 41.3, stretto)
  const linea = ellisse(50, 49, 29, 27, stretto)
  return (
    <svg className="fondo" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <radialGradient id="g-pelle" cx="50%" cy="20%" r="80%">
          <stop offset="0%" stopColor="#5a3826" />
          <stop offset="55%" stopColor="#38200f" />
          <stop offset="100%" stopColor="#1b0d06" />
        </radialGradient>
        <linearGradient id="g-legno" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a160b" />
          <stop offset="100%" stopColor="#0b0503" />
        </linearGradient>
        <radialGradient id="g-panno" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor="#3a9a6b" />
          <stop offset="45%" stopColor="#21724b" />
          <stop offset="85%" stopColor="#144a33" />
          <stop offset="100%" stopColor="#0c3121" />
        </radialGradient>
        <pattern id="p-panno" patternUnits="userSpaceOnUse" width={lato} height={lato * rapporto}>
          <image href="/img/panno.webp" width={lato} height={lato * rapporto} preserveAspectRatio="none" />
        </pattern>
        <pattern id="p-pelle" patternUnits="userSpaceOnUse" width={lato} height={lato * rapporto}>
          <image href="/img/pelle.webp" width={lato} height={lato * rapporto} preserveAspectRatio="none" />
        </pattern>
        <radialGradient id="g-luce" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="40%" stopColor="#fff" stopOpacity="0" />
          <stop offset="80%" stopColor="#000" stopOpacity="0.30" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
        <filter id="f-ombra" x="-20%" y="-20%" width="140%" height="160%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <path d={spessore} transform="translate(0 2.5)" fill="rgba(0,0,0,0.55)" filter="url(#f-ombra)" />
      <path d={spessore} fill="url(#g-legno)" />
      <path d={bordo} fill="url(#p-pelle)" />
      <path d={bordo} fill="url(#g-pelle)" opacity="0.45" />
      <path d={bordo} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      <path d={panno} fill="url(#g-panno)" />
      <path d={panno} fill="url(#p-panno)" />
      <path d={panno} fill="#0e5a3c" fillOpacity="0.28" />
      <path d={panno} fill="url(#g-luce)" />
      <path d={panno} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="6" vectorEffect="non-scaling-stroke" />
      <path d={filo} fill="none" stroke="#c9a227" strokeOpacity="0.8" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <path d={linea} fill="none" stroke="rgba(242,215,122,0.25)" strokeWidth="1" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export default function TavoloVerde({ mano, posti, giocatori, io, carte, scelte, onScegli, azioni, conclusa, fumetti = {} }) {
  const [fantasmi, setFantasmi] = useState([])
  const [viste, vedi] = useViste(mano?.id)
  const prevCambio = useRef({})
  const stretto = useStretto()
  const stile = (pos, extra = {}) => {
    const q = proietta(pos, stretto)
    return { left: `${q.x}%`, top: `${q.y}%`, '--s': q.s.toFixed(3), ...extra }
  }
  // Spostamento sullo schermo da un punto all'altro (per le animazioni)
  const delta = (da, a) => {
    const p = proietta(da, stretto), q = proietta(a, stretto)
    return { '--dx': (p.x - q.x).toFixed(2), '--dy': (p.y - q.y).toFixed(2) }
  }

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
    return (
      <div className="scena">
        <div className="tavolo-verde vuoto"><Fondo stretto={stretto} /><div className="panno"><p className="invito-mano">Il mazzo è pronto.</p></div></div>
      </div>
    )
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
    ? verso(CENTRO, posDi[vincitori[0]], stretto ? 0.18 : 0.34) : CENTRO
  const mostraPiatto = mano.fase !== 'finita' || vincitori.length === 1

  return (
    <div className="scena">
    <div className="tavolo-verde">
      <Fondo stretto={stretto} />
      <div className="panno" aria-label={`Tavolo: mano ${mano.numero}, piatto ${fmt(mano.piatto)}`}>
        {/* Mazzo e scarti al centro */}
        <span className="mazzetto" style={stile(MAZZO)} aria-hidden="true"><span className="dorso" /><span className="dorso" /></span>
        <span className="mazzetto scarti" style={stile(SCARTI)} aria-hidden="true">
          {mano.fase !== 'apertura' && mano.fase !== 'primo_giro' && <span className="dorso storto" />}
        </span>

        {/* Di chi è il turno */}
        {/* Sul telefono a 5-6 giocatori lo dice già la barra dei comandi e il posto illuminato */}
        {!conclusa && mano.turno != null && !(stretto && giro.length >= 5) && (() => {
          const t = posti.find((p) => p.posto === mano.turno)
          if (!t) return null
          const mio = t.giocatore_id === io.id
          return (
            <span key={`${mano.id}-${mano.fase}-${mano.turno}`} className={`turno-centro${mio ? ' mio' : ''}`} style={stile({ x: 50, y: 32 })}>
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
          // Telefono in verticale: i posti laterali stanno attaccati al bordo dello schermo,
          // le loro carte vanno sopra o sotto il posto (verso il centro), la puntata dall'altro lato
          const bordo = stretto && !sonoIo && (s.x < 20 || s.x > 80)
          const sx = s.x < 50
          const dir = s.y > 55 ? -1 : 1
          const puntataPos = bordo ? { x: sx ? 18 : 82, y: s.y - dir * (dir < 0 ? 14 : 11) } : verso(s, CENTRO, sonoIo ? 0.42 : 0.4)
          const cartePos = sonoIo ? { x: 50, y: stretto ? (conclusa && p.carte_mostrate ? 72 : 75) : 74 }
            : bordo ? { x: sx ? 26 : 74, y: s.y + dir * (dir < 0 ? 13 : 11) }
            : verso(s, CENTRO, stretto ? 0.3 : 0.24)
          const sopra = bordo ? dir < 0 : s.y > 50
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
            <div key={p.giocatore_id} className="posto-gruppo">
              {/* Carte */}
              {primaDelleCarte ? null : sonoIo && !scoperte ? (
                <div className={`mano-mia${fuori ? ' piegata' : ''}`} style={stile(cartePos)}>
                  {carte.map((c, k) => (
                    <span key={`${mano.id}-${c}`} className={`volo${gia(`${mano.id}-${c}`)}`} style={{ ...delta(MAZZO, cartePos), '--ritardo': `${k * giro.length * 70 + 40}ms`, '--rot': `${(k - 2) * 3}deg` }}>
                      {viste.has(c) || fuori
                        ? <Carta c={c} scelta={scelte.includes(c)} onClick={onScegli ? () => onScegli(c) : undefined} />
                        : <Spizza c={c} onVedi={() => vedi(c)} />}
                    </span>
                  ))}
                  {carte.length === 5 && !fuori && carte.some((c) => !viste.has(c)) && (
                    <button type="button" className="mio-punto scopri-tutte" onClick={() => { gira(); vedi(carte) }}>
                      Spizza le carte · scopri tutte
                    </button>
                  )}
                  {carte.length === 5 && !fuori && carte.every((c) => viste.has(c)) && (
                    <span className="mio-punto">
                      {nomePunto(valutaMano(carte, mano.bassa))}
                      {mano.fase === 'apertura' && (puoAprire(carte, mano.requisito, mano.bassa)
                        ? <b className="si"> · puoi aprire</b> : <b className="no"> · non puoi aprire</b>)}
                    </span>
                  )}
                </div>
              ) : scoperte ? (
                <div className={`mano-scoperta${vince ? ' vincente' : ''}${sonoIo ? ' mia' : ''}${!sonoIo && sopra ? ' sopra' : ''}`} style={stile(sonoIo || bordo ? cartePos : verso(s, CENTRO, 0.36))}>
                  {p.carte_mostrate.map((c, k) => (
                    <span key={c} className={`gira${gia(`${mano.id}-g-${c}`)}`} style={{ '--ritardo': `${k * 90}ms` }}><Carta c={c} piccola={!sonoIo} /></span>
                  ))}
                  <span className="punto-mostrato">{p.punto}</span>
                </div>
              ) : (
                <div className={`mano-coperta${fuori ? ' piegata' : ''}`} style={{ ...stile(cartePos), '--ang': bordo ? '0deg' : `${(Math.atan2(CENTRO.y - s.y, CENTRO.x - s.x) * 180) / Math.PI - 90}deg` }}>
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
              <div className={`posto-tavolo${s.x < 35 ? ' lato-sx' : s.x > 65 ? ' lato-dx' : ''}${bordo ? (sx ? ' bordo-sx' : ' bordo-dx') : ''}${sonoIo ? ' io' : ''}${diTurno ? ' di-turno' : ''}${fuori ? ' fuori' : ''}${vince ? ' vince' : ''}`} style={stile(s)}>
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
    </div>
  )
}
