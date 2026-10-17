/**
 * L'ORDRE DE SORTIE DES LOTS D'UN MAGASIN (FEFO, 17/10/2026).
 *
 * Celui qui perime le premier sort le premier ; a peremption egale — ou sans
 * peremption —, le plus ancien. C'est l'ordre de la vue `v_lot_fefo` de la base,
 * que l'ecran de choix d'un lot ignorait : il triait par date d'entree seule.
 *
 * AU 17/10/2026, AUCUN LOT NE PORTE DE PEREMPTION (0 sur 280). L'ordre est alors
 * exactement celui des entrees, le FIFO d'avant : ce module ne change rien tant
 * que personne ne saisit de peremption a la reception. Le test le garde.
 *
 * Module PUR, sans React ni client API, pour etre teste par `node --test`.
 */

/** Trie apres toute vraie date : un lot sans peremption ne passe devant aucun autre. */
export const SANS_PEREMPTION = '9999-12-31'

export interface LotDatable {
  date_premiere_entree: string
  date_peremption?: string | null
}

/** Les lots dans l'ordre ou ils doivent sortir. Ne modifie pas le tableau recu. */
export function trierPourSortie<T extends LotDatable>(lots: readonly T[]): T[] {
  return [...lots].sort(
    (a, b) =>
      (a.date_peremption || SANS_PEREMPTION).localeCompare(b.date_peremption || SANS_PEREMPTION) ||
      a.date_premiere_entree.localeCompare(b.date_premiere_entree),
  )
}
