/**
 * Le noyau du module machines : les formes, les appels, et le calcul.
 *
 * TOUT CE QUI EST ICI EST PARTAGE PAR LES DEUX INTERFACES. Le bureau et le
 * telephone sont deux ecrans differents — pas deux mises en page du meme —
 * mais ils lisent les memes donnees et font le meme calcul. Le jour ou la
 * formule de consommation changera, elle changera ici et nulle part ailleurs.
 */
import { api } from '../../api/client'

/* DECLAREE TOUT EN HAUT, avant les calculs qui l’appellent.
   Elle vivait dans la section « formatage », en bas du fichier : `const`
   n’etant pas remonte, elle ne tenait que parce que ses appelants sont des
   fonctions, executees plus tard. C’est exactement le montage qui a laisse
   une page blanche le 25/09 des qu’un appel s’est produit plus tot. */
export const arrondi = (v: number) => Math.round(v * 10000) / 10000

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

/**
 * Une ligne du contenu d'une machine : la zone, et ce qui est monte dessus.
 *
 * LES ZONES VIDES Y FIGURENT, avec une reference nulle. Un etage sans fil est
 * une information — c'est la qu'il faut charger — et le retirer donnerait un
 * metier qui parait plein alors qu'il ne l'est pas.
 */
export interface LigneContenu {
  code_emplacement: string
  zone_libelle: string
  role: string
  numero_etage: number
  capacite_bobines: number
  code_reference: string | null
  designation: string | null
  couleur: string | null
  lot_fournisseur: string | null
  nb_bobines: number | null
  pourcentage: number | null
  kg: number | null
  date_constat: string | null
  [k: string]: unknown
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
/**
 * Une ligne telle qu'elle part au serveur.
 *
 * `lot_force` n'est pose que si l'operateur a confirme apres un refus : c'est
 * une reponse a une question, jamais une valeur par defaut.
 */
export interface LigneEnvoi {
  code_reference: string
  lot_fournisseur: string
  lot_force?: boolean
  motif_lot_force?: string
  [k: string]: unknown
}

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
  /**
   * Le poids d'une bobine au catalogue, garde a cote de `poids_unitaire` pour
   * montrer la divergence pendant la saisie. Il ne part PAS au serveur : c'est
   * un rappel, pas une donnee de la fiche. Nul si le catalogue n'en porte pas.
   */
  poids_catalogue?: number | null
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

/**
 * LA DIVERGENCE DE POIDS PAR BOBINE, en % du catalogue.
 *
 * Positive quand la bobine saisie est plus lourde que le catalogue. Nulle —
 * et non zero — quand il n'y a rien a comparer : pas de poids catalogue, ou
 * pas encore de poids saisi. La couleur se lit ensuite avec `couleurEcart` et
 * les tolerances des reglages, jamais avec des seuils codes ici.
 */
export function ecartPoidsBobine(l: Pick<LigneSaisie, 'poids_unitaire' | 'poids_catalogue'>): number | null {
  const cat = l.poids_catalogue
  if (cat == null || !(cat > 0) || !(l.poids_unitaire > 0)) return null
  return ((l.poids_unitaire - cat) / cat) * 100
}

/** La classe de texte d'une couleur d'ecart (vert, orange, rouge). */
export const CLASSE_ECART = { vert: 'text-succes', orange: 'text-alerte', rouge: 'text-danger' } as const

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
  /** TOUT ce que la machine porte, zone par zone, en un seul appel. */
  contenu: (code: string) =>
    api.get<LigneContenu[]>(`/api/machines/${encodeURIComponent(code)}/contenu`),
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
  /** `corriger` : charger malgre un stock insuffisant, en tracant la correction. */
  valider: (id: string, corriger = false) =>
    api.post<{ consomme_kg: number; mouvement: string | null; correction?: string | null }>(
      `/api/machines/fiches/${id}/valider${corriger ? '?corriger=1' : ''}`,
      {},
    ),
  remplacerFiche: (id: string, corps: unknown) => api.put(`/api/machines/fiches/${id}`, corps),
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


export const nb = (v: number | null | undefined, d = 2) =>
  v == null || Number.isNaN(v)
    ? '—'
    : v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })

/** Un ecart en %, signe : « +1,54 % », « -0,80 % ». */
export const signePct = (pct: number) => `${pct > 0 ? '+' : ''}${nb(pct, 2)} %`

/**
 * Le rappel catalogue d'une ligne, tel qu'il s'affiche sous le poids saisi :
 * « cat. 2,600 · +1,54 % ». Nul s'il n'y a pas de poids catalogue.
 */
export function rappelCatalogue(l: Pick<LigneSaisie, 'poids_unitaire' | 'poids_catalogue'>): string | null {
  const cat = l.poids_catalogue
  if (cat == null || !(cat > 0)) return null
  const pct = ecartPoidsBobine(l)
  return pct == null ? `cat. ${nb(cat, 3)}` : `cat. ${nb(cat, 3)} · ${signePct(pct)}`
}

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
    poids_catalogue: e.poids_catalogue_kg,
    pourcentage: e.pourcentage ?? 100,
    mode: 'ESTIMATION',
    pese_kg: e.kg,
    avant_bobines: e.nb_bobines,
    avant_pourcentage: e.pourcentage,
    avant_kg: e.kg,
    avant_date: e.date_constat,
  }
}

/**
 * Une ligne neuve, pour une reference qui n'etait pas sur la zone.
 *
 * Le poids propose vient du catalogue : sauf avis contraire, c'est donc aussi
 * le poids catalogue de reference — l'ecart part de zero et ne bouge que si
 * l'operateur corrige le poids de la bobine.
 */
export function ligneNeuve(
  code_reference: string,
  designation: string,
  poids_unitaire: number,
  poids_catalogue?: number | null,
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
    poids_catalogue: poids_catalogue !== undefined ? poids_catalogue : poids_unitaire || null,
    pourcentage: 100,
    mode: 'ESTIMATION',
    pese_kg: 0,
    avant_bobines: 0,
    avant_pourcentage: null,
    avant_kg: 0,
    avant_date: null,
  }
}
