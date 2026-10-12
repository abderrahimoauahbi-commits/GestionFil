/**
 * L'AGENT DE SAISIE : il rejoue l'activite de l'usine de janvier 2024 a
 * aujourd'hui EN TAPANT DANS LES VRAIS ECRANS, avec les vrais comptes — la
 * direction ouvre les cours, l'assistante cree les bons, la direction les
 * valide au cours du jour et les envoie, le magasin receptionne a la date du
 * bon de livraison et charge les machines, la direction valide les controles,
 * sort les matieres de l'atelier et cloture l'inventaire. Aucune ecriture ne
 * passe par l'API : l'API ne sert qu'a relire, comme un utilisateur relit
 * l'ecran.
 *
 * REPRISE. Chaque evenement fait est inscrit au journal
 * (rapport-simulation/journal.json) ; relance, l'agent reprend au premier
 * evenement non fait. Il s'arrete au premier echec, avec une capture : on
 * corrige, on relance.
 *
 * Lancement : python simulation/lancer.py (serveur d'essai sur gestionfil_saisie).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import { construirePlan, FIL, MATIERES_HORS_MACHINE, type Evenement, type Machine, type RefCatalogue } from './plan'

const MDP = process.env.SIM_MDP ?? 'Simulation-2026!'
const DOSSIER = join(process.cwd(), 'rapport-simulation')
const JOURNAL = join(DOSSIER, 'journal.json')
const SANS_LOT = 'SANS-LOT'
/** S'arreter apres N evenements (essai) ; 0 = jusqu'au bout. */
const LIMITE = Number(process.env.SIM_LIMITE ?? 0)

interface Journal {
  fait: Record<string, string>
  /** Les identifiants des documents crees, par evenement du plan. */
  ids: Record<string, string>
}
mkdirSync(DOSSIER, { recursive: true })
const journal: Journal = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, 'utf-8')) : { fait: {}, ids: {} }
const sauver = () => writeFileSync(JOURNAL, JSON.stringify(journal, null, 1))
const tracer = (ligne: string) => {
  appendFileSync(join(DOSSIER, 'journal.log'), `${new Date().toISOString().slice(0, 19)}  ${ligne}\n`)
  console.log(ligne)
}

// =============================================================================
// Les sessions : une fenetre par compte, ouverte une fois, comme au bureau
// =============================================================================

let navigateur: Browser
let baseURL = ''
const sessions = new Map<string, Page>()

async function connecter(page: Page, login: string) {
  await page.goto('/connexion')
  await page.locator('#login').fill(login)
  await page.locator('#mdp').fill(MDP)
  await page.locator('button[type=submit]').click()
  await expect(page).not.toHaveURL(/connexion/, { timeout: 30_000 })
}

async function session(login: string): Promise<Page> {
  let page = sessions.get(login)
  if (!page || page.isClosed()) {
    const contexte = await navigateur.newContext({
      viewport: { width: 1366, height: 768 },
      locale: 'fr-FR',
      timezoneId: 'Africa/Casablanca',
      baseURL,
    })
    page = await contexte.newPage()
    page.on('pageerror', (e) => tracer(`    ! JavaScript (${login}) : ${e.message.slice(0, 200)}`))
    await connecter(page, login)
    sessions.set(login, page)
  }
  await deverrouiller(page)
  return page
}

/** L'ecran se verrouille faute d'activite : on retape son mot de passe, comme au bureau. */
async function deverrouiller(page: Page) {
  const verrou = page.getByText('Session verrouillée', { exact: false })
  if (!(await verrou.isVisible().catch(() => false))) return
  await page.locator('input[type=password]').fill(MDP)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(verrou).toBeHidden({ timeout: 15_000 })
}

/** Aller a un ecran ; une session expiree se reconnecte, comme l'utilisateur. */
async function aller(page: Page, chemin: string, login: string) {
  await page.goto(chemin)
  if (/\/connexion/.test(page.url())) {
    await connecter(page, login)
    await page.goto(chemin)
  }
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined)
  await deverrouiller(page)
}

/** Relire au serveur, avec le jeton de la session (jamais pour ecrire). */
async function lire<T>(page: Page, chemin: string): Promise<T> {
  const jeton = await page.evaluate(() => sessionStorage.getItem('gestionfil.jeton'))
  const r = await page.request.get(chemin, { headers: { Authorization: `Bearer ${jeton}` } })
  if (!r.ok()) throw new Error(`lecture ${chemin} : ${r.status()} ${(await r.text()).slice(0, 200)}`)
  return (await r.json()) as T
}

// =============================================================================
// La frappe
// =============================================================================

/** Un nombre a la francaise : 2 500,5 s'ecrit « 2500,5 ». */
const fr = (n: number, dec = 2) => String(+n.toFixed(dec)).replace('.', ',')
const jjmmaaaa = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

async function taper(champ: Locator, texte: string) {
  await champ.click()
  await champ.press('Control+a')
  await champ.pressSequentially(texte)
  await champ.press('Tab')
}

const champNombre = (page: Page | Locator, nom: string | RegExp) =>
  page.getByRole('textbox', { name: nom }).or(page.getByRole('spinbutton', { name: nom }))

async function choisirOption(liste: Locator, motif: RegExp) {
  const libelles = await liste.locator('option').allTextContents()
  const libelle = libelles.find((l) => motif.test(l))
  if (!libelle) throw new Error(`aucune option ${motif} dans ${JSON.stringify(libelles).slice(0, 300)}`)
  await liste.selectOption({ label: libelle })
}

/** La reference d'une ligne, choisie dans la liste deroulante comme a la main. */
async function choisirReference(page: Page, code: string) {
  const ref = page.getByRole('combobox', { name: 'Référence de la ligne' }).last()
  await ref.click()
  await ref.pressSequentially(code)
  const liste = page.getByRole('listbox')
  const bonne = liste.getByRole('option').filter({ hasText: code }).first()
  const ailleurs = liste.getByRole('button', { name: 'Chercher dans tout le catalogue' })
  await expect(bonne.or(ailleurs)).toBeVisible({ timeout: 15_000 })
  if (!(await bonne.isVisible()) && (await ailleurs.isVisible())) {
    await ailleurs.click()
    await ref.click()
  }
  await expect(bonne).toBeVisible({ timeout: 15_000 })
  await bonne.click()
  await expect(ref).toBeHidden()
}

/** Une confirmation qui peut venir (ou non) apres un clic. */
async function confirmerSi(page: Page, nom: string | RegExp, attente = 2_500) {
  const b = page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: nom })
  if (await b.isVisible({ timeout: attente }).catch(() => false)) await b.click()
}

/** Attendre une valeur lue au serveur. */
async function attendre<T>(lecture: () => Promise<T>, test: (v: T) => boolean, quoi: string, delai = 30_000) {
  const fin = Date.now() + delai
  let v = await lecture()
  while (!test(v)) {
    if (Date.now() > fin) throw new Error(`${quoi} : toujours ${JSON.stringify(v).slice(0, 200)}`)
    await new Promise((r) => setTimeout(r, 400))
    v = await lecture()
  }
  return v
}

/** Le message d'erreur affiche, s'il y en a un (toast ou alerte). */
async function messageAffiche(page: Page) {
  const t = page.locator('[data-sonner-toast][data-type=error], [role=alert]').filter({ hasText: /\S/ })
  return (await t.allTextContents().catch(() => [])).join(' | ').slice(0, 400)
}

/** Cliquer, puis lire le message qui repond (succes ou refus), comme on le lit a l'ecran. */
async function cliquer(page: Page, bouton: Locator) {
  const toasts = page.locator('[data-sonner-toast]')
  const avant = await toasts.count()
  await bouton.click()
  await expect(toasts).toHaveCount(avant + 1, { timeout: 8_000 }).catch(() => undefined)
  const dernier = toasts.last()
  const texte = (await dernier.textContent().catch(() => '')) ?? ''
  const refus = (await dernier.getAttribute('data-type').catch(() => null)) === 'error'
  return { texte: texte.trim(), refus }
}

// =============================================================================
// Le referentiel lu au depart
// =============================================================================

let catalogue: RefCatalogue[] = []
const parCode = new Map<string, RefCatalogue>()

interface LotStock {
  code_reference: string
  code_magasin: string
  lot_fournisseur: string
  quantite_kg: number
  date_premiere_entree: string
  poids_bobine_kg: number | null
}

async function lots(page: Page, magasin: string) {
  return lire<LotStock[]>(page, `/api/stock/lots?code_magasin=${magasin}&limite=5000`)
}

/** Le plus ancien lot d'une reference au magasin, comme l'ecran le propose. */
function plusAncien(tous: LotStock[], ref: string) {
  return tous
    .filter((l) => l.code_reference === ref && l.lot_fournisseur !== SANS_LOT && l.quantite_kg > 0)
    .sort((a, b) => a.date_premiere_entree.localeCompare(b.date_premiere_entree))[0]
}

/** Un petit hasard stable par evenement : rejouer donne les memes choix. */
function hasardDe(id: string) {
  let h = 2166136261
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995)
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296
  }
}

// =============================================================================
// Les gestes
// =============================================================================

async function ouvrirTaux(e: Extract<Evenement, { type: 'TAUX' }>) {
  const p = await session('Mohamed')
  const existe = async () =>
    (await lire<{ date_debut: string }[]>(p, `/api/devises/${e.devise}/taux`)).some((t) => t.date_debut.slice(0, 10) === e.date)
  if (await existe()) return 'déjà saisi'
  if (!p.url().includes('section=devises')) await aller(p, '/configuration?section=devises', 'Mohamed')
  await p.getByRole('row').filter({ hasText: new RegExp(`^\\s*${e.devise}`) }).first().click()
  await taper(p.locator('#t'), fr(e.taux, 4))
  await p.locator('#d').fill(e.date)
  await p.getByRole('button', { name: 'Ouvrir le taux' }).click()
  await attendre(existe, (v) => v, `cours ${e.devise} du ${e.date}`)
  return `${e.devise} ${fr(e.taux, 4)}`
}

interface BonListe {
  id_bc: string
  numero_bc: string
  statut: string
  code_devise: string
}
const bon = async (p: Page, id: string) => (await lire<BonListe[]>(p, '/api/bons-commande')).find((b) => b.id_bc === id)

async function creerBon(e: Extract<Evenement, { type: 'BC' }>) {
  const login = 'Assistante'
  const p = await session(login)
  let id = journal.ids[e.id]
  if (!id) {
    await aller(p, '/bons-commande/nouveau', login)
    await p.locator('#frs').selectOption(e.fournisseur)
    await p.locator('#datebc').fill(e.date)
    await p.locator('#livr').fill(e.livraison)
    await p.locator('#notes').fill(`Simulation ${e.id} — livraison attendue le ${jjmmaaaa(e.livraison)}.`)
    for (const [i, l] of e.lignes.entries()) {
      if (i > 0) await p.getByRole('button', { name: 'Ajouter une ligne' }).click()
      await choisirReference(p, l.ref)
      const unite = p.getByRole('combobox', { name: 'Unité' }).last()
      if (await unite.isEnabled()) await unite.selectOption('kg').catch(() => undefined)
      await taper(champNombre(p, 'Quantité en kilos').last(), fr(l.kg))
      await taper(champNombre(p, /^Prix .* par kg$/).last(), fr(l.prix, 4))
    }
    await p.getByRole('button', { name: /^Cr[ée]er le bon$/ }).click()
    await expect(p).toHaveURL(/\/bons-commande\/[0-9a-f-]{36}$/, { timeout: 30_000 }).catch(async () => {
      throw new Error(`bon non créé : ${await messageAffiche(p)}`)
    })
    id = p.url().split('/').pop()!
    journal.ids[e.id] = id
    sauver()
    const r = await lire<{ lignes?: { code_reference: string }[] } | { code_reference: string }[]>(p, `/api/bons-commande/${id}/lignes`)
    const lignes = Array.isArray(r) ? r : (r.lignes ?? [])
    if (lignes.length !== e.lignes.length) throw new Error(`bon ${id} : ${lignes.length} ligne(s) au lieu de ${e.lignes.length}`)
  } else await aller(p, `/bons-commande/${id}`, login)
  const b = await bon(p, id)
  if (b?.statut === 'BROUILLON') {
    await p.getByRole('button', { name: /Soumettre [aà] validation/ }).click()
    await attendre(async () => (await bon(p, id))?.statut, (s) => s !== 'BROUILLON', 'soumission du bon')
  }
  return `${b?.numero_bc} ${e.fournisseur} ${e.lignes.length} ligne(s), ${fr(e.lignes.reduce((s, l) => s + l.kg, 0), 0)} kg`
}

async function validerBon(e: Extract<Evenement, { type: 'BC_VALIDER' }>) {
  const login = 'Choukri'
  const p = await session(login)
  const id = journal.ids[e.bc]
  if (!id) throw new Error(`bon ${e.bc} absent du journal`)
  await aller(p, `/bons-commande/${id}`, login)
  let b = (await bon(p, id))!
  if (b.statut === 'EN_ATTENTE_VALIDATION') {
    await p.getByRole('button', { name: 'Valider', exact: true }).click()
    const taux = p.locator('#ch-boncommande-1')
    if (await taux.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Le cours du jour de la validation, celui que la banque a confirme a l'epoque.
      await taper(taux, fr(e.taux, 4))
      const motif = p.locator('#ch-boncommande-2')
      if (await motif.isVisible().catch(() => false))
        await motif.fill(`Cours BAM du ${jjmmaaaa(e.date)} (bon saisi après coup)`)
      await p.getByRole('button', { name: 'Valider à ce taux' }).click()
      await confirmerSi(p, 'Je confirme ce taux', 5_000)
    } else await confirmerSi(p, /Valider/)
    b = await attendre(async () => (await bon(p, id))!, (x) => x.statut === 'VALIDE', `validation du bon : ${await messageAffiche(p)}`)
  }
  if (b.statut === 'VALIDE') {
    await p.getByRole('button', { name: 'Envoyer au fournisseur' }).click()
    await confirmerSi(p, /Envoyer/)
    b = await attendre(async () => (await bon(p, id))!, (x) => x.statut === 'ENVOYE', 'envoi du bon')
  }
  return `${b.numero_bc} ${b.statut}${b.code_devise !== 'MAD' ? ` au taux ${fr(e.taux, 4)}` : ''}`
}

interface ReceptionListe {
  id_reception: string
  numero_reception: string
  statut: string
}
const reception = async (p: Page, id: string) =>
  (await lire<ReceptionListe[]>(p, '/api/receptions')).find((r) => r.id_reception === id)

/**
 * LES BOBINES COMPTEES : le poids reel d'une bobine s'ecarte un peu du catalogue
 * (le fournisseur derive) ; le compte est celui du quai, jamais deduit des kilos.
 */
function bobinesComptees(ref: string, pese: number, graine: string) {
  const poids = parCode.get(ref)?.poids_bobine_kg ?? 0
  if (!(poids > 0)) return 0
  const alea = hasardDe(`${graine}-${ref}`)
  return Math.max(1, Math.round((pese / poids) * (0.985 + alea() * 0.03)))
}

/** Un brouillon repris : les bobines manquantes se comptent sur l'ecran de la reception. */
async function completerBobines(p: Page, rid: string, e: Extract<Evenement, { type: 'RECEPTION' }>) {
  const lues = await lire<{ code_reference: string; nb_bobines: number | null; quantite_stock_kg: number }[]>(p, `/api/receptions/${rid}/lignes`)
  const manquent = lues.filter((l) => l.nb_bobines == null && (parCode.get(l.code_reference)?.poids_bobine_kg ?? 0) > 0)
  if (!manquent.length) return
  for (const l of manquent) {
    const principale = p.getByRole('row').filter({ hasText: l.code_reference }).filter({ has: p.getByRole('button', { name: /(Modifier|Valider) la ligne/ }) }).first()
    const ligne = principale.locator('xpath=self::tr | following-sibling::tr[1]')
    const modifier = principale.getByRole('button', { name: 'Modifier la ligne' })
    if (await modifier.isVisible().catch(() => false)) await modifier.click()
    const detacher = ligne.getByRole('button', { name: 'Détacher le calcul' }).first()
    if (await detacher.isVisible().catch(() => false)) await detacher.click()
    await taper(champNombre(ligne, 'Nombre de bobines').first(), String(bobinesComptees(l.code_reference, Number(l.quantite_stock_kg), e.id)))
    await principale.getByRole('button', { name: 'Valider la ligne' }).click()
  }
  const m = await cliquer(p, p.getByRole('button', { name: 'Enregistrer', exact: true }))
  if (m.refus) throw new Error(`bobines non enregistrées : ${m.texte}`)
  const refs = new Set(manquent.map((l) => l.code_reference))
  await attendre(
    () => lire<{ code_reference: string; nb_bobines: number | null }[]>(p, `/api/receptions/${rid}/lignes`),
    (ls) => ls.filter((x) => refs.has(x.code_reference)).every((x) => x.nb_bobines != null),
    'bobines comptées',
  )
}

async function receptionner(e: Extract<Evenement, { type: 'RECEPTION' }>) {
  const idBc = journal.ids[e.bc]
  if (!idBc) throw new Error(`bon ${e.bc} absent du journal`)
  const login = 'Magasinie'
  const p = await session(login)
  let rid = journal.ids[e.id]
  if (!rid) {
    const b = (await bon(p, idBc))!
    if (b.statut !== 'ENVOYE' && b.statut !== 'PARTIELLEMENT_RECU') throw new Error(`bon ${b.numero_bc} en ${b.statut}`)
    await aller(p, '/receptions/nouvelle', login)
    await p.getByRole('combobox', { name: 'Fournisseur *' }).selectOption(e.fournisseur)
    await p.locator('#date-rec').fill(e.date)
    await p.getByLabel('Bon de livraison').fill(`BL-${e.date.replace(/-/g, '')}-${e.fournisseur.slice(-3)}`)
    await p.getByLabel('Transporteur').fill(e.fournisseur === 'FRS-011' || e.fournisseur === 'FRS-012' ? 'Livraison fournisseur' : 'Transit Tanger Med')
    const totalBl = e.lignes.reduce((s, l) => s + l.bl, 0)
    await taper(champNombre(p, 'Nombre de colis'), String(Math.max(1, Math.round(totalBl / 900))))
    await taper(champNombre(p, /^Poids brut/), fr(totalBl * 1.035, 1))
    const bons = p.getByRole('combobox', { name: 'Bon de commande' })
    await choisirOption(bons, new RegExp(b.numero_bc))
    await p.getByRole('button', { name: 'Reprendre les lignes' }).click()
    const pesees = champNombre(p, 'Quantité pesée, en kilos')
    await expect(pesees).toHaveCount(e.lignes.length, { timeout: 15_000 })
    for (const [i, l] of e.lignes.entries()) {
      // La ligne et sa ligne complementaire (colis, lot, magasin) depuis le 10/10/2026.
      const ligne = pesees.nth(i).locator('xpath=ancestor::tr[1] | ancestor::tr[1]/following-sibling::tr[1]')
      // Peser et compter sont deux gestes : on detache le calcul, sinon compter
      // les bobines recalculerait la pesee (ou l'inverse).
      const detacher = ligne.getByRole('button', { name: 'Détacher le calcul' }).first()
      if (await detacher.isVisible().catch(() => false)) await detacher.click()
      await taper(champNombre(p, 'Quantité du bon de livraison, en kilos').nth(i), fr(l.bl, 1))
      await taper(pesees.nth(i), fr(l.pese, 2))
      const bob = bobinesComptees(l.ref, l.pese, e.id)
      if (bob) await taper(champNombre(ligne, 'Nombre de bobines').first(), String(bob))
      if (parCode.get(l.ref)?.suivi_lot === 1) await p.getByLabel('Lot fournisseur').nth(i).fill(l.lot)
      await p.getByRole('combobox', { name: 'Magasin destinataire' }).nth(i).selectOption(l.magasin)
    }
    await p.getByRole('button', { name: /^Enregistrer la r[ée]ception$/ }).click()
    await expect(p).toHaveURL(/\/receptions\/[0-9a-f-]{36}$/, { timeout: 30_000 }).catch(async () => {
      throw new Error(`réception non créée : ${await messageAffiche(p)}`)
    })
    rid = p.url().split('/').pop()!
    journal.ids[e.id] = rid
    sauver()
    // Ce qui est enregistre doit etre ce qui a ete tape, ligne par ligne.
    const lignes = await lire<{ code_reference: string; quantite_stock_kg: number }[]>(p, `/api/receptions/${rid}/lignes`)
    for (const l of e.lignes) {
      const lu = lignes.find((x) => x.code_reference === l.ref)
      if (!lu || Math.abs(Number(lu.quantite_stock_kg) - l.pese) > 0.01)
        throw new Error(`réception ${rid} : ${l.ref} enregistré ${lu?.quantite_stock_kg} kg au lieu de ${l.pese}`)
    }
  } else await aller(p, `/receptions/${rid}`, login)
  let r = (await reception(p, rid))!
  if (r.statut === 'BROUILLON') await completerBobines(p, rid, e)
  if (r.statut === 'BROUILLON') {
    const m = await cliquer(p, p.getByRole('button', { name: /Soumettre au contr[oô]le/ }))
    if (m.refus) throw new Error(`soumission refusée : ${m.texte}`)
    r = await attendre(async () => (await reception(p, rid))!, (x) => x.statut !== 'BROUILLON', `soumission de la réception (${m.texte})`)
  }
  if (r.statut === 'A_CONTROLER') {
    const d = await session('Choukri')
    await aller(d, `/receptions/${rid}`, 'Choukri')
    await d.getByRole('button', { name: /^Valider le contr[oô]le$/ }).click()
    await confirmerSi(d, 'Générer les lots et valider')
    r = await attendre(async () => (await reception(d, rid))!, (x) => x.statut === 'VALIDE', `validation de la réception : ${await messageAffiche(d)}`)
  }
  return `${r.numero_reception} ${r.statut}, ${fr(e.lignes.reduce((s, l) => s + l.pese, 0), 1)} kg`
}

// --- Les machines -----------------------------------------------------------

interface LigneEtage {
  code_reference: string
  lot_fournisseur: string
  nb_bobines: number
  kg: number
  pourcentage: number | null
}
interface FicheListe {
  id_fiche: string
  numero_fiche: string
  statut: string
  type_fiche: string
  numero_of: string | null
}
const RESPONSABLES = ['Hassan Benali', 'Youssef Amrani', 'Rachid Mernissi', 'Said Ouazzani']

async function ficheFaite(p: Page, machine: string, zone: string, of: string) {
  const f = await lire<FicheListe[]>(p, `/api/machines/fiches?code_machine=${machine}&code_emplacement=${zone}`)
  return f.find((x) => x.numero_of === of && x.statut === 'VALIDE')
}

/** Apercu, puis validation, puis le bandeau de succes ; tout blocage s'arrete la, en clair. */
async function validerFiche(p: Page) {
  await p.getByRole('button', { name: 'Aperçu' }).click()
  await expect(p.getByText('Aperçu — ce que la validation enregistrera').or(p.getByText('Aperçu impossible'))).toBeVisible({ timeout: 20_000 })
  const valider = p.getByRole('button', { name: 'Valider la décision' })
  if (!(await valider.isEnabled())) throw new Error(`fiche non validable : ${await messageAffiche(p)}`)
  await valider.click()
  await confirmerSi(p, 'Valider quand même')
  await expect(p.getByText(/Décision validée/).or(p.getByText('Validation refusée'))).toBeVisible({ timeout: 30_000 })
  if (await p.getByText('Validation refusée').isVisible()) throw new Error(`validation refusée : ${await messageAffiche(p)}`)
  const texte = (await p.getByText(/consommation [\d\s ,]+ kg/).first().textContent().catch(() => '')) ?? ''
  return texte.match(/consommation ([\d\s ,]+) kg/)?.[1]?.trim() ?? '?'
}

async function entete(p: Page, date: string, of: string, responsable: string, magasin?: string) {
  await p.getByLabel('Date', { exact: true }).fill(date)
  if (magasin) await p.getByLabel(/^Magasin d.origine/).selectOption(magasin)
  await p.getByLabel('Ordre de fabrication').fill(of)
  await p.getByLabel('Responsable').fill(responsable)
}

async function machine(e: Extract<Evenement, { type: 'MACHINE' }>) {
  const login = 'Magasinie'
  const p = await session(login)
  const alea = hasardDe(e.id)
  const responsable = RESPONSABLES[Math.floor(alea() * RESPONSABLES.length)]
  const ofConstat = `SIM-${e.date}-${e.zone}-C`
  const ofCharge = `SIM-${e.date}-${e.zone}-CH`
  const compte: string[] = []

  // 1. LE CONSTAT : ce qui reste sur l'etage depuis le dernier chargement.
  let etat = (await lire<LigneEtage[]>(p, `/api/machines/${e.machine}/zones/${e.zone}`)).filter((l) => l.nb_bobines > 0)
  let garde: LigneEtage | undefined
  if (etat.length && !(await ficheFaite(p, e.machine, e.zone, ofConstat))) {
    await aller(p, `/machines/${e.machine}/fiche/MAJ/${e.zone}`, login)
    await entete(p, e.date, ofConstat, responsable)
    const grille = p.locator('table').filter({ has: p.locator('th', { hasText: 'Présentes' }) })
    const lignes = grille.locator('tbody tr')
    await expect(lignes).toHaveCount(etat.length, { timeout: 15_000 })
    // Une ligne sur l'etage reste entamee (30 a 45 %) ; les autres sont finies.
    // Seule une ligne encore bien pleine (40 % et plus) peut rester entamee ; elle
    // descend toujours sous son dernier constat, jamais au-dessus.
    const pleines = etat.filter((l) => (l.pourcentage ?? 100) >= 40)
    garde = pleines.length && (etat.length > 1 || alea() < 0.5) ? pleines[Math.floor(alea() * pleines.length)] : undefined
    for (let i = 0; i < etat.length; i++) {
      const ligne = lignes.nth(i)
      const lot = ((await ligne.locator('td').nth(1).textContent()) ?? '').trim()
      const cases = ligne.locator('input[inputmode=decimal]')
      if (garde && lot === garde.lot_fournisseur) await taper(cases.nth(1), fr((garde.pourcentage ?? 100) * (0.35 + alea() * 0.25), 1))
      else await taper(cases.nth(0), '0')
      await ligne.getByLabel('Précision du motif').fill('Constat de production')
    }
    compte.push(`constat ${await validerFiche(p)} kg consommés`)
  }

  // 2. LE CHARGEMENT : deux ou trois fils du magasin le mieux pourvu, lot le plus ancien d'abord.
  if (!(await ficheFaite(p, e.machine, e.zone, ofCharge))) {
    etat = (await lire<LigneEtage[]>(p, `/api/machines/${e.machine}/zones/${e.zone}`)).filter((l) => l.nb_bobines > 0)
    const occupees = etat.reduce((s, l) => s + l.nb_bobines, 0)
    const surEtage = new Set(etat.map((l) => l.code_reference))
    const stocks = await Promise.all(['Polyfashions', 'Morocco'].map(async (m) => ({ m, lots: await lots(p, m) })))
    const fil = (l: LotStock) => FIL.includes(parCode.get(l.code_reference)?.code_categorie ?? '') && (l.poids_bobine_kg ?? 0) > 0
    const total = (s: { lots: LotStock[] }) => s.lots.filter(fil).reduce((t, l) => t + l.quantite_kg, 0)
    const { m: magasin, lots: dispo } = stocks.sort((a, b) => total(b) - total(a))[0]
    const candidats = [...new Set(dispo.filter(fil).map((l) => l.code_reference))]
      .filter((r) => !surEtage.has(r))
      .map((r) => ({ r, lot: plusAncien(dispo, r)! }))
      // Le poids d'une bobine suit les receptions : celui du jour, relu avec les lots.
      .map((c) => ({ ...c, poids: Number(c.lot?.poids_bobine_kg ?? parCode.get(c.r)!.poids_bobine_kg) }))
      .filter((c) => c.lot && Math.floor(c.lot.quantite_kg / (c.poids * 1.01)) >= 40)
      .sort((a, b) => b.lot.quantite_kg - a.lot.quantite_kg)
    let places = e.capacite - occupees
    const choix: { r: string; lot: string; bobines: number }[] = []
    for (const c of candidats.slice(0, 8).sort(() => alea() - 0.5)) {
      if (choix.length >= 2 + Math.floor(alea() * 2) || places < 40) break
      const voulu = 150 + Math.floor(alea() * 300)
      const bobines = Math.min(voulu, Math.floor(c.lot.quantite_kg / (c.poids * 1.01)), places)
      if (bobines < 40) continue
      choix.push({ r: c.r, lot: c.lot.lot_fournisseur, bobines })
      places -= bobines
    }
    if (!choix.length) compte.push('rien à charger (pas de fil en stock)')
    else {
      await aller(p, `/machines/${e.machine}/fiche/CHARGE/${e.zone}`, login)
      await entete(p, e.date, ofCharge, responsable, magasin)
      const grille = p.locator('table').filter({ has: p.locator('th', { hasText: 'À charger' }) })
      for (const c of choix) {
        await p.getByRole('button', { name: 'Ajouter une référence' }).click()
        const liste = p.locator('select').filter({ has: p.locator('option', { hasText: 'Choisir une référence…' }) })
        await expect(liste.locator(`option[value="${CSS_escape(c.r)}"]`)).toHaveCount(1, { timeout: 15_000 })
        await liste.selectOption(c.r)
        const ligne = grille.locator('tbody tr').last()
        await ligne.getByRole('combobox', { name: 'Lot fournisseur' }).selectOption(c.lot)
        await taper(ligne.locator('input[inputmode=decimal]').nth(0), String(c.bobines))
      }
      await validerFiche(p)
      compte.push(`chargé ${choix.map((c) => `${c.bobines} bob. ${c.r}`).join(', ')} depuis ${magasin}`)
    }
  }
  return compte.join(' ; ') || 'déjà fait'
}

/** Les valeurs d'attribut passent par des guillemets : on echappe ce qui les casserait. */
function CSS_escape(v: string) {
  return v.replace(/["\\]/g, '\\$&')
}

// --- Les sorties d'atelier --------------------------------------------------

interface MouvementListe {
  numero_of: string | null
}

async function sortir(e: Extract<Evenement, { type: 'SORTIE' }>) {
  // Au-dela de 50 kg par jour et par reference, la sortie demande la direction (regle 1).
  const login = 'Choukri'
  const p = await session(login)
  const alea = hasardDe(e.id)
  const bilan: string[] = []
  for (const magasin of ['Polyfashions', 'Morocco']) {
    const of = `SIM-${e.date}-${magasin}`
    const deja = await lire<MouvementListe[]>(p, `/api/mouvements/documents?depuis=${e.date}&jusqu_a=${e.date}T23:59:59&limite=500`)
    if (deja.some((m) => (m.numero_of ?? '').startsWith(of))) continue
    const tous = (await lots(p, magasin)).filter((l) => MATIERES_HORS_MACHINE.includes(parCode.get(l.code_reference)?.code_categorie ?? ''))
    // LE STOCK DU MAGASIN fait foi pour une matiere non suivie au lot : une sortie
    // sans lot ne diminue pas les soldes par lot, qui la surestimeraient.
    const magasinStock = (await lire<{ code_reference: string; quantite_kg: number }[]>(p, `/api/stock?code_magasin=${magasin}&limite=5000`))
      .filter((x) => MATIERES_HORS_MACHINE.includes(parCode.get(x.code_reference)?.code_categorie ?? '') && Number(x.quantite_kg) > 0)
    const refs = [...new Set([...tous.map((l) => l.code_reference), ...magasinStock.map((x) => x.code_reference)])]
    const lignes = refs
      .map((r) => {
        const suivi = parCode.get(r)?.suivi_lot === 1
        const ancien = suivi ? plusAncien(tous, r) : undefined
        const stock = suivi ? (ancien?.quantite_kg ?? 0) : Number(magasinStock.find((x) => x.code_reference === r)?.quantite_kg ?? 0)
        return { r, lot: ancien?.lot_fournisseur, kg: Math.floor(stock * (0.3 + alea() * 0.4)) }
      })
      .filter((l) => l.kg >= 20)
    if (!lignes.length) continue
    await aller(p, '/mouvements/nouveau', login)
    await p.getByRole('combobox', { name: /^Type de mouvement/ }).selectOption({ label: '− Sortie hors machine (atelier, échantillon, essai, réparation, prêt)' })
    await p.getByRole('combobox', { name: /^Magasin/ }).first().selectOption(magasin)
    await p.locator('#mvt-6').fill(e.date)
    await p.getByRole('textbox', { name: /ordre de fabrication/i }).fill(`${of} atelier finition`)
    await choisirOption(p.getByRole('combobox', { name: /^Motif/ }).first(), /Sortie hors machine/)
    for (const [i, l] of lignes.entries()) {
      if (i > 0) await p.getByRole('button', { name: 'Ajouter une ligne' }).click()
      await choisirReference(p, l.r)
      await taper(champNombre(p, 'Quantité en kilos').last(), String(l.kg))
      await choisirOption(p.getByRole('combobox', { name: 'Motif de la ligne' }).last(), /atelier/i)
      if (l.lot) {
        const lot = p.locator('tbody select').filter({ has: p.locator('option', { hasText: 'Choisir un lot' }) }).last()
        await choisirOption(lot, new RegExp(l.lot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      }
      await p.getByRole('button', { name: 'Valider la ligne' }).last().click()
    }
    await p.getByRole('button', { name: 'Enregistrer le mouvement' }).click()
    await expect(p).toHaveURL(/\/mouvements$/, { timeout: 30_000 }).catch(async () => {
      throw new Error(`sortie non enregistrée : ${await messageAffiche(p)}`)
    })
    bilan.push(`${magasin} : ${lignes.map((l) => `${l.kg} kg ${l.r}`).join(', ')}`)
  }
  return bilan.join(' ; ') || 'rien à sortir'
}

// --- L'import (fournisseurs etrangers) ----------------------------------------

interface DossierApi {
  dossier?: { statut?: string; numero?: string; numero_dum?: string | null }
  factures?: { id_facture: string; numero_facture: string }[]
  lignes?: { code_reference: string }[]
  frais?: { libelle?: string | null; montant_devise?: number }[]
  statut?: string
  numero?: string
  numero_dum?: string | null
}
const dossierApi = (p: Page, id: string) => lire<DossierApi>(p, `/api/import/dossiers/${id}`)
const statutDossier = (d: DossierApi) => d.dossier?.statut ?? d.statut
const numeroDossier = (d: DossierApi) => d.dossier?.numero ?? d.numero ?? ''

/** Le dossier et la facture du fournisseur, a l'expedition : l'assistante les saisit. */
async function importDossier(e: Extract<Evenement, { type: 'IMPORT_DOSSIER' }>) {
  const login = 'Assistante'
  const p = await session(login)
  const idBc = journal.ids[e.bc]
  if (!idBc) throw new Error(`bon ${e.bc} absent du journal`)
  let id = journal.ids[e.id]
  if (!id) {
    await aller(p, '/import', login)
    await p.getByRole('button', { name: /Nouveau dossier/ }).first().click()
    await p.locator('#ch-dossiersimport-2').fill(e.arrivee)
    await p.locator('#ch-dossiersimport-3').fill(e.bl)
    await p.locator('#ch-dossiersimport-4').fill(e.conteneur)
    await p.getByRole('button', { name: 'Créer le dossier' }).click()
    await expect(p).toHaveURL(/\/import\/[0-9a-f-]{36}$/, { timeout: 30_000 }).catch(async () => {
      throw new Error(`dossier non créé : ${await messageAffiche(p)}`)
    })
    id = p.url().split('/').pop()!
    journal.ids[e.id] = id
    sauver()
  }
  const d = await dossierApi(p, id)
  if ((d.factures ?? []).length === 0) {
    const bc = (await bon(p, idBc))!
    const lignesBc = await lire<{ lignes?: { code_reference: string; ligne_numero: number }[] } | { code_reference: string; ligne_numero: number }[]>(
      p, `/api/bons-commande/${idBc}/lignes`)
    const lbc = Array.isArray(lignesBc) ? lignesBc : (lignesBc.lignes ?? [])
    await aller(p, `/import/${id}/factures/nouvelle`, login)
    await p.locator('#ch-factureimport-1').selectOption(e.fournisseur)
    await p.locator('#ch-factureimport-2').fill(e.facture)
    await p.locator('#ch-factureimport-3').fill(e.date)
    // Le taux se propose (cours de reference du jour de la facture) ; un ecart se confirme.
    await expect(p.locator('#ch-factureimport-6')).not.toHaveValue('', { timeout: 15_000 })
    const confirme = p.getByRole('checkbox', { name: /Je confirme ce taux/ })
    if (await confirme.isVisible().catch(() => false)) await confirme.check()
    const grille = p.locator('table').filter({ has: p.locator('th', { hasText: 'Poids net kg' }) })
    // Les lignes principales seulement : la complementaire porte aussi une liste (l'unite).
    const rangees = grille.locator('tbody > tr').filter({ has: p.locator('[aria-label="Référence de la ligne"]') })
    for (const [i, l] of e.lignes.entries()) {
      if ((await rangees.count()) <= i) await p.getByRole('button', { name: 'Ligne', exact: true }).click()
      const r = rangees.nth(i)
      const n = lbc.find((x) => x.code_reference === l.ref)?.ligne_numero
      // Depuis le 10/10/2026, la ligne de facture a ses etiquettes et une ligne
      // complementaire ; l'ancien ecran se reperait par colonne.
      const zone = r.locator('xpath=self::tr | following-sibling::tr[1]')
      const etiquete = (await zone.getByRole('combobox', { name: 'Bon de commande de la ligne' }).count()) > 0
      await choisirOption(
        etiquete ? zone.getByRole('combobox', { name: 'Bon de commande de la ligne' }) : r.locator('td').nth(2).locator('select'),
        new RegExp(`^${bc.numero_bc} · l\\.${n} ·`),
      )
      const detacher = zone.getByRole('button', { name: 'Détacher le calcul' }).first()
      if (await detacher.isVisible().catch(() => false)) await detacher.click()
      await (etiquete ? zone.getByRole('textbox', { name: 'Lot de la ligne' }) : r.locator('td').nth(3).locator('input')).fill(l.lot)
      await taper(etiquete ? zone.getByRole('textbox', { name: 'Poids net en kilos' }) : r.locator('td').nth(7).locator('input'), fr(l.bl, 1))
      const poids = parCode.get(l.ref)?.poids_bobine_kg ?? 0
      if (poids > 0)
        await taper(
          etiquete ? zone.getByRole('textbox', { name: 'Bobines de la ligne' }) : r.locator('td').nth(9).locator('input'),
          String(Math.round(l.bl / poids)),
        )
    }
    await p.getByRole('button', { name: 'Enregistrer la facture' }).click()
    await expect(p).toHaveURL(/\/factures\/[0-9a-f-]{36}$/, { timeout: 30_000 }).catch(async () => {
      throw new Error(`facture non enregistrée : ${await messageAffiche(p)}`)
    })
    journal.ids[`${e.id}:facture`] = e.facture
    sauver()
    const apres = await dossierApi(p, id)
    if ((apres.lignes ?? []).length < e.lignes.length)
      throw new Error(`facture du dossier ${numeroDossier(apres)} : ${(apres.lignes ?? []).length} ligne(s) au lieu de ${e.lignes.length}`)
  }
  return `dossier ${numeroDossier(await dossierApi(p, id))} : facture ${e.facture}, ${e.lignes.length} ligne(s), arrivée prévue ${jjmmaaaa(e.arrivee)}`
}

/** A l'arrivee : la DUM et les frais (transitaire, droits, transport), saisis par l'assistante. */
async function importDedouanement(e: Extract<Evenement, { type: 'IMPORT_DEDOUANEMENT' }>) {
  const login = 'Assistante'
  const p = await session(login)
  const id = journal.ids[e.dossier]
  if (!id) throw new Error(`dossier ${e.dossier} absent du journal`)
  let d = await dossierApi(p, id)
  await aller(p, `/import/${id}`, login)
  if (!(d.dossier?.numero_dum ?? d.numero_dum)) {
    await p.locator('#ch-dossierimport-4').fill(e.dum)
    await p.locator('#ch-dossierimport-5').fill('010')
    await p.locator('#ch-dossierimport-6').fill(e.date)
    await p.getByRole('button', { name: 'Enregistrer', exact: true }).first().click()
    await attendre(() => dossierApi(p, id), (x) => !!(x.dossier?.numero_dum ?? x.numero_dum), `DUM du dossier : ${await messageAffiche(p)}`)
  }
  await p.getByRole('tab', { name: /Frais/ }).first().click()
  for (const f of e.frais) {
    d = await dossierApi(p, id)
    if ((d.frais ?? []).some((x) => x.libelle === f.libelle)) continue
    const avant = (d.frais ?? []).length
    const type = p.getByRole('combobox', { name: 'Type de frais' })
    const options = (await type.locator('option').allTextContents()).filter((o) => !/^Nouveau frais/.test(o))
    await type.selectOption({ label: options.find((o) => f.motif.test(o)) ?? options[0] })
    await p.getByRole('textbox', { name: 'Libellé du frais' }).fill(f.libelle)
    await p.getByRole('textbox', { name: 'N° de pièce' }).fill(`${e.dum}-${avant + 1}`)
    await p.getByRole('combobox', { name: 'Devise du frais' }).selectOption('MAD')
    await taper(p.getByRole('textbox', { name: 'Montant en devise' }), fr(f.montant, 2))
    await p.getByRole('button', { name: 'Ajouter', exact: true }).click()
    await attendre(() => dossierApi(p, id), (x) => (x.frais ?? []).length > avant, `frais ${f.libelle} : ${await messageAffiche(p)}`)
  }
  return `DUM ${e.dum} ; frais ${e.frais.map((f) => `${f.libelle} ${f.montant} MAD`).join(', ')}`
}

interface ReceptionImportApi {
  statut?: string
  numero?: string
  reception?: { statut?: string; numero?: string }
}
const receptionImport = async (p: Page, rid: string) => {
  const r = await lire<ReceptionImportApi>(p, `/api/import/receptions/${rid}`)
  return { statut: r.reception?.statut ?? r.statut ?? '', numero: r.reception?.numero ?? r.numero ?? '' }
}

/** La reception d'import : le magasin pese et compte, la direction valide le controle. */
async function importReception(e: Extract<Evenement, { type: 'IMPORT_RECEPTION' }>) {
  const idDossier = journal.ids[e.dossier]
  if (!idDossier) throw new Error(`dossier ${e.dossier} absent du journal`)
  const login = 'Magasinie'
  const p = await session(login)
  let rid = journal.ids[e.id]
  if (!rid) {
    await aller(p, '/receptions-import/nouvelle', login)
    await p.locator('#ch-receptionimport-2').fill(e.date)
    await p.getByRole('combobox', { name: 'Dossier' }).selectOption(idDossier)
    // SEULEMENT LES LIGNES DE SA FACTURE : un autre utilisateur peut avoir ajoute la
    // sienne au dossier (c'est arrive le 10/10/2026), elle ne se recoit pas ici. Le
    // numero de facture est masque au magasin : la ligne se reconnait a sa reference
    // et a son lot.
    const aRecevoir = p.locator('table').filter({ has: p.getByRole('checkbox', { name: 'Tout sélectionner' }) }).locator('tbody tr')
    for (const l of e.lignes) await aRecevoir.filter({ hasText: l.ref }).filter({ hasText: l.lot }).first().click()
    await p.getByRole('button', { name: /Ajouter la sélection/ }).click()
    const poidsRecus = p.getByRole('textbox', { name: 'Poids reçu en kg' })
    await expect(poidsRecus).toHaveCount(e.lignes.length, { timeout: 15_000 })
    for (const l of e.lignes) {
      const r = p.getByRole('row').filter({ hasText: l.ref }).filter({ has: p.getByRole('textbox', { name: 'Poids reçu en kg' }) }).first()
      const detacher = r.getByRole('button', { name: 'Détacher le calcul' })
      if (await detacher.isVisible().catch(() => false)) await detacher.click()
      await taper(r.getByRole('textbox', { name: 'Poids reçu en kg' }), fr(l.pese, 2))
      const bob = bobinesComptees(l.ref, l.pese, e.id)
      if (bob) await taper(r.getByRole('textbox', { name: 'Bobines' }), String(bob))
      await r.getByRole('combobox', { name: 'Magasin' }).selectOption(l.magasin)
      const lot = r.getByLabel('Lot')
      if (await lot.count()) await lot.fill(l.lot)
      await r.getByRole('button', { name: 'Valider la ligne' }).click()
    }
    await p.getByRole('button', { name: 'Enregistrer', exact: true }).last().click()
    await expect(p).toHaveURL(/\/receptions-import\/[0-9a-f-]{36}$/, { timeout: 30_000 }).catch(async () => {
      throw new Error(`réception d'import non créée : ${await messageAffiche(p)}`)
    })
    rid = p.url().split('/').pop()!
    journal.ids[e.id] = rid
    sauver()
  } else await aller(p, `/receptions-import/${rid}`, login)
  let r = await receptionImport(p, rid)
  journal.ids[`${e.id}:numero`] = r.numero
  sauver()
  if (r.statut === 'BROUILLON') {
    const m = await cliquer(p, p.getByRole('button', { name: 'Soumettre au contrôle' }))
    if (m.refus) throw new Error(`soumission refusée : ${m.texte}`)
    r = await attendre(() => receptionImport(p, rid), (x) => x.statut !== 'BROUILLON', `soumission (${m.texte})`)
  }
  if (r.statut === 'A_CONTROLER') {
    const d = await session('Choukri')
    await aller(d, `/receptions-import/${rid}`, 'Choukri')
    await d.getByRole('button', { name: /Valider le contrôle/ }).click()
    await confirmerSi(d, 'Générer les lots et valider')
    r = await attendre(() => receptionImport(d, rid), (x) => x.statut === 'VALIDEE', `validation : ${await messageAffiche(d)}`)
  }
  return `${r.numero} ${r.statut}, ${fr(e.lignes.reduce((t, l) => t + l.pese, 0), 1)} kg`
}

/** La cloture du dossier : les frais entrent dans le CMUP du stock encore present. */
async function importCloture(e: Extract<Evenement, { type: 'IMPORT_CLOTURE' }>) {
  const login = 'Choukri'
  const p = await session(login)
  const id = journal.ids[e.dossier]
  if (!id) throw new Error(`dossier ${e.dossier} absent du journal`)
  const avant = await dossierApi(p, id)
  if (statutDossier(avant) === 'CLOTURE') return 'déjà clôturé'
  const facture = journal.ids[`${e.dossier}:facture`]
  const etrangeres = (avant.factures ?? []).filter((f) => facture && f.numero_facture !== facture)
  if (etrangeres.length)
    return `non clôturé : le dossier porte aussi ${etrangeres.map((f) => `la facture ${f.numero_facture}`).join(', ')}, saisie hors simulation`
  await aller(p, `/import/${id}`, login)
  await p.getByRole('button', { name: 'Clôturer', exact: true }).click()
  await p.getByRole('button', { name: /Clôturer et ajuster le CUMP/ }).click()
  const d = await attendre(() => dossierApi(p, id), (x) => statutDossier(x) === 'CLOTURE', `clôture : ${await messageAffiche(p)}`, 60_000)
  return `dossier ${numeroDossier(d)} clôturé`
}

// --- Les retours au fournisseur -------------------------------------------------

/**
 * UN RETOUR AU FOURNISSEUR (12/10/2026) : un document libre — le fournisseur,
 * la reference rendue, son lot, la quantite ; le prix propose au CMUP. Saisi
 * par la direction, valide par un autre compte. Le lot a pu etre consomme
 * depuis : on ne rend que ce qui reste, ou rien.
 */
async function retourner(e: Extract<Evenement, { type: 'RETOUR' }>) {
  const login = 'Choukri'
  const p = await session(login)
  const marque = `(simulation ${e.id})`
  const deja = await lire<{ observations?: string | null; motif?: string }[]>(p, '/api/retours-fournisseur')
  if (deja.some((r) => (r.motif ?? '').includes(marque))) return 'déjà saisi'
  const l = e.ligne
  const dispo = (await lire<{ code_reference: string; code_magasin: string; lot_fournisseur: string | null; quantite_kg: number }[]>(
    p, '/api/retours-fournisseur/disponible'))
    .filter((x) => x.code_reference === l.ref && x.code_magasin === l.magasin)
  const ligne = dispo.find((x) => x.lot_fournisseur === l.lot) ?? dispo.find((x) => x.lot_fournisseur === null)
  const kg = Math.min(e.kg, Math.floor(ligne?.quantite_kg ?? 0))
  if (!ligne || kg < 1) return `${l.ref} lot ${l.lot} déjà consommé : rien à rendre`

  await aller(p, '/retours-fournisseur/nouveau', login)
  await p.locator('#rfo-fournisseur').selectOption(e.fournisseur)
  await p.locator('#rfo-date').fill(e.date)
  await p.locator('#rfo-motif').fill(`Non conforme au déballage ${marque}`)
  await p.getByRole('combobox', { name: 'Magasin' }).first().selectOption(l.magasin)
  await p.getByRole('combobox', { name: 'Référence' }).first().selectOption(l.ref)
  await p.getByRole('combobox', { name: 'Lot' }).first().selectOption(ligne.lot_fournisseur ?? '')
  await taper(p.getByRole('textbox', { name: 'Quantité kg' }).first(), String(kg))
  await p.getByRole('combobox', { name: 'Motif de la ligne' }).first().selectOption('R1')
  await p.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(p).toHaveURL(/retours-fournisseur\/[0-9a-f-]{36}/,{ timeout: 30_000 }).catch(async () => {
    throw new Error(`retour non enregistré : ${await messageAffiche(p)}`)
  })
  // Un autre compte le valide.
  const v = await session('Mohamed')
  await aller(v, new URL(p.url()).pathname, 'Mohamed')
  await v.getByRole('button', { name: 'Valider', exact: true }).click()
  await v.getByRole('button', { name: 'Valider le retour' }).click()
  await expect(v.getByText('Validé', { exact: true }).first()).toBeVisible({ timeout: 30_000 }).catch(async () => {
    throw new Error(`retour non validé : ${await messageAffiche(v)}`)
  })
  return `${kg} kg ${l.ref} rendus à ${e.fournisseur}`
}

// --- L'inventaire du jour ---------------------------------------------------

interface Inventaire {
  id_inventaire: string
  numero_inventaire: string
  statut: string
  code_magasin: string
}

async function inventorier(e: Extract<Evenement, { type: 'INVENTAIRE' }>) {
  const login = 'Choukri'
  const p = await session(login)
  const alea = hasardDe(e.id)
  const ouverts = async () =>
    (await lire<Inventaire[]>(p, '/api/inventaires')).filter((i) => i.code_magasin === e.magasin && i.statut !== 'ANNULE')
  let inv = (await ouverts()).find((i) => i.statut === 'BROUILLON' || i.statut === 'EN_COURS')
  if (!inv) {
    await aller(p, '/inventaires', login)
    await p.getByRole('button', { name: 'Nouvel inventaire' }).first().click()
    await p.getByRole('combobox', { name: 'Magasin *', exact: true }).selectOption(e.magasin)
    await p.locator('#type').selectOption('TOURNANT')
    await p.getByRole('button', { name: /^Cr[ée]er$/ }).click()
    inv = (await attendre(ouverts, (l) => l.some((i) => i.statut === 'BROUILLON'), 'création de l’inventaire')).find((i) => i.statut === 'BROUILLON')!
  }
  await aller(p, '/inventaires', login)
  // Un brouillon s'ouvre par son bouton ; un inventaire en cours, en cliquant sa ligne.
  const ligneInv = p.getByRole('row', { name: new RegExp(inv.numero_inventaire) })
  const ouvrir = ligneInv.getByRole('button', { name: 'Ouvrir' })
  if (await ouvrir.isVisible().catch(() => false)) await ouvrir.click()
  else await ligneInv.getByRole('cell').first().click()
  const champs = p.getByRole('textbox', { name: /^Kilos comptés, / })
  await expect(champs.first()).toBeVisible({ timeout: 20_000 })
  const lignes = await attendre(
    () => lire<{ code_reference: string; quantite_theorique_kg: number }[]>(p, `/api/inventaires/${inv!.id_inventaire}/lignes`),
    (l) => l.length > 0,
    'lignes d’inventaire',
  )
  await expect(champs).toHaveCount(lignes.length, { timeout: 20_000 })
  const vus = new Map<string, number>()
  let ecarts = 0
  for (let i = 0; i < lignes.length; i++) {
    const champ = champs.nth(i)
    const ref = (await champ.getAttribute('aria-label'))!.replace('Kilos comptés, ', '')
    const rang = vus.get(ref) ?? 0
    vus.set(ref, rang + 1)
    const theorique = Number(lignes.filter((l) => l.code_reference === ref)[rang]?.quantite_theorique_kg ?? 0)
    // Quelques ecarts de comptage, petits, justifies : une bobine abimee, une pesee arrondie.
    if (theorique > 100 && ecarts < 4 && alea() < 0.08) {
      const compte = +(theorique * (1 - 0.002 - alea() * 0.004)).toFixed(2)
      await taper(champ, fr(compte, 2))
      await p.getByRole('textbox', { name: `Motif de l'écart, ${ref}` }).nth(rang).fill('Bobine abîmée et pesée arrondie au comptage')
      ecarts++
    } else await taper(champ, fr(theorique, 4))
  }
  await p.getByRole('button', { name: 'Enregistrer le comptage' }).click()
  // Le comptage s'enregistre d'abord (194 lignes : quelques secondes) ; la cloture attend.
  const cloturer = p.getByRole('button', { name: /^Cl[oô]turer et ajuster$/ })
  await expect(cloturer).toBeEnabled({ timeout: 120_000 })
  await cloturer.click()
  await confirmerSi(p, /^Cl[oô]turer$/, 5_000)
  await attendre(async () => (await lire<Inventaire[]>(p, '/api/inventaires')).find((i) => i.id_inventaire === inv!.id_inventaire)?.statut,
    (s) => s === 'CLOTURE', `clôture de l’inventaire : ${await messageAffiche(p)}`, 60_000)
  return `${inv.numero_inventaire} : ${lignes.length} lignes, ${ecarts} écart(s)`
}

// =============================================================================
// Le deroule
// =============================================================================

test('simulation de janvier 2024 à aujourd’hui', async ({ browser }, info) => {
  test.setTimeout(0)
  navigateur = browser
  baseURL = String(info.project.use.baseURL)
  const p = await session('Mohamed')
  catalogue = await lire<RefCatalogue[]>(p, '/api/catalogue?actif=1&limite=5000')
  for (const r of catalogue) parCode.set(r.code_reference, r)
  const parc = await lire<{ code_machine: string; etat: string }[]>(p, '/api/machines')
  const machines: Machine[] = []
  for (const m of parc.filter((x) => x.etat === 'ACTIVE').sort((a, b) => a.code_machine.localeCompare(b.code_machine))) {
    const zones = await lire<{ code_emplacement: string; role: string; capacite_bobines: number }[]>(p, `/api/machines/${m.code_machine}`)
    machines.push({
      code: m.code_machine,
      zones: zones.filter((z) => z.role === 'ETAGE').map((z) => ({ code: z.code_emplacement, capacite: Number(z.capacite_bobines) })),
    })
  }
  const aujourdhui = new Date().toISOString().slice(0, 10)
  const plan = construirePlan(catalogue, machines, aujourdhui)
  const restant = plan.filter((e) => !journal.fait[e.id])
  tracer(`plan : ${plan.length} événements, ${plan.length - restant.length} déjà faits, ${restant.length} à saisir`)
  writeFileSync(join(DOSSIER, 'plan.json'), JSON.stringify(plan, null, 1))

  let n = 0
  for (const e of restant) {
    if (LIMITE && n >= LIMITE) break
    const debut = Date.now()
    try {
      const r =
        e.type === 'TAUX' ? await ouvrirTaux(e)
        : e.type === 'BC' ? await creerBon(e)
        : e.type === 'BC_VALIDER' ? await validerBon(e)
        : e.type === 'RECEPTION' ? await receptionner(e)
        : e.type === 'RETOUR' ? await retourner(e)
        : e.type === 'IMPORT_DOSSIER' ? await importDossier(e)
        : e.type === 'IMPORT_DEDOUANEMENT' ? await importDedouanement(e)
        : e.type === 'IMPORT_RECEPTION' ? await importReception(e)
        : e.type === 'IMPORT_CLOTURE' ? await importCloture(e)
        : e.type === 'MACHINE' ? await machine(e)
        : e.type === 'SORTIE' ? await sortir(e)
        : await inventorier(e)
      journal.fait[e.id] = r
      sauver()
      tracer(`${e.date}  ${e.type.padEnd(10)} ${r}  (${((Date.now() - debut) / 1000).toFixed(1)} s)`)
    } catch (err) {
      const capture = join(DOSSIER, `echec-${e.id.replace(/[^A-Za-z0-9-]/g, '_')}.png`)
      for (const [login, page] of sessions) {
        await page.screenshot({ path: capture.replace('.png', `-${login}.png`), fullPage: true }).catch(() => undefined)
        const html = await page.locator('main').first().innerHTML().catch(() => '')
        writeFileSync(capture.replace('.png', `-${login}.html`), html)
      }
      tracer(`ÉCHEC ${e.date} ${e.type} ${e.id} : ${(err as Error).message.split('\n')[0].slice(0, 400)}`)
      throw err
    }
    n++
  }
  tracer(`fin : ${n} événement(s) saisi(s) dans ce passage`)
})
