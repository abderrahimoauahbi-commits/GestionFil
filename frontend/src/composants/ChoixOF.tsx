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

/** Une qualité qu'une consommation sans OF peut servir (23/10/2026). */
export interface QualiteOuverte {
  code_qualite: string
  qualite_nom: string | null
}

export function useQualitesOuvertes() {
  return useQuery({
    queryKey: ['qualites-ouvertes'],
    queryFn: ({ signal }) => api.get<QualiteOuverte[]>('/api/machines/qualites', { signal }),
    staleTime: 300_000,
  })
}

/**
 * LA QUALITÉ EXPLICITE (23/10/2026) : « quand on choisit un OF ou non, on doit
 * explicitement définir la qualité ». Avec un OF, c'est la sienne : affichée,
 * non modifiable (`imposee`). Sans OF, elle se choisit — obligatoire là où le
 * serveur et la base l'exigent (consommation directe, chargement machine).
 */
export function ChoixQualite({
  valeur, onChange, imposee, vide = 'Choisir la qualité…', invalide, className, ariaLabel = 'Qualité',
}: {
  valeur: string
  onChange: (code: string) => void
  /** Le libellé de la qualité imposée par l'OF ; présent, le choix est fermé. */
  imposee?: string | null
  vide?: string
  invalide?: boolean
  className?: string
  ariaLabel?: string
}) {
  const q = useQualitesOuvertes()
  const base = 'min-h-[34px] rounded-[var(--radius-sm)] border bg-fond px-2 text-[13px]'
  if (imposee != null) {
    return (
      <span
        aria-label={ariaLabel}
        title="La qualité de l’OF : elle ne se change pas ici"
        className={cn(base, 'inline-flex items-center border-bordure bg-surface text-attenue-texte', className)}
      >
        {imposee} <span className="ml-1 text-[11px]">(qualité de l’OF)</span>
      </span>
    )
  }
  const liste = q.data ?? []
  return (
    <select
      value={valeur}
      aria-label={ariaLabel}
      aria-invalid={invalide || undefined}
      onChange={(e) => onChange(e.target.value)}
      className={cn(base, invalide ? 'border-danger' : 'border-bordure', className)}
    >
      <option value="">{q.isLoading ? 'Lecture des qualités…' : vide}</option>
      {!!valeur && !liste.some((x) => x.code_qualite === valeur) && <option value={valeur}>{valeur}</option>}
      {liste.map((x) => (
        <option key={x.code_qualite} value={x.code_qualite}>
          {x.qualite_nom && x.qualite_nom !== x.code_qualite ? `${x.code_qualite} · ${x.qualite_nom}` : x.code_qualite}
        </option>
      ))}
    </select>
  )
}

/** Le libellé de la qualité d'un OF ouvert, ou null s'il n'est pas dans la liste. */
export function qualiteDeLOf(ofs: OfOuvert[] | undefined, idOf: string | null | undefined): string | null {
  if (!idOf) return null
  const o = (ofs ?? []).find((x) => x.id_of === idOf)
  return o ? (o.qualite_nom ?? o.code_qualite) : null
}
