/**
 * Cellule editable en ligne.
 *
 * Sur les tables simples — densites d'une qualite, lignes d'un plan, comptage
 * d'inventaire — passer par un panneau de saisie pour changer un nombre est
 * une perte de temps. Ici, on clique, on tape, on valide.
 *
 * Regles de saisie :
 *   Entree   valide          Echap    annule
 *   Tab      valide et passe a la cellule suivante
 *   perte de focus : valide, sauf si la valeur est inchangee
 *
 * La cellule respecte la grille de droits : sans le niveau ECRITURE sur le
 * champ, elle reste un simple texte. Le serveur applique de toute facon la
 * meme regle — l'interface evite seulement une saisie vouee au refus.
 */
import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { cn } from '../lib/utils'

export interface OptionCellule {
  valeur: string
  libelle: string
}

interface Props {
  valeur: unknown
  /** Rendu en lecture. Par defaut, la valeur brute. */
  affichage?: React.ReactNode
  type?: 'texte' | 'nombre' | 'entier' | 'date' | 'liste'
  options?: OptionCellule[]
  modifiable: boolean
  min?: number
  max?: number
  pas?: number
  suffixe?: string
  aligneDroite?: boolean
  /** Doit rejeter en cas d'echec : la cellule restaure alors l'ancienne valeur. */
  surValider: (valeur: unknown) => Promise<unknown> | unknown
}

export function CelluleEditable({
  valeur,
  affichage,
  type = 'texte',
  options,
  modifiable,
  min,
  max,
  pas,
  suffixe,
  aligneDroite,
  surValider,
}: Props) {
  const [edition, setEdition] = useState(false)
  const [brouillon, setBrouillon] = useState('')
  const [enCours, setEnCours] = useState(false)
  const champRef = useRef<HTMLInputElement | HTMLSelectElement>(null)

  useEffect(() => {
    if (edition) {
      champRef.current?.focus()
      if (champRef.current instanceof HTMLInputElement) champRef.current.select()
    }
  }, [edition])

  function ouvrir() {
    if (!modifiable || enCours) return
    setBrouillon(valeur === null || valeur === undefined ? '' : String(valeur))
    setEdition(true)
  }

  async function valider() {
    const brut = brouillon.trim()
    const nouvelle =
      brut === ''
        ? null
        : type === 'nombre' || type === 'entier'
          ? Number(brut)
          : brut

    // Rien n'a change : on ferme sans solliciter le serveur.
    if (String(nouvelle ?? '') === String(valeur ?? '')) {
      setEdition(false)
      return
    }
    if ((type === 'nombre' || type === 'entier') && nouvelle !== null && isNaN(nouvelle as number)) {
      setEdition(false)
      return
    }

    setEnCours(true)
    try {
      await surValider(nouvelle)
      setEdition(false)
    } catch {
      // L'appelant a signale l'erreur ; on reste en edition pour permettre
      // la correction plutot que de perdre la saisie.
    } finally {
      setEnCours(false)
    }
  }

  if (!modifiable) {
    return (
      <span className={cn('block', aligneDroite && 'text-right')}>
        {affichage ?? (valeur === null || valeur === undefined ? '—' : String(valeur))}
        {suffixe && <span className="ml-0.5 text-attenue-texte">{suffixe}</span>}
      </span>
    )
  }

  if (edition) {
    const commun = {
      ref: champRef as never,
      value: brouillon,
      disabled: enCours,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          void valider()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setEdition(false)
        }
      },
      onBlur: () => void valider(),
      className: cn(
        'w-full rounded border border-anneau bg-surface px-1.5 py-0.5 text-sm outline-none',
        'ring-2 ring-anneau/25',
        aligneDroite && 'text-right',
      ),
    }

    return (
      <div className="flex items-center gap-1">
        {type === 'liste' ? (
          <select {...commun} onChange={(e) => setBrouillon(e.target.value)}>
            <option value="">—</option>
            {options?.map((o) => (
              <option key={o.valeur} value={o.valeur}>
                {o.libelle}
              </option>
            ))}
          </select>
        ) : (
          <input
            {...commun}
            type={type === 'date' ? 'date' : type === 'texte' ? 'text' : 'number'}
            inputMode={type === 'nombre' || type === 'entier' ? 'decimal' : undefined}
            step={type === 'entier' ? 1 : (pas ?? 'any')}
            min={min}
            max={max}
            onChange={(e) => setBrouillon(e.target.value)}
          />
        )}
        {enCours ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-attenue-texte" />
        ) : (
          <>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void valider()}
              className="shrink-0 rounded p-0.5 text-succes hover:bg-succes/10"
              aria-label="Valider"
            >
              <Check className="size-3.5" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setEdition(false)}
              className="shrink-0 rounded p-0.5 text-attenue-texte hover:bg-attenue"
              aria-label="Annuler"
            >
              <X className="size-3.5" />
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={ouvrir}
      className={cn(
        'group flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors',
        'hover:bg-attenue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau',
        aligneDroite && 'justify-end',
      )}
      title="Cliquer pour modifier"
    >
      <span className={cn('truncate', aligneDroite && 'text-right')}>
        {affichage ?? (valeur === null || valeur === undefined ? '—' : String(valeur))}
        {suffixe && <span className="ml-0.5 text-attenue-texte">{suffixe}</span>}
      </span>
      <Pencil className="size-3 shrink-0 text-attenue-texte opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}
