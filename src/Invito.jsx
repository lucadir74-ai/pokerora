import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Testata from './Testata'
import { vai, messaggioErrore } from './rotte'
import { fmt } from './regole'

export default function Invito({ codice, io }) {
  const [info, setInfo] = useState(undefined)
  const [errore, setErrore] = useState('')
  const [attesa, setAttesa] = useState(false)

  useEffect(() => {
    supabase.rpc('info_invito', { p_codice: codice }).then(({ data, error }) => {
      if (error) return setErrore(messaggioErrore(error))
      const t = data?.[0] ?? null
      if (t?.gia_seduto) return vai(`/tavolo/${t.tavolo_id}`)
      setInfo(t)
    })
  }, [codice])

  async function siediti() {
    setErrore('')
    setAttesa(true)
    const { data, error } = await supabase.rpc('entra_tavolo', { p_codice: codice })
    setAttesa(false)
    if (error) return setErrore(messaggioErrore(error))
    vai(`/tavolo/${data}`)
  }

  const liberi = info ? info.posti - info.occupati : 0

  return (
    <main className="pagina">
      <Testata io={io} indietro />
      <section className="carta">
        {info === undefined && !errore && <p className="tenue">Controllo l’invito…</p>}
        {info === null && <p>Questo invito non esiste. Controlla di aver copiato tutto il link.</p>}
        {info && (
          <>
            <p className="tenue">{info.organizzatore} ti invita al tavolo</p>
            <h2 className="titolo-tavolo">{info.nome}</h2>
            <p>Posta da {fmt(info.valore_posta)}, {info.occupati} su {info.posti} posti occupati</p>
            {info.stato !== 'attesa'
              ? <p className="errore">La partita a questo tavolo è già iniziata o è chiusa.</p>
              : liberi === 0
                ? <p className="errore">Il tavolo è al completo.</p>
                : <button className="principale" onClick={siediti} disabled={attesa}>
                    {attesa ? 'Un attimo…' : 'Siediti al tavolo'}
                  </button>}
          </>
        )}
        {errore && <p className="errore" role="alert">{errore}</p>}
      </section>
    </main>
  )
}
