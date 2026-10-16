-- =============================================================================
-- 2026-10-09t — Une ligne de facture d'import ne vise qu'un bon envoye
-- (audit v5, U1, valide le 09/10/2026)
-- =============================================================================
-- L'ecran ne proposait que les bons envoyes, mais rien ne l'imposait : une
-- ligne de facture pouvait viser un bon en brouillon, un bon d'un autre
-- fournisseur, une autre reference, une ligne soldee ou annulee. La base le
-- refuse desormais, a la pose ou au changement du rattachement (IMPORT-BC).
-- Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_trg_import_ligne_bon() RETURNS trigger AS $$
DECLARE
    v_bc      record;
    v_frs     text;
BEGIN
    IF NEW.id_ligne_bc IS NULL THEN
        RETURN NEW;
    END IF;
    -- Un rattachement deja pose, inchange (le bon a pu avancer depuis) : rien a revoir.
    IF TG_OP = 'UPDATE' AND NEW.id_ligne_bc IS NOT DISTINCT FROM OLD.id_ligne_bc
       AND NEW.code_reference IS NOT DISTINCT FROM OLD.code_reference THEN
        RETURN NEW;
    END IF;
    SELECT b.numero_bc, b.statut AS statut_bc, b.code_fournisseur, lb.statut AS statut_ligne,
           lb.code_reference, lb.type_ligne
      INTO v_bc
      FROM ligne_bc lb JOIN bon_commande b ON b.id_bc = lb.id_bc
     WHERE lb.id_ligne_bc = NEW.id_ligne_bc;
    SELECT f.code_fournisseur INTO v_frs FROM import_factures f WHERE f.id_facture = NEW.id_facture;
    IF v_bc.statut_bc NOT IN ('ENVOYE', 'LIVRE_PARTIEL') THEN
        RAISE EXCEPTION 'IMPORT-BC : le bon % est %, pas envoye au fournisseur : une facture ne s''y rattache pas.',
            v_bc.numero_bc, lower(v_bc.statut_bc) USING ERRCODE = 'check_violation';
    END IF;
    IF v_bc.statut_ligne IN ('SOLDE', 'ANNULE') THEN
        RAISE EXCEPTION 'IMPORT-BC : la ligne du bon % est % : elle ne recoit plus rien.',
            v_bc.numero_bc, lower(v_bc.statut_ligne) USING ERRCODE = 'check_violation';
    END IF;
    IF v_bc.type_ligne <> 'MARCHANDISE' THEN
        RAISE EXCEPTION 'IMPORT-BC : la ligne du bon % est un service : une facture d''import se rattache a de la marchandise.',
            v_bc.numero_bc USING ERRCODE = 'check_violation';
    END IF;
    IF v_frs IS DISTINCT FROM v_bc.code_fournisseur THEN
        RAISE EXCEPTION 'IMPORT-BC : le bon % est d''un autre fournisseur que la facture.',
            v_bc.numero_bc USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.code_reference IS DISTINCT FROM v_bc.code_reference THEN
        RAISE EXCEPTION 'IMPORT-BC : la ligne du bon % commande %, pas %.',
            v_bc.numero_bc, v_bc.code_reference, COALESCE(NEW.code_reference, '(sans reference)')
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_import_ligne_bon() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_import_ligne_bon ON import_facture_lignes;
CREATE TRIGGER trg_import_ligne_bon BEFORE INSERT OR UPDATE OF id_ligne_bc, code_reference ON import_facture_lignes
FOR EACH ROW EXECUTE FUNCTION fn_trg_import_ligne_bon();

COMMIT;
