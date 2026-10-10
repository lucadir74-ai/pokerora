// Suoni del tavolo, generati al momento con il browser (nessun file audio da scaricare).
// Il telefono li fa partire solo dopo il primo tocco sulla pagina: per questo il contesto
// audio si "sblocca" al primo tocco.

const CHIAVE = 'pokerora_suoni'
let attivi = true
try { attivi = localStorage.getItem(CHIAVE) !== 'no' } catch {}
const ascoltatori = new Set()

let ctx = null
let rumore = null
let fineMescola = 0 // le carte si distribuiscono solo dopo il mescolare

function contesto() {
  if (ctx) return ctx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  ctx = new AC()
  // Un secondo di rumore bianco, riusato per fruscii e tocchi
  rumore = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const d = rumore.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return ctx
}

function sblocca() {
  const c = contesto()
  if (c && c.state === 'suspended') c.resume()
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', sblocca, { passive: true })
  window.addEventListener('keydown', sblocca)
}

export const suoniAttivi = () => attivi
export function impostaSuoni(si) {
  attivi = si
  try { localStorage.setItem(CHIAVE, si ? 'si' : 'no') } catch {}
  if (si) sblocca()
  ascoltatori.forEach((f) => f(si))
}
export function ascoltaSuoni(f) { ascoltatori.add(f); return () => ascoltatori.delete(f) }

const pronto = () => {
  if (!attivi) return null
  const c = contesto()
  return c && c.state === 'running' ? c : null
}
const caso = (a, b) => a + Math.random() * (b - a)

// Colpo di rumore filtrato: fruscio di carta, tocco, strisciata
function fruscio(c, quando, { durata = 0.05, freq = 3000, q = 1, volume = 0.3, tipo = 'bandpass', freqFine } = {}) {
  const s = c.createBufferSource()
  s.buffer = rumore
  const f = c.createBiquadFilter()
  f.type = tipo
  f.frequency.setValueAtTime(freq, quando)
  if (freqFine) f.frequency.exponentialRampToValueAtTime(freqFine, quando + durata)
  f.Q.value = q
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, quando)
  g.gain.exponentialRampToValueAtTime(volume, quando + Math.min(0.006, durata / 4))
  g.gain.exponentialRampToValueAtTime(0.0001, quando + durata)
  s.connect(f).connect(g).connect(c.destination)
  s.start(quando, Math.random() * 0.8, durata + 0.02)
}

// Tintinnio di una fiche: due toni alti brevissimi più un piccolo colpo
function fiche(c, quando, volume = 0.18) {
  const base = caso(2600, 3600)
  for (const [mult, vol] of [[1, 1], [1.48, 0.5]]) {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = base * mult
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, quando)
    g.gain.exponentialRampToValueAtTime(volume * vol, quando + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, quando + caso(0.05, 0.09))
    o.connect(g).connect(c.destination)
    o.start(quando)
    o.stop(quando + 0.12)
  }
  fruscio(c, quando, { durata: 0.02, freq: 5000, q: 2, volume: volume * 0.8 })
}

// ── Suoni del gioco ──

// Mazzo mescolato: una serie di fruscii ravvicinati, come un riffle
export function mescola() {
  const c = pronto(); if (!c) return
  const t = c.currentTime + 0.02
  for (let i = 0; i < 18; i++) {
    fruscio(c, t + i * caso(0.018, 0.026), { durata: 0.03, freq: caso(2500, 4500), q: 0.8, volume: 0.12 })
  }
  fruscio(c, t + 0.45, { durata: 0.07, freq: 1200, q: 0.7, volume: 0.25 })
  fineMescola = t + 0.6
}

// Carte distribuite: un "flic" per carta
export function distribuisci(n = 5, intervallo = 0.09) {
  const c = pronto(); if (!c) return
  const t = Math.max(c.currentTime + 0.02, fineMescola)
  for (let i = 0; i < n; i++) {
    fruscio(c, t + i * intervallo, { durata: 0.06, freq: caso(1800, 2600), q: 0.9, volume: 0.22, freqFine: 900 })
  }
}

// Fiches messe nel piatto (o ricevute): più sono, più tintinnii
export function fiches(quante = 3) {
  const c = pronto(); if (!c) return
  const t = c.currentTime + 0.02
  const n = Math.max(2, Math.min(quante, 7))
  for (let i = 0; i < n; i++) fiche(c, t + i * caso(0.045, 0.075))
}

// Piatto vinto: una cascata di fiches
export function vincita() {
  const c = pronto(); if (!c) return
  const t = c.currentTime + 0.05
  for (let i = 0; i < 14; i++) fiche(c, t + i * caso(0.03, 0.06), 0.14)
}

// Carte scartate: strisciata verso il basso
export function scarta() {
  const c = pronto(); if (!c) return
  fruscio(c, c.currentTime + 0.02, { durata: 0.22, freq: 3500, freqFine: 500, q: 0.6, volume: 0.25, tipo: 'lowpass' })
}

// Mano lasciata: carte buttate sul panno
export function lascia() {
  const c = pronto(); if (!c) return
  fruscio(c, c.currentTime + 0.02, { durata: 0.12, freq: 900, q: 0.7, volume: 0.28 })
}

// Carta girata mentre la spizzi
export function gira() {
  const c = pronto(); if (!c) return
  fruscio(c, c.currentTime + 0.01, { durata: 0.08, freq: 3200, freqFine: 1400, q: 1.2, volume: 0.2 })
}

// Quantità di fiches da far suonare per un importo, rispetto all'invito
export const quanteFiches = (importo, invito) =>
  Math.round(2 + Math.log2(Math.max(1, (importo || 1) / Math.max(1, invito || 1))))
