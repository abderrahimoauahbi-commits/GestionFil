/**
 * L'INDICE D'UN CHAMP ET LE CATALOGUE D'AIDE (src/aide/).
 *
 * Le ⓘ posé à côté d'un champ se trouve par la route de l'écran puis par
 * l'intitulé du champ (src/aide/indice.ts) ; à l'écran, l'intitulé change de
 * costume — capitales, astérisque d'obligatoire, deux-points, accents absents,
 * devise — sans changer de sens. Ces tests tiennent la normalisation, le choix
 * de la fiche, et la cohérence du catalogue : une route qui n'existe pas, un
 * intitulé en double, un exemple orphelin ou une étape du guide qui nomme un
 * champ absent de sa fiche font échouer `npm test`.
 *
 * Lancement : npm test (node --test ; Node 24 lit le TypeScript sans outil).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  champDans,
  normaliserIntitule,
  plierVariables,
  sansPrecision,
  scoreRoute,
  sujetDans,
  texteDe,
} from '../src/aide/indice.ts'
import { SUJETS } from '../src/aide/contenu.ts'
import { EXEMPLES } from '../src/aide/exemples.ts'
import { TUTORIEL } from '../src/aide/tutoriel.ts'
import type { Sujet } from '../src/aide/types.ts'

const FICHE: Sujet = {
  route: '/essai',
  titre: 'Essai',
  chemin: 'Essai',
  objectif: 'Tester.',
  champs: [
    { nom: 'Date de réception', description: 'Le jour où le camion arrive.', obligatoire: true },
    { nom: 'Qté (kg)', description: 'La quantité en kilos.' },
    { nom: 'Prix', alias: ['Prix unitaire'], description: 'Le prix au kilo.' },
    { nom: 'Taux USD → MAD', description: 'Le taux de la facture.' },
    { nom: 'Numéro d’ordre', description: 'Le numéro.' },
    { nom: 'Montant MAD', description: 'Le montant en dirhams.' },
    { nom: 'Montant devise', alias: ['Montant USD'], description: 'Le montant dans la devise du bon.' },
    { nom: 'Champ muet', description: '   ' },
  ],
}

test('normaliser : casse, accents, astérisque, deux-points, espaces', () => {
  assert.equal(normaliserIntitule('Date de réception'), 'date de reception')
  assert.equal(normaliserIntitule('DATE DE RECEPTION'), 'date de reception')
  assert.equal(normaliserIntitule('Date de réception *'), 'date de reception')
  assert.equal(normaliserIntitule('  Date de   réception : '), 'date de reception')
  assert.equal(normaliserIntitule('Date de réception (obligatoire)'), 'date de reception')
  assert.equal(normaliserIntitule('↳ Lot fournisseur'), 'lot fournisseur')
})

test('normaliser : apostrophes ; devise et année repliées à part', () => {
  assert.equal(normaliserIntitule('Numéro d’ordre'), normaliserIntitule("Numero d'ordre"))
  const plie = (t: string) => plierVariables(normaliserIntitule(t))
  assert.equal(plie('Taux EUR → MAD'), plie('Taux USD → MAD'))
  assert.equal(plie('Prix MAD'), plie('Prix EUR'))
  assert.equal(plie('Change 2026'), plie('Change 2027'))
  assert.notEqual(normaliserIntitule('Montant MAD'), normaliserIntitule('Montant EUR'))
})

test('sans précision : la parenthèse finale tombe', () => {
  assert.equal(sansPrecision(normaliserIntitule('Qté (kg)')), 'qte')
  assert.equal(sansPrecision('poids'), 'poids')
})

test('champ : trouvé par son intitulé, quel que soit son costume', () => {
  assert.equal(champDans(FICHE, 'DATE DE RECEPTION *')?.nom, 'Date de réception')
  assert.equal(champDans(FICHE, 'Date de réception :')?.nom, 'Date de réception')
  assert.equal(champDans(FICHE, 'Qté (kg)')?.nom, 'Qté (kg)')
  assert.equal(champDans(FICHE, 'Qté')?.nom, 'Qté (kg)', 'second essai sans la parenthèse')
  assert.equal(champDans(FICHE, 'Qté (palettes)')?.nom, 'Qté (kg)')
  assert.equal(champDans(FICHE, 'Prix unitaire')?.nom, 'Prix', 'par un alias')
  assert.equal(champDans(FICHE, 'Taux CNY → MAD')?.nom, 'Taux USD → MAD', 'la devise varie')
  assert.equal(champDans(FICHE, "Numero d'ordre")?.nom, 'Numéro d’ordre')
  assert.equal(champDans(FICHE, 'Montant MAD')?.nom, 'Montant MAD', 'l’exact passe avant la devise repliée')
  assert.equal(champDans(FICHE, 'Montant USD')?.nom, 'Montant devise', 'par l’alias exact')
})

test('champ : rien pour un intitulé absent, vide ou sans description', () => {
  assert.equal(champDans(FICHE, 'Fournisseur'), undefined)
  assert.equal(champDans(FICHE, ''), undefined)
  assert.equal(champDans(FICHE, ' * '), undefined)
  assert.equal(champDans(FICHE, 'Champ muet'), undefined, 'un champ sans description n’affiche rien')
  assert.equal(champDans(undefined, 'Prix'), undefined)
})

test('route : la plus précise gagne, la racine ne prend que l’accueil', () => {
  const sujets = ['/', '/receptions', '/receptions/:id', '/receptions/nouvelle', '/catalogue', '/catalogue/completer'].map(
    (route) => ({ ...FICHE, route }),
  )
  assert.equal(sujetDans(sujets, '/receptions/nouvelle')?.route, '/receptions/nouvelle')
  assert.equal(sujetDans(sujets, '/receptions/42')?.route, '/receptions/:id')
  assert.equal(sujetDans(sujets, '/receptions')?.route, '/receptions')
  assert.equal(sujetDans(sujets, '/catalogue/completer')?.route, '/catalogue/completer')
  assert.equal(sujetDans(sujets, '/')?.route, '/')
  assert.equal(sujetDans(sujets, '/inconnu'), undefined, 'un écran sans fiche ne prend pas celle de l’accueil')
  assert.equal(scoreRoute('/roles', '/roles-bom'), null, 'un segment entier, pas un préfixe de texte')
})

test('texte d’un intitulé React : les balises de texte, pas les composants', () => {
  const span = (children: unknown) => ({ type: 'span', props: { children } })
  const composant = (children: unknown) => ({ type: () => null, props: { children } })
  assert.equal(texteDe(['Date', ' ', span('*')]), 'Date *')
  assert.equal(texteDe(['Fournisseur', composant('Changer de fournisseur…')]), 'Fournisseur')
  assert.equal(texteDe([false, null, 'Lot', 3]), 'Lot3')
  assert.equal(texteDe({ type: 'button', props: { children: '?' } }), '')
})

// ---------------------------------------------------------------------------
// Le catalogue réel
// ---------------------------------------------------------------------------

/** Les adresses montées par App.tsx, en motifs. */
const ROUTES_APP = [...readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8').matchAll(/path="([^"*]+)"/g)]
  .map((m) => '/' + m[1].replace(/^\//, ''))
  .concat('/')

function existeDansApp(route: string): boolean {
  const r = route.split('/').filter(Boolean)
  return ROUTES_APP.some((app) => {
    const a = app.split('/').filter(Boolean)
    return a.length === r.length && a.every((s, i) => s.startsWith(':') || r[i].startsWith(':') || s === r[i])
  })
}

test('catalogue : une fiche par route, et chaque route existe dans App.tsx', () => {
  const vues = new Set<string>()
  for (const s of SUJETS) {
    assert.ok(!vues.has(s.route), `route en double : ${s.route}`)
    vues.add(s.route)
    assert.ok(existeDansApp(s.route), `la fiche ${s.route} ne correspond à aucun écran de App.tsx`)
  }
})

test('catalogue : chaque champ est décrit, une seule fois par fiche', () => {
  for (const s of SUJETS) {
    const vus = new Map<string, string>()
    for (const c of s.champs ?? []) {
      assert.ok(c.description.trim(), `${s.route} : « ${c.nom} » sans description`)
      for (const n of [c.nom, ...(c.alias ?? [])]) {
        const cle = normaliserIntitule(n)
        // Deux alias d’un même champ peuvent se confondre (la devise) ; deux champs, jamais.
        assert.ok(!vus.has(cle) || vus.get(cle) === c.nom, `${s.route} : « ${n} » en double (déjà « ${vus.get(cle)} »)`)
        vus.set(cle, c.nom)
      }
    }
  }
})

test('catalogue : chaque exemple s’attache à une fiche', () => {
  const routes = new Set(SUJETS.map((s) => s.route))
  for (const cle of Object.keys(EXEMPLES)) assert.ok(routes.has(cle), `exemple orphelin : ${cle}`)
})

test('catalogue : plus un mot du paramètre retiré P_MrpInclureStockMachine', () => {
  const texte = JSON.stringify(SUJETS)
  assert.ok(!texte.includes('P_MrpInclureStockMachine'))
})

test('guide pas à pas : chaque étape mène à une fiche, et ses champs y sont décrits', () => {
  for (const p of TUTORIEL.parties) {
    for (const e of p.etapes) {
      assert.ok(existeDansApp(e.route), `étape « ${e.titre} » : route ${e.route} inconnue`)
      const fiche = sujetDans(SUJETS, e.route)
      assert.ok(fiche, `étape « ${e.titre} » : aucune fiche pour ${e.route}`)
      for (const nom of e.champs ?? []) {
        assert.ok(champDans(fiche, nom), `étape « ${e.titre} » : « ${nom} » absent de la fiche ${fiche!.route}`)
      }
    }
  }
})
