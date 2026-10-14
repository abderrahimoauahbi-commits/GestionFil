-- =============================================================================
-- 2026-10-14 — Plan d'achat : stocker le complément de palette
-- =============================================================================
-- Le complément de palette (les kilos ajoutés pour fermer une palette pleine)
-- n'était pas stocké sur la proposition : la liste du plan d'achat allait le
-- rechercher dans la vue `v_plan_achat` à CHAQUE ouverture — c'est-à-dire
-- recalculer tout le MRP juste pour cette colonne. On le fige donc au moment de
-- la génération, comme `palettes_a_commander`, et la liste n'a plus besoin de la
-- vue (ouverture bien plus rapide).
--
-- Les propositions ouvertes déjà en base sont remplies une fois ici, pour ne pas
-- laisser un trou le temps de la prochaine régénération.
-- Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE plan_achat
  ADD COLUMN IF NOT EXISTS complement_palette_kg numeric(18,4);

COMMENT ON COLUMN plan_achat.complement_palette_kg IS
  'Kilos ajoutés pour fermer la palette pleine (logistique, pas production). '
  'Figé à la génération depuis v_plan_achat ; la liste ne recalcule plus le MRP.';

-- Remplir les propositions ouvertes une seule fois (un passage du calcul).
UPDATE plan_achat pa
   SET complement_palette_kg = ROUND(v.complement_palette_kg, 4)
  FROM v_plan_achat v
 WHERE v.code_reference = pa.code_reference
   AND pa.complement_palette_kg IS NULL
   AND pa.statut IN ('PROPOSE', 'EN_REVISION', 'VALIDE');

COMMIT;
