-- =============================================================================
-- MIGRATION 2026-09-02 — identite complete de l'entreprise
-- -----------------------------------------------------------------------------
-- PREMIERE MIGRATION INCREMENTALE. La base de production a ete chargee avant
-- que `entreprise` ne recoive le groupe, le telephone, le fax et les banques ;
-- elle porte deja un mot de passe administrateur, donc elle ne se recree plus.
-- A partir d'ici, chaque evolution de schema est un fichier date dans ce
-- dossier, rejouable sans effet s'il a deja ete applique.
--
-- Application, sur le serveur :
--     cd /tmp && sudo -u postgres psql -d gestionfil -v ON_ERROR_STOP=1 \
--        -f /home/sysadmin/gestionfil/db/migrations/2026-09-02_entreprise_identite.sql \
--        -f /home/sysadmin/gestionfil/db/seed_120_entreprise.sql
--
-- Le seed d'identite est rejoue apres : il est ecrit en upsert et remplit les
-- colonnes qui viennent d'apparaitre.
-- =============================================================================
ALTER TABLE entreprise ADD COLUMN IF NOT EXISTS groupe    text;
ALTER TABLE entreprise ADD COLUMN IF NOT EXISTS telephone text;
ALTER TABLE entreprise ADD COLUMN IF NOT EXISTS fax       text;
ALTER TABLE entreprise ADD COLUMN IF NOT EXISTS banques   text;
