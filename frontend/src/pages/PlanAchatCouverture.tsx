/**
 * L'ONGLET « À COMMANDER » DU PLAN D'ACHAT (étape 2 du plan du 26/10/2026).
 *
 * Il LIT le moteur de couverture (`GET /api/couverture`, `GET /api/couverture/{ref}`) :
 * la proposition est calculée par le moteur, la décision reste au directeur.
 * « Commander » (27/10/2026) régénère la proposition d'achat de la référence
 * depuis ce même moteur, puis l'ouvre dans les lignes à commander du plan
 * d'achat, où l'acheteur choisit kg ou palettes — jamais de palette pleine par
 * défaut.
 *
 * L'ordre (27/10/2026) : la première rupture la plus proche d'abord (une rupture
 * aujourd'hui en tête, sans rupture en dernier), puis la date limite de commande.
 * Une référence sans plan ni stock mais avec un arrivage, même hors couverture,
 * est listée, ses kilos hors couverture sur la ligne ↳.
 *
 * Vocabulaire tenu : un déficit est un « plan non couvert à partir du … », jamais
 * une dette ; il n'est ni reporté ni rattrapé — le solde projeté ne descend pas
 * sous zéro.
 *
 * La liste : une rangée par référence, et une ligne ↳ d'information seulement
 * quand quelque chose est compté à part (fil sur métiers, restes) ou laissé hors
 * couverture (quarantaine, bloqué, en retard, sans date, en route). Le détail se
 * déplie sous la ligne, au clic : la courbe du solde, le calcul de la première
 * proposition, les ressources et arrivages, la chronologie, le plan par mois.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, CornerDownRight, ShoppingCart } from 'lucide-react'
import { api } from '../api/client'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import { BarreFiltres, useFiltres, type ChampFiltre } from '../composants/PanneauFiltres'
import { Alerte, Badge, Bouton, Chargement } from '../composants/ui/base'
import { cn, fmt } from '../lib/utils'

const MODULE = 'PLAN_ACHAT'

// ============================================================================
// Ce que rend le serveur (backend/src/routes/couverture.rs). Tout champ peut
// manquer : un champ masqué par la grille de droits n'est pas envoyé.
// ============================================================================

interface LigneCouverture extends Record<string, unknown> {
  code_reference: string
  designation?: string | null
  classe_abc?: string | null
  code_fournisseur?: string | null
  fournisseur_nom?: string | null
  disponible_kg?: number
  magasin_kg?: number
  machine_kg?: number
  plan_horizon_kg?: number
  couvert_jusqu_au?: string | null
  couvert_tout_horizon?: boolean
  premiere_rupture?: string | null
  plan_non_couvert_kg?: number
  premier_passage_securite?: string | null
  prochain_arrivage_date?: string | null
  prochain_arrivage_kg?: number | null
  delai_j?: number
  source_delai?: string
  couverture_commande_j?: number
  source_couverture?: string
  jours_securite?: number
  qte_a_commander_kg?: number | null
  /** Inactive : lisible, jamais commandée (la génération l’écarte). */
  actif?: boolean
  palettes_equivalentes?: number | null
  date_disponibilite?: string | null
  date_limite_commande?: string | null
  nb_propositions?: number
  propositions_plafonnees?: boolean
  motif_sans_proposition?: string | null
  restes_kg?: number
  quarantaine_kg?: number
  bloque_kg?: number
  hors_plan_kg?: number
  en_retard_kg?: number
  sans_date_kg?: number
  transit_kg?: number
  /** Bons non validés et bons livrés après l'horizon : non comptés, montrés (27/10/2026). */
  non_valide_kg?: number
  apres_horizon_kg?: number
}

interface EnteteCouverture {
  aujourdhui: string
  plan: {
    id_plan: string
    libelle: string | null
    date_debut: string | null
    date_fin: string | null
    date_photo_mrp: string | null
  } | null
  fin_horizon: string | null
  max_propositions: number
  parametres?: {
    securite_j: { A: number; B: number; C: number }
    delai_defaut_j: number
    marge_jours: number
  }
  regles_provisoires?: string[]
}

interface ListeCouverture extends EnteteCouverture {
  lignes: LigneCouverture[]
}

interface Jour {
  date: string
  conso_prevue_kg: number
  arrivee_kg: number
  solde_kg: number
  securite_kg: number
  plan_non_couvert_kg: number
}

interface Evenement {
  date: string
  natures: string[]
  conso_prevue_kg: number
  arrivee_kg: number
  solde_apres_kg: number
  securite_kg: number
  plan_non_couvert_kg: number
}

interface Proposition {
  rang: number
  date_sous_securite: string
  date_au_plus_tot?: string
  date_disponibilite: string
  motif_date: string
  date_fin_fenetre: string
  dernier_jour_couvert: string
  fenetre_bornee_horizon?: boolean
  jours_fenetre: number
  plan_fenetre_kg: number
  conso_moyenne_kg_j: number
  jours_securite?: number
  securite_kg: number
  solde_debut_d_kg: number
  arrivages_fenetre_kg: number
  besoin_theorique_kg: number
  jour_determinant: string
  moq_kg: number | null
  apres_minimum_kg: number
  multiple_kg: number | null
  quantite_proposee_kg: number
  palettes_equivalentes: number | null
  date_limite_commande: string
}

interface Arrivage {
  origine: 'BON' | 'IMPORT_SANS_BON' | 'TRANSFERT'
  numero_bc?: string | null
  ligne_numero?: number | null
  statut_bc?: string | null
  numero_dossier?: string | null
  numero_facture?: string | null
  numero_transfert?: string | null
  code_magasin_source?: string | null
  code_magasin_dest?: string | null
  lot_fournisseur?: string | null
  date_ligne?: string | null
  date_entete?: string | null
  date: string | null
  source_date: string | null
  kg: number
  compte: boolean
  categorie: string
  raison: string
}

interface DetailCouverture extends EnteteCouverture {
  reference: {
    code_reference: string
    designation: string | null
    classe_abc: string | null
    fournisseur_nom: string | null
    moq_kg: number | null
    multiple_achat_kg: number | null
    poids_bobine_kg: number | null
    bobines_par_palette: number | null
  }
  reglages: {
    delai_j: number
    source_delai: string
    couverture_commande_j: number
    source_couverture: string
    jours_securite: number
    source_securite: string
    moq_kg: number | null
    multiple_kg: number | null
    source_multiple: string
    kg_palette: number | null
  }
  synthese: LigneCouverture
  ressources: {
    compte_kg: number
    magasin_kg: number
    machine_kg: number
    magasins: {
      code_magasin: string
      nom: string | null
      quantite_kg: number
      bloque_kg: number
      restes_kg: number
      compte_kg: number
      etat: string
      raison: string
    }[]
    machine: {
      code_emplacement: string
      lot_fournisseur: string | null
      kg: number
      date_constat: string | null
      age_constat_j: number | null
      reste: boolean
      bloque: boolean
      compte: boolean
      raison: string
    }[]
    lots: {
      code_magasin: string
      lot_fournisseur: string
      kg: number
      statut_lot: string
      categorie: string | null
      compte: boolean
      raison: string
    }[]
    information: { restes_kg: number; quarantaine_kg: number; bloque_kg: number; hors_plan_kg: number }
  }
  arrivages: Arrivage[]
  evenements: Evenement[]
  propositions: Proposition[]
  propositions_plafonnees: boolean
  motif_sans_proposition: string | null
  plan_mois: {
    annee_mois: string
    kg_mois: number
    jours_mois: number
    kg_jour: number
    jours_dans_horizon: number
    kg_dans_horizon: number
    qualites: { code_qualite: string; kg: number }[]
    kg_qualites: number
  }[]
  jours: Jour[]
}

// ============================================================================
// Outils
// ============================================================================

/** Des kilos lisibles : entiers au-delà de 10 kg, une décimale en dessous. */
const kg = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? fmt.nombre(v, Math.abs(v) < 10 && v !== 0 ? 1 : 0) : '—'

const positif = (v: unknown): v is number => typeof v === 'number' && v > 0.0001

/** « 2026-10-26 » + n jours, en restant en dates civiles (pas d'heure). */
function plusJours(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function joursEntre(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** Une date courte, sans dépendre du fuseau du poste. */
function dateCourte(iso: string | null | undefined) {
  if (!iso) return '—'
  const [a, m, j] = iso.slice(0, 10).split('-')
  return `${j}/${m}/${a}`
}

/** La même, année sur deux chiffres : pour la liste, où chaque colonne compte. */
function dateListe(iso: string | null | undefined) {
  if (!iso) return '—'
  const [a, m, j] = iso.slice(0, 10).split('-')
  return `${j}/${m}/${a.slice(2)}`
}

const NATURES: Record<string, string> = {
  AUJOURDHUI: 'Aujourd’hui',
  ARRIVAGE: 'Arrivage',
  RUPTURE: 'Plan non couvert à partir de ce jour',
  REPRISE: 'Couverture reprise',
  SOUS_SECURITE: 'Passage sous la sécurité',
  FIN_DE_MOIS: 'Fin de mois',
  AUJOURDHUI_PLUS_DELAI: 'Aujourd’hui + délai : première arrivée possible',
  FIN_HORIZON: 'Fin de l’horizon du plan',
}

const CATEGORIES: Record<string, { libelle: string; ton: 'succes' | 'alerte' | 'neutre' | 'info' }> = {
  DATE: { libelle: 'compté à sa date', ton: 'succes' },
  EN_RETARD: { libelle: 'en retard', ton: 'alerte' },
  SANS_DATE: { libelle: 'sans date', ton: 'neutre' },
  NON_VALIDE: { libelle: 'non validé', ton: 'neutre' },
  APRES_HORIZON: { libelle: 'après l’horizon', ton: 'neutre' },
  TRANSIT: { libelle: 'en route', ton: 'info' },
}

/** La source d'un réglage, toujours dite (fournisseur, paramètre global, classe ABC). */
const source = (s: string | null | undefined) => (s ? ` (${s})` : '')

function Titre({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">{children}</p>
  )
}

// ============================================================================
// La liste
// ============================================================================

/** La désignation, sauf quand elle ne fait que répéter le code (« PES Nylon — PES Nylon »). */
function designationUtile(l: { code_reference: string; designation?: string | null }) {
  const d = l.designation?.trim()
  return d && d.toLowerCase() !== l.code_reference.trim().toLowerCase() ? d : null
}

/** Ce que la ligne ↳ dit : compté à part, non compté, hors couverture. */
function partsInformation(l: LigneCouverture) {
  const dont = [
    positif(l.machine_kg) && `sur métiers ${kg(l.machine_kg)} kg`,
    positif(l.restes_kg) && `restes ${kg(l.restes_kg)} kg`,
  ].filter(Boolean) as string[]
  const nonComptes = [
    positif(l.quarantaine_kg) && `quarantaine ${kg(l.quarantaine_kg)} kg`,
    positif(l.bloque_kg) && `bloqué ${kg(l.bloque_kg)} kg`,
    positif(l.hors_plan_kg) && `magasins hors plan ${kg(l.hors_plan_kg)} kg`,
  ].filter(Boolean) as string[]
  const horsCouverture = [
    positif(l.en_retard_kg) && `en retard ${kg(l.en_retard_kg)} kg`,
    positif(l.sans_date_kg) && `sans date ${kg(l.sans_date_kg)} kg`,
    positif(l.transit_kg) && `en route ${kg(l.transit_kg)} kg`,
    positif(l.non_valide_kg) && `bons non validés ${kg(l.non_valide_kg)} kg`,
    positif(l.apres_horizon_kg) && `après l’horizon ${kg(l.apres_horizon_kg)} kg`,
  ].filter(Boolean) as string[]
  const vide = !dont.length && !nonComptes.length && !horsCouverture.length
  return { dont, nonComptes, horsCouverture, vide }
}

/** La ligne ↳ d'information : seulement quand quelque chose est compté à part ou laissé hors couverture. */
function LigneInformation({ l }: { l: LigneCouverture }) {
  const { dont, nonComptes, horsCouverture, vide } = partsInformation(l)
  if (vide) return null
  return (
    <div className="-my-1 flex items-baseline gap-2 text-[12px] text-attenue-texte">
      <CornerDownRight aria-label="information sur la ligne" className="size-3.5 shrink-0 translate-y-0.5" />
      <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-0.5">
        {dont.length > 0 && <span>dont {dont.join(', ')}</span>}
        {nonComptes.length > 0 && <span>non compté : {nonComptes.join(', ')}</span>}
        {horsCouverture.length > 0 && <span>hors couverture : {horsCouverture.join(', ')}</span>}
      </div>
    </div>
  )
}

export function ACommander({
  commander,
  enCommande,
}: {
  /** « Commander » : la proposition de la référence part dans les lignes à commander. Absent : lecture seule. */
  commander?: (l: LigneCouverture) => void
  /** La référence dont la commande se prépare (bouton en attente). */
  enCommande?: string | null
} = {}) {
  const q = useQuery({
    queryKey: ['couverture'],
    queryFn: ({ signal }) => api.get<ListeCouverture>('/api/couverture', { signal }),
    staleTime: 60_000,
  })
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({})
  const basculer = (code: string) => setOuverts((o) => ({ ...o, [code]: !o[code] }))

  const aujourdhui = q.data?.aujourdhui ?? new Date().toISOString().slice(0, 10)
  const lignes = useMemo(() => q.data?.lignes ?? [], [q.data])

  /* Les filtres de toujours (BarreFiltres) : valeurs déduites des lignes. */
  const champs = useMemo<ChampFiltre<LigneCouverture>[]>(
    () => [
      { cle: 'fournisseur', libelle: 'Fournisseur', type: 'liste', recherche: true, valeur: (l) => l.fournisseur_nom ?? null },
      {
        cle: 'proposition',
        libelle: 'Proposition',
        type: 'liste',
        valeur: (l) => (positif(l.qte_a_commander_kg) ? 'Avec proposition' : 'Sans proposition'),
      },
      {
        cle: 'couverture',
        libelle: 'Plan non couvert',
        type: 'liste',
        valeur: (l) =>
          !l.premiere_rupture
            ? 'Couvert sur l’horizon'
            : l.premiere_rupture < plusJours(aujourdhui, l.delai_j ?? 0)
              ? 'Avant aujourd’hui + délai'
              : 'Après aujourd’hui + délai',
      },
    ],
    [aujourdhui],
  )
  const filtres = useFiltres<LigneCouverture>(champs)
  const filtrees = useMemo(() => lignes.filter(filtres.retenir), [lignes, filtres.retenir])

  const colonnes: ColonneDT<LigneCouverture>[] = [
    {
      champ: 'code_reference',
      entete: 'Référence',
      // La recherche du tableau porte aussi sur la désignation et le fournisseur.
      valeurTri: (l) => [l.code_reference, l.designation, l.fournisseur_nom].filter(Boolean).join(' '),
      // Le chevron vit dans la cellule : une colonne de moins, la ligne tient à 1366 px.
      rendu: (l) => {
        const suite = [designationUtile(l), l.fournisseur_nom].filter(Boolean).join(' · ')
        const ouvert = !!ouverts[l.code_reference]
        return (
          <div className="flex max-w-[15rem] items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                basculer(l.code_reference)
              }}
              aria-label={`Détail de ${l.code_reference}`}
              aria-expanded={ouvert}
              className="-ml-1 shrink-0 rounded p-0.5 text-attenue-texte hover:bg-attenue"
            >
              {ouvert ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
            <div className="min-w-0 truncate" title={[l.code_reference, suite].filter(Boolean).join(' — ')}>
              <span className="font-medium">{l.code_reference}</span>
              {suite && <span className="text-[11.5px] text-attenue-texte"> — {suite}</span>}
            </div>
          </div>
        )
      },
    },
    {
      champ: 'disponible_kg',
      entete: 'Disponible',
      numerique: true,
      largeur: '84px',
      rendu: (l) => (
        <span title="Magasins comptés et fil sur métiers, aujourd’hui">{kg(l.disponible_kg)}</span>
      ),
    },
    {
      champ: 'couvert_jusqu_au',
      entete: 'Couvert jusqu’au',
      largeur: '96px',
      valeurTri: (l) => (l.couvert_tout_horizon ? '9999' : l.couvert_jusqu_au ?? '0000'),
      rendu: (l) =>
        l.couvert_tout_horizon ? (
          <span className="text-succes" title={`Jusqu’au ${dateCourte(l.couvert_jusqu_au)}, fin de l’horizon`}>
            tout l’horizon
          </span>
        ) : l.couvert_jusqu_au ? (
          <span className="tabular-nums">{dateListe(l.couvert_jusqu_au)}</span>
        ) : l.premiere_rupture ? (
          <span className="text-danger">non couvert</span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'prochain_arrivage_date',
      entete: 'Prochain arrivage',
      largeur: '130px',
      rendu: (l) =>
        l.prochain_arrivage_date ? (
          <span className="tabular-nums">
            {dateListe(l.prochain_arrivage_date)}
            {typeof l.prochain_arrivage_kg === 'number' && (
              <span className="text-attenue-texte"> · {kg(l.prochain_arrivage_kg)} kg</span>
            )}
          </span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'premiere_rupture',
      entete: '1re rupture',
      largeur: '90px',
      rendu: (l) =>
        l.premiere_rupture ? (
          <span
            className={cn(
              'tabular-nums',
              l.premiere_rupture < plusJours(aujourdhui, l.delai_j ?? 0) ? 'font-medium text-danger' : 'text-alerte',
            )}
            title={`Plan non couvert à partir du ${dateCourte(l.premiere_rupture)}`}
          >
            {dateListe(l.premiere_rupture)}
          </span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'plan_non_couvert_kg',
      entete: 'Plan non couvert',
      numerique: true,
      largeur: '96px',
      rendu: (l) =>
        positif(l.plan_non_couvert_kg) ? (
          <span className="text-danger">{kg(l.plan_non_couvert_kg)}</span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'delai_j',
      entete: 'Délai',
      numerique: true,
      largeur: '56px',
      rendu: (l) =>
        typeof l.delai_j === 'number' ? (
          <span className="text-attenue-texte" title={`Délai fournisseur, pour information${source(l.source_delai)}`}>
            {l.delai_j} j
          </span>
        ) : (
          '—'
        ),
    },
    {
      champ: 'qte_a_commander_kg',
      entete: 'Proposition',
      numerique: true,
      largeur: '140px',
      rendu: (l) =>
        positif(l.qte_a_commander_kg) ? (
          <span>
            <span className="font-semibold">{kg(l.qte_a_commander_kg)} kg</span>
            {typeof l.palettes_equivalentes === 'number' && (
              <span className="text-[11.5px] text-attenue-texte"> ≈ {fmt.nombre(l.palettes_equivalentes, 1)} pal.</span>
            )}
          </span>
        ) : (
          <span className="text-attenue-texte" title={l.motif_sans_proposition ?? undefined}>
            rien
          </span>
        ),
    },
    {
      champ: 'date_limite_commande',
      entete: 'Avant le',
      largeur: '84px',
      rendu: (l) => {
        if (!l.date_limite_commande) return <span className="text-attenue-texte">—</span>
        const reste = joursEntre(aujourdhui, l.date_limite_commande)
        return (
          <span
            className={cn('tabular-nums', reste < 0 ? 'font-medium text-danger' : reste <= 7 ? 'text-alerte' : '')}
            title={`À commander avant le ${dateCourte(l.date_limite_commande)} — ${reste < 0 ? `date dépassée de ${-reste} j` : reste === 0 ? 'aujourd’hui' : `dans ${reste} j`}`}
          >
            {dateListe(l.date_limite_commande)}
          </span>
        )
      },
    },
  ]

  if (q.isLoading) return <Chargement />

  const d = q.data
  return (
    <div>
      {d && !d.plan && (
        <div className="mb-3">
          <Alerte ton="alerte" titre="Aucun plan de production en service">
            Sans plan en service, il n’y a ni horizon ni consommation prévue : rien ne se projette.
          </Alerte>
        </div>
      )}
      {d?.plan && (
        <p className="mb-2 text-[12px] text-attenue-texte">
          {d.plan.libelle ?? 'Plan en service'} · horizon jusqu’au {dateCourte(d.fin_horizon)}
          {d.plan.date_photo_mrp && <> · photo du besoin du {dateCourte(d.plan.date_photo_mrp)}</>}
          {' '}· projection depuis le {dateCourte(d.aujourdhui)}
        </p>
      )}
      {(d?.regles_provisoires?.length ?? 0) > 0 && (
        <details className="mb-3 rounded-[var(--radius)] border border-bordure bg-surface px-3 py-1.5 text-[12px]">
          <summary className="cursor-pointer select-none text-attenue-texte hover:text-texte">
            Règles provisoires des dates d’arrivage — à confirmer
          </summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-attenue-texte">
            {d!.regles_provisoires!.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
      )}

      <BarreFiltres
        champs={champs}
        lignes={lignes}
        valeurs={filtres.valeurs}
        definir={filtres.definir}
        reinitialiser={filtres.reinitialiser}
        actifs={filtres.actifs}
      />

      <DataTable<LigneCouverture>
        module={MODULE}
        exportable="plan-achat-a-commander"
        colonnes={colonnes}
        lignes={filtrees}
        erreur={q.error}
        cle={(l) => l.code_reference}
        surClic={(l) => basculer(l.code_reference)}
        titreCarte={(l) => [l.code_reference, designationUtile(l), l.fournisseur_nom].filter(Boolean).join(' — ')}
        placeholderRecherche="Référence, désignation, fournisseur..."
        tailleParDefaut={50}
        videTitre="Aucune référence"
        videDescription="Aucune référence n’a de demande au plan en service, de stock ni d’arrivage."
        actions={
          commander
            ? (l) =>
                positif(l.qte_a_commander_kg) && l.actif !== false ? (
                  // Icône seule sous 1536 px : la ligne garde sa date limite à 1366 px.
                  <Bouton
                    taille="xs"
                    variante="contour"
                    className="px-1.5 2xl:px-2"
                    chargement={enCommande === l.code_reference}
                    disabled={!!enCommande && enCommande !== l.code_reference}
                    onClick={(e) => {
                      e.stopPropagation()
                      commander(l)
                    }}
                    aria-label={`Commander ${l.code_reference}`}
                    title="Préparer la commande : la proposition s’ouvre dans les lignes à commander, en kg ou en palettes"
                  >
                    <ShoppingCart />
                    <span className="hidden 2xl:inline">Commander</span>
                  </Bouton>
                ) : null
            : undefined
        }
        detail={(l) => {
          const ouvert = !!ouverts[l.code_reference]
          const aInfo = !partsInformation(l).vide
          if (!ouvert && !aInfo) return null
          return (
            <div className="space-y-3">
              {aInfo && <LigneInformation l={l} />}
              {ouvert && <DetailReference reference={l.code_reference} />}
            </div>
          )
        }}
      />
    </div>
  )
}

// ============================================================================
// Le détail d'une référence
// ============================================================================

/** Le détail d'une référence : aussi déplié sous une proposition de l'onglet Besoins. */
export function DetailReference({ reference }: { reference: string }) {
  const q = useQuery({
    queryKey: ['couverture', reference],
    queryFn: ({ signal }) =>
      api.get<DetailCouverture>(`/api/couverture/${encodeURIComponent(reference)}`, { signal }),
    staleTime: 60_000,
  })
  if (q.isLoading) return <Chargement />
  if (q.error || !q.data)
    return (
      <p className="text-[12.5px] text-attenue-texte">
        Le détail de {reference} n’a pas pu être lu
        {q.error instanceof Error && q.error.message ? ` : ${q.error.message}` : '.'}
      </p>
    )
  const d = q.data
  const r = d.reglages
  const premiere = d.propositions?.[0]
  return (
    <div className="min-w-0 space-y-4 text-[12.5px] whitespace-normal" onClick={(e) => e.stopPropagation()}>
      {r && (
        <p className="text-attenue-texte">
          Délai fournisseur <b className="text-texte">{r.delai_j} j</b>
          {source(r.source_delai)} · couverture d’une commande <b className="text-texte">{r.couverture_commande_j} j</b>
          {source(r.source_couverture)} · sécurité <b className="text-texte">{fmt.nombre(r.jours_securite, 0)} j</b>
          {source(r.source_securite)} · minimum de commande{' '}
          <b className="text-texte">{r.moq_kg ? `${kg(r.moq_kg)} kg` : 'aucun'}</b> (fiche) · arrondi :{' '}
          {r.multiple_kg ? `${kg(r.multiple_kg)} kg, ` : ''}
          {r.source_multiple}
          {r.kg_palette ? ` · palette ordinaire ${kg(r.kg_palette)} kg (fiche)` : ''}
        </p>
      )}

      {(d.jours?.length ?? 0) > 1 && (
        <section>
          <Titre>Solde projeté jour par jour</Titre>
          <CourbeSolde jours={d.jours} propositions={d.propositions ?? []} />
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="min-w-0">
          <Titre>À commander — le calcul</Titre>
          {premiere ? (
            <CalculProposition p={premiere} d={d} />
          ) : (
            <Alerte ton="info" taille="compacte">
              Rien à commander : {d.motif_sans_proposition ?? 'aucune proposition sur l’horizon du plan'}.
            </Alerte>
          )}
          {(d.propositions?.length ?? 0) > 1 && (
            <div className="mt-3">
              <p className="mb-1 text-attenue-texte">
                Propositions suivantes, indicatives (elles supposent les précédentes commandées) :
              </p>
              <ul className="space-y-0.5">
                {d.propositions.slice(1).map((p) => (
                  <li key={p.rang} className="tabular-nums">
                    n° {p.rang} — disponible le {dateCourte(p.date_disponibilite)} :{' '}
                    <b>{kg(p.quantite_proposee_kg)} kg</b>
                    {p.palettes_equivalentes != null && (
                      <span className="text-attenue-texte"> ≈ {fmt.nombre(p.palettes_equivalentes, 1)} pal.</span>
                    )}
                    , à commander avant le {dateCourte(p.date_limite_commande)}
                  </li>
                ))}
              </ul>
              {d.propositions_plafonnees && (
                <p className="mt-1 text-attenue-texte">
                  Le calcul s’arrête à {d.max_propositions} propositions ; l’horizon va plus loin.
                </p>
              )}
            </div>
          )}
        </section>
        <section className="min-w-0">
          <Ressources d={d} />
        </section>
      </div>

      <section>
        <Titre>Chronologie</Titre>
        <Chronologie evenements={d.evenements ?? []} />
      </section>

      {(d.plan_mois?.length ?? 0) > 0 && <PlanParMois d={d} />}
    </div>
  )
}

/** Une étape du calcul : signe, libellé, valeur, explication. */
function Etape({
  signe,
  libelle,
  valeur,
  note,
  fort,
}: {
  signe?: string
  libelle: ReactNode
  valeur: ReactNode
  note?: ReactNode
  fort?: boolean
}) {
  return (
    <tr className={cn('align-baseline', fort && 'border-t border-bordure font-semibold')}>
      <td className="w-5 py-0.5 pr-1 text-center text-attenue-texte">{signe}</td>
      <td className="min-w-[9.5rem] py-0.5 pr-3">{libelle}</td>
      <td className="whitespace-nowrap py-0.5 pr-3 text-right tabular-nums">{valeur}</td>
      <td className="py-0.5 text-[11.5px] font-normal text-attenue-texte">{note}</td>
    </tr>
  )
}

function CalculProposition({ p, d }: { p: Proposition; d: DetailCouverture }) {
  const r = d.reglages
  const pourquoiD =
    p.motif_date === 'délai'
      ? `aujourd’hui + délai de ${r?.delai_j ?? '?'} j${source(r?.source_delai)} : une commande ne peut pas arriver avant ; le solde passe sous la sécurité dès le ${dateCourte(p.date_sous_securite)}`
      : `premier jour où le solde projeté passe sous la sécurité${
          p.date_au_plus_tot ? ` (aujourd’hui + délai, le ${dateCourte(p.date_au_plus_tot)}, tombe avant)` : ''
        }`
  return (
    <table className="w-full">
      <tbody>
        <Etape libelle="D — disponibilité de la commande" valeur={dateCourte(p.date_disponibilite)} note={pourquoiD} />
        <Etape
          libelle="F — fin de la fenêtre (exclue)"
          valeur={dateCourte(p.date_fin_fenetre)}
          note={`D + couverture de ${r?.couverture_commande_j ?? p.jours_fenetre} j${source(r?.source_couverture)} : couvre jusqu’au ${dateCourte(p.dernier_jour_couvert)} inclus, ${p.jours_fenetre} j${p.fenetre_bornee_horizon ? ', bornée à la fin de l’horizon du plan' : ''}`}
        />
        <Etape
          libelle="Plan sur la fenêtre"
          valeur={`${kg(p.plan_fenetre_kg)} kg`}
          note={`soit ${fmt.nombre(p.conso_moyenne_kg_j, 1)} kg/j en moyenne`}
        />
        <Etape
          signe="+"
          libelle="Sécurité"
          valeur={`${kg(p.securite_kg)} kg`}
          note={`${fmt.nombre(p.jours_securite ?? r?.jours_securite ?? 0, 0)} j × ${fmt.nombre(p.conso_moyenne_kg_j, 1)} kg/j${source(r?.source_securite)}`}
        />
        <Etape
          signe="−"
          libelle="S(D) — solde au début de D"
          valeur={`${kg(p.solde_debut_d_kg)} kg`}
          note="arrivages du jour D compris, sans la commande ; jamais négatif : le plan non couvert avant D n’est pas reporté"
        />
        <Etape
          signe="−"
          libelle="Arrivages dans la fenêtre, après D"
          valeur={`${kg(p.arrivages_fenetre_kg)} kg`}
        />
        <Etape
          signe="="
          libelle="Besoin théorique"
          valeur={`${kg(p.besoin_theorique_kg)} kg`}
          note={`contrôlé chaque jour t de la fenêtre : sécurité + plan de D à t − arrivages après D jusqu’à t − S(D) ; le plus fort le ${dateCourte(p.jour_determinant)} (jour déterminant)`}
          fort
        />
        <Etape
          signe="+"
          libelle="Minimum de commande"
          valeur={`${kg(p.apres_minimum_kg)} kg`}
          note={p.moq_kg ? `minimum de la fiche : ${kg(p.moq_kg)} kg` : 'aucun minimum sur la fiche'}
        />
        <Etape
          signe="+"
          libelle="Arrondi vers le haut"
          valeur={`${kg(p.quantite_proposee_kg)} kg`}
          note={p.multiple_kg ? `au multiple de ${kg(p.multiple_kg)} kg — ${r?.source_multiple ?? ''}` : r?.source_multiple ?? 'aucun multiple : kg'}
        />
        <Etape
          signe="="
          libelle="Quantité proposée"
          valeur={`${kg(p.quantite_proposee_kg)} kg`}
          note={
            p.palettes_equivalentes != null
              ? `≈ ${fmt.nombre(p.palettes_equivalentes, 2)} palette(s) ordinaire(s)${r?.kg_palette ? ` de ${kg(r.kg_palette)} kg` : ''}, pour information`
              : 'palette inconnue de la fiche'
          }
          fort
        />
        <Etape
          libelle="À commander avant le"
          valeur={dateCourte(p.date_limite_commande)}
          note={`D − délai de ${r?.delai_j ?? '?'} j`}
          fort
        />
      </tbody>
    </table>
  )
}

function Ressources({ d }: { d: DetailCouverture }) {
  const res = d.ressources
  const info = res?.information
  const arrivages = d.arrivages ?? []
  const restes = (res?.lots ?? []).filter((l) => l.compte)
  return (
    <div className="space-y-3">
      {res && (
        <div>
          <Titre>Ressources d’aujourd’hui — comptées {kg(res.compte_kg)} kg</Titre>
          <ul className="space-y-0.5">
            {res.magasins.map((m) => (
              <li key={m.code_magasin} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{m.nom ?? m.code_magasin}</span>
                <span className="tabular-nums">{kg(m.quantite_kg)} kg</span>
                {m.etat === 'COMPTE' ? (
                  <Badge ton="succes">compté {kg(m.compte_kg)} kg</Badge>
                ) : (
                  <Badge ton="neutre">non compté</Badge>
                )}
                <span className="text-[11.5px] text-attenue-texte">{m.raison}</span>
              </li>
            ))}
            {res.machine.map((e) => (
              <li key={`${e.code_emplacement}-${e.lot_fournisseur ?? ''}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">Métier {e.code_emplacement}</span>
                {e.lot_fournisseur && <span className="text-attenue-texte">lot {e.lot_fournisseur}</span>}
                <span className="tabular-nums">{kg(e.kg)} kg</span>
                <Badge ton={e.compte ? 'succes' : 'neutre'}>{e.compte ? 'compté' : 'non compté'}</Badge>
                <span className="text-[11.5px] text-attenue-texte">
                  constat du {dateCourte(e.date_constat)}
                  {e.age_constat_j != null ? ` (${e.age_constat_j} j)` : ''} — {e.raison}
                </span>
              </li>
            ))}
            {res.lots.filter((l) => !l.compte).map((l) => (
              <li key={`${l.code_magasin}-${l.lot_fournisseur}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-attenue-texte">
                  {l.code_magasin} · lot {l.lot_fournisseur}
                </span>
                <span className="tabular-nums">{kg(l.kg)} kg</span>
                <Badge ton="neutre">non compté</Badge>
                <span className="text-[11.5px] text-attenue-texte">{l.raison}</span>
              </li>
            ))}
            {res.magasins.length + res.machine.length === 0 && (
              <li className="text-attenue-texte">Aucun stock, ni en magasin ni sur métier.</li>
            )}
          </ul>
          {restes.length > 0 && (
            <details className="mt-1 text-[11.5px] text-attenue-texte">
              <summary className="cursor-pointer select-none hover:text-texte">
                Restes : {restes.length} lot(s), {kg(restes.reduce((t, l) => t + l.kg, 0))} kg — comptés
              </summary>
              <ul className="mt-0.5 pl-4">
                {restes.map((l) => (
                  <li key={`${l.code_magasin}-${l.lot_fournisseur}`} className="tabular-nums">
                    {l.code_magasin} · lot {l.lot_fournisseur} · {kg(l.kg)} kg
                  </li>
                ))}
              </ul>
            </details>
          )}
          {info && (positif(info.restes_kg) || positif(info.quarantaine_kg) || positif(info.bloque_kg) || positif(info.hors_plan_kg)) && (
            <p className="mt-1 text-[11.5px] text-attenue-texte">
              {[
                positif(info.restes_kg) && `restes ${kg(info.restes_kg)} kg (compris)`,
                positif(info.quarantaine_kg) && `quarantaine ${kg(info.quarantaine_kg)} kg (non comptée)`,
                positif(info.bloque_kg) && `bloqué ${kg(info.bloque_kg)} kg (non compté)`,
                positif(info.hors_plan_kg) && `magasins hors plan ${kg(info.hors_plan_kg)} kg (non comptés)`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>
      )}
      <div>
        <Titre>Arrivages</Titre>
        {arrivages.length === 0 ? (
          <p className="text-attenue-texte">Aucun bon ouvert, aucun import ni transfert en route.</p>
        ) : (
          <ul className="space-y-0.5">
            {arrivages.map((a, i) => {
              const c = CATEGORIES[a.categorie] ?? { libelle: a.categorie, ton: 'neutre' as const }
              const quoi =
                a.origine === 'BON'
                  ? `Bon ${a.numero_bc ?? '?'}${a.ligne_numero != null ? `, ligne ${a.ligne_numero}` : ''}`
                  : a.origine === 'IMPORT_SANS_BON'
                    ? `Import ${a.numero_dossier ?? '?'}${a.numero_facture ? `, facture ${a.numero_facture}` : ''}`
                    : `Transfert ${a.numero_transfert ?? '?'}${a.code_magasin_source ? ` (${a.code_magasin_source} → ${a.code_magasin_dest ?? '?'})` : ''}`
              return (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{quoi}</span>
                  <span className="tabular-nums">{kg(a.kg)} kg</span>
                  {a.date && (
                    <span className="tabular-nums">
                      le {dateCourte(a.date)}
                      {a.source_date && <span className="text-attenue-texte"> (date de {a.source_date === 'ligne' ? 'la ligne' : 'l’en-tête'})</span>}
                    </span>
                  )}
                  <Badge ton={c.ton}>{a.compte ? 'compté' : `non compté · ${c.libelle}`}</Badge>
                  <span className="text-[11.5px] text-attenue-texte">{a.raison}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function Chronologie({ evenements }: { evenements: Evenement[] }) {
  if (!evenements.length) return <p className="text-attenue-texte">Aucun événement.</p>
  const libelles = (e: Evenement) => e.natures.map((n) => NATURES[n] ?? n).join(' · ')
  return (
    <>
      {/* Au bureau, un tableau ; au téléphone, une pile (pas de défilement horizontal). */}
      <table className="hidden w-full text-[12px] sm:table">
        <thead>
          <tr className="border-b border-bordure text-[10.5px] uppercase tracking-wider text-attenue-texte">
            <th className="py-1 pr-3 text-left font-semibold">Date</th>
            <th className="py-1 pr-3 text-left font-semibold">Événement</th>
            <th className="py-1 pr-3 text-right font-semibold" title="Depuis la ligne précédente">Conso prévue</th>
            <th className="py-1 pr-3 text-right font-semibold">Arrivée</th>
            <th className="py-1 pr-3 text-right font-semibold">Solde après</th>
            <th className="py-1 text-right font-semibold" title="Depuis la ligne précédente">Plan non couvert</th>
          </tr>
        </thead>
        <tbody>
          {evenements.map((e) => {
            const rupture = e.natures.includes('RUPTURE')
            return (
              <tr key={e.date} className={cn('border-b border-ligne', rupture && 'bg-danger/5')}>
                <td className="whitespace-nowrap py-0.5 pr-3 tabular-nums">{dateCourte(e.date)}</td>
                <td className={cn('py-0.5 pr-3', rupture && 'text-danger')}>{libelles(e)}</td>
                <td className="py-0.5 pr-3 text-right tabular-nums">{positif(e.conso_prevue_kg) ? `− ${kg(e.conso_prevue_kg)}` : '—'}</td>
                <td className="py-0.5 pr-3 text-right tabular-nums text-succes">{positif(e.arrivee_kg) ? `+ ${kg(e.arrivee_kg)}` : ''}</td>
                <td className="py-0.5 pr-3 text-right tabular-nums">{kg(e.solde_apres_kg)}</td>
                <td className="py-0.5 text-right tabular-nums text-danger">{positif(e.plan_non_couvert_kg) ? kg(e.plan_non_couvert_kg) : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <ul className="space-y-1.5 sm:hidden">
        {evenements.map((e) => (
          <li key={e.date} className="border-b border-ligne pb-1">
            <div className={cn(e.natures.includes('RUPTURE') && 'text-danger')}>
              <b className="tabular-nums">{dateCourte(e.date)}</b> — {libelles(e)}
            </div>
            <div className="text-[11.5px] tabular-nums text-attenue-texte">
              {positif(e.conso_prevue_kg) && <>conso − {kg(e.conso_prevue_kg)} · </>}
              {positif(e.arrivee_kg) && <>arrivée + {kg(e.arrivee_kg)} · </>}
              solde {kg(e.solde_apres_kg)} kg
              {positif(e.plan_non_couvert_kg) && <span className="text-danger"> · non couvert {kg(e.plan_non_couvert_kg)}</span>}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

function PlanParMois({ d }: { d: DetailCouverture }) {
  return (
    <details className="rounded-[var(--radius)] border border-bordure px-3 py-1.5">
      <summary className="cursor-pointer select-none font-medium">
        Plan mois par mois, par qualité
      </summary>
      <p className="mt-1 text-[11.5px] text-attenue-texte">
        Les kilos du mois viennent de la photo du besoin du plan ; la part par qualité, des recettes actuelles. Le plan
        des jours passés du mois en cours est perdu, jamais reporté.
      </p>
      <ul className="mt-2 space-y-2">
        {d.plan_mois.map((m) => (
          <li key={m.annee_mois} className="border-b border-ligne pb-1.5">
            <div className="flex flex-wrap items-baseline gap-x-3 tabular-nums">
              <b>{m.annee_mois}</b>
              <span>{kg(m.kg_mois)} kg sur {m.jours_mois} j</span>
              <span className="text-attenue-texte">{fmt.nombre(m.kg_jour, 1)} kg/j</span>
              <span className="text-attenue-texte">
                dans l’horizon : {m.jours_dans_horizon} j, {kg(m.kg_dans_horizon)} kg
              </span>
            </div>
            {m.qualites.length > 0 && (
              <div className="mt-0.5 text-[11.5px] text-attenue-texte">
                {m.qualites.map((q) => `${q.code_qualite} ${kg(q.kg)} kg`).join(' · ')}
                {Math.abs(m.kg_qualites - m.kg_mois) > 1 && (
                  <> — total des qualités {kg(m.kg_qualites)} kg (recettes actuelles)</>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

// ============================================================================
// La courbe du solde projeté (SVG fait main, jetons du thème)
// ============================================================================

function useLargeur() {
  const ref = useRef<HTMLDivElement>(null)
  const [l, setL] = useState(640)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const o = new ResizeObserver(([e]) => setL(Math.max(260, Math.floor(e.contentRect.width))))
    o.observe(el)
    return () => o.disconnect()
  }, [])
  return [ref, l] as const
}

/** Graduations rondes : 0, 2 000, 4 000… */
function graduations(max: number) {
  if (max <= 0) return [0]
  const brut = max / 3
  const p = 10 ** Math.floor(Math.log10(brut))
  const pas = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= brut) ?? brut
  const t: number[] = []
  for (let v = 0; v <= max + 1e-9; v += pas) t.push(v)
  return t
}

const compact = (v: number) =>
  Math.abs(v) >= 1000
    ? `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} t`
    : v.toLocaleString('fr-FR', { maximumFractionDigits: 0 })

const COULEUR = {
  solde: 'hsl(var(--primaire))',
  securite: 'hsl(var(--alerte))',
  danger: 'hsl(var(--danger))',
  arrivage: 'hsl(var(--succes))',
  repere: 'hsl(var(--info))',
  grille: 'hsl(var(--ligne))',
  axe: 'hsl(var(--bordure))',
  texte: 'hsl(var(--attenue-texte))',
}

function CourbeSolde({ jours, propositions }: { jours: Jour[]; propositions: Proposition[] }) {
  const [ref, largeur] = useLargeur()
  const [survol, setSurvol] = useState<number | null>(null)
  const n = jours.length
  const H = 210
  const M = { g: 44, d: 8, h: 10, b: 22 }
  const bande = 22 // la zone sous zéro : les jours où le plan n'est pas couvert
  const hUtile = H - M.h - M.b - bande
  const maxBrut = Math.max(1, ...jours.map((j) => Math.max(j.solde_kg, j.securite_kg)))
  const ticks = graduations(maxBrut * 1.05)
  const max = ticks[ticks.length - 1] || 1
  const x = (i: number) => M.g + ((largeur - M.g - M.d) * i) / Math.max(1, n - 1)
  const y = (v: number) => M.h + hUtile * (1 - v / max)
  const y0 = y(0)
  const pas = (largeur - M.g - M.d) / Math.max(1, n - 1)

  const chemin = (v: (j: Jour) => number) =>
    jours.map((j, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v(j)).toFixed(1)}`).join(' ')
  const aire = `${chemin((j) => j.solde_kg)} L${x(n - 1).toFixed(1)},${y0} L${x(0).toFixed(1)},${y0} Z`

  // Les séries de jours où le plan n'est pas couvert, et ce qu'elles perdent.
  const zones: { debut: number; fin: number; kg: number }[] = []
  jours.forEach((j, i) => {
    if (j.plan_non_couvert_kg <= 0.0001) return
    const z = zones[zones.length - 1]
    if (z && z.fin === i - 1) {
      z.fin = i
      z.kg += j.plan_non_couvert_kg
    } else zones.push({ debut: i, fin: i, kg: j.plan_non_couvert_kg })
  })
  const totalNonCouvert = zones.reduce((s, z) => s + z.kg, 0)

  // Les débuts de mois, en abscisse (un sur deux s'ils se serrent).
  const mois = jours
    .map((j, i) => ({ i, j }))
    .filter(({ j, i }) => i === 0 || j.date.endsWith('-01'))
  const ecartMois = mois.length > 1 ? x(mois[1].i) - x(mois[0].i) : largeur
  const sautMois = ecartMois < 34 ? 2 : 1
  const nomMois = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' })

  const indexDe = (date: string) => jours.findIndex((j) => j.date === date)
  const p1 = propositions[0]
  const iD = p1 ? indexDe(p1.date_disponibilite) : -1

  const j = survol != null ? jours[survol] : null
  const description =
    `Solde projeté de ${kg(jours[0].solde_kg)} kg aujourd’hui à ${kg(jours[n - 1].solde_kg)} kg en fin d’horizon` +
    (totalNonCouvert > 0 ? `, plan non couvert ${kg(totalNonCouvert)} kg` : '')

  return (
    <div ref={ref} className="relative w-full">
      <svg
        viewBox={`0 0 ${largeur} ${H}`}
        preserveAspectRatio="none"
        height={H}
        role="img"
        aria-label={description}
        className="block w-full touch-none select-none"
        onPointerLeave={() => setSurvol(null)}
        onPointerMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect()
          const i = Math.round((e.clientX - b.left - M.g) / pas)
          setSurvol(i >= 0 && i < n ? i : null)
        }}
      >
        {/* Grille et axe des kilos */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.g} x2={largeur - M.d} y1={y(t)} y2={y(t)} stroke={t === 0 ? COULEUR.axe : COULEUR.grille} strokeWidth={t === 0 ? 1.2 : 1} strokeDasharray={t === 0 ? undefined : '2 3'} />
            <text x={M.g - 5} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill={COULEUR.texte}>
              {compact(t)}
            </text>
          </g>
        ))}
        <text x={M.g - 5} y={y0 + bande / 2 + 3.5} textAnchor="end" fontSize="10" fill={COULEUR.danger}>
          &lt; 0
        </text>

        {/* La zone sous zéro : plan non couvert */}
        {zones.map((z) => (
          <rect
            key={z.debut}
            x={x(z.debut) - pas / 2}
            y={y0}
            width={Math.max(2, x(z.fin) - x(z.debut) + pas)}
            height={bande}
            fill={COULEUR.danger}
            fillOpacity={0.28}
          >
            <title>
              {`Plan non couvert du ${dateCourte(jours[z.debut].date)} au ${dateCourte(jours[z.fin].date)} : ${kg(z.kg)} kg`}
            </title>
          </rect>
        ))}

        {/* Solde et sécurité */}
        <path d={aire} fill={COULEUR.solde} fillOpacity={0.1} />
        <path d={chemin((j) => j.securite_kg)} fill="none" stroke={COULEUR.securite} strokeWidth={1.3} strokeDasharray="5 3" />
        <path d={chemin((j) => j.solde_kg)} fill="none" stroke={COULEUR.solde} strokeWidth={1.8} strokeLinejoin="round" />

        {/* Les arrivages qui remontent le solde */}
        {jours.map((jj, i) =>
          jj.arrivee_kg > 0.0001 ? (
            <path
              key={jj.date}
              d={`M${x(i)},${y(jj.solde_kg) - 9} l-4.5,7 h9 Z`}
              fill={COULEUR.arrivage}
            >
              <title>{`Arrivage le ${dateCourte(jj.date)} : ${kg(jj.arrivee_kg)} kg`}</title>
            </path>
          ) : null,
        )}

        {/* D de la première proposition */}
        {iD >= 0 && (
          <g>
            <line x1={x(iD)} x2={x(iD)} y1={M.h} y2={y0 + bande} stroke={COULEUR.repere} strokeWidth={1} strokeDasharray="3 3" />
            <text x={x(iD) + 3} y={M.h + 9} fontSize="10" fill={COULEUR.repere}>
              D
            </text>
          </g>
        )}

        {/* Les mois */}
        {mois.map(({ i, j: jj }, k) =>
          k % sautMois === 0 ? (
            <text key={jj.date} x={x(i)} y={H - 6} fontSize="10" textAnchor={i === 0 ? 'start' : 'middle'} fill={COULEUR.texte}>
              {nomMois(jj.date)}
            </text>
          ) : null,
        )}

        {/* Le jour survolé */}
        {j && survol != null && (
          <g pointerEvents="none">
            <line x1={x(survol)} x2={x(survol)} y1={M.h} y2={y0 + bande} stroke={COULEUR.texte} strokeWidth={0.8} />
            <circle cx={x(survol)} cy={y(j.solde_kg)} r={3} fill={COULEUR.solde} />
          </g>
        )}
      </svg>

      {j && survol != null && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-[var(--radius-sm)] border border-bordure bg-surface px-2 py-1 text-[11px] leading-snug shadow-[var(--ombre-pose)]"
          style={x(survol) > largeur / 2 ? { right: largeur - x(survol) + 8 } : { left: x(survol) + 8 }}
        >
          <div className="font-semibold tabular-nums">{dateCourte(j.date)}</div>
          <div className="tabular-nums">solde {kg(j.solde_kg)} kg</div>
          <div className="tabular-nums text-attenue-texte">sécurité {kg(j.securite_kg)} kg</div>
          {positif(j.conso_prevue_kg) && <div className="tabular-nums text-attenue-texte">conso prévue {kg(j.conso_prevue_kg)} kg</div>}
          {positif(j.arrivee_kg) && <div className="tabular-nums text-succes">arrivage + {kg(j.arrivee_kg)} kg</div>}
          {positif(j.plan_non_couvert_kg) && <div className="tabular-nums text-danger">plan non couvert {kg(j.plan_non_couvert_kg)} kg</div>}
        </div>
      )}

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-attenue-texte">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: COULEUR.solde }} /> solde projeté
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: COULEUR.securite }} /> sécurité
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5" style={{ background: COULEUR.arrivage, clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' }} /> arrivage compté
        </span>
        {iD >= 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 border-l border-dashed" style={{ borderColor: COULEUR.repere }} /> D, disponibilité de la 1re proposition
          </span>
        )}
        {totalNonCouvert > 0 && (
          <span className="inline-flex items-center gap-1.5 text-danger">
            <span className="inline-block h-2.5 w-4" style={{ background: COULEUR.danger, opacity: 0.35 }} /> plan non couvert à
            partir du {dateCourte(jours[zones[0].debut].date)} : {kg(totalNonCouvert)} kg sur l’horizon
          </span>
        )}
      </div>
    </div>
  )
}
