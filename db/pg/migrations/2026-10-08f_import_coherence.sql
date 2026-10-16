-- =============================================================================
-- 2026-10-08f — Import : facture figee, etancheite local / import
-- (audit v4, P2 action 13)
-- =============================================================================
-- 1. UNE FACTURE RECUE NE BOUGE PLUS. Fournisseur, devise, taux et montant
--    d'une facture dont une ligne est entree en stock, et reference, poids,
--    prix, remise, ligne de bon d'une ligne recue, se modifiaient librement :
--    le stock etait valorise sur une facture qui n'existait plus. La base le
--    refuse (IMPORT-FIGEE). Une correction passe par les frais du dossier, ou
--    par la contre-passation de la reception avant la DUM.
-- 2. ETANCHEITE LOCAL / IMPORT. Une ligne de bon servie par un dossier
--    d'import se recevait aussi en reception locale (BC-0006 sur la copie) :
--    deux entrees pour une commande. La base refuse l'une quand l'autre existe ;
--    le controle C45 montre les cas anterieurs.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_trg_import_facture_figee() RETURNS trigger AS $$
BEGIN
    IF (NEW.code_fournisseur, NEW.code_devise, NEW.taux_change, NEW.montant_devise)
           IS DISTINCT FROM (OLD.code_fournisseur, OLD.code_devise, OLD.taux_change, OLD.montant_devise)
       AND EXISTS (SELECT 1 FROM import_facture_lignes l WHERE l.id_facture = NEW.id_facture
                      AND l.quantite_recue_kg > 0) THEN
        RAISE EXCEPTION 'IMPORT-FIGEE : la facture % a deja fait entrer de la marchandise : son fournisseur, sa devise, son taux et son montant ne bougent plus. Corrigez par les frais du dossier, ou contre-passez la reception avant la DUM.',
            NEW.numero_facture USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_import_facture_figee() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_import_facture_figee ON import_factures;
CREATE TRIGGER trg_import_facture_figee BEFORE UPDATE ON import_factures
FOR EACH ROW EXECUTE FUNCTION fn_trg_import_facture_figee();

CREATE OR REPLACE FUNCTION fn_trg_import_ligne_figee() RETURNS trigger AS $$
BEGIN
    IF OLD.quantite_recue_kg > 0
       AND (NEW.code_reference, NEW.type_ligne, NEW.unite, NEW.quantite, NEW.poids_net_kg,
            NEW.prix_unitaire_devise, NEW.remise_pct, NEW.id_ligne_bc)
           IS DISTINCT FROM
           (OLD.code_reference, OLD.type_ligne, OLD.unite, OLD.quantite, OLD.poids_net_kg,
            OLD.prix_unitaire_devise, OLD.remise_pct, OLD.id_ligne_bc) THEN
        RAISE EXCEPTION 'IMPORT-FIGEE : la ligne % de la facture est deja recue (% kg) : reference, poids, prix et bon ne bougent plus. Soldez-la, ou contre-passez la reception avant la DUM.',
            OLD.code_reference, OLD.quantite_recue_kg USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_import_ligne_figee() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_import_ligne_figee ON import_facture_lignes;
CREATE TRIGGER trg_import_ligne_figee BEFORE UPDATE ON import_facture_lignes
FOR EACH ROW EXECUTE FUNCTION fn_trg_import_ligne_figee();

-- L'etancheite, dans les deux sens.
CREATE OR REPLACE FUNCTION fn_trg_reception_locale_hors_import() RETURNS trigger AS $$
DECLARE v_dossier text;
BEGIN
    IF NEW.id_ligne_bc IS NOT NULL THEN
        SELECT d.numero INTO v_dossier
          FROM import_facture_lignes fl
          JOIN import_factures f ON f.id_facture = fl.id_facture
          JOIN import_dossiers d ON d.id_dossier = f.id_dossier
         WHERE fl.id_ligne_bc = NEW.id_ligne_bc
         LIMIT 1;
        IF v_dossier IS NOT NULL THEN
            RAISE EXCEPTION 'ETANCHEITE : cette ligne de bon (%) est servie par le dossier d''import % : elle se recoit par la reception d''import, pas en reception locale.',
                NEW.code_reference, v_dossier USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_reception_locale_hors_import() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_reception_locale_hors_import ON ligne_reception;
CREATE TRIGGER trg_reception_locale_hors_import BEFORE INSERT OR UPDATE OF id_ligne_bc ON ligne_reception
FOR EACH ROW EXECUTE FUNCTION fn_trg_reception_locale_hors_import();

CREATE OR REPLACE FUNCTION fn_trg_import_hors_reception_locale() RETURNS trigger AS $$
DECLARE v_reception text;
BEGIN
    IF NEW.id_ligne_bc IS NOT NULL THEN
        SELECT r.numero_reception INTO v_reception
          FROM ligne_reception lr JOIN reception r ON r.id_reception = lr.id_reception
         WHERE lr.id_ligne_bc = NEW.id_ligne_bc AND r.statut <> 'ANNULE'
         LIMIT 1;
        IF v_reception IS NOT NULL THEN
            RAISE EXCEPTION 'ETANCHEITE : cette ligne de bon est deja recue en reception locale (%) : elle ne se rattache pas a un dossier d''import.',
                v_reception USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_import_hors_reception_locale() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_import_hors_reception_locale ON import_facture_lignes;
CREATE TRIGGER trg_import_hors_reception_locale BEFORE INSERT OR UPDATE OF id_ligne_bc ON import_facture_lignes
FOR EACH ROW EXECUTE FUNCTION fn_trg_import_hors_reception_locale();

-- C45 : les cas anterieurs aux declencheurs.
CREATE OR REPLACE VIEW v_ctl_c45 AS
SELECT bc.numero_bc, lb.code_reference, lb.id_ligne_bc
  FROM ligne_bc lb
  JOIN bon_commande bc ON bc.id_bc = lb.id_bc
 WHERE EXISTS (SELECT 1 FROM import_facture_lignes fl WHERE fl.id_ligne_bc = lb.id_ligne_bc)
   AND EXISTS (SELECT 1 FROM ligne_reception lr JOIN reception r ON r.id_reception = lr.id_reception
                WHERE lr.id_ligne_bc = lb.id_ligne_bc AND r.statut <> 'ANNULE');
ALTER VIEW v_ctl_c45 OWNER TO gestionfil;

DO $$
DECLARE def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C45' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C45''::text, ''Ligne de bon recue a la fois en local et a l''''import''::text,'
                ' ''CRITIQUE''::text, (SELECT count(*) FROM v_ctl_c45)';
    END IF;
END $$;

COMMIT;
