/**
 * CHAQUE LOT A SON CONDITIONNEMENT (23/10/2026) : dès qu'un lot est choisi, ses
 * palettes, ses bobines et ses kilos se convertissent avec SON poids de bobine
 * et SES bobines par palette ; à défaut, ceux de la fiche article ; jamais un
 * facteur 1. Mêmes nombres que le banc (scenario_lot_conditionnement) : lot à
 * 2,4 kg et 210 bobines par palette, fiche à 2,5 kg et 200.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appliquerConditionnementLot,
  conditionnementDuLot,
  depuisBobines,
  depuisChamp,
  depuisKg,
  depuisPalettes,
  type LigneColisLot,
} from '../src/lib/conditionnement.ts'

const fiche = { poids_bobine_kg: 2.5, bobines_par_palette: 200, bobines_par_lot: 1344 }
const lot = { poids_bobine_kg: 2.4, bobines_par_palette: 210 }

test('le lot prime sur la fiche article, facteur par facteur', () => {
  assert.deepEqual(conditionnementDuLot(fiche, lot), { ...fiche, poids_bobine_kg: 2.4, bobines_par_palette: 210 })
  // Un facteur que le lot ne porte pas reste celui de la fiche.
  assert.deepEqual(conditionnementDuLot(fiche, { poids_bobine_kg: 2.4 }), { ...fiche, poids_bobine_kg: 2.4 })
  // Un zéro n'est pas un facteur.
  assert.deepEqual(conditionnementDuLot(fiche, { poids_bobine_kg: 0, bobines_par_palette: 0 }), fiche)
  // Sans lot : la fiche.
  assert.equal(conditionnementDuLot(fiche, null), fiche)
})

test('palettes, bobines et kilos se répondent avec le conditionnement du lot', () => {
  const c = conditionnementDuLot(fiche, lot)
  assert.deepEqual(depuisPalettes(1, c), { kg: 504, bobines: 210, palettes: 1 })
  assert.deepEqual(depuisBobines(10, c), { kg: 24, bobines: 10, palettes: 1 })
  // Le poids pesé fait foi ; les bobines sont entières ; la palette entamée compte pour une palette,
  // sans que les kilos soient arrondis à la palette pleine.
  const r = depuisKg(500, c)
  assert.equal(r.kg, 500)
  assert.equal(r.bobines, 208)
  assert.equal(r.palettes, 1)
  assert.deepEqual(depuisChamp('palettes', '2', c), { kg: 1008, bobines: 420, palettes: 2 })
})

test('facteur manquant : seule la case des kilos', () => {
  const sans = conditionnementDuLot({ poids_bobine_kg: null, bobines_par_palette: null }, {})
  assert.deepEqual(depuisKg(12, sans), { kg: 12, bobines: null, palettes: null })
  assert.deepEqual(depuisPalettes(1, sans), { kg: null, bobines: null, palettes: 1 })
})

function ligne(p: Partial<LigneColisLot> = {}): LigneColisLot {
  return { code_reference: 'PP', cond: fiche, qte: '', palettes: '', bobines: '', lie: true, ...p }
}

test('une ligne prend le conditionnement de son lot, une fois, et le rend sans lot', () => {
  // Trois palettes tapées : elles restent trois palettes, les kilos suivent le lot.
  const l = appliquerConditionnementLot(ligne({ palettes: '3', bobines: '600', qte: '1500', saisiePar: 'palettes' }), 'L1', lot)
  assert.equal(l.cond.poids_bobine_kg, 2.4)
  assert.equal(l.palettes, '3')
  assert.equal(l.bobines, '630')
  assert.equal(l.qte, '1512')
  // Rejouée avec le même lot : rien ne bouge (même objet).
  assert.equal(appliquerConditionnementLot(l, 'L1', lot), l)
  // Un poids pesé fait foi : il ne bouge pas, les bobines suivent.
  const k = appliquerConditionnementLot(ligne({ qte: '24', saisiePar: 'quantite' }), 'L1', lot)
  assert.equal(k.qte, '24')
  assert.equal(k.bobines, '10')
  // Sans lot, la fiche article revient.
  const f = appliquerConditionnementLot(l, '', null)
  assert.equal(f.cond.poids_bobine_kg, 2.5)
  assert.equal(f.qte, '1500')
  // Une ligne détachée garde ses trois valeurs.
  const d = appliquerConditionnementLot(ligne({ palettes: '3', bobines: '600', qte: '1500', lie: false }), 'L1', lot)
  assert.deepEqual([d.qte, d.palettes, d.bobines], ['1500', '3', '600'])
  assert.equal(d.cond.bobines_par_palette, 210)
})

test("une autre référence repart de sa propre fiche, pas du conditionnement de l'ancienne", () => {
  const l = appliquerConditionnementLot(ligne(), 'L1', lot)
  const autre = { ...l, code_reference: 'AUTRE', cond: { poids_bobine_kg: 3, bobines_par_palette: 100 } }
  const r = appliquerConditionnementLot(autre, '', null)
  assert.deepEqual(r.cond, { poids_bobine_kg: 3, bobines_par_palette: 100 })
})
