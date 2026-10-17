/**
 * LE CHOIX D'UN LOT — le meme partout ou l'on sort, transfere ou fait entrer
 * une reference suivie (demande du 01/10/2026).
 *
 * On ne tape plus un numero au juge : la liste montre les lots que CE MAGASIN
 * tient de CETTE reference, avec ses kilos et sa date d'entree, dans l'ordre ou
 * ils doivent sortir : celui qui perime le premier, puis le plus ancien (FEFO).
 *
 * FEFO PLUTOT QUE FIFO (17/10/2026). La reception laisse saisir une date de
 * peremption, et la base tient la vue `v_lot_fefo` et son index ; seul cet
 * ecran l'ignorait. Au 17/10 aucun lot n'en porte : l'ordre est alors celui
 * des entrees, exactement le FIFO d'avant. Le jour ou une peremption est
 * saisie, le lot qui va perimer passe devant. « Sans lot » reste possible — le stock d'avant le suivi —
 * et « Autre lot… » ouvre la saisie libre, pour un lot qui n'est pas encore en
 * stock (une entree, une regularisation).
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { trierPourSortie } from '../lib/fefo'
import { libelleLot, SANS_LOT } from '../lib/lots'
import { cn, fmt } from '../lib/utils'

interface LotMagasin {
  lot_fournisseur: string
  quantite_kg: number
  date_premiere_entree: string
  /** Saisie a la reception, ou absente — le cas de tous les lots au 17/10/2026. */
  date_peremption?: string | null
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
  proposerPlusAncien,
}: {
  reference: string
  magasin: string
  valeur: string
  onChange: (v: string) => void
  className?: string
  invalide?: boolean
  ariaLabel?: string
  /**
   * LE PREMIER A SORTIR (audit v5, F21) : pour une sortie ou un chargement, le
   * lot qui perime le premier — a defaut, le plus ancien — est propose d'office ;
   * on en choisit un autre si besoin (l'ecran le signale alors). Jamais pour une
   * entree. Le nom date du FIFO ; il est garde pour ne pas toucher les appelants.
   */
  proposerPlusAncien?: boolean
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
  // L'ordre de la vue `v_lot_fefo` : voir lib/fefo.ts, et son test.
  const lots = trierPourSortie(q.data ?? [])
  const plusAncien = lots.find((x) => x.lot_fournisseur !== SANS_LOT && x.quantite_kg > 0)?.lot_fournisseur
  useEffect(() => {
    if (proposerPlusAncien && valeur === '' && !libre && plusAncien) onChange(plusAncien)
  }, [proposerPlusAncien, valeur, libre, plusAncien, onChange])
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
          {x.date_peremption ? ` · périme le ${fmt.date(x.date_peremption)}` : ''}
          {i === 0 && lots.length > 1 ? (x.date_peremption ? ' · à sortir en premier' : ' · le plus ancien') : ''}
        </option>
      ))}
      {!lots.some((x) => x.lot_fournisseur === SANS_LOT) && <option value={SANS_LOT}>Sans lot</option>}
      <option value={AUTRE}>Autre lot…</option>
    </select>
  )
}
