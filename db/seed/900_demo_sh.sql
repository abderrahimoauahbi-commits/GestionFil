-- =============================================================================
-- SEED 900 : JEU DE DEMONSTRATION — QUALITE SH (SHEHRAZADE)
-- =============================================================================
-- /!\ DONNEES DE TEST /!\
-- Les designations, densites et pourcentages proviennent du CDC E3 (reels).
-- Les PRIX, MOQ et multiples d'achat sont INVENTES : ils n'existent pas dans le
-- CDC et devront etre remplaces par l'extraction de GESTION Fil.xlsx.
-- Ne pas charger ce fichier en production.
--
-- OBJET : prouver de bout en bout que la chaine
--     catalogue -> recette -> plan -> MRP -> plan d'achat
-- reproduit exactement les nombres que le CDC calcule lui-meme en F2 :
--     Plan SH Juillet 500 m2
--       PP-1500 Dtex-Yellow 3430-Hs : 500 x 1.760 x 6.4%  = 56.32 kg
--       Jute 9,6/1                  : 500 x 0.520 x 100%  = 260.00 kg
-- La vue I4 du CDC, elle, aurait renvoye 0 (densite cherchee par categorie).
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- Catalogue : les 12 references de la recette SH
-- Les 4 unites de saisie sont representees pour exercer la conversion R01.
-- -----------------------------------------------------------------------------
INSERT INTO reference
    (code_reference, code_categorie, code_fournisseur, designation, couleur, titrage,
     unite_catalogue, poids_bobine_kg, bobines_par_palette, densite_kg_ml,
     prix_catalogue, code_devise_catalogue, stock_min_kg, moq_kg, multiple_achat_kg,
     classe_abc, suivi_lot)
VALUES
    -- Role POIL
    ('PP-3430',   'PP',    'HAS','PP-1500 Dtex-Yellow 3430-Hs',            'Jaune',   '1500 Dtex','Bobine', 3.2,  240, NULL,  9.60,  'USD', 12900, 3840, 768, 'A', 1),
    ('PP-6665',   'PP',    'HAS','PP-1500 Dtex-D.Bleu 6665-Hs',            'Bleu fonce','1500 Dtex','Bobine',3.2, 240, NULL,  9.60,  'USD',  8000, 3840, 768, 'A', 1),
    ('PES-61043', 'PES-PO','GZM','PES-1200 Deniers-Anty Bordeau 61043-Gzm','Bordeaux','1200 Den', 'kg',     NULL, NULL, NULL,  2.60,  'USD', 25000, 5000,1000, 'A', 1),
    ('PES-61044', 'PES-PO','GZM','PES-1200 Deniers-Anty Ecru 61044-Gzm',   'Ecru',    '1200 Den', 'kg',     NULL, NULL, NULL,  2.55,  'USD', 20000, 5000,1000, 'A', 1),
    -- Role TRAME
    ('JUT-961',   'JUT',   'SUJ','Jute 9,6/1',                             NULL,      '9,6/1',    'kg',     NULL, NULL, NULL,  0.95,  'USD', 30000,10000,1000, 'B', 0),
    -- Role CHAINE
    ('PES-202',   'PES-CH','LOM','PES-20/2 LOMAT',                         NULL,      '20/2',     'kg',     NULL, NULL, NULL,  2.10,  'USD',  6000, 2000, 500, 'B', 0),
    ('PES-204',   'PES-CH','LOM','PES-20/4 LOMAT',                         NULL,      '20/4',     'kg',     NULL, NULL, NULL,  2.15,  'USD',  4000, 2000, 500, 'B', 0),
    -- Role COLLE
    ('SBR-821',   'SBR',   'TEX','SBR 821',                                NULL,      NULL,       'kg',     NULL, NULL, NULL,  1.20,  'USD', 15000, 5000,1000, 'B', 0),
    -- Reference SANS multiple_achat_kg : reproduit le cas ou la vue I2 du CDC
    -- renvoyait une quantite a commander de 0 en silence.
    ('HOTMELT',   'LAT',   'TUR','Hotmelt',                                NULL,      NULL,       'kg',     NULL, NULL, NULL,  3.50,  'USD',   800, NULL, NULL,'C', 0),
    -- Role CUIR (ml/m2)
    ('CUIR-01',   'CUI',   'OZK','Simili cuir de finition',                'Naturel', NULL,       'ml',     NULL, NULL, 0.35,  1.47,  'USD',  5000, 2000, 500, 'B', 0),
    -- Role PLAST
    ('PLAST-50',  'PLA',   'CHM','Plastique 50',                           NULL,      '50',       'kg',     NULL, NULL, NULL, 12.00,  'MAD',  1000,  500, 100, 'C', 0),
    -- Role RUBAN (ml/m2)
    ('BANDE-01',  'PLA',   'EXP','Bande de bordure',                       NULL,      NULL,       'ml',     NULL, NULL, 0.02,  0.30,  'MAD',   500,  200, 100, 'C', 0);

-- -----------------------------------------------------------------------------
-- Groupe d'equivalence : les deux PES POIL sont substituables (CDC F8)
-- -----------------------------------------------------------------------------
INSERT INTO groupe_equiv (code_groupe_equiv, libelle, description) VALUES
    ('GRP-001','PES 1200 Deniers Anty','Polyester poil 1200 deniers, nuances interchangeables');

INSERT INTO reference_groupe_equiv (code_reference, code_groupe_equiv, priorite, est_preferentielle) VALUES
    ('PES-61043','GRP-001', 1, 1),
    ('PES-61044','GRP-001', 2, 0);

-- -----------------------------------------------------------------------------
-- Composition de la qualite SH
-- Les 3 premieres lignes du role POIL sont celles du CDC E3 (6.4 + 8.6 + 44.4
-- = 59.4%). Le CDC s'arrete la sur "... (total = 100%)" : la 4e ligne (40.6%)
-- complete la composition pour satisfaire R07.
-- -----------------------------------------------------------------------------
INSERT INTO recette (code_qualite, ligne_numero, code_reference, code_role, code_groupe_equiv, pourcentage_composition, couleur) VALUES
    ('SH',  1, 'PP-3430',   'POIL',   NULL,      6.4,  'Jaune'),
    ('SH',  2, 'PP-6665',   'POIL',   NULL,      8.6,  'Bleu fonce'),
    ('SH',  3, 'PES-61043', 'POIL',   'GRP-001',44.4,  'Bordeaux'),
    ('SH',  4, 'PES-61044', 'POIL',   'GRP-001',40.6,  'Ecru'),
    ('SH', 10, 'JUT-961',   'TRAME',  NULL,    100.0,  NULL),
    ('SH', 20, 'PES-202',   'CHAINE', NULL,     62.0,  NULL),
    ('SH', 21, 'PES-204',   'CHAINE', NULL,     38.0,  NULL),
    ('SH', 30, 'SBR-821',   'COLLE',  NULL,     95.0,  NULL),
    ('SH', 31, 'HOTMELT',   'COLLE',  NULL,      5.0,  NULL),
    ('SH', 40, 'CUIR-01',   'CUIR',   NULL,    100.0,  NULL),
    ('SH', 50, 'PLAST-50',  'PLAST',  NULL,    100.0,  NULL),
    ('SH', 60, 'BANDE-01',  'RUBAN',  NULL,    100.0,  NULL);

-- Mise en service de la qualite : declenche R07 (somme = 100% par role), la
-- presence d'une densite pour chaque role, et densite_kg_ml pour les roles ml/m2.
UPDATE qualite SET statut = 'ACTIF' WHERE code_qualite = 'SH';

-- -----------------------------------------------------------------------------
-- Plan de production 2026 v1 — saisonnalite SH du CDC E4
-- Base mensuelle 1000 m2 x coefficient. Juillet : 1000 x 0.20 = 200 m2.
-- La ligne de JUILLET est portee a 500 m2 pour reproduire exactement l'exemple
-- de calcul F2 du CDC.
-- -----------------------------------------------------------------------------
INSERT INTO plan_production
    (id_plan, annee, numero_version, libelle, scenario_nom, date_debut, date_fin,
     marge_securite_pct, couv_min_mois, taux_perte_pct,
     seuil_alerte_jours, seuil_critique_jours,
     seuil_tier1_mad, seuil_tier2_mad, seuil_tier3_mad,
     id_utilisateur_creation)
VALUES
    ('00000000-0000-4000-a000-0000000000b1', 2026, 1, 'Plan 2026 - Scenario de base', 'BASE',
     '2026-01-01','2026-12-31', 20.0, 2.0, 2.0, 90, 60, 300000, 200000, 100000,
     '00000000-0000-4000-a000-000000000013');

WITH s(mois, coef) AS (VALUES
    (1,0.50),(2,1.00),(3,0.50),(4,0.50),(5,0.20),(6,0.20),
    (7,0.20),(8,0.20),(9,0.50),(10,0.50),(11,0.80),(12,1.00)
)
INSERT INTO plan_saisonnalite (id_plan, code_qualite, mois, coefficient)
SELECT '00000000-0000-4000-a000-0000000000b1', 'SH', s.mois, s.coef FROM s;

WITH s(mois, coef) AS (VALUES
    (1,0.50),(2,1.00),(3,0.50),(4,0.50),(5,0.20),(6,0.20),
    (7,0.20),(8,0.20),(9,0.50),(10,0.50),(11,0.80),(12,1.00)
)
INSERT INTO ligne_plan_production
    (id_plan, mois, rang_mois, annee_mois, code_qualite,
     m2_prevus, m2_base_mensuel, saisonnalite, facteur_croissance)
SELECT '00000000-0000-4000-a000-0000000000b1', s.mois, s.mois - 1,
       printf('2026-%02d', s.mois), 'SH',
       CASE WHEN s.mois = 7 THEN 500.0 ELSE 1000.0 * s.coef END,
       1000.0, s.coef, 1.0
FROM s;

-- Qualite retenue par l'entete du plan, avec sa base mensuelle (BL-4)
INSERT INTO plan_qualite (id_plan, code_qualite, m2_base_mensuel) VALUES
    ('00000000-0000-4000-a000-0000000000b1','SH', 1000.0);

-- Workflow G1 : BROUILLON -> SIMULATION -> VALIDE
UPDATE plan_production SET statut = 'SIMULATION' WHERE id_plan = '00000000-0000-4000-a000-0000000000b1';
UPDATE plan_production SET statut = 'EN_COURS',
                           date_validation = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                           id_utilisateur_validation = '00000000-0000-4000-a000-000000000010',
                           m2_total_annuel = (SELECT SUM(m2_prevus) FROM ligne_plan_production
                                              WHERE id_plan = '00000000-0000-4000-a000-0000000000b1')
 WHERE id_plan = '00000000-0000-4000-a000-0000000000b1';

-- -----------------------------------------------------------------------------
-- Calcul MRP : materialisation de v_besoin_mrp_calcule dans besoin_mrp.
-- En production, ce DELETE + INSERT est execute par le service Rust dans une
-- transaction. La contrainte UNIQUE(id_plan, mois, code_reference) rend
-- l'operation idempotente (correction BL-6 : le CDC empilait les recalculs).
-- -----------------------------------------------------------------------------
DELETE FROM besoin_mrp WHERE id_plan = '00000000-0000-4000-a000-0000000000b1';

INSERT INTO besoin_mrp (id_plan, mois, rang_mois, annee_mois, code_reference,
                        quantite_brute_kg, taux_perte_applique, quantite_kg, date_reference)
SELECT id_plan, mois, rang_mois, annee_mois, code_reference,
       quantite_brute_kg, taux_perte_pct, quantite_kg, date('now')
FROM v_besoin_mrp_calcule
WHERE id_plan = '00000000-0000-4000-a000-0000000000b1';

-- -----------------------------------------------------------------------------
-- Stock initial  (photo figee au P_DateSaisie du CDC B1 : 27/04/2026)
-- Volontairement partiel : certaines references restent a zero afin que les
-- statuts RUPTURE / CRITIQUE / OK soient tous representes.
-- -----------------------------------------------------------------------------
INSERT INTO mouvement (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt,
                       code_magasin, code_motif, reference_document, id_utilisateur, est_initial)
VALUES ('00000000-0000-4000-a000-0000000000c1','MVT-INIT-2026-0001','2026-04-27T08:00:00.000Z',
        'STOCK_INIT','MP-01','INIT','Photo Excel 27/04/2026',
        '00000000-0000-4000-a000-000000000015', 1);

INSERT INTO ligne_mouvement (id_mouvement, ligne_numero, code_reference, quantite_kg, prix_kg_mad, lot_fournisseur) VALUES
    ('00000000-0000-4000-a000-0000000000c1', 1, 'PP-3430',   15000.0, 28.5000, 'LOT-HAS-2601'),
    ('00000000-0000-4000-a000-0000000000c1', 2, 'PP-6665',    9000.0, 28.5000, 'LOT-HAS-2602'),
    ('00000000-0000-4000-a000-0000000000c1', 3, 'PES-61043', 40000.0, 24.7000, 'LOT-GZM-2601'),
    ('00000000-0000-4000-a000-0000000000c1', 4, 'PES-61044',  1200.0, 24.2250, 'LOT-GZM-2602'),
    ('00000000-0000-4000-a000-0000000000c1', 5, 'JUT-961',   45000.0,  9.0250, NULL),
    ('00000000-0000-4000-a000-0000000000c1', 6, 'PES-202',    8000.0, 19.9500, NULL),
    ('00000000-0000-4000-a000-0000000000c1', 7, 'PES-204',    5000.0, 20.4250, NULL),
    ('00000000-0000-4000-a000-0000000000c1', 8, 'SBR-821',   20000.0, 11.4000, NULL),
    ('00000000-0000-4000-a000-0000000000c1', 9, 'PLAST-50',   1500.0, 12.0000, NULL),
    ('00000000-0000-4000-a000-0000000000c1',10, 'BANDE-01',    900.0, 15.0000, NULL);
-- HOTMELT et CUIR-01 : aucun stock initial -> statut RUPTURE attendu.

-- -----------------------------------------------------------------------------
-- Consommation reelle : deux sorties production, pour que v_conso_reelle
-- dispose d'un historique et que source_conso vaille 'REELLE'
-- (et non le repli previsionnel).
-- -----------------------------------------------------------------------------
INSERT INTO mouvement (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt,
                       code_magasin, code_motif, numero_of, id_utilisateur)
VALUES ('00000000-0000-4000-a000-0000000000c2','MVT-SORT-2026-0001','2026-05-20T10:00:00.000Z',
        'SORTIE_PROD','MP-01','PRODUCTION','OF-2026-0142','00000000-0000-4000-a000-000000000015'),
       ('00000000-0000-4000-a000-0000000000c3','MVT-SORT-2026-0002','2026-06-18T10:00:00.000Z',
        'SORTIE_PROD','MP-01','PRODUCTION','OF-2026-0187','00000000-0000-4000-a000-000000000015');

INSERT INTO ligne_mouvement (id_mouvement, ligne_numero, code_reference, quantite_kg, lot_fournisseur, numero_of) VALUES
    ('00000000-0000-4000-a000-0000000000c2', 1, 'PP-3430',   1800.0, 'LOT-HAS-2601','OF-2026-0142'),
    ('00000000-0000-4000-a000-0000000000c2', 2, 'PES-61043', 6200.0, 'LOT-GZM-2601','OF-2026-0142'),
    ('00000000-0000-4000-a000-0000000000c2', 3, 'JUT-961',   3900.0, NULL,          'OF-2026-0142'),
    ('00000000-0000-4000-a000-0000000000c3', 1, 'PP-3430',   2100.0, 'LOT-HAS-2601','OF-2026-0187'),
    ('00000000-0000-4000-a000-0000000000c3', 2, 'PES-61043', 7000.0, 'LOT-GZM-2601','OF-2026-0187'),
    ('00000000-0000-4000-a000-0000000000c3', 3, 'JUT-961',   4300.0, NULL,          'OF-2026-0187');
