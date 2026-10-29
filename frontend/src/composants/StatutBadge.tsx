import type { HTMLAttributes } from 'react'
import { CheckCircle2, OctagonAlert, Target, TriangleAlert, type LucideIcon } from 'lucide-react'
import { Badge } from './ui/base'
import { statutMetier, type EntiteStatut } from '../lib/statuts'

/**
 * LE STATUT D'UN DOCUMENT, EN LIBELLÉ ET EN COULEUR — tirés de la table unique
 * (`lib/statuts.ts`). Un écran ne choisit plus ni le mot ni la teinte : il dit
 * de quelle entité vient le code, et la table répond. Un code inconnu
 * s'affiche humanisé, en neutre ; un code absent, en tiret.
 */
/**
 * L'ÉTAT DE COUVERTURE (moteur v2, 27/10/2026) se lit sans la couleur seule :
 * une icône par état, devant le libellé de la table.
 */
const ICONES: Partial<Record<EntiteStatut, Record<string, LucideIcon>>> = {
  statut_stock: {
    RUPTURE_INEVITABLE: OctagonAlert,
    PLAN_NON_COUVERT: OctagonAlert,
    SOUS_SECURITE: TriangleAlert,
    SOUS_CIBLE: Target,
    COUVERT: CheckCircle2,
  },
}

export function StatutBadge({
  entite,
  code,
  ...props
}: { entite: EntiteStatut; code: string | null | undefined } & HTMLAttributes<HTMLSpanElement>) {
  if (code == null || code === '') return <span className="text-attenue-texte">—</span>
  const { libelle, ton } = statutMetier(entite, code)
  const Icone = ICONES[entite]?.[code]
  return (
    <Badge ton={ton} data-statut={code} {...props}>
      {Icone && !props.children && <Icone aria-hidden className="mr-1 inline size-3 shrink-0 align-[-1px]" />}
      {props.children ?? libelle}
    </Badge>
  )
}
