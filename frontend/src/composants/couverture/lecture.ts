/**
 * LA LECTURE DU DÉTAIL D'UNE RÉFÉRENCE au moteur de couverture, partagée par
 * la grande fenêtre et la simulation (même clé de cache : une seule lecture).
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { DetailCouverture } from './types'

export function useDetailCouverture(reference: string | null) {
  return useQuery({
    queryKey: ['couverture', reference],
    queryFn: ({ signal }) =>
      api.get<DetailCouverture>(`/api/couverture/${encodeURIComponent(reference ?? '')}`, { signal }),
    enabled: !!reference,
    staleTime: 60_000,
  })
}
