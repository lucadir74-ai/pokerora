import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Testata from './Testata'
import { vai, messaggioErrore } from './rotte'
import { fmt } from './regole'

export default function Invito({ codice, io }) {
  const [info, setInfo] = useState(undefined)
  const [errore, setErrore] = useState('')
  const [attesa, setAttesa] = useState(false)
  const [richiesta, setRichiesta] = useState(null)   // null | 'attesa' | 'accettata' | 'rifiutata'

  // A partita in corso: si aspetta la conferma di un giocatore seduto
  useEffect(() => {
    let attivo = true
    const controlla = async () => {
      const { data } = await supabase.rpc('mia_richiesta', { p_codice: codice })
      if (!attivo) return
      setRichiesta(data ?? null)
      if (data === 'accettata' && info?.tavolo_id) vai(`/tavolo/${info.tavolo_id}`)
    }
    controlla()
    const timer = setInterval(() => { if (richiesta === 'attesa') controlla() }, 3000)
    return () => { attivo = false; clearInterval(timer) }
  }, [codice, info?.tavolo_id, richiesta])

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

  async function aggiungiti() {
    setErrore('')
    setAttesa(true)
    const { error } = await supabase.rpc('chiedi_ingresso', { p_codice: codice })
    setAttesa(false)
    if (error) return setErrore(messaggioErrore(error))
    setRichiesta('attesa')
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
            {info.stato === 'in_corso' && liberi > 0 && richiesta !== 'attesa' && (
              <p className="tenue">La partita è già iniziata: chiedi di aggiungerti e un giocatore seduto deve confermare. Poi giochi dalla prossima mano, con la tua prima posta.</p>
            )}
            {info.stato === 'chiuso'
              ? <p className="errore">La partita a questo tavolo è chiusa.</p>
              : liberi === 0
                ? <p className="errore">Il tavolo è al completo.</p>
                : info.stato === 'in_corso'
                  ? (richiesta === 'attesa'
                      ? <p className="avviso" role="status">Richiesta inviata: aspetta che un giocatore al tavolo confermi. Questa pagina si aggiorna da sola.</p>
                      : <>
                          {richiesta === 'rifiutata' && <p className="errore">La tua richiesta non è stata accettata. Puoi riprovare.</p>}
                          <button className="principale" onClick={aggiungiti} disabled={attesa}>
                            {attesa ? 'Un attimo…' : 'Aggiungiti al tavolo'}
                          </button>
                        </>)
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
