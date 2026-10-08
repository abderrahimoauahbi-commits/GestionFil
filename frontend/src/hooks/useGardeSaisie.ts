/**
 * LA GARDE DE PERTE DE SAISIE (audit v4, P3).
 *
 * Une réception à moitié pesée, un bon à moitié saisi se perdaient sans un
 * mot : un clic dans le menu, et vingt lignes disparaissaient. Tant que
 * `actif` est vrai, la garde :
 *   - demande confirmation avant de quitter l'écran par un lien de
 *     l'application (menu, fil d'Ariane, bouton qui est un lien) ;
 *   - fait avertir le navigateur avant de fermer l'onglet ou de recharger.
 *
 * L'application monte un `BrowserRouter`, qui n'offre pas `useBlocker` : la
 * garde écoute donc les clics sur les liens en phase de capture, avant que le
 * routeur ne les traite. Une navigation par programme (après un
 * enregistrement réussi) n'est pas interceptée : c'est voulu.
 */
import { useEffect } from 'react'

const MESSAGE = 'Des modifications ne sont pas enregistrées. Quitter cet écran quand même ?'

export function useGardeSaisie(actif: boolean) {
  useEffect(() => {
    if (!actif) return
    const avantFermeture = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Les navigateurs affichent leur propre texte ; la valeur doit seulement exister.
      e.returnValue = ''
    }
    const surClic = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const lien = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!lien || lien.target === '_blank' || lien.hasAttribute('download')) return
      const url = new URL(lien.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      if (!window.confirm(MESSAGE)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', avantFermeture)
    document.addEventListener('click', surClic, true)
    return () => {
      window.removeEventListener('beforeunload', avantFermeture)
      document.removeEventListener('click', surClic, true)
    }
  }, [actif])
}
