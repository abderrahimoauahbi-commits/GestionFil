/**
 * LES INVENTAIRES OUVERTS, QUI GELENT LEUR MAGASIN (decision du 23/10/2026).
 * Lus par les ecrans qui ecrivent du stock ; le bandeau est dans
 * composants/AvisInventaireOuvert.tsx. La base refuse de toute facon
 * (INVENTAIRE-OUVERT, migration 2026-10-23g) : ceci n'est que l'avertissement.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export interface InventaireOuvert {
  id_inventaire: string
  numero_inventaire: string
  code_magasin: string
  magasin_nom: string | null
  statut: string
  type_inventaire: string
}

export function useInventairesOuverts() {
  return useQuery({
    queryKey: ['inventaires', 'ouverts'],
    queryFn: ({ signal }) => api.get<InventaireOuvert[]>('/api/inventaires/ouverts', { signal }),
    staleTime: 10_000,
  })
}

/** Les inventaires ouverts qui gelent l'un des magasins donnes (vides ignores). */
export function useInventaireOuvert(...magasins: (string | null | undefined)[]): InventaireOuvert[] {
  const q = useInventairesOuverts()
  const cle = magasins.filter(Boolean).join('|')
  return useMemo(() => {
    const voulus = new Set(cle ? cle.split('|') : [])
    return (q.data ?? []).filter((i) => voulus.has(i.code_magasin))
  }, [q.data, cle])
}

/** La phrase du gel, pour un bandeau ou la raison d'un bouton desactive. */
export function phraseGel(inventaires: InventaireOuvert[], nommer = false): string | null {
  if (inventaires.length === 0) return null
  return inventaires
    .map(
      (i) =>
        `Inventaire ${i.numero_inventaire} ouvert sur ${nommer ? `le magasin ${i.magasin_nom ?? i.code_magasin}` : 'ce magasin'} : aucun mouvement jusqu’à sa clôture.`,
    )
    .join(' ')
}
