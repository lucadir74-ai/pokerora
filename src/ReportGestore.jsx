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

// Somma doppia coppia e scala bilaterale: Francesco (Acekekko) al proprio tavolo, gli altri organizzatori,
// gli ospiti (bot compresi) e tutti insieme
const FRANCESCO = 'Acekekko'
function gruppi(giocatori) {
  const defs = [
    ['Francesco, al proprio tavolo', (g) => g.nickname === FRANCESCO && g.al_proprio_tavolo],
    ['Francesco, al tavolo di altri', (g) => g.nickname === FRANCESCO && !g.al_proprio_tavolo],
    ['Altri organizzatori, al proprio tavolo', (g) => g.nickname !== FRANCESCO && g.al_proprio_tavolo],
    ['Altri giocatori e bot, tavoli altrui', (g) => g.nickname !== FRANCESCO && !g.al_proprio_tavolo],
    ['Tutti', () => true],
  ]
  return defs.map(([nome, f]) => {
    const s = giocatori.filter(f)
    const n = s.reduce((a, g) => a + g.dc_n + g.sb_n, 0)
    const ok = s.reduce((a, g) => a + g.dc_ok + g.sb_ok, 0)
    const att = s.reduce((a, g) => a + Number(g.dc_att ?? 0) + Number(g.sb_att ?? 0), 0)
    const v = s.reduce((a, g) => a + Number(g.dc_var) + Number(g.sb_var), 0)
    return { nome, n, ok, att, z: v > 0 ? (ok - att) / Math.sqrt(v) : null }
  })
}

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
            <Riga ok={r.pescate_ok === r.mani_pescate}>
              Carte pescate dopo il cambio = quelle successive nel mazzo: {r.pescate_ok} su {r.mani_pescate}
              {r.pescate_anomale.length > 0 && ` (mani anomale: ${r.pescate_anomale.slice(0, 15).join(', ')})`}
            </Riga>
          </ul>

          <h4>Chi organizza contro chi no (punti entrati al cambio di 1 carta)</h4>
          <table className="report">
            <thead><tr><th>Gruppo</th><th>Casi</th><th>Entrati</th><th>Attesi</th><th>z</th></tr></thead>
            <tbody>
              {gruppi(r.giocatori).map((x) => (
                <tr key={x.nome}>
                  <td>{x.nome}</td><td>{x.n}</td><td>{x.ok}</td><td>{x.att.toFixed(1)}</td>
                  <td>{x.z == null ? '–' : x.z.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
