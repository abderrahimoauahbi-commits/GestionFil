-- =============================================================================
-- 2026-10-09n — L'avoir d'import (regle 3, arbitrage du 09/10/2026)
-- =============================================================================
-- Une facture d'import recue est figee ; un avoir du fournisseur ne
-- s'enregistrait nulle part. Il passe par le journal du dossier :
--   * AVOIR_PRIX   : remise, non-conformite gardee. La valeur baisse, portee a
--                    la marchandise du dossier encore en stock (son CMUP), la part
--                    deja sortie en « consomme » — le moteur de la cloture.
--   * AVOIR_RETOUR : rapproche des retours fournisseur rattaches aux receptions
--                    du dossier (nature RETOUR, un par mouvement, qui le solde).
--                    Les kilos sont deja sortis : rien au CMUP, la difference de
--                    prix en « consomme ».
-- Les lignes de la cloture restent d'origine FRAIS. Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE import_ajustements_cump
    ADD COLUMN IF NOT EXISTS origine text NOT NULL DEFAULT 'FRAIS',
    ADD COLUMN IF NOT EXISTS numero_piece text,
    ADD COLUMN IF NOT EXISTS motif text,
    ADD COLUMN IF NOT EXISTS id_mouvement_retour text REFERENCES mouvement(id_mouvement);
CREATE INDEX IF NOT EXISTS ix_fk_import_ajustements_cump_mouvement_retour
    ON import_ajustements_cump(id_mouvement_retour);

ALTER TABLE import_ajustements_cump DROP CONSTRAINT IF EXISTS import_ajustements_cump_nature_check;
ALTER TABLE import_ajustements_cump ADD CONSTRAINT import_ajustements_cump_nature_check
    CHECK (nature IN ('STOCK', 'CONSOMME', 'RETOUR'));
ALTER TABLE import_ajustements_cump DROP CONSTRAINT IF EXISTS import_ajustements_cump_check;
ALTER TABLE import_ajustements_cump ADD CONSTRAINT import_ajustements_cump_check
    CHECK ((nature = 'STOCK' AND code_magasin IS NOT NULL AND cump_apres IS NOT NULL)
        OR (nature = 'CONSOMME' AND code_magasin IS NULL)
        OR (nature = 'RETOUR' AND code_magasin IS NULL AND id_mouvement_retour IS NOT NULL));
ALTER TABLE import_ajustements_cump DROP CONSTRAINT IF EXISTS ck_iac_origine;
ALTER TABLE import_ajustements_cump ADD CONSTRAINT ck_iac_origine
    CHECK (origine IN ('FRAIS', 'AVOIR_PRIX', 'AVOIR_RETOUR'));
-- Un avoir porte sa piece et son motif.
ALTER TABLE import_ajustements_cump DROP CONSTRAINT IF EXISTS ck_iac_avoir_justifie;
ALTER TABLE import_ajustements_cump ADD CONSTRAINT ck_iac_avoir_justifie
    CHECK (origine = 'FRAIS'
        OR (COALESCE(btrim(numero_piece), '') <> '' AND char_length(btrim(COALESCE(motif, ''))) >= 5));
-- Un retour ne se solde qu'une fois.
CREATE UNIQUE INDEX IF NOT EXISTS ux_iac_retour_solde
    ON import_ajustements_cump(id_mouvement_retour) WHERE nature = 'RETOUR';

-- Les retours fournisseur d'un dossier : rattaches a une reception d'import
-- (RIM-…) qui a recu cette reference pour ce dossier.
CREATE OR REPLACE VIEW v_retours_import AS
SELECT d.id_dossier, d.numero AS numero_dossier, r.id_reception, r.numero AS numero_reception,
       m.id_mouvement, m.numero_mouvement, m.date_mouvement, lm.code_reference,
       round(sum(lm.quantite_kg), 4) AS kg,
       EXISTS (SELECT 1 FROM import_ajustements_cump a
                WHERE a.nature = 'RETOUR' AND a.id_mouvement_retour = m.id_mouvement) AS solde
  FROM mouvement m
  JOIN ligne_mouvement lm ON lm.id_mouvement = m.id_mouvement
  JOIN import_receptions r ON r.numero = m.reference_document
  JOIN import_dossiers d ON EXISTS (
        SELECT 1 FROM import_reception_lignes rl
          JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
          JOIN import_factures f ON f.id_facture = l.id_facture
         WHERE rl.id_reception = r.id_reception AND f.id_dossier = d.id_dossier
           AND l.code_reference = lm.code_reference)
 WHERE m.code_type_mvt = 'RETOUR_FOURN'
   AND NOT EXISTS (SELECT 1 FROM mouvement c WHERE c.id_mouvement_contrepasse = m.id_mouvement)
 GROUP BY d.id_dossier, d.numero, r.id_reception, r.numero, m.id_mouvement, m.numero_mouvement,
          m.date_mouvement, lm.code_reference;
ALTER VIEW v_retours_import OWNER TO gestionfil;

COMMIT;
