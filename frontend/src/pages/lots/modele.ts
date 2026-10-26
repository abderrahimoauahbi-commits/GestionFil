/**
 * LES LOTS — le modele partage par la liste, la fiche et les autorisations :
 * les champs exacts des vues serveur, les libelles d'ecran, les formats et les
 * gestes qui ne demandent pas de dialogue.
 *
 * Les libelles vivent ici, une fois : la liste et la fiche ne doivent pas
 * appeler la meme chose de deux noms.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api, ErreurApi } from '../../api/client'
import { libelleLot } from '../../lib/lots'

export const MODULE = 'STOCK'
/** Les decisions sur un lot (derogation, blocage, dormant) : regle 5. */
export const MODULE_DECISION = 'LOTS'

// ============================================================================
// Types — les champs exacts de `v_lot`, `v_lot_vie` et `demande_autorisation`
// ============================================================================

export interface Lot extends Record<string, unknown> {
  code_reference: string
  designation: string | null
  code_categorie: string | null
  lot_fournisseur: string
  origine: string
  code_fournisseur: string | null
  fournisseur_nom: string | null
  statut: 'LIBRE' | 'BLOQUE' | 'SOLDE'
  categorie: 'PROJET' | 'RESTES'
  /** Le type de lot de l'article : d'ou vient le numero a l'entree. */
  type_lot?: 'OBLIGATOIRE' | 'GENERIQUE' | 'INDIFFERENT' | null
  /** La fiche article permet-elle de fusionner ses lots ? */
  fusion_autorisee?: boolean | null
  fusionne_dans: string | null
  date_creation: string | null
  date_derniere_activite: string | null
  solde_kg: number | null
  solde_bobines: number | null
  /** Le seuil Projet / Restes dans l'unite ou il est pose (un etage = 1 344 bobines). */
  seuil_valeur: number | null
  seuil_unite: 'kg' | 'Bobine' | 'Palette' | null
  seuil_bobines: number | null
  /** Le meme seuil traduit en kilos. */
  seuil_restes_kg: number | null
  jours_sans_activite: number | null
  dormant: boolean | null
  a_basculer: boolean | null
  ecart_cumule_kg: number | null
  ecart_cumule_pct: number | null
  poids_reel_moyen_bobine_kg: number | null
  poids_catalogue_bobine_kg: number | null
  alerte_derive: 'VERT' | 'ORANGE' | 'ROUGE' | null
  /** Absent quand la grille de droits masque les montants. */
  valeur_mad?: number | null
  /** LE CONDITIONNEMENT DU LOT (23/10/2026) : ce qui convertit ses palettes, bobines et kilos. */
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
  /** RECEPTION, HISTORIQUE, MOUVEMENT, FICHE_ARTICLE ou CORRECTION. */
  origine_poids_bobine?: string | null
  origine_bobines_palette?: string | null
  date_conditionnement?: string | null
  bobines_par_palette_catalogue?: number | null
}

export interface Compteurs {
  comptable: number
  projet: number
  restes: number
  a_basculer: number
  dormants: number
  bloques: number
  derive: number
  autorisations: number
}

export interface Demande extends Record<string, unknown> {
  id_demande: string
  type_demande: string
  niveau: 'ORANGE' | 'ROUGE'
  statut: 'EN_ATTENTE' | 'ACCORDEE' | 'REFUSEE' | 'ANNULEE'
  code_reference: string | null
  lot_fournisseur: string | null
  document: string | null
  details: unknown
  motif: string
  id_demandeur: string
  date_demande: string
  id_decideur: string | null
  date_decision: string | null
  motif_decision: string | null
  demandeur: string | null
  decideur: string | null
  /** Les kilos que couvre une derogation de lot bloque (F17), et ceux employes. */
  kg_autorises?: number | string | null
  kg_consommes?: number | string | null
  date_consommation?: string | null
}

// ============================================================================
// Libelles
// ============================================================================

export const ORIGINES: Record<string, string> = {
  FOURNISSEUR: 'Fournisseur',
  GENERE: 'Numéro attribué',
  RETOUR: 'Retour',
  FUSION: 'Fusion',
  SANS_LOT: 'Sans lot',
}

export const EVENEMENTS: Record<string, string> = {
  BLOCAGE: 'Blocage qualité',
  DEBLOCAGE: 'Déblocage',
  BASCULEMENT_RESTES: 'Passage en Restes',
  RETOUR_PROJET: 'Retour en Projet',
  FUSION: 'Fusion',
  DECISION_DORMANT: 'Décision sur lot dormant',
  DEROGATION: 'Dérogation accordée',
  SOLDE: 'Lot soldé',
}

export const TYPES_DEMANDE: Record<string, string> = {
  ECART_POIDS: 'Écart de poids',
  MELANGE_FOURNISSEURS: 'Mélange de fournisseurs',
  LOT_BLOQUE: 'Lot bloqué',
  RESTES_PRODUCTION: 'Restes en production',
  RETOUR_PRINCIPAL: 'Retour au magasin principal',
  DORMANT: 'Lot dormant',
  FUSION: 'Fusion de lots',
  STOCK_INSUFFISANT: 'Stock insuffisant',
}

export const STATUTS_DEMANDE: Record<string, { libelle: string; ton: 'alerte' | 'succes' | 'danger' | 'neutre' }> = {
  EN_ATTENTE: { libelle: 'En attente', ton: 'alerte' },
  ACCORDEE: { libelle: 'Accordée', ton: 'succes' },
  REFUSEE: { libelle: 'Refusée', ton: 'danger' },
  ANNULEE: { libelle: 'Annulée', ton: 'neutre' },
}

/** Un nombre a la francaise ; le tiret dit « on ne sait pas », pas « zero ». */
export const nb = (v: unknown, d = 0) =>
  typeof v === 'number' && Number.isFinite(v)
    ? v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })
    : '—'

/**
 * LE SEUIL PROJET / RESTES dans l'unite ou l'atelier le compte : « 1 344 bob. »
 * (un etage de machine), et sa traduction en kilos quand on la demande.
 */
export function libelleSeuil(
  l: { seuil_valeur?: number | null; seuil_unite?: string | null; seuil_restes_kg?: number | null },
  avecKg = false,
): string {
  if (l.seuil_valeur == null) return l.seuil_restes_kg == null ? '—' : `${nb(l.seuil_restes_kg)} kg`
  const u = l.seuil_unite === 'Bobine' ? 'bob.' : l.seuil_unite === 'Palette' ? 'pal.' : 'kg'
  const base = `${nb(l.seuil_valeur)} ${u}`
  return avecKg && l.seuil_unite !== 'kg' && l.seuil_restes_kg != null
    ? `${base} (≈ ${nb(l.seuil_restes_kg)} kg)`
    : base
}

/**
 * UN ARTICLE GERE AU KILO — le jute, la colle — n'a pas de poids de bobine au
 * catalogue : ses bobines ne se comptent pas, et l'ecart de poids par bobine
 * n'a pas de sens. On le dit, au lieu d'afficher des tirets et des zeros.
 */
export const gereAuKilo = (l: { poids_catalogue_bobine_kg?: number | null; solde_bobines?: number | null }) =>
  !(Number(l.poids_catalogue_bobine_kg) > 0) && !(Number(l.solde_bobines) > 0)

/** La designation n'apporte rien quand elle repete le code. */
export const designationUtile = (l: { code_reference: string; designation?: string | null }) =>
  l.designation && l.designation.trim() !== l.code_reference.trim() ? l.designation : null

/** Un ecart signe : le « + » se lit avant le chiffre. */
export const signe = (v: unknown, d = 1, unite = '') =>
  typeof v === 'number' && Number.isFinite(v) ? `${v > 0 ? '+' : ''}${nb(v, d)}${unite}` : '—'

export const lienFiche = (reference: string, lot: string) =>
  `/lots/fiche?reference=${encodeURIComponent(reference)}&lot=${encodeURIComponent(lot)}`

/** Un message d'erreur lisible, quelle que soit sa forme. */
export const messageErreur = (e: unknown) =>
  e instanceof ErreurApi ? e.message : e instanceof Error ? e.message : String(e)

/** Tout se rafraichit : un lot solde change le stock, le plan d'achat, les etats. */
export function useApresDecision() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries()
}

/** Le basculement en Restes : sans motif, le serveur ecrit celui de la regle. */
export function useBasculerRestes() {
  const apres = useApresDecision()
  return useMutation({
    mutationFn: (l: { code_reference: string; lot_fournisseur: string }) =>
      api.post('/api/lots/basculer', { ...l, categorie: 'RESTES' }),
    onSuccess: async (_r, l) => {
      await apres()
      toast.success(`Lot ${libelleLot(l.lot_fournisseur)} passé en Restes`)
    },
    onError: (e) => toast.error(messageErreur(e)),
  })
}
