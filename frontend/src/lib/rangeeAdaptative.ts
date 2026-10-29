/**
 * UNE LIGNE DE SAISIE SUR UNE SEULE RANGEE, QUAND ELLE Y TIENT (24/10/2026).
 *
 * « Sur la ligne les champs sont trop larges, alors qu'il se peut que tous les
 * champs soient sur la meme ligne. » Chaque case a la largeur de ce qu'elle
 * attend (une quantite, un compte de bobines, un lot) ; la reference prend le
 * reste. Les cases FACULTATIVES (palettes, lot, magasin…) se placent sur la
 * rangee principale tant que la largeur MESUREE du tableau le permet, dans
 * l'ordre donne ; celles qui n'y tiennent plus passent sur la rangee « ↳ »,
 * juste dessous. Rien n'est suppose : c'est la largeur reelle du conteneur qui
 * decide, et elle est suivie quand la fenetre ou la barre laterale change.
 */
import { useLayoutEffect, useRef, useState } from 'react'

/** La largeur utile d'un element, suivie a chaque redimensionnement. */
export function useLargeurConteneur<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [largeur, setLargeur] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const maj = () => setLargeur(el.clientWidth)
    maj()
    if (typeof ResizeObserver === 'undefined') return
    const o = new ResizeObserver(maj)
    o.observe(el)
    return () => o.disconnect()
  }, [])
  return [ref, largeur] as const
}

/** Une case facultative : sa cle et sa largeur en pixels, rembourrage compris. */
export interface CaseSouple {
  cle: string
  largeur: number
}

/**
 * Les cases qui tiennent sur la rangee principale, dans l'ordre, et les autres.
 *
 * `fixe` : ce que prennent deja les cases toujours presentes (la reference
 * comptee a sa largeur minimale). Des qu'une case ne tient plus, elle et les
 * suivantes passent dessous : l'ordre de lecture ne change pas d'une rangee a
 * l'autre. Largeur encore inconnue (premier rendu) : tout passe dessous.
 */
export function repartirCases<C extends CaseSouple>(fixe: number, cases: C[], disponible: number) {
  const enLigne: C[] = []
  const dessous: C[] = []
  let reste = disponible - fixe
  for (const c of cases) {
    if (dessous.length === 0 && disponible > 0 && c.largeur <= reste) {
      enLigne.push(c)
      reste -= c.largeur
    } else dessous.push(c)
  }
  return { enLigne, dessous }
}

/**
 * La largeur en pixels d'une classe Tailwind `w-N` ou d'une valeur `120px`,
 * ramenee a ce que la case doit contenir (jamais plus de `plafond`).
 */
export function largeurDeClasse(classe: string | undefined, defaut = 140, plafond = 160): number {
  if (!classe) return defaut
  const px = /^(\d+)px$/.exec(classe.trim())
  if (px) return Math.min(Number(px[1]), plafond)
  const w = /(?:^|\s)w-(\d+(?:\.\d+)?)(?:\s|$)/.exec(classe)
  if (w) return Math.max(64, Math.min(Math.round(Number(w[1]) * 4 * 0.85), plafond))
  return defaut
}
