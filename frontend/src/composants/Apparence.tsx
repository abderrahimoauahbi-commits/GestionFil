/**
 * Les preferences d'apparence, et leur application.
 *
 * LE STYLE (05/10/2026) : cinq chartes au choix, plus des REGLAGES FINS
 * (06/10/2026) sur le modele du panneau de reglage fourni par la direction —
 * palette de couleurs, police, taille, cadres en degrade ou non, image de fond
 * (position, zoom, luminosite, contraste, saturation, flou, voile) et verre des
 * panneaux (transparence, flou, saturation, bordure, rayon).
 *
 * La DENSITE change la hauteur des lignes : sur une tablette de magasin on veut
 * de l'air pour viser au doigt, sur un poste de bureau quarante lignes.
 *
 * LES REGLAGES SUIVENT LE COMPTE (06/10/2026). Ils sont gardes dans le
 * navigateur pour s'appliquer des le premier affichage, ET sur le serveur
 * (`/api/auth/preferences`, voir `SynchroPreferences`) pour qu'on les retrouve
 * a chaque connexion, sur n'importe quel poste. On ne les regle qu'une fois.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type Densite = 'compacte' | 'normale' | 'aeree'
/** Taille de base, en pixels. Tout le reste est en rem et suit. */
export type Taille = 11 | 12 | 13 | 14 | 15 | 16 | 17
/** Ou vit la navigation. */
export type Disposition = 'laterale' | 'entete' | 'mixte'
/** Le style de l'outil : cinq chartes, au choix de chacun (05/10/2026). */
/** Les familles de couleurs de la v1, reprises le 06/10/2026 (sans les familles en verre). */
export type FamilleV1 =
  | 'laiton' | 'industriel' | 'atlas' | 'nordique' | 'terminal' | 'ardoise' | 'graphite'
  | 'slate' | 'divalto' | 'chaud' | 'contraste' | 'claude' | 'azur'
export type Charte = 'classique' | FamilleV1 | 'degrades' | 'full-degrades' | 'sobre' | 'graphite-verre' | 'liquid-glass'
/** La police du texte ; « auto » : celle du style. */
export type Police =
  | 'auto' | 'inter' | 'plus-jakarta' | 'manrope' | 'dm-sans' | 'outfit' | 'sora' | 'lexend' | 'ibm-plex'
  | 'space-grotesk' | 'geist' | 'source-sans' | 'systeme'
/** La couleur d'accent ; « auto » : celle du style. */
export type Palette = 'auto' | 'indigo' | 'cyan' | 'emeraude' | 'or' | 'ardoise' | 'petrole'
/** Les cadres en degrade : selon le style, toujours, jamais. */
export type Cadres = 'auto' | 'degrades' | 'simples'

export interface ReglageFond {
  /** Faux : le fond propre au style. Vrai : l'image et ses reglages. */
  actif: boolean
  position: string
  /** En pour cent, 100 a 250. */
  zoom: number
  luminosite: number
  contraste: number
  saturation: number
  /** En pixels. */
  flou: number
  /** Voile par-dessus l'image, en pour cent (sombre en mode sombre, clair sinon). */
  voile: number
}

/** Les quatre verres de la maquette « verre net » : net, strie, en bandes, coupe. */
export type TypeVerre = 'net' | 'strie' | 'bandes' | 'coupe'

export interface ReglageVerre {
  /** Faux : le verre propre au style. */
  actif: boolean
  type: TypeVerre
  /** Opacite du panneau, en pour cent : 0 tout transparent, 100 plein. */
  transparence: number
  flou: number
  saturation: number
  bordure: number
  bordureOpacite: number
  rayon: number
}

export interface Apparence {
  charte: Charte
  densite: Densite
  taille: Taille
  disposition: Disposition
  /** Une barre de pied portant les raccourcis et l'etat de la base. */
  piedVisible: boolean
  /** La barre laterale glissee hors de l'ecran (bouton de la barre du haut). */
  menuMasque: boolean
  police: Police
  palette: Palette
  cadres: Cadres
  fond: ReglageFond
  verre: ReglageVerre
}

export const FOND_DEFAUT: ReglageFond = {
  actif: false,
  position: 'center',
  zoom: 100,
  luminosite: 100,
  contraste: 100,
  saturation: 100,
  flou: 0,
  voile: 0,
}

export const VERRE_DEFAUT: ReglageVerre = {
  actif: false,
  type: 'net',
  transparence: 55,
  flou: 12,
  saturation: 140,
  bordure: 1,
  bordureOpacite: 12,
  rayon: 16,
}

export const DEFAUT: Apparence = {
  charte: 'classique',
  densite: 'normale',
  taille: 14,
  disposition: 'laterale',
  piedVisible: false,
  menuMasque: false,
  police: 'auto',
  palette: 'auto',
  cadres: 'auto',
  fond: FOND_DEFAUT,
  verre: VERRE_DEFAUT,
}
const CLE = 'gestionfil.apparence'
const CLE_IMAGE = 'gestionfil.fond-image'

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
    nom: 'Barre latérale',
    resume: 'Tout en colonne à gauche. Rend de la hauteur au tableau, prend de la largeur.',
  },
  {
    cle: 'entete',
    nom: 'Barre du haut',
    resume: 'Modules en menus deroulants. Rend toute la largeur, coûte deux clics par écran.',
  },
  {
    cle: 'mixte',
    nom: 'Les deux',
    resume: 'Modules en haut, écrans du module courant à gauche. Un seul clic, mais deux barres.',
  },
]

/**
 * Les cinq styles. Trois viennent des maquettes fournies par la direction le
 * 05/10/2026 (cadres degrades, tout en degrades, version sobre), deux de ses
 * preferences anterieures (graphite et or ancien sur verre ; verre liquide).
 * Les chartes « sombre » ou « claire » par nature ignorent le mode clair/sombre.
 */
export const CHARTES: { cle: Charte; nom: string; resume: string }[] = [
  {
    cle: 'classique',
    nom: 'Classique',
    resume: 'Le style d’origine de Gestion Fil : gris clair, encre et pétrole, filets or ancien, Source Sans. Clair ou sombre.',
  },
  { cle: 'laiton', nom: 'Laiton', resume: 'Gris pierre, encre pétrole et or laiton, barre latérale sombre. Famille de la v1, clair ou sombre.' },
  { cle: 'industriel', nom: 'Industrial Clean', resume: 'Fond clair, bleu franc, beaucoup de blanc. Le choix sur lequel on ne se trompe pas. Famille de la v1, clair ou sombre.' },
  { cle: 'atlas', nom: 'Atlas Data', resume: 'Bleu profond, angles nets, grille stricte. Pour un écran chargé de chiffres. Famille de la v1, clair ou sombre.' },
  { cle: 'nordique', nom: 'Nordic Textile', resume: 'Lin et terre cuite, arrondis généreux. Rappelle la matière. Famille de la v1, clair ou sombre.' },
  { cle: 'terminal', nom: 'Terminal Supply', resume: 'Console sombre, chiffres à chasse fixe, lignes serrées. Famille de la v1, clair ou sombre.' },
  { cle: 'ardoise', nom: 'Ardoise', resume: 'Gris-bleu froid, accent bleu calme. Douce pour une journée entière. Famille de la v1, clair ou sombre.' },
  { cle: 'graphite', nom: 'Graphite', resume: 'Gris neutres, accent bleu vif. Austère, très lisible. Famille de la v1, clair ou sombre.' },
  { cle: 'slate', nom: 'Slate industriel', resume: 'Sombre par nature, dense. Pensée pour les tableaux de chiffres. Famille de la v1, clair ou sombre.' },
  { cle: 'divalto', nom: 'Divalto', resume: 'Bleu profond et accents francs, dans l’esprit des ERP classiques. Famille de la v1, clair ou sombre.' },
  { cle: 'chaud', nom: 'Chaud', resume: 'Gris tirant sur le sable, accent ambre. Moins froid en fin de journée. Famille de la v1, clair ou sombre.' },
  { cle: 'contraste', nom: 'Contraste renforcé', resume: 'Bordures marquées et texte plus noir. Pour un écran d’atelier ou une vue basse. Famille de la v1, clair ou sombre.' },
  { cle: 'claude', nom: 'Claude', resume: 'Crème chaud et terre cuite. Le crème réfléchit moins que le blanc. Famille de la v1, clair ou sombre.' },
  { cle: 'azur', nom: 'Azur', resume: 'Bleu franc sur gris neutres. Une grammaire visuelle que tout le monde connaît. Famille de la v1, clair ou sombre.' },
  {
    cle: 'degrades',
    nom: 'Cadres dégradés',
    resume: 'Bleu nuit et indigo en dégradés, chiffres clés en cartes pleines, tableaux dans un cadre dégradé. Clair ou sombre.',
  },
  {
    cle: 'full-degrades',
    nom: 'Tout en dégradés',
    resume: 'La même famille poussée plus loin : boutons, lignes et cartes en dégradés, relief au survol. Clair seulement.',
  },
  {
    cle: 'sobre',
    nom: 'Cadres dégradés — sobre',
    resume: 'Fond blanc à peine teinté, menu gris pâle, chiffres clés blancs à filet coloré. Clair seulement.',
  },
  {
    cle: 'graphite-verre',
    nom: 'Graphite, verre et or',
    resume: 'Fond graphite aux fils dorés, panneaux en verre sombre, filets or ancien. Sombre seulement.',
  },
  {
    cle: 'liquid-glass',
    nom: 'Verre liquide',
    resume: 'Fond d’ondes de points reliés, verre net, polices fines, libellés en capitales espacées, statuts à point. Clair ou sombre.',
  },
]

export const POLICES: { cle: Police; nom: string; famille?: string }[] = [
  { cle: 'auto', nom: 'Celle du style' },
  { cle: 'inter', nom: 'Inter', famille: '"Inter Variable", Inter, sans-serif' },
  { cle: 'plus-jakarta', nom: 'Plus Jakarta Sans', famille: '"Plus Jakarta Sans Variable", sans-serif' },
  { cle: 'manrope', nom: 'Manrope', famille: '"Manrope Variable", sans-serif' },
  { cle: 'dm-sans', nom: 'DM Sans', famille: '"DM Sans Variable", sans-serif' },
  { cle: 'outfit', nom: 'Outfit', famille: '"Outfit Variable", sans-serif' },
  { cle: 'sora', nom: 'Sora', famille: '"Sora Variable", sans-serif' },
  { cle: 'lexend', nom: 'Lexend', famille: '"Lexend Variable", sans-serif' },
  { cle: 'ibm-plex', nom: 'IBM Plex Sans', famille: '"IBM Plex Sans Variable", sans-serif' },
  { cle: 'space-grotesk', nom: 'Space Grotesk', famille: '"Space Grotesk Variable", "Space Grotesk", sans-serif' },
  { cle: 'geist', nom: 'Geist', famille: '"Geist Variable", Geist, sans-serif' },
  { cle: 'source-sans', nom: 'Source Sans 3', famille: '"Source Sans 3 Variable", "Source Sans 3", sans-serif' },
  { cle: 'systeme', nom: 'Police du système', famille: '"Segoe UI", system-ui, sans-serif' },
]

/** Les palettes : deux teintes, le debut et la fin des degrades. */
export const PALETTES: { cle: Palette; nom: string; teintes?: [string, string] }[] = [
  { cle: 'auto', nom: 'Celle du style' },
  { cle: 'indigo', nom: 'Bleu nuit et indigo', teintes: ['#1E3A8A', '#4F46E5'] },
  { cle: 'cyan', nom: 'Cyan et violet', teintes: ['#0891B2', '#8B5CF6'] },
  { cle: 'emeraude', nom: 'Émeraude', teintes: ['#047857', '#10B981'] },
  { cle: 'or', nom: 'Or ancien', teintes: ['#8A6D2E', '#D4B26B'] },
  { cle: 'ardoise', nom: 'Ardoise', teintes: ['#334155', '#64748B'] },
  { cle: 'petrole', nom: 'Pétrole', teintes: ['#155E75', '#0E9FB0'] },
]

export const TYPES_VERRE: { cle: TypeVerre; nom: string; resume: string }[] = [
  { cle: 'net', nom: 'A · Net', resume: 'Translucide sans flou : le fond reste net derrière, juste assombri.' },
  { cle: 'strie', nom: 'B · Strié', resume: 'Stries verticales fines, comme un verre brossé.' },
  { cle: 'bandes', nom: 'C · Bandes', resume: 'Quatre paliers de lumière, du haut vers le bas, sur un verre flouté.' },
  { cle: 'coupe', nom: 'D · Coupé', resume: 'Deux tons francs coupés en diagonale, sur un verre flouté.' },
]

export const CADRES: { cle: Cadres; nom: string }[] = [
  { cle: 'auto', nom: 'Selon le style' },
  { cle: 'degrades', nom: 'Avec dégradé' },
  { cle: 'simples', nom: 'Sans dégradé' },
]

export const POSITIONS_FOND: { cle: string; nom: string }[] = [
  { cle: 'center', nom: 'Centre' },
  { cle: 'top', nom: 'Haut' },
  { cle: 'bottom', nom: 'Bas' },
  { cle: 'left', nom: 'Gauche' },
  { cle: 'right', nom: 'Droite' },
  { cle: 'top left', nom: 'Haut-gauche' },
  { cle: 'top right', nom: 'Haut-droite' },
  { cle: 'bottom left', nom: 'Bas-gauche' },
  { cle: 'bottom right', nom: 'Bas-droite' },
]

export const TAILLES: { cle: Taille; nom: string }[] = [
  { cle: 11, nom: 'Très petite' },
  { cle: 12, nom: 'Petite' },
  { cle: 13, nom: 'Réduite' },
  { cle: 14, nom: 'Normale' },
  { cle: 15, nom: 'Moyenne' },
  { cle: 16, nom: 'Grande' },
  { cle: 17, nom: 'Très grande' },
]

export const DENSITES: { cle: Densite; nom: string; resume: string }[] = [
  { cle: 'compacte', nom: 'Compacte', resume: 'Le maximum de lignes à l’écran. Poste de bureau.' },
  { cle: 'normale', nom: 'Normale', resume: 'L’equilibre par défaut.' },
  { cle: 'aeree', nom: 'Aeree', resume: 'Lignes hautes, visables au doigt. Tablette de magasin.' },
]

interface Contexte extends Apparence {
  definir: (a: Partial<Apparence>) => void
  /** Remplace tout l'etat d'un coup : reglages relus depuis le serveur. */
  remplacer: (a: Partial<Apparence>) => void
  reinitialiser: () => void
  /** L'image de fond choisie (data URL), ou null : celle du style. */
  imageFond: string | null
  definirImageFond: (dataUrl: string | null) => void
}

const ApparenceContext = createContext<Contexte | null>(null)

const dans = <T,>(liste: { cle: T }[], v: unknown, defaut: T): T =>
  liste.some((x) => x.cle === v) ? (v as T) : defaut

/** Fusionne une preference lue (navigateur ou serveur) avec les valeurs par
 *  defaut : un reglage ajoute plus tard ne doit pas rendre illisible une
 *  preference enregistree avant lui, et une valeur inconnue retombe au defaut. */
export function normaliser(brut: Partial<Apparence> | null | undefined): Apparence {
  const lu = { ...DEFAUT, ...(brut ?? {}) }
  return {
    charte: dans(CHARTES, lu.charte, DEFAUT.charte),
    densite: dans(DENSITES, lu.densite, DEFAUT.densite),
    taille: dans(TAILLES, lu.taille, DEFAUT.taille),
    disposition: dans(DISPOSITIONS, lu.disposition, DEFAUT.disposition),
    piedVisible: !!lu.piedVisible,
    menuMasque: !!lu.menuMasque,
    police: dans(POLICES, lu.police, DEFAUT.police),
    palette: dans(PALETTES, lu.palette, DEFAUT.palette),
    cadres: dans(CADRES, lu.cadres, DEFAUT.cadres),
    fond: { ...FOND_DEFAUT, ...(lu.fond ?? {}) },
    verre: { ...VERRE_DEFAUT, ...(lu.verre ?? {}), type: dans(TYPES_VERRE, lu.verre?.type, VERRE_DEFAUT.type) },
  }
}

function lire(): Apparence {
  try {
    const brut = localStorage.getItem(CLE)
    return normaliser(brut ? (JSON.parse(brut) as Partial<Apparence>) : null)
  } catch {
    return DEFAUT
  }
}

function lireImage(): string | null {
  try {
    return localStorage.getItem(CLE_IMAGE)
  } catch {
    return null
  }
}

export function FournisseurApparence({ children }: { children: ReactNode }) {
  const [etat, setEtat] = useState<Apparence>(lire)
  const [imageFond, setImageFond] = useState<string | null>(lireImage)

  useEffect(() => {
    const r = document.documentElement
    // LA CHARTE PORTE TOUT LE STYLE : couleurs, degrades, verre, relief.
    // Les ecrans ne la connaissent pas ; ils posent des accroches que chaque
    // charte habille (voir `styles/chartes.css`).
    r.setAttribute('data-charte', etat.charte)
    r.setAttribute('data-densite', etat.densite)
    r.setAttribute('data-disposition', etat.disposition)
    r.setAttribute('data-police', etat.police)
    r.setAttribute('data-palette', etat.palette)
    r.setAttribute('data-cadres', etat.cadres)
    r.setAttribute('data-fond', etat.fond.actif ? 'perso' : 'style')
    r.setAttribute('data-verre', etat.verre.actif ? 'perso' : 'style')
    r.setAttribute('data-verre-type', etat.verre.type)
    // LA TAILLE S'APPLIQUE A TOUT (06/10/2026). Elle changeait la taille de
    // base, en rem — mais la plupart des textes de l'interface sont en pixels,
    // et rien ne bougeait. C'est maintenant un ZOOM de toute l'interface :
    // textes, tableaux, marges, icones, sur toutes les pages. 14 px = 100 %.
    r.style.fontSize = '14px'
    r.style.setProperty('--zoom-interface', String(etat.taille / 14))

    const police = POLICES.find((p) => p.cle === etat.police)?.famille
    if (police) r.style.setProperty('--police-choisie', police)
    else r.style.removeProperty('--police-choisie')

    const teintes = PALETTES.find((p) => p.cle === etat.palette)?.teintes
    if (teintes) {
      r.style.setProperty('--pal-1', teintes[0])
      r.style.setProperty('--pal-2', teintes[1])
    } else {
      r.style.removeProperty('--pal-1')
      r.style.removeProperty('--pal-2')
    }

    const f = etat.fond
    r.style.setProperty('--fond-pos', f.position)
    r.style.setProperty('--fond-echelle', String(f.zoom / 100))
    r.style.setProperty('--fond-lum', `${f.luminosite}%`)
    r.style.setProperty('--fond-contraste', `${f.contraste}%`)
    r.style.setProperty('--fond-sat', `${f.saturation}%`)
    r.style.setProperty('--fond-flou', `${f.flou}px`)
    r.style.setProperty('--fond-voile', String(f.voile / 100))

    const v = etat.verre
    r.style.setProperty('--verre-opacite', String(v.transparence / 100))
    r.style.setProperty('--verre-flou', `${v.flou}px`)
    r.style.setProperty('--verre-sat', `${v.saturation}%`)
    r.style.setProperty('--verre-bord', `${v.bordure}px`)
    r.style.setProperty('--verre-bord-op', String(v.bordureOpacite / 100))
    r.style.setProperty('--verre-rayon', `${v.rayon}px`)

    try {
      localStorage.setItem(CLE, JSON.stringify(etat))
    } catch {
      /* navigation privee : le reglage vaut pour la session, sans plus */
    }
  }, [etat])

  useEffect(() => {
    const r = document.documentElement
    if (imageFond) r.style.setProperty('--fond-image', `url("${imageFond}")`)
    else r.style.removeProperty('--fond-image')
    try {
      if (imageFond) localStorage.setItem(CLE_IMAGE, imageFond)
      else localStorage.removeItem(CLE_IMAGE)
    } catch {
      /* image trop lourde pour le navigateur : elle reste sur le serveur */
    }
  }, [imageFond])

  const definir = useCallback((a: Partial<Apparence>) => setEtat((e) => ({ ...e, ...a })), [])
  const remplacer = useCallback((a: Partial<Apparence>) => setEtat(normaliser(a)), [])
  const reinitialiser = useCallback(() => {
    setEtat(DEFAUT)
    setImageFond(null)
  }, [])

  const valeur = useMemo(
    () => ({ ...etat, definir, remplacer, reinitialiser, imageFond, definirImageFond: setImageFond }),
    [etat, definir, remplacer, reinitialiser, imageFond],
  )
  return <ApparenceContext.Provider value={valeur}>{children}</ApparenceContext.Provider>
}

export function useApparence() {
  const c = useContext(ApparenceContext)
  if (!c) throw new Error('useApparence doit etre utilise dans un FournisseurApparence')
  return c
}
