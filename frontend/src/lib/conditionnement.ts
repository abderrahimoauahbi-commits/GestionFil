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
 *
 * Une référence qui ne porte pas ces paramètres ne se convertit pas — et il
 * faut le dire, pas inventer un facteur. Un kilo faux se propage en coût de
 * revient faux.
 */

/** Ce que la référence dit de son conditionnement. */
export interface Conditionnement {
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
  /** Pour les matières comptées au mètre linéaire — bande, plastique. */
  densite_kg_ml?: number | null
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
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
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
