import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { VideoCerchio, TastiMedia } from './VideoCerchio'
import Carta from './Carta'
import { fmt } from './regole'
import { valutaMigliore, nomePunto, puoAprire } from './punti'
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

// Tasto delle emoticon accanto al mio nome: si apre la tavolozza, un tocco e l'emoticon
// compare sul tuo posto per tutti
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

const nf = new Intl.NumberFormat('it-IT')
const AZIONI = {
  passo: 'Passo', lascio: 'Lascio', vedo: 'Vedo', busso: 'Busso', parol: 'Parola',
  buio: 'Buio', controbuio: 'Controbuio', over: 'Over', nobuio: 'Niente buio', chiudo: 'Chiudo',
  apro: 'Apro', punto: 'Punto', rilancio: 'Rilancio', copro: 'Copro',
}
const CON_PUNTATA = new Set(['apro', 'vedo', 'rilancio', 'punto', 'buio', 'controbuio', 'over', 'copro'])
const testoCambio = (n) => (n === 0 ? 'Servito' : `Cambia ${n}`)

// Carte di un giocatore senza la vela (al confronto la vela resta al centro)
const senzaVela = (carte, mano) => (mano?.gioco === 'telesina' && mano.vela ? carte.filter((c) => c !== mano.vela) : carte)

// ── Disposizione del tavolo, in pixel ──
// Ogni avversario è un blocco: targhetta (nome e fiches), carte, etichetta (azione e puntata, o il punto).
// I blocchi stanno su due colonne ai lati, più uno in alto al centro se sono dispari;
// piatto, vela e mazzo nella colonna centrale; la mia puntata in basso al centro.
// Niente si sovrappone: se lo spazio non basta, prima si compattano targhette ed etichette, poi le carte.
const DENSITA = [{ ph: 36, pill: 22 }, { ph: 32, pill: 20 }, { ph: 28, pill: 18 }]
const DENSITA_VIDEO = [56, 46, 36]
const limita = (v, a, b) => Math.min(b, Math.max(a, v))

export function sedi(nAltri) {
  const coppie = Math.floor(nAltri / 2), dispari = nAltri % 2
  const sx = [], dx = []
  for (let r = coppie - 1 + dispari; r >= dispari; r--) sx.push({ lato: 'l', riga: r })
  for (let r = dispari; r <= coppie - 1 + dispari; r++) dx.push({ lato: 'r', riga: r })
  // In senso orario partendo da chi siede alla mia sinistra
  return [...sx, ...(dispari ? [{ lato: 'c', riga: 0 }] : []), ...dx]
}

export function disposizione({ W, H, nAltri, vela = false, mazzo = true, dueRighe = false, video = false }) {
  const m = 8, pad = 7, sp = 3
  const posti = sedi(nAltri)
  const R = Math.max(1, ...posti.map((s) => s.riga + 1))
  const centrale = posti.some((s) => s.lato === 'c')
  const cwLargo = limita(W * 0.082, 26, 58)
  const k = limita(cwLargo / 30, 1, 1.4)             // schermi grandi: targhette ed etichette in proporzione
  // Tentativi, dal più comodo al più compatto; nell'ultimo la mia puntata lascia il tavolo
  // e va accanto al mio nome, così le righe degli altri hanno 30 pixel in più
  const TENTATIVI = [[0, 30], [1, 30], [2, 30], [2, 0]]
  let d, riserva, ph, pill, cw, pezzi, top, bottom
  for (let t = 0; t < TENTATIVI.length; t++) {
    [d, riserva] = TENTATIVI[t]
    const ultimo = t === TENTATIVI.length - 1
    ph = (video ? DENSITA_VIDEO[d] : DENSITA[d].ph) * k
    pill = (DENSITA[d].pill + (dueRighe ? 8 : 0)) * k
    const cwAlto = (H - 2 * pad - riserva - R * (ph + pill + 2 * sp) - (R - 1) * 5) / (R * 1.4)
    cw = Math.min(cwLargo, Math.max(18, cwAlto))
    top = centrale ? pad + ph + pill + 2 * sp + cw * 1.4 + 8 : pad + 4
    bottom = H - riserva - 4
    pezzi = []
    if (vela) pezzi.push({ tipo: 'vela', h: cw * 1.12 * 1.4 + 14 })
    pezzi.push({ tipo: 'piatto', h: 26 * k })
    if (mazzo && !vela) pezzi.push({ tipo: 'mazzo', h: cw * 0.9 * 1.4 })
    const tot = () => pezzi.reduce((s, p) => s + p.h, 0) + (pezzi.length - 1) * 10
    if (ultimo && tot() > bottom - top) pezzi = pezzi.filter((p) => p.tipo !== 'mazzo')
    if ((cwAlto >= cwLargo && tot() <= bottom - top) || ultimo) break
  }
  const ch = cw * 1.4, step = cw * 0.7
  const mw = cw + 4 * step, mh = ph + sp + ch + sp + pill
  const gap = R > 1 ? limita((H - 2 * pad - riserva - R * mh) / (R - 1), 0, 44 * k) : 0
  const blocchi = posti.map((s) => ({
    lato: s.lato,
    x: s.lato === 'l' ? m : s.lato === 'r' ? W - m - mw : (W - mw) / 2,
    y: pad + s.riga * (mh + gap),
  }))
  const tot = pezzi.reduce((s, p) => s + p.h, 0) + (pezzi.length - 1) * 10
  let y = top + Math.max(0, (bottom - top - tot) / 2)
  if (!centrale && R === 1 && nAltri > 0) y = Math.max(top, Math.min(pad + mh * 0.5, bottom - tot))
  for (const p of pezzi) { p.y = y; y += p.h + 10 }
  const colW = nAltri >= 2 ? W - 2 * (m + mw) - 10 : W - 2 * m
  const origine = pezzi.find((p) => p.tipo === 'mazzo') ?? pezzi[0]
  return {
    d, k, cw, ch, step, mw, mh, ph, pill, sp, blocchi, pezzi, colW,
    miaSulTavolo: riserva > 0, miaY: H - riserva + 2, kf: limita(cw / 29, 0.8, 1), mazzo: { x: W / 2, y: origine.y + origine.h / 2 },
  }
}

// Sfondo del tavolo: rettangolo arrotondato con bordo sottile, piatto, senza prospettiva
const Fondo = () => <div className="t2-fondo" aria-hidden="true" />

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
      const v = manoRef.current?.querySelectorAll(':scope > .t2-mia')
      if (v && v.length > 1) setPassoCarte(v[1].offsetLeft - v[0].offsetLeft)
    }
    misura()
    window.addEventListener('resize', misura)
    return () => window.removeEventListener('resize', misura)
  }, [carte.length, mano?.id])
  const prevCambio = useRef({})

  // Misura del tavolo: la disposizione si calcola in pixel
  const tavoloRef = useRef(null)
  const [misura, setMisura] = useState({ W: 0, H: 0 })
  useLayoutEffect(() => {
    const el = tavoloRef.current
    if (!el) return
    const leggi = () => setMisura((p) => (p.W === el.clientWidth && p.H === el.clientHeight ? p : { W: el.clientWidth, H: el.clientHeight }))
    leggi()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(leggi) : null
    ro?.observe(el)
    window.addEventListener('resize', leggi)
    return () => { ro?.disconnect(); window.removeEventListener('resize', leggi) }
  }, [])

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
        <div className="tavolo-verde t2 vuoto" ref={tavoloRef}><Fondo /><p className="t2-invito">Il mazzo è pronto.</p></div>
      </div>
    )
  }

  const telesina = mano.gioco === 'telesina'
  const primaDelleCarte = mano.fase === 'buio' || mano.fase === 'scelta'

  // Io in basso (fuori dal tavolo, sopra i comandi), gli altri in senso orario
  const ordinati = [...posti].sort((a, b) => a.posto - b.posto)
  const mioIndice = ordinati.findIndex((p) => p.giocatore_id === io.id)
  const altri = mioIndice < 0 ? ordinati : [...ordinati.slice(mioIndice + 1), ...ordinati.slice(0, mioIndice)]
  const pIo = mioIndice < 0 ? null : ordinati[mioIndice]

  const nomeDi = (id) => giocatori.find((g) => g.giocatore_id === id)?.profili?.nickname ?? 'giocatore'
  const fichesDi = (id) => giocatori.find((g) => g.giocatore_id === id)?.fiches ?? 0

  // Ultima azione di ciascuno in questa mano (le azioni arrivano dalla più recente)
  const ultima = {}
  for (const a of azioni) {
    if (a.giocatore_id && !(a.giocatore_id in ultima) && (AZIONI[a.tipo] || a.tipo === 'cambio')) ultima[a.giocatore_id] = a
  }

  const inGiro = posti.reduce((s, p) => s + p.versato_giro, 0)
  const alCentro = mano.piatto - inGiro
  const vincitori = mano.esito?.vincitori ?? []
  const mostraPiatto = mano.fase !== 'finita' || vincitori.length === 1
  const conVela = telesina && !!mano.con_vela
  const scartiVisibili = !telesina && !['apertura', 'primo_giro', 'scelta', 'buio'].includes(mano.fase)
  const qualcheVideo = !!video && altri.some((p) => video.stati?.[p.giocatore_id]?.cam && video.flussi?.[p.giocatore_id])
  const puntiMostrati = conclusa && altri.some((p) => p.carte_mostrate && p.punto)

  const { W, H } = misura
  const L = W > 0 && H > 0
    ? disposizione({ W, H, nAltri: altri.length, vela: conVela, mazzo: !conclusa, dueRighe: puntiMostrati, video: qualcheVideo })
    : null

  // Etichetta sotto le carte: il punto a fine mano, altrimenti l'ultima azione con la puntata del giro
  const etichetta = (p) => {
    const fuori = p.stato === 'fuori'
    const vince = conclusa && p.vincita > 0
    if (conclusa) {
      if (p.carte_mostrate && p.punto) return { testo: p.punto, due: true, vince }
      if (vince) return { testo: `Vince ${nf.format(p.vincita)}`, vince }
      return fuori ? { testo: 'Lascio', fuori } : null
    }
    if (fuori) return { testo: 'Lascio', fuori }
    const u = ultima[p.giocatore_id]
    if (p.versato_giro > 0) {
      return { testo: `${u && CON_PUNTATA.has(u.tipo) ? AZIONI[u.tipo] + ' ' : ''}${nf.format(p.versato_giro)}`, importo: p.versato_giro }
    }
    if (u) return { testo: u.tipo === 'cambio' ? testoCambio(u.importo) : AZIONI[u.tipo], chiave: u.id }
    return p.cambio != null ? { testo: testoCambio(p.cambio) } : null
  }
  const pallino = (n) => <span className={`t2-fiche${n >= 100 ? ' nera' : n >= 50 ? ' blu' : ''}`} aria-hidden="true" />

  const riga = (lato, x, y, w, chiave, dentro) => (
    <div key={chiave} className={`t2-riga j${lato}`} style={{ left: x, top: y, width: w }}>{dentro}</div>
  )

  // ── Le mie carte, davanti a me ──
  const mioFuori = pIo?.stato === 'fuori'
  // Telesina: la prima carta è la coperta; il punto si calcola con 5 carte (più la vela, se è girata)
  const carteMie = telesina && mano.vela ? [...carte, mano.vela] : carte
  const chiuse = !telesina && conSpizzata && carte.length === 5 && !mioFuori && !aperto
  const mioPunto = carte.length === 5 ? nomePunto(valutaMigliore(carteMie, mano.bassa)) : ''
  const mioTurno = !!pIo && mano.turno === pIo.posto && !conclusa
  const manoMia = () => (
    <div ref={manoRef} className={`t2-mano${mioFuori ? ' piegata' : ''}${chiuse ? ' chiuse' : ''}`}
      onClick={chiuse ? () => setSpizzo(true) : undefined}
      onKeyDown={chiuse ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSpizzo(true) } } : undefined}
      role={chiuse ? 'button' : undefined} tabIndex={chiuse ? 0 : undefined}
      aria-label={chiuse ? 'Le tue carte sono chiuse: tocca per spizzarle' : undefined}>
      {ordine.map((c, k) => (
        <span key={`${mano.id}-${c}`} className={`t2-mia t2-arriva${gia(`${mano.id}-${c}`)}`}
          style={{ '--ritardo': `${k * (altri.length + 1) * 70 + 40}ms`, zIndex: 10 - k }}>
          <span className="strato" style={{ transform: chiuse ? `translate(${(2 - k) * passoCarte + (k - 2) * -2}px, ${(4 - k) * -1.5}px)` : undefined }}>
            <Carta c={c} indice scelta={scelte.includes(c)} coperta={telesina && c === carte[0]}
              onClick={onScegli && !chiuse ? () => onScegli(c) : undefined} />
          </span>
        </span>
      ))}
      {spizzo && conSpizzata && carte.length === 5 && !mioFuori && (
        <Spizzata ordine={ordine} viste={viste} onVedi={vedi} punto={mioPunto} onChiudi={() => setSpizzo(false)} />
      )}
    </div>
  )

  return (
    <div className="scena">
      <div className="tavolo-verde t2" ref={tavoloRef}
        style={L ? { '--cw': `${L.cw.toFixed(1)}px`, '--step': `${L.step.toFixed(1)}px`, '--ph': `${L.ph.toFixed(1)}px`, '--pill': `${L.pill.toFixed(1)}px`, '--k': (L.k * L.kf).toFixed(3) } : undefined}
        data-densita={L?.d} data-stretto={L && L.cw < 28 ? '' : undefined} aria-label={`Tavolo: mano ${mano.numero}, piatto ${fmt(mano.piatto)}`}>
        <Fondo />
        {L && L.pezzi.map((pz) => riga('c', 0, pz.y, W, pz.tipo,
          pz.tipo === 'vela' ? (
            <span className="t2-vela ov" style={{ '--cw': `${(L.cw * 1.12).toFixed(1)}px` }} aria-label={mano.vela ? 'La vela' : 'La vela, ancora coperta'}>
              {mano.vela ? <span key={mano.vela} className={`gira${gia(`${mano.id}-vela`)}`}><Carta c={mano.vela} piccola indice /></span> : <span className="t2-dorso" />}
              <small>Vela</small>
            </span>
          ) : pz.tipo === 'piatto' ? (
            mostraPiatto && (
              <span className="t2-piatto ov" style={{ maxWidth: L.colW }}>
                <span key={alCentro} className={`t2-pila${gia(`${mano.id}-piatto-${alCentro}`)}`} aria-hidden="true"><i /></span>
                {nf.format(conclusa ? mano.piatto : Math.max(alCentro, 0))}
              </span>
            )
          ) : (
            <span className="t2-mazzo ov" style={{ '--cw': `${(L.cw * 0.9).toFixed(1)}px` }} aria-hidden="true">
              <span className="t2-dorso" />
              {scartiVisibili && <span className="t2-dorso storto" />}
            </span>
          )))}

        {L && altri.map((p, i) => {
          const b = L.blocchi[i]
          if (!b) return null
          const id = p.giocatore_id
          const fuori = p.stato === 'fuori'
          const diTurno = mano.turno === p.posto && !conclusa
          const vince = conclusa && p.vincita > 0
          const scoperte = conclusa && p.carte_mostrate
          const yCarte = b.y + L.ph + L.sp, yEtichetta = yCarte + L.ch + L.sp
          // Da dove partono le carte nell'animazione: il mazzo al centro
          const larghe = scoperte || telesina
          const lgr = larghe ? L.mw : L.cw + 4 * L.cw * 0.42
          const cx = b.lato === 'l' ? b.x + lgr / 2 : b.lato === 'r' ? b.x + L.mw - lgr / 2 : b.x + L.mw / 2
          const dalMazzo = { '--dx': (L.mazzo.x - cx).toFixed(0), '--dy': (L.mazzo.y - (yCarte + L.ch / 2)).toFixed(0) }
          const st = video?.stati?.[id]
          const conVideo = st?.cam && video.flussi?.[id]
          const et = etichetta(p)

          // Dorsi degli altri: le prime (5 − cambio) sono le vecchie, poi le nuove arrivate dal mazzo
          const nuove = Math.max(0, (p.cambio ?? 0) - p.cambio_pendente)
          const vecchie = 5 - (p.cambio ?? 0)
          const dorsi = [
            ...Array.from({ length: vecchie }, (_, k) => `v${k}`),
            ...Array.from({ length: nuove }, (_, k) => `n${k}`),
          ]
          // Quante carte ha cambiato: resta visibile accanto alle carte fino alla fine della mano
          const segnoCambio = !telesina && !conclusa && !fuori && p.cambio != null && et?.testo !== testoCambio(p.cambio) && (
            <span key="cambio" className="t2-cambio ov" title={p.cambio === 0 ? 'Servito' : `Ha cambiato ${p.cambio} ${p.cambio === 1 ? 'carta' : 'carte'}`}>
              {p.cambio === 0 ? 'serv.' : `↻${p.cambio}`}
            </span>
          )

          let gruppo = null
          if (primaDelleCarte) gruppo = null
          else if (scoperte) {
            gruppo = (
              <div key="carte" className={`t2-gruppo ov${vince ? ' vincente' : ''}`}>
                {senzaVela(p.carte_mostrate, mano).map((c, k) => (
                  <span key={c} className={`gira${gia(`${mano.id}-g-${c}`)}`} style={{ '--ritardo': `${k * 90}ms` }}><Carta c={c} piccola indice /></span>
                ))}
              </div>
            )
          } else if (telesina) {
            gruppo = (
              <div key="carte" className={`t2-gruppo ov${fuori ? ' piegata' : ''}`}>
                <span className={`t2-volo${gia(`${mano.id}-${id}-coperta`)}`} style={{ ...dalMazzo, '--ritardo': `${i * 70}ms` }}><span className="t2-dorso" /></span>
                {(p.scoperte ?? []).map((c, k) => (
                  <span key={c} className={`t2-volo${gia(`${mano.id}-${id}-${c}`)}`} style={{ ...dalMazzo, '--ritardo': `${(k === 0 ? altri.length + 1 : 0) * 70 + i * 70}ms` }}>
                    <Carta c={c} piccola indice />
                  </span>
                ))}
              </div>
            )
          } else {
            gruppo = (
              <div key="carte" className={`t2-gruppo coperte ov${fuori ? ' piegata' : ''}`}>
                {dorsi.map((k, j) => (
                  <span key={`${mano.id}-${k}`} className={`t2-volo${gia(`${mano.id}-${id}-${k}`)}`}
                    style={{ ...dalMazzo, '--ritardo': k.startsWith('v') ? `${j * (altri.length + 1) * 70 + i * 70}ms` : `${j * 60}ms` }}>
                    <span className="t2-dorso" />
                  </span>
                ))}
              </div>
            )
          }

          return (
            <div key={id} className="t2-posto">
              {riga(b.lato, b.x, b.y, L.mw, 'targa', (
                <div className={`t2-targa ov${diTurno ? ' di-turno' : ''}${fuori ? ' fuori' : ''}${vince ? ' vince' : ''}${conVideo ? ' con-video' : ''}`}>
                  <span className="t2-av">
                    {conVideo
                      ? <VideoCerchio stream={video.flussi[id]} className="t2-video" titolo={`Video di ${nomeDi(id)}`} />
                      : <span aria-hidden="true">{nomeDi(id).slice(0, 1).toUpperCase()}</span>}
                    {p.posto === mano.mazziere && <small className="t2-mz" title="Mazziere">M</small>}
                    {st?.mic && <span className="t2-mic" title="Microfono acceso" aria-label="Microfono acceso">🎤</span>}
                    {(() => {
                      // Diagnosi: se qualcuno ha video o audio acceso ma il collegamento con questo giocatore non c'è
                      if (!st || st.collegato || !(st.cam || st.mic || video.cam || video.mic)) return null
                      const fallito = st.stato === 'failed' || st.stato === 'disconnected'
                      return (
                        <button type="button" className={`t2-collegamento${fallito ? ' fallito' : ''}`}
                          onClick={() => video.mostraDiagnosi(id)}
                          title={fallito ? 'Collegamento video non riuscito: tocca per i dettagli' : 'Collegamento video in corso: tocca per i dettagli'}>
                          {fallito ? '📡✕' : '📡…'}
                        </button>
                      )
                    })()}
                    {reazioni[id] && (
                      <span key={reazioni[id].id} className="t2-reazione" role="img"
                        aria-label={`${nomeDi(id)}: ${EMOTICON.find((x) => x.e === reazioni[id].e)?.nome ?? ''}`}>
                        {reazioni[id].e}
                      </span>
                    )}
                  </span>
                  <span className="t2-testo">
                    <b>{nomeDi(id)}</b>
                    {vince ? <i>+{fmt(p.vincita)}</i>
                      : p.tutto_dentro && p.stato === 'attivo' ? <i className="tutto">Tutto dentro</i>
                      : <i>{fmt(fichesDi(id))}</i>}
                  </span>
                  {fumetti[id] && (
                    <span key={`chat-${fumetti[id].id}`} className="t2-chat">
                      {fumetti[id].testo.length > 60 ? fumetti[id].testo.slice(0, 58) + '…' : fumetti[id].testo}
                    </span>
                  )}
                </div>
              ))}

              {gruppo && riga(b.lato, b.x, yCarte, L.mw, 'carte', b.lato === 'r' ? [segnoCambio, gruppo] : [gruppo, segnoCambio])}

              {/* Carte scartate che volano agli scarti */}
              {fantasmi.filter((f) => f.giocatore === id).map((f) => riga(b.lato, b.x, yCarte, L.mw, f.id, (
                <span className="t2-fantasmi" aria-hidden="true">
                  {Array.from({ length: f.n }, (_, k) => (
                    <span key={k} className="t2-dorso via" style={{ ...dalMazzo, '--ritardo': `${k * 60}ms` }} />
                  ))}
                </span>
              )))}

              {et && riga(b.lato, b.x, yEtichetta, L.mw, 'etichetta', (
                <span key={et.importo ? `p${et.importo}` : et.chiave ?? et.testo}
                  className={`t2-etichetta ov${et.due ? ' due' : ''}${et.vince ? ' vince' : ''}${et.fuori ? ' fuori' : ''}${et.importo ? '' : ' solo'}${gia(`${mano.id}-${id}-e-${et.importo ?? et.testo}`)}`}>
                  {et.importo ? pallino(et.importo) : null}{et.testo}
                </span>
              ))}
            </div>
          )
        })}

        {/* La mia puntata del giro: in basso al centro, davanti a me */}
        {L && L.miaSulTavolo && pIo && pIo.versato_giro > 0 && !conclusa && riga('c', 0, L.miaY, W, 'mia', (
          <span key={pIo.versato_giro} className={`t2-etichetta mia ov${gia(`${mano.id}-io-p${pIo.versato_giro}`)}`}>
            {pallino(pIo.versato_giro)}Tu {nf.format(pIo.versato_giro)}
          </span>
        ))}
      </div>

      {povEl && pIo && createPortal(
        <div className={`t2-mio${mioTurno ? ' di-turno' : ''}${mioFuori ? ' fuori' : ''}`}>
          <div className="t2-io">
            <span className="t2-av">
              {video?.cam && video.locale
                ? <VideoCerchio stream={video.locale} specchio className="t2-video" titolo="Il tuo video" />
                : <span aria-hidden="true">{nomeDi(io.id).slice(0, 1).toUpperCase()}</span>}
              {pIo.posto === mano.mazziere && <small className="t2-mz" title="Mazziere">M</small>}
              {reazioni[io.id] && (
                <span key={reazioni[io.id].id} className="t2-reazione" role="img"
                  aria-label={EMOTICON.find((x) => x.e === reazioni[io.id].e)?.nome ?? ''}>{reazioni[io.id].e}</span>
              )}
            </span>
            <span className="t2-nick">{nomeDi(io.id)}</span>
            <span className="t2-fiches">{fmt(fichesDi(io.id))}</span>
            {(() => {
              const n = giocatori.find((g) => g.giocatore_id === io.id)?.poste_in_arrivo ?? 0
              return n > 0 && <span className="t2-nota" title="Le fiches arrivano a fine mano">+{n} {n === 1 ? 'posta' : 'poste'}</span>
            })()}
            {pIo.tutto_dentro && pIo.stato === 'attivo' && <span className="t2-nota rossa">Tutto dentro</span>}
            {pIo.cambio != null && pIo.stato === 'attivo' && !conclusa && <span className="t2-nota">{testoCambio(pIo.cambio)}</span>}
            {/* Tavolo molto pieno su schermo basso: la mia puntata sta qui invece che sul tavolo */}
            {L && !L.miaSulTavolo && pIo.versato_giro > 0 && !conclusa && (
              <span className="t2-nota puntata">{pallino(pIo.versato_giro)}{nf.format(pIo.versato_giro)}</span>
            )}
          </div>
          <div className="t2-tasti">
            {video && <TastiMedia video={video} className="pov-media" />}
            {onReagisci && <Emoticon onReagisci={onReagisci} />}
          </div>
          <div className="t2-stato">
            {mioTurno && (
              <span className="t2-tocca">{mano.fase === 'cambio' ? 'Tocca a te: scegli le carte' : mano.fase === 'scelta' ? 'Tocca a te: con o senza vela?' : 'Tocca a te'}</span>
            )}
            {conclusa && pIo.carte_mostrate && pIo.punto ? (
              <span className={`t2-punto${pIo.vincita > 0 ? ' vince' : ''}`}>{pIo.punto}{pIo.vincita > 0 ? ` · vinci ${fmt(pIo.vincita)}` : ''}</span>
            ) : chiuse ? (
              <span className="t2-punto spizza-aiuto">Tocca le carte per spizzarle</span>
            ) : carte.length === 5 && !mioFuori && !primaDelleCarte ? (
              <span className="t2-punto">
                {mioPunto}
                {mano.fase === 'apertura' && (puoAprire(carte, mano.requisito, mano.bassa)
                  ? <b className="si"> · puoi aprire</b> : <b className="no"> · non puoi aprire</b>)}
              </span>
            ) : mioFuori ? (
              <span className="t2-punto tenue">Hai lasciato</span>
            ) : null}
          </div>
          <div className="t2-carte">
            {mano.fase === 'scelta' ? (
              <span className="t2-attesa">Il mazziere sceglie se giocare con la vela</span>
            ) : mano.fase === 'buio' ? (
              <span className="t2-attesa">Le carte arrivano dopo il buio</span>
            ) : conclusa && pIo.carte_mostrate ? (
              <div className={`t2-mano${pIo.vincita > 0 ? ' vincente' : ''}`}>
                {senzaVela(pIo.carte_mostrate, mano).map((c, k) => (
                  <span key={c} className={`t2-mia gira${gia(`${mano.id}-g-${c}`)}`} style={{ '--ritardo': `${k * 90}ms` }}><Carta c={c} indice /></span>
                ))}
              </div>
            ) : manoMia()}
          </div>
        </div>,
        povEl,
      )}
    </div>
  )
}
