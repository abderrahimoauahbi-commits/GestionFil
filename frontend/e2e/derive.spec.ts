/**
 * LA MEME LIGNE DE BON RECUE EN DEUX FORMES DU MEME LOT (07/11/2026).
 *
 * Le cas de l'utilisateur : 18 palettes commandees ; le fournisseur livre le
 * lot 10 en 16 palettes (488 bobines) et 2 palettes (200 bobines). Au bureau,
 * la ligne se dedouble (« Autre lot ou autre forme »), la seconde forme se
 * compare a la premiere — autre nombre de bobines par palette —, l'ecran
 * propose un nouveau derive, la personne le confirme ; a la validation, le lot
 * 10 a D1 et D2, chacun ses kilos. Le bon se prepare par l'API (le circuit du
 * bon est eprouve par saisie.spec) ; la reception, elle, se tape a l'ecran.
 */
import { test, expect, request as apiRequest } from '@playwright/test'
import { choisirRecherche, consigner, lireApi, mesurer, MDP, saisir, session } from './outils'

const URL = process.env.E2E_URL ?? 'http://127.0.0.1:8097'
const PASSAGE = Date.now().toString(36).slice(-5).toUpperCase()
const REF = 'PP-1500 Dtex-L.Beige 44377-Hs'

async function bonEnvoye(): Promise<string> {
  const ctx = await apiRequest.newContext({ baseURL: URL })
  const entete = (t: string) => ({ Authorization: `Bearer ${t}` })
  const jeton = async (login: string) => {
    const r = await ctx.post('/api/auth/connexion', { data: { login, mot_de_passe: MDP, code: null } })
    expect(r.ok(), `connexion ${login} : ${r.status()} ${await r.text()}`).toBeTruthy()
    return (await r.json()).jeton as string
  }
  const tAss = await jeton('Assistante')
  const tDir = await jeton('Choukri')
  const rBc = await ctx.post('/api/bons-commande', {
    headers: entete(tAss),
    data: {
      code_fournisseur: 'FRS-001',
      lignes: [{ code_reference: REF, unite_commande: 'kg', quantite_commandee_unite: 2064, prix_unitaire_devise: 2 }],
    },
  })
  expect(rBc.ok(), `bon : ${rBc.status()} ${await rBc.text()}`).toBeTruthy()
  const { id_bc: idBc, numero_bc: numero } = (await rBc.json()) as { id_bc: string; numero_bc: string }
  for (const [t, statut, motif] of [
    [tAss, 'EN_CONTROLE', undefined],
    [tDir, 'EN_ATTENTE_VALIDATION', 'Prix sous contrat (e2e)'],
    [tDir, 'VALIDE', undefined],
    [tDir, 'ENVOYE', undefined],
  ] as const) {
    const r = await ctx.put(`/api/bons-commande/${idBc}/statut`, { headers: entete(t), data: { statut, motif } })
    expect(r.ok(), `statut ${statut} : ${r.status()} ${await r.text()}`).toBeTruthy()
  }
  await ctx.dispose()
  return numero
}

test('réception : la même ligne de bon en deux formes du même lot fait D1 et D2', async ({ browser }, info) => {
  test.skip((info.project.use.viewport?.width ?? 1366) < 768, 'grille de bureau : sous 768 px, la pesée mobile')
  const numeroBc = await bonEnvoye()
  const lot = `LOT10-${PASSAGE}`
  const { page, veille } = await session(browser, info, 'Magasinie')
  await page.goto('/receptions/nouvelle')
  await choisirRecherche(page, page.locator('#frs'), 'FRS-001', /^FRS-001 — /)
  await saisir(page.locator('#bl'), `BL-FORMES-${PASSAGE}`)
  await choisirRecherche(page, page.getByRole('combobox', { name: 'Bon de commande' }), numeroBc)

  const nombre = (name: string) => page.getByRole('textbox', { name }).or(page.getByRole('spinbutton', { name }))
  const pesee = nombre('Quantité pesée, en kilos')
  const palettes = nombre('Nombre de palettes')
  const bobines = nombre('Nombre de bobines')
  // 1re forme : 16 palettes, 488 bobines de 3 kg.
  await saisir(page.getByRole('textbox', { name: 'Lot fournisseur' }).first(), lot)
  await saisir(pesee.first(), '1 464')
  await saisir(palettes.first(), '16')
  await saisir(bobines.first(), '488')
  // 2e forme, meme ligne de bon, meme lot : 2 palettes, 200 bobines.
  await page.getByRole('button', { name: 'Autre lot ou autre forme' }).first().click()
  await expect(pesee).toHaveCount(2)
  await saisir(pesee.nth(1), '600')
  await saisir(palettes.nth(1), '2')
  await saisir(bobines.nth(1), '200')
  const proposition = page.getByRole('checkbox', { name: /Créer un nouveau dérivé de ce lot/ })
  await expect(proposition).toBeVisible()
  await proposition.check()
  const constats = [...veille.constats, ...(await mesurer(page))]
  await page.screenshot({ path: info.outputPath('reception-deux-formes.png'), fullPage: true })
  consigner(info, 'saisie : réception en deux formes du même lot', constats, info.outputPath('reception-deux-formes.png'))

  await page.getByRole('button', { name: /^Enregistrer la r[ée]ception$/ }).click()
  await expect(page).toHaveURL(/\/receptions\/[0-9a-f-]{36}$/)
  const idReception = page.url().split('/').pop()!
  const lignes = await lireApi<Record<string, unknown>[]>(page, `/api/receptions/${idReception}/lignes`)
  expect(lignes, 'deux formes du même lot : deux lignes').toHaveLength(2)

  // Le controle puis la validation (autre compte) : D2 nait.
  await page.getByRole('button', { name: /Soumettre au contr[oô]le/ }).click()
  await expect
    .poll(async () => (await lireApi<Record<string, unknown>[]>(page, '/api/receptions')).find((r) => r.id_reception === idReception)?.statut)
    .toBe('A_CONTROLER')
  await page.context().close()

  const dir = await session(browser, info, 'Choukri')
  await dir.page.goto(`/receptions/${idReception}`)
  await dir.page.getByRole('button', { name: /^Valider le contr[oô]le$/ }).click()
  const confirmer = dir.page.getByRole('button', { name: 'Générer les lots et valider' })
  if (await confirmer.isVisible().catch(() => false)) await confirmer.click()
  await expect
    .poll(async () => {
      const d = await lireApi<{ code_derive: string; quantite_kg: number; unites_par_palette: number | null }[]>(
        dir.page,
        `/api/lots/derives?code_reference=${encodeURIComponent(REF)}&lot_fournisseur=${encodeURIComponent(lot)}`,
      )
      return d.map((x) => `${x.code_derive}:${Math.round(Number(x.quantite_kg))}`).sort().join(' ')
    })
    .toBe('D1:1464 D2:600')
  const d2 = (
    await lireApi<{ code_derive: string; unites_par_palette: number | null }[]>(
      dir.page,
      `/api/lots/derives?code_reference=${encodeURIComponent(REF)}&lot_fournisseur=${encodeURIComponent(lot)}`,
    )
  ).find((x) => x.code_derive === 'D2')!
  expect(Number(d2.unites_par_palette), 'D2 : 100 bobines par palette').toBe(100)
  expect(veille.erreurs).toEqual([])
  expect(dir.veille.erreurs).toEqual([])
  await dir.page.context().close()
})
