/**
 * LE STOCK PROJETÉ EST UNE VUE DU MOTEUR DE COUVERTURE (27/10/2026, une seule
 * source de vérité). Plus de « stock disponible + en-cours − besoins sur 12 mois »
 * ni d'échelle RUPTURE / CRITIQUE / ATTENTION / OK : chaque référence suivie
 * (une demande au plan, du stock ou un arrivage) a l'état que le moteur lui donne
 * en projetant le plan jour par jour —
 *
 *   * PLAN NON COUVERT : une rupture est prévue sur l'horizon du plan ;
 *   * SOUS LA SÉCURITÉ : le solde passe sous la sécurité, sans rupture ;
 *   * COUVERT : ni l'un ni l'autre ;
 *
 * et, à part, « à commander aujourd'hui » (la date limite de commande de la
 * première proposition est atteinte ou dépassée). Les mêmes chiffres que l'onglet
 * « À commander » du plan d'achat : disponible compté, couvert jusqu'au, première
 * rupture, plan non couvert, arrivages comptés, proposition.
 *
 * Le filtrage passe par un RAIL LATÉRAL : il porte le NOMBRE de références derrière
 * chaque état, calculé une fois sur le jeu complet.
 */
import { useMemo, useState } from 'react'
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
} from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/utils'
import { EnTetePage } from '../components/Layout'
import { PageAvecRail, RailLateral, type GroupeRail } from '../composants/RailLateral'
import { PanneauFiltres, useFiltres, type ChampFiltre } from '../composants/PanneauFiltres'
import { TableDroits, type Colonne } from '../components/TableDroits'
import { fmt } from '../lib/utils'
import {
  MenuContextuelElement,
  MenuContextuelSeparateur,
  MenuContextuelTitre,
} from '../composants/ui/surcouches'
import { useOuvrirVue } from '../lib/navigation'
import { BesoinReference } from '../composants/BesoinOf'
import { Badge, Bouton } from '../composants/ui/base'
import { StatutBadge } from '../composants/StatutBadge'
import { libelleStatut } from '../lib/statuts'

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

export function Stock() {
  const ouvrir = useOuvrirVue()
  const [filtre, setFiltre] = useState('')
  const [recherche, setRecherche] = useState('')
  const filtres = useFiltres(CHAMPS_FILTRABLES)
  // La référence ouverte : son besoin, en haut de la liste.
  const [ouverte, setOuverte] = useState<string | null>(null)

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
      rendu: (l) => <span className="whitespace-nowrap font-medium text-texte">{l.code_reference}</span>,
    },
    {
      champ: 'statut',
      entete: 'État',
      // L'état, sa cause en une date, et le défaut de données s'il y en a un.
      rendu: (l) => {
        const m = motif(l)
        return (
          <div className="flex items-center gap-1.5 whitespace-nowrap" title={m ?? undefined}>
            <StatutBadge entite="statut_stock" code={l.statut} />
            {l.a_commander_aujourdhui && <Badge ton="danger">à commander</Badge>}
            {l.defaut_donnees && (
              <Badge ton="alerte" title={l.defaut_donnees}>
                donnée
              </Badge>
            )}
            {m && <span className="max-w-[12rem] truncate text-[11px] text-attenue-texte">{m}</span>}
          </div>
        )
      },
    },
    {
      champ: 'disponible_kg',
      entete: 'Disponible (kg)',
      numerique: true,
      rendu: (l) => (
        <span
          title={
            l.machine_kg > 0.05
              ? `${kg(l.magasin_kg, 1)} kg en magasins comptés + ${kg(l.machine_kg, 1)} kg sur métiers`
              : undefined
          }
        >
          {kg(l.disponible_kg, 1)}
        </span>
      ),
    },
    {
      champ: 'couvert_jusqu_au',
      entete: 'Couvert jusqu’au',
      rendu: (l) =>
        l.couvert_tout_horizon ? (
          <span className="text-succes">tout l’horizon</span>
        ) : l.couvert_jusqu_au ? (
          <span className="tabular-nums">
            {fmt.date(l.couvert_jusqu_au)}
            {l.jours_couverture != null && <span className="text-attenue-texte"> · {l.jours_couverture} j</span>}
          </span>
        ) : (
          <span className="font-medium text-danger">rupture aujourd’hui</span>
        ),
    },
    {
      champ: 'plan_non_couvert_kg',
      entete: 'Plan non couvert (kg)',
      numerique: true,
      rendu: (l) =>
        l.plan_non_couvert_kg > 0.05 ? (
          <span className="font-medium text-danger">{kg(l.plan_non_couvert_kg)}</span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'qte_a_commander_kg',
      entete: 'À commander',
      numerique: true,
      rendu: (l) =>
        l.qte_a_commander_kg ? (
          <span className={cn('whitespace-nowrap tabular-nums', l.a_commander_aujourdhui && 'font-medium text-danger')}>
            {kg(l.qte_a_commander_kg)} kg
            {l.date_limite_commande && (
              <span className="text-attenue-texte"> · avant le {fmt.date(l.date_limite_commande)}</span>
            )}
          </span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'plan_horizon_kg',
      entete: 'Plan sur l’horizon (kg)',
      numerique: true,
      secondaire: true,
      rendu: (l) => kg(l.plan_horizon_kg),
    },
    {
      champ: 'arrivages_comptes_kg',
      entete: 'Arrivages comptés (kg)',
      numerique: true,
      secondaire: true,
      rendu: (l) =>
        l.arrivages_comptes_kg > 0.05 ? (
          <span
            title={
              l.prochain_arrivage_date
                ? `prochain : ${kg(l.prochain_arrivage_kg)} kg le ${fmt.date(l.prochain_arrivage_date)}`
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
      champ: 'fournisseur_nom',
      entete: 'Fournisseur',
      secondaire: true,
      rendu: (l) => <span className="whitespace-nowrap">{fmt.texte(l.fournisseur_nom)}</span>,
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
    {
      champ: 'delai_j',
      entete: 'Délai (j)',
      numerique: true,
      secondaire: true,
      rendu: (l) => l.delai_j ?? '—',
    },
  ]

  return (
    <div>
      <EnTetePage
        titre="Stock projeté"
        sous_titre="La couverture du plan par le moteur : ce qui est compté aujourd’hui, ce qui arrive à sa date, jusqu’où le plan est couvert"
      />

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
        {ouverte && (
          <section className="mb-3 rounded-md border border-bordure bg-surface p-3">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-[13px] font-semibold">Besoin de {ouverte}</h2>
              <Bouton variante="discret" taille="sm" className="ml-auto" onClick={() => setOuverte(null)}>
                Fermer
              </Bouton>
            </div>
            <BesoinReference reference={ouverte} />
          </section>
        )}
        <TableDroits
          exportable="stock-projete"
          imprimable="Stock projeté"
          module={MODULE}
          menuContextuel={(l) => <ActionsLigne ligne={l} ouvrir={ouvrir} />}
          surClic={(l) => setOuverte((o) => (o === l.code_reference ? null : l.code_reference))}
          colonnes={colonnes}
          lignes={lignes}
          chargement={q.isLoading}
          erreur={q.error}
          cle={(l) => l.code_reference}
          titreCarte={(l) => l.code_reference}
          texteVide="Aucune référence pour ce filtre."
        />
      </PageAvecRail>
    </div>
  )
}
