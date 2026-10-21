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

> Les README (racine, `backend/`, `db/`, `deploiement/`) ont été remis à jour le 08/10/2026 ;
> `demarrer.ps1` ne cherche plus de base SQLite.

## Commandes

```powershell
# BASE NEUVE ET COMPLÈTE : le socle (schéma exact d'une base migrée + configuration),
# puis les migrations venues après lui. C'est la seule voie qui donne tout le schéma :
# l'historique des migrations ne se rejoue pas sur une base vide (données réelles de septembre).
cd db\pg; python charger.py --base gestionfil_essai --socle --comptes
python migrer.py --base gestionfil_essai          # migrations postérieures au socle
python socle.py --depuis <copie migrée>           # régénérer le socle (jamais depuis gestionfil)

# Fichiers d'origine 001–018 seuls (sans lots, machines, import) — documentation du schéma
python charger.py --base gestionfil_essai --seeds

# Migrations : journal `migration_appliquee` (depuis 2026-10-08c), tenu par migrer.py
python migrer.py --base <base> --lister            # ce qui reste à jouer
python migrer.py --base <base>                     # le jouer, dans l'ordre, arrêt au premier échec
python migrer.py --base <base> --verifier          # fichier modifié après application

# Backend (lit backend\.env : DATABASE_URL, JWT_SECRET, BIND_ADDR, CORS_ORIGINS, FRONTEND_DIR)
cd backend
cargo run --bin gestionfil-admin -- init-config   # crée .env
cargo run --bin gestionfil-import -- --simuler    # import du classeur à blanc
# Plan de production du classeur (feuille Production_Plan) : enregistré par l'API, passé en cours, MRP calculé
python ..\db\pg\importer_plan_production.py --url http://127.0.0.1:8099 --classeur "<GESTION FIL.xlsx>" [--a-blanc]
cargo run                                         # API sur 127.0.0.1:8080
cargo check
cargo test                                        # tests unitaires (#[test] dans src/)
cargo test --bin gestionfil domain::plan          # un module / un test par filtre de nom
cargo run --bin gestionfil-admin -- verifier      # contrôles métier

# BANC DE TESTS (exigé par fabriquer-paquet.ps1) : base jetable bâtie depuis le socle,
# serveur d'essai sur 8096 lancé depuis un dossier vide (aucun .env lu), scénarios métier
# (réception, clôture, avoir, écart de pesée, saisie libre, inventaire, import, colisage,
# déclencheurs, masquage). Base supprimée à la fin. PGPASSWORD = mot de passe postgres.
python backend\tests\banc\banc.py --cible <CARGO_TARGET_DIR>          # tout
python backend\tests\banc\banc.py import inventaire --garder         # quelques scénarios, base gardée
cd frontend; npm test                              # node --test : colisage, mêmes cas que la base
# TESTS DE BOUT EN BOUT (Playwright + Edge, vrais écrans) : base jetable remplie par les scénarios
# du banc, serveur 8097 qui sert frontend/dist (npm run build avant). ecrans.spec : chaque écran ;
# saisie.spec : documents TAPÉS au clavier par les vrais rôles (bon → validation → réception →
# contrôle, fiches, sortie), relus au serveur (« 1 234,5 » doit valoir 1234,5). Échec = écran
# planté, erreur JS, 5xx, valeur mal enregistrée ; le reste (champ trop étroit, tableau qui
# déborde, bouton hors écran, HTML/axe) va dans rapport-e2e/constats.md et galerie.html.
cd frontend; python e2e/lancer.py --cible <CARGO_TARGET_DIR> [-- --grep "écran /stock"]
python e2e/lancer.py --servir      # base + serveur gardés ouverts pour écrire un test
# autres sous-commandes admin : definir-mot-de-passe <login>, lister-comptes, sauvegarder,
# lister-sauvegardes, restaurer, verifier-sauvegarde (restaure à côté, contrôle, efface), diagnostic, reparer

# Frontend (Vite relaie /api vers :8080)
cd frontend
npm run dev          # :5173
npm run build        # tsc -b + vite build — c'est la vérification de types de référence
npm run lint         # eslint + tsc --noEmit
npm run bureau:dev   # fenêtre Tauri

# Tout d'un coup
.\demarrer.ps1       # UN serveur sur :8080 (API + interface, dist recompile si le code a change) ; -Dev ajoute Vite
.\verifier.ps1 -Rapide              # clippy, tests Rust, lint, types, build, tests interface (sans base)
git config core.hooksPath .githooks  # UNE FOIS par clone : verifier.ps1 -Rapide a chaque push
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

**Le fil en route compte** (transfert expédié, pas encore reçu) : valeur du stock et calcul des besoins (`v_stock_transit_reference`, `v_stock_physique.stock_transit_kg`) ; chaque sortie porte son coût, le CMUP du moment (`trg_lmvt_cout_sortie`) ; un prix au kilo garde 4 décimales.

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

**Machines : chaque validation de fiche est une décision** (`domain/decision_machine.rs`,
migration `2026-10-05_decisions_machine.sql`) : état avant → saisie par ligne Réf + Lot →
aperçu (`POST …/apercu`, même calcul que la validation) → validation → état résultant, archivés
dans `machine_decision*` (immuables). L'écart (kg avant + chargé − retiré − après) est classé
par le motif (`machine_motif`). Seule la décision tête d'un étage se retire (dévalider /
annuler), par mouvements `ANNUL_*` liés ; les mouvements de fiche ne se contre-passent pas.
Verrou : fiche puis étage en `FOR UPDATE NOWAIT`. Pas de fiche « Consommation ».

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
l'ancienne enveloppe à onglets, plus montée mais gardée au dépôt par décision — seul `etat.tsx` sert), `hooks/useCrud.ts` pour le CRUD générique, `composants/ui/` pour les
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
- Une migration dont le binaire dépend s'ajoute à `MIGRATIONS_REQUISES` (`backend/src/db.rs`) avec
  un témoin : le serveur refuse alors de démarrer sur une base qui ne l'a pas, en la nommant.
- Écrire du Rust par un heredoc du shell mange les `\` de fin de ligne : les chaînes continuées
  gardent alors de longs blancs. Passer par l'outil d'écriture ou un script `.py`.
- **Ne pas toucher la base `gestionfil` ni le serveur de l'utilisateur sur le port 8080** : essais
  sur une copie (`pg_dump` → base de répétition), serveur d'essai sur un autre port (8099), et
  `CARGO_TARGET_DIR` séparé pour ne pas buter sur `gestionfil.exe` verrouillé.
- Avant de reprendre le travail, vérifier qu'aucun marqueur de conflit n'a été commité :
  `grep -rl '^<<<<<<< ' --include=*.rs --include=*.tsx` (déjà arrivé le 24/09/2026).
- Suppression : préférer contre-passation, dévalidation ou désactivation logique à un refus sec
  ou un `DELETE` ; l'historique comptable ne disparaît pas.

## Documentation

- `docs/ADR-001-decisions-fondatrices.md` — décisions d'architecture.
- `docs/ADR-002-regles-de-gestion-2026-10.md` — les 18 règles du 08/10/2026 : décision, lieu de la garantie, contrôle.
- `docs/ADR-003-reception-unifiee-gr-ir-landed-cost.md` — réception unifiée GR → IR → Landed Cost
  (logique SAP, CMUP seul). **Phase A livrée le 14/10** (migration `2026-10-14a_reception_arrivage.sql`,
  exigée au démarrage) : une réception est un **arrivage** dont chaque **ligne** pege à une ligne de bon
  de commande — un bon ou plusieurs ; le dossier d'import se rattache à l'en-tête ; une ligne sans bon
  fait naître le bon de régularisation (un seul par arrivage) et bloque la validation jusqu'à son envoi.
  **Phase C livrée le 14/10** (`2026-10-14b`, `2026-10-14c`, exigées au démarrage) — l'ordre est devenu
  A → C → B, C étant le préalable de la bascule de l'import : `synchroniser_recu_arrivages` relit les kilos
  d'un dossier depuis ses arrivages validés (recalcul, pas incrément : la facture arrive après le camion),
  l'étanchéité local/import et le contrôle C45 ne visent plus que les dossiers restés en circuit `FACTURE`,
  et `import_dossiers.circuit_reception` passe à `BON` par défaut.
  **Écran `/receptions-import` retiré le 16/10** : la réception d'import n'est plus un circuit, la marchandise
  importée entre par la réception unifiée ; les routes `/api/import/a-recevoir` et `/api/import/receptions*`
  n'existent plus. Les frais d'approche d'un arrivage local vont au CMUP
  **chacun selon sa clé** (poids / valeur / parts égales), une fois (`frais_approche.date_portee` les fige),
  journalisés en `origine = 'FRAIS'`.
  **Phase B livrée le 14/10** (`2026-10-14d`, exigée au démarrage) : `facture_fournisseur` +
  `ligne_facture_fournisseur`, chaque ligne pegée à une **ligne de réception** (donc au bon et à l'arrivage) ;
  `v_facture_rapprochement` donne le 3-way par ligne ; l'écart de prix est porté **exact par référence** (là où
  l'ancienne saisie, qui n'a qu'un total, le répartit au prorata — elle reste en place, même moteur) ;
  `FACTURE-DOUBLE` refuse de facturer deux fois la même pesée, `FACTURE-BLOC` refuse de couper une référence en
  deux factures, et l'arrivage ne se clôture que quand tout est facturé. Écrans `/factures-fournisseur`.
- `docs/ecarts-cahier-des-charges.md` — traçabilité cahier des charges → implémentation, points
  en attente de décision métier.
- `db/README.md` — invariants, vues, contrôles C01–C59 (C38–C42 machines au 05/10 ; C43 colisage incohérent au 08/10 ; C45–C52 au 09/10, C53–C54 au 10/10, C55 période close au 17/10, C56 ligne d'import sans position tarifaire au 19/10, C57–C58 proposition et réception en double au 19/10, C59 écart au prix confirmé de la demande de prix au 21/10, tous des signaux).
- Audit P3 du 19/10/2026 : création idempotente (`id_document` tiré par l'écran, `domain/idempotence.rs`) ; positions tarifaires, valeur en douane et répartition « au taux des droits » (`2026-10-19a`) ; étiquettes de lot Code 128 et scan (`2026-10-19b`, `routes/etiquettes.rs`, `lib/code128.ts`, `composants/ChampScan.tsx`). Une colonne de date nouvelle naît en `timestamptz`/`date` (cliquet A1) — `routes/json.rs` les sérialise.
- `docs/matrice-mouvements.md` — matrice des 17 types de mouvement (sens, CMUP, coût, validation, réversibilité), générée par `python db/pg/matrice.py` depuis `backend/tests/banc/matrice_mouvements.json`, que le banc vérifie contre la base : modifier un type = modifier ce fichier.
- Règles de gestion validées le 08/10/2026 : migrations `db/pg/migrations/2026-10-08_regles_p1.sql` (sections 1 à 14) puis `2026-10-08b_audit_v4.sql` (corrections de l'audit v4), les deux exigées au démarrage ; `seed_006_regles_2026_10.sql` en porte les référentiels pour une base neuve. Le colisage incohérent se SIGNALE, il ne bloque jamais.
- Arbitrages du 09/10/2026 (audit v5) : `docs/ADR-002` section « Arbitrages du 09/10/2026 » (A1–A11) ; migrations `2026-10-09a` à `2026-10-09za`, puis `2026-10-10a` (A1 et A11 tranchés le 10/10 : prêt toujours rendu, jamais d'acompte avant dédouanement → C53), toutes exigées au démarrage. Une migration déjà appliquée corrigée après coup se déclare dans `EMPREINTES_REMPLACEES` (`db/pg/migrer.py`), sinon `--verifier` arrête la publication.
- `deploiement/README.md` — serveur, migrations en production, sauvegardes, assistant.
