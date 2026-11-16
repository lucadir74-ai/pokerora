// Dati finti per provare la grafica del tavolo senza collegarsi al server vero.
// Usato solo dal banco di prova (prove-grafica/vite.prova.js lo mette al posto di src/supabase.js).

const AVV = [
  { id: 'a1', n: 'Marco', f: 2450, h: ['KC', 'KP', '7F', '8Q', '9P'] },
  { id: 'a2', n: 'Massimiliano', f: 12450, h: ['TC', 'TQ', 'TF', 'TP', '9C'] },
  { id: 'a3', n: 'Sara', f: 860, h: ['AF', 'QF', '9F', '8F', '7C'] },
  { id: 'a4', n: 'Gigi', f: 0, h: ['JC', 'JQ', 'JP', '8P', '8C'] },
  { id: 'a5', n: 'Antonella', f: 3120, h: ['AP', 'AC', 'AQ', '6P', 'QQ'] },
]
const MIE = ['KF', 'KQ', '9Q', 'JF', '6C']
const CHI = { 5: [0, 1, 2, 3, 4], 4: [0, 1, 3, 4], 3: [0, 1, 4], 2: [1, 4], 1: [1] }

// Per ogni fase: cosa ha fatto ciascun avversario
const STATI = {
  puntate: [{ t: 'apro', v: 20 }, { t: 'vedo', v: 20 }, { t: 'lascio', fuori: 1 }, { t: 'vedo', v: 95, tutto: 1 }, { t: 'rilancio', v: 160 }],
  attesa: [{ t: 'apro', v: 20 }, { t: 'vedo', v: 20 }, { t: 'lascio', fuori: 1 }, { t: 'controbuio', v: 40 }, { turno: 1 }],
  cambio: [{ c: 2 }, { c: 0 }, { t: 'lascio', fuori: 1 }, { c: 3 }, { c: 1 }],
  cambioattesa: [{ c: 2 }, { c: 0 }, { t: 'lascio', fuori: 1 }, { c: 3 }, { turno: 1 }],
  secondo: [{ t: 'punto', v: 40, c: 2 }, { t: 'vedo', v: 40, c: 0 }, { t: 'lascio', fuori: 1 }, { t: 'rilancio', v: 120, c: 3 }, { c: 1, turno: 1 }],
  fine: [{ p: 'Scala reale massima' }, { p: 'Doppia coppia di donne e jack', vince: 1240 }, { t: 'lascio', fuori: 1 }, { p: 'Full di donne e jack' }, { p: 'Carta alta: asso' }],
}

export function scenario(o = {}) {
  const q = new URLSearchParams(location.search)
  const gioco = o.gioco ?? q.get('gioco') ?? 'base'
  let fase = o.fase ?? q.get('fase') ?? 'puntate'
  const n = Number(o.n ?? q.get('n') ?? 6)
  const tele = gioco === 'telesina'
  if (tele && ['cambio', 'cambioattesa', 'secondo'].includes(fase)) fase = 'puntate'
  const chi = CHI[n - 1]
  const stati = STATI[fase]
  const giocatori = [{ giocatore_id: 'io', posto: 0, fiches: 1180, profili: { nickname: 'Luca' }, poste_in_arrivo: 0 }]
  const posti = []
  const azioni = []
  let id = 100, turno = 0
  chi.forEach((k, i) => {
    const a = AVV[k], s = stati[k], posto = i + 1
    giocatori.push({ giocatore_id: a.id, posto, fiches: a.f, profili: { nickname: a.n }, poste_in_arrivo: 0 })
    if (s.turno) turno = posto
    posti.push({
      giocatore_id: a.id, posto, stato: s.fuori ? 'fuori' : 'attivo',
      versato_giro: s.v ?? 0, versato_mano: s.v ?? 0,
      cambio: tele ? null : s.c ?? (fase === 'fine' ? 1 : null), cambio_pendente: 0,
      carte_mostrate: s.p ? a.h : null, punto: s.p ?? null, vincita: s.vince ?? 0,
      scoperte: tele ? a.h.slice(1) : null, tutto_dentro: !!s.tutto || (a.f === 0 && !s.fuori && fase !== 'fine'),
    })
    if (s.c != null && fase !== 'secondo') azioni.unshift({ id: id++, testo: '', giocatore_id: a.id, tipo: 'cambio', importo: s.c })
    if (s.t) azioni.unshift({ id: id++, testo: `${a.n}: ${s.t}`, giocatore_id: a.id, tipo: s.t, importo: s.v ?? 0 })
  })
  const mioVersato = ['puntate', 'attesa'].includes(fase) ? 20 : 0
  posti.unshift({
    giocatore_id: 'io', posto: 0, stato: 'attivo', versato_giro: mioVersato, versato_mano: mioVersato,
    cambio: fase === 'secondo' ? 2 : null, cambio_pendente: 0,
    carte_mostrate: fase === 'fine' ? MIE : null, punto: fase === 'fine' ? 'Coppia di re' : null, vincita: 0,
    scoperte: tele ? MIE.slice(1) : null, tutto_dentro: false,
  })
  const inGiro = posti.reduce((s, p) => s + p.versato_giro, 0)
  const vincitore = posti.find((p) => p.vincita > 0)
  const mano = {
    id: `m-${gioco}-${fase}-${n}`, numero: 7, gioco: tele ? 'telesina' : 'italiana',
    fase: fase === 'fine' ? 'finita' : tele ? 'telesina' : fase.startsWith('cambio') ? 'cambio' : fase === 'secondo' ? 'secondo_giro' : 'primo_giro',
    turno, piatto: fase === 'fine' ? 1240 : 455 + inGiro, puntata: Math.max(0, ...posti.map((p) => p.versato_giro)),
    mazziere: 2 % n, giro: tele ? 4 : 1, telesina_n: 2, telesina_di: n,
    con_vela: tele && q.get('vela') !== '0', vela: tele && fase === 'fine' ? 'QP' : null,
    esito: fase === 'fine' && vincitore ? { vincitori: [vincitore.giocatore_id], tipo: 'confronto' } : null,
    bassa: 11 - Math.min(Math.max(n, 4), 6), requisito: 11, buio_aperto: false, parol_possibile: false,
  }
  const tavolo = {
    id: 't1', nome: 'Tavolo del venerdì', mano_corrente: mano.id, valore_posta: 2000, organizzatore: 'io',
    regole: { limite: q.get('limite') ?? 'apertura', cambio_max: 4 }, avviato_il: new Date(Date.now() - 84 * 60000).toISOString(),
  }
  return { tavolo, giocatori, mano, posti, carte: MIE, azioni }
}

const dati = scenario()
const TABELLE = {
  mani: () => dati.mano,
  mani_giocatori: () => dati.posti,
  mani_carte: () => ({ carte: dati.carte }),
  mani_azioni: () => dati.azioni,
  messaggi: () => [],
}
function richiesta(tabella) {
  const r = {
    select: () => r, eq: () => r, order: () => r, limit: () => r, insert: () => r,
    maybeSingle: () => r, single: () => r,
    then: (ok, ko) => Promise.resolve({ data: TABELLE[tabella]?.() ?? null, error: null }).then(ok, ko),
  }
  return r
}
const canale = () => { const c = { on: () => c, subscribe: () => c, send: () => {} }; return c }
export const supabase = {
  from: richiesta,
  // Niente mano successiva nel banco di prova: la scena resta ferma su quella scelta
  rpc: async (nome) => ({ error: nome === 'nuova_mano' ? { message: 'prova' } : null }),
  channel: canale,
  removeChannel: () => {},
}
