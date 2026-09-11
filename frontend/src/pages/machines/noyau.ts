/**
 * Le noyau du module machines : les formes, les appels, et le calcul.
 *
 * TOUT CE QUI EST ICI EST PARTAGE PAR LES DEUX INTERFACES. Le bureau et le
 * telephone sont deux ecrans differents — pas deux mises en page du meme —
 * mais ils lisent les memes donnees et font le meme calcul. Le jour ou la
 * formule de consommation changera, elle changera ici et nulle part ailleurs.
 */
import { api } from '../../api/client'

// =============================================================================
// LES FORMES
// =============================================================================

export interface Machine {
  code_machine: string
  nom: string
  capacite_bobines: number
  nb_etages: number
  bobines_presentes: number
  quantite_kg: number
  nb_zones: number
  dernier_constat: string | null
  actif: number
  /** ACTIVE, PANNE, SOMMEIL ou RETIREE. */
  etat: string
  motif_etat: string | null
  date_etat: string | null
}

export interface Zone {
  code_emplacement: string
  code_machine: string
  role: 'ETAGE' | 'CHAINE' | 'TRAME' | 'RESERVE'
  numero_etage: number
  libelle: string
  capacite_bobines: number
  bobines_presentes: number
  quantite_kg: number
  nb_lots: number
  dernier_constat: string | null
}

/** Une ligne du constat courant d'une zone. */
export interface LigneEtat {
  code_reference: string
  designation: string
  lot_fournisseur: string
  nb_bobines: number
  nb_palettes: number | null
  poids_unitaire_kg: number | null
  pourcentage: number | null
  kg: number
  mode_constat: string
  date_constat: string
  responsable: string | null
  poids_catalogue_kg: number | null
}

export type TypeFiche = 'CHARGE' | 'DECHARGE' | 'MAJ' | 'CONSO'
export type StatutFiche = 'BROUILLON' | 'VALIDE' | 'ANNULE'

export interface Fiche {
  id_fiche: string
  numero_fiche: string
  type_fiche: TypeFiche
  statut: StatutFiche
  code_machine: string
  machine_nom: string
  code_emplacement: string
  zone: string
  date_fiche: string
  date_constat_precedent: string | null
  code_magasin: string | null
  nb_bobines_etage: number | null
  numero_of: string | null
  responsable: string
  observations: string | null
  nb_lignes: number
  date_validation: string | null
  motif_annulation: string | null
}

export interface LigneConso {
  code_machine: string
  machine_nom: string
  zone: string
  code_reference: string
  designation: string
  lot_fournisseur: string
  date_debut: string | null
  kg_debut: number
  kg_charge: number
  kg_retourne: number
  date_fin: string | null
  kg_fin: number
  consommation_kg: number
}

/** Une ligne en cours de saisie. */
export interface LigneSaisie {
  cle: string
  code_reference: string
  designation: string
  lot_fournisseur: string
  /** Ce qui monte ou descend : ne sert qu'a debiter ou crediter le magasin. */
  mouvementees: number
  /** Ce que la zone porte de cette reference APRES : c'est lui qui fait l'etat. */
  presentes: number
  /** Vrai des que l'operateur a saisi `presentes` lui-meme : on n'y touche plus. */
  presentes_forcees?: boolean
  nb_palettes: number | null
  poids_unitaire: number
  pourcentage: number
  mode: 'ESTIMATION' | 'PESEE'
  /** En pesee, c'est l'operateur qui le donne ; en estimation, il se calcule. */
  pese_kg: number
  /** L'etat d'avant, garde pour montrer l'ecart au moment de la saisie. */
  avant_bobines: number
  avant_pourcentage: number | null
  avant_kg: number
  avant_date: string | null
}

// =============================================================================
// LE CALCUL — la seule copie
// =============================================================================

/** L'etat constate d'une ligne : bobines presentes x poids unitaire x %. */
export function etatKg(l: LigneSaisie): number {
  return l.mode === 'PESEE'
    ? l.pese_kg
    : l.presentes * l.poids_unitaire * (l.pourcentage / 100)
}

/** Ce qui monte ou descend, en kilos. Les bobines chargees sont pleines. */
export function mouvementeKg(l: LigneSaisie): number {
  return l.mouvementees * l.poids_unitaire
}

/* LA CONSOMMATION NE SE CALCULE PLUS ICI, ET C'EST VOULU.
 *
 * Personne ne sait quel chargement a ete tisse quand : l'attribuer fiche par
 * fiche serait une invention. Elle se lit en CUMUL, entre deux cliches —
 *
 *     consommation = cliche d'ouverture + charges - retours - cliche de cloture
 *
 * — et c'est le serveur qui la produit, sur `/api/machines/consommation`.
 */

// =============================================================================
// LES APPELS
// =============================================================================

export const machinesApi = {
  liste: () => api.get<Machine[]>('/api/machines'),
  plan: (code: string) => api.get<Zone[]>(`/api/machines/${encodeURIComponent(code)}`),
  etat: (code: string, zone: string) =>
    api.get<LigneEtat[]>(
      `/api/machines/${encodeURIComponent(code)}/zones/${encodeURIComponent(zone)}`,
    ),
  fiches: (code?: string) =>
    api.get<Fiche[]>(`/api/machines/fiches${code ? `?code_machine=${encodeURIComponent(code)}` : ''}`),
  consommation: (code?: string) =>
    api.get<LigneConso[]>(
      `/api/machines/consommation${code ? `?code_machine=${encodeURIComponent(code)}` : ''}`,
    ),
  creerFiche: (corps: unknown) =>
    api.post<{ id_fiche: string; numero_fiche: string }>('/api/machines/fiches', corps),
  valider: (id: string) =>
    api.post<{ consomme_kg: number; mouvement: string | null }>(
      `/api/machines/fiches/${id}/valider`,
      {},
    ),
  annuler: (id: string, motif: string) =>
    api.post(`/api/machines/fiches/${id}/annuler`, { motif }),

  /* LE PARC MACHINE EST DU PARAMETRAGE, pas de la saisie quotidienne : ces deux
     appels exigent PARAMETRES/ECRIRE, donc la direction ou un super-utilisateur.
     Une capacite fausse fausserait toute la consommation qui en decoule. */
  declarer: (corps: MachineSaisie) =>
    api.post<{ code_machine: string; capacite_bobines: number }>('/api/machines', corps),
  corriger: (code: string, corps: MachineSaisie) =>
    api.put<{ code_machine: string; capacite_bobines: number }>(
      `/api/machines/${encodeURIComponent(code)}`,
      corps,
    ),
}

export type RoleZone = 'ETAGE' | 'CHAINE' | 'TRAME' | 'RESERVE'

export interface ZoneSaisie {
  role: RoleZone
  numero_etage?: number | null
  capacite_bobines: number
}

export interface MachineSaisie {
  code_machine?: string
  nom: string
  notes?: string | null
  zones: ZoneSaisie[]
}

export const LIBELLE_ROLE: Record<RoleZone, string> = {
  ETAGE: 'Étage',
  CHAINE: 'Fil de chaîne',
  TRAME: 'Trame',
  RESERVE: 'Réserve',
}

/** Le corps attendu par l'API, construit depuis les lignes saisies. */
export function corpsFiche(
  type: TypeFiche,
  machine: string,
  zone: string,
  entete: { date: string; magasin: string; responsable: string; of: string; bobinesEtage: number; observations: string },
  lignes: LigneSaisie[],
) {
  return {
    type_fiche: type,
    code_machine: machine,
    code_emplacement: zone,
    date_fiche: entete.date,
    code_magasin: entete.magasin || null,
    nb_bobines_etage: entete.bobinesEtage || null,
    numero_of: entete.of || null,
    responsable: entete.responsable,
    observations: entete.observations || null,
    lignes: lignes.map((l) => ({
      code_reference: l.code_reference,
      lot_fournisseur: l.lot_fournisseur,
      nb_bobines_mouvementees: l.mouvementees || null,
      kg_mouvementes: l.mouvementees ? arrondi(mouvementeKg(l)) : null,
      nb_palettes: l.nb_palettes,
      nb_bobines_presentes: l.presentes,
      poids_unitaire_kg: l.poids_unitaire || null,
      pourcentage: l.mode === 'ESTIMATION' ? l.pourcentage : null,
      total_kg: arrondi(etatKg(l)),
      mode_constat: l.mode,
    })),
  }
}

// =============================================================================
// LE FORMATAGE
// =============================================================================

export const arrondi = (v: number) => Math.round(v * 10000) / 10000

export const nb = (v: number | null | undefined, d = 2) =>
  v == null || Number.isNaN(v)
    ? '—'
    : v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const [a, m, j] = String(d).slice(0, 10).split('-')
  return j ? `${j}/${m}/${a}` : String(d)
}

export const LIBELLE_TYPE: Record<TypeFiche, string> = {
  CHARGE: 'Chargement',
  DECHARGE: 'Déchargement',
  MAJ: 'Mise à jour',
  CONSO: 'Consommation',
}

/** Une ligne de saisie amorcee depuis le constat courant. */
export function depuisEtat(e: LigneEtat): LigneSaisie {
  return {
    cle: `${e.code_reference}${e.lot_fournisseur}`,
    code_reference: e.code_reference,
    designation: e.designation,
    lot_fournisseur: e.lot_fournisseur,
    mouvementees: 0,
    presentes: e.nb_bobines,
    nb_palettes: e.nb_palettes,
    poids_unitaire: e.poids_unitaire_kg ?? e.poids_catalogue_kg ?? 0,
    pourcentage: e.pourcentage ?? 100,
    mode: 'ESTIMATION',
    pese_kg: e.kg,
    avant_bobines: e.nb_bobines,
    avant_pourcentage: e.pourcentage,
    avant_kg: e.kg,
    avant_date: e.date_constat,
  }
}

/** Une ligne neuve, pour une reference qui n'etait pas sur la zone. */
export function ligneNeuve(
  code_reference: string,
  designation: string,
  poids_unitaire: number,
): LigneSaisie {
  return {
    cle: `${code_reference}`,
    code_reference,
    designation,
    lot_fournisseur: '',
    mouvementees: 0,
    presentes: 0,
    nb_palettes: null,
    poids_unitaire,
    pourcentage: 100,
    mode: 'ESTIMATION',
    pese_kg: 0,
    avant_bobines: 0,
    avant_pourcentage: null,
    avant_kg: 0,
    avant_date: null,
  }
}
