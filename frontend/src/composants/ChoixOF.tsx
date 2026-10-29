/**
 * LE CHOIX D'UN ORDRE DE FABRICATION (22/10/2026).
 *
 * L'OF devient un LIEN (il etait un texte libre) : la fiche machine, ses lignes,
 * la fiche hors machine et la consommation directe le choisissent parmi les OF
 * PREVUS ou LANCES. La machine ne l'impose jamais : c'est l'atelier qui dit quel
 * OF il sert. Le serveur reverifie le statut a l'enregistrement.
 *
 * AVEC RECHERCHE (24/10/2026) : la liste deroulante chargeait tous les OF
 * ouverts ; on tape maintenant le numero ou la qualite, le serveur cherche
 * (`ChoixRecherche`, type « of »). Les props n'ont pas change : les ecrans qui
 * s'en servent n'ont rien a modifier.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { cn } from '../lib/utils'
import { ChoixRecherche, classeDuChamp, classeEnveloppe, useLigneChoix } from './ChoixRecherche'

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
  const ouverts = useOfOuverts()
  const ouvert = valeur ? (ouverts.data ?? []).find((o) => o.id_of === valeur) : undefined
  // Un OF qui n'est plus ouvert se relit par son id : on montre son numero, et
  // qu'il n'est plus ouvert — jamais un identifiant brut.
  const relu = useLigneChoix('of', valeur && ouverts.isSuccess && !ouvert ? valeur : null)
  const libelle = !valeur
    ? undefined
    : ouvert
      ? libelleOf(ouvert)
      : ouverts.isSuccess && !relu.isLoading
        ? `${(relu.data?.numero as string | undefined) ?? inconnu ?? valeur} (n’est plus ouvert)`
        : (inconnu ?? undefined)
  return (
    <ChoixRecherche
      type="of"
      valeur={valeur}
      libelle={libelle}
      onChange={(id, l) => onChange(id, l ? String(l.numero ?? '') : '')}
      vide={vide}
      ariaLabel={ariaLabel}
      invalide={invalide}
      className={cn('min-w-0', classeEnveloppe(className))}
      classeChamp={classeDuChamp(className)}
    />
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
 * Avec recherche depuis le 24/10/2026 (type « qualite »), mêmes props.
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
  return (
    <ChoixRecherche
      type="qualite"
      valeur={valeur}
      onChange={(code) => onChange(code)}
      vide={vide}
      ariaLabel={ariaLabel}
      invalide={invalide}
      className={cn('min-w-0', classeEnveloppe(className))}
      classeChamp={classeDuChamp(className)}
    />
  )
}

/** Le libellé de la qualité d'un OF ouvert, ou null s'il n'est pas dans la liste. */
export function qualiteDeLOf(ofs: OfOuvert[] | undefined, idOf: string | null | undefined): string | null {
  if (!idOf) return null
  const o = (ofs ?? []).find((x) => x.id_of === idOf)
  return o ? (o.qualite_nom ?? o.code_qualite) : null
}
