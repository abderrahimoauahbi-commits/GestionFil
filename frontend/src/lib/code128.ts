/**
 * CODE 128, JEU B (19/10/2026) : le code-barres des etiquettes de lot.
 *
 * Le symbole que lisent toutes les douchettes laser, y compris celles qui ne
 * lisent pas les QR codes. Le jeu B couvre l'ASCII imprimable (32 a 126) : nos
 * codes d'etiquette (« E000001234 ») n'ont besoin de rien d'autre.
 *
 * Structure : depart B (104), un symbole par caractere (valeur = code ASCII -
 * 32), un symbole de controle (somme ponderee modulo 103), l'arret. Chaque
 * symbole est 6 largeurs (barre, espace, barre…) qui totalisent 11 modules ;
 * l'arret en a 7 (13 modules). Une marge blanche de 10 modules de chaque cote
 * est exigee par la norme : c'est le dessin qui la laisse.
 *
 * La table a ete verifiee symbole par symbole contre celle de JsBarcode 3.11.6
 * (19/10/2026), sans en faire une dependance.
 *
 * Module PUR, sans React, pour etre teste par `node --test`.
 */
export const LARGEURS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

const DEPART_B = 104
const ARRET = 106

/** Les valeurs des symboles : depart, donnees, controle, arret. */
export function symboles(texte: string): number[] {
  const donnees = [...texte].map((c) => {
    const n = c.charCodeAt(0)
    if (n < 32 || n > 126) throw new Error(`Code 128 B : caractère non encodable « ${c} »`)
    return n - 32
  })
  const controle = donnees.reduce((s, v, i) => s + v * (i + 1), DEPART_B) % 103
  return [DEPART_B, ...donnees, controle, ARRET]
}

/** Les modules, barre = 1 et espace = 0, sans les marges. */
export function modules(texte: string): string {
  return symboles(texte)
    .map((v) =>
      [...LARGEURS[v]].map((l, i) => (i % 2 === 0 ? '1' : '0').repeat(Number(l))).join(''),
    )
    .join('')
}

/**
 * Les barres a dessiner : position et largeur, en modules, marge de 10 modules
 * comprise. `largeur` est la largeur totale du symbole marges incluses.
 */
export function barres(texte: string): { barres: { x: number; l: number }[]; largeur: number } {
  const m = modules(texte)
  const MARGE = 10
  const res: { x: number; l: number }[] = []
  let i = 0
  while (i < m.length) {
    if (m[i] === '1') {
      let j = i
      while (j < m.length && m[j] === '1') j++
      res.push({ x: MARGE + i, l: j - i })
      i = j
    } else i++
  }
  return { barres: res, largeur: m.length + 2 * MARGE }
}
