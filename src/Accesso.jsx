import { useState } from 'react'
import { supabase } from './supabase'

// "333 123 4567" → "+393331234567"; "0039..." → "+39..."
export function normalizzaTelefono(grezzo) {
  let t = grezzo.replace(/[\s\-().\/]/g, '')
  if (t.startsWith('00')) t = '+' + t.slice(2)
  if (!t.startsWith('+')) t = '+39' + t
  return t
}

const VUOTO = { email: '', password: '', nome: '', cognome: '', nickname: '', telefono: '' }

export default function Accesso() {
  const [modo, setModo] = useState('entra') // 'entra' | 'iscriviti'
  const [campi, setCampi] = useState(VUOTO)
  const [errore, setErrore] = useState('')
  const [avviso, setAvviso] = useState('')
  const [attesa, setAttesa] = useState(false)

  const cambia = (k) => (e) => setCampi({ ...campi, [k]: e.target.value })

  function cambiaModo(m) {
    setModo(m)
    setErrore('')
    setAvviso('')
  }

  async function entra(e) {
    e.preventDefault()
    setErrore('')
    setAttesa(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: campi.email.trim(),
      password: campi.password,
    })
    setAttesa(false)
    if (error) {
      setErrore(
        error.message.includes('Email not confirmed')
          ? 'Devi ancora confermare l’email: apri il link che ti abbiamo mandato.'
          : 'Email o password non corretti.'
      )
    }
  }

  async function iscriviti(e) {
    e.preventDefault()
    setErrore('')
    setAvviso('')

    const nickname = campi.nickname.trim()
    const telefono = campi.telefono.trim() ? normalizzaTelefono(campi.telefono) : ''

    if (!/^[A-Za-z0-9_.\-]{3,20}$/.test(nickname)) {
      return setErrore('Il nickname va da 3 a 20 caratteri: lettere, numeri, punto, trattino o trattino basso.')
    }
    if (telefono && !/^\+[1-9][0-9]{6,14}$/.test(telefono)) {
      return setErrore('Il numero di telefono non sembra valido. Esempio: 333 1234567.')
    }
    if (campi.password.length < 8) {
      return setErrore('La password deve avere almeno 8 caratteri.')
    }

    setAttesa(true)
    const { data: libero, error: errNick } = await supabase.rpc('nickname_disponibile', {
      p_nickname: nickname,
    })
    if (errNick) {
      setAttesa(false)
      return setErrore('Non riesco a contattare il server. Riprova tra poco.')
    }
    if (!libero) {
      setAttesa(false)
      return setErrore(`Il nickname “${nickname}” è già preso. Scegline un altro.`)
    }

    const { data, error } = await supabase.auth.signUp({
      email: campi.email.trim(),
      password: campi.password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          nome: campi.nome.trim(),
          cognome: campi.cognome.trim(),
          nickname,
          telefono,
        },
      },
    })
    setAttesa(false)

    if (error) {
      return setErrore(
        error.message.toLowerCase().includes('database')
          ? 'Questo numero di telefono è già registrato con un altro account.'
          : 'Iscrizione non riuscita: ' + error.message
      )
    }
    // Con la conferma email attiva, un'email già registrata torna senza identità
    if (data.user && data.user.identities?.length === 0) {
      return setErrore('Questa email è già registrata. Usa “Entra”.')
    }
    if (!data.session) {
      setCampi(VUOTO)
      setAvviso(`Ti abbiamo mandato un’email a ${campi.email.trim()}. Apri il link per attivare l’account, poi entra.`)
    }
  }

  return (
    <main className="tavolo">
      <h1 className="marchio">
        PokerOra
        <span className="sottotitolo">Poker all’italiana, al tavolo con gli amici</span>
      </h1>

      <section className="carta" aria-label={modo === 'entra' ? 'Entra' : 'Iscriviti'}>
        <span className="angolo alto" aria-hidden="true">A<br />♠</span>
        <span className="angolo basso" aria-hidden="true">A<br />♠</span>

        <div className="schede" role="tablist">
          <button role="tab" aria-selected={modo === 'entra'} onClick={() => cambiaModo('entra')}>
            Entra
          </button>
          <button role="tab" aria-selected={modo === 'iscriviti'} onClick={() => cambiaModo('iscriviti')}>
            Iscriviti
          </button>
        </div>

        {avviso && <p className="avviso" role="status">{avviso}</p>}

        <form onSubmit={modo === 'entra' ? entra : iscriviti} noValidate>
          {modo === 'iscriviti' && (
            <>
              <div className="riga">
                <label>
                  Nome
                  <input required autoComplete="given-name" value={campi.nome} onChange={cambia('nome')} />
                </label>
                <label>
                  Cognome
                  <input required autoComplete="family-name" value={campi.cognome} onChange={cambia('cognome')} />
                </label>
              </div>
              <label>
                Nickname al tavolo
                <input required autoComplete="username" value={campi.nickname} onChange={cambia('nickname')} />
                <small>È l’unico nome che vedono gli altri giocatori.</small>
              </label>
              <label>
                Telefono (facoltativo)
                <input type="tel" inputMode="tel" autoComplete="tel" placeholder="333 1234567"
                  value={campi.telefono} onChange={cambia('telefono')} />
                <small>Resta privato. Senza prefisso usiamo +39.</small>
              </label>
            </>
          )}

          <label>
            Email
            <input required type="email" autoComplete="email" value={campi.email} onChange={cambia('email')} />
          </label>
          <label>
            Password
            <input required type="password" minLength={8}
              autoComplete={modo === 'entra' ? 'current-password' : 'new-password'}
              value={campi.password} onChange={cambia('password')} />
          </label>

          {errore && <p className="errore" role="alert">{errore}</p>}

          <button className="principale" type="submit" disabled={attesa}>
            {attesa ? 'Un attimo…' : modo === 'entra' ? 'Entra' : 'Crea l’account'}
          </button>
        </form>
      </section>
    </main>
  )
}
