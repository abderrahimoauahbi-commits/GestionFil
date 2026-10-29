/**
 * LE CONDITIONNEMENT DES LOTS, lu pour les écrans de saisie (23/10/2026).
 *
 * Chaque lot porte son poids de bobine et ses bobines par palette (mesurés à la
 * réception, corrigés sur la fiche du lot) : `GET /api/lots/conditionnement`,
 * une requête par référence, gardée en cache. Les grilles (mouvement, transfert)
 * l'appliquent à chaque ligne dès que son lot est choisi ; le serveur convertit
 * avec le même conditionnement (`vers_kg_lot`).
 */
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { api } from '../api/client'
import { appliquerConditionnementLot, type ConditionnementLot, type LigneColisLot } from '../lib/conditionnement'

export interface LotConditionne extends ConditionnementLot {
  code_reference: string
  lot_fournisseur: string
  origine_poids_bobine?: string | null
  origine_bobines_palette?: string | null
  date_conditionnement?: string | null
}

/** Le conditionnement de chaque lot de ces références : `condLot(reference, lot)`. */
export function useConditionnementsLots(references: string[]) {
  const uniques = [...new Set(references.filter(Boolean))].sort()
  const requetes = useQueries({
    queries: uniques.map((r) => ({
      queryKey: ['conditionnement-lots', r],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.get<LotConditionne[]>(`/api/lots/conditionnement?code_reference=${encodeURIComponent(r)}`, { signal }),
      staleTime: 60_000,
      retry: false,
    })),
  })
  const empreinte = requetes.map((q) => q.dataUpdatedAt).join('|')
  const parCle = useMemo(() => {
    const m = new Map<string, LotConditionne>()
    for (const q of requetes) for (const l of q.data ?? []) m.set(`${l.code_reference}\u0001${l.lot_fournisseur}`, l)
    return m
    // `requetes` change d'identite a chaque rendu ; ses donnees, seulement quand l'empreinte change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empreinte])
  const condLot = useCallback(
    (reference: string, lot: string): LotConditionne | undefined =>
      lot ? parCle.get(`${reference}\u0001${lot.trim()}`) : undefined,
    [parCle],
  )
  return { condLot, enCours: requetes.some((q) => q.isLoading) }
}

/**
 * LA GRILLE SUIT LE CONDITIONNEMENT DU LOT DE CHAQUE LIGNE : une ligne dont le
 * lot (dans `extra.lot`) change prend ses facteurs ; le champ tapé en dernier
 * garde sa valeur, les deux autres se recalculent (`appliquerConditionnementLot`).
 */
export function useLotsSurGrille<T extends LigneColisLot>(lignes: T[], setLignes: Dispatch<SetStateAction<T[]>>) {
  const { condLot } = useConditionnementsLots(
    lignes.filter((l) => (l.extra?.lot ?? '').trim()).map((l) => l.code_reference),
  )
  useEffect(() => {
    const suivre = (l: T) =>
      l.code_reference ? appliquerConditionnementLot(l, l.extra?.lot ?? '', condLot(l.code_reference, l.extra?.lot ?? '')) : l
    if (lignes.every((l) => suivre(l) === l)) return
    setLignes((ls) => ls.map(suivre))
  }, [lignes, setLignes, condLot])
}
