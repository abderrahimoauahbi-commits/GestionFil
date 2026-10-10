/**
 * LA SAISIE REELLE : des documents tapes au clavier dans les vrais ecrans, par
 * les vrais roles, puis relus au serveur. Le nombre tape « 1 234,5 » doit etre
 * enregistre 1234,5 — ni 12345, ni 1,2345, ni vide.
 *
 * Les parcours s'enchainent comme au bureau : l'assistante cree le bon, la
 * direction le valide et l'envoie, le magasin le receptionne.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { attendu, consigner, lireApi, mesurer, saisir, session, type Constat } from './outils'

test.describe.configure({ mode: 'serial' })

/** Un suffixe par passage : rejouer les tests sur la meme base ne doit pas buter sur un doublon. */
const PASSAGE = Date.now().toString(36).slice(-5).toUpperCase()

/** Le bon cree par le premier parcours, repris par les suivants. */
let idBc = ''
let numeroBc = ''
let idReception = ''
/** La reference commandee puis recue (le plan propose d'abord ce qu'il veut). */
let refRecue = ''

/** Un champ numerique, par son nom : zone de texte au clavier decimal depuis le 10/10/2026. */
function champNombre(page: Page, options: { name: string | RegExp; exact?: boolean }) {
  return page.getByRole('textbox', options).or(page.getByRole('spinbutton', options))
}

/** Le statut d'une reception, lu au serveur (l'ecran affiche le code brut). */
async function statutReception(page: Page, id: string) {
  const liste = await lireApi<Record<string, unknown>[]>(page, '/api/receptions')
  return liste.find((r) => r.id_reception === id)?.statut
}

/** Choisir l'option d'une liste par une partie de son libelle, comme on la lit. */
async function choisirOption(liste: Locator, motif: RegExp) {
  const libelles = await liste.locator('option').allTextContents()
  const libelle = libelles.find((l) => motif.test(l))
  expect(libelle, `aucune option ${motif} dans ${JSON.stringify(libelles)}`).toBeTruthy()
  await liste.selectOption({ label: libelle! })
}

/** La premiere proposition de la liste deroulante « Référence de la ligne ». */
async function choisirReference(page: Page, motif: string) {
  const ref = page.getByRole('combobox', { name: 'Référence de la ligne' }).last()
  await ref.click()
  await ref.pressSequentially(motif, { delay: 20 })
  // La liste arrive du serveur : on attend qu'elle soit la, puis on choisit, comme
  // un utilisateur (un Entree tape trop tot ne retenait rien).
  const liste = page.getByRole('listbox')
  // La suggestion qui porte ce qu'on a tape : la liste montre d'abord le stock du
  // magasin, avant d'appliquer la frappe, et un clic trop rapide prenait sa tete.
  const premiere = liste.getByRole('option').filter({ hasText: motif }).first()
  const ailleurs = liste.getByRole('button', { name: 'Chercher dans tout le catalogue' })
  await expect(premiere.or(ailleurs)).toBeVisible({ timeout: 15_000 })
  // Le plan ne propose rien qui corresponde : l'utilisateur elargit au catalogue.
  if (await ailleurs.isVisible()) {
    await ailleurs.click()
    await ref.click()
  }
  await expect(premiere).toBeVisible({ timeout: 15_000 })
  await premiere.click()
  await expect(ref).toBeHidden()
}

test('les formats de nombre tapés dans une quantité', async ({ browser }, info) => {
  // Ce qu'un utilisateur tape, et ce qu'il attend (src/lib/nombres.ts). Depuis le
  // 10/10/2026, TOUS doivent etre lus juste : « 1.234,5 » valait 1,2345 avant.
  const formats: [string, number][] = [
    ['1234,5', 1234.5],
    ['1 234,5', 1234.5],
    ['1234.5', 1234.5],
    ['12 345,678', 12345.678],
    ['1.234,5', 1234.5],
    ['1,234.5', 1234.5],
    ['12.5', 12.5],
  ]
  const { page } = await session(browser, info, 'Assistante')
  await page.goto('/bons-commande/nouveau')
  await page.locator('#frs').selectOption('FRS-001')
  await choisirReference(page, 'PP')
  const qte = champNombre(page, { name: 'Quantité en kilos' }).first()
  const constats: Constat[] = []
  for (const [f, valeur] of formats) {
    await saisir(qte, f)
    await qte.press('Tab')
    // En quittant le champ, la saisie se range a la francaise : « 1234,5 ».
    const lu = await qte.inputValue()
    const bon = lu !== '' && Math.abs(attendu(lu) - valeur) < 1e-9
    if (!bon)
      constats.push({
        type: 'nombre-mal-lu',
        gravite: lu === '' ? 'bloquant' : 'genant',
        element: 'Quantité en kilos (bon de commande)',
        detail: `tapé « ${f} », le champ garde « ${lu} »${lu === '' ? ' (saisie perdue sans message)' : ''}`,
      })
    expect.soft(bon, `« ${f} » lu « ${lu} » au lieu de ${valeur}`).toBe(true)
  }
  // Un nombre illisible se dit (bordure rouge), il ne se devine pas.
  await saisir(qte, '1,2,3')
  await expect(qte).toHaveAttribute('aria-invalid', 'true')
  consigner(info, 'saisie : formats de nombre', constats)
  await page.context().close()
})

test('bon de commande : l’assistante le crée, au format français', async ({ browser }, info) => {
  const { page, veille } = await session(browser, info, 'Assistante')
  await page.goto('/bons-commande/nouveau')
  await page.locator('#frs').selectOption('FRS-001')
  await saisir(page.getByLabel('Observations'), 'Commande e2e : livraison en deux palettes, quai 3, avant 10 h.')
  // Une reference que les scenarios du banc ne sortent pas (regle des 50 kg par jour).
  await choisirReference(page, '6666')
  await page.getByRole('combobox', { name: 'Unité' }).first().selectOption('kg')
  await saisir(champNombre(page, { name: 'Quantité en kilos' }).first(), '1 234,5')
  await saisir(champNombre(page, { name: /^Prix .* par kg$/ }).first(), '3,75')
  await saisir(champNombre(page, { name: 'Remise en pourcentage du prix brut' }).first(), '2,5')

  const constats = [...veille.constats, ...(await mesurer(page))]
  await page.screenshot({ path: info.outputPath('bc-saisi.png'), fullPage: true })
  consigner(info, 'saisie : bon de commande (formulaire rempli)', constats, info.outputPath('bc-saisi.png'))

  await page.getByRole('button', { name: 'Creer le bon' }).click()
  await expect(page).toHaveURL(/\/bons-commande\/[0-9a-f-]{36}$/)
  idBc = page.url().split('/').pop()!

  const r = await lireApi<{ lignes?: Record<string, number>[] } | Record<string, number>[]>(
    page,
    `/api/bons-commande/${idBc}/lignes`,
  )
  const lignes = Array.isArray(r) ? r : (r.lignes ?? [])
  expect(lignes).toHaveLength(1)
  refRecue = String(lignes[0].code_reference)
  expect(Number(lignes[0].quantite_commandee_kg)).toBeCloseTo(1234.5, 4)
  expect(Number(lignes[0].prix_unitaire_devise)).toBeCloseTo(3.75, 4)
  expect(Number(lignes[0].remise_pct)).toBeCloseTo(2.5, 4)

  await page.getByRole('button', { name: /Soumettre a validation/ }).click()
  await expect(page.getByText('A valider').or(page.getByText('En attente'))).toBeVisible()
  expect(veille.erreurs).toEqual([])
  await page.context().close()
})

test('bon de commande : la direction le valide à un autre taux, puis l’envoie', async ({ browser }, info) => {
  test.skip(!idBc, 'pas de bon créé')
  const { page, veille } = await session(browser, info, 'Choukri')
  await page.goto(`/bons-commande/${idBc}`)
  await page.getByRole('button', { name: 'Valider', exact: true }).click()
  const taux = page.locator('input[inputmode=decimal]').first()
  await saisir(taux, '10,05')
  await saisir(taux.locator('xpath=ancestor::div[contains(@class,"grid")]//input').nth(1), 'Taux confirmé par la banque')
  const constats = [...veille.constats, ...(await mesurer(page))]
  await page.screenshot({ path: info.outputPath('bc-validation.png') })
  consigner(info, 'saisie : validation du bon (taux)', constats, info.outputPath('bc-validation.png'))
  await page.getByRole('button', { name: 'Valider à ce taux' }).click()

  await expect(page.getByRole('button', { name: 'Envoyer au fournisseur' })).toBeVisible()
  // L'ecran du bon lit la liste et y prend le sien : on fait de meme.
  const bons = await lireApi<Record<string, unknown>[]>(page, '/api/bons-commande')
  const entete = bons.find((b) => b.id_bc === idBc)!
  expect(entete.statut).toBe('VALIDE')
  numeroBc = String(entete.numero_bc)
  expect(Number(entete.taux_change_engage)).toBeCloseTo(10.05, 4)
  expect(entete.motif_taux_engage).toBe('Taux confirmé par la banque')

  await page.getByRole('button', { name: 'Envoyer au fournisseur' }).click()
  await expect(page.getByText('Envoye').first()).toBeVisible()
  expect(veille.erreurs).toEqual([])
  await page.context().close()
})

test('réception : le magasin reprend le bon, pèse au format français et soumet', async ({ browser }, info) => {
  test.skip(!numeroBc, 'pas de bon envoyé')
  const { page, veille } = await session(browser, info, 'Magasinie')
  await page.goto('/receptions/nouvelle')
  await page.getByRole('combobox', { name: 'Fournisseur *' }).selectOption('FRS-001')
  await saisir(page.getByLabel('Bon de livraison'), 'BL-E2E-0001')
  await saisir(page.getByLabel('Transporteur'), 'Transports Atlas Tanger')
  await saisir(champNombre(page, { name: 'Nombre de colis' }), '3')
  await saisir(champNombre(page, { name: /^Poids brut/ }), '1 260,8')
  const bons = page.getByRole('combobox', { name: 'Bon de commande' })
  const option = bons.locator('option', { hasText: numeroBc })
  await bons.selectOption({ label: (await option.textContent())!.trim() })
  await page.getByRole('button', { name: 'Reprendre les lignes' }).click()

  const pesee = champNombre(page, { name: 'Quantité pesée, en kilos' }).first()
  await saisir(champNombre(page, { name: 'Quantité du bon de livraison, en kilos' }).first(), '1 234,5')
  await saisir(pesee, '1 230,25')
  await saisir(page.getByLabel('Lot fournisseur').first(), `LOT-E2E-${PASSAGE}`)
  // Les bobines comptees : pesee, palettes et bobines sont liees ; on verifie
  // que compter les bobines n'ecrase pas la pesee tapee juste avant.
  const bobines = champNombre(page, { name: 'Nombre de bobines' }).first()
  await saisir(bobines, '474')
  const peseeApres = await pesee.inputValue()
  const constats = [...veille.constats, ...(await mesurer(page))]
  if (Math.abs(attendu(peseeApres) - 1230.25) > 1e-6)
    constats.push({
      type: 'saisie-ecrasee',
      gravite: 'bloquant',
      element: 'Quantité pesée (réception)',
      detail: `pesée tapée 1 230,25 ; après avoir compté 474 bobines, le champ affiche « ${peseeApres} »`,
    })
  await page.screenshot({ path: info.outputPath('reception-saisie.png'), fullPage: true })
  consigner(info, 'saisie : réception (formulaire rempli)', constats, info.outputPath('reception-saisie.png'))

  // Si les bobines ont recalcule la pesee, l'utilisateur la retape : c'est elle qui fait foi.
  if (Math.abs(attendu(peseeApres) - 1230.25) > 1e-6) await saisir(pesee, '1 230,25')
  await page.getByRole('button', { name: 'Enregistrer la reception' }).click()
  await expect(page).toHaveURL(/\/receptions\/[0-9a-f-]{36}$/)
  idReception = page.url().split('/').pop()!

  const lignes = await lireApi<Record<string, unknown>[]>(page, `/api/receptions/${idReception}/lignes`)
  expect(lignes).toHaveLength(1)
  expect(Number(lignes[0].quantite_stock_kg)).toBeCloseTo(1230.25, 4)
  expect(Number(lignes[0].quantite_bl_kg)).toBeCloseTo(1234.5, 4)
  expect.soft(Number(lignes[0].nb_bobines), 'bobines comptées').toBe(474)

  await page.getByRole('button', { name: /Soumettre au controle/ }).click()
  await expect.poll(() => statutReception(page, idReception)).toBe('A_CONTROLER')
  expect(veille.erreurs).toEqual([])
  await page.context().close()
})

test('réception : la direction valide le contrôle, le bon se solde', async ({ browser }, info) => {
  test.skip(!idReception, 'pas de réception soumise')
  const { page, veille } = await session(browser, info, 'Choukri')
  await page.goto(`/receptions/${idReception}`)
  await page.getByRole('button', { name: 'Valider le controle' }).click()
  const confirmer = page.getByRole('button', { name: 'Générer les lots et valider' })
  if (await confirmer.isVisible().catch(() => false)) await confirmer.click()
  await expect.poll(() => statutReception(page, idReception)).toBe('VALIDE')

  const bons = await lireApi<Record<string, unknown>[]>(page, '/api/bons-commande')
  const bc = bons.find((b) => b.id_bc === idBc)!
  expect(Number(bc.quantite_recue_kg)).toBeCloseTo(1230.25, 4)
  // Regle 6 : 1 230,25 kg sur 1 234,5 commandes, dans la tolerance de 2 % : le bon se solde.
  expect(bc.statut).toBe('CLOTURE')
  consigner(info, 'saisie : validation de la réception', [...veille.constats, ...(await mesurer(page))])
  expect(veille.erreurs).toEqual([])
  await page.context().close()
})

test('fournisseur : la direction crée une fiche longue, au format français', async ({ browser }, info) => {
  const { page, veille } = await session(browser, info, 'Mohamed')
  await page.goto('/fournisseurs')
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click()
  const nom = 'SOCIÉTÉ MAROCAINE DES FILS ET TEXTILES SYNTHÉTIQUES DU NORD SARL'
  await saisir(page.getByRole('textbox', { name: /^Code/ }), `FRS-E2E-${PASSAGE}`)
  await saisir(page.getByRole('textbox', { name: 'Raison sociale *' }), nom)
  await saisir(page.getByRole('textbox', { name: 'Contact' }), 'Mme Khadija El Amrani-Benjelloun')
  await saisir(page.getByRole('textbox', { name: 'Telephone' }), '+212 5 39 94 12 34')
  await saisir(page.getByRole('textbox', { name: 'Email' }), 'approvisionnement.fils@societe-marocaine-textiles.ma')
  await saisir(page.getByRole('textbox', { name: 'Ville' }), 'Tanger')
  await saisir(page.getByRole('textbox', { name: 'Pays *' }), 'Maroc')
  await page.getByRole('combobox', { name: 'Devise de facturation' }).selectOption('EUR')
  await saisir(champNombre(page, { name: /^Délai de paiement/ }), '90')
  await saisir(champNombre(page, { name: /^Délai de livraison/ }), '45')
  await saisir(champNombre(page, { name: /^Tolerance de pesee/ }), '2,5')
  await saisir(champNombre(page, { name: 'Note globale (/100)' }), '87,5')
  const constats = [...veille.constats, ...(await mesurer(page))]
  await page.screenshot({ path: info.outputPath('fournisseur.png'), fullPage: true })
  consigner(info, 'saisie : fiche fournisseur', constats, info.outputPath('fournisseur.png'))
  await page.getByRole('button', { name: 'Creer', exact: true }).click()

  await expect
    .poll(async () => (await lireApi<Record<string, unknown>[]>(page, '/api/fournisseurs')).some((f) => f.code_fournisseur === `FRS-E2E-${PASSAGE}`))
    .toBe(true)
  const f = (await lireApi<Record<string, unknown>[]>(page, '/api/fournisseurs')).find((x) => x.code_fournisseur === `FRS-E2E-${PASSAGE}`)!
  expect(f.nom).toBe(nom)
  expect(Number(f.tolerance_pesee_pct)).toBeCloseTo(2.5, 4)
  expect(Number(f.note_globale)).toBeCloseTo(87.5, 4)
  expect(f.code_devise).toBe('EUR')

  // La liste, avec cette raison sociale longue : rien ne doit deborder ni sortir de l'ecran.
  await page.goto('/fournisseurs')
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined)
  consigner(info, 'saisie : liste des fournisseurs (nom long)', await mesurer(page))
  expect(veille.erreurs).toEqual([])
  await page.context().close()
})

test('référence : la direction crée une fiche, poids et prix au format français', async ({ browser }, info) => {
  const { page, veille } = await session(browser, info, 'Mohamed')
  await page.goto('/catalogue')
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click()
  const code = `PP-E2E-${PASSAGE} Dtex-Beige 44377-Hs`
  await saisir(page.getByRole('textbox', { name: /^Référence/ }), code)
  await saisir(page.getByRole('textbox', { name: 'Designation *' }), 'Polypropylène 1500 deniers texturé, beige sable, bobine conique 2,6 kg')
  await page.getByRole('combobox', { name: 'Catégorie matiere *' }).selectOption({ index: 1 })
  await page.getByRole('combobox', { name: 'Fournisseur *' }).selectOption('FRS-001')
  await saisir(champNombre(page, { name: /^Densité/ }), '0,0125')
  await saisir(champNombre(page, { name: /^Poids par unité/ }), '2,597')
  await saisir(champNombre(page, { name: /^Unités par palette/ }), '240')
  await saisir(champNombre(page, { name: /^Stock minimum/ }), '1 500')
  await saisir(champNombre(page, { name: 'Couverture minimale (mois)' }), '1,5')
  await saisir(champNombre(page, { name: /^Marge de sécurité/ }), '12,5')
  await saisir(champNombre(page, { name: 'Prix par unité *' }), '3,85')
  await page.getByRole('combobox', { name: 'Devise *' }).selectOption('USD')
  const constats = [...veille.constats, ...(await mesurer(page))]

  // L'oubli d'un champ obligatoire (l'unite de stock) : le message doit dire
  // lequel, et l'ecran doit l'amener sous les yeux.
  await page.getByRole('button', { name: 'Creer', exact: true }).click()
  const message = page.getByText(/Champs? obligatoires? à renseigner|Renseignez les champs obligatoires/)
  if (await message.isVisible().catch(() => false)) {
    await page.waitForTimeout(800) // le defilement doux vers le champ
    const unite = page.getByRole('combobox', { name: /^Unité de stock/ })
    const visible = await unite.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return r.top >= 0 && r.bottom <= window.innerHeight
    })
    const texte = (await message.textContent()) ?? ''
    if (!visible || !/unit/i.test(texte))
      constats.push({
        type: 'champ-obligatoire-introuvable',
        gravite: 'genant',
        element: 'Unité de stock (fiche référence)',
        detail: `message « ${texte.trim()} »${/unit/i.test(texte) ? '' : ' sans nommer le champ'}${visible ? '' : ', champ hors de l’écran (il faut remonter le chercher)'}`,
      })
  }
  await page.getByRole('combobox', { name: /^Unité de stock/ }).selectOption({ index: 1 })
  await page.screenshot({ path: info.outputPath('reference.png'), fullPage: true })
  consigner(info, 'saisie : fiche référence', constats, info.outputPath('reference.png'))
  await page.getByRole('button', { name: 'Creer', exact: true }).click()

  const lire = async () =>
    (await lireApi<Record<string, unknown>[]>(page, '/api/catalogue')).find((r) => r.code_reference === code)
  await expect.poll(async () => !!(await lire())).toBe(true)
  const r = (await lire())!
  expect(Number(r.densite_kg_ml), 'densité').toBeCloseTo(0.0125, 6)
  expect(Number(r.poids_bobine_kg), 'poids par unité').toBeCloseTo(2.597, 4)
  expect(Number(r.bobines_par_palette), 'unités par palette').toBe(240)
  expect(Number(r.stock_min_kg), 'stock minimum').toBeCloseTo(1500, 4)
  expect(Number(r.couverture_min_mois), 'couverture').toBeCloseTo(1.5, 4)
  expect(Number(r.marge_securite_pct), 'marge').toBeCloseTo(12.5, 4)
  expect(Number(r.prix_catalogue), 'prix').toBeCloseTo(3.85, 4)
  expect(veille.erreurs).toEqual([])
  await page.context().close()
})

test('mouvement : le magasin sort 12,5 kg hors machine, avec un motif', async ({ browser }, info) => {
  const { page, veille } = await session(browser, info, 'Magasinie')
  await page.goto('/mouvements/nouveau')
  // Les listes d'en-tete ont leur etiquette (10/10/2026) : on les prend par leur nom.
  await page.getByRole('combobox', { name: /^Type de mouvement/ }).selectOption({ label: '− Sortie hors machine (atelier, échantillon, essai, réparation, prêt)' })
  await page.getByRole('combobox', { name: /^Magasin/ }).first().selectOption({ label: 'Morocco' })
  await saisir(page.getByRole('textbox', { name: /ordre de fabrication/i }), 'OF-2026-118 échantillon client')
  test.skip(!refRecue, 'pas de référence reçue')
  await choisirReference(page, refRecue)
  await saisir(champNombre(page, { name: 'Quantité en kilos' }).first(), '12,5')
  await choisirOption(page.getByRole('combobox', { name: /^Motif/ }).first(), /Sortie hors machine/)
  await choisirOption(page.getByRole('combobox', { name: 'Motif de la ligne' }).first(), /chantillon/i)
  const lot = page.locator('tbody select').filter({ has: page.locator('option', { hasText: 'Choisir un lot' }) }).first()
  if (await lot.count()) await choisirOption(lot, new RegExp(`LOT-E2E-${PASSAGE}`))
  const constats = [...veille.constats, ...(await mesurer(page))]
  await page.screenshot({ path: info.outputPath('mouvement.png'), fullPage: true })
  consigner(info, 'saisie : sortie hors machine', constats, info.outputPath('mouvement.png'))
  await page.getByRole('button', { name: 'Valider la ligne' }).first().click()
  await page.getByRole('button', { name: 'Enregistrer le mouvement' }).click()
  // L'ecran revient a la liste : on y cherche le mouvement par son ordre de fabrication.
  await expect(page).toHaveURL(/\/mouvements$/)
  const lignes = await lireApi<Record<string, unknown>[]>(page, '/api/mouvements')
  const m = lignes.find((l) => String(l.numero_of ?? '').startsWith('OF-2026-118') && l.code_reference === refRecue)
  expect(m, 'le mouvement saisi est introuvable').toBeTruthy()
  expect(m!.code_type_mvt).toBe('SORTIE_HORS_MACHINE')
  expect(Number(m!.quantite_kg)).toBeCloseTo(12.5, 4)
  expect(m!.lot_fournisseur).toBe(`LOT-E2E-${PASSAGE}`)
  expect(veille.erreurs).toEqual([])
  await page.context().close()
})
