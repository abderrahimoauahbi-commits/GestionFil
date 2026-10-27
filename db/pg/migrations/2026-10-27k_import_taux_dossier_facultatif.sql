-- =============================================================================
-- 2026-10-27k — Le taux de change d'un dossier d'import est facultatif
-- =============================================================================
-- ARBITRAGE DE L'UTILISATEUR (27/10/2026) : « Taux import → contrat serveur
-- maître ; assistant aligné dessus. » Un dossier d'import sans taux est
-- admissible ; le taux n'est exigé que là où une conversion a lieu : sur la
-- FACTURE en devise (controler_taux, backend/src/routes/importation.rs).
--
-- CE QUI EXISTAIT. `import_dossiers.taux_change` était NOT NULL : le serveur, à
-- la création, posait 1 quand le taux manquait — y compris pour un dossier en
-- euros ou en dollars. Ce taux 1 « de repli » est celui qui avait fait entrer des
-- factures à 1 DH l'euro (incident du 05/10/2026).
--
-- CE QUE FAIT CETTE MIGRATION.
--   1. `taux_change` accepte NULL (le CHECK > 0 reste : NULL le satisfait).
--   2. Un dossier NON CLOS en devise au taux 1 perd ce taux inventé (NULL) : le
--      contrôle de la facture refuse le taux 1 pour une devise, aucun dossier ne
--      peut l'avoir voulu. Un dossier clos est figé (trg_import_dossier_garde) :
--      il garde sa valeur, qui ne convertit rien.
-- Aucune vue, fonction ni déclencheur ne lit le taux du DOSSIER : la valeur en
-- dirhams, le coût de revient (v_import_cout_revient, v_cout_revient_reel), le
-- change au paiement (v_change_paiement), la répartition des frais et les
-- contrôles lisent tous le taux de la FACTURE, qui reste NOT NULL et > 0.
--
-- Rejouable : DROP NOT NULL et UPDATE ciblé sont sans effet la seconde fois.
-- Enregistrée par migrer.py. Source : db/pg/018_schema_import.sql.
-- =============================================================================

BEGIN;

ALTER TABLE import_dossiers ALTER COLUMN taux_change DROP NOT NULL;

COMMENT ON COLUMN import_dossiers.taux_change IS
    'Taux proposé aux factures du dossier, dans sa devise. Facultatif (27/10/2026) : '
    'NULL pour une devise sans taux, 1 pour le dirham ; il ne convertit rien, '
    'chaque facture porte le sien.';

UPDATE import_dossiers
   SET taux_change = NULL
 WHERE code_devise <> 'MAD'
   AND taux_change = 1
   AND statut <> 'CLOTURE';

COMMIT;
