/**
 * Rail lateral de navigation et de filtrage.
 *
 * Une barre d'onglets en haut de page marche tant qu'il y a quatre entrees. Au
 * dela, elle deborde, on la fait defiler horizontalement, et l'on ne voit plus
 * jamais les dernieres. Le rail lateral n'a pas cette limite : il empile, il
 * porte un compteur par entree, et il laisse la place d'expliquer ce que chaque
 * choix montre.
 *
 * C'est aussi ce qui rend un filtre HONNETE : « 12 » a cote de « Rupture » dit
 * combien de references sont concernees AVANT de cliquer. Une barre d'onglets ne
 * peut pas le faire sans devenir illisible.
 *
 * Le meme composant sert a la navigation (Configuration, Statistiques) et au
 * filtrage (Stock, Catalogue) : dans les deux cas, on choisit un sous-ensemble
 * de ce que la page sait montrer.
 */
import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { cn } from '../lib/utils'

export interface EntreeRail {
  cle: string
  libelle: string
  /** Une phrase sur ce que l'entree montre. Facultative, mais elle evite un clic. */
  resume?: string
  /** Nombre d'elements derriere l'entree. `null` : inconnu, on n'affiche rien. */
  compte?: number | null
  Icone?: React.ComponentType<{ className?: string }>
  /** Teinte du compteur : sert a dire qu'une file demande une action. */
  ton?: 'neutre' | 'danger' | 'alerte' | 'succes' | 'info'
}

export interface GroupeRail {
  titre?: string
  entrees: EntreeRail[]
}

const TON_COMPTEUR: Record<NonNullable<EntreeRail['ton']>, string> = {
  neutre: 'bg-bordure/70 text-attenue-texte',
  danger: 'bg-danger/15 text-danger',
  alerte: 'bg-alerte/15 text-alerte',
  succes: 'bg-succes/15 text-succes',
  info: 'bg-primaire/15 text-primaire',
}

export function RailLateral({
  groupes,
  actif,
  surChoix,
  recherche,
}: {
  groupes: GroupeRail[]
  actif: string
  surChoix: (cle: string) => void
  /** Champ de recherche au-dessus du rail. Omis : pas de champ. */
  recherche?: {
    valeur: string
    surChangement: (v: string) => void
    placeholder?: string
  }
}) {
  return (
    <div className="space-y-3">
      {recherche && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] border border-bordure bg-surface px-2">
          <Search className="size-3.5 shrink-0 text-attenue-texte" />
          <input
            value={recherche.valeur}
            onChange={(e) => recherche.surChangement(e.target.value)}
            placeholder={recherche.placeholder ?? 'Chercher…'}
            className="h-8 w-full bg-transparent text-[13px] outline-none"
          />
        </div>
      )}

      {groupes.map((g, i) => (
        <div key={g.titre ?? i}>
          {g.titre && (
            <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
              {g.titre}
            </div>
          )}
          <nav className="space-y-0.5">
            {g.entrees.map((e) => {
              const choisi = e.cle === actif
              return (
                <button
                  key={e.cle}
                  type="button"
                  onClick={() => surChoix(e.cle)}
                  aria-current={choisi ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-[var(--radius)] px-2.5 py-2 text-left transition-colors',
                    choisi ? 'bg-primaire/10 text-primaire' : 'text-texte hover:bg-attenue/40',
                  )}
                >
                  {e.Icone && <e.Icone className="mt-0.5 size-4 shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-[13px]', choisi && 'font-medium')}>
                      {e.libelle}
                    </span>
                    {e.resume && (
                      <span className="block text-[11px] leading-tight text-attenue-texte">
                        {e.resume}
                      </span>
                    )}
                  </span>
                  {e.compte != null && (
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums',
                        TON_COMPTEUR[e.ton ?? 'neutre'],
                      )}
                    >
                      {e.compte}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
        </div>
      ))}
    </div>
  )
}

/**
 * Disposition a deux colonnes : le rail, puis le contenu.
 *
 * Sur petit ecran le rail passe au-dessus plutot que de se replier : un filtre
 * qu'on ne voit pas est un filtre qu'on oublie avoir mis, et l'on cherche
 * ensuite pourquoi la liste est vide.
 */
export function PageAvecRail({
  rail,
  children,
  large = false,
}: {
  rail: ReactNode
  children: ReactNode
  /** Rail plus large, quand les libelles portent un resume. */
  large?: boolean
}) {
  return (
    <div
      className={cn(
        'grid gap-4',
        large
          ? 'lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]'
          : 'lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]',
      )}
    >
      <div>{rail}</div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
