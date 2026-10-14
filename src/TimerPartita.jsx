import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { ora } from './tempo'
import { suoniAttivi } from './suoni'
import { testoDurata } from './regole'
import { messaggioErrore } from './rotte'

const QUINDICI = 15 * 60 * 1000
const PROLUNGHE = [[15, '+15 min'], [30, '+30 min'], [60, '+1 ora']]

// Tempo che manca: "1 h 20 min", "40 min"; negli ultimi 15 minuti "14:05"
function testoMancano(ms) {
  if (ms <= 0) return 'Tempo scaduto'
  const sec = Math.ceil(ms / 1000)
  if (ms <= QUINDICI) return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  const minuti = Math.ceil(sec / 60)
  const h = Math.floor(minuti / 60), m = minuti % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

// Scelta della durata come un timer da cucina: ore e minuti (0 e 0 = senza limite)
export function SceltaDurata({ minuti, onCambia }) {
  const tot = Number(minuti) || 0
  const h = Math.floor(tot / 60), m = tot % 60
  return (
    <fieldset className="durata-scelta">
      <legend>Durata della partita</legend>
      <div className="durata-campi">
        <label>
          Ore
          <select value={h} onChange={(e) => onCambia(Number(e.target.value) * 60 + m)}>
            {Array.from({ length: 13 }, (_, i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>
        <label>
          Minuti
          <select value={m} onChange={(e) => onCambia(h * 60 + Number(e.target.value))}>
            {[0, 15, 30, 45].map((v) => <option key={v} value={v}>{String(v).padStart(2, '0')}</option>)}
          </select>
        </label>
      </div>
      <small>
        {tot > 0
          ? `Il timer parte quando inizia la partita e suona dopo ${testoDurata(tot)}.`
          : 'Con 0 ore e 0 minuti si gioca senza limite di tempo.'}
      </small>
    </fieldset>
  )
}

// Timer della partita nella barra del tavolo: tempo residuo, avviso a 15 minuti dalla fine
// e, allo scadere, la scelta dell'organizzatore: continuare o terminare.
// Il tempo vero lo tiene il server (fine_prevista).
export default function TimerPartita({ tavolo, organizzo, chiama, attesa }) {
  const [adesso, setAdesso] = useState(Date.now())
  useEffect(() => {
    const i = setInterval(() => setAdesso(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])

  // Avviso dei 15 minuti chiuso con "Ok": resta chiuso finché l'orario di fine non cambia
  const [chiuso, setChiuso] = useState(null)

  // Quando la partita viene allungata, lo vedono tutti per qualche secondo
  const [notizia, setNotizia] = useState('')
  const finePrima = useRef(tavolo.fine_prevista)
  const allungataIl = useRef(0)
  useEffect(() => {
    const prima = finePrima.current
    finePrima.current = tavolo.fine_prevista
    if (!prima || !tavolo.fine_prevista || Date.parse(tavolo.fine_prevista) <= Date.parse(prima)) return
    allungataIl.current = Date.now()
    setTermino(false)
    setNotizia(`Si continua per altri ${testoDurata(tavolo.ultimo_prolungamento)}: si finisce alle ${ora(tavolo.fine_prevista)}.`)
    const t = setTimeout(() => setNotizia(''), 7000)
    return () => clearTimeout(t)
  }, [tavolo.fine_prevista, tavolo.ultimo_prolungamento])

  // La finestra dello scadere si può ridurre a una striscia (per finire di giocare la mano)
  const [ridotto, setRidotto] = useState(null)

  // "Termina": se c'è ancora una mano in corso si aspetta che finisca, poi si chiude
  const [termino, setTermino] = useState(false)
  const [errore, setErrore] = useState('')
  useEffect(() => {
    if (!termino) return
    let attivo = true
    const prova = async () => {
      const { data, error } = await supabase.rpc('chiudi_per_tempo', { p_tavolo: tavolo.id })
      if (!attivo) return
      if (error) { setErrore(messaggioErrore(error)); setTermino(false) }
      else if (data) setTermino(false)          // chiuso: il tavolo passa al report da solo
    }
    prova()
    const i = setInterval(prova, 3000)
    return () => { attivo = false; clearInterval(i) }
  }, [termino, tavolo.id])

  const fine = tavolo.fine_prevista ? Date.parse(tavolo.fine_prevista) : null
  const pausa = tavolo.in_pausa_dal ? Date.parse(tavolo.in_pausa_dal) : null
  const resta = fine ? fine - (pausa ?? adesso) : null
  const scaduto = resta !== null && resta <= 0
  const ultimi = resta !== null && resta <= QUINDICI
  // Se è stata allungata di soli 15 minuti, l'avviso dei 15 minuti non ricompare subito
  const giaNegliUltimi = fine !== null && fine - allungataIl.current <= QUINDICI + 5000
  const chiave = String(tavolo.fine_prevista)
  const mostraAvviso = ultimi && !scaduto && !pausa && chiuso !== chiave && !giaNegliUltimi

  // Vibrazione quando compare l'avviso e quando scade il tempo
  const vibrato = useRef(null)
  const momento = scaduto ? `${chiave}|scaduto` : mostraAvviso ? `${chiave}|avviso` : null
  useEffect(() => {
    if (!momento || vibrato.current === momento) return
    vibrato.current = momento
    if (suoniAttivi()) navigator.vibrate?.(scaduto ? [200, 100, 200, 100, 200] : [120, 80, 120])
  }, [momento, scaduto])

  if (!fine) return null

  const minutiRimasti = Math.max(1, Math.ceil(resta / 60000))
  const prolunga = (min) => { setErrore(''); chiama('prolunga_partita', { p_tavolo: tavolo.id, p_minuti: min }) }

  return (
    <>
      <span className={`chip-tempo${ultimi ? ' ultimi' : ''}${scaduto ? ' scaduto' : ''}${pausa ? ' in-pausa' : ''}`}
        title={pausa ? 'Timer fermo: partita in pausa' : `Fine prevista alle ${ora(tavolo.fine_prevista)}`} role="timer" aria-live="off">
        <span aria-hidden="true">{pausa ? '⏸ ' : '⏱ '}</span>{testoMancano(resta)}
      </span>

      {mostraAvviso && (
        <div className="avviso-tempo" role="alert">
          <p>
            Mancano {minutiRimasti} {minutiRimasti === 1 ? 'minuto' : 'minuti'} alla fine della partita (alle {ora(tavolo.fine_prevista)}).
            {' '}{organizzo ? 'Puoi già allungarla:' : 'Allo scadere l’organizzatore decide se continuare.'}
          </p>
          <div className="avviso-tempo-tasti">
            {organizzo && PROLUNGHE.map(([min, testo]) => (
              <button key={min} className="chip-posta" disabled={attesa} onClick={() => prolunga(min)}>{testo}</button>
            ))}
            <button className="link-chiaro" onClick={() => setChiuso(chiave)}>Ok</button>
          </div>
        </div>
      )}

      {/* Tempo scaduto: gli altri aspettano, l'organizzatore sceglie */}
      {scaduto && !pausa && !organizzo && (
        <p className="avviso-tempo" role="status">
          Tempo scaduto: finita la mano in corso, l’organizzatore decide se continuare o terminare la partita.
        </p>
      )}
      {scaduto && !pausa && organizzo && ridotto === chiave && (
        <div className="avviso-tempo" role="status">
          <p>Tempo scaduto: {termino ? 'la partita si chiude appena finisce la mano.' : 'continuare o terminare?'}</p>
          {!termino && (
            <div className="avviso-tempo-tasti">
              {PROLUNGHE.map(([min, testo]) => (
                <button key={min} className="chip-posta" disabled={attesa} onClick={() => prolunga(min)}>{testo}</button>
              ))}
              <button className="link-chiaro" disabled={attesa} onClick={() => { setErrore(''); setTermino(true) }}>Termina</button>
            </div>
          )}
          {errore && <p className="errore" role="alert">{errore}</p>}
        </div>
      )}
      {scaduto && !pausa && organizzo && ridotto !== chiave && (
        <div className="timer-velo">
          <div className="timer-scaduto" role="alertdialog" aria-modal="true" aria-labelledby="timer-titolo">
            <p className="timer-sveglia" aria-hidden="true">⏰</p>
            <h2 id="timer-titolo">Tempo scaduto</h2>
            {termino ? (
              <p>La mano in corso deve finire: appena finisce il tavolo si chiude e compare il report della partita.</p>
            ) : (
              <>
                <p>Volete continuare? Per quanto tempo?</p>
                <div className="timer-scelte">
                  {PROLUNGHE.map(([min, testo]) => (
                    <button key={min} type="button" className="azione-grande verde" disabled={attesa} onClick={() => prolunga(min)}>
                      <span>{testo}</span>
                    </button>
                  ))}
                </div>
                <button type="button" className="azione-grande neutro timer-termina" disabled={attesa}
                  onClick={() => { setErrore(''); setTermino(true) }}>
                  <span>Termina la partita</span>
                </button>
              </>
            )}
            {errore && <p className="errore" role="alert">{errore}</p>}
            <button type="button" className="link-chiaro timer-dopo" onClick={() => setRidotto(chiave)}>
              {termino ? 'Torna al tavolo' : 'Decido dopo, torno al tavolo'}
            </button>
          </div>
        </div>
      )}

      {notizia && !mostraAvviso && !scaduto && <p className="avviso-tempo notizia" role="status">{notizia}</p>}
    </>
  )
}
