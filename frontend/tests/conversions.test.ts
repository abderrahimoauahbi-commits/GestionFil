/**
 * LES CONVERSIONS DU CONDITIONNEMENT (src/lib/conditionnement.ts) : kilos,
 * bobines, palettes, lots et metres lineaires. Le controle de colisage a ses
 * propres tests (conditionnement.test.ts) ; ceux-ci figent les formules que
 * les ecrans de saisie appliquent :
 *
 *     kg = bobines x poids_bobine_kg
 *     bobines = palettes x bobines_par_palette = lots x bobines_par_lot
 *
 * Bobines entieres, palettes arrondies vers le haut, valeur saisie qui fait
 * foi, et aucune conversion inventee quand la reference ne porte pas ses
 * parametres.
 *
 * Lancement : npm test (node --test ; Node 24 lit le TypeScript sans outil).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  depuisBobines,
  depuisKg,
  depuisPalettes,
  depuisUnite,
  facteurVersKg,
  pourChamp,
} from '../src/lib/conditionnement.ts'

/** Un fil de 2,1 kg la bobine, 336 bobines par palette, bain de 1 344 bobines. */
const FICHE = { poids_bobine_kg: 2.1, bobines_par_palette: 336, bobines_par_lot: 1344, densite_kg_ml: 0.05 }
const VIDE = { kg: null, bobines: null, palettes: null }

/** Egalite a la precision des flottants (2,1 x 100 ne fait pas exactement 210). */
const proche = (recu: number | null, attendu: number) =>
  assert.ok(recu !== null && Math.abs(recu - attendu) < 1e-9, `${recu} au lieu de ${attendu}`)

test('facteurVersKg : le facteur de chaque unite', () => {
  assert.equal(facteurVersKg('kg', FICHE), 1)
  assert.equal(facteurVersKg('kg', {}), 1)
  assert.equal(facteurVersKg('Bobine', FICHE), 2.1)
  proche(facteurVersKg('Palette', FICHE), 705.6)     // 2,1 x 336
  proche(facteurVersKg('Lot', FICHE), 2822.4)        // 2,1 x 1 344
  assert.equal(facteurVersKg('ml', FICHE), 0.05)
})

test('facteurVersKg : sans parametre, pas de facteur invente', () => {
  assert.equal(facteurVersKg('Bobine', {}), null)
  assert.equal(facteurVersKg('Bobine', { poids_bobine_kg: 0 }), null)
  assert.equal(facteurVersKg('Bobine', { poids_bobine_kg: -2 }), null)
  assert.equal(facteurVersKg('Palette', { poids_bobine_kg: 2.1 }), null)
  assert.equal(facteurVersKg('Palette', { bobines_par_palette: 336 }), null)
  assert.equal(facteurVersKg('Lot', { poids_bobine_kg: 2.1 }), null)
  assert.equal(facteurVersKg('Lot', { poids_bobine_kg: 2.1, bobines_par_lot: 0 }), null)
  assert.equal(facteurVersKg('ml', { densite_kg_ml: 0 }), null)
  assert.equal(facteurVersKg('ml', {}), null)
})

test('facteurVersKg : une unite inconnue n\'a pas de facteur (casse comprise)', () => {
  assert.equal(facteurVersKg('m2', FICHE), null)
  assert.equal(facteurVersKg('', FICHE), null)
  assert.equal(facteurVersKg('bobine', FICHE), null)
})

test('depuisBobines : les bobines menent, les palettes s\'arrondissent vers le haut', () => {
  const r = depuisBobines(100, FICHE)
  assert.equal(r.bobines, 100)
  proche(r.kg, 210)
  assert.equal(r.palettes, 1)                        // 0,3 palette occupe une palette
  assert.equal(depuisBobines(336, FICHE).palettes, 1)
  assert.equal(depuisBobines(337, FICHE).palettes, 2)
  assert.deepEqual(depuisBobines(0, FICHE), { kg: 0, bobines: 0, palettes: 0 })
})

test('depuisBobines : saisie a la francaise, bobines entieres', () => {
  const r = depuisBobines('1 234,5', FICHE)
  assert.equal(r.bobines, 1235)
  proche(r.kg, 2592.45)                              // le poids suit la saisie, pas l'arrondi
  assert.equal(r.palettes, 4)
})

test('depuisBobines : vide ou illisible ne donne rien', () => {
  assert.deepEqual(depuisBobines('', FICHE), VIDE)
  assert.deepEqual(depuisBobines(null, FICHE), VIDE)
  assert.deepEqual(depuisBobines(undefined, FICHE), VIDE)
  assert.deepEqual(depuisBobines('abc', FICHE), VIDE)
})

test('depuisKg : le poids pese fait foi', () => {
  const r = depuisKg(211, FICHE)
  assert.equal(r.kg, 211)                            // jamais ramene a 100 bobines x 2,1
  assert.equal(r.bobines, 100)
  assert.equal(r.palettes, 1)
})

test('depuisKg : sans poids de bobine, seuls les kilos restent', () => {
  assert.deepEqual(depuisKg(50, { bobines_par_palette: 336 }), { kg: 50, bobines: null, palettes: null })
  assert.deepEqual(depuisKg('', FICHE), VIDE)
})

test('depuisPalettes : la palette comptee fait foi', () => {
  const r = depuisPalettes(3, FICHE)
  assert.equal(r.palettes, 3)
  assert.equal(r.bobines, 1008)
  proche(r.kg, 2116.8)
})

test('depuisPalettes : sans bobines par palette, seules les palettes restent', () => {
  assert.deepEqual(depuisPalettes(2, { poids_bobine_kg: 2.1 }), { kg: null, bobines: null, palettes: 2 })
  assert.deepEqual(depuisPalettes(null, FICHE), VIDE)
})

test('depuisUnite : palettes et bobines passent par leurs fonctions', () => {
  assert.deepEqual(depuisUnite(2, 'Palette', FICHE), depuisPalettes(2, FICHE))
  assert.deepEqual(depuisUnite(100, 'Bobine', FICHE), depuisBobines(100, FICHE))
})

test('depuisUnite : un lot est un bain de 1 344 bobines', () => {
  const r = depuisUnite(1, 'Lot', FICHE)
  assert.equal(r.bobines, 1344)
  assert.equal(r.palettes, 4)
  proche(r.kg, 2822.4)
})

test('depuisUnite : metres lineaires et kilos', () => {
  const ml = depuisUnite(100, 'ml', FICHE)
  proche(ml.kg, 5)                                   // 100 m x 0,05 kg/m
  assert.equal(ml.bobines, 2)
  assert.equal(ml.palettes, 1)
  const kg = depuisUnite(12.5, 'kg', FICHE)
  assert.equal(kg.kg, 12.5)
  assert.equal(kg.bobines, 6)
})

test('depuisUnite : unite inconnue ou valeur vide ne donne rien', () => {
  assert.deepEqual(depuisUnite(10, 'm2', FICHE), VIDE)
  assert.deepEqual(depuisUnite(1, 'Lot', { poids_bobine_kg: 2.1 }), VIDE)
  assert.deepEqual(depuisUnite('', 'kg', FICHE), VIDE)
})

test('pourChamp : vide plutot que « null », arrondi ou decimales', () => {
  assert.equal(pourChamp(null), '')
  assert.equal(pourChamp(0), '0')
  assert.equal(pourChamp(3.6), '4')
  assert.equal(pourChamp(2.5), '3')
  assert.equal(pourChamp(1.23456, 2), '1.23')
  assert.equal(pourChamp(1.5, 2), '1.5')             // pas de zero inutile
  assert.equal(pourChamp(1234.5, 1), '1234.5')
})
