/**
 * L'EXPORT CSV POUR EXCEL FRANCOPHONE (src/lib/export.ts). Vingt-cinq tableaux
 * passent par versCsv : ces tests figent ses trois conventions — point-virgule,
 * BOM, virgule decimale seulement sur les nombres des colonnes numeriques — et
 * l'echappement RFC 4180, tels qu'ils sont aujourd'hui.
 *
 * Lancement : npm test (node --test ; Node 24 lit le TypeScript sans outil).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { versCsv } from '../src/lib/export.ts'
import type { ColonneExport } from '../src/lib/export.ts'

type Ligne = Record<string, unknown>

const BOM = '﻿'
const COLONNES: ColonneExport<Ligne>[] = [
  { champ: 'code', entete: 'Code' },
  { champ: 'qte', entete: 'Quantité', numerique: true },
]

/** Les lignes du fichier, BOM retire. */
const lignesDe = (csv: string) => csv.slice(BOM.length).split('\r\n')

/** La cellule d'une colonne numerique seule, pour une valeur donnee. */
const numerique = (v: unknown) =>
  lignesDe(versCsv([{ champ: 'v', entete: 'V', numerique: true }], [{ v }]))[1]

/** La cellule d'une colonne de texte seule, pour une valeur donnee. */
const texte = (v: unknown) => lignesDe(versCsv([{ champ: 'v', entete: 'V' }], [{ v }]))[1]

test('structure : BOM, en-tete, point-virgule, CRLF', () => {
  const csv = versCsv(COLONNES, [
    { code: 'A1', qte: 2.5 },
    { code: 'B2', qte: 10 },
  ])
  assert.equal(csv, BOM + 'Code;Quantité\r\nA1;2,5\r\nB2;10')
})

test('un seul BOM, en tete, et aucun saut de ligne isole', () => {
  const csv = versCsv(COLONNES, [{ code: 'A1', qte: 1 }])
  assert.ok(csv.startsWith(BOM))
  assert.equal(csv.indexOf(BOM, 1), -1)
  assert.equal(csv.replace(/\r\n/g, '').includes('\n'), false)
})

test('liste vide : l\'en-tete seul', () => {
  assert.equal(versCsv(COLONNES, []), BOM + 'Code;Quantité')
})

test('aucune colonne : le BOM seul', () => {
  assert.equal(versCsv([], []), BOM)
})

test('colonne numerique : virgule decimale sur un nombre fini', () => {
  assert.equal(numerique(1234.5), '1234,5')
  assert.equal(numerique(-0.25), '-0,25')
  assert.equal(numerique(1234567.891), '1234567,891')   // pas de separateur de milliers
  assert.equal(numerique(0), '0')
  assert.equal(numerique(10), '10')
})

test('colonne numerique : le texte n\'est pas converti', () => {
  assert.equal(numerique('12.5'), '12.5')
  assert.equal(numerique('—'), '—')
  assert.equal(numerique('PP-1500 Dtex-1.5'), 'PP-1500 Dtex-1.5')
})

test('colonne numerique : NaN et l\'infini donnent une cellule vide (T-GF-003)', () => {
  assert.equal(numerique(Number.NaN), '')
  assert.equal(numerique(Number.POSITIVE_INFINITY), '')
  assert.equal(numerique(Number.NEGATIVE_INFINITY), '')
  assert.equal(numerique(1 / 0), '')
})

test('colonne de texte : NaN reste ecrit tel quel (hors du champ de T-GF-003)', () => {
  assert.equal(texte(Number.NaN), 'NaN')
})

test('colonne de texte : un nombre garde son point', () => {
  assert.equal(texte(1.5), '1.5')
  assert.equal(texte('PP-1500 Dtex-1.5'), 'PP-1500 Dtex-1.5')
  assert.equal(texte(false), 'false')
})

test('vide : null, undefined et champ absent donnent une cellule vide', () => {
  assert.equal(texte(null), '')
  assert.equal(texte(undefined), '')
  assert.equal(numerique(null), '')
  assert.equal(lignesDe(versCsv(COLONNES, [{ code: 'A1' }]))[1], 'A1;')
})

test('valeurExport l\'emporte sur le champ brut', () => {
  const colonnes: ColonneExport<Ligne>[] = [
    { champ: 'statut', entete: 'Statut', valeurExport: (l) => `Libellé ${String(l.statut)}` },
    { champ: 'prix', entete: 'Prix', numerique: true, valeurExport: (l) => Number(l.prix) * 1.5 },
    { champ: 'note', entete: 'Note', valeurExport: () => null },
  ]
  const csv = versCsv(colonnes, [{ statut: 'BROUILLON', prix: 2.5, note: 'ignoree' }])
  assert.equal(lignesDe(csv)[1], 'Libellé BROUILLON;3,75;')
})

test('echappement RFC 4180 : point-virgule, guillemet, sauts de ligne', () => {
  assert.equal(texte('Bleu; marine'), '"Bleu; marine"')
  assert.equal(texte('dit "oui"'), '"dit ""oui"""')
  assert.equal(texte('"'), '""""')
  assert.equal(numerique('a;b'), '"a;b"')
  // Un saut de ligne dans une cellule est garde, entre guillemets.
  assert.equal(versCsv([{ champ: 'v', entete: 'V' }], [{ v: 'a\nb' }]), BOM + 'V\r\n"a\nb"')
  assert.equal(versCsv([{ champ: 'v', entete: 'V' }], [{ v: 'a\rb' }]), BOM + 'V\r\n"a\rb"')
})

test('echappement de l\'en-tete aussi, jamais converti en nombre', () => {
  const csv = versCsv([{ champ: 'p', entete: 'Prix; HT "net"', numerique: true }], [])
  assert.equal(csv, BOM + '"Prix; HT ""net"""')
})

test('une virgule dans le texte n\'est pas echappee (le separateur est le point-virgule)', () => {
  assert.equal(texte('Rouge, vert'), 'Rouge, vert')
})
