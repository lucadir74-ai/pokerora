import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'

// ── Video e audio al tavolo, diretti tra i dispositivi (WebRTC) ──
// Supabase serve solo a "presentare" i dispositivi (segnali e presenza): il video va da dispositivo a dispositivo.
// Ogni DISPOSITIVO è un partecipante a sé (sessione), non l'account: chi apre il tavolo da PC e da telefono
// insieme non confonde i collegamenti. I miei dispositivi non si collegano tra loro (niente eco).
// Ogni coppia ha un canale audio e uno video già pronti: accendere o spegnere fotocamera e microfono
// sostituisce solo la traccia, senza rinegoziare. Fotocamera e microfono partono spenti.

// Server per trovare la strada tra i dispositivi. Il TURN si configura su Vercel con
// VITE_TURN_URL (anche più indirizzi separati da virgola), VITE_TURN_USER e VITE_TURN_PASS.
function serverIce() {
  const lista = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
  const url = import.meta.env.VITE_TURN_URL
  if (url) {
    lista.push({
      urls: url.split(',').map((x) => x.trim()).filter(Boolean),
      username: import.meta.env.VITE_TURN_USER,
      credential: import.meta.env.VITE_TURN_PASS,
    })
  }
  return lista
}

const VINCOLI_VIDEO = { facingMode: 'user', width: { ideal: 240 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 20 } }
const VINCOLI_AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }

export function useVideoTavolo(tavoloId, mioId, attivo) {
  const [cam, setCam] = useState(false)
  const [mic, setMic] = useState(false)
  const [locale, setLocale] = useState(null)       // anteprima del mio video
  const [ricevuti, setRicevuti] = useState({})     // sessione → MediaStream ricevuto
  const [presenti, setPresenti] = useState({})     // sessione → { id, cam, mic }
  const [errore, setErrore] = useState('')
  const [collegamenti, setCollegamenti] = useState({}) // sessione → stato del collegamento (per capire cosa non va)

  const canale = useRef(null)
  const pcs = useRef(new Map())                    // sessione → RTCPeerConnection
  const attese = useRef(new Map())                 // sessione → candidati arrivati prima della connessione
  const tracce = useRef({ audio: null, video: null })
  const mio = useRef({ cam: false, mic: false })
  const sessione = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)

  const invia = useCallback((msg) => {
    canale.current?.send({ type: 'broadcast', event: 'segnale', payload: { ...msg, da: sessione.current } })
  }, [])

  const annunciaStato = useCallback(() => {
    canale.current?.track({ id: mioId, sessione: sessione.current, cam: mio.current.cam, mic: mio.current.mic })
  }, [mioId])

  useEffect(() => {
    if (!attivo || !tavoloId || !mioId) return
    let vivo = true
    const me = sessione.current

    const chiudi = (s) => {
      const pc = pcs.current.get(s)
      if (pc) { pc.onicecandidate = null; pc.ontrack = null; pc.onconnectionstatechange = null; pc.close() }
      pcs.current.delete(s)
      attese.current.delete(s)
      setRicevuti((f) => { if (!(s in f)) return f; const n = { ...f }; delete n[s]; return n })
      setCollegamenti((f) => { if (!(s in f)) return f; const n = { ...f }; delete n[s]; return n })
    }

    const attaccaTracce = async (pc) => {
      for (const t of pc.getTransceivers()) {
        const tipo = t.receiver.track?.kind
        if (tipo) await t.sender.replaceTrack(tracce.current[tipo] ?? null).catch(() => {})
      }
    }

    const svuotaAttese = async (s, pc) => {
      const lista = attese.current.get(s) ?? []
      attese.current.delete(s)
      for (const c of lista) await pc.addIceCandidate(c).catch(() => {})
    }

    const crea = (s) => {
      chiudi(s)
      const pc = new RTCPeerConnection({ iceServers: serverIce() })
      pcs.current.set(s, pc)
      pc.onicecandidate = (e) => { if (e.candidate) invia({ tipo: 'ice', a: s, candidate: e.candidate.toJSON() }) }
      pc.ontrack = (e) => {
        setRicevuti((f) => {
          const st = f[s] ?? new MediaStream()
          if (!st.getTracks().includes(e.track)) st.addTrack(e.track)
          return { ...f, [s]: st }
        })
      }
      setCollegamenti((f) => ({ ...f, [s]: 'new' }))
      pc.onconnectionstatechange = () => {
        if (pcs.current.get(s) === pc) setCollegamenti((f) => ({ ...f, [s]: pc.connectionState }))
        // Collegamento perso: lo ricrea chi ha la sessione "minore" (così non lo ricreano in due)
        if (['failed', 'disconnected'].includes(pc.connectionState) && pcs.current.get(s) === pc && me < s) {
          setTimeout(() => { if (vivo && pcs.current.get(s) === pc && pc.connectionState !== 'connected') chiama(s) }, 3000)
        }
      }
      return pc
    }

    // Chiama chi ha la sessione minore, l'altro risponde: niente chiamate incrociate
    const chiama = async (s) => {
      try {
        const pc = crea(s)
        pc.addTransceiver('audio', { direction: 'sendrecv' })
        pc.addTransceiver('video', { direction: 'sendrecv' })
        await attaccaTracce(pc)
        await pc.setLocalDescription(await pc.createOffer())
        invia({ tipo: 'offerta', a: s, sdp: pc.localDescription.toJSON() })
      } catch { /* si riprova alla prossima presenza */ }
    }

    const segnale = async ({ payload: m }) => {
      if (!vivo || !m || m.a !== me || m.da === me) return
      try {
        if (m.tipo === 'offerta') {
          const pc = crea(m.da)
          await pc.setRemoteDescription(m.sdp)
          for (const t of pc.getTransceivers()) t.direction = 'sendrecv'
          await attaccaTracce(pc)
          await pc.setLocalDescription(await pc.createAnswer())
          invia({ tipo: 'risposta', a: m.da, sdp: pc.localDescription.toJSON() })
          await svuotaAttese(m.da, pc)
        } else if (m.tipo === 'risposta') {
          const pc = pcs.current.get(m.da)
          if (pc && pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(m.sdp)
            await svuotaAttese(m.da, pc)
          }
        } else if (m.tipo === 'ice') {
          const pc = pcs.current.get(m.da)
          if (pc && pc.remoteDescription) await pc.addIceCandidate(m.candidate).catch(() => {})
          else attese.current.set(m.da, [...(attese.current.get(m.da) ?? []), m.candidate])
        }
      } catch { /* un segnale andato storto non blocca il tavolo */ }
    }

    const presenza = () => {
      const stato = canale.current?.presenceState() ?? {}
      const nuovi = {}
      for (const voci of Object.values(stato)) {
        for (const v of voci) {
          if (v?.id && v?.sessione) nuovi[v.sessione] = { id: v.id, cam: !!v.cam, mic: !!v.mic }
        }
      }
      setPresenti(nuovi)
      for (const [s, v] of Object.entries(nuovi)) {
        if (s === me || v.id === mioId) continue          // non mi collego a me stesso né ai miei altri dispositivi
        if (me < s && !pcs.current.has(s)) chiama(s)
      }
      for (const s of [...pcs.current.keys()]) if (!(s in nuovi)) chiudi(s)
    }

    const ch = supabase.channel(`video-${tavoloId}`, {
      config: { broadcast: { self: false }, presence: { key: me } },
    })
    canale.current = ch
    ch.on('broadcast', { event: 'segnale' }, segnale)
      .on('presence', { event: 'sync' }, presenza)
      .subscribe((st) => { if (st === 'SUBSCRIBED') annunciaStato() })

    return () => {
      vivo = false
      for (const s of [...pcs.current.keys()]) chiudi(s)
      for (const t of Object.values(tracce.current)) t?.stop()
      tracce.current = { audio: null, video: null }
      mio.current = { cam: false, mic: false }
      setCam(false); setMic(false); setLocale(null); setPresenti({}); setCollegamenti({})
      supabase.removeChannel(ch)
      canale.current = null
    }
  }, [attivo, tavoloId, mioId, invia, annunciaStato])

  // Per ogni giocatore: acceso se lo è uno dei suoi dispositivi; si mostra il video del dispositivo con la fotocamera accesa
  const { flussi, stati, audio, doppio } = useMemo(() => {
    const flussi = {}, stati = {}, audio = []
    let doppio = false
    for (const [s, v] of Object.entries(presenti)) {
      if (v.id === mioId) { if (s !== sessione.current) doppio = true; continue }
      const prima = stati[v.id] ?? { cam: false, mic: false, collegato: false, stato: null }
      const c = collegamenti[s] ?? null
      stati[v.id] = {
        cam: prima.cam || v.cam, mic: prima.mic || v.mic,
        collegato: prima.collegato || c === 'connected',
        stato: c === 'connected' ? 'connected' : prima.stato === 'connected' ? 'connected' : (c ?? prima.stato),
      }
      if (ricevuti[s] && (v.cam || !flussi[v.id])) flussi[v.id] = ricevuti[s]
      if (v.mic && ricevuti[s]) audio.push({ chiave: s, stream: ricevuti[s] })
    }
    return { flussi, stati, audio, doppio }
  }, [presenti, ricevuti, collegamenti, mioId])

  // Sostituisce la traccia (o la toglie) in tutti i collegamenti aperti
  const sostituisci = async (tipo, traccia) => {
    for (const pc of pcs.current.values()) {
      for (const t of pc.getTransceivers()) {
        if (t.receiver.track?.kind === tipo) await t.sender.replaceTrack(traccia).catch(() => {})
      }
    }
  }

  const accendi = async (tipo) => {
    setErrore('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrore('Questo browser non permette di usare fotocamera e microfono.')
      return false
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia(tipo === 'video' ? { video: VINCOLI_VIDEO } : { audio: VINCOLI_AUDIO })
      const t = tipo === 'video' ? s.getVideoTracks()[0] : s.getAudioTracks()[0]
      tracce.current[tipo] = t
      await sostituisci(tipo, t)
      return t
    } catch (e) {
      setErrore(e?.name === 'NotAllowedError'
        ? `Permesso negato: abilita ${tipo === 'video' ? 'la fotocamera' : 'il microfono'} per questo sito nelle impostazioni del browser.`
        : `Non riesco ad accendere ${tipo === 'video' ? 'la fotocamera' : 'il microfono'}.`)
      return false
    }
  }

  const spegni = async (tipo) => {
    tracce.current[tipo]?.stop()
    tracce.current[tipo] = null
    await sostituisci(tipo, null)
  }

  const alternaCam = async () => {
    if (mio.current.cam) {
      await spegni('video')
      mio.current.cam = false; setCam(false); setLocale(null)
    } else {
      const t = await accendi('video')
      if (!t) return
      mio.current.cam = true; setCam(true); setLocale(new MediaStream([t]))
    }
    annunciaStato()
  }

  const alternaMic = async () => {
    if (mio.current.mic) {
      await spegni('audio')
      mio.current.mic = false; setMic(false)
    } else {
      const t = await accendi('audio')
      if (!t) return
      mio.current.mic = true; setMic(true)
    }
    annunciaStato()
  }

  return { cam, mic, locale, flussi, stati, audio, doppio, errore, alternaCam, alternaMic }
}
