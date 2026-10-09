import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Accesso from './Accesso'
import NuovaPassword from './NuovaPassword'
import Lobby from './Lobby'
import Invito from './Invito'
import Tavolo from './Tavolo'
import { useRotta, salvaInvito, prendiInvito, vai } from './rotte'

export default function App() {
  const [sessione, setSessione] = useState(undefined)
  const [profilo, setProfilo] = useState(null)
  const [recupero, setRecupero] = useState(false)
  const rotta = useRotta()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessione(data.session))
    const { data } = supabase.auth.onAuthStateChange((evento, s) => {
      setSessione(s)
      // Arrivo dal link per reimpostare la password
      if (evento === 'PASSWORD_RECOVERY') setRecupero(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!sessione) return setProfilo(null)
    supabase.from('profili').select('id, nickname').eq('id', sessione.user.id).single()
      .then(({ data }) => setProfilo(data))
    const sospeso = prendiInvito()
    if (sospeso && rotta.pagina !== 'invito') vai(`/invito/${sospeso}`)
  }, [sessione?.user?.id])

  useEffect(() => {
    if (sessione === null && rotta.pagina === 'invito' && rotta.param) salvaInvito(rotta.param)
  }, [sessione, rotta.pagina, rotta.param])

  if (sessione === undefined) return <main className="tavolo" />
  if (recupero && sessione) return <NuovaPassword onFatto={() => setRecupero(false)} />
  if (!sessione) return <Accesso />

  const io = { id: sessione.user.id, nickname: profilo?.nickname ?? '' }
  if (rotta.pagina === 'invito') return <Invito codice={rotta.param} io={io} />
  if (rotta.pagina === 'tavolo') return <Tavolo id={rotta.param} io={io} />
  return <Lobby io={io} />
}
