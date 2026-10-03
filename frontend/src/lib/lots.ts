import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

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


/**
 * LES TOLERANCES D'ECART DE POIDS, lues dans les reglages (cahier « Gestion
 * des lots », regle 9) : au-dela d'orange, une confirmation ; au-dela de
 * rouge, une autorisation. Jamais codees en dur : la direction les regle.
 */
export function useTolerancesLot() {
  const q = useQuery({
    queryKey: ['parametres'],
    queryFn: () => api.get<{ code_parametre: string; valeur_courante: string }[]>('/api/parametres'),
    staleTime: 5 * 60_000,
  })
  const val = (code: string, defaut: number) => {
    const p = q.data?.find((x) => x.code_parametre === code)
    const n = p ? Number(p.valeur_courante) : NaN
    return Number.isFinite(n) ? n : defaut
  }
  return { orange: val('P_LotTolOrangePct', 1), rouge: val('P_LotTolRougePct', 3) }
}

export type CouleurEcart = 'vert' | 'orange' | 'rouge'

/** La couleur d'un ecart en %, selon les tolerances. */
export const couleurEcart = (pct: number | null, t: { orange: number; rouge: number }): CouleurEcart | null =>
  pct == null || !Number.isFinite(pct) ? null : Math.abs(pct) > t.rouge ? 'rouge' : Math.abs(pct) > t.orange ? 'orange' : 'vert'
