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

/**
 * Un nombre affichable : fini. NaN et l'infini s'affichent « — » comme une
 * valeur absente — une saisie illisible (« 1,2,3 ») ou une division par zero
 * ecrivait « NaN » ou « ∞ » a l'ecran (T-GF-009, 15/10/2026).
 */
const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Formatage francais, uniforme dans toute l'application. */
export const fmt = {
  nombre: (v: unknown, decimales = 2) =>
    fini(v)
      ? v.toLocaleString('fr-FR', {
          minimumFractionDigits: decimales,
          maximumFractionDigits: decimales,
        })
      : '—',

  entier: (v: unknown) => (fini(v) ? v.toLocaleString('fr-FR') : '—'),

  mad: (v: unknown) =>
    fini(v)
      ? `${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} MAD`
      : '—',

  /** Montant compact pour les tuiles : 13 421 922 -> 13,4 M. */
  compact: (v: unknown) => {
    if (!fini(v)) return '—'
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
/**
 * `chemin` est-il l'ecran `vers` ou l'un de ses sous-ecrans ? Par SEGMENT, pas
 * par caractere : « /receptions » ne couvre pas « /receptions-import ».
 */
export const sousChemin = (chemin: string, vers: string) =>
  chemin === vers || chemin.startsWith(vers.endsWith('/') ? vers : `${vers}/`)

export const estBureau = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * ARRONDI AU CENTIME, comme `round(x, 2)` de PostgreSQL : a la moitie, on
 * s'eloigne de zero. Le decalage d'un epsilon rattrape les flottants qui
 * tombent juste sous la moitie (1,005 vaut 1,00499… en binaire).
 *
 * C'EST LA REGLE DES DOCUMENTS : chaque ligne s'arrondit au centime, le total
 * est la somme des lignes arrondies, et la contre-valeur en dirhams
 * s'arrondit une fois, sur ce total. L'ecran et la base comptent ainsi pareil.
 */
export const auCentime = (x: number) => {
  if (!Number.isFinite(x)) return 0
  const s = Math.sign(x)
  return (s * Math.round(Math.abs(x) * 100 + 1e-7)) / 100
}
