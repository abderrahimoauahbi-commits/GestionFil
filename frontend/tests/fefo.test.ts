/**
 * L'ORDRE DE SORTIE DES LOTS (FEFO, 17/10/2026).
 *
 * Le premier cas est celui qui compte aujourd'hui : SANS PEREMPTION, l'ordre doit
 * rester exactement le FIFO d'avant. Aucun lot n'en porte au 17/10 ; passer au
 * FEFO ne doit rien changer pour personne tant qu'on n'en saisit pas.
 *
 * Lancement : npm test (node --test ; Node 24 lit le TypeScript sans outil).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trierPourSortie } from '../src/lib/fefo.ts'

const lot = (nom: string, entree: string, peremption: string | null = null) => ({
  nom,
  date_premiere_entree: entree,
  date_peremption: peremption,
})
const noms = (l: { nom: string }[]) => l.map((x) => x.nom)

test('sans peremption, l’ordre est exactement le FIFO d’avant', () => {
  const lots = [
    lot('C', '2026-03-10'),
    lot('A', '2025-11-02'),
    lot('D', '2026-08-30'),
    lot('B', '2026-01-15'),
  ]
  // L'ancien tri de ChampLot, recopie tel quel : la reference.
  const fifo = [...lots].sort((a, b) => a.date_premiere_entree.localeCompare(b.date_premiere_entree))
  assert.deepEqual(noms(trierPourSortie(lots)), noms(fifo))
  assert.deepEqual(noms(trierPourSortie(lots)), ['A', 'B', 'C', 'D'])
})

test('le lot qui perime le premier sort le premier, meme entre plus tard', () => {
  const lots = [lot('ANCIEN', '2025-01-01', '2027-06-30'), lot('RECENT', '2026-09-01', '2026-12-31')]
  assert.deepEqual(noms(trierPourSortie(lots)), ['RECENT', 'ANCIEN'])
})

test('un lot avec peremption passe devant un lot sans peremption', () => {
  const lots = [lot('SANS', '2024-01-01'), lot('AVEC', '2026-09-01', '2030-01-01')]
  assert.deepEqual(noms(trierPourSortie(lots)), ['AVEC', 'SANS'])
})

test('a peremption egale, le plus ancien sort le premier', () => {
  const lots = [lot('NEUF', '2026-09-01', '2027-01-31'), lot('VIEUX', '2026-02-01', '2027-01-31')]
  assert.deepEqual(noms(trierPourSortie(lots)), ['VIEUX', 'NEUF'])
})

test('une peremption vide vaut une peremption absente', () => {
  // La base peut rendre une chaine vide comme un NULL : les deux se trient pareil.
  const lots = [lot('VIDE', '2026-05-01', ''), lot('NULLE', '2026-01-01', null)]
  assert.deepEqual(noms(trierPourSortie(lots)), ['NULLE', 'VIDE'])
})

test('le tableau recu n’est pas modifie', () => {
  const lots = [lot('B', '2026-02-01'), lot('A', '2026-01-01')]
  trierPourSortie(lots)
  assert.deepEqual(noms(lots), ['B', 'A'])
})
