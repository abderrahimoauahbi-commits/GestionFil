-- =============================================================================
-- 2026-10-09y — Le journal d'audit complete, et sans bruit (audit v5, T10)
-- =============================================================================
--   * cours_bam (le cours de reference des factures d'import, des bons et du
--     change) et ligne_inventaire (les comptages) n'etaient pas journalises en
--     modification : un cours ou un compte change ne laissait pas de trace.
--   * lot_evenement est un journal : il devient immuable.
--   * La purge des propositions au recalcul du plan d'achat inscrivait une ligne
--     d'audit par proposition supprimee (une centaine a chaque calcul) : elle se
--     resume en une ligne, sous le drapeau gestionfil.purge_plan, pose par le
--     service. Les suppressions a la main restent journalisees une par une.
-- Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_audit_modification ON cours_bam;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE OR DELETE ON cours_bam
FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();

-- Les comptages : la suppression etait deja journalisee.
DROP TRIGGER IF EXISTS trg_audit_modification ON ligne_inventaire;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE ON ligne_inventaire
FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();

CREATE OR REPLACE FUNCTION fn_trg_lot_evenement_immuable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'lot_evenement est un journal : ni modification, ni suppression.';
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lot_evenement_immuable() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_lot_evenement_immuable ON lot_evenement;
CREATE TRIGGER trg_lot_evenement_immuable BEFORE UPDATE OR DELETE ON lot_evenement
FOR EACH ROW EXECUTE FUNCTION fn_trg_lot_evenement_immuable();

DROP TRIGGER IF EXISTS trg_audit_suppression_plan_achat ON plan_achat;
CREATE TRIGGER trg_audit_suppression_plan_achat AFTER DELETE ON plan_achat
FOR EACH ROW WHEN (COALESCE(current_setting('gestionfil.purge_plan', true), '') <> 'on')
EXECUTE FUNCTION fn_trg_audit_modification();

COMMIT;
