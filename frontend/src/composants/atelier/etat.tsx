/**
 * Etat des onglets de l'atelier.
 *
 * La zone de travail se divise en **groupes** cote a cote (ou l'un au-dessus de
 * l'autre). Chaque groupe porte ses propres onglets et son onglet actif ; un
 * seul groupe a le focus, et c'est le sien qui pilote l'adresse du routeur.
 *
 * Un seul niveau de division, deliberement. Les dispositions imbriquees d'un
 * editeur de code servent a comparer des fichiers ; ici le besoin reel est
 * « le catalogue a gauche, le bon de commande a droite, l'historique des prix
 * au bout » — une rangee suffit, et elle evite un arbre de panneaux que
 * personne ne saurait remettre d'aplomb.
 *
 * Un onglet n'est qu'un chemin : titre et icone sont resolus au rendu par
 * `decrire()`, ce qui evite de serialiser des composants React.
 *
 * Le modele d'apercu est celui de l'editeur : un clic simple ouvre un onglet en
 * italique que le prochain clic simple remplacera ; un double-clic le rend
 * permanent. Sans cela, une session de consultation laisse quinze onglets.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import {
  ClipboardList,
  FileText,
  Package,
  Receipt,
  type LucideIcon,
  ShieldCheck,
  Truck,
} from 'lucide-react'
import { NAVIGATION } from '../Coquille'

export interface Onglet {
  chemin: string
  /** Onglet d'apercu : titre en italique, remplace par le prochain apercu. */
  apercu: boolean
  epingle: boolean
}

export interface Groupe {
  id: string
  onglets: Onglet[]
  actif: string | null
}

export type Orientation = 'colonnes' | 'lignes'

export interface Descripteur {
  titre: string
  /** Second niveau, affiche en infobulle et dans la palette. */
  detail?: string
  Icone: LucideIcon
}

/* -------------------------------------------------------------------------- */
/* Description d'un chemin                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Chemins dynamiques, dans l'ordre d'essai. Le premier motif qui accroche
 * gagne, donc les motifs les plus longs viennent en premier.
 */
const DYNAMIQUES: {
  motif: RegExp
  decrire: (m: RegExpMatchArray) => Descripteur
}[] = [
  {
    motif: /^\/transferts\/([^/]+)\/bon-sortie$/,
    decrire: (m) => ({ titre: `Bon de sortie ${m[1]}`, detail: 'Transfert', Icone: FileText }),
  },
  {
    motif: /^\/transferts\/([^/]+)\/bon-reception$/,
    decrire: (m) => ({ titre: `Bon de reception ${m[1]}`, detail: 'Transfert', Icone: FileText }),
  },
  {
    motif: /^\/transferts\/([^/]+)\/modifier$/,
    decrire: (m) => ({ titre: `Transfert ${m[1]}`, detail: 'Modification', Icone: Truck }),
  },
  {
    motif: /^\/transferts\/nouveau$/,
    decrire: () => ({ titre: 'Nouveau transfert', Icone: Truck }),
  },
  {
    motif: /^\/receptions\/nouvelle$/,
    decrire: () => ({ titre: 'Nouvelle reception', Icone: Package }),
  },
  {
    motif: /^\/receptions\/([^/]+)$/,
    decrire: (m) => ({ titre: `Reception ${m[1]}`, Icone: Package }),
  },
  {
    motif: /^\/bons-commande\/nouveau$/,
    decrire: () => ({ titre: 'Nouveau bon de commande', Icone: Receipt }),
  },
  {
    motif: /^\/bons-commande\/([^/]+)$/,
    decrire: (m) => ({ titre: `BC ${m[1]}`, detail: 'Bon de commande', Icone: Receipt }),
  },
  {
    motif: /^\/utilisateurs\/([^/]+)\/droits$/,
    decrire: (m) => ({ titre: `Droits ${m[1]}`, detail: 'Utilisateur', Icone: ShieldCheck }),
  },
]

/** Titre et icone d'un chemin, qu'il soit statique ou dynamique. */
export function decrire(chemin: string): Descripteur {
  const fixe = NAVIGATION.find((e) => e.vers === chemin)
  if (fixe) return { titre: fixe.libelle, detail: fixe.section, Icone: fixe.Icone }

  for (const d of DYNAMIQUES) {
    const m = chemin.match(d.motif)
    if (m) return d.decrire(m)
  }

  // Chemin inconnu : on retombe sur l'entree de navigation la plus proche pour
  // garder une icone coherente plutot qu'un onglet muet.
  const parent = NAVIGATION.filter((e) => e.vers !== '/' && chemin.startsWith(e.vers)).sort(
    (a, b) => b.vers.length - a.vers.length,
  )[0]
  return { titre: chemin, Icone: parent?.Icone ?? ClipboardList }
}

/* -------------------------------------------------------------------------- */
/* Rangement                                                                   */
/* -------------------------------------------------------------------------- */

const CLE = 'gestionfil.atelier.onglets'

/**
 * Cle de rangement des onglets.
 *
 * Elle porte le compte *et* l'etiquette de fenetre : deux fenetres partagent le
 * meme `localStorage`, et sans la seconde partie chacune ecraserait les onglets
 * de l'autre. `ouvrirFenetre()` s'en sert pour preouvrir les onglets d'une
 * fenetre avant meme qu'elle existe.
 */
export function cleOnglets(compte: string, etiquette: string) {
  return `${CLE}.${compte}.${etiquette}`
}

interface Persiste {
  groupes: Groupe[]
  focus: string
  orientation: Orientation
  /** Fractions de la zone de travail, une par groupe, de somme 1. */
  tailles: number[]
}

const VIDE: Persiste = {
  groupes: [{ id: 'g1', onglets: [], actif: null }],
  focus: 'g1',
  orientation: 'colonnes',
  tailles: [1],
}

let compteur = 0
const nouvelId = () => `g${Date.now().toString(36)}${(compteur++).toString(36)}`

/** Repartition egale : un fractionnement remet les parts a plat. */
function repartir(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n)
}

/** Normalise ce qui vient du stockage, y compris l'ancien format sans groupes. */
function normaliser(brut: unknown): Persiste {
  const p = brut as Partial<Persiste> & { onglets?: Onglet[]; actif?: string | null }

  // Format anterieur au fractionnement : une liste plate d'onglets. Migre sans
  // rien perdre, sinon la premiere ouverture apres mise a jour repartirait de
  // zero pour tous les utilisateurs.
  if (Array.isArray(p?.onglets)) {
    return {
      groupes: [{ id: 'g1', onglets: p.onglets, actif: p.actif ?? null }],
      focus: 'g1',
      orientation: 'colonnes',
      tailles: [1],
    }
  }

  if (!Array.isArray(p?.groupes) || p.groupes.length === 0) return VIDE

  const groupes = p.groupes.filter(
    (g) => g && typeof g.id === 'string' && Array.isArray(g.onglets),
  )
  if (!groupes.length) return VIDE

  const tailles =
    Array.isArray(p.tailles) && p.tailles.length === groupes.length
      ? p.tailles
      : repartir(groupes.length)

  return {
    groupes,
    focus: groupes.some((g) => g.id === p.focus) ? (p.focus as string) : groupes[0].id,
    orientation: p.orientation === 'lignes' ? 'lignes' : 'colonnes',
    tailles,
  }
}

function charger(cle: string): Persiste {
  try {
    const brut = localStorage.getItem(cle)
    return brut ? normaliser(JSON.parse(brut)) : VIDE
  } catch {
    return VIDE
  }
}

/* -------------------------------------------------------------------------- */
/* Contexte                                                                    */
/* -------------------------------------------------------------------------- */

interface Contexte {
  groupes: Groupe[]
  focus: string
  orientation: Orientation
  tailles: number[]
  /** Onglet actif du groupe qui a le focus. */
  actif: string | null

  ouvrir: (chemin: string, options?: { apercu?: boolean; groupe?: string }) => void
  fixer: (chemin: string, groupe?: string) => void
  fermer: (chemin: string, groupe?: string) => void
  fermerAutres: (chemin: string, groupe?: string) => void
  fermerADroite: (chemin: string, groupe?: string) => void
  fermerTous: (groupe?: string) => void
  basculerEpingle: (chemin: string, groupe?: string) => void
  deplacer: (de: string, vers: string, groupe: string) => void
  decaler: (pas: 1 | -1) => void

  focaliser: (groupe: string) => void
  fractionner: () => void
  fermerGroupe: (groupe: string) => void
  deplacerVersGroupe: (chemin: string, source: string, cible: string) => void
  basculerOrientation: () => void
  definirTailles: (t: number[]) => void
}

const OngletsContext = createContext<Contexte | null>(null)

/** Part minimale d'un groupe : en deca, il ne montre plus rien d'exploitable. */
export const PART_MINIMALE = 0.12

/** Au-dela, chaque groupe devient trop etroit pour un tableau de gestion. */
const GROUPES_MAX = 4

export function FournisseurOnglets({
  compte,
  etiquette,
  chemin,
  naviguer,
  children,
}: {
  /** Login de l'utilisateur : les onglets ne se partagent pas entre comptes. */
  compte: string
  /** Etiquette de la fenetre : ni entre fenetres. */
  etiquette: string
  /** Chemin courant du routeur. */
  chemin: string
  naviguer: (chemin: string) => void
  children: ReactNode
}) {
  const cle = cleOnglets(compte, etiquette)
  const [etat, setEtat] = useState<Persiste>(() => charger(cle))

  /* Onglet actif au moment de la restauration, capture au premier rendu : il
     prime sur le chemin d'ouverture, sinon rouvrir la fenetre ramenerait
     toujours au cockpit en perdant l'onglet sur lequel on avait quitte. */
  const actifRestaure = useRef(
    (etat.groupes.find((g) => g.id === etat.focus) ?? etat.groupes[0])?.actif ?? null,
  )
  const premierRendu = useRef(true)

  useEffect(() => {
    localStorage.setItem(cle, JSON.stringify(etat))
  }, [etat, cle])

  /** Applique une transformation au groupe designe, celui du focus par defaut. */
  const surGroupe = useCallback(
    (id: string | undefined, f: (g: Groupe) => Groupe) =>
      setEtat((e) => {
        const cible = id ?? e.focus
        return { ...e, groupes: e.groupes.map((g) => (g.id === cible ? f(g) : g)) }
      }),
    [],
  )

  /* --- Ouverture ---------------------------------------------------------- */

  const ouvrir = useCallback((c: string, options?: { apercu?: boolean; groupe?: string }) => {
    const apercu = options?.apercu ?? false
    setEtat((e) => {
      const cible = options?.groupe ?? e.focus
      const groupes = e.groupes.map((g) => {
        if (g.id !== cible) return g

        const existant = g.onglets.find((o) => o.chemin === c)
        if (existant) {
          // Ouvrir en permanent un onglet deja en apercu le fixe.
          const onglets = apercu
            ? g.onglets
            : g.onglets.map((o) => (o.chemin === c ? { ...o, apercu: false } : o))
          return { ...g, onglets, actif: c }
        }

        const nouveau: Onglet = { chemin: c, apercu, epingle: false }
        if (!apercu) return { ...g, onglets: [...g.onglets, nouveau], actif: c }

        // Un seul onglet d'apercu a la fois : il prend la place du precedent.
        const i = g.onglets.findIndex((o) => o.apercu && !o.epingle)
        if (i === -1) return { ...g, onglets: [...g.onglets, nouveau], actif: c }
        const onglets = [...g.onglets]
        onglets[i] = nouveau
        return { ...g, onglets, actif: c }
      })
      return { ...e, groupes, focus: cible }
    })
  }, [])

  const fixer = useCallback(
    (c: string, groupe?: string) =>
      surGroupe(groupe, (g) => ({
        ...g,
        onglets: g.onglets.map((o) => (o.chemin === c ? { ...o, apercu: false } : o)),
      })),
    [surGroupe],
  )

  /* --- Fermeture ----------------------------------------------------------
     Le successeur est l'onglet de droite, a defaut celui de gauche : la regle
     de l'editeur, celle qui surprend le moins. Un groupe vide se referme, sauf
     s'il ne reste que lui — la zone de travail garde toujours un groupe, qui
     affiche alors l'accueil. */

  const retirer = useCallback(
    (groupe: string | undefined, garde: (o: Onglet) => boolean) =>
      setEtat((e) => {
        const cible = groupe ?? e.focus
        const groupes = e.groupes.map((g) => {
          if (g.id !== cible) return g
          const onglets = g.onglets.filter(garde)
          if (onglets.length === g.onglets.length) return g
          if (g.actif && onglets.some((o) => o.chemin === g.actif)) return { ...g, onglets }

          const i = g.onglets.findIndex((o) => o.chemin === g.actif)
          const successeur =
            g.onglets.slice(i + 1).find((o) => onglets.includes(o)) ??
            [...g.onglets.slice(0, i)].reverse().find((o) => onglets.includes(o))
          return { ...g, onglets, actif: successeur?.chemin ?? null }
        })

        const restants = groupes.filter((g) => g.onglets.length > 0)
        if (restants.length === 0 || restants.length === groupes.length) {
          return { ...e, groupes }
        }
        return {
          ...e,
          groupes: restants,
          focus: restants.some((g) => g.id === e.focus) ? e.focus : restants[0].id,
          tailles: repartir(restants.length),
        }
      }),
    [],
  )

  /* Fermeture explicite : elle emporte aussi un onglet epingle, puisque
     l'utilisateur l'a designe. Seules les fermetures en masse le respectent. */
  const fermer = useCallback(
    (c: string, groupe?: string) => retirer(groupe, (o) => o.chemin !== c),
    [retirer],
  )
  const fermerAutres = useCallback(
    (c: string, groupe?: string) => retirer(groupe, (o) => o.chemin === c || o.epingle),
    [retirer],
  )
  const fermerTous = useCallback(
    (groupe?: string) => retirer(groupe, (o) => o.epingle),
    [retirer],
  )

  const fermerADroite = useCallback(
    (c: string, groupe?: string) =>
      surGroupe(groupe, (g) => {
        const i = g.onglets.findIndex((o) => o.chemin === c)
        if (i === -1) return g
        const onglets = g.onglets.filter((o, j) => j <= i || o.epingle)
        return { ...g, onglets, actif: onglets.some((o) => o.chemin === g.actif) ? g.actif : c }
      }),
    [surGroupe],
  )

  /** Epingler deplace l'onglet en tete, apres les autres epingles. */
  const basculerEpingle = useCallback(
    (c: string, groupe?: string) =>
      surGroupe(groupe, (g) => {
        const cible = g.onglets.find((o) => o.chemin === c)
        if (!cible) return g
        const bascule = { ...cible, epingle: !cible.epingle, apercu: false }
        const reste = g.onglets.filter((o) => o.chemin !== c)
        reste.splice(reste.filter((o) => o.epingle).length, 0, bascule)
        return { ...g, onglets: reste }
      }),
    [surGroupe],
  )

  const deplacer = useCallback(
    (de: string, vers: string, groupe: string) =>
      surGroupe(groupe, (g) => {
        const i = g.onglets.findIndex((o) => o.chemin === de)
        const j = g.onglets.findIndex((o) => o.chemin === vers)
        if (i === -1 || j === -1 || i === j) return g
        const onglets = [...g.onglets]
        const [tire] = onglets.splice(i, 1)
        onglets.splice(j, 0, tire)
        return { ...g, onglets }
      }),
    [surGroupe],
  )

  const decaler = useCallback((pas: 1 | -1) => {
    setEtat((e) => {
      const g = e.groupes.find((x) => x.id === e.focus)
      if (!g || g.onglets.length < 2) return e
      const i = g.onglets.findIndex((o) => o.chemin === g.actif)
      const j = (i + pas + g.onglets.length) % g.onglets.length
      return {
        ...e,
        groupes: e.groupes.map((x) => (x.id === g.id ? { ...x, actif: g.onglets[j].chemin } : x)),
      }
    })
  }, [])

  /* --- Groupes ------------------------------------------------------------ */

  const focaliser = useCallback(
    (groupe: string) => setEtat((e) => (e.focus === groupe ? e : { ...e, focus: groupe })),
    [],
  )

  /**
   * Fractionne : cree un groupe a droite (ou en dessous) portant une copie de
   * l'onglet actif, comme le fait un editeur. Le meme ecran s'affiche alors des
   * deux cotes, et il suffit d'en changer un pour obtenir la comparaison
   * voulue — catalogue a gauche, bon de commande a droite.
   */
  const fractionner = useCallback(() => {
    setEtat((e) => {
      if (e.groupes.length >= GROUPES_MAX) return e
      const i = e.groupes.findIndex((g) => g.id === e.focus)
      const source = e.groupes[i]
      if (!source?.actif) return e

      const nouveau: Groupe = {
        id: nouvelId(),
        onglets: [{ chemin: source.actif, apercu: false, epingle: false }],
        actif: source.actif,
      }
      const groupes = [...e.groupes]
      groupes.splice(i + 1, 0, nouveau)
      return { ...e, groupes, focus: nouveau.id, tailles: repartir(groupes.length) }
    })
  }, [])

  const fermerGroupe = useCallback((groupe: string) => {
    setEtat((e) => {
      if (e.groupes.length < 2) return e
      const groupes = e.groupes.filter((g) => g.id !== groupe)
      return {
        ...e,
        groupes,
        focus: groupes.some((g) => g.id === e.focus) ? e.focus : groupes[0].id,
        tailles: repartir(groupes.length),
      }
    })
  }, [])

  const deplacerVersGroupe = useCallback((c: string, source: string, cible: string) => {
    setEtat((e) => {
      if (source === cible) return e
      const onglet = e.groupes.find((g) => g.id === source)?.onglets.find((o) => o.chemin === c)
      if (!onglet) return e

      let groupes = e.groupes.map((g) => {
        if (g.id === source) {
          const onglets = g.onglets.filter((o) => o.chemin !== c)
          return {
            ...g,
            onglets,
            actif: g.actif === c ? (onglets[onglets.length - 1]?.chemin ?? null) : g.actif,
          }
        }
        if (g.id === cible) {
          const deja = g.onglets.some((o) => o.chemin === c)
          return {
            ...g,
            onglets: deja ? g.onglets : [...g.onglets, { ...onglet, apercu: false }],
            actif: c,
          }
        }
        return g
      })

      // Le groupe d'origine vide se referme, sauf s'il est le dernier.
      const restants = groupes.filter((g) => g.onglets.length > 0)
      const tailles = restants.length !== groupes.length ? repartir(restants.length) : e.tailles
      if (restants.length > 0) groupes = restants

      return { ...e, groupes, focus: cible, tailles }
    })
  }, [])

  const basculerOrientation = useCallback(
    () =>
      setEtat((e) => ({
        ...e,
        orientation: e.orientation === 'colonnes' ? 'lignes' : 'colonnes',
      })),
    [],
  )

  const definirTailles = useCallback((t: number[]) => setEtat((e) => ({ ...e, tailles: t })), [])

  /* --- Synchronisation avec le routeur ----------------------------------- */

  const focusActif = etat.groupes.find((g) => g.id === etat.focus)?.actif ?? null

  /* Le routeur mene : toute navigation ouvre ou active l'onglet correspondant
     dans le groupe qui a le focus. En apercu, parce qu'une navigation par lien
     n'est pas un engagement. */
  const dernierChemin = useRef<string | null>(null)
  useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false
      if (actifRestaure.current) {
        dernierChemin.current = actifRestaure.current
        return
      }
    }
    if (dernierChemin.current === chemin) return
    dernierChemin.current = chemin
    ouvrir(chemin, { apercu: true })
  }, [chemin, ouvrir])

  /* ... et reciproquement : changer d'onglet ou de groupe actif navigue. */
  useEffect(() => {
    if (focusActif && focusActif !== chemin) {
      dernierChemin.current = focusActif
      naviguer(focusActif)
      return
    }
    const vide = etat.groupes.every((g) => g.onglets.length === 0)
    if (!focusActif && vide && chemin !== '/') {
      dernierChemin.current = '/'
      naviguer('/')
    }
  }, [focusActif, etat.groupes, chemin, naviguer])

  const valeur = useMemo<Contexte>(
    () => ({
      groupes: etat.groupes,
      focus: etat.focus,
      orientation: etat.orientation,
      tailles: etat.tailles,
      actif: focusActif,
      ouvrir,
      fixer,
      fermer,
      fermerAutres,
      fermerADroite,
      fermerTous,
      basculerEpingle,
      deplacer,
      decaler,
      focaliser,
      fractionner,
      fermerGroupe,
      deplacerVersGroupe,
      basculerOrientation,
      definirTailles,
    }),
    [
      etat.groupes,
      etat.focus,
      etat.orientation,
      etat.tailles,
      focusActif,
      ouvrir,
      fixer,
      fermer,
      fermerAutres,
      fermerADroite,
      fermerTous,
      basculerEpingle,
      deplacer,
      decaler,
      focaliser,
      fractionner,
      fermerGroupe,
      deplacerVersGroupe,
      basculerOrientation,
      definirTailles,
    ],
  )

  return <OngletsContext.Provider value={valeur}>{children}</OngletsContext.Provider>
}

export function useOnglets() {
  const c = useContext(OngletsContext)
  if (!c) throw new Error('useOnglets doit etre utilise dans un FournisseurOnglets')
  return c
}
