/**
 * Palette de commandes et navigation rapide.
 *
 * Un seul composant pour les deux, parce que c'est un seul champ : le prefixe
 * « > » bascule de la navigation vers les commandes, exactement comme dans
 * l'editeur. Ctrl+P ouvre sans prefixe, Ctrl+Maj+P ouvre avec.
 *
 * Le filtrage est un appariement par sous-sequence — taper « planac » trouve
 * « Plan d'achat ». Un filtre par sous-chaine stricte obligerait a connaitre
 * le libelle exact, ce qui annule l'interet de la palette.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Command, Search, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface Entree {
  id: string
  libelle: string
  /** Second niveau, aligne a droite : groupe, chemin ou raccourci. */
  detail?: string
  raccourci?: string
  Icone?: LucideIcon
  executer: () => void
}

/* -------------------------------------------------------------------------- */
/* Appariement                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Score d'une sous-sequence. Renvoie `null` si le motif n'apparait pas dans
 * l'ordre. Les correspondances contigues et les debuts de mot valent plus, ce
 * qui remonte « Plans » avant « Plan d'achat » sur la saisie « plan ».
 */
function apparier(texte: string, motif: string): number | null {
  if (!motif) return 0
  const t = texte.toLowerCase()
  const m = motif.toLowerCase()

  let score = 0
  let i = 0
  let precedent = -2

  for (const car of m) {
    const trouve = t.indexOf(car, i)
    if (trouve === -1) return null
    if (trouve === precedent + 1) score += 6
    if (trouve === 0 || ' -/_·'.includes(t[trouve - 1])) score += 4
    score -= Math.min(trouve - i, 6)
    precedent = trouve
    i = trouve + 1
  }

  // Un libelle court qui contient tout le motif est plus pertinent qu'un long.
  return score - Math.min(t.length - m.length, 20) / 4
}

/* -------------------------------------------------------------------------- */
/* Palette                                                                     */
/* -------------------------------------------------------------------------- */

export function Palette({
  ouvert,
  prefixe,
  fermer,
  commandes,
  destinations,
}: {
  ouvert: boolean
  /** '>' pour la palette de commandes, '' pour la navigation rapide. */
  prefixe: '>' | ''
  fermer: () => void
  commandes: Entree[]
  destinations: Entree[]
}) {
  const [saisie, setSaisie] = useState<string>(prefixe)
  const [curseur, setCurseur] = useState(0)
  const champ = useRef<HTMLInputElement>(null)
  const liste = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ouvert) return
    setSaisie(prefixe)
    setCurseur(0)
    // Le champ doit prendre le focus apres le rendu du portail.
    const t = window.setTimeout(() => champ.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [ouvert, prefixe])

  const modeCommande = saisie.startsWith('>')
  const motif = modeCommande ? saisie.slice(1).trim() : saisie.trim()

  const resultats = useMemo(() => {
    const source = modeCommande ? commandes : destinations
    if (!motif) return source.slice(0, 50)
    return source
      .map((e) => ({ e, s: apparier(`${e.libelle} ${e.detail ?? ''}`, motif) }))
      .filter((r): r is { e: Entree; s: number } => r.s !== null)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map((r) => r.e)
  }, [modeCommande, motif, commandes, destinations])

  useEffect(() => setCurseur(0), [saisie])

  /* Maintient l'element sous le curseur dans la zone visible. */
  useEffect(() => {
    liste.current?.querySelector<HTMLElement>('[data-curseur="oui"]')?.scrollIntoView({
      block: 'nearest',
    })
  }, [curseur, resultats])

  if (!ouvert) return null

  const valider = (e?: Entree) => {
    const cible = e ?? resultats[curseur]
    if (!cible) return
    fermer()
    cible.executer()
  }

  const auClavier = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      fermer()
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault()
      setCurseur((c) => (resultats.length ? (c + 1) % resultats.length : 0))
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault()
      setCurseur((c) => (resultats.length ? (c - 1 + resultats.length) % resultats.length : 0))
    } else if (ev.key === 'Enter') {
      ev.preventDefault()
      valider()
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-center pt-[6vh]"
      onMouseDown={fermer}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={modeCommande ? 'Palette de commandes' : 'Navigation rapide'}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-fit max-h-[60vh] w-[min(620px,92vw)] flex-col overflow-hidden
                   rounded-[6px] border border-bordure bg-surface shadow-2xl"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-bordure px-3 py-2">
          {modeCommande ? (
            <Command className="size-4 shrink-0 text-attenue-texte" />
          ) : (
            <Search className="size-4 shrink-0 text-attenue-texte" />
          )}
          <input
            ref={champ}
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={auClavier}
            placeholder={
              modeCommande ? 'Taper une commande' : 'Aller a un ecran — taper > pour les commandes'
            }
            className="w-full bg-transparent text-[13px] text-texte outline-none
                       placeholder:text-attenue-texte"
          />
        </div>

        <div ref={liste} className="min-h-0 flex-1 overflow-y-auto py-1">
          {resultats.length === 0 ? (
            <p className="px-3 py-4 text-center text-[12px] text-attenue-texte">
              Aucune correspondance
            </p>
          ) : (
            resultats.map((e, i) => (
              <button
                key={e.id}
                type="button"
                data-curseur={i === curseur ? 'oui' : 'non'}
                onMouseMove={() => setCurseur(i)}
                onClick={() => valider(e)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]',
                  i === curseur ? 'at-liste-actif' : 'text-texte hover:bg-attenue',
                )}
              >
                {e.Icone ? (
                  <e.Icone className="size-4 shrink-0 opacity-80" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 opacity-40" />
                )}
                <span className="flex-1 truncate">{e.libelle}</span>
                {e.detail && (
                  <span className="shrink-0 text-[11px] text-attenue-texte">{e.detail}</span>
                )}
                {e.raccourci && (
                  <span className="shrink-0 font-mono text-[10px] text-attenue-texte">
                    {e.raccourci}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
