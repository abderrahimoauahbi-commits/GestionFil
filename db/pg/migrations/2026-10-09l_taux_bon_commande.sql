-- =============================================================================
-- 2026-10-09l — Le taux engage d'un bon de commande, justifie (regle 10,
-- arbitrage du 09/10/2026)
-- =============================================================================
-- Arbitrage : le taux est propose au cours du jour de la VALIDATION, modifiable
-- avec un motif (alerte au-dela de 3 % du cours Bank Al-Maghrib) ; le plafond
-- de validation se juge sur le plus haut des deux taux ; une fois valide, le
-- taux est fige avec sa justification : la date du cours, sa source (reference
-- de l'ERP ou saisi a la validation) et le motif d'une saisie. Le bon imprime
-- porte la date de validation comme date de commande.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE bon_commande ADD COLUMN IF NOT EXISTS date_cours_engage text;
ALTER TABLE bon_commande ADD COLUMN IF NOT EXISTS source_taux_engage text;
ALTER TABLE bon_commande ADD COLUMN IF NOT EXISTS motif_taux_engage text;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_bc_source_taux_engage') THEN
        ALTER TABLE bon_commande ADD CONSTRAINT ck_bc_source_taux_engage
            CHECK (source_taux_engage IS NULL OR source_taux_engage IN ('REFERENCE', 'SAISI'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_bc_motif_taux_saisi') THEN
        ALTER TABLE bon_commande ADD CONSTRAINT ck_bc_motif_taux_saisi
            CHECK (source_taux_engage IS DISTINCT FROM 'SAISI' OR length(btrim(COALESCE(motif_taux_engage, ''))) >= 5);
    END IF;
END $$;
COMMENT ON COLUMN bon_commande.date_cours_engage IS
  'Le jour du cours qui justifie le taux engage (regle 10) : celui de la reference, ou le jour de la saisie.';

-- Le passe : les bons valides l'ont ete au taux de reference du jour de validation.
UPDATE bon_commande
   SET source_taux_engage = 'REFERENCE', date_cours_engage = substr(COALESCE(date_taux_engage, date_validation), 1, 10)
 WHERE source_taux_engage IS NULL AND date_validation IS NOT NULL AND code_devise <> 'MAD';

COMMIT;
