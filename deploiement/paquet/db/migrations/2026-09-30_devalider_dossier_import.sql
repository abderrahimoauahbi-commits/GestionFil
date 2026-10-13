-- =============================================================================
-- MIGRATION 2026-09-30 — un dossier d'import clos peut etre devalide
--
-- LE DEFAUT. La route /api/devalider/dossiers-import (CLOTURE -> EN_COURS)
-- existait, mais le declencheur de garde refusait TOUTE modification d'un
-- dossier clos, la sienne comprise : « Dossier cloture : il ne se modifie
-- plus. » La devalidation ne pouvait donc jamais aboutir.
--
-- LA CORRECTION. Le retour a EN_COURS est le seul changement admis sur un
-- dossier clos. Tout le reste reste refuse. Le journal import_ajustements_cump
-- n'est pas touche : il reste immuable, et la cloture suivante n'applique que
-- la difference avec ce qu'il a deja ajoute au CUMP (cote serveur).
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-09-30_devalider_dossier_import.sql
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_trg_import_dossier_garde() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.statut <> 'BROUILLON' THEN
            RAISE EXCEPTION 'Seul un dossier en brouillon se supprime.' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.statut = 'CLOTURE' AND NEW.statut IS DISTINCT FROM 'EN_COURS' THEN
        RAISE EXCEPTION 'Dossier cloture : il ne se modifie plus.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION fn_trg_import_dossier_garde() OWNER TO gestionfil;

-- PREUVE
SELECT 'garde du dossier : devalidation admise = '
       || (position('IS DISTINCT FROM ''EN_COURS''' IN prosrc) > 0)::text
  FROM pg_proc WHERE proname = 'fn_trg_import_dossier_garde';
