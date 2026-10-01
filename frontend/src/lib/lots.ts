/**
 * « PAS DE LOT » A UN NOM, UN SEUL (01/10/2026).
 *
 * Le fournisseur n'a pas toujours mis de lot sur la marchandise, certaines
 * references ne se gerent pas par lot, et le stock d'avant le suivi n'en a
 * aucun. La base exige pourtant un lot sur les mouvements des references
 * suivies et sur chaque ligne de machine : celui-ci dit honnetement qu'on ne
 * le connait pas — au lieu d'un numero invente — et l'ecran l'affiche
 * « Sans lot ». Meme valeur que la migration 2026-10-01b.
 */
export const SANS_LOT = 'SANS-LOT'

export const libelleLot = (lot: string | null | undefined) =>
  !lot ? '—' : lot === SANS_LOT ? 'Sans lot' : lot
