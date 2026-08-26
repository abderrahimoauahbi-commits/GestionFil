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
  Link2,
  BarChart3,
  Bell,
  Boxes,
  Calculator,
  ChevronDown,
  ClipboardList,
  Factory,
  FileText,
  Gauge,
  LayoutGrid,
  LogOut,
  Menu as MenuIcone,
  Monitor,
  Moon,
  Package,
  PackageSearch,
  Settings,
  ShieldAlert,
  ShoppingCart,
  Sun,
  Truck,
  Users,
  Coins,
  FileSpreadsheet,
  Library,
  Receipt,
  ScrollText,
  Ship,
  SlidersHorizontal,
  Sparkles,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { cn, estBureau } from '../lib/utils'
import { useTheme } from './Theme'
import { Badge, Bouton } from './ui/base'
import {
  Aide,
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
 * Le rail de gauche porte ces sept entrees et rien d'autre : ce sont les
 * grandes fonctions de l'entreprise, pas des vues d'outil. Le sous-menu du
 * module actif s'affiche dans le bandeau superieur.
 *
 * Une precision de vocabulaire qui compte ici : dans cette usine, « qualite »
 * designe une **qualite de tapis** (SH, LP, ...), pas le controle qualite. Les
 * qualites sont donc rangees en Production, et le controle qualite reste ou il
 * se pratique — dans la reception, au moment de la pesee.
 */
export type Section =
  | 'PILOTAGE'
  | 'STOCK'
  | 'MRP'
  | 'PRODUCTION'
  | 'ACHATS'
  | 'FINANCE'
  | 'ADMIN'

export const MODULES: {
  id: Section
  libelle: string
  resume: string
  Icone: LucideIcon
}[] = [
  { id: 'PILOTAGE', libelle: 'Pilotage', resume: 'Indicateurs et alertes', Icone: Gauge },
  { id: 'STOCK', libelle: 'Stock', resume: 'Mouvements, inventaires, receptions', Icone: Boxes },
  { id: 'MRP', libelle: 'MRP', resume: 'Plans, besoins, stock projete', Icone: Calculator },
  { id: 'PRODUCTION', libelle: 'Production', resume: 'Qualites et compositions', Icone: Factory },
  { id: 'ACHATS', libelle: 'Achats', resume: "Plan d'achat, commandes, fournisseurs", Icone: ShoppingCart },
  { id: 'FINANCE', libelle: 'Finance', resume: 'Valorisation, classification, rapports', Icone: Calculator },
  { id: 'ADMIN', libelle: 'Parametres', resume: 'Referentiels, droits, audit', Icone: Settings },
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
  if (!peut(entree.module, 'LIRE')) return false
  if (entree.roles && !entree.roles.includes(role ?? '')) return false
  return true
}

export const NAVIGATION: EntreeNav[] = [
  /* --- 1. Pilotage ------------------------------------------------------- */
  { vers: '/', libelle: 'Cockpit', module: 'COCKPIT', Icone: Gauge, section: 'PILOTAGE', principale: true },
  { vers: '/stock', libelle: 'Stock projete', module: 'STOCK', Icone: PackageSearch, section: 'MRP' },
  { vers: '/statistiques', libelle: 'Statistiques', module: 'MOUVEMENTS', Icone: BarChart3, section: 'PILOTAGE' },
  {
    vers: '/assistant',
    libelle: 'Assistant',
    module: 'COCKPIT',
    Icone: Sparkles,
    section: 'PILOTAGE',
    roles: ['DIRECTION'],
  },

  /* --- 2. Stock ---------------------------------------------------------- */
  { vers: '/etat-stock', libelle: 'Etat de stock', module: 'STOCK', Icone: Warehouse, section: 'STOCK', principale: true },
  { vers: '/mouvements', libelle: 'Mouvements', module: 'MOUVEMENTS', Icone: Boxes, section: 'STOCK', principale: true },
  { vers: '/transferts', libelle: 'Transferts', module: 'MOUVEMENTS', Icone: Truck, section: 'STOCK' },
  { vers: '/inventaires', libelle: 'Inventaires', module: 'INVENTAIRE', Icone: ClipboardList, section: 'STOCK' },
  { vers: '/receptions', libelle: 'Receptions', module: 'RECEPTIONS', Icone: Package, section: 'STOCK', principale: true },

  /* --- 3. Production ----------------------------------------------------- */
  { vers: '/qualites', libelle: 'Qualites', module: 'QUALITES', Icone: Factory, section: 'PRODUCTION' },
  { vers: '/recettes', libelle: 'Compositions', module: 'RECETTES', Icone: FileText, section: 'PRODUCTION' },
  { vers: '/plans', libelle: 'Plans', module: 'PLANS', Icone: LayoutGrid, section: 'MRP' },
  { vers: '/besoins', libelle: 'Calcul des besoins', module: 'MRP', Icone: Calculator, section: 'MRP', principale: true },

  /* --- 4. Achats --------------------------------------------------------- */
  { vers: '/plan-achat', libelle: "Plan d'achat", module: 'PLAN_ACHAT', Icone: ShoppingCart, section: 'ACHATS' },
  { vers: '/bons-commande', libelle: 'Bons de commande', module: 'BONS_COMMANDE', Icone: Receipt, section: 'ACHATS' },
  { vers: '/catalogue', libelle: 'Catalogue', module: 'CATALOGUE', Icone: Package, section: 'ACHATS', principale: true },
  { vers: '/fournisseurs', libelle: 'Fournisseurs', module: 'FOURNISSEURS', Icone: Truck, section: 'ACHATS' },
  { vers: '/equivalences', libelle: 'Equivalences', module: 'CATALOGUE', Icone: Link2, section: 'ACHATS' },

  /* --- 5. Finance & valorisation ----------------------------------------- */
  { vers: '/valorisation', libelle: 'Valorisation stock', module: 'VALORISATION', Icone: Coins, section: 'FINANCE' },
  {
    vers: '/classification',
    libelle: 'Analyse ABC / XYZ',
    module: 'STOCK',
    Icone: BarChart3,
    section: 'FINANCE',
    aVenir: "Les colonnes existent, mais la classification n'a jamais ete calculee sur cette base.",
  },
  {
    vers: '/rapports',
    libelle: 'Rapports',
    module: 'VALORISATION',
    Icone: FileSpreadsheet,
    section: 'FINANCE',
    aVenir: "Export comptable et valorisation globale : format a arreter avec la DAF.",
  },
  {
    vers: '/landed-cost',
    libelle: 'Cout de revient complet',
    module: 'VALORISATION',
    Icone: Ship,
    section: 'FINANCE',
    aVenir: "Necessite les frais de transport et de douane, qui vivent dans l'ERP transitaire.",
  },

  /* --- 6. Parametres & administration ------------------------------------ */
  { vers: '/referentiels', libelle: 'Referentiels', module: 'CATALOGUE', Icone: Library, section: 'ADMIN' },
  { vers: '/utilisateurs', libelle: 'Utilisateurs & droits', module: 'UTILISATEURS', Icone: Users, section: 'ADMIN' },
  { vers: '/parametres', libelle: 'Parametres systeme', module: 'PARAMETRES', Icone: Settings, section: 'ADMIN' },
  { vers: '/configuration', libelle: 'Champs & affichage', module: 'PARAMETRES', Icone: SlidersHorizontal, section: 'ADMIN' },
  { vers: '/audit', libelle: "Journal d'audit", module: 'AUDIT', Icone: ScrollText, section: 'ADMIN' },
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

  const accessibles = NAVIGATION.filter((e) => estAccessible(e, peut, moi?.role))
  const principales = accessibles.filter((e) => e.principale).slice(0, 4)
  const courante = accessibles.find(
    (e) =>
      e.vers === emplacement.pathname ||
      (e.vers !== '/' && emplacement.pathname.startsWith(e.vers)),
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

  const lienNav = (actif: boolean) =>
    cn(
      'flex items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[13px]',
      'whitespace-nowrap transition-colors',
      actif
        ? 'bg-attenue font-medium text-texte'
        : 'text-attenue-texte hover:bg-attenue hover:text-texte',
    )

  /** Un groupe de la navigation, en menu deroulant. */
  const groupeMenu = (section: Section) => {
    const entrees = accessibles.filter((e) => e.section === section)
    if (!entrees.length) return null
    const actif = entrees.some((e) => e.vers === courante?.vers)
    return (
      <Menu key={section}>
        <MenuDeclencheur asChild>
          <button
            className={cn(
              'flex items-center gap-1 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[13px]',
              'whitespace-nowrap transition-colors',
              actif
                ? 'bg-attenue font-medium text-texte'
                : 'text-attenue-texte hover:bg-attenue hover:text-texte',
            )}
          >
            {MODULES.find((m) => m.id === section)?.libelle ?? section}
            <ChevronDown className="size-3 opacity-60" />
          </button>
        </MenuDeclencheur>
        <MenuContenu align="start" className="w-56">
          {entrees.map((e) => (
            <MenuElement key={e.vers} asChild>
              <NavLink to={e.vers} end={e.vers === '/'}>
                <e.Icone />
                {e.libelle}
                {e.vers === courante?.vers && (
                  <Badge ton="contour" className="ml-auto">
                    ici
                  </Badge>
                )}
              </NavLink>
            </MenuElement>
          ))}
        </MenuContenu>
      </Menu>
    )
  }

  return (
    <div className="flex h-full flex-col bg-fond">
      {/* --- Bandeau superieur : marque, navigation, alertes, profil ------- */}
      <header
        className={cn(
          'sans-impression z-30 flex shrink-0 items-center gap-2 border-b border-bordure bg-surface px-3',
          estBureau() ? 'zone-glisser h-11' : 'h-12',
        )}
      >
        {/* Marque */}
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

        {/* Navigation en clair au-dela de 1280 px */}
        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 xl:flex">
          {accessibles
            .filter((e) => e.vers === '/')
            .map((e) => (
              <NavLink key={e.vers} to={e.vers} end className={({ isActive }) => lienNav(isActive)}>
                <e.Icone className="size-3.5" />
                {e.libelle}
              </NavLink>
            ))}
          {GROUPES.filter((g) => g !== 'PILOTAGE').map(groupeMenu)}
          {/* Pilotage hors cockpit : rattache au premier groupe pour ne pas
              multiplier les menus a une seule entree. */}
          {accessibles
            .filter((e) => e.section === 'PILOTAGE' && e.vers !== '/')
            .map((e) => (
              <NavLink key={e.vers} to={e.vers} className={({ isActive }) => lienNav(isActive)}>
                <e.Icone className="size-3.5" />
                {e.libelle}
              </NavLink>
            ))}
        </nav>

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
            <MenuTitre>Controles de coherence</MenuTitre>
            {alertes.length === 0 ? (
              <div className="px-2 py-3 text-center text-[12px] text-attenue-texte">
                {qControles.isLoading ? 'Verification...' : 'Aucune anomalie detectee.'}
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {alertes.map((c) => (
                  <MenuElement key={c.code} asChild>
                    <Link to="/">
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
                        <NavLink
                          key={e.vers}
                          to={e.vers}
                          end={e.vers === '/'}
                          className={({ isActive }) => lienNav(isActive)}
                        >
                          <e.Icone className="size-3.5" />
                          {e.libelle}
                        </NavLink>
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
          className="mx-auto max-w-[1900px] p-3 lg:p-4"
          style={{ paddingBottom: 'calc(4rem + var(--marge-sure-bas))' }}
        >
          <Outlet key={emplacement.pathname} />
        </div>
      </main>

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
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-bordure pb-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <h1 className="text-[15px] font-semibold leading-tight tracking-tight">{titre}</h1>
        {/* La description tient dans une aide plutot que sous le titre : trois
            lignes de prose en tete d'ecran repoussent le contenu utile. */}
        {description && <Aide>{description}</Aide>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  )
}
