import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import TavoloVerde from './TavoloVerde'
import { messaggioErrore } from './rotte'
import { fmt, invitoDi } from './regole'
import { durata } from './tempo'
import Chat from './Chat'
import { useChat } from './chat'
import * as suoni from './suoni'

const COPPIA = { 11: 'fanti', 12: 'donne', 13: 're' }

export default function Gioco({ tavolo, giocatori, io, bot = new Set() }) {
  const [mano, setMano] = useState(null)
  const [posti, setPosti] = useState([])
  const [carte, setCarte] = useState([])
  const [carteDi, setCarteDi] = useState(null) // mano a cui appartengono le carte caricate
  const [registro, setRegistro] = useState([])
  const [scelte, setScelte] = useState([])
  const [importo, setImporto] = useState('')
  const [errore, setErrore] = useState('')
  const [attesa, setAttesa] = useState(false)
  const [pre, setPre] = useState(null)
  const ripeti = useRef(null)
  useEffect(() => () => { clearTimeout(ripeti.current?.t); clearInterval(ripeti.current?.i) }, [])
  const preInviata = useRef(false)

  const idMano = tavolo.mano_corrente

  // Altezza della barra dei comandi: su telefono è fissa in basso e la pagina lascia spazio sotto
  const comandiRef = useRef(null)
  useEffect(() => {
    const el = comandiRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() =>
      document.documentElement.style.setProperty('--h-comandi', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--h-comandi') }
  }, [])

  // Chat: i messaggi nuovi compaiono anche come fumetto sul tavolo per qualche secondo
  const [fumetti, setFumetti] = useState({})
  const { messaggi, invia } = useChat(tavolo.id, (m) => {
    setFumetti((f) => ({ ...f, [m.giocatore_id]: m }))
    setTimeout(() => setFumetti((f) => (f[m.giocatore_id]?.id === m.id
      ? Object.fromEntries(Object.entries(f).filter(([k]) => k !== m.giocatore_id)) : f)), 7000)
  })

  // Aggiorna la durata della serata ogni 30 secondi
  const [, setOrologio] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setOrologio((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  // Suoni: si suonano solo le azioni arrivate dopo l'apertura della pagina
  const caricato = useRef(false)
  const ultimaSuonata = useRef(null)
  const carteSuonate = useRef(new Set())

  const carica = useCallback(async () => {
    if (!idMano) { setMano(null); return }
    const [m, g, c, r] = await Promise.all([
      supabase.from('mani').select('*').eq('id', idMano).maybeSingle(),
      supabase.from('mani_giocatori').select('*').eq('mano_id', idMano).order('posto'),
      supabase.from('mani_carte').select('carte').eq('mano_id', idMano).eq('giocatore_id', io.id).maybeSingle(),
      supabase.from('mani_azioni').select('id, testo, giocatore_id, tipo, importo').eq('mano_id', idMano).order('id', { ascending: false }).limit(40),
    ])
    setMano(m.data ?? null)
    setPosti(g.data ?? [])
    setCarte(c.data?.carte ?? [])
    setCarteDi(idMano)
    setRegistro(r.data ?? [])
    caricato.current = true
  }, [idMano, io.id])

  useEffect(() => {
    carica()
    const canale = supabase
      .channel(`gioco-${tavolo.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mani_azioni', filter: `tavolo_id=eq.${tavolo.id}` }, carica)
      .subscribe()
    return () => { supabase.removeChannel(canale) }
  }, [tavolo.id, carica])

  useEffect(() => {
    if (!caricato.current) return
    const massimo = registro.reduce((m, a) => Math.max(m, a.id), 0)
    if (ultimaSuonata.current === null) {
      ultimaSuonata.current = massimo
      if (idMano) carteSuonate.current.add(idMano) // la mano già in corso non si ridistribuisce
      return
    }
    const nuove = registro.filter((a) => a.id > ultimaSuonata.current).sort((a, b) => a.id - b.id)
    ultimaSuonata.current = Math.max(ultimaSuonata.current, massimo)
    const inv = invitoDi(tavolo)
    const suona = (a) => {
      switch (a.tipo) {
        case 'mano': suoni.mescola(); break
        case 'apro': case 'vedo': case 'rilancio': case 'punto':
        case 'buio': case 'controbuio': case 'over': case 'copro': case 'posta':
          suoni.fiches(suoni.quanteFiches(a.importo, inv)); break
        case 'cambio':
          if (a.importo > 0) { suoni.scarta(); setTimeout(() => suoni.distribuisci(a.importo, 0.1), 300) }
          break
        case 'lascio': suoni.lascia(); break
        case 'vince': suoni.vincita(); break
        default: break
      }
    }
    // La prima subito (così il mescolare parte prima della distribuzione), le altre in fila
    nuove.forEach((a, k) => (k === 0 ? suona(a) : setTimeout(() => suona(a), k * 220)))
  }, [registro])

  // Carte distribuite: un flic per ogni carta data al tavolo, una volta per mano
  useEffect(() => {
    if (!caricato.current || ultimaSuonata.current === null || carteDi !== idMano || !idMano) return
    if (carte.length !== 5 || carteSuonate.current.has(idMano)) return
    carteSuonate.current.add(idMano)
    suoni.distribuisci(5 * Math.max(posti.length, 1), 0.07)
  }, [carte, carteDi, idMano, posti.length])

  // Giocatori automatici: quando tocca a uno di loro, un giocatore vero chiede al server di farlo giocare.
  // Lo fa il primo giocatore vero al tavolo; gli altri subentrano solo se lui non risponde.
  const [tentativoBot, setTentativoBot] = useState(0)
  const turnoDi = posti.find((p) => p.posto === mano?.turno)?.giocatore_id
  const tocca_a_bot = !!(mano && turnoDi && bot.has(turnoDi) &&
    ['buio', 'apertura', 'primo_giro', 'cambio', 'secondo_giro'].includes(mano.fase))
  const regista = giocatori.filter((g) => !bot.has(g.giocatore_id)).sort((a, b) => a.posto - b.posto)[0]?.giocatore_id === io.id
  useEffect(() => {
    if (!tocca_a_bot) return
    const t = setTimeout(async () => {
      const { error } = await supabase.rpc('gioca_bot', { p_mano: mano.id })
      if (error) setTimeout(() => setTentativoBot((n) => n + 1), 2000)
      else carica()
    }, regista ? 900 + Math.random() * 900 : 8000 + Math.random() * 2000)
    return () => clearTimeout(t)
  }, [tocca_a_bot, mano?.id, mano?.turno, mano?.fase, registro.length, regista, tentativoBot])

  // Nuova fase o nuovo turno: azzera scelte e importo
  useEffect(() => { setScelte([]); setImporto('') }, [mano?.fase, mano?.turno, idMano])

  async function rpc(nome, parametri) {
    setErrore('')
    setAttesa(true)
    const { error } = await supabase.rpc(nome, parametri)
    setAttesa(false)
    if (error) { setErrore(messaggioErrore(error)); return false }
    await carica()
    return true
  }

  const nomeDi = (id) => giocatori.find((g) => g.giocatore_id === id)?.profili?.nickname ?? 'giocatore'
  const fichesDi = (id) => giocatori.find((g) => g.giocatore_id === id)?.fiches ?? 0

  // Nessuna mano ancora, oppure mano conclusa
  const conclusa = !mano || mano.fase === 'finita' || mano.fase === 'annullata'

  // Mano successiva in automatico: qualche secondo per guardare com'è finita, poi si distribuisce.
  // La avvia il primo giocatore vero al tavolo; gli altri subentrano solo se lui non c'è.
  const [traSecondi, setTraSecondi] = useState(null)
  const prontaNuova = caricato.current && (idMano ? (mano?.id === idMano && conclusa) : true)
  useEffect(() => {
    if (!prontaNuova) { setTraSecondi(null); return }
    const pausa = idMano ? 7000 : 3000
    const ritardo = pausa + (regista ? 0 : 6000)
    const fine = Date.now() + pausa
    setTraSecondi(Math.ceil(pausa / 1000))
    const conta = setInterval(() => setTraSecondi(Math.max(0, Math.ceil((fine - Date.now()) / 1000))), 250)
    const via = setTimeout(async () => {
      // Se un altro giocatore l'ha già distribuita, il server risponde con un errore che si può ignorare
      const { error } = await supabase.rpc('nuova_mano', { p_tavolo: tavolo.id })
      if (!error) carica()
    }, ritardo)
    return () => { clearInterval(conta); clearTimeout(via) }
  }, [prontaNuova, idMano, regista, tavolo.id])

  const mio = posti.find((p) => p.giocatore_id === io.id)
  const mioTurno = !!mano && !!mio && mio.stato === 'attivo' && mano.turno === mio.posto
  const diTurno = posti.find((p) => p.posto === mano?.turno)
  const invito = invitoDi(tavolo)
  const daVedere = mano && mio ? mano.puntata - mio.versato_giro : 0
  const limite = tavolo.regole?.limite ?? 'apertura'
  const tetto = !mano ? null
    : limite === 'piatto' || (limite === 'apertura' && mano.fase === 'apertura') ? mano.piatto + daVedere
    : limite === 'fisso' ? Number(tavolo.regole?.puntata_massima) || null
    : null
  const cambioMax = Number(tavolo.regole?.cambio_max) || 4
  const valore = importo === '' ? invito : Number(importo)

  function scegli(c) {
    setScelte((s) => s.includes(c) ? s.filter((x) => x !== c) : s.length < cambioMax ? [...s, c] : s)
  }

  const azione = (tipo, imp = 0) => rpc('azione', { p_mano: mano.id, p_tipo: tipo, p_importo: imp })

  // Pre-azione: quando arriva il mio turno la eseguo, purché la situazione sia la stessa di quando l'ho scelta
  useEffect(() => {
    if (!pre || !mano) return
    const cambiata = pre.mano !== mano.id || pre.fase !== mano.fase
    if (cambiata) { setPre(null); return }
    const mioOra = mio && mio.stato === 'attivo' && mano.turno === mio.posto
    const dv = mio ? mano.puntata - mio.versato_giro : 0
    // Se qualcuno ha rilanciato dopo la scelta, "Vedo" e "Busso" non valgono più
    if ((pre.tipo === 'vedo' && dv !== pre.daVedere) || (pre.tipo === 'busso' && mano.puntata > 0)) { setPre(null); return }
    if (!mioOra || preInviata.current) return
    preInviata.current = true
    const tipo = pre.tipo
    setPre(null)
    azione(tipo).finally(() => { preInviata.current = false })
  }, [pre, mano, mio])


  // Riga dell'importo: frecce per scendere e salire, campo e scorciatoie
  const passo = invito
  const limita = (v) => Math.max(invito, tetto ? Math.min(v, tetto) : v)
  const cambiaImporto = (verso) => setImporto((attuale) => {
    const v = attuale === '' ? invito : Number(attuale) || invito
    return String(limita(v + verso * passo))
  })
  const rigaImporto = () => (
    <div className="puntata-riga">
      <div className="importo-frecce">
        <Freccia verso={-1} onPasso={cambiaImporto} disabled={attesa || valore <= invito} etichetta={`Diminuisci di ${fmt(passo)}`} />
        <label className="puntata-campo">
          <span className="nascosto">Importo</span>
          <input type="number" inputMode="numeric" min={invito} max={tetto ?? undefined} step={passo}
            value={importo} placeholder={String(invito)} aria-label="Importo in Vardis"
            onChange={(e) => setImporto(e.target.value)} />
        </label>
        <Freccia verso={1} onPasso={cambiaImporto} disabled={attesa || (tetto != null && valore >= tetto)} etichetta={`Aumenta di ${fmt(passo)}`} />
      </div>
      <button type="button" className="chip" onClick={() => setImporto(String(invito))}>Min</button>
      <button type="button" className="chip" onClick={() => setImporto(String(limita(Math.floor((tetto ?? mano.piatto) / 2))))}>½ piatto</button>
      <button type="button" className="chip" onClick={() => setImporto(String(limita(tetto ?? mano.piatto)))}>{tetto ? 'Max' : 'Piatto'}</button>
    </div>
  )

  // Pulsante grande: titolo con l'eventuale cifra, e sotto una riga che spiega cosa succede
  const grande = (testo, tono, onClick, spiega) => (
    <button type="button" className={`azione-grande ${tono}`} disabled={attesa} onClick={onClick} title={spiega}>
      <span>{testo}</span>
      {spiega && <small>{spiega}</small>}
    </button>
  )

  function azioni() {
    if (!mano || conclusa) return null
    if (!mio || mio.stato !== 'attivo') return <p className="tenue">Sei fuori da questa mano.</p>
    if (!mioTurno) return preAzioni()
    if (mano.fase === 'buio' && mano.buio_da_chiedere?.[0] === io.id) {
      // Prima delle carte: coprire il controbuio o l'over per conservare il diritto di rilancio
      const cosa = mano.buio_livello === 2 ? 'il controbuio' : 'l’over'
      const diff = mano.buio_importo - (mio.versato_giro ?? 0)
      return (
        <div className="azioni-gioco">
          <p>
            {nomeDi(mano.buio_di)} ha fatto {cosa}. Se lo copri adesso, prima di vedere le carte, aggiungi {fmt(diff)} e
            conservi il diritto di rilanciare.
          </p>
          <div className="griglia-azioni due">
            {grande('Non copro', 'neutro', () => rpc('copri_buio', { p_mano: mano.id, p_copro: false }),
              'Dopo aver visto le carte potrai solo vedere o lasciare')}
            {grande(`Copro ${cosa} +${fmt(diff)}`, 'oro', () => rpc('copri_buio', { p_mano: mano.id, p_copro: true }),
              'Metti la differenza al buio e potrai rilanciare')}
          </div>
        </div>
      )
    }
    if (mano.fase === 'buio') {
      const nome = ['buio', 'controbuio', 'over'][mano.buio_livello]
      const quanto = mano.buio_livello === 0 ? mano.piatto : mano.buio_importo * 2
      // Protezione: chi ha già fatto un buio in questa mano non può rilanciarlo (l'over spetta al terzo)
      const giaBuio = registro.some((a) => a.giocatore_id === io.id && ['buio', 'controbuio', 'over'].includes(a.tipo))
      if (giaBuio) {
        return (
          <div className="azioni-gioco">
            <p>Hai già fatto un buio in questa mano: non puoi rispondere con il {nome}.</p>
            <div className="griglia-azioni">
              {grande('Avanti', 'neutro', () => rpc('buio', { p_mano: mano.id, p_faccio: false }), 'Si prosegue e si distribuiscono le carte')}
            </div>
          </div>
        )
      }
      return (
        <div className="azioni-gioco">
          <p>
            {mano.buio_livello === 0
              ? 'Puoi fare il buio prima di vedere le carte: costa quanto il piatto.'
              : `${nomeDi(mano.buio_di)} ha fatto il ${['', 'buio', 'controbuio'][mano.buio_livello]}. Puoi rispondere con il ${nome}.`}
          </p>
          <div className="griglia-azioni due">
            {grande(`Niente ${nome}`, 'neutro', () => rpc('buio', { p_mano: mano.id, p_faccio: false }), 'Non punti al buio: si distribuiscono le carte')}
            {grande(`Faccio il ${nome} ${fmt(quanto)}`, 'oro', () => rpc('buio', { p_mano: mano.id, p_faccio: true }), 'Punti prima di vedere le carte')}
          </div>
        </div>
      )
    }
    const hoDiritto = mano.buio_di === io.id || (mano.buio_coperti ?? []).includes(io.id)
    if (mano.buio_aperto && !hoDiritto) {
      // Coprire il buio: chi non ha messo buii paga l'ultimo per intero,
      // chi aveva già messo buio o controbuio aggiunge solo la differenza
      const cosa = ['', 'il buio', 'il controbuio', 'l’over'][mano.buio_livello]
      const giaMesso = mio.versato_giro > 0
      return (
        <div className="azioni-gioco">
          <p>
            {giaMesso
              ? `${nomeDi(mano.buio_di)} ha fatto ${cosa}: per restare in gioco aggiungi la differenza.`
              : `C’è ${cosa} di ${fmt(mano.puntata)}: per giocare devi coprirlo, altrimenti lasci.`}
          </p>
          <div className="griglia-azioni due">
            {grande('Lascio', 'neutro', () => azione('passo'),
              giaMesso ? 'Esci dalla mano: perdi quanto hai già messo' : 'Esci dalla mano')}
            {grande(`Copro ${cosa} ${fmt(daVedere)}`, 'verde', () => azione('vedo'),
              giaMesso ? `Aggiungi ${fmt(daVedere)} e resti in gioco` : 'Metti la stessa cifra e resti in gioco')}
          </div>
        </div>
      )
    }
    if (mano.fase === 'cambio') {
      return (
        <div className="azioni-gioco">
          <p>Tocca le carte da scartare (al massimo {cambioMax}).</p>
          <div className="griglia-azioni uno">
            {grande(scelte.length === 0 ? 'Sono servito' : scelte.length === 1 ? 'Cambio 1 carta' : `Cambio ${scelte.length} carte`,
              'oro', () => rpc('cambia', { p_mano: mano.id, p_scarti: scelte }),
              scelte.length === 0 ? 'Tieni le tue 5 carte' : 'Scarti le carte scelte e ne ricevi di nuove')}
          </div>
        </div>
      )
    }
    // Giri di puntate: riga dell'importo sopra, pulsanti grandi sotto
    let pulsanti
    if (mano.buio_aperto) {
      pulsanti = [
        mano.buio_di === io.id
          ? grande('Chiudo il giro', 'verde', () => azione('vedo'), 'Non rilanci e si passa al cambio')
          : grande('Non rilancio', 'verde', () => azione('vedo'), 'Hai coperto il buio: resti in gioco senza rilanciare'),
        grande(`Rilancio +${fmt(valore)}`, 'oro', () => azione('rilancio', valore), 'Alzi la puntata: gli altri devono pareggiare'),
      ]
    } else if (mano.fase === 'apertura') {
      pulsanti = [
        grande('Passo', 'neutro', () => azione('passo'), 'Non apri: la parola passa al prossimo'),
        grande(`Apro ${fmt(valore)}`, 'oro', () => azione('apro', valore), 'Apri il gioco con questa puntata'),
      ]
    } else if (mano.puntata > 0) {
      pulsanti = [
        grande('Lascio', 'neutro', () => azione('passo'), 'Esci dalla mano: perdi quanto hai già puntato'),
        daVedere > 0 ? grande(`Vedo ${fmt(daVedere)}`, 'verde', () => azione('vedo'), 'Pareggi la puntata e resti in gioco') : null,
        grande(`Rilancio +${fmt(valore)}`, 'oro', () => azione('rilancio', valore), 'Alzi la puntata: gli altri devono pareggiare'),
      ].filter(Boolean)
    } else {
      pulsanti = [
        grande('Busso', 'verde', () => azione('busso'), 'Non punti ma resti in gioco'),
        mano.parol_possibile ? grande('Parola', 'neutro', () => azione('parol'), 'Non punti; se la dicono tutti la mano si annulla') : null,
        grande(`Punto ${fmt(valore)}`, 'oro', () => azione('punto', valore), 'Punti per primo: gli altri devono vedere o lasciare'),
      ].filter(Boolean)
    }
    return (
      <div className="azioni-gioco">
        {rigaImporto()}
        <div className={`griglia-azioni ${['', 'uno', 'due', 'tre'][pulsanti.length]}`}>
          {pulsanti.map((b, k) => <span key={k} className="cella">{b}</span>)}
        </div>
        <small className="limiti">Minimo {fmt(invito)}{tetto ? `, massimo ${fmt(tetto)}` : ', nessun massimo'}</small>
      </div>
    )
  }

  // Pre-azioni: quando non è il tuo turno puoi scegliere in anticipo cosa fare
  function preAzioni() {
    const fasiPuntata = ['apertura', 'primo_giro', 'secondo_giro']
    if (!fasiPuntata.includes(mano.fase)) return null
    const scelte = mano.fase === 'apertura'
      ? [['passo', 'Passo']]
      : mano.puntata > 0
        ? [['passo', 'Lascio'], ...(daVedere > 0 ? [['vedo', `Vedo ${fmt(daVedere)}`]] : [])]
        : [['busso', 'Busso']]
    const attiva = (tipo) => pre && pre.tipo === tipo
    return (
      <div className="pre-azioni" role="group" aria-label="Scegli in anticipo">
        <span className="pre-titolo">Quando tocca a te:</span>
        {scelte.map(([tipo, testo]) => (
          <label key={tipo} className={`pre-scelta${attiva(tipo) ? ' attiva' : ''}`}>
            <input type="checkbox" checked={attiva(tipo)}
              onChange={(e) => setPre(e.target.checked
                ? { tipo, mano: mano.id, fase: mano.fase, daVedere, puntata: mano.puntata }
                : null)} />
            {testo}
          </label>
        ))}
      </div>
    )
  }

  const fase = !mano ? '' : {
    buio: 'Buio: prima di vedere le carte',
    apertura: `Apertura: serve almeno una coppia di ${COPPIA[mano.requisito]}`,
    primo_giro: 'Primo giro di puntate',
    cambio: 'Cambio delle carte',
    secondo_giro: 'Secondo giro di puntate',
    finita: 'Mano conclusa',
    annullata: 'Mano annullata',
  }[mano.fase]

  const mostrate = posti.filter((p) => p.carte_mostrate || p.vincita > 0)

  return (
    <section className="gioco">
      <div className="gioco-griglia">
        <div className="zona-tavolo">
        <TavoloVerde
            mano={mano} posti={posti} giocatori={giocatori} io={io} carte={carte}
            scelte={scelte} onScegli={mano?.fase === 'cambio' && mioTurno ? scegli : null}
            azioni={registro} conclusa={conclusa} fumetti={fumetti}
          />

          <div className="comandi console" ref={comandiRef} aria-label="Comandi di gioco">
            {mano && !conclusa && diTurno && (
              <p className={`turno${mioTurno ? ' mio' : ''}`} role="status">
                {mioTurno
                  ? (mano.fase === 'cambio' ? 'Tocca a te: scegli le carte da cambiare' : 'Tocca a te')
                  : `Tocca a ${nomeDi(diTurno.giocatore_id)}`}
              </p>
            )}

            {errore && (
              <div className="errore-gioco" role="alert">
                <p className="errore">{errore}</p>
                {errore.includes('fiches') && (
                  <button className="secondario" disabled={attesa}
                    onClick={() => rpc('prendi_posta', { p_tavolo: tavolo.id })}>
                    Prendi un’altra posta ({fmt(tavolo.valore_posta)})
                  </button>
                )}
              </div>
            )}

            {azioni()}

            {conclusa && traSecondi !== null && (
              <p className="prossima-mano" role="status">
                {traSecondi > 0
                  ? `${mano ? 'Prossima mano' : 'Prima mano'} tra ${traSecondi} ${traSecondi === 1 ? 'secondo' : 'secondi'}…`
                  : 'Si distribuiscono le carte…'}
              </p>
            )}
          </div>

        </div>

        <aside className="pannello" aria-label="Informazioni sul tavolo e chat">
          <div className="pannello-testa">
            <h2>{mano ? `Mano ${mano.numero}` : 'Pronti a giocare'}</h2>
            {mano && <p className="piatto">Piatto <strong>{fmt(mano.piatto)}</strong></p>}
          </div>
          <p className="sotto-pannello">{tavolo.nome}, in gioco da {durata(tavolo.avviato_il)}</p>
          {mano && <p className="fase">{fase}</p>}

          <div className="pannello-scorre">
            {mano && !conclusa && mio && (
              <dl className="dati-mano">
                <div><dt>Le tue fiches</dt><dd>{fmt(fichesDi(io.id))}</dd></div>
                {mano.puntata > 0 && <div><dt>Puntata da pareggiare</dt><dd>{fmt(mano.puntata)}</dd></div>}
                {daVedere > 0 && <div><dt>Per vedere ti servono</dt><dd>{fmt(daVedere)}</dd></div>}
              </dl>
            )}

            {conclusa && mano && mostrate.length > 0 && (
              <ul className="esito">
                {mostrate.map((p) => (
                  <li key={p.giocatore_id} className={p.vincita > 0 ? 'vincente' : ''}>
                    <span>{nomeDi(p.giocatore_id)}</span>
                    <span>{p.punto ?? 'non mostra le carte'}{p.vincita > 0 ? `: vince ${fmt(p.vincita)}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}

            <Chat messaggi={messaggi} invia={invia} nomeDi={nomeDi} io={io} />

            {registro.length > 0 && (
              <details className="cronaca-box">
                <summary>Cronaca della mano</summary>
                <ol className="cronaca">
                  {registro.slice(0, 10).map((r) => <li key={r.id}>{r.testo}</li>)}
                </ol>
              </details>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}

// Freccia per l'importo: un tocco cambia di un passo, tenendola premuta continua sempre più veloce
function Freccia({ verso, onPasso, disabled, etichetta }) {
  const timer = useRef(null)
  const ferma = () => { clearTimeout(timer.current); timer.current = null }
  const avvia = (e) => {
    if (disabled) return
    e.preventDefault()
    onPasso(verso)
    let ritardo = 400
    const ripeti = () => {
      onPasso(verso)
      ritardo = Math.max(60, ritardo * 0.8)
      timer.current = setTimeout(ripeti, ritardo)
    }
    timer.current = setTimeout(ripeti, ritardo)
  }
  useEffect(() => ferma, [])
  useEffect(() => { if (disabled) ferma() }, [disabled])
  return (
    <button type="button" className="freccia" disabled={disabled} aria-label={etichetta} title={etichetta}
      onPointerDown={avvia} onPointerUp={ferma} onPointerLeave={ferma} onPointerCancel={ferma}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPasso(verso) } }}
      onContextMenu={(e) => e.preventDefault()}>
      {verso < 0 ? '−' : '+'}
    </button>
  )
}
