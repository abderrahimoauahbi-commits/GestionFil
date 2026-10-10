/**
 * LE CONTROLE DE COLISAGE DE L'ECRAN, sur les cas qu'il partage avec la base
 * (backend/tests/banc/cas_colisage.json, joues aussi contre fn_controle_colisage
 * par le banc). Les deux doivent rendre le meme verdict : c'etait l'un des
 * constats de l'audit (« 10/25 identique ecran/SQL »), sans rien pour le garder.
 *
 * Lancement : npm test (node --test ; Node 24 lit le TypeScript sans outil).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { controleColisage, depuisKg, depuisPalettes, saisieExacte } from '../src/lib/conditionnement.ts'

interface Cas {
  nom: string
  kg: number
  bobines: number | null
  palettes: number | null
  attendu: 'ok' | 'alerte' | 'incoherent'
}
const donnees = JSON.parse(
  readFileSync(new URL('../../backend/tests/banc/cas_colisage.json', import.meta.url), 'utf-8'),
) as { poids_bobine_kg: number; bobines_par_palette: number; alerte_pct: number; refus_pct: number; cas: Cas[] }

const fiche = { poids_bobine_kg: donnees.poids_bobine_kg, bobines_par_palette: donnees.bobines_par_palette }
const tolerances = { alerte: donnees.alerte_pct, refus: donnees.refus_pct }

for (const c of donnees.cas) {
  test(`colisage : ${c.nom}`, () => {
    const v = controleColisage(c.kg, c.bobines, c.palettes, fiche, tolerances)
    assert.equal(v.niveau, c.attendu, v.message ?? '')
  })
}

test('le kilogramme reste canonique : 4 032 kg font 1 920 bobines et 6 palettes', () => {
  const r = depuisKg(4032, fiche)
  assert.equal(r.bobines, 1920)
  assert.equal(r.palettes, 6)
})

test('une palette se convertit sans repli sur x1', () => {
  const r = depuisPalettes(2, fiche)
  assert.equal(r.bobines, 672)
  assert.ok(Math.abs((r.kg ?? 0) - 1411.2) < 1e-9)
  // Sans conditionnement, pas de kilos inventes.
  assert.equal(depuisPalettes(2, {}).kg, null)
})

// LA SAISIE EXACTE SE JUGE A QUATRE DECIMALES, celles que la base garde (10/10/2026) :
// 6 kg en palettes de 463,2 kg ne se traduisent pas exactement, ils partent en kilos.
test('saisieExacte : une traduction inexacte a quatre decimales part en kilos', () => {
  assert.deepEqual(saisieExacte(6, 'Palette', 463.2), { unite_saisie: 'kg', quantite_saisie: 6 })
  assert.deepEqual(saisieExacte(926.4, 'Palette', 463.2), { unite_saisie: 'Palette', quantite_saisie: 2 })
  // Une palette refaite depuis la quantite gardee par la base rend toujours les kilos envoyes.
  for (const kg of [1, 6, 12.5, 99.9, 2500, 3554.1]) {
    const s = saisieExacte(kg, 'Palette', 463.2)
    const garde = Number(s.quantite_saisie.toFixed(4))
    const facteur = s.unite_saisie === 'kg' ? 1 : 463.2
    assert.ok(Math.abs(garde * facteur - kg) < 0.001, `${kg} kg : ${JSON.stringify(s)}`)
  }
})
