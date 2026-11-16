// Banco di prova: l'app vera con dati finti.
//   /prove-grafica/app.html?gioco=base|telesina&fase=puntate|attesa|cambio|cambioattesa|secondo|fine&n=2..6
//   /prove-grafica/app.html?griglia=1   → tutte le combinazioni del tavolo, a tante misure, con il controllo
import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import Gioco from '../src/Gioco'
import TavoloVerde from '../src/TavoloVerde'
import Accesso from '../src/Accesso'
import Lobby from '../src/Lobby'
import Tavolo from '../src/Tavolo'
import Giocatori from '../src/Giocatori'
import Messaggi from '../src/Messaggi'
import Invito from '../src/Invito'
import Copertina from '../src/Copertina'
import NuovaPassword from '../src/NuovaPassword'
import '../src/stile.css'
import '../src/stile2.css'
import '../src/tavolo2.css'
import { scenario } from './supabase-finto'
import { spizzataAttiva, impostaSpizzata } from '../src/preferenze'

const q = new URLSearchParams(location.search)
const io = { id: 'io', nickname: 'Luca' }

// Controllo: niente si tocca, niente esce dal tavolo, ogni indice di carta resta scoperto, nessun testo tagliato
export function controlla(tav) {
  const guai = []
  const tr = tav.getBoundingClientRect()
  const els = [...tav.querySelectorAll('.ov')], rs = els.map((e) => e.getBoundingClientRect())
  const nome = (e) => e.className.replace(/\s*\b(ov|gia)\b/g, '').trim()
  rs.forEach((a, i) => {
    if (a.width === 0) return
    if (a.left < tr.left - 0.5 || a.right > tr.right + 0.5 || a.top < tr.top - 0.5 || a.bottom > tr.bottom + 0.5) guai.push(`fuori dal tavolo: ${nome(els[i])}`)
    for (let j = i + 1; j < rs.length; j++) {
      const b = rs[j]
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (ix > 0.5 && iy > 0.5) guai.push(`sovrapposti: ${nome(els[i])} / ${nome(els[j])}`)
    }
  })
  let indice = 99, striscia = 99
  tav.querySelectorAll('.t2-gruppo').forEach((g) => {
    const cc = [...g.children]
    cc.forEach((c, k) => {
      const v = c.querySelector('.cg-valore'); if (!v) return
      indice = Math.min(indice, parseFloat(getComputedStyle(v).fontSize))
      const nx = cc[k + 1]; if (!nx) return
      const lim = nx.getBoundingClientRect().left
      striscia = Math.min(striscia, lim - c.getBoundingClientRect().left)
      const mini = c.querySelector('.cg-mini')
      // il testo vero (non la scatola): larghezza del contenuto
      const r = document.createRange(); r.selectNodeContents(v)
      if (r.getBoundingClientRect().right > lim + 0.5 || (mini && mini.getBoundingClientRect().left > lim)) guai.push('indice coperto dalla carta accanto')
    })
  })
  tav.querySelectorAll('.t2-etichetta, .t2-piatto, .t2-cambio').forEach((b) => {
    if (b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1) guai.push(`testo tagliato: ${b.textContent.trim()}`)
  })
  return { guai: [...new Set(guai)], indice, striscia }
}
window.__controlla = () => {
  const tav = document.querySelector('.t2')
  const r = controlla(tav)
  const fuoriSchermo = [...document.querySelectorAll('.pov, .comandi')].filter((e) => { const b = e.getBoundingClientRect(); return b.bottom > innerHeight + 0.5 || b.right > innerWidth + 0.5 || b.left < -0.5 })
  const pov = document.querySelector('.pov')?.getBoundingClientRect(), com = document.querySelector('.comandi')?.getBoundingClientRect(), t = tav.getBoundingClientRect()
  if (fuoriSchermo.length) r.guai.push('carte o comandi fuori dallo schermo')
  if (pov && t.bottom > pov.top + 0.5 && innerWidth < 960) r.guai.push(`il tavolo finisce sotto le mie carte di ${(t.bottom - pov.top).toFixed(0)}px`)
  if (pov && com && pov.bottom > com.top + 0.5 && innerWidth < 960) r.guai.push('le mie carte finiscono sotto i comandi')
  const mie = [...document.querySelectorAll('.t2-mano .carta-gioco')].map((c) => c.getBoundingClientRect())
  mie.forEach((a, i) => { const b = mie[i + 1]; if (b && a.right > b.left + 0.5 && !document.querySelector('.t2-mano.chiuse')) r.guai.push('le mie carte si sovrappongono') })
  document.querySelectorAll('.azione-grande, .console .chip, .pre-scelta').forEach((b) => { if (b.scrollWidth > b.clientWidth + 1) r.guai.push(`tasto tagliato: ${b.textContent.trim()}`) })
  return { ...r, schermo: `${innerWidth}x${innerHeight}`, tavolo: `${Math.round(t.width)}x${Math.round(t.height)}`, densita: tav.dataset.densita }
}

// Controllo di leggibilità: testi con poco contrasto rispetto al loro sfondo (apre anche le sezioni chiuse)
window.__contrasto = (soglia = 3) => {
  document.querySelectorAll('details').forEach((d) => { d.open = true })
  const rgb = (s) => { const m = s.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]; return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 } }
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const sopra = (su, giu) => ({ r: su.r * su.a + giu.r * (1 - su.a), g: su.g * su.a + giu.g * (1 - su.a), b: su.b * su.a + giu.b * (1 - su.a), a: 1 })
  const sfondo = (el) => {
    const strati = []
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e)
      const c = rgb(s.backgroundColor)
      if (c.a > 0) strati.push(c)
      if (s.backgroundImage !== 'none' && c.a === 0) { const m = s.backgroundImage.match(/rgba?\([^)]+\)/g); if (m) strati.push({ ...rgb(m[m.length - 1]), a: 1 }) }
      if (c.a === 1) break
    }
    return strati.reverse().reduce((giu, su) => sopra(su, giu), { r: 8, g: 19, b: 15, a: 1 })
  }
  const guai = []
  for (const el of document.querySelectorAll('body *')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || Number(s.opacity) === 0) continue
    const bg = sfondo(el), fg = sopra(rgb(s.color), bg)
    const a = lum(fg), b = lum(bg), k = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    if (k < soglia) guai.push(`${k.toFixed(1)} · ${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')} · “${el.textContent.trim().slice(0, 28)}”`)
  }
  return [...new Set(guai)]
}

// ── Tutte le combinazioni del solo tavolo, in scatole di misura fissa ──
const MISURE = [[320, 250], [320, 300], [360, 270], [360, 330], [360, 420], [375, 380], [390, 440], [390, 520], [412, 560], [430, 600], [700, 500], [1000, 640]]
const FASI = ['puntate', 'attesa', 'cambio', 'cambioattesa', 'secondo', 'fine']
function Griglia() {
  const [esito, setEsito] = useState(null)
  const casi = []
  for (const [W, H] of MISURE) for (const gioco of ['base', 'telesina']) for (const fase of FASI) for (let n = 2; n <= 6; n++) {
    if (gioco === 'telesina' && ['cambio', 'cambioattesa', 'secondo'].includes(fase)) continue
    casi.push({ W, H, gioco, fase, n, s: scenario({ gioco, fase, n }) })
  }
  useEffect(() => {
    const t = setTimeout(() => {
      const righe = {}; let ko = 0
      document.querySelectorAll('.caso').forEach((el) => {
        const r = controlla(el.querySelector('.t2'))
        const m = el.dataset.misura
        righe[m] ??= { n: 0, ko: [], indice: 99, striscia: 99, densita: 0 }
        righe[m].n++; righe[m].indice = Math.min(righe[m].indice, r.indice); righe[m].striscia = Math.min(righe[m].striscia, r.striscia)
        righe[m].densita = Math.max(righe[m].densita, Number(el.querySelector('.t2').dataset.densita))
        if (r.guai.length) { ko++; righe[m].ko.push(`${el.dataset.caso}: ${r.guai.join(', ')}`); el.style.outline = '3px solid #ff3b6b' }
      })
      const out = { casi: casi.length, ko, righe }
      window.__esito = out; setEsito(out)
    }, 1200)
    return () => clearTimeout(t)
  }, [])
  return (
    <div style={{ padding: 12, color: '#fff', background: '#17181b', minHeight: '100vh', fontFamily: 'system-ui' }}>
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{esito ? `${esito.casi} combinazioni → ${esito.ko ? esito.ko + ' CON PROBLEMI' : 'nessuna sovrapposizione, nessun testo tagliato'}\n` + Object.entries(esito.righe).map(([m, r]) => `${m.padEnd(9)} ${r.ko.length ? 'KO ' + r.ko.length : 'OK'}/${r.n} · indice min ${r.indice.toFixed(1)}px · striscia ${r.striscia.toFixed(1)}px · compattezza ${r.densita}${r.ko.map((k) => '\n   ✗ ' + k).join('')}`).join('\n') : 'Controllo in corso…'}</pre>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        {casi.map((c) => (
          <div key={`${c.W}x${c.H}-${c.gioco}-${c.fase}-${c.n}`} className="caso" data-misura={`${c.W}x${c.H}`} data-caso={`${c.gioco}/${c.fase}/${c.n}g`}
            style={{ width: c.W, height: c.H, position: 'relative', background: '#08130f', '--tv-w': `${c.W}px`, '--tv-h': `${c.H}px` }}>
            <div className="zona-tavolo" style={{ '--tv-w': `${c.W}px`, '--tv-h': `${c.H}px`, display: 'block' }}>
              <TavoloVerde mano={c.s.mano} posti={c.s.posti} giocatori={c.s.giocatori} io={io} carte={c.s.carte} scelte={[]}
                azioni={c.s.azioni} conclusa={c.s.mano.fase === 'finita'} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── L'app intera (barra, tavolo, mie carte, comandi) a misure di telefono vere, una scena dopo l'altra ──
const SCHERMI = [[320, 568], [360, 560], [360, 640], [360, 740], [375, 667], [390, 750], [390, 844], [412, 915], [430, 932], [768, 1024], [1280, 720]]
function Giro() {
  const [esito, setEsito] = useState({})
  const [fatto, setFatto] = useState(false)
  useEffect(() => {
    const scene = []
    for (const gioco of ['base', 'telesina']) for (const fase of FASI) for (let n = 2; n <= 6; n++) {
      if (gioco === 'telesina' && ['cambio', 'cambioattesa', 'secondo'].includes(fase)) continue
      scene.push({ gioco, fase, n })
    }
    const attendi = (ms) => new Promise((r) => setTimeout(r, ms))
    const uno = async ([W, H]) => {
      const f = document.createElement('iframe')
      f.style.cssText = `width:${W}px;height:${H}px;border:0;position:fixed;left:0;top:0;opacity:0.02;pointer-events:none`   // in vista, altrimenti il browser non lo disegna
      document.body.append(f)
      const r = { n: 0, ko: [], indice: 99, striscia: 99, densita: 0, tavolo: [9999, 0] }
      for (const s of scene) {
        f.src = `/prove-grafica/app.html?gioco=${s.gioco}&fase=${s.fase}&n=${s.n}`
        await new Promise((ok) => { f.onload = ok })
        let c = null
        for (let i = 0; i < 40 && !c; i++) { await attendi(120); try { if (f.contentDocument.querySelector('.t2 .ov') && f.contentDocument.querySelector('.t2-mio')) c = true } catch {} }
        // Se la pagina è in secondo piano il browser non avvisa dei cambi di misura: si forza il ricalcolo
        for (let i = 0; i < 2; i++) { f.contentWindow.dispatchEvent(new Event('resize')); await attendi(110) }
        let x
        try { x = f.contentWindow.__controlla() } catch (e) { x = { guai: [`la pagina si è rotta: ${e.message}`], indice: 99, striscia: 99, densita: 0, tavolo: '0x0' } }
        const h = Number(x.tavolo.split('x')[1])
        r.n++; r.indice = Math.min(r.indice, x.indice); r.striscia = Math.min(r.striscia, x.striscia); r.densita = Math.max(r.densita, Number(x.densita))
        r.tavolo = [Math.min(r.tavolo[0], h), Math.max(r.tavolo[1], h)]
        if (x.guai.length) r.ko.push(`${s.gioco}/${s.fase}/${s.n}g (tavolo ${x.tavolo}): ${x.guai.join(', ')}`)
        setEsito((e) => ({ ...e, [`${W}x${H}`]: { ...r } }))
      }
      f.remove()
    }
    Promise.all(SCHERMI.map(uno)).then(() => { setFatto(true); window.__giro = true })
  }, [])
  window.__esitoGiro = esito
  return (
    <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, padding: 12, color: '#fff', background: '#17181b', minHeight: '100vh', margin: 0 }}>
      {fatto ? 'FINITO\n' : 'Controllo in corso…\n'}
      {Object.entries(esito).map(([m, r]) => `${m.padEnd(9)} ${r.ko.length ? 'KO ' + r.ko.length : 'OK'}/${r.n} · tavolo alto ${r.tavolo[0]}–${r.tavolo[1]}px · indice min ${r.indice.toFixed(1)}px · striscia ${r.striscia.toFixed(1)}px · compattezza ${r.densita}${r.ko.map((k) => '\n   ✗ ' + k).join('')}`).join('\n')}
    </pre>
  )
}

function Pagina() {
  const s = scenario()
  const [menu, setMenu] = useState(q.has('menu'))
  return (
    <main className="pagina ampia">
      <nav className="barra-gioco" aria-label="Tavolo">
        <button className="link-chiaro barra-home" aria-label="Torna alla home">‹</button>
        <span className="barra-nome">{s.tavolo.nome}</span>
        <span className="chip-tempo">⏱ 1:24</span>
        <button className="chip-posta">+ Posta</button>
        <span className="barra-org"><button className="tasto-pausa">⏸</button><button className="tasto-termina solo-largo">Termina</button></span>
        <button className="barra-menu-tasto" aria-expanded={menu} aria-label="Menu del tavolo" onClick={() => setMenu((m) => !m)}>⋯</button>
        {menu && <span className="barra-menu-velo" onClick={() => setMenu(false)} aria-hidden="true" />}
        <span className={`barra-link${menu ? ' aperto' : ''}`}>
          <button className="suoni-tasto">🔊</button>
          <button className="interruttore-spizza">Spizza <span className="interruttore-pallino" aria-hidden="true" /></button>
          <button className="link-chiaro">Chat</button>
          <button className="link-chiaro">Storico</button>
          <button className="link-chiaro">Regole</button>
          <button className="link-chiaro">Poste</button>
          <button className="tasto-termina solo-stretto">Termina la partita</button>
        </span>
      </nav>
      <Gioco tavolo={s.tavolo} giocatori={s.giocatori} io={io} />
    </main>
  )
}

// Le altre pagine dell'app: ?pagina=accesso|lobby|attesa|chiuso|partita|giocatori|messaggi|invito|copertina|password
const PAGINE = {
  accesso: () => <Accesso />,
  lobby: () => <Lobby io={io} />,
  attesa: () => <Tavolo id="t2" io={io} />,
  chiuso: () => <Tavolo id="t3" io={io} />,
  partita: () => <Tavolo id="t1" io={io} />,
  giocatori: () => <Giocatori io={io} />,
  messaggi: () => <Messaggi altroId="11111111-1111-4111-8111-111111111111" io={io} />,
  invito: () => <Invito codice="M4RC0X" io={io} />,
  copertina: () => <Copertina onEntra={() => {}} />,
  password: () => <NuovaPassword onFatto={() => {}} />,
}

// Nel banco di prova le carte arrivano già aperte, salvo ?spizza=1
const spizzataPrima = spizzataAttiva()
impostaSpizzata(q.has('spizza'))
window.addEventListener('pagehide', () => impostaSpizzata(spizzataPrima))
ReactDOM.createRoot(document.getElementById('root')).render(q.has('griglia') ? <Griglia /> : q.has('giro') ? <Giro /> : PAGINE[q.get('pagina')]?.() ?? <Pagina />)
