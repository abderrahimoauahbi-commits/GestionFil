-- =============================================================================
-- 2026-10-08j — Sessions : revocation au changement de mot de passe, code a
-- usage unique (audit v4, P2 action 18)
-- =============================================================================
-- 1. Un jeton emis AVANT un changement de mot de passe restait valable jusqu'a
--    son expiration (huit heures) : changer son mot de passe apres un vol de
--    session ne fermait pas la session volee. La date du changement est posee
--    par la base, quel que soit l'ecrivain (ecran, administration, outil) ; le
--    service refuse un jeton plus ancien.
-- 2. Un code de double authentification se rejouait pendant sa fenetre de
--    validite (jusqu'a 90 secondes). Le dernier pas de temps accepte est
--    inscrit ; un code deja employe est refuse.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS mot_de_passe_change_le bigint;
ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS totp_dernier_pas bigint;

CREATE OR REPLACE FUNCTION fn_trg_utilisateur_mdp_change() RETURNS trigger AS $$
BEGIN
    IF NEW.mot_de_passe_hash IS DISTINCT FROM OLD.mot_de_passe_hash THEN
        NEW.mot_de_passe_change_le := floor(extract(epoch FROM clock_timestamp()))::bigint;
    END IF;
    -- Un nouveau secret repart d'un compteur vierge.
    IF NEW.secret_totp IS DISTINCT FROM OLD.secret_totp THEN
        NEW.totp_dernier_pas := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_utilisateur_mdp_change() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_utilisateur_mdp_change ON utilisateur;
CREATE TRIGGER trg_utilisateur_mdp_change BEFORE UPDATE OF mot_de_passe_hash, secret_totp ON utilisateur
FOR EACH ROW EXECUTE FUNCTION fn_trg_utilisateur_mdp_change();

COMMIT;
