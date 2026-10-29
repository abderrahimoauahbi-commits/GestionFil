# ERP Gestion Fil — backend

Rust + Axum + sqlx. Consomme la base construite par [`db/`](../db/README.md).

---

## Démarrage

```powershell
cd db\pg;   python charger.py --base gestionfil_essai --socle --comptes   # --base obligatoire
cd ..\backend
cargo run --bin gestionfil-admin -- init-config   # crée .env avec un secret aléatoire
cargo run --bin gestionfil-import                 # charge GESTION Fil.xlsx
cargo run --bin gestionfil-admin -- definir-mot-de-passe direction
cargo run                                         # http://127.0.0.1:8080
```

Le paquet expose trois binaires ; `default-run` fait pointer `cargo run` sur le serveur.

```powershell
cargo test                                        # tests unitaires (#[test] dans src/)
cargo test --bin gestionfil domain::couverture    # un module / un test, par filtre de nom
cargo run --bin gestionfil-admin -- verifier      # les contrôles de v_controles (C01–C66, voir db/README.md)
cargo run --bin gestionfil-admin -- lister-comptes
cargo run --bin gestionfil-import -- --simuler    # import à blanc, rapport identique
python tests\banc\banc.py --cible <CARGO_TARGET_DIR>   # banc métier : base jetable, serveur sur 8096
```

Sous-commandes de `gestionfil-admin` : `init-config`, `definir-mot-de-passe <login>` (lit
`GESTIONFIL_MOT_DE_PASSE` s'il est posé, sinon le demande), `retirer-2fa <login>`, `lister-comptes`,
`verifier`, `sauvegarder`, `lister-sauvegardes`, `restaurer`, `verifier-sauvegarde` (restaure à côté,
contrôle, efface), `diagnostic`, `reparer`.

Au démarrage, `db::verifier_schema` refuse une base qui n'a pas assez de tables, de vues ou de
déclencheurs, et `MIGRATIONS_REQUISES` (`src/db.rs`) refuse une base à laquelle manque une migration
dont ce binaire dépend, **en la nommant** : `python ..\db\pg\migrer.py --base <base>` la joue.

`charger.py --production` charge les comptes réels sans référentiel : il s'importe ensuite depuis le classeur. **À ne pas combiner avec un jeu de démonstration** : les deux créeraient les mêmes fournisseurs sous des codes différents.

---

## Organisation

```
src/
├── main.rs           démarrage, arrêt gracieux
├── config.rs         configuration depuis l'environnement
├── db.rs             pool PostgreSQL, témoins de migration, contexte de session, arrondis, délais
├── error.rs          AppError → HTTP ; les messages des triggers remontent tels quels
├── state.rs          état partagé
├── crud.rs           registre ENTITES du CRUD générique (colonnes, suppression, module RBAC)
├── auth/
│   ├── password.rs   Argon2id
│   ├── jwt.rs        HS256
│   ├── rbac.rs       permissions, plafonds, masquage de champs (sortie et entrée)
│   ├── garde.rs      garde de la connexion : essais un par un, blocage après échecs (13/10)
│   ├── totp.rs       second facteur à six chiffres
│   └── mod.rs        extracteur `Utilisateur`
├── assistant/        le chatbot : le modèle choisit une compétence, la requête est écrite à
│                     l'avance, le résultat est masqué selon les droits ; aucune écriture
├── bin/              admin.rs (gestionfil-admin), import.rs (gestionfil-import)
├── domain/
│   ├── unites.rs     conversion vers le kg (R01), sans repli silencieux ; conditionnement par lot
│   ├── mrp.rs        figer les recettes, calcul idempotent, snapshot
│   ├── plan.rs       déploiement d'un plan de production sur une période glissante
│   ├── couverture.rs le moteur de couverture : projection jour par jour du plan, propositions
│   │                 (calcul pur, testé) — seule source du besoin depuis le 27/10/2026
│   ├── plan_achat.rs génération des propositions (1re proposition du moteur) et conversion en bons
│   ├── reception.rs  arrivage pegé aux lignes de bon, cascade 3-en-1, bobines comptées
│   ├── facture_fournisseur.rs  la facture comme document, rapprochement 3-way (ADR-003 phase B)
│   ├── facture_locale.rs  valorisation en deux temps d'une réception locale, avoir
│   ├── importation.rs     dossiers d'import : répartition, entrée en stock, clôture
│   ├── retour_fournisseur.rs  le retour fournisseur, document libre
│   ├── decision_machine.rs  décisions machine (avant → saisie par ligne → aperçu → après)
│   ├── transitions.rs     retours arrière à VALIDER
│   ├── transfert.rs  deux mouvements, valeur qui suit la marchandise, fil en route
│   ├── inventaire.rs ouverture, comptage et clôture avec ajustements
│   ├── classification.rs  ABC / XYZ sur 12 mois glissants
│   ├── idempotence.rs     double envoi d'une création (`id_document` tiré par l'écran)
│   ├── concurrence.rs     verrou optimiste des documents à workflow
│   ├── numerotation.rs    numéros de documents par préfixe et par année
│   ├── cours_bam.rs       cours de Bank Al-Maghrib, pour information
│   └── sauvegarde.rs      sauvegarde de la base
└── routes/           un seul `Router` (mod.rs), trois familles (voir « API ») :
    ├── entites.rs      le CRUD générique `/api/{entite}`, enregistré EN DERNIER
    ├── auth_routes.rs  connexion, identité et droits effectifs (`/api/auth/moi`)
    ├── consultation.rs, operations.rs  lectures (LIRE + masquage), cascades et calculs
    ├── bons_commande.rs, receptions.rs, factures.rs, retours.rs, importation.rs, pieces.rs
    ├── stock.rs, transferts.rs, inventaires.rs, lots.rs, machines.rs, etiquettes.rs
    ├── production.rs, ordres_fabrication.rs, couverture.rs, completion.rs, recherche.rs
    ├── admin.rs, roles.rs, referentiels.rs, devalidation.rs, telechargements.rs
    ├── assistant.rs, briefing.rs   l'assistant et le briefing de connexion
    └── json.rs         lignes PostgreSQL → JSON (dates `timestamptz` / `date` comprises)
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
Un seul `Router` (`src/routes/mod.rs`), trois familles :

- **Le CRUD générique** `/api/{entite}`, piloté par le registre `ENTITES` de `src/crud.rs` : liste
  blanche de colonnes en création et en modification, politique de suppression, module RBAC.
  Ajouter une entité de référentiel = ajouter une entrée au registre, pas écrire des handlers.
  Ces routes sont enregistrées **en dernier**, pour ne pas masquer les routes spécifiques.
- **Les entités à workflow** (qualités, recettes, plans, OF, bons de commande, réceptions, factures
  fournisseur, retours, dossiers d'import, transferts, inventaires, lots, machines…) : un module par
  famille dans `routes/`, les cascades transactionnelles dans `domain/` (réception 3-en-1, transfert,
  clôture d'inventaire, décision machine, MRP, couverture et plan d'achat, ABC/XYZ).
- **L'assistant** `/api/chat` : le modèle de langage (Ollama ou Claude, `P_AssistantMoteur`) ne fait
  que choisir une compétence ; la requête est écrite à l'avance, le résultat masqué selon les droits.
  Il ne produit que des brouillons, jamais d'écriture.

`/api/auth/moi` renvoie les permissions et les champs masqués effectifs : c'est la source de vérité
du frontend pour n'afficher que ce que l'utilisateur peut faire. Une route `/api/...` inconnue
renvoie `ROUTE_INCONNUE` plutôt qu'un 405 muet ; hors `/api`, le serveur sert l'interface
(`FRONTEND_DIR`, repli sur `index.html` pour la navigation côté client).

Quelques routes repères (la liste complète est `routes/mod.rs`) :

| Route | Permission |
|---|---|
| `GET /api/couverture` · `/api/couverture/{ref}` | le moteur de couverture (onglet « À commander ») |
| `POST /api/plan-achat/generer[?reference=]` | PLAN_ACHAT · ÉCRIRE — `?reference=` : le bouton « Commander » |
| `POST /api/plans/{id}/figer-recettes` · `/mrp` · `/snapshot` | PLANS · ÉCRIRE, puis MRP · ÉCRIRE |
| `PUT /api/bons-commande/{id}/statut` | BONS_COMMANDE · ÉCRIRE, VALIDER pour valider (créateur ≠ valideur) |
| `POST /api/receptions/{id}/valider` | RECEPTIONS · **VALIDER** |
| `POST /api/transferts/{id}/valider` | MOUVEMENTS · **VALIDER** |
| `GET /api/inventaires/ouverts` | les inventaires qui gèlent un magasin (bandeau des écrans) |
| `POST /api/inventaires/{id}/cloturer` | INVENTAIRE · **VALIDER** |
| `POST /api/lots/conditionnement` | corriger le conditionnement mesuré d'un lot |
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
| `ROUTE_INCONNUE` | 404 | Route `/api/...` qui n'existe pas |

S'y ajoutent les codes de la connexion et des sessions (`IDENTIFIANTS_INVALIDES`,
`DOUBLE_AUTH_REQUISE`, `TROP_DE_TENTATIVES`, `SESSION_VERROUILLEE`), `CHAMP_NON_MODIFIABLE` (champ
en lecture seule pour ce compte) et `SERVEUR_OCCUPE` (voir `src/error.rs`).

---

## Séquence type : du plan à la commande

```
POST /api/plans/{id}/figer-recettes    fige la version de recette par qualité
POST /api/plans/{id}/mrp               explose le plan (idempotent)
     … validation du plan …
POST /api/plans/{id}/snapshot          photo figée des besoins
GET  /api/couverture                   le moteur : projection jour par jour du plan, 1re rupture
POST /api/plan-achat/generer           1re proposition du moteur par référence (minimum, multiple)
     … revue, puis conversion en bon de commande BROUILLON …
```

Bon de commande : `BROUILLON → EN_CONTROLE` (un autre compte) `→ DEMANDE_PRIX` (ou saut motivé)
`→ EN_ATTENTE_VALIDATION → VALIDE` (VALIDER, créateur ≠ valideur, taux engagé figé) `→ ENVOYE`.

Réception :

```
     … saisie des pesées, statut BROUILLON → A_CONTROLER …
POST /api/receptions/{id}/valider      cascade 3-en-1, transaction atomique
```

La cascade crée **un mouvement par magasin destinataire**, une archive figée et une ligne d'historique de prix par ligne, met à jour les soldes du BC en kg, et fait basculer le BC en `LIVRE_PARTIEL` ou `CLOTURE`.

---

## Notes d'implémentation

**sqlx en requêtes dynamiques**, pas les macros `query!` : cela évite d'exiger une base accessible à la compilation — donc en CI et sur un poste neuf. En contrepartie, une erreur de SQL ou de type ne se voit qu'à l'exécution : toute requête nouvelle se vérifie par un `PREPARE` sur une copie de la base, résultat comparé aux types Rust (audit du 17/09/2026, seize requêtes en panne).

**Contexte de session.** Chaque transaction écrivante appelle `user.poser_contexte(&mut tx)` en premier : les triggers d'audit lisent `_contexte_session` au moment où ils s'exécutent. Sans cet appel, le journal enregistre des actions anonymes.

**Arrondis.** 4 décimales pour les kg et le CMUP, 2 pour les montants (ADR-001 D-10).

**Séquence du plan à la commande, depuis le 27/10/2026.** Le besoin vient du **plan de production
seul** : `figer-recettes` puis `mrp` explosent le plan ; le moteur de couverture
(`domain/couverture.rs`) projette jour par jour stock, en-cours de commande et fil en route ;
`plan-achat/generer` en prend la 1re proposition par référence (quantité, date de besoin, date limite
de commande, urgence), prix, devise et fournisseur venant de la fiche ; la conversion ouvre un bon de
commande en brouillon. L'OF ne crée pas de besoin : il prévoit, oriente et analyse
(`v_of_consommation`, `v_of_bilan`, `v_qualite_consommation`).
