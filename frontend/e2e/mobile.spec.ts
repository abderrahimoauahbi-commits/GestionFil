/**
 * CAPTURE MOBILE DE LA PESEE (Receptions), 14/10/2026.
 *
 * But : prouver en images que l'ecran de reception tient au telephone — la liste
 * en cartes, la fiche, la pesee d'une ligne en feuille plein ecran, la feuille
 * d'ajout. On se place en magasinier (MAGASIN) : montants masques, c'est son
 * metier.
 *
 * Les scenarios du banc valident/cloturent leurs receptions : il n'en reste
 * aucune en brouillon. Ce spec en CREE une (API, comme le magasinier) et la
 * laisse en brouillon pour que `PeseesMobile` s'affiche.
 *
 * Largeurs : passer E2E_LARGEURS=360,390 au lanceur ; ce test herite du viewport
 * telephone du projet (voir playwright.config.ts).
 */
import { test, expect, request as apiRequest } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { connexion, MDP } from './outils'

const URL = process.env.E2E_URL ?? 'http://127.0.0.1:8097'

/** Cree un bon envoye puis une reception BROUILLON (1 ligne pesee), rend son id. */
async function creerReceptionBrouillon(): Promise<string> {
  const ctx = await apiRequest.newContext({ baseURL: URL })
  const entete = (t: string) => ({ Authorization: `Bearer ${t}` })
  const jeton = async (login: string) => {
    const r = await ctx.post('/api/auth/connexion', { data: { login, mot_de_passe: MDP, code: null } })
    expect(r.ok(), `connexion ${login} : ${r.status()} ${await r.text()}`).toBeTruthy()
    return (await r.json()).jeton as string
  }
  const tAss = await jeton('Assistante')
  const tDir = await jeton('Choukri')
  const tMag = await jeton('Magasinie')

  const rBc = await ctx.post('/api/bons-commande', {
    headers: entete(tAss),
    data: {
      code_fournisseur: 'FRS-011',
      lignes: [
        { code_reference: 'PLA 100 CHE', unite_commande: 'kg', quantite_commandee_unite: 1225, prix_unitaire_devise: 20 },
        { code_reference: 'PLA 50 CHE', unite_commande: 'kg', quantite_commandee_unite: 920, prix_unitaire_devise: 22 },
      ],
    },
  })
  expect(rBc.ok(), `bon : ${rBc.status()} ${await rBc.text()}`).toBeTruthy()
  const idBc = (await rBc.json()).id_bc as string

  // Le circuit du 21/10/2026 : controle par un autre compte, demande de prix
  // sautee avec son motif (le prix n'est pas l'objet de ce test).
  for (const [t, statut, motif] of [
    [tAss, 'EN_CONTROLE', undefined],
    [tDir, 'EN_ATTENTE_VALIDATION', 'Prix sous contrat (e2e)'],
    [tDir, 'VALIDE', undefined],
    [tDir, 'ENVOYE', undefined],
  ] as const) {
    const r = await ctx.put(`/api/bons-commande/${idBc}/statut`, { headers: entete(t), data: { statut, motif } })
    expect(r.ok(), `statut ${statut} : ${r.status()} ${await r.text()}`).toBeTruthy()
  }

  const rL = await ctx.get(`/api/bons-commande/${idBc}/lignes`, { headers: entete(tDir) })
  const brut = await rL.json()
  const lignesBc = (Array.isArray(brut) ? brut : brut.lignes ?? []) as {
    id_ligne_bc: string
    code_reference: string
  }[]
  const l0 = lignesBc[0]

  // Reception BROUILLON : une ligne pesee (une carte a montrer), une ligne reste
  // a ajouter (la feuille d'ajout la proposera). On NE soumet PAS au controle.
  const rRec = await ctx.post('/api/receptions', {
    headers: entete(tMag),
    data: {
      id_bc: idBc,
      num_bon_livraison: 'BL-MOBILE',
      lignes: [
        {
          code_reference: l0.code_reference,
          id_ligne_bc: l0.id_ligne_bc,
          unite_saisie: 'kg',
          quantite_pesee_unite: 1240,
          code_magasin_dest: 'Morocco',
          lot_fournisseur: '125',
          nb_colis_ligne: 20,
        },
      ],
    },
  })
  expect(rRec.ok(), `reception : ${rRec.status()} ${await rRec.text()}`).toBeTruthy()
  const id = (await rRec.json()).id_reception as string
  await ctx.dispose()
  return id
}

test('pesée mobile : liste → fiche → pesée → ajout', async ({ page }, info) => {
  const taille = info.project.name
  const dossier = `rapport-e2e/mobile`
  mkdirSync(dossier, { recursive: true })
  const shot = (n: string) => page.screenshot({ path: `${dossier}/${taille}-${n}.png` })

  const rid = await creerReceptionBrouillon()
  await connexion(page, 'Magasinie')

  // 1. La liste des receptions (cartes, barre du bas).
  await page.goto('/receptions')
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.waitForTimeout(400)
  await shot('01-liste')

  // 2. La fiche : en-tete replie, pesees en cartes, barre d'action.
  await page.goto(`/receptions/${rid}`)
  await page.waitForLoadState('networkidle').catch(() => undefined)
  // La premiere carte de pesee prouve que PeseesMobile est monte.
  await expect(page.locator('main li button').first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(400)
  await shot('02-fiche')
  await page.screenshot({ path: `${dossier}/${taille}-02b-fiche-complete.png`, fullPage: true })

  // 3. Peser une ligne : la feuille plein ecran.
  await page.locator('li button').first().click()
  await expect(page.getByText('Poids pesé (kg)')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(300)
  await shot('03-pesee-editeur')

  // 4. La feuille d'ajout. On recharge la fiche pour repartir d'un etat propre
  //    (l'editeur est transitoire) plutot que de fermer par un « Retour » — le
  //    bouton de l'en-tete de page porte le meme nom et piegerait le clic.
  await page.goto(`/receptions/${rid}`)
  await expect(page.locator('main li button').first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /Ajouter une ligne/i }).click()
  await expect(page.getByText('Attendu chez ce fournisseur')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(300)
  await shot('04-ajouter')
})
