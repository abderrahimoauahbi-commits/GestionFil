/**
 * LA GARDE DE PERTE DE SAISIE (audit v4, completee le 09/10/2026, F20).
 *
 * Une réception à moitié pesée, un bon à moitié saisi se perdaient sans un
 * mot : un clic dans le menu, et vingt lignes disparaissaient. Tant que
 * `actif` est vrai, la garde demande confirmation avant de quitter l'écran :
 *   - par un lien de l'application (menu, fil d'Ariane, bouton qui est un
 *     lien) — clics écoutés en phase de capture, avant le routeur ;
 *   - par les boutons « Retour » et « Annuler » de l'écran, qui passent par
 *     `quitter(() => naviguer(...))` ;
 *   - par le retour du navigateur ou le geste retour de la tablette : une
 *     entrée d'historique témoin, à la même adresse, absorbe le premier retour ;
 *   - et le navigateur avertit avant de fermer l'onglet ou de recharger.
 *
 * La question est posée dans l'application (jamais `window.confirm`, proscrit :
 * il bloque, ne se style pas et diffère d'une plateforme à l'autre), par
 * `<ConfirmationQuitter />`, monté une fois dans la coquille. Une navigation
 * par programme après un enregistrement réussi n'est pas interceptée : c'est
 * voulu.
 *
 * L'application monte un `BrowserRouter`, qui n'offre pas `useBlocker`.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { Confirmation } from '../composants/ui/surcouches'

const TITRE = 'Quitter sans enregistrer ?'
const MESSAGE = 'Des modifications ne sont pas enregistrées : elles seront perdues.'
const TEMOIN = 'gardeSaisie'

// ---------------------------------------------------------------------------
// La question en attente : un seul magasin pour toute l'application.
// ---------------------------------------------------------------------------
type Question = { partir: () => void; rester?: () => void } | null
let question: Question = null
const abonnes = new Set<() => void>()
const publier = () => abonnes.forEach((f) => f())

function demander(q: NonNullable<Question>) {
  question = q
  publier()
}

/** La confirmation de la garde, montée une fois dans la coquille. */
export function ConfirmationQuitter() {
  const q = useSyncExternalStore(
    (f) => {
      abonnes.add(f)
      return () => abonnes.delete(f)
    },
    () => question,
  )
  return (
    <Confirmation
      ouvert={q !== null}
      surOuvert={(o) => {
        if (!o && question) {
          const rester = question.rester
          question = null
          publier()
          rester?.()
        }
      }}
      titre={TITRE}
      description={MESSAGE}
      libelleConfirmer="Quitter sans enregistrer"
      destructif
      surConfirmer={() => {
        const partir = question?.partir
        question = null
        publier()
        partir?.()
      }}
    />
  )
}

/**
 * Arme la garde tant que `actif` est vrai. Rend `quitter(action)` : l'action
 * (le plus souvent une navigation) passe tout de suite si rien n'est en cours,
 * après confirmation sinon.
 */
export function useGardeSaisie(actif: boolean) {
  const naviguer = useNavigate()
  const actifRef = useRef(actif)
  useEffect(() => {
    actifRef.current = actif
  }, [actif])
  // La garde levee pour une sortie confirmee : plus de question jusqu'au depart.
  const levee = useRef(false)

  useEffect(() => {
    if (!actif) return
    levee.current = false
    const avantFermeture = (e: BeforeUnloadEvent) => {
      if (levee.current) return
      e.preventDefault()
      // Les navigateurs affichent leur propre texte ; la valeur doit seulement exister.
      e.returnValue = ''
    }
    const surClic = (e: MouseEvent) => {
      if (levee.current) return
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const lien = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!lien || lien.target === '_blank' || lien.hasAttribute('download')) return
      const url = new URL(lien.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      e.preventDefault()
      e.stopPropagation()
      demander({
        partir: () => {
          levee.current = true
          naviguer(url.pathname + url.search + url.hash)
        },
      })
    }
    // LE RETOUR DU NAVIGATEUR : une entree temoin, a la meme adresse. Le
    // premier retour la retire sans changer d'ecran ; on pose alors la
    // question. Rester la remet ; partir fait le vrai retour.
    if (!window.history.state?.[TEMOIN]) {
      window.history.pushState({ ...window.history.state, [TEMOIN]: true }, '')
    }
    const surRetour = () => {
      if (levee.current || window.history.state?.[TEMOIN]) return
      demander({
        partir: () => {
          levee.current = true
          window.history.back()
        },
        rester: () => window.history.pushState({ ...window.history.state, [TEMOIN]: true }, ''),
      })
    }
    window.addEventListener('beforeunload', avantFermeture)
    window.addEventListener('popstate', surRetour)
    document.addEventListener('click', surClic, true)
    return () => {
      window.removeEventListener('beforeunload', avantFermeture)
      window.removeEventListener('popstate', surRetour)
      document.removeEventListener('click', surClic, true)
      // Desarmee sur place (saisie enregistree) : l'entree temoin perd sa
      // marque, sans retour en arriere — un `history.back()` ici croiserait la
      // navigation qui suit souvent l'enregistrement.
      if (window.history.state?.[TEMOIN]) {
        window.history.replaceState({ ...window.history.state, [TEMOIN]: false }, '')
      }
    }
  }, [actif, naviguer])

  return useCallback(
    (action: () => void) => {
      if (!actifRef.current || levee.current) return action()
      demander({
        partir: () => {
          levee.current = true
          action()
        },
      })
    },
    [],
  )
}
