/**
 * Surcouches : dialogue, panneau lateral, menu, info-bulle, onglets,
 * interrupteur, confirmation.
 *
 * Toutes sont bati sur Radix : piegeage du focus, fermeture au clavier,
 * restitution du focus a la fermeture et attributs ARIA sont geres par la
 * bibliotheque. Les reimplementer a la main produit presque toujours des
 * fenetres inaccessibles au clavier.
 */
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'
import * as ContextPrimitive from '@radix-ui/react-context-menu'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Bouton } from './base'

// ============================================================================
// Dialogue et panneau lateral
// ============================================================================

export const Dialogue = DialogPrimitive.Root
export const DialogueDeclencheur = DialogPrimitive.Trigger

const voile =
  'fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] ' +
  'data-[state=open]:animate-in data-[state=closed]:animate-out ' +
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'

/**
 * Contenu modal.
 *
 * `cote` decide de la disposition : centre sur grand ecran, feuille remontant
 * du bas sur mobile — la ou le pouce atteint les actions.
 */
export function DialogueContenu({
  className,
  children,
  titre,
  description,
  cote = 'centre',
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  titre: string
  description?: string
  cote?: 'centre' | 'droite'
}) {
  const positions = {
    centre:
      'left-1/2 top-1/2 max-h-[92vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-lg ' +
      'max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none ' +
      'max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none',
    droite:
      'right-0 top-0 h-full w-full max-w-lg rounded-none border-l ' +
      'max-sm:bottom-0 max-sm:top-auto max-sm:h-[92vh] max-sm:rounded-t-lg max-sm:border-l-0',
  }

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={voile} />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 flex flex-col overflow-hidden border border-bordure bg-surface shadow-xl',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          positions[cote],
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-bordure p-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-base font-semibold">{titre}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-0.5 text-sm text-attenue-texte">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <Bouton variante="discret" taille="icone" aria-label="Fermer">
              <X />
            </Bouton>
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

// ============================================================================
// Confirmation
// ============================================================================

/**
 * Confirmation d'action destructrice.
 *
 * Remplace `window.confirm`, qui bloque le fil d'execution, ne se style pas et
 * s'affiche differemment sur chaque plateforme — inacceptable dans une
 * application censee tourner a l'identique sur bureau, web et tablette.
 */
export function Confirmation({
  ouvert,
  surOuvert,
  titre,
  description,
  libelleConfirmer = 'Confirmer',
  destructif,
  surConfirmer,
}: {
  ouvert: boolean
  surOuvert: (o: boolean) => void
  titre: string
  description?: React.ReactNode
  libelleConfirmer?: string
  destructif?: boolean
  surConfirmer: () => void
}) {
  return (
    <AlertDialogPrimitive.Root open={ouvert} onOpenChange={surOuvert}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className={voile} />
        <AlertDialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2
                     -translate-y-1/2 rounded-lg border border-bordure bg-surface p-5 shadow-xl"
        >
          <AlertDialogPrimitive.Title className="text-base font-semibold">
            {titre}
          </AlertDialogPrimitive.Title>
          {description && (
            <AlertDialogPrimitive.Description className="mt-2 text-sm text-attenue-texte">
              {description}
            </AlertDialogPrimitive.Description>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <Bouton variante="contour">Annuler</Bouton>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Bouton variante={destructif ? 'danger' : 'principal'} onClick={surConfirmer}>
                {libelleConfirmer}
              </Bouton>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}

/** Pilote une confirmation depuis un simple appel de fonction. */
export function useConfirmation() {
  const [etat, setEtat] = React.useState<{
    ouvert: boolean
    titre: string
    description?: React.ReactNode
    destructif?: boolean
    libelleConfirmer?: string
    action?: () => void
  }>({ ouvert: false, titre: '' })

  const demander = React.useCallback(
    (options: Omit<typeof etat, 'ouvert'> & { action: () => void }) =>
      setEtat({ ...options, ouvert: true }),
    [],
  )

  const element = (
    <Confirmation
      ouvert={etat.ouvert}
      surOuvert={(o) => setEtat((e) => ({ ...e, ouvert: o }))}
      titre={etat.titre}
      description={etat.description}
      destructif={etat.destructif}
      libelleConfirmer={etat.libelleConfirmer}
      surConfirmer={() => etat.action?.()}
    />
  )

  return { demander, element }
}

// ============================================================================
// Menu deroulant
// ============================================================================

export const Menu = DropdownPrimitive.Root
export const MenuDeclencheur = DropdownPrimitive.Trigger

export function MenuContenu({
  className,
  align = 'end',
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={4}
        className={cn(
          'z-50 min-w-44 overflow-hidden rounded-[var(--radius)] border border-bordure',
          'bg-surface p-1 shadow-lg apparition',
          className,
        )}
        {...props}
      />
    </DropdownPrimitive.Portal>
  )
}

export function MenuElement({
  className,
  destructif,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & { destructif?: boolean }) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
        'focus:bg-attenue data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        destructif && 'text-danger focus:bg-danger/10',
        className,
      )}
      {...props}
    />
  )
}

export function MenuSeparateur() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-bordure" />
}

export function MenuTitre({ children }: { children: React.ReactNode }) {
  return <DropdownPrimitive.Label className="px-2 py-1.5 text-xs font-semibold text-attenue-texte">{children}</DropdownPrimitive.Label>
}

// ============================================================================
// Menu contextuel (clic droit)
// ============================================================================
//
// Famille distincte du menu deroulant, et non le meme composant declenche
// autrement : Radix separe les deux parce qu'ils ne se positionnent pas pareil.
// Un menu deroulant s'ancre sur son bouton ; un menu contextuel s'ouvre AU
// POINTEUR. Detourner le premier oblige a lui fabriquer une ancre invisible a
// la position du curseur — c'est ce que fait la barre d'onglets, faute de mieux
// a l'epoque.
//
// L'apparence reste celle du menu deroulant, aux memes classes pres : deux
// menus qui ne se ressemblent pas se lisent comme deux mecanismes differents.

export const MenuContextuel = ContextPrimitive.Root
export const MenuContextuelDeclencheur = ContextPrimitive.Trigger

export function MenuContextuelContenu({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ContextPrimitive.Content>) {
  return (
    <ContextPrimitive.Portal>
      <ContextPrimitive.Content
        className={cn(
          'z-50 min-w-52 overflow-hidden rounded-[var(--radius)] border border-bordure',
          'bg-surface p-1 shadow-lg apparition',
          className,
        )}
        {...props}
      />
    </ContextPrimitive.Portal>
  )
}

export function MenuContextuelElement({
  className,
  destructif,
  ...props
}: React.ComponentPropsWithoutRef<typeof ContextPrimitive.Item> & { destructif?: boolean }) {
  return (
    <ContextPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
        'focus:bg-attenue data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        destructif && 'text-danger focus:bg-danger/10',
        className,
      )}
      {...props}
    />
  )
}

export function MenuContextuelSeparateur() {
  return <ContextPrimitive.Separator className="my-1 h-px bg-bordure" />
}

export function MenuContextuelTitre({ children }: { children: React.ReactNode }) {
  return (
    <ContextPrimitive.Label className="truncate px-2 py-1.5 text-xs font-semibold text-attenue-texte">
      {children}
    </ContextPrimitive.Label>
  )
}

// ============================================================================
// Info-bulle
// ============================================================================

export const FournisseurInfobulle = TooltipPrimitive.Provider

export function Infobulle({
  contenu,
  children,
}: {
  contenu: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-50 max-w-xs rounded-md bg-accent px-2.5 py-1.5 text-xs text-accent-texte shadow-md apparition"
        >
          {contenu}
          <TooltipPrimitive.Arrow className="fill-accent" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

/**
 * Note d'aide repliee dans une icone.
 *
 * Les explications valent d'etre ecrites, mais pas d'occuper trois lignes sous
 * chaque champ : elles ecartent les controles les uns des autres et le
 * formulaire perd sa lecture. On les met a portee de survol, la ou on les
 * cherche — sur l'etiquette du champ ou le titre du bloc.
 */
export function Aide({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Infobulle contenu={<div className="leading-relaxed">{children}</div>}>
      <button
        type="button"
        // `tabIndex=-1` : l'aide ne doit pas s'intercaler dans la tabulation de
        // saisie. Elle reste atteignable a la souris et lisible par un lecteur
        // d'ecran via aria-label.
        tabIndex={-1}
        aria-label="Aide"
        className={cn(
          'inline-grid size-3.5 shrink-0 place-items-center rounded-full border border-current',
          'align-middle text-[9px] font-semibold leading-none text-attenue-texte',
          'transition-colors hover:text-texte',
          className,
        )}
      >
        ?
      </button>
    </Infobulle>
  )
}

// ============================================================================
// Onglets
// ============================================================================

export const Onglets = TabsPrimitive.Root

export function OngletsListe({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'defilement-x inline-flex h-9 items-center gap-1 rounded-lg bg-attenue p-1',
        className,
      )}
      {...props}
    />
  )
}

export function Onglet({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium',
        'text-attenue-texte transition-all outline-none',
        'focus-visible:ring-2 focus-visible:ring-anneau',
        'data-[state=active]:bg-surface data-[state=active]:text-texte data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
    />
  )
}

export const OngletContenu = TabsPrimitive.Content

// ============================================================================
// Interrupteur
// ============================================================================

export function Interrupteur({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2',
        'border-transparent transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-anneau focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-primaire data-[state=unchecked]:bg-attenue-texte/40',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="pointer-events-none block size-4 rounded-full bg-surface shadow transition-transform
                   data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}
