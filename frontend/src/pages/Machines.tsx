/**
 * Machines — l'aiguillage entre les deux interfaces.
 *
 * DEUX CONCEPTS, PAS DEUX MISES EN PAGE. Le bureau sert a comparer et a
 * corriger : trois colonnes, une grille de saisie qui se remplit au clavier.
 * Le terrain sert a declarer : une chose a la fois, de gros champs, et le
 * constat toujours au-dessus du clavier.
 *
 * Les deux lisent les memes donnees et font le meme calcul — `useFiche` est
 * partage — de sorte qu'un chargement saisi au telephone donne exactement le
 * meme resultat que le meme chargement saisi au bureau.
 *
 * LE SEUIL EST A 1024 px, et il se reevalue au redimensionnement : une
 * tablette qu'on tourne change d'interface, ce qui est le comportement voulu.
 */
import { useEffect, useState } from 'react'
import { MachinesBureau } from './machines/Bureau'
import { MachinesMobile } from './machines/Mobile'

export function Machines() {
  const [large, setLarge] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1024,
  )

  useEffect(() => {
    const m = window.matchMedia('(min-width: 1024px)')
    const suivre = (e: MediaQueryListEvent) => setLarge(e.matches)
    m.addEventListener('change', suivre)
    setLarge(m.matches)
    return () => m.removeEventListener('change', suivre)
  }, [])

  return large ? <MachinesBureau /> : <MachinesMobile />
}
