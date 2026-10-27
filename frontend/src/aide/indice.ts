/**
 * TROUVER L'INDICE D'UN CHAMP — la route de l'écran, puis l'intitulé du champ.
 *
 * C'est le même chemin que le « ? » : la fiche de l'écran se trouve par la
 * route courante, et dans cette fiche, le champ se trouve par son intitulé TEL
 * QU'IL EST ÉCRIT À L'ÉCRAN. Aucun écran n'a donc à déclarer ses indices : une
 * étiquette dont le texte figure au catalogue reçoit son ⓘ, une étiquette qui
 * n'y figure pas n'affiche rien.
 *
 * L'INTITULÉ SE COMPARE APRÈS NORMALISATION, parce qu'à l'écran il change de
 * costume sans changer de sens : en capitales (les en-têtes de grille), avec
 * l'astérisque d'obligatoire, avec deux-points, avec ou sans accents, avec
 * l'apostrophe typographique ou droite. « Date de réception * : » et
 * « DATE DE RECEPTION » désignent le même champ.
 *
 * MODULE PUR (aucune dépendance à React ni au catalogue) : il se teste sous
 * `node --test` (tests/aide.test.ts) et sert au composant `Indice`.
 */
import type { ChampAide, Sujet } from './types.ts'

/**
 * L'intitulé réduit à ce qui le distingue : minuscules, sans accents, sans
 * astérisque ni deux-points, apostrophes et espaces unifiés.
 */
export function normaliserIntitule(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // les accents
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'") // apostrophes typographiques
    .replace(/[\u00a0\u202f\u2007]/g, ' ') // espaces insécables
    .replace(/\(\s*obligatoire\s*\)/g, ' ')
    .replace(/[*:]/g, ' ') // astérisque d'obligatoire, deux-points
    .replace(/^[\s↳·•–—-]+/, '') // la flèche « ↳ » des rangées complémentaires
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * L'intitulé normalisé, la devise et l'année repliées : « Prix EUR » et
 * « Prix MAD », « Taux USD → MAD » et « Taux EUR → MAD », « Change 2026 » et
 * « Change 2027 » se décrivent une fois au catalogue. DERNIER essai seulement :
 * « Montant MAD » et « Montant EUR » sont deux colonnes d'un même bon.
 */
export function plierVariables(texteNormalise: string): string {
  return texteNormalise
    .replace(/\b(?:mad|dh|eur|usd|gbp|cny|try|chf|jpy|aed|sar|inr)\b/g, '¤')
    .replace(/\b20\d\d\b/g, '#')
}

/**
 * L'intitulé sans sa précision finale entre parenthèses : « Qté (kg) » →
 * « qte ». Second essai seulement, quand l'intitulé exact n'est pas au
 * catalogue — l'unité affichée peut suivre la devise ou le conditionnement.
 */
export function sansPrecision(texteNormalise: string): string {
  return texteNormalise.replace(/\s*\([^()]*\)\s*$/, '').trim()
}

/**
 * Le score d'une route de fiche pour une adresse, ou `null` si elle ne la
 * couvre pas. Une route de fiche couvre l'adresse elle-même et ses
 * sous-adresses ; un segment « :x » accepte n'importe quel segment. Plus la
 * route est PRÉCISE, plus le score est haut : « /receptions/nouvelle » bat
 * « /receptions/:id », qui bat « /receptions ».
 */
export function scoreRoute(route: string, chemin: string): number | null {
  const motif = route.split('?')[0].split('/').filter(Boolean)
  const segments = chemin.split('?')[0].split('#')[0].split('/').filter(Boolean)
  if (motif.length > segments.length) return null
  // La racine (l'accueil) ne couvre qu'elle-même : sinon tout écran sans fiche
  // afficherait l'aide de l'accueil.
  if (motif.length === 0) return segments.length === 0 ? 1 : null
  let score = 1
  for (let i = 0; i < motif.length; i++) {
    if (motif[i].startsWith(':')) score += 2
    else if (motif[i] === decodeURIComponent(segments[i])) score += 3
    else return null
  }
  // À précision égale, la route qui a exactement la longueur de l'adresse gagne.
  if (motif.length === segments.length) score += 1
  return score
}

/** La fiche d'un écran, trouvée par sa route : la plus précise gagne. */
export function sujetDans(sujets: readonly Sujet[], chemin: string): Sujet | undefined {
  let meilleur: Sujet | undefined
  let meilleurScore = -1
  for (const s of sujets) {
    const score = scoreRoute(s.route, chemin)
    if (score !== null && score > meilleurScore) {
      meilleur = s
      meilleurScore = score
    }
  }
  return meilleur
}

/** Tous les intitulés sous lesquels un champ peut paraître à l'écran. */
function intitulesDe(c: ChampAide): string[] {
  return [c.nom, ...(c.alias ?? [])]
}

/**
 * Le champ d'une fiche, trouvé par son intitulé à l'écran. D'abord l'intitulé
 * exact (normalisé), puis sans la précision entre parenthèses, puis devise et
 * année repliées. Un champ sans description n'est pas un indice : il ne se
 * trouve pas.
 */
export function champDans(sujet: Sujet | undefined, intitule: string): ChampAide | undefined {
  if (!sujet?.champs?.length) return undefined
  const cherche = normaliserIntitule(intitule)
  if (!cherche) return undefined
  const utiles = sujet.champs.filter((c) => c.description.trim() !== '')
  const exact = utiles.find((c) => intitulesDe(c).some((n) => normaliserIntitule(n) === cherche))
  if (exact) return exact
  // Les essais suivants, du plus strict au plus large : sans la précision
  // entre parenthèses, puis devise et année repliées, puis les deux.
  const essais: ((n: string) => string)[] = [
    sansPrecision,
    plierVariables,
    (n) => sansPrecision(plierVariables(n)),
  ]
  for (const forme of essais) {
    const voulu = forme(cherche)
    if (!voulu) continue
    const trouve = utiles.find((c) => intitulesDe(c).some((n) => forme(normaliserIntitule(n)) === voulu))
    if (trouve) return trouve
  }
  return undefined
}

/** L'indice d'un champ, de l'adresse de l'écran à la description. */
export function indiceDans(
  sujets: readonly Sujet[],
  chemin: string,
  intitule: string,
): ChampAide | undefined {
  return champDans(sujetDans(sujets, chemin), intitule)
}

/**
 * Le texte d'un intitulé React : les chaînes et nombres qu'il contient, mis
 * bout à bout. Une étiquette s'écrit souvent `{cond ? 'A' : 'B'} *` — c'est le
 * texte que l'œil lit qui compte, pas la forme du code.
 */
export function texteDe(noeud: unknown): string {
  if (noeud === null || noeud === undefined || typeof noeud === 'boolean') return ''
  if (typeof noeud === 'string' || typeof noeud === 'number') return String(noeud)
  if (Array.isArray(noeud)) return noeud.map(texteDe).join('')
  if (typeof noeud === 'object' && 'props' in noeud) {
    const { type, props } = noeud as { type?: unknown; props?: { children?: unknown } }
    // Une balise de texte (`<span>`, `<strong>`…) ou un fragment se lisent ;
    // un COMPOSANT logé dans l'étiquette (une note `<Aide>`, un cadenas « lecture
    // seule »…) n'est pas l'intitulé, et ni un bouton ni une saisie ne le sont.
    if (typeof type === 'string') {
      if (/^(button|svg|select|input|textarea|option)$/.test(type)) return ''
      return texteDe(props?.children)
    }
    if (typeof type === 'symbol') return texteDe(props?.children)
    return ''
  }
  return ''
}
