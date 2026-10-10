import { SEMI, NOMI_SEMI, valoreVisibile } from './regole'

const NOMI_VALORI = { J: 'fante', Q: 'donna', K: 're', A: 'asso', T: '10' }

export default function Carta({ c, scelta, onClick, piccola, indice }) {
  const rossa = c[1] === 'C' || c[1] === 'Q'
  const nome = `${NOMI_VALORI[c[0]] ?? c[0]} di ${NOMI_SEMI[c[1]]}`
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      className={`carta-gioco${rossa ? ' rossa' : ''}${scelta ? ' scelta' : ''}${piccola ? ' piccola' : ''}`}
      onClick={onClick}
      aria-pressed={onClick ? !!scelta : undefined}
      aria-label={nome}
      type={onClick ? 'button' : undefined}
    >
      <span className="cg-valore">{valoreVisibile(c)}{indice && <small className="cg-mini">{SEMI[c[1]]}</small>}</span>
      <span className="cg-seme">{SEMI[c[1]]}</span>
    </Tag>
  )
}
