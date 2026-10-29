-- =============================================================================
-- 2026-10-27l — La couverture cible de la fiche article (moteur de couverture v2)
-- =============================================================================
-- DÉCISION DU 27/10/2026 (soir), docs/A-DECIDER-of-supply-chain.md § 15.2 et
-- § 15.9 bis point 4 : chaque réglage de l'article a UN seul rôle.
--
--   * `couverture_min_mois` est renommée `couverture_cible_mois` : la couverture
--     souhaitée AU MOMENT DE LA RÉCEPTION, cible du MRP (C), obligatoire pour un
--     article soumis au MRP (actif, au besoin du plan en service ; sans cible :
--     signal CIBLE_NON_DEFINIE / C69, aucune proposition). Jamais une quantité.
--   * `stock_min_kg` reste : un garde-fou, un SIGNAL (« vérifier le plan », C68),
--     jamais une quantité de commande.
--   * `marge_securite_pct` de l'ARTICLE est supprimée (aucun rôle dans le moteur
--     v2). Celle de la QUALITÉ, défaut du plan de production, et sa copie dans
--     `plan_production` restent. Sur gestionfil_saisie (27/10/2026) les 125
--     références portaient toutes 20 % : la valeur part avec la colonne.
--   * La vue `v_stocks_minimums_a_revoir`, sa route
--     `/api/plan-achat/stocks-minimums` et son écran (SaisonMinimums, jamais
--     monté) sont retirés.
--
-- RELEVÉ DES LECTEURS (27/10/2026, copie de gestionfil_saisie, pg_depend +
-- pg_get_viewdef / prosrc) : en base, la seule vue v_stocks_minimums_a_revoir
-- (couverture_min_mois, stock_min_kg) ; aucune fonction, aucun déclencheur,
-- aucun contrôle. Dans le code : crud.rs (registre), bin/import.rs,
-- routes/consultation.rs (route retirée), routes/couverture.rs (moteur v2),
-- Catalogue.tsx, EtatsListes.tsx, e2e/saisie.spec.ts, le banc.
--
-- Le code du champ configurable suit la colonne : la ligne CATALOGUE /
-- couverture_min_mois devient couverture_cible_mois, avec les droits déjà posés
-- par rôle (modele_droit_champ) et par compte (droit_champ) ; la ligne
-- CATALOGUE / marge_securite_pct part avec ses droits (cascade). Celle du module
-- QUALITES reste.
--
-- Les colonnes nouvelles du moteur v2 sont déclarées (une colonne non déclarée
-- est MASQUÉE à l'écran) au niveau de `jours_couverture` du même module, rôle par
-- rôle et compte par compte (même mécanisme que 2026-10-27h) :
--   PLAN_ACHAT et STOCK : couverture_cible_j, ecart_cible_j, signaux ;
--   COCKPIT : nb_rupture_inevitable, nb_sous_cible, nb_cible_non_definie,
--             nb_sous_minimum, nb_retard_cible.
-- `nb_plan_non_couvert` (COCKPIT) reste en place (témoin de 2026-10-27e).
--
-- Aucun objet créé (une vue retirée, une colonne renommée, une supprimée) :
-- pas d'OWNER à poser. Exigée au démarrage (backend/src/db.rs). Rejouable.
-- Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. La vue des stocks minimums à revoir (elle lit couverture_min_mois).
DROP VIEW IF EXISTS v_stocks_minimums_a_revoir;

-- 2. couverture_min_mois → couverture_cible_mois (seulement si l'ancienne
--    existe et pas la nouvelle), contrainte CHECK renommée avec elle.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'reference'
                  AND column_name = 'couverture_min_mois')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'reference'
                          AND column_name = 'couverture_cible_mois') THEN
        ALTER TABLE reference RENAME COLUMN couverture_min_mois TO couverture_cible_mois;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = 'reference'::regclass
                  AND conname = 'reference_couverture_min_mois_check')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = 'reference'::regclass
                          AND conname = 'reference_couverture_cible_mois_check') THEN
        ALTER TABLE reference RENAME CONSTRAINT reference_couverture_min_mois_check
                                             TO reference_couverture_cible_mois_check;
    END IF;
END $$;

COMMENT ON COLUMN reference.couverture_cible_mois IS
    'Couverture cible (mois) : couverture souhaitée au moment de la réception ; cible MRP, obligatoire pour un article soumis au MRP ; jamais une quantité';
COMMENT ON COLUMN reference.stock_min_kg IS
    'Stock minimum : garde-fou, signal seulement, jamais une quantité de commande';

-- 3. La marge de sécurité de l'ARTICLE (celle de la qualité reste).
ALTER TABLE reference DROP COLUMN IF EXISTS marge_securite_pct;

-- 4. Le champ configurable suit la colonne : nouveau code, mêmes droits.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT module, 'couverture_cible_mois', 'Couverture cible (mois)', niveau_defaut, sensible, ordre
  FROM champ_configurable
 WHERE module = 'CATALOGUE' AND champ = 'couverture_min_mois'
ON CONFLICT (module, champ) DO NOTHING;
-- Base sans l'ancienne ligne : la déclarer quand même (une colonne non déclarée est masquée).
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
VALUES ('CATALOGUE', 'couverture_cible_mois', 'Couverture cible (mois)', 'LECTURE', 0, 180)
ON CONFLICT (module, champ) DO NOTHING;
UPDATE champ_configurable SET libelle = 'Couverture cible (mois)'
 WHERE module = 'CATALOGUE' AND champ = 'couverture_cible_mois'
   AND libelle IS DISTINCT FROM 'Couverture cible (mois)';
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT code_role_user, module, 'couverture_cible_mois', niveau
  FROM modele_droit_champ
 WHERE module = 'CATALOGUE' AND champ = 'couverture_min_mois'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT id_utilisateur, module, 'couverture_cible_mois', niveau
  FROM droit_champ
 WHERE module = 'CATALOGUE' AND champ = 'couverture_min_mois'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;
-- L'ancien code et la marge de l'article : leurs droits partent par cascade.
DELETE FROM champ_configurable
 WHERE module = 'CATALOGUE' AND champ IN ('couverture_min_mois', 'marge_securite_pct');

-- 5. Les colonnes du moteur v2, au niveau de jours_couverture du même module.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT m.module, c.champ, c.libelle,
       COALESCE(j.niveau_defaut, 'LECTURE'), COALESCE(j.sensible, 0), COALESCE(j.ordre, 990)
  FROM (VALUES ('PLAN_ACHAT'), ('STOCK')) m(module)
 CROSS JOIN (VALUES ('couverture_cible_j', 'Cible (j)'),
                    ('ecart_cible_j',      'Écart à la cible (j)'),
                    ('signaux',            'Signaux')
            ) c(champ, libelle)
  LEFT JOIN champ_configurable j ON j.module = m.module AND j.champ = 'jours_couverture'
ON CONFLICT (module, champ) DO NOTHING;
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'COCKPIT', c.champ, c.libelle,
       COALESCE(j.niveau_defaut, 'LECTURE'), COALESCE(j.sensible, 0), COALESCE(j.ordre, 990)
  FROM (VALUES ('nb_rupture_inevitable', 'Références en rupture inévitable'),
               ('nb_sous_cible',         'Références sous la cible'),
               ('nb_cible_non_definie',  'Références sans cible (MRP)'),
               ('nb_sous_minimum',       'Références sous le stock minimum'),
               ('nb_retard_cible',       'Références en retard sur la cible')
       ) c(champ, libelle)
  LEFT JOIN champ_configurable j ON j.module = 'COCKPIT' AND j.champ = 'jours_couverture'
ON CONFLICT (module, champ) DO NOTHING;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, m.module, c.champ, m.niveau
  FROM modele_droit_champ m
  JOIN (VALUES ('PLAN_ACHAT', 'couverture_cible_j'), ('PLAN_ACHAT', 'ecart_cible_j'), ('PLAN_ACHAT', 'signaux'),
               ('STOCK', 'couverture_cible_j'), ('STOCK', 'ecart_cible_j'), ('STOCK', 'signaux'),
               ('COCKPIT', 'nb_rupture_inevitable'), ('COCKPIT', 'nb_sous_cible'),
               ('COCKPIT', 'nb_cible_non_definie'), ('COCKPIT', 'nb_sous_minimum'),
               ('COCKPIT', 'nb_retard_cible')
       ) c(module, champ) ON c.module = m.module
 WHERE m.champ = 'jours_couverture'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, d.module, c.champ, d.niveau
  FROM droit_champ d
  JOIN (VALUES ('PLAN_ACHAT', 'couverture_cible_j'), ('PLAN_ACHAT', 'ecart_cible_j'), ('PLAN_ACHAT', 'signaux'),
               ('STOCK', 'couverture_cible_j'), ('STOCK', 'ecart_cible_j'), ('STOCK', 'signaux'),
               ('COCKPIT', 'nb_rupture_inevitable'), ('COCKPIT', 'nb_sous_cible'),
               ('COCKPIT', 'nb_cible_non_definie'), ('COCKPIT', 'nb_sous_minimum'),
               ('COCKPIT', 'nb_retard_cible')
       ) c(module, champ) ON c.module = d.module
 WHERE d.champ = 'jours_couverture'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- 6. Contrôle de l'état attendu.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'reference'
                      AND column_name = 'couverture_cible_mois') THEN
        RAISE EXCEPTION '2026-10-27l : reference.couverture_cible_mois absente.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'reference'
                  AND column_name IN ('couverture_min_mois', 'marge_securite_pct')) THEN
        RAISE EXCEPTION '2026-10-27l : reference porte encore couverture_min_mois ou marge_securite_pct.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'reference'
                      AND column_name = 'stock_min_kg') THEN
        RAISE EXCEPTION '2026-10-27l : reference.stock_min_kg doit rester.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'qualite'
                      AND column_name = 'marge_securite_pct') THEN
        RAISE EXCEPTION '2026-10-27l : la marge de sécurité de la QUALITÉ doit rester.';
    END IF;
    IF to_regclass('public.v_stocks_minimums_a_revoir') IS NOT NULL THEN
        RAISE EXCEPTION '2026-10-27l : v_stocks_minimums_a_revoir doit être retirée.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM champ_configurable
                    WHERE module = 'CATALOGUE' AND champ = 'couverture_cible_mois'
                      AND libelle = 'Couverture cible (mois)')
       OR EXISTS (SELECT 1 FROM champ_configurable
                   WHERE module = 'CATALOGUE' AND champ IN ('couverture_min_mois', 'marge_securite_pct'))
       OR NOT EXISTS (SELECT 1 FROM champ_configurable
                       WHERE module = 'QUALITES' AND champ = 'marge_securite_pct') THEN
        RAISE EXCEPTION '2026-10-27l : champs configurables du catalogue non mis à jour.';
    END IF;
    IF (SELECT count(*) FROM champ_configurable
         WHERE (module, champ) IN (('PLAN_ACHAT', 'couverture_cible_j'), ('PLAN_ACHAT', 'ecart_cible_j'),
                                   ('PLAN_ACHAT', 'signaux'), ('STOCK', 'couverture_cible_j'),
                                   ('STOCK', 'ecart_cible_j'), ('STOCK', 'signaux'),
                                   ('COCKPIT', 'nb_rupture_inevitable'), ('COCKPIT', 'nb_sous_cible'),
                                   ('COCKPIT', 'nb_cible_non_definie'), ('COCKPIT', 'nb_sous_minimum'),
                                   ('COCKPIT', 'nb_retard_cible'), ('COCKPIT', 'nb_plan_non_couvert'))) <> 12 THEN
        RAISE EXCEPTION '2026-10-27l : colonnes du moteur v2 non déclarées (ou nb_plan_non_couvert retiré).';
    END IF;
    -- Chaque rôle et chaque compte qui a un niveau sur jours_couverture l'a sur les colonnes v2.
    IF EXISTS (SELECT 1 FROM modele_droit_champ m
                 JOIN champ_configurable c ON c.module = m.module
                  AND c.champ IN ('couverture_cible_j', 'ecart_cible_j', 'signaux', 'nb_rupture_inevitable',
                                  'nb_sous_cible', 'nb_cible_non_definie', 'nb_sous_minimum', 'nb_retard_cible')
                WHERE m.champ = 'jours_couverture'
                  AND NOT EXISTS (SELECT 1 FROM modele_droit_champ n
                                   WHERE n.code_role_user = m.code_role_user AND n.module = c.module
                                     AND n.champ = c.champ))
       OR EXISTS (SELECT 1 FROM droit_champ d
                    JOIN champ_configurable c ON c.module = d.module
                     AND c.champ IN ('couverture_cible_j', 'ecart_cible_j', 'signaux', 'nb_rupture_inevitable',
                                     'nb_sous_cible', 'nb_cible_non_definie', 'nb_sous_minimum', 'nb_retard_cible')
                   WHERE d.champ = 'jours_couverture'
                     AND NOT EXISTS (SELECT 1 FROM droit_champ e
                                      WHERE e.id_utilisateur = d.id_utilisateur AND e.module = c.module
                                        AND e.champ = c.champ)) THEN
        RAISE EXCEPTION '2026-10-27l : droits des colonnes du moteur v2 incomplets.';
    END IF;
END $$;

COMMIT;
