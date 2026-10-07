import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Testata from './Testata'
import Fiches from './Fiches'
import { vai, messaggioErrore } from './rotte'

const STATI = { attesa: 'In sala d’attesa', in_corso: 'Partita in corso', chiuso: 'Chiuso' }

export default function Lobby({ io }) {
  const [tavoli, setTavoli] = useState(null)
  const [nome, setNome] = useState('')
  const [posti, setPosti] = useState(6)
  const [posta, setPosta] = useState(1000)
  const [errore, setErrore] = useState('')
  const [attesa, setAttesa] = useState(false)

  useEffect(() => {
    supabase.from('tavoli')
      .select('id, nome, stato, posti, organizzatore, creato_il, tavolo_giocatori(count)')
      .order('creato_il', { ascending: false })
      .then(({ data }) => setTavoli(data ?? []))
  }, [])

  async function crea(e) {
    e.preventDefault()
    setErrore('')
    const v = Number(posta)
    if (!nome.trim()) return setErrore('Dai un nome al tavolo, per esempio “Venerdì da Luca”.')
    if (!Number.isInteger(v) || v < 100) return setErrore('La posta deve essere di almeno 100 Vardis.')
    setAttesa(true)
    const { data, error } = await supabase.rpc('crea_tavolo', {
      p_nome: nome, p_posti: posti, p_valore_posta: v,
    })
    setAttesa(false)
    if (error) return setErrore(messaggioErrore(error))
    vai(`/tavolo/${data}`)
  }

  const aperti = (tavoli ?? []).filter((t) => t.stato !== 'chiuso')
  const chiusi = (tavoli ?? []).filter((t) => t.stato === 'chiuso')

  return (
    <main className="pagina">
      <Testata io={io} />

      <section className="carta">
        <h2>Apri un tavolo</h2>
        <form onSubmit={crea} noValidate>
          <label>
            Nome del tavolo
            <input value={nome} maxLength={40} placeholder="Venerdì da Luca" onChange={(e) => setNome(e.target.value)} />
          </label>
          <fieldset className="scelta">
            <legend>Posti al tavolo</legend>
            {[4, 5, 6].map((n) => (
              <button type="button" key={n} aria-pressed={posti === n} onClick={() => setPosti(n)}>{n}</button>
            ))}
          </fieldset>
          <label>
            Valore di una posta (Vardis)
            <input type="number" inputMode="numeric" min={100} step={100} value={posta}
              onChange={(e) => setPosta(e.target.value)} />
          </label>
          {Number(posta) >= 100 && <Fiches valore={Number(posta)} />}
          {errore && <p className="errore" role="alert">{errore}</p>}
          <button className="principale" disabled={attesa}>{attesa ? 'Un attimo…' : 'Apri il tavolo'}</button>
        </form>
      </section>

      <section className="carta">
        <h2>I tuoi tavoli</h2>
        {tavoli === null && <p className="tenue">Carico i tavoli…</p>}
        {tavoli?.length === 0 && (
          <p className="tenue">Non sei ancora seduto a nessun tavolo. Aprine uno qui sopra, oppure apri il link di invito che ti hanno mandato.</p>
        )}
        <ul className="elenco">
          {[...aperti, ...chiusi].map((t) => (
            <li key={t.id}>
              <button className="riga-tavolo" onClick={() => vai(`/tavolo/${t.id}`)}>
                <span className="riga-nome">{t.nome}</span>
                <span className="riga-info">
                  {STATI[t.stato]}, {t.tavolo_giocatori?.[0]?.count ?? 0} su {t.posti} giocatori
                  {t.organizzatore === io.id ? ', organizzi tu' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
