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
 *
 * AVEC RECHERCHE (24/10/2026). La liste etait un `<select>` des 200 premiers
 * lots, coupe sans le dire. On tape maintenant un morceau du numero ; le
 * serveur cherche dans le stock du magasin (`/api/recherche/lot`, meme ordre
 * FEFO) et dit s'il en reste. Les props n'ont pas change.
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SANS_LOT } from '../lib/lots'
import { cn } from '../lib/utils'
import { chercherChoix, ChoixRecherche, classeDuChamp, classeEnveloppe, useLigneChoix } from './ChoixRecherche'

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
  const filtres = { code_reference: reference, code_magasin: magasin }
  const avecListe = !!reference && !!magasin

  // Le premier a sortir, dans l'ordre FEFO du serveur (le « Sans lot » exclu).
  const qPremier = useQuery({
    queryKey: ['lot-premier-a-sortir', reference, magasin],
    queryFn: ({ signal }) =>
      chercherChoix<{ lot_fournisseur: string }>('lot', { filtres, limite: 1, exclure: [SANS_LOT], signal }),
    enabled: avecListe && !!proposerPlusAncien,
  })
  const plusAncien = qPremier.data?.lignes[0]?.lot_fournisseur
  useEffect(() => {
    if (proposerPlusAncien && valeur === '' && !libre && plusAncien) onChange(plusAncien)
  }, [proposerPlusAncien, valeur, libre, plusAncien, onChange])

  // UN LOT QUE LE MAGASIN NE CONNAIT PAS se saisit librement (une entree).
  const relu = useLigneChoix(
    'lot',
    avecListe && valeur !== '' && valeur !== SANS_LOT ? valeur : null,
    filtres,
  )
  const connu = valeur === '' || valeur === SANS_LOT || relu.isLoading || !!relu.data
  const style = cn(className, invalide && 'border-danger')

  // Sans magasin ou sans reference, pas de liste a proposer : la saisie libre.
  if (!avecListe || libre || !connu) {
    return (
      <div className="flex items-center gap-1">
        <input
          value={valeur}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Lot fournisseur"
          aria-label={ariaLabel}
          className={style}
        />
        {avecListe && (libre || !connu) && (
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
    <ChoixRecherche
      type="lot"
      valeur={valeur}
      filtres={filtres}
      exclure={[SANS_LOT]}
      supplements={[
        { valeur: SANS_LOT, libelle: 'Sans lot', info: 'le stock d’avant le suivi par lot' },
        { valeur: AUTRE, libelle: 'Autre lot…', info: 'saisir un numéro qui n’est pas en stock ici' },
      ]}
      onChange={(v) => {
        if (v === AUTRE) {
          setLibre(true)
          onChange('')
        } else onChange(v)
      }}
      vide="Choisir un lot…"
      ariaLabel={ariaLabel}
      invalide={invalide}
      className={cn('min-w-0', classeEnveloppe(className))}
      classeChamp={classeDuChamp(className)}
    />
  )
}
