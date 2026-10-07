import { useEffect, useState } from 'react'

// Rotte con l'hash: #/  ·  #/invito/CODICE  ·  #/tavolo/ID
export function leggiRotta() {
  const [, pagina = '', param = ''] = (window.location.hash || '#/').slice(1).split('/')
  return { pagina, param: decodeURIComponent(param) }
}
export function vai(percorso) {
  window.location.hash = percorso
}
export function useRotta() {
  const [rotta, setRotta] = useState(leggiRotta())
  useEffect(() => {
    const f = () => setRotta(leggiRotta())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  return rotta
}

// Invito aperto prima del login: lo teniamo da parte e lo riprendiamo dopo
const CHIAVE = 'pokerora_invito'
export const salvaInvito = (c) => { try { localStorage.setItem(CHIAVE, c) } catch {} }
export const prendiInvito = () => {
  try { const c = localStorage.getItem(CHIAVE); localStorage.removeItem(CHIAVE); return c } catch { return null }
}

export const messaggioErrore = (e) =>
  e?.message?.replace(/^.*?ERROR:\s*/, '') || 'Qualcosa non ha funzionato. Riprova.'
