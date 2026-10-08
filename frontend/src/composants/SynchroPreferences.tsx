/**
 * Les reglages d'apparence suivent le COMPTE (06/10/2026).
 *
 * A la connexion, on relit les reglages enregistres sur le serveur et on les
 * applique : on retrouve son style, sa palette, sa police, son fond, sur
 * n'importe quel poste, sans rien reconfigurer. Ensuite, chaque changement est
 * renvoye au serveur, une fois l'utilisateur arrete de regler (une seconde).
 *
 * Monte dans la coquille, donc seulement quand on est connecte.
 *
 * PREMIERE CONNEXION APRES LA MISE A JOUR : le serveur n'a encore rien pour ce
 * compte. On lui envoie alors les reglages deja faits dans ce navigateur, pour
 * ne pas les perdre.
 */
import { useEffect, useRef } from 'react'
import { api } from '../api/client'
import { useApparence, type Apparence } from './Apparence'
import { useTheme, type Theme } from './Theme'

interface Enregistre {
  apparence: (Partial<Apparence> & { theme?: Theme }) | null
  fond_image: string | null
}

export function SynchroPreferences() {
  const ap = useApparence()
  const { theme, definir: definirTheme } = useTheme()
  /** Faux tant que les reglages du serveur ne sont pas appliques : on n'ecrase
   *  pas le serveur avec les valeurs du navigateur avant de l'avoir lu. */
  const pret = useRef(false)
  const imageEnvoyee = useRef<string | null | undefined>(undefined)
  /** Les reglages courants, pour la premiere sauvegarde d'un compte neuf. */
  const courant = useRef<Record<string, unknown>>({})

  const { remplacer, definirImageFond } = ap
  useEffect(() => {
    let annule = false
    api
      .get<Enregistre>('/api/auth/preferences')
      .then((p) => {
        if (annule) return
        if (!p.apparence) {
          // Compte sans reglages sur le serveur : on y range ceux du navigateur.
          api.put('/api/auth/preferences', courant.current).catch(() => {})
          imageEnvoyee.current = courant.current.fond_image as string | null
        } else {
          const { theme: t, ...reste } = p.apparence
          remplacer(reste)
          if (t) definirTheme(t)
          definirImageFond(p.fond_image)
          imageEnvoyee.current = p.fond_image
        }
        pret.current = true
      })
      .catch(() => {
        // Serveur ancien ou injoignable : on garde les reglages du navigateur.
        pret.current = true
      })
    return () => {
      annule = true
    }
  }, [remplacer, definirTheme, definirImageFond])

  const { charte, densite, taille, disposition, piedVisible, menuMasque, police, palette, cadres, fond, verre, imageFond } = ap
  useEffect(() => {
    courant.current = {
      apparence: { charte, densite, taille, disposition, piedVisible, menuMasque, police, palette, cadres, fond, verre, theme },
      fond_image: imageFond,
    }
    if (!pret.current) return
    const minuterie = window.setTimeout(() => {
      const corps: Record<string, unknown> = {
        apparence: { charte, densite, taille, disposition, piedVisible, menuMasque, police, palette, cadres, fond, verre, theme },
      }
      // L'image ne part que si elle a change : quelques centaines de Ko a
      // chaque deplacement de curseur seraient un gaspillage.
      if (imageEnvoyee.current !== imageFond) {
        corps.fond_image = imageFond
        imageEnvoyee.current = imageFond
      }
      api.put('/api/auth/preferences', corps).catch(() => {
        /* hors ligne : le navigateur garde le reglage, il repartira au prochain changement */
      })
    }, 1000)
    return () => window.clearTimeout(minuterie)
  }, [charte, densite, taille, disposition, piedVisible, menuMasque, police, palette, cadres, fond, verre, theme, imageFond])

  return null
}
