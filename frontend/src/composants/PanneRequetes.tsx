/**
 * UNE PANNE N'EST PAS UNE LISTE VIDE (audit v4, P3).
 *
 * Sur les ecrans de saisie du jour, une requete en echec laissait la liste
 * vide : « aucune ligne a recevoir », « aucun magasin », et l'on cherchait
 * l'erreur chez soi. Ce bandeau nomme ce qui n'a pas pu etre lu, dit pourquoi
 * quand le serveur l'a dit, et propose de reessayer.
 */
import { CloudOff, RefreshCw } from 'lucide-react'
import { ErreurApi } from '../api/client'
import { Alerte, Bouton } from './ui/base'

interface RequeteSuivie {
  isError: boolean
  error: unknown
  refetch: () => unknown
}

export function PanneRequetes({ requetes }: { requetes: [string, RequeteSuivie][] }) {
  const pannes = requetes.filter(([, q]) => q.isError)
  if (pannes.length === 0) return null
  return (
    <Alerte ton="danger" titre="Des données n’ont pas pu être lues" className="mb-3">
      <ul className="m-0 list-none space-y-0.5 p-0">
        {pannes.map(([quoi, q]) => (
          <li key={quoi} className="flex items-start gap-1.5">
            <CloudOff className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <strong>{quoi}</strong> —{' '}
              {q.error instanceof ErreurApi ? q.error.message : 'le serveur n’a pas répondu.'}
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-1 text-[12px]">Rien n’est affirmé tant que ces données manquent : une liste vide ici ne veut rien dire.</p>
      <Bouton taille="sm" variante="contour" className="mt-2" onClick={() => pannes.forEach(([, q]) => q.refetch())}>
        <RefreshCw />
        Réessayer
      </Bouton>
    </Alerte>
  )
}
