/**
 * Outils des tests de bout en bout : connexion par le vrai formulaire,
 * surveillance (console, erreurs JavaScript, reponses du serveur), mesures de
 * mise en page et controle du HTML (axe), rapport des constats.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test'

export const MDP = process.env.E2E_MDP ?? 'Banc-Essai-2026!'

/** Un constat : ce qu'un utilisateur verrait de travers, sans que l'ecran plante. */
export interface Constat {
  type: string
  gravite: 'bloquant' | 'genant' | 'mineur'
  element?: string
  detail: string
}

/** Connexion par l'ecran de connexion, comme un utilisateur. */
export async function connexion(page: Page, login: string) {
  await page.goto('/connexion')
  await page.locator('#login').fill(login)
  await page.locator('#mdp').fill(MDP)
  await page.locator('button[type=submit]').click()
  await expect(page).not.toHaveURL(/connexion/, { timeout: 15_000 })
}

/** Ce que la console et le reseau disent pendant qu'un ecran s'affiche. */
export function surveiller(page: Page) {
  const erreurs: string[] = []
  const constats: Constat[] = []
  page.on('pageerror', (e) => erreurs.push(`JavaScript : ${e.message}`))
  page.on('console', (m) => {
    // « Failed to load resource » double une reponse en erreur, deja suivie ci-dessous.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource'))
      erreurs.push(`console : ${m.text().slice(0, 300)}`)
    else if (m.type() === 'warning')
      constats.push({ type: 'console-avertissement', gravite: 'mineur', detail: m.text().slice(0, 300) })
  })
  page.on('response', (r) => {
    const url = new URL(r.url())
    if (!url.pathname.startsWith('/api/')) return
    const route = `${r.request().method()} ${url.pathname}`
    if (r.status() >= 500) erreurs.push(`serveur ${r.status()} : ${route}`)
    else if (r.status() >= 400 && r.status() !== 401)
      constats.push({ type: 'api-refus', gravite: 'genant', detail: `${r.status()} ${route}` })
  })
  return {
    erreurs,
    constats,
    vider() {
      erreurs.length = 0
      constats.length = 0
    },
  }
}

/** Attendre que l'ecran ait fini de charger ses donnees (borne : certains ecrans interrogent en continu). */
export async function attendreEcran(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined)
  await page.waitForTimeout(300)
}

/** L'ecran a-t-il plante (barriere d'erreur) ? */
export async function ecranPlante(page: Page): Promise<string | null> {
  const titre = page.getByText(/Cet écran a rencontré une erreur|Écran indisponible/)
  if (await titre.count()) return (await page.locator('.font-mono').first().textContent().catch(() => '')) ?? 'erreur'
  return null
}

/**
 * LES MESURES DE MISE EN PAGE, dans la page : ce qui deborde, ce qui est
 * tronque, ce qui sort de l'ecran. Les seuils sont ceux d'un utilisateur : un
 * pixel de trop ne compte pas.
 */
export async function mesurer(page: Page): Promise<Constat[]> {
  return page.evaluate(() => {
    const out: { type: string; gravite: 'bloquant' | 'genant' | 'mineur'; element?: string; detail: string }[] = []
    const vw = window.innerWidth
    const vh = window.innerHeight
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    }
    const nom = (el: Element) => {
      const h = el as HTMLElement
      const label =
        h.getAttribute('aria-label') ||
        (h.id && document.querySelector(`label[for="${CSS.escape(h.id)}"]`)?.textContent) ||
        h.getAttribute('name') ||
        h.getAttribute('placeholder') ||
        h.textContent ||
        ''
      return `${el.tagName.toLowerCase()}${h.id ? '#' + h.id : ''} « ${label.trim().replace(/\s+/g, ' ').slice(0, 50)} »`
    }
    const page = document.scrollingElement ?? document.documentElement
    if (page.scrollWidth > vw + 2)
      out.push({
        type: 'page-defile-horizontalement',
        gravite: 'genant',
        detail: `la page fait ${page.scrollWidth} px de large pour ${vw} px d'ecran`,
      })

    // Champs dont la valeur ne tient pas dans la largeur.
    const mesureur = document.createElement('canvas').getContext('2d')!
    for (const el of document.querySelectorAll<HTMLElement>(
      'input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]):not([type=date]), select, textarea',
    )) {
      if (!visible(el)) continue
      const texte =
        el instanceof HTMLSelectElement
          ? (el.selectedOptions[0]?.text ?? '')
          : (el as HTMLInputElement).value || (el as HTMLInputElement).placeholder || ''
      if (!texte) continue
      const s = getComputedStyle(el)
      mesureur.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`
      const largeurTexte = mesureur.measureText(texte).width
      const utile =
        el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - (el instanceof HTMLSelectElement ? 18 : 0)
      if (largeurTexte > utile + 2)
        out.push({
          type: 'champ-trop-etroit',
          gravite: 'genant',
          element: nom(el),
          detail: `« ${texte.slice(0, 40)} » demande ${Math.round(largeurTexte)} px, le champ en offre ${Math.round(utile)}`,
        })
    }

    // Cellules de tableau tronquees (texte coupe par overflow / ellipsis).
    let tronquees = 0
    const exemples: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('td, th')) {
      if (!visible(el)) continue
      const cible = (el.firstElementChild as HTMLElement | null) ?? el
      for (const c of [el, cible]) {
        const s = getComputedStyle(c)
        if ((s.overflow === 'hidden' || s.textOverflow === 'ellipsis') && c.scrollWidth > c.clientWidth + 2) {
          tronquees++
          if (exemples.length < 3) exemples.push((c.textContent ?? '').trim().slice(0, 30))
          break
        }
      }
    }
    if (tronquees)
      out.push({
        type: 'cellules-tronquees',
        gravite: 'mineur',
        detail: `${tronquees} cellule(s) coupee(s), ex. ${exemples.map((e) => `« ${e} »`).join(', ')}`,
      })

    // Tableaux plus larges que leur cadre : defilement horizontal.
    for (const t of document.querySelectorAll<HTMLElement>('table')) {
      if (!visible(t)) continue
      let cadre: HTMLElement | null = t.parentElement
      while (cadre && cadre !== document.body) {
        const s = getComputedStyle(cadre)
        if (/(auto|scroll|hidden)/.test(s.overflowX)) break
        cadre = cadre.parentElement
      }
      const largeurCadre = cadre && cadre !== document.body ? cadre.clientWidth : vw
      if (t.scrollWidth > largeurCadre + 4) {
        const entetes = [...t.querySelectorAll('thead th')].length
        out.push({
          type: 'tableau-defile-horizontalement',
          gravite: t.scrollWidth > largeurCadre * 1.3 ? 'genant' : 'mineur',
          element: `table (${entetes} colonnes)`,
          detail: `${t.scrollWidth} px de tableau pour ${largeurCadre} px visibles (${Math.round((largeurCadre / t.scrollWidth) * 100)} % visible)`,
        })
      }
      const r = t.getBoundingClientRect()
      if (r.height > vh * 3)
        out.push({
          type: 'tableau-tres-long',
          gravite: 'mineur',
          element: `table (${t.querySelectorAll('tbody tr').length} lignes)`,
          detail: `${Math.round(r.height)} px de haut, ${Math.round(r.height / vh)} ecrans a faire defiler`,
        })
    }

    // Boutons hors de l'ecran, ou caches derriere autre chose.
    for (const b of document.querySelectorAll<HTMLElement>('button, a[role=button], [role=button]')) {
      if (!visible(b) || (b as HTMLButtonElement).disabled) continue
      // Cache expres (panneau replie) : axe dit s'il reste atteignable au clavier.
      if (b.closest('[aria-hidden="true"], [inert]')) continue
      const r = b.getBoundingClientRect()
      // Dans un cadre qui defile (tableau large) : on l'atteint en faisant defiler
      // le cadre, et c'est le constat « tableau qui deborde » qui le dit.
      let cadre = b.parentElement
      while (cadre && cadre !== document.body && !/(auto|scroll|hidden|clip)/.test(getComputedStyle(cadre).overflowX))
        cadre = cadre.parentElement
      if (cadre && cadre !== document.body) {
        const rc = cadre.getBoundingClientRect()
        if (r.left < rc.left - 1 || r.right > rc.right + 1) continue
      }
      if (r.right > vw + 1 || r.left < -1) {
        out.push({
          type: 'bouton-hors-ecran',
          gravite: 'bloquant',
          element: nom(b),
          detail: `bouton de ${Math.round(r.left)} a ${Math.round(r.right)} px, ecran de ${vw} px`,
        })
        continue
      }
      if (r.top >= 0 && r.bottom <= vh) {
        const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (dessus && !b.contains(dessus) && !dessus.contains(b))
          out.push({
            type: 'bouton-masque',
            gravite: 'genant',
            element: nom(b),
            detail: `recouvert par ${dessus.tagName.toLowerCase()}.${String((dessus as HTMLElement).className).split(' ')[0]}`,
          })
      }
    }
    // Les actions principales sous la ligne de flottaison : il faut defiler pour les trouver.
    const actions = /^(enregistrer|valider|créer|ajouter|confirmer|soumettre|calculer|imprimer|nouveau|nouvelle)/i
    for (const b of document.querySelectorAll<HTMLElement>('button')) {
      if (!visible(b)) continue
      const texte = (b.textContent ?? '').trim()
      if (!actions.test(texte)) continue
      const r = b.getBoundingClientRect()
      if (r.top > vh)
        out.push({
          type: 'action-sous-l-ecran',
          gravite: 'genant',
          element: nom(b),
          detail: `a ${Math.round(r.top)} px, l'ecran s'arrete a ${vh} px`,
        })
    }

    // HTML : identifiants en double, champs sans etiquette.
    const ids = new Map<string, number>()
    for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) ?? 0) + 1)
    for (const [id, n] of ids)
      if (n > 1) out.push({ type: 'html-id-double', gravite: 'mineur', element: `#${id}`, detail: `${n} elements` })
    return out
  })
}

/** Le controle du HTML par axe-core (regles WCAG A/AA, sauf le contraste : il depend du theme choisi). */
export async function controlerHtml(page: Page): Promise<Constat[]> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).disableRules(['color-contrast']).analyze()
  return r.violations.map((v) => ({
    type: `html-${v.id}`,
    gravite: v.impact === 'critical' || v.impact === 'serious' ? 'genant' : 'mineur',
    element: v.nodes[0]?.target.join(' ').slice(0, 80),
    detail: `${v.help} (${v.nodes.length} element(s))`,
  }))
}

/** Range les constats d'un test dans rapport-e2e/constats (lus par constats.py). */
export function consigner(info: TestInfo, ecran: string, constats: Constat[], capture?: string) {
  const dossier = join(info.config.rootDir, '..', 'rapport-e2e', 'constats')
  mkdirSync(dossier, { recursive: true })
  const nom = `${info.project.name}__${ecran.replace(/[^a-z0-9]+/gi, '_')}.json`
  writeFileSync(join(dossier, nom), JSON.stringify({ ecran, taille: info.project.name, capture, constats }, null, 1))
}

/** Une session d'utilisateur dans son propre contexte de navigateur, aux reglages du projet. */
export async function session(browser: Browser, info: TestInfo, login: string) {
  const { viewport, locale, timezoneId, baseURL } = info.project.use
  const contexte = await browser.newContext({ viewport, locale, timezoneId, baseURL })
  const page = await contexte.newPage()
  const veille = surveiller(page)
  await connexion(page, login)
  return { page, veille }
}

/**
 * Taper comme un utilisateur : cliquer, tout selectionner, frapper touche par
 * touche. `fill` contournerait le navigateur ; ici, ce qu'Edge refuse dans un
 * champ numerique (espace, separateur de milliers) est refuse comme pour lui.
 */
export async function saisir(champ: Locator, texte: string) {
  await champ.click()
  await champ.press('Control+a')
  await champ.pressSequentially(texte, { delay: 15 })
}

/** Lire au serveur, avec le jeton de la session (pour verifier ce qui a ete enregistre). */
export async function lireApi<T = unknown>(page: Page, chemin: string): Promise<T> {
  const jeton = await page.evaluate(() => sessionStorage.getItem('gestionfil.jeton'))
  const r = await page.request.get(chemin, { headers: { Authorization: `Bearer ${jeton}` } })
  expect(r.ok(), `${chemin} : ${r.status()} ${await r.text()}`).toBeTruthy()
  return (await r.json()) as T
}

/** Un nombre a la francaise, tel qu'un utilisateur l'attend : « 1 234,5 » vaut 1234,5. */
export const attendu = (texte: string) => Number(texte.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'))
