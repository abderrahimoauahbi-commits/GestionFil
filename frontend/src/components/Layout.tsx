/**
 * Compatibilite : la coquille applicative a ete remplacee par `Coquille`,
 * qui apporte la barre laterale repliable, le fil d'Ariane, le theme et la
 * palette de commandes.
 */
export { Coquille as Layout, EnTetePage as EnTetePageBase } from '../composants/Coquille'

import { EnTetePage as Base } from '../composants/Coquille'

/** Ancienne signature : `sous_titre` au lieu de `description`. */
export function EnTetePage({
  titre,
  sous_titre,
  actions,
}: {
  titre: string
  sous_titre?: React.ReactNode
  actions?: React.ReactNode
}) {
  return <Base titre={titre} description={sous_titre} actions={actions} />
}
