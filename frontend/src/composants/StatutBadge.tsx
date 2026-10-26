import type { HTMLAttributes } from 'react'
import { Badge } from './ui/base'
import { statutMetier, type EntiteStatut } from '../lib/statuts'

/**
 * LE STATUT D'UN DOCUMENT, EN LIBELLÉ ET EN COULEUR — tirés de la table unique
 * (`lib/statuts.ts`). Un écran ne choisit plus ni le mot ni la teinte : il dit
 * de quelle entité vient le code, et la table répond. Un code inconnu
 * s'affiche humanisé, en neutre ; un code absent, en tiret.
 */
export function StatutBadge({
  entite,
  code,
  ...props
}: { entite: EntiteStatut; code: string | null | undefined } & HTMLAttributes<HTMLSpanElement>) {
  if (code == null || code === '') return <span className="text-attenue-texte">—</span>
  const { libelle, ton } = statutMetier(entite, code)
  return (
    <Badge ton={ton} data-statut={code} {...props}>
      {props.children ?? libelle}
    </Badge>
  )
}
