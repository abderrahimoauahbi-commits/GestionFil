/**
 * LE CHOIX DU DERIVE D'UN LOT (06/11/2026) — seulement quand le lot en a
 * plusieurs (futs de 600 et de 1000 kg du meme lot). Un lot a derive unique
 * ne montre rien : l'ecran reste celui d'avant, et le serveur pose le derive.
 *
 * Pas de choix d'office : la base exige que le mouvement dise lequel bouge
 * (DERIVE-REQUIS) ; le champ vide est signale.
 */
import { type OptionDerive, optionsDesDerives, useDerivesLot } from '../lib/derives'
import { cn, fmt } from '../lib/utils'

/**
 * Le choix parmi des derives deja connus (lignes de stock). Rien sous deux
 * options, sauf `plusieurs` : le lot a plusieurs derives meme si un seul est
 * en stock ici — la base exige alors qu'on le dise.
 */
export function ChoixDerive({
  options,
  valeur,
  onChange,
  className,
  plusieurs,
  ariaLabel = 'Dérivé du lot',
}: {
  options: OptionDerive[]
  valeur: string
  onChange: (v: string) => void
  className?: string
  plusieurs?: boolean
  ariaLabel?: string
}) {
  if (!(plusieurs ?? options.length > 1) || options.length === 0) return null
  const inconnu = !!valeur && !options.some((o) => o.code_derive === valeur)
  return (
    <select
      value={valeur}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      title="Le lot a plusieurs conditionnements : dites lequel bouge"
      className={cn(className, !valeur && 'border-danger')}
    >
      <option value="">Dérivé…</option>
      {inconnu && <option value={valeur}>{valeur}</option>}
      {options.map((o) => (
        <option key={o.code_derive} value={o.code_derive}>
          {o.code_derive}
          {o.conditionnement ? ` · ${o.conditionnement}` : ''}
          {o.quantite_kg != null ? ` · ${fmt.nombre(Number(o.quantite_kg), 0)} kg` : ''}
          {o.bloque ? ' · bloqué' : ''}
        </option>
      ))}
    </select>
  )
}

/** Le choix du derive d'un lot choisi par la recherche (`ChampLot`). */
export function ChampDerive({
  reference,
  lot,
  magasin,
  valeur,
  onChange,
  className,
}: {
  reference: string
  lot: string
  magasin?: string
  valeur: string
  onChange: (v: string) => void
  className?: string
}) {
  const q = useDerivesLot(reference, lot)
  return (
    <ChoixDerive
      options={optionsDesDerives(q.data ?? [], magasin)}
      valeur={valeur}
      onChange={onChange}
      className={className}
    />
  )
}
