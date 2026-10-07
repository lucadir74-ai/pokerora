import { dividiPosta, fmt } from './regole'

export default function Fiches({ valore }) {
  const tagli = dividiPosta(valore)
  return (
    <div className="fiches-blocco">
      <p className="posta-valore">1 posta = {fmt(valore)}</p>
      <ul className="fiches" aria-label="Divisione della posta in fiches">
        {tagli.map(({ taglio, pezzi }) => (
          <li key={taglio} className={`fiche f${taglio}`}>
            <span className="fiche-disco">{taglio}</span>
            <span className="fiche-pezzi">× {pezzi}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
