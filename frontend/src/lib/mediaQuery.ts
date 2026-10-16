import { useEffect, useState } from 'react'

/**
 * Vrai sous `largeur` px (768 par defaut : telephone et tablette portrait).
 *
 * Sert aux ecrans qui changent de FORME, pas seulement de style, selon la place
 * — par exemple une grille large qui devient une pile de cartes au doigt. Les
 * seuls ajustements de style passent par les classes Tailwind ; ce hook est pour
 * quand il faut monter un composant different, pas pour masquer en CSS.
 */
export function useEstMobile(largeur = 768): boolean {
  const requete = `(max-width: ${largeur - 1}px)`
  const [etroit, setEtroit] = useState(() =>
    typeof window !== 'undefined' && 'matchMedia' in window
      ? window.matchMedia(requete).matches
      : false,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return
    const mq = window.matchMedia(requete)
    const surChangement = () => setEtroit(mq.matches)
    surChangement()
    mq.addEventListener('change', surChangement)
    return () => mq.removeEventListener('change', surChangement)
  }, [requete])
  return etroit
}
