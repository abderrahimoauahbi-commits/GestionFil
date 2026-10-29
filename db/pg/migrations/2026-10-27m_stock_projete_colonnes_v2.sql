-- =============================================================================
-- 2026-10-27m — Les colonnes du Stock projeté, moteur de couverture v2
-- =============================================================================
-- DÉCISION DU 27/10/2026 (soir) : l'onglet « Stock projeté » de /stock porte
-- 21 colonnes définies avec l'utilisateur. Toutes viennent du moteur de
-- couverture (`routes/couverture.rs`, `ligne()`) ; deux n'étaient pas encore
-- déclarées au module STOCK :
--
--   besoin_jusqu_reception_kg  le plan daté P(aujourd'hui, D), D la réception
--                              proposée (la 1re proposition du moteur) ;
--   palettes_equivalentes      la quantité à commander en palettes, quand le
--                              conditionnement de l'article est connu.
--
-- Les autres (couverture_cible_j, ecart_cible_j, signaux) sont déclarées par
-- 2026-10-27l. Une colonne non déclarée dans `champ_configurable` est MASQUÉE à
-- l'écran. Les droits sont repris de `jours_couverture` du même module, rôle
-- par rôle et compte par compte (même mécanisme que 2026-10-27h et 27l).
--
-- Aucun objet créé : pas d'OWNER à poser. Le serveur n'en dépend pas (non
-- exigée au démarrage). Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'STOCK', c.champ, c.libelle,
       COALESCE(j.niveau_defaut, 'LECTURE'), COALESCE(j.sensible, 0), COALESCE(j.ordre, 990)
  FROM (VALUES ('besoin_jusqu_reception_kg', 'Besoin jusqu''à réception (kg)'),
               ('palettes_equivalentes',     'Unité / palette')
       ) c(champ, libelle)
  LEFT JOIN champ_configurable j ON j.module = 'STOCK' AND j.champ = 'jours_couverture'
ON CONFLICT (module, champ) DO NOTHING;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, m.module, c.champ, m.niveau
  FROM modele_droit_champ m
 CROSS JOIN (VALUES ('besoin_jusqu_reception_kg'), ('palettes_equivalentes')) c(champ)
 WHERE m.module = 'STOCK' AND m.champ = 'jours_couverture'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, d.module, c.champ, d.niveau
  FROM droit_champ d
 CROSS JOIN (VALUES ('besoin_jusqu_reception_kg'), ('palettes_equivalentes')) c(champ)
 WHERE d.module = 'STOCK' AND d.champ = 'jours_couverture'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

DO $$
BEGIN
    IF (SELECT count(*) FROM champ_configurable
         WHERE module = 'STOCK' AND champ IN ('besoin_jusqu_reception_kg', 'palettes_equivalentes')) <> 2 THEN
        RAISE EXCEPTION '2026-10-27m : colonnes du Stock projeté non déclarées.';
    END IF;
END $$;

COMMIT;
