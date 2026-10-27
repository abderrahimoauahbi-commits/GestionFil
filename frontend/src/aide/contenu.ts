/**
 * LE CATALOGUE D'AIDE — une fiche par ecran.
 *
 * Il alimente l'aide contextuelle (le « ? » de chaque ecran) et le manuel
 * imprimable. Voir `types.ts` pour la forme d'une fiche et la raison de cet
 * ordre de sections.
 *
 * UN ECRAN SANS FICHE N'EST PAS UNE ERREUR : le panneau affiche alors ce que
 * l'ecran dit de lui-meme. Mais tout ecran de SAISIE doit avoir son tableau de
 * champs — c'est la que l'aide se gagne.
 */
import { EXEMPLES } from './exemples.ts'
import { sujetDans } from './indice.ts'
import type { Sujet } from './types.ts'
import { FICHES_RESERVEES } from './fiches/reserve.ts'
import { FICHES_CATALOGUE } from './fiches/catalogue.ts'
import { FICHES_PLANIFICATION } from './fiches/planification.ts'
import { FICHES_ACHATS } from './fiches/achats.ts'
import { FICHES_RECEPTIONS } from './fiches/receptions.ts'
import { FICHES_IMPORTATION } from './fiches/importation.ts'
import { FICHES_STOCK } from './fiches/stock.ts'
import { FICHES_MACHINES } from './fiches/machines.ts'
import { FICHES_PILOTAGE } from './fiches/pilotage.ts'

export const SUJETS: Sujet[] = [
  ...FICHES_CATALOGUE,
  ...FICHES_PLANIFICATION,
  ...FICHES_ACHATS,
  ...FICHES_RECEPTIONS,
  ...FICHES_IMPORTATION,
  ...FICHES_STOCK,
  ...FICHES_MACHINES,
  ...FICHES_PILOTAGE,
  ...FICHES_RESERVEES,
]

// LES EXEMPLES CHIFFRÉS (13/10/2026) s'attachent à la fiche de leur écran.
for (const s of SUJETS) {
  const ex = EXEMPLES[s.route]
  if (ex) s.exemples = [...(s.exemples ?? []), ...ex]
}

/**
 * La fiche d'un écran, trouvée par sa route : la plus PRÉCISE gagne
 * (« /catalogue/completer » ne tombe pas sur « /catalogue », et
 * « /receptions/nouvelle » bat « /receptions/:id »). Voir `indice.ts`.
 */
export function sujetPour(chemin: string): Sujet | undefined {
  return sujetDans(SUJETS, chemin)
}
