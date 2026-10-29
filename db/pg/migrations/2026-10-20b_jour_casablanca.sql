-- =============================================================================
-- 2026-10-20b — Le jour est celui de Casablanca (decision du 20/10/2026)
-- =============================================================================
-- Le serveur ouvre ses sessions a l'heure de Casablanca (db.rs) : current_date
-- y est le jour de l'usine. Restait la regle C06 « pas de mouvement date dans
-- le futur », qui comparait le jour du mouvement a l'instant UTC en texte :
-- entre minuit et 1 h (heure du Maroc), un mouvement du jour etait refuse.
-- Elle compare desormais deux jours de Casablanca, quel que soit le fuseau de
-- la session (psql, sauvegarde, outil d'administration).
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

DROP TRIGGER IF EXISTS trg_mouvement_date_future ON mouvement;
CREATE TRIGGER trg_mouvement_date_future BEFORE INSERT ON mouvement
FOR EACH ROW WHEN (NEW.date_mouvement > (now() AT TIME ZONE 'Africa/Casablanca')::date)
EXECUTE FUNCTION fn_refuser('C06 : un mouvement ne peut pas etre date dans le futur.');

CREATE OR REPLACE VIEW v_ctl_c06 AS
SELECT id_mouvement, numero_mouvement, (date_mouvement)::text AS date_mouvement
  FROM mouvement
 WHERE date_mouvement > (now() AT TIME ZONE 'Africa/Casablanca')::date;
ALTER VIEW v_ctl_c06 OWNER TO gestionfil;

-- Temoin
DO $$
BEGIN
    IF pg_get_triggerdef((SELECT oid FROM pg_trigger WHERE tgname = 'trg_mouvement_date_future'))
       !~ 'Africa/Casablanca' THEN
        RAISE EXCEPTION '2026-10-20b : migration incomplete';
    END IF;
END $$;

COMMIT;
