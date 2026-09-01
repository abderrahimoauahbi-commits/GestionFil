/**
 * Export d'un tableau vers un fichier CSV lisible par Excel francophone.
 *
 * POURQUOI CE FICHIER PLUTOT QU'UNE FONCTION PAR ECRAN. Vingt-cinq tableaux
 * exportent la meme chose : des colonnes deja definies pour l'affichage, deja
 * filtrees par les droits. Recopier la mise en forme dans chacun garantissait
 * qu'ils divergeraient — et l'unique export existant, celui des besoins,
 * portait deja un defaut que personne n'avait vu.
 *
 * TROIS CONVENTIONS, ET LEURS RAISONS.
 *
 * Le SEPARATEUR est le point-virgule. Excel en configuration francaise attend
 * cela ; avec une virgule il empile tout dans la premiere colonne.
 *
 * La MARQUE D'ORDRE (BOM) ouvre le fichier. Sans elle, Excel lit l'UTF-8 comme
 * de l'ANSI et « Qualité » devient « QualitÃ© ».
 *
 * La VIRGULE DECIMALE ne s'applique QU'AUX NOMBRES, cellule par cellule.
 * L'export des besoins la posait par une expression reguliere sur le fichier
 * entier : elle transformait aussi « PP-1500 Dtex-1.5 » en « ...1,5 » et
 * coupait les horodatages. Ici une cellule n'est convertie que si la colonne
 * est declaree numerique et que la valeur en est reellement un.
 */

export interface ColonneExport<L> {
  champ: string
  entete: string
  numerique?: boolean
  /** Valeur a exporter, si differente du champ brut. */
  valeurExport?: (ligne: L) => string | number | null | undefined
}

/**
 * Echappement CSV.
 *
 * Une cellule est encadree de guillemets des qu'elle contient un separateur,
 * un guillemet ou un saut de ligne ; les guillemets internes sont doubles.
 * C'est la regle du RFC 4180, celle qu'Excel applique. Remplacer les
 * points-virgules par des virgules — ce que faisait l'export des besoins —
 * modifie la donnee au lieu de la proteger : une designation « Bleu; marine »
 * ressortait fausse dans le fichier.
 */
function cellule(v: unknown, numerique: boolean): string {
  if (v == null) return ''

  if (numerique && typeof v === 'number' && Number.isFinite(v)) {
    return String(v).replace('.', ',')
  }
  // Une colonne numerique peut porter du texte : « — » quand la valeur manque,
  // ou un libelle quand le droit masque le chiffre. On ne le convertit pas.
  const t = String(v)
  return /[";\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t
}

/** Nom de fichier : sujet, date, extension. Trie naturellement dans un dossier. */
function nomFichier(sujet: string): string {
  const jour = new Date().toISOString().slice(0, 10)
  const propre = sujet
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${propre}-${jour}.csv`
}

/**
 * Construit le contenu CSV. Isole de l'ecriture du fichier pour etre testable
 * et pour servir aussi bien au telechargement qu'a un envoi.
 */
export function versCsv<L extends Record<string, unknown>>(
  colonnes: ColonneExport<L>[],
  lignes: L[],
): string {
  const entete = colonnes.map((c) => cellule(c.entete, false)).join(';')
  const corps = lignes.map((l) =>
    colonnes
      .map((c) => {
        const v = c.valeurExport ? c.valeurExport(l) : l[c.champ]
        return cellule(v, c.numerique === true)
      })
      .join(';'),
  )
  // CRLF : Excel accepte les deux, mais le Bloc-notes de Windows n'affiche
  // correctement que le premier.
  return '﻿' + [entete, ...corps].join('\r\n')
}

/**
 * Ecrit le fichier et le propose au telechargement.
 *
 * L'URL objet est revoquee apres le clic : sans cela chaque export laisse en
 * memoire une copie du fichier jusqu'a la fermeture de l'onglet, ce qui compte
 * sur un poste ouvert toute la journee.
 */
export function exporterCsv<L extends Record<string, unknown>>(
  sujet: string,
  colonnes: ColonneExport<L>[],
  lignes: L[],
): void {
  const contenu = versCsv(colonnes, lignes)
  const url = URL.createObjectURL(new Blob([contenu], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nomFichier(sujet)
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Laisse au navigateur le temps de demarrer le telechargement.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
