// Preferenze personali salvate sul dispositivo (per ora: spizzare o no le carte)
const CHIAVE = 'pokerora_spizzata'
let spizzata = true
try { spizzata = localStorage.getItem(CHIAVE) !== 'no' } catch {}
const ascoltatori = new Set()

export const spizzataAttiva = () => spizzata
export function impostaSpizzata(si) {
  spizzata = si
  try { localStorage.setItem(CHIAVE, si ? 'si' : 'no') } catch {}
  ascoltatori.forEach((f) => f(si))
}
export function ascoltaSpizzata(f) { ascoltatori.add(f); return () => ascoltatori.delete(f) }
