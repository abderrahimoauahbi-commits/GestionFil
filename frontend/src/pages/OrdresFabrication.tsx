/**
 * LES ORDRES DE FABRICATION (22/10/2026, docs/A-DECIDER-of-supply-chain.md).
 *
 * L'OF — date, qualité, métrage — PRÉVOIT la consommation, ORIENTE les machines
 * et ANALYSE la réalité ; il ne déplace jamais le stock. Il n'entre pas dans le
 * besoin d'achat (le plan de production seul, 2026-10-27b) ; C64 signale un OF
 * au-delà du plan du mois. Deux onglets :
 *
 *   Ordres de fabrication   la liste, filtrée par statut (barre de droite),
 *                           qualité, période ; chaque OF s'ouvre sur sa page ;
 *   Consommation par qualité  par qualité et par mois de l'OF : le prévu
 *                           (métrage × recette, perte comprise), le réel (écarts
 *                           machine attribués + hors machine), l'écart.
 *
 * Le réel ne vient JAMAIS de la recette : il est la somme des écarts constatés
 * sur les machines pendant que l'OF occupait la portion, et des consommations
 * directes portant l'OF, retours déduits.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, ClipboardCheck, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { PageAvecRail, RailLateral, type GroupeRail } from '../composants/RailLateral'
import { PanneauFiltres, useFiltres, type ChampFiltre } from '../composants/PanneauFiltres'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import { Bouton, Champ, Chargement, Etiq } from '../composants/ui/base'
import { Onglet, OngletContenu, Onglets, OngletsListe } from '../composants/ui/surcouches'
import { PanneRequetes } from '../composants/PanneRequetes'
import { cn, fmt } from '../lib/utils'
import { ChoixRecherche } from '../composants/ChoixRecherche'
import { StatutBadge } from '../composants/StatutBadge'

export const MODULE_OF = 'PLANS'

export interface OfListe extends Record<string, unknown> {
  id_of: string
  numero: string
  code_qualite: string
  qualite_nom: string
  statut: string
  date_of: string
  date_fin_prevue: string | null
  metrage_m2: number
  kg_prevu: number
  kg_reel: number
  kg_conso_fil: number
  kg_hors_machine: number
  kg_dechet: number
  kg_perte: number
  kg_casse: number
  ecart_kg: number
  ecart_pct: number | null
  cree_par: string | null
}

interface QualiteConso extends Record<string, unknown> {
  /** Vide : « Non attribué » — l'historique consommé sans OF ni qualité (23/10/2026). */
  code_qualite: string | null
  qualite_nom: string
  mois: string
  nb_of: number
  nb_of_clotures: number
  metrage_m2: number
  kg_prevu: number
  kg_conso_fil: number
  kg_hors_machine: number
  kg_reel: number
  kg_dechet: number
  kg_perte: number
  kg_casse: number
  kg_autre_ecart: number
  ecart_kg: number | null
  ecart_pct: number | null
  /** La part des OF, et ce qui a été consommé sans OF sous cette qualité (23/10/2026). */
  kg_reel_of?: number
  kg_reel_sans_of?: number
  attribue?: boolean
}

/** L'écart réel − prévu : signé, coloré seulement au-delà de 15 % (P_EcartOfPct par défaut). */
export function Ecart({ kg, pct }: { kg: number; pct: number | null }) {
  const fort = pct != null && Math.abs(pct) > 15
  return (
    <span className={cn('tabular-nums', fort && 'font-medium text-alerte')}>
      {kg > 0 ? '+' : ''}
      {fmt.nombre(kg, 1)}
      {pct != null && <span className="ml-1 text-[11px] text-attenue-texte">({pct > 0 ? '+' : ''}{fmt.nombre(pct, 1)} %)</span>}
    </span>
  )
}

const kg = (v: unknown) => fmt.nombre(Number(v ?? 0), 1)

const CHAMPS_OF: ChampFiltre<OfListe>[] = [
  { cle: 'periode', libelle: 'Période', type: 'periode', valeur: (l) => l.date_of },
  { cle: 'qualite', libelle: 'Qualité', type: 'liste', valeur: (l) => l.code_qualite },
  { cle: 'numero', libelle: 'Numéro', type: 'texte', valeur: (l) => l.numero },
]

export function OrdresFabrication() {
  const droits = useDroits(MODULE_OF)
  const naviguer = useNavigate()
  const [onglet, setOnglet] = useState('of')

  return (
    <div>
      <EnTetePage
        titre="Ordres de fabrication"
        description="L'OF prévoit et oriente ; la consommation réelle se lit sur les machines et les consommations directes qui le portent."
        actions={
          droits.peutEcrire && (
            <Bouton title="Nouvel ordre de fabrication" aria-label="Nouvel OF" onClick={() => naviguer('/ordres-fabrication/nouveau')}>
              <Plus />
              Nouvel OF
            </Bouton>
          )
        }
      />
      <Onglets value={onglet} onValueChange={setOnglet}>
        <OngletsListe>
          <Onglet value="of">
            <ClipboardCheck className="size-3.5" />
            Ordres de fabrication
          </Onglet>
          <Onglet value="qualites">
            <BarChart3 className="size-3.5" />
            Consommation par qualité
          </Onglet>
        </OngletsListe>
        <OngletContenu value="of" className="mt-3">
          <ListeOf />
        </OngletContenu>
        <OngletContenu value="qualites" className="mt-3">
          <ConsommationQualites />
        </OngletContenu>
      </Onglets>
    </div>
  )
}

function ListeOf() {
  const naviguer = useNavigate()
  const [statut, setStatut] = useState('')
  const filtres = useFiltres(CHAMPS_OF)
  const q = useQuery({
    queryKey: ['ordres-fabrication'],
    queryFn: ({ signal }) => api.get<OfListe[]>('/api/ordres-fabrication', { signal }),
  })

  const colonnes: ColonneDT<OfListe>[] = [
    { champ: 'numero', entete: 'N° d’OF', rendu: (o) => <span className="font-mono text-xs">{o.numero}</span> },
    { champ: 'date_of', entete: 'Date', rendu: (o) => fmt.date(o.date_of) },
    { champ: 'code_qualite', entete: 'Qualité', rendu: (o) => <span title={o.qualite_nom}>{o.code_qualite}</span> },
    { champ: 'metrage_m2', entete: 'Métrage (m²)', numerique: true, rendu: (o) => fmt.nombre(Number(o.metrage_m2), 0) },
    {
      champ: 'statut',
      entete: 'Statut',
      rendu: (o) => <StatutBadge entite="ordre_fabrication" code={o.statut} />,
    },
    { champ: 'kg_prevu', entete: 'Prévu (kg)', numerique: true, rendu: (o) => kg(o.kg_prevu) },
    { champ: 'kg_reel', entete: 'Réel (kg)', numerique: true, rendu: (o) => kg(o.kg_reel) },
    {
      champ: 'ecart_kg',
      entete: 'Écart (kg)',
      numerique: true,
      rendu: (o) => <Ecart kg={Number(o.ecart_kg)} pct={o.ecart_pct == null ? null : Number(o.ecart_pct)} />,
    },
    { champ: 'date_fin_prevue', entete: 'Fin prévue', secondaire: true, rendu: (o) => fmt.date(o.date_fin_prevue) },
    {
      champ: 'kg_dechet',
      entete: 'Déchets · pertes · casses (kg)',
      secondaire: true,
      rendu: (o) => kg(Number(o.kg_dechet ?? 0) + Number(o.kg_perte ?? 0) + Number(o.kg_casse ?? 0)),
    },
  ]

  if (q.isLoading) return <Chargement />
  const tous = q.data ?? []
  const comptes = tous.reduce<Record<string, number>>((m, o) => {
    m[o.statut] = (m[o.statut] ?? 0) + 1
    return m
  }, {})
  const filtrables = tous.filter((o) => !statut || o.statut === statut)
  const vus = filtrables.filter(filtres.retenir)

  const groupes: GroupeRail[] = [
    { entrees: [{ cle: '', libelle: 'Tous les OF', compte: tous.length }] },
    {
      titre: 'Par statut',
      entrees: [
        { cle: 'PREVU', libelle: 'Prévu', resume: 'À lancer', compte: comptes.PREVU ?? 0, ton: 'neutre' as const },
        { cle: 'LANCE', libelle: 'Lancé', resume: 'En production', compte: comptes.LANCE ?? 0, ton: 'alerte' as const },
        { cle: 'CLOTURE', libelle: 'Clôturé', resume: 'Consommation arrêtée', compte: comptes.CLOTURE ?? 0, ton: 'succes' as const },
        { cle: 'ANNULE', libelle: 'Annulé', compte: comptes.ANNULE ?? 0, ton: 'neutre' as const },
      ],
    },
  ]

  return (
    <>
      <PanneRequetes requetes={[['Les ordres de fabrication', q]]} />
      <PageAvecRail
        large
        rail={
          <div className="space-y-3">
            <RailLateral groupes={groupes} actif={statut} surChoix={setStatut} />
            <PanneauFiltres
              champs={CHAMPS_OF}
              lignes={filtrables}
              valeurs={filtres.valeurs}
              definir={filtres.definir}
              reinitialiser={filtres.reinitialiser}
              actifs={filtres.actifs}
            />
          </div>
        }
      >
        <DataTable<OfListe>
          exportable="ordres-fabrication"
          imprimable="Ordres de fabrication"
          module={MODULE_OF}
          colonnes={colonnes}
          lignes={vus}
          cle={(o) => o.id_of}
          surClic={(o) => naviguer(`/ordres-fabrication/${o.id_of}`)}
          titreCarte={(o) => `${o.numero} — ${o.code_qualite}`}
          placeholderRecherche="Filtrer les OF..."
          tailleParDefaut={25}
          videTitre="Aucun ordre de fabrication"
        />
      </PageAvecRail>
    </>
  )
}

function ConsommationQualites() {
  const [qualite, setQualite] = useState('')
  const [du, setDu] = useState('')
  const [au, setAu] = useState('')
  const params = new URLSearchParams()
  if (qualite) params.set('qualite', qualite)
  if (du) params.set('du', du)
  if (au) params.set('au', au)
  const q = useQuery({
    queryKey: ['consommation-qualites', qualite, du, au],
    queryFn: ({ signal }) =>
      api.get<QualiteConso[]>(`/api/ordres-fabrication/consommation-qualites?${params.toString()}`, { signal }),
  })

  const colonnes: ColonneDT<QualiteConso>[] = [
    {
      champ: 'code_qualite',
      entete: 'Qualité',
      rendu: (l) =>
        l.code_qualite ? (
          <span title={l.qualite_nom}>{l.code_qualite}</span>
        ) : (
          <span className="italic text-attenue-texte" title="Consommé sans OF ni qualité : l’historique d’avant le 23/10/2026">
            Non attribué
          </span>
        ),
    },
    { champ: 'mois', entete: 'Mois', rendu: (l) => <span className="tabular-nums">{l.mois}</span> },
    { champ: 'nb_of', entete: 'OF', numerique: true, rendu: (l) => `${l.nb_of}${l.nb_of_clotures ? ` (${l.nb_of_clotures} clôt.)` : ''}` },
    { champ: 'metrage_m2', entete: 'Métrage (m²)', numerique: true, rendu: (l) => fmt.nombre(Number(l.metrage_m2), 0) },
    { champ: 'kg_prevu', entete: 'Prévu (kg)', numerique: true, rendu: (l) => kg(l.kg_prevu) },
    { champ: 'kg_reel', entete: 'Réel (kg)', numerique: true, rendu: (l) => kg(l.kg_reel) },
    {
      champ: 'ecart_kg',
      entete: 'Écart (kg)',
      numerique: true,
      // L'écart ne compare que ce que les OF ont prévu à ce qu'ils ont consommé.
      rendu: (l) =>
        l.ecart_kg == null ? '—' : <Ecart kg={Number(l.ecart_kg)} pct={l.ecart_pct == null ? null : Number(l.ecart_pct)} />,
    },
    { champ: 'kg_reel_of', entete: 'dont OF (kg)', secondaire: true, rendu: (l) => kg(l.kg_reel_of ?? 0) },
    { champ: 'kg_reel_sans_of', entete: 'dont sans OF (kg)', secondaire: true, rendu: (l) => kg(l.kg_reel_sans_of ?? 0) },
    { champ: 'kg_conso_fil', entete: 'dont fil (kg)', secondaire: true, rendu: (l) => kg(l.kg_conso_fil) },
    { champ: 'kg_hors_machine', entete: 'dont hors machine (kg)', secondaire: true, rendu: (l) => kg(l.kg_hors_machine) },
    {
      champ: 'kg_dechet',
      entete: 'Déchets · pertes · casses (kg)',
      secondaire: true,
      rendu: (l) => `${kg(l.kg_dechet)} · ${kg(l.kg_perte)} · ${kg(l.kg_casse)}`,
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-56">
          <Etiq htmlFor="cq-qualite">Qualité</Etiq>
          {/* La qualite se cherche (24/10/2026) : sa liste grandit. */}
          <ChoixRecherche
            type="qualite"
            id="cq-qualite"
            ariaLabel="Qualité"
            valeur={qualite}
            onChange={(v) => setQualite(v)}
            vide="Toutes"
          />
        </div>
        <div className="w-[calc(50%-0.375rem)] sm:w-40">
          <Etiq htmlFor="cq-du">Du mois</Etiq>
          <Champ id="cq-du" type="month" value={du} onChange={(e) => setDu(e.target.value)} />
        </div>
        <div className="w-[calc(50%-0.375rem)] sm:w-40">
          <Etiq htmlFor="cq-au">Au mois</Etiq>
          <Champ id="cq-au" type="month" value={au} onChange={(e) => setAu(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-attenue-texte">
        Réel = écarts à effet consommation des machines, attribués à l’OF qui occupait la portion (corrections exclues),
        plus les consommations directes portant l’OF, retours déduits — au mois de l’OF. S’y ajoute ce qui a été
        consommé SANS OF sous sa qualité (écarts machine sous la qualité de la période, consommations directes sans OF),
        au mois du constat ou du mouvement ; sans qualité, l’historique est « Non attribué ». Prévu = métrage × recette,
        perte comprise : un étalon, jamais la consommation, comparé aux seuls OF. OF annulés exclus.
      </p>
      <PanneRequetes requetes={[['La consommation par qualité', q]]} />
      {q.isLoading ? (
        <Chargement />
      ) : (
        <DataTable<QualiteConso>
          exportable="consommation-qualites"
          imprimable="Consommation par qualité"
          module={MODULE_OF}
          colonnes={colonnes}
          lignes={q.data ?? []}
          cle={(l) => `${l.code_qualite ?? '—'}|${l.mois}`}
          titreCarte={(l) => `${l.code_qualite ?? 'Non attribué'} — ${l.mois}`}
          placeholderRecherche="Filtrer..."
          tailleParDefaut={25}
          videTitre="Aucune consommation"
          videDescription="Les OF de la période n’ont encore ni prévu ni consommation attribuée."
        />
      )}
    </div>
  )
}
