import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Testata from './Testata'
import Fiches from './Fiches'
import { vai, messaggioErrore } from './rotte'
import { durata, ora } from './tempo'

const STATI = { attesa: 'In sala d’attesa', in_corso: 'Partita in corso', chiuso: 'Chiuso' }
const giorno = (t) => new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })

// ── Apri un tavolo ──
function NuovoTavolo({ onChiudi }) {
  const [nome, setNome] = useState('')
  const [posti, setPosti] = useState(6)
  const [posta, setPosta] = useState(1000)
  const [invito, setInvito] = useState('')
  const [errore, setErrore] = useState('')
  const [attesa, setAttesa] = useState(false)

  async function crea(e) {
    e.preventDefault()
    setErrore('')
    const v = Number(posta)
    if (!nome.trim()) return setErrore('Dai un nome al tavolo, per esempio “Venerdì da Luca”.')
    if (!Number.isInteger(v) || v < 100) return setErrore('La posta deve essere di almeno 100 Vardis.')
    const inv = invito === '' ? Math.max(1, Math.floor(v / 100)) : Number(invito)
    if (!Number.isInteger(inv) || inv < 1 || inv > v) return setErrore('L’invito deve essere un numero intero tra 1 e il valore della posta.')
    setAttesa(true)
    const { data, error } = await supabase.rpc('crea_tavolo', {
      p_nome: nome, p_posti: posti, p_valore_posta: v, p_invito: inv,
    })
    setAttesa(false)
    if (error) return setErrore(messaggioErrore(error))
    vai(`/tavolo/${data}`)
  }

  return (
    <section className="carta" id="apri-tavolo">
      <div className="home-testa">
        <h2>Apri un tavolo</h2>
        {onChiudi && <button type="button" className="home-chiudi" onClick={onChiudi}>Chiudi</button>}
      </div>
      <form onSubmit={crea} noValidate>
        <label>
          Nome del tavolo
          <input value={nome} maxLength={40} placeholder="Venerdì da Luca" onChange={(e) => setNome(e.target.value)} />
        </label>
        <fieldset className="scelta">
          <legend>Posti al tavolo</legend>
          {[4, 5, 6].map((n) => (
            <button type="button" key={n} aria-pressed={posti === n} onClick={() => setPosti(n)}>{n}</button>
          ))}
        </fieldset>
        <label>
          Valore di una posta (Vardis)
          <input type="number" inputMode="numeric" min={100} step={100} value={posta}
            onChange={(e) => setPosta(e.target.value)} />
        </label>
        {Number(posta) >= 100 && <Fiches valore={Number(posta)} />}
        <label>
          Invito a ogni mano (Vardis)
          <input type="number" inputMode="numeric" min={1} value={invito}
            placeholder={String(Math.max(1, Math.floor((Number(posta) || 0) / 100)))}
            onChange={(e) => setInvito(e.target.value)} />
          <small>Se lo lasci vuoto vale l’1% della posta. Le altre regole si cambiano in sala d’attesa.</small>
        </label>
        {errore && <p className="errore" role="alert">{errore}</p>}
        <button className="principale" disabled={attesa}>{attesa ? 'Un attimo…' : 'Apri il tavolo'}</button>
      </form>
    </section>
  )
}

// ── Come si gioca: regole di base della casa ──
const REGOLE = [
  ['Il mazzo', (
    <>
      <p>Si gioca con la regola dell’11: la carta più bassa è 11 meno il numero dei giocatori.</p>
      <ul>
        <li>4 giocatori: dal 7 all’asso, 32 carte</li>
        <li>5 giocatori: dal 6 all’asso, 36 carte</li>
        <li>6 giocatori: dal 5 all’asso, 40 carte</li>
      </ul>
    </>
  )],
  ['I punti, dal più alto', (
    <>
      <ol>
        <li>Scala reale (5 carte di fila dello stesso seme)</li>
        <li>Poker (4 carte uguali)</li>
        <li>Colore (5 carte dello stesso seme): batte il full</li>
        <li>Full (tris più coppia)</li>
        <li>Scala (5 carte di fila)</li>
        <li>Tris</li>
        <li>Doppia coppia</li>
        <li>Coppia</li>
        <li>Carta più alta</li>
      </ol>
      <p>A parità decide il seme: cuori, quadri, fiori, picche (“Come Quando Fuori Piove”). Nelle scale l’asso vale anche sotto la carta più bassa del mazzo.</p>
      <p>Tra scale reali: la minima batte la massima, la massima batte la media, la media batte la minima.</p>
    </>
  )],
  ['Invito e apertura', (
    <>
      <p>A ogni mano tutti mettono l’invito nel piatto. Dopo la distribuzione si apre con almeno una coppia di fanti, oppure con 4 carte di fila dello stesso seme senza asso.</p>
      <p>Se passano tutti, il piatto resta e la mano dopo si apre con coppia di donne, poi di re. Si resta al re finché una mano non viene aperta e giocata.</p>
      <p>Dopo l’apertura gli altri vedono, rilanciano o lasciano.</p>
    </>
  )],
  ['Buio, controbuio e over', (
    <>
      <p>Prima di vedere le carte, il primo dopo il mazziere può fare il buio: punta quanto c’è nel piatto. Il successivo può fare il controbuio (il doppio), il terzo l’over (il doppio del controbuio).</p>
      <p>Dopo la distribuzione gli altri possono solo vedere o lasciare. Chi ha fatto l’ultimo buio parla per ultimo: chiude il giro o rilancia. Niente buio dopo una mano finita a parola.</p>
    </>
  )],
  ['Il cambio', (
    <p>Chi è rimasto in gioco cambia fino a 4 carte, partendo dal primo dopo il mazziere: 3 subito e l’eventuale quarta quando sono stati serviti tutti. Il tavolo può alzare il limite a 5.</p>
  )],
  ['Secondo giro e parola', (
    <>
      <p>Dopo il cambio parla per primo chi ha aperto (o chi ha fatto l’ultimo buio). Si può puntare, bussare (si va avanti senza puntare) o dire parola.</p>
      <p>Se tutti dicono parola la mano si annulla: il piatto resta, la mano dopo si apre con coppia di re e senza buio. Chi era uscito al primo giro, per rientrare, versa la differenza.</p>
    </>
  )],
  ['Poste e Vardis', (
    <p>Non si gioca con soldi veri. A inizio partita ognuno riceve una posta in Vardis, divisa in fiches. Se finisci le fiches prendi un’altra posta: resta tutto nel report del tavolo, con il saldo di ognuno.</p>
  )],
]

function ComeSiGioca() {
  return (
    <section className="carta">
      <h2>Come si gioca</h2>
      <p className="tenue">Sono le regole di base. Chi apre un tavolo può cambiarne alcune in sala d’attesa.</p>
      <div className="regole-home">
        {REGOLE.map(([titolo, testo]) => (
          <details key={titolo}>
            <summary>{titolo}</summary>
            <div className="regole-testo">{testo}</div>
          </details>
        ))}
      </div>
    </section>
  )
}

export default function Lobby({ io }) {
  const [tavoli, setTavoli] = useState(null)
  const [inviti, setInviti] = useState([])
  const [chat, setChat] = useState([])
  const [daLeggere, setDaLeggere] = useState(0)
  const [apri, setApri] = useState(false)
  const [codice, setCodice] = useState('')

  useEffect(() => {
    let attivo = true

    supabase.from('tavoli')
      .select('id, nome, stato, posti, organizzatore, creato_il, avviato_il, chiuso_il, tavolo_giocatori(count)')
      .order('creato_il', { ascending: false })
      .then(({ data }) => { if (attivo) setTavoli(data ?? []) })

    // Messaggi privati: inviti ricevuti e ultime conversazioni
    ;(async () => {
      const [{ data: msg }, { data: gente }] = await Promise.all([
        supabase.from('messaggi_privati')
          .select('id, mittente, destinatario, testo, codice_invito, creato_il')
          .order('id', { ascending: false }).limit(60),
        supabase.rpc('elenco_giocatori'),
      ])
      if (!attivo) return
      const persone = gente ?? []
      const nick = Object.fromEntries(persone.map((g) => [g.id, g.nickname]))
      setDaLeggere(persone.reduce((s, g) => s + (g.da_leggere || 0), 0))

      // Ultimo messaggio con ciascuno
      const visti = new Set()
      const ultime = []
      for (const m of msg ?? []) {
        const altro = m.mittente === io.id ? m.destinatario : m.mittente
        if (visti.has(altro)) continue
        visti.add(altro)
        ultime.push({
          altro, nick: nick[altro] ?? 'giocatore', testo: m.testo, mio: m.mittente === io.id,
          quando: m.creato_il, nuovi: persone.find((g) => g.id === altro)?.da_leggere ?? 0,
        })
      }
      setChat(ultime.slice(0, 5))

      // Inviti ancora validi: tavolo in sala d'attesa, con posti liberi, dove non sono già seduto
      const ricevuti = (msg ?? []).filter((m) => m.destinatario === io.id && m.codice_invito)
      const codici = [...new Set(ricevuti.map((m) => m.codice_invito))].slice(0, 6)
      const info = await Promise.all(codici.map(async (c) => {
        const { data } = await supabase.rpc('info_invito', { p_codice: c })
        const t = data?.[0]
        if (!t || t.stato !== 'attesa' || t.gia_seduto || t.occupati >= t.posti) return null
        const da = ricevuti.find((m) => m.codice_invito === c)
        return { codice: c, ...t, da: nick[da?.mittente] ?? t.organizzatore }
      }))
      if (attivo) setInviti(info.filter(Boolean))
    })()

    return () => { attivo = false }
  }, [io.id])

  const inCorso = (tavoli ?? []).filter((t) => t.stato === 'in_corso')
  const inAttesa = (tavoli ?? []).filter((t) => t.stato === 'attesa')
  const chiusi = (tavoli ?? []).filter((t) => t.stato === 'chiuso')
  const nessunTavolo = tavoli !== null && inCorso.length + inAttesa.length === 0

  function entraConCodice(e) {
    e.preventDefault()
    const c = codice.trim().toUpperCase()
    if (c.length >= 4) vai(`/invito/${encodeURIComponent(c)}`)
  }

  function apriTavolo() {
    setApri(true)
    setTimeout(() => document.getElementById('apri-tavolo')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const riga = (t) => (
    <li key={t.id}>
      <button className="riga-tavolo" onClick={() => vai(`/tavolo/${t.id}`)}>
        <span className="riga-nome">{t.nome}</span>
        <span className="riga-info">
          {STATI[t.stato]}, {t.tavolo_giocatori?.[0]?.count ?? 0} su {t.posti} giocatori
          {t.stato === 'in_corso' && t.avviato_il ? `, da ${durata(t.avviato_il)}` : ''}
          {t.stato === 'chiuso' && t.chiuso_il ? `, ${giorno(t.chiuso_il)}` : ''}
          {t.organizzatore === io.id ? ', organizzi tu' : ''}
        </span>
      </button>
    </li>
  )

  return (
    <main className="pagina">
      <Testata io={io} />

      <section className="carta home-benvenuto">
        <span className="angolo alto" aria-hidden="true">A<br />♥</span>
        <h1 className="saluto">Ciao{io.nickname ? `, ${io.nickname}` : ''}</h1>
        <p className="tenue">Poker all’italiana, al tavolo con gli amici.</p>
        <div className="home-azioni">
          <button className="principale" onClick={apriTavolo}>Apri un tavolo</button>
          <form className="home-codice" onSubmit={entraConCodice}>
            <input value={codice} maxLength={8} placeholder="Codice invito" aria-label="Codice invito"
              autoCapitalize="characters" onChange={(e) => setCodice(e.target.value)} />
            <button className="secondario" disabled={codice.trim().length < 4}>Entra</button>
          </form>
        </div>
      </section>

      {inviti.length > 0 && (
        <section className="carta">
          <h2>Inviti per te</h2>
          <ul className="elenco">
            {inviti.map((t) => (
              <li key={t.codice} className="home-invito">
                <span className="home-invito-testo">
                  <span className="riga-nome">{t.nome}</span>
                  <span className="riga-info">Da {t.da}, {t.occupati} su {t.posti} seduti</span>
                </span>
                <button className="principale piccolo" onClick={() => vai(`/invito/${t.codice}`)}>Siediti</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="carta">
        <h2>Le tue partite</h2>
        {tavoli === null && <p className="tenue">Carico i tavoli…</p>}
        {nessunTavolo && (
          <p className="tenue">Non sei seduto a nessun tavolo. Aprine uno, oppure entra con il codice o il link che ti hanno mandato.</p>
        )}
        {inCorso.length > 0 && (
          <>
            <h3 className="home-sotto">In corso</h3>
            <ul className="elenco">{inCorso.map(riga)}</ul>
          </>
        )}
        {inAttesa.length > 0 && (
          <>
            <h3 className="home-sotto">In sala d’attesa</h3>
            <ul className="elenco">{inAttesa.map(riga)}</ul>
          </>
        )}
        {chiusi.length > 0 && (
          <details className="home-chiusi">
            <summary>Tavoli chiusi ({chiusi.length})</summary>
            <ul className="elenco">{chiusi.map(riga)}</ul>
          </details>
        )}
      </section>

      {apri && <NuovoTavolo onChiudi={() => setApri(false)} />}

      <section className="carta">
        <div className="home-testa">
          <h2>Amici</h2>
          {daLeggere > 0 && <span className="segnale">{daLeggere} da leggere</span>}
        </div>
        {chat.length === 0 ? (
          <p className="tenue">Nessun messaggio ancora. Nell’elenco dei giocatori trovi tutti gli iscritti: puoi scrivere e invitarli ai tuoi tavoli.</p>
        ) : (
          <ul className="elenco">
            {chat.map((c) => (
              <li key={c.altro}>
                <button className="riga-tavolo" onClick={() => vai(`/messaggi/${c.altro}`)}>
                  <span className="riga-nome">
                    {c.nick}{c.nuovi > 0 && <span className="segnale">{c.nuovi}</span>}
                  </span>
                  <span className="riga-info home-anteprima">
                    {c.mio ? 'Tu: ' : ''}{c.testo} · {giorno(c.quando)} {ora(c.quando)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button className="secondario home-tutti" onClick={() => vai('/giocatori')}>Tutti i giocatori</button>
      </section>

      <ComeSiGioca />
    </main>
  )
}
