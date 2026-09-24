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
    'text-[13px] font-medium outline-none select-none ' +
    // LA TRANSITION PORTE AUSSI SUR L'OMBRE ET LA POSITION : sans elles,
    // l'enfoncement est un saut, pas un geste.
    'transition-[background-color,border-color,color,box-shadow,transform] ' +
    'duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)] ' +
    'focus-visible:ring-2 focus-visible:ring-anneau focus-visible:ring-offset-1 focus-visible:ring-offset-fond ' +
    // UN BOUTON DOIT REPONDRE AU DOIGT. Sans etat enfonce, rien ne distingue
    // un appui pris d'un appui perdu — et sur un ecran tactile, ou il n'y a
    // pas de survol, c'est le SEUL retour que recoit l'operateur.
    'active:translate-y-px active:shadow-none active:duration-75 ' +
    'disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none ' +
    '[&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variante: {
        // L'OMBRE EST UNE MINCE ARETE, PAS UN NUAGE. Elle detache le bouton de
        // son fond sans donner l'air d'une maquette : un liachage de 1 px sous
        // la surface suffit a le faire lire comme un objet qu'on presse.
        // AU SURVOL, LE BOUTON MONTE D'UN DEMI-PIXEL ET SON OMBRE S'ALLONGE.
        // Le geste dure 140 ms : assez pour se sentir, trop court pour se
        // remarquer. C'est cette micro-elevation, et non la teinte, qui donne
        // aux interfaces soignees leur impression de reactivite.
        principal:
          'bg-accent text-accent-texte shadow-[var(--ombre-pose)] ' +
          'hover:-translate-y-px hover:bg-accent/92 hover:shadow-[var(--ombre-levee)]',
        primaire:
          'bg-primaire text-primaire-texte shadow-[var(--ombre-pose)] ' +
          'hover:-translate-y-px hover:bg-primaire/92 hover:shadow-[var(--ombre-levee)]',
        contour:
          'border border-bordure bg-surface shadow-[var(--ombre-pose)] ' +
          'hover:-translate-y-px hover:border-primaire/35 hover:bg-attenue/60 ' +
          'hover:shadow-[var(--ombre-levee)]',
        discret: 'hover:bg-attenue hover:text-texte',
        danger:
          'bg-danger text-danger-texte shadow-[var(--ombre-pose)] ' +
          'hover:-translate-y-px hover:bg-danger/92 hover:shadow-[var(--ombre-levee)]',
        lien: 'text-primaire underline-offset-4 hover:underline active:translate-y-0',
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

/*
 * UN CHAMP VIDE NE DOIT PAS RESSEMBLER A UN CHAMP REMPLI.
 *
 * L'indication d'aide — le « placeholder » — s'affichait dans la meme graisse
 * et presque la meme teinte que la valeur saisie. Devant un formulaire, on ne
 * distinguait plus ce qui etait renseigne de ce qui ne l'etait pas : on croyait
 * avoir saisi, et l'enregistrement refusait. Elle est desormais en ITALIQUE et
 * franchement plus claire : la difference se voit d'un coup d'oeil, sans lire.
 */
const classeChamp =
  'flex h-8 w-full rounded-[var(--radius)] border border-champ bg-surface px-2.5 py-1 text-[13px] ' +
  'transition-colors placeholder:italic placeholder:text-attenue-texte/55 ' +
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
      className={cn(
        // La classe `carte` ne style rien ici : elle donne aux familles de
        // couleurs un point d'accroche pour traiter les cartes autrement que
        // le reste — c'est ce dont Glassier a besoin pour poser du verre sur
        // les cartes sans en poser sur les cellules d'un tableau.
        'carte rounded-[var(--radius)] border border-bordure bg-surface text-surface-texte',
        // UNE OMBRE, MAIS A PEINE.
        //
        // Il n'y en avait aucune, par crainte du halo gris qu'on voit sur les
        // interfaces surchargees. La crainte etait juste, la conclusion non :
        // sans elevation, une carte, un menu deroulant et une boite de
        // dialogue se ressemblent, et l'oeil ne sait plus ce qui est pose sur
        // quoi. `--ombre-pose` vaut un pixel de contact et trois de diffusion
        // — de quoi decoller la carte du fond, pas de quoi la faire leviter.
        'shadow-[var(--ombre-pose)]',
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
        // L'EN-TETE RESPIRE. A 1.5 de padding vertical, le titre touchait le
        // trait du dessous ; l'espace est ce qui distingue une interface qu'on
        // a dessinee d'une interface qu'on a assemblee.
        'flex min-h-10 items-center justify-between gap-3 border-b border-bordure bg-attenue/60 px-4 py-2',
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

/**
 * LA PASTILLE D'ETAT.
 *
 * Elle etait carree et plate : un rectangle colore de dix pixels, qu'on lisait
 * comme un fond de cellule plutot que comme un statut. Trois changements la
 * font reconnaitre d'un coup d'oeil, et ce sont les memes partout ou l'on sait
 * faire — pleinement arrondie, un filet de la meme teinte que le fond, et le
 * texte un cran plus fonce que ce filet. Le relief vient du contraste entre
 * ces trois valeurs, pas d'une ombre.
 */
const varianteBadge = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[10.5px] font-medium ' +
    'leading-[1.35] whitespace-nowrap',
  {
    variants: {
      ton: {
        neutre: 'border-bordure bg-attenue text-attenue-texte',
        accent: 'border-accent bg-accent text-accent-texte',
        info: 'border-info/25 bg-info/10 text-info',
        succes: 'border-succes/25 bg-succes/10 text-succes',
        alerte: 'border-alerte/30 bg-alerte/12 text-alerte',
        danger: 'border-danger/25 bg-danger/10 text-danger',
        or: 'border-or/40 bg-or/12 text-or',
        contour: 'border-bordure text-attenue-texte',
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

/**
 * LE SQUELETTE D'ATTENTE.
 *
 * `animate-pulse` fait clignoter un bloc gris : on voit qu'il se passe quelque
 * chose, mais le clignotement attire l'oeil sur du vide. Une LUEUR QUI TRAVERSE
 * le bloc dit la meme chose et va dans un sens — celui de la lecture. C'est ce
 * que font les interfaces dont on dit qu'elles « semblent rapides », a temps de
 * chargement strictement identique.
 */
export function Squelette({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('squelette rounded-[var(--radius-sm)] bg-attenue', className)}
      {...props}
    />
  )
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
    /* UN ECRAN VIDE N'EST PAS UNE PANNE, et doit se presenter comme tel.
       Le cadre en pointilles disait « il manque quelque chose ici ». L'icone
       posee dans un disque attenue, le titre puis l'explication, et l'action
       en dessous : c'est la disposition qu'on lit comme « tout va bien, il n'y
       a simplement rien encore ». */
    <div
      className="flex flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)]
                 border border-bordure bg-surface/60 px-6 py-16 text-center"
    >
      {Icone && (
        <span
          className="grid size-12 place-items-center rounded-full bg-attenue
                     text-attenue-texte ring-1 ring-bordure"
        >
          <Icone className="size-5" />
        </span>
      )}
      <div className="max-w-md">
        <p className="text-[14.5px] font-semibold tracking-[-0.01em] text-texte">{titre}</p>
        {description && (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-attenue-texte">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}

// ============================================================================
// Messages
// ============================================================================

/* L'ALERTE PORTE SA COULEUR SUR LE COTE, pas sur tout son texte.
   Un paragraphe entier en rouge se lit mal et crie ; un filet epais a gauche
   donne le meme signal en un coup d'oeil, et le texte reste du texte. C'est la
   convention des consoles d'administration serieuses. */
const varianteAlerte = cva(
  'flex gap-3 rounded-[var(--radius)] border border-l-[3px] px-3.5 py-3 text-[13px] leading-relaxed',
  {
    variants: {
      ton: {
        info: 'border-info/25 border-l-info bg-info/[0.07] text-texte',
        succes: 'border-succes/25 border-l-succes bg-succes/[0.07] text-texte',
        alerte: 'border-alerte/30 border-l-alerte bg-alerte/[0.09] text-texte',
        danger: 'border-danger/25 border-l-danger bg-danger/[0.07] text-texte',
      },
    },
    defaultVariants: { ton: 'info' },
  },
)

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
