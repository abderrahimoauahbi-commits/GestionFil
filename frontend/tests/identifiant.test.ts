/**
 * L'identifiant tire par l'ecran (19/10/2026) : un UUID version 4, que le
 * serveur accepte, y compris sans `crypto.randomUUID` (poste en http).
 *
 * Lancement : npm test (node --test ; Node 24 lit le TypeScript sans outil).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nouvelIdentifiant } from '../src/lib/identifiant.ts'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('un UUID version 4, different a chaque tirage', () => {
  const a = nouvelIdentifiant()
  assert.match(a, UUID_V4)
  assert.notEqual(a, nouvelIdentifiant())
})

test('sans crypto.randomUUID (contexte non sur) : toujours un UUID version 4', () => {
  const c = globalThis.crypto as Crypto & { randomUUID?: unknown }
  const origine = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(c), 'randomUUID')
  Object.defineProperty(c, 'randomUUID', { value: undefined, configurable: true })
  try {
    for (let i = 0; i < 200; i++) assert.match(nouvelIdentifiant(), UUID_V4)
  } finally {
    delete (c as { randomUUID?: unknown }).randomUUID
    if (origine) assert.equal(typeof c.randomUUID, 'function')
  }
})
