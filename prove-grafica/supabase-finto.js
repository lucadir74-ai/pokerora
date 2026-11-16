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

// ── Pagine fuori dal tavolo: lobby, sala d'attesa, tavolo chiuso, giocatori, messaggi ──
const fa = (min) => new Date(Date.now() - min * 60000).toISOString()
const REGOLE = { mazzo: 'regola11', limite: 'apertura', cambio_max: 4, buio: 'si', durata: 120, giochi: 'entrambi', vela: 'si', invito: 20 }
const TAVOLI = [
  { ...dati.tavolo, id: 't1', nome: 'Tavolo del venerdì', stato: 'in_corso', posti: 6, organizzatore: 'io', creato_il: fa(200), avviato_il: fa(84), valore_posta: 2000, regole: REGOLE, codice_invito: 'K7QP2A', tavolo_giocatori: [{ count: 5 }] },
  { id: 't2', nome: 'Sabato da Marco', stato: 'attesa', posti: 5, organizzatore: 'io', creato_il: fa(30), valore_posta: 2000, regole: REGOLE, codice_invito: 'M4RC0X', tavolo_giocatori: [{ count: 3 }] },
  { id: 't3', nome: 'Torneo di Natale', stato: 'chiuso', posti: 4, organizzatore: 'a1', creato_il: fa(9000), avviato_il: fa(8900), chiuso_il: fa(8700), valore_posta: 1000, regole: REGOLE, codice_invito: 'N4T4LE', prolungamenti: 1, tavolo_giocatori: [{ count: 4 }] },
]
const SEDUTI = [
  { posto: 1, giocatore_id: 'io', fiches: 1180, poste_in_arrivo: 0, esce_a_fine_mano: false, profili: { nickname: 'Luca' } },
  { posto: 2, giocatore_id: 'a1', fiches: 2450, poste_in_arrivo: 0, esce_a_fine_mano: false, profili: { nickname: 'Marco' } },
  { posto: 3, giocatore_id: 'a2', fiches: 4120, poste_in_arrivo: 0, esce_a_fine_mano: false, profili: { nickname: 'Massimiliano' } },
  { posto: 4, giocatore_id: 'a4', fiches: 250, poste_in_arrivo: 0, esce_a_fine_mano: false, profili: { nickname: 'Gigi' } },
]
const POSTE = [
  ...SEDUTI.map((g, i) => ({ id: i + 1, giocatore_id: g.giocatore_id, numero: 1, valore: 2000, presa_il: fa(84) })),
  { id: 9, giocatore_id: 'a4', numero: 2, valore: 2000, presa_il: fa(40) },
]
const ISCRITTI = [
  { id: 'a1', nickname: 'Marco', nome: 'Marco', cognome: 'Bianchi', email: 'marco@example.com', telefono: '+393331234567', da_leggere: 2 },
  { id: 'a2', nickname: 'Massimiliano', da_leggere: 0 },
  { id: 'a3', nickname: 'Sara', nome: 'Sara', cognome: 'Verdi', da_leggere: 0 },
  { id: 'a5', nickname: 'Antonella', da_leggere: 0 },
]
const PRIVATI = [
  { id: 31, mittente: 'a1', destinatario: 'io', testo: 'Ti invito al mio tavolo “Sabato da Marco”.', codice_invito: 'M4RC0X', creato_il: fa(25), letto_il: null },
  { id: 30, mittente: 'io', destinatario: 'a1', testo: 'Sabato ci sono, a che ora?', codice_invito: null, creato_il: fa(60), letto_il: fa(50) },
  { id: 29, mittente: 'a3', destinatario: 'io', testo: 'Bella partita ieri!', codice_invito: null, creato_il: fa(1500), letto_il: fa(1400) },
]
const CHAT = [
  { id: 1, giocatore_id: 'a1', testo: 'Arrivo tra cinque minuti', creato_il: fa(12) },
  { id: 2, giocatore_id: 'io', testo: 'Va bene, ti aspettiamo', creato_il: fa(11) },
]
const TABELLE = {
  mani: () => [dati.mano],
  mani_giocatori: () => dati.posti,
  mani_carte: () => [{ carte: dati.carte }],
  mani_azioni: () => dati.azioni,
  messaggi: () => CHAT,
  tavoli: (f) => TAVOLI.filter((t) => Object.entries(f).every(([k, v]) => !(k in t) || t[k] === v)),
  tavolo_giocatori: (f) => (f.tavolo_id === 't2' ? SEDUTI.slice(0, 3) : f.tavolo_id === 't1' ? dati.giocatori : SEDUTI),
  poste: () => POSTE,
  tavolo_usciti: () => [],
  richieste_ingresso: () => [],
  giocatori_automatici: () => [{ id: 'a4' }],
  messaggi_privati: () => PRIVATI,
  profili: (f) => [{ id: f.id ?? 'a1', nickname: ISCRITTI.find((p) => p.id === f.id)?.nickname ?? 'Marco' }],
  profili_privati: () => [{ mostra_nome: true, mostra_email: false, mostra_telefono: false, telefono: null }],
}
const FUNZIONI = {
  nuova_mano: () => ({ error: { message: 'prova' } }),   // la scena resta ferma su quella scelta
  elenco_giocatori: () => ({ data: ISCRITTI }),
  sono_gestore: () => ({ data: true }),
  tavoli_aperti_gestione: () => ({ data: TAVOLI.filter((t) => t.stato !== 'chiuso').map((t) => ({ tavolo_id: t.id, tavolo_nome: t.nome, tavolo_stato: t.stato, organizzatore_nick: 'Luca', seduti: 3, posti_totali: t.posti, ultima_attivita: fa(5) })) }),
  info_invito: () => ({ data: [{ nome: 'Sabato da Marco', stato: 'attesa', posti: 5, occupati: 3, gia_seduto: false, organizzatore: 'Marco' }] }),
  invitati_tavolo: () => ({ data: [{ giocatore_id: 'a3', nickname: 'Sara', invitato_da: 'Luca', letto: true }] }),
  nickname_disponibile: () => ({ data: true }),
}
function richiesta(tabella) {
  const filtri = {}
  let uno = false, conta = false
  const r = {
    select: (_c, o) => { if (o?.head) conta = true; return r },
    eq: (k, v) => { filtri[k] = v; return r },
    is: () => r, or: () => r, in: () => r, order: () => r, limit: () => r, insert: () => r, update: () => r,
    maybeSingle: () => { uno = true; return r }, single: () => { uno = true; return r },
    then: (ok, ko) => {
      const righe = TABELLE[tabella]?.(filtri) ?? []
      const esito = conta ? { count: righe.filter((x) => x.letto_il === null).length, data: null, error: null }
        : { data: uno ? righe[0] ?? null : righe, error: null }
      return Promise.resolve(esito).then(ok, ko)
    },
  }
  return r
}
// Canale in tempo reale finto: accetta qualunque chiamata e non fa niente
const canale = () => {
  const c = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' || typeof k === 'symbol' ? undefined : k === 'presenceState' ? () => ({}) : () => c),
    apply: () => c,
  })
  return c
}
export const supabase = {
  from: richiesta,
  rpc: (nome) => Promise.resolve({ data: null, error: null, ...(FUNZIONI[nome]?.() ?? {}) }),
  channel: canale,
  removeChannel: () => {},
  functions: { invoke: async () => ({ data: null, error: { message: 'prova' } }) },
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'io' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({}), signInWithPassword: async () => ({ error: { message: 'prova' } }),
    signUp: async () => ({ data: {}, error: { message: 'prova' } }), resetPasswordForEmail: async () => ({ error: null }),
    updateUser: async () => ({ error: null }),
  },
}
