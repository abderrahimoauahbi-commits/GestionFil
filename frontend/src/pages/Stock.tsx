/**
 * LE STOCK PROJETÉ — TROIS ONGLETS (décisions du 27 et du 30/10/2026).
 *
 *   * STOCK PROJETÉ (§ 16, 30/10/2026) : COMBIEN COMMANDER, sans chronologie.
 *     Quatre vues sur les mêmes lignes, UNE SEULE LIGNE par référence, sans ↳
 *     (décision du 30/10/2026), les trois mêmes colonnes en tête de chacune :
 *     référence, fournisseur, état (31/10/2026). APPROVISIONNEMENT (stock
 *     disponible, sur machine, en route, position, couverture — en négatif les
 *     jours sans fil jusqu'au prochain approvisionnement —, cible, à commander, montant), RISQUES
 *     (avant le, ABC, rang, % cumulé, valeur 12 mois, XYZ, CV, palier), SOURCING
 *     (délai, sources, groupe d'équivalence, substituts en stock, couverture du
 *     substitut, sans mouvement, dormant), ces deux-là lus à leur ouverture, et
 *     EMPLACEMENTS (disponible total, un magasin par colonne, sur machines,
 *     restes, quarantaine, en route = transferts, commandé, stock global après
 *     l'arrivage). Le bouton RATTRAPAGE (barre d'outils, et sur la ligne qui a un
 *     manque) dit si le manque avant un arrivage tardif reste dû ; il revient à
 *     « inclus » à chaque ouverture. Le clic sur la ligne ouvre la fenêtre du
 *     détail (tuiles, approvisionnement, calcul, classement, où se trouve la
 *     matière, onglets).
 *   * SIMULATION : « et si ? » sur une référence, recalculé par le même moteur ;
 *     rien n'est jamais enregistré.
 *   * SURVEILLANCE : le tableau « À commander », déplacé du plan d'achat
 *     (27/10/2026), sans bouton « Commander » pour l'instant ; le clic ouvre la
 *     fenêtre de détail du plan d'achat (non enrichie).
 *
 * Chaque chiffre vient de `routes/couverture.rs` (une seule source de vérité) :
 * aucune formule de besoin n'est refaite ici. Le filtrage du premier onglet passe
 * par le RAIL : il porte le NOMBRE de références derrière chaque état.
 */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  History,
  Layers,
  Repeat,
  Shuffle,
  ShoppingCart,
  Siren,
  FlaskConical,
  Target,
  Warehouse,
} from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/utils'
import { EnTetePage } from '../components/Layout'
import { PageAvecRail, RailLateral, type GroupeRail } from '../composants/RailLateral'
import { PanneauFiltres, useFiltres, type ChampFiltre } from '../composants/PanneauFiltres'
import { DataTable, type ColonneDT as Colonne } from '../composants/DataTable'
import { fmt } from '../lib/utils'
import {
  MenuContextuelElement,
  MenuContextuelSeparateur,
  MenuContextuelTitre,
} from '../composants/ui/surcouches'
import { useOuvrirVue } from '../lib/navigation'
import { Alerte, Bouton } from '../composants/ui/base'
import { Onglet, OngletContenu, Onglets, OngletsListe } from '../composants/ui/surcouches'
import { libelleStatut } from '../lib/statuts'
import { useParametreNombre } from '../lib/parametres'
import { useDroits } from '../auth/AuthContext'
import { ListeCouverture } from '../composants/couverture/ListeCouverture'
import { ModaleReference } from '../composants/couverture/ModaleCouverture'
import { SimulationCouverture } from '../composants/couverture/Simulation'
import { dateListe, type SignalCouverture } from '../composants/couverture/types'
import { StatutBadge } from '../composants/StatutBadge'

const MODULE = 'STOCK'

/** Une ligne : celle de l'onglet « À commander », avec ce que le stock dit en plus. */
interface LigneProjete {
  code_reference: string
  designation: string | null
  fournisseur_nom: string | null
  classe_abc: string | null
  classe_xyz: string | null
  unite_catalogue: string | null
  /** L'état du stock projeté : ALERTE | SOUS_CIBLE | COUVERT (§ 16.4). */
  statut: string
  // ---- Le stock projeté (§ 16, 30/10/2026) ----
  /** Le plan pendant le délai, P(0, L). */
  besoin_delai_kg?: number | null
  /** Aujourd'hui + (couverture projetée − cible) ; passé : en retard. */
  avant_le?: string | null
  /** L'option de rattrapage appliquée à la ligne. */
  rattrapage?: boolean
  /** Les restes comptés dans le stock (31/10/2026, réglage ou bouton). */
  restes_comptes?: boolean
  // ---- Les attributs matière des filtres (31/10/2026) ----
  composition?: string | null
  role?: string | null
  type_fil?: string | null
  titrage?: string | null
  couleur?: string | null
  /** Le plan non servi avant un arrivage tardif (kg). */
  manque_kg?: number | null
  seuil_alerte_j?: number | null
  couverture_livraison_j?: number | null
  /** Les jours sans fil jusqu'au prochain approvisionnement : montrés en négatif dans la couverture. */
  jours_sans_fil?: number | null
  // ---- Onglet Emplacements (31/10/2026) ----
  /** Chaque magasin au plan : kg comptés, hors bloqués et hors restes. */
  stock_par_magasin?: Record<string, number> | null
  /** Les transferts entre magasins, en route. */
  transit_kg?: number | null
  /** Les autres arrivages datés (bons validés). */
  commande_kg?: number | null
  /** Disponible + quarantaine + en route + commandé. */
  stock_apres_arrivage_kg?: number | null
  /** Ce qui arrive après aujourd'hui + délai (trop tard contre une rupture). */
  en_route_apres_delai_kg?: number | null
  // ---- Les paliers de rupture (31/10/2026) ----
  /** Jours jusqu'au premier jour sans fil ; null : jamais sur l'horizon. */
  rupture_j?: number | null
  rupture_le?: string | null
  /** RUPTURE | IMMINENTE | CRITIQUE | ATTENTION ; null : au-delà du seuil d'attention. */
  palier_rupture?: string | null
  palier_suivant?: string | null
  date_palier_suivant?: string | null
  /** Le premier trou avant un camion connu. */
  a_sec?: { date_sec: string; date_arrivage: string; jours: number; manque_kg: number } | null
  // ---- Onglet Risques ----
  rang?: number | null
  pct_cumule?: number | null
  valeur_conso_annuelle_mad?: number | null
  coef_variation_xyz?: number | null
  politique?: string | null
  tier?: string | null
  // ---- Onglet Sourcing ----
  nb_sources?: number | null
  risque_source?: string | null
  code_groupe_equiv?: string | null
  groupe_libelle?: string | null
  nb_substituts?: number | null
  substituts_stock_kg?: number | null
  /** La meilleure couverture projetée des substituts en stock ; « horizon » : tout l'horizon. */
  substitut_couverture_j?: number | string | null
  derniere_sortie?: string | null
  jours_sans_mouvement?: number | null
  dormant?: boolean | null
  /** Les signaux, à part de l'état (§ 15.4) : lus dans la fenêtre de détail seulement. */
  signaux?: SignalCouverture[]
  /** La raison de l'état, en une phrase chiffrée (infobulle de l'état). */
  raison_etat?: string | null
  /** La réception proposée D (1re proposition), « en retard » quand la cible l'est. */
  date_disponibilite?: string | null
  reception_en_retard?: boolean | null
  /** Le plan daté de [aujourd'hui, D[ ; null sans réception proposée. */
  besoin_jusqu_reception_kg?: number | null
  /** La quantité à commander en palettes, quand le conditionnement est connu. */
  palettes_equivalentes?: number | null
  /** L'horizon du plan en jours (« > N j » sans rupture). */
  horizon_j?: number | null
  source_delai?: string | null
  /** C, la couverture cible (jours), sa source, et l'écart couverture − C. */
  couverture_cible_j?: number | null
  source_cible?: string | null
  ecart_cible_j?: number | null
  /** Jours couverts depuis aujourd'hui jusqu'à la veille de la 1re rupture ; null : tout l'horizon. */
  jours_couverture: number | null
  disponible_kg: number
  magasin_kg: number
  machine_kg: number
  kg_sur_machine: number | null
  plan_horizon_kg: number
  couvert_jusqu_au: string | null
  couvert_tout_horizon: boolean
  premiere_rupture: string | null
  premier_passage_securite: string | null
  plan_non_couvert_kg: number
  arrivages_comptes_kg: number
  prochain_arrivage_date: string | null
  prochain_arrivage_kg: number | null
  qte_a_commander_kg: number | null
  date_limite_commande: string | null
  a_commander_aujourdhui: boolean
  delai_j: number
  defaut_donnees: string | null
  quarantaine_kg: number
  bloque_kg: number
  restes_kg: number
  en_retard_kg: number
  sans_date_kg: number
  stock_physique_net_kg: number | null
  /** Le plan ramené à un mois de 30 jours, tel que le moteur le consomme. */
  plan_mois_kg: number | null
  cmup_mad: number | null
  // ---- Les colonnes du stock projeté (27/10/2026), tirées du moteur ----
  magasin_hors_restes_kg: number
  machine_hors_restes_kg: number
  restant_kg: number
  stock_total_projete_kg: number
  besoin_jusqu_livraison_kg: number
  securite_aujourdhui_kg: number
  /** Le prix du plan d'achat et le montant de la 1re proposition : masqués selon les droits. */
  prix_estime_mad?: number | null
  source_prix?: string
  montant_estime_mad?: number | null
  [k: string]: unknown
}

/** Ce que les onglets Risques et Sourcing lisent en plus (`/api/stock/projete/complements`). */
interface ComplementProjete {
  code_reference: string
  rang?: number | null
  pct_cumule?: number | null
  valeur_conso_annuelle_mad?: number | null
  coef_variation_xyz?: number | null
  politique?: string | null
  tier?: string | null
  nb_sources?: number | null
  risque_source?: string | null
  code_groupe_equiv?: string | null
  groupe_libelle?: string | null
  nb_substituts?: number | null
  substituts_stock_kg?: number | null
  /** Les substituts en stock, séparés par « | ». */
  substituts_en_stock?: string | null
  derniere_sortie?: string | null
  jours_sans_mouvement?: number | null
  dormant?: boolean | null
}

const kg = (v: number | null | undefined, d = 0) => fmt.nombre(v ?? 0, d)

/** Les états du stock projeté (§ 16.4), ce qu'ils veulent dire, et la couleur de leur compteur. */
const ETATS = [
  {
    cle: 'ALERTE',
    resume: 'À la livraison, la couverture passe sous le seuil d’alerte (sécurité + stock minimum)',
    Icone: AlertTriangle,
    ton: 'danger' as const,
  },
  {
    cle: 'SOUS_CIBLE',
    resume: 'La couverture projetée est sous la cible : une quantité est proposée',
    Icone: Target,
    ton: 'alerte' as const,
  },
  {
    cle: 'COUVERT',
    resume: 'La couverture projetée atteint la cible',
    Icone: CheckCircle2,
    ton: 'succes' as const,
  },
]

/** Les paliers de rupture (31/10/2026), du plus grave au moins grave. */
const PALIERS = [
  { cle: 'RUPTURE', resume: 'Sans fil dès aujourd’hui', Icone: Siren, ton: 'danger' as const },
  { cle: 'IMMINENTE', resume: 'Le fil manque dans moins de P_SeuilImminent jours', Icone: AlertTriangle, ton: 'danger' as const },
  { cle: 'CRITIQUE', resume: 'Le fil manque dans moins de P_SeuilCritique jours', Icone: AlertTriangle, ton: 'alerte' as const },
  { cle: 'ATTENTION', resume: 'Le fil manque dans moins de P_SeuilAlerte jours', Icone: CalendarClock, ton: 'neutre' as const },
]

/** Les quatre vues du stock projeté (§ 16.5 ; Emplacements le 31/10/2026). */
const VUES = [
  { cle: 'appro', libelle: 'Approvisionnement' },
  { cle: 'risques', libelle: 'Risques' },
  { cle: 'sourcing', libelle: 'Sourcing' },
  { cle: 'emplacements', libelle: 'Emplacements' },
] as const
type VueProjete = (typeof VUES)[number]['cle']

/**
 * Filtres : des axes que l'on choisit, jamais un comparateur à saisir.
 */
const CHAMPS_FILTRABLES: ChampFiltre<LigneProjete>[] = [
  { cle: 'statut', libelle: 'État', type: 'liste', valeur: (l) => libelleStatut('statut_projete', l.statut) },
  { cle: 'fournisseur', libelle: 'Fournisseur', type: 'liste', recherche: true, valeur: (l) => l.fournisseur_nom },
  { cle: 'classe', libelle: 'Classe ABC', type: 'liste', valeur: (l) => l.classe_abc },
  { cle: 'reference', libelle: 'Référence', type: 'texte', valeur: (l) => l.code_reference },
  // LES FILTRES MATIÈRE (31/10/2026) : composition et rôle (la catégorie et son
  // rôle par défaut), type de fil, titrage, couleur, magasin principal.
  { cle: 'composition', libelle: 'Composition', type: 'liste', valeur: (l) => l.composition ?? null },
  { cle: 'role', libelle: 'Rôle', type: 'liste', valeur: (l) => l.role ?? null },
  { cle: 'type_fil', libelle: 'Type de fil', type: 'liste', valeur: (l) => l.type_fil ?? null },
  { cle: 'titrage', libelle: 'Titrage', type: 'liste', recherche: true, valeur: (l) => l.titrage ?? null },
  { cle: 'couleur', libelle: 'Couleur', type: 'liste', recherche: true, valeur: (l) => l.couleur ?? null },
  { cle: 'magasin', libelle: 'Magasin principal', type: 'liste', valeur: (l) => magasinPrincipal(l) },
]

/** Le magasin qui porte le plus de stock de la référence (filtre « Magasin »). */
function magasinPrincipal(l: LigneProjete): string | null {
  const entrees = Object.entries(l.stock_par_magasin ?? {}).filter(([, v]) => v > 0.05)
  return entrees.length ? entrees.sort((a, b) => b[1] - a[1])[0][0] : null
}

/**
 * Le menu au clic droit : il n'ouvre aucun chemin nouveau, il porte la référence
 * vers des écrans existants (commande, fiche, mouvements, équivalents, inventaire).
 */
function ActionsLigne({ ligne: l, ouvrir }: { ligne: LigneProjete; ouvrir: (chemin: string) => void }) {
  const ref = encodeURIComponent(l.code_reference)
  const tendu = typeof l.qte_a_commander_kg === 'number' && l.qte_a_commander_kg > 0
  return (
    <>
      <MenuContextuelTitre>{l.code_reference}</MenuContextuelTitre>
      <MenuContextuelSeparateur />
      {tendu && (
        <MenuContextuelElement onSelect={() => ouvrir(`/bons-commande/nouveau?reference=${ref}`)}>
          <ShoppingCart /> Commander cette référence
        </MenuContextuelElement>
      )}
      <MenuContextuelElement onSelect={() => ouvrir(`/catalogue?reference=${ref}`)}>
        <FileText /> Ouvrir la fiche
      </MenuContextuelElement>
      <MenuContextuelElement onSelect={() => ouvrir(`/mouvements?reference=${ref}`)}>
        <History /> Voir l’historique des mouvements
      </MenuContextuelElement>
      <MenuContextuelElement onSelect={() => ouvrir(`/equivalences?reference=${ref}`)}>
        <Shuffle /> Chercher un équivalent
      </MenuContextuelElement>
      {!tendu && (
        <MenuContextuelElement onSelect={() => ouvrir(`/bons-commande/nouveau?reference=${ref}`)}>
          <ShoppingCart /> Commander cette référence
        </MenuContextuelElement>
      )}
      <MenuContextuelSeparateur />
      <MenuContextuelElement onSelect={() => ouvrir('/inventaires')}>
        <ClipboardList /> Lancer un inventaire
      </MenuContextuelElement>
    </>
  )
}

const ONGLETS = ['projete', 'simulation', 'surveillance'] as const
type OngletStock = (typeof ONGLETS)[number]

export function Stock() {
  const [params, setParams] = useSearchParams()
  const ongletLu = params.get('onglet')
  const onglet: OngletStock = (ONGLETS as readonly string[]).includes(ongletLu ?? '') ? (ongletLu as OngletStock) : 'projete'
  // La référence de la simulation, gardée d'un onglet à l'autre (jamais enregistrée).
  const [simulee, setSimulee] = useState<string | null>(params.get('reference'))
  // Le moteur (détail, simulation, surveillance) se lit sous le droit du plan d'achat.
  const lirePlan = useDroits('PLAN_ACHAT').peutLire

  const choisirOnglet = (o: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (o === 'projete') n.delete('onglet')
        else n.set('onglet', o)
        return n
      },
      { replace: true },
    )
  const simuler = (reference: string) => {
    setSimulee(reference)
    choisirOnglet('simulation')
  }

  return (
    <div>
      <EnTetePage
        titre="Stock projeté"
        sous_titre="Combien commander pour être couvert selon la cible : le stock compté, les commandes à leur date, la couverture projetée et la quantité"
      />
      <Onglets value={onglet} onValueChange={choisirOnglet}>
        <OngletsListe className="mb-3 h-auto max-w-full flex-wrap gap-y-0">
          <Onglet value="projete">
            <Warehouse className="size-3.5" />
            Stock projeté
          </Onglet>
          <Onglet value="simulation" disabled={!lirePlan}>
            <FlaskConical className="size-3.5" />
            Simulation
          </Onglet>
          <Onglet value="surveillance" disabled={!lirePlan}>
            <Siren className="size-3.5" />
            Surveillance
          </Onglet>
        </OngletsListe>
        <OngletContenu value="projete">
          <StockProjete lirePlan={lirePlan} surSimuler={lirePlan ? simuler : undefined} />
        </OngletContenu>
        <OngletContenu value="simulation">
          {lirePlan ? (
            <SimulationCouverture reference={simulee} surReference={setSimulee} />
          ) : (
            <PasDeDroitPlan />
          )}
        </OngletContenu>
        <OngletContenu value="surveillance">
          {lirePlan ? <ListeCouverture surSimuler={simuler} exportable="stock-surveillance" /> : <PasDeDroitPlan />}
        </OngletContenu>
      </Onglets>
    </div>
  )
}

function PasDeDroitPlan() {
  return (
    <Alerte ton="info">
      Le détail du moteur de couverture, la simulation et la surveillance se lisent avec le droit de lecture du plan
      d’achat, que votre rôle n’a pas.
    </Alerte>
  )
}

/** Des kilos dans une cellule : « — » pour zéro. */
const kgCellule = (v: number | null | undefined) =>
  typeof v === 'number' && Math.abs(v) > 0.05 ? kg(v) : <span className="text-attenue-texte">—</span>

/** L'ONGLET « STOCK PROJETÉ » (§ 16) : toutes les matières suivies, une ligne chacune, en trois vues. */
function StockProjete({ lirePlan, surSimuler }: { lirePlan: boolean; surSimuler?: (reference: string) => void }) {
  const ouvrir = useOuvrirVue()
  const [filtre, setFiltre] = useState('')
  const [recherche, setRecherche] = useState('')
  const [vue, setVue] = useState<VueProjete>('appro')
  const filtres = useFiltres(CHAMPS_FILTRABLES)
  // LE RATTRAPAGE (§ 16.1-4) : inclus par défaut, non retenu d'une ouverture à
  // l'autre ; les lignes inversées prennent l'option contraire.
  // Le départ est le réglage P_ProjeteRattrapage (31/10/2026) ; le bouton
  // impose l'un ou l'autre pour la session.
  const rattrapageReglage = useParametreNombre('P_ProjeteRattrapage', 1) !== 0
  const [choixRattrapage, setChoixRattrapage] = useState<boolean | null>(null)
  const rattrapage = choixRattrapage ?? rattrapageReglage
  const [inverses, setInverses] = useState<string[]>([])
  // LES RESTES (31/10/2026) : `null` suit le réglage P_ProjeteRestes ; le bouton
  // impose l'un ou l'autre pour la session.
  const [restes, setRestes] = useState<boolean | null>(null)
  // La référence dont la grande fenêtre est ouverte.
  const [ouverte, setOuverte] = useState<LigneProjete | null>(null)

  const q = useQuery({
    queryKey: ['stock-projete', rattrapage, inverses, restes],
    queryFn: ({ signal }) => {
      // Mode léger : sans les compléments du stock que lisent le cockpit et les états.
      const p = new URLSearchParams({ limite: '2000', leger: '1' })
      p.set('rattrapage', rattrapage ? 'inclus' : 'exclu')
      if (inverses.length > 0) p.set('inverses', JSON.stringify(inverses))
      if (restes != null) p.set('restes', restes ? 'comptes' : 'exclus')
      return api.get<LigneProjete[]>(`/api/stock/projete?${p.toString()}`, { signal })
    },
    placeholderData: (avant) => avant,
  })

  const inverser = (reference: string) =>
    setInverses((v) => (v.includes(reference) ? v.filter((x) => x !== reference) : [...v, reference]))
  const optionDe = (reference: string) => rattrapage !== inverses.includes(reference)

  const toutes = useMemo(() => q.data ?? [], [q.data])
  const aCommander = (l: LigneProjete) => typeof l.qte_a_commander_kg === 'number' && l.qte_a_commander_kg > 0

  const comptes = useMemo(() => {
    const m: Record<string, number> = {}
    for (const l of toutes) {
      m[l.statut] = (m[l.statut] ?? 0) + 1
      if (aCommander(l)) m.A_COMMANDER = (m.A_COMMANDER ?? 0) + 1
      if (positifKg(l.manque_kg)) m.MANQUE = (m.MANQUE ?? 0) + 1
      if (l.palier_rupture) m[`PALIER:${l.palier_rupture}`] = (m[`PALIER:${l.palier_rupture}`] ?? 0) + 1
      if (l.classe_abc) m[`ABC:${l.classe_abc}`] = (m[`ABC:${l.classe_abc}`] ?? 0) + 1
    }
    return m
  }, [toutes])

  const classes = useMemo(
    () => [...new Set(toutes.map((l) => l.classe_abc).filter(Boolean) as string[])].sort(),
    [toutes],
  )
  // Les magasins de l'onglet Emplacements : ceux qui portent du stock, le plus
  // fourni d'abord.
  const magasins = useMemo(() => {
    const total = new Map<string, number>()
    for (const l of toutes)
      for (const [m, v] of Object.entries(l.stock_par_magasin ?? {})) total.set(m, (total.get(m) ?? 0) + v)
    return [...total.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m)
  }, [toutes])

  const lignes = useMemo(() => {
    const f = recherche.trim().toLowerCase()
    return toutes
      .filter((l) => {
        if (!filtre) return true
        if (filtre === 'A_COMMANDER') return aCommander(l)
        if (filtre === 'MANQUE') return positifKg(l.manque_kg)
        if (filtre.startsWith('PALIER:')) return l.palier_rupture === filtre.slice(7)
        if (filtre.startsWith('ABC:')) return l.classe_abc === filtre.slice(4)
        return l.statut === filtre
      })
      .filter(
        (l) =>
          !f ||
          l.code_reference.toLowerCase().includes(f) ||
          (l.designation ?? '').toLowerCase().includes(f) ||
          (l.fournisseur_nom ?? '').toLowerCase().includes(f),
      )
      .filter(filtres.retenir)
  }, [toutes, filtre, recherche, filtres])

  const groupes: GroupeRail[] = [
    {
      entrees: [
        { cle: '', libelle: 'Toutes les références', resume: 'Suivies par le stock projeté', Icone: Layers, compte: toutes.length },
      ],
    },
    {
      titre: 'Par état',
      entrees: [
        ...ETATS.map((s) => ({
          cle: s.cle,
          libelle: libelleStatut('statut_projete', s.cle),
          resume: s.resume,
          Icone: s.Icone,
          compte: comptes[s.cle] ?? 0,
          ton: s.ton,
        })),
        {
          cle: 'A_COMMANDER',
          libelle: 'À commander',
          resume: 'Une quantité est proposée',
          Icone: ShoppingCart,
          compte: comptes.A_COMMANDER ?? 0,
          ton: 'alerte' as const,
        },
        {
          cle: 'MANQUE',
          libelle: 'Manque avant arrivage',
          resume: 'Un arrivage tardif : le bouton Rattrapage change le calcul',
          Icone: CalendarClock,
          compte: comptes.MANQUE ?? 0,
          ton: 'neutre' as const,
        },
      ],
    },
  ]
  // LES PALIERS DE RUPTURE (31/10/2026) : quand le fil manque, échelonné par
  // P_SeuilImminent / P_SeuilCritique / P_SeuilAlerte.
  groupes.push({
    titre: 'Par palier de rupture',
    entrees: PALIERS.map((p) => ({
      cle: `PALIER:${p.cle}`,
      libelle: libelleStatut('palier_rupture', p.cle),
      resume: p.resume,
      Icone: p.Icone,
      compte: comptes[`PALIER:${p.cle}`] ?? 0,
      ton: p.ton,
    })),
  })
  if (classes.length > 0) {
    groupes.push({
      titre: 'Par classe ABC',
      entrees: classes.map((c) => ({
        cle: `ABC:${c}`,
        libelle: `Classe ${c}`,
        resume: c === 'A' ? 'Le gros du capital immobilisé' : c === 'B' ? 'Poids intermédiaire' : 'Nombreuses, faible valeur',
        compte: comptes[`ABC:${c}`] ?? 0,
        ton: c === 'A' ? ('danger' as const) : ('neutre' as const),
      })),
    })
  }

  // LES ONGLETS RISQUES ET SOURCING (§ 16.5) : leurs données se lisent à
  // l'ouverture de l'onglet seulement (la liste reste légère), puis restent en cache.
  const complements = useQuery({
    queryKey: ['stock-projete-complements'],
    queryFn: ({ signal }) => api.get<ComplementProjete[]>('/api/stock/projete/complements', { signal }),
    enabled: vue === 'risques' || vue === 'sourcing',
    staleTime: 60_000,
  })
  const lignesVue = useMemo(() => {
    if (vue === 'appro' || vue === 'emplacements') return lignes
    const par = new Map((complements.data ?? []).map((c) => [c.code_reference, c]))
    // La couverture projetée de chaque référence, pour dire celle de ses substituts.
    const couverture = new Map(toutes.map((l) => [l.code_reference, l.jours_couverture]))
    return lignes.map((l) => {
      const c = par.get(l.code_reference)
      if (!c) return l
      const subs = (c.substituts_en_stock ?? '').split('|').filter(Boolean).filter((s) => couverture.has(s))
      const jours = subs.map((s) => couverture.get(s) ?? Number.POSITIVE_INFINITY)
      const meilleure = jours.length ? Math.max(...jours) : null
      return {
        ...l,
        ...c,
        substitut_couverture_j: meilleure == null ? null : meilleure === Number.POSITIVE_INFINITY ? 'horizon' : meilleure,
      }
    })
  }, [vue, lignes, toutes, complements.data])

  /* UNE SEULE LIGNE PAR RÉFÉRENCE, SANS ↳ (décision du 30/10/2026). La
     désignation se lit au survol de la référence et dans la fenêtre. */
  const reference: Colonne<LigneProjete> = {
    champ: 'code_reference',
    entete: 'Référence',
    rendu: (l) => (
      <span
        className="block min-w-[7.5rem] max-w-[11rem] whitespace-normal break-words font-medium leading-snug text-texte"
        title={l.designation && l.designation !== l.code_reference ? `${l.code_reference} — ${l.designation}` : l.code_reference}
      >
        {l.code_reference}
      </span>
    ),
  }
  const etat: Colonne<LigneProjete> = {
    champ: 'statut',
    entete: 'État',
    largeur: '96px',
    valeurTri: (l) => `${{ ALERTE: 0, SOUS_CIBLE: 1 }[l.statut] ?? 2}`,
    rendu: (l) => <StatutBadge entite="statut_projete" code={l.statut} title={l.raison_etat ?? undefined} />,
  }
  const fournisseur: Colonne<LigneProjete> = {
    champ: 'fournisseur_nom',
    entete: 'Fournisseur',
    rendu: (l) => (
      <span className="block min-w-[5.5rem] max-w-[8rem] whitespace-normal break-words leading-snug">
        {fmt.texte(l.fournisseur_nom)}
      </span>
    ),
  }
  /* LES TROIS COLONNES FIXES, en tête des quatre onglets (31/10/2026). */
  const fixes = [reference, fournisseur, etat]

  /* L'ONGLET APPROVISIONNEMENT (31/10/2026) : stock disponible + sur machine +
     en route = position. */
  const colonnesAppro: Colonne<LigneProjete>[] = [
    ...fixes,
    {
      champ: 'magasin_kg',
      total: true,
      entete: 'Stock disponible',
      numerique: true,
      largeur: '70px',
      rendu: (l) => kgCellule(l.magasin_kg),
    },
    {
      champ: 'machine_kg',
      total: true,
      entete: 'Sur machine',
      numerique: true,
      largeur: '64px',
      rendu: (l) => kgCellule(l.machine_kg),
    },
    {
      champ: 'arrivages_comptes_kg',
      total: true,
      entete: 'En route (arrivages)',
      numerique: true,
      largeur: '72px',
      rendu: (l) => kgCellule(l.arrivages_comptes_kg),
    },
    {
      champ: 'stock_total_projete_kg',
      total: true,
      entete: 'Position',
      numerique: true,
      largeur: '72px',
      rendu: (l) => <span className="font-medium">{kg(l.stock_total_projete_kg)}</span>,
    },
    {
      // Le plan ramené à un mois de 30 jours : ce que le calcul consomme.
      champ: 'plan_mois_kg',
      total: true,
      entete: 'Conso / mois',
      numerique: true,
      largeur: '64px',
      rendu: (l) => kgCellule(l.plan_mois_kg),
    },
    {
      champ: 'jours_couverture',
      entete: 'Couverture',
      numerique: true,
      largeur: '88px',
      // Les jours sans fil d'abord (les plus nombreux en tête), puis la couverture.
      valeurTri: (l) =>
        (l.jours_sans_fil ?? 0) > 0 ? -(l.jours_sans_fil ?? 0) : l.jours_couverture == null ? 1e9 : l.jours_couverture,
      rendu: (l) => (
        <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
          {(positifKg(l.manque_kg) || inverses.includes(l.code_reference)) && (
            <BoutonRattrapageLigne
              inclus={optionDe(l.code_reference)}
              exception={inverses.includes(l.code_reference)}
              manque={l.manque_kg}
              surClic={() => inverser(l.code_reference)}
            />
          )}
          {(l.jours_sans_fil ?? 0) > 0 ? (
            <span
              className="font-medium tabular-nums text-danger"
              title={`${l.jours_sans_fil} jour(s) sans fil jusqu’au prochain approvisionnement${positifKg(l.manque_kg) ? ` (${kg(l.manque_kg)} kg non servis)` : ''}${l.jours_couverture != null ? ` ; couverture projetée ${l.jours_couverture} j` : ''}`}
            >
              −{l.jours_sans_fil} j
            </span>
          ) : l.jours_couverture == null ? (
            <span className="text-succes">{`> ${l.horizon_j ?? '?'} j`}</span>
          ) : (
            <span className={cn('tabular-nums', l.ecart_cible_j != null && l.ecart_cible_j < 0 && 'font-medium text-danger')}>
              {l.jours_couverture} j
            </span>
          )}
        </span>
      ),
    },
    {
      // LE PALIER DE RUPTURE (31/10/2026) et, dessous, le palier suivant et le
      // jour où la référence y passe.
      champ: 'palier_rupture',
      entete: 'Rupture',
      largeur: '96px',
      valeurTri: (l) => (l.rupture_j == null ? 1e9 : l.rupture_j),
      rendu: (l) => (
        <div
          className="min-w-0"
          title={l.rupture_le ? `Premier jour sans fil le ${dateListe(l.rupture_le)} (dans ${l.rupture_j} j)` : 'Aucune rupture sur l’horizon du plan'}
        >
          {l.palier_rupture ? (
            <StatutBadge entite="palier_rupture" code={l.palier_rupture} />
          ) : (
            <span className="text-attenue-texte">—</span>
          )}
          {l.palier_suivant && l.date_palier_suivant && (
            <div className="mt-0.5 whitespace-nowrap text-[11px] text-attenue-texte">
              → {libelleStatut('palier_rupture', l.palier_suivant)} le {dateListe(l.date_palier_suivant)}
            </div>
          )}
        </div>
      ),
    },
    {
      champ: 'couverture_cible_j',
      entete: 'Cible',
      numerique: true,
      largeur: '54px',
      rendu: (l) =>
        l.couverture_cible_j == null ? (
          <span className="text-alerte">—</span>
        ) : (
          <span className="tabular-nums">{l.couverture_cible_j} j</span>
        ),
    },
    {
      champ: 'qte_a_commander_kg',
      total: true,
      entete: 'À commander',
      numerique: true,
      largeur: '72px',
      rendu: (l) =>
        l.qte_a_commander_kg ? (
          <span
            className="font-medium tabular-nums"
            title={typeof l.palettes_equivalentes === 'number' ? `≈ ${fmt.nombre(l.palettes_equivalentes, 2)} palettes` : undefined}
          >
            {kg(l.qte_a_commander_kg)}
          </span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'montant_estime_mad',
      total: true,
      entete: 'Montant',
      numerique: true,
      largeur: '76px',
      rendu: (l) =>
        typeof l.montant_estime_mad === 'number' ? (
          <span className="tabular-nums" title={l.source_prix ? `Prix : ${l.source_prix}` : undefined}>
            {fmt.nombre(l.montant_estime_mad, 0)}
          </span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
  ]

  /* L'ONGLET RISQUES (validé le 30/10/2026). La politique ABC/XYZ, un texte
     long, se lit dans la fenêtre. */
  const colonnesRisques: Colonne<LigneProjete>[] = [
    ...fixes,
    {
      champ: 'avant_le',
      entete: 'Avant le',
      largeur: '70px',
      rendu: (l) =>
        l.avant_le ? (
          <span className={cn('tabular-nums', aCommander(l) && l.avant_le <= aujourdhuiIso() && 'font-medium text-danger')}>
            {dateListe(l.avant_le)}
          </span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    { champ: 'classe_abc', entete: 'ABC', largeur: '44px', rendu: (l) => l.classe_abc ?? '—' },
    { champ: 'rang', entete: 'Rang', numerique: true, largeur: '48px', rendu: (l) => (l.rang != null ? l.rang : '—') },
    {
      champ: 'pct_cumule',
      entete: '% cumulé',
      numerique: true,
      largeur: '62px',
      rendu: (l) => (typeof l.pct_cumule === 'number' ? `${fmt.nombre(l.pct_cumule, 1)} %` : '—'),
    },
    {
      champ: 'valeur_conso_annuelle_mad',
      total: true,
      entete: 'Valeur 12 mois',
      numerique: true,
      largeur: '80px',
      rendu: (l) => (typeof l.valeur_conso_annuelle_mad === 'number' ? fmt.nombre(l.valeur_conso_annuelle_mad, 0) : '—'),
    },
    {
      champ: 'classe_xyz',
      entete: 'XYZ',
      largeur: '44px',
      rendu: (l) => <span title={l.politique ?? undefined}>{l.classe_xyz ?? '—'}</span>,
    },
    {
      champ: 'coef_variation_xyz',
      entete: 'CV',
      numerique: true,
      largeur: '50px',
      rendu: (l) => (typeof l.coef_variation_xyz === 'number' ? fmt.nombre(l.coef_variation_xyz, 2) : '—'),
    },
    { champ: 'tier', entete: 'Palier', largeur: '64px', rendu: (l) => (l.tier ? l.tier.replace('TIER_', 'palier ') : '—') },
  ]

  /* L'ONGLET SOURCING (validé le 30/10/2026). */
  const colonnesSourcing: Colonne<LigneProjete>[] = [
    ...fixes,
    { champ: 'delai_j', entete: 'Délai', numerique: true, largeur: '50px', rendu: (l) => `${l.delai_j ?? '—'} j` },
    {
      champ: 'risque_source',
      entete: 'Sources',
      largeur: '104px',
      rendu: (l) =>
        l.risque_source === 'MONO_SOURCE' ? (
          <span className="font-medium text-danger">mono-source</span>
        ) : l.risque_source === 'MULTI_SOURCE' ? (
          <span className="text-succes">multi-source ({l.nb_sources ?? '?'})</span>
        ) : (
          '—'
        ),
    },
    {
      champ: 'code_groupe_equiv',
      entete: 'Groupe d’équivalence',
      rendu: (l) => (l.code_groupe_equiv ? <span title={l.groupe_libelle ?? undefined}>{l.code_groupe_equiv}</span> : '—'),
    },
    {
      champ: 'substituts_stock_kg',
      entete: 'Substituts en stock',
      numerique: true,
      largeur: '80px',
      rendu: (l) => kgCellule(l.substituts_stock_kg),
    },
    {
      champ: 'substitut_couverture_j',
      entete: 'Couverture du substitut',
      numerique: true,
      largeur: '84px',
      rendu: (l) =>
        l.substitut_couverture_j == null ? (
          <span className="text-attenue-texte">—</span>
        ) : l.substitut_couverture_j === 'horizon' ? (
          <span className="text-succes">tout l’horizon</span>
        ) : (
          `${l.substitut_couverture_j} j`
        ),
    },
    {
      champ: 'jours_sans_mouvement',
      entete: 'Sans mouvement',
      numerique: true,
      largeur: '72px',
      rendu: (l) => (l.jours_sans_mouvement != null ? `${l.jours_sans_mouvement} j` : '—'),
    },
    { champ: 'dormant', entete: 'Dormant', largeur: '62px', rendu: (l) => (l.dormant ? <span className="text-alerte">oui</span> : 'non') },
  ]

  /* L'ONGLET EMPLACEMENTS (31/10/2026) : où se trouve chaque kilo. Les
     magasins + sur machines + restes = disponible total ; en route = les
     transferts entre magasins ; le stock après l'arrivage ajoute quarantaine,
     en route et commandé. */
  const colonnesEmplacements: Colonne<LigneProjete>[] = [
    ...fixes,
    {
      champ: 'disponible_kg',
      total: true,
      entete: 'Disponible total',
      numerique: true,
      largeur: '64px',
      rendu: (l) => <span className="font-medium">{kgCellule(l.disponible_kg)}</span>,
    },
    ...magasins.map(
      (m): Colonne<LigneProjete> => ({
        champ: `magasin:${m}`,
        droit: 'stock_par_magasin',
        total: true,
        entete: m,
        numerique: true,
        largeur: '60px',
        valeurTri: (l) => l.stock_par_magasin?.[m] ?? 0,
        rendu: (l) => kgCellule(l.stock_par_magasin?.[m]),
      }),
    ),
    {
      champ: 'machine_hors_restes_kg',
      total: true,
      entete: 'Sur machines',
      numerique: true,
      largeur: '64px',
      rendu: (l) => kgCellule(l.machine_hors_restes_kg),
    },
    { champ: 'restant_kg',
      total: true, entete: 'Restes', numerique: true, largeur: '60px', rendu: (l) => kgCellule(l.restant_kg) },
    {
      champ: 'quarantaine_kg',
      total: true,
      entete: 'Quarantaine',
      numerique: true,
      largeur: '70px',
      rendu: (l) => kgCellule(l.quarantaine_kg),
    },
    { champ: 'transit_kg',
      total: true, entete: 'En route', numerique: true, largeur: '64px', rendu: (l) => kgCellule(l.transit_kg) },
    {
      // Ce qui arrive après aujourd'hui + délai : trop tard pour éviter une rupture.
      champ: 'en_route_apres_delai_kg',
      total: true,
      entete: 'En route après le délai',
      numerique: true,
      largeur: '72px',
      rendu: (l) => kgCellule(l.en_route_apres_delai_kg),
    },
    { champ: 'commande_kg',
      total: true, entete: 'Commandé', numerique: true, largeur: '68px', rendu: (l) => kgCellule(l.commande_kg) },
    {
      champ: 'stock_apres_arrivage_kg',
      total: true,
      entete: 'Stock global après l’arrivage',
      numerique: true,
      largeur: '72px',
      rendu: (l) => <span className="font-medium">{kgCellule(l.stock_apres_arrivage_kg)}</span>,
    },
  ]

  const colonnes =
    vue === 'risques'
      ? colonnesRisques
      : vue === 'sourcing'
        ? colonnesSourcing
        : vue === 'emplacements'
          ? colonnesEmplacements
          : colonnesAppro

  return (
    <PageAvecRail
      large
      rail={
        <div className="space-y-3">
          <RailLateral
            groupes={groupes}
            actif={filtre}
            surChoix={setFiltre}
            recherche={{ valeur: recherche, surChangement: setRecherche, placeholder: 'Référence, fournisseur…' }}
          />
          <PanneauFiltres
            champs={CHAMPS_FILTRABLES}
            lignes={toutes}
            valeurs={filtres.valeurs}
            definir={filtres.definir}
            reinitialiser={filtres.reinitialiser}
            actifs={filtres.actifs}
          />
        </div>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Vue du stock projeté" className="inline-flex rounded-[var(--radius)] border border-bordure p-0.5">
          {VUES.map((v) => (
            <button
              key={v.cle}
              type="button"
              role="tab"
              aria-selected={vue === v.cle}
              onClick={() => setVue(v.cle)}
              className={cn(
                'rounded-[calc(var(--radius)-2px)] px-2.5 py-1 text-[12px] transition-colors',
                vue === v.cle ? 'bg-primaire text-primaire-texte' : 'text-attenue-texte hover:text-texte',
              )}
            >
              {v.libelle}
            </button>
          ))}
        </div>
        <Bouton
          taille="sm"
          variante={rattrapage ? 'contour' : 'primaire'}
          onClick={() => setChoixRattrapage(!rattrapage)}
          title="Le manque avant un arrivage tardif : inclus, il reste dû et se déduit de l’arrivage ; exclu, il est perdu. Vaut pour toutes les lignes, sauf celles inversées sur la ligne."
        >
          <Repeat /> Rattrapage : {rattrapage ? 'inclus' : 'exclu'}
        </Bouton>
        <BoutonRestes restes={restes ?? toutes[0]?.restes_comptes ?? true} surBascule={(v) => setRestes(v)} />
        {inverses.length > 0 && (
          <Bouton taille="sm" variante="discret" onClick={() => setInverses([])}>
            {inverses.length} ligne(s) inversée(s) · tout remettre
          </Bouton>
        )}
        {q.isFetching && !q.isLoading && <span className="text-[11.5px] text-attenue-texte">recalcul…</span>}
        {(vue === 'risques' || vue === 'sourcing') && complements.isFetching && (
          <span className="text-[11.5px] text-attenue-texte">lecture du classement et du sourcing…</span>
        )}
      </div>
      {filtres.actifs > 0 && (
        <div className="mb-2 text-[12px] text-attenue-texte">
          {lignes.length} référence(s) sur {toutes.length} après filtrage.
        </div>
      )}
      <DataTable<LigneProjete>
        exportable={`stock-projete-${vue}`}
        imprimable={`Stock projeté — ${VUES.find((v) => v.cle === vue)?.libelle}`}
        module={MODULE}
        recherche={false}
        entetesRepliables
        lisible
        serre
        menuContextuel={(l) => <ActionsLigne ligne={l} ouvrir={ouvrir} />}
        surClic={lirePlan ? (l) => setOuverte(l) : undefined}
        colonnes={colonnes}
        lignes={lignesVue}
        chargement={q.isLoading}
        erreur={q.error ?? complements.error}
        cle={(l) => l.code_reference}
        titreCarte={(l) => [l.code_reference, l.designation && l.designation !== l.code_reference ? l.designation : null].filter(Boolean).join(' — ')}
        videTitre="Aucune référence pour ce filtre."
      />
      <ModaleReference
        reference={ouverte?.code_reference ?? null}
        designation={ouverte?.designation}
        surFermer={() => setOuverte(null)}
        enrichi
        rattrapage={ouverte ? optionDe(ouverte.code_reference) : true}
        restes={restes}
        surSimuler={surSimuler}
      />
    </PageAvecRail>
  )
}

/** Des kilos non nuls. */
function positifKg(v: number | null | undefined): boolean {
  return typeof v === 'number' && v > 0.05
}

/** Aujourd'hui, en AAAA-MM-JJ (jour du poste). */
function aujourdhuiIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * LE BOUTON DE RATTRAPAGE DE LA LIGNE : il n'apparaît que là où il change le
 * calcul (un manque avant un arrivage tardif) ou là où la ligne est déjà
 * inversée. Le clic n'ouvre pas la fenêtre.
 */
function BoutonRattrapageLigne({
  inclus,
  exception,
  manque,
  surClic,
}: {
  inclus: boolean
  exception: boolean
  manque: number | null | undefined
  surClic: () => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        surClic()
      }}
      title={`Manque avant arrivage${typeof manque === 'number' ? ` : ${kg(manque)} kg` : ''}. Rattrapage ${inclus ? 'inclus' : 'exclu'} sur cette ligne${exception ? ' (exception)' : ''} : cliquer pour inverser.`}
      aria-label={`Rattrapage ${inclus ? 'inclus' : 'exclu'} : inverser pour cette ligne`}
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded border px-0.5 text-[9.5px] font-semibold leading-none',
        exception ? 'border-primaire bg-primaire/15 text-primaire' : 'border-bordure text-attenue-texte hover:text-texte',
      )}
    >
      {inclus ? 'R' : 'R̶'}
    </button>
  )
}

/**
 * LE BOUTON RESTES (31/10/2026) : les restes (magasins et machines) comptés dans
 * le stock, ou retirés. Il part du réglage P_ProjeteRestes (que suit le plan
 * d'achat) et ne change que l'affichage de la session.
 */
function BoutonRestes({ restes, surBascule }: { restes: boolean; surBascule: (v: boolean) => void }) {
  return (
    <Bouton
      taille="sm"
      variante={restes ? 'contour' : 'primaire'}
      onClick={() => surBascule(!restes)}
      title="Les restes (magasins et machines) comptent-ils dans le stock disponible ? Le réglage P_ProjeteRestes donne le départ ; ce bouton ne change que l’affichage."
    >
      <Layers /> Restes : {restes ? 'comptés' : 'exclus'}
    </Bouton>
  )
}
