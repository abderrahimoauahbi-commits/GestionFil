# ERP Gestion Fil — backend

Rust + Axum + sqlx. Consomme la base construite par [`db/`](../db/README.md).

---

## Démarrage

```powershell
cd db;      .\build.ps1                # construire la base (schéma + référentiels)
cd ..\backend
cargo run --bin gestionfil-admin -- init-config   # crée .env avec un secret aléatoire
cargo run --bin gestionfil-import                 # charge GESTION Fil.xlsx
cargo run --bin gestionfil-admin -- definir-mot-de-passe direction
cargo run                                         # http://127.0.0.1:8080
```

Le paquet expose trois binaires ; `default-run` fait pointer `cargo run` sur le serveur.

```powershell
cargo test                                        # tests unitaires
.\tests\e2e.ps1                                   # 40 tests de bout en bout
cargo run --bin gestionfil-admin -- verifier      # contrôles métier C01–C21
cargo run --bin gestionfil-admin -- lister-comptes
cargo run --bin gestionfil-import -- --simuler    # import à blanc, rapport identique
```

`build.ps1 -Demo` ajoute un jeu de démonstration (fournisseurs fictifs, qualité SH, réception en attente). **À ne pas combiner avec l'import** : les deux créeraient les mêmes fournisseurs sous des codes différents.

---

## Organisation

```
src/
├── main.rs           démarrage, arrêt gracieux
├── config.rs         configuration depuis l'environnement
├── db.rs             pool SQLite, contexte de session, arrondis
├── error.rs          AppError → HTTP ; les messages des triggers remontent tels quels
├── state.rs          état partagé
├── auth/
│   ├── password.rs   Argon2id
│   ├── jwt.rs        HS256
│   ├── rbac.rs       permissions, plafonds, masquage de champs
│   └── mod.rs        extracteur `Utilisateur`
├── domain/
│   ├── unites.rs     conversion vers le kg (R01), sans repli silencieux
│   ├── mrp.rs        figer les recettes, calcul idempotent, snapshot
│   ├── reception.rs  cascade 3-en-1
│   ├── transfert.rs  deux mouvements, valeur qui suit la marchandise
│   ├── inventaire.rs ouverture et clôture avec ajustements
│   ├── plan_achat.rs génération des propositions
│   └── classification.rs  ABC / XYZ sur 12 mois glissants
└── routes/
    ├── auth_routes.rs  connexion, identité et droits effectifs
    ├── consultation.rs lectures (permission LIRE + masquage)
    ├── operations.rs   écritures (permission ÉCRIRE ou VALIDER)
    └── json.rs         lignes SQLite → JSON
```

---

## Principes

**Les invariants sont en base, les orchestrations ici** (ADR-001 D-04). Le service ne réimplémente jamais une règle que la base garantit déjà : il ne peut pas produire un stock négatif, modifier un mouvement passé ou valider une recette dont les pourcentages ne somment pas à 100 %. Les messages métier des triggers (`R02 : stock insuffisant…`) remontent tels quels au client — ils sont rédigés pour l'utilisateur.

**`Utilisateur` en argument de handler vaut authentification.** Le type n'est constructible que par l'extracteur, qui exige un jeton valide et revalide le compte à chaque requête — une désactivation prend effet immédiatement, sans attendre l'expiration du jeton.

**Le masquage s'applique à la sortie.** Une seule règle (`champ_restreint`) appliquée uniformément, plutôt qu'une projection SQL par endpoint où l'oubli d'un champ trahirait la règle B4-1 en silence.

**`VALIDER` est distincte d'`ÉCRIRE`.** Toute la ségrégation des tâches du CDC B4 repose sur cette séparation : l'acheteur rédige un BC, la Direction le valide ; le magasinier pèse, le contrôleur qualité valide.

---

## API

Toutes les routes sauf `/api/sante` et `/api/auth/connexion` exigent `Authorization: Bearer <jeton>`.

### Authentification
| Méthode | Route | Permission |
|---|---|---|
| POST | `/api/auth/connexion` | — |
| GET | `/api/auth/moi` | authentifié |

`/api/auth/moi` renvoie les permissions et champs masqués effectifs : c'est la source de vérité du frontend pour n'afficher que ce que l'utilisateur peut faire.

### Consultation
| Route | Module |
|---|---|
| `GET /api/cockpit` | COCKPIT |
| `GET /api/controles` · `/api/controles/{code}` | COCKPIT |
| `GET /api/catalogue` | CATALOGUE |
| `GET /api/fournisseurs` · `/api/fournisseurs/scorecard` | FOURNISSEURS |
| `GET /api/stock` · `/stock/projete` · `/stock/dormant` · `/stock/lots` | STOCK |
| `GET /api/substitutions` | STOCK |
| `GET /api/plan-achat` | PLAN_ACHAT |
| `GET /api/recettes/{id}/lignes` | RECETTES |
| `GET /api/plans/{id}/besoins` | MRP |
| `GET /api/mouvements` | MOUVEMENTS |
| `GET /api/audit` | AUDIT |

Filtres : `?limite=N` (max 5000), `?statut=RUPTURE`, `?code_reference=PP-3430`.

### Opérations
| Route | Permission |
|---|---|
| `POST /api/plans/{id}/figer-recettes` | PLANS · ÉCRIRE |
| `POST /api/plans/{id}/mrp` | MRP · ÉCRIRE |
| `POST /api/plans/{id}/snapshot` | MRP · ÉCRIRE |
| `POST /api/plan-achat/generer` | PLAN_ACHAT · ÉCRIRE |
| `POST /api/receptions/{id}/valider` | RECEPTIONS · **VALIDER** |
| `POST /api/transferts/{id}/valider` | MOUVEMENTS · **VALIDER** |
| `POST /api/inventaires/{id}/ouvrir` | INVENTAIRE · ÉCRIRE |
| `POST /api/inventaires/{id}/cloturer` | INVENTAIRE · **VALIDER** |
| `POST /api/classification` | CATALOGUE · ÉCRIRE |

### Erreurs

```json
{ "code": "REGLE_METIER", "message": "R02 : stock insuffisant dans ce magasin..." }
```

| Code | HTTP | Sens |
|---|---|---|
| `REGLE_METIER` | 422 | Règle métier violée — message affichable |
| `INVALIDE` | 400 | Contrainte de données |
| `NON_AUTHENTIFIE` | 401 | Jeton absent, invalide ou compte désactivé |
| `NON_AUTORISE` | 403 | Permission manquante |
| `INTROUVABLE` | 404 | |
| `CONFLIT` | 409 | Unicité |
| `ERREUR_INTERNE` | 500 | Détail journalisé, jamais renvoyé |

---

## Séquence type : du plan à la commande

```
POST /api/plans/{id}/figer-recettes    fige la version de recette par qualité
POST /api/plans/{id}/mrp               explose le plan (idempotent)
     … validation du plan …
POST /api/plans/{id}/snapshot          photo figée des besoins
POST /api/plan-achat/generer           propositions avec MOQ, multiples, tiering
GET  /api/plan-achat                   revue par l'acheteur
```

Réception :

```
     … saisie des pesées, statut BROUILLON → A_CONTROLER …
POST /api/receptions/{id}/valider      cascade 3-en-1, transaction atomique
```

La cascade crée **un mouvement par magasin destinataire**, une archive figée et une ligne d'historique de prix par ligne, met à jour les soldes du BC en kg, et fait basculer le BC en `LIVRE_PARTIEL` ou `CLOTURE`.

---

## Notes d'implémentation

**sqlx en requêtes dynamiques**, pas les macros `query!`. La couche SQL est déjà validée par `db/tests/run-tests.ps1` (38 tests), et cela évite d'exiger une base accessible à la compilation — donc en CI et sur un poste neuf.

**Contexte de session.** Chaque transaction écrivante appelle `user.poser_contexte(&mut tx)` en premier : les triggers d'audit lisent `_contexte_session` au moment où ils s'exécutent. Sans cet appel, le journal enregistre des actions anonymes.

**Arrondis.** 4 décimales pour les kg et le CMUP, 2 pour les montants (ADR-001 D-10).

**Reste à faire.** CRUD complets (création de BC, saisie de réception, plans), notifications, import Excel, export PDF/Excel.
