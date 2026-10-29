-- =============================================================================
-- 2026-10-27d — Le fil en route est un arrivage : sa date prévue de disponibilité
-- =============================================================================
-- ARBITRAGE DU 27/10/2026 (direction). Un transfert expédié porte une DATE PRÉVUE
-- DE DISPONIBILITÉ au magasin destinataire :
--
--   * OBLIGATOIRE À L'EXPÉDITION (passage BROUILLON → VALIDE) : garanti ici, en
--     base, par un déclencheur sur la transition d'état (TRF-DATE) ;
--   * RÉVISABLE tant que le transfert est en route (VALIDE), jamais après sa
--     réception (TERMINE) ni sur un transfert abandonné (ANNULE) ;
--   * saisissable dès le brouillon (l'écran de préparation la porte) ;
--   * chaque changement est journalisé par l'audit existant
--     (`fn_trg_audit_modification`, sur la seule colonne).
--
-- Le moteur de couverture (`routes/couverture.rs`) compte le transfert comme un
-- arrivage à cette date (catégorie TRANSIT) vers le magasin destinataire compté.
-- Date dépassée sans nouvelle date : « en retard », hors couverture (comme un bon
-- en retard). Jamais une date déduite d'un constat machine ni d'autre chose.
--
-- LES TRANSFERTS DÉJÀ EN ROUTE SANS DATE (expédiés avant cette migration) ne sont
-- pas datés d'office : le moteur les liste « sans date », ne les compte pas, et le
-- contrôle C66 (2026-10-27e) les signale jusqu'à ce qu'une date soit saisie.
--
-- Déclarés au module MOUVEMENTS (la liste des transferts) : la date et le retard.
-- Le libellé de `transit_kg` (PLAN_ACHAT) change de sens : compté à sa date.
-- Rejouable. Enregistrée par migrer.py. Exigée au démarrage (backend/src/db.rs).
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE transfert ADD COLUMN IF NOT EXISTS date_disponibilite_prevue date;
COMMENT ON COLUMN transfert.date_disponibilite_prevue IS
    'Date prévue de disponibilité au magasin destinataire : obligatoire à l''expédition, révisable tant que le transfert est en route (arbitrage du 27/10/2026). Le moteur de couverture compte le transfert à cette date.';

-- -----------------------------------------------------------------------------
-- L'invariant, en base (TRF-DATE)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_transfert_date_disponibilite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- L'expédition (passage en VALIDE) exige la date.
    IF NEW.statut = 'VALIDE'
       AND (TG_OP = 'INSERT' OR OLD.statut IS DISTINCT FROM 'VALIDE')
       AND NEW.date_disponibilite_prevue IS NULL THEN
        RAISE EXCEPTION 'TRF-DATE : le transfert % ne part pas sans date prévue de disponibilité au magasin destinataire. Saisissez-la avant d''expédier.',
            NEW.numero_transfert;
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.date_disponibilite_prevue IS DISTINCT FROM OLD.date_disponibilite_prevue THEN
        -- Reçu ou abandonné : la date est figée.
        IF OLD.statut NOT IN ('BROUILLON', 'VALIDE') THEN
            RAISE EXCEPTION 'TRF-DATE : le transfert % est %, sa date prévue de disponibilité ne se révise plus (seulement tant qu''il est en route).',
                NEW.numero_transfert, lower(OLD.statut);
        END IF;
        -- En route, on la révise, on ne l'efface pas.
        IF OLD.statut = 'VALIDE' AND NEW.date_disponibilite_prevue IS NULL THEN
            RAISE EXCEPTION 'TRF-DATE : le transfert % est en route : sa date prévue de disponibilité se révise, elle ne s''efface pas.',
                NEW.numero_transfert;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION fn_trg_transfert_date_disponibilite() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_transfert_date_disponibilite ON transfert;
CREATE TRIGGER trg_transfert_date_disponibilite
    BEFORE INSERT OR UPDATE ON transfert
    FOR EACH ROW EXECUTE FUNCTION fn_trg_transfert_date_disponibilite();

-- -----------------------------------------------------------------------------
-- La révision journalisée par l'audit existant (qui, quand, avant, après)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_transfert_date ON transfert;
CREATE TRIGGER trg_audit_transfert_date
    AFTER UPDATE OF date_disponibilite_prevue ON transfert
    FOR EACH ROW
    WHEN (OLD.date_disponibilite_prevue IS DISTINCT FROM NEW.date_disponibilite_prevue)
    EXECUTE FUNCTION fn_trg_audit_modification('version', 'statut', 'date_sortie',
                                               'id_utilisateur_reception', 'date_reception_dest');

-- -----------------------------------------------------------------------------
-- Les champs à l'écran
-- -----------------------------------------------------------------------------
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'MOUVEMENTS', c.champ, c.libelle, 'LECTURE', 0, 990
  FROM (VALUES ('date_disponibilite_prevue', 'Disponible le (prévu)'),
               ('jours_de_retard_disponibilite', 'Retard sur la date prévue (j)')
       ) c(champ, libelle)
ON CONFLICT DO NOTHING;

UPDATE champ_configurable
   SET libelle = 'Transferts en route, comptés à leur date (kg)'
 WHERE module = 'PLAN_ACHAT' AND champ = 'transit_kg'
   AND libelle IS DISTINCT FROM 'Transferts en route, comptés à leur date (kg)';

-- Témoin
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'transfert'
                      AND column_name = 'date_disponibilite_prevue' AND data_type = 'date')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_transfert_date_disponibilite')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_transfert_date')
       OR NOT EXISTS (SELECT 1 FROM champ_configurable
                       WHERE module = 'MOUVEMENTS' AND champ = 'date_disponibilite_prevue') THEN
        RAISE EXCEPTION '2026-10-27d : migration incomplète';
    END IF;
END $$;

COMMIT;
