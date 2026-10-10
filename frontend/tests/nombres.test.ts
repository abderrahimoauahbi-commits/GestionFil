/**
 * LA LECTURE DES NOMBRES TAPES A LA FRANCAISE (src/lib/nombres.ts). Le cas
 * « 1.234,5 » lu 1,2345 par le champ numerique d'Edge a ete trouve par les tests
 * de bout en bout du 10/10/2026 : il ne doit plus revenir.
 *
 * Lancement : npm test.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lireNombre, versCanonique, versSaisie } from '../src/lib/nombres.ts'

const LISIBLES: [string, number][] = [
  ['1234,5', 1234.5],
  ['1 234,5', 1234.5],
  ['1\u00a0234,5', 1234.5],
  ['1\u202f234,5', 1234.5],
  ['1234.5', 1234.5],
  ['1.234,5', 1234.5],
  ['1,234.5', 1234.5],
  ['12 345,678', 12345.678],
  ['1.234.567', 1234567],
  ['1,234,567', 1234567],
  ['1.234.567,89', 1234567.89],
  ['12,5', 12.5],
  ['12.5', 12.5],
  [',5', 0.5],
  ['0,0125', 0.0125],
  ['-3,75', -3.75],
  ['+10', 10],
  ['  42 ', 42],
  ['1.234', 1.234],
  ['5,', 5],
]

for (const [texte, attendu] of LISIBLES)
  test(`« ${texte} » vaut ${attendu}`, () => assert.equal(lireNombre(texte), attendu))

for (const texte of ['1,2,3', '12.34,5', '1.2.3,4', 'abc', '12a', '1,23,456', ',', '-', '1..2', '1,2.3.4'])
  test(`« ${texte} » est illisible`, () => assert.ok(Number.isNaN(lireNombre(texte))))

test('vide : null', () => {
  assert.equal(lireNombre(''), null)
  assert.equal(lireNombre('   '), null)
  assert.equal(lireNombre(null), null)
})

test('forme canonique et affichage', () => {
  assert.equal(versCanonique('1 234,5'), '1234.5')
  assert.equal(versCanonique(''), '')
  assert.equal(versCanonique('1,2,3'), '1,2,3')
  assert.equal(versSaisie('1234.5'), '1234,5')
  assert.equal(versSaisie(3400), '3400')
  assert.equal(versSaisie(null), '')
})
