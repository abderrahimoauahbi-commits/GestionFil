/**
 * LA QUALITE D'UNE LIGNE DE FICHE MACHINE — la meme au bureau et au telephone.
 *
 * LA QUALITE EXPLICITE (23/10/2026) : celle de son OF (celui de la ligne, ou
 * celui qu'elle sert deja), affichee ; sans OF, au chargement, elle se choisit
 * — obligatoire. Au dechargement et au constat, celle de l'etat, affichee. La
 * fiche n'a plus de qualite d'en-tete (24/10/2026).
 *
 * Rien n'est calcule ici : l'ecran montre ce que `useFiche` envoie deja. Le
 * libelle « (qualité de l'OF) » ne se montre plus sur une ligne qui n'a pas
 * d'OF (24/10/2026) : au dechargement et au constat sans OF, c'est la qualite
 * que la ligne sert deja.
 */
import { cn } from '../../lib/utils'
import { ChoixQualite, type OfOuvert } from '../../composants/ChoixOF'
import type { LigneSaisie, TypeFiche } from './noyau'
import { qualiteDeLaLigne } from './ligneMachine'

export function QualiteLigne({
  l, type, ofs, onChange, className,
}: {
  l: LigneSaisie
  type: TypeFiche
  ofs: OfOuvert[] | undefined
  onChange: (code: string) => void
  className?: string
}) {
  const { imposee, source } = qualiteDeLaLigne(l, type, ofs)
  /* SANS OF, AU DECHARGEMENT OU AU CONSTAT : la qualite que la ligne sert deja.
     Elle ne se choisit pas ici (comme avant) ; seul le libelle change. */
  if (source === 'LIGNE') {
    return (
      <span
        aria-label="Qualité de la ligne"
        title="La qualité que la ligne sert déjà : elle ne se change pas ici"
        className={cn(
          'inline-flex min-w-0 items-center truncate rounded-[var(--radius-sm)] border border-bordure bg-surface px-1 text-attenue-texte',
          className,
        )}
      >
        {imposee}
      </span>
    )
  }
  /* AVEC UN OF (celui de la ligne, ou celui qu'elle sert deja) : sa qualite, en
     lecture, sur une ligne (24/10/2026) — elle ne se choisit pas. */
  if (source === 'OF') {
    return (
      <span
        title={`${imposee} — la qualité de l’OF : elle ne se change pas ici`}
        className={cn(
          'inline-flex min-w-0 items-center gap-1 rounded-[var(--radius-sm)] border border-bordure bg-surface px-1 text-attenue-texte',
          className,
        )}
      >
        <span className="truncate">{imposee}</span>
        <span className="shrink-0 text-[10px] opacity-80">(OF)</span>
      </span>
    )
  }
  return (
    <ChoixQualite
      valeur={l.code_qualite ?? ''}
      onChange={onChange}
      vide={l.avant_code_qualite ? `garde ${l.avant_qualite_nom ?? l.avant_code_qualite}` : 'Qualité (obligatoire)…'}
      invalide={imposee == null && !l.code_qualite && !l.avant_code_qualite}
      ariaLabel="Qualité de la ligne"
      className={className}
    />
  )
}
