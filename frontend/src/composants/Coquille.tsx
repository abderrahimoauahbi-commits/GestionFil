/**
 * Coquille applicative — navigation en bandeau superieur.
 *
 * La barre laterale a ete retiree : elle immobilisait 208 px de largeur sur
 * toute la hauteur, alors que les ecrans de cet ERP sont des tableaux larges qui
 * reclament cette place. Le bandeau superieur porte tout — marque, navigation,
 * alertes, profil — sur 44 px de haut, et rend la largeur au contenu.
 *
 * Trois dispositions issues d'une seule structure :
 *   >= 1280 px  les groupes de menus tiennent en clair dans le bandeau
 *   768-1279 px les groupes se replient dans un menu unique
 *   < 768 px    barre d'onglets en bas, la ou le pouce atteint
 *
 * Les entrees dont le module n'est pas accessible ne sont pas rendues : la
 * navigation reflete exactement ce que l'utilisateur peut faire.
 */
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeftRight, BarChart3, Bell, Bot, Boxes, Calculator, ChevronDown, ClipboardCheck, Cog, Coins, Container, Download, Factory, FileSpreadsheet, FileText, Gauge, Grid3x3, Home, KeyRound, Layers, LayoutGrid, Link2, LogOut, Menu as MenuIcone, Monitor, Moon, Package, PackageCheck, PackageSearch, Palette, Receipt, Shapes, ShieldAlert, ShieldCheck, Ship, ShoppingCart, SlidersHorizontal, Sparkles, Sun, TrendingUp, Truck, Undo2, Warehouse, type LucideIcon,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useEntreprise } from '../lib/entreprise'
import { cn, estBureau, sousChemin } from '../lib/utils'
import { useTheme } from './Theme'
import { BarreLaterale } from './BarreLaterale'
import { BoutonRafraichir, useEcranCalcule } from './BoutonRafraichir'
import { NavigationEntete } from './NavigationEntete'
import { PanneauApparence } from './PanneauApparence'
import { AideEcran } from './AideEcran'
import { RobotConnexion } from './RobotConnexion'
import { ChangerMotDePasse } from './ChangerMotDePasse'
import { DoubleAuthentification } from './DoubleAuthentification'
import { useApparence } from './Apparence'
import { Badge, Bouton } from './ui/base'
import {
  Menu,
  MenuContenu,
  MenuDeclencheur,
  MenuElement,
  MenuSeparateur,
  MenuTitre,
} from './ui/surcouches'

/**
 * Modules metier de l'ERP.
 *
 * Le rail de gauche porte ces six entrees et rien d'autre : ce sont les
 * grandes fonctions de l'entreprise, pas des vues d'outil. Le sous-menu du
 * module actif s'affiche dans le bandeau superieur.
 *
 * DEUX CORRECTIONS PAR RAPPORT AU DECOUPAGE PRECEDENT, toutes deux venues de
 * l'usage et non d'une preference de rangement.
 *
 * Le catalogue N'EST PAS UN SOUS-ENSEMBLE DES ACHATS. Il etait range sous
 * Achats parce qu'on y achete des references — mais la production, le stock et
 * la qualite le consultent tout autant, et l'acheteur n'en est pas
 * proprietaire. Il devient une section a lui, avec ce qui le decrit :
 * equivalences et fournisseurs.
 *
 * Le MRP N'EST PAS UN MODULE. C'est un calcul, celui qui relie la production
 * aux achats. Lui donner une icone separee obligeait a choisir arbitrairement
 * ou ranger « stock projete » (cote MRP) et « etat de stock » (cote Stock) —
 * deux ecrans que les magasiniers cherchaient au meme endroit. Le calcul se
 * range donc avec ce qui le nourrit, la production, et ses resultats avec ce
 * qu'ils decrivent, le stock.
 *
 * Une precision de vocabulaire qui compte ici : dans cette usine, « qualite »
 * designe une **qualite de tapis** (SH, LP, ...), pas le controle qualite. Les
 * qualites sont donc rangees en Production, et le controle qualite reste ou il
 * se pratique — dans la reception, au moment de la pesee.
 */
export type Section =
  | 'GENERAL'
  | 'CATALOGUE'
  | 'PRODUCTION'
  | 'ACHATS'
  | 'STOCK'
  | 'FINANCE'
  | 'PARAMETRES'

export const MODULES: {
  id: Section
  libelle: string
  resume: string
  Icone: LucideIcon
}[] = [
  { id: 'GENERAL',    libelle: 'Général',    resume: 'Tableau de bord, statistiques, entreprise', Icone: Gauge },
  { id: 'CATALOGUE',  libelle: 'Catalogue',  resume: 'Références, équivalences, fournisseurs',    Icone: Package },
  { id: 'PRODUCTION', libelle: 'Production', resume: 'Qualités, recettes, plans, besoins',        Icone: Factory },
  { id: 'ACHATS',     libelle: 'Achats',     resume: "Plan d'achat, commandes, réceptions",       Icone: ShoppingCart },
  { id: 'STOCK',      libelle: 'Stock',      resume: 'État, mouvements, transferts, inventaires', Icone: Boxes },
  { id: 'FINANCE',    libelle: 'Finance',    resume: 'Valorisation, classification, rapports',    Icone: Coins },
  { id: 'PARAMETRES', libelle: 'Paramètres', resume: 'Apparence, entreprise, droits, sauvegardes', Icone: SlidersHorizontal },
]

export interface EntreeNav {
  vers: string
  libelle: string
  /** Module de droits, utilise par la grille d'habilitations. */
  module: string
  Icone: LucideIcon
  /** Section du menu : determine sous quelle icone du rail l'ecran se range. */
  section: Section
  /** Presente dans la barre du bas sur mobile. */
  principale?: boolean
  /** Une ligne disant CE QU'ON Y FAIT. Affichee sur l'accueil, sous le nom :
      « Mouvements » n'apprend rien a qui ne connait pas encore l'outil. */
  resume?: string
  /** Ecran declare mais pas encore construit : affiche grise, non ouvrable. */
  aVenir?: string
  /**
   * Roles autorises, quand la permission de module ne suffit pas a decider.
   * Absent : tout role ayant la permission de lecture voit l'entree.
   */
  roles?: string[]
}

/**
 * Un ecran est-il accessible a cet utilisateur ?
 *
 * Deux conditions, et la seconde n'est pas redondante : la grille de droits
 * raisonne par module, or certains ecrans ne se decident que par role. Les
 * filtrer au seul module ferait apparaitre une entree qui repond 403.
 */
export function estAccessible(
  entree: EntreeNav,
  peut: (module: string, action: 'LIRE') => boolean,
  role: string | undefined,
): boolean {
  /* UN MODULE VIDE VEUT DIRE « OUVERT A TOUS ». L'accueil n'appartient a aucun
     module : il ne montre que les ecrans auxquels celui qui regarde a deja
     droit, et le lui fermer reviendrait a le laisser sans porte de sortie. */
  if (entree.module === '') return true
  if (!peut(entree.module, 'LIRE')) return false
  if (entree.roles && !entree.roles.includes(role ?? '')) return false
  return true
}

export const NAVIGATION: EntreeNav[] = [
  /* --- 1. General -------------------------------------------------------- */
  { vers: '/', libelle: 'Accueil', module: '', Icone: Home, section: 'GENERAL', principale: true },
  { vers: '/tableau-de-bord', libelle: 'Tableau de bord', module: 'COCKPIT', Icone: Gauge, section: 'GENERAL', resume: 'Indicateurs, alertes et mur de risques', principale: true },
  { vers: '/statistiques', libelle: 'Statistiques', module: 'MOUVEMENTS', Icone: BarChart3, section: 'GENERAL' },
  // La coherence est un ecran de pilotage, pas d'administration : c'est la
  // direction et l'assistante qui corrigent les anomalies, pas l'informaticien.
  { vers: '/controles', libelle: 'Contrôles de cohérence', module: 'COCKPIT', Icone: ShieldCheck, section: 'GENERAL' },
  /* LE CHATBOT EST OUVERT A TOUS, l'ancien assistant reste a la Direction.
     Le premier n'expose que les competences que le role de l'appelant autorise
     deja, chacune verifiee module par module ; le second lit des vues
     consolidees sans ce filtre, d'ou sa restriction. */
  { vers: '/chat', libelle: 'Assistant', module: 'COCKPIT', Icone: Bot, section: 'GENERAL',
    resume: 'Poser une question sur le stock et les achats',
    principale: true },
  {
    vers: '/assistant',
    libelle: 'Questions types',
    module: 'COCKPIT',
    Icone: Sparkles,
    section: 'GENERAL',
    roles: ['DIRECTION'],
  },


  /* --- 2. Catalogue ------------------------------------------------------ */
  { vers: '/catalogue', libelle: 'Références', module: 'CATALOGUE', Icone: Boxes, section: 'CATALOGUE', resume: 'Les références, leurs prix et leur stock', principale: true },
  // L'assistant de completion : il lit le code de chaque reference et
  // propose famille, couleur et reference fournisseur. Sa place est ici,
  // sous les references qu'il complete.
  { vers: '/catalogue/completer', libelle: 'Compléter les références', module: 'CATALOGUE', Icone: Sparkles, section: 'CATALOGUE', resume: 'L’assistant déduit famille, couleur et réf. fournisseur' },
  { vers: '/equivalences', libelle: 'Équivalences', module: 'CATALOGUE', Icone: Link2, section: 'CATALOGUE' },
  { vers: '/fournisseurs', libelle: 'Fournisseurs', module: 'FOURNISSEURS', Icone: Truck, section: 'CATALOGUE' },
  // Categories et roles BOM decrivent le PRODUIT : ils quittent l'administration
  // pour rejoindre ce qu'ils qualifient. Chacun ouvre l'ecran des referentiels
  // reduit a son seul onglet — meme code, meme CRUD, pas de doublon.
  { vers: '/categories', libelle: 'Catégories matière', module: 'CATALOGUE', Icone: Shapes, section: 'CATALOGUE' },
  { vers: '/couleurs', libelle: 'Couleurs', module: 'CATALOGUE', Icone: Palette, section: 'CATALOGUE', resume: 'Le nuancier maison et son code chez chaque fournisseur' },
  { vers: '/roles-bom', libelle: 'Rôles BOM', module: 'CATALOGUE', Icone: Layers, section: 'CATALOGUE' },

  /* --- 3. Production & MRP ----------------------------------------------- */
  { vers: '/qualites', libelle: 'Qualités', module: 'QUALITES', Icone: Factory, section: 'PRODUCTION' },
  { vers: '/recettes', libelle: 'Recettes (BOM)', module: 'RECETTES', Icone: FileText, section: 'PRODUCTION' },
  { vers: '/plans', libelle: 'Plan de production', module: 'PLANS', Icone: LayoutGrid, section: 'PRODUCTION' },
  { vers: '/besoins', libelle: 'Besoins (MRP)', module: 'MRP', Icone: Calculator, section: 'PRODUCTION', resume: 'Ce qu’il faut acheter, et quand', principale: true },
  { vers: '/plan-achat', libelle: "Plan d'achat", module: 'PLAN_ACHAT', Icone: ShoppingCart, section: 'PRODUCTION' },

  /* --- 4. Achats --------------------------------------------------------- */
  { vers: '/bons-commande', libelle: 'Bons de commande', module: 'BONS_COMMANDE', Icone: Receipt, section: 'ACHATS' },
  { vers: '/receptions', libelle: 'Réceptions', module: 'RECEPTIONS', Icone: PackageCheck, section: 'ACHATS', resume: 'Peser et enregistrer ce qui arrive', principale: true },
  // L'assistant part du scan et non du formulaire vide : c'est l'ordre du
  // geste reel, la liasse arrive avant le dossier.
  { vers: '/import/assistant', libelle: "Assistant d'import", module: 'IMPORT', Icone: Sparkles, section: 'ACHATS', resume: 'Chargez la liasse scannée, le dossier se crée autour' },
  { vers: '/import', libelle: "Dossiers d'import", module: 'IMPORT', Icone: Ship, section: 'ACHATS', resume: 'Factures, frais et coût de revient des importations' },
  { vers: '/receptions-import', libelle: 'Réceptions import', module: 'RECEPTIONS', Icone: Container, section: 'ACHATS', resume: 'Faire entrer en stock la marchandise importée' },
  {
    vers: '/historique-prix',
    libelle: 'Historique des prix',
    module: 'CATALOGUE',
    Icone: TrendingUp,
    section: 'ACHATS',
  },
  // La matrice et l'historique montrent les MEMES achats : l'un en liste
  // chronologique, l'autre croise par mois. Ce n'est pas un doublon — c'est la
  // difference entre « quand a-t-on paye quoi » et « depuis quand ca monte ».
  {
    vers: '/matrice-prix',
    libelle: 'Matrice des prix',
    module: 'CATALOGUE',
    Icone: Grid3x3,
    section: 'ACHATS',
  },
  {
    vers: '/retours-fournisseur',
    libelle: 'Retours fournisseur',
    module: 'MOUVEMENTS',
    Icone: Undo2,
    section: 'ACHATS',
    aVenir:
      "Le type de mouvement existe et la sortie fonctionne ; il manque l'ecran qui rattache le retour a sa ligne de reception.",
  },

  /* --- 5. Stock & mouvements --------------------------------------------- */
  { vers: '/etat-stock', libelle: 'État des stocks', module: 'STOCK', Icone: Warehouse, section: 'STOCK', resume: 'Ce que chaque magasin porte, en kilos', principale: true },
  { vers: '/stock', libelle: 'Stock projeté & alertes', module: 'STOCK', Icone: PackageSearch, section: 'STOCK' },
  { vers: '/mouvements', libelle: 'Mouvements', module: 'MOUVEMENTS', Icone: ArrowLeftRight, section: 'STOCK', resume: 'Entrées, sorties, transferts', principale: true },
  { vers: '/transferts', libelle: 'Transferts', module: 'MOUVEMENTS', Icone: Truck, section: 'STOCK' },
  // Le stock pose sur les metiers. Il vit dans les memes tables que le reste :
  // chaque etage est un magasin, et rien ici n'est un registre a part.
  { vers: '/machines', libelle: 'Machines', module: 'STOCK', Icone: Cog, section: 'STOCK', resume: 'Charger, décharger, constater les métiers', principale: true },
  { vers: '/inventaires', libelle: 'Inventaires', module: 'INVENTAIRE', Icone: ClipboardCheck, section: 'STOCK' },

  /* --- 6. Finance & valorisation ----------------------------------------- */
  { vers: '/valorisation', libelle: 'Valorisation (CMUP)', module: 'VALORISATION', Icone: Coins, section: 'FINANCE' },
  {
    vers: '/classification',
    libelle: 'Analyse ABC / XYZ',
    module: 'STOCK',
    Icone: BarChart3,
    section: 'FINANCE',
  },
  {
    vers: '/landed-cost',
    libelle: 'Coût de revient complet',
    module: 'VALORISATION',
    Icone: Ship,
    section: 'FINANCE',

  },
  {
    vers: '/rapports',
    libelle: 'Rapports financiers',
    module: 'VALORISATION',
    Icone: FileSpreadsheet,
    section: 'FINANCE',
  },


  /* --- Reglages ----------------------------------------------------------
     Ils ne sont PAS un module metier : on n'y passe pas sa journee, on y va
     quand quelque chose doit changer. Les ranger avec le pilotage les mettait
     au meme rang que le plan d'achat, ce qu'ils ne sont pas. La barre les
     place donc en pied, separes du reste par un filet. */
  { vers: '/parc-machines', libelle: 'Parc machines', module: 'PARAMETRES', Icone: Cog, section: 'PARAMETRES' },
  { vers: '/configuration', libelle: 'Paramètres', module: 'PARAMETRES', Icone: SlidersHorizontal, section: 'PARAMETRES' },
  /* L'ecran de telechargement est ouvert a TOUS les comptes, pas au seul
     administrateur : celui qui doit reinstaller son poste est celui qui s'en
     sert dessus. Il est rattache au module COCKPIT, que tout le monde lit,
     precisement pour cela. Le JOURNAL qu'il affiche, lui, reste reserve a
     PARAMETRES — c'est l'ecran qui le masque, et le serveur qui le refuse. */
  { vers: '/telecharger', libelle: 'Télécharger l application', module: 'COCKPIT', Icone: Download, section: 'PARAMETRES' },
]

/** Sections dans l'ordre du rail. */
const GROUPES = MODULES.map((m) => m.id)

interface Controle {
  code: string
  controle: string
  criticite: 'BLOQUANT' | 'MAJEUR' | 'MINEUR' | string
  anomalies: number
}

export function Coquille() {
  const { moi, deconnecter, peut } = useAuth()
  const { theme, definir } = useTheme()
  const emplacement = useLocation()
  const [tiroir, setTiroir] = useState(false)
  const [apparence, setApparence] = useState(false)
  const [motDePasse, setMotDePasse] = useState(false)
  const [doubleAuth, setDoubleAuth] = useState(false)
  const reglages = useApparence()
  const entreprise = useEntreprise()

  const accessibles = NAVIGATION.filter((e) => estAccessible(e, peut, moi?.role))
  const principales = accessibles.filter((e) => e.principale).slice(0, 4)
  const courante = accessibles.find(
    (e) =>
      e.vers === emplacement.pathname ||
      (e.vers !== '/' && sousChemin(emplacement.pathname, e.vers)),
  )

  useEffect(() => setTiroir(false), [emplacement.pathname])

  /**
   * Alertes : les controles de coherence en anomalie. Ce sont les seules
   * notifications qui aient un sens ici — elles portent sur l'etat des donnees,
   * pas sur une activite sociale. Rafraichies toutes les cinq minutes.
   */
  const qControles = useQuery({
    queryKey: ['controles'],
    queryFn: () => api.get<Controle[]>('/api/controles'),
    enabled: peut('COCKPIT', 'LIRE'),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  })

  const alertes = (qControles.data ?? []).filter((c) => c.anomalies > 0)
  const bloquantes = alertes.filter((c) => c.criticite === 'BLOQUANT')

  /**
   * Une entree de navigation, ouvrable ou non.
   *
   * POURQUOI CE COMPOSANT EXISTE. Les entrees marquees `aVenir` designent des
   * ecrans declares mais pas construits ; leur `vers` ne correspond a aucune
   * route. Rendues en lien ordinaire, elles tombaient sur la route attrape-tout
   * et REDIRIGEAIENT VERS LE COCKPIT : les trois entrees Finance menaient donc
   * a la meme page, sans que rien n'explique pourquoi.
   *
   * Le fil d'Ariane les desactivait deja ; les quatre autres endroits qui
   * rendent la navigation l'avaient oublie, chacun a son tour. D'ou un seul
   * composant, que ces cinq endroits partagent : la regle ne peut plus etre
   * respectee a un endroit et pas a l'autre.
   */
  const LienNav = ({
    e,
    className,
    end,
    children,
  }: {
    e: EntreeNav
    className?: string | ((p: { isActive: boolean }) => string)
    end?: boolean
    children: React.ReactNode
  }) => {
    if (e.aVenir) {
      return (
        <span
          aria-disabled
          title={e.aVenir}
          className={cn(
            typeof className === 'function' ? className({ isActive: false }) : className,
            'cursor-not-allowed opacity-45',
          )}
        >
          {children}
          <Badge ton="contour" className="ml-auto shrink-0 text-[9px]">
            a venir
          </Badge>
        </span>
      )
    }
    return (
      <NavLink to={e.vers} end={end} className={className}>
        {children}
      </NavLink>
    )
  }

  const lienNav = (actif: boolean) =>
    cn(
      'flex items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[13px]',
      'whitespace-nowrap transition-colors',
      actif
        ? 'bg-attenue font-medium text-texte'
        : 'text-attenue-texte hover:bg-attenue hover:text-texte',
    )


  return (
    <div
      className="flex h-full bg-fond"
      /* LA HAUTEUR DE LA BARRE DU BAS, PUBLIEE POUR LES AUTRES.
         Une barre d'action figee en bas d'un tableau se collerait sinon au bord
         de l'ecran — c'est-a-dire DERRIERE la navigation du telephone, ou elle
         est parfaitement invisible. On donne donc la mesure une fois, ici, la
         ou l'on sait si la barre existe, plutot que de recopier « 4rem » dans
         chaque ecran en esperant que personne ne la deplace. */
      style={
        {
          '--barre-basse':
            principales.length > 1
              ? 'calc(4rem + var(--marge-sure-bas))'
              : 'var(--marge-sure-bas)',
        } as React.CSSProperties
      }
    >
      {/* La navigation passe en COLONNE. Sept modules et vingt-neuf ecrans ne
          tiennent pas sur une ligne : la barre du haut les repliait en menus
          deroulants, et il fallait deux clics et une memoire du rangement pour
          atteindre un ecran. */}
      {reglages.disposition !== 'entete' && <BarreLaterale />}

      <div className="flex min-w-0 flex-1 flex-col">
      {/* --- Bandeau superieur : marque, navigation, alertes, profil ------- */}
      <header
        className={cn(
          'sans-impression z-30 flex shrink-0 items-center gap-2 border-b border-bordure bg-surface px-3',
          estBureau() ? 'zone-glisser h-11' : 'h-12',
        )}
      >
        {/* Marque — UNIQUEMENT quand rien d'autre ne la porte.

            La barre laterale affiche deja le sigle et le nom en haut de sa
            colonne. Les repeter ici mettait la marque deux fois sur le meme
            ecran, a dix centimetres d'ecart, et volait a l'entete la largeur
            du fil d'Ariane. En disposition « barre du haut », il n'y a pas de
            barre laterale : la marque revient ici. */}
        {reglages.disposition === 'entete' && (
          <>
            <Link to="/" className="flex shrink-0 items-center gap-2">
              <div className="grid size-7 place-items-center rounded-[var(--radius-sm)] bg-primaire text-[11px] font-bold text-primaire-texte">
                GF
              </div>
              <div className="hidden min-w-0 sm:block">
                <div className="truncate text-[13px] font-semibold leading-tight">Gestion Fil</div>
                <div className="truncate text-[10px] leading-tight text-attenue-texte">
                  Polyfashions Carpet
                </div>
              </div>
            </Link>

            <div className="mx-1 hidden h-5 w-px shrink-0 bg-bordure xl:block" />
          </>
        )}

        {/* La navigation vit desormais dans la barre laterale. Il reste ici
            le fil d'Ariane de l'ecran courant, qui dit OU l'on est — la barre
            dit ou l'on peut aller, ce n'est pas la meme question. */}
        {reglages.disposition === 'laterale' ? (
          /* La barre laterale porte deja la navigation : l'entete ne dit plus
             que l'ecran courant. Ou l'on peut aller et ou l'on est sont deux
             questions differentes, et les melanger encombre. */
          <div className="hidden min-w-0 flex-1 items-center gap-1.5 text-[13px] md:flex">
            <span className="truncate font-medium text-texte">
              {courante?.libelle ?? 'Gestion Fil'}
            </span>
            {courante && (
              <span className="truncate text-attenue-texte">
                · {MODULES.find((m) => m.id === courante.section)?.libelle}
              </span>
            )}
          </div>
        ) : (
          <NavigationEntete accessibles={accessibles} courante={courante} />
        )}

        {/* Navigation repliee en dessous de 1280 px */}
        <div className="min-w-0 flex-1 xl:hidden">
          <Bouton
            variante="discret"
            taille="sm"
            onClick={() => setTiroir(true)}
            className="gap-1.5"
          >
            <MenuIcone />
            <span className="truncate">{courante?.libelle ?? 'Menu'}</span>
            <ChevronDown className="size-3 opacity-60" />
          </Bouton>
        </div>

        {/* Apparence : un tiroir plutot qu'une page, pour que le tableau
            reste visible pendant qu'on regle sa couleur. */}
        <button
          onClick={() => setApparence(true)}
          aria-label="Apparence"
          title="Theme, caracteres, disposition"
          className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-sm)] text-attenue-texte transition-colors hover:bg-attenue hover:text-texte"
        >
          <Palette className="size-4" />
        </button>

        {/* Alertes */}
        <Menu>
          <MenuDeclencheur asChild>
            <button
              className="relative grid size-7 shrink-0 place-items-center rounded-[var(--radius-sm)] text-attenue-texte transition-colors hover:bg-attenue hover:text-texte"
              aria-label={`Alertes${alertes.length ? ` (${alertes.length})` : ''}`}
            >
              <Bell className="size-4" />
              {alertes.length > 0 && (
                <span
                  className={cn(
                    'absolute -right-0.5 -top-0.5 grid min-w-3.5 place-items-center rounded-full px-1',
                    'text-[9px] font-semibold leading-[14px] text-white',
                    bloquantes.length ? 'bg-danger' : 'bg-alerte',
                  )}
                >
                  {alertes.length}
                </span>
              )}
            </button>
          </MenuDeclencheur>
          <MenuContenu className="w-80">
            <MenuTitre>Contrôles de cohérence</MenuTitre>
            {alertes.length === 0 ? (
              <div className="px-2 py-3 text-center text-[12px] text-attenue-texte">
                {qControles.isLoading ? 'Verification...' : 'Aucune anomalie detectee.'}
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {alertes.map((c) => (
                  <MenuElement key={c.code} asChild>
                    {/* VERS LES CONTROLES, PAS VERS L'ACCUEIL. Ce lien visait
                        « / » du temps ou le tableau de bord y logeait ; depuis
                        que l'accueil a pris cette adresse, cliquer une alerte
                        menait a une page qui ne parle pas d'elle. */}
                    <Link to="/controles">
                      <ShieldAlert
                        className={c.criticite === 'BLOQUANT' ? 'text-danger' : 'text-alerte'}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px]">{c.controle}</span>
                        <span className="block text-[10px] text-attenue-texte">
                          {c.code} · {c.criticite.toLowerCase()}
                        </span>
                      </span>
                      <Badge ton={c.criticite === 'BLOQUANT' ? 'danger' : 'alerte'}>
                        {c.anomalies}
                      </Badge>
                    </Link>
                  </MenuElement>
                ))}
              </div>
            )}
          </MenuContenu>
        </Menu>

        {/* Profil */}
        <Menu>
          <MenuDeclencheur asChild>
            <button className="flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] px-1 py-1 transition-colors hover:bg-attenue">
              <div className="grid size-6 place-items-center rounded-full bg-accent text-[10px] font-semibold text-accent-texte">
                {moi?.login.slice(0, 2).toUpperCase()}
              </div>
              <div className="hidden min-w-0 text-left lg:block">
                <div className="truncate text-[12px] leading-tight">{moi?.login}</div>
                <div className="truncate text-[10px] leading-tight text-attenue-texte">
                  {moi?.role}
                </div>
              </div>
              <ChevronDown className="hidden size-3 opacity-60 lg:block" />
            </button>
          </MenuDeclencheur>
          <MenuContenu className="w-56">
            <MenuTitre>
              {moi?.login} — {moi?.role}
            </MenuTitre>
            <MenuSeparateur />
            <MenuTitre>Apparence</MenuTitre>
            {(
              [
                ['clair', 'Clair', Sun],
                ['sombre', 'Sombre', Moon],
                ['systeme', 'Systeme', Monitor],
              ] as const
            ).map(([valeur, libelle, Icone]) => (
              <MenuElement key={valeur} onSelect={() => definir(valeur)}>
                <Icone />
                {libelle}
                {theme === valeur && (
                  <Badge ton="contour" className="ml-auto">
                    actif
                  </Badge>
                )}
              </MenuElement>
            ))}
            <MenuSeparateur />
            <MenuElement onSelect={() => setDoubleAuth(true)}>
              <ShieldCheck />
              Double authentification
            </MenuElement>
            <MenuElement onSelect={() => setMotDePasse(true)}>
              <KeyRound />
              Changer mon mot de passe
            </MenuElement>
            <MenuSeparateur />
            <MenuElement destructif onSelect={deconnecter}>
              <LogOut />
              Se deconnecter
            </MenuElement>
          </MenuContenu>
        </Menu>
      </header>

      {/* --- Tiroir de navigation : sous 1280 px -------------------------- */}
      {tiroir && (
        <div
          className="sans-impression fixed inset-0 z-40 xl:hidden"
          onClick={() => setTiroir(false)}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute inset-x-0 top-0 max-h-[85vh] overflow-y-auto border-b border-bordure bg-surface p-3 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {GROUPES.map((section) => {
                const entrees = accessibles.filter((e) => e.section === section)
                if (!entrees.length) return null
                return (
                  <div key={section}>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                      {MODULES.find((m) => m.id === section)?.libelle ?? section}
                    </div>
                    <div className="space-y-0.5">
                      {entrees.map((e) => (
                        <LienNav
                          key={e.vers}
                          e={e}
                          end={e.vers === '/'}
                          className={({ isActive }) => lienNav(isActive)}
                        >
                          <e.Icone className="size-3.5" />
                          {e.libelle}
                        </LienNav>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* --- Contenu ------------------------------------------------------ */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div
          // Pas de largeur maximale : une table de quinze colonnes se lit
          // mieux etalee que centree entre deux marges vides. La densite
          // reste reglable, la largeur suit la fenetre.
          className="p-3 lg:p-4"
          style={{ paddingBottom: 'calc(4rem + var(--marge-sure-bas))' }}
        >
          <Outlet key={emplacement.pathname} />
        </div>
      </main>

      {/* LA BARRE DE PIED PORTE LES COORDONNEES DE L'ENTREPRISE.
          Elle ne portait que l'etat des controles et le nom du compte — deux
          choses qu'on lit deja ailleurs. Le telephone et l'adresse du siege,
          eux, se cherchent : ils sont sur les documents papier, jamais a
          l'ecran, et on finit par les demander a quelqu'un. Ils viennent de la
          base (`/api/entreprise`), donc un changement d'adresse se voit
          partout sans recompiler.

          L'ORDRE SUIT L'IMPORTANCE : l'etat des donnees a gauche, l'identite au
          centre, le compte a droite. Sous 1024 px l'identite disparait — sur un
          telephone, la place manque et l'etat prime. */}
      {reglages.piedVisible && (
        <footer className="sans-impression flex h-7 shrink-0 items-center gap-4 border-t border-bordure bg-barre px-3 text-[11px] text-attenue-texte">
          <span className="flex shrink-0 items-center gap-1.5">
            <span
              className={cn(
                'size-1.5 rounded-full',
                bloquantes.length ? 'bg-danger' : alertes.length ? 'bg-alerte' : 'bg-succes',
              )}
            />
            {alertes.length
              ? `${alertes.length} controle(s) en anomalie`
              : `${qControles.data?.length ?? 0} controles au vert`}
          </span>

          {entreprise.nom && (
            <span className="hidden min-w-0 flex-1 items-center justify-center gap-2 truncate lg:flex">
              <span className="font-medium text-texte">{entreprise.nom}</span>
              {entreprise.groupe && <span>· {entreprise.groupe}</span>}
              {entreprise.adresse && <span className="truncate">· {entreprise.adresse}</span>}
              {entreprise.telephone && (
                <span className="shrink-0">· Tel. {entreprise.telephone}</span>
              )}
            </span>
          )}

          <span className="ml-auto shrink-0">{moi?.login} · {moi?.role}</span>
        </footer>
      )}
      </div>

      {/* Le tiroir d'apparence : hors de la colonne de contenu, il se pose
          par-dessus tout et n'entre dans aucun flux. */}
      {/* Le robot de connexion : il s'ouvre seul a la premiere page de la
          session, et se rappelle par son bouton. */}
      <RobotConnexion />
      <PanneauApparence ouvert={apparence} surFermeture={() => setApparence(false)} />
      <ChangerMotDePasse ouvert={motDePasse} surFermeture={() => setMotDePasse(false)} />
      <DoubleAuthentification ouvert={doubleAuth} surFermeture={() => setDoubleAuth(false)} />

      {/* --- Barre du bas : mobile ---------------------------------------- */}
      {principales.length > 1 && (
        <nav
          className="sans-impression fixed inset-x-0 bottom-0 z-30 flex border-t border-bordure bg-surface md:hidden"
          style={{ paddingBottom: 'var(--marge-sure-bas)' }}
        >
          {principales.map((e) => (
            <NavLink
              key={e.vers}
              to={e.vers}
              end={e.vers === '/'}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition-colors',
                  isActive ? 'text-primaire' : 'text-attenue-texte',
                )
              }
            >
              <e.Icone className="size-4" />
              {e.libelle}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}

/** En-tete de page, uniforme sur tous les ecrans. */
export function EnTetePage({
  titre,
  description,
  actions,
}: {
  titre: string
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  const calculable = useEcranCalcule()
  return (
    /* L'EN-TETE SUIT LE DEFILEMENT, PARCE QUE C'EST LUI QUI PORTE « VALIDER »
       ET « RETOUR ». Sur une table de plusieurs centaines de lignes, ces deux
       boutons disparaissaient des qu'on descendait : il fallait remonter tout
       en haut pour valider, puis redescendre pour verifier. Un ecran de saisie
       ou l'action s'eloigne de la saisie est un ecran qu'on abandonne.

       Le fond est OPAQUE et la marge negative compense le rembourrage du
       conteneur : sans elle, les lignes du tableau defileraient visiblement
       dans la gouttiere, de part et d'autre de l'en-tete.

       LES DECALAGES SONT EN CSS PUR, PAS MESURES EN JAVASCRIPT. J'avais d'abord
       publie la hauteur reelle depuis un `useEffect` : ajouter des crochets a ce
       composant a fait planter toute l'application — React refuse qu'un
       composant change son nombre de crochets d'un rendu a l'autre. Deux
       regimes de hauteur suffisent : compact des `sm`, plus haut en dessous ou
       les actions passent a la ligne. */
    <div
      className="sticky top-0 z-30 mb-3 -mx-3 flex flex-wrap items-center justify-between gap-3
                 border-b border-bordure bg-fond px-3 pb-2 pt-1 sm:-mx-4 sm:px-4"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <h1 className="text-[15px] font-semibold leading-tight tracking-tight">{titre}</h1>
        {/* L'AIDE DE L'ECRAN, ici et nulle part ailleurs. Elle trouve sa fiche
            par la route courante : aucun ecran n'a a la declarer, donc aucun ne
            peut l'oublier. */}
        <AideEcran description={description} />
      </div>
      {/* LES ACTIONS PRENNENT LEUR PROPRE LIGNE SUR TELEPHONE.

          `flex-wrap` ne suffisait pas : le titre porte `min-w-0`, donc le
          navigateur le RETRECIT au lieu de passer les actions a la ligne — et
          les boutons, eux, ne se retrecissent pas. Resultat, ils sortaient de
          l'ecran. `w-full` en dessous de `sm` tranche : les actions descendent,
          alignees a droite, et rien ne deborde. */}
      {/* LE RAFRAICHISSEMENT SE PLACE SEUL, COMME L'AIDE D'ECRAN. Il connait la
          liste des ecrans calcules et ne s'affiche que la : aucun ecran n'a a
          le declarer, donc aucun ne peut l'oublier. Il vient EN DERNIER, apres
          les actions propres a la page — « Valider » et « Enregistrer »
          gardent la place de droite, qui est celle qu'on cherche. */}
      {(actions || calculable) && (
        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
          {actions}
          <BoutonRafraichir />
        </div>
      )}
    </div>
  )
}
