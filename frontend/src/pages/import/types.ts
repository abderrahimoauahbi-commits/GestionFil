/**
 * Les formes que renvoie l'API des dossiers d'importation.
 *
 * Les champs de cout (`cout_revient_*`, `frais_alloues_dhs`, `coef_frais_pct`,
 * `montant_alloue_dhs`) sont MASQUES par le serveur a qui n'a pas le module
 * VALORISATION : ils sont donc optionnels, et leur absence n'est pas un zero.
 */

export type StatutDossier = 'BROUILLON' | 'EN_COURS' | 'CLOTURE'

export interface DossierResume extends Record<string, unknown> {
  id_dossier: string
  numero: string
  numero_bl: string | null
  conteneurs: string | null
  code_devise: string
  taux_change: number
  date_arrivee: string | null
  statut: StatutDossier
  date_creation: string
  date_cloture: string | null
  nb_factures: number
  fournisseurs: string | null
  /** Les numeros d'engagement d'importation, separes par des virgules. */
  engagements?: string | null
  valeur_dhs: number
  poids_kg: number
  recu_kg: number
  nb_palettes: number
  nb_bobines: number
  frais_dhs: number
  tva_dhs: number
  coef_frais_pct?: number | null
}

export interface Dossier {
  id_dossier: string
  numero: string
  numero_bl: string | null
  conteneurs: string | null
  code_devise: string
  taux_change: number
  date_arrivee: string | null
  statut: StatutDossier
  notes: string | null
  date_creation: string
  date_cloture: string | null
  cree_par: string | null
  cloture_par: string | null
}

export interface Facture {
  id_facture: string
  code_fournisseur: string
  fournisseur_nom: string
  numero_facture: string
  date_facture: string
  code_devise: string
  taux_change: number
  montant_devise: number | null
  montant_lignes_devise: number
  nb_palettes: number | null
  nb_bobines: number | null
  nb_lignes: number
  statut_reception: 'NON_RECUE' | 'PARTIELLE' | 'RECUE'
}

/** Une ligne de `v_import_cout_revient`. */
export interface Ligne {
  id_ligne: string
  id_facture: string
  numero_facture: string
  code_fournisseur: string
  fournisseur_nom: string | null
  ligne_numero: number
  type_ligne: 'ERP' | 'HORS_ERP'
  code_reference: string | null
  designation: string | null
  id_ligne_bc: string | null
  numero_bc: string | null
  lot_fournisseur: string | null
  code_couleur: string | null
  libelle_couleur: string | null
  unite: 'kg' | 'ml' | 'piece'
  quantite: number
  poids_net_kg: number | null
  nb_bobines: number
  nb_palettes: number
  prix_unitaire_devise: number
  /** Remise du fournisseur, en % du prix brut. */
  remise_pct?: number | null
  code_devise: string
  taux_change: number
  montant_devise: number
  pct_dossier: number | null
  valeur_achat_dhs: number
  prix_achat_unitaire_dhs: number
  frais_alloues_dhs?: number
  cout_revient_dhs?: number
  cout_revient_unitaire_dhs?: number
  cout_revient_kg_dhs?: number | null
  coef_frais_pct?: number | null
  quantite_recue_kg: number
  reste_kg: number | null
  soldee: number
}

export interface Frais {
  id_ligne_frais: string
  id_frais: string
  frais_libelle: string
  categorie: string
  inclus_dans_cout: number
  libelle: string | null
  numero_piece: string | null
  montant_devise: number
  code_devise: string
  cours_change: number
  montant_dhs: number
  cibles: string[]
}

export interface Allocation {
  id_ligne_frais: string
  id_article_dossier: string
  pourcentage: number
  montant_alloue_dhs?: number
}

/**
 * Une reception d'import, dans sa liste. C'est un document A PART : dossiers,
 * fournisseurs et factures se lisent a travers ses lignes. Le numero de
 * facture peut etre masque (droits RECEPTIONS du magasin).
 */
export interface ReceptionResume extends Record<string, unknown> {
  id_reception: string
  numero_reception: string
  date_reception: string
  statut: 'BROUILLON' | 'VALIDEE' | 'ANNULEE'
  litige: number
  motif_litige: string | null
  date_validation: string | null
  cree_par: string | null
  valide_par: string | null
  dossiers: string | null
  fournisseur_nom: string | null
  numero_facture?: string | null
  nb_lignes: number
  quantite_kg: number
  ecart_kg: number
  nb_bobines: number
  nb_palettes: number
}

export interface Ajustement {
  code_reference: string
  nature: 'STOCK' | 'CONSOMME'
  code_magasin: string | null
  quantite_recue_kg: number
  stock_kg: number
  cump_avant?: number | null
  cump_apres?: number | null
  montant_dhs: number
}

/** Une piece deposee dans le dossier : scan, PDF, photo. */
export interface Piece {
  id_piece: string
  id_facture: string | null
  id_reception: string | null
  nature: 'FACTURE_FOURNISSEUR' | 'DUM' | 'QUITTANCE_DOUANE' | 'LIQUIDATION' | 'FACTURE_FRAIS'
    | 'BL' | 'PACKING' | 'ENGAGEMENT' | 'AUTRE'
  id_frais: string | null
  frais_libelle: string | null
  libelle: string | null
  nom_fichier: string
  type_mime: string
  taille_octets: number
  nb_pages: number | null
  date_depot: string
  depose_par: string | null
  numero_facture: string | null
}

export const NATURE_PIECE: Record<Piece['nature'], string> = {
  FACTURE_FOURNISSEUR: 'Facture fournisseur',
  DUM: 'DUM (declaration)',
  QUITTANCE_DOUANE: 'Quittance de la douane',
  LIQUIDATION: 'Fiche de liquidation',
  FACTURE_FRAIS: 'Facture de frais',
  BL: 'Connaissement / BL',
  PACKING: 'Liste de colisage',
  ENGAGEMENT: "Engagement d'importation",
  AUTRE: 'Autre document',
}

/**
 * Un document que le dossier devrait porter, et ce qu'il en manque. Calculé par
 * le serveur : l'assistant répond aux mêmes questions que cet écran, et la
 * règle ne peut pas vivre en deux endroits.
 */
export interface PieceAttendue {
  nature: Piece['nature']
  libelle: string
  /** Combien il en faut — un dossier à trois factures en attend trois. */
  combien: number
  deposees: number
  manque: number
}

export interface DossierComplet {
  dossier: Dossier
  factures: Facture[]
  lignes: Ligne[]
  frais: Frais[]
  repartition: Allocation[]
  pieces: Piece[]
  attendues: PieceAttendue[]
  ajustements: Ajustement[]
  engagements?: Engagement[]
}

/** Un engagement d'importation (EI) ouvert en banque, cite par la DUM. */
export interface Engagement {
  id_engagement: string
  numero_ei: string
  banque: string | null
  date_ei: string | null
  quantite_kg: number | null
  montant_devise: number | null
  code_devise: string | null
}

/**
 * Un type de frais du catalogue. Il dit la pièce qui le justifie, s'il est
 * récupérable (la TVA), s'il est commun au dossier ou affecté à des lignes, et
 * comment il se répartit. Il s'administre dans Référentiels → Types de frais.
 */
export interface ParametreFrais {
  id_frais: string
  libelle: string
  categorie: string
  piece_justificative: string | null
  recuperable: number
  commun: number
  methode_repartition: 'VALEUR' | 'POIDS' | 'QUANTITE' | 'PARTS_EGALES'
  inclus_dans_cout: number
  actif: number
}

export const METHODE_REPARTITION: Record<ParametreFrais['methode_repartition'], string> = {
  VALEUR: 'À la valeur',
  POIDS: 'Au poids',
  QUANTITE: 'À la quantité',
  PARTS_EGALES: 'À parts égales',
}

export const LIBELLE_STATUT: Record<StatutDossier, string> = {
  BROUILLON: 'Brouillon',
  EN_COURS: 'En cours',
  CLOTURE: 'Clôturé',
}

export const TON_STATUT: Record<StatutDossier, 'neutre' | 'info' | 'succes'> = {
  BROUILLON: 'neutre',
  EN_COURS: 'info',
  CLOTURE: 'succes',
}

export const LIBELLE_RECEPTION: Record<Facture['statut_reception'], string> = {
  NON_RECUE: 'Non reçue',
  PARTIELLE: 'Partielle',
  RECUE: 'Reçue',
}

export const TON_RECEPTION: Record<Facture['statut_reception'], 'neutre' | 'alerte' | 'succes'> = {
  NON_RECUE: 'neutre',
  PARTIELLE: 'alerte',
  RECUE: 'succes',
}

export const UNITE: Record<Ligne['unite'], string> = { kg: 'kg', ml: 'm', piece: 'pce' }
