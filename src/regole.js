// Regole del tavolo, mazzo e fiches in Vardis

export const VALUTA = 'Vardis'
export const SIGLA = 'V'
export const TAGLI = [1, 5, 10, 20, 50, 100]

const nf = new Intl.NumberFormat('it-IT')
export const fmt = (n) => `${nf.format(n ?? 0)} ${SIGLA}`

export const REGOLE_BASE = {
  mazzo: 'regola11',
  limite: 'apertura',
  cambio_max: 4,
  buio: 'si',
  durata: 0,
}

export const invitoDi = (tavolo) =>
  Number(tavolo?.regole?.invito) || Math.max(1, Math.floor((tavolo?.valore_posta ?? 0) / 100))

export const OPZIONI = {
  mazzo: [
    ['regola11', 'Regola dell’11: il mazzo si riduce in base ai giocatori'],
    ['completo', 'Mazzo completo da 52 carte'],
  ],
  limite: [
    ['apertura', 'Apertura al massimo quanto il piatto, poi rilanci liberi'],
    ['piatto', 'Sempre al massimo quanto c’è nel piatto'],
    ['fisso', 'Puntata massima fissa'],
    ['libero', 'Nessun limite'],
  ],
  buio: [
    ['si', 'Sì: buio, controbuio e over'],
    ['no', 'No'],
  ],
  durata: [
    ['0', 'Senza limite di tempo'],
    ['60', '1 ora'],
    ['90', '1 ora e mezza'],
    ['120', '2 ore'],
    ['150', '2 ore e mezza'],
    ['180', '3 ore'],
    ['240', '4 ore'],
  ],
  cambio_max: [
    ['4', 'Fino a 4 carte: 3 subito e 1 a fine giro'],
    ['5', 'Fino a 5 carte: 3 subito e 2 a fine giro'],
  ],
}

export function descriviRegole(tavolo) {
  const r = { ...REGOLE_BASE, ...(tavolo?.regole ?? {}) }
  const limite =
    r.limite === 'fisso' ? `Puntata massima: ${fmt(Number(r.puntata_massima))}`
    : r.limite === 'libero' ? 'Nessun limite di puntata'
    : r.limite === 'piatto' ? 'Puntata massima: quanto c’è nel piatto'
    : 'Apertura al massimo quanto c’è nel piatto, poi rilanci liberi e illimitati'
  const durata = Number(r.durata) || 0
  const testoDur = testoDurata(durata)
  return [
    durata > 0
      ? `Durata della partita: ${testoDur}. A 15 minuti dalla fine compare un avviso; allo scadere si finisce la mano in corso e l’organizzatore sceglie se continuare (15, 30 o 60 minuti) o terminare`
      : 'Nessun limite di tempo',
    `Invito a ogni mano: ${fmt(invitoDi(tavolo))}`,
    limite,
    String(r.cambio_max) === '5'
      ? 'Si cambiano fino a 5 carte: 3 subito e 2 a fine giro'
      : 'Si cambiano fino a 4 carte: 3 subito e 1 a fine giro',
    'Si apre con almeno una coppia di jack, o 4 carte di fila dello stesso seme senza asso. Se passano tutti: donne, poi re, e si resta al re finché una mano non viene aperta e giocata',
    r.buio === 'no'
      ? 'Niente buio'
      : 'Buio prima di vedere le carte, solo nelle mani che si aprono ai jack: lo fa il primo dopo il mazziere e vale il piatto; controbuio il doppio, over il doppio del controbuio (anche in 4 giocatori). Chi ha fatto il buio può coprire il controbuio prima delle carte e conserva il diritto di rilanciare. Dopo il cambio l’ultimo buio parla per ultimo. Non si fa dopo una parola',
    'Se tutti dicono parola: il piatto resta, la mano dopo si apre con coppia di re e senza buio',
    'Se dopo una o più parole qualcuno bussa, la parola non vale più: chi l’aveva detta torna a parlare e può puntare o bussare',
    'Il colore batte il full. Semi: cuori, quadri, fiori, picche',
    'Scala reale: la minima batte la massima, la massima batte la media, la media batte la minima',
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

// Carte: "TC" = 10 di cuori. Semi: C cuori, Q quadri, F fiori, P picche
export const SEMI = { C: '♥', Q: '♦', F: '♣', P: '♠' }
export const NOMI_SEMI = { C: 'cuori', Q: 'quadri', F: 'fiori', P: 'picche' }
export const valoreVisibile = (c) => (c[0] === 'T' ? '10' : c[0])

// Durata in minuti → "2 ore", "1 ora e 45 minuti", "30 minuti"
export function testoDurata(min) {
  const m = Number(min) || 0
  if (m <= 0) return 'senza limite'
  const h = Math.floor(m / 60), r = m % 60
  const ore = h === 0 ? '' : h === 1 ? '1 ora' : `${h} ore`
  const minuti = r === 0 ? '' : `${r} minuti`
  return [ore, minuti].filter(Boolean).join(' e ')
}
