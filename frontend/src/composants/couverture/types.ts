/**
 * LE MOTEUR DE COUVERTURE, VU DE L'ÉCRAN — les formes que rend le serveur
 * (`backend/src/routes/couverture.rs`) et les petits outils d'affichage
 * partagés par la liste « À commander » (plan d'achat), le volet « Surveillance
 * / Alertes » du stock projeté, la grande fenêtre de détail et la simulation.
 *
 * Tout champ peut manquer : un champ masqué par la grille de droits n'est pas
 * envoyé. Aucun calcul de besoin ici : l'écran affiche ce que le moteur rend
 * (au plus une différence pour l'écart à la sécurité, ou une somme de jours).
 */
import { fmt } from '../../lib/utils'

export interface LigneCouverture extends Record<string, unknown> {
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
  /** Le fil en route vers un magasin compté, compté à sa date prévue de disponibilité (27/10/2026). */
  transit_kg?: number
  /** Bons non validés et bons livrés après l'horizon : non comptés, montrés (27/10/2026). */
  non_valide_kg?: number
  apres_horizon_kg?: number
  /** L'état au moteur : PLAN_NON_COUVERT, SOUS_SECURITE, COUVERT (27/10/2026). */
  statut?: string
  a_commander_aujourdhui?: boolean
  arrivages_comptes_kg?: number
  /** Jours couverts depuis aujourd'hui jusqu'à la veille de la 1re rupture ; null : tout l'horizon. */
  jours_couverture?: number | null
  /** Le plan de l'horizon ramené à un mois de 30 jours (« Plan / mois »). */
  plan_mois_kg?: number | null
  /** Un défaut de la fiche qui impose un réglage par défaut (pas de classe ABC) : signalé, jamais bloquant. */
  defaut_donnees?: string | null
  // ---- Le stock projeté (27/10/2026), tiré du moteur ----
  /** Magasins comptés, restes ôtés. */
  magasin_hors_restes_kg?: number
  /** Fil sur machine compté, restes chargés ôtés. */
  machine_hors_restes_kg?: number
  /** Les restes comptés par le moteur (magasin + machine). */
  restant_kg?: number
  /** Disponible + machine + restant + arrivages comptés, sans recouvrement. */
  stock_total_projete_kg?: number
  /** Le plan de [aujourd'hui, aujourd'hui + délai[. */
  besoin_jusqu_livraison_kg?: number
  /** La ligne de sécurité du moteur aujourd'hui. */
  securite_aujourdhui_kg?: number
}

export interface EnteteCouverture {
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

export interface ListeCouverture extends EnteteCouverture {
  lignes: LigneCouverture[]
}

export interface Jour {
  date: string
  conso_prevue_kg: number
  arrivee_kg: number
  solde_kg: number
  securite_kg: number
  plan_non_couvert_kg: number
}

export interface Evenement {
  date: string
  natures: string[]
  conso_prevue_kg: number
  arrivee_kg: number
  solde_apres_kg: number
  securite_kg: number
  plan_non_couvert_kg: number
}

export interface Proposition {
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
  /** Masqués avec la quantité à commander. */
  besoin_theorique_kg?: number
  jour_determinant: string
  moq_kg: number | null
  apres_minimum_kg?: number
  multiple_kg: number | null
  quantite_proposee_kg?: number
  palettes_equivalentes?: number | null
  date_limite_commande: string
}

export interface Arrivage {
  origine: 'BON' | 'IMPORT_SANS_BON' | 'TRANSFERT'
  /** La clé de l'arrivage, pour une hypothèse de simulation (BON:…, TRANSFERT:…, IMPORT:…). */
  cle?: string
  /** Né ou modifié par une hypothèse de simulation. */
  hypothese?: string | null
  numero_bc?: string | null
  ligne_numero?: number | null
  statut_bc?: string | null
  numero_dossier?: string | null
  numero_facture?: string | null
  numero_transfert?: string | null
  /** La date prévue de disponibilité d'un transfert en route (27/10/2026). */
  date_disponibilite_prevue?: string | null
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

export interface Reglages {
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
  defaut_donnees?: string | null
}

/** Ce que le détail et la simulation rendent pareil (`vue_analyse`). */
export interface VueAnalyse {
  reglages: Reglages
  synthese: LigneCouverture
  arrivages: Arrivage[]
  evenements: Evenement[]
  propositions: Proposition[]
  propositions_plafonnees: boolean
  motif_sans_proposition: string | null
  jours: Jour[]
}

export interface ReferenceCouverture {
  code_reference: string
  designation: string | null
  classe_abc: string | null
  code_fournisseur?: string | null
  fournisseur_nom: string | null
  moq_kg: number | null
  multiple_achat_kg: number | null
  arrondi_palette?: boolean
  poids_bobine_kg: number | null
  bobines_par_palette: number | null
}

export interface DetailCouverture extends EnteteCouverture, VueAnalyse {
  reference: ReferenceCouverture
  ressources: {
    compte_kg: number
    magasin_kg: number
    machine_kg: number
    /** Tout le stock physique, compté ou non. */
    stock_physique_kg?: number
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
  /** Le prix du plan d'achat et le montant de la 1re proposition (masqués selon les droits). */
  achat?: { prix_estime_mad?: number | null; source_prix?: string; montant_estime_mad?: number | null } | null
  /** Les réglages de la fiche qui ne sont que des ALERTES, et le réel du grand livre. */
  approvisionnement?: {
    stock_min_fiche_kg?: number | null
    couverture_min_fiche_mois?: number | null
    couverture_min_parametre_mois?: number | null
    marge_securite_fiche_pct?: number | null
    seuil_alerte_j?: number | null
    unite_catalogue?: string | null
    reel_mois_kg?: number | null
  } | null
}

/** La réponse de la simulation : le réel et le simulé, côte à côte. */
export interface ReponseSimulation extends EnteteCouverture {
  simulation: true
  avertissement: string
  reference: ReferenceCouverture
  hypotheses: string[]
  reelle: VueAnalyse
  simulee: VueAnalyse
}

// ============================================================================
// Outils d'affichage
// ============================================================================

/** Des kilos lisibles : entiers au-delà de 10 kg, une décimale en dessous. */
export const kg = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? fmt.nombre(v, Math.abs(v) < 10 && v !== 0 ? 1 : 0) : '—'

export const positif = (v: unknown): v is number => typeof v === 'number' && v > 0.0001

/** « 2026-10-26 » + n jours, en restant en dates civiles (pas d'heure). */
export function plusJours(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function joursEntre(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** Une date courte, sans dépendre du fuseau du poste. */
export function dateCourte(iso: string | null | undefined) {
  if (!iso) return '—'
  const [a, m, j] = iso.slice(0, 10).split('-')
  return `${j}/${m}/${a}`
}

/** La même, année sur deux chiffres : pour les listes, où chaque colonne compte. */
export function dateListe(iso: string | null | undefined) {
  if (!iso) return '—'
  const [a, m, j] = iso.slice(0, 10).split('-')
  return `${j}/${m}/${a.slice(2)}`
}

export const NATURES: Record<string, string> = {
  AUJOURDHUI: 'Aujourd’hui',
  ARRIVAGE: 'Arrivage',
  RUPTURE: 'Plan non couvert à partir de ce jour',
  REPRISE: 'Couverture reprise',
  SOUS_SECURITE: 'Passage sous la sécurité',
  FIN_DE_MOIS: 'Fin de mois',
  AUJOURDHUI_PLUS_DELAI: 'Aujourd’hui + délai : première arrivée possible',
  FIN_HORIZON: 'Fin de l’horizon du plan',
}

export const CATEGORIES: Record<string, { libelle: string; ton: 'succes' | 'alerte' | 'neutre' | 'info' }> = {
  DATE: { libelle: 'compté à sa date', ton: 'succes' },
  EN_RETARD: { libelle: 'en retard', ton: 'alerte' },
  SANS_DATE: { libelle: 'sans date', ton: 'neutre' },
  NON_VALIDE: { libelle: 'non validé', ton: 'neutre' },
  APRES_HORIZON: { libelle: 'après l’horizon', ton: 'neutre' },
  TRANSIT: { libelle: 'en route, compté à sa date', ton: 'succes' },
}

/** Les sources du prix, dites en clair. */
export const SOURCES_PRIX: Record<string, string> = {
  DERNIER_ACHAT: 'dernier achat chez le fournisseur',
  CATALOGUE: 'prix catalogue au taux du jour',
  CMUP: 'CMUP, à défaut d’achat et de catalogue',
  AUCUN: 'aucun prix connu',
}

/** La source d'un réglage, toujours dite (fournisseur, paramètre global, classe ABC, simulation). */
export const source = (s: string | null | undefined) => (s ? ` (${s})` : '')

/** La désignation, sauf quand elle ne fait que répéter le code (« PES Nylon — PES Nylon »). */
export function designationUtile(l: { code_reference: string; designation?: string | null }) {
  const d = l.designation?.trim()
  return d && d.toLowerCase() !== l.code_reference.trim().toLowerCase() ? d : null
}

/** Le libellé d'un arrivage : bon, import ou transfert, ou l'hypothèse qui l'a fait naître. */
export function libelleArrivage(a: Arrivage) {
  if (a.origine === 'BON' && a.cle?.startsWith('BON:SIMULATION')) return a.numero_bc ?? 'Hypothèse'
  return a.origine === 'BON'
    ? `Bon ${a.numero_bc ?? '?'}${a.ligne_numero != null ? `, ligne ${a.ligne_numero}` : ''}`
    : a.origine === 'IMPORT_SANS_BON'
      ? `Import ${a.numero_dossier ?? '?'}${a.numero_facture ? `, facture ${a.numero_facture}` : ''}`
      : `Transfert ${a.numero_transfert ?? '?'}${a.code_magasin_source ? ` (${a.code_magasin_source} → ${a.code_magasin_dest ?? '?'})` : ''}`
}
