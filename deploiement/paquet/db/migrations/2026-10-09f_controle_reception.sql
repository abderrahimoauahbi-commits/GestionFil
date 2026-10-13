-- =============================================================================
-- 2026-10-09f — Le controle des receptions, separation reelle (regle 4, 09/10/2026)
-- =============================================================================
-- Arbitrage (option A) : celui qui valide une reception ne peut pas etre
-- l'auteur de sa DERNIERE pesee. Un controleur qui voit une erreur ne corrige
-- plus lui-meme : il renvoie au magasinier, avec un motif ; le magasinier
-- corrige et resoumet ; le controleur valide. Meme regle en local et a l'import.
--
-- 1. L'auteur de la derniere pesee, tenu par la base : tout ajout, suppression
--    ou correction de quantite, de bobines ou de palettes sur une ligne le pose
--    (compte connecte, gestionfil.id_utilisateur). Les lots generes et le
--    recalage de l'attendu, que fait la validation, ne comptent pas.
-- 2. La validation refusee a l'auteur de la derniere pesee.
-- 3. Le renvoi au magasinier : motif, date, auteur.
-- 4. Les lignes de reception locale au journal d'audit (ancien et nouveau
--    poids) : une correction ne passe plus sans trace.
-- 5. Import : le createur du bon ne valide pas la reception (U1, comme en local).
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1 et 3. Les colonnes ------------------------------------------------------------
ALTER TABLE reception ADD COLUMN IF NOT EXISTS id_utilisateur_pesee text REFERENCES utilisateur(id_utilisateur);
ALTER TABLE reception ADD COLUMN IF NOT EXISTS motif_renvoi text;
ALTER TABLE reception ADD COLUMN IF NOT EXISTS date_renvoi text;
ALTER TABLE reception ADD COLUMN IF NOT EXISTS id_utilisateur_renvoi text REFERENCES utilisateur(id_utilisateur);
ALTER TABLE import_receptions ADD COLUMN IF NOT EXISTS id_utilisateur_pesee text REFERENCES utilisateur(id_utilisateur);
ALTER TABLE import_receptions ADD COLUMN IF NOT EXISTS motif_renvoi text;
ALTER TABLE import_receptions ADD COLUMN IF NOT EXISTS date_renvoi text;
ALTER TABLE import_receptions ADD COLUMN IF NOT EXISTS id_utilisateur_renvoi text REFERENCES utilisateur(id_utilisateur);
CREATE INDEX IF NOT EXISTS ix_fk_reception_pesee ON reception(id_utilisateur_pesee);
CREATE INDEX IF NOT EXISTS ix_fk_reception_renvoi ON reception(id_utilisateur_renvoi);
CREATE INDEX IF NOT EXISTS ix_fk_import_receptions_pesee ON import_receptions(id_utilisateur_pesee);
CREATE INDEX IF NOT EXISTS ix_fk_import_receptions_renvoi ON import_receptions(id_utilisateur_renvoi);

-- Le passe : la pesee est celle de qui a saisi la reception.
UPDATE reception SET id_utilisateur_pesee = id_utilisateur_reception
 WHERE id_utilisateur_pesee IS NULL AND id_utilisateur_reception IS NOT NULL;
UPDATE import_receptions SET id_utilisateur_pesee = id_utilisateur_creation
 WHERE id_utilisateur_pesee IS NULL AND id_utilisateur_creation IS NOT NULL;

-- 1. Qui a pese en dernier ----------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_pesee_auteur() RETURNS trigger AS $$
DECLARE
    v_qui text := NULLIF(current_setting('gestionfil.id_utilisateur', true), '');
    v_id  text;
BEGIN
    IF v_qui IS NULL THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'DELETE' THEN
        v_id := OLD.id_reception;
    ELSE
        v_id := NEW.id_reception;
    END IF;
    -- Une mise a jour qui ne touche pas la pesee (lot genere, attendu recale,
    -- mouvement rattache, qualite) ne change pas l'auteur de la pesee.
    IF TG_OP = 'UPDATE' THEN
        IF TG_TABLE_NAME = 'ligne_reception' THEN
            IF (NEW.quantite_pesee_unite, NEW.quantite_stock_kg, NEW.unite_saisie, NEW.nb_bobines_saisi,
                NEW.nb_palettes_saisi, NEW.code_reference)
               IS NOT DISTINCT FROM
               (OLD.quantite_pesee_unite, OLD.quantite_stock_kg, OLD.unite_saisie, OLD.nb_bobines_saisi,
                OLD.nb_palettes_saisi, OLD.code_reference) THEN
                RETURN NULL;
            END IF;
        ELSE
            IF (NEW.quantite_recue_kg, NEW.nb_bobines, NEW.nb_palettes)
               IS NOT DISTINCT FROM (OLD.quantite_recue_kg, OLD.nb_bobines, OLD.nb_palettes) THEN
                RETURN NULL;
            END IF;
        END IF;
    END IF;
    IF TG_TABLE_NAME = 'ligne_reception' THEN
        UPDATE reception SET id_utilisateur_pesee = v_qui
         WHERE id_reception = v_id AND id_utilisateur_pesee IS DISTINCT FROM v_qui;
    ELSE
        UPDATE import_receptions SET id_utilisateur_pesee = v_qui
         WHERE id_reception = v_id AND id_utilisateur_pesee IS DISTINCT FROM v_qui;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_pesee_auteur() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_pesee_auteur ON ligne_reception;
CREATE TRIGGER trg_pesee_auteur AFTER INSERT OR UPDATE OR DELETE ON ligne_reception
FOR EACH ROW EXECUTE FUNCTION fn_trg_pesee_auteur();
DROP TRIGGER IF EXISTS trg_pesee_auteur ON import_reception_lignes;
CREATE TRIGGER trg_pesee_auteur AFTER INSERT OR UPDATE OR DELETE ON import_reception_lignes
FOR EACH ROW EXECUTE FUNCTION fn_trg_pesee_auteur();

-- 2. La validation refusee a qui a pese ---------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_reception_valideur_pas_peseur() RETURNS trigger AS $$
DECLARE
    v_qui text := NULLIF(current_setting('gestionfil.id_utilisateur', true), '');
BEGIN
    IF TG_TABLE_NAME = 'reception' THEN
        IF NEW.statut = 'VALIDE' AND OLD.statut IS DISTINCT FROM 'VALIDE'
           AND NEW.id_utilisateur_pesee IS NOT NULL
           AND NEW.id_utilisateur_pesee = COALESCE(NEW.id_utilisateur_controle, v_qui) THEN
            RAISE EXCEPTION 'B4 regle 2 : vous avez pese ou corrige la pesee de la reception % : un autre doit la valider. Renvoyez-la au magasinier si elle est fausse.',
                NEW.numero_reception USING ERRCODE = 'check_violation';
        END IF;
    ELSE
        IF NEW.statut = 'VALIDEE' AND OLD.statut IS DISTINCT FROM 'VALIDEE'
           AND NEW.id_utilisateur_pesee IS NOT NULL
           AND NEW.id_utilisateur_pesee = COALESCE(NEW.id_utilisateur_validation, v_qui) THEN
            RAISE EXCEPTION 'B4 regle 2 : vous avez pese ou corrige la pesee de la reception % : un autre doit la valider. Renvoyez-la au magasinier si elle est fausse.',
                NEW.numero USING ERRCODE = 'check_violation';
        END IF;
        -- 5. Le createur d'un bon servi par cette reception ne la valide pas (U1).
        IF NEW.statut = 'VALIDEE' AND OLD.statut IS DISTINCT FROM 'VALIDEE' AND EXISTS (
            SELECT 1 FROM import_reception_lignes rl
              JOIN import_facture_lignes fl ON fl.id_ligne = rl.id_ligne
              JOIN ligne_bc lb ON lb.id_ligne_bc = fl.id_ligne_bc
              JOIN bon_commande bc ON bc.id_bc = lb.id_bc
             WHERE rl.id_reception = NEW.id_reception
               AND bc.id_utilisateur_creation = COALESCE(NEW.id_utilisateur_validation, v_qui)) THEN
            RAISE EXCEPTION 'B4 regle 2 : le createur du bon de commande ne valide pas la reception % qui le sert.',
                NEW.numero USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_reception_valideur_pas_peseur() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_reception_valideur_pas_peseur ON reception;
CREATE TRIGGER trg_reception_valideur_pas_peseur BEFORE UPDATE OF statut ON reception
FOR EACH ROW EXECUTE FUNCTION fn_trg_reception_valideur_pas_peseur();
DROP TRIGGER IF EXISTS trg_reception_valideur_pas_peseur ON import_receptions;
CREATE TRIGGER trg_reception_valideur_pas_peseur BEFORE UPDATE OF statut ON import_receptions
FOR EACH ROW EXECUTE FUNCTION fn_trg_reception_valideur_pas_peseur();

-- 4. Les lignes de reception locale au journal ------------------------------------
DROP TRIGGER IF EXISTS trg_audit_modification ON ligne_reception;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE ON ligne_reception
FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification('id_mouvement_genere');

COMMIT;
