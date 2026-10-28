import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Report di fine partita: dimostra che il mazzo e la distribuzione sono stati regolari.
// Prima di ogni mano la cronaca mostra l’impronta (SHA-256) del mazzo mescolato;
// a tavolo chiuso si rivelano mazzi e chiavi, e chiunque può ricalcolare le impronte.

async function sha256(testo) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(testo))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function Voce({ ok, children }) {
  return (
    <li style={{ listStyle: 'none', margin: '0.3rem 0' }}>
      <span className={ok ? 'positivo' : 'negativo'}>{ok ? '✔' : '✘'}</span> {children}
    </li>
  )
}

export default function ControlloDistribuzione({ tavoloId }) {
  const [r, setR] = useState(null)
  const [errore, setErrore] = useState(null)
  const [ricalcolo, setRicalcolo] = useState(null)

  useEffect(() => {
    supabase.rpc('report_distribuzione', { p_tavolo: tavoloId })
      .then(({ data, error }) => (error ? setErrore(error.message) : setR(data)))
  }, [tavoloId])

  async function ricalcola() {
    setRicalcolo('…')
    let giuste = 0
    for (const m of r.mazzi) if ((await sha256(`${m.mazzo}|${m.chiave}`)) === m.impronta) giuste++
    setRicalcolo(`${giuste} su ${r.mazzi.length}`)
  }

  if (errore) return <p className="tenue">Controllo della distribuzione non disponibile.</p>
  if (!r) return <p className="tenue">Controllo della distribuzione in corso…</p>
  if (r.mani === 0) return null

  const v = r.verificabili
  const tuttoOk = v > 0 && r.impronte_ok === v && r.mazzi_ok === v && r.distribuzioni_ok === v && r.carte_doppie === 0

  return (
    <>
      <h3>Controllo della distribuzione</h3>
      <p className={tuttoOk ? 'positivo' : v === 0 ? 'tenue' : 'negativo'}>
        {tuttoOk ? 'Distribuzione regolare: nessun errore trovato.'
          : v === 0 ? 'Le mani di questa partita sono state giocate prima che il controllo fosse attivo.'
          : 'Trovate anomalie nella distribuzione: segnalalo all’organizzatore.'}
      </p>
      {v > 0 && (
        <ul style={{ padding: 0 }}>
          <Voce ok={r.impronte_ok === v}>Ogni mazzo corrisponde all’impronta annunciata prima della mano ({r.impronte_ok} su {v})</Voce>
          <Voce ok={r.mazzi_ok === v}>Ogni mazzo era completo, senza carte mancanti o ripetute ({r.mazzi_ok} su {v})</Voce>
          <Voce ok={r.distribuzioni_ok === v}>Le carte sono state date una alla volta, nell’ordine del mazzo, partendo dalla sinistra del mazziere ({r.distribuzioni_ok} su {v})</Voce>
          <Voce ok={r.carte_doppie === 0}>Nessuna carta in mano a due giocatori contemporaneamente</Voce>
        </ul>
      )}
      {v > 0 && v < r.mani && (
        <p className="tenue">{r.mani - v} mani su {r.mani} sono state giocate prima che il controllo fosse attivo e non sono verificabili.</p>
      )}

      <table className="report">
        <thead>
          <tr><th>Giocatore</th><th>Carte iniziali</th><th>Vinte al confronto</th></tr>
        </thead>
        <tbody>
          {r.giocatori.map((g) => (
            <tr key={g.nickname}>
              <td>{g.nickname}</td>
              <td>{g.punto_medio ?? '–'}</td>
              <td>{g.vinte_confronto} <small className="tenue">(attese {g.attese_confronto})</small></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tenue">
        “Carte iniziali” è il punto medio delle 5 carte ricevute, da 1 (carta alta) a 9 (scala reale){r.punto_medio_tavolo != null && `: al tavolo la media è ${r.punto_medio_tavolo}`}.
        Le vinte al confronto si paragonano a quelle attese per pura fortuna. In una sola partita sono normali differenze anche ampie: la prova della regolarità sono i controlli qui sopra.
      </p>

      {r.mazzi.length > 0 && (
        <details className="cronaca-box">
          <summary>Verifica tu stesso</summary>
          <p className="tenue">
            Per ogni mano, l’impronta SHA-256 del testo “mazzo|chiave” deve coincidere con quella annunciata nella cronaca prima della distribuzione.
          </p>
          <button className="secondario" onClick={ricalcola} disabled={ricalcolo === '…'}>Ricalcola le impronte su questo dispositivo</button>
          {ricalcolo && ricalcolo !== '…' && <p>Impronte ricalcolate e giuste: {ricalcolo}</p>}
          <ol style={{ fontFamily: 'monospace', fontSize: '0.72rem', wordBreak: 'break-all', paddingLeft: '1.2rem' }}>
            {r.mazzi.map((m) => (
              <li key={m.numero} style={{ marginBottom: '0.6rem' }}>
                Mano {m.numero}<br />impronta {m.impronta}<br />chiave {m.chiave}<br />mazzo {m.mazzo}
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  )
}
