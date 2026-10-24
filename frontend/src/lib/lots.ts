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
    queryFn: ({ signal }) => api.get<{ code_parametre: string; valeur_courante: string }[]>('/api/parametres', { signal }),
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

/** Les seuils du controle de colisage (parametres P_ColisageTol*). */
export function useTolerancesColisage() {
  const q = useQuery({
    queryKey: ['parametres'],
    queryFn: ({ signal }) => api.get<{ code_parametre: string; valeur_courante: string }[]>('/api/parametres', { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const val = (code: string, defaut: number) => {
    const p = q.data?.find((x) => x.code_parametre === code)
    const n = p ? Number(p.valeur_courante) : NaN
    return Number.isFinite(n) ? n : defaut
  }
  return { alerte: val('P_ColisageTolAlertePct', 10), refus: val('P_ColisageTolRefusPct', 25) }
}

/**
 * LA TOLERANCE DE PESEE DU FOURNISSEUR (regle 14, audit v4). Les ecrans la
 * figeaient a 2 % alors que le serveur lit le reglage du fournisseur : a 1 %,
 * la case de derogation ne s'affichait pas et le serveur refusait. A defaut de
 * reglage, 2 %, comme le serveur.
 */
export function useToleranceFournisseur(code: string | null | undefined): number {
  // LA FICHE DE CE FOURNISSEUR, ET ELLE SEULE (24/10/2026) : l'ecran chargeait
  // mille fournisseurs pour lire une tolerance — et le millieme et unieme
  // n'existait plus. Un champ masque revient absent : le parametre s'applique.
  const q = useQuery({
    queryKey: ['fournisseur-tolerance', code ?? ''],
    queryFn: ({ signal }) =>
      api.get<{ code_fournisseur: string; tolerance_pesee_pct?: number | string | null }>(
        `/api/fournisseurs/${encodeURIComponent(code!)}`,
        { signal },
      ),
    enabled: !!code,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const parametres = useQuery({
    queryKey: ['parametres'],
    queryFn: ({ signal }) => api.get<{ code_parametre: string; valeur_courante: string }[]>('/api/parametres', { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  })
  // A DEFAUT DE REGLAGE, LE PARAMETRE, COMME LE SERVEUR (fn_tolerance_fournisseur).
  // `Number(null)` vaut 0 : un fournisseur sans reglage affichait 0 % et tout
  // excedent passait au rouge « exige une derogation » que le serveur ne demandait pas.
  const p = Number(parametres.data?.find((x) => x.code_parametre === 'P_TolerEcartPesee')?.valeur_courante)
  const defaut = Number.isFinite(p) && p >= 0 ? p : 2
  const brut = q.data?.tolerance_pesee_pct
  if (brut === null || brut === undefined || String(brut).trim() === '') return defaut
  const t = Number(brut)
  return Number.isFinite(t) && t >= 0 ? t : defaut
}
