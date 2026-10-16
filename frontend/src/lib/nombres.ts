/**
 * LA LECTURE D'UN NOMBRE TAPE A LA FRANCAISE, une seule regle pour tout l'ecran.
 *
 * POURQUOI. Chaque ecran lisait a sa facon : `Number(v.replace(',', '.'))` ici,
 * le champ numerique d'Edge la. Les deux echouaient en silence sur ce qu'un
 * utilisateur tape vraiment : « 1.234,5 » (point des milliers, a l'europeenne)
 * devenait 1,2345 kg — mille fois moins — sans un mot (test de bout en bout du
 * 10/10/2026).
 *
 * LA REGLE :
 *   - les espaces (ordinaires, insecables, fines) separent les milliers : ignores ;
 *   - avec point ET virgule, le DERNIER des deux est la decimale, l'autre separe
 *     les milliers : « 1.234,5 » = « 1,234.5 » = 1234,5 ;
 *   - un seul separateur, present une fois, est la decimale : « 12,5 » = « 12.5 »
 *     (le pave numerique ecrit souvent un point) ;
 *   - le meme separateur repete separe les milliers : « 1.234.567 » = 1234567 ;
 *   - des milliers se groupent par trois chiffres, sinon le nombre est ILLISIBLE
 *     (« 1,2,3 », « 12.34,5 ») : on le dit, on ne devine pas.
 * Vide : null. Illisible : NaN.
 */
export function lireNombre(texte: string | number | null | undefined): number | null {
  if (texte == null) return null
  if (typeof texte === 'number') return Number.isFinite(texte) ? texte : Number.NaN
  let t = texte.replace(/[\s\u00a0\u202f]/g, '')
  if (t === '') return null
  let signe = ''
  if (t[0] === '-' || t[0] === '+') {
    signe = t[0] === '-' ? '-' : ''
    t = t.slice(1)
  }
  const virgule = t.lastIndexOf(',')
  const point = t.lastIndexOf('.')
  let decimale: string | null = null
  let milliers: string | null = null
  if (virgule >= 0 && point >= 0) {
    decimale = virgule > point ? ',' : '.'
    milliers = decimale === ',' ? '.' : ','
  } else if (virgule >= 0 || point >= 0) {
    const sep = virgule >= 0 ? ',' : '.'
    if (t.split(sep).length === 2) decimale = sep
    else milliers = sep
  }
  let entier = t
  let fraction = ''
  if (decimale) {
    const i = t.lastIndexOf(decimale)
    entier = t.slice(0, i)
    fraction = t.slice(i + 1)
    if (fraction.includes(decimale) || !/^\d*$/.test(fraction)) return Number.NaN
  }
  if (milliers && entier.includes(milliers)) {
    const groupes = entier.split(milliers)
    if (!/^\d{1,3}$/.test(groupes[0]) || groupes.slice(1).some((g) => !/^\d{3}$/.test(g))) return Number.NaN
    entier = groupes.join('')
  }
  if (!/^\d*$/.test(entier) || (entier === '' && fraction === '')) return Number.NaN
  return Number(`${signe}${entier || '0'}${fraction ? '.' + fraction : ''}`)
}

/** Un nombre lu, ou 0 s'il est vide ou illisible (pour un total d'affichage, jamais pour enregistrer). */
export const nombreOuZero = (texte: string | number | null | undefined) => {
  const n = lireNombre(texte)
  return n == null || Number.isNaN(n) ? 0 : n
}

/** La forme d'echange avec les ecrans : « 1234.5 », chaine vide si vide, la saisie brute si illisible. */
export function versCanonique(texte: string): string {
  const n = lireNombre(texte)
  if (n == null) return ''
  return Number.isNaN(n) ? texte : String(n)
}

/** L'affichage dans un champ : la virgule decimale, sans separateur de milliers (facile a retoucher). */
export const versSaisie = (v: string | number | null | undefined) =>
  v == null || v === '' ? '' : String(v).replace('.', ',')
