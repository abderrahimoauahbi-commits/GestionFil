/**
 * LE CHOIX D'UN ORDRE DE FABRICATION (22/10/2026).
 *
 * L'OF devient un LIEN (il etait un texte libre) : la fiche machine, ses lignes,
 * la fiche hors machine et la consommation directe le choisissent parmi les OF
 * PREVUS ou LANCES. La machine ne l'impose jamais : c'est l'atelier qui dit quel
 * OF il sert. Le serveur reverifie le statut a l'enregistrement.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { cn } from '../lib/utils'

export interface OfOuvert {
  id_of: string
  numero: string
  statut: 'PREVU' | 'LANCE'
  code_qualite: string
  qualite_nom: string | null
  date_of: string
}

export function useOfOuverts() {
  return useQuery({
    queryKey: ['of-ouverts'],
    queryFn: ({ signal }) => api.get<OfOuvert[]>('/api/machines/of-ouverts', { signal }),
    staleTime: 60_000,
  })
}

/** Le libelle d'un OF : « OF-2026-014 · 8F (lancé) ». */
export const libelleOf = (o: OfOuvert) =>
  `${o.numero} · ${o.qualite_nom ?? o.code_qualite}${o.statut === 'LANCE' ? ' (lancé)' : ' (prévu)'}`

export function ChoixOF({
  valeur, onChange, vide = '— aucun OF —', invalide, className, ariaLabel = 'Ordre de fabrication', inconnu,
}: {
  /** L'id de l'OF choisi, ou '' . */
  valeur: string
  /** L'id et le numero de l'OF choisi ('' et '' pour aucun). */
  onChange: (id: string, numero: string) => void
  /** Le libelle du choix vide : « OF de la fiche », « — aucun OF — »… */
  vide?: string
  invalide?: boolean
  className?: string
  ariaLabel?: string
  /** Le numero a montrer quand l'OF choisi n'est plus ouvert (cloture depuis). */
  inconnu?: string | null
}) {
  const q = useOfOuverts()
  const liste = q.data ?? []
  const absent = !!valeur && !liste.some((o) => o.id_of === valeur)
  return (
    <select
      value={valeur}
      aria-label={ariaLabel}
      aria-invalid={invalide || undefined}
      onChange={(e) => {
        const o = liste.find((x) => x.id_of === e.target.value)
        onChange(o?.id_of ?? '', o?.numero ?? '')
      }}
      className={cn(
        'min-h-[34px] rounded-[var(--radius-sm)] border bg-fond px-2 text-[13px]',
        invalide ? 'border-danger' : 'border-bordure',
        className,
      )}
    >
      <option value="">{q.isLoading ? 'Lecture des OF…' : vide}</option>
      {absent && <option value={valeur}>{inconnu ?? valeur} (n’est plus ouvert)</option>}
      {liste.map((o) => (
        <option key={o.id_of} value={o.id_of}>{libelleOf(o)}</option>
      ))}
    </select>
  )
}
