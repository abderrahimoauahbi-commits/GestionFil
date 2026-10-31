/**
 * LA LECTURE DU DÉTAIL D'UNE RÉFÉRENCE au moteur de couverture, partagée par
 * la grande fenêtre et la simulation (même clé de cache : une seule lecture).
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { DetailCouverture } from './types'

/**
 * `rattrapage` : l'option du stock projeté (§ 16, inclus par défaut). `leger` :
 * sans le classement (la fenêtre du stock projeté le lit à part, il coûte plus
 * d'une seconde).
 */
/** `restes` (31/10/2026) : `null` suit le réglage `P_ProjeteRestes`, sinon le bouton de l'écran. */
export function useDetailCouverture(
  reference: string | null,
  rattrapage: boolean | null = null,
  leger = false,
  restes: boolean | null = null,
) {
  return useQuery({
    queryKey: ['couverture', reference, rattrapage, leger, restes],
    queryFn: ({ signal }) => {
      const p = new URLSearchParams()
      // `null` : le réglage P_ProjeteRattrapage.
      if (rattrapage != null) p.set('rattrapage', rattrapage ? 'inclus' : 'exclu')
      if (restes != null) p.set('restes', restes ? 'comptes' : 'exclus')
      if (leger) p.set('leger', '1')
      const suite = p.toString()
      return api.get<DetailCouverture>(`/api/couverture/${encodeURIComponent(reference ?? '')}${suite ? `?${suite}` : ''}`, {
        signal,
      })
    },
    enabled: !!reference,
    staleTime: 60_000,
  })
}

/** Le classement et le risque d'une référence, lus à part de la fenêtre du stock projeté. */
export function useClassementReference(reference: string | null) {
  return useQuery({
    queryKey: ['couverture-classement', reference],
    queryFn: ({ signal }) =>
      api.get<NonNullable<NonNullable<DetailCouverture['stock_projete']>['classement']>>(
        `/api/couverture/${encodeURIComponent(reference ?? '')}/classement`,
        { signal },
      ),
    enabled: !!reference,
    staleTime: 5 * 60_000,
  })
}
