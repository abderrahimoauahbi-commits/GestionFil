# ADR-001 — Décisions fondatrices du modèle de données

**Statut** : accepté · **Date** : 2026-08-06 · **Portée** : couche base de données de l'ERP Gestion Fil

Ce document tranche les arbitrages laissés ouverts — ou rendus contradictoires — par le cahier des charges v3.0 du 07/08/2026. Chaque décision est numérotée et référencée depuis les scripts SQL.

---

## Contexte

Le CDC est solide sur la philosophie (dualisme figé/glissant, paramètres embarqués, kg canonique, ségrégation des tâches) et sur les données réelles. Son modèle physique, en revanche, comportait des défauts qui rendaient le système inopérant en l'état : le stock ne diminuait jamais, le MRP ne pouvait pas appliquer sa propre formule F2, et le script SQL ne se créait pas.

Les décisions ci-dessous conservent l'intention métier du CDC en corrigeant sa traduction technique.

---

## D-01 — La densité BOM est portée par le rôle, pas par la catégorie

**Décision** — `ligne_qualite` est clefée sur `(code_qualite, code_role)` et porte un discriminant `unite_densite ∈ {kg_m2, ml_m2}`.

**Pourquoi** — Le CDC clefait sur `(code_qualite, code_categorie)` alors que E3 définit les densités par rôle BOM. Les deux ne sont pas interchangeables : dans la qualité SH, la catégorie *Polyester* apparaît dans le rôle Poil (densité 1,760) **et** dans le rôle Chaîne (densité 0,235). Une clé sur la catégorie exigerait deux valeurs pour la même ligne — impossible.

Le CDC ne portait par ailleurs aucun moyen d'exprimer les rôles en ml/m² (Cuir, Ruban), dont E3 donne pourtant une formule de conversion distincte.

**Conséquence** — La vue `v_ligne_recette_calculee` reproduit exactement les nombres du CDC : `500 × 1,760 × 6,4 % = 56,32 kg`. La vue I4 du CDC aurait renvoyé 0.

**Coût** — Les densités des 17 qualités autres que SH doivent être ressaisies par rôle depuis `GESTION Fil.xlsx`. Le trigger `trg_recette_valider_roles` refuse toute recette dont un rôle n'a pas de densité, au lieu de calculer un besoin nul en silence.

---

## D-02 — Le repli sur le prix catalogue est autorisé mais tracé

**Décision** — `reference.cmup_mad` reste `NULL` tant qu'aucune réception réelle n'existe (RG-08 intact). Le plan d'achat utilise `COALESCE(cmup, prix_catalogue_kg × taux)` et expose systématiquement la colonne `source_prix ∈ {CMUP, CATALOGUE, NEGOCIE}`.

**Pourquoi** — RG-08 interdit tout repli sur le prix catalogue, mais le KPI « 18,6 M MAD à engager » est exigé dès le démarrage, alors que la valorisation est à 0. Les deux exigences sont incompatibles tant qu'aucune réception n'est saisie. Le CDC ne tranchait pas : sa vue I2 aurait affiché un budget de 0.

Un repli **explicite et tracé ligne à ligne** satisfait l'esprit de RG-08 — interdire le repli *silencieux* — sans rendre le cockpit inutilisable.

---

## D-03 — La traçabilité par lot est conservée, via une table dédiée

**Décision** — Ajout de `stock_lot(code_reference, code_magasin, lot_fournisseur)`. Le suivi est activable par référence (`reference.suivi_lot`). Pour une référence sous suivi, le lot est obligatoire sur chaque mouvement.

**Pourquoi** — A3 promet une traçabilité « kg par kg, lot par lot », mais `stock_magasin` était clefé sans lot : la promesse était irréalisable. En tapis, le bain de teinture conditionne la nuance — mélanger deux lots dans une même pièce est un défaut qualité. La traçabilité n'est pas une formalité réglementaire ici, c'est un enjeu produit.

**Conséquence** — L'allocation FEFO est proposée par la vue `v_lot_fefo` mais **décidée par le service Rust** : c'est une règle métier, pas un invariant de base.

---

## D-04 — Les invariants vont en base, les cascades vont dans le service

**Décision** —

| Base de données | Service Rust |
|---|---|
| Solde de stock, CMUP | Cascade réception 3-en-1 |
| Immuabilité de l'historique | Cascade transfert |
| Transitions d'états | Clôture d'inventaire |
| Verrous (recette, paramètre) | Calcul MRP, plan d'achat |
| Journal d'audit | Classification ABC/XYZ |

**Pourquoi** — Un invariant doit tenir quel que soit le chemin d'appel, y compris une correction SQL passée à la main : sa place est en base. Une cascade est une orchestration métier, avec des règles d'erreur et des messages : sa place est dans le service, qui contrôle la transaction.

Le CDC plaçait les cascades dans des triggers PL/pgSQL à boucles `FOR`. Outre que SQLite ne les propose pas, ces triggers concentraient les défauts les plus graves (magasin unique par réception, `ligne_numero` codé en dur, confusion devise/MAD).

---

## D-05 — Le signe du mouvement a une source unique

**Décision** — `ligne_mouvement.quantite_kg` est **toujours strictement positive**. Le sens vient exclusivement de `type_mouvement.signe ∈ {−1, +1}`. Le type `AJUST_INV` « ±1 » du CDC est scindé en `AJUST_INV_POS` / `AJUST_INV_NEG`.

**Pourquoi** — Le CDC portait un signe sur `type_mouvement` **et** insérait des quantités négatives dans `ligne_mouvement` (trigger J3) : double encodage, donc double négation possible. Le `CHECK(signe IN (-1,0,1))` rendait par ailleurs le type `AJUST_INV ±1` littéralement instockable.

---

## D-06 — Le plan fige ses versions de recette

**Décision** — `plan_production.id_recette_base` est remplacé par la table `plan_recette(id_plan, code_qualite, id_recette)`.

**Pourquoi** — Une FK unique sur l'entête du plan limitait le MRP à **une seule qualité par plan** : la jointure de la vue I4 éliminait les lignes de toutes les autres. Un plan couvrant les 18 qualités n'aurait calculé les besoins que d'une seule.

Figer la version par qualité est en outre exactement l'esprit de B3 : le plan reste reconstituable même si les recettes évoluent ensuite.

---

## D-07 — Le taux de change a une source de vérité unique

**Décision** — La table `taux_change` fait foi. Les paramètres `P_TauxEURMAD` et `P_TauxUSDMAD` du CDC A4 sont supprimés. Les périodes ne peuvent pas se chevaucher (trigger dédié).

**Pourquoi** — Le CDC entretenait deux sources : E8 disait « conversion via P_TauxEURMAD / P_TauxUSDMAD », J4 lisait `taux_change`. Aucune contrainte n'empêchait par ailleurs deux taux simultanément valides, et J4 les départageait par un `LIMIT 1` **sans `ORDER BY`** : le taux retenu était non déterministe.

---

## D-08 — Contradictions internes du CDC : valeurs retenues

| Sujet | Valeurs en conflit | Retenu | Motif |
|---|---|---|---|
| Seuil de stock dormant | A4 : 180 j · E9 : 60 j | **180 j** | A4 est la table des paramètres, elle fait foi |
| Nombre de références | A2/E2 : 124 · E9 : 300 | **à trancher** | Écart non explicable depuis le CDC — voir « Questions ouvertes » |
| Stack frontend | l.13 : « 0 JavaScript » · L1 : React 19 | **React 19 + TS** | La ligne 13 est un reliquat du prompt initial |
| Versionnement | qualité (SH1/SH2) vs recette (V1/V2) | **recette** | Le code qualité reste stable ; `recette.version` porte l'historique |

---

## D-09 — Un seul moteur d'autorisation

**Décision** — Les tables `permission` et `champ_restreint` font foi ; Casbin est abandonné. Un middleware Rust charge la matrice au démarrage.

**Pourquoi** — Le CDC prévoyait les deux (table `permission` en H2, Casbin en L1). Deux moteurs signifient deux vérités possibles sur qui a le droit de faire quoi — inacceptable pour un système dont la SoD est un objectif affiché. La matrice en base est testable en SQL et auditable.

`champ_restreint` implémente la règle B4 n°1 (« le magasinier ne voit pas les prix »), que le CDC énonçait sans aucun mécanisme de masquage.

---

## D-10 — Représentation des décimaux : REAL avec arrondi explicite

**Décision** — Les quantités et montants sont stockés en `REAL` (IEEE-754 double), avec `ROUND(x, 4)` pour les kg et le CMUP, `ROUND(x, 2)` pour les montants, appliqué **à chaque écriture**.

**Pourquoi** — SQLite n'a pas de type décimal exact. Deux options : entiers en virgule fixe (grammes, centimes) ou flottants arrondis.

Les ordres de grandeur du dossier — 44,2 M MAD à 2 décimales, 783 000 kg à 4 décimales — représentent 10 chiffres significatifs, quand un double en offre 15 à 17. L'erreur relative est de l'ordre de 10⁻⁶, sans accumulation dès lors qu'on arrondit à l'écriture.

L'argument décisif : **`ligne_mouvement` est la source de vérité et est immuable** ; `stock_magasin` n'est qu'un cache recalculable. Toute dérive est détectable (contrôle C11) et corrigeable par recalcul depuis le grand livre. Le risque est donc borné et réversible.

La virgule fixe entière aurait rendu illisible l'arithmétique des vues et compliqué la migration vers `DECIMAL` sous PostgreSQL.

---

## D-11 — Horodatages en TEXT ISO-8601 UTC

**Décision** — Tous les horodatages sont des chaînes `YYYY-MM-DDTHH:MM:SS.sssZ` en UTC ; les dates calendaires sont `YYYY-MM-DD`.

**Pourquoi** — Le CDC utilisait `TIMESTAMP` sans fuseau. Le Maroc applique un changement d'heure (retour à UTC+0 pendant le Ramadan) : deux fois par an, un horodatage local est ambigu. Pour un journal d'audit conservé 10 ans et pour la résolution d'un taux de change « à la date de », c'est disqualifiant.

Le stockage en UTC explicite résout le problème et se migre directement vers `TIMESTAMPTZ`.

---

## D-12 — Tables `STRICT` et clés étrangères actives

**Décision** — Toutes les tables sont déclarées `STRICT`. `PRAGMA foreign_keys = ON` est requis sur chaque connexion.

**Pourquoi** — Sans `STRICT`, SQLite accepte `'abc'` dans une colonne numérique. Sans le PRAGMA, les clés étrangères ne sont pas vérifiées — ce qui aurait rendu vains les contrôles C03 et C04.

**Conséquence** — Le pool `sqlx` doit exécuter le PRAGMA à l'ouverture de chaque connexion. Les triggers reposent par ailleurs sur `recursive_triggers` désactivé (valeur par défaut) : ne pas l'activer.

---

## Questions ouvertes

Ces points appellent une décision métier, pas technique. Ils sont documentés dans `docs/ecarts-cahier-des-charges.md`.

1. **124 ou 300 références ?** A2/E2 et E9 se contredisent. La classification ABC (16 + 25 + 259) totalise 300.
2. **Rotation ≥ 12×/an ou couverture ≥ 60 jours ?** Les deux objectifs de A3 sont mutuellement exclusifs : 60 jours de couverture impliquent une rotation d'environ 6×/an.
3. **Définition du KPI « économies »** — « 5 557 436 MAD/an sur 33 opportunités » est le chiffre le plus mis en avant du cockpit, et aucune formule n'en est donnée nulle part.
4. **`m2_prevus` est-il déjà saisonnalisé ?** Retenu : oui (`m2_prevus` fait foi, `saisonnalite` reste informative). À confirmer.
5. **Module ventes** — le DSO (60 j) et le CCC (−41 j) sont affichés sans aucune source de données dans le modèle.
