import { useEffect, useRef, useState } from 'react'
import { ora } from './tempo'
import { suoniAttivi } from './suoni'

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

// Timer della partita nella barra del tavolo: tempo residuo, avviso a 15 minuti dalla fine
// e, per l'organizzatore, i tasti per allungare. Il tempo vero lo tiene il server (fine_prevista).
export default function TimerPartita({ tavolo, organizzo, chiama, attesa }) {
  const [adesso, setAdesso] = useState(Date.now())
  useEffect(() => {
    const i = setInterval(() => setAdesso(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])

  // Avviso chiuso con "Ok": resta chiuso finché l'orario di fine non cambia
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
    setNotizia(`Partita allungata di ${tavolo.ultimo_prolungamento ?? ''} minuti: si finisce alle ${ora(tavolo.fine_prevista)}.`)
    const t = setTimeout(() => setNotizia(''), 7000)
    return () => clearTimeout(t)
  }, [tavolo.fine_prevista, tavolo.ultimo_prolungamento])

  const fine = tavolo.fine_prevista ? Date.parse(tavolo.fine_prevista) : null
  const resta = fine ? fine - adesso : null
  const scaduto = resta !== null && resta <= 0
  const ultimi = resta !== null && resta <= QUINDICI
  const chiave = `${tavolo.fine_prevista}|${scaduto ? 'scaduto' : 'avviso'}`
  // Se è stata allungata di soli 15 minuti, l'avviso dei 15 minuti non ricompare subito: resta quello dello scadere
  const giaNegliUltimi = fine !== null && fine - allungataIl.current <= QUINDICI + 5000
  const mostraAvviso = ultimi && chiuso !== chiave && (scaduto || !giaNegliUltimi)

  // Vibrazione leggera quando compare l'avviso
  const vibrato = useRef(null)
  useEffect(() => {
    if (!mostraAvviso || vibrato.current === chiave) return
    vibrato.current = chiave
    if (suoniAttivi()) navigator.vibrate?.([120, 80, 120])
  }, [mostraAvviso, chiave])

  if (!fine) return null

  const minutiRimasti = Math.max(1, Math.ceil(resta / 60000))
  const piattoInSospeso = tavolo.piatto_riporto > 0
  const finale = piattoInSospeso
    ? 'si continua finché qualcuno non vince il piatto rimasto, poi la partita si chiude'
    : 'la partita si chiude alla fine della mano in corso'

  return (
    <>
      <span className={`chip-tempo${ultimi ? ' ultimi' : ''}${scaduto ? ' scaduto' : ''}`}
        title={`Fine prevista alle ${ora(tavolo.fine_prevista)}`} role="timer" aria-live="off">
        <span aria-hidden="true">⏱ </span>{testoMancano(resta)}
      </span>

      {mostraAvviso && (
        <div className="avviso-tempo" role="alert">
          <p>
            {scaduto
              ? <>Tempo scaduto: {finale}.</>
              : <>Mancano {minutiRimasti} {minutiRimasti === 1 ? 'minuto' : 'minuti'} alla fine della partita (alle {ora(tavolo.fine_prevista)}).</>}
            {' '}
            {organizzo ? 'Vuoi allungare?' : 'L’organizzatore può decidere di allungarla.'}
          </p>
          <div className="avviso-tempo-tasti">
            {organizzo && PROLUNGHE.map(([min, testo]) => (
              <button key={min} className="chip-posta" disabled={attesa}
                onClick={() => chiama('prolunga_partita', { p_tavolo: tavolo.id, p_minuti: min })}>
                {testo}
              </button>
            ))}
            <button className="link-chiaro" onClick={() => setChiuso(chiave)}>
              {organizzo ? 'No, finiamo così' : 'Ok'}
            </button>
          </div>
        </div>
      )}

      {notizia && !mostraAvviso && <p className="avviso-tempo notizia" role="status">{notizia}</p>}
    </>
  )
}
