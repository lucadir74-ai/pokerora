import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

// Messaggi della chat di un tavolo, in tempo reale.
// onNuovo viene chiamato solo per i messaggi arrivati dopo l'apertura della pagina.
export function useChat(tavoloId, onNuovo) {
  const [messaggi, setMessaggi] = useState([])
  const richiamo = useRef(onNuovo)
  richiamo.current = onNuovo

  useEffect(() => {
    let attivo = true
    supabase.from('messaggi').select('id, giocatore_id, testo, creato_il')
      .eq('tavolo_id', tavoloId).order('id', { ascending: false }).limit(100)
      .then(({ data }) => { if (attivo) setMessaggi((data ?? []).reverse()) })

    const canale = supabase
      .channel(`chat-${tavoloId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messaggi', filter: `tavolo_id=eq.${tavoloId}` },
        ({ new: m }) => {
          setMessaggi((lista) => lista.some((x) => x.id === m.id) ? lista : [...lista, m].slice(-100))
          richiamo.current?.(m)
        })
      .subscribe()
    return () => { attivo = false; supabase.removeChannel(canale) }
  }, [tavoloId])

  const invia = useCallback(async (testo) => {
    const t = testo.trim()
    if (!t) return null
    const { data, error } = await supabase.from('messaggi')
      .insert({ tavolo_id: tavoloId, testo: t.slice(0, 300) })
      .select('id, giocatore_id, testo, creato_il').single()
    if (error) return 'Messaggio non inviato. Riprova.'
    setMessaggi((lista) => lista.some((x) => x.id === data.id) ? lista : [...lista, data].slice(-100))
    return null
  }, [tavoloId])

  return { messaggi, invia }
}
