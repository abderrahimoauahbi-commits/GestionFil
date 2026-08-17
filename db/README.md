# ERP Gestion Fil — couche base de données

Polyfashions Carpet Morocco · pilotage des achats, stocks et production de matières premières.

**Dev** : SQLite 3.51+ (tables `STRICT`) · **Cible prod** : PostgreSQL 16

---

## Démarrage

```powershell
cd db
.\build.ps1 -Demo          # schéma + référentiels + jeu de démonstration SH
.\tests\run-tests.ps1      # 38 tests d'invariants
```

```powershell
.\build.ps1                        # sans le jeu de démonstration
.\build.ps1 -Database recette.db   # base cible différente
```

`build.ps1` reconstruit la base à zéro, puis vérifie `foreign_key_check` et `integrity_check`.

---

## Structure

```
db/
├── 001_schema_referentiels.sql   devises, taux, catégories, rôles BOM, magasins,
│                                 types/motifs de mouvement, paramètres, machine à états
├── 002_schema_securite.sql       rôles, utilisateurs, permissions, champs restreints
├── 003_schema_catalogue.sql      fournisseurs, références, groupes d'équivalence
├── 004_schema_production.sql     qualités, densités par rôle, recettes versionnées
├── 005_schema_planification.sql  plans, plan_recette, besoins MRP, snapshots
├── 006_schema_achats.sql         bons de commande, plan d'achat, historique des prix
├── 007_schema_receptions.sql     réceptions, lignes, archives figées
├── 008_schema_stock.sql          mouvements, stock par magasin, stock par lot,
│                                 transferts, inventaires, valorisation
├── 009_schema_pilotage.sql       KPI, journal d'audit, alertes, contexte de session
├── 010_triggers.sql              invariants (voir plus bas)
├── 011_vues.sql                  vues de pilotage
├── 012_controles.sql             contrôles métier C01–C20
├── seed/
│   ├── 001_referentiels.sql      devises, 15 catégories, 8 rôles, 4 magasins,
│   │                             9 types de mouvement, 26 paramètres, 31 transitions
│   ├── 002_securite.sql          6 rôles, matrice RBAC du CDC D2, 6 comptes
│   ├── 003_fournisseurs.sql      12 fournisseurs réels (CDC A4)
│   ├── 004_qualites.sql          18 qualités réelles + densités par rôle de SH
│   └── 900_demo_sh.sql           ⚠ DONNÉES DE TEST — prix inventés
├── build.ps1
└── tests/run-tests.ps1
```

**51 tables · 36 vues · 51 triggers · 54 index**

---

## Invariants garantis par la base

Ce que la base refuse, quel que soit le chemin d'appel — y compris une correction SQL passée à la main.

| Règle | Mécanisme |
|---|---|
| R01 · unité canonique kg | `reference.facteur_kg` colonne générée + 3 `CHECK` conditionnels |
| R02 · stock jamais négatif | garde avant écriture, par magasin **et** par lot |
| R03 · historique immuable | refus d'`UPDATE`/`DELETE` sur mouvements, archives, historique prix, audit |
| R04 · CMUP aux entrées seules | `type_mouvement.impacte_cmup`, contraint à `signe = +1 AND exige_prix = 1` |
| R07 · Σ % = 100 par rôle | contrôlé au passage à `VALIDE` |
| R08 · seuls les plans VALIDE alimentent le MRP | index unique partiel sur `(annee) WHERE statut='VALIDE'` |
| RG-04 · recette validée immuable | verrou sur `ligne_recette` |
| RG-09 · taux de change déterministe | périodes non chevauchantes, devise pivot à 1 |
| B4-4 · créateur BC ≠ valideur BC | `CHECK` sur `bon_commande` |
| B4-2 · peseur ≠ contrôleur | `CHECK` sur `reception` |
| Transitions d'états | table `transition_statut` + trigger par entité — **aucune transition arrière** |
| Audit | journal alimenté sur paramètres, prix, droits, engagements |

Un rôle BOM sans densité sur la qualité **bloque la validation de la recette** plutôt que de produire un besoin nul en silence.

---

## Vues de pilotage

| Vue | Rôle |
|---|---|
| `v_ligne_recette_calculee` | kg/m² par ligne de recette (gère kg/m² et ml/m²) |
| `v_besoin_mrp_calcule` | besoins MRP agrégés par référence, taux de perte appliqué |
| `v_conso_reelle` / `v_conso_retenue` | consommation réelle (correction N4) et sa provenance |
| `v_stock_disponible` | stock agrégé par référence, hors magasins `inclure_mrp = 0` |
| `v_encours_bc` | reliquat des BC envoyés |
| `v_stock_min_dynamique` | stock minimum F3 (max de 4 sécurités) |
| `v_stock_projete` | `stock + en-cours − besoins`, statut et jours de couverture |
| `v_plan_achat` | quantité à commander (MOQ + multiple), tiering, sourcing, prix tracé |
| `v_cockpit_stock` | KPI en un seul balayage |
| `v_substitution_dispo` | alternatives disponibles sur rupture |
| `v_fournisseur_scorecard` | conformité, ponctualité, OTIF, écart de pesée |
| `v_stock_dormant` | références sans mouvement au-delà de `P_SeuilDormant` |
| `v_lot_fefo` | proposition d'allocation FEFO |

---

## Contrôles métier

```powershell
sqlite3 gestionfil.db "SELECT * FROM v_controles;"          # tableau de bord
sqlite3 gestionfil.db "SELECT * FROM v_ctl_c05;"            # détail d'un contrôle
```

C01–C14 traduisent les contrôles du CDC en requêtes exécutables. C15–C20 ont été ajoutés :

- **C15** cohérence stock par lot / stock par magasin
- **C16** rôle de recette sans densité (le cas du besoin nul silencieux)
- **C17** références orphelines sans recette (T09 du CDC)
- **C18** qualité planifiée sans densité de rôle
- **C19** devise catalogue sans taux en vigueur
- **C20** référence classe A mono-source

**C11 est le contrôle central** : il compare le solde de `stock_magasin` au grand livre. `stock_magasin` n'est qu'un cache ; `ligne_mouvement` fait foi. Toute divergence signale un bug applicatif, et le solde est reconstructible.

---

## Contraintes d'intégration côté service

1. **`PRAGMA foreign_keys = ON` à chaque connexion.** SQLite le désactive par défaut. Sans lui, C03 et C04 ne protègent rien.
2. **Ne pas activer `recursive_triggers`.** L'historisation des paramètres s'appuie sur son état par défaut.
3. **Renseigner `_contexte_session` en début de transaction** — sinon le journal d'audit enregistre des actions anonymes :
   ```sql
   UPDATE _contexte_session SET id_utilisateur = ?, adresse_ip = ?, session_id = ? WHERE id = 1;
   ```
   C'est l'équivalent SQLite de `SET LOCAL app.id_utilisateur` sous PostgreSQL.
4. **Arrondir à l'écriture** : 4 décimales pour les kg et le CMUP, 2 pour les montants (ADR-001 D-10).
5. **Les cascades sont à la charge du service**, dans une transaction : réception 3-en-1, transfert, clôture d'inventaire, calcul MRP, plan d'achat, ABC/XYZ (ADR-001 D-04).

---

## Vérification de bout en bout

Le jeu `900_demo_sh.sql` reproduit l'exemple de calcul F2 du cahier des charges :

```
Plan SH Juillet, 500 m²
  PP-3430 (Poil, 6,4 %)  : 500 × 1,760 × 6,4 %          =  56,32 kg   ✓ CDC F2
  JUT-961 (Trame, 100 %) : 500 × 0,520 × 100 %          = 260,00 kg   ✓ CDC F2
  CUIR-01 (Cuir, ml/m²)  : 500 × 1,000 × 100 % × 0,35   = 175,00 kg   (non exprimable dans le modèle du CDC)
```

```powershell
sqlite3 -header -column gestionfil.db `
  "SELECT code_reference, quantite_brute_kg, quantite_kg FROM v_besoin_mrp_calcule WHERE mois=7;"
```

---

## Migration vers PostgreSQL 16

Le schéma est écrit pour se transposer sans réécriture de la logique :

| SQLite (dev) | PostgreSQL (prod) |
|---|---|
| `TEXT` (UUID v4) | `UUID` |
| `REAL` | `DECIMAL(12,4)` / `DECIMAL(15,2)` |
| `TEXT` ISO-8601 UTC | `TIMESTAMPTZ` |
| `INTEGER` 0/1 | `BOOLEAN` |
| `TEXT` + `json_valid()` | `JSONB` |
| triggers `RAISE(ABORT, …)` | fonctions PL/pgSQL `RAISE EXCEPTION` |
| `_contexte_session` | `SET LOCAL app.*` |
| trigger anti-chevauchement des taux | contrainte `EXCLUDE USING gist` |

Points de vigilance :

- **`max()` scalaire propage les NULL en SQLite ; `GREATEST` les ignore en PostgreSQL.** Les termes sont déjà tous `COALESCE` — c'est précisément le piège qui mettait à 0 la quantité à commander dans la vue I2 du CDC.
- Les colonnes générées `VIRTUAL` deviennent `GENERATED ALWAYS AS … STORED`.
- `strftime('%Y-%m-%dT%H:%M:%fZ','now')` devient `now()`.

---

## Documentation

- [ADR-001 — Décisions fondatrices](../docs/ADR-001-decisions-fondatrices.md)
- [Écarts au cahier des charges](../docs/ecarts-cahier-des-charges.md)
