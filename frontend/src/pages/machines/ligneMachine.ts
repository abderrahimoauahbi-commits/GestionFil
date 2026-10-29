/**
 * Ce qu'une ligne de fiche machine sert, en clair (sa qualite), et le seuil de
 * l'interface de terrain. Partage par le bureau et le telephone ; rien n'y est
 * calcule de ce qui part au serveur.
 */
import { useEffect, useState } from 'react'
import { qualiteDeLOf, type OfOuvert } from '../../composants/ChoixOF'
import type { LigneSaisie, TypeFiche } from './noyau'

/**
 * Ce que la ligne sert, en clair : sa qualite et d'ou elle vient. Plus d'OF ni
 * de qualite d'en-tete (24/10/2026) : celle de l'OF de la ligne, ou de l'OF
 * qu'elle sert deja ; au dechargement et au constat sans OF, celle de l'etat.
 */
export function qualiteDeLaLigne(
  l: LigneSaisie,
  type: TypeFiche,
  ofs: OfOuvert[] | undefined,
): { imposee: string | null; source: 'OF' | 'LIGNE' | null } {
  if (l.id_of) return { imposee: qualiteDeLOf(ofs, l.id_of) ?? '…', source: 'OF' }
  if (l.avant_numero_of) return { imposee: l.avant_qualite_nom ?? l.avant_code_qualite ?? '…', source: 'OF' }
  if (type !== 'CHARGE') return { imposee: l.avant_qualite_nom ?? l.avant_code_qualite ?? 'sans qualité', source: 'LIGNE' }
  return { imposee: null, source: null }
}

/** Le texte court d'une ligne fermee : « 8F MOSQUEE », « garde 8F »… */
export function resumeQualite(l: LigneSaisie, type: TypeFiche, ofs: OfOuvert[] | undefined) {
  const q = qualiteDeLaLigne(l, type, ofs)
  if (q.imposee != null) return q.imposee
  if (l.code_qualite) return l.code_qualite
  if (l.avant_code_qualite) return `garde ${l.avant_qualite_nom ?? l.avant_code_qualite}`
  return 'qualité à choisir'
}

/**
 * L'ECRAN EST-IL LARGE ? Le meme seuil que l'aiguillage /machines (1024 px),
 * reevalue au redimensionnement : sous ce seuil, la fiche prend l'interface
 * de terrain.
 */
export function useEcranLarge() {
  const [large, setLarge] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024)
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1024px)')
    const suivre = (e: MediaQueryListEvent) => setLarge(e.matches)
    m.addEventListener('change', suivre)
    return () => m.removeEventListener('change', suivre)
  }, [])
  return large
}
