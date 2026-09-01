/**
 * Stock projete = stock disponible + en-cours fournisseur − besoins sur 12 mois.
 *
 * Le filtrage passe par un RAIL LATERAL plutot que par des onglets en haut : il
 * porte le NOMBRE de references derriere chaque statut. « Rupture » seul invite
 * a cliquer pour savoir ; « Rupture 12 » a deja repondu.
 *
 * Les compteurs se calculent sur le jeu complet, une seule fois, et ne bougent
 * pas quand on filtre : un compteur qui suivrait le filtre afficherait toujours
 * le total de ce qu'on regarde deja, et ne dirait plus rien.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
  History,
  Layers,
  PackageX,
  Shuffle,
  ShoppingCart,
  TrendingDown,
} from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/utils'
import { EnTetePage } from '../components/Layout'
import { PageAvecRail, RailLateral, type GroupeRail } from '../composants/RailLateral'
import {
  PanneauFiltres,
  useFiltres,
  type ChampFiltre,
} from '../composants/PanneauFiltres'
import { TableDroits, type Colonne } from '../components/TableDroits'
import { Etiquette, fmt } from '../components/ui'
import {
  MenuContextuelElement,
  MenuContextuelSeparateur,
  MenuContextuelTitre,
} from '../composants/ui/surcouches'
import { useOuvrirVue } from '../lib/navigation'

const MODULE = 'STOCK'

interface LigneProjete {
  code_reference: string
  designation: string
  fournisseur_nom: string | null
  stock_mrp_kg: number
  encours_kg: number
  besoin_12m_kg: number
  stock_projete_kg: number
  jours_couverture: number | null
  /** Bornes de l'echelle logique, servies par la vue : la jauge s'y gradue. */
  seuil_critique_jours: number | null
  seuil_alerte_jours: number | null
  conso_mensuelle_kg: number | null
  classe_xyz: string | null
  delai_livraison_jours: number | null
  unite_catalogue: string | null
  cmup_mad: number | null
  valeur_totale_mad: number | null
  date_derniere_sortie: string | null
  source_conso: string | null
  statut: string
  classe_abc: string | null
  /** Les deux couches, separement : c'est ce qui explique le statut final. */
  statut_physique: string | null
  statut_logique: string | null
  stock_physique_net_kg: number | null
  stock_quarantaine_kg: number | null
  stock_min_kg: number | null
  stock_max_kg: number | null
  sur_stock: number | null
  encours_retarde_kg: number | null
  nb_lignes_retardees: number | null
  retard_max_jours: number | null
  ecart_majeur: number | null
  besoins_calcules_le: string | null
  [k: string]: unknown
}

/**
 * Pourquoi cette ligne est-elle dans cet etat ?
 *
 * Le statut seul ne dit rien de sa cause : « critique » peut venir du magasin
 * vide aujourd'hui, d'une couverture trop courte demain, ou d'un camion qu'on
 * n'attend plus. Sans la cause, l'operateur doit reconstituer le calcul de
 * tete — et il finit par ne plus lire l'alerte.
 */
function motifAlerte(l: LigneProjete): string | null {
  if (l.statut === 'OK') return null
  if (l.statut === 'RUPTURE') {
    return (l.stock_physique_net_kg ?? 0) <= 0
      ? 'magasin vide'
      : 'les besoins de l horizon depassent le stock et les commandes'
  }
  if (l.statut_physique === 'CRITIQUE') {
    return `magasin sous son minimum (${fmt.nombre(l.stock_physique_net_kg ?? 0, 0)} pour ${fmt.nombre(l.stock_min_kg ?? 0, 0)} kg)`
  }
  if ((l.nb_lignes_retardees ?? 0) > 0) {
    return `${fmt.nombre(l.encours_retarde_kg ?? 0, 0)} kg ecartes : commande en retard de ${l.retard_max_jours} j`
  }
  if (l.jours_couverture != null) {
    return `${fmt.nombre(l.jours_couverture, 0)} jours de couverture`
  }
  return null
}

/**
 * La couverture, en chiffre et en jauge.
 *
 * TROIS CHOIX QUI SE TIENNENT.
 *
 * La COULEUR vient du statut calcule, jamais d'un seuil ecrit ici. Peindre en
 * rouge tout ce qui passe sous soixante jours contredirait le modele a double
 * declencheur : une reference a 55 jours mais au-dessus de son minimum magasin
 * n'est pas critique, et la ligne afficherait deux verdicts opposes — la
 * couverture en rouge, la colonne Statut en vert, a deux cases d'ecart.
 *
 * La GRADUATION vient de la base, pas du code. Le plein de la jauge est le
 * seuil d'alerte (P_SeuilAlerte), le repere le seuil critique
 * (P_SeuilCritique) ; tous deux voyagent dans la vue. Ecrits en dur, ils
 * cesseraient de suivre le parametre le jour ou la direction le deplace : le
 * chiffre changerait de statut, la barre non.
 *
 * La LARGEUR est fixe. Une jauge qui s'etirerait avec la colonne ne serait
 * comparable d'une ligne a l'autre que par accident — or c'est le seul usage
 * d'une jauge dans une liste : voir d'un coup laquelle est la plus courte.
 */
function JaugeCouverture({ ligne: l }: { ligne: LigneProjete }) {
  if (l.jours_couverture == null) return <span className="text-attenue-texte">—</span>

  const plein = l.seuil_alerte_jours ?? 0
  const critique = l.seuil_critique_jours ?? 0
  const grave = l.statut === 'RUPTURE' || l.statut === 'CRITIQUE'
  const alerte = l.statut === 'ATTENTION'

  // Une couverture negative existe : la projection retranche les besoins de
  // l'horizon et peut passer sous zero. La jauge se vide, elle ne s'inverse pas.
  const part = plein > 0 ? Math.min(Math.max(l.jours_couverture / plein, 0), 1) : 0

  return (
    <span
      className="relative inline-flex h-[18px] w-[86px] items-center justify-end overflow-hidden rounded-[3px] bg-attenue/40 px-1.5"
      title={
        plein > 0
          ? `${fmt.nombre(l.jours_couverture, 0)} jours — critique en dessous de ${critique}, confortable a partir de ${plein}`
          : `${fmt.nombre(l.jours_couverture, 0)} jours`
      }
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 transition-[width] duration-150 ease-out',
          grave ? 'bg-danger/25' : alerte ? 'bg-alerte/30' : 'bg-succes/25',
        )}
        style={{ width: `${part * 100}%` }}
      />
      {/* Repere du seuil critique : sans lui la jauge dit « peu », avec lui elle
          dit « peu, et de quel cote de la limite ». */}
      {plein > 0 && critique > 0 && critique < plein && (
        <span
          aria-hidden
          className="absolute inset-y-0 w-px bg-texte/25"
          style={{ left: `${(critique / plein) * 100}%` }}
        />
      )}
      <span
        className={cn(
          'relative tabular-nums',
          grave ? 'font-medium text-danger' : alerte ? 'text-alerte' : 'text-texte',
        )}
      >
        {fmt.nombre(l.jours_couverture, 0)} j
      </span>
    </span>
  )
}

const TON: Record<string, 'rouge' | 'ambre' | 'vert' | 'neutre'> = {
  RUPTURE: 'rouge',
  CRITIQUE: 'rouge',
  ATTENTION: 'ambre',
  OK: 'vert',
}

/** Chaque statut, ce qu'il veut dire, et la couleur de son compteur. */
const STATUTS = [
  {
    cle: 'RUPTURE',
    libelle: 'Rupture',
    resume: 'Projete a zero ou negatif',
    Icone: PackageX,
    ton: 'danger' as const,
  },
  {
    cle: 'CRITIQUE',
    libelle: 'Critique',
    resume: 'Sous le stock minimum, ou moins de 60 j',
    Icone: TrendingDown,
    ton: 'danger' as const,
  },

  {
    cle: 'ATTENTION',
    libelle: 'Attention',
    resume: 'Moins de 90 jours de couverture',
    Icone: AlertTriangle,
    ton: 'alerte' as const,
  },
  {
    cle: 'OK',
    libelle: 'Situation normale',
    resume: 'Couverture suffisante',
    Icone: CheckCircle2,
    ton: 'succes' as const,
  },
]

/** Ce sur quoi une question peut porter, avec le type qui decide des operateurs. */
/**
 * Filtres du stock projete.
 *
 * Uniquement des axes que l'on choisit, jamais de comparateur a saisir : sur
 * cet ecran, les questions reelles sont « quelles references en tension »,
 * « chez quel fournisseur », « quelle classe » — pas « couverture < 42 ».
 */
const CHAMPS_FILTRABLES: ChampFiltre<LigneProjete>[] = [
  { cle: 'statut', libelle: 'Statut', type: 'liste', valeur: (l) => l.statut },
  { cle: 'fournisseur', libelle: 'Fournisseur', type: 'liste', valeur: (l) => l.fournisseur_nom },
  { cle: 'classe', libelle: 'Classe ABC', type: 'liste', valeur: (l) => l.classe_abc },
  { cle: 'reference', libelle: 'Reference', type: 'texte', valeur: (l) => l.code_reference },
]

/**
 * Le menu au clic droit sur une ligne de stock.
 *
 * IL NE CREE AUCUN CHEMIN. Chacune de ces quatre destinations reste atteignable
 * par la navigation ordinaire ; le menu ne fait que les atteindre AVEC la
 * reference deja portee. C'est la difference entre « ouvrir l'ecran des
 * mouvements » et « voir l'historique de PES-20/2 » : le second evite a
 * l'operateur de retaper un code qu'il a sous les yeux, et donc de le retaper
 * faux. Un menu contextuel ne s'ouvre ni au clavier ni au doigt : y loger une
 * action unique la rendrait inaccessible a une partie des postes.
 *
 * Les liens portent `?reference=`, et les trois ecrans vises le lisent. Un
 * parametre qu'une page ignorerait serait pire que pas de lien du tout :
 * l'entree promettrait un filtre et livrerait une liste entiere.
 */
function ActionsLigne({
  ligne: l,
  ouvrir,
}: {
  ligne: LigneProjete
  ouvrir: (chemin: string) => void
}) {
  const ref = encodeURIComponent(l.code_reference)
  const tendu = l.statut === 'RUPTURE' || l.statut === 'CRITIQUE'

  return (
    <>
      <MenuContextuelTitre>{l.code_reference}</MenuContextuelTitre>
      <MenuContextuelSeparateur />

      {/* Commander en tete quand la ligne est en tension : c'est l'action que
          l'acheteur cherche, et la remonter evite de la lire dans une liste. */}
      {tendu && (
        <MenuContextuelElement onSelect={() => ouvrir(`/bons-commande/nouveau?reference=${ref}`)}>
          <ShoppingCart /> Commander cette reference
        </MenuContextuelElement>
      )}

      <MenuContextuelElement onSelect={() => ouvrir(`/catalogue?reference=${ref}`)}>
        <FileText /> Ouvrir la fiche
      </MenuContextuelElement>

      <MenuContextuelElement onSelect={() => ouvrir(`/mouvements?reference=${ref}`)}>
        <History /> Voir l historique des mouvements
      </MenuContextuelElement>

      <MenuContextuelElement onSelect={() => ouvrir(`/equivalences?reference=${ref}`)}>
        <Shuffle /> Chercher un equivalent
      </MenuContextuelElement>

      {!tendu && (
        <MenuContextuelElement onSelect={() => ouvrir(`/bons-commande/nouveau?reference=${ref}`)}>
          <ShoppingCart /> Commander cette reference
        </MenuContextuelElement>
      )}

      <MenuContextuelSeparateur />

      {/* L'inventaire ne porte pas la reference : il se lance par magasin, et
          l'ecran demande lequel. Promettre un inventaire cible ici serait
          promettre ce que le module ne fait pas. */}
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

  // Un seul appel, sans filtre serveur : le jeu tient largement en memoire, et
  // le garder entier permet de compter chaque statut sans quatre requetes.
  const q = useQuery({
    queryKey: ['stock-projete'],
    queryFn: () => api.get<LigneProjete[]>('/api/stock/projete?limite=2000'),
  })

  const toutes = useMemo(() => q.data ?? [], [q.data])

  const comptes = useMemo(() => {
    const m: Record<string, number> = {}
    for (const l of toutes) m[l.statut] = (m[l.statut] ?? 0) + 1
    for (const c of toutes) {
      if (c.classe_abc) m[`ABC:${c.classe_abc}`] = (m[`ABC:${c.classe_abc}`] ?? 0) + 1
    }
    return m
  }, [toutes])

  const classes = useMemo(
    () => [...new Set(toutes.map((l) => l.classe_abc).filter(Boolean) as string[])].sort(),
    [toutes],
  )

  const lignes = useMemo(() => {
    const f = recherche.trim().toLowerCase()
    const base = toutes
      .filter((l) => {
        if (!filtre) return true
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
    return base.filter(filtres.retenir)
  }, [toutes, filtre, recherche, filtres])

  const groupes: GroupeRail[] = [
    {
      entrees: [
        {
          cle: '',
          libelle: 'Toutes les references',
          resume: 'Sans filtre',
          Icone: Layers,
          compte: toutes.length,
        },
      ],
    },
    {
      titre: 'Par statut',
      entrees: STATUTS.map((s) => ({
        cle: s.cle,
        libelle: s.libelle,
        resume: s.resume,
        Icone: s.Icone,
        compte: comptes[s.cle] ?? 0,
        ton: s.ton,
      })),
    },
  ]

  if (classes.length > 0) {
    groupes.push({
      titre: 'Par classe ABC',
      entrees: classes.map((c) => ({
        cle: `ABC:${c}`,
        libelle: `Classe ${c}`,
        resume:
          c === 'A'
            ? 'Le gros du capital immobilise'
            : c === 'B'
              ? 'Poids intermediaire'
              : 'Nombreuses, faible valeur',
        compte: comptes[`ABC:${c}`] ?? 0,
        ton: c === 'A' ? ('danger' as const) : ('neutre' as const),
      })),
    })
  }

  const colonnes: Colonne<LigneProjete>[] = [
    {
      champ: 'code_reference',
      entete: 'Reference',
      rendu: (l) => <span className="font-medium text-texte">{l.code_reference}</span>,
    },
    {
      champ: 'statut',
      entete: 'Statut',
      // Le statut, sa CAUSE, et le sur-stock qui est un axe distinct. Les trois
      // tiennent dans la meme cellule parce qu'ils se lisent ensemble : « rouge »
      // sans « pourquoi » oblige a rouvrir le calcul de tete.
      rendu: (l) => {
        const motif = motifAlerte(l)
        return (
          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-1">
              <Etiquette ton={TON[l.statut] ?? 'neutre'}>{l.statut}</Etiquette>
              {l.sur_stock === 1 && <Etiquette ton="neutre">sur-stock</Etiquette>}
              {l.ecart_majeur === 1 && <Etiquette ton="ambre">ecart a verifier</Etiquette>}
            </div>
            {motif && <div className="text-[11px] text-attenue-texte">{motif}</div>}
          </div>
        )
      },
    },
    {
      champ: 'quantite_kg',
      entete: 'Stock (kg)',
      numerique: true,
      rendu: (l) => fmt.nombre(l.stock_mrp_kg, 1),
    },
    {
      champ: 'stock_projete_kg',
      entete: 'Projete (kg)',
      numerique: true,
      rendu: (l) => (
        <span className={l.stock_projete_kg < 0 ? 'font-medium text-red-600' : ''}>
          {fmt.nombre(l.stock_projete_kg, 1)}
        </span>
      ),
    },
    {
      champ: 'jours_couverture',
      entete: 'Couverture',
      numerique: true,
      /* La couverture se colore selon le STATUT calcule, jamais selon un seuil
         ecrit ici. Peindre en rouge tout ce qui passe sous soixante jours
         contredirait le modele a double declencheur : une reference a 55 jours
         mais au-dessus de son minimum magasin n'est pas critique, et l'ecran
         afficherait alors deux verdicts opposes sur la meme ligne. */
      rendu: (l) => <JaugeCouverture ligne={l} />,
    },
    {
      champ: 'date_derniere_entree',
      entete: 'En-cours (kg)',
      numerique: true,
      secondaire: true,
      rendu: (l) => fmt.nombre(l.encours_kg, 1),
    },
    {
      champ: 'designation',
      entete: 'Fournisseur',
      rendu: (l) => fmt.texte(l.fournisseur_nom),
      secondaire: true,
    },

    /* --- Les colonnes du classeur qui manquaient ------------------------
       La vue en expose trente-six, l'ecran n'en montrait sept. Celles-ci
       sont marquees `secondaire` : elles apparaissent au-dela de 1280 px et
       restent accessibles par le menu de colonnes. Une tablette de magasin
       garde ses sept colonnes lisibles ; un poste de bureau voit tout. */
    {
      champ: 'classe_abc',
      entete: 'ABC / XYZ',
      largeur: '78px',
      secondaire: true,
      // Les deux classements ensemble : la valeur ET la regularite. Une
      // reference AX se pilote au fil de l'eau, une AZ demande un stock de
      // securite — c'est le croisement qui dit la politique, pas chaque
      // lettre prise seule.
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
      champ: 'stock_physique_net_kg',
      entete: 'Physique (kg)',
      numerique: true,
      secondaire: true,
      rendu: (l) => fmt.nombre(l.stock_physique_net_kg ?? 0, 1),
    },
    {
      champ: 'stock_min_kg',
      entete: 'Minimum (kg)',
      numerique: true,
      secondaire: true,
      rendu: (l) => (l.stock_min_kg == null ? '—' : fmt.nombre(l.stock_min_kg, 1)),
    },
    {
      champ: 'conso_mensuelle_kg',
      entete: 'Conso / mois',
      numerique: true,
      secondaire: true,
      rendu: (l) =>
        l.conso_mensuelle_kg == null ? '—' : fmt.nombre(l.conso_mensuelle_kg, 1),
    },
    {
      champ: 'besoin_12m_kg',
      entete: 'Besoin horizon',
      numerique: true,
      secondaire: true,
      rendu: (l) => (l.besoin_12m_kg == null ? '—' : fmt.nombre(l.besoin_12m_kg, 1)),
    },
    {
      champ: 'delai_livraison_jours',
      entete: 'Delai (j)',
      numerique: true,
      secondaire: true,
      rendu: (l) => l.delai_livraison_jours ?? '—',
    },
    {
      champ: 'unite_catalogue',
      entete: 'Unite',
      secondaire: true,
      rendu: (l) => fmt.texte(l.unite_catalogue),
    },
    {
      champ: 'cmup_mad',
      entete: 'CMUP',
      numerique: true,
      secondaire: true,
      rendu: (l) => (l.cmup_mad == null ? '—' : fmt.nombre(l.cmup_mad, 2)),
    },
    {
      champ: 'valeur_totale_mad',
      entete: 'Valeur (MAD)',
      numerique: true,
      secondaire: true,
      rendu: (l) => (l.valeur_totale_mad == null ? '—' : fmt.nombre(l.valeur_totale_mad, 2)),
    },
    {
      champ: 'sur_stock',
      entete: 'Sur-stock',
      largeur: '80px',
      secondaire: true,
      // Le sur-stock est un drapeau SEPARE du statut, pas une valeur de
      // l'echelle : une reference peut etre en sur-stock ET en alerte, si le
      // stock dort dans le mauvais magasin.
      rendu: (l) =>
        l.sur_stock ? (
          <span className="rounded-[3px] bg-alerte/12 px-1.5 py-px text-[11px] text-alerte">
            oui
          </span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'date_derniere_sortie',
      entete: 'Derniere sortie',
      secondaire: true,
      rendu: (l) => fmt.date(l.date_derniere_sortie),
    },
  ]

  return (
    <div>
      <EnTetePage
        titre="Stock projete"
        sous_titre="Stock disponible + en-cours fournisseur − besoins sur 12 mois"
      />

      <PageAvecRail
        large
        rail={
          <div className="space-y-3">
            <RailLateral
              groupes={groupes}
              actif={filtre}
              surChoix={setFiltre}
              recherche={{
                valeur: recherche,
                surChangement: setRecherche,
                placeholder: 'Reference, fournisseur…',
              }}
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
            {lignes.length} reference(s) sur {toutes.length} apres filtrage.
          </div>
        )}
        <TableDroits
          exportable="etat-des-stocks"
          imprimable="Etat des stocks"
          module={MODULE}
          menuContextuel={(l) => <ActionsLigne ligne={l} ouvrir={ouvrir} />}
          colonnes={colonnes}
          lignes={lignes}
          chargement={q.isLoading}
          cle={(l) => l.code_reference}
          titreCarte={(l) => l.code_reference}
          texteVide="Aucune reference pour ce filtre."
        />
      </PageAvecRail>
    </div>
  )
}
