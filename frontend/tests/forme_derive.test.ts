/**
 * LE NOUVEAU DERIVE A LA RECEPTION (src/lib/formeDerive.ts, 07/11/2026) : une
 * ligne du meme lot dont la forme differe — poids d'une unite au-dela du seuil,
 * ou autre nombre d'unites par palette — fait proposer un nouveau derive.
 *
 * Lancement : npm test.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formeDe, nouvelleForme, type Forme } from '../src/lib/formeDerive.ts'

const SEUIL = 5
const nommee = (nom: string, f: Omit<Forme, 'nom'>): Forme => ({ nom, ...f })

test('le cas de l’utilisateur : 16 palettes de 488 bobines puis 2 palettes de 200, même poids de bobine', () => {
  const premiere = nommee('ligne 1', formeDe(488 * 3, '488', '16'))
  const seconde = formeDe(200 * 3, '200', '2')
  assert.equal(seconde.unitaire, 3)
  assert.equal(seconde.parPalette, 100)
  assert.equal(nouvelleForme(seconde, [premiere], SEUIL), true)
})

test('les fûts du latex : 600 kg contre 1 000 kg, même lot', () => {
  const d1 = nommee('D1', { unitaire: 1000, parPalette: null })
  assert.equal(nouvelleForme(formeDe(1200, '2', ''), [d1], SEUIL), true)
  assert.equal(nouvelleForme(formeDe(90000, '90', ''), [d1], SEUIL), false)
})

test('jusqu’à 5 % d’écart de poids, c’est la mesure : même dérivé', () => {
  const d1 = nommee('D1', { unitaire: 3, parPalette: 30 })
  assert.equal(nouvelleForme(formeDe(3.12 * 300, '300', '10'), [d1], SEUIL), false)
  assert.equal(nouvelleForme(formeDe(3.2 * 300, '300', '10'), [d1], SEUIL), true)
})

test('proche d’une seule des formes connues : pas de nouveau dérivé', () => {
  const connues = [nommee('D1', { unitaire: 3, parPalette: 30 }), nommee('D2', { unitaire: 3, parPalette: 100 })]
  assert.equal(nouvelleForme(formeDe(600, '200', '2'), connues, SEUIL), false)
})

test('rien à comparer (premier arrivage du lot, ou ni bobines ni palettes) : rien n’est proposé', () => {
  assert.equal(nouvelleForme(formeDe(600, '200', '2'), [], SEUIL), false)
  assert.equal(nouvelleForme(formeDe(600, '', ''), [nommee('D1', { unitaire: 3, parPalette: 30 })], SEUIL), false)
})
