# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ERP « Gestion Fil » de Polyfashions Carpet Morocco : achats, stocks et production de matières
premières (fil pour tapis). Tout le code, les commentaires, les messages et l'interface sont en
**français** — écrire de même.

## Pile

- `db/pg/` — schéma **PostgreSQL 18** : tables, déclencheurs, vues, contrôles, seeds. Source unique
  du schéma depuis l'abandon de SQLite (04/09/2026).
- `backend/` — Rust + Axum 0.8 + sqlx 0.8 (requêtes **dynamiques**, pas de macros `query!`).
  Trois binaires : `gestionfil` (serveur, `default-run`), `gestionfil-admin`, `gestionfil-import`.
- `frontend/` — React 19 + TypeScript + Tailwind 4 + Radix + TanStack Query/Table. Une seule base
  de code pour le web (PWA) et le bureau (Tauri 2, `frontend/src-tauri`).
- `deploiement/` — scripts du serveur Ubuntu (192.168.1.140) : paquet, publication, retour arrière.

> Les README racine et `backend/README.md` sont en partie périmés : `db/build.ps1`,
> `db/tests/run-tests.ps1`, `backend/tests/e2e.ps1` et toute mention de SQLite (`gestionfil.db`,
> `sqlite3` dans `demarrer.ps1`) ne correspondent plus au dépôt. `db/README.md` et
> `deploiement/README.md` sont à jour.

## Commandes

```powershell
# Base locale (schéma, vues, contrôles, seeds) — joue les fichiers PAR PASSES
cd db\pg; python charger.py                       # base `gestionfil`
python charger.py --base gestionfil_essai         # autre base
python charger.py --production                    # comptes réels, référentiel à importer ensuite

# Appliquer une migration (pas de table de suivi : rien ne signale un oubli)
psql -d gestionfil -v ON_ERROR_STOP=1 -f migrations\<fichier>.sql

# Backend (lit backend\.env : DATABASE_URL, JWT_SECRET, BIND_ADDR, CORS_ORIGINS, FRONTEND_DIR)
cd backend
cargo run --bin gestionfil-admin -- init-config   # crée .env
cargo run --bin gestionfil-import -- --simuler    # import du classeur à blanc
cargo run                                         # API sur 127.0.0.1:8080
cargo check
cargo test                                        # tests unitaires (#[test] dans src/)
cargo test --bin gestionfil domain::plan          # un module / un test par filtre de nom
cargo run --bin gestionfil-admin -- verifier      # contrôles métier
# autres sous-commandes admin : definir-mot-de-passe <login>, lister-comptes, sauvegarder,
# lister-sauvegardes, restaurer, diagnostic, reparer

# Frontend (Vite relaie /api vers :8080)
cd frontend
npm run dev          # :5173
npm run build        # tsc -b + vite build — c'est la vérification de types de référence
npm run lint         # eslint + tsc --noEmit
npm run bureau:dev   # fenêtre Tauri

# Tout d'un coup
.\demarrer.ps1       # compile et lance le backend, puis Vite
.\deploiement\fabriquer-paquet.ps1   # paquet pour 03-publier.sh sur le serveur
```

## Architecture

**Les invariants sont en base, les orchestrations dans le service** (ADR-001 D-04). Stock jamais
négatif, mouvements/archives/audit immuables, transitions d'état sans retour arrière, Σ % = 100
des recettes, ségrégation des tâches (créateur BC ≠ valideur) : tout est garanti par les
déclencheurs de `db/pg/010*.sql`. Le backend ne réimplémente pas ces règles ; les messages des
déclencheurs (`R02 : stock insuffisant…`) remontent tels quels au client via `error.rs`
(`REGLE_METIER` → 422). Au démarrage, `db::verifier_schema` refuse de servir une base qui n'a pas
assez de tables/vues/déclencheurs.

**Le kilogramme est l'unité canonique.** Bobines, palettes, mètres ne sont que des masques de
saisie (`domain/unites.rs`, `frontend/src/lib/conditionnement.ts`) ; un facteur manquant fait
échouer la saisie, jamais de repli sur ×1. Arrondir à l'écriture : 4 décimales pour kg et CMUP,
2 pour les montants (`db::arrondi_kg`, `db::arrondi_mad`).

**`stock_magasin` n'est qu'un cache** ; `ligne_mouvement` (le grand livre) fait foi. Le contrôle
C11 compare les deux.

**Backend — trois familles de routes** (`backend/src/routes/mod.rs`, un seul `Router`) :
- CRUD générique `/api/{entite}` piloté par le registre `ENTITES` de `crud.rs` : liste blanche de
  colonnes en création/modification, politique de suppression, module RBAC. Ajouter une entité de
  référentiel = ajouter une entrée au registre, pas écrire des handlers. Les routes génériques
  sont enregistrées **en dernier** pour ne pas masquer les routes spécifiques.
- Entités à workflow (qualités, recettes, plans, réceptions, BC, lots, machines…) : modules
  dédiés dans `routes/` et cascades transactionnelles dans `domain/` (réception 3-en-1,
  transfert, clôture d'inventaire, MRP, plan d'achat, ABC/XYZ).
- `/api/chat` : l'assistant (`backend/src/assistant/`). Le modèle de langage (Ollama ou Claude,
  choisi par le paramètre `P_AssistantMoteur`) ne fait que **choisir une compétence** ; la
  requête est écrite à l'avance, et le résultat est masqué selon les droits. Il ne produit que des
  brouillons, jamais d'écriture.

**Toute transaction écrivante** commence par `db::poser_contexte` (`SET LOCAL app.id_utilisateur`,
etc.), sinon le journal d'audit enregistre une action anonyme.

**Sécurité à deux niveaux** (`auth/rbac.rs`) : permission de module LIRE / ECRIRE / VALIDER par
rôle (`VALIDER` ≠ `ECRIRE`, base de la ségrégation des tâches), et visibilité par champ
MASQUE / LECTURE / ECRITURE par utilisateur. Le masquage s'applique **à la sortie** (`masquer`)
et à l'entrée (`filtrer_entree`, `exiger_ecriture`). Un handler qui prend `Utilisateur` en
argument est authentifié (le compte est revalidé à chaque requête). Le frontend lit la grille
via `/api/auth/moi` et ne fait que refléter ce que le serveur impose.

**Le serveur sert aussi l'interface** (`FRONTEND_DIR`, repli sur `index.html` pour la navigation
côté client) : même origine en production, pas de CORS. Une route `/api/...` inconnue renvoie
`ROUTE_INCONNUE` plutôt qu'un 405 muet.

**Frontend** : `src/api/client.ts` (jeton en sessionStorage, adresse du serveur réglable par
poste pour les paquets Tauri), `src/App.tsx` (liste `ECRANS`, chaque écran gardé par
`<ExigeModule module="…">`, montée dans `composants/Coquille.tsx` ; `composants/atelier/` est
l'enveloppe à onglets du bureau), `hooks/useCrud.ts` pour le CRUD générique, `composants/ui/` pour les
primitives (Radix + CVA). Couleurs en jetons de thème, jamais en teintes figées.

## Pièges connus

- **Schéma** : éditer `db/pg/*.sql` **et** écrire une migration datée et rejouable dans
  `db/pg/migrations/` (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE VIEW`, upsert). Une
  migration qui crée une table ou une vue doit faire `OWNER TO gestionfil` (elles se jouent en
  `postgres` sur le serveur). Ordre : sauvegarde → migration → publication du binaire.
- **Vues** : ne pas recharger `db/pg/*.sql` fichier par fichier ; `charger.py` résout les
  références avant. `012_controles.sql` doit passer en dernier. Témoin après intervention :
  `SELECT count(*) FROM v_controles` et `/api/cockpit` en 200.
- **SQL sqlx/PostgreSQL** (ne casse qu'à l'exécution, en « erreur interne ») : `NUMERIC` lu en
  `f64` → `::float8` ; `ROUND(x, n)` sur un flottant → `$n::numeric` ; jamais `?`,
  `SUM(booléen)` (→ `COUNT(*) FILTER (WHERE …)`), `datetime('now')` ; listes via `= ANY($1)`.
  Vérifier une requête nouvelle par `PREPARE` sur une **copie** de la base.
- Devant une « erreur interne » à l'écriture : vérifier d'abord que la base locale a bien les
  migrations récentes (colonnes, déclencheurs) avant de lire le code.
- **Ne pas toucher la base `gestionfil` ni le serveur de l'utilisateur sur le port 8080** : essais
  sur une copie (`pg_dump` → base de répétition), serveur d'essai sur un autre port (8099), et
  `CARGO_TARGET_DIR` séparé pour ne pas buter sur `gestionfil.exe` verrouillé.
- Avant de reprendre le travail, vérifier qu'aucun marqueur de conflit n'a été commité :
  `grep -rl '^<<<<<<< ' --include=*.rs --include=*.tsx` (déjà arrivé le 24/09/2026).
- Suppression : préférer contre-passation, dévalidation ou désactivation logique à un refus sec
  ou un `DELETE` ; l'historique comptable ne disparaît pas.

## Documentation

- `docs/ADR-001-decisions-fondatrices.md` — décisions d'architecture.
- `docs/ecarts-cahier-des-charges.md` — traçabilité cahier des charges → implémentation, points
  en attente de décision métier.
- `db/README.md` — invariants, vues, contrôles C01–C37.
- `deploiement/README.md` — serveur, migrations en production, sauvegardes, assistant.
