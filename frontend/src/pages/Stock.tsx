/**
 * LE STOCK PROJETÉ — TROIS ONGLETS SUR LE MÊME MOTEUR (décisions du 27/10/2026).
 *
 *   * STOCK PROJETÉ : toutes les matières suivies, une ligne par référence, en
 *     21 colonnes (moteur v2, décision du 27/10/2026) — stock disponible, sur
 *     machines, restant constaté, arrivages, stock projeté, besoin jusqu'à
 *     réception, couverture actuelle, cible, écart, à commander, montant, avant
 *     le, état ; sur la ligne ↳ désignation, fournisseur, ABC / XYZ, 1re rupture,
 *     délai, réception proposée, palettes. Le clic sur la ligne ouvre la fenêtre
 *     du détail ENRICHIE (tuiles, approvisionnement, calcul, classement, où se
 *     trouve la matière, onglets).
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
  PackageX,
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
import { Alerte } from '../composants/ui/base'
import { Onglet, OngletContenu, Onglets, OngletsListe } from '../composants/ui/surcouches'
import { libelleStatut } from '../lib/statuts'
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
  /** L'état au moteur v2 : RUPTURE_INEVITABLE | SOUS_SECURITE | SOUS_CIBLE | COUVERT (§ 15.4). */
  statut: string
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

const kg = (v: number | null | undefined, d = 0) => fmt.nombre(v ?? 0, d)

/** Les états du moteur v2 (§ 15.4), ce qu'ils veulent dire, et la couleur de leur compteur. */
const ETATS = [
  {
    cle: 'RUPTURE_INEVITABLE',
    resume: 'La 1re rupture tombe avant aujourd’hui + délai',
    Icone: PackageX,
    ton: 'danger' as const,
  },
  {
    cle: 'SOUS_SECURITE',
    resume: 'Un creux sous le seuil de sécurité dans le délai',
    Icone: AlertTriangle,
    ton: 'alerte' as const,
  },
  {
    cle: 'SOUS_CIBLE',
    resume: 'La couverture actuelle est sous la couverture cible',
    Icone: Target,
    ton: 'info' as const,
  },
  {
    cle: 'COUVERT',
    resume: 'La couverture atteint la cible',
    Icone: CheckCircle2,
    ton: 'succes' as const,
  },
]

/**
 * Filtres : des axes que l'on choisit, jamais un comparateur à saisir.
 */
const CHAMPS_FILTRABLES: ChampFiltre<LigneProjete>[] = [
  { cle: 'statut', libelle: 'État', type: 'liste', valeur: (l) => libelleStatut('statut_stock', l.statut) },
  { cle: 'fournisseur', libelle: 'Fournisseur', type: 'liste', recherche: true, valeur: (l) => l.fournisseur_nom },
  { cle: 'classe', libelle: 'Classe ABC', type: 'liste', valeur: (l) => l.classe_abc },
  { cle: 'reference', libelle: 'Référence', type: 'texte', valeur: (l) => l.code_reference },
]

/**
 * Le menu au clic droit : il n'ouvre aucun chemin nouveau, il porte la référence
 * vers des écrans existants (commande, fiche, mouvements, équivalents, inventaire).
 */
function ActionsLigne({ ligne: l, ouvrir }: { ligne: LigneProjete; ouvrir: (chemin: string) => void }) {
  const ref = encodeURIComponent(l.code_reference)
  const tendu = l.statut !== 'COUVERT'
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
        sous_titre="Le moteur de couverture : ce qui est compté aujourd’hui, ce qui arrive à sa date, jusqu’où le plan est couvert, et ce qu’il faut commander"
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

/** L'ONGLET « STOCK PROJETÉ » : toutes les matières suivies, une ligne chacune. */
function StockProjete({ lirePlan, surSimuler }: { lirePlan: boolean; surSimuler?: (reference: string) => void }) {
  const ouvrir = useOuvrirVue()
  const [filtre, setFiltre] = useState('')
  const [recherche, setRecherche] = useState('')
  const filtres = useFiltres(CHAMPS_FILTRABLES)
  // La référence dont la grande fenêtre est ouverte.
  const [ouverte, setOuverte] = useState<LigneProjete | null>(null)

  const q = useQuery({
    queryKey: ['stock-projete'],
    queryFn: ({ signal }) => api.get<LigneProjete[]>('/api/stock/projete?limite=2000', { signal }),
  })

  const toutes = useMemo(() => q.data ?? [], [q.data])

  const comptes = useMemo(() => {
    const m: Record<string, number> = {}
    for (const l of toutes) {
      m[l.statut] = (m[l.statut] ?? 0) + 1
      if (l.a_commander_aujourdhui) m.AUJOURDHUI = (m.AUJOURDHUI ?? 0) + 1
      if (l.classe_abc) m[`ABC:${l.classe_abc}`] = (m[`ABC:${l.classe_abc}`] ?? 0) + 1
    }
    return m
  }, [toutes])

  const classes = useMemo(
    () => [...new Set(toutes.map((l) => l.classe_abc).filter(Boolean) as string[])].sort(),
    [toutes],
  )

  const lignes = useMemo(() => {
    const f = recherche.trim().toLowerCase()
    return toutes
      .filter((l) => {
        if (!filtre) return true
        if (filtre === 'AUJOURDHUI') return l.a_commander_aujourdhui
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
        { cle: '', libelle: 'Toutes les références', resume: 'Suivies par le moteur', Icone: Layers, compte: toutes.length },
      ],
    },
    {
      titre: 'Par état (moteur de couverture)',
      entrees: [
        ...ETATS.map((s) => ({
          cle: s.cle,
          libelle: libelleStatut('statut_stock', s.cle),
          resume: s.resume,
          Icone: s.Icone,
          compte: comptes[s.cle] ?? 0,
          ton: s.ton,
        })),
        {
          cle: 'AUJOURDHUI',
          libelle: 'À commander aujourd’hui',
          resume: 'Date limite de commande atteinte ou dépassée',
          Icone: CalendarClock,
          compte: comptes.AUJOURDHUI ?? 0,
          ton: 'danger' as const,
        },
      ],
    },
  ]
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

  /* LES 21 COLONNES DU STOCK PROJETÉ (décision du 27/10/2026, soir), dans
     l'ordre validé. Ligne principale : 1, 5 à 13, 17, 19, 20, 21 ; ligne ↳
     (`complement`) : 2, 3, 4, 14, 15, 16, 18. Les signaux ne sont QUE dans la
     fenêtre de détail. Tout vient du moteur de couverture. */
  const colonnes: Colonne<LigneProjete>[] = [
    {
      champ: 'code_reference',
      entete: 'Référence',
      rendu: (l) => (
        <span className="block max-w-[6.5rem] truncate font-medium text-texte" title={l.code_reference}>
          {l.code_reference}
        </span>
      ),
    },
    {
      champ: 'designation',
      entete: 'Désignation',
      complement: true,
      rendu: (l) => (l.designation && l.designation !== l.code_reference ? l.designation : '—'),
    },
    {
      champ: 'fournisseur_nom',
      entete: 'Fournisseur',
      complement: true,
      rendu: (l) => fmt.texte(l.fournisseur_nom),
    },
    {
      champ: 'classe_abc',
      entete: 'ABC / XYZ',
      complement: true,
      rendu: (l) => (l.classe_abc ? `${l.classe_abc}${l.classe_xyz ?? ''}` : '—'),
    },
    {
      champ: 'magasin_hors_restes_kg',
      entete: 'Stock disponible',
      numerique: true,
      largeur: '66px',
      rendu: (l) => kgCellule(l.magasin_hors_restes_kg),
    },
    {
      champ: 'machine_hors_restes_kg',
      entete: 'Sur machines',
      numerique: true,
      largeur: '60px',
      rendu: (l) => kgCellule(l.machine_hors_restes_kg),
    },
    {
      champ: 'restant_kg',
      entete: 'Restant constaté',
      numerique: true,
      largeur: '62px',
      rendu: (l) => kgCellule(l.restant_kg),
    },
    {
      champ: 'arrivages_comptes_kg',
      entete: 'Arrivages',
      numerique: true,
      largeur: '64px',
      rendu: (l) => kgCellule(l.arrivages_comptes_kg),
    },
    {
      champ: 'stock_total_projete_kg',
      entete: 'Stock projeté',
      numerique: true,
      largeur: '66px',
      rendu: (l) => <span className="font-medium">{kg(l.stock_total_projete_kg)}</span>,
    },
    {
      champ: 'besoin_jusqu_reception_kg',
      entete: 'Besoin jusqu’à réception',
      numerique: true,
      largeur: '70px',
      rendu: (l) => (l.besoin_jusqu_reception_kg == null ? <span className="text-attenue-texte">—</span> : kg(l.besoin_jusqu_reception_kg)),
    },
    {
      champ: 'jours_couverture',
      entete: 'Couverture actuelle',
      numerique: true,
      largeur: '68px',
      valeurTri: (l) => (l.jours_couverture == null ? 1e9 : l.jours_couverture),
      rendu: (l) =>
        l.jours_couverture == null ? (
          <span className="text-succes">{`> ${l.horizon_j ?? '?'} j`}</span>
        ) : (
          <span className="tabular-nums">{l.jours_couverture} j</span>
        ),
    },
    {
      champ: 'couverture_cible_j',
      entete: 'Cible',
      numerique: true,
      largeur: '54px',
      rendu: (l) =>
        l.couverture_cible_j == null ? (
          <span className="text-alerte">non définie</span>
        ) : (
          <span className="tabular-nums">{l.couverture_cible_j} j</span>
        ),
    },
    {
      champ: 'ecart_cible_j',
      entete: 'Écart cible',
      numerique: true,
      largeur: '56px',
      valeurTri: (l) => (l.ecart_cible_j == null ? 1e9 : l.ecart_cible_j),
      rendu: (l) =>
        l.ecart_cible_j == null ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <span className={cn('tabular-nums', l.ecart_cible_j < 0 && 'font-medium text-danger')}>
            {l.ecart_cible_j > 0 ? '+' : l.ecart_cible_j < 0 ? '−' : ''}
            {Math.abs(l.ecart_cible_j)} j
          </span>
        ),
    },
    {
      champ: 'premiere_rupture',
      entete: '1re rupture projetée',
      complement: true,
      rendu: (l) => (l.premiere_rupture ? <span className="tabular-nums">{dateListe(l.premiere_rupture)}</span> : 'aucune sur l’horizon'),
    },
    {
      champ: 'delai_j',
      entete: 'Délai',
      numerique: true,
      complement: true,
      rendu: (l) => <span title={l.source_delai ? `source : ${l.source_delai}` : undefined}>{l.delai_j ?? '—'} j</span>,
    },
    {
      champ: 'date_disponibilite',
      entete: 'Date réception proposée',
      complement: true,
      rendu: (l) =>
        l.date_disponibilite ? (
          <span className="tabular-nums">
            {dateListe(l.date_disponibilite)}
            {l.reception_en_retard && <span className="ml-1 font-medium text-danger">en retard</span>}
          </span>
        ) : (
          '—'
        ),
    },
    {
      champ: 'qte_a_commander_kg',
      entete: 'À commander',
      numerique: true,
      largeur: '68px',
      rendu: (l) =>
        l.qte_a_commander_kg ? (
          <span className="font-medium tabular-nums">{kg(l.qte_a_commander_kg)}</span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'palettes_equivalentes',
      entete: 'Unité / palette',
      complement: true,
      rendu: (l) => (typeof l.palettes_equivalentes === 'number' ? `${fmt.nombre(l.palettes_equivalentes, 2)} pal.` : '—'),
    },
    {
      champ: 'montant_estime_mad',
      entete: 'Montant commande',
      numerique: true,
      largeur: '72px',
      rendu: (l) =>
        typeof l.montant_estime_mad === 'number' ? (
          <span className="tabular-nums" title={l.source_prix ? `Prix : ${l.source_prix}` : undefined}>
            {fmt.nombre(l.montant_estime_mad, 0)}
          </span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'date_limite_commande',
      entete: 'Avant le',
      largeur: '64px',
      rendu: (l) =>
        l.date_limite_commande ? (
          <span className={cn('tabular-nums', l.a_commander_aujourdhui && 'font-medium text-danger')}>
            {dateListe(l.date_limite_commande)}
          </span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'statut',
      entete: 'État',
      largeur: '136px',
      valeurTri: (l) => `${{ RUPTURE_INEVITABLE: 0, SOUS_SECURITE: 1, SOUS_CIBLE: 2 }[l.statut] ?? 3}`,
      rendu: (l) => <StatutBadge entite="statut_stock" code={l.statut} title={l.raison_etat ?? undefined} />,
    },
  ]

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
      {filtres.actifs > 0 && (
        <div className="mb-2 text-[12px] text-attenue-texte">
          {lignes.length} référence(s) sur {toutes.length} après filtrage.
        </div>
      )}
      <DataTable<LigneProjete>
        exportable="stock-projete"
        imprimable="Stock projeté"
        module={MODULE}
        recherche={false}
        entetesRepliables
        serre
        menuContextuel={(l) => <ActionsLigne ligne={l} ouvrir={ouvrir} />}
        surClic={lirePlan ? (l) => setOuverte(l) : undefined}
        colonnes={colonnes}
        lignes={lignes}
        chargement={q.isLoading}
        erreur={q.error}
        cle={(l) => l.code_reference}
        titreCarte={(l) => [l.code_reference, l.designation && l.designation !== l.code_reference ? l.designation : null].filter(Boolean).join(' — ')}
        videTitre="Aucune référence pour ce filtre."
      />
      <ModaleReference
        reference={ouverte?.code_reference ?? null}
        designation={ouverte?.designation}
        surFermer={() => setOuverte(null)}
        enrichi
        surSimuler={surSimuler}
      />
    </PageAvecRail>
  )
}
