import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import Carta from './Carta'
import { messaggioErrore } from './rotte'
import { fmt, invitoDi } from './regole'

const COPPIA = { 11: 'fanti', 12: 'donne', 13: 're' }

export default function Gioco({ tavolo, giocatori, io }) {
  const [mano, setMano] = useState(null)
  const [posti, setPosti] = useState([])
  const [carte, setCarte] = useState([])
  const [registro, setRegistro] = useState([])
  const [scelte, setScelte] = useState([])
  const [importo, setImporto] = useState('')
  const [errore, setErrore] = useState('')
  const [attesa, setAttesa] = useState(false)

  const idMano = tavolo.mano_corrente

  const carica = useCallback(async () => {
    if (!idMano) { setMano(null); return }
    const [m, g, c, r] = await Promise.all([
      supabase.from('mani').select('*').eq('id', idMano).maybeSingle(),
      supabase.from('mani_giocatori').select('*').eq('mano_id', idMano).order('posto'),
      supabase.from('mani_carte').select('carte').eq('mano_id', idMano).eq('giocatore_id', io.id).maybeSingle(),
      supabase.from('mani_azioni').select('id, testo').eq('mano_id', idMano).order('id', { ascending: false }).limit(12),
    ])
    setMano(m.data ?? null)
    setPosti(g.data ?? [])
    setCarte(c.data?.carte ?? [])
    setRegistro(r.data ?? [])
  }, [idMano, io.id])

  useEffect(() => {
    carica()
    const canale = supabase
      .channel(`gioco-${tavolo.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mani_azioni', filter: `tavolo_id=eq.${tavolo.id}` }, carica)
      .subscribe()
    return () => { supabase.removeChannel(canale) }
  }, [tavolo.id, carica])

  // Nuova fase o nuovo turno: azzera scelte e importo
  useEffect(() => { setScelte([]); setImporto('') }, [mano?.fase, mano?.turno, idMano])

  async function rpc(nome, parametri) {
    setErrore('')
    setAttesa(true)
    const { error } = await supabase.rpc(nome, parametri)
    setAttesa(false)
    if (error) { setErrore(messaggioErrore(error)); return false }
    await carica()
    return true
  }

  const nomeDi = (id) => giocatori.find((g) => g.giocatore_id === id)?.profili?.nickname ?? 'giocatore'
  const fichesDi = (id) => giocatori.find((g) => g.giocatore_id === id)?.fiches ?? 0

  // Nessuna mano ancora, oppure mano conclusa
  const conclusa = !mano || mano.fase === 'finita' || mano.fase === 'annullata'

  const mio = posti.find((p) => p.giocatore_id === io.id)
  const mioTurno = !!mano && !!mio && mio.stato === 'attivo' && mano.turno === mio.posto
  const diTurno = posti.find((p) => p.posto === mano?.turno)
  const invito = invitoDi(tavolo)
  const daVedere = mano && mio ? mano.puntata - mio.versato_giro : 0
  const limite = tavolo.regole?.limite ?? 'piatto'
  const tetto = !mano ? null
    : limite === 'piatto' ? mano.piatto + daVedere
    : limite === 'fisso' ? Number(tavolo.regole?.puntata_massima) || null
    : null
  const cambioMax = Number(tavolo.regole?.cambio_max) || 4
  const valore = importo === '' ? invito : Number(importo)

  function scegli(c) {
    setScelte((s) => s.includes(c) ? s.filter((x) => x !== c) : s.length < cambioMax ? [...s, c] : s)
  }

  const azione = (tipo, imp = 0) => rpc('azione', { p_mano: mano.id, p_tipo: tipo, p_importo: imp })

  const campoImporto = (etichetta, tipo) => (
      <div className="puntata">
        <label>
          {etichetta}
          <input type="number" inputMode="numeric" min={invito} max={tetto ?? undefined} step={1}
            value={importo} placeholder={String(invito)} onChange={(e) => setImporto(e.target.value)} />
        </label>
        <div className="rapidi">
          <button type="button" className="chip" onClick={() => setImporto(String(invito))}>Invito</button>
          {tetto && <button type="button" className="chip" onClick={() => setImporto(String(Math.max(invito, Math.floor(tetto / 2))))}>Metà</button>}
          {tetto && <button type="button" className="chip" onClick={() => setImporto(String(tetto))}>Massimo</button>}
        </div>
        <button className="principale" disabled={attesa} onClick={() => azione(tipo, valore)}>
          {tipo === 'apro' ? `Apro con ${fmt(valore)}` : tipo === 'punto' ? `Punto ${fmt(valore)}` : `Rilancio di ${fmt(valore)}`}
        </button>
        <small>Minimo {fmt(invito)}{tetto ? `, massimo ${fmt(tetto)}` : ''}</small>
      </div>
  )

  function azioni() {
    if (!mano || conclusa) return null
    if (!mio || mio.stato !== 'attivo') return <p className="tenue">Sei fuori da questa mano.</p>
    if (!mioTurno) {
      return <p className="tenue">Tocca a {diTurno ? nomeDi(diTurno.giocatore_id) : '…'}.</p>
    }
    if (mano.fase === 'cambio') {
      return (
        <div className="azioni-gioco">
          <p>Tocca le carte da scartare (al massimo {cambioMax}).</p>
          <button className="principale" disabled={attesa}
            onClick={() => rpc('cambia', { p_mano: mano.id, p_scarti: scelte })}>
            {scelte.length === 0 ? 'Sono servito' : scelte.length === 1 ? 'Cambia 1 carta' : `Cambia ${scelte.length} carte`}
          </button>
        </div>
      )
    }
    if (mano.fase === 'apertura') {
      return (
        <div className="azioni-gioco">
          <button className="secondario" disabled={attesa} onClick={() => azione('passo')}>Passo</button>
          {campoImporto('Apertura', 'apro')}
        </div>
      )
    }
    if (mano.puntata > 0) {
      return (
        <div className="azioni-gioco">
          <div className="bottoni">
            <button className="secondario" disabled={attesa} onClick={() => azione('passo')}>Lascio</button>
            {daVedere > 0 && <button className="secondario" disabled={attesa} onClick={() => azione('vedo')}>Vedo ({fmt(daVedere)})</button>}
          </div>
          {campoImporto('Rilancio', 'rilancio')}
        </div>
      )
    }
    return (
      <div className="azioni-gioco">
        <div className="bottoni">
          <button className="secondario" disabled={attesa} onClick={() => azione('busso')}>Busso</button>
          {mano.parol_possibile && <button className="secondario" disabled={attesa} onClick={() => azione('parol')}>Parol</button>}
        </div>
        {campoImporto('Puntata', 'punto')}
      </div>
    )
  }

  const fase = !mano ? '' : {
    apertura: `Apertura: serve almeno una coppia di ${COPPIA[mano.requisito]}`,
    primo_giro: 'Primo giro di puntate',
    cambio: 'Cambio delle carte',
    secondo_giro: 'Secondo giro di puntate',
    finita: 'Mano conclusa',
    annullata: 'Mano annullata',
  }[mano.fase]

  const stato = (p) => {
    if (p.stato === 'fuori') return 'ha lasciato'
    if (mano.fase === 'cambio' && p.cambio !== null) return p.cambio === 0 ? 'servito' : `cambia ${p.cambio}`
    if (p.versato_giro > 0) return `${fmt(p.versato_giro)} in questo giro`
    return ''
  }

  return (
    <section className="carta gioco">
      <div className="gioco-testa">
        <h2>{mano ? `Mano ${mano.numero}` : 'Pronti a giocare'}</h2>
        {mano && <p className="piatto">Piatto <strong>{fmt(mano.piatto)}</strong></p>}
      </div>
      {mano && <p className="fase">{fase}</p>}

      {mano && (
        <ul className="giro">
          {posti.map((p) => (
            <li key={p.giocatore_id}
              className={`${p.posto === mano.turno ? 'di-turno' : ''} ${p.stato === 'fuori' ? 'fuori' : ''} ${conclusa && p.vincita > 0 ? 'vincente' : ''}`}>
              <span className="giro-nome">
                {nomeDi(p.giocatore_id)}{p.giocatore_id === io.id ? ' (tu)' : ''}
                {p.posto === mano.mazziere && <span className="segno" title="Mazziere">M</span>}
                {p.giocatore_id === mano.apritore && <span className="segno apre" title="Ha aperto">A</span>}
              </span>
              <span className="giro-info">{fmt(fichesDi(p.giocatore_id))}</span>
              <span className="giro-stato">{stato(p)}</span>
              {conclusa && p.carte_mostrate && (
                <span className="giro-mostrate">
                  {p.carte_mostrate.map((c) => <Carta key={c} c={c} piccola />)}
                  <span className="giro-punto">{p.punto}{p.vincita > 0 ? `: vince ${fmt(p.vincita)}` : ''}</span>
                </span>
              )}
              {conclusa && !p.carte_mostrate && p.vincita > 0 && (
                <span className="giro-punto">vince {fmt(p.vincita)} senza mostrare le carte</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {mano && carte.length > 0 && !(conclusa && mio?.carte_mostrate) && (
        <div className="mie-carte" aria-label="Le tue carte">
          {carte.map((c) => (
            <Carta key={c} c={c} scelta={scelte.includes(c)}
              onClick={mano.fase === 'cambio' && mioTurno ? () => scegli(c) : undefined} />
          ))}
        </div>
      )}

      {errore && (
        <div className="errore-gioco" role="alert">
          <p className="errore">{errore}</p>
          {errore.includes('fiches') && (
            <button className="secondario" disabled={attesa}
              onClick={() => rpc('prendi_posta', { p_tavolo: tavolo.id })}>
              Prendi un’altra posta ({fmt(tavolo.valore_posta)})
            </button>
          )}
        </div>
      )}

      {azioni()}

      {conclusa && (
        <button className="principale" disabled={attesa} onClick={() => rpc('nuova_mano', { p_tavolo: tavolo.id })}>
          {mano ? 'Distribuisci la prossima mano' : 'Distribuisci la prima mano'}
        </button>
      )}

      {registro.length > 0 && (
        <ol className="cronaca" reversed>
          {registro.map((r) => <li key={r.id}>{r.testo}</li>)}
        </ol>
      )}
    </section>
  )
}
