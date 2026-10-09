-- =============================================================================
-- 2026-10-09za — La colonne « Voir le calcul » du plan d'achat, declaree
-- (audit v5, F16)
-- =============================================================================
-- Le tableau filtre ses colonnes par la grille des droits, et un champ non
-- declare vaut MASQUE (le meme oubli avait cache la case de selection le 18/09).
-- Le bouton qui deplie le calcul d'une proposition prend les droits de la case
-- de selection, role par role et compte par compte. Rejouable, sans ecraser un
-- reglage fait a la main.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
VALUES ('PLAN_ACHAT', 'calcul', 'Detail du calcul', 'LECTURE', 0, 4195)
ON CONFLICT (module, champ) DO NOTHING;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'PLAN_ACHAT', 'calcul', CASE WHEN m.niveau = 'MASQUE' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM modele_droit_champ m WHERE m.module = 'PLAN_ACHAT' AND m.champ = 'selection'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, 'PLAN_ACHAT', 'calcul', CASE WHEN d.niveau = 'MASQUE' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM droit_champ d WHERE d.module = 'PLAN_ACHAT' AND d.champ = 'selection'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

COMMIT;
