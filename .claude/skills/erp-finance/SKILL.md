---
name: erp-finance
description: Règles de calcul et de traçabilité de l'argent dans Gestion Fil — montants, prix, CMUP, taux de change, valorisation, frais d'import, contre-passations et journal d'audit. À charger avant d'écrire ou de modifier du code qui calcule, stocke ou corrige une valeur en MAD ou en devise.
---

# Finance et traçabilité — Gestion Fil

## 1. L'argent ne passe pas par un flottant

**Règle pour tout code nouveau ou réécrit** : un montant, un prix, un CMUP ou un taux de
change ne se calcule **jamais** en `f32`/`f64`.

- En Rust : `rust_decimal::Decimal`. La dépendance n'est pas encore dans `backend/Cargo.toml` ;
  l'ajouter avec `rust_decimal = { version = "1", features = ["serde-with-str"] }` et la
  fonctionnalité `rust_decimal` de `sqlx`, puis lire les colonnes `numeric` **sans** `::float8`.
- Ou bien faire le calcul **en SQL** (`numeric`), là où vivent déjà les invariants : c'est la
  voie préférée pour le CMUP (déclencheur `fn_trg_lmvt_appliquer`, `fn_cmup_annuler_entree`).
- Le module d'import calcule déjà la répartition des frais en **centimes entiers**
  (`domain/importation.rs`, `repartir_centimes`) : c'est le modèle à suivre côté Rust si
  `Decimal` n'est pas encore branché.

**Existant** : une grande partie du backend lit les `numeric` en `f64` (`::float8`) et arrondit
à l'écriture (`db::arrondi_mad` à 2 décimales, `db::arrondi_kg` à 4). Ne pas étendre ce motif
à du code nouveau qui calcule de l'argent ; ne pas non plus lancer une conversion massive sans
décision : la migrer fichier par fichier, avec essais.

Côté interface, un montant affiché se formate (`lib/utils` `fmt`), il ne se recalcule pas :
le serveur fait foi.

## 2. Précision et arrondi
- Kilogramme : 4 décimales ; CMUP et prix au kg : 4 ; montants : 2 (MAD).
- Arrondir **une fois**, à l'écriture, jamais en cascade.
- Répartition d'un montant sur des lignes : méthode du plus fort reste, la somme des parts
  égale exactement le total (aucun centime perdu).

## 3. Devises et taux
- Chaque facture porte sa devise et son taux. Un montant en devise sans taux est refusé ;
  le taux 1 hors MAD est refusé ; un écart de plus de 3 % au cours Bank Al-Maghrib du jour
  demande confirmation (`controler_taux`, avec `taux_confirme`). Même règle pour les frais.
- Le taux utilisé est **figé** sur le document : un montant en MAD doit rester reproductible
  quand le taux du jour change.
- Jamais de repli silencieux `COALESCE(taux, 1)`.

## 4. Valorisation (CMUP)
- Le CMUP se tient par **référence × magasin**, sur les seules entrées (`impacte_cmup = 1`).
- Annuler une entrée retire sa valeur **à son prix d'origine, dans son magasin** (modèle SAP) ;
  annuler une sortie ne touche pas au CMUP. Jamais de « recalcul sur tout l'historique ».
- Un ajustement de valeur (frais d'import à la clôture, écart de prix) laisse une trace
  datée et immuable (`import_ajustements_cump`).
- Un transfert part au CMUP de la source, figé au départ.

## 5. Audit trail : rien ne s'efface
1. **Toute transaction écrivante** commence par `user.poser_contexte(&mut tx)` (ou
   `db::poser_contexte`) : les déclencheurs d'audit lisent `gestionfil.id_utilisateur`. Sans
   lui, l'action est anonyme dans `audit_log`.
2. Le grand livre (`mouvement`, `ligne_mouvement`), `audit_log`, `historique_prix`,
   `archive_reception`, les décisions machine et leurs journaux sont **immuables** (déclencheurs).
   On ne fait jamais `UPDATE` ni `DELETE` dessus.
3. Corriger = **écrire l'inverse** : contre-passation (mouvement inverse lié par
   `id_mouvement_contrepasse`, motif obligatoire de 5 caractères au moins), dévalidation,
   annulation administrative liée. Jamais un refus sec, jamais une suppression
   (doctrine de suppression).
4. Une correction de valeur dit **qui, quand, pourquoi, et combien** (avant / après).
5. Les droits suivent la ségrégation des tâches : `VALIDER` ≠ `ECRIRE` ; défaire le passé
   (contre-passation, dévalidation) est réservé à ADMIN / DIRECTION.
6. Les montants sont des champs masquables (`champ_configurable`) : un champ nouveau en MAD
   se déclare dans la grille, sinon il fuit (le masquage serveur ne masque que ce qui est déclaré).

## 6. Vérifier avant de livrer
- Contrôles de cohérence : `SELECT code, anomalies FROM v_controles` (C11 cache = grand livre,
  C15 lots = magasin) à zéro sur la copie d'essai.
- Un essai chiffré : valeur avant, opération, valeur après, comparée à la formule.
- Jamais sur la base `gestionfil` ni sur le serveur du port 8080 : sur une copie.
