-- =============================================================================
-- 2026-10-30a — Le nouveau Stock projeté (§ 16, décisions du 30/10/2026)
-- =============================================================================
-- Le Stock projeté dit COMBIEN COMMANDER, sans chronologie (`domain/projete.rs`).
-- Il a trois onglets : Approvisionnement (19 colonnes), Risques, Sourcing.
--
-- 1. LE CV EST CONSERVÉ : `reference.coef_variation_xyz`, le coefficient de
--    variation de la consommation sur les 12 mois pleins, écrit par la
--    classification (`domain/classification.rs`) à côté de la classe XYZ qu'il
--    fixe. Le binaire l'écrit : migration EXIGÉE au démarrage.
--
-- 2. LES COLONNES DES TROIS ONGLETS, déclarées au module STOCK (une colonne non
--    déclarée dans `champ_configurable` est MASQUÉE à l'écran). Les droits sont
--    repris de `jours_couverture` du même module, rôle par rôle et compte par
--    compte (même mécanisme que 2026-10-27h, 27l, 27m). Les montants et le
--    pourcentage cumulé sont déjà déclarés (sensibles) : ils ne bougent pas.
--
-- Aucun objet créé : pas d'OWNER à poser. Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE reference ADD COLUMN IF NOT EXISTS coef_variation_xyz numeric(10,4)
    CHECK (coef_variation_xyz IS NULL OR coef_variation_xyz >= 0);
COMMENT ON COLUMN reference.coef_variation_xyz IS
    'Coefficient de variation de la consommation sur les 12 mois pleins (classe XYZ), écrit par la classification';

CREATE TEMP TABLE _colonnes_projete (champ text PRIMARY KEY, libelle text NOT NULL) ON COMMIT DROP;
INSERT INTO _colonnes_projete VALUES
    ('besoin_delai_kg',        'Besoin pendant le délai (kg)'),
    ('avant_le',               'Avant le'),
    ('manque_kg',              'Manque avant arrivage (kg)'),
    ('coef_variation_xyz',     'Coefficient de variation'),
    ('nb_sources',             'Nombre de sources'),
    ('risque_source',          'Mono / multi-source'),
    ('tier',                   'Palier de montant'),
    ('code_groupe_equiv',      'Groupe d''équivalence'),
    ('nb_substituts',          'Substituts'),
    ('substituts_stock_kg',    'Substituts en stock (kg)'),
    ('substitut_couverture_j', 'Couverture du substitut'),
    ('dormant',                'Dormant');

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'STOCK', c.champ, c.libelle,
       COALESCE(j.niveau_defaut, 'LECTURE'), COALESCE(j.sensible, 0), COALESCE(j.ordre, 990)
  FROM _colonnes_projete c
  LEFT JOIN champ_configurable j ON j.module = 'STOCK' AND j.champ = 'jours_couverture'
ON CONFLICT (module, champ) DO NOTHING;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, m.module, c.champ, m.niveau
  FROM modele_droit_champ m
 CROSS JOIN _colonnes_projete c
 WHERE m.module = 'STOCK' AND m.champ = 'jours_couverture'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, d.module, c.champ, d.niveau
  FROM droit_champ d
 CROSS JOIN _colonnes_projete c
 WHERE d.module = 'STOCK' AND d.champ = 'jours_couverture'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'reference'
                      AND column_name = 'coef_variation_xyz') THEN
        RAISE EXCEPTION '2026-10-30a : reference.coef_variation_xyz absente.';
    END IF;
    IF (SELECT count(*) FROM champ_configurable c JOIN _colonnes_projete p ON p.champ = c.champ
         WHERE c.module = 'STOCK') <> (SELECT count(*) FROM _colonnes_projete) THEN
        RAISE EXCEPTION '2026-10-30a : colonnes du Stock projeté non déclarées.';
    END IF;
END $$;

COMMIT;
