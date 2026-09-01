/**
 * Compatibilite : `TableDroits` est desormais une facade sur `DataTable`, qui
 * apporte le tri, la pagination et le choix des colonnes.
 */
import { DataTable, type ColonneDT } from '../composants/DataTable'

export type Colonne<L> = ColonneDT<L>

interface Props<L> {
  module: string
  colonnes: Colonne<L>[]
  lignes: L[] | undefined
  chargement?: boolean
  cle: (ligne: L) => string
  surClic?: (ligne: L) => void
  menuContextuel?: (ligne: L) => React.ReactNode
  /** Sujet du fichier CSV. Sa presence affiche le bouton d'export. */
  exportable?: string
  /** Titre de l'etat imprime. */
  imprimable?: string
  texteVide?: string
  titreCarte?: (ligne: L) => React.ReactNode
}

export function TableDroits<L extends Record<string, unknown>>({
  texteVide,
  ...props
}: Props<L>) {
  return <DataTable {...props} videTitre={texteVide ?? 'Aucun resultat'} recherche={false} />
}
