/**
 * LA FORME PHYSIQUE D'UNE LIGNE DE RECEPTION, et quand elle fait un nouveau
 * derive du lot (06/11 et 07/11/2026).
 *
 * Une forme : le poids d'une unite (bobine, fut…) et le nombre d'unites par
 * palette. Deux formes different quand le poids d'une unite s'ecarte de plus
 * du seuil (P_SeuilDerivePoidsPct, 5 %) — en deca, c'est l'ecart de mesure —
 * ou quand le nombre d'unites par palette n'est pas le meme (decision du
 * 07/11/2026 : 16 palettes de 30 bobines et 2 de 100 du meme lot font deux
 * derives). L'ecran PROPOSE alors un nouveau derive ; la personne le confirme.
 *
 * Pur, sans React : `tests/forme_derive.test.ts` le prouve.
 */

/** Une forme connue : celle d'un derive du lot, ou d'une autre ligne de la reception. */
export interface Forme {
  nom: string
  /** Kilos d'une unite ; null : inconnu. */
  unitaire: number | null
  /** Unites par palette ; null : inconnu. */
  parPalette: number | null
}

/** La forme d'une ligne saisie : kilos / unites, unites / palettes. */
export function formeDe(kg: number | null, unites: string, palettes: string): Omit<Forme, 'nom'> {
  const u = Number(unites)
  const p = Number(palettes)
  return {
    unitaire: kg != null && kg > 0 && u > 0 ? kg / u : null,
    parPalette: u > 0 && p > 0 ? u / p : null,
  }
}

/** Deux nombres d'unites par palette differents : un compte, a l'unite pres. */
export function autreParPalette(a: number | null, b: number | null): boolean {
  return a != null && b != null && Math.abs(a - b) >= 1
}

/** La forme `f` differe-t-elle de `connue` (poids au-dela du seuil, ou unites par palette) ? */
export function differe(f: Omit<Forme, 'nom'>, connue: Omit<Forme, 'nom'>, seuilPct: number): boolean {
  const poids =
    f.unitaire != null && connue.unitaire != null && Math.abs(f.unitaire / connue.unitaire - 1) * 100 > seuilPct
  return poids || autreParPalette(f.parPalette, connue.parPalette)
}

/**
 * UN NOUVEAU DERIVE EST-IL A PROPOSER ? Oui quand la forme de la ligne differe
 * de TOUTES les formes qu'on peut lui comparer ; non s'il n'y a rien a comparer
 * (le premier arrivage d'un lot est son D1).
 */
export function nouvelleForme(f: Omit<Forme, 'nom'>, connues: Forme[], seuilPct: number): boolean {
  const comparables = connues.filter(
    (c) => (f.unitaire != null && c.unitaire != null) || (f.parPalette != null && c.parPalette != null),
  )
  return comparables.length > 0 && comparables.every((c) => differe(f, c, seuilPct))
}
