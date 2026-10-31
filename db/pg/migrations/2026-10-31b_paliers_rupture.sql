-- =============================================================================
-- 2026-10-31b — Stock projeté : les paliers de rupture (31/10/2026)
-- =============================================================================
-- Décision du 31/10/2026 : les seuils globaux ÉCHELONNENT les ruptures. Une
-- rupture dans 85 jours n'appelle pas la même réaction qu'une rupture dans 25
-- jours ; c'est une autre question que l'ABC (qui ne règle que la sécurité) et
-- que l'état du stock projeté (qui dit combien commander).
--
-- Mesure : les jours jusqu'au PREMIER jour sans fil, arrivages comptés
-- (`domain/projete.rs`, `palier`). Paliers :
--   RUPTURE    sans fil dès aujourd'hui ;
--   IMMINENTE  moins de P_SeuilImminent (30 j, NOUVEAU) ;
--   CRITIQUE   moins de P_SeuilCritique (60 j, existant) ;
--   ATTENTION  moins de P_SeuilAlerte (90 j, existant).
-- Chaque ligne dit aussi le palier suivant et le jour où elle y passe, et le
-- premier trou avant un camion connu (« à sec avant le camion », bandeau du
-- plan d'achat). L'onglet Emplacements ajoute « en route après le délai ».
--
-- Les colonnes sont déclarées au module STOCK (droits repris de
-- `jours_couverture`, comme 2026-10-30a et 31a). Aucun objet créé. Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description,
                       categorie, modifiable_par, verrouille) VALUES
 ('P_SeuilImminent', 'Seuil de rupture imminente (statut IMMINENTE)', '30', 'ENTIER', 'jours',
  'Stock projeté : une référence dont le premier jour sans fil tombe dans moins de ce nombre de jours est en rupture IMMINENTE. Inférieur au seuil critique.',
  'STOCK', 'DIRECTION', 0)
ON CONFLICT (code_parametre) DO NOTHING;

CREATE TEMP TABLE _colonnes_paliers (champ text PRIMARY KEY, libelle text NOT NULL) ON COMMIT DROP;
INSERT INTO _colonnes_paliers VALUES
    ('rupture_j',               'Rupture dans (jours)'),
    ('rupture_le',              'Première rupture le'),
    ('palier_rupture',          'Palier de rupture'),
    ('palier_suivant',          'Palier suivant'),
    ('date_palier_suivant',     'Passe au palier suivant le'),
    ('a_sec',                   'À sec avant le camion'),
    ('en_route_apres_delai_kg', 'En route après le délai (kg)');

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'STOCK', c.champ, c.libelle,
       COALESCE(j.niveau_defaut, 'LECTURE'), COALESCE(j.sensible, 0), COALESCE(j.ordre, 990)
  FROM _colonnes_paliers c
  LEFT JOIN champ_configurable j ON j.module = 'STOCK' AND j.champ = 'jours_couverture'
ON CONFLICT (module, champ) DO NOTHING;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, m.module, c.champ, m.niveau
  FROM modele_droit_champ m
 CROSS JOIN _colonnes_paliers c
 WHERE m.module = 'STOCK' AND m.champ = 'jours_couverture'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, d.module, c.champ, d.niveau
  FROM droit_champ d
 CROSS JOIN _colonnes_paliers c
 WHERE d.module = 'STOCK' AND d.champ = 'jours_couverture'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM parametre WHERE code_parametre = 'P_SeuilImminent') THEN
        RAISE EXCEPTION '2026-10-31b : P_SeuilImminent absent.';
    END IF;
    IF (SELECT count(*) FROM champ_configurable c JOIN _colonnes_paliers p ON p.champ = c.champ
         WHERE c.module = 'STOCK') <> (SELECT count(*) FROM _colonnes_paliers) THEN
        RAISE EXCEPTION '2026-10-31b : colonnes des paliers de rupture non déclarées.';
    END IF;
END $$;

COMMIT;
