-- =============================================================================
-- MIGRATION 2026-09-22c — `lot_force` passe en bigint
--
-- LE DEFAUT, ET IL EST DE MOI. La migration `2026-09-20e_lot_approximatif` a
-- cree `lot_force integer`. Tout le reste de ce schema est en `bigint`, et le
-- code Rust lit donc ces colonnes en `i64`. sqlx ne convertit pas
-- silencieusement : il refuse.
--
--     Sqlx(ColumnDecode { index: "9",
--       source: "Rust type `i64` (as SQL type `INT8`) is not compatible
--                with SQL type `INT4`" })
--
-- CONSEQUENCE : toute validation de fiche machine echouait en « erreur
-- interne » depuis le 20/09. Le chargement, le dechargement et la mise a jour
-- des metiers etaient bloques — et le message ne disait rien, puisqu'une
-- erreur interne ne se raconte jamais au client.
--
-- POURQUOI CHANGER LA BASE ET NON LE RUST. Le `i64` n'est pas l'erreur : c'est
-- la convention de tout le schema. La colonne etait l'exception. Corriger
-- l'exception vaut mieux que l'inscrire dans le code, ou elle attendrait la
-- prochaine requete qui l'oublie.
--
-- AUCUNE VUE N'EN DEPEND — verifie avant d'ecrire ceci — donc la conversion
-- passe sans depose ni recreation.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-09-22c_lot_force_bigint.sql
-- =============================================================================

ALTER TABLE ligne_mouvement      ALTER COLUMN lot_force TYPE bigint;
ALTER TABLE machine_fiche_ligne  ALTER COLUMN lot_force TYPE bigint;

-- PREUVE : plus aucune colonne `lot_force` en integer.
SELECT table_name || '.' || column_name || ' : ' || data_type
  FROM information_schema.columns
 WHERE column_name = 'lot_force'
 ORDER BY 1;
