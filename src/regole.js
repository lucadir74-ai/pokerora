// Regole del tavolo, mazzo e fiches in Vardis

export const VALUTA = 'Vardis'
export const SIGLA = 'V'
export const TAGLI = [1, 5, 10, 20, 50, 100]

const nf = new Intl.NumberFormat('it-IT')
export const fmt = (n) => `${nf.format(n)} ${SIGLA}`

export const REGOLE_BASE = {
  mazzo: 'regola11',
  apertura: 'fanti',
  colore_batte_full: true,
  cambio_cinque: '3+2',
  scala_ciclica: true,
}

export const OPZIONI = {
  mazzo: [
    ['regola11', 'Regola dell’11: il mazzo si riduce in base ai giocatori'],
    ['completo', 'Mazzo completo da 52 carte'],
  ],
  apertura: [
    ['fanti', 'Si apre con almeno una coppia di fanti'],
    ['libera', 'Apertura libera'],
  ],
  cambio_cinque: [
    ['3+2', 'Chi cambia 5 carte ne riceve 3 subito e 2 a fine giro'],
    ['5', 'Chi cambia 5 carte le riceve tutte subito'],
    ['no', 'Non si possono cambiare tutte e 5 le carte'],
  ],
}

export function descriviRegole(r = {}) {
  const x = { ...REGOLE_BASE, ...r }
  const voce = (k) => OPZIONI[k].find(([v]) => v === x[k])?.[1] ?? ''
  return [
    voce('mazzo'),
    voce('apertura'),
    x.colore_batte_full ? 'Il colore batte il full' : 'Il full batte il colore',
    voce('cambio_cinque'),
    x.scala_ciclica ? 'Scala reale ciclica' : 'Scala reale non ciclica',
  ]
}

const NOMI = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7' }

// Regola dell'11: carta più bassa = 11 − giocatori; carte = (15 − più bassa) × 4
export function descriviMazzo(giocatori, regole = {}) {
  const r = { ...REGOLE_BASE, ...regole }
  if (r.mazzo === 'completo') return 'Mazzo completo: 52 carte'
  const n = Math.min(Math.max(giocatori, 4), 6)
  const bassa = 11 - n
  return `Con ${n} giocatori si gioca dal ${NOMI[bassa]} all’asso: ${(15 - bassa) * 4} carte`
}

// Divide una posta in fiches da 1, 5, 10, 20, 50, 100.
// Quote di partenza (su 1.000 V: 10×1, 8×5, 10×10, 5×20, 5×50, 5×100), il resto in tagli grandi.
const QUOTE = { 1: 0.01, 5: 0.04, 10: 0.1, 20: 0.1, 50: 0.25 }
export function dividiPosta(valore) {
  const pezzi = Object.fromEntries(TAGLI.map((t) => [t, 0]))
  let resto = valore
  for (const t of [1, 5, 10, 20, 50]) {
    const n = Math.floor((valore * QUOTE[t]) / t)
    pezzi[t] += n
    resto -= n * t
  }
  for (const t of [...TAGLI].reverse()) {
    const n = Math.floor(resto / t)
    pezzi[t] += n
    resto -= n * t
  }
  return TAGLI.map((t) => ({ taglio: t, pezzi: pezzi[t] })).filter((x) => x.pezzi > 0)
}
