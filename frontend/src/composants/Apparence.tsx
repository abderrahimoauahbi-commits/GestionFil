/**
 * Les preferences d'apparence, et leur application.
 *
 * UN SEUL STYLE DEPUIS LE 02/10/2026. Les familles de couleurs et le choix de
 * police sont retires : l'outil a une apparence, claire ou sombre (voir
 * `Theme.tsx`). Restent les reglages qui servent le POSTE, pas le gout.
 *
 * La DENSITE change la hauteur des lignes. Sur une tablette de magasin on veut
 * de l'air pour viser au doigt ; sur un poste de bureau on veut voir quarante
 * lignes sans defiler. Le meme reglage ne convient pas aux deux.
 *
 * Le MENU se replie ou se fige. Replie, il rend deux cents pixels au tableau et
 * s'ouvre au survol ; fige, il reste ouvert. Le choix depend de la largeur de
 * l'ecran, pas d'un gout — et c'est pourquoi il est reglable plutot que decide.
 *
 * TOUT EST GARDE DANS LE NAVIGATEUR, par poste. Deux personnes qui partagent un
 * compte sur deux machines gardent chacune son reglage ; le serveur n'en sait
 * rien et n'a pas a en savoir.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type Densite = 'compacte' | 'normale' | 'aeree'
/** Taille de base, en pixels. Tout le reste est en rem et suit. */
export type Taille = 13 | 14 | 15 | 16 | 17
/** Ou vit la navigation. */
export type Disposition = 'laterale' | 'entete' | 'mixte'

export interface Apparence {
  densite: Densite
  taille: Taille
  disposition: Disposition
  /** Une barre de pied portant les raccourcis et l'etat de la base. */
  piedVisible: boolean
  /** Le menu lateral reste ouvert au lieu de se replier. */
  menuFige: boolean
}

const DEFAUT: Apparence = {
  densite: 'normale',
  taille: 14,
  disposition: 'laterale',
  piedVisible: false,
  menuFige: false,
}
const CLE = 'gestionfil.apparence'

/**
 * Les trois dispositions, et ce que chacune coute.
 *
 * Il n'y a pas de meilleure reponse : cela depend de la forme de l'ecran. Un
 * 16/9 large a de la place a gauche et pas en hauteur ; un ecran de portable
 * a l'inverse. C'est pourquoi c'est un reglage.
 */
export const DISPOSITIONS: { cle: Disposition; nom: string; resume: string }[] = [
  {
    cle: 'laterale',
    nom: 'Barre laterale',
    resume: 'Tout en colonne a gauche. Rend de la hauteur au tableau, prend de la largeur.',
  },
  {
    cle: 'entete',
    nom: 'Barre du haut',
    resume: 'Modules en menus deroulants. Rend toute la largeur, coute deux clics par ecran.',
  },
  {
    cle: 'mixte',
    nom: 'Les deux',
    resume: 'Modules en haut, ecrans du module courant a gauche. Un seul clic, mais deux barres.',
  },
]

export const TAILLES: { cle: Taille; nom: string }[] = [
  { cle: 13, nom: 'Petite' },
  { cle: 14, nom: 'Normale' },
  { cle: 15, nom: 'Moyenne' },
  { cle: 16, nom: 'Grande' },
  { cle: 17, nom: 'Tres grande' },
]

export const DENSITES: { cle: Densite; nom: string; resume: string }[] = [
  { cle: 'compacte', nom: 'Compacte', resume: 'Le maximum de lignes a l ecran. Poste de bureau.' },
  { cle: 'normale', nom: 'Normale', resume: 'L equilibre par defaut.' },
  { cle: 'aeree', nom: 'Aeree', resume: 'Lignes hautes, visables au doigt. Tablette de magasin.' },
]

interface Contexte extends Apparence {
  definir: (a: Partial<Apparence>) => void
  reinitialiser: () => void
}

const ApparenceContext = createContext<Contexte | null>(null)

function lire(): Apparence {
  try {
    const brut = localStorage.getItem(CLE)
    if (!brut) return DEFAUT
    // Fusion avec le defaut : un reglage ajoute plus tard ne doit pas rendre
    // illisible une preference enregistree avant lui.
    const lu = { ...DEFAUT, ...(JSON.parse(brut) as Partial<Apparence>) }
    // Les anciens reglages de famille et de police restent dans le navigateur
    // sans effet ; on ne garde que ce qui existe encore.
    return {
      densite: lu.densite,
      taille: lu.taille,
      disposition: lu.disposition,
      piedVisible: lu.piedVisible,
      menuFige: lu.menuFige,
    }
  } catch {
    return DEFAUT
  }
}

export function FournisseurApparence({ children }: { children: ReactNode }) {
  const [etat, setEtat] = useState<Apparence>(lire)

  useEffect(() => {
    const r = document.documentElement
    r.removeAttribute('data-palette')
    r.setAttribute('data-densite', etat.densite)
    r.setAttribute('data-disposition', etat.disposition)
    // La taille de base commande tout le reste : les tailles de l'interface
    // sont en rem, elles suivent sans qu'on y touche.
    r.style.fontSize = `${etat.taille}px`
    try {
      localStorage.setItem(CLE, JSON.stringify(etat))
    } catch {
      /* navigation privee : le reglage vaut pour la session, sans plus */
    }
  }, [etat])

  const definir = useCallback((a: Partial<Apparence>) => setEtat((e) => ({ ...e, ...a })), [])
  const reinitialiser = useCallback(() => setEtat(DEFAUT), [])

  const valeur = useMemo(() => ({ ...etat, definir, reinitialiser }), [etat, definir, reinitialiser])
  return <ApparenceContext.Provider value={valeur}>{children}</ApparenceContext.Provider>
}

export function useApparence() {
  const c = useContext(ApparenceContext)
  if (!c) throw new Error('useApparence doit etre utilise dans un FournisseurApparence')
  return c
}
