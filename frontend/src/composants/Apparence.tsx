/**
 * Les preferences d'apparence, et leur application.
 *
 * QUATRE REGLAGES, ET AUCUN N'EST DECORATIF.
 *
 * La FAMILLE de couleurs et le MODE clair/sombre se combinent : la famille dit
 * quelle teinte, le mode quelle luminosite. Les separer permet de garder sa
 * famille en passant du bureau eclaire du matin a l'atelier du soir.
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

// Les familles de couleurs vivent dans la feuille de l'atelier, mais servent
// desormais partout : elle est donc importee ICI, par le fournisseur qui est
// toujours monte. La laisser au seul atelier faisait que le navigateur ne la
// chargeait jamais — le reglage existait, sans effet.
import './atelier/palettes.css'

export type Palette =
  | 'ardoise' | 'graphite' | 'slate' | 'divalto' | 'chaud' | 'contraste'
  | 'glassier' | 'claude' | 'azur'
export type Densite = 'compacte' | 'normale' | 'aeree'
export type Police = 'systeme' | 'inter' | 'geometrique' | 'serif' | 'lisible'
/** Taille de base, en pixels. Tout le reste est en rem et suit. */
export type Taille = 13 | 14 | 15 | 16 | 17
/** Ou vit la navigation. */
export type Disposition = 'laterale' | 'entete' | 'mixte'

export interface Apparence {
  palette: Palette
  densite: Densite
  police: Police
  taille: Taille
  disposition: Disposition
  /** Une barre de pied portant les raccourcis et l'etat de la base. */
  piedVisible: boolean
  /** Le menu lateral reste ouvert au lieu de se replier. */
  menuFige: boolean
}

const DEFAUT: Apparence = {
  palette: 'ardoise',
  densite: 'normale',
  police: 'systeme',
  taille: 14,
  disposition: 'laterale',
  piedVisible: false,
  menuFige: false,
}
const CLE = 'gestionfil.apparence'

export const PALETTES: { cle: Palette; nom: string; resume: string; teintes: string[] }[] = [
  {
    cle: 'ardoise',
    nom: 'Ardoise',
    resume: 'Gris-bleu froid, accent bleu calme. Douce pour une journee entiere.',
    teintes: ['#F5F7FA', '#1F6FEB', '#2E3A4A'],
  },
  {
    cle: 'graphite',
    nom: 'Graphite',
    resume: 'Gris neutres, accent bleu vif. Austere, tres lisible.',
    teintes: ['#F4F4F5', '#2563EB', '#27272A'],
  },
  {
    cle: 'slate',
    nom: 'Slate industriel',
    resume: 'Sombre par nature, dense. Pensee pour les tableaux de chiffres.',
    teintes: ['#0F172A', '#38BDF8', '#1E293B'],
  },
  {
    cle: 'divalto',
    nom: 'Divalto',
    resume: 'Bleu profond et accents francs, dans l esprit des ERP classiques.',
    teintes: ['#EEF2F7', '#0B5FAF', '#123A5E'],
  },
  {
    cle: 'chaud',
    nom: 'Chaud',
    resume: 'Gris tirant sur le sable, accent ambre. Moins froid en fin de journee.',
    teintes: ['#FAF7F2', '#B45309', '#3B342C'],
  },
  {
    cle: 'contraste',
    nom: 'Contraste renforce',
    resume: 'Bordures marquees et texte plus noir. Pour un ecran d atelier ou une vue basse.',
    teintes: ['#FFFFFF', '#0033AA', '#000000'],
  },
  {
    cle: 'glassier',
    nom: 'Verre liquide',
    resume: 'Nappe de couleurs saturees, surfaces refractantes a bord lumineux. Les tableaux gardent un verre ferme pour que les chiffres restent nets.',
    teintes: ['#A78BFA', '#22D3EE', '#7C3AED'],
  },
  {
    cle: 'claude',
    nom: 'Claude',
    resume: 'Creme chaud et terre cuite. Le creme reflechit moins que le blanc sous un neon d atelier.',
    teintes: ['#F5F4EE', '#D97757', '#2B2823'],
  },
  {
    cle: 'azur',
    nom: 'Azur',
    resume: 'Bleu franc sur gris neutres. La grammaire visuelle que tout le monde a deja pratiquee.',
    teintes: ['#F8F9FA', '#1A73E8', '#202124'],
  },
]

/**
 * Les familles de caracteres proposees.
 *
 * AUCUNE N'EST TELECHARGEE. Toutes reposent sur ce que la machine possede
 * deja : une police distante ajoute une attente au premier affichage, et
 * l'ERP tourne sur un reseau d'usine ou elle n'arriverait pas toujours.
 *
 * Le CHIFFRE compte plus que la lettre dans cet outil. Les cinq choix gardent
 * donc tous des chiffres a chasse fixe pour que les colonnes s'alignent — ce
 * qui les separe, c'est la lisibilite du texte autour.
 */
export const POLICES: { cle: Police; nom: string; resume: string; pile: string }[] = [
  {
    cle: 'systeme',
    nom: 'Systeme',
    resume: 'Celle de Windows. Nette a toute taille, aucune attente au chargement.',
    pile: '"Segoe UI", system-ui, -apple-system, sans-serif',
  },
  {
    cle: 'inter',
    nom: 'Inter',
    resume: 'Dessinee pour les interfaces denses. Le defaut precedent.',
    pile: '"Inter", "Segoe UI", system-ui, sans-serif',
  },
  {
    cle: 'geometrique',
    nom: 'Geometrique',
    resume: 'Formes rondes et ouvertes. Plus douce, un peu plus large.',
    pile: '"Century Gothic", "Futura", "Trebuchet MS", system-ui, sans-serif',
  },
  {
    cle: 'serif',
    nom: 'Serif',
    resume: 'Empattements. Reposante sur un long texte, moins sur un tableau.',
    pile: 'Georgia, "Times New Roman", serif',
  },
  {
    cle: 'lisible',
    nom: 'Haute lisibilite',
    resume: 'Lettres tres differenciees, utile en cas de vue basse ou d ecran d atelier.',
    pile: 'Verdana, Tahoma, "DejaVu Sans", sans-serif',
  },
]

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
    return { ...DEFAUT, ...(JSON.parse(brut) as Partial<Apparence>) }
  } catch {
    return DEFAUT
  }
}

export function FournisseurApparence({ children }: { children: ReactNode }) {
  const [etat, setEtat] = useState<Apparence>(lire)

  useEffect(() => {
    const r = document.documentElement
    r.setAttribute('data-palette', etat.palette)
    r.setAttribute('data-densite', etat.densite)
    r.setAttribute('data-disposition', etat.disposition)
    // La pile est posee en variable plutot qu'en classe : les feuilles de style
    // la lisent deja sous ce nom, rien d'autre n'a a changer.
    r.style.setProperty(
      '--font-sans',
      POLICES.find((p) => p.cle === etat.police)?.pile ?? POLICES[0].pile,
    )
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
