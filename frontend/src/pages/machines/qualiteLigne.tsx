/**
 * LA QUALITE D'UNE LIGNE DE FICHE MACHINE — la meme au bureau et au telephone.
 *
 * LA QUALITE EXPLICITE (23/10/2026) : celle de son OF (de la ligne, de la fiche,
 * ou celui qu'elle sert deja), affichee ; sans OF, au chargement, elle se choisit
 * — obligatoire. Au dechargement et au constat, celle de l'etat, affichee.
 *
 * Rien n'est calcule ici : l'ecran montre ce que `useFiche` envoie deja. Le
 * libelle « (qualité de l'OF) » ne se montre plus sur une ligne qui n'a pas
 * d'OF (24/10/2026) : au dechargement et au constat sans OF, c'est la qualite
 * que la ligne sert deja.
 */
import { cn } from '../../lib/utils'
import { ChoixQualite, type OfOuvert } from '../../composants/ChoixOF'
import type { LigneSaisie, TypeFiche } from './noyau'
import { qualiteDeLaLigne, type EnteteQualite } from './ligneMachine'

export function QualiteLigne({
  l, entete, type, ofs, onChange, className,
}: {
  l: LigneSaisie
  entete: EnteteQualite
  type: TypeFiche
  ofs: OfOuvert[] | undefined
  onChange: (code: string) => void
  className?: string
}) {
  const { imposee, source } = qualiteDeLaLigne(l, entete, type, ofs)
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
  return (
    <ChoixQualite
      valeur={l.code_qualite ?? ''}
      onChange={onChange}
      imposee={imposee}
      vide={entete.code_qualite ? `qualité de la fiche (${entete.code_qualite})`
        : l.avant_code_qualite ? `garde ${l.avant_qualite_nom ?? l.avant_code_qualite}` : 'Qualité (obligatoire)…'}
      invalide={imposee == null && !l.code_qualite && !entete.code_qualite && !l.avant_code_qualite}
      ariaLabel="Qualité de la ligne"
      className={className}
    />
  )
}
