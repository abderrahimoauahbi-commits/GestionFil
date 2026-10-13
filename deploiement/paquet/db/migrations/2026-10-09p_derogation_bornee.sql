-- =============================================================================
-- 2026-10-09p — La derogation de lot bornee en kilos (audit v5, F17, 09/10/2026)
-- =============================================================================
-- Une derogation LOT_BLOQUE accordee pour une fiche admettait n'importe quelle
-- quantite de ce lot, et la validation de la fiche consommait d'un coup toutes
-- les derogations du document. Desormais :
--   * la demande porte les kilos demandes (kg_autorises) : la base n'admet pas
--     un chargement au-dela ;
--   * la validation consomme lot par lot, avec les kilos reellement charges
--     (kg_consommes) ;
--   * une fiche brouillon supprimee ou annulee emporte ses derogations non
--     employees (ANNULEE) : une nouvelle fiche demande la sienne.
-- Les derogations anterieures (kg_autorises vide) restent sans borne. Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE demande_autorisation
    ADD COLUMN IF NOT EXISTS kg_autorises numeric(18, 4),
    ADD COLUMN IF NOT EXISTS kg_consommes numeric(18, 4);
ALTER TABLE demande_autorisation DROP CONSTRAINT IF EXISTS ck_demande_kg_autorises;
ALTER TABLE demande_autorisation ADD CONSTRAINT ck_demande_kg_autorises
    CHECK (kg_autorises IS NULL OR kg_autorises > 0);

-- Le controle du mouvement : la derogation couvre ce lot, cette fiche, et au
-- plus ses kilos (lignes deja ecrites du meme document comprises).
DO $$
DECLARE
    def text;
    ancien constant text := 'AND d.document = v_doc AND d.date_consommation IS NULL) THEN';
BEGIN
    def := pg_get_functiondef('fn_trg_lmvt_lot_controle'::regproc);
    IF position('kg_autorises' IN def) = 0 THEN
        IF position(ancien IN def) = 0 THEN
            RAISE EXCEPTION 'fn_trg_lmvt_lot_controle : la clause de derogation a change, migration a revoir';
        END IF;
        def := replace(def, ancien,
            'AND d.document = v_doc AND d.date_consommation IS NULL'
            || E'\n                   AND (d.kg_autorises IS NULL OR NEW.quantite_kg + COALESCE(('
            || E'\n                        SELECT sum(lm.quantite_kg) FROM ligne_mouvement lm'
            || E'\n                          JOIN mouvement m2 ON m2.id_mouvement = lm.id_mouvement'
            || E'\n                         WHERE m2.code_type_mvt = ''CHARGE_MACHINE'' AND m2.reference_document = v_doc'
            || E'\n                           AND lm.code_reference = NEW.code_reference'
            || E'\n                           AND lm.lot_fournisseur = NEW.lot_fournisseur'
            || E'\n                           AND NOT EXISTS (SELECT 1 FROM mouvement inv WHERE inv.id_mouvement_contrepasse = m2.id_mouvement)'
            || E'\n                       ), 0) <= d.kg_autorises + 0.0005)) THEN');
        EXECUTE def;
    END IF;
END $$;
ALTER FUNCTION fn_trg_lmvt_lot_controle() OWNER TO gestionfil;

-- Une fiche jetee ou annulee emporte ses derogations non employees.
CREATE OR REPLACE FUNCTION fn_trg_fiche_derogations() RETURNS trigger AS $$
DECLARE
    v_numero text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_numero := OLD.numero_fiche;
    ELSIF NEW.statut = 'ANNULE' AND OLD.statut IS DISTINCT FROM 'ANNULE' THEN
        v_numero := NEW.numero_fiche;
    ELSE
        RETURN NEW;
    END IF;
    UPDATE demande_autorisation
       SET statut = 'ANNULEE',
           motif_decision = 'Fiche ' || v_numero || ' supprimee ou annulee : derogation non employee retiree'
     WHERE type_demande = 'LOT_BLOQUE' AND document = v_numero
       AND statut IN ('EN_ATTENTE', 'ACCORDEE') AND date_consommation IS NULL;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_fiche_derogations() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_fiche_derogations ON machine_fiche;
CREATE TRIGGER trg_fiche_derogations AFTER UPDATE OF statut OR DELETE ON machine_fiche
FOR EACH ROW EXECUTE FUNCTION fn_trg_fiche_derogations();

COMMIT;
