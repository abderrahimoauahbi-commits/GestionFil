-- =============================================================================
-- MIGRATION 2026-10-01 — groupage : la DUM du dossier, l'engagement de chaque
-- facture
--
-- LE METIER (regime 010, mise a la consommation directe). Un dossier est une
-- expedition en GROUPAGE : plusieurs factures, souvent de plusieurs
-- fournisseurs et en plusieurs devises, sous un meme BL et une meme DUM.
--
--   * LA DUM est celle du dossier — une seule par dossier (decision du
--     01/10/2026). Son numero s'ecrit en quatre blocs : bureau, regime, annee,
--     serie. Le regime est 010 sauf exception.
--
--   * L'ENGAGEMENT D'IMPORTATION s'ouvre en banque sur la proforma d'UN
--     fournisseur, dans SA devise. Une facture s'impute sur UN engagement ; un
--     engagement peut couvrir plusieurs factures du meme fournisseur.
--
--   * LA DEVISE est celle de chaque facture. Le dossier garde ses colonnes
--     code_devise / taux_change (elles ne servent plus que de repli), mais
--     l'ecran ne les montre plus.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-10-01_import_groupage_dum.sql
-- =============================================================================

ALTER TABLE import_dossiers
    ADD COLUMN IF NOT EXISTS numero_dum      text,
    ADD COLUMN IF NOT EXISTS regime_douanier text NOT NULL DEFAULT '010',
    ADD COLUMN IF NOT EXISTS date_dum        text;

-- Le fournisseur dont l'engagement couvre la proforma. Vide sur les
-- engagements saisis avant cette migration : on ne le devine pas.
ALTER TABLE import_engagements
    ADD COLUMN IF NOT EXISTS code_fournisseur text REFERENCES fournisseur (code_fournisseur);

-- Retirer un engagement detache ses factures, il ne les supprime pas.
ALTER TABLE import_factures
    ADD COLUMN IF NOT EXISTS id_engagement text
        REFERENCES import_engagements (id_engagement) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_import_factures_engagement ON import_factures (id_engagement);

-- L'ENGAGEMENT D'UNE FACTURE est du meme dossier et du meme fournisseur. Un
-- engagement sans fournisseur (anterieur a cette migration) est admis.
CREATE OR REPLACE FUNCTION fn_trg_import_facture_engagement() RETURNS trigger AS $$
DECLARE
    v_dossier text;
    v_frs     text;
    v_numero  text;
BEGIN
    IF NEW.id_engagement IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT id_dossier, code_fournisseur, numero_ei INTO v_dossier, v_frs, v_numero
      FROM import_engagements WHERE id_engagement = NEW.id_engagement;
    IF v_dossier IS DISTINCT FROM NEW.id_dossier THEN
        RAISE EXCEPTION 'L''engagement % n''appartient pas a ce dossier.', v_numero
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_frs IS NOT NULL AND v_frs <> NEW.code_fournisseur THEN
        RAISE EXCEPTION 'L''engagement % couvre un autre fournisseur que celui de la facture.', v_numero
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_import_facture_engagement ON import_factures;
CREATE TRIGGER trg_import_facture_engagement
BEFORE INSERT OR UPDATE OF id_engagement, code_fournisseur ON import_factures
FOR EACH ROW EXECUTE FUNCTION fn_trg_import_facture_engagement();

ALTER FUNCTION fn_trg_import_facture_engagement() OWNER TO gestionfil;

-- PREUVE
SELECT 'groupage : ' ||
       (SELECT count(*) FROM information_schema.columns
         WHERE (table_name, column_name) IN (('import_dossiers','numero_dum'),
                                             ('import_dossiers','regime_douanier'),
                                             ('import_dossiers','date_dum'),
                                             ('import_engagements','code_fournisseur'),
                                             ('import_factures','id_engagement')))
       || '/5 colonnes';
