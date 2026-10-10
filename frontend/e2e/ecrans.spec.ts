/**
 * TOUS LES ECRANS, un par un, ouverts dans Edge par la Direction (tous les
 * droits, aucun champ masque) : l'ecran ne doit ni planter, ni produire
 * d'erreur JavaScript, ni recevoir d'erreur 500. Ce qui se voit de travers
 * (champ trop etroit, tableau qui deborde, bouton hors de l'ecran, HTML
 * fautif) est consigne dans le rapport, sans faire echouer le test.
 *
 * La liste vient de src/App.tsx : un ecran ajoute est teste sans rien ecrire ici.
 */
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { attendreEcran, connexion, consigner, controlerHtml, ecranPlante, mesurer, surveiller } from './outils'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf-8')
const routes = [...new Set([...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]))].filter(
  (r) => r !== '*' && r !== '/connexion',
)
const exemples: Record<string, string> = (() => {
  try {
    return JSON.parse(readFileSync(process.env.E2E_EXEMPLES ?? '', 'utf-8'))
  } catch {
    return {}
  }
})()

/** L'adresse a ouvrir : les parametres remplaces par un document existant, sinon l'ecran est saute. */
function adresse(route: string): string | null {
  if (!route.includes(':')) return '/' + route
  const id = exemples[route]
  if (!id) return null
  return '/' + route.replace(/:[A-Za-z]+/, encodeURIComponent(id))
}

test.describe.configure({ mode: 'serial' })

let page: Page
let veille: ReturnType<typeof surveiller>

test.beforeAll(async ({ browser }) => {
  // Un contexte aux reglages du projet (taille d'ecran, langue, adresse) : une
  // page de browser.newPage() les ignorerait, et axe la refuse.
  const { viewport, locale, timezoneId, baseURL } = test.info().project.use
  const contexte = await browser.newContext({ viewport, locale, timezoneId, baseURL })
  page = await contexte.newPage()
  veille = surveiller(page)
  await connexion(page, 'Mohamed')
})

test.afterAll(async () => {
  await page.context().close()
})

for (const route of ['', ...routes]) {
  const url = route === '' ? '/' : adresse(route)
  // eslint-disable-next-line no-empty-pattern -- Playwright exige la destructuration des fixtures
  test(`écran ${url ?? route}`, async ({}, info) => {
    test.skip(url === null, `aucun document pour ${route}`)
    veille.vider()
    await page.goto(url!)
    await attendreEcran(page)
    await expect(page, 'renvoyé à la connexion').not.toHaveURL(/connexion/)

    const plante = await ecranPlante(page)
    const constats = [...veille.constats, ...(await mesurer(page)), ...(await controlerHtml(page))]
    const capture = info.outputPath('ecran.png')
    await page.screenshot({ path: capture, fullPage: false })
    consigner(info, url!, constats, capture)

    expect(plante, `l'écran a planté : ${plante}`).toBeNull()
    expect(veille.erreurs, 'erreurs JavaScript ou serveur').toEqual([])
  })
}
