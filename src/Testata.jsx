import { supabase } from './supabase'
import { vai } from './rotte'

export default function Testata({ io, indietro }) {
  return (
    <header className="testata">
      {indietro
        ? <button className="link-chiaro" onClick={() => vai('/')}>‹ I tuoi tavoli</button>
        : <span className="marchio-piccolo">PokerOra</span>}
      <span className="chi">
        {io.nickname}
        <button className="link-chiaro" onClick={() => supabase.auth.signOut()}>Esci</button>
      </span>
    </header>
  )
}
