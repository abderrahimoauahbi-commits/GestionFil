-- =============================================================================
-- 2026-10-09g — Avoirs types et retours fournisseur dans la cloture (regle 3,
-- arbitrage du 09/10/2026)
-- =============================================================================
-- Le retour fournisseur sort au CMUP ; la cloture et l'avoir l'ignoraient et
-- retiraient une seconde fois la valeur rendue (1 000 kg a 20, 200 rendus : le
-- stock restant sous-evalue de 3 200 MAD). Desormais :
--   * FACTURE NETTE (sur les kilos gardes) : elle se compare a la valeur
--     provisoire DIMINUEE des retours, qui sont alors soldes (FACTURE_NETTE) ;
--   * FACTURE BRUTE puis AVOIR POUR RETOUR : l'avoir se rapproche des retours,
--     sans effet sur le CMUP ; une difference de prix va en ecart de prix ;
--   * AVOIR DE PRIX : il ajuste le CMUP du stock restant (comportement d'avant).
-- Le journal note quels retours sont soldes (nature RETOUR, le mouvement de
-- retour) : un retour ne se solde qu'une fois.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE reception_ajustements_cmup ADD COLUMN IF NOT EXISTS id_mouvement_retour text
    REFERENCES mouvement(id_mouvement);
CREATE INDEX IF NOT EXISTS ix_fk_reception_ajustements_cmup_retour
    ON reception_ajustements_cmup(id_mouvement_retour);
COMMENT ON COLUMN reception_ajustements_cmup.id_mouvement_retour IS
  'Nature RETOUR : le retour fournisseur solde par une facture nette ou un avoir pour retour.';

ALTER TABLE reception_ajustements_cmup DROP CONSTRAINT IF EXISTS reception_ajustements_cmup_nature_check;
ALTER TABLE reception_ajustements_cmup ADD CONSTRAINT reception_ajustements_cmup_nature_check
    CHECK (nature = ANY (ARRAY['STOCK', 'ECART_PRIX', 'RETOUR']));
ALTER TABLE reception_ajustements_cmup DROP CONSTRAINT IF EXISTS reception_ajustements_cmup_check;
ALTER TABLE reception_ajustements_cmup ADD CONSTRAINT reception_ajustements_cmup_check
    CHECK ((nature = 'STOCK' AND code_magasin IS NOT NULL AND cmup_apres IS NOT NULL)
        OR (nature = 'ECART_PRIX' AND code_magasin IS NULL)
        OR (nature = 'RETOUR' AND code_magasin IS NULL AND id_mouvement_retour IS NOT NULL));
ALTER TABLE reception_ajustements_cmup DROP CONSTRAINT IF EXISTS ck_rec_ajust_origine;
-- 'FRAIS' ajoute le 14/10/2026 (ADR-003 phase C, migration 2026-10-14c) :
-- les frais d'approche d'un arrivage vont au CUMP avec leur propre origine.
-- IL EST ICI, et pas seulement dans la migration qui l'introduit, parce que
-- cette migration-ci se REJOUE : rejouee sur une base qui porte deja des
-- ajustements 'FRAIS', elle y reposait l'ancienne liste et la contrainte
-- echouait sur ses propres lignes. Empreinte d'origine declaree dans
-- EMPREINTES_REMPLACEES (migrer.py).
ALTER TABLE reception_ajustements_cmup ADD CONSTRAINT ck_rec_ajust_origine
    CHECK (origine = ANY (ARRAY['CLOTURE', 'AVOIR', 'COMPLEMENT', 'AVOIR_RETOUR',
                                'FACTURE_NETTE', 'FRAIS'])
           AND (origine = 'CLOTURE' OR length(btrim(COALESCE(motif, ''))) >= 5));

-- Les retours d'une reception et ce qui les solde.
CREATE OR REPLACE VIEW v_retours_reception AS
SELECT r.id_reception, r.numero_reception, m.id_mouvement, m.numero_mouvement, m.date_mouvement::text AS date_mouvement,
       lm.code_reference, round(sum(lm.quantite_kg), 4) AS kg,
       EXISTS (SELECT 1 FROM reception_ajustements_cmup a
                WHERE a.nature = 'RETOUR' AND a.id_mouvement_retour = m.id_mouvement) AS solde
  FROM reception r
  JOIN mouvement m ON m.reference_document = r.numero_reception AND m.code_type_mvt = 'RETOUR_FOURN'
  JOIN ligne_mouvement lm ON lm.id_mouvement = m.id_mouvement
 WHERE NOT EXISTS (SELECT 1 FROM mouvement c WHERE c.id_mouvement_contrepasse = m.id_mouvement)
 GROUP BY r.id_reception, r.numero_reception, m.id_mouvement, m.numero_mouvement, m.date_mouvement, lm.code_reference;
ALTER VIEW v_retours_reception OWNER TO gestionfil;

COMMIT;
