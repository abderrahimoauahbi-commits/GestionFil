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
import { AlertTriangle, CheckCircle2, Layers, PackageX, TrendingDown } from 'lucide-react'
import { api } from '../api/client'
import { EnTetePage } from '../components/Layout'
import { PageAvecRail, RailLateral, type GroupeRail } from '../composants/RailLateral'
import {
  FiltrePersonnalise,
  appliquerConditions,
  type ChampFiltrable,
  type Condition,
} from '../composants/FiltrePersonnalise'
import { TableDroits, type Colonne } from '../components/TableDroits'
import { Etiquette, fmt } from '../components/ui'

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
  conso_mensuelle_kg: number | null
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
const CHAMPS_FILTRABLES: ChampFiltrable[] = [
  { champ: 'code_reference', libelle: 'Reference', type: 'texte' },
  { champ: 'designation', libelle: 'Designation', type: 'texte' },
  { champ: 'fournisseur_nom', libelle: 'Fournisseur', type: 'texte' },
  { champ: 'stock_mrp_kg', libelle: 'Stock disponible', type: 'nombre', unite: 'kg' },
  { champ: 'encours_kg', libelle: 'En-cours fournisseur', type: 'nombre', unite: 'kg' },
  { champ: 'besoin_12m_kg', libelle: 'Besoin 12 mois', type: 'nombre', unite: 'kg' },
  { champ: 'stock_projete_kg', libelle: 'Stock projete', type: 'nombre', unite: 'kg' },
  { champ: 'jours_couverture', libelle: 'Couverture', type: 'nombre', unite: 'jours' },
  { champ: 'conso_mensuelle_kg', libelle: 'Consommation mensuelle', type: 'nombre', unite: 'kg' },
  {
    champ: 'statut',
    libelle: 'Statut',
    type: 'liste',
    options: [
      { valeur: 'RUPTURE', libelle: 'Rupture' },
      { valeur: 'CRITIQUE', libelle: 'Critique' },
      { valeur: 'ATTENTION', libelle: 'Attention' },
      { valeur: 'OK', libelle: 'Situation normale' },
    ],
  },
  {
    champ: 'statut_physique',
    libelle: 'Couche physique',
    type: 'liste',
    options: [
      { valeur: 'RUPTURE', libelle: 'Magasin vide' },
      { valeur: 'CRITIQUE', libelle: 'Sous le minimum' },
      { valeur: 'OK', libelle: 'Suffisant' },
    ],
  },
  {
    champ: 'sur_stock',
    libelle: 'Sur-stock',
    type: 'liste',
    options: [
      { valeur: '1', libelle: 'Au-dela du maximum' },
      { valeur: '0', libelle: 'Dans les bornes' },
    ],
  },
  { champ: 'stock_physique_net_kg', libelle: 'Stock physique net', type: 'nombre', unite: 'kg' },
  { champ: 'stock_min_kg', libelle: 'Stock minimum', type: 'nombre', unite: 'kg' },
  { champ: 'encours_retarde_kg', libelle: 'En-cours en retard', type: 'nombre', unite: 'kg' },
  {
    champ: 'classe_abc',
    libelle: 'Classe ABC',
    type: 'liste',
    options: [
      { valeur: 'A', libelle: 'A' },
      { valeur: 'B', libelle: 'B' },
      { valeur: 'C', libelle: 'C' },
    ],
  },
  {
    champ: 'source_conso',
    libelle: 'Source de consommation',
    type: 'liste',
    options: [
      { valeur: 'REELLE', libelle: 'Reelle' },
      { valeur: 'PREVISIONNELLE_MRP', libelle: 'Previsionnelle (MRP)' },
      { valeur: 'INDETERMINEE', libelle: 'Indeterminee' },
    ],
  },
]

export function Stock() {
  const [filtre, setFiltre] = useState('')
  const [recherche, setRecherche] = useState('')
  const [conditions, setConditions] = useState<Condition[]>([])

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
    return appliquerConditions(base, conditions, CHAMPS_FILTRABLES)
  }, [toutes, filtre, recherche, conditions])

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
      rendu: (l) => (l.jours_couverture == null ? '—' : `${fmt.nombre(l.jours_couverture, 0)} j`),
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
            <FiltrePersonnalise
              champs={CHAMPS_FILTRABLES}
              conditions={conditions}
              surChangement={setConditions}
            />
          </div>
        }
      >
        {conditions.length > 0 && (
          <div className="mb-2 text-[12px] text-attenue-texte">
            {lignes.length} reference(s) sur {toutes.length} apres filtrage.
          </div>
        )}
        <TableDroits
          module={MODULE}
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
