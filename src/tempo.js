// Durata leggibile tra due istanti: "45 min", "1 h 20 min", "2 h"
export function durata(da, a = new Date()) {
  if (!da) return ''
  const minuti = Math.max(0, Math.floor((new Date(a) - new Date(da)) / 60000))
  const h = Math.floor(minuti / 60)
  const m = minuti % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export const ora = (t) => new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
