-- =============================================================================
-- seed_140 — LA LISTE DES COULEURS, et les droits des nouveaux champs
-- -----------------------------------------------------------------------------
-- Les familles ne sont pas semees : elles sortent des classeurs de prix, et se
-- valident a l'ecran. Les couleurs, elles, sont stables : ce sont les codes que
-- l'entreprise emploie depuis des annees chez tous ses fournisseurs.
-- =============================================================================

-- Les couleurs relevees dans les classeurs de prix. Celles dont le libelle
-- n'est pas certain sont posees quand meme : le code existe chez plusieurs
-- fournisseurs, c'est a l'usage de le nommer.
INSERT INTO couleur (code_couleur_interne, libelle, classe_teinture, description, ordre_affichage) VALUES
    ('C1',  'Or',           NULL,   'GOLD chez les fournisseurs',            10),
    ('C2',  'Noir',         'DARK', 'BLACK',                                 20),
    ('C3',  'Rouge',        'RED',  'RED — classe tarifaire la plus chere',  30),
    ('C4',  'A preciser',   NULL,   'Code present chez Goral et Ozkaralar',  40),
    ('C5',  'Beige',        NULL,   'CREAM / BEIGE',                         50),
    ('C5N', 'Beige fonce',  NULL,   NULL,                                    55),
    ('C5S', 'Beige nouveau', NULL,  'NEW BEIGE / SH. beige',                 56),
    ('C6',  'A preciser',   NULL,   'Code present chez Tekstur et Turkan',   60),
    ('C7',  'A preciser',   NULL,   'Code present chez Tekstur',             70),
    ('C8',  'A preciser',   NULL,   'Code present chez Tekstur et Turkan',   80),
    ('CG',  'Gris clair',   'LIGHT','L.GRAY',                                90),
    ('CV',  'A preciser',   NULL,   'Code present chez Tekstur',            100),
    ('CM',  'Marron',       'DARK', 'BROWN',                                110),
    ('CLM', 'Marron clair', NULL,   'L.BROWN',                              120),
    ('CMS', 'Marron nouveau', NULL, 'NEW MARRON / SH. brown',               130),
    ('CVR', 'Vert fonce',   'DARK', 'D.GREEN',                              140),
    ('CBR', 'Bleu fonce',   'DARK', 'D.BLUE',                               150),
    ('TAUPE','Taupe',       NULL,   NULL,                                   160)
ON CONFLICT (code_couleur_interne) DO NOTHING;

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('CATALOGUE', 'code_couleur_interne',  'Code couleur interne',   'ECRITURE', 0, 700),
 ('CATALOGUE', 'code_famille',          'Famille',                'ECRITURE', 0, 705),
 ('CATALOGUE', 'reference_fournisseur', 'Reference fournisseur',  'ECRITURE', 0, 710),
 ('CATALOGUE', 'supplement_teinture',   'Supplement teinture',    'ECRITURE', 0, 715),
 ('CATALOGUE', 'classe_teinture',       'Classe de teinture',     'ECRITURE', 0, 720),
 ('CATALOGUE', 'description',           'Description',            'ECRITURE', 0, 725),
 ('CATALOGUE', 'ordre_affichage',       'Ordre d''affichage',     'ECRITURE', 0, 730),
 ('CATALOGUE', 'nb_references',         'References',             'LECTURE',  0, 735)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE WHEN c.niveau_defaut = 'ECRITURE' AND EXISTS (
                 SELECT 1 FROM permission p WHERE p.code_role_user = r.code_role_user
                  AND p.module = 'CATALOGUE' AND p.action = 'ECRIRE') THEN 'ECRITURE'
            WHEN EXISTS (SELECT 1 FROM permission p WHERE p.code_role_user = r.code_role_user
                          AND p.module = 'CATALOGUE' AND p.action = 'LIRE') THEN 'LECTURE'
            ELSE 'MASQUE' END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'CATALOGUE' AND c.ordre BETWEEN 700 AND 735 AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champ_configurable c ON c.module = m.module AND c.champ = m.champ
 WHERE m.module = 'CATALOGUE' AND c.ordre BETWEEN 700 AND 735
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- Les familles, extraites des feuilles de prix du classeur.
INSERT INTO famille (code_famille, libelle, titrage, description, ordre_affichage) VALUES
    ('FIL-2650-DTEX-FZ', 'FIL 2650 dtex  FZ', '2650 dtex', 'Cote chez GORAL, HASIRCI, TANER', 10),
    ('FIL-1200-DENIERS', 'FIL 1200 Deniers', '1200 Deniers', 'Cote chez GZM, TEKSTUR, TURKAN', 20),
    ('FIL-1350-DTEX-SH', 'FIL 1350 dtex  SH', '1350 dtex', 'Cote chez TANER', 30),
    ('FIL-1500-DENIERS', 'Fil 1500 Deniers', '1500 Deniers', 'Cote chez GZM, SOFIA, TEKSTUR, TURKAN', 40),
    ('FIL-2600-DTEX-BCF', 'FIL 2600 dtex BCF', '2600 dtex', 'Cote chez TANER', 50),
    ('FIL-2600-DTEX', 'FIL 2600 dtex', '2600 dtex', 'Cote chez BY', 60),
    ('FIL-1800-DENIERS', 'Fil 1800 Deniers', '1800 Deniers', 'Cote chez GZM, TEKSTUR, TURKAN', 70),
    ('FIL-2650-2900-DTEX-FZ', 'FIL 2650/2900 dtex  FZ', '2650 2900 dtex', 'Cote chez OZ', 80),
    ('FIL-1200-DENIERS-SHRINK', 'FIL 1200 Deniers SHRINK', '1200 Deniers', 'Cote chez GZM, SOFIA, TURKAN', 90),
    ('FIL-1500-1350-DTEX-SHEHRAZAD', 'FIL 1500/1350 dtex SHEHRAZAD', '1500 1350 dtex', 'Cote chez GORAL, HASIRCI, OZ', 100),
    ('FIL-2100-DTEX-IL', 'FIL 2100 dtex  IL', '2100 dtex', 'Cote chez TANER', 110),
    ('FIL-2100-DTEX-IN', 'FIL 2100 dtex  IN', '2100 dtex', 'Cote chez MUKA, TANER', 120),
    ('CHAGUI-1750-2', 'CHAGUI 1750*2', '1750', 'Cote chez HASIRCI, OZ', 130),
    ('FIL1900-DTEX', 'FIL1900 dtex', '1900 dtex', 'Cote chez GORAL, HASIRCI', 140),
    ('FIL-2650-DTEX', 'FIL 2650 dtex', '2650 dtex', 'Cote chez FLAMNT, TAT', 150),
    ('FIL-1500-FDY', 'FIL 1500 FDY', '1500', 'Cote chez GZM', 160),
    ('FIL-1800-FDY', 'FIL 1800 FDY', '1800', 'Cote chez SOFIA, TURKAN', 170),
    ('FIL-2100-DTEX-INES', 'FIL 2100 dtex INES', '2100 dtex', 'Cote chez GORAL', 180),
    ('FIL2600-DTEX-SARA', 'FIL2600 dtex  SARA', '2600 dtex', 'Cote chez GORAL', 190),
    ('MICRO-POLYESTER-DEN-3600-SOLID', 'MICRO POLYESTER DEN 3600 SOLID', '3600', 'Cote chez TAT', 200),
    ('1775DX2-FRZ-300-SOLID', '1775DX2 FRZ-300 SOLID', '300', 'Cote chez TAT', 210),
    ('1000X2-DTEX-HS-360-FLAMENTS-MONO', '1000X2 DTEX HS-360 FLAMENTS MONO', '1000X2 dtex', 'Cote chez TAT', 220),
    ('FIL-1900-DTEX', 'FIL 1900 dtex', '1900 dtex', 'Cote chez TAT', 230),
    ('3000-DENIERS', '3000 Deniers', '3000 Deniers', 'Cote chez SUJATA', 240),
    ('SHRINK-1200', 'SHRINK 1200', '1200', 'Cote chez TEKSTUR', 250),
    ('FIL-1900-DTEX-INAS', 'FIL 1900 dtex  INAS', '1900 dtex', 'Cote chez OZ', 260),
    ('POLYESTER-1200-SHRINK', 'POLYESTER 1200 SHRINK', '1200', 'Cote chez TAT', 270),
    ('FIL-1200', 'FIL 1200', '1200', 'Cote chez SOFIA', 280),
    ('FIL-1350-DTEX', 'FIL 1350 dtex', '1350 dtex', 'Cote chez MUKA', 290),
    ('PESMICRO-7360', 'PesMicro 7360', '7360', 'Cote chez SUJATA', 300),
    ('FIL-VERONA-1500', 'FIL VERONA 1500', '1500', 'Cote chez TEKSTUR', 310),
    ('POLYESTER-FRISE-2400', 'POLYESTER FRISE 2400', '2400', 'Cote chez TEKSTUR', 320),
    ('CHAGUI-1775-2', 'CHAGUI 1775*2', '1775', 'Cote chez OZ', 330),
    ('POLYESTER-1500-SHRINK-MONO', 'POLYESTER 1500 SHRINK MONO', '1500', 'Cote chez TAT', 340),
    ('FIL-1500-DENIERS-SHRINK', 'FIL 1500 Deniers SHRINK', '1500 Deniers', 'Cote chez SOFIA', 350)
ON CONFLICT (code_famille) DO NOTHING;
