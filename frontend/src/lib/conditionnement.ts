/**
 * LE CONDITIONNEMENT — palettes, bobines, kilos : trois façons de dire la même
 * chose, et l'on saisit celle qu'on a sous les yeux.
 *
 * Au quai, on compte des palettes. Sur la machine, on compte des bobines. En
 * stock, tout est en kilos. Obliger l'opérateur à convertir de tête, c'est
 * garantir l'erreur — et lui faire saisir les trois séparément, c'est garantir
 * qu'elles se contrediront.
 *
 * ON SAISIT UN DES TROIS, LES DEUX AUTRES SUIVENT. Le champ qu'on vient de
 * taper commande ; les autres se recalculent. Et ils restent **modifiables** :
 * une palette incomplète reste une palette à manutentionner, et c'est
 * l'opérateur qui le sait, pas la formule.
 *
 * LES FACTEURS VIENNENT DE LA RÉFÉRENCE, jamais de l'écran :
 *
 *     kg      = bobines × poids_bobine_kg
 *     bobines = palettes × bobines_par_palette
 *     bobines = lots     × bobines_par_lot
 *
 * LE LOT EST UNE UNITÉ D'ACHAT, pas une unité de manutention. Le fournisseur
 * turc produit par bains — 1344 bobines le plus souvent, parfois 1400, 1688 ou
 * 1720 selon l'article. On commande au lot ; on réceptionne et on range en
 * palettes. C'est pourquoi il entre dans `facteurVersKg` et pas dans le
 * triplet palettes/bobines/kilos, qui décrit ce qu'on manutentionne.
 *
 * Une référence qui ne porte pas ces paramètres ne se convertit pas — et il
 * faut le dire, pas inventer un facteur. Un kilo faux se propage en coût de
 * revient faux.
 */
import { lireNombre } from './nombres.ts'


/** Ce que la référence dit de son conditionnement. */
export interface Conditionnement {
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
  /** Pour les matières comptées au mètre linéaire — bande, plastique. */
  densite_kg_ml?: number | null
  /** Le bain de production du fournisseur, en bobines. Unité d'achat. */
  bobines_par_lot?: number | null
}

/** Les trois expressions d'une même quantité. Nul = non calculable. */
export interface Colisage {
  kg: number | null
  bobines: number | null
  palettes: number | null
}

const VIDE: Colisage = { kg: null, bobines: null, palettes: null }

/** Un nombre utilisable, ou null. Une chaîne vide n'est pas un zéro. */
function nombre(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : (lireNombre(String(v)) ?? 0)
  return Number.isFinite(n) ? n : null
}

/** Les comptes de colis sont entiers : on ne manutentionne pas 3,4 bobines. */
function entier(n: number | null): number | null {
  return n === null ? null : Math.max(0, Math.round(n))
}

/**
 * LES PALETTES S'ARRONDISSENT VERS LE HAUT.
 *
 * Cent bobines qui en font 0,3 de palette occupent quand meme UNE palette dans
 * le camion et dans l'allee. Arrondir au plus proche afficherait « 0 palette »
 * devant une palette bien reelle — et c'est le compte de places qui interesse
 * le cariste, pas la fraction theorique.
 */
function entierHaut(n: number | null): number | null {
  return n === null ? null : Math.max(0, Math.ceil(n - 1e-9))
}

function poids(c: Conditionnement): number | null {
  const p = nombre(c.poids_bobine_kg)
  return p && p > 0 ? p : null
}

function parPalette(c: Conditionnement): number | null {
  const n = nombre(c.bobines_par_palette)
  return n && n > 0 ? n : null
}

/**
 * Le nombre de bobines mène tout : c'est le pivot des deux formules.
 *
 * On passe donc toujours par lui, quel que soit le champ saisi. Convertir
 * directement des palettes vers les kilos marcherait aussi, mais dupliquerait
 * la règle — et une règle écrite deux fois finit par différer.
 */
function depuisBobinesExact(bobines: number | null, c: Conditionnement): Colisage {
  if (bobines === null) return VIDE
  const p = poids(c)
  const pp = parPalette(c)
  return {
    kg: p === null ? null : bobines * p,
    bobines: entier(bobines),
    palettes: pp === null ? null : entierHaut(bobines / pp),
  }
}

/** On a compté des palettes. */
export function depuisPalettes(valeur: unknown, c: Conditionnement): Colisage {
  const n = nombre(valeur)
  const pp = parPalette(c)
  if (n === null) return VIDE
  if (pp === null) return { ...VIDE, palettes: entier(n) }
  const r = depuisBobinesExact(n * pp, c)
  // La palette saisie fait foi : elle ne doit pas revenir arrondie.
  return { ...r, palettes: entier(n) }
}

/** On a compté des bobines. */
export function depuisBobines(valeur: unknown, c: Conditionnement): Colisage {
  const n = nombre(valeur)
  return n === null ? VIDE : depuisBobinesExact(n, c)
}

/** On a pesé des kilos. */
export function depuisKg(valeur: unknown, c: Conditionnement): Colisage {
  const n = nombre(valeur)
  if (n === null) return VIDE
  const p = poids(c)
  if (p === null) return { ...VIDE, kg: n }
  const r = depuisBobinesExact(n / p, c)
  // Le poids pesé fait foi : il ne doit pas revenir arrondi par les bobines.
  return { ...r, kg: n }
}

/**
 * Le facteur d'une unité de manutention vers le kilo, ou null.
 *
 * Il sert aux écrans qui saisissent « une quantité dans une unité » plutôt que
 * les trois colis séparément — le mouvement, le transfert.
 */
export function facteurVersKg(unite: string, c: Conditionnement): number | null {
  switch (unite) {
    case 'kg':
      return 1
    case 'Bobine':
      return poids(c)
    case 'Palette': {
      const p = poids(c)
      const pp = parPalette(c)
      return p !== null && pp !== null ? p * pp : null
    }
    case 'Lot': {
      const p = poids(c)
      const pl = nombre(c.bobines_par_lot)
      return p !== null && pl !== null && pl > 0 ? p * pl : null
    }
    case 'ml': {
      const d = nombre(c.densite_kg_ml)
      return d && d > 0 ? d : null
    }
    default:
      return null
  }
}

/** Le colisage déduit d'une quantité exprimée dans une unité de manutention. */
export function depuisUnite(valeur: unknown, unite: string, c: Conditionnement): Colisage {
  switch (unite) {
    case 'Palette':
      return depuisPalettes(valeur, c)
    case 'Bobine':
      return depuisBobines(valeur, c)
    default: {
      const f = facteurVersKg(unite, c)
      const n = nombre(valeur)
      if (n === null) return VIDE
      return f === null ? { ...VIDE, kg: null } : depuisKg(n * f, c)
    }
  }
}

/** Formate un nombre pour un champ de saisie : vide plutôt que « null ». */
export function pourChamp(n: number | null, decimales = 0): string {
  if (n === null) return ''
  return decimales > 0 ? String(Number(n.toFixed(decimales))) : String(Math.round(n))
}

/**
 * LA QUANTITE TELLE QU'ELLE PART AU SERVEUR, sans perdre un gramme.
 *
 * Le serveur refait les kilos : quantite saisie x facteur. 2 500 kg en
 * palettes de 980 kg font 2,551020… palettes, et 2,551020 x 980 rend
 * 2 499,9996 kg — quatre decigrammes perdus a chaque ligne, cumules dans le
 * stock. Une ligne ne part donc dans son unite que si la traduction est
 * exacte ; sinon elle part en kilos, qui sont ce que l'on a pese.
 *
 * EXACTE A QUATRE DECIMALES, la precision ou la base GARDE la quantite saisie
 * (10/10/2026). Jugee a six, 6 kg partaient en 0,012952 palette, la base gardait
 * 0,0130, qui ne fait plus 6 kg : le retour fournisseur etait refuse par la
 * contrainte de conversion, sans message comprehensible.
 */
export function saisieExacte(
  kg: number,
  unite: string,
  facteur: number | null,
): { unite_saisie: string; quantite_saisie: number } {
  if (!facteur) return { unite_saisie: 'kg', quantite_saisie: kg }
  const q = Number((kg / facteur).toFixed(4))
  const refait = Math.round(q * facteur * 10_000) / 10_000
  return Math.abs(refait - kg) < 0.00005
    ? { unite_saisie: unite, quantite_saisie: q }
    : { unite_saisie: 'kg', quantite_saisie: kg }
}

/** Les seuils du controle de colisage, en % du poids de bobine de la fiche. */
export interface TolerancesColisage {
  alerte: number
  refus: number
}

export interface VerdictColisage {
  /** ok, alerte (a verifier) ou incoherent — jamais bloquant : on signale. */
  niveau: 'ok' | 'alerte' | 'incoherent'
  message: string | null
}

/**
 * KILOS, BOBINES ET PALETTES DOIVENT S'ACCORDER (08/10/2026).
 *
 * 4 032 kg, 1 920 bobines et 20 palettes pour un fil de 2,1 kg la bobine et
 * 336 bobines par palette ne decrivent rien de reel : il faut 6 palettes. Le
 * raisonnement est celui de la base (`fn_controle_colisage`, controle C43) :
 *   * le poids moyen d'une bobine ne s'ecarte pas trop de la fiche ;
 *   * les palettes ne depassent pas le minimum plus une palette entamee, et
 *     aucune ne porte plus que sa capacite.
 * Le verdict SIGNALE ; il ne bloque jamais la saisie.
 */
export function controleColisage(
  kgV: unknown,
  bobinesV: unknown,
  palettesV: unknown,
  c: Conditionnement,
  t: TolerancesColisage,
): VerdictColisage {
  const kg = nombre(kgV)
  const bob = nombre(bobinesV)
  const pal = nombre(palettesV)
  const p = poids(c)
  const pp = parPalette(c)
  let alerte: string | null = null

  if (bob && bob > 0 && p && kg && kg > 0) {
    const reel = kg / bob
    const ecart = ((reel - p) / p) * 100
    const texte = `${Math.round(bob)} bobines pour ${kg.toLocaleString('fr-FR')} kg font ${reel.toFixed(2)} kg par bobine ; la fiche dit ${p.toFixed(2)} kg (${ecart > 0 ? '+' : ''}${ecart.toFixed(0)} %).`
    if (Math.abs(ecart) > t.refus) return { niveau: 'incoherent', message: texte }
    if (Math.abs(ecart) > t.alerte) alerte = texte
  }

  const beff = bob && bob > 0 ? bob : p && kg ? kg / p : null
  if (pal && pal > 0 && pp && beff && beff > 0) {
    const min = Math.ceil(beff / pp - 1e-6)
    if (pal > min + 1) {
      return {
        niveau: 'incoherent',
        message: `${Math.round(pal)} palettes pour ${Math.round(beff)} bobines : à ${pp} bobines par palette il en faut ${min} (${min + 1} avec une palette entamée). Des colis ont-ils été saisis comme palettes ?`,
      }
    }
    if (beff / pal > pp * (1 + t.refus / 100)) {
      return {
        niveau: 'incoherent',
        message: `${Math.round(beff)} bobines sur ${Math.round(pal)} palette(s), soit ${Math.round(beff / pal)} par palette ; une palette en porte ${pp}. Il en faut au moins ${min}.`,
      }
    }
  }
  return alerte ? { niveau: 'alerte', message: alerte } : { niveau: 'ok', message: null }
}
