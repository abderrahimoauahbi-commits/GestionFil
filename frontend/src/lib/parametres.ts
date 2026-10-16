import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

/**
 * UN REGLAGE NUMERIQUE, lu dans les parametres (meme cache que les autres
 * lectures). Un ecran n'ecrit jamais « 90 jours » : il dit ce que la direction
 * a regle. A defaut de lecture, la valeur par defaut du serveur.
 */
export function useParametreNombre(code: string, defaut: number): number {
  const q = useQuery({
    queryKey: ['parametres'],
    queryFn: ({ signal }) => api.get<{ code_parametre: string; valeur_courante: string }[]>('/api/parametres', { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const n = Number(q.data?.find((x) => x.code_parametre === code)?.valeur_courante)
  return Number.isFinite(n) ? n : defaut
}
