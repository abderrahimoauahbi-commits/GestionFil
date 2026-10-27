/**
 * L'INDICE D'UN CHAMP — le petit ⓘ posé à côté de l'intitulé.
 *
 * IL SE TROUVE TOUT SEUL, comme le « ? » de l'écran : la route courante donne
 * la fiche du catalogue (`aide/`), l'intitulé du champ donne la ligne de son
 * tableau des champs. Aucun écran ne déclare ses indices : les primitives
 * d'étiquette (`Etiq`, `Libelle`, `EnteteIndice`, les en-têtes de `DataTable`
 * et de `GrilleLignes`) le posent d'elles-mêmes. Un champ que le catalogue ne
 * décrit pas n'affiche RIEN — pas d'icône vide qui promet une aide absente.
 *
 * TROIS FAÇONS DE L'OUVRIR :
 *   - au survol de la souris (il se referme quand on s'en va) ;
 *   - au clic ou au tap — sur téléphone, il n'y a pas de survol ; il reste
 *     ouvert jusqu'au clic suivant, à Échap ou à un clic ailleurs ;
 *   - au clavier, touche F1 dans le champ (l'aide de champ des ERP) : l'icône
 *     ne prend pas de place dans la tabulation, sinon chaque saisie coûterait
 *     deux tabulations. Échap ferme et rend la main au champ.
 *
 * IL NE PREND PAS DE LARGEUR À UNE GRILLE : 12 px, et dans une colonne étroite
 * c'est le texte de l'en-tête qui se tronque, pas la colonne qui s'élargit.
 */
import * as React from 'react'
import * as Popover from '@radix-ui/react-popover'
import { createPortal } from 'react-dom'
import { useInRouterContext, useLocation } from 'react-router-dom'
import { Info } from 'lucide-react'
import { sujetPour } from '../../aide/contenu'
import { champDans, texteDe } from '../../aide/indice'
import type { ChampAide } from '../../aide/types'
import { cn } from '../../lib/utils'

/** L'indice d'un intitulé, sur l'écran courant ; rien si le catalogue n'en dit rien. */
export function IndiceChamp({
  intitule,
  className,
  repli = null,
}: {
  intitule: string
  className?: string
  /**
   * Ce qu'on montre quand le catalogue ne dit rien de ce champ — la note
   * locale d'un formulaire, par exemple. Jamais les deux à la fois : une
   * seule aide par champ.
   */
  repli?: React.ReactNode
}) {
  // Hors routeur (rare : une étiquette rendue avant le montage des routes),
  // pas d'écran, donc pas de fiche.
  const dansRouteur = useInRouterContext()
  if (!dansRouteur || !intitule.trim()) return <>{repli}</>
  return <IndiceDeLEcran intitule={intitule} className={className} repli={repli} />
}

function IndiceDeLEcran({
  intitule,
  className,
  repli,
}: {
  intitule: string
  className?: string
  repli: React.ReactNode
}) {
  const { pathname } = useLocation()
  const champ = React.useMemo(() => champDans(sujetPour(pathname), intitule), [pathname, intitule])
  if (!champ) return <>{repli}</>
  return <BulleIndice champ={champ} className={className} />
}

/**
 * Un en-tête de colonne qui porte son indice. Le texte se tronque (avec son
 * titre complet au survol), l'icône reste visible : la colonne ne s'élargit
 * pas. `cle` sert quand l'intitulé affiché varie (« Prix EUR » → « Prix »).
 */
export function EnteteIndice({
  texte,
  cle,
  className,
}: {
  texte: React.ReactNode
  cle?: string
  className?: string
}) {
  const lu = texteDe(texte)
  return (
    <span
      data-indice-gere=""
      className={cn('inline-flex min-w-0 max-w-full items-center gap-0.5 align-bottom', className)}
    >
      <span className="min-w-0 truncate" title={lu || undefined}>
        {texte}
      </span>
      <IndiceChamp intitule={cle ?? lu} />
    </span>
  )
}

// ---------------------------------------------------------------------------
// Les écrans qui dessinent leurs libellés eux-mêmes
// ---------------------------------------------------------------------------

/** Ce qui, dans un libellé, n'est pas son texte : les saisies, les boutons, les icônes. */
const IGNORES = 'select,input,textarea,button,svg,[data-indice-hote],[aria-hidden=true],.sr-only'

/** Ce que l'œil lit d'un libellé : son texte, sans les listes ni les saisies qu'il englobe. */
function texteVisible(el: Element): string {
  let t = ''
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) t += n.textContent ?? ''
    else if (n instanceof Element) {
      if (n.matches(IGNORES)) continue
      t += texteVisible(n)
    }
  }
  return t
}

/** Un élément qui porte lui-même du texte (pas seulement ses enfants). */
function aDuTexte(e: Element): boolean {
  return Array.from(e.childNodes).some(
    (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
  )
}

/**
 * L'élément où poser l'icône : le premier qui porte lui-même du texte (le
 * `<span>` d'un `<label>` qui englobe sa saisie, ou le libellé lui-même).
 */
function porteurDuTexte(el: Element): Element {
  if (aDuTexte(el)) return el
  for (const enfant of Array.from(el.children)) {
    if (enfant.matches(IGNORES)) continue
    const p = porteurDuTexte(enfant)
    if (aDuTexte(p)) return p
  }
  return el
}

/**
 * Ce qui fait office d'intitulé : les étiquettes, les en-têtes de colonne, les
 * termes d'une liste de définitions, et les petits titres en capitales (le
 * style des intitulés de la maison : rangées « ↳ », tuiles, cartes).
 */
const LIBELLES = 'label, th, dt, span[class*="uppercase"], div[class*="uppercase"]'
/** Jamais dans le menu, l'aide, une bulle d'indice, ou un libellé déjà servi par une primitive. */
const DEJA_GERE = '[data-indice-gere], [data-indice], [data-indice-hote]'
const HORS_CHAMP =
  '[data-aide-panneau], [data-sans-indice], nav, button, a[href], [role=tab], [role=dialog][aria-label^="Indice"]'

/**
 * Un libellé RÉPÉTÉ à chaque ligne d'une table (la rangée « ↳ ») ou à chaque
 * carte d'une liste ne porte son indice qu'à la PREMIÈRE ligne : une icône par
 * ligne ferait d'une liste de cent articles cent fois la même aide.
 */
function repete(el: Element): boolean {
  const corps = el.closest('tbody')
  if (corps) {
    const ligne = el.closest('tr')
    // La ligne principale et sa rangée « ↳ » : les deux premières.
    if (ligne && Array.from(corps.rows).indexOf(ligne as HTMLTableRowElement) > 1) return true
  }
  const carte = el.closest('[role=article]')
  if (carte?.parentElement && carte.parentElement.querySelector(':scope > [role=article]') !== carte) return true
  return false
}

/**
 * LE FILET DES ÉCRANS SANS PRIMITIVE (27/10/2026). Les primitives (`Etiq`,
 * `Libelle`, `EnteteIndice`, `DataTable`, `GrilleLignes`, `Formulaire`)
 * posent l'indice d'elles-mêmes ; mais une fiche machine, une fiche hors
 * machine, une grille de réception dessinent leurs `<label>`, `<th>` et
 * `<dt>` à la main. Plutôt que de retoucher chaque écran, ce composant —
 * monté UNE fois dans la coquille — relit les libellés de la page à chaque
 * changement du DOM, et pose un indice là où l'intitulé est décrit au
 * catalogue de l'écran. Les libellés des primitives (`data-indice-gere`) ne
 * sont pas relus.
 *
 * Il n'écrit qu'un `<span data-indice-hote>` à la fin du texte du libellé ; la
 * bulle y est rendue par un portail React. Si React réécrit le libellé et
 * emporte l'hôte, la passe suivante le repose.
 */
export function IndicesAutomatiques() {
  const { pathname } = useLocation()
  const [hotes, setHotes] = React.useState<{ hote: HTMLElement; champ: ChampAide }[]>([])

  React.useEffect(() => {
    if (typeof document === 'undefined') return
    const sujet = sujetPour(pathname)
    const lus = new WeakMap<Element, string>()
    const poses = new Map<Element, { hote: HTMLElement; champ: ChampAide }>()
    let image = 0

    const passe = () => {
      image = 0
      let change = false
      // Les libellés qui ont quitté la page, ou perdu leur hôte.
      for (const [el, h] of poses) {
        if (!el.isConnected || !h.hote.isConnected) {
          h.hote.remove()
          poses.delete(el)
          lus.delete(el)
          change = true
        }
      }
      if (sujet?.champs?.length) {
        for (const el of Array.from(document.querySelectorAll(LIBELLES))) {
          if (poses.has(el)) continue
          if (el.closest(DEJA_GERE) || el.closest(HORS_CHAMP) || el.querySelector(DEJA_GERE)) continue
          if (repete(el)) continue
          // Un seul indice par intitulé : ni dans un libellé déjà servi.
          let servi = false
          for (let p = el.parentElement; p && !servi; p = p.parentElement) servi = poses.has(p)
          if (servi) continue
          const texte = texteVisible(el).trim()
          if (lus.get(el) === texte) continue
          lus.set(el, texte)
          // Au-delà de quelques mots, ce n'est plus un intitulé.
          if (!texte || texte.length > 60) continue
          const champ = champDans(sujet, texte)
          if (!champ) continue
          const hote = document.createElement('span')
          hote.setAttribute('data-indice-hote', '')
          hote.className = 'ml-1 inline-flex align-middle normal-case'
          porteurDuTexte(el).appendChild(hote)
          poses.set(el, { hote, champ })
          change = true
        }
      }
      if (change) setHotes(Array.from(poses.values()))
    }

    const planifier = () => {
      if (!image) image = window.requestAnimationFrame(passe)
    }
    planifier()
    const observateur = new MutationObserver(planifier)
    observateur.observe(document.body, { childList: true, subtree: true })
    return () => {
      observateur.disconnect()
      if (image) window.cancelAnimationFrame(image)
      for (const h of poses.values()) h.hote.remove()
      setHotes([])
    }
  }, [pathname])

  return (
    <>
      {hotes.map(({ hote, champ }, i) => (
        <React.Fragment key={i}>{createPortal(<BulleIndice champ={champ} />, hote)}</React.Fragment>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// F1 : l'indice du champ où se trouve le curseur
// ---------------------------------------------------------------------------

/** Les indices montés, retrouvés par leur bouton. */
const INDICES = new Map<HTMLElement, (retour: HTMLElement | null) => void>()
let ecouteF1 = false

const SAISIES = 'input:not([type=hidden]),select,textarea,[contenteditable=true]'

/** Le bouton d'indice qui décrit l'élément actif, s'il en a un. */
function boutonPour(actif: HTMLElement): HTMLElement | null {
  // 1. Le champ est relié à son étiquette (htmlFor, ou étiquette englobante).
  const etiquettes = (actif as HTMLInputElement).labels
  if (etiquettes) {
    for (const e of Array.from(etiquettes)) {
      const b = e.querySelector<HTMLElement>('[data-indice]')
      if (b) return b
    }
  }
  const englobante = actif.closest('label')?.querySelector<HTMLElement>('[data-indice]')
  if (englobante) return englobante

  // 2. Une cellule de grille : l'indice est sur l'en-tête de SA colonne.
  const cellule = actif.closest('td')
  const table = cellule?.closest('table')
  if (cellule && table?.tHead) {
    let colonne = 0
    for (const c of Array.from((cellule.parentElement as HTMLTableRowElement).cells)) {
      if (c === cellule) break
      colonne += c.colSpan || 1
    }
    for (const ligne of Array.from(table.tHead.rows)) {
      let x = 0
      for (const th of Array.from(ligne.cells)) {
        if (x === colonne) {
          const b = th.querySelector<HTMLElement>('[data-indice]')
          if (b) return b
        }
        x += th.colSpan || 1
      }
    }
  }

  // 3. Une étiquette posée à côté du champ sans lui être reliée : on remonte
  // tant que le conteneur ne porte qu'UNE saisie, pour ne jamais prendre
  // l'étiquette d'un champ voisin.
  let p = actif.parentElement
  for (let n = 0; p && n < 4; n++, p = p.parentElement) {
    if (p.querySelectorAll(SAISIES).length > 1) break
    const b = p.querySelector<HTMLElement>('[data-indice]')
    if (b) return b
  }
  return null
}

function installerF1() {
  if (ecouteF1 || typeof window === 'undefined') return
  ecouteF1 = true
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'F1' || e.ctrlKey || e.altKey || e.metaKey) return
      const actif = document.activeElement as HTMLElement | null
      if (!actif || actif === document.body) return
      const bouton = boutonPour(actif)
      const ouvrir = bouton ? INDICES.get(bouton) : undefined
      if (!ouvrir) return
      // F1 ouvrirait l'aide du navigateur dans un nouvel onglet.
      e.preventDefault()
      ouvrir(actif)
    },
    true,
  )
}

// ---------------------------------------------------------------------------
// La bulle
// ---------------------------------------------------------------------------

function BulleIndice({ champ, className }: { champ: ChampAide; className?: string }) {
  const [ouvert, setOuvert] = React.useState(false)
  // Ouvert par un clic, un tap ou F1 : il ne se referme pas quand la souris s'en va.
  const epingle = React.useRef(false)
  const minuterie = React.useRef<number | undefined>(undefined)
  const retour = React.useRef<HTMLElement | null>(null)
  const parClavier = React.useRef(false)
  const bouton = React.useRef<HTMLButtonElement>(null)
  const idContenu = React.useId()

  const annuler = () => window.clearTimeout(minuterie.current)
  const plusTard = (valeur: boolean, delai: number) => {
    annuler()
    minuterie.current = window.setTimeout(() => setOuvert(valeur), delai)
  }

  const fermer = () => {
    annuler()
    epingle.current = false
    setOuvert(false)
  }

  React.useEffect(() => {
    const b = bouton.current
    if (!b) return
    installerF1()
    INDICES.set(b, (actif) => {
      annuler()
      retour.current = actif
      parClavier.current = true
      epingle.current = true
      setOuvert(true)
    })
    return () => {
      INDICES.delete(b)
      annuler()
    }
  }, [])

  const survol = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && !epingle.current) plusTard(true, 250)
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && !epingle.current) plusTard(false, 180)
    },
  }

  return (
    <Popover.Root open={ouvert} onOpenChange={(v) => (v ? setOuvert(true) : fermer())}>
      <Popover.Anchor asChild>
        <button
          ref={bouton}
          type="button"
          tabIndex={-1}
          data-indice=""
          aria-label={`Indice : ${champ.nom}`}
          aria-expanded={ouvert}
          aria-controls={ouvert ? idContenu : undefined}
          aria-haspopup="dialog"
          {...survol}
          onClick={(e) => {
            // Ni le tri d'une colonne, ni l'activation de l'étiquette, ni le
            // clic sur la ligne : l'indice ne fait rien d'autre que s'ouvrir.
            e.preventDefault()
            e.stopPropagation()
            annuler()
            if (ouvert && epingle.current) {
              fermer()
            } else {
              retour.current = null
              parClavier.current = false
              epingle.current = true
              setOuvert(true)
            }
          }}
          className={cn(
            'indice-champ inline-grid size-3.5 shrink-0 cursor-help place-items-center rounded-full',
            'align-middle normal-case tracking-normal text-attenue-texte/70 transition-colors',
            'hover:text-primaire focus-visible:outline focus-visible:outline-2 focus-visible:outline-anneau',
            ouvert && 'text-primaire',
            className,
          )}
        >
          <Info className="size-3" aria-hidden strokeWidth={2.25} />
        </button>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          id={idContenu}
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={16}
          aria-label={`Indice : ${champ.nom}`}
          data-sans-indice=""
          {...survol}
          // Au survol, le curseur reste dans le champ ; au clavier, la bulle
          // prend le focus pour être lue, et Échap le rend au champ.
          onOpenAutoFocus={(e) => {
            if (!parClavier.current) e.preventDefault()
          }}
          // Un clic sur l'icône elle-même n'est pas « ailleurs » : c'est son
          // propre gestionnaire qui ouvre, épingle ou referme.
          onInteractOutside={(e) => {
            if (bouton.current?.contains(e.target as Node)) e.preventDefault()
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            retour.current?.focus()
            retour.current = null
          }}
          className={cn(
            'z-[70] w-max max-w-[min(20rem,calc(100vw-2rem))] rounded-md border border-bordure',
            'bg-surface px-2.5 py-2 text-left text-[12px] font-normal normal-case leading-relaxed',
            'tracking-normal text-texte shadow-lg outline-none apparition',
          )}
          tabIndex={-1}
        >
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-semibold">{champ.nom}</span>
            {champ.obligatoire && (
              <span className="rounded bg-danger/10 px-1 text-[9.5px] font-semibold uppercase tracking-wide text-danger">
                obligatoire
              </span>
            )}
          </div>
          <p className="m-0 mt-0.5">{champ.description}</p>
          {champ.valeurs && (
            <p className="m-0 mt-1 text-[11.5px] text-attenue-texte">
              <span className="font-medium">Valeurs : </span>
              {champ.valeurs}
            </p>
          )}
          {champ.defaut && (
            <p className="m-0 mt-0.5 text-[11.5px] text-attenue-texte">
              <span className="font-medium">Par défaut : </span>
              {champ.defaut}
            </p>
          )}
          <Popover.Arrow className="fill-bordure" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
