import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import TavoloVerde from './TavoloVerde'
import { messaggioErrore } from './rotte'
import { fmt, invitoDi } from './regole'
import { durata } from './tempo'
import Chat from './Chat'
import { useChat } from './chat'

const COPPIA = { 11: 'fanti', 12: 'donne', 13: 're' }

export default function Gioco({ tavolo, giocatori, io }) {
  const [mano, setMano] = useState(null)
  const [posti, setPosti] = useState([])
  const [carte, setCarte] = useState([])
  const [registro, setRegistro] = useState([])
  const [scelte, setScelte] = useState([])
  const [importo, setImporto] = useState('')
  const [errore, setErrore] = useState('')
  const [attesa, setAttesa] = useState(false)
  const [pre, setPre] = useState(null)
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
    setRegistro(r.data ?? [])
  }, [idMano, io.id])

  useEffect(() => {
    carica()
    const canale = supabase
      .channel(`gioco-${tavolo.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mani_azioni', filter: `tavolo_id=eq.${tavolo.id}` }, carica)
      .subscribe()
    return () => { supabase.removeChannel(canale) }
  }, [tavolo.id, carica])

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


  // Riga dell'importo: campo e scorciatoie
  const rigaImporto = () => (
    <div className="puntata-riga">
      <label className="puntata-campo">
        <span className="nascosto">Importo</span>
        <input type="number" inputMode="numeric" min={invito} max={tetto ?? undefined} step={1}
          value={importo} placeholder={String(invito)} aria-label="Importo in Vardis"
          onChange={(e) => setImporto(e.target.value)} />
      </label>
      <button type="button" className="chip" onClick={() => setImporto(String(invito))}>Min</button>
      <button type="button" className="chip" onClick={() => setImporto(String(Math.max(invito, Math.floor((tetto ?? mano.piatto) / 2))))}>½ piatto</button>
      <button type="button" className="chip" onClick={() => setImporto(String(Math.max(invito, tetto ?? mano.piatto)))}>{tetto ? 'Max' : 'Piatto'}</button>
    </div>
  )

  // Pulsante grande: tono 'neutro' (passo, lascio), 'verde' (vedo, busso), 'oro' (apro, punto, rilancio)
  const grande = (testo, tono, onClick, sotto) => (
    <button type="button" className={`azione-grande ${tono}`} disabled={attesa} onClick={onClick}>
      <span>{testo}</span>
      {sotto && <small>{sotto}</small>}
    </button>
  )

  function azioni() {
    if (!mano || conclusa) return null
    if (!mio || mio.stato !== 'attivo') return <p className="tenue">Sei fuori da questa mano.</p>
    if (!mioTurno) return preAzioni()
    if (mano.fase === 'buio') {
      const nome = ['buio', 'controbuio', 'over'][mano.buio_livello]
      const quanto = mano.buio_livello === 0 ? mano.piatto : mano.buio_importo * 2
      return (
        <div className="azioni-gioco">
          <p>
            {mano.buio_livello === 0
              ? 'Puoi fare il buio prima di vedere le carte: costa quanto il piatto.'
              : `${nomeDi(mano.buio_di)} ha fatto il ${['', 'buio', 'controbuio'][mano.buio_livello]}. Puoi rispondere con il ${nome}.`}
          </p>
          <div className="griglia-azioni due">
            {grande(`Niente ${nome}`, 'neutro', () => rpc('buio', { p_mano: mano.id, p_faccio: false }))}
            {grande(`Faccio il ${nome}`, 'oro', () => rpc('buio', { p_mano: mano.id, p_faccio: true }), fmt(quanto))}
          </div>
        </div>
      )
    }
    if (mano.buio_aperto && mano.buio_di !== io.id) {
      return (
        <div className="azioni-gioco">
          <p>Dopo il buio puoi solo vedere o lasciare.</p>
          <div className="griglia-azioni due">
            {grande('Lascio', 'neutro', () => azione('passo'))}
            {grande('Vedo', 'verde', () => azione('vedo'), fmt(daVedere))}
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
              'oro', () => rpc('cambia', { p_mano: mano.id, p_scarti: scelte }))}
          </div>
        </div>
      )
    }
    // Giri di puntate: riga dell'importo sopra, pulsanti grandi sotto
    let pulsanti
    if (mano.buio_aperto) {
      pulsanti = [
        grande('Chiudo il giro', 'verde', () => azione('vedo')),
        grande('Rilancio', 'oro', () => azione('rilancio', valore), `+${fmt(valore)}`),
      ]
    } else if (mano.fase === 'apertura') {
      pulsanti = [
        grande('Passo', 'neutro', () => azione('passo')),
        grande('Apro', 'oro', () => azione('apro', valore), fmt(valore)),
      ]
    } else if (mano.puntata > 0) {
      pulsanti = [
        grande('Lascio', 'neutro', () => azione('passo')),
        daVedere > 0 ? grande('Vedo', 'verde', () => azione('vedo'), fmt(daVedere)) : null,
        grande('Rilancio', 'oro', () => azione('rilancio', valore), `+${fmt(valore)}`),
      ].filter(Boolean)
    } else {
      pulsanti = [
        grande('Busso', 'verde', () => azione('busso')),
        mano.parol_possibile ? grande('Parola', 'neutro', () => azione('parol')) : null,
        grande('Punto', 'oro', () => azione('punto', valore), fmt(valore)),
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
        <TavoloVerde
          mano={mano} posti={posti} giocatori={giocatori} io={io} carte={carte}
          scelte={scelte} onScegli={mano?.fase === 'cambio' && mioTurno ? scegli : null}
          azioni={registro} conclusa={conclusa} fumetti={fumetti}
        />

        <aside className="pannello" aria-label="Informazioni e comandi">
          <div className="pannello-testa">
            <h2>{mano ? `Mano ${mano.numero}` : 'Pronti a giocare'}</h2>
            {mano && <p className="piatto">Piatto <strong>{fmt(mano.piatto)}</strong></p>}
          </div>
          <p className="sotto-pannello">{tavolo.nome}, in gioco da {durata(tavolo.avviato_il)}</p>
          {mano && <p className="fase">{fase}</p>}

          <div className="comandi" ref={comandiRef}>
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

            {conclusa && (
              <button className="principale" disabled={attesa} onClick={() => rpc('nuova_mano', { p_tavolo: tavolo.id })}>
                {mano ? 'Distribuisci la prossima mano' : 'Distribuisci la prima mano'}
              </button>
            )}
          </div>

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
