/**
 * Le Code 128 des etiquettes de lot (19/10/2026). L'attendu de « E000001234 »
 * est celui que produit JsBarcode 3.11.6, compare le 19/10/2026 : une seule
 * barre fausse et la douchette ne lit plus rien.
 *
 * Lancement : npm test (node --test ; Node 24 lit le TypeScript sans outil).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LARGEURS, barres, modules, symboles } from '../src/lib/code128.ts'

test('la table : 107 symboles distincts de 11 modules, l\'arret de 13', () => {
  assert.equal(LARGEURS.length, 107)
  assert.equal(new Set(LARGEURS).size, 107)
  LARGEURS.forEach((w, i) => {
    const total = [...w].reduce((s, l) => s + Number(l), 0)
    assert.equal(total, i === 106 ? 13 : 11, `symbole ${i}`)
  })
})

test('le controle : somme ponderee modulo 103, depart B compris', () => {
  const s = symboles('E000001234')
  assert.equal(s[0], 104)
  assert.equal(s.at(-1), 106)
  const donnees = s.slice(1, -2)
  const attendu = donnees.reduce((t, v, i) => t + v * (i + 1), 104) % 103
  assert.equal(s.at(-2), attendu)
})

test('« E000001234 » : les modules de JsBarcode, a l\'identique', () => {
  assert.equal(
    modules('E000001234'),
    '1101001000010001101000100111011001001110110010011101100100111011001001110110010011100110110011100101100101110011001001110100101100001100011101011',
  )
})

test('les barres : marge de 10 modules de chaque cote', () => {
  const { barres: b, largeur } = barres('E000001234')
  assert.equal(b[0].x, 10)
  assert.equal(largeur, modules('E000001234').length + 20)
  const fin = b.at(-1)!
  assert.equal(fin.x + fin.l, largeur - 10)
})

test('un caractere hors du jeu B est refuse', () => {
  assert.throws(() => symboles('é'))
})
