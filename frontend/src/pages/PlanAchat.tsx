/**
 * Plan d'achat : propositions issues du MRP, et leur conversion en commandes.
 *
 * Deux choses distinctes cohabitent ici, et il faut les garder separees.
 *
 *   Le CALCUL — `v_plan_achat` — se refait a chaque lecture et ne garde aucune
 *   trace. Il repond a « que faudrait-il commander aujourd'hui ? ».
 *
 *   Les PROPOSITIONS — la table — portent un cycle de vie : proposee, ecartee,
 *   convertie en commande. Elles repondent a « qu'a-t-on decide ? ».
 *
 * L'ecran travaille sur les propositions, parce que ce sont elles qu'on decide.
 * Regenerer efface celles qui n'engagent rien et refait la photo ; celles qui
 * ont produit un bon de commande, et celles qu'on a ecartees, survivent.
 *
 * La quantite proposee integre le stock minimum dynamique (formule F3), le MOQ,
 * le multiple d'achat et l'en-cours fournisseur — ce dernier terme evite de
 * recommander ce qui est deja en route.
 */
import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Ban, ChevronDown, ChevronRight, FileCheck2, Gauge, ListChecks, Lock, LockOpen, RefreshCw, Repeat, ShoppingCart, Truck, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { CelluleEditable } from '../composants/CelluleEditable'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import {
  Alerte,
  Badge,
  Bouton,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Champ,
  Chargement,
  Etiq,
  Selecteur,
} from '../composants/ui/base'
import { Dialogue, DialogueContenu, Onglet, OngletContenu, Onglets, OngletsListe, useConfirmation } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'
import { SaisonMinimums } from './SaisonMinimums'
import { DetailCalcul } from './PlanAchatDetail'
import { useParametreNombre } from '../lib/parametres'

const MODULE = 'PLAN_ACHAT'

/** Entetes de la repartition par fournisseur, dans l'ordre de la feuille. */
const ENTETES_FRS = [
  'Fournisseur', 'Pays', 'Devise', 'Delai', 'Refs',
  'Quantite', 'Montant MAD', '% budget', 'TIER 1', 'Contact',
]

interface Proposition extends Record<string, unknown> {
  id_proposition: string
  code_reference: string
  designation: string
  code_fournisseur: string
  fournisseur_nom: string
  fournisseur_pays: string | null
  quantite_suggeree_kg: number
  quantite_suggeree_unite: number | null
  unite_saisie: string | null
  unite_catalogue: string
  prix_estime_mad?: number
  source_prix?: string
  /** Estime au CMUP, que ce compte ne voit pas : le prix est a saisir (regle 8). */
  prix_a_saisir?: boolean
  montant_total_mad?: number
  /* CE QU'ON IRA NEGOCIER, dans la devise du fournisseur. Le montant en
     dirhams ne sert qu'au budget : le bon de commande, lui, se libelle en
     dollars ou en euros, et c'est ce chiffre-la que le fournisseur lira. */
  code_devise?: string | null
  prix_devise?: number | null
  montant_devise?: number | null
  taux_devise?: number | null
  palettes_a_commander?: number | null
  /** Ce que l'arrondi a la palette pleine ajoute au besoin (kg). */
  complement_palette_kg?: number | null
  date_besoin_prevue: string
  urgence: string
  risque_identifie: string | null
  classe_abc: string | null
  classe_xyz: string | null
  tier: string | null
  risque_source: string | null
  nb_sources: number | null
  action_recommandee: string | null
  statut: string
  numero_bc: string | null
  statut_bc: string | null
  /** Arbitrage : la reference que le MRP avait reellement calculee. */
  code_reference_origine: string | null
  designation_origine: string | null
  motif_substitution: string | null
  nb_equivalents: number
  equivalent_dispo_kg: number
  /** Figement : la ligne a ete retouchee, le recalcul ne l ecrase plus. */
  figee: number
  figee_par: string | null
  date_figement: string | null
  motif_figement: string | null
  quantite_mrp_kg: number | null
  /** Ce que le calcul dit AUJOURD HUI, compare a la lecture — jamais stocke. */
  quantite_calculee_kg: number | null
  ecart_calcul_kg: number | null
  etat_figement: string | null
}

interface Equivalent extends Record<string, unknown> {
  equivalent_reference: string
  equivalent_designation: string
  equivalent_fournisseur_nom: string | null
  equivalent_delai_jours: number | null
  equivalent_stock_kg: number
  equivalent_besoin_12m_kg: number
  equivalent_statut: string | null
  equivalent_prix_catalogue_kg?: number
  equivalent_devise?: string
  meme_fournisseur: number
  interchangeable: number
}

/** Le plan d'achat est une LECTURE DU STOCK : ces colonnes disent pourquoi. */
interface Kpi {
  globaux: {
    refs_en_alerte: number
    ruptures: number
    critiques: number
    attention: number
    ok: number
    classe_a_en_alerte: number
    budget_mad: number
    quantite_kg: number
    refs_a_commander: number
  } | null
  tiering: { tier: string; nb: number; montant_mad: number }[]
  risques: { risque: string; nb: number; montant_mad: number }[]
  fournisseurs: {
    code_fournisseur: string
    fournisseur_nom: string
    pays: string | null
    ville: string | null
    code_devise: string
    delai_livraison_jours: number | null
    contact_principal: string | null
    nb_references: number
    quantite_kg: number
    montant_mad: number
    nb_tier1: number
    nb_ruptures: number
  }[]
}

const TON_URGENCE: Record<string, 'danger' | 'alerte' | 'info' | 'neutre'> = {
  'TIER 1': 'danger',
  'TIER 2': 'alerte',
  'TIER 3': 'info',
  'TIER 4': 'neutre',
}

const TON_STATUT: Record<string, 'neutre' | 'info' | 'succes' | 'contour'> = {
  PROPOSE: 'info',
  EN_REVISION: 'info',
  VALIDE: 'info',
  COMMANDE: 'succes',
  IGNORE: 'contour',
}

const LIBELLE_STATUT: Record<string, string> = {
  PROPOSE: 'Proposee',
  EN_REVISION: 'En revision',
  VALIDE: 'Validee',
  COMMANDE: 'Commandee',
  IGNORE: 'Ecartee',
}

/**
 * Ce que le calcul pense d'une ligne protegee.
 *
 * Proteger n'est pas ignorer : le MRP continue de dire ce qu'il faudrait
 * acheter, et l'ecart se lit ici. Une ligne figee sans ce retour serait une
 * ligne aveugle — l'acheteur croirait tenir un arbitrage encore valable.
 */
const LIBELLE_FIGEMENT: Record<string, string> = {
  COHERENTE: 'conforme au calcul',
  SURDIMENSIONNEE: 'au-dessus du besoin',
  SOUS_DIMENSIONNEE: 'sous le besoin',
  BESOIN_DISPARU: 'besoin disparu',
  REFERENCE_INACTIVE: 'reference inactive',
}

const TON_FIGEMENT: Record<string, 'succes' | 'alerte' | 'danger' | 'info' | 'neutre'> = {
  COHERENTE: 'succes',
  SURDIMENSIONNEE: 'alerte',
  SOUS_DIMENSIONNEE: 'info',
  BESOIN_DISPARU: 'danger',
  REFERENCE_INACTIVE: 'danger',
}

const MOTIF_FIGEMENT: Record<string, string> = {
  PRIX_NEGOCIE: 'prix negocie',
  QUANTITE_AJUSTEE: 'quantite ajustee',
  LIVRAISON_GROUPEE: 'livraison groupee',
  DELAI_FOURNISSEUR: 'delai fournisseur',
  AUTRE: 'arbitrage',
}

/** Une proposition n'est convertible que tant qu'elle n'engage rien. */
const convertible = (p: Proposition) =>
  p.statut === 'PROPOSE' || p.statut === 'EN_REVISION' || p.statut === 'VALIDE'

export function PlanAchat() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const confirmation = useConfirmation()
  const [coches, setCoches] = useState<Record<string, boolean>>({})
  const [onglet, setOnglet] = useState('besoins')

  const q = useQuery({
    queryKey: ['plan-achat-propositions'],
    queryFn: ({ signal }) => api.get<Proposition[]>('/api/plan-achat/propositions', { signal }),
  })

  const qKpi = useQuery({
    queryKey: ['plan-achat-kpi'],
    queryFn: ({ signal }) => api.get<Kpi>('/api/plan-achat/kpi', { signal }),
  })

  const rafraichir = async () => {
    await qc.invalidateQueries({ queryKey: ['plan-achat-propositions'] })
    void qc.invalidateQueries({ queryKey: ['plan-achat-kpi'] })
    void qc.invalidateQueries({ queryKey: ['bons-commande'] })
    void qc.invalidateQueries({ queryKey: ['cockpit'] })
  }

  const generer = useMutation({
    mutationFn: () =>
      api.post<{
        propositions_generees: number
        budget_total_mad: number
        tier1: number
        propositions_figees: number
        propositions_arbitrees: number
      }>('/api/plan-achat/generer'),
    onSuccess: async (r) => {
      // Annoncer les lignes preservees evite de laisser croire que le calcul a
      // tout refait : il a deliberement laisse en place le travail de l'acheteur.
      const preservees =
        (r.propositions_figees ?? 0) + (r.propositions_arbitrees ?? 0) > 0
          ? [
              r.propositions_figees > 0 && `${r.propositions_figees} protegee(s)`,
              r.propositions_arbitrees > 0 && `${r.propositions_arbitrees} arbitree(s)`,
            ]
              .filter(Boolean)
              .join(' et ') + ' conservees telles quelles.'
          : undefined
      toast.success(
        `${r.propositions_generees} proposition(s) · ${fmt.mad(r.budget_total_mad)} · ${r.tier1} en TIER 1.`,
        { description: preservees, duration: preservees ? 9000 : 5000 },
      )
      setCoches({})
      await rafraichir()
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Generation impossible.'),
  })

  const commander = useMutation({
    mutationFn: (v: { propositions: string[]; cibles: Record<string, string> }) =>
      api.post<{
        propositions_converties: number
        bons: { numero_bc: string; code_fournisseur: string; lignes: number; montant_total_mad: number }[]
      }>('/api/plan-achat/commander', v),
    onSuccess: async (r) => {
      toast.success(`Lignes envoyées : ${r.bons.map((b) => b.numero_bc).join(', ')}`, {
        description: `${r.propositions_converties} proposition(s) converties · ${fmt.mad(
          r.bons.reduce((s, b) => s + b.montant_total_mad, 0),
        )}`,
      })
      setCoches({})
      await rafraichir()
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Conversion impossible.'),
  })

  const ajuster = useMutation({
    mutationFn: (v: { id: string; corps: Record<string, unknown> }) =>
      api.patch<{ figement_nouveau: boolean }>(
        `/api/plan-achat/propositions/${v.id}`,
        v.corps,
      ),
    onSuccess: async (r) => {
      toast.success('Proposition ajustee', {
        description: r.figement_nouveau
          ? 'Elle est desormais protegee : le prochain recalcul ne l ecrasera plus. ' +
            "L'ecart avec le calcul reste affiche sur la ligne."
          : 'Elle ne sort plus telle quelle du calcul.',
        duration: 8000,
      })
      await rafraichir()
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Ajustement impossible.'),
  })

  /**
   * Proteger une ligne du prochain recalcul, ou la lui rendre.
   *
   * Le MRP ne connait ni le camion a remplir, ni le lot minimum non declare, ni
   * la remise obtenue au telephone.
   */
  const figer = useMutation({
    mutationFn: (v: { id: string; motif: string }) =>
      api.post(`/api/plan-achat/propositions/${v.id}/figer`, { motif_figement: v.motif }),
    onSuccess: async () => {
      toast.success('Proposition protegee', {
        description: 'Le recalcul ne la remplacera plus. L ecart avec le calcul reste visible.',
        duration: 7000,
      })
      await rafraichir()
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Protection impossible.'),
  })

  const defiger = useMutation({
    mutationFn: (id: string) => api.delete(`/api/plan-achat/propositions/${id}/figer`),
    onSuccess: async () => {
      toast.success('Proposition rendue au calcul', {
        description: 'Le prochain recalcul la remplacera par ce que le MRP dit aujourd hui.',
        duration: 7000,
      })
      await rafraichir()
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.'),
  })

  const ignorer = useMutation({
    mutationFn: (id: string) => api.post(`/api/plan-achat/propositions/${id}/ignorer`),
    onSuccess: async () => {
      toast.success('Proposition ecartee')
      await rafraichir()
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Impossible d’ecarter.'),
  })

  const lignes = q.data ?? []
  const ouvertes = useMemo(() => lignes.filter(convertible), [lignes])

  // La selection ne retient que ce qui est encore convertible : une proposition
  // qui vient d'etre commandee ne doit pas rester cochee dans un etat fantome.
  const selection = useMemo(
    () => ouvertes.filter((p) => coches[p.id_proposition]).map((p) => p.id_proposition),
    [ouvertes, coches],
  )

  const budgetSelection = ouvertes
    .filter((p) => coches[p.id_proposition])
    .reduce((s, p) => s + (p.montant_total_mad ?? 0), 0)
  const fournisseursSelection = new Set(
    ouvertes.filter((p) => coches[p.id_proposition]).map((p) => p.code_fournisseur),
  ).size
  const surCatalogue = ouvertes.filter((p) => p.source_prix === 'CATALOGUE').length
  const kpi = qKpi.data?.globaux ?? null

  // La proposition dont on examine les equivalents. Null : aucun panneau.
  const [arbitrage, setArbitrage] = useState<Proposition | null>(null)
  // Les propositions dont le calcul est deplie sous la ligne.
  const [deplies, setDeplies] = useState<Record<string, boolean>>({})
  const dureeEcart = useParametreNombre('P_DureeEcartJours', 90)

  const substituer = useMutation({
    mutationFn: (v: { id: string; cible: string; motif: string }) =>
      api.post<{ fusionnee: boolean; message?: string }>(
        `/api/plan-achat/${v.id}/substituer`,
        { code_reference_cible: v.cible, motif: v.motif },
      ),
    onSuccess: (r) => {
      toast.success('Besoin reporte sur la reference equivalente', {
        description:
          r.message ??
          "La proposition passe en revision, et la reference d'origine reste tracee.",
        duration: 8000,
      })
      setArbitrage(null)
      void qc.invalidateQueries({ queryKey: ['propositions-achat'] })
      void qc.invalidateQueries({ queryKey: ['kpi-plan-achat'] })
    },
    onError: (e) =>
      toast.error(e instanceof ErreurApi ? e.message : 'Bascule impossible.'),
  })

  const colonnes: ColonneDT<Proposition>[] = [
    {
      champ: 'calcul',
      entete: '',
      largeur: '30px',
      triable: false,
      rendu: (p) => (
        <Bouton
          variante="discret"
          taille="icone-xs"
          className="text-attenue-texte hover:bg-attenue"
          onClick={(e) => {
            e.stopPropagation()
            setDeplies((d) => ({ ...d, [p.id_proposition]: !d[p.id_proposition] }))
          }}
          aria-label="Voir le calcul"
          title="D’où viennent ces kilos : stock, machine, en-cours, demande, sécurité"
        >
          {deplies[p.id_proposition] ? <ChevronDown /> : <ChevronRight />}
        </Bouton>
      ),
    },
    {
      champ: 'selection',
      entete: '',
      largeur: '38px',
      rendu: (p) =>
        convertible(p) ? (
          <input
            type="checkbox"
            checked={!!coches[p.id_proposition]}
            onChange={() =>
              setCoches((c) => ({ ...c, [p.id_proposition]: !c[p.id_proposition] }))
            }
            onClick={(e) => e.stopPropagation()}
            className="size-4"
            aria-label={`Selectionner ${p.code_reference}`}
          />
        ) : null,
    },
    {
      champ: 'classe_abc',
      entete: 'ABC',
      largeur: '54px',
      secondaire: true,
      // La classe est un rang, pas une note : A ne veut pas dire « bon » mais
      // « porte l'essentiel du budget ». On la teinte donc par le poids, pas
      // par une echelle de gravite.
      rendu: (p) =>
        !p.classe_abc ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <span
            className={cn(
              'inline-block rounded-[3px] px-1.5 py-px text-[11px] font-medium',
              p.classe_abc === 'A'
                ? 'bg-primaire/15 text-primaire'
                : p.classe_abc === 'B'
                  ? 'bg-attenue text-texte'
                  : 'text-attenue-texte',
            )}
          >
            {p.classe_abc}
            {p.classe_xyz && <span className="opacity-60">{p.classe_xyz}</span>}
          </span>
        ),
    },
    {
      champ: 'risque_source',
      entete: 'Source',
      largeur: '128px',
      // C'est la colonne qui manquait : elle dit si un ennui chez ce
      // fournisseur arrete la ligne, ou si une alternative existe.
      rendu: (p) =>
        !p.risque_source ? (
          <span className="text-attenue-texte">—</span>
        ) : p.risque_source === 'MONO_SOURCE' ? (
          <span className="inline-flex items-center gap-1 rounded-[3px] bg-danger/12 px-1.5 py-px text-[11px] font-medium text-danger">
            <AlertTriangle className="size-3" />
            mono-source
          </span>
        ) : (
          <span className="text-[11px] text-succes">
            {p.nb_sources} sources
          </span>
        ),
    },
    {
      champ: 'action_recommandee',
      entete: 'Action',
      secondaire: true,
      rendu: (p) => (
        <span className="text-[11px] text-attenue-texte">{p.action_recommandee ?? '—'}</span>
      ),
    },
    {
      champ: 'urgence',
      entete: 'Urgence',
      largeur: '90px',
      filtre: 'liste',
      rendu: (p) => <Badge ton={TON_URGENCE[p.urgence] ?? 'neutre'}>{p.urgence}</Badge>,
    },
    {
      champ: 'code_reference',
      entete: 'Référence',
      filtre: 'texte',
      rendu: (p) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{p.code_reference}</div>
          {p.designation && (
            <div className="truncate text-[11px] text-attenue-texte">{p.designation}</div>
          )}
        </div>
      ),
    },
    {
      /* LE FOURNISSEUR EST UNE COLONNE, PAS UNE SOUS-LIGNE.
         Il figurait en petit sous la reference : visible, mais impossible a
         trier et surtout a FILTRER. Or c'est la premiere question qu'on se
         pose devant un plan d'achat de cent six lignes — « que dois-je
         commander chez Sujata ? » — parce qu'on ne passe pas une commande par
         reference, on la passe par fournisseur. Sans ce filtre, il fallait
         lire les cent six lignes pour en retenir douze. */
      champ: 'fournisseur_nom',
      entete: 'Fournisseur',
      largeur: '150px',
      filtre: 'liste',
      rendu: (p) => (
        <div className="min-w-0">
          <div className="truncate">{p.fournisseur_nom || '—'}</div>
          {p.fournisseur_pays && (
            <div className="truncate text-[11px] text-attenue-texte">{p.fournisseur_pays}</div>
          )}
        </div>
      ),
    },
    {
      champ: 'statut',
      entete: 'Statut',
      largeur: '150px',
      filtre: 'liste',
      rendu: (p) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge ton={TON_STATUT[p.statut] ?? 'neutre'}>
            {LIBELLE_STATUT[p.statut] ?? p.statut}
          </Badge>
          {p.numero_bc && (
            <span className="text-[11px] text-attenue-texte">{p.numero_bc}</span>
          )}
        </div>
      ),
    },
    {
      champ: 'quantite_suggeree_kg',
      entete: 'A commander',
      numerique: true,
      largeur: '140px',
      rendu: (p) => (
        <CelluleEditable
          valeur={p.quantite_suggeree_kg}
          affichage={
            <span>
              <span className="font-medium tabular-nums">
                {fmt.nombre(p.quantite_suggeree_kg, 0)} kg
              </span>
              {p.quantite_suggeree_unite != null && p.unite_catalogue !== 'kg' && (
                <span className="block text-[11px] text-attenue-texte tabular-nums">
                  {fmt.nombre(p.quantite_suggeree_unite, 1)} {p.unite_catalogue}
                </span>
              )}
            </span>
          }
          type="nombre"
          min={0}
          aligneDroite
          modifiable={droits.peutEcrire && convertible(p)}
          surValider={(v) =>
            v != null &&
            Number(v) !== p.quantite_suggeree_kg &&
            ajuster.mutate({ id: p.id_proposition, corps: { quantite_suggeree_kg: Number(v) } })
          }
        />
      ),
    },
    {
      champ: 'prix_estime_mad',
      entete: 'Prix MAD/kg',
      numerique: true,
      largeur: '120px',
      // LE PRIX SE NEGOCIE, DONC IL SE SAISIT. Il etait seul en lecture au
      // milieu de colonnes modifiables : l'acheteur qui obtenait un rabais
      // devait commander au tarif, puis corriger le bon apres coup. Le prix en
      // devise et le montant suivent, cote serveur.
      rendu: (p) =>
        p.prix_estime_mad == null ? (
          '—'
        ) : (
          <CelluleEditable
            valeur={p.prix_estime_mad}
            type="nombre"
            min={0}
            aligneDroite
            modifiable={droits.peutEcrire && convertible(p)}
            surValider={(v) =>
              v != null &&
              Number(v) !== p.prix_estime_mad &&
              ajuster.mutate({ id: p.id_proposition, corps: { prix_estime_mad: Number(v) } })
            }
            affichage={
          <div>
            <div className="tabular-nums">{p.prix_a_saisir ? '—' : fmt.nombre(p.prix_estime_mad, 3)}</div>
            {/* Le meme prix dans l'unite d'achat : au metre, un prix au kg ne
                se reconnait pas sur la facture. */}
            {p.unite_catalogue !== 'kg' && p.quantite_suggeree_unite ? (
              <div className="text-[11px] text-attenue-texte tabular-nums">
                {fmt.nombre((p.prix_estime_mad * p.quantite_suggeree_kg) / p.quantite_suggeree_unite, 4)} MAD/
                {p.unite_catalogue}
              </div>
            ) : null}
            {/* LA SOURCE DU PRIX (regle 8, 09/10/2026) : le dernier prix d'achat
                chez ce fournisseur, a defaut le catalogue, en dernier recours le
                CMUP — que l'on ne voit pas toujours : « prix a saisir ». */}
            {p.prix_a_saisir ? (
              <div className="text-[11px] text-alerte">prix à saisir</div>
            ) : p.source_prix === 'DERNIER_ACHAT' ? (
              <div className="text-[11px] text-attenue-texte">dernier achat</div>
            ) : p.source_prix === 'CATALOGUE' ? (
              <div className="text-[11px] text-alerte">catalogue</div>
            ) : p.source_prix === 'CMUP' ? (
              <div className="text-[11px] text-alerte">coût moyen</div>
            ) : null}
          </div>
            }
          />
        ),
    },
    // LES TROIS COLONNES DU CLASSEUR. Le fournisseur est turc ou indien : le
    // bon se libelle dans SA devise, et le dirham ne sert qu'au budget. Les
    // afficher cote a cote evite la conversion de tete au moment de negocier.
    {
      champ: 'prix_devise',
      entete: 'Prix devise',
      numerique: true,
      largeur: '110px',
      rendu: (p) =>
        p.prix_devise == null ? (
          '—'
        ) : (
          <span className="tabular-nums">
            {fmt.nombre(p.prix_devise, 3)}
            <span className="ml-1 text-[11px] text-attenue-texte">{p.code_devise}</span>
          </span>
        ),
    },
    {
      champ: 'montant_devise',
      entete: 'Montant devise',
      numerique: true,
      largeur: '140px',
      rendu: (p) =>
        p.montant_devise == null ? (
          '—'
        ) : (
          <span className="font-medium tabular-nums">
            {fmt.nombre(p.montant_devise, 2)}
            <span className="ml-1 text-[11px] text-attenue-texte">{p.code_devise}</span>
          </span>
        ),
    },
    {
      champ: 'montant_total_mad',
      entete: 'Montant MAD',
      numerique: true,
      largeur: '130px',
      rendu: (p) => (p.montant_total_mad == null ? '—' : fmt.mad(p.montant_total_mad)),
    },
    {
      champ: 'palettes_a_commander',
      entete: 'Palettes',
      numerique: true,
      largeur: '90px',
      rendu: (p) =>
        p.palettes_a_commander == null ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <span className="tabular-nums">{fmt.entier(p.palettes_a_commander)}</span>
        ),
    },
    {
      // LE COMPLEMENT DE PALETTE : ce qui est commande pour fermer la palette,
      // pas pour produire. Vide quand l'article n'est pas arrondi a la palette.
      champ: 'complement_palette_kg',
      entete: 'Complément palette',
      numerique: true,
      largeur: '120px',
      rendu: (p) =>
        !p.complement_palette_kg || p.complement_palette_kg <= 0 ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <span className="tabular-nums" title="Ajouté pour fermer la palette, pas pour produire">
            + {fmt.nombre(p.complement_palette_kg, 0)} kg
          </span>
        ),
    },
    {
      champ: 'date_besoin_prevue',
      entete: 'Besoin le',
      largeur: '110px',
      secondaire: true,
      rendu: (p) => fmt.date(p.date_besoin_prevue),
    },
    {
      // Une ligne protegee sans son ecart serait une ligne aveugle : on saurait
      // que le calcul ne la touche plus, sans savoir ce qu'il en pense.
      champ: 'etat_figement',
      entete: 'Protection',
      largeur: '190px',
      filtre: 'liste',
      rendu: (p) =>
        !p.figee ? (
          <span className="text-[11px] text-attenue-texte">suit le calcul</span>
        ) : (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1">
              <Lock className="size-3 shrink-0 text-primaire" />
              <Badge ton={TON_FIGEMENT[p.etat_figement ?? ''] ?? 'neutre'}>
                {LIBELLE_FIGEMENT[p.etat_figement ?? ''] ?? 'protegee'}
              </Badge>
            </div>
            {p.etat_figement === 'BESOIN_DISPARU' ? (
              <div className="text-[11px] text-danger">
                le calcul ne demande plus rien sur cette reference
              </div>
            ) : p.etat_figement === 'REFERENCE_INACTIVE' ? (
              <div className="text-[11px] text-danger">référence desactivee au catalogue</div>
            ) : (
              p.ecart_calcul_kg != null &&
              Math.abs(p.ecart_calcul_kg) > 0.001 && (
                <div className="text-[11px] tabular-nums text-attenue-texte">
                  calcul {fmt.nombre(p.quantite_calculee_kg ?? 0, 0)} kg ·{' '}
                  <span className={p.ecart_calcul_kg > 0 ? 'text-alerte' : 'text-info'}>
                    {p.ecart_calcul_kg > 0 ? '+' : ''}
                    {fmt.nombre(p.ecart_calcul_kg, 0)} kg
                  </span>
                </div>
              )
            )}
            {p.figee_par && (
              <div className="text-[11px] text-attenue-texte">
                {MOTIF_FIGEMENT[p.motif_figement ?? ''] ?? p.motif_figement} · {p.figee_par}
              </div>
            )}
          </div>
        ),
    },
  ]

  return (
    <div>
      <EnTetePage
        titre="Plan d'achat"
        description="Propositions issues du MRP. Convertir ouvre un bon de commande en brouillon : rien n'est engage avant sa validation."
      />

      {/* LES ONGLETS (demandes des 30/09 et 01/10/2026). Le travail se fait en
          deux temps, chacun dans son onglet : les BESOINS, qu'on regenere et
          qu'on coche ; les LIGNES A COMMANDER, ce qu'on a coche, qu'on envoie
          au bon de commande — neuf ou deja ouvert. Repartition et situation
          restent a cote, pour lire. */}
      <Onglets value={onglet} onValueChange={setOnglet}>
        <OngletsListe className="mb-3">
          <Onglet value="besoins">
            <ShoppingCart className="size-3.5" />
            Besoins
            <span className="text-[11px] tabular-nums text-attenue-texte">{ouvertes.length}</span>
          </Onglet>
          <Onglet value="lignes">
            <ListChecks className="size-3.5" />
            Lignes à commander
            <span className={cn('text-[11px] tabular-nums', selection.length ? 'font-semibold text-primaire' : 'text-attenue-texte')}>
              {selection.length}
            </span>
          </Onglet>
          <Onglet value="fournisseurs" disabled={(qKpi.data?.fournisseurs ?? []).length === 0}>
            <Truck className="size-3.5" />
            Par fournisseur
            <span className="text-[11px] tabular-nums text-attenue-texte">{(qKpi.data?.fournisseurs ?? []).length}</span>
          </Onglet>
          <Onglet value="situation" disabled={!kpi}>
            <Gauge className="size-3.5" />
            Situation
          </Onglet>
        </OngletsListe>
        <OngletContenu value="situation">
      {/* ---- KPI : les trois blocs de la feuille Plan_Achat -------------------
           Tout se lit dans le STOCK. Une reference apparait ici parce que son
           projete est passe sous son minimum, pas parce qu'on l'a saisie. ---- */}
      {kpi && (
        <div className="mb-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-[var(--radius)] border border-bordure bg-surface p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
              Situation du stock
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
              <span className="text-attenue-texte">Références en alerte</span>
              <span className="text-right font-semibold tabular-nums">{kpi.refs_en_alerte}</span>
              <span className="text-danger">Ruptures</span>
              <span className="text-right font-semibold tabular-nums text-danger">{kpi.ruptures}</span>
              <span className="text-danger">Critiques</span>
              <span className="text-right tabular-nums">{kpi.critiques}</span>
              <span className="text-alerte">Attention</span>
              <span className="text-right tabular-nums">{kpi.attention}</span>
              <span className="text-succes">OK</span>
              <span className="text-right tabular-nums">{kpi.ok}</span>
              <span className="text-attenue-texte">Classe A en alerte</span>
              <span className="text-right font-semibold tabular-nums">{kpi.classe_a_en_alerte}</span>
            </div>
          </div>

          <div className="rounded-[var(--radius)] border border-bordure bg-surface p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
              A commander
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
              <span className="text-attenue-texte">Budget total</span>
              <span className="text-right font-semibold tabular-nums">{fmt.mad(kpi.budget_mad)}</span>
              <span className="text-attenue-texte">Quantité totale</span>
              <span className="text-right tabular-nums">{fmt.nombre(kpi.quantite_kg, 0)} kg</span>
              <span className="text-attenue-texte">Références</span>
              <span className="text-right tabular-nums">{kpi.refs_a_commander}</span>
            </div>
            <div className="mt-2 border-t border-bordure pt-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                Urgence
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                {(qKpi.data?.tiering ?? []).map((t) => (
                  <Fragment key={t.tier}>
                    <span><Badge ton={TON_URGENCE[t.tier] ?? 'neutre'}>{t.tier}</Badge></span>
                    <span className="text-right tabular-nums">{t.nb} · {fmt.mad(t.montant_mad)}</span>
                  </Fragment>
                ))}
                {(qKpi.data?.tiering ?? []).length === 0 && (
                  <span className="col-span-2 text-attenue-texte">Aucune référence a commander.</span>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-[var(--radius)] border border-bordure bg-surface p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
              Risques identifies
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
              {(qKpi.data?.risques ?? []).map((r) => (
                <Fragment key={r.risque}>
                  <span className={r.risque === 'MONO-SOURCE' ? 'text-alerte' : 'text-attenue-texte'}>
                    {r.risque}
                  </span>
                  <span className="text-right tabular-nums">{r.nb} · {fmt.mad(r.montant_mad)}</span>
                </Fragment>
              ))}
              {(qKpi.data?.risques ?? []).length === 0 && (
                <span className="col-span-2 text-attenue-texte">Rien a signaler.</span>
              )}
            </div>
          </div>
        </div>
      )}

        </OngletContenu>
        <OngletContenu value="fournisseurs">
      {/* ---- Repartition par fournisseur, classee par budget ---------------- */}
      {(qKpi.data?.fournisseurs ?? []).length > 0 && (
        <Carte className="mb-4">
          <CarteEntete>
            <CarteTitre>Répartition par fournisseur</CarteTitre>
            <span className="text-[11px] text-attenue-texte">
              classee par budget · un bon de commande sera cree par fournisseur
            </span>
          </CarteEntete>
          <CarteCorps className="p-0">
            <div className="defilement-x">
              <table className="grille w-full text-[13px]">
                <thead>
                  <tr className="bg-attenue">
                    {ENTETES_FRS.map((t, i) => (
                      <th
                        key={t}
                        className={cn(
                          'px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-attenue-texte',
                          i >= 3 && i <= 8 ? 'text-right' : 'text-left',
                        )}
                      >
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(qKpi.data?.fournisseurs ?? []).map((f) => {
                    const part = kpi && kpi.budget_mad > 0 ? f.montant_mad / kpi.budget_mad : 0
                    return (
                      <tr key={f.code_fournisseur} className="hover:bg-attenue/60">
                        <td className="px-2.5 py-1.5">
                          <span className="font-medium">{f.fournisseur_nom}</span>
                          <span className="ml-1.5 text-[11px] text-attenue-texte">{f.code_fournisseur}</span>
                        </td>
                        <td className="px-2.5 py-1.5 text-attenue-texte">{f.pays ?? '—'}</td>
                        <td className="px-2.5 py-1.5">{f.code_devise}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">{f.delai_livraison_jours ?? '—'} j</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">{f.nb_references}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">{fmt.nombre(f.quantite_kg, 0)} kg</td>
                        <td className="px-2.5 py-1.5 text-right font-medium tabular-nums">{fmt.mad(f.montant_mad)}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">{fmt.nombre(part * 100, 1)} %</td>
                        <td className="px-2.5 py-1.5 text-right">
                          {f.nb_tier1 > 0 ? <Badge ton="danger">{f.nb_tier1}</Badge> : <span className="text-attenue-texte">—</span>}
                        </td>
                        <td className="px-2.5 py-1.5 text-[11px] text-attenue-texte">{f.contact_principal ?? '—'}</td>
                      </tr>
                    )
                  })}
                  <tr className="bg-attenue/40 font-semibold">
                    <td className="px-2.5 py-1.5" colSpan={4}>TOTAL</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">
                      {(qKpi.data?.fournisseurs ?? []).reduce((s, f) => s + f.nb_references, 0)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">
                      {fmt.nombre((qKpi.data?.fournisseurs ?? []).reduce((s, f) => s + f.quantite_kg, 0), 0)} kg
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">
                      {fmt.mad((qKpi.data?.fournisseurs ?? []).reduce((s, f) => s + f.montant_mad, 0))}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">100 %</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          </CarteCorps>
        </Carte>
      )}

        </OngletContenu>
        <OngletContenu value="lignes">
          <LignesACommander
            lignes={ouvertes.filter((p) => coches[p.id_proposition])}
            retirer={(id) => setCoches((c) => ({ ...c, [id]: false }))}
            enCours={commander.isPending}
            ecrire={droits.peutEcrire}
            envoyer={(cibles) => commander.mutate({ propositions: selection, cibles })}
            revenir={() => setOnglet('besoins')}
          />
        </OngletContenu>
        <OngletContenu value="besoins">
      {/* LA REGENERATION VIT ICI, avec ce qu'elle produit. */}
      {droits.peutEcrire && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Bouton
            variante="contour"
            onClick={() =>
              confirmation.demander({
                titre: 'Regenerer les propositions ?',
                libelleConfirmer: 'Regenerer',
                description:
                  'Les propositions ouvertes seront remplacees par un nouveau calcul. Celles ' +
                  'deja converties en commande, et celles que vous avez ecartees, sont conservees.',
                action: () => generer.mutate(),
              })
            }
            chargement={generer.isPending}
          >
            <RefreshCw />
            Regenerer
          </Bouton>
          <Bouton disabled={selection.length === 0} onClick={() => setOnglet('lignes')}>
            Lignes à commander
            {selection.length > 0 && (
              <span className="rounded bg-primaire-texte/15 px-1 text-[10px]">{selection.length}</span>
            )}
            <ArrowRight />
          </Bouton>
        </div>
      )}
      {/* PAS DE TUILES EN TETE D'UNE LISTE DE TRAVAIL (preference de
          l'entreprise, audit v4) : les indicateurs vivent au tableau de bord et
          dans les statistiques ; ici, on traite les lignes. */}
      {selection.length > 0 && (
        <p className="mb-3 text-[12.5px] text-attenue-texte">
          Sélection : <span className="font-semibold text-texte tabular-nums">{fmt.mad(budgetSelection)}</span>
          {' '}· {fournisseursSelection} fournisseur(s)
        </p>
      )}

      {droits.peutEcrire && ouvertes.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <Bouton
            variante="discret"
            taille="xs"
            onClick={() =>
              setCoches(Object.fromEntries(ouvertes.map((p) => [p.id_proposition, true])))
            }
          >
            Tout cocher ({ouvertes.length})
          </Bouton>
          <Bouton variante="discret" taille="xs" onClick={() => setCoches({})}>
            Tout decocher
          </Bouton>
          <span className="text-[11px] text-attenue-texte">
            Un bon de commande sera cree par fournisseur.
          </span>
        </div>
      )}

      {surCatalogue > 0 && (
        <div className="mb-4">
          <Alerte ton="alerte" titre="Prix estimes au catalogue">
            {surCatalogue} reference(s) n'ont encore jamais ete commandees chez leur fournisseur :
            leur prix vient du catalogue converti en dirhams, pas d'un bon valide. Le montant est
            indicatif jusqu'a la premiere commande.
          </Alerte>
        </div>
      )}

      <DataTable<Proposition>
          exportable="plan-achat"
          imprimable="Plan achat"
        module={MODULE}
        colonnes={colonnes}
        lignes={lignes}
        chargement={q.isLoading}
        erreur={q.error}
        cle={(p) => p.id_proposition}
        detail={(p) => (deplies[p.id_proposition] ? <DetailCalcul reference={p.code_reference} /> : null)}
        titreCarte={(p) => p.code_reference}
        placeholderRecherche="Référence, fournisseur, urgence..."
        tailleParDefaut={50}
        videTitre="Aucune proposition"
        videDescription="Le stock projete couvre les besoins, ou le MRP n'a pas encore ete calcule."
        videAction={
          droits.peutEcrire && (
            <Bouton variante="contour" onClick={() => generer.mutate()}>
              <ShoppingCart />
              Generer les propositions
            </Bouton>
          )
        }
        actions={
          droits.peutEcrire
            ? (p) =>
                convertible(p) ? (
                  <div className="flex justify-end gap-0.5">
                    {(p.nb_equivalents ?? 0) > 0 && (
                      <Bouton
                        variante="discret"
                        taille="icone-xs"
                        className={cn(
                          (p.equivalent_dispo_kg ?? 0) > 0
                            ? 'text-primaire hover:bg-primaire/10'
                            : 'text-attenue-texte hover:bg-attenue',
                        )}
                        onClick={() => setArbitrage(p)}
                        aria-label="Equivalents"
                        title={
                          (p.equivalent_dispo_kg ?? 0) > 0
                            ? `Un equivalent a ${fmt.nombre(p.equivalent_dispo_kg, 0)} kg en stock`
                            : 'Voir les references equivalentes'
                        }
                      >
                        <Repeat />
                      </Bouton>
                    )}
                  {/* Proteger du recalcul, ou rendre la ligne au calcul. */}
                  <Bouton
                    variante="discret"
                    taille="icone-xs"
                    className={cn(
                      p.figee ? 'text-primaire hover:bg-primaire/10' : 'text-attenue-texte hover:bg-attenue',
                    )}
                    onClick={() =>
                      p.figee
                        ? confirmation.demander({
                            titre: `Rendre ${p.code_reference} au calcul ?`,
                            description:
                              'Le prochain recalcul remplacera cette ligne par ce que le MRP dit ' +
                              'aujourd hui. Votre ajustement sera perdu.',
                            libelleConfirmer: 'Rendre au calcul',
                            destructif: true,
                            action: () => defiger.mutate(p.id_proposition),
                          })
                        : figer.mutate({ id: p.id_proposition, motif: 'AUTRE' })
                    }
                    aria-label={p.figee ? 'Rendre au calcul' : 'Proteger du recalcul'}
                    title={
                      p.figee
                        ? `Protegee${p.figee_par ? ` par ${p.figee_par}` : ''} — cliquer pour rendre au calcul`
                        : 'Proteger cette ligne du prochain recalcul'
                    }
                  >
                    {p.figee ? <Lock /> : <LockOpen />}
                  </Bouton>
                  <Bouton
                    variante="discret"
                    taille="icone-xs"
                    className="text-attenue-texte hover:bg-attenue"
                    onClick={() =>
                      confirmation.demander({
                        titre: `Ecarter ${p.code_reference} ?`,
                        libelleConfirmer: 'Ecarter',
                        description:
                          `Elle ne sera plus reproposée pendant ${dureeEcart} jours (réglage P_DureeEcartJours) ` +
                          'et n’entrera dans aucune commande. Passé ce délai, si le besoin existe ' +
                          'toujours, le calcul la repropose.',
                        action: () => ignorer.mutate(p.id_proposition),
                      })
                    }
                    aria-label="Ecarter"
                    title="Ecarter cette proposition"
                  >
                    <Ban />
                  </Bouton>
                  </div>
                ) : null
            : undefined
        }
      />
        </OngletContenu>
      </Onglets>

      {arbitrage && (
        <PanneauEquivalent
          proposition={arbitrage}
          enCours={substituer.isPending}
          surFermeture={() => setArbitrage(null)}
          surBascule={(cible, motif) =>
            substituer.mutate({ id: arbitrage.id_proposition, cible, motif })
          }
        />
      )}

      <SaisonMinimums />

      {confirmation.element}
    </div>
  )
}

/**
 * Les references equivalentes a une proposition, et la bascule.
 *
 * Le MRP ne mutualise jamais le stock d'un groupe : il calcule un besoin par
 * reference, et c'est deliberé — mutualiser masquerait le manque de la
 * reference preferentielle derriere du stock qui n'est pas le bon article.
 *
 * La contrepartie est ici : l'acheteur VOIT ce que le calcul a ignore, et
 * decide. La bascule est un acte, avec un motif, et la reference d'origine
 * reste attachee a la proposition.
 */
function PanneauEquivalent({
  proposition,
  enCours,
  surFermeture,
  surBascule,
}: {
  proposition: Proposition
  enCours: boolean
  surFermeture: () => void
  surBascule: (cible: string, motif: string) => void
}) {
  const [choisi, setChoisi] = useState('')
  const [motif, setMotif] = useState('')

  const q = useQuery({
    queryKey: ['equivalences', proposition.code_reference],
    queryFn: () =>
      api.get<Equivalent[]>(
        `/api/equivalences?code_reference=${encodeURIComponent(proposition.code_reference)}`,
      ),
  })

  const equivalents = q.data ?? []
  const retenu = equivalents.find((e) => e.equivalent_reference === choisi)

  return (
    <Dialogue open onOpenChange={(o) => !o && surFermeture()}>
      <DialogueContenu
        cote="droite"
        titre={`Equivalents de ${proposition.code_reference}`}
        description={`Besoin a couvrir : ${fmt.nombre(proposition.quantite_suggeree_kg, 0)} kg`}
      >
        {q.isLoading && <Chargement texte="Lecture du groupe d équivalence…" />}

        {!q.isLoading && equivalents.length === 0 && (
          <Alerte ton="info">
            Cette reference n'appartient a aucun groupe d'equivalence actif. Rattachez-la depuis
            l'ecran Equivalences si un substitut existe.
          </Alerte>
        )}

        <div className="space-y-1.5">
          {equivalents.map((e) => {
            const dort = e.equivalent_stock_kg > 0 && e.equivalent_besoin_12m_kg === 0
            const couvre = e.equivalent_stock_kg >= proposition.quantite_suggeree_kg
            return (
              <label
                key={e.equivalent_reference}
                className={cn(
                  'block rounded-[var(--radius)] border p-2',
                  e.interchangeable === 0 && 'opacity-60',
                  choisi === e.equivalent_reference
                    ? 'border-primaire bg-primaire/5'
                    : 'border-bordure',
                  e.interchangeable === 1 ? 'cursor-pointer' : 'cursor-not-allowed',
                )}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="equivalent"
                    checked={choisi === e.equivalent_reference}
                    disabled={e.interchangeable === 0}
                    onChange={() => setChoisi(e.equivalent_reference)}
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{e.equivalent_reference}</span>
                      {dort && <Badge ton="alerte">stock sans besoin</Badge>}
                      {couvre && <Badge ton="succes">couvre le besoin</Badge>}
                      {e.meme_fournisseur === 1 && (
                        <Badge ton="alerte">meme fournisseur</Badge>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-attenue-texte">
                      {e.equivalent_designation}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-attenue-texte">
                      <span>
                        Stock{' '}
                        <span className="tabular-nums font-medium text-texte">
                          {fmt.nombre(e.equivalent_stock_kg, 0)} kg
                        </span>
                      </span>
                      <span>
                        Besoin propre{' '}
                        <span className="tabular-nums text-texte">
                          {fmt.nombre(e.equivalent_besoin_12m_kg, 0)} kg
                        </span>
                      </span>
                      {e.equivalent_fournisseur_nom && (
                        <span>{e.equivalent_fournisseur_nom}</span>
                      )}
                      {e.equivalent_delai_jours != null && (
                        <span className="tabular-nums">{e.equivalent_delai_jours} j</span>
                      )}
                      {e.equivalent_prix_catalogue_kg != null && (
                        <span className="tabular-nums">
                          {fmt.nombre(e.equivalent_prix_catalogue_kg, 2)} {e.equivalent_devise}/kg
                        </span>
                      )}
                    </div>
                    {e.interchangeable === 0 && (
                      <p className="mt-1 text-[11px] text-danger">
                        Unite, densite ou categorie differentes : substituer fausserait le kg/m2
                        des recettes. Bascule refusee par le serveur.
                      </p>
                    )}
                  </div>
                </div>
              </label>
            )
          })}
        </div>

        {retenu && (
          <div className="mt-3">
            <Etiq htmlFor="motif" obligatoire>
              Motif de la bascule
            </Etiq>
            <Champ
              id="motif"
              value={motif}
              onChange={(ev) => setMotif(ev.target.value)}
              placeholder="Stock dormant, délai plus court, rupture chez le fournisseur…"
            />
            <p className="mt-1 text-[11px] text-attenue-texte">
              Le besoin sera reporte sur {retenu.equivalent_reference}, et{' '}
              {proposition.code_reference} restera tracee comme reference d'origine. Si une
              proposition est deja ouverte sur la cible, les quantites seront fusionnees.
            </p>
          </div>
        )}

        <div className="sticky bottom-0 -mx-4 mt-4 flex items-center justify-between gap-2 border-t border-bordure bg-surface px-4 pt-3">
          <span className="text-[11px] text-attenue-texte">
            Le calcul du MRP n'est pas modifie : seule la proposition change de reference.
          </span>
          <div className="flex items-center gap-2">
            <Bouton variante="contour" onClick={surFermeture}>
              Annuler
            </Bouton>
            <Bouton
              disabled={!choisi || !motif.trim()}
              chargement={enCours}
              onClick={() => surBascule(choisi, motif.trim())}
            >
              <Repeat />
              Basculer le besoin
            </Bouton>
          </div>
        </div>
      </DialogueContenu>
    </Dialogue>
  )
}

interface BcResume {
  id_bc: string
  numero_bc: string
  code_fournisseur: string
  statut: string
  date_bc: string
  nb_lignes: number
}

/**
 * LES LIGNES A COMMANDER — ce qu'on a coche dans les besoins, par fournisseur.
 *
 * Chaque ligne se retire d'un geste (elle redevient un simple besoin). Pour
 * chaque fournisseur, on choisit ou ses lignes vont : un NOUVEAU bon, ou un
 * bon du meme fournisseur encore en brouillon — on complete au lieu d'en
 * ouvrir un second. Rien n'est engage : le bon reste a valider.
 */
function LignesACommander({
  lignes, retirer, enCours, ecrire, envoyer, revenir,
}: {
  lignes: Proposition[]
  retirer: (id: string) => void
  enCours: boolean
  ecrire: boolean
  envoyer: (cibles: Record<string, string>) => void
  revenir: () => void
}) {
  const [cibles, setCibles] = useState<Record<string, string>>({})
  const qBc = useQuery({
    queryKey: ['bons-commande'],
    queryFn: ({ signal }) => api.get<BcResume[]>('/api/bons-commande', { signal }),
  })
  const groupes = useMemo(() => {
    const m = new Map<string, Proposition[]>()
    for (const p of lignes) m.set(p.code_fournisseur, [...(m.get(p.code_fournisseur) ?? []), p])
    return [...m.entries()]
  }, [lignes])
  const ouverts = (frs: string) =>
    (qBc.data ?? []).filter(
      (b) => b.code_fournisseur === frs && (b.statut === 'BROUILLON' || b.statut === 'EN_ATTENTE_VALIDATION'),
    )

  if (lignes.length === 0) {
    return (
      <Alerte ton="info" titre="Aucune ligne à commander">
        Cochez des besoins dans l’onglet Besoins : ils apparaîtront ici, groupés par fournisseur.{' '}
        <button type="button" className="underline" onClick={revenir}>Aller aux besoins</button>
      </Alerte>
    )
  }

  const th = 'px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte'
  const totalMad = lignes.reduce((t, p) => t + (p.montant_total_mad ?? 0), 0)

  return (
    <div className="space-y-3">
      {groupes.map(([frs, ls]) => {
        const devise = ls[0].code_devise ?? ''
        const montantDevise = ls.reduce((t, p) => t + (p.montant_devise ?? 0), 0)
        return (
          <Carte key={frs}>
            <CarteEntete>
              <CarteTitre>{ls[0].fournisseur_nom || frs}</CarteTitre>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11.5px] text-attenue-texte">Envoyer vers</span>
                <Selecteur
                  className="h-8 w-80 max-w-full"
                  value={cibles[frs] ?? ''}
                  disabled={!ecrire}
                  onChange={(e) => setCibles((c) => ({ ...c, [frs]: e.target.value }))}
                  aria-label={`Bon de commande pour ${ls[0].fournisseur_nom || frs}`}
                >
                  <option value="">Un nouveau bon</option>
                  {ouverts(frs).map((b) => (
                    <option key={b.id_bc} value={b.id_bc}>
                      {b.numero_bc} · {b.statut === 'BROUILLON' ? 'brouillon' : 'en attente'} · {b.nb_lignes} ligne(s)
                    </option>
                  ))}
                </Selecteur>
              </div>
            </CarteEntete>
            <CarteCorps className="p-0">
              <div className="defilement-x">
                <table className="w-full min-w-[44rem] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-bordure">
                      <th className={cn(th, 'text-left')}>Référence</th>
                      <th className={cn(th, 'w-24 text-left')}>Urgence</th>
                      <th className={cn(th, 'w-32 text-right')}>Quantité</th>
                      <th className={cn(th, 'w-28 text-right')}>Prix {devise}</th>
                      <th className={cn(th, 'w-32 text-right')}>Montant {devise}</th>
                      <th className={cn(th, 'w-36 text-right')}>Montant MAD</th>
                      {ecrire && <th className={cn(th, 'w-10')} />}
                    </tr>
                  </thead>
                  <tbody>
                    {ls.map((p) => (
                      <tr key={p.id_proposition} className="border-b border-bordure/60">
                        <td className="px-2 py-1.5">
                          <div className="font-medium">{p.code_reference}</div>
                          {p.designation && <div className="text-[11px] text-attenue-texte">{p.designation}</div>}
                        </td>
                        <td className="px-2 py-1.5"><Badge ton={TON_URGENCE[p.urgence] ?? 'neutre'}>{p.urgence}</Badge></td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmt.nombre(p.quantite_suggeree_kg, 0)} kg</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{p.prix_devise == null ? '—' : fmt.nombre(p.prix_devise, 3)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{p.montant_devise == null ? '—' : fmt.nombre(p.montant_devise, 2)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{p.montant_total_mad == null ? '—' : fmt.mad(p.montant_total_mad)}</td>
                        {ecrire && (
                          <td className="px-2 py-1.5">
                            <Bouton taille="icone-xs" variante="discret" aria-label={`Retirer ${p.code_reference}`}
                              title="Retirer de la commande : la ligne redevient un simple besoin"
                              onClick={() => retirer(p.id_proposition)}>
                              <X />
                            </Bouton>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-attenue/40 font-semibold">
                      <td className="px-2 py-1.5" colSpan={4}>{ls.length} ligne(s)</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt.nombre(montantDevise, 2)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmt.mad(ls.reduce((t, p) => t + (p.montant_total_mad ?? 0), 0))}</td>
                      {ecrire && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CarteCorps>
          </Carte>
        )
      })}

      {ecrire && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-primaire bg-surface px-3 py-2 shadow-sm">
          <span className="text-[13px]">
            <span className="font-medium">{lignes.length} ligne(s)</span>
            <span className="text-attenue-texte"> · {groupes.length} fournisseur(s) · {fmt.mad(totalMad)}</span>
            <span className="text-attenue-texte"> — les bons restent en brouillon, rien n’est engagé.</span>
          </span>
          <Bouton chargement={enCours} onClick={() => envoyer(Object.fromEntries(Object.entries(cibles).filter(([, v]) => v)))}>
            <FileCheck2 />
            Envoyer au bon de commande
          </Bouton>
        </div>
      )}
    </div>
  )
}
