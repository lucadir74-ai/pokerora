import { useState } from 'react'
import { supabase } from './supabase'

// Audit di tutte le mani di tutti i tavoli, solo per il gestore dell'app.
// Gli “attesi” sono quelli che darebbe un mazzo perfettamente casuale; lo scarto è in z-score:
// oltre ±2 su poche decine di casi può ancora essere fortuna, ben oltre ±3 su molti casi no.

function Riga({ ok, children }) {
  return (
    <li style={{ listStyle: 'none', margin: '0.3rem 0' }}>
      <span className={ok ? 'positivo' : 'negativo'}>{ok ? '✔' : '✘'}</span> {children}
    </li>
  )
}

const cella = (n, ok, att, z) => (n ? `${ok}/${n} (attesi ${att})${z != null ? ` z ${z}` : ''}` : '–')

export default function ReportGestore() {
  const [r, setR] = useState(null)
  const [errore, setErrore] = useState('')
  const [giorni, setGiorni] = useState('')

  async function carica() {
    setErrore('')
    setR(null)
    const da = giorni ? new Date(Date.now() - Number(giorni) * 86400000).toISOString() : null
    const { data, error } = await supabase.rpc('report_gestore', { p_da: da })
    if (error) return setErrore(error.message)
    setR(data)
  }

  const v = r?.verificabili ?? 0
  const d = r?.mani_distribuzione ?? 0

  return (
    <div className="regole-testo">
      <p className="tenue">Controlla mazzi, impronte e distribuzione di tutte le mani, e confronta i punti ottenuti con quelli attesi per pura fortuna.</p>
      <label>Ultimi giorni (vuoto = tutte){' '}
        <input type="number" min="1" value={giorni} onChange={(e) => setGiorni(e.target.value)} style={{ width: '5rem' }} />
      </label>{' '}
      <button className="secondario piccolo" onClick={carica}>Calcola report</button>
      {errore && <p className="errore" role="alert">{errore}</p>}
      {r && (
        <>
          <p>Mani nel periodo: {r.mani_totali}. Verificabili (con mazzo iniziale salvato): {v}.</p>
          <ul style={{ padding: 0 }}>
            <Riga ok={r.mazzi_ok === v}>Mazzi completi: {r.mazzi_ok} su {v}</Riga>
            <Riga ok={r.impronte_ok === v}>Impronte che corrispondono al mazzo: {r.impronte_ok} su {v}</Riga>
            <Riga ok={r.dist_una_alla_volta === d}>Carte date una alla volta dalla sinistra del mazziere: {r.dist_una_alla_volta} su {d} (a blocchi di 5: {r.dist_a_blocchi})</Riga>
            <Riga ok={r.mani_con_carte_doppie === 0}>Mani con una carta in mano a due giocatori: {r.mani_con_carte_doppie}</Riga>
          </ul>
          <table className="report">
            <thead>
              <tr><th>Giocatore</th><th>Tavolo</th><th>Mani</th><th>Punto medio</th><th>Doppia coppia, cambia 1 → full</th><th>Scala bilaterale, cambia 1 → scala</th></tr>
            </thead>
            <tbody>
              {r.giocatori.map((g) => (
                <tr key={g.nickname + g.al_proprio_tavolo}>
                  <td>{g.nickname}</td>
                  <td>{g.al_proprio_tavolo ? 'proprio' : 'di altri'}</td>
                  <td>{g.mani}</td>
                  <td>{g.punto_medio ?? '–'}</td>
                  <td>{cella(g.dc_n, g.dc_ok, g.dc_att, g.dc_z)}</td>
                  <td>{cella(g.sb_n, g.sb_ok, g.sb_att, g.sb_z)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tenue">
            Punto medio: da 1 (carta alta) a 9 (scala reale), sulle 5 carte iniziali. Se per un giocatore, o per chi organizza,
            gli scarti restano sempre dalla stessa parte (sotto gli attesi, z molto negativo) su molti casi, serve indagare; poche mani non provano niente.
          </p>
        </>
      )}
    </div>
  )
}
