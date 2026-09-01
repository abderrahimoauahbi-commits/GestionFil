/**
 * Ouvrir une vue, et lire ses parametres, sans savoir dans quelle enveloppe on
 * tourne.
 *
 * Sur le poste fixe l'application est un atelier a onglets ; sur le web et en
 * PWA c'est une navigation ordinaire. Un ecran metier ne doit dependre ni de
 * l'une ni de l'autre : il demande a ouvrir une vue, la coquille tranche.
 *
 * LE PIEGE, ET LA RAISON DE CE FICHIER. Dans l'atelier, TOUS les onglets
 * restent montes, et chacun rend `<Routes location={son chemin}>`. Cela suffit
 * a `useParams()`, qui vient de la correspondance de route — mais PAS a
 * `useLocation()`, qui rend l'adresse globale du routeur. Un ecran qui lirait
 * `useLocation().search` recevrait donc la chaine de requete de l'onglet qu'on
 * vient d'ouvrir, et l'appliquerait a tous les autres : deux onglets Mouvements
 * ouverts sur deux references afficheraient la meme.
 *
 * D'ou le contexte ci-dessous : l'atelier y depose le chemin PROPRE a l'onglet,
 * et `useParamVue` le lit en priorite. Hors atelier, le contexte est absent et
 * l'adresse du routeur est la bonne reponse.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useOngletsFacultatif } from '../composants/atelier/etat'

/** Chemin de la vue courante, depose par l'atelier pour chaque onglet monte. */
export const ContexteChemin = createContext<string | null>(null)

export function useOuvrirVue() {
  const navigate = useNavigate()
  const onglets = useOngletsFacultatif()

  return useCallback(
    (chemin: string) => {
      if (onglets) onglets.ouvrir(chemin)
      else navigate(chemin)
    },
    [onglets, navigate],
  )
}

/** Parametre de requete de LA vue courante, onglet par onglet. */
export function useParamVue(nom: string): string {
  const chemin = useContext(ContexteChemin)
  const location = useLocation()
  const requete = chemin ? chemin.slice(chemin.indexOf('?')) : location.search
  if (chemin && !chemin.includes('?')) return ''
  return new URLSearchParams(requete).get(nom) ?? ''
}

/**
 * Etat local amorce par un parametre d'URL, et resynchronise s'il change.
 *
 * L'amorcage seul suffirait dans l'atelier, ou le chemin d'un onglet ne change
 * jamais — il EST son identite. Hors atelier, naviguer vers la meme page avec
 * un autre parametre ne remonte pas le composant : sans l'effet, l'ecran
 * garderait le filtre precedent en affichant une adresse qui en promet un autre.
 */
export function useEtatDepuisParam(nom: string): [string, (v: string) => void] {
  const param = useParamVue(nom)
  const [valeur, setValeur] = useState(param)
  useEffect(() => setValeur(param), [param])
  return [valeur, setValeur]
}
