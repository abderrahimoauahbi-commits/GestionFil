/**
 * LES TABLEAUX FAITS A LA MAIN NE DEFILENT PAS EN LARGEUR (12/10/2026).
 *
 * `DataTable` reporte ce qui ne tient pas sur une ligne complementaire. Une
 * cinquantaine d'ecrans ont pourtant leur propre `<table>` (etat des stocks,
 * lots, besoins, matrices, documents…) : a 1280 px, ou sur un portable regle a
 * 125 %, ils sortaient de leur cadre et il fallait les faire defiler de cote.
 *
 * Plutot que de reprendre chaque ecran, un seul observateur, monte dans la
 * coquille, surveille les tableaux de la page. Quand l'un deborde de son cadre,
 * il le resserre par crans, et s'arrete au premier qui suffit :
 *   1. les titres de colonne passent a la ligne ;
 *   2. le texte des cellules passe a la ligne (un nombre reste d'un tenant) ;
 *   3. les marges des cellules et la taille du texte se resserrent ;
 *   4. davantage encore, pour les grilles de nombres a 1024 px.
 * Le cran est un attribut (`data-souple`), la mise en forme est dans index.css.
 * Une autre largeur, d'autres donnees : on repart de zero.
 *
 * Ne sont pas concernes : les tableaux de `DataTable` (ils ont leur ligne
 * complementaire) et ceux de l'etat imprime (le papier a sa propre largeur).
 *
 * SUR TELEPHONE (sous 640 px), un tableau de SAISIE ne se resserre pas : il
 * devient une pile de cartes (voir `enCartes`).
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const CRANS = 4

/** Le cadre qui borne le tableau : le premier ancetre qui coupe ou fait defiler. */
function cadreDe(t: HTMLElement): HTMLElement | null {
  let c = t.parentElement
  while (c && c !== document.body) {
    if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(c).overflowX)) return c
    c = c.parentElement
  }
  return null
}

/** Un tableau de SAISIE : des champs dans son corps. */
const deSaisie = (t: HTMLTableElement) =>
  !!t.tBodies[0]?.querySelector('input:not([type="checkbox"]):not([type="radio"]), select, textarea')

/**
 * SUR TELEPHONE, UN TABLEAU DE SAISIE DEVIENT UNE PILE DE CARTES (13/10/2026).
 * Chaque cellule recoit le titre de sa colonne (`data-libelle`), que le CSS
 * affiche au-dessus du champ ; un nombre ou une cellule etroite (`data-court`)
 * partage sa rangee avec la suivante.
 */
function enCartes(t: HTMLTableElement): boolean {
  if (window.innerWidth >= 640 || !deSaisie(t)) {
    t.removeAttribute('data-cartes')
    return false
  }
  const entetes = t.tHead?.rows[t.tHead.rows.length - 1]
  const titres: string[] = []
  if (entetes) {
    for (const th of Array.from(entetes.cells)) {
      for (let i = 0; i < th.colSpan; i += 1) titres.push((th.textContent ?? '').trim())
    }
  }
  for (const corps of Array.from(t.tBodies)) {
    for (const tr of Array.from(corps.rows)) {
      let col = 0
      for (const td of Array.from(tr.cells)) {
        const titre = td.colSpan === 1 ? titres[col] ?? '' : ''
        if (titre) td.setAttribute('data-libelle', titre)
        else td.removeAttribute('data-libelle')
        const nombre = td.matches('.text-right, .tabular-nums')
          || !!td.querySelector('input[inputmode="decimal"], input[inputmode="numeric"], input[type="number"], input[type="date"]')
        if (nombre && td.colSpan === 1) td.setAttribute('data-court', '')
        else td.removeAttribute('data-court')
        col += td.colSpan
      }
    }
  }
  t.setAttribute('data-cartes', '')
  return true
}

function ajuster(t: HTMLTableElement) {
  if (t.closest('.cadre-table, .zone-impression, .impression-seule, [data-pas-souple]')) return
  if (!t.offsetParent) return // cache (onglet ferme, cartes) : rien a mesurer
  if (enCartes(t)) {
    t.removeAttribute('data-souple')
    return
  }
  const cadre = cadreDe(t)
  const largeur = cadre ? cadre.clientWidth : document.documentElement.clientWidth
  if (!largeur) return
  t.removeAttribute('data-souple')
  for (let cran = 1; cran <= CRANS && t.scrollWidth > largeur + 1; cran += 1) {
    t.setAttribute('data-souple', String(cran))
  }
}

export function TablesSouples() {
  const { pathname } = useLocation()

  useEffect(() => {
    const racine = document.querySelector('main')
    if (!racine) return
    let prevu = 0
    const tout = () => {
      cancelAnimationFrame(prevu)
      prevu = requestAnimationFrame(() => racine.querySelectorAll('table').forEach(ajuster))
    }
    // Les lignes arrivent apres le rendu (requetes) : on reprend a chaque
    // changement du contenu. Nos propres attributs ne declenchent rien — seuls
    // les noeuds et le texte sont observes.
    const mutations = new MutationObserver(tout)
    mutations.observe(racine, { childList: true, subtree: true, characterData: true })
    const tailles = new ResizeObserver(tout)
    tailles.observe(racine)
    tout()
    return () => {
      cancelAnimationFrame(prevu)
      mutations.disconnect()
      tailles.disconnect()
    }
  }, [pathname])

  return null
}
