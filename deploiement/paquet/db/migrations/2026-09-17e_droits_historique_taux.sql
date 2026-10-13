-- =============================================================================
-- MIGRATION 2026-09-17e — L'HISTORIQUE DES TAUX ETAIT INVISIBLE
-- -----------------------------------------------------------------------------
-- Configuration > Devises et taux > « voir les taux » affichait, pour TOUS les
-- profils : « Aucune colonne visible — Vos droits masquent tous les champs de
-- cet ecran. » Les taux etaient bien en base (USD 9,2704 au 15/09, EUR 10,85 au
-- 17/09, saisis le 17) ; seul l'ecran les cachait.
--
-- LA CAUSE : le tableau passe chaque colonne par la grille de droits du module
-- PARAMETRES, et un champ NON DECLARE y vaut MASQUE. `taux`, `date_debut` et
-- `date_fin` n'avaient jamais ete declares.
--
-- En LECTURE : l'historique ne se modifie pas. Un nouveau taux passe par sa
-- propre route, qui exige le droit d'ecriture sur le module.
--
-- Rejouable : ON CONFLICT partout.
-- =============================================================================

BEGIN;

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('PARAMETRES', 'taux',       'Taux de change',     'LECTURE', 0, 2110),
 ('PARAMETRES', 'date_debut', 'En vigueur depuis',  'LECTURE', 0, 2120),
 ('PARAMETRES', 'date_fin',   'En vigueur jusqu''au', 'LECTURE', 0, 2130)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

-- LES TROIS COUPLES SE NOMMENT : une distribution par plage de `ordre` pourrait
-- rendre un droit que quelqu'un a deliberement retire.
CREATE TEMP TABLE champs_neufs (module text, champ text) ON COMMIT DROP;
INSERT INTO champs_neufs VALUES
 ('PARAMETRES', 'taux'), ('PARAMETRES', 'date_debut'), ('PARAMETRES', 'date_fin');

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE WHEN EXISTS (SELECT 1 FROM permission p
                          WHERE p.code_role_user = r.code_role_user
                            AND p.module = c.module AND p.action IN ('LIRE', 'ECRIRE'))
            THEN c.niveau_defaut
            ELSE 'MASQUE' END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
  JOIN champs_neufs n ON n.module = c.module AND n.champ = c.champ
 WHERE r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champs_neufs n ON n.module = m.module AND n.champ = m.champ
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

COMMIT;
