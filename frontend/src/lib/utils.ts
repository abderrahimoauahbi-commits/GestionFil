import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Fusionne des classes Tailwind en resolvant les conflits.
 *
 * Sans `twMerge`, `cn('px-4', 'px-2')` laisserait les deux regles et l'ordre
 * dans la feuille de style deciderait — ce qui rend les surcharges de
 * composants imprevisibles.
 */
export function cn(...entrees: ClassValue[]) {
  return twMerge(clsx(entrees))
}

/** Formatage francais, uniforme dans toute l'application. */
export const fmt = {
  nombre: (v: unknown, decimales = 2) =>
    typeof v === 'number'
      ? v.toLocaleString('fr-FR', {
          minimumFractionDigits: decimales,
          maximumFractionDigits: decimales,
        })
      : '—',

  entier: (v: unknown) => (typeof v === 'number' ? v.toLocaleString('fr-FR') : '—'),

  mad: (v: unknown) =>
    typeof v === 'number'
      ? `${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} MAD`
      : '—',

  /** Montant compact pour les tuiles : 13 421 922 -> 13,4 M. */
  compact: (v: unknown) => {
    if (typeof v !== 'number') return '—'
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`
    if (Math.abs(v) >= 1e3) return `${(v / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k`
    return v.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
  },

  date: (v: unknown) => {
    if (typeof v !== 'string' || !v) return '—'
    const d = new Date(v)
    return isNaN(d.getTime()) ? v : d.toLocaleDateString('fr-FR')
  },

  dateHeure: (v: unknown) => {
    if (typeof v !== 'string' || !v) return '—'
    const d = new Date(v)
    return isNaN(d.getTime())
      ? v
      : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
  },

  booleen: (v: unknown) =>
    v === 1 || v === true ? 'Oui' : v === 0 || v === false ? 'Non' : '—',

  texte: (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v)),
}

/** Detecte l'execution dans l'enveloppe Tauri (application de bureau). */
export const estBureau = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
