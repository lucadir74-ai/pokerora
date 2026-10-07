import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Accesso from './Accesso'

export default function App() {
  const [sessione, setSessione] = useState(undefined)
  const [profilo, setProfilo] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessione(data.session))
    const { data } = supabase.auth.onAuthStateChange((_ev, s) => setSessione(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!sessione) return setProfilo(null)
    supabase
      .from('profili')
      .select('nickname')
      .eq('id', sessione.user.id)
      .single()
      .then(({ data }) => setProfilo(data))
  }, [sessione])

  if (sessione === undefined) return <main className="tavolo" />
  if (!sessione) return <Accesso />

  return (
    <main className="tavolo">
      <h1 className="marchio">PokerOra</h1>
      <section className="carta benvenuto">
        <span className="angolo alto" aria-hidden="true">A<br />♥</span>
        <span className="angolo basso" aria-hidden="true">A<br />♥</span>
        <p className="saluto">Ciao {profilo?.nickname ?? '…'}</p>
        <p>Sei dentro. I tavoli arrivano nel prossimo passo.</p>
        <button className="secondario" onClick={() => supabase.auth.signOut()}>Esci</button>
      </section>
    </main>
  )
}
