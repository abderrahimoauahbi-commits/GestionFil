/**
 * LE FORMATAGE DES NOMBRES (fmt, src/lib/utils.ts), par lequel passe tout
 * l'affichage de l'application : un nombre fini s'affiche a la francaise, une
 * valeur absente ou non finie (NaN, infini) s'affiche « — ».
 *
 * Les attentes sont calculees par toLocaleString plutot qu'ecrites en dur :
 * l'espace des milliers depend de la version d'ICU embarquee par Node.
 *
 * Lancement : npm test (node --test ; Node 24 lit le TypeScript sans outil).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmt } from '../src/lib/utils.ts'

const NON_FINIS = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0 / 0, 1 / 0]
const ABSENTS = [null, undefined, '', '12', '1 234,5']

test('non fini : « — » partout (T-GF-009)', () => {
  for (const v of NON_FINIS) {
    assert.equal(fmt.nombre(v), '—', `nombre(${v})`)
    assert.equal(fmt.nombre(v, 4), '—', `nombre(${v}, 4)`)
    assert.equal(fmt.entier(v), '—', `entier(${v})`)
    assert.equal(fmt.mad(v), '—', `mad(${v})`)
    assert.equal(fmt.compact(v), '—', `compact(${v})`)
  }
})

test('absent ou texte : « — », comme avant', () => {
  for (const v of ABSENTS) {
    assert.equal(fmt.nombre(v), '—')
    assert.equal(fmt.entier(v), '—')
    assert.equal(fmt.mad(v), '—')
    assert.equal(fmt.compact(v), '—')
  }
})

test('fini : affichage a la francaise inchange', () => {
  assert.equal(fmt.nombre(1234.5), (1234.5).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  assert.equal(fmt.nombre(0.125, 1), (0.125).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
  assert.equal(fmt.nombre(0), (0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  assert.equal(fmt.entier(-42), (-42).toLocaleString('fr-FR'))
  assert.equal(fmt.mad(9876.543), `${(9876.543).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} MAD`)
})

test('compact : millions, milliers, unites', () => {
  assert.equal(fmt.compact(13421922), `${(13.421922).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`)
  assert.equal(fmt.compact(-2500), `${(-2.5).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k`)
  assert.equal(fmt.compact(999), '999')
  assert.equal(fmt.compact(0), '0')
})
