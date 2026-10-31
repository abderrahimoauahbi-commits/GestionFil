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
import { attendreEcran, connexion, consigner, controlerHtml, ecranPlante, mesurer, surveiller, verifierMasques } from './outils'

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
    const constats = [...veille.constats, ...(await verifierMasques(page, await mesurer(page))), ...(await controlerHtml(page))]
    const capture = info.outputPath('ecran.png')
    await page.screenshot({ path: capture, fullPage: false })
    consigner(info, url!, constats, capture)

    expect(plante, `l'écran a planté : ${plante}`).toBeNull()
    expect(veille.erreurs, 'erreurs JavaScript ou serveur').toEqual([])
    // LE HTML RESTE PROPRE (10/10/2026) : ramenes a zero, les defauts axe font
    // maintenant echouer le test — un nouveau defaut ne repasse pas en silence.
    const html = constats.filter((x) => x.type.startsWith('html-')).map((x) => `${x.type} ${x.element ?? ''} : ${x.detail}`)
    expect.soft(html, 'défauts HTML / accessibilité').toEqual([])
  })
}

/* LE PLAN D'ACHAT SANS L'ONGLET « À COMMANDER » (décision du 27/10/2026) : il est
   déplacé dans /stock › Surveillance, sans bouton « Commander ». Un clic sur une
   ligne des besoins ouvre la FENÊTRE DE SURVEILLANCE de la référence (la même
   modale), jamais un détail déplié sous la ligne ; la case à cocher garde son
   geste. La liste peut être vide sur la base du banc. */
test('plan-achat : sans « À commander », le clic sur une ligne ouvre la fenêtre de surveillance', async () => {
  veille.vider()
  await page.goto('/plan-achat')
  await attendreEcran(page)
  await expect(page.getByRole('tab', { name: 'À commander', exact: true })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: /Besoins/ })).toBeVisible()
  await expect(page.locator('main').getByRole('button', { name: /^Commander/ })).toHaveCount(0)
  const lignes = page.locator('main tbody tr.cursor-pointer')
  if ((await lignes.count()) > 0) {
    // La case à cocher n'ouvre pas la fenêtre.
    const caseLigne = page.locator('main tbody input[type=checkbox]').first()
    if ((await caseLigne.count()) > 0) {
      await caseLigne.click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await caseLigne.click()
    }
    await lignes.first().click({ position: { x: 200, y: 8 } })
    const fenetre = page.getByRole('dialog')
    await expect(fenetre).toBeVisible()
    await expect(fenetre.getByText('Chronologie', { exact: true }).first()).toBeVisible()
    await expect(fenetre.getByText('Solde projeté jour par jour', { exact: true }).first()).toBeVisible()
    await expect(fenetre.locator('[data-statut]').first()).toBeVisible()
    await expect(fenetre.getByRole('button', { name: /^Commander/ })).toHaveCount(0)
    // Rien ne se déplie sous la ligne : le calcul n'est que dans la fenêtre.
    await expect(page.locator('main').getByText('À commander — le calcul', { exact: true })).toHaveCount(0)
    const deborde = await page.evaluate(() => {
      const m = document.querySelector('main')
      return m ? m.scrollWidth - m.clientWidth : 0
    })
    expect(deborde, 'défilement horizontal de la page').toBeLessThanOrEqual(1)
    await page.keyboard.press('Escape')
    await expect(fenetre).toHaveCount(0)
  }
  expect(veille.erreurs, 'erreurs JavaScript ou serveur').toEqual([])
})

/* LE STOCK PROJETÉ, TROIS ONGLETS (27 et 30/10/2026) : la liste (19 colonnes et les
   vues Risques et Sourcing, l'état en pastille, le bouton Rattrapage) et sa fenêtre
   ouverte AU CLIC SUR LA LIGNE, sans chronologie (§ 16), la
   surveillance (le tableau « À commander », sans « Commander », sa fenêtre au clic),
   et la simulation, qui ne doit RIEN écrire — aucune requête d'écriture hors le
   POST de lecture de la simulation. */
test('stock : trois onglets, la fenêtre enrichie et la simulation sans écriture', async () => {
  veille.vider()
  // Les réglages d'affichage du compte (colonnes, vue) se rangent sur le serveur : ce n'est pas une donnée.
  const ecritures: string[] = []
  const espion = (r: import('@playwright/test').Request) => {
    const url = new URL(r.url())
    if (url.pathname.startsWith('/api/') && r.method() !== 'GET' && !/^\/api\/couverture\/[^/]+\/simulation$/.test(url.pathname)
        && url.pathname !== '/api/auth/connexion' && url.pathname !== '/api/auth/preferences')
      ecritures.push(`${r.method()} ${url.pathname}`)
  }
  page.on('request', espion)
  try {
    await page.goto('/stock')
    await attendreEcran(page)
    for (const nom of ['Stock projeté', 'Simulation', 'Surveillance'])
      await expect(page.getByRole('tab', { name: nom, exact: true })).toBeVisible()
    const deborde = () =>
      page.evaluate(() => {
        const m = document.querySelector('main')
        return m ? m.scrollWidth - m.clientWidth : 0
      })
    expect(await deborde(), 'défilement horizontal (stock projeté)').toBeLessThanOrEqual(1)

    // LE STOCK PROJETÉ (§ 16, 30/10/2026) : ses colonnes, l'état en pastille, le bouton Rattrapage,
    // et ses trois vues (Approvisionnement, Risques, Sourcing) sans défilement horizontal.
    // Une seule ligne par référence (30/10/2026) ; référence, fournisseur et état en tête
    // des quatre vues (31/10/2026) ; ni « 1re rupture » ni « Avant le » en Approvisionnement.
    for (const entete of ['Référence', 'Fournisseur', 'État', 'Stock disponible', 'Position', 'Couverture', 'Cible', 'À commander'])
      await expect(page.locator('main thead th', { hasText: entete }).first()).toBeVisible()
    for (const absente of ['1re rupture', 'Avant le', 'Écart cible', 'Désignation', 'Restant'])
      await expect(page.locator('main thead th', { hasText: absente })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Rattrapage : inclus/ })).toBeVisible()
    for (const [vue, entete] of [
      ['Risques', 'Avant le'],
      ['Sourcing', 'Groupe d’équivalence'],
      ['Emplacements', 'Stock global après l’arrivage'],
    ] as const) {
      await page.getByRole('tab', { name: vue, exact: true }).click()
      await expect(page.locator('main thead th', { hasText: entete }).first()).toBeVisible()
      for (const fixe of ['Référence', 'Fournisseur', 'État'])
        await expect(page.locator('main thead th', { hasText: fixe }).first()).toBeVisible()
      expect(await deborde(), `défilement horizontal (vue ${vue})`).toBeLessThanOrEqual(1)
    }
    await page.getByRole('tab', { name: 'Approvisionnement', exact: true }).click()
    // La fenêtre ENRICHIE au clic sur la LIGNE (pas seulement sur une icône).
    const lignes = page.locator('main tbody tr.cursor-pointer')
    let reference: string | null = null
    if ((await lignes.count()) > 0) {
      await expect(page.locator('main tbody [data-statut]').first()).toBeVisible()
      await lignes.first().click({ position: { x: 300, y: 8 } })
      const fenetre = page.getByRole('dialog')
      await expect(fenetre).toBeVisible()
      // La disposition « pont de calcul » (31/10/2026) : décision, quatre chiffres, pont,
      // matière et arrivages, puis l'onglet Calcul ouvert.
      for (const titre of ['Comment on arrive à la quantité', 'Où se trouve la matière', 'Arrivages', 'Approvisionnement', 'Calcul de la quantité'])
        await expect(fenetre.getByRole('heading', { name: titre, exact: true })).toBeVisible()
      await expect(fenetre.locator('[data-statut]').first()).toBeVisible()
      await expect(fenetre.getByRole('region', { name: 'Décision' })).toBeVisible()
      for (const tuile of ['Couverture', 'Couverture à la livraison', 'Position', 'Délai'])
        await expect(fenetre.getByText(tuile, { exact: true }).first()).toBeVisible()
      // Pas de chronologie au stock projeté (§ 16) : ni onglet Projection, ni date de rupture.
      await expect(fenetre.getByRole('tab', { name: 'Projection', exact: true })).toHaveCount(0)
      await fenetre.getByRole('tab', { name: 'Lots', exact: false }).click()
      await expect(fenetre.getByRole('tab', { name: /^Lots/ })).toHaveAttribute('aria-selected', 'true')
      reference = (await page.getByRole('dialog').locator('h2').first().textContent())?.split(' — ')[0]?.trim() ?? null
      // Échap ferme la fenêtre ; un nouveau clic sur la ligne la rouvre.
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await lignes.first().click({ position: { x: 300, y: 8 } })
      await expect(page.getByRole('dialog')).toBeVisible()
      // « Simuler cette référence » : l'onglet Simulation, la référence choisie.
      await fenetre.getByRole('button', { name: /Simuler cette référence/ }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('tab', { name: 'Simulation', exact: true })).toHaveAttribute('aria-selected', 'true')
    } else {
      await page.getByRole('tab', { name: 'Simulation', exact: true }).click()
    }

    // La simulation : le bandeau, et une hypothèse recalculée sans rien écrire.
    await expect(page.getByText('Simulation — rien n’est enregistré', { exact: true })).toBeVisible()
    if (reference) {
      await expect(page.locator('th', { hasText: /^Simulé/ })).toBeVisible({ timeout: 30_000 })
      await page.getByRole('button', { name: /Ajouter un arrivage/ }).click()
      await page.getByLabel('Date de l’arrivage').fill(new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10))
      await page.getByLabel('Kilos').last().fill('500')
      await expect(page.getByText(/Arrivage ajouté : 500 kg le/)).toBeVisible({ timeout: 30_000 })
      expect(await deborde(), 'défilement horizontal (simulation)').toBeLessThanOrEqual(1)
    }

    // La surveillance : le tableau « À commander », sans « Commander » ; le clic sur
    // une ligne ouvre la fenêtre de surveillance (celle du plan d'achat), Échap la ferme.
    await page.getByRole('tab', { name: 'Surveillance', exact: true }).click()
    await expect(page.getByText('Règles des dates d’arrivage', { exact: false })).toBeVisible()
    await expect(page.locator('main').getByRole('button', { name: /^Commander/ })).toHaveCount(0)
    expect(await deborde(), 'défilement horizontal (surveillance)').toBeLessThanOrEqual(1)
    const surveillees = page.locator('main tbody tr.cursor-pointer')
    if ((await surveillees.count()) > 0) {
      await surveillees.first().click({ position: { x: 300, y: 8 } })
      const fenetre = page.getByRole('dialog')
      await expect(fenetre).toBeVisible()
      await expect(fenetre.getByText('Chronologie', { exact: true }).first()).toBeVisible()
      await expect(fenetre.getByRole('button', { name: /^Commander/ })).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(fenetre).toHaveCount(0)
    }
  } finally {
    page.off('request', espion)
  }
  expect(ecritures, 'la simulation et les onglets n’écrivent rien').toEqual([])
  expect(veille.erreurs, 'erreurs JavaScript ou serveur').toEqual([])
})
