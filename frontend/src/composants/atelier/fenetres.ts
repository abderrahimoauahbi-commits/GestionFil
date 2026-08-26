/**
 * Palettes et fenetres de l'atelier.
 *
 * Deux sujets qui n'ont en commun que d'etre propres a l'enveloppe de bureau :
 * le choix de la famille de couleurs, et la gestion du multifenetrage.
 */
import { useCallback, useEffect, useState } from 'react'
import { cleOnglets, type Onglet } from './etat'

/* -------------------------------------------------------------------------- */
/* Palettes                                                                    */
/* -------------------------------------------------------------------------- */

export type Famille =
  | 'ardoise'
  | 'slate'
  | 'divalto'
  | 'graphite'
  | 'chaud'
  | 'contraste'

export const FAMILLES: { id: Famille; libelle: string; description: string }[] = [
  {
    id: 'ardoise',
    libelle: 'Ardoise',
    description: 'Gris-bleu doux, accent bleu. Recommandee pour une journee entiere.',
  },
  {
    id: 'slate',
    libelle: 'Industrial Slate',
    description: 'Slate 950/900/800, accents Blue, Red, Amber, Emerald. Par defaut.',
  },
  {
    id: 'divalto',
    libelle: 'Divalto',
    description: 'Zone de travail blanche, chrome bleu. Le classique des ERP de gestion.',
  },
  {
    id: 'graphite',
    libelle: 'Graphite',
    description: "Gris neutres facon editeur de code. Austere et familiere.",
  },
  {
    id: 'chaud',
    libelle: 'Atelier',
    description: 'Neutres chauds, accent vert. Reposante en fin de journee.',
  },
  {
    id: 'contraste',
    libelle: 'Contraste',
    description: 'Contraste maximal, bordures franches. Pour un poste en bord de ligne.',
  },
]

const CLE_FAMILLE = 'gestionfil.atelier.palette'

/**
 * Famille de couleurs courante. Elle se combine au reglage clair / sombre :
 * la famille dit quelle teinte, le mode dit quelle luminosite.
 */
export function usePalette() {
  const [famille, setFamille] = useState<Famille>(() => {
    const v = localStorage.getItem(CLE_FAMILLE) as Famille | null
    // Industrial Slate par defaut sur le poste de bureau : c'est le choix
    // arrete pour un ecran regarde huit heures par jour.
    return v && FAMILLES.some((f) => f.id === v) ? v : 'slate'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-palette', famille)
    return () => document.documentElement.removeAttribute('data-palette')
  }, [famille])

  const definir = useCallback((f: Famille) => {
    localStorage.setItem(CLE_FAMILLE, f)
    setFamille(f)
  }, [])

  return { famille, definir }
}

/* -------------------------------------------------------------------------- */
/* Fenetres                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Etiquette de la fenetre courante, lue en synchrone.
 *
 * Elle sert de cle de rangement pour les onglets : deux fenetres partagent le
 * meme `localStorage`, et sans cette separation la seconde ecraserait les
 * onglets de la premiere a chaque changement.
 */
export function etiquetteFenetre(): string {
  const internals = (globalThis as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } })
    .__TAURI_INTERNALS__
  return internals?.metadata?.currentWindow?.label ?? 'main'
}

/** Les fenetres supplementaires portent ce prefixe, declare dans la capability. */
const PREFIXE = 'atelier-'

/**
 * Ouvre une fenetre d'atelier.
 *
 * Les onglets de la nouvelle fenetre sont **ecrits avant sa creation** : elle
 * les lit a son demarrage comme n'importe quelle session restauree. C'est plus
 * sur que de passer le chemin dans l'URL, qui differe entre le serveur de
 * developpement et l'application empaquetee.
 */
export async function ouvrirFenetre(options: {
  compte: string
  /** Onglets a preouvrir. Vide : la fenetre s'ouvre sur l'ecran d'accueil. */
  onglets?: string[]
  titre?: string
}): Promise<boolean> {
  const etiquette = `${PREFIXE}${Date.now().toString(36)}`

  if (options.onglets?.length) {
    const onglets: Onglet[] = options.onglets.map((chemin) => ({
      chemin,
      apercu: false,
      epingle: false,
    }))
    localStorage.setItem(
      cleOnglets(options.compte, etiquette),
      JSON.stringify({ onglets, actif: onglets[onglets.length - 1].chemin }),
    )
  }

  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const fenetre = new WebviewWindow(etiquette, {
      url: '/',
      title: options.titre ?? 'Gestion Fil',
      width: 1280,
      height: 820,
      minWidth: 900,
      minHeight: 600,
      decorations: false,
      shadow: true,
      center: true,
    })

    return await new Promise<boolean>((resoudre) => {
      // `once` renvoie une promesse de desabonnement : les deux issues sont
      // ecoutees, sinon un echec de creation resterait suspendu.
      void fenetre.once('tauri://created', () => resoudre(true))
      void fenetre.once('tauri://error', () => resoudre(false))
      window.setTimeout(() => resoudre(false), 5000)
    })
  } catch {
    return false
  }
}
