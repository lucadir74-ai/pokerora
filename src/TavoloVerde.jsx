import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { VideoCerchio, TastiMedia } from './VideoCerchio'
import Carta from './Carta'
import { fmt } from './regole'
import { valutaMano, nomePunto, puoAprire } from './punti'
import Spizzata from './Spizzata'
import { EMOTICON } from './emoticon'
import { spizzataAttiva, ascoltaSpizzata } from './preferenze'

// Spizzata: le mie carte arrivano chiuse una sopra l'altra, a faccia in su.
// Si spizzano a tutto schermo, una carta alla volta (vedi Spizzata.jsx).
// Ordine: la prima è quella davanti; le carte nuove dopo il cambio finiscono dietro.
function useSpizzata(idMano, carte) {
  const chiave = `pokerora_spizza_${idMano}`
  const leggi = () => {
    try { return JSON.parse(sessionStorage.getItem(chiave) || 'null') || { ordine: [], viste: [] } }
    catch { return { ordine: [], viste: [] } }
  }
  const [salvato, setSalvato] = useState(leggi)
  useEffect(() => { setSalvato(leggi()) }, [idMano])
  const unisci = (base) => [...(base.ordine || []).filter((c) => carte.includes(c)), ...carte.filter((c) => !(base.ordine || []).includes(c))]
  const ordine = unisci(salvato)
  const viste = new Set((salvato.viste || []).filter((c) => carte.includes(c)))
  const aperto = carte.length > 0 && carte.every((c) => viste.has(c))
  const vedi = (cc) => setSalvato((prima) => {
    const nuovo = { ordine: unisci(prima), viste: [...new Set([...(prima.viste || []), ...[].concat(cc)])] }
    try { sessionStorage.setItem(chiave, JSON.stringify(nuovo)) } catch {}
    return nuovo
  })
  return { ordine, viste, aperto, vedi }
}

// Tasto delle emoticon nell'angolo del tavolo: si apre la tavolozza, un tocco e l'emoticon
// compare sopra il tuo posto per tutti
function Emoticon({ onReagisci }) {
  const [aperta, setAperta] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!aperta) return
    const fuori = (e) => { if (!ref.current?.contains(e.target)) setAperta(false) }
    const esc = (e) => { if (e.key === 'Escape') setAperta(false) }
    document.addEventListener('pointerdown', fuori)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', fuori); document.removeEventListener('keydown', esc) }
  }, [aperta])
  return (
    <div className="emoticon" ref={ref}>
      {aperta && (
        <div className="emoticon-tavolozza" role="menu" aria-label="Commenta con un’emoticon">
          {EMOTICON.map((x) => (
            <button key={x.e} type="button" role="menuitem" title={x.nome} aria-label={x.nome}
              onClick={() => { onReagisci(x.e); setAperta(false) }}>{x.e}</button>
          ))}
        </div>
      )}
      <button type="button" className="emoticon-tasto" aria-expanded={aperta} aria-label="Emoticon"
        onClick={() => setAperta((a) => !a)}>😀</button>
    </div>
  )
}

// Posizioni in percentuale del tavolo (x sulla larghezza, y sull'altezza)
const CENTRO = { x: 50, y: 48 }
const MAZZO = { x: 36, y: 48 }
const SCARTI = { x: 64, y: 48 }
const verso = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

// Senso orario visto dall'alto: io in basso, poi a sinistra, in alto, a destra
function posizioni(n, stretto, pov = false) {
  const rx = stretto ? 40 : 45
  const ry = stretto ? 44 : 45
  // Prima persona: il mio posto non è sul tavolo, quindi gli altri si distribuiscono su tutto l'arco
  // da sinistra a destra passando per l'alto; i laterali scendono un po' e usano lo spazio in basso
  if (pov) {
    const m = n - 1
    const da = stretto ? 162 : 168, a_ = stretto ? 378 : 372
    const cy = stretto ? 47 : 50
    return [{ x: 50, y: 95 }, ...Array.from({ length: m }, (_, k) => {
      const g = ((da + (k * (a_ - da)) / Math.max(1, m - 1)) * Math.PI) / 180
      return { x: 50 + rx * Math.cos(g), y: cy + (stretto ? 41 : ry) * Math.sin(g) }
    })]
  }
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

// Telefono e tablet: visuale in prima persona. Le mie carte e il mio posto non stanno sul tavolo
// ma davanti, nella barra in basso insieme ai tasti; sul tavolo restano gli altri e la mia puntata.
function usePov() {
  const q = '(max-width: 959px)'
  const [pov, setPov] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const f = () => setPov(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return pov
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
  largo: { fondo: 1, alto: 7, altezza: 84 },   // computer: ovale regolare, senza prospettiva
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

export default function TavoloVerde({ mano, posti, giocatori, io, carte, scelte, onScegli, azioni, conclusa, fumetti = {}, reazioni = {}, onReagisci, povEl = null, video = null }) {
  const [fantasmi, setFantasmi] = useState([])
  // ── Spizzata delle mie carte ──
  const { ordine, viste, aperto, vedi } = useSpizzata(mano?.id, carte)
  const [spizzo, setSpizzo] = useState(false)
  const [conSpizzata, setConSpizzata] = useState(spizzataAttiva())   // spizzata facoltativa
  useEffect(() => ascoltaSpizzata(setConSpizzata), [])
  const [passoCarte, setPassoCarte] = useState(0)      // distanza tra due carte aperte, in pixel
  const manoRef = useRef(null)
  useEffect(() => { setSpizzo(false) }, [mano?.id])
  useLayoutEffect(() => {
    const misura = () => {
      const v = manoRef.current?.querySelectorAll(':scope > .volo')
      if (v && v.length > 1) setPassoCarte(v[1].offsetLeft - v[0].offsetLeft)
    }
    misura()
    window.addEventListener('resize', misura)
    return () => window.removeEventListener('resize', misura)
  }, [carte.length, mano?.id])
  const prevCambio = useRef({})
  const stretto = useStretto()
  const pov = usePov() && !!povEl
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

  // Le mie carte: sul tavolo (computer) o davanti a me nella barra in basso (telefono)
  const manoMia = (cartePos, fuori, nGiro) => {
                  const chiuse = conSpizzata && carte.length === 5 && !fuori && !aperto
                  const ap = chiuse ? 0 : 1
                  const punto = carte.length === 5 ? nomePunto(valutaMano(carte, mano.bassa)) : ''
                  return (
                <div ref={manoRef} className={`mano-mia${fuori ? ' piegata' : ''}${chiuse ? ' chiuse' : ''}`}
                  style={cartePos ? stile(cartePos) : undefined} onClick={chiuse ? () => setSpizzo(true) : undefined}
                  onKeyDown={chiuse ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSpizzo(true) } } : undefined}
                  role={chiuse ? 'button' : undefined} tabIndex={chiuse ? 0 : undefined}
                  aria-label={chiuse ? 'Le tue carte sono chiuse: tocca per spizzarle' : undefined}>
                  {ordine.map((c, k) => (
                    <span key={`${mano.id}-${c}`} className={`volo${gia(`${mano.id}-${c}`)}`}
                      style={{ ...(cartePos ? delta(MAZZO, cartePos) : { '--dx': 0, '--dy': -14 }), '--ritardo': `${k * nGiro * 70 + 40}ms`, '--rot': `${(k - 2) * 3 * ap}deg`, zIndex: 10 - k }}>
                      <span className="strato" style={{ transform: `translate(${((2 - k) * passoCarte + (k - 2) * -2) * (1 - ap)}px, ${chiuse ? (4 - k) * -1.5 : Math.abs(k - 2) * 2}px)` }}>
                        <Carta c={c} indice scelta={scelte.includes(c)}
                          onClick={onScegli && !chiuse ? () => onScegli(c) : undefined} />
                      </span>
                    </span>
                  ))}
                  {chiuse && (
                    <span className="mio-punto spizza-aiuto" aria-hidden="true">Tocca per spizzare</span>
                  )}
                  {spizzo && conSpizzata && carte.length === 5 && !fuori && (
                    <Spizzata ordine={ordine} viste={viste} onVedi={vedi} punto={punto}
                      onChiudi={() => setSpizzo(false)} />
                  )}
                  {carte.length === 5 && !fuori && !chiuse && (
                    <span className="mio-punto">
                      {nomePunto(valutaMano(carte, mano.bassa))}
                      {mano.fase === 'apertura' && (puoAprire(carte, mano.requisito, mano.bassa)
                        ? <b className="si"> · puoi aprire</b> : <b className="no"> · non puoi aprire</b>)}
                    </span>
                  )}
                </div>
                  )
  }

  // Io in basso, gli altri in senso orario
  const ordinati = [...posti].sort((a, b) => a.posto - b.posto)
  const mioIndice = Math.max(0, ordinati.findIndex((p) => p.giocatore_id === io.id))
  const giro = [...ordinati.slice(mioIndice), ...ordinati.slice(0, mioIndice)]
  const pos = posizioni(giro.length, stretto, pov)
  const posDi = Object.fromEntries(giro.map((p, i) => [p.giocatore_id, pos[i]]))
  const pIo = posti.find((p) => p.giocatore_id === io.id)

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
    ? verso(CENTRO, posDi[vincitori[0]], stretto ? 0 : 0.12) : CENTRO
  const mostraPiatto = mano.fase !== 'finita' || vincitori.length === 1

  return (
    <div className="scena">
      {onReagisci && <Emoticon onReagisci={onReagisci} />}
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
        {/* Sul telefono lo dice già la barra dei comandi in basso, e il posto di turno è illuminato */}
        {!conclusa && mano.turno != null && !stretto && (() => {
          const t = posti.find((p) => p.posto === mano.turno)
          if (!t) return null
          const mio = t.giocatore_id === io.id
          return (
            <span key={`${mano.id}-${mano.fase}-${mano.turno}`} className={`turno-centro${mio ? ' mio' : ''}`}>
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
          // Computer: carte e puntate più verso il centro, così non finiscono sotto i nomi (ora più grandi)
          const puntataPos = bordo ? { x: sx ? 18 : 82, y: s.y - dir * (dir < 0 ? 14 : 11) }
            : verso(s, CENTRO, sonoIo ? (stretto ? 0.42 : 0.5) : (stretto ? 0.4 : 0.52))
          const cartePos = sonoIo ? { x: 50, y: stretto ? (conclusa && p.carte_mostrate ? 72 : 75) : 69 }
            : bordo ? { x: sx ? 26 : 74, y: s.y + dir * (dir < 0 ? 13 : 11) }
            : verso(s, CENTRO, stretto ? 0.3 : 0.36)
          // Fumetto sotto il nome: posti in basso sul computer, e laterali con le carte sopra in prima persona
          const basso = (!stretto && !sonoIo && s.y > 60) || (pov && bordo && dir < 0)
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
              {/* Carte (in prima persona le mie stanno nella barra in basso) */}
              {primaDelleCarte || (pov && sonoIo) ? null : sonoIo && !scoperte ? (
                manoMia(cartePos, fuori, giro.length)
              ) : scoperte ? (
                <div className={`mano-scoperta${vince ? ' vincente' : ''}${sonoIo ? ' mia' : ''}${sonoIo || sopra ? ' sopra' : ''}`} style={stile(sonoIo || bordo ? cartePos : stretto ? verso(s, CENTRO, 0.36) : basso ? { x: s.x + (50 - s.x) * 0.3, y: s.y - 18 } : verso(s, CENTRO, 0.4))}>
                  {p.carte_mostrate.map((c, k) => (
                    <span key={c} className={`gira${gia(`${mano.id}-g-${c}`)}`} style={{ '--ritardo': `${k * 90}ms` }}><Carta c={c} piccola={!sonoIo} /></span>
                  ))}
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
              {!(pov && sonoIo) && fantasmi.filter((f) => f.giocatore === p.giocatore_id).map((f) => (
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

              {/* Il posto (in prima persona il mio è nella barra in basso) */}
              {!(pov && sonoIo) && (
              <div className={`posto-tavolo${s.x < 35 ? ' lato-sx' : s.x > 65 ? ' lato-dx' : ''}${bordo ? (sx ? ' bordo-sx' : ' bordo-dx') : ''}${sonoIo ? ' io' : ''}${diTurno ? ' di-turno' : ''}${fuori ? ' fuori' : ''}${vince ? ' vince' : ''}${basso ? ' basso' : ''}`} style={stile(s)}>
                {fumetti[p.giocatore_id] ? (
                  <span key={`chat-${fumetti[p.giocatore_id].id}`} className="bolla chat-bolla">
                    {fumetti[p.giocatore_id].testo.length > 60 ? fumetti[p.giocatore_id].testo.slice(0, 58) + '…' : fumetti[p.giocatore_id].testo}
                  </span>
                ) : conclusa && p.carte_mostrate && p.punto ? (
                  // A fine mano il fumetto mostra il punto (e quanto vince), grande e leggibile
                  <span className={`bolla bolla-punto${vince ? ' vincente' : ''}`}>
                    {p.punto}{vince && p.vincita > 0 ? ` · vince ${fmt(p.vincita)}` : ''}
                  </span>
                ) : ultima[p.giocatore_id] && !(conclusa && !vince && !scoperte) && (
                  <span key={`${ultima[p.giocatore_id]}-${azioni[0]?.id}`} className="bolla">{ultima[p.giocatore_id]}</span>
                )}
                {reazioni[p.giocatore_id] && (
                  <span key={reazioni[p.giocatore_id].id} className="reazione" role="img"
                    aria-label={`${nomeDi(p.giocatore_id)}: ${EMOTICON.find((x) => x.e === reazioni[p.giocatore_id].e)?.nome ?? ''}`}>
                    {reazioni[p.giocatore_id].e}
                  </span>
                )}
                {video?.stati[p.giocatore_id]?.cam && video.flussi[p.giocatore_id]
                  ? <VideoCerchio stream={video.flussi[p.giocatore_id]} className="avatar avatar-video" titolo={`Video di ${nomeDi(p.giocatore_id)}`} />
                  : <span className="avatar" aria-hidden="true">{nomeDi(p.giocatore_id).slice(0, 1).toUpperCase()}</span>}
                {video?.stati[p.giocatore_id]?.mic && <span className="mic-acceso" title="Microfono acceso" aria-label="Microfono acceso">🎤</span>}
                {(() => {
                  // Diagnosi: se qualcuno ha video o audio acceso ma il collegamento con questo giocatore non c'è
                  const st = video?.stati[p.giocatore_id]
                  if (!st || st.collegato || !(st.cam || st.mic || video.cam || video.mic)) return null
                  const fallito = st.stato === 'failed' || st.stato === 'disconnected'
                  return (
                    <button type="button" className={`collegamento-video${fallito ? ' fallito' : ''}`}
                      onClick={() => video.mostraDiagnosi(p.giocatore_id)}
                      title={fallito ? 'Collegamento video non riuscito: tocca per i dettagli' : 'Collegamento video in corso: tocca per i dettagli'}>
                      {fallito ? '📡✕' : '📡…'}
                    </button>
                  )
                })()}
                <span className="posto-testo">
                  <span className="posto-nick">{sonoIo ? 'Tu' : nomeDi(p.giocatore_id)}</span>
                  <span className="posto-fiches">{fmt(fichesDi(p.giocatore_id))}</span>
                  {/* Quante carte ha cambiato: resta visibile fino alla fine della mano */}
                  {p.tutto_dentro && p.stato === 'attivo' && <span className="posto-cambio tutto-dentro">Tutto dentro</span>}
                  {p.cambio != null && p.stato === 'attivo' && (
                    <span className="posto-cambio">{p.cambio === 0 ? 'Servito' : p.cambio === 1 ? 'Cambia 1 carta' : `Cambia ${p.cambio} carte`}</span>
                  )}
                </span>
                {p.posto === mano.mazziere && <span className="bottone-mazziere" title="Mazziere">M</span>}
              </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
    {pov && pIo && createPortal(
      <div className={`pov-dentro${mano.turno === pIo.posto && !conclusa ? ' di-turno' : ''}${pIo.stato === 'fuori' ? ' fuori' : ''}`}>
        <div className="pov-carte">
          {mano.fase === 'buio' ? (
            <span className="pov-attesa">Le carte arrivano dopo il buio</span>
          ) : conclusa && pIo.carte_mostrate ? (
            <div className={`mano-scoperta mia${pIo.vincita > 0 ? ' vincente' : ''}`}>
              {pIo.carte_mostrate.map((c, k) => (
                <span key={c} className={`gira${gia(`${mano.id}-g-${c}`)}`} style={{ '--ritardo': `${k * 90}ms` }}><Carta c={c} /></span>
              ))}
              {pIo.punto && <span className="mio-punto">{pIo.punto}{pIo.vincita > 0 ? ` · vinci ${fmt(pIo.vincita)}` : ''}</span>}
            </div>
          ) : manoMia(null, pIo.stato === 'fuori', giro.length)}
        </div>
        <div className="pov-io">
          {mano.turno === pIo.posto && !conclusa && (
            <span className="pov-tocca">{mano.fase === 'cambio' ? 'Tocca a te: scegli le carte' : 'Tocca a te'}</span>
          )}
          {video?.cam && video.locale
            ? <VideoCerchio stream={video.locale} specchio className="avatar avatar-video" titolo="Il tuo video" />
            : <span className="avatar" aria-hidden="true">{nomeDi(io.id).slice(0, 1).toUpperCase()}</span>}
          <span className="pov-nick">{nomeDi(io.id)}</span>
          <span className="pov-fiches">{fmt(fichesDi(io.id))}</span>
          {(() => {
            const n = giocatori.find((g) => g.giocatore_id === io.id)?.poste_in_arrivo ?? 0
            return n > 0 && <span className="pov-arrivo" title="Le fiches arrivano a fine mano">+{n} {n === 1 ? 'posta' : 'poste'} a fine mano</span>
          })()}
          {pIo.posto === mano.mazziere && <span className="bottone-mazziere" title="Mazziere">M</span>}
          {pIo.tutto_dentro && pIo.stato === 'attivo' && <span className="pov-cambio tutto-dentro">Tutto dentro</span>}
          {pIo.cambio != null && pIo.stato === 'attivo' && (
            <span className="pov-cambio">{pIo.cambio === 0 ? 'Servito' : pIo.cambio === 1 ? 'Cambia 1' : `Cambia ${pIo.cambio}`}</span>
          )}
          {reazioni[io.id] && (
            <span key={reazioni[io.id].id} className="pov-reazione" role="img"
              aria-label={EMOTICON.find((x) => x.e === reazioni[io.id].e)?.nome ?? ''}>{reazioni[io.id].e}</span>
          )}
          {video && <TastiMedia video={video} className="pov-media" />}
          {ultima[io.id] && !conclusa && ultima[io.id] !== BOLLE.cambio(pIo.cambio) && <span key={`${ultima[io.id]}-${azioni[0]?.id}`} className="pov-bolla">{ultima[io.id]}</span>}
        </div>
      </div>,
      povEl,
    )}
    </div>
  )
}
