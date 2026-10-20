/**
 * Le noyau du module machines : les formes, les appels, et le calcul.
 *
 * TOUT CE QUI EST ICI EST PARTAGE PAR LES DEUX INTERFACES. Le bureau et le
 * telephone sont deux ecrans differents — pas deux mises en page du meme —
 * mais ils lisent les memes donnees et font le meme calcul.
 *
 * LE MODELE DU 05/10/2026 : chaque validation est une DECISION.
 *
 *   etat precedent valide -> constat et decision par ligne Reference + Lot
 *   -> apercu -> validation -> etat resultant
 *
 * L'etat resultant n'est jamais saisi. Le calcul de reference est celui du
 * serveur (route d'apercu) ; celui d'ici n'est qu'une estimation immediate,
 * pendant qu'on tape, avec les memes formules.
 */
import { api } from '../../api/client'

/* DECLAREE TOUT EN HAUT, avant les calculs qui l’appellent (page blanche du
   25/09 : une `const` lue avant sa declaration). */
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
  /** La version lue (verrou optimiste, groupe 3, 20/10/2026). */
  version: number
}

/**
 * Une ligne du contenu d'une machine : la zone, et ce qui est monte dessus.
 * LES ZONES VIDES Y FIGURENT, avec une reference nulle : c'est la qu'il faut
 * charger.
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

/** Une ligne de l'etat courant d'une zone. */
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

/** CONSO reste lisible pour les anciennes fiches ; on n'en cree plus. */
export type TypeFiche = 'CHARGE' | 'DECHARGE' | 'MAJ' | 'CONSO'
export type StatutFiche = 'BROUILLON' | 'VALIDE' | 'ANNULE'
export type Destination = 'MAGASIN' | 'PERTE' | 'DECHET' | 'CASSE'

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
  code_magasin: string | null
  numero_of: string | null
  responsable: string
  observations: string | null
  nb_lignes: number
  date_validation: string | null
  motif_annulation: string | null
  /** 1 : la fiche porte la derniere decision de son etage — la seule qui se retire seule. */
  est_tete?: number
  valide_par?: string | null
}

/** La matrice des motifs (validee le 05/10/2026). */
export interface Motif {
  code_motif: string
  type_fiche: 'CHARGE' | 'DECHARGE' | 'MAJ'
  libelle: string
  /** Liste separee par des virgules ; vide hors dechargement. */
  destinations: string
  /** Effet de l'ecart ; vide = au choix parmi `effets_permis`. */
  effet_defaut: string | null
  effets_permis: string
  ordre: number
}

/** Une ligne calculee par le serveur : ce que la decision enregistrera. */
export interface LigneCalculee {
  ligne_numero: number
  code_reference: string
  lot_fournisseur: string
  poids_nominal_kg: number
  nb_avant: number
  kg_avant: number
  nb_mouvementees: number
  poids_retenu_kg: number | null
  pct_retirees: number | null
  kg_mouvementes: number
  destination: Destination | null
  nb_apres: number
  pourcentage_apres: number | null
  kg_apres: number
  pourcentage_theorique: number | null
  ecart_kg: number
  /** VERT, ORANGE, ROUGE (regle 1) ou AUCUN. */
  niveau_ecart?: 'AUCUN' | 'VERT' | 'ORANGE' | 'ROUGE'
  effet_ecart: string
  code_motif: string
  motif_texte: string | null
}

/** La couleur d'un niveau d'ecart machine, en classes de theme. */
export const TON_ECART: Record<string, string> = {
  VERT: 'text-succes',
  ORANGE: 'text-alerte',
  ROUGE: 'text-danger',
}

export interface Apercu {
  lignes: LigneCalculee[]
  capacite: number
  bobines_apres: number
  blocages: string[]
  /** Les lots bloques qu'une derogation debloquerait (audit v4). */
  derogations?: import('./Derogation').DerogationPossible[]
}

export interface LigneConso {
  code_machine: string
  machine_nom: string
  zone: string
  code_emplacement: string
  code_reference: string
  designation: string
  lot_fournisseur: string
  date_debut: string | null
  kg_debut: number
  kg_charge: number
  kg_retourne: number
  kg_sorti_autre: number
  date_fin: string | null
  kg_fin: number
  consommation_kg: number
  dechet_perte_casse_kg: number
  non_qualifie_kg: number
  regularisation_kg: number
  erreur_saisie_kg: number
}

/** Le detail d'une fiche : ses lignes, ses decisions, son journal. */
export interface FicheDetail {
  entete: Fiche & { nb_validations: number; capacite_bobines: number; date_creation?: string | null }
  lignes: (LigneEnvoi & { designation: string; poids_catalogue_kg: number | null })[]
  decisions: {
    numero_validation: number
    statut: 'ACTIVE' | 'RETIREE' | 'ANNULEE'
    est_tete: number
    date_decision: string
    code_emplacement: string
    auteur: string | null
    date_retrait: string | null
    motif_retrait: string | null
    auteur_retrait: string | null
  }[]
  lignes_decision: (LigneCalculee & { designation: string; motif: string })[]
  etats: { moment: 'AVANT' | 'APRES'; code_reference: string; designation: string; lot_fournisseur: string
           nb_bobines: number; pourcentage: number | null; kg: number }[]
  journal: { evenement: string; horodatage: string; code_emplacement: string | null; motif: string | null
             auteur: string | null; detail: string | null }[]
}

/** Une ligne telle qu'elle part au serveur. */
export interface LigneEnvoi {
  code_reference: string
  lot_fournisseur: string
  nb_bobines_mouvementees?: number | null
  poids_retenu_kg?: number | null
  pct_retirees?: number | null
  destination?: string | null
  pourcentage?: number | null
  nb_bobines_presentes?: number
  code_motif?: string | null
  motif_texte?: string | null
  effet_ecart?: string | null
  /** Pose seulement apres un refus R02-LOT confirme par l'operateur. */
  lot_force?: boolean
  motif_lot_force?: string
  [k: string]: unknown
}

/** Une ligne en cours de saisie. */
export interface LigneSaisie {
  cle: string
  code_reference: string
  designation: string
  lot_fournisseur: string
  /** Chargement : a charger. Dechargement : a retirer. */
  mouvementees: number
  /** Constat : le nombre present. */
  presentes: number
  /** Le poids NOMINAL de la reference : la base du %. */
  poids_unitaire: number
  poids_catalogue?: number | null
  /** Chargement : le poids retenu par bobine chargee (nominal propose). */
  poids_retenu: number
  /** Chargement : % de TOUTE la ligne apres. Dechargement : % des restantes. Constat : %. */
  pourcentage: number
  /** Le % a deja ete touche par l'operateur : l'estimation ne le remplace plus. */
  pourcentage_saisi?: boolean
  /** Dechargement : % des bobines retirees. */
  pct_retirees: number
  destination: Destination | ''
  code_motif: string
  motif_texte: string
  effet_ecart: string
  /** L'etat d'avant, montre a cote de la saisie. */
  avant_bobines: number
  avant_pourcentage: number | null
  avant_kg: number
  avant_date: string | null
}

// =============================================================================
// LE CALCUL D'ESTIMATION — les formules du serveur, pour l'affichage immediat
// =============================================================================

/** Le % moyen d'une ligne : kg / (bobines x nominal). */
export function pctMoyen(kg: number, bobines: number, nominal: number): number | null {
  return bobines > 0 && nominal > 0 ? Math.round((kg / (bobines * nominal)) * 10000) / 100 : null
}

/**
 * L'ecart que produit a lui seul l'arrondi d'un % saisi au centieme : la moitie
 * d'un centieme de pourcent de la ligne. En dessous, l'ecart est nul (06/10/2026,
 * meme regle que le serveur).
 */
export const toleranceArrondi = (nb: number, nominal: number) => Math.max(0, nb) * nominal * 0.00005 + 0.0005

/** Ce que la ligne deviendra, et l'ecart, selon le type de fiche. */
export function estimer(type: TypeFiche, l: LigneSaisie) {
  const r = estimerBrut(type, l)
  if (r.nbApres > 0 && Math.abs(r.ecart) <= toleranceArrondi(r.nbApres, l.poids_unitaire)) {
    return { ...r, kgApres: r.kgApres + r.ecart, ecart: 0 }
  }
  // Tout retirer au % affiche rend exactement ce que la ligne portait.
  if (r.nbApres === 0 && type === 'DECHARGE' && Math.abs(r.ecart) <= toleranceArrondi(l.avant_bobines, l.poids_unitaire)) {
    return { ...r, kgMouv: r.kgMouv + r.ecart, ecart: 0 }
  }
  return r
}

function estimerBrut(type: TypeFiche, l: LigneSaisie) {
  // REGLE 2 : une ligne qui ARRIVE sur l'etage prend pour nominal le poids
  // declare au chargement — comme le serveur. Estimer au catalogue proposait
  // un % faux, et l'apercu levait un ecart rouge qui n'existait pas.
  const nom = type === 'CHARGE' && l.avant_bobines === 0 && l.poids_retenu > 0 ? l.poids_retenu : l.poids_unitaire
  if (type === 'CHARGE') {
    const kgMouv = l.mouvementees * (l.poids_retenu || nom)
    const nbApres = l.avant_bobines + l.mouvementees
    const kgApres = nbApres * nom * (l.pourcentage / 100)
    return {
      kgMouv, nbApres, kgApres,
      theorique: pctMoyen(l.avant_kg + kgMouv, nbApres, nom),
      ecart: l.avant_kg + kgMouv - kgApres,
    }
  }
  if (type === 'DECHARGE') {
    const kgMouv = l.mouvementees * nom * (l.pct_retirees / 100)
    const nbApres = Math.max(0, l.avant_bobines - l.mouvementees)
    const kgApres = nbApres === 0 ? 0 : nbApres * nom * (l.pourcentage / 100)
    return {
      kgMouv, nbApres, kgApres,
      theorique: pctMoyen(Math.max(0, l.avant_kg - kgMouv), nbApres, nom),
      ecart: l.avant_kg - kgMouv - kgApres,
    }
  }
  const kgApres = l.presentes * nom * (l.pourcentage / 100)
  return { kgMouv: 0, nbApres: l.presentes, kgApres, theorique: pctMoyen(l.avant_kg, l.presentes, nom), ecart: l.avant_kg - kgApres }
}

/**
 * LA DIVERGENCE DE POIDS PAR BOBINE, en % du catalogue. Nulle quand il n'y a
 * rien a comparer. La couleur se lit avec `couleurEcart` et les tolerances.
 */
export function ecartPoidsBobine(l: { poids: number; poids_catalogue?: number | null }): number | null {
  const cat = l.poids_catalogue
  if (cat == null || !(cat > 0) || !(l.poids > 0)) return null
  return ((l.poids - cat) / cat) * 100
}

/** La classe de texte d'une couleur d'ecart (vert, orange, rouge). */
export const CLASSE_ECART = { vert: 'text-succes', orange: 'text-alerte', rouge: 'text-danger' } as const

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
  /** Les fiches d'une machine, ou d'un seul de ses etages. */
  fiches: (code?: string, zone?: string) => {
    const q = new URLSearchParams()
    if (code) q.set('code_machine', code)
    if (zone) q.set('code_emplacement', zone)
    const s = q.toString()
    return api.get<Fiche[]>(`/api/machines/fiches${s ? `?${s}` : ''}`)
  },
  fiche: (id: string) => api.get<FicheDetail>(`/api/machines/fiches/${id}`),
  motifs: () => api.get<Motif[]>('/api/machines/motifs'),
  /** Le journal des mouvements machine : chaque decision ligne par ligne, et son mouvement magasin (F22). */
  mouvements: (code: string, etage?: string) =>
    api.get<LigneMouvementMachine[]>(
      `/api/machines/${encodeURIComponent(code)}/mouvements${etage ? `?etage=${encodeURIComponent(etage)}` : ''}`,
    ),
  /** Avant d'annuler : l'etat auquel l'etage reviendra, les mouvements annules (F22). */
  apercuRetrait: (idFiche: string) =>
    api.get<{
      decision: string | null
      derniere?: boolean
      etat_avant?: { code_reference: string; lot_fournisseur: string; nb_bobines: number; kg: number }[]
      mouvements?: { numero_mouvement: string; code_type_mvt: string; code_magasin: string; kg: number }[]
    }>(`/api/machines/fiches/${idFiche}/retrait-apercu`),
  consommation: (code?: string) =>
    api.get<LigneConso[]>(
      `/api/machines/consommation${code ? `?code_machine=${encodeURIComponent(code)}` : ''}`,
    ),
  creerFiche: (corps: unknown) =>
    api.post<{ id_fiche: string; numero_fiche: string }>('/api/machines/fiches', corps),
  remplacerFiche: (id: string, corps: unknown) => api.put(`/api/machines/fiches/${id}`, corps),
  /** Ce que la validation enregistrera, sans rien ecrire. */
  apercu: (id: string) => api.post<Apercu>(`/api/machines/fiches/${id}/apercu`, {}),
  /** `confirmeOrange` : l'ecran a montre l'ecart orange et l'operateur a confirme. */
  valider: (id: string, confirmeOrange = false) =>
    api.post<{ consomme_kg: number; mouvement: string | null; numero_validation: number
               id_fiche: string; numero_fiche: string }>(
      `/api/machines/fiches/${id}/valider`,
      { confirme_orange: confirmeOrange },
    ),

  /* LE PARC MACHINE EST DU PARAMETRAGE (PARAMETRES/ECRIRE). */
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
  /** Exigee a la correction (verrou optimiste) ; ignoree a la declaration. */
  version?: number
}

export const LIBELLE_ROLE: Record<RoleZone, string> = {
  ETAGE: 'Étage',
  CHAINE: 'Fil de chaîne',
  TRAME: 'Trame',
  RESERVE: 'Réserve',
}

/**
 * LES LIGNES QUI PARTENT. Un chargement ou un dechargement n'envoie que les
 * lignes qu'il mouvemente ; un constat les envoie toutes (une ligne inchangee
 * donne un ecart nul).
 */
export function lignesAEnvoyer(type: TypeFiche, lignes: LigneSaisie[]): LigneSaisie[] {
  return type === 'MAJ' ? lignes : lignes.filter((l) => l.mouvementees > 0)
}

/** Le corps attendu par l'API, construit depuis les lignes saisies. */
export function corpsFiche(
  type: TypeFiche,
  machine: string,
  zone: string,
  entete: { date: string; magasin: string; responsable: string; of: string; observations: string },
  lignes: LigneSaisie[],
) {
  return {
    type_fiche: type,
    code_machine: machine,
    code_emplacement: zone,
    date_fiche: entete.date,
    code_magasin: type === 'MAJ' ? null : entete.magasin || null,
    numero_of: entete.of || null,
    responsable: entete.responsable,
    observations: entete.observations || null,
    lignes: lignesAEnvoyer(type, lignes).map((l): LigneEnvoi => ({
      code_reference: l.code_reference,
      lot_fournisseur: l.lot_fournisseur,
      nb_bobines_mouvementees: type === 'MAJ' ? null : l.mouvementees,
      poids_retenu_kg: type === 'CHARGE' ? l.poids_retenu || null : null,
      pct_retirees: type === 'DECHARGE' ? l.pct_retirees : null,
      destination: type === 'DECHARGE' ? l.destination || null : null,
      pourcentage: type === 'DECHARGE' && l.mouvementees >= l.avant_bobines ? null : l.pourcentage,
      nb_bobines_presentes: type === 'MAJ' ? l.presentes : 0,
      code_motif: l.code_motif || null,
      motif_texte: l.motif_texte.trim() || null,
      effet_ecart: l.effet_ecart || null,
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

/** Le rappel catalogue d'un poids : « cat. 2,600 · +1,54 % ». */
export function rappelCatalogue(l: { poids: number; poids_catalogue?: number | null }): string | null {
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

/** Date et heure, a la minute : « 05/10/2026 16:55 ». */
export function fmtInstant(d: string | null | undefined): string {
  if (!d) return '—'
  const t = new Date(d)
  return Number.isNaN(t.getTime())
    ? fmtDate(d)
    : t.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export const LIBELLE_TYPE: Record<TypeFiche, string> = {
  CHARGE: 'Chargement',
  DECHARGE: 'Déchargement',
  MAJ: 'Constat',
  CONSO: 'Consommation (ancienne fiche)',
}

export const LIBELLE_DESTINATION: Record<Destination, string> = {
  MAGASIN: 'Retour au magasin',
  PERTE: 'Perte',
  DECHET: 'Déchet',
  CASSE: 'Casse',
}

export const LIBELLE_EFFET: Record<string, string> = {
  CONSOMMATION: 'Consommation',
  ERREUR_SAISIE: 'Erreur de saisie (hors consommation)',
  DECHET: 'Déchet',
  PERTE: 'Perte',
  CASSE: 'Casse',
  NON_QUALIFIE: 'Écart non qualifié (à revoir)',
  REGULARISATION: 'Régularisation (constat supérieur)',
  AUCUN: 'Aucun écart',
}

/** Le motif propose par defaut a l'ouverture d'une fiche. */
export const MOTIF_DEFAUT: Record<'CHARGE' | 'DECHARGE' | 'MAJ', string> = {
  CHARGE: 'CH_PRODUCTION',
  DECHARGE: 'DE_CHGT_PROD',
  MAJ: 'MJ_ORDINAIRE',
}

/** La destination imposee par un motif qui n'en admet qu'une. */
export function destinationsDe(m: Motif | undefined): Destination[] {
  return (m?.destinations ?? '').split(',').filter(Boolean) as Destination[]
}

/** Une ligne de saisie amorcee depuis l'etat courant. */
export function depuisEtat(e: LigneEtat, type: TypeFiche): LigneSaisie {
  /* LE POIDS NOMINAL DE L'ETAGE, pas celui du catalogue (06/10/2026) : le
     catalogue change a chaque reception, l'etage garde celui de son chargement. */
  const nominal = e.poids_unitaire_kg ?? e.poids_catalogue_kg ?? 0
  const pct = e.pourcentage ?? 100
  return {
    cle: `${e.code_reference}${e.lot_fournisseur}`,
    code_reference: e.code_reference,
    designation: e.designation,
    lot_fournisseur: e.lot_fournisseur,
    mouvementees: 0,
    presentes: e.nb_bobines,
    poids_unitaire: nominal,
    poids_catalogue: e.poids_catalogue_kg,
    poids_retenu: nominal,
    pourcentage: pct,
    pct_retirees: pct,
    destination: '',
    code_motif: type === 'CONSO' ? '' : MOTIF_DEFAUT[type],
    motif_texte: '',
    effet_ecart: '',
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
  poids_catalogue?: number | null,
): LigneSaisie {
  return {
    cle: `${code_reference}`,
    code_reference,
    designation,
    lot_fournisseur: '',
    mouvementees: 0,
    presentes: 0,
    poids_unitaire,
    poids_catalogue: poids_catalogue !== undefined ? poids_catalogue : poids_unitaire || null,
    poids_retenu: poids_unitaire,
    pourcentage: 100,
    pct_retirees: 100,
    destination: '',
    code_motif: MOTIF_DEFAUT.CHARGE,
    motif_texte: '',
    effet_ecart: '',
    avant_bobines: 0,
    avant_pourcentage: null,
    avant_kg: 0,
    avant_date: null,
  }
}

/** L'adresse de la machine, l'etage choisi en parametre. */
export const cheminMachine = (code: string, zone?: string) =>
  `/machines/${encodeURIComponent(code)}${zone ? `?etage=${encodeURIComponent(zone)}` : ''}`

/** L'adresse d'une decision neuve sur un etage. */
/** Une ligne du journal des mouvements machine (F22, 09/10/2026). */
export interface LigneMouvementMachine {
  id_decision: string
  id_fiche: string | null
  numero_fiche: string | null
  nature: string
  code_emplacement: string
  zone: string | null
  date_decision: string
  statut: string
  est_tete: number
  valide_par: string | null
  ligne_numero: number
  code_reference: string
  lot_fournisseur: string
  kg_avant: number
  nb_mouvementees: number | null
  kg_mouvementes: number | null
  destination: string | null
  kg_apres: number
  ecart_kg: number
  effet_ecart: string | null
  niveau_ecart: string | null
  code_motif: string | null
  motif_texte: string | null
  id_mouvement: string | null
  numero_mouvement: string | null
  id_annulation: string | null
  numero_annulation: string | null
}

export const cheminNouvelleFiche = (code: string, type: TypeFiche, zone: string) =>
  `/machines/${encodeURIComponent(code)}/fiche/${type}/${encodeURIComponent(zone)}`

/** Les raisons d'une consommation au-dela de ce que portait la ligne, a un
    chargement (regle 2, 09/10/2026) — la meme liste que le serveur. */
export const RAISONS_SURPLUS = ['Saisie décalée', 'Oubli de constat précédent', 'Erreur de report']
