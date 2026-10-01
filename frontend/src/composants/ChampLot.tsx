/**
 * LE CHOIX D'UN LOT — le meme partout ou l'on sort, transfere ou fait entrer
 * une reference suivie (demande du 01/10/2026).
 *
 * On ne tape plus un numero au juge : la liste montre les lots que CE MAGASIN
 * tient de CETTE reference, le plus ancien d'abord (FIFO), avec ses kilos et
 * sa date d'entree. « Sans lot » reste possible — le stock d'avant le suivi —
 * et « Autre lot… » ouvre la saisie libre, pour un lot qui n'est pas encore en
 * stock (une entree, une regularisation).
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { libelleLot, SANS_LOT } from '../lib/lots'
import { cn, fmt } from '../lib/utils'

interface LotMagasin {
  lot_fournisseur: string
  quantite_kg: number
  date_premiere_entree: string
}

const AUTRE = '__autre__'

export function ChampLot({
  reference,
  magasin,
  valeur,
  onChange,
  className,
  invalide,
  ariaLabel = 'Lot fournisseur',
}: {
  reference: string
  magasin: string
  valeur: string
  onChange: (v: string) => void
  className?: string
  invalide?: boolean
  ariaLabel?: string
}) {
  const [libre, setLibre] = useState(false)
  const q = useQuery({
    queryKey: ['lots-reference-magasin', reference, magasin],
    queryFn: () =>
      api.get<LotMagasin[]>(
        `/api/stock/lots?code_reference=${encodeURIComponent(reference)}&code_magasin=${encodeURIComponent(magasin)}&limite=200`,
      ),
    enabled: !!reference && !!magasin,
  })
  const lots = [...(q.data ?? [])].sort((a, b) => a.date_premiere_entree.localeCompare(b.date_premiere_entree))
  const connu = valeur === '' || valeur === SANS_LOT || lots.some((x) => x.lot_fournisseur === valeur)
  const style = cn(className, invalide && 'border-danger')

  // Sans magasin ou sans reference, pas de liste a proposer : la saisie libre.
  if (!reference || !magasin || libre || !connu) {
    return (
      <div className="flex items-center gap-1">
        <input
          value={valeur}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Lot fournisseur"
          aria-label={ariaLabel}
          className={style}
        />
        {reference && magasin && (libre || !connu) && (
          <button
            type="button"
            onClick={() => {
              setLibre(false)
              onChange('')
            }}
            className="shrink-0 text-[11px] text-attenue-texte underline hover:text-texte"
            title="Revenir à la liste des lots du magasin"
          >
            liste
          </button>
        )}
      </div>
    )
  }

  return (
    <select
      value={valeur}
      aria-label={ariaLabel}
      className={style}
      onChange={(e) => {
        if (e.target.value === AUTRE) {
          setLibre(true)
          onChange('')
        } else onChange(e.target.value)
      }}
    >
      <option value="">{q.isLoading ? 'Lecture des lots…' : 'Choisir un lot…'}</option>
      {lots.map((x, i) => (
        <option key={x.lot_fournisseur} value={x.lot_fournisseur}>
          {libelleLot(x.lot_fournisseur)} · {fmt.nombre(x.quantite_kg, 0)} kg · {fmt.date(x.date_premiere_entree)}
          {i === 0 && lots.length > 1 ? ' · le plus ancien' : ''}
        </option>
      ))}
      {!lots.some((x) => x.lot_fournisseur === SANS_LOT) && <option value={SANS_LOT}>Sans lot</option>}
      <option value={AUTRE}>Autre lot…</option>
    </select>
  )
}
