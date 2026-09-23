-- =============================================================================
-- MIGRATION 2026-09-12 (c) — LES FAMILLES DE FIL
-- -----------------------------------------------------------------------------
-- Extraites des treize feuilles de prix du classeur d'importation : une famille
-- par bloc de cotation, regroupee quand deux fournisseurs la titrent pareil.
-- Le libelle est celui du classeur, pas une invention ; la description dit qui
-- la cote, pour que le rapprochement entre fournisseurs se lise d'un coup.
--
-- Quelques titres se ressemblent (2650 dtex FZ / 2650-2900 dtex FZ / 2650 dtex) :
-- ce sont les memes fils chez des vendeurs differents. On les pose tels quels, et
-- la fusion se fait a l'ecran, en connaissance de cause.
-- =============================================================================

BEGIN;

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

COMMIT;
