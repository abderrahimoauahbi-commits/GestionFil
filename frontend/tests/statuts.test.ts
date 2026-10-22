/**
 * OU UN BON S'EFFACE, ET OU IL S'ANNULE (src/lib/statuts.ts).
 *
 * L'ecran ne propose « Supprimer » qu'en BROUILLON (un bon en validation est fige
 * depuis le 21/10/2026) ; au-dela, le numero est parti chez un fournisseur et le bon s'annule. Le
 * serveur tient la meme regle (supprimer_bc, backend/src/routes/bons_commande.rs) et a
 * le dernier mot : le second test lit sa garde et echoue si les deux listes
 * divergent — c'est la promesse ecrite dans statuts.ts.
 *
 * Lancement : npm test (node --test ; Node 24 lit le TypeScript sans outil).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SUPPRIMABLES, estSupprimable } from '../src/lib/statuts.ts'

test('estSupprimable : brouillon seulement', () => {
  assert.equal(estSupprimable('BROUILLON'), true)
  for (const statut of ['EN_ATTENTE_VALIDATION', 'EN_CONTROLE', 'DEMANDE_PRIX', 'VALIDE', 'ANNULE', 'RECU', 'CLOTURE', '', 'brouillon', ' BROUILLON'])
    assert.equal(estSupprimable(statut), false, statut)
})

test('l\'ecran et le serveur ont la meme liste', () => {
  const source = readFileSync(new URL('../../backend/src/routes/bons_commande.rs', import.meta.url), 'utf-8')
  const debut = source.indexOf('pub async fn supprimer_bc(')
  assert.ok(debut >= 0, 'supprimer_bc introuvable dans bons_commande.rs')
  const fin = source.indexOf('\npub async fn ', debut + 1)
  const corps = source.slice(debut, fin < 0 ? undefined : fin)
  const garde = corps.split('\n').find((l) => /^\s*if statut != "/.test(l))
  assert.ok(garde, 'garde « if statut != … » introuvable dans supprimer_bc')
  const serveur = [...garde.matchAll(/statut != "([A-Z_]+)"/g)].map((m) => m[1]).sort()
  assert.deepEqual(serveur, [...SUPPRIMABLES].sort())
})
