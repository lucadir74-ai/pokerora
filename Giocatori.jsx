import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import Testata from './Testata'
import { vai, messaggioErrore } from './rotte'

// Cosa vedono gli altri di me: si sceglie qui, di base è tutto nascosto
function Visibilita({ io }) {
  const [v, setV] = useState(null)
  const [errore, setErrore] = useState('')

  useEffect(() => {
    supabase.from('profili_privati')
      .select('mostra_nome, mostra_email, mostra_telefono, telefono')
      .eq('id', io.id).single()
      .then(({ data, error }) => {
        if (error) setErrore(messaggioErrore(error))
        setV(data ?? null)
      })
  }, [io.id])

  async function cambia(campo) {
    const prima = v
    const nuovo = { ...v, [campo]: !v[campo] }
    setV(nuovo)
    setErrore('')
    const { error } = await supabase.from('profili_privati')
      .update({ [campo]: nuovo[campo] }).eq('id', io.id)
    if (error) { setV(prima); setErrore('Non sono riuscito a salvare. Riprova.') }
  }

  return (
    <section className="carta">
      <h2>Cosa vedono gli altri di te</h2>
      <p className="tenue">Il tuo nickname, <strong>{io.nickname}</strong>, lo vedono tutti gli iscritti. Il resto solo se lo attivi tu, e puoi cambiare idea quando vuoi.</p>
      {!v && !errore && <p className="tenue">Carico…</p>}
      {v && (
        <div className="spunte">
          <label className="spunta">
            <input type="checkbox" checked={v.mostra_nome} onChange={() => cambia('mostra_nome')} />
            Nome e cognome
          </label>
          <label className="spunta">
            <input type="checkbox" checked={v.mostra_email} onChange={() => cambia('mostra_email')} />
            Email
          </label>
          <label className="spunta">
            <input type="checkbox" checked={v.mostra_telefono} disabled={!v.telefono}
              onChange={() => cambia('mostra_telefono')} />
            Telefono {!v.telefono && <span className="tenue">(non l’hai inserito all’iscrizione)</span>}
          </label>
        </div>
      )}
      {errore && <p className="errore" role="alert">{errore}</p>}
    </section>
  )
}

export default function Giocatori({ io }) {
  const [giocatori, setGiocatori] = useState(null)
  const [cerca, setCerca] = useState('')
  const [errore, setErrore] = useState('')

  useEffect(() => {
    supabase.rpc('elenco_giocatori').then(({ data, error }) => {
      if (error) setErrore(messaggioErrore(error))
      setGiocatori(data ?? [])
    })
  }, [])

  const filtrati = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    const tutti = giocatori ?? []
    if (!q) return tutti
    return tutti.filter((g) =>
      [g.nickname, g.nome, g.cognome].filter(Boolean).join(' ').toLowerCase().includes(q))
  }, [giocatori, cerca])

  return (
    <main className="pagina">
      <Testata io={io} indietro />

      <section className="carta">
        <h2>Giocatori iscritti</h2>
        <label>
          Cerca
          <input type="search" value={cerca} placeholder="Nickname, nome o cognome"
            onChange={(e) => setCerca(e.target.value)} />
        </label>
        {giocatori === null && <p className="tenue">Carico l’elenco…</p>}
        {giocatori?.length === 0 && !errore && <p className="tenue">Per ora sei l’unico iscritto.</p>}
        {giocatori?.length > 0 && filtrati.length === 0 && <p className="tenue">Nessuno corrisponde alla ricerca.</p>}
        {errore && <p className="errore" role="alert">{errore}</p>}

        <ul className="elenco">
          {filtrati.map((g) => (
            <li key={g.id} className="giocatore">
              <div className="giocatore-testa">
                <span className="riga-nome">{g.nickname}</span>
                {g.da_leggere > 0 && <span className="segnale">{g.da_leggere} da leggere</span>}
              </div>
              {g.nome && <span className="riga-info">{g.nome} {g.cognome}</span>}
              <div className="bottoni">
                <button className="secondario" onClick={() => vai(`/messaggi/${g.id}`)}>
                  Scrivi o invita
                </button>
                {g.email && <a className="secondario" href={`mailto:${g.email}`}>Email</a>}
                {g.telefono && <a className="secondario" href={`tel:${g.telefono}`}>Chiama</a>}
                {g.telefono && (
                  <a className="secondario" target="_blank" rel="noreferrer"
                    href={`https://wa.me/${g.telefono.replace('+', '')}`}>WhatsApp</a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Visibilita io={io} />
    </main>
  )
}
