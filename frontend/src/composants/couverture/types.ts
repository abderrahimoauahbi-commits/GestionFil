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

/** Un signal du moteur (§ 15.4) : indépendant de l'état, il ne bloque jamais. */
export interface SignalCouverture {
  code: string
  date: string | null
  message: string
}

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
  /** L'état au moteur v2 : RUPTURE_INEVITABLE, SOUS_SECURITE, SOUS_CIBLE, COUVERT (§ 15.4). */
  statut?: string
  /** Les signaux, à part de l'état : CIBLE_NON_DEFINIE, SOUS_MINIMUM, RETARD_CIBLE, HORIZON_COURT, DEFAUT_DONNEES. */
  signaux?: SignalCouverture[]
  /** C, la couverture cible (jours = 30 × mois de la fiche), sa valeur en mois et sa source. */
  couverture_cible_j?: number | null
  couverture_cible_mois?: number | null
  source_cible?: string | null
  /** Couverture actuelle − C (jours). */
  ecart_cible_j?: number | null
  /** D* = R − C, la date de besoin. */
  date_besoin?: string | null
  /** X, la sécurité appliquée à la 1re proposition. */
  securite_x_kg?: number
  /** Le stock minimum de la fiche (garde-fou) et le jour où il est franchi. */
  stock_min_kg?: number | null
  sous_minimum_le?: string | null
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
  /** NS(aujourd'hui) : le plan des S jours suivants. */
  securite_aujourdhui_kg?: number
  /** La raison de l'état, en une phrase chiffrée. */
  raison_etat?: string
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
  /** B(t), le solde au soir du jour, sans plafond à zéro. */
  solde_kg: number
  /** b(t), le point bas du jour, avant ses arrivages. */
  point_bas_kg?: number
  /** NS(t), le seuil de sécurité : le plan des S jours suivants. */
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

/** Une fenêtre de commande : la rupture R, sa date de besoin D*, sa réception D, son besoin net Q0. */
export interface Fenetre {
  date_rupture: string
  date_besoin: string
  date_disponibilite: string
  date_limite_commande: string
  en_retard: boolean
  rupture_inevitable: boolean
  manque_inevitable_kg: number
  debut: string
  /** Exclue : la fenêtre est [debut, fin[. */
  fin: string
  dernier_jour_couvert: string
  jours: number
  bornee_horizon: boolean
  plan_kg: number
  reste_kg: number
  arrivages_kg: number
  /** Q0 — masqué avec la quantité à commander. */
  besoin_net_kg?: number
}

/** Une proposition : Q0 (besoin net) + X (sécurité) + arrondi = Q (§ 15.5). */
export interface Proposition {
  rang: number
  /** Plusieurs fenêtres reçues le même jour (cible déjà en retard, § 15.9 bis-2). */
  consolidee: boolean
  date_rupture: string
  date_besoin: string
  date_disponibilite: string
  date_limite_commande: string
  en_retard: boolean
  rupture_inevitable: boolean
  manque_inevitable_kg: number
  date_debut_fenetre: string
  date_fin_fenetre: string
  dernier_jour_couvert: string
  jours_fenetre: number
  fenetre_bornee_horizon?: boolean
  plan_fenetre_kg: number
  reste_kg: number
  arrivages_fenetre_kg: number
  moq_kg: number | null
  multiple_kg: number | null
  /** Masqués avec la quantité à commander. */
  besoin_net_kg?: number
  securite_kg?: number
  apres_minimum_kg?: number
  arrondi_kg?: number
  quantite_proposee_kg?: number
  palettes_equivalentes?: number | null
  stock_apres_reception_kg?: number
  stock_fin_fenetre_kg?: number
  fenetres: Fenetre[]
}

/** La situation d'une référence (§ 15.5). */
export interface Situation {
  etat: string
  signaux: SignalCouverture[]
  couverture_actuelle_j: number | null
  premiere_rupture: string | null
  reste_rupture_kg: number | null
  couverture_cible_j: number | null
  ecart_cible_j: number | null
  date_besoin: string | null
  date_limite_commande: string | null
  securite: {
    jours: number
    appliquee: boolean
    x_kg: number
    premier_franchissement: string | null
    point_bas_franchissement_kg: number | null
    seuil_franchissement_kg: number | null
    jour_creux: string | null
    point_bas_creux_kg: number | null
    seuil_creux_kg: number | null
  }
  stock_minimum: { kg: number | null; franchi_le: string | null; point_bas_kg: number | null }
  plan_mois_kg: number
  source: string
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
  couverture_cible_j?: number | null
  couverture_cible_mois?: number | null
  source_cible?: string | null
  stock_min_kg?: number | null
}

/** Ce que le détail et la simulation rendent pareil (`vue_analyse`). */
export interface VueAnalyse {
  reglages: Reglages
  situation?: Situation
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
    qualites: { code_qualite: string; kg_m2?: number | null; kg: number }[]
    kg_qualites: number
  }[]
  /** Le prix du plan d'achat et le montant de la 1re proposition (masqués selon les droits), et en devise. */
  achat?: {
    prix_estime_mad?: number | null
    source_prix?: string
    montant_estime_mad?: number | null
    code_devise?: string | null
    prix_devise?: number | null
    montant_devise?: number | null
  } | null
  /** La fenêtre du stock projeté (27/10/2026). */
  stock_projete?: StockProjeteDetail
  /** LE STOCK PROJETÉ (§ 16, 30/10/2026) : combien commander, sans chronologie. */
  projete?: ProjeteDetail
  /** Les réglages de la fiche (couverture cible, stock minimum = garde-fou), et le réel du grand livre. */
  approvisionnement?: {
    stock_min_fiche_kg?: number | null
    couverture_cible_fiche_mois?: number | null
    seuil_alerte_j?: number | null
    unite_catalogue?: string | null
    reel_mois_kg?: number | null
  } | null
}

/** Une étape de la formation de la couverture (§ 16.2). */
export interface EtapeProjete {
  date: string
  /** ARRIVAGE ou EPUISEMENT. */
  nature: 'ARRIVAGE' | 'EPUISEMENT'
  conso_kg: number
  manque_kg: number
  arrivee_kg: number
  solde_kg: number
}

/** LE STOCK PROJETÉ d'une référence (§ 16, `domain/projete.rs`). */
export interface ProjeteDetail {
  rattrapage: boolean
  horizon_j: number
  arrivages_kg: number
  position_kg: number
  besoin_delai_kg: number
  couverture_j: number | null
  couvert_jusqu_au: string | null
  manque_kg: number
  cible_j: number | null
  ecart_cible_j: number | null
  avant_le: string | null
  stock_min_j: number | null
  seuil_alerte_j: number
  couverture_livraison_j: number | null
  /** ALERTE | SOUS_CIBLE | COUVERT. */
  etat: string
  raison: string
  signaux: SignalCouverture[]
  /** Absente : rien à commander, ou masquée selon les droits. */
  quantite?: {
    date_reception: string
    niveau_vise_j: number
    besoin_kg: number
    moq_kg: number | null
    apres_minimum_kg: number
    multiple_kg: number | null
    complement_multiple_kg: number
    quantite_kg: number
    palettes: number | null
  } | null
  motif_sans_quantite: string | null
  etapes: EtapeProjete[]
  /** Les jours sans fil jusqu'au prochain approvisionnement (31/10/2026). */
  jours_sans_fil?: number
  /** Les paliers de rupture (31/10/2026). */
  rupture_j?: number | null
  rupture_le?: string | null
  palier?: string | null
  palier_suivant?: string | null
  date_palier_suivant?: string | null
  a_sec?: { date_sec: string; date_arrivage: string; jours: number; manque_kg: number } | null
  /** Le pont de la fenêtre : du stock compté au niveau visé C + N ; absent sans cible. */
  pont?: {
    vise_j: number
    date_vise: string
    arrivages_kg: number
    plan_kg: number
    solde_kg: number
  } | null
  /** La ligne du tableau (onglets Approvisionnement et Emplacements). */
  ligne?: {
    stock_par_magasin?: Record<string, number> | null
    machine_hors_restes_kg?: number
    restant_kg?: number
    quarantaine_kg?: number
    transit_kg?: number
    commande_kg?: number
    stock_apres_arrivage_kg?: number
    disponible_kg?: number
    [k: string]: unknown
  }
  montant_estime_mad?: number | null
  montant_devise?: number | null
  /** Les réglages du stock projeté appliqués (31/10/2026, P_Projete*). */
  options?: {
    sans_date: boolean
    retard_j: number
    quarantaine: boolean
    age_constat_max_j: number
    min_multiple: boolean
    minimum_alerte: boolean
  } | null
}

/** LA FENÊTRE DU STOCK PROJETÉ (27/10/2026) : ce qu'elle montre en plus du détail commun. */
export interface StockProjeteDetail {
  tuiles: {
    stock_total_kg: number
    sur_metiers_kg: number
    disponible_kg: number
    date_reception: string | null
    reception_en_retard: boolean | null
    besoin_jusqu_reception_kg: number | null
    plan_commande_kg: number | null
    couverture_commande_j: number
    stock_a_la_reception_kg: number | null
    couverture_actuelle_j: number | null
    couverture_cible_j: number | null
    ecart_cible_j: number | null
    horizon_j: number
    qte_a_commander_kg?: number | null
    palettes_equivalentes?: number | null
    date_limite_commande: string | null
    raison_etat: string
  }
  cascade: {
    magasins: { code_magasin: string; nom: string | null; kg: number }[]
    sur_metiers_kg: number
    restes_kg: number
    disponible_kg: number
    date_reception: string | null
    arrivages_avant_reception_kg: number | null
    besoin_jusqu_reception_kg: number | null
    stock_a_la_reception_kg: number | null
    arrivages_apres: Arrivage[]
    arrivages_non_comptes: Arrivage[]
    quarantaine_kg: number
    bloque_kg: number
    hors_plan_kg: number
  }
  classement: {
    classe_abc?: string | null
    rang?: number | null
    pct_cumule?: number | null
    valeur_conso_annuelle_mad?: number | null
    classe_xyz?: string | null
    politique?: string | null
    /** Le coefficient de variation qui fixe la classe XYZ (§ 16, 30/10/2026). */
    coef_variation_xyz?: number | null
    /** Le palier de montant (v_risque_sourcing). */
    tier?: string | null
    nb_sources?: number | null
    risque_source?: string | null
    code_groupe_equiv?: string | null
    groupe_libelle?: string | null
    nb_fournisseurs_groupe?: number | null
    derniere_sortie?: string | null
    jours_sans_mouvement?: number | null
    dormant?: boolean
  } | null
  lots: {
    code_magasin: string
    magasin_nom: string | null
    lot_fournisseur: string
    kg: number
    nb_bobines: number | null
    statut_lot: string | null
    categorie: string | null
    date_premiere_entree: string | null
    date_peremption: string | null
    quarantaine: boolean
    inclure_mrp: boolean
  }[]
  /** Null : pas le droit de lire les mouvements. */
  historique:
    | {
        numero_mouvement: string | null
        date_mouvement: string | null
        code_type_mvt: string | null
        type_libelle: string | null
        signe: number | null
        code_magasin: string | null
        lot_fournisseur: string | null
        kg: number
      }[]
    | null
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
  RUPTURE: 'Rupture : plan non couvert à partir de ce jour',
  REPRISE: 'Couverture reprise',
  SOUS_SECURITE: 'Point bas sous le seuil de sécurité',
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
