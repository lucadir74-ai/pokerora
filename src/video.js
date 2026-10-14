import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

// ── Video e audio al tavolo, diretti tra i telefoni (WebRTC) ──
// Supabase serve solo a "presentare" i giocatori (segnali e presenza): il video va da telefono a telefono.
// Ogni coppia di giocatori ha una connessione con un canale audio e uno video già pronti:
// accendere o spegnere fotocamera e microfono non richiede di rinegoziare, si sostituisce solo la traccia.
// Fotocamera e microfono partono spenti e si accendono con un tocco.

// Server per trovare la strada tra i telefoni. Il TURN (facoltativo) si configura su Vercel con
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
  const [locale, setLocale] = useState(null)     // anteprima del mio video
  const [flussi, setFlussi] = useState({})       // id giocatore → MediaStream ricevuto
  const [stati, setStati] = useState({})         // id giocatore → { cam, mic }
  const [errore, setErrore] = useState('')

  const canale = useRef(null)
  const pcs = useRef(new Map())                  // id → RTCPeerConnection
  const attese = useRef(new Map())               // id → candidati arrivati prima della connessione
  const tracce = useRef({ audio: null, video: null })
  const mio = useRef({ cam: false, mic: false })
  const sessione = useRef(Math.random().toString(36).slice(2))   // cambia se ricarico la pagina
  const sessioni = useRef(new Map())             // id → sessione vista dell'altro giocatore

  const invia = useCallback((msg) => {
    canale.current?.send({ type: 'broadcast', event: 'segnale', payload: { ...msg, da: mioId } })
  }, [mioId])

  const annunciaStato = useCallback(() => {
    canale.current?.track({ id: mioId, sessione: sessione.current, cam: mio.current.cam, mic: mio.current.mic })
  }, [mioId])

  useEffect(() => {
    if (!attivo || !tavoloId || !mioId) return
    let vivo = true

    const chiudi = (id) => {
      const pc = pcs.current.get(id)
      if (pc) { pc.onicecandidate = null; pc.ontrack = null; pc.onconnectionstatechange = null; pc.close() }
      pcs.current.delete(id)
      attese.current.delete(id)
      setFlussi((f) => { if (!(id in f)) return f; const n = { ...f }; delete n[id]; return n })
    }

    const attaccaTracce = async (pc) => {
      for (const t of pc.getTransceivers()) {
        const tipo = t.receiver.track?.kind
        if (tipo) await t.sender.replaceTrack(tracce.current[tipo] ?? null).catch(() => {})
      }
    }

    const svuotaAttese = async (id, pc) => {
      const lista = attese.current.get(id) ?? []
      attese.current.delete(id)
      for (const c of lista) await pc.addIceCandidate(c).catch(() => {})
    }

    const crea = (id) => {
      chiudi(id)
      const pc = new RTCPeerConnection({ iceServers: serverIce() })
      pcs.current.set(id, pc)
      pc.onicecandidate = (e) => { if (e.candidate) invia({ tipo: 'ice', a: id, candidate: e.candidate.toJSON() }) }
      pc.ontrack = (e) => {
        setFlussi((f) => {
          const s = f[id] ?? new MediaStream()
          if (!s.getTracks().includes(e.track)) s.addTrack(e.track)
          return { ...f, [id]: s }
        })
      }
      pc.onconnectionstatechange = () => {
        // Connessione persa: la ricrea chi ha l'id "minore" (così non la ricreano in due)
        if (['failed', 'disconnected'].includes(pc.connectionState) && pcs.current.get(id) === pc && mioId < id) {
          setTimeout(() => { if (vivo && pcs.current.get(id) === pc && pc.connectionState !== 'connected') chiama(id) }, 3000)
        }
      }
      return pc
    }

    // Chi ha l'id minore chiama, l'altro risponde: niente chiamate incrociate
    const chiama = async (id) => {
      const pc = crea(id)
      pc.addTransceiver('audio', { direction: 'sendrecv' })
      pc.addTransceiver('video', { direction: 'sendrecv' })
      await attaccaTracce(pc)
      await pc.setLocalDescription(await pc.createOffer())
      invia({ tipo: 'offerta', a: id, sdp: pc.localDescription.toJSON() })
    }

    const segnale = async ({ payload: m }) => {
      if (!vivo || !m || m.a !== mioId || m.da === mioId) return
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
      } catch {
        // un segnale andato storto non deve bloccare il tavolo: la connessione si ricrea alla prossima presenza
      }
    }

    const presenza = () => {
      const stato = canale.current?.presenceState() ?? {}
      const nuovi = {}
      for (const voci of Object.values(stato)) {
        const v = voci[voci.length - 1]
        if (v?.id) nuovi[v.id] = { cam: !!v.cam, mic: !!v.mic, sessione: v.sessione }
      }
      setStati(nuovi)
      for (const [id, v] of Object.entries(nuovi)) {
        if (id === mioId) continue
        // Giocatore nuovo, o che ha ricaricato la pagina: chi ha l'id minore lo chiama
        const cambiata = sessioni.current.get(id) !== v.sessione
        sessioni.current.set(id, v.sessione)
        if (mioId < id && (cambiata || !pcs.current.has(id))) chiama(id)
      }
      for (const id of [...pcs.current.keys()]) if (!(id in nuovi)) { chiudi(id); sessioni.current.delete(id) }
    }

    const ch = supabase.channel(`video-${tavoloId}`, {
      config: { broadcast: { self: false }, presence: { key: mioId } },
    })
    canale.current = ch
    ch.on('broadcast', { event: 'segnale' }, segnale)
      .on('presence', { event: 'sync' }, presenza)
      .subscribe((s) => { if (s === 'SUBSCRIBED') annunciaStato() })

    return () => {
      vivo = false
      for (const id of [...pcs.current.keys()]) chiudi(id)
      for (const t of Object.values(tracce.current)) t?.stop()
      tracce.current = { audio: null, video: null }
      mio.current = { cam: false, mic: false }
      sessioni.current.clear()
      setCam(false); setMic(false); setLocale(null); setStati({})
      supabase.removeChannel(ch)
      canale.current = null
    }
  }, [attivo, tavoloId, mioId, invia, annunciaStato])

  // Sostituisce la traccia (o la toglie) in tutte le connessioni aperte
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

  return { cam, mic, locale, flussi, stati, errore, alternaCam, alternaMic }
}
