/**
 * LE DERIVE D'UN LOT, lu pour les ecrans de saisie (06/11/2026).
 *
 * Un derive est une forme physique a l'interieur du MEME lot fournisseur : le
 * latex d'un lot en futs de 600 kg (D1) et de 1000 kg (D2). Chaque lot a au
 * moins D1. Quand il en a PLUSIEURS, chaque mouvement dit lequel bouge (la base
 * refuse sinon : DERIVE-REQUIS) ; quand il n'en a qu'un, le serveur le pose
 * d'office et l'ecran ne montre rien de plus.
 *
 * Deux sources, selon l'ecran :
 *   - `GET /api/stock/lots` (et `/api/retours-fournisseur/disponible`) rendent
 *     une ligne par derive, avec `code_derive` et `nb_derives` : l'ecran choisit
 *     une LIGNE (lot + derive) ;
 *   - `GET /api/lots/derives` rend les derives d'un lot, pour les ecrans qui
 *     choisissent le lot par la recherche (`ChampLot`) : la meme cle de cache
 *     que la fiche du lot (`['lots', 'derives', reference, lot]`).
 */
import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { ConditionnementLot } from './conditionnement'
import { SANS_LOT } from './lots'

/** Un derive, tel que `GET /api/lots/derives` le rend. */
export interface DeriveLot {
  code_reference: string
  lot_fournisseur: string
  code_derive: string
  code_conditionnement?: string | null
  conditionnement_libelle?: string | null
  /** Le poids d'une unite du derive ; nul : celui du lot. */
  poids_unitaire_kg?: number | null
  unites_par_palette?: number | null
  statut?: 'LIBRE' | 'BLOQUE' | string | null
  quantite_kg?: number | null
  par_magasin?: { code_magasin: string; quantite_kg: number }[] | null
}

/** Ce qu'une ligne de stock dit de son derive (`/api/stock/lots`). */
export interface LigneDerivee {
  code_derive?: string | null
  nb_derives?: number | null
  conditionnement_derive?: string | null
}

/** Le lot a-t-il plusieurs derives ? Seul ce cas montre le derive a l'ecran. */
export const plusieursDerives = (l: LigneDerivee | null | undefined) => Number(l?.nb_derives ?? 0) > 1

/**
 * LE SUFFIXE DU LIBELLE D'UNE LIGNE DE LOT : « · D2 FUT600 » quand le lot a
 * plusieurs derives, rien sinon — un lot a derive unique garde son libelle.
 */
export const suffixeDerive = (l: LigneDerivee | null | undefined) =>
  plusieursDerives(l) && l?.code_derive
    ? ` · ${l.code_derive}${l.conditionnement_derive ? ` ${l.conditionnement_derive}` : ''}`
    : ''

/** La cle d'une ligne de lot : le lot ET son derive, sinon deux derives se confondent. */
export const cleLotDerive = (lot: string | null | undefined, derive?: string | null) =>
  `${lot ?? ''}\u0001${derive ?? ''}`

/**
 * LE DERIVE QUE PORTE UNE LIGNE DE GRILLE (`extra`) : `derive`, choisi pour le
 * lot `derive_lot`. Changer de lot l'efface de fait — il n'est rendu que pour
 * le lot pour lequel il a ete choisi.
 */
export const deriveDeExtra = (extra: Record<string, string> | undefined) => {
  const lot = (extra?.lot ?? '').trim()
  return lot && extra?.derive && extra.derive_lot === lot ? extra.derive : ''
}

/** Le `extra` d'une ligne de grille qui porte ce derive, choisi pour ce lot. */
export const extraAvecDerive = (extra: Record<string, string> | undefined, derive: string) => ({
  ...(extra ?? {}),
  derive,
  derive_lot: (extra?.lot ?? '').trim(),
})

/** Les derives d'un lot (`/api/lots/derives`). Rien a lire sans lot, ni pour « Sans lot ». */
export function useDerivesLot(reference: string, lot: string) {
  const l = lot.trim()
  return useQuery({
    queryKey: ['lots', 'derives', reference, l],
    queryFn: ({ signal }) =>
      api.get<DeriveLot[]>(
        `/api/lots/derives?code_reference=${encodeURIComponent(reference)}&lot_fournisseur=${encodeURIComponent(l)}`,
        { signal },
      ),
    enabled: !!reference && !!l && l !== SANS_LOT,
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * LES DERIVES DE PLUSIEURS LOTS, pour la conversion d'une grille : seulement
 * ceux des lignes qui ont choisi un derive (un lot a derive unique n'en lit
 * aucun). `deriveDe(reference, lot, derive)` rend le derive, s'il est connu.
 */
export function useDerivesLots(paires: { reference: string; lot: string }[]) {
  const uniques = [
    ...new Map(
      paires
        .map((p) => ({ reference: p.reference, lot: p.lot.trim() }))
        .filter((p) => p.reference && p.lot && p.lot !== SANS_LOT)
        .map((p) => [cleLotDerive(p.reference, p.lot), p]),
    ).values(),
  ].sort((a, b) => cleLotDerive(a.reference, a.lot).localeCompare(cleLotDerive(b.reference, b.lot)))
  const requetes = useQueries({
    queries: uniques.map((p) => ({
      queryKey: ['lots', 'derives', p.reference, p.lot],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.get<DeriveLot[]>(
          `/api/lots/derives?code_reference=${encodeURIComponent(p.reference)}&lot_fournisseur=${encodeURIComponent(p.lot)}`,
          { signal },
        ),
      staleTime: 60_000,
      retry: false,
    })),
  })
  const empreinte = requetes.map((q) => q.dataUpdatedAt).join('|')
  const parCle = useMemo(() => {
    const m = new Map<string, DeriveLot>()
    for (const q of requetes)
      for (const d of q.data ?? []) m.set(`${d.code_reference}\u0001${cleLotDerive(d.lot_fournisseur, d.code_derive)}`, d)
    return m
    // `requetes` change d'identite a chaque rendu ; ses donnees, seulement quand l'empreinte change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empreinte])
  const deriveDe = useMemo(
    () =>
      (reference: string, lot: string, derive: string): DeriveLot | undefined =>
        derive ? parCle.get(`${reference}\u0001${cleLotDerive(lot.trim(), derive)}`) : undefined,
    [parCle],
  )
  return { deriveDe }
}

/**
 * LE CONDITIONNEMENT DU DERIVE, a defaut celui du lot : ce qui convertit les
 * palettes et les unites d'une ligne. Meme regle que la base
 * (`fn_derive_poids_unitaire`, `fn_derive_unites_palette`).
 */
export function conditionnementDuDerive(
  lot: ConditionnementLot | null | undefined,
  derive: DeriveLot | null | undefined,
): ConditionnementLot | undefined {
  if (!derive) return lot ?? undefined
  const p = Number(derive.poids_unitaire_kg)
  const n = Number(derive.unites_par_palette)
  return {
    poids_bobine_kg: derive.poids_unitaire_kg != null && p > 0 ? p : (lot?.poids_bobine_kg ?? null),
    bobines_par_palette: derive.unites_par_palette != null && n > 0 ? n : (lot?.bobines_par_palette ?? null),
  }
}

/** Une option du choix : le derive, son contenant, et ce qu'il en reste ici. */
export interface OptionDerive {
  code_derive: string
  conditionnement?: string | null
  quantite_kg?: number | null
  bloque?: boolean
}

/** Les options d'un lot lues de `/api/lots/derives`, avec le stock du magasin s'il est dit. */
export const optionsDesDerives = (derives: DeriveLot[], magasin?: string): OptionDerive[] =>
  derives.map((d) => ({
    code_derive: d.code_derive,
    conditionnement: d.conditionnement_libelle || d.code_conditionnement,
    quantite_kg: magasin
      ? ((d.par_magasin ?? []).find((m) => m.code_magasin === magasin)?.quantite_kg ?? 0)
      : null,
    bloque: d.statut === 'BLOQUE',
  }))

/**
 * LES LIGNES D'UN MEME LOT EN PLUSIEURS DERIVES (inventaire, 06/11/2026) : une
 * ligne d'inventaire porte toujours son derive (D1 pour un lot a derive
 * unique) ; l'ecran ne le montre que si une autre ligne du meme lot, au meme
 * magasin, en porte un autre. `plusieurs_derives` le dit sur chaque ligne.
 */
export function marquerPlusieursDerives<
  T extends { code_reference: string; code_magasin: string; lot_fournisseur: string | null; code_derive?: string | null },
>(lignes: T[]): (T & { plusieurs_derives?: boolean })[] {
  const derives = new Map<string, Set<string>>()
  for (const l of lignes) {
    if (!l.lot_fournisseur) continue
    const k = `${l.code_reference}\u0001${l.code_magasin}\u0001${l.lot_fournisseur}`
    derives.set(k, (derives.get(k) ?? new Set<string>()).add(l.code_derive || 'D1'))
  }
  return lignes.map((l) => {
    const n = l.lot_fournisseur
      ? (derives.get(`${l.code_reference}\u0001${l.code_magasin}\u0001${l.lot_fournisseur}`)?.size ?? 0)
      : 0
    return n > 1 ? { ...l, plusieurs_derives: true } : l
  })
}
