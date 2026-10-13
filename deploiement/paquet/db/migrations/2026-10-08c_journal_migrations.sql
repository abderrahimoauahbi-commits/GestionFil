-- =============================================================================
-- 2026-10-08c — Le journal des migrations (audit v4, P2 action 10)
-- =============================================================================
-- Les migrations se jouaient a la main, et rien ne disait lesquelles une base
-- avait recues : un oubli ne se voyait qu'en « erreur interne », au premier
-- ecran qui touchait la colonne absente. Cette table les inscrit ; `migrer.py`
-- y lit ce qui reste a jouer et y ecrit ce qu'il a joue.
--
-- Une base existante s'y inscrit une fois, sans rien rejouer :
--     python migrer.py --base gestionfil --marquer-jusqua 2026-10-08c_journal_migrations.sql
-- Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS migration_appliquee (
    fichier             text    NOT NULL PRIMARY KEY,
    -- L'empreinte SHA-256 du fichier tel qu'il a ete joue : un fichier modifie
    -- apres coup se voit (migrer.py --verifier).
    empreinte           text,
    date_application    text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    -- JOUEE (par migrer.py), MARQUEE (presente avant le journal, ou comprise
    -- dans le socle) : on ne pretend pas avoir joue ce qu'on a seulement note.
    mode                text    NOT NULL DEFAULT 'JOUEE' CHECK (mode IN ('JOUEE','MARQUEE','SOCLE')),
    par                 text    NOT NULL DEFAULT current_user
);
ALTER TABLE migration_appliquee OWNER TO gestionfil;

COMMIT;
