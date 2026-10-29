-- =============================================================================
-- seed_006 — Ce que les regles du 08/10/2026 ont pose par migration, et dont
-- une base chargee par charger.py a besoin (audit v4, action 7)
-- =============================================================================
-- Les migrations 2026-10-08_regles_p1.sql et 2026-10-08b_audit_v4.sql restent
-- la voie des bases existantes. Ce fichier donne le MEME etat a une base neuve :
-- sans lui, elle demarrait sans les parametres des seuils machine ni du taux,
-- sans droit sur le module LOTS (seed_003 rase les permissions) et avec les
-- montants du tableau de bord et des receptions visibles de tous.
--
-- Joue APRES seed_003 (roles 2026) et seed_004/005 (champs) : il derive ses
-- droits des champs de reference que ceux-ci posent. Rejouable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PARAMETRES
-- -----------------------------------------------------------------------------
-- P_MrpInclureStockMachine n'est plus pose (27/10/2026, migration
-- 2026-10-27e_source_unique_moteur.sql) : parametre sans lecteur, le fil sur
-- machine compte toujours au dernier constat (moteur de couverture).
INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description, categorie, modifiable_par) VALUES
  ('P_AncienneteTauxJours', 'Anciennete maximale du taux de reference', '7', 'ENTIER', 'jours',
   'Au-dela, un bon de commande en devise ne se valide pas tant que le taux du jour n''est pas saisi. Le taux de chaque facture d''import reste celui de sa facture.', 'ACHAT', 'DIRECTION'),
  ('P_MachineEcartVertKg',   'Ecart machine : vert jusqu''a (kg)',   '10', 'DECIMAL', 'kg', 'Le seuil vert est le plus grand de ce poids et du pourcentage vert de la ligne.', 'MACHINE', 'DIRECTION'),
  ('P_MachineEcartVertPct',  'Ecart machine : vert jusqu''a (%)',    '1',  'DECIMAL', '%',  'Pourcentage du poids de la ligne.', 'MACHINE', 'DIRECTION'),
  ('P_MachineEcartRougeKg',  'Ecart machine : rouge au-dela de (kg)', '50', 'DECIMAL', 'kg', 'Le seuil rouge est le plus grand de ce poids et du pourcentage rouge de la ligne.', 'MACHINE', 'DIRECTION'),
  ('P_MachineEcartRougePct', 'Ecart machine : rouge au-dela de (%)',  '5',  'DECIMAL', '%',  'Pourcentage du poids de la ligne.', 'MACHINE', 'DIRECTION'),
  ('P_DechetSeuilValiderKg', 'Dechet : seuil de validation (kg)', '50', 'DECIMAL', 'kg',
   'Au-dela, un dechet saisi a la main demande le droit de valider l''inventaire, comme un ajustement negatif.', 'STOCK', 'DIRECTION'),
  -- 22/10/2026 (migration 2026-10-22b) : le signal C61.
  ('P_EcartOfPct', 'OF : ecart reel / prevu signale', '15', 'DECIMAL', '%',
   'Un OF cloture dont la consommation reelle s''ecarte du prevu (metrage x recette) de plus de ce pourcentage est signale (C61). Signal seulement.', 'PROD', 'DIRECTION'),
  -- 23/10/2026 (migration 2026-10-24b) : la proposition de l'inventaire tournant, par classe ABC.
  ('P_ComptageTournantA', 'Inventaire tournant : classe A comptee tous les', '30', 'ENTIER', 'jours',
   'Une reference de classe A en stock est proposee au tournant si elle n''a pas ete comptee dans ce magasin depuis ce nombre de jours (ou jamais).', 'STOCK', 'DIRECTION'),
  ('P_ComptageTournantB', 'Inventaire tournant : classe B comptee tous les', '90', 'ENTIER', 'jours',
   'Une reference de classe B en stock est proposee au tournant si elle n''a pas ete comptee dans ce magasin depuis ce nombre de jours (ou jamais).', 'STOCK', 'DIRECTION'),
  ('P_ComptageTournantC', 'Inventaire tournant : classe C comptee tous les', '180', 'ENTIER', 'jours',
   'Une reference de classe C - ou sans classe ABC - en stock est proposee au tournant si elle n''a pas ete comptee dans ce magasin depuis ce nombre de jours (ou jamais).', 'STOCK', 'DIRECTION')
ON CONFLICT (code_parametre) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. LE MODULE LOTS (regle 5) : lire et ecrire suivent le stock ; decider d'un
--    lot (derogation, blocage) revient a la Direction et a l'administration.
-- -----------------------------------------------------------------------------
INSERT INTO permission (code_role_user, module, action)
SELECT p.code_role_user, 'LOTS', p.action FROM permission p
 WHERE p.module = 'STOCK' AND p.action IN ('LIRE', 'ECRIRE') AND p.actif = 1
ON CONFLICT (code_role_user, module, action) DO NOTHING;
INSERT INTO permission (code_role_user, module, action)
SELECT r.code_role_user, 'LOTS', 'VALIDER' FROM role_utilisateur r
 WHERE r.code_role_user IN ('ADMIN', 'DIRECTION')
ON CONFLICT (code_role_user, module, action) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. MONTANTS DECLARES (regle 16) : un champ non declare est visible de tous.
--    Chacun reprend, role par role et compte par compte, le niveau d'un champ
--    de reference du meme module.
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE champs_neufs (module text, champ text, libelle text, niveau_defaut text,
                                sensible int, ordre int, modele text);
INSERT INTO champs_neufs VALUES
 -- Tableau de bord (/api/cockpit/analyse) : comme la valeur du stock.
 ('COCKPIT',    'budget_annuel_mad',         'Budget annuel (MAD)',               'LECTURE', 1, 4200, 'valeur_stock_mad'),
 ('COCKPIT',    'cout_mad',                  'Cout (MAD)',                        'LECTURE', 1, 4210, 'valeur_stock_mad'),
 ('COCKPIT',    'cout_matiere_annuel_mad',   'Cout matiere annuel (MAD)',         'LECTURE', 1, 4220, 'valeur_stock_mad'),
 ('COCKPIT',    'economie_annuelle_mad',     'Economie annuelle (MAD)',           'LECTURE', 1, 4230, 'valeur_stock_mad'),
 ('COCKPIT',    'montant_mad',               'Montant (MAD)',                     'LECTURE', 1, 4240, 'valeur_stock_mad'),
 ('COCKPIT',    'prix_actuel_mad',           'Prix actuel (MAD/kg)',              'LECTURE', 1, 4250, 'valeur_stock_mad'),
 ('COCKPIT',    'prix_min_mad',              'Prix le plus bas (MAD/kg)',         'LECTURE', 1, 4260, 'valeur_stock_mad'),
 ('COCKPIT',    'valeur_conso_annuelle_mad', 'Valeur consommee par an (MAD)',     'LECTURE', 1, 4270, 'valeur_stock_mad'),
 ('COCKPIT',    'montant_total_mad',         'Montant (MAD) du fil d''actualite', 'LECTURE', 1, 4280, 'valeur_stock_mad'),
 -- Facture locale, cloture et avoir : comme le total de la reception.
 ('RECEPTIONS', 'montant_facture_mad',       'Montant de la facture (MAD)',       'LECTURE', 1, 4300, 'total_mad'),
 ('RECEPTIONS', 'frais_facture_mad',         'Frais de la facture (MAD)',         'LECTURE', 1, 4310, 'total_mad'),
 ('RECEPTIONS', 'taux_change_reception',     'Taux de change de la reception',    'LECTURE', 1, 4320, 'total_mad'),
 ('RECEPTIONS', 'valeur_provisoire_mad',     'Valeur provisoire (MAD)',           'LECTURE', 1, 4330, 'total_mad'),
 ('RECEPTIONS', 'valeur_definitive_mad',     'Valeur definitive (MAD)',           'LECTURE', 1, 4340, 'total_mad'),
 ('RECEPTIONS', 'difference_mad',            'Difference de facture (MAD)',       'LECTURE', 1, 4350, 'total_mad'),
 ('RECEPTIONS', 'au_stock_mad',              'Part portee au stock (MAD)',        'LECTURE', 1, 4360, 'total_mad'),
 ('RECEPTIONS', 'ecart_prix_mad',            'Ecart de prix (MAD)',               'LECTURE', 1, 4370, 'total_mad'),
 ('RECEPTIONS', 'cmup_avant',                'CMUP avant cloture',                'LECTURE', 1, 4380, 'total_mad'),
 ('RECEPTIONS', 'cmup_apres',                'CMUP apres cloture',                'LECTURE', 1, 4390, 'total_mad'),
 ('RECEPTIONS', 'montant_facture_devise',    'Montant de la facture (devise)',    'LECTURE', 1, 4392, 'total_mad'),
 ('RECEPTIONS', 'taux_facture',              'Taux de la facture',                'LECTURE', 1, 4394, 'total_mad'),
 ('RECEPTIONS', 'montant_devise',            'Montant facture saisi (devise)',    'LECTURE', 1, 4396, 'total_mad'),
 -- Prix d'entree d'un lot : comme le CMUP du stock.
 ('STOCK',      'prix_entree_mad',           'Prix d''entree du lot (MAD/kg)',    'LECTURE', 1, 4400, 'cmup_mad');

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT module, champ, libelle, niveau_defaut, sensible, ordre FROM champs_neufs
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, n.module, n.champ,
       CASE WHEN m.niveau = 'MASQUE' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM champs_neufs n
  JOIN modele_droit_champ m ON m.module = n.module AND m.champ = n.modele
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, n.module, n.champ,
       CASE WHEN d.niveau = 'MASQUE' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM champs_neufs n
  JOIN droit_champ d ON d.module = n.module AND d.champ = n.modele
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

DROP TABLE champs_neufs;
