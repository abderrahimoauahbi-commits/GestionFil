-- =============================================================================
-- 2026-10-09h — La vie du dossier d'import (regle 5, arbitrage du 09/10/2026)
-- =============================================================================
-- Arbitrage :
--   * avant la cloture, les frais sont libres (ajout, modification,
--     suppression) et traces ; la facture fournisseur reste figee des la
--     premiere reception (2026-10-08f) ;
--   * une DUM saisie ne s'efface plus : elle se corrige (droit VALIDER, motif,
--     tenu par le service), jamais ne redevient vide — l'effacer rouvrait la
--     contre-passation apres dedouanement ;
--   * a la cloture, tout est fige : plus de frais ajoute, modifie ou supprime,
--     plus de reouverture du dossier (le service ne la propose plus) ;
--   * une facture tardive (transitaire, port) s'ajoute en FRAIS POST-CLOTURE :
--     le service pose `gestionfil.frais_post_cloture`, ajoute la ligne et la
--     repartit sur le stock restant, la part consommee en ecart, sans rouvrir.
-- Et le journal : les frais d'approche locaux entrent a l'audit.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- La DUM ne s'efface pas --------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_import_dum_permanente() RETURNS trigger AS $$
BEGIN
    IF COALESCE(btrim(OLD.numero_dum), '') <> '' AND COALESCE(btrim(NEW.numero_dum), '') = '' THEN
        RAISE EXCEPTION 'IMPORT-DUM : la DUM % du dossier % ne s''efface pas : elle prouve le dedouanement. Une faute de frappe se corrige (droit de valider, avec un motif).',
            OLD.numero_dum, OLD.numero USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_import_dum_permanente() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_import_dum_permanente ON import_dossiers;
CREATE TRIGGER trg_import_dum_permanente BEFORE UPDATE OF numero_dum ON import_dossiers
FOR EACH ROW EXECUTE FUNCTION fn_trg_import_dum_permanente();

-- Les frais d'un dossier cloture sont figes ---------------------------------------
ALTER TABLE dossier_lignes_frais ADD COLUMN IF NOT EXISTS post_cloture smallint NOT NULL DEFAULT 0;
ALTER TABLE dossier_lignes_frais ADD COLUMN IF NOT EXISTS motif_post_cloture text;

CREATE OR REPLACE FUNCTION fn_trg_frais_dossier_clos() RETURNS trigger AS $$
DECLARE
    v_statut text;
    v_numero text;
BEGIN
    SELECT statut, numero INTO v_statut, v_numero
      FROM import_dossiers WHERE id_dossier = COALESCE(NEW.id_dossier, OLD.id_dossier);
    IF v_statut = 'CLOTURE' THEN
        IF TG_OP = 'INSERT' AND current_setting('gestionfil.frais_post_cloture', true) = 'on'
           AND NEW.post_cloture = 1 AND length(btrim(COALESCE(NEW.motif_post_cloture, ''))) >= 5 THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'IMPORT-CLOS : le dossier % est cloture, ses frais sont figes. Une facture tardive s''ajoute en « frais post-cloture ».',
            v_numero USING ERRCODE = 'check_violation';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_frais_dossier_clos() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_frais_dossier_clos ON dossier_lignes_frais;
CREATE TRIGGER trg_frais_dossier_clos BEFORE INSERT OR UPDATE OR DELETE ON dossier_lignes_frais
FOR EACH ROW EXECUTE FUNCTION fn_trg_frais_dossier_clos();

-- Le verrou du dossier clos (2026-09-11) laisse passer le seul frais post-cloture :
-- sa ligne, ses cibles, la repartition recalculee et les frais portes par les lignes
-- de facture. Les factures elles-memes restent figees.
CREATE OR REPLACE FUNCTION fn_trg_import_verrou() RETURNS trigger AS $$
DECLARE
    v_row     record;
    v_dossier text;
    v_statut  text;
BEGIN
    IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;

    IF TG_TABLE_NAME IN ('import_factures', 'dossier_lignes_frais') THEN
        v_dossier := v_row.id_dossier;
    ELSIF TG_TABLE_NAME = 'import_facture_lignes' THEN
        SELECT id_dossier INTO v_dossier FROM import_factures WHERE id_facture = v_row.id_facture;
    ELSIF TG_TABLE_NAME IN ('dossier_lignes_frais_cibles', 'lignes_frais_repartition') THEN
        SELECT id_dossier INTO v_dossier FROM dossier_lignes_frais WHERE id_ligne_frais = v_row.id_ligne_frais;
    END IF;

    SELECT statut INTO v_statut FROM import_dossiers WHERE id_dossier = v_dossier;
    IF v_statut = 'CLOTURE' THEN
        IF current_setting('gestionfil.frais_post_cloture', true) = 'on'
           AND (TG_TABLE_NAME IN ('dossier_lignes_frais_cibles', 'lignes_frais_repartition')
                OR (TG_TABLE_NAME = 'import_facture_lignes' AND TG_OP = 'UPDATE')
                OR (TG_TABLE_NAME = 'dossier_lignes_frais' AND TG_OP = 'INSERT')) THEN
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Dossier cloture : ses factures, ses frais et leur repartition sont figes. Une facture tardive s''ajoute en « frais post-cloture ».'
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_import_verrou() OWNER TO gestionfil;

-- Les frais d'approche locaux au journal --------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.frais_approche') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS trg_audit_modification ON frais_approche;
        CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE ON frais_approche
        FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();
    END IF;
END $$;

COMMIT;
