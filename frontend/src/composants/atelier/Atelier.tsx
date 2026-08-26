/**
 * Coquille d'atelier — application de bureau uniquement.
 *
 * Disposition de VS Code : barre de titre integree, barre d'activites, panneau
 * lateral redimensionnable, onglets de documents, panneau inferieur, barre
 * d'etat.
 *
 * Le choix structurant est que **tous les onglets ouverts restent montes**, et
 * que seul l'onglet actif est visible. C'est ce qui donne le comportement
 * attendu d'un editeur : revenir sur un onglet retrouve son defilement, ses
 * filtres et son formulaire a moitie rempli. Chaque onglet rend son propre
 * `<Routes location=...>`, si bien que `useParams()` continue de fonctionner a
 * l'interieur des pages sans qu'aucune d'elles ait a etre modifiee.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Routes, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { useTheme } from '../Theme'
import { estAccessible, MODULES, NAVIGATION, type Section } from '../Coquille'
import { Infobulle } from '../ui/surcouches'
import { cn } from '../../lib/utils'
import { BarreTitre, type MenuBarre } from './BarreTitre'
import { BarreActivites, type Controle } from './Lateral'
import { FilAriane } from './FilAriane'
import { BarreEtat } from './BarreEtat'
import { Onglets } from './Onglets'
import { PanneauBas, type OngletBas } from './PanneauBas'
import { Palette, type Entree } from './Palette'
import { decrire, FournisseurOnglets, PART_MINIMALE, useOnglets } from './etat'
import { etiquetteFenetre, FAMILLES, ouvrirFenetre, usePalette } from './fenetres'
import './atelier.css'
import './palettes.css'

const VERSION = '0.1.0'

/** Barre oblique inversee : touche du fractionnement, comme dans l'editeur. */
const BARRE = String.fromCharCode(92)

/* Bornes de redimensionnement. En deca, un panneau ne montre plus rien
   d'utilisable ; au dela, il mange la zone de travail. */
const LAT_MIN = 170
const LAT_MAX = 520
const BAS_MIN = 80
const BAS_MAX = 600

interface Preferences {
  largeurLaterale: number
  hauteurBas: number
  basOuvert: boolean
  section: Section
  ongletBas: OngletBas
  zoom: number
}

const PREFS_DEFAUT: Preferences = {
  largeurLaterale: 240,
  hauteurBas: 200,
  basOuvert: false,
  section: 'PILOTAGE',
  ongletBas: 'controles',
  zoom: 1,
}

const CLE_PREFS = 'gestionfil.atelier.disposition'

function chargerPrefs(): Preferences {
  try {
    const brut = localStorage.getItem(CLE_PREFS)
    return brut ? { ...PREFS_DEFAUT, ...(JSON.parse(brut) as Partial<Preferences>) } : PREFS_DEFAUT
  } catch {
    return PREFS_DEFAUT
  }
}

/* -------------------------------------------------------------------------- */
/* Point d'entree                                                              */
/* -------------------------------------------------------------------------- */

export function Atelier({ routes }: { routes: React.ReactNode }) {
  const { moi } = useAuth()
  const emplacement = useLocation()
  const naviguer = useNavigate()

  /* La classe `atelier` porte le theme et les proportions. Elle est posee sur
     <html> pour que les portails (menus, palette, notifications) en heritent. */
  useEffect(() => {
    document.documentElement.classList.add('atelier')
    return () => document.documentElement.classList.remove('atelier')
  }, [])

  /* Sombre par defaut sur le poste de bureau — mais seulement tant qu'aucun
     choix n'a ete fait : un reglage explicite de l'utilisateur, meme clair,
     doit survivre au redemarrage. */
  const { definir: definirTheme } = useTheme()
  useEffect(() => {
    if (!localStorage.getItem('gestionfil.theme')) definirTheme('sombre')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allerA = useCallback((chemin: string) => naviguer(chemin), [naviguer])

  /* Empaquetee, l'application est servie depuis le disque et la localisation
     initiale porte le nom du fichier (`/index.html`), qui ne correspond a
     aucune route. Sans cette remise a plat, la fenetre s'ouvrirait sur un
     onglet « Ecran introuvable ». Vaut aussi pour les fenetres creees. */
  useEffect(() => {
    if (emplacement.pathname.endsWith('index.html')) naviguer('/', { replace: true })
  }, [emplacement.pathname, naviguer])

  return (
    <FournisseurOnglets
      compte={moi?.login ?? 'anonyme'}
      etiquette={etiquetteFenetre()}
      chemin={emplacement.pathname}
      naviguer={allerA}
    >
      <Etabli routes={routes} />
    </FournisseurOnglets>
  )
}

/* -------------------------------------------------------------------------- */
/* Etabli                                                                      */
/* -------------------------------------------------------------------------- */

function Etabli({ routes }: { routes: React.ReactNode }) {
  const { moi, deconnecter, peut } = useAuth()
  const { definir } = useTheme()
  const { famille, definir: definirPalette } = usePalette()
  const naviguer = useNavigate()
  const queryClient = useQueryClient()
  const onglets = useOnglets()

  const [prefs, setPrefs] = useState<Preferences>(chargerPrefs)
  const [basMaximise, setBasMaximise] = useState(false)
  const [palette, setPalette] = useState<null | '>' | ''>(null)
  const racine = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem(CLE_PREFS, JSON.stringify(prefs))
  }, [prefs])

  const majPrefs = useCallback(
    (p: Partial<Preferences>) => setPrefs((e) => ({ ...e, ...p })),
    [],
  )

  /* --- Adaptation a la resolution ------------------------------------------
     Trois paliers plutot qu'une echelle continue : au-dela, on ne sait plus
     dire de quoi depend ce qu'on voit. Le palier « compact » replie la barre
     laterale, parce qu'en dessous de 1150 px elle et le rail mangent la moitie
     de la zone de travail. Le repli est memorise separement du choix de
     l'utilisateur : agrandir la fenetre rouvre le panneau s'il etait ouvert. */
  const [largeurPx, setLargeurPx] = useState(() => window.innerWidth)
  const palier: 'compact' | 'normal' | 'ample' =
    largeurPx < 1150 ? 'compact' : largeurPx >= 1700 ? 'ample' : 'normal'

  useEffect(() => {
    const el = racine.current
    if (!el) return
    const obs = new ResizeObserver(([entree]) => setLargeurPx(entree.contentRect.width))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])


  /* --- Menu contextuel du moteur de rendu ---------------------------------
     WebView2 propose « Inspecter » au clic droit : dans une application de
     gestion, c'est une porte ouverte sur les outils de developpement au milieu
     d'un ecran de saisie. On le supprime partout ; les menus de l'application
     restent, puisqu'ils appellent eux-memes `preventDefault`.

     Les raccourcis d'outils ne sont bloques qu'en production : les garder en
     developpement permet de diagnostiquer un ecran blanc. */
  useEffect(() => {
    const sansMenu = (e: MouseEvent) => e.preventDefault()
    const sansOutils = (e: KeyboardEvent) => {
      const ctrlMaj = (e.ctrlKey || e.metaKey) && e.shiftKey
      if (e.key === 'F12' || (ctrlMaj && ['i', 'j', 'c'].includes(e.key.toLowerCase()))) {
        e.preventDefault()
      }
    }
    document.addEventListener('contextmenu', sansMenu)
    if (!import.meta.env.DEV) window.addEventListener('keydown', sansOutils, true)
    return () => {
      document.removeEventListener('contextmenu', sansMenu)
      window.removeEventListener('keydown', sansOutils, true)
    }
  }, [])

  /* --- Zoom ---------------------------------------------------------------
     WebView2 et WKWebView honorent `zoom` sur l'element racine : c'est le seul
     moyen de mettre a l'echelle une interface dont les tailles sont en pixels,
     et c'est ce que fait l'editeur avec Ctrl+=. */
  useEffect(() => {
    document.documentElement.style.setProperty('zoom', String(prefs.zoom))
    return () => {
      document.documentElement.style.removeProperty('zoom')
    }
  }, [prefs.zoom])

  /* --- Controles ---------------------------------------------------------- */
  const qControles = useQuery({
    queryKey: ['controles'],
    queryFn: () => api.get<Controle[]>('/api/controles'),
    enabled: peut('COCKPIT', 'LIRE'),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  })
  const controles = useMemo(() => qControles.data ?? [], [qControles.data])
  const anomalies = controles.filter((c) => c.anomalies > 0).length
  const bloquantes = controles.filter(
    (c) => c.anomalies > 0 && (c.criticite === 'BLOQUANT' || c.criticite === 'CRITIQUE'),
  ).length

  /* --- Ouverture d'un document ------------------------------------------- */
  const ouvrir = useCallback(
    (chemin: string, apercu: boolean, groupe?: string) => {
      onglets.ouvrir(chemin, { apercu, groupe })
      naviguer(chemin)
    },
    [onglets, naviguer],
  )

  /* --- Redimensionnement --------------------------------------------------
     Un seul gestionnaire pour les deux poignees. La capture du pointeur evite
     de perdre le glissement quand le curseur sort de la poignee, et l'attribut
     `data-glisse` fige le curseur sur toute la fenetre. */
  const glisser = useCallback(
    (axe: 'col' | 'ligne') => (ev: React.PointerEvent<HTMLDivElement>) => {
      ev.preventDefault()
      const cible = ev.currentTarget
      cible.setPointerCapture(ev.pointerId)
      cible.dataset.actif = 'oui'
      racine.current?.setAttribute('data-glisse', axe)

      const depart = axe === 'col' ? ev.clientX : ev.clientY
      const initiale = axe === 'col' ? prefs.largeurLaterale : prefs.hauteurBas

      const bouger = (e: PointerEvent) => {
        if (axe === 'col') {
          const v = initiale + (e.clientX - depart)
          majPrefs({ largeurLaterale: Math.min(LAT_MAX, Math.max(LAT_MIN, v)) })
        } else {
          // Le panneau grandit vers le haut : le delta est inverse.
          const v = initiale - (e.clientY - depart)
          majPrefs({ hauteurBas: Math.min(BAS_MAX, Math.max(BAS_MIN, v)) })
        }
      }
      const finir = () => {
        cible.releasePointerCapture(ev.pointerId)
        delete cible.dataset.actif
        racine.current?.removeAttribute('data-glisse')
        window.removeEventListener('pointermove', bouger)
        window.removeEventListener('pointerup', finir)
      }

      window.addEventListener('pointermove', bouger)
      window.addEventListener('pointerup', finir)
    },
    [prefs.largeurLaterale, prefs.hauteurBas, majPrefs],
  )

  /* --- Separation entre groupes -------------------------------------------
     Meme mecanique que les autres poignees, mais en parts et non en pixels :
     les groupes se partagent la zone, donc deplacer la separation prend a l'un
     ce qu'elle donne a l'autre. Le mouvement est refuse plutot que borne quand
     il ferait passer un groupe sous sa part minimale : borner ferait « coller »
     la poignee de facon deroutante. */
  const conteneurGroupes = useRef<HTMLDivElement>(null)

  const glisserGroupes = useCallback(
    (index: number) => (ev: React.PointerEvent<HTMLDivElement>) => {
      ev.preventDefault()
      const boite = conteneurGroupes.current?.getBoundingClientRect()
      if (!boite) return
      const horizontal = onglets.orientation === 'colonnes'
      const total = horizontal ? boite.width : boite.height
      if (total <= 0) return

      const cible = ev.currentTarget
      cible.setPointerCapture(ev.pointerId)
      cible.dataset.actif = 'oui'
      racine.current?.setAttribute('data-glisse', horizontal ? 'col' : 'ligne')

      const depart = horizontal ? ev.clientX : ev.clientY
      const initiales = [...onglets.tailles]

      const bouger = (e: PointerEvent) => {
        const delta = ((horizontal ? e.clientX : e.clientY) - depart) / total
        const avant = (initiales[index - 1] ?? 0) + delta
        const apres = (initiales[index] ?? 0) - delta
        if (avant < PART_MINIMALE || apres < PART_MINIMALE) return
        const t = [...initiales]
        t[index - 1] = avant
        t[index] = apres
        onglets.definirTailles(t)
      }
      const finir = () => {
        cible.releasePointerCapture(ev.pointerId)
        delete cible.dataset.actif
        racine.current?.removeAttribute('data-glisse')
        window.removeEventListener('pointermove', bouger)
        window.removeEventListener('pointerup', finir)
      }

      window.addEventListener('pointermove', bouger)
      window.addEventListener('pointerup', finir)
    },
    [onglets],
  )

  /* --- Commandes ---------------------------------------------------------- */
  const rafraichir = useCallback(() => {
    void queryClient.invalidateQueries()
  }, [queryClient])

  const definirSection = useCallback(
    (v: Section) => setPrefs((e) => ({ ...e, section: v })),
    [],
  )

  /** Ouvre le panneau du bas sur les controles. */
  const montrerControles = useCallback(
    () => setPrefs((e) => ({ ...e, basOuvert: true, ongletBas: 'controles' })),
    [],
  )

  const compte = moi?.login ?? 'anonyme'

  /** Nouvelle fenetre, vide ou portant un onglet retire de celle-ci. */
  const nouvelleFenetre = useCallback(
    async (chemin?: string) => {
      const ok = await ouvrirFenetre({
        compte,
        onglets: chemin ? [chemin] : [],
        titre: chemin ? `${decrire(chemin).titre} — Gestion Fil` : 'Gestion Fil',
      })
      // L'onglet ne quitte cette fenetre que si la nouvelle a bien ouvert :
      // sinon il disparaitrait sans reapparaitre nulle part.
      if (ok && chemin) onglets.fermer(chemin)
      return ok
    },
    [compte, onglets],
  )

  const quitter = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().close()
    } catch {
      /* sans effet hors Tauri */
    }
  }, [])

  const destinations = useMemo<Entree[]>(
    () =>
      NAVIGATION.filter((e) => estAccessible(e, peut, moi?.role)).map((e) => ({
        id: e.vers,
        libelle: e.libelle,
        detail: e.section,
        Icone: e.Icone,
        executer: () => ouvrir(e.vers, false),
      })),
    [peut, ouvrir],
  )

  const commandes = useMemo<Entree[]>(() => {
    const c: Entree[] = [
      ...destinations.map((d) => ({ ...d, id: `aller:${d.id}`, libelle: `Aller : ${d.libelle}` })),
      ...MODULES.map((m) => ({
        id: `module:${m.id}`,
        libelle: `Module : ${m.libelle}`,
        detail: m.resume,
        Icone: m.Icone,
        executer: () => definirSection(m.id),
      })),
      {
        id: 'vue:bas',
        libelle: 'Affichage : basculer le panneau inferieur',
        raccourci: 'Ctrl+J',
        executer: () => majPrefs({ basOuvert: !prefs.basOuvert }),
      },
      {
        id: 'vue:controles',
        libelle: 'Affichage : controles de coherence',
        raccourci: 'Ctrl+Maj+M',
        executer: montrerControles,
      },
      {
        id: 'donnees:rafraichir',
        libelle: 'Donnees : tout rafraichir',
        raccourci: 'Ctrl+R',
        executer: rafraichir,
      },
      {
        id: 'onglet:fermer',
        libelle: 'Onglet : fermer',
        raccourci: 'Ctrl+W',
        executer: () => onglets.actif && onglets.fermer(onglets.actif),
      },
      {
        id: 'onglet:fermer-tous',
        libelle: 'Onglet : tout fermer',
        executer: onglets.fermerTous,
      },
      {
        id: 'onglet:epingler',
        libelle: 'Onglet : epingler ou desepingler',
        executer: () => onglets.actif && onglets.basculerEpingle(onglets.actif),
      },
      {
        id: 'groupe:fractionner',
        libelle: 'Groupe : fractionner la zone de travail',
        raccourci: 'Ctrl+' + BARRE,
        executer: onglets.fractionner,
      },
      {
        id: 'groupe:fermer',
        libelle: 'Groupe : fermer le groupe courant',
        executer: () => onglets.fermerGroupe(onglets.focus),
      },
      {
        id: 'groupe:orientation',
        libelle:
          onglets.orientation === 'colonnes'
            ? 'Groupe : disposer les groupes en lignes'
            : 'Groupe : disposer les groupes en colonnes',
        executer: onglets.basculerOrientation,
      },
      {
        id: 'fenetre:nouvelle',
        libelle: 'Fenetre : nouvelle fenetre',
        raccourci: 'Ctrl+Maj+N',
        executer: () => void nouvelleFenetre(),
      },
      {
        id: 'fenetre:deplacer',
        libelle: "Fenetre : deplacer l'onglet vers une nouvelle fenetre",
        executer: () => onglets.actif && void nouvelleFenetre(onglets.actif),
      },
      ...FAMILLES.map((f) => ({
        id: `palette:${f.id}`,
        libelle: `Palette : ${f.libelle}`,
        detail: f.id === famille ? 'active' : undefined,
        executer: () => definirPalette(f.id),
      })),
      { id: 'theme:clair', libelle: 'Theme : clair', executer: () => definir('clair') },
      { id: 'theme:sombre', libelle: 'Theme : sombre', executer: () => definir('sombre') },
      { id: 'theme:systeme', libelle: 'Theme : systeme', executer: () => definir('systeme') },
      {
        id: 'zoom:plus',
        libelle: 'Zoom : agrandir',
        raccourci: 'Ctrl+=',
        executer: () => majPrefs({ zoom: Math.min(2, +(prefs.zoom + 0.1).toFixed(2)) }),
      },
      {
        id: 'zoom:moins',
        libelle: 'Zoom : reduire',
        raccourci: 'Ctrl+-',
        executer: () => majPrefs({ zoom: Math.max(0.6, +(prefs.zoom - 0.1).toFixed(2)) }),
      },
      {
        id: 'zoom:zero',
        libelle: 'Zoom : taille normale',
        raccourci: 'Ctrl+0',
        executer: () => majPrefs({ zoom: 1 }),
      },
      { id: 'session:quitter', libelle: 'Session : se deconnecter', executer: deconnecter },
    ]
    return c
  }, [
    destinations,
        prefs.basOuvert,
    prefs.zoom,
    majPrefs,
    definirSection,
    montrerControles,
    rafraichir,
    onglets,
    definir,
    deconnecter,
    nouvelleFenetre,
    famille,
    definirPalette,
  ])

  /* --- Menus de la barre de titre ---------------------------------------- */
  const menus = useMemo<MenuBarre[]>(() => {
    const nouveaux = [
      { chemin: '/mouvements', libelle: 'Mouvement de stock', module: 'MOUVEMENTS' },
      { chemin: '/receptions/nouvelle', libelle: 'Reception', module: 'RECEPTIONS' },
      { chemin: '/transferts/nouveau', libelle: 'Transfert', module: 'MOUVEMENTS' },
      { chemin: '/bons-commande/nouveau', libelle: 'Bon de commande', module: 'BONS_COMMANDE' },
    ].filter((n) => peut(n.module, 'ECRIRE'))

    return [
      {
        libelle: 'Fichier',
        commandes: [
          ...nouveaux.map((n) => ({
            id: `nouveau:${n.chemin}`,
            libelle: `Nouveau ${n.libelle.toLowerCase()}`,
            executer: () => ouvrir(n.chemin, false),
          })),
          {
            id: 'fichier:nouvelle-fenetre',
            libelle: 'Nouvelle fenetre',
            raccourci: 'Ctrl+Maj+N',
            separateurAvant: nouveaux.length > 0,
            executer: () => void nouvelleFenetre(),
          },
          {
            id: 'fichier:deplacer-fenetre',
            libelle: "Deplacer l'onglet vers une nouvelle fenetre",
            executer: () => onglets.actif && void nouvelleFenetre(onglets.actif),
          },
          {
            id: 'fichier:fermer',
            libelle: "Fermer l'onglet",
            raccourci: 'Ctrl+W',
            separateurAvant: true,
            executer: () => onglets.actif && onglets.fermer(onglets.actif),
          },
          {
            id: 'fichier:fermer-tous',
            libelle: 'Fermer tous les onglets',
            executer: onglets.fermerTous,
          },
          {
            id: 'fichier:quitter',
            libelle: 'Quitter',
            raccourci: 'Alt+F4',
            separateurAvant: true,
            executer: () => void quitter(),
          },
        ],
      },
      {
        libelle: 'Affichage',
        commandes: [
          {
            id: 'aff:palette',
            libelle: 'Palette de commandes',
            raccourci: 'Ctrl+Maj+P',
            executer: () => setPalette('>'),
          },
          {
            id: 'aff:aller',
            libelle: 'Aller a un ecran',
            raccourci: 'Ctrl+P',
            executer: () => setPalette(''),
          },
          {
            id: 'aff:controles',
            libelle: 'Controles de coherence',
            raccourci: 'Ctrl+Maj+M',
            separateurAvant: true,
            executer: montrerControles,
          },
          {
            id: 'aff:fractionner',
            libelle: 'Fractionner la zone de travail',
            raccourci: 'Ctrl+' + BARRE,
            separateurAvant: true,
            executer: onglets.fractionner,
          },
          {
            id: 'aff:orientation',
            libelle:
              onglets.orientation === 'colonnes'
                ? 'Disposer les groupes en lignes'
                : 'Disposer les groupes en colonnes',
            executer: onglets.basculerOrientation,
          },
          {
            id: 'aff:bas',
            libelle: 'Panneau inferieur',
            raccourci: 'Ctrl+J',
            executer: () => majPrefs({ basOuvert: !prefs.basOuvert }),
          },
          {
            id: 'aff:zoom-plus',
            libelle: 'Zoom avant',
            raccourci: 'Ctrl+=',
            separateurAvant: true,
            executer: () => majPrefs({ zoom: Math.min(2, +(prefs.zoom + 0.1).toFixed(2)) }),
          },
          {
            id: 'aff:zoom-moins',
            libelle: 'Zoom arriere',
            raccourci: 'Ctrl+-',
            executer: () => majPrefs({ zoom: Math.max(0.6, +(prefs.zoom - 0.1).toFixed(2)) }),
          },
          {
            id: 'aff:zoom-zero',
            libelle: 'Taille normale',
            raccourci: 'Ctrl+0',
            executer: () => majPrefs({ zoom: 1 }),
          },
          ...FAMILLES.map((f, i) => ({
            id: `aff:palette:${f.id}`,
            libelle: `Palette : ${f.libelle}`,
            raccourci: f.id === famille ? 'actuelle' : undefined,
            separateurAvant: i === 0,
            executer: () => definirPalette(f.id),
          })),
        ],
      },
      {
        libelle: 'Aller',
        commandes: destinations.map((d) => ({
          id: `menu-aller:${d.id}`,
          libelle: d.libelle,
          executer: d.executer,
        })),
      },
    ]
  }, [
    peut,
    ouvrir,
    onglets,
    quitter,
    definirSection,
    montrerControles,
    majPrefs,
        prefs.basOuvert,
    prefs.zoom,
    destinations,
    nouvelleFenetre,
    famille,
    definirPalette,
  ])

  /* --- Raccourcis clavier -------------------------------------------------
     Poses sur la fenetre en phase de capture, pour passer devant les champs de
     saisie : Ctrl+P doit ouvrir la navigation rapide meme lorsque le curseur
     est dans un filtre. */
  useEffect(() => {
    const auClavier = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return

      const prendre = () => {
        e.preventDefault()
        e.stopPropagation()
      }

      if (e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case 'p':
            prendre()
            return setPalette('>')
          case 'm':
            prendre()
            return montrerControles()
          case 'n':
            prendre()
            void nouvelleFenetre()
            return
        }
      }

      switch (e.key.toLowerCase()) {
        case 'p':
          if (e.shiftKey) return
          prendre()
          return setPalette('')
        case 'j':
          prendre()
          return majPrefs({ basOuvert: !prefs.basOuvert })
        case 'w':
          prendre()
          if (onglets.actif) onglets.fermer(onglets.actif)
          return
        case 'r':
          prendre()
          return rafraichir()
        case BARRE:
          prendre()
          return onglets.fractionner()
        case 'tab':
          prendre()
          return onglets.decaler(e.shiftKey ? -1 : 1)
        case '=':
        case '+':
          prendre()
          return majPrefs({ zoom: Math.min(2, +(prefs.zoom + 0.1).toFixed(2)) })
        case '-':
          prendre()
          return majPrefs({ zoom: Math.max(0.6, +(prefs.zoom - 0.1).toFixed(2)) })
        case '0':
          prendre()
          return majPrefs({ zoom: 1 })
      }
    }

    window.addEventListener('keydown', auClavier, true)
    return () => window.removeEventListener('keydown', auClavier, true)
  }, [
        prefs.basOuvert,
    prefs.zoom,
    majPrefs,
    definirSection,
    montrerControles,
    onglets,
    rafraichir,
    nouvelleFenetre,
  ])

  /* --- Rendu --------------------------------------------------------------- */
  const titreFenetre = onglets.actif
    ? `${decrire(onglets.actif).titre} — Gestion Fil`
    : 'Gestion Fil'

  return (
    <div
      ref={racine}
      data-palier={palier}
      className="flex h-full flex-col overflow-hidden bg-[hsl(var(--at-editeur))]"
    >
      <BarreTitre menus={menus} titre={titreFenetre} />

      <div className="flex min-h-0 flex-1">
        <BarreActivites
          section={prefs.section}
          definirSection={definirSection}
          anomalies={anomalies}
          bas={<EtatServeur />}
        />

        {/* --- Zone de travail --------------------------------------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          <FilAriane
            section={prefs.section}
            ecrans={NAVIGATION.filter(
              (e) => e.section === prefs.section && estAccessible(e, peut, moi?.role),
            )}
            cheminActif={onglets.actif}
            ouvrir={ouvrir}
            ouvrirRecherche={() => setPalette('')}
            anomalies={anomalies}
            bloquantes={bloquantes}
            ouvrirControles={montrerControles}
            login={moi?.login ?? '—'}
            role={moi?.role ?? '—'}
            deconnecter={deconnecter}
          />

          {/* Les groupes se partagent la zone. Tous les onglets de tous les
              groupes restent montes : seul l'actif de chaque groupe s'affiche,
              ce qui preserve defilement, filtres et formulaires en cours. */}
          <div
            ref={conteneurGroupes}
            className={cn(
              'flex min-h-0',
              onglets.orientation === 'colonnes' ? 'flex-row' : 'flex-col',
              basMaximise && prefs.basOuvert ? 'hidden' : 'flex-1',
            )}
          >
            {onglets.groupes.map((groupe, i) => (
              <Fragment key={groupe.id}>
                {i > 0 && (
                  <div
                    className={onglets.orientation === 'colonnes' ? 'poignee-v' : 'poignee-h'}
                    role="separator"
                    aria-orientation={
                      onglets.orientation === 'colonnes' ? 'vertical' : 'horizontal'
                    }
                    aria-label="Redimensionner les groupes"
                    onPointerDown={glisserGroupes(i)}
                  />
                )}
                <section
                  aria-label={`Groupe ${i + 1}`}
                  onPointerDownCapture={() => onglets.focaliser(groupe.id)}
                  className={cn(
                    'flex min-h-0 min-w-0 flex-col bg-[hsl(var(--at-editeur))]',
                    // Le groupe qui a le focus se distingue par un filet, jamais
                    // par un fond : deux fonds differents dans la meme zone de
                    // travail se lisent comme deux applications.
                    onglets.groupes.length > 1 &&
                      groupe.id === onglets.focus &&
                      'ring-1 ring-inset ring-primaire/40',
                  )}
                  style={{ flex: `${onglets.tailles[i] ?? 1} 1 0%` }}
                >
                  <Onglets
                    groupe={groupe}
                    focalise={groupe.id === onglets.focus}
                    plusieursGroupes={onglets.groupes.length > 1}
                    activer={(c) => ouvrir(c, true, groupe.id)}
                    fixer={(c) => onglets.fixer(c, groupe.id)}
                    fermer={(c) => onglets.fermer(c, groupe.id)}
                    fermerAutres={(c) => onglets.fermerAutres(c, groupe.id)}
                    fermerADroite={(c) => onglets.fermerADroite(c, groupe.id)}
                    fermerTous={() => onglets.fermerTous(groupe.id)}
                    basculerEpingle={(c) => onglets.basculerEpingle(c, groupe.id)}
                    deplacer={(de, vers) => onglets.deplacer(de, vers, groupe.id)}
                    deplacerVersGroupe={onglets.deplacerVersGroupe}
                    deplacerVersFenetre={(c) => void nouvelleFenetre(c)}
                    fractionner={onglets.fractionner}
                    fermerGroupe={() => onglets.fermerGroupe(groupe.id)}
                  />

                  <div className="min-h-0 flex-1">
                    {groupe.onglets.length === 0 ? (
                      <Accueil ouvrirPalette={() => setPalette('')} />
                    ) : (
                      groupe.onglets.map((o) => (
                        <div
                          key={o.chemin}
                          role="tabpanel"
                          aria-hidden={o.chemin !== groupe.actif}
                          className={cn(
                            'zone-travail h-full overflow-y-auto',
                            o.chemin === groupe.actif ? 'block' : 'hidden',
                          )}
                        >
                          <Routes location={o.chemin}>{routes}</Routes>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </Fragment>
            ))}
          </div>

          {prefs.basOuvert && (
            <>
              <div
                className="poignee-h"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Redimensionner le panneau inferieur"
                onPointerDown={glisser('ligne')}
              />
              <div
                className={cn(
                  'flex min-h-0 flex-col',
                  // Agrandi, le panneau prend toute la place laissee par la zone
                  // de travail masquee ; sinon il garde sa hauteur reglee.
                  basMaximise ? 'flex-1' : 'shrink-0',
                )}
                style={{ height: basMaximise ? undefined : prefs.hauteurBas }}
              >
                <PanneauBas
                  onglet={prefs.ongletBas}
                  definirOnglet={(o) => majPrefs({ ongletBas: o })}
                  controles={controles}
                  ouvrir={ouvrir}
                  fermer={() => {
                    setBasMaximise(false)
                    majPrefs({ basOuvert: false })
                  }}
                  maximise={basMaximise}
                  basculerMaximise={() => setBasMaximise((m) => !m)}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <BarreEtat
        controles={controles}
        ouvrirControles={() => {
          setPrefs((e) => ({ ...e, basOuvert: true, ongletBas: 'controles' }))
        }}
        rafraichir={rafraichir}
        version={VERSION}
      />

      <Palette
        ouvert={palette !== null}
        prefixe={palette ?? ''}
        fermer={() => setPalette(null)}
        commandes={commandes}
        destinations={destinations}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Ecran d'accueil : aucun onglet ouvert                                       */
/* -------------------------------------------------------------------------- */

function Accueil({ ouvrirPalette }: { ouvrirPalette: () => void }) {
  const raccourcis: [string, string][] = [
    ['Aller a un ecran', 'Ctrl+P'],
    ['Palette de commandes', 'Ctrl+Maj+P'],
    ['Barre laterale', 'Ctrl+B'],
    ['Panneau inferieur', 'Ctrl+J'],
    ['Onglet suivant', 'Ctrl+Tab'],
    ["Fermer l'onglet", 'Ctrl+W'],
  ]

  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col gap-5 text-center">
        <div>
          <p className="text-[22px] font-light tracking-tight text-texte">Gestion Fil</p>
          <p className="text-[12px] text-attenue-texte">Polyfashions Carpet Morocco</p>
        </div>
        <dl className="flex flex-col gap-1.5 text-[12px]">
          {raccourcis.map(([libelle, touche]) => (
            <div key={libelle} className="flex items-center justify-between gap-8">
              <dt className="text-attenue-texte">{libelle}</dt>
              <dd className="font-mono text-[11px] text-texte">{touche}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          onClick={ouvrirPalette}
          className="mx-auto rounded-[3px] border border-bordure px-3 py-1 text-[12px]
                     text-texte hover:bg-attenue"
        >
          Ouvrir un ecran
        </button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Etat du serveur, ancre en bas du rail                                       */
/* -------------------------------------------------------------------------- */

/**
 * Point de synchronisation.
 *
 * Vert quand le serveur repond, rouge sinon. Il ne clignote pas : un indicateur
 * qui bouge en permanence dans le coin de l'oeil fatigue et finit ignore. Le
 * changement de couleur suffit, parce qu'il est rare.
 */
function EtatServeur() {
  const sante = useQuery({
    queryKey: ['atelier-sante'],
    queryFn: () => api.get<{ tables?: number; version?: string }>('/api/sante'),
    refetchInterval: 30_000,
    retry: false,
    staleTime: 0,
  })

  const horsLigne = sante.isError
  return (
    <Infobulle
      contenu={
        horsLigne
          ? 'Serveur injoignable — aucune saisie ne sera enregistree'
          : `Serveur relie · ${sante.data?.tables ?? '—'} tables · version ${sante.data?.version ?? '—'}`
      }
    >
      <div
        aria-label={horsLigne ? 'Serveur injoignable' : 'Serveur relie'}
        role="status"
        className="grid h-10 w-full place-items-center"
      >
        <span
          className={cn(
            'size-2.5 rounded-full',
            horsLigne ? 'bg-danger' : 'bg-succes',
          )}
        />
      </div>
    </Infobulle>
  )
}
