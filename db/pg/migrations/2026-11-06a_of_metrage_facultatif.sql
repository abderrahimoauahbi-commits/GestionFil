-- =============================================================================
-- 2026-11-06a — L'OF accepte un métrage vide (06/11/2026)
-- =============================================================================
-- Décision du 06/11/2026 : « changer la règle et accepter le métrage vide ».
-- Occasion : la reprise de gestion-mp-pro, dont les cinq OF n'ont aucun m².
--
-- Un métrage vide veut dire « inconnu », jamais zéro : le prévu de l'OF
-- (métrage × recette) reste alors inconnu dans v_of_consommation / v_of_bilan
-- (les sommes ignorent la valeur vide). Un métrage SAISI reste positif.
--
-- Aucun objet créé. Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE ordre_fabrication ALTER COLUMN metrage_m2 DROP NOT NULL;
ALTER TABLE ordre_fabrication DROP CONSTRAINT IF EXISTS ordre_fabrication_metrage_m2_check;
ALTER TABLE ordre_fabrication ADD CONSTRAINT ordre_fabrication_metrage_m2_check
    CHECK (metrage_m2 IS NULL OR metrage_m2 > 0);

DO $$
BEGIN
    IF (SELECT is_nullable FROM information_schema.columns
         WHERE table_name = 'ordre_fabrication' AND column_name = 'metrage_m2') <> 'YES' THEN
        RAISE EXCEPTION '2026-11-06a : metrage_m2 toujours obligatoire.';
    END IF;
END $$;

COMMIT;
