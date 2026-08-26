/**
 * Rail des modules, et vue des controles de coherence.
 */
import { AlertTriangle } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import { estAccessible, MODULES, NAVIGATION, type Section } from '../Coquille'
import { Infobulle } from '../ui/surcouches'
import { cn } from '../../lib/utils'

export interface Controle {
  code: string
  controle: string
  criticite: string
  anomalies: number
}

/**
 * Rail des modules.
 *
 * Il ne porte que les grandes fonctions de l'entreprise. Aucune vue d'outil :
 * la recherche est dans le Command Center, les controles dans le panneau du
 * bas. Un rail qui melange « Stock » et « Explorateur » melange le metier et
 * l'outil, et on ne sait plus ce qu'on choisit en cliquant.
 */
export function BarreActivites({
  section,
  definirSection,
  anomalies,
  bas,
}: {
  section: Section
  definirSection: (s: Section) => void
  /** Report sur le module Pilotage : les anomalies s'y traitent. */
  anomalies: number
  /** Elements ancres en bas du rail (compte, reglages). */
  bas: React.ReactNode
}) {
  const { peut, moi } = useAuth()

  /* Un module dont aucun ecran n'est lisible ne s'affiche pas : montrer une
     icone qui mene a un refus de droits est pire que de ne rien montrer. */
  const visibles = MODULES.filter((m) =>
    NAVIGATION.some((e) => e.section === m.id && estAccessible(e, peut, moi?.role)),
  )

  return (
    <div
      className="flex w-[var(--at-l-activite)] shrink-0 flex-col justify-between
                 border-r border-bordure bg-[hsl(var(--at-activite))]"
    >
      <div className="flex flex-col">
        {visibles.map(({ id, libelle, resume, Icone }) => {
          const actif = section === id
          return (
            <Infobulle key={id} contenu={`${libelle} — ${resume}`}>
              <button
                type="button"
                aria-label={libelle}
                aria-pressed={actif}
                onClick={() => definirSection(id)}
                className={cn(
                  'relative grid h-12 w-full place-items-center transition-colors',
                  actif ? 'text-texte' : 'text-attenue-texte hover:text-texte',
                )}
              >
                {/* Filet d'accent a gauche, marque du module actif. */}
                <span
                  className={cn(
                    'absolute inset-y-0 left-0 w-[2px]',
                    actif ? 'bg-primaire' : 'bg-transparent',
                  )}
                />
                <Icone className="size-6" strokeWidth={1.4} />
                {id === 'PILOTAGE' && anomalies > 0 && (
                  <span
                    className="absolute bottom-2 right-2 grid min-w-4 place-items-center rounded-full
                               bg-[hsl(var(--at-badge))] px-1 text-[9px] font-semibold leading-4
                               text-[hsl(var(--at-badge-texte))]"
                  >
                    {anomalies > 99 ? '99+' : anomalies}
                  </span>
                )}
              </button>
            </Infobulle>
          )
        })}
      </div>
      <div className="flex flex-col pb-1">{bas}</div>
    </div>
  )
}

/* --- Controles ------------------------------------------------------------ */

/** Ecran ou porter le regard quand un controle sort en anomalie. */
const DESTINATION: Record<string, string> = {
  C01: '/recettes',
  C02: '/bons-commande',
  C03: '/mouvements',
  C04: '/catalogue',
  C05: '/stock',
  C06: '/mouvements',
  C07: '/mouvements',
  C08: '/mouvements',
  C09: '/mouvements',
  C10: '/receptions',
  C11: '/stock',
  C12: '/catalogue',
  C13: '/catalogue',
  C14: '/recettes',
  C15: '/stock',
  C16: '/qualites',
  C17: '/catalogue',
  C18: '/qualites',
  C19: '/configuration',
  C20: '/catalogue',
  C21: '/recettes',
  C22: '/equivalences',
  C23: '/equivalences',
  C24: '/receptions',
  C25: '/equivalences',
  C26: '/equivalences',
  C27: '/stock',
  C28: '/bons-commande',
  C29: '/besoins',
}

const TEINTE: Record<string, string> = {
  BLOQUANT: 'text-danger',
  CRITIQUE: 'text-danger',
  MAJEUR: 'text-alerte',
  ATTENTION: 'text-alerte',
  MINEUR: 'text-attenue-texte',
}

export function VueControles({
  controles,
  ouvrir,
}: {
  controles: Controle[]
  ouvrir: (chemin: string, apercu: boolean) => void
}) {
  const anomalies = controles.filter((c) => c.anomalies > 0)

  if (!anomalies.length) {
    return (
      <p className="px-4 py-3 text-[12px] text-attenue-texte">
        Aucune anomalie. Les 29 controles sont au vert.
      </p>
    )
  }

  return (
    <div>
      {anomalies.map((c) => (
        <button
          key={c.code}
          type="button"
          onClick={() => ouvrir(DESTINATION[c.code] ?? '/', true)}
          className="flex w-full items-start gap-2 px-3 py-1.5 text-left
                     hover:bg-[hsl(var(--at-liste-survol))]"
        >
          <AlertTriangle
            className={cn('mt-[2px] size-4 shrink-0', TEINTE[c.criticite] ?? 'text-alerte')}
            strokeWidth={1.8}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] text-texte">{c.controle}</span>
            <span className="block text-[11px] text-attenue-texte">
              {c.code} · {c.criticite.toLowerCase()} · {c.anomalies} ligne
              {c.anomalies > 1 ? 's' : ''}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
