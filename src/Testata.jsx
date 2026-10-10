import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { vai } from './rotte'

// indietro: true = torna a "I tuoi tavoli"; una stringa = torna a quel percorso (es. '/giocatori')
export default function Testata({ io, indietro }) {
  const [daLeggere, setDaLeggere] = useState(0)

  useEffect(() => {
    if (!io.id) return
    let attivo = true
    const conta = () => supabase.from('messaggi_privati')
      .select('id', { count: 'exact', head: true })
      .eq('destinatario', io.id).is('letto_il', null)
      .then(({ count }) => { if (attivo) setDaLeggere(count ?? 0) })
    conta()
    const canale = supabase
      .channel(`dm-avviso-${io.id}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messaggi_privati', filter: `destinatario=eq.${io.id}` },
        () => conta())
      .subscribe()
    return () => { attivo = false; supabase.removeChannel(canale) }
  }, [io.id])

  const verso = typeof indietro === 'string' ? indietro : '/'
<<<<<<< HEAD
  const etichetta = verso === '/giocatori' ? '‹ Giocatori' : '‹ Home'
=======
  const etichetta = verso === '/giocatori' ? '‹ Giocatori' : '‹ I tuoi tavoli'
>>>>>>> a8c4b772e6d31a9c80eb8120cef34eb81e6904a4

  return (
    <header className="testata">
      {indietro
        ? <button className="link-chiaro" onClick={() => vai(verso)}>{etichetta}</button>
        : <span className="marchio-piccolo">PokerOra</span>}
      <span className="chi">
        <button className="link-chiaro" onClick={() => vai('/giocatori')}>
          Giocatori{daLeggere > 0 && <span className="segnale" aria-label={`${daLeggere} messaggi da leggere`}>{daLeggere}</span>}
        </button>
        {io.nickname}
        <button className="link-chiaro" onClick={() => supabase.auth.signOut()}>Esci</button>
      </span>
    </header>
  )
}
