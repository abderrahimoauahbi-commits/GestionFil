# AGENT_CONTEXT — GestionFil

Contexte stable et neutre pour tout agent qui travaille sur ce projet (AI Software Factory, Playbook §16.3). Il ne
remplace pas `CLAUDE.md` (guide détaillé) : il en extrait les règles permanentes. Manifest : `factory.yaml`.
Aucun secret ici.

## Le projet

ERP « Gestion Fil » de Polyfashions Carpet Morocco : achats, stocks et production de matières premières (fil pour
tapis). Code, commentaires, messages et interface en **français**.
Pile : backend Rust (Axum 0.8, sqlx 0.8 en requêtes dynamiques) ; base PostgreSQL 18 (`db/pg/`) ; frontend React 19
+ TypeScript + Tailwind 4 (web PWA et bureau Tauri 2).

## Règles métier permanentes (ne jamais les contourner)

- **Les invariants sont en base, les orchestrations dans le service** (ADR-001 D-04) : stock jamais négatif,
  mouvements et audit immuables, transitions d'état sans retour, Σ % = 100 des recettes, ségrégation des tâches —
  garantis par les déclencheurs de `db/pg/010*.sql`. Le backend ne les réimplémente pas.
- **Le kilogramme est l'unité canonique** ; bobines, palettes, mètres ne sont que des masques de saisie ; un facteur
  manquant fait échouer la saisie, jamais de repli sur ×1. Arrondis : 4 décimales (kg, CMUP), 2 (montants).
- `stock_magasin` n'est qu'un cache : `ligne_mouvement` fait foi.
- Toute transaction écrivante commence par `db::poser_contexte`.
- **Le backend est l'autorité** (RBAC par module, masquage par champ) ; le frontend ne fait que refléter.
- Une suppression se fait par contre-passation, dévalidation ou désactivation, jamais par un `DELETE` sec.

## Commandes sûres pour un agent

```bash
cd frontend && npm test          # tests unitaires du frontend (node --test) — sans base, sans serveur
cd backend && cargo test --bins  # tests unitaires Rust — sans base
```

Le banc (`backend/tests/banc/banc.py`) et les tests de bout en bout (`frontend/e2e/lancer.py`) créent des bases
jetables dans PostgreSQL : **pas à la portée d'un agent C1**.

## Zones interdites

- La base `gestionfil` et le serveur local sur le port 8080 (CLAUDE.md, « Pièges connus »).
- La production : serveur `192.168.1.140` et `erp-polyfashions.dedyn.io` ; scripts `deploiement/`.
- `backend/.env*`, `backend/sauvegardes/`, `db/pg/seed_100_*`, `seed_110_*`, `seed_120_*`, `.claude/settings.local.json`.
- Toute écriture hors des chemins `paths.write` de `factory.yaml` et du périmètre du ticket.

## Décisions de référence

`docs/ADR-001-decisions-fondatrices.md`, `docs/ADR-002-regles-de-gestion-2026-10.md`,
`docs/ADR-003-reception-unifiee-gr-ir-landed-cost.md`.
