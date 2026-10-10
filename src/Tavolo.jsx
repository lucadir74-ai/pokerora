import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import Testata from './Testata'
import Fiches from './Fiches'
import Gioco from './Gioco'
import { durata, ora } from './tempo'
import Chat from './Chat'
import Cassetto from './Cassetto'
import { suoniAttivi, impostaSuoni, ascoltaSuoni } from './suoni'
import { useChat } from './chat'
import { messaggioErrore, vai } from './rotte'
import { REGOLE_BASE, OPZIONI, descriviRegole, descriviMazzo, fmt, invitoDi } from './regole'


function ChatAttesa({ tavoloId, io, nomeDi }) {
  const { messaggi, invia } = useChat(tavoloId)
  return (
    <section className="carta">
      <Chat messaggi={messaggi} invia={invia} nomeDi={nomeDi} io={io} />
    </section>
  )
}

export default function Tavolo({ id, io }) {
  const [tavolo, setTavolo] = useState(undefined)
  const [giocatori, setGiocatori] = useState([])
  const [poste, setPoste] = useState([])
  const [errore, setErrore] = useState('')
  const [avviso, setAvviso] = useState('')
  const [attesa, setAttesa] = useState(false)
  const [modifica, setModifica] = useState(null)
  const [cassetto, setCassetto] = useState(null) // 'poste' | 'regole' | null
  const chiudiCassetto = useCallback(() => setCassetto(null), [])
  const [suoni, setSuoni] = useState(suoniAttivi())
  useEffect(() => ascoltaSuoni(setSuoni), [])

  const carica = useCallback(async () => {
    const [t, g, p] = await Promise.all([
      supabase.from('tavoli').select('*').eq('id', id).maybeSingle(),
      supabase.from('tavolo_giocatori').select('posto, giocatore_id, fiches, profili(nickname)').eq('tavolo_id', id).order('posto'),
      supabase.from('poste').select('id, giocatore_id, numero, valore, presa_il').eq('tavolo_id', id).order('presa_il'),
    ])
    setTavolo(t.data ?? null)
    setGiocatori(g.data ?? [])
    setPoste(p.data ?? [])
  }, [id])

  // Giocatori automatici (per le prove): l'elenco non cambia, basta caricarlo una volta
  const [bot, setBot] = useState(() => new Set())
  useEffect(() => {
    supabase.from('giocatori_automatici').select('id')
      .then(({ data }) => setBot(new Set((data ?? []).map((b) => b.id))))
  }, [])

  useEffect(() => {
    carica()
    const canale = supabase
      .channel(`tavolo-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tavoli', filter: `id=eq.${id}` }, carica)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tavolo_giocatori', filter: `tavolo_id=eq.${id}` }, carica)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poste', filter: `tavolo_id=eq.${id}` }, carica)
      .subscribe()
    return () => { supabase.removeChannel(canale) }
  }, [id, carica])

  // Durante la partita l'avviso nella barra sparisce da solo dopo qualche secondo
  const inCorso = tavolo?.stato === 'in_corso'
  useEffect(() => {
    if (!inCorso || (!avviso && !errore)) return
    const t = setTimeout(() => { setAvviso(''); setErrore('') }, 4000)
    return () => clearTimeout(t)
  }, [inCorso, avviso, errore])

  async function chiama(funzione, parametri, ok) {
    setErrore('')
    setAvviso('')
    setAttesa(true)
    const { error } = await supabase.rpc(funzione, parametri)
    setAttesa(false)
    if (error) return setErrore(messaggioErrore(error))
    if (ok) setAvviso(ok)
    await carica()
    return true
  }

  if (tavolo === undefined) return <main className="pagina"><Testata io={io} indietro /></main>
  if (tavolo === null) {
    return (
      <main className="pagina">
        <Testata io={io} indietro />
        <section className="carta"><p>Questo tavolo non esiste oppure non ci sei seduto.</p></section>
      </main>
    )
  }

  const organizzo = tavolo.organizzatore === io.id
  const inAttesa = tavolo.stato === 'attesa'
  const nomeDi = (gid) => giocatori.find((g) => g.giocatore_id === gid)?.profili?.nickname ?? 'giocatore uscito'
  const link = `${window.location.origin}/#/invito/${tavolo.codice_invito}`
  const posti = Array.from({ length: tavolo.posti }, (_, i) => giocatori.find((g) => g.posto === i + 1))

  async function copia() {
    try {
      await navigator.clipboard.writeText(link)
      setAvviso('Link copiato.')
    } catch {
      setAvviso('Copia il link a mano dal riquadro.')
    }
  }

  function apriModifica() {
    setModifica({
      nome: tavolo.nome,
      posti: tavolo.posti,
      valore_posta: tavolo.valore_posta,
      regole: { ...REGOLE_BASE, invito: invitoDi(tavolo), ...tavolo.regole },
    })
  }

  async function salvaModifica(e) {
    e.preventDefault()
    const v = Number(modifica.valore_posta)
    if (!Number.isInteger(v) || v < 100) return setErrore('La posta deve essere di almeno 100 Vardis.')
    const r = modifica.regole
    const invito = Number(r.invito)
    if (!Number.isInteger(invito) || invito < 1) return setErrore('L’invito deve essere un numero intero di almeno 1 Vardis.')
    const regole = { mazzo: r.mazzo, limite: r.limite, cambio_max: Number(r.cambio_max), invito, buio: r.buio ?? 'si' }
    if (r.limite === 'fisso') {
      const massima = Number(r.puntata_massima)
      if (!Number.isInteger(massima) || massima < invito) return setErrore('Indica una puntata massima almeno pari all’invito.')
      regole.puntata_massima = massima
    }
    const ok = await chiama('aggiorna_tavolo', {
      p_tavolo: id, p_nome: modifica.nome, p_posti: modifica.posti,
      p_valore_posta: v, p_regole: regole,
    }, 'Modifiche salvate.')
    if (ok) setModifica(null)
  }

  const regola = (k, v) => setModifica({ ...modifica, regole: { ...modifica.regole, [k]: v } })

  // Report poste per giocatore
  const perGiocatore = giocatori.map((g) => {
    const mie = poste.filter((p) => p.giocatore_id === g.giocatore_id)
    const totale = mie.reduce((s, p) => s + p.valore, 0)
    return { ...g, quante: mie.length, totale, saldo: (g.fiches ?? 0) - totale }
  })

  const messaggi = (avviso || errore) && (
    <>
      {avviso && <p className="avviso" role="status">{avviso}</p>}
      {errore && <p className="errore" role="alert">{errore}</p>}
    </>
  )

  const contenutoPoste = (
    <>
          {tavolo.stato === 'chiuso' && tavolo.avviato_il && tavolo.chiuso_il && (
            <p className="durata-partita">
              Partita durata {durata(tavolo.avviato_il, tavolo.chiuso_il)}, dalle {ora(tavolo.avviato_il)} alle {ora(tavolo.chiuso_il)}
            </p>
          )}
          <p className="tenue">Il saldo è la differenza tra le fiches che hai e le poste che hai preso.</p>
          {messaggi}
          <table className="report">
            <thead>
              <tr><th>Giocatore</th><th>Poste</th><th>Fiches</th><th>Saldo</th></tr>
            </thead>
            <tbody>
              {perGiocatore.map((g) => (
                <tr key={g.giocatore_id}>
                  <td>{g.profili?.nickname}</td><td>{g.quante}</td><td>{fmt(g.fiches)}</td>
                  <td className={g.saldo > 0 ? 'positivo' : g.saldo < 0 ? 'negativo' : ''}>{g.saldo > 0 ? '+' : ''}{fmt(g.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tavolo.stato === 'in_corso' && (
            <>
              <button className="secondario" disabled={attesa}
                onClick={() => window.confirm(`Prendi un’altra posta da ${fmt(tavolo.valore_posta)}? Resterà nel report.`)
                  && chiama('prendi_posta', { p_tavolo: id }, 'Posta aggiunta.')}>
                Prendi un’altra posta
              </button>
            </>
          )}
          <h3>Registro</h3>
          <ol className="registro">
            {poste.map((p) => (
              <li key={p.id}>
                <time>{ora(p.presa_il)}</time> {nomeDi(p.giocatore_id)} {p.numero === 1 ? 'riceve la prima posta' : `prende la posta n. ${p.numero}`} ({fmt(p.valore)})
              </li>
            ))}
          </ol>
    </>
  )

  return (
    <main className={`pagina${tavolo.stato === 'in_corso' ? ' ampia' : ''}`}>
      <Testata io={io} indietro />

      {tavolo.stato === 'in_corso' && (
        <nav className="barra-gioco" aria-label="Tavolo">
          <span className="barra-nome">{tavolo.nome}</span>
          <span className="barra-link">
            <button className="suoni-tasto" onClick={() => impostaSuoni(!suoni)}
              aria-label={suoni ? 'Disattiva i suoni' : 'Attiva i suoni'} title={suoni ? 'Suoni attivi' : 'Suoni spenti'}>
              {suoni ? '🔊' : '🔇'}
            </button>
            <button className="link-chiaro" onClick={() => setCassetto('regole')}>Regole</button>
            <button className="link-chiaro" onClick={() => setCassetto('poste')}>Poste e saldi</button>
            <button className="chip-posta" disabled={attesa} title={`Prendi un’altra posta da ${fmt(tavolo.valore_posta)}`}
              onClick={() => window.confirm(`Prendi un’altra posta da ${fmt(tavolo.valore_posta)}? Resterà nel report.`)
                && chiama('prendi_posta', { p_tavolo: id }, `Posta da ${fmt(tavolo.valore_posta)} aggiunta.`)}>
              + Posta
            </button>
          </span>
          {cassetto === null && (avviso || errore) && (
            <p className={`barra-avviso${errore ? ' errore' : ''}`} role={errore ? 'alert' : 'status'}>{errore || avviso}</p>
          )}
        </nav>
      )}

      {tavolo.stato !== 'in_corso' && <section className="carta intestazione-tavolo">
        <h2 className="titolo-tavolo">{tavolo.nome}</h2>
        <p className={`stato stato-${tavolo.stato}`}>
          {inAttesa ? 'Sala d’attesa' : 'Tavolo chiuso'}
        </p>

        {inAttesa && <ul className="posti" aria-label="Posti al tavolo">
          {posti.map((g, i) => (!inAttesa && !g) ? null : (
            <li key={i} className={g ? 'occupato' : 'libero'}>
              <span className="posto-numero">{i + 1}</span>
              <span className="posto-nome">
                {g ? g.profili?.nickname : 'Posto libero'}
                {g && (g.giocatore_id === tavolo.organizzatore || g.giocatore_id === io.id || bot.has(g.giocatore_id)) && (
                  <small>{[g.giocatore_id === tavolo.organizzatore && 'organizzatore', g.giocatore_id === io.id && 'tu',
                    bot.has(g.giocatore_id) && 'automatico'].filter(Boolean).join(', ')}</small>
                )}
              </span>
              {g && organizzo && bot.has(g.giocatore_id) && (
                <button className="togli-bot" disabled={attesa} aria-label={`Togli ${g.profili?.nickname}`}
                  onClick={() => chiama('togli_bot', { p_tavolo: id, p_bot: g.giocatore_id })}>×</button>
              )}
            </li>
          ))}
        </ul>}

        {inAttesa && organizzo && giocatori.length < tavolo.posti && (
          <button className="secondario aggiungi-bot" disabled={attesa}
            onClick={() => chiama('aggiungi_bot', { p_tavolo: id }, 'Giocatore automatico seduto.')}>
            + Giocatore automatico (per le prove)
          </button>
        )}

        {inAttesa && messaggi}

        {inAttesa && organizzo && (
          <div className="azioni">
            <button className="principale" disabled={attesa || giocatori.length < 4}
              onClick={() => chiama('avvia_partita', { p_tavolo: id }, 'Partita avviata: ognuno ha ricevuto la prima posta.')}>
              Avvia la partita
            </button>
            {giocatori.length < 4 && <small>Servono almeno 4 giocatori seduti (ora {giocatori.length}).</small>}
          </div>
        )}
        {inAttesa && !organizzo && (
          <p className="tenue">Aspetta che l’organizzatore avvii la partita.</p>
        )}
      </section>}

      {inAttesa && (
        <section className="carta">
          <h2>Invita gli amici</h2>
          <p className="tenue">Chi apre il link e ha un account si siede al primo posto libero.</p>
          <input className="campo-link" readOnly value={link} onFocus={(e) => e.target.select()} />
          <div className="bottoni">
            <button className="secondario" onClick={copia}>Copia il link</button>
            <a className="secondario" target="_blank" rel="noreferrer"
              href={`https://wa.me/?text=${encodeURIComponent(`Siediti al mio tavolo di poker su PokerOra: ${link}`)}`}>
              Invia su WhatsApp
            </a>
          </div>
        </section>
      )}

      {inAttesa && <ChatAttesa tavoloId={id} io={io} nomeDi={nomeDi} />}

      {tavolo.stato === 'in_corso' && <Gioco tavolo={tavolo} giocatori={giocatori} io={io} bot={bot} />}

      {tavolo.stato === 'chiuso' && (
        <section className="carta">
          <h2>Poste e saldi</h2>
          {contenutoPoste}
        </section>
      )}

      {tavolo.stato === 'in_corso' && (
        <>
          <Cassetto aperto={cassetto === 'poste'} onChiudi={chiudiCassetto} titolo="Poste e saldi">
            {contenutoPoste}
          </Cassetto>
          <Cassetto aperto={cassetto === 'regole'} onChiudi={chiudiCassetto} titolo="Posta e regole">
            <Fiches valore={tavolo.valore_posta} />
            <p className="mazzo">{descriviMazzo(giocatori.length, tavolo.regole)}</p>
            <ul className="regole">
              {descriviRegole(tavolo).map((r) => <li key={r}>{r}</li>)}
            </ul>
            <p className="tenue">Durante la partita le regole non si possono cambiare.</p>
            {organizzo && (
              <div className="chiudi-tavolo">
                <button className="secondario" disabled={attesa}
                  onClick={() => window.confirm('Chiudere il tavolo? Nessuno potrà più sedersi né prendere poste.')
                    && chiama('chiudi_tavolo', { p_tavolo: id }, 'Tavolo chiuso.').then((ok) => ok && chiudiCassetto())}>
                  Chiudi il tavolo
                </button>
              </div>
            )}
          </Cassetto>
        </>
      )}

      {tavolo.stato !== 'in_corso' && (
      <section className="carta">
          <h2>Posta e regole</h2>
          {!modifica && (
            <>
              <Fiches valore={tavolo.valore_posta} />
              <p className="mazzo">{descriviMazzo(inAttesa ? Math.max(giocatori.length, 4) : giocatori.length, tavolo.regole)}</p>
              <ul className="regole">
                {descriviRegole(tavolo).map((r) => <li key={r}>{r}</li>)}
              </ul>
              {inAttesa && organizzo && (
                <button className="secondario" onClick={apriModifica}>Modifica posta e regole</button>
              )}
            </>
          )}
  
          {modifica && (
            <form onSubmit={salvaModifica} noValidate>
              <label>
                Nome del tavolo
                <input value={modifica.nome} maxLength={40} onChange={(e) => setModifica({ ...modifica, nome: e.target.value })} />
              </label>
              <fieldset className="scelta">
                <legend>Posti al tavolo</legend>
                {[4, 5, 6].map((n) => (
                  <button type="button" key={n} aria-pressed={modifica.posti === n}
                    onClick={() => setModifica({ ...modifica, posti: n })}>{n}</button>
                ))}
              </fieldset>
              <label>
                Valore di una posta (Vardis)
                <input type="number" inputMode="numeric" min={100} step={100} value={modifica.valore_posta}
                  onChange={(e) => setModifica({ ...modifica, valore_posta: e.target.value })} />
              </label>
              <label>
                Mazzo
                <select value={modifica.regole.mazzo} onChange={(e) => regola('mazzo', e.target.value)}>
                  {OPZIONI.mazzo.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </label>
              <label>
                Invito a ogni mano (Vardis)
                <input type="number" inputMode="numeric" min={1} value={modifica.regole.invito}
                  onChange={(e) => regola('invito', e.target.value)} />
              </label>
              <label>
                Limite delle puntate
                <select value={modifica.regole.limite} onChange={(e) => regola('limite', e.target.value)}>
                  {OPZIONI.limite.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </label>
              {modifica.regole.limite === 'fisso' && (
                <label>
                  Puntata massima (Vardis)
                  <input type="number" inputMode="numeric" min={1} value={modifica.regole.puntata_massima ?? ''}
                    onChange={(e) => regola('puntata_massima', e.target.value)} />
                </label>
              )}
              <label>
                Buio, controbuio e over
                <select value={modifica.regole.buio ?? 'si'} onChange={(e) => regola('buio', e.target.value)}>
                  {OPZIONI.buio.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </label>
              <label>
                Cambio delle carte
                <select value={String(modifica.regole.cambio_max)} onChange={(e) => regola('cambio_max', e.target.value)}>
                  {OPZIONI.cambio_max.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </label>
              <div className="bottoni">
                <button className="principale" disabled={attesa}>Salva le modifiche</button>
                <button type="button" className="secondario" onClick={() => setModifica(null)}>Annulla</button>
              </div>
            </form>
          )}
        </section>
      )}

      {tavolo.stato === 'attesa' && (
        <div className="fondo">
          {organizzo
            ? <button className="link-chiaro" disabled={attesa}
                onClick={() => window.confirm('Chiudere il tavolo? Nessuno potrà più sedersi né prendere poste.')
                  && chiama('chiudi_tavolo', { p_tavolo: id }, 'Tavolo chiuso.')}>
                Chiudi il tavolo
              </button>
            : inAttesa && (
              <button className="link-chiaro" disabled={attesa}
                onClick={async () => { if (await chiama('lascia_tavolo', { p_tavolo: id })) vai('/') }}>
                Alzati dal tavolo
              </button>
            )}
        </div>
      )}
    </main>
  )
}
