/**
 * Primitives d'interface.
 *
 * Construites sur Radix UI : accessibilite clavier, gestion du focus, ARIA et
 * portails sont deleguees a une bibliotheque qui les traite correctement.
 * L'apparence reste entierement pilotee par les jetons de theme, de sorte que
 * le mode sombre ne demande aucune modification de composant.
 */
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

// ============================================================================
// Bouton
// ============================================================================

// Densite d'un tableau de bord d'administration : hauteurs reduites, texte 13 px.
// Un ERP se consulte huit heures par jour — chaque pixel de hauteur en trop est
// une ligne de moins a l'ecran.
const varianteBouton = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] ' +
    'text-[13px] font-medium transition-colors outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-anneau focus-visible:ring-offset-1 focus-visible:ring-offset-fond ' +
    'disabled:pointer-events-none disabled:opacity-50 ' +
    '[&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variante: {
        principal: 'bg-accent text-accent-texte hover:bg-accent/90',
        primaire: 'bg-primaire text-primaire-texte hover:bg-primaire/90',
        contour: 'border border-bordure bg-surface hover:bg-attenue',
        discret: 'hover:bg-attenue hover:text-texte',
        danger: 'bg-danger text-danger-texte hover:bg-danger/90',
        lien: 'text-primaire underline-offset-4 hover:underline',
      },
      // UN CRAN PLUS BAS QUE LA CONVENTION DU WEB, ET C'EST VOULU. Un bouton de
      // 36 px convient a une page qu'on visite ; sur un ecran de saisie ou dix
      // boutons cotoient une table de quarante lignes, chaque pixel de hauteur
      // pris par la barre d'actions est une ligne de moins a lire. La cible
      // reste au-dessus des 24 px en deca desquels le pointage devient penible.
      taille: {
        xs: 'h-6 px-2 text-[11px] [&_svg]:size-3',
        sm: 'h-6 px-2 text-[11.5px]',
        md: 'h-7 px-2.5 text-[12px]',
        lg: 'h-8 px-3',
        icone: 'h-7 w-7 p-0',
        'icone-xs': 'h-6 w-6 p-0 [&_svg]:size-3',
      },
    },
    defaultVariants: { variante: 'principal', taille: 'md' },
  },
)

export interface BoutonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof varianteBouton> {
  asChild?: boolean
  chargement?: boolean
}

export const Bouton = React.forwardRef<HTMLButtonElement, BoutonProps>(
  ({ className, variante, taille, asChild, chargement, children, disabled, ...props }, ref) => {
    const Composant = asChild ? Slot : 'button'
    return (
      <Composant
        ref={ref}
        className={cn(varianteBouton({ variante, taille }), className)}
        disabled={disabled || chargement}
        {...props}
      >
        {chargement ? (
          <>
            <Loader2 className="animate-spin" />
            {children}
          </>
        ) : (
          children
        )}
      </Composant>
    )
  },
)
Bouton.displayName = 'Bouton'

// ============================================================================
// Champs de saisie
// ============================================================================

const classeChamp =
  'flex h-8 w-full rounded-[var(--radius)] border border-champ bg-surface px-2.5 py-1 text-[13px] ' +
  'transition-colors placeholder:text-attenue-texte ' +
  'focus-visible:border-anneau focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau/20 ' +
  'disabled:cursor-not-allowed disabled:bg-attenue disabled:text-attenue-texte ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/25'

export const Champ = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(classeChamp, className)} {...props} />
  ),
)
Champ.displayName = 'Champ'

export const Zone = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(classeChamp, 'h-auto min-h-20 py-2', className)} {...props} />
))
Zone.displayName = 'Zone'

/** Selecteur natif : sur tablette, le selecteur du systeme est plus facile a
 *  manipuler qu'une liste personnalisee, et il reste accessible au clavier. */
export const Selecteur = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(classeChamp, 'pr-8', className)} {...props}>
    {children}
  </select>
))
Selecteur.displayName = 'Selecteur'

export function Etiq({
  className,
  obligatoire,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { obligatoire?: boolean }) {
  return (
    <label
      className={cn(
        'mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-attenue-texte',
        className,
      )}
      {...props}
    >
      {children}
      {obligatoire && <span className="text-danger">*</span>}
    </label>
  )
}

// ============================================================================
// Surfaces
// ============================================================================

/* -------------------------------------------------------------------------- */
/* Repli                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Etat de repli partage entre `Carte`, `CarteEntete` et `CarteCorps`.
 *
 * Passer par un contexte plutot que par des props evite d'avoir a cabler trois
 * composants a chaque usage : declarer `repliable` sur la carte suffit, le
 * chevron apparait dans son en-tete et son corps se retire.
 */
const ContexteRepli = React.createContext<{
  replie: boolean
  basculer: () => void
} | null>(null)

const CLE_REPLI = 'gestionfil.cartes.repliees'

function repliesEnregistres(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(CLE_REPLI) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

export function Carte({
  className,
  repliable,
  replieParDefaut = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /**
   * Identifiant de memoire. Present, la carte devient repliable et son etat
   * survit d'une session a l'autre — sans quoi le geste serait a refaire a
   * chaque ouverture et personne ne s'en servirait.
   */
  repliable?: string
  replieParDefaut?: boolean
}) {
  const [replie, setReplie] = React.useState(
    () => (repliable ? (repliesEnregistres()[repliable] ?? replieParDefaut) : false),
  )

  const basculer = React.useCallback(() => {
    if (!repliable) return
    setReplie((r) => {
      const suivant = !r
      try {
        localStorage.setItem(
          CLE_REPLI,
          JSON.stringify({ ...repliesEnregistres(), [repliable]: suivant }),
        )
      } catch {
        /* sans memoire, le repli fonctionne quand meme */
      }
      return suivant
    })
  }, [repliable])

  const carte = (
    <div
      // Pas d'ombre : sur un fond legerement gris, un simple contour suffit a
      // detacher la carte, et l'ecran reste net meme avec dix blocs empiles.
      className={cn(
        // La classe `carte` ne style rien ici : elle donne aux familles de
        // couleurs un point d'accroche pour traiter les cartes autrement que
        // le reste — c'est ce dont Glassier a besoin pour poser du verre sur
        // les cartes sans en poser sur les cellules d'un tableau.
        'carte rounded-[var(--radius)] border border-bordure bg-surface text-surface-texte',
        className,
      )}
      {...props}
    />
  )

  if (!repliable) return carte
  return (
    <ContexteRepli.Provider value={{ replie, basculer }}>{carte}</ContexteRepli.Provider>
  )
}

export function CarteEntete({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const repli = React.useContext(ContexteRepli)
  return (
    <div
      className={cn(
        'flex min-h-9 items-center justify-between gap-3 border-b border-bordure bg-attenue px-3 py-1.5',
        className,
      )}
      {...props}
    >
      {repli && (
        <button
          type="button"
          onClick={repli.basculer}
          aria-expanded={!repli.replie}
          aria-label={repli.replie ? 'Deplier' : 'Replier'}
          className="-ml-1 grid size-5 shrink-0 place-items-center rounded-[3px]
                     text-attenue-texte hover:bg-surface hover:text-texte"
        >
          <ChevronDown
            className={cn(
              'size-3.5 transition-transform duration-100',
              repli.replie && '-rotate-90',
            )}
          />
        </button>
      )}
      {children}
    </div>
  )
}

export function CarteTitre({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'text-[10px] font-semibold uppercase tracking-wider text-attenue-texte',
        className,
      )}
      {...props}
    />
  )
}

export function CarteCorps({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const repli = React.useContext(ContexteRepli)
  // Demonte plutot que masque : un formulaire replie ne doit pas continuer a
  // recevoir le focus au clavier.
  if (repli?.replie) return null
  return <div className={cn('p-2.5', className)} {...props} />
}

// ============================================================================
// Badge
// ============================================================================

const varianteBadge = cva(
  'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-px text-[10px] font-medium whitespace-nowrap',
  {
    variants: {
      ton: {
        neutre: 'bg-attenue text-attenue-texte',
        accent: 'bg-accent text-accent-texte',
        info: 'bg-info/15 text-info',
        succes: 'bg-succes/15 text-succes',
        alerte: 'bg-alerte/20 text-alerte',
        danger: 'bg-danger/15 text-danger',
        contour: 'border border-bordure text-attenue-texte',
      },
    },
    defaultVariants: { ton: 'neutre' },
  },
)

export function Badge({
  className,
  ton,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof varianteBadge>) {
  return <span className={cn(varianteBadge({ ton }), className)} {...props} />
}

// ============================================================================
// Etats
// ============================================================================

export function Squelette({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-attenue', className)} {...props} />
}

export function Chargement({ texte = 'Chargement...' }: { texte?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-attenue-texte">
      <Loader2 className="size-4 animate-spin" />
      {texte}
    </div>
  )
}

export function EtatVide({
  titre,
  description,
  action,
  icone: Icone,
}: {
  titre: string
  description?: string
  action?: React.ReactNode
  icone?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-bordure py-14 text-center">
      {Icone && <Icone className="size-8 text-attenue-texte" />}
      <div>
        <p className="font-medium text-texte">{titre}</p>
        {description && <p className="mt-1 text-sm text-attenue-texte">{description}</p>}
      </div>
      {action}
    </div>
  )
}

// ============================================================================
// Messages
// ============================================================================

const varianteAlerte = cva('flex gap-3 rounded-[var(--radius)] border p-3 text-sm', {
  variants: {
    ton: {
      info: 'border-info/30 bg-info/10 text-info',
      succes: 'border-succes/30 bg-succes/10 text-succes',
      alerte: 'border-alerte/30 bg-alerte/10 text-alerte',
      danger: 'border-danger/30 bg-danger/10 text-danger',
    },
  },
  defaultVariants: { ton: 'info' },
})

export function Alerte({
  className,
  ton,
  titre,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof varianteAlerte> & { titre?: string }) {
  return (
    <div role="status" className={cn(varianteAlerte({ ton }), className)} {...props}>
      <div className="min-w-0 flex-1">
        {titre && <p className="font-semibold">{titre}</p>}
        <div className={titre ? 'mt-0.5' : undefined}>{children}</div>
      </div>
    </div>
  )
}

// ============================================================================
// Separateur
// ============================================================================

export function Separateur({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('h-px w-full bg-bordure', className)} {...props} />
}
