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
import { readFileSync, readdirSync } from 'node:fs'
import {
  SOURCE_STATUTS,
  STATUTS,
  SUPPRIMABLES,
  estSupprimable,
  humaniser,
  libelleStatut,
  statutMetier,
  tonStatut,
  type EntiteStatut,
} from '../src/lib/statuts.ts'

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

// =============================================================================
// LA TABLE DES STATUTS METIER (24/10/2026)
// =============================================================================

const racine = new URL('../../', import.meta.url)
const lire = (chemin: string) => readFileSync(new URL(chemin, racine), 'utf-8')

/**
 * Les codes que la BASE permet, colonne par colonne : chaque contrainte CHECK
 * « pure » (`col IN (...)`, eventuellement `col IS NULL OR col IN (...)`) du
 * schema db/pg puis des migrations, dans l'ordre ou elles se jouent — la
 * derniere definition d'une colonne fait foi (une migration qui retire un code
 * le retire ici aussi). Les contraintes conditionnelles (`statut IN (...) OR
 * date_validation IS NOT NULL`) ne disent pas la liste et sont ignorees.
 */
function codesDeLaBase(): Map<string, string[]> {
  const dossier = 'db/pg/'
  const schema = readdirSync(new URL(dossier, racine))
    .filter((f) => /^\d{3}[a-z]?_.*\.sql$/.test(f))
    .sort()
    .map((f) => dossier + f)
  const migrations = readdirSync(new URL(dossier + 'migrations/', racine))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => dossier + 'migrations/' + f)
  const codes = new Map<string, string[]>()
  for (const fichier of [...schema, ...migrations]) {
    const texte = lire(fichier).replace(/--[^\n]*/g, '')
    for (const instruction of texte.split(';')) {
      const table = /\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE(?:\s+IF\s+EXISTS)?(?:\s+ONLY)?)\s+(?:public\.)?(\w+)/i.exec(instruction)?.[1]
      if (!table) continue
      const motif =
        /CHECK\s*\(\s*\(*\s*(?:(\w+)\s+IS\s+NULL\s*\)*\s+OR\s+\(*\s*)?(\w+)\s+(?:IN\s*\(([^)]*)\)|=\s*ANY\s*\(\s*ARRAY\s*\[([^\]]*)\]\s*\))(?![\s)]*(?:OR|AND)\b)/gi
      for (const m of instruction.matchAll(motif)) {
        if (m[1] && m[1] !== m[2]) continue
        const valeurs = [...(m[3] ?? m[4]).matchAll(/'([^']*)'/g)].map((v) => v[1])
        if (valeurs.length) codes.set(`${table.toLowerCase()}.${m[2].toLowerCase()}`, valeurs)
      }
    }
  }
  return codes
}

/** Les codes calcules : relus a la source qui les ecrit. */
function codesCalcules(source: string): string[] {
  const [fichier, nom] = source.slice('calcule:'.length).split('#')
  const texte = lire(fichier)
  const fin = texte.search(new RegExp(String.raw`\bAS\s+${nom}\b`))
  assert.ok(fin >= 0, `« AS ${nom} » introuvable dans ${fichier}`)
  // Le CASE qui ferme sur « END AS nom » : on remonte en comptant les CASE
  // imbriques (la livraison en a un pour le retard partiel).
  const jetons = [...texte.slice(0, fin).matchAll(/\b(CASE|END)\b/g)].reverse()
  let profondeur = 0
  let debut = 0
  for (const j of jetons) {
    profondeur += j[1] === 'END' ? 1 : -1
    if (profondeur === 0) {
      debut = j.index
      break
    }
  }
  return [...new Set([...texte.slice(debut, fin).matchAll(/(?:THEN|ELSE)\s+'([^']+)'/g)].map((m) => m[1]))]
}

test('chaque code de la base a son libelle dans la table des statuts', () => {
  const base = codesDeLaBase()
  for (const entite of Object.keys(STATUTS) as EntiteStatut[]) {
    const source = SOURCE_STATUTS[entite]
    const attendus = source.startsWith('calcule:') ? codesCalcules(source) : base.get(source)
    assert.ok(attendus && attendus.length > 0, `${entite} : aucune contrainte CHECK pour ${source}`)
    const table = Object.keys(STATUTS[entite]).sort()
    assert.deepEqual(table, [...attendus].sort(), `${entite} (${source}) : la table et la base divergent`)
  }
})

test('les sources nommees sont celles de la base (statut principal de chaque document)', () => {
  const base = codesDeLaBase()
  // Les quelques valeurs relues dans la base de saisie le 24/10/2026 (pg_constraint).
  assert.deepEqual(base.get('inventaire.statut'), ['BROUILLON', 'VALIDE', 'CLOTURE', 'ANNULE'])
  assert.deepEqual(base.get('bon_commande.statut')?.length, 9)
  assert.deepEqual(base.get('ordre_fabrication.statut'), ['PREVU', 'LANCE', 'CLOTURE', 'ANNULE'])
})

test('un code inconnu ne s affiche jamais brut', () => {
  assert.equal(humaniser('A_CONTROLER'), 'A controler')
  assert.equal(humaniser('MEME FOURNISSEUR'), 'Meme fournisseur')
  assert.equal(humaniser('PARTIEL EN RETARD'), 'Partiel en retard')
  for (const code of ['NOUVEAU_STATUT', 'EN_ATTENTE_SIGNATURE', 'ABANDONNE']) {
    const s = statutMetier('bon_commande', code)
    assert.notEqual(s.libelle, code)
    assert.equal(s.ton, 'neutre')
  }
  assert.equal(libelleStatut('reception', null), '')
})

test('aucun libelle de la table n est un code brut, et une meme semantique garde son ton', () => {
  for (const [entite, table] of Object.entries(STATUTS)) {
    for (const [code, def] of Object.entries(table)) {
      if (entite === 'classe_abc' || code === 'OK') continue
      assert.notEqual(def.libelle, code, `${entite}.${code}`)
      assert.ok(!/_/.test(def.libelle), `${entite}.${code} : « ${def.libelle} »`)
    }
  }
  for (const entite of Object.keys(STATUTS) as EntiteStatut[]) {
    if ('ANNULE' in STATUTS[entite]) assert.equal(tonStatut(entite, 'ANNULE'), 'danger', entite)
    if ('ANNULEE' in STATUTS[entite]) assert.equal(tonStatut(entite, 'ANNULEE'), 'danger', entite)
    if ('CLOTURE' in STATUTS[entite]) assert.equal(tonStatut(entite, 'CLOTURE'), 'neutre', entite)
    if ('BROUILLON' in STATUTS[entite]) assert.equal(tonStatut(entite, 'BROUILLON'), 'neutre', entite)
  }
  assert.equal(tonStatut('statut_stock', 'CRITIQUE'), 'danger')
})
