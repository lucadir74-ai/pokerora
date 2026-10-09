import { useState } from 'react'
import { supabase } from './supabase'

// Si apre quando si arriva dal link "reimposta la password" ricevuto per email
export default function NuovaPassword({ onFatto }) {
  const [password, setPassword] = useState('')
  const [conferma, setConferma] = useState('')
  const [errore, setErrore] = useState('')
  const [attesa, setAttesa] = useState(false)

  async function salva(e) {
    e.preventDefault()
    setErrore('')
    if (password.length < 8) return setErrore('La password deve avere almeno 8 caratteri.')
    if (password !== conferma) return setErrore('Le due password non coincidono.')
    setAttesa(true)
    const { error } = await supabase.auth.updateUser({ password })
    setAttesa(false)
    if (error) return setErrore('Non è stato possibile salvare la password. Richiedi un nuovo link e riprova.')
    onFatto()
  }

  return (
    <main className="tavolo">
      <h1 className="marchio">PokerOra</h1>
      <section className="carta" aria-label="Nuova password">
        <span className="angolo alto" aria-hidden="true">A<br />♠</span>
        <span className="angolo basso" aria-hidden="true">A<br />♠</span>
        <h2>Scegli una nuova password</h2>
        <form onSubmit={salva} noValidate>
          <label>
            Nuova password
            <input type="password" autoComplete="new-password" minLength={8}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label>
            Ripeti la password
            <input type="password" autoComplete="new-password" minLength={8}
              value={conferma} onChange={(e) => setConferma(e.target.value)} />
          </label>
          {errore && <p className="errore" role="alert">{errore}</p>}
          <button className="principale" disabled={attesa}>{attesa ? 'Un attimo…' : 'Salva la password'}</button>
        </form>
      </section>
    </main>
  )
}
