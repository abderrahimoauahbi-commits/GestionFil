# ERP Gestion Fil — couche base de données

Polyfashions Carpet Morocco · pilotage des achats, stocks et production de matières premières.

**PostgreSQL 18** — SQLite a ete abandonne le 4 septembre 2026. `db/pg/` est la source ;
toute evolution s'y ecrit ET dans un fichier date de `db/pg/migrations/`.

---

## Démarrage

```powershell
cd db\pg
python charger.py                          # base locale : schéma, vues, contrôles, seeds
python charger.py --base gestionfil_essai  # une autre base
python charger.py --production             # comptes réels, référentiel à importer ensuite
```

Le chargeur joue les fichiers PAR PASSES : les vues se citent en avant, et PostgreSQL
résout à la création. Une migration s'applique ensuite à part :

```powershell
psql -d gestionfil -v ON_ERROR_STOP=1 -f migrations\2026-09-17i_tableau_de_bord.sql
```

---

## Structure

```
db/pg/
├── 001_schema_referentiels.sql   devises, taux, cours Bank Al-Maghrib, catégories,
│                                 rôles BOM, magasins, types/motifs de mouvement,
│                                 paramètres, machine à états
├── 002_schema_securite.sql       rôles, utilisateurs, permissions, champs restreints
├── 003_schema_catalogue.sql      fournisseurs, références, groupes d'équivalence
├── 004_schema_production.sql     qualités, densités par rôle, recettes versionnées
├── 005_schema_planification.sql  plans, saisonnalité, besoins MRP, snapshots
├── 006_schema_achats.sql         bons de commande, plan d'achat, historique des prix
├── 007_schema_receptions.sql     réceptions, lignes, archives figées
├── 008_schema_stock.sql          mouvements, stock par magasin, stock par lot,
│                                 transferts, inventaires, valorisation
├── 009_schema_pilotage.sql       KPI, journal d'audit, alertes, contexte de session
├── 009b_schema_machines.sql      métiers, emplacements, fiches de charge
├── 010_declencheurs.sql          invariants (voir plus bas)
├── 010b_declencheurs_logique.sql solde, CMUP, capacité machine
├── 011_vues.sql                  vues de pilotage
├── 012_controles.sql             contrôles métier C01–C37
├── 013_vues_cockpit.sql          le cockpit : Pareto, couvertures, économies
├── 014_audit_operations.sql      journal d'audit des opérations
├── seed_*.sql                    référentiels, sécurité, qualités, comptes réels
├── migrations/                   une évolution = un fichier daté, REJOUABLE
└── charger.py                    chargement par passes
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
| R04 · CMUP aux entrées seules | `type_mouvement.impacte_cmup`, contraint à `signe = +1`. Sans achat, le CMUP est le prix catalogue × taux en vigueur (`fn_prix_catalogue_mad`, vide sans taux) ; la première réception moyenne avec lui |
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
psql -d gestionfil -c "SELECT * FROM v_controles;"          # tableau de bord
psql -d gestionfil -c "SELECT * FROM v_ctl_c05;"            # détail d'un contrôle
```

C01–C14 traduisent les contrôles du CDC en requêtes exécutables. C15–C37 ont été ajoutés, dont :

- **C15** cohérence stock par lot / stock par magasin
- **C16** rôle de recette sans densité (le cas du besoin nul silencieux)
- **C17** références orphelines sans recette (T09 du CDC)
- **C18** qualité planifiée sans densité de rôle
- **C19** devise catalogue sans taux en vigueur
- **C20** référence classe A mono-source

**C11 est le contrôle central** : il compare le solde de `stock_magasin` au grand livre. `stock_magasin` n'est qu'un cache ; `ligne_mouvement` fait foi. Toute divergence signale un bug applicatif, et le solde est reconstructible.

---

## Contraintes d'intégration côté service

1. **Renseigner le contexte de session en début de transaction écrivante** — sinon le journal
   d'audit enregistre des actions anonymes. Côté serveur : `user.poser_contexte(&mut tx)`,
   qui pose `SET LOCAL app.id_utilisateur`, `app.adresse_ip`, `app.session_id`.
2. **Arrondir à l'écriture** : 4 décimales pour les kg et le CMUP, 2 pour les montants
   (ADR-001 D-10).
3. **Les cascades sont à la charge du service**, dans une transaction : réception 3-en-1,
   transfert, clôture d'inventaire, calcul MRP, plan d'achat, ABC/XYZ (ADR-001 D-04).
4. **Une requête nouvelle se vérifie avant d'être livrée** : `PREPARE` sur une copie de la base,
   et types du résultat comparés aux types Rust. Un `NUMERIC` lu en `f64`, un `ROUND(x, n)` sur un
   flottant ou un `SUM(booléen)` ne se voient qu'à l'exécution — seize requêtes plantaient ainsi
   le 17 septembre 2026.

---

## Ce que la base porte aujourd'hui

- **125 références**, familles et couleurs alignées sur « Liste ref fil.xlsx ».
- **18 qualités** et leurs recettes, densités par rôle comprises.
- Le **plan de production** de l'année et sa saisonnalité, d'où le MRP tire les besoins.
- Le **CMUP** : prix catalogue × taux en vigueur tant qu'aucun achat ne l'a fixé, puis moyenne
  pondérée à chaque réception valorisée.
- Le **cours de référence de Bank Al-Maghrib**, lu pour information à côté du taux de l'ERP.

---

## Documentation

- [ADR-001 — Décisions fondatrices](../docs/ADR-001-decisions-fondatrices.md)
- [Écarts au cahier des charges](../docs/ecarts-cahier-des-charges.md)
