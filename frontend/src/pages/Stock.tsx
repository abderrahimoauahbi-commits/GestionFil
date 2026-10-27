/**
 * LE STOCK PROJETÉ — TROIS ONGLETS SUR LE MÊME MOTEUR (décisions du 27/10/2026).
 *
 *   * STOCK PROJETÉ : toutes les matières suivies, une ligne par référence —
 *     disponible (hors quarantaine, hors restes), sur machine, restant (les
 *     restes comptés), arrivages comptés, stock total projeté (la somme, sans
 *     recouvrement), besoin jusqu'à livraison, couverture planifiée, à commander
 *     et son montant (le prix du plan d'achat). Le clic ouvre la grande fenêtre
 *     du détail, ENRICHIE (situation, approvisionnement, projection, résultat MRP).
 *   * SIMULATION : « et si ? » sur une référence, recalculé par le même moteur ;
 *     rien n'est jamais enregistré.
 *   * SURVEILLANCE / ALERTES : EXACTEMENT le tableau « À commander » du plan
 *     d'achat, et la même fenêtre de détail (composants partagés).
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
import { dateListe } from '../composants/couverture/types'

const MODULE = 'STOCK'

/** Une ligne : celle de l'onglet « À commander », avec ce que le stock dit en plus. */
interface LigneProjete {
  code_reference: string
  designation: string | null
  fournisseur_nom: string | null
  classe_abc: string | null
  classe_xyz: string | null
  unite_catalogue: string | null
  /** PLAN_NON_COUVERT | SOUS_SECURITE | COUVERT */
  statut: string
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

/**
 * Pourquoi cet état ? Le moteur le dit en une date : la rupture, le passage sous
 * la sécurité. Le statut seul obligerait à rouvrir le calcul de tête.
 */
function motif(l: LigneProjete): string | null {
  if (l.statut === 'PLAN_NON_COUVERT') {
    return l.premiere_rupture
      ? `rupture le ${fmt.date(l.premiere_rupture)}${l.plan_non_couvert_kg > 0.05 ? `, ${kg(l.plan_non_couvert_kg)} kg non couverts` : ''}`
      : null
  }
  if (l.statut === 'SOUS_SECURITE') {
    return l.premier_passage_securite ? `sous la sécurité le ${fmt.date(l.premier_passage_securite)}` : null
  }
  return null
}

/** Les états du moteur, ce qu'ils veulent dire, et la couleur de leur compteur. */
const ETATS = [
  {
    cle: 'PLAN_NON_COUVERT',
    resume: 'Une rupture est prévue sur l’horizon du plan',
    Icone: PackageX,
    ton: 'danger' as const,
  },
  {
    cle: 'SOUS_SECURITE',
    resume: 'Le solde passe sous la sécurité, sans rupture',
    Icone: AlertTriangle,
    ton: 'alerte' as const,
  },
  {
    cle: 'COUVERT',
    resume: 'Ni rupture ni passage sous la sécurité',
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
            Surveillance / Alertes
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

  const colonnes: Colonne<LigneProjete>[] = [
    {
      champ: 'code_reference',
      entete: 'Référence',
      rendu: (l) => (
        <span className="block max-w-[11rem] truncate font-medium text-texte" title={l.code_reference}>
          {l.code_reference}
        </span>
      ),
    },
    {
      champ: 'designation',
      entete: 'Désignation',
      // Souvent la répétition du code : elle part la première sur la ligne ↳.
      secondaire: true,
      rendu: (l) => (
        <span className="block max-w-[12rem] truncate text-attenue-texte" title={l.designation ?? undefined}>
          {l.designation && l.designation !== l.code_reference ? l.designation : '—'}
        </span>
      ),
    },
    {
      champ: 'magasin_hors_restes_kg',
      entete: 'Disponible',
      numerique: true,
      largeur: '84px',
      rendu: (l) => kgCellule(l.magasin_hors_restes_kg),
    },
    {
      champ: 'machine_hors_restes_kg',
      entete: 'Sur machine',
      numerique: true,
      largeur: '84px',
      rendu: (l) => kgCellule(l.machine_hors_restes_kg),
    },
    {
      champ: 'restant_kg',
      entete: 'Restant',
      numerique: true,
      largeur: '76px',
      rendu: (l) => kgCellule(l.restant_kg),
    },
    {
      champ: 'arrivages_comptes_kg',
      entete: 'Arrivages',
      numerique: true,
      largeur: '84px',
      rendu: (l) =>
        l.arrivages_comptes_kg > 0.05 ? (
          <span
            title={
              l.prochain_arrivage_date
                ? `prochain : ${kg(l.prochain_arrivage_kg ?? 0)} kg le ${fmt.date(l.prochain_arrivage_date)}`
                : undefined
            }
          >
            {kg(l.arrivages_comptes_kg)}
          </span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'stock_total_projete_kg',
      entete: 'Stock total projeté',
      numerique: true,
      largeur: '96px',
      rendu: (l) => <span className="font-medium">{kg(l.stock_total_projete_kg)}</span>,
    },
    {
      champ: 'besoin_jusqu_livraison_kg',
      entete: 'Besoin jusqu’à livraison',
      numerique: true,
      largeur: '104px',
      rendu: (l) => (
        <span
          className={cn(l.besoin_jusqu_livraison_kg > l.magasin_hors_restes_kg + l.machine_hors_restes_kg + l.restant_kg + 0.05 && 'text-alerte')}
          title={`Le plan des ${l.delai_j} prochains jours (délai fournisseur)`}
        >
          {kgCellule(l.besoin_jusqu_livraison_kg)}
        </span>
      ),
    },
    {
      champ: 'jours_couverture',
      entete: 'Couverture planifiée',
      numerique: true,
      largeur: '96px',
      valeurTri: (l) => (l.jours_couverture == null ? 1e9 : l.jours_couverture),
      rendu: (l) => {
        const m = motif(l)
        return l.couvert_tout_horizon ? (
          <span className="text-succes" title={`Couvert jusqu’au ${fmt.date(l.couvert_jusqu_au)}, fin de l’horizon`}>
            horizon
          </span>
        ) : l.jours_couverture != null ? (
          <span
            className={cn('tabular-nums', l.statut === 'PLAN_NON_COUVERT' ? 'font-medium text-danger' : l.statut === 'SOUS_SECURITE' ? 'text-alerte' : '')}
            title={m ?? undefined}
          >
            {l.jours_couverture} j
          </span>
        ) : (
          <span className="text-attenue-texte">—</span>
        )
      },
    },
    {
      champ: 'qte_a_commander_kg',
      entete: 'À commander',
      numerique: true,
      largeur: '92px',
      rendu: (l) =>
        l.qte_a_commander_kg ? (
          <span
            className={cn('tabular-nums', l.a_commander_aujourdhui && 'font-semibold text-danger')}
            title={l.a_commander_aujourdhui ? 'Date limite de commande atteinte ou dépassée' : undefined}
          >
            {kg(l.qte_a_commander_kg)}
          </span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'montant_estime_mad',
      entete: 'Montant commande',
      numerique: true,
      largeur: '104px',
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
      champ: 'fournisseur_nom',
      entete: 'Fournisseur',
      secondaire: true,
      rendu: (l) => <span className="whitespace-nowrap">{fmt.texte(l.fournisseur_nom)}</span>,
    },
    {
      champ: 'delai_j',
      entete: 'Délai (j)',
      numerique: true,
      secondaire: true,
      rendu: (l) => l.delai_j ?? '—',
    },
    {
      champ: 'premiere_rupture',
      entete: '1re rupture',
      secondaire: true,
      rendu: (l) =>
        l.premiere_rupture ? (
          <span className="tabular-nums text-danger">{dateListe(l.premiere_rupture)}</span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'date_limite_commande',
      entete: 'Date limite de commande',
      secondaire: true,
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
      champ: 'classe_abc',
      entete: 'ABC / XYZ',
      largeur: '78px',
      secondaire: true,
      rendu: (l) =>
        !l.classe_abc ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <span
            className={cn(
              'inline-block rounded-[3px] px-1.5 py-px font-medium',
              l.classe_abc === 'A' ? 'bg-primaire/15 text-primaire' : 'text-attenue-texte',
            )}
          >
            {l.classe_abc}
            {l.classe_xyz ?? ''}
          </span>
        ),
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
