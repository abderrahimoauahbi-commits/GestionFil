/**
 * Les pages du tableau de bord, par adresse : /tableau-de-bord/:vue.
 * Une vue inconnue ramène à la vue d'ensemble.
 */
import { useParams } from 'react-router-dom'
import { AnalyseTableau } from './Analyse'
import { Matiere } from './Matiere'
import { Opportunites } from './Opportunites'
import { Risques } from './Risques'
import { VueEnsemble } from './VueEnsemble'

export function PageTableauDeBord() {
  const { vue } = useParams<{ vue?: string }>()
  if (vue === 'situation') return <Risques />
  if (vue === 'analyse') return <AnalyseTableau />
  if (vue === 'opportunites') return <Opportunites />
  if (vue === 'matiere') return <Matiere />
  return <VueEnsemble />
}
