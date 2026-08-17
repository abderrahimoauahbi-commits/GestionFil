/**
 * Compatibilite : les ecrans ecrits avant le design system importent d'ici.
 * Les noms historiques pointent desormais vers les primitives Radix.
 */
export { fmt } from '../lib/utils'
export {
  Bouton as BoutonBase,
  Chargement,
  Alerte,
  Carte,
  CarteEntete,
  CarteTitre,
  CarteCorps,
  Champ,
  Zone,
  Selecteur,
  Etiq,
  Separateur,
  Squelette,
  EtatVide,
} from '../composants/ui/base'

import type { ReactNode } from 'react'
import { Bouton as BoutonUI, Alerte, Badge, EtatVide } from '../composants/ui/base'

/**
 * Anciens tons de couleur, traduits vers les jetons du theme.
 *
 * Nommer une etiquette par sa couleur la fige : « rouge » n'a plus de sens en
 * mode sombre, ou la teinte change. Les nouveaux noms disent l'intention
 * (danger, succes, alerte), et le theme choisit la couleur.
 */
const tonsHistoriques = {
  neutre: 'neutre',
  gris: 'neutre',
  bleu: 'info',
  vert: 'succes',
  ambre: 'alerte',
  rouge: 'danger',
} as const

export function Etiquette({
  ton = 'neutre',
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { ton?: keyof typeof tonsHistoriques }) {
  return (
    <Badge ton={tonsHistoriques[ton]} {...props}>
      {children}
    </Badge>
  )
}

type VarianteHistorique = 'principal' | 'secondaire' | 'discret' | 'danger'

const correspondance: Record<VarianteHistorique, 'principal' | 'contour' | 'discret' | 'danger'> = {
  principal: 'principal',
  secondaire: 'contour',
  discret: 'discret',
  danger: 'danger',
}

export function Bouton({
  variante = 'principal',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VarianteHistorique }) {
  return <BoutonUI variante={correspondance[variante]} {...props} />
}

export function Message({
  ton = 'info',
  titre,
  children,
}: {
  ton?: 'info' | 'attention' | 'erreur' | 'succes'
  titre?: string
  children: ReactNode
}) {
  const tons = { info: 'info', attention: 'alerte', erreur: 'danger', succes: 'succes' } as const
  return (
    <Alerte ton={tons[ton]} titre={titre}>
      {children}
    </Alerte>
  )
}

export function Vide({ texte }: { texte: string }) {
  return <EtatVide titre={texte} />
}
