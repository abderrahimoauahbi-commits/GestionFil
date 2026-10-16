/** Ce que partagent la liste des retours fournisseur et le document. */

/** Un retour defait une reception : il en suit les droits. */
export const MODULE_RETOURS = 'RECEPTIONS'

export interface RetourListe extends Record<string, unknown> {
  id_retour: string
  numero_retour: string
  statut_retour: 'BROUILLON' | 'VALIDE'
  date_retour: string
  code_fournisseur: string
  fournisseur_nom: string
  motif: string
  saisi_par: string
  valide_par: string | null
  quantite_totale_kg: number
  nb_lignes: number
  /** Masque au magasinier. */
  montant_avoir_mad?: number | null
}

export const LIBELLE_STATUT_RETOUR = { BROUILLON: 'Brouillon', VALIDE: 'Validé' } as const
