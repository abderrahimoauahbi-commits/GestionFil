/**
 * Le reessai des lectures en echec (17/10/2026). Une rafale (429 de nginx) ou un
 * serveur sature (503) se reessaient ; un refus, une regle metier ou un
 * verrouillage de connexion, jamais.
 *
 * Lancement : npm test (node --test ; Node 24 lit le TypeScript sans outil).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { doitReessayer } from '../src/lib/reessai.ts'

const erreur = (statut: number, code = 'ERREUR') => ({ statut, code })

test('une rafale (429 de nginx) se reessaie, trois fois au plus', () => {
  assert.equal(doitReessayer(0, erreur(429, 'TROP_DE_REQUETES')), true)
  assert.equal(doitReessayer(2, erreur(429, 'TROP_DE_REQUETES')), true)
  assert.equal(doitReessayer(3, erreur(429, 'TROP_DE_REQUETES')), false)
})

test('un serveur sature (503) se reessaie, trois fois au plus', () => {
  assert.equal(doitReessayer(0, erreur(503, 'SERVEUR_OCCUPE')), true)
  assert.equal(doitReessayer(3, erreur(503, 'SERVEUR_OCCUPE')), false)
})

test('un verrouillage de connexion ne se reessaie jamais', () => {
  // Il dure des minutes : reessayer dans la seconde compterait comme de nouvelles tentatives.
  assert.equal(doitReessayer(0, erreur(429, 'TROP_DE_TENTATIVES')), false)
})

test('un refus de droits ou une regle metier ne se reessaie jamais', () => {
  for (const s of [400, 401, 403, 404, 409, 422]) {
    assert.equal(doitReessayer(0, erreur(s)), false, `statut ${s}`)
  }
})

test('une panne passagere se reessaie deux fois', () => {
  assert.equal(doitReessayer(0, erreur(500)), true)
  assert.equal(doitReessayer(1, erreur(502)), true)
  assert.equal(doitReessayer(2, erreur(500)), false)
})

test('une erreur sans statut (reseau) se reessaie deux fois', () => {
  assert.equal(doitReessayer(0, new Error('reseau')), true)
  assert.equal(doitReessayer(2, null), false)
})
