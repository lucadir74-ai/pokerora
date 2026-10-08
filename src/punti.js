// Valutazione del punto: copia fedele di public.valuta_mano e public.nome_punto sul server.
// Serve solo a mostrare al giocatore il suo punto; chi vince lo decide sempre il server.

const valore = (c) => '23456789TJQKA'.indexOf(c[0]) + 2
const seme = (c) => ({ C: 4, Q: 3, F: 2, P: 1 })[c[1]]

export function valutaMano(carte, bassa) {
  const ord = [...carte].sort((a, b) => valore(b) - valore(a) || seme(b) - seme(a))
  const v = ord.map(valore)
  const s = ord.map(seme)
  const colore = new Set(s).size === 1
  let scala = false, assoBasso = false, alta = 0, semeAlta = 0
  if (new Set(v).size === 5) {
    if (v[0] - v[4] === 4) { scala = true; alta = v[0]; semeAlta = s[0] }
    else if (v[0] === 14 && v[1] === bassa + 3 && v[4] === bassa) {
      scala = true; assoBasso = true; alta = v[1]; semeAlta = s[1]
    }
  }
  if (scala && colore) return [9, assoBasso ? 1 : alta === 14 ? 3 : 2, alta, semeAlta]

  const gruppi = {}
  v.forEach((x, i) => { (gruppi[x] ??= []).push(s[i]) })
  const lista = Object.entries(gruppi)
    .map(([x, semi]) => ({ val: Number(x), n: semi.length, maxSeme: Math.max(...semi) }))
    .sort((a, b) => b.n - a.n || b.val - a.val)
  const quad = lista.find((g) => g.n === 4)
  const tris = lista.find((g) => g.n === 3)
  const coppie = lista.filter((g) => g.n === 2)
  const singole = lista.filter((g) => g.n === 1).map((g) => g.val)

  if (quad) return [8, quad.val, ...singole]
  if (colore) return [7, ...v, s[0]]
  if (tris && coppie.length === 1) return [6, tris.val, coppie[0].val]
  if (scala) return [5, alta, semeAlta]
  if (tris) return [4, tris.val, ...singole]
  if (coppie.length === 2) return [3, coppie[0].val, coppie[1].val, singole[0], coppie[0].maxSeme]
  if (coppie.length === 1) return [2, coppie[0].val, ...singole, coppie[0].maxSeme]
  return [1, ...v, s[0]]
}

function nomeValore(p, plurale = false) {
  if (p === 11) return plurale ? 'fanti' : 'fante'
  if (p === 12) return plurale ? 'donne' : 'donna'
  if (p === 13) return 're'
  if (p === 14) return plurale ? 'assi' : 'asso'
  return String(p)
}

export function nomePunto(p) {
  switch (p[0]) {
    case 9: return 'Scala reale ' + ['minima', 'media', 'massima'][p[1] - 1]
    case 8: return 'Poker di ' + nomeValore(p[1], true)
    case 7: return 'Colore'
    case 6: return 'Full di ' + nomeValore(p[1], true) + ' e ' + nomeValore(p[2], true)
    case 5: return p[1] === 14 ? 'Scala all\u2019asso' : 'Scala al ' + nomeValore(p[1])
    case 4: return 'Tris di ' + nomeValore(p[1], true)
    case 3: return 'Doppia coppia di ' + nomeValore(p[1], true) + ' e ' + nomeValore(p[2], true)
    case 2: return 'Coppia di ' + nomeValore(p[1], true)
    default: return 'Carta alta: ' + nomeValore(p[1])
  }
}

// Si apre con almeno una coppia del requisito (o un punto superiore),
// oppure con 4 carte di fila dello stesso seme senza l'asso
export function puoAprire(carte, requisito, bassa) {
  const v = valutaMano(carte, bassa)
  if (v[0] >= 3) return true
  if (v[0] === 2 && v[1] >= requisito) return true
  return carte.some((a) => a[0] !== 'A' &&
    carte.filter((b) => b[1] === a[1] && b[0] !== 'A' &&
      valore(b) >= valore(a) && valore(b) <= valore(a) + 3).length === 4)
}
