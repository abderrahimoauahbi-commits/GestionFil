/**
 * Operations CRUD sur une entite du registre generique.
 *
 * Centralise l'invalidation du cache et la remontee des messages metier : sans
 * cela, chaque ecran refait les memes quatre mutations et finit par en oublier
 * une (typiquement l'invalidation apres suppression, qui laisse a l'ecran une
 * ligne qui n'existe plus).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, ErreurApi } from '../api/client'

export function useCrud<T>(chemin: string, filtres: Record<string, string> = {}) {
  const qc = useQueryClient()
  const [erreur, setErreur] = useState<string | null>(null)
  const [succes, setSucces] = useState<string | null>(null)

  const params = new URLSearchParams(
    Object.entries(filtres).filter(([, v]) => v !== '' && v != null),
  )
  const cle = [chemin, params.toString()]

  const liste = useQuery({
    queryKey: cle,
    queryFn: () => api.get<T[]>(`/api/${chemin}?${params}`),
  })

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: [chemin] })
    // Le cockpit et les controles dependent des referentiels.
    void qc.invalidateQueries({ queryKey: ['cockpit'] })
    void qc.invalidateQueries({ queryKey: ['controles'] })
  }

  const message = (e: unknown, defaut: string) =>
    e instanceof ErreurApi ? e.message : defaut

  const creer = useMutation({
    mutationFn: (donnees: Record<string, unknown>) =>
      api.post<Record<string, unknown>>(`/api/${chemin}`, donnees),
    onSuccess: () => {
      setErreur(null)
      setSucces('Enregistrement cree.')
      rafraichir()
    },
    onError: (e) => setErreur(message(e, 'Creation impossible.')),
  })

  const modifier = useMutation({
    mutationFn: ({ id, donnees }: { id: string; donnees: Record<string, unknown> }) =>
      api.patch<Record<string, unknown>>(`/api/${chemin}/${encodeURIComponent(id)}`, donnees),
    onSuccess: () => {
      setErreur(null)
      setSucces('Modifications enregistrees.')
      rafraichir()
    },
    onError: (e) => setErreur(message(e, 'Modification impossible.')),
  })

  const supprimer = useMutation({
    mutationFn: (id: string) =>
      api.delete<{ mode?: string }>(`/api/${chemin}/${encodeURIComponent(id)}`),
    onSuccess: (r) => {
      setErreur(null)
      setSucces(
        r?.mode === 'desactivation'
          ? 'Enregistrement desactive. Il reste consultable dans l historique.'
          : 'Enregistrement supprime.',
      )
      rafraichir()
    },
    onError: (e) => setErreur(message(e, 'Suppression impossible.')),
  })

  return {
    liste,
    creer,
    modifier,
    supprimer,
    erreur,
    succes,
    reinitialiser: () => {
      setErreur(null)
      setSucces(null)
    },
    enCours: creer.isPending || modifier.isPending || supprimer.isPending,
  }
}
