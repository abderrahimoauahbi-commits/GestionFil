-- =============================================================================
-- 2026-10-27c — « Commander » part de la proposition du moteur de couverture
-- =============================================================================
-- Le basculement du 27/10/2026 (étape 4 du plan validé le 26/10) :
--
--   * la génération du plan d'achat (`domain/plan_achat.rs`, `generer`) prend la
--     PREMIÈRE proposition du moteur de couverture de chaque référence :
--     quantité proposée, D comme date de besoin (puis date de livraison prévue de
--     la ligne de bon), date limite de commande, urgence déduite de cette date
--     limite. Prix, devise, unité, fournisseur : inchangés (mêmes formules que
--     v_plan_achat). La date limite se garde sur la proposition : nouvelle
--     colonne `plan_achat.date_limite_commande` (déjà déclarée au module
--     PLAN_ACHAT par 2026-10-27a, même nom) ;
--   * l'onglet « À commander » liste aussi une référence sans plan ni stock qui a
--     un arrivage, même hors couverture ; les kilos des bons NON VALIDÉS et des
--     bons livrés APRÈS L'HORIZON s'y lisent à part : deux champs déclarés
--     (LECTURE, non sensibles : des kilos).
--
-- Une proposition générée avant cette migration garde une date limite vide.
-- Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE plan_achat ADD COLUMN IF NOT EXISTS date_limite_commande date;
COMMENT ON COLUMN plan_achat.date_limite_commande IS
    'Date limite de commande de la proposition du moteur de couverture : D moins le délai fournisseur (27/10/2026).';

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'PLAN_ACHAT', c.champ, c.libelle, 'LECTURE', 0, 981
  FROM (VALUES ('non_valide_kg',    'Bons non validés, non comptés (kg)'),
               ('apres_horizon_kg', 'Livrés après l''horizon, non comptés (kg)')
       ) c(champ, libelle)
ON CONFLICT DO NOTHING;

-- Témoin
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'plan_achat'
                      AND column_name = 'date_limite_commande' AND data_type = 'date')
       OR (SELECT count(*) FROM champ_configurable
            WHERE module = 'PLAN_ACHAT' AND champ IN ('non_valide_kg', 'apres_horizon_kg')) <> 2 THEN
        RAISE EXCEPTION '2026-10-27c : migration incomplete';
    END IF;
END $$;

COMMIT;
