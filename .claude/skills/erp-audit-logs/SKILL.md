---
name: erp-audit-logs
description: Règle absolue du journal d'audit de Gestion Fil — toute écriture (INSERT, UPDATE, DELETE) laisse qui, quand, l'ancienne et la nouvelle valeur dans audit_log. À charger avant d'écrire une route ou une cascade qui modifie la base, de créer une table, ou de toucher aux déclencheurs d'audit.
---

# Journal d'audit — règle absolue

Toute écriture métier dans la base laisse une ligne dans `audit_log` qui dit :
**qui** (`id_utilisateur`), **quand** (`date_operation`, UTC ISO-8601), **quoi**
(`table_concernee`, `operation`, `id_enregistrement`), **avant** (`anciennes_valeurs`, JSON)
et **après** (`nouvelles_valeurs`, JSON), plus `adresse_ip` et `session_id`.

## Où se fait l'audit : dans la base, pas dans le handler

Le journal est écrit par des **déclencheurs PostgreSQL** (`db/pg/014_audit_operations.sql`,
`fn_trg_audit_*`), jamais par du code Rust qui « pense à » insérer une ligne. Un déclencheur
ne s'oublie pas, ne se contourne pas par un autre chemin (outil d'import, `psql`, binaire
d'administration), et vit dans la même transaction que l'écriture : pas d'écriture sans sa trace,
pas de trace sans son écriture.

**Ne pas** ajouter d'`INSERT INTO audit_log` dans les handlers Axum : ce serait une deuxième
source, qui divergerait de la première.

## Ce que le code Rust DOIT faire

1. **Toute transaction écrivante commence par `user.poser_contexte(&mut tx).await?`**
   (ou `db::poser_contexte`), avant la première écriture. Il pose, local à la transaction,
   `gestionfil.id_utilisateur`, `gestionfil.adresse_ip`, `gestionfil.session_id`, que lisent
   les déclencheurs. Sans lui, la ligne d'audit est **anonyme** — c'est un défaut, pas un détail.
2. Jamais d'écriture sur le pool (`&state.db`) quand une transaction est ouverte, ni d'écriture
   hors transaction : le contexte ne la suivrait pas. (Défaut connu : la suppression d'une
   réception d'import, `routes/importation.rs`, écrit sur le pool sans contexte.)
3. Les binaires `gestionfil-admin` et `gestionfil-import` posent aussi un contexte (compte
   technique nommé), jamais une écriture anonyme.

## Ce que le schéma DOIT faire

1. **Toute table nouvelle qui porte une donnée métier modifiable** reçoit ses déclencheurs
   d'audit dans la migration qui la crée :
   - `AFTER DELETE` → `fn_trg_audit_suppression` (générique, déjà branché sur 42 tables) ;
   - `AFTER INSERT OR UPDATE` → un déclencheur qui écrit `to_jsonb(OLD)` / `to_jsonb(NEW)`
     (masquer les colonnes secrètes : `mot_de_passe_hash`, `secret_totp`) et lit l'utilisateur par
     `current_setting('gestionfil.id_utilisateur', true)`.
2. Une colonne d'argent ou de statut ajoutée à une table auditée doit apparaître dans le JSON
   (pas de liste de colonnes figée qui l'oublierait).
3. **Exemptées**, parce qu'elles SONT déjà une trace : les tables immuables en insertion seule
   (`mouvement`, `ligne_mouvement`, `audit_log`, `historique_prix`, `archive_reception`,
   `machine_decision*`, `machine_fiche_journal`, `lot_evenement`, `import_ajustements_cump`),
   et les caches recalculés depuis le grand livre (`stock_magasin`, `stock_lot`).
4. **Trous connus à boucher** (tables métier modifiables sans audit à ce jour) :
   `dossier_lignes_frais` (montants de frais d'import !), `lot`, `import_engagements`,
   `cours_bam`, et les MODIFICATIONS des tables qui ne sont auditées qu'à la suppression.

## Immuabilité du journal
- `audit_log` refuse `UPDATE` et `DELETE` (`trg_audit_immuable_*`). Ne jamais les désactiver.
- Corriger une erreur = écrire une nouvelle opération (contre-passation, dévalidation,
  annulation liée), qui laisse à son tour sa ligne d'audit. Voir la skill **erp-finance**.
- Retrouver une valeur supprimée : `anciennes_valeurs` de la ligne `DELETE` (JSON complet) —
  interroger `audit_log` avant de conclure à une perte.

## Vérifier avant de livrer
Sur la copie d'essai, après l'opération :
```sql
SELECT operation, id_utilisateur, date_operation, anciennes_valeurs, nouvelles_valeurs
  FROM audit_log WHERE table_concernee = '<table>' ORDER BY date_operation DESC LIMIT 5;
```
`id_utilisateur` doit être renseigné, et l'avant / l'après doivent porter la valeur changée.
