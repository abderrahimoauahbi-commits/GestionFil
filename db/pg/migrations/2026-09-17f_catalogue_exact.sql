-- ===========================================================================
-- LE CATALOGUE EXACTEMENT COMME « Liste ref fil.xlsx » (17/09/2026)
--
-- « Les familles et les couleurs exactement comme dans le fichier. » Le fichier
-- est un export de la page Catalogue, retravaille : chaque case est la valeur
-- brute d'un champ. 2026-09-17c en DEDUISAIT encore une partie (C4 depuis
-- « Bleu », C5S depuis « Beige (C5S) ») et laissait les libelles de famille et le
-- nom de couleur fournisseur de l'ancien import. Ici, rien n'est deduit.
--
-- UNE traduction, decidee le 16/09 : « C0 » = aucune couleur.
-- Rejouable : mises a jour idempotentes, retraits gardes.
-- ===========================================================================

BEGIN;

CREATE TEMP TABLE exact (code text PRIMARY KEY, couleur text, interne text, famille text) ON COMMIT DROP;
INSERT INTO exact (code, couleur, interne, famille) VALUES
  ('Cuir', 'Noir', NULL, 'IMITATION-CUIR'),
  ('Jute 12/1', 'Beige', 'C5', '12/1'),
  ('Jute 16/2', 'Beige', 'C5', '16/2'),
  ('Jute 20/2', 'Beige', 'C5', '20/2'),
  ('Jute 24/1', 'Beige', 'C5', '24/1'),
  ('Jute 30/1', 'Beige', 'C5', '30/1'),
  ('Jute 9,6/1', 'Beige', 'C5', '9,6/1'),
  ('Jute 10/1', 'Beige', 'C5', '10/1'),
  ('Bande', 'Beige', 'C5', 'LAINE'),
  ('PES Fdy-1500 Deniers-Gold Fdy-33005-Gzm', 'Or', 'C1', '1500-FDY'),
  ('PES Fdy-1500 Deniers-Marron Fdy-36005-Gzm', 'Marron', 'CM', '1500-FDY'),
  ('PES Fdy-1500 Deniers-Olive Fdy-93005-Gzm', 'Olive', NULL, '1500-FDY'),
  ('PES Fdy-1500 Deniers-Rose Fdy-423020-Gzm', 'Rose', NULL, '1500-FDY'),
  ('PES Fdy-1500 Deniers-Taupe Fdy-811100-Gzm', 'Beige', 'C5', '1500-FDY'),
  ('PES Fdy-1500 Deniers-Turkoise Fdy-513020-Gzm', 'Turkoise', NULL, '1500-FDY'),
  ('PES Fdy -1800 Deniers-Gold Cf-101 Turk', 'Or', 'C1', '1800-FDY'),
  ('PES Fdy -1800 Deniers-Taupe Cf-4001 Turk', 'Beige', 'C5', '1800-FDY'),
  ('PES Fdy -1800 Deniers-White Cf-1001 Turk', 'Blanc', NULL, '1800-FDY'),
  ('Micro PES-3600 Deniers Shade 25-Tat', 'Blanc Mouchte', NULL, 'MICRO-PES-3600-DENIERS'),
  ('Micro PES-3600 Deniers Ivory 15-Tat', 'Blanc', NULL, 'MICRO-PES-3600-DENIERS'),
  ('Micro PES-7360 Deniers-Multi Beige 1305-129-Suj', 'Beige', 'C5', 'MICRO-PES-7360'),
  ('Micro PES-7360 Deniers-Multi L.Beige 1305-130-Suj', 'L.Beige', NULL, 'MICRO-PES-7360'),
  ('Micro PES-7360 Deniers-Multi L.Brown 1305-61-Suj', 'L.Brown', NULL, 'MICRO-PES-7360'),
  ('PES-3000 Deniers- Bleu Ssl2244-Suj', 'Bleu', NULL, '3000-DENIERS'),
  ('PES-3000 Deniers- Dark Grey Ssl2069-Suj', 'Grris', NULL, '3000-DENIERS'),
  ('PES-3000 Deniers- Dk.Vison Ssl2176-Suj', 'Dk Vison', NULL, '3000-DENIERS'),
  ('PES-3000 Deniers- Khave Ssl2279-Suj', 'Khave', NULL, '3000-DENIERS'),
  ('PES-3000 Deniers- Pink Ssl2259-Suj', 'Rose', NULL, '3000-DENIERS'),
  ('PES-3000 Deniers- Rouge Ssl2232-Suj', 'Rouge', 'C3', '3000-DENIERS'),
  ('PES-3000 Deniers- Seker Cream Ssl2081-Suj', 'Cream', NULL, '3000-DENIERS'),
  ('PES-3000 Deniers- Vison Ssl2247-Suj', 'Vison', NULL, '3000-DENIERS'),
  ('PES-3000 Deniers- WhiteSsl2331-Suj', 'Blanc', NULL, '3000-DENIERS'),
  ('PES Ver-1500 Deniers-BleuTex-8100 Text', 'Bleu', NULL, 'VERONA-1500'),
  ('PES Ver-1500 Deniers-TerraTex-8000 Text', 'Brique', NULL, 'VERONA-1500'),
  ('PES -1200 Deniers-Anty Bordeau 61043-Gzm', 'Rouge', 'C3', '1200-DENIERS'),
  ('PES Nylon', 'Blanc', NULL, '1100-POLY'),
  ('PES-Nylon', 'Blanc', NULL, '1100-POLY'),
  ('PES-3000 Deniers- Dk.Beige Ssl2271-Suj', 'Or', 'C1', '3000-DENIERS'),
  ('PES Fdy-1500 Deniers-Bleu  Fdy-542030-Gzm', 'Bleu', NULL, '1500-FDY'),
  ('PES-20/2 GLOBALTEX', 'Blanc', NULL, '12/2'),
  ('PES-20/2 LOMAT', 'Blanc', NULL, '12/2'),
  ('PES-20/4 GLOBALTEX', 'Blanc', NULL, '12/4'),
  ('PES-20/4 LOMAT', 'Blanc', NULL, '12/4'),
  ('PES -1500 Deniers-Grey 1274-Gzm', 'Gris', 'CG', '1500-DENIERS'),
  ('PES -1500 Deniers-Green 1272-Gzm', 'Vert', 'CV', '1500-DENIERS'),
  ('PES -1500 Deniers-L.Beige 1273-Gzm', 'L.Beige', NULL, '1500-DENIERS'),
  ('PES -1500 Deniers-D.Bleu 1271-Gzm', 'Bleu Marine', NULL, '1500-DENIERS'),
  ('PES -1500 Deniers-Bordeau 61043-Gzm', 'Rouge', 'C3', '1500-DENIERS'),
  ('PES-1500 Deniers-Gold Cb-4016 Sf', 'Or', 'C1', '1500-DENIERS'),
  ('PES Sh-1200 Deniers-Cream B-Cb -1005 Sf', 'Cream', NULL, '1200-DENIERS-SHRINK'),
  ('PES Sh-1200 Deniers-Beige Cp-1432 Sf', 'Beige', 'C5', '1200-DENIERS-SHRINK'),
  ('PES Sh-1500 Deniers-D.Vizon Cp-2068 Sf', 'Marron', 'CM', '1500-DENIERS-SHRINK'),
  ('PES Sh-1500 Deniers-Vizon Cp-2018 Sf', 'Cream', NULL, '1500-DENIERS-SHRINK'),
  ('PES Sh-1200 Deniers-Antrasit 802-Tat', 'Gris Mouchte', NULL, '1200-DENIERS-SHRINK'),
  ('PES Sh-1200 Deniers-Cpbt Grey 801-Tat', 'Gris', 'CG', '1200-DENIERS-SHRINK'),
  ('PES Sh-1200 Deniers- Cream Dtbc-H69-Gzm', 'Cream', NULL, '1200-DENIERS-SHRINK'),
  ('PES Sh-1500 Deniers-Beige Cp-2039 Sf', 'Beige', 'C5', '1500-DENIERS-SHRINK'),
  ('PES Sh-1500 Deniers- L.Beige H-2000-Tat', 'Beige', 'C5', '1500-DENIERS-SHRINK'),
  ('PES Sh -1200 Deniers-Cream B Cp-1005Turk', 'Cream B', NULL, '1200-DENIERS-SHRINK'),
  ('PES Sh -1200 Deniers-Cream Cb-1056 Turk', 'Cream CR', NULL, '1200-DENIERS-SHRINK'),
  ('PES Sh -1200 Deniers-Cream Cb-1426 Turk', 'Beige', 'C5', '1200-DENIERS-SHRINK'),
  ('PES Sh -1200 Deniers-Grey Cb-7A Turk', 'Gris', 'CG', '1200-DENIERS-SHRINK'),
  ('PES Sh-1500 Deniers-D.VizonTex-7521 Text', 'Marron', 'CM', '1500-DENIERS-SHRINK'),
  ('PES Sh-1500 Deniers-VizonTex-7530 Text', 'Vizon', NULL, '1500-DENIERS-SHRINK'),
  ('PES Sh-1500 Deniers-Beige H-2001-Tat', 'Beige Fonce', 'C5N', '1500-DENIERS-SHRINK'),
  ('PES Sh-1500 Deniers-Beige Tex-7500 Text', 'Beige', 'C5', '1500-DENIERS-SHRINK'),
  ('PES Sh-1500 Deniers-Cream H-1008-Tat', 'Cream', NULL, '1500-DENIERS-SHRINK'),
  ('PLA 100 EXT', 'Blanc', 'C00', 'PLA-100'),
  ('PLA 140 EXT', 'Blanc', 'C00', 'PLA-140'),
  ('PLA 35 EXT', 'Blanc', 'C00', 'PLA-35'),
  ('PLA 35 CHE', 'Blanc', 'C00', 'PLA-35'),
  ('PLA 45 EXT', 'Blanc', 'C00', 'PLA-45'),
  ('PLA 50 EXT', 'Blanc', 'C00', 'PLA-50'),
  ('PLA 65 EXT', 'Blanc', 'C00', 'PLA-65'),
  ('PLA 80 EXT', 'Blanc', 'C00', 'PLA-80'),
  ('PLA 100 CHE', 'Blanc', 'C00', 'PLA-100'),
  ('PLA 140 CHE', 'Blanc', 'C00', 'PLA-140'),
  ('PLA 45 CHE', 'Blanc', 'C00', 'PLA-45'),
  ('PLA 50 CHE', 'Blanc', 'C00', 'PLA-50'),
  ('PLA 65 CHE', 'Blanc', 'C00', 'PLA-65'),
  ('PLA 80 CHE', 'Blanc', 'C00', 'PLA-80'),
  ('PP-1500 Dtex-Bleu 6666-Hs', 'Bleu', 'C4', '1500-DTEX'),
  ('PP-1500 Dtex-Cream 2951-Hs', 'C5N', 'C5N', '1500-DTEX'),
  ('PP-1500 Dtex-D.Bleu 6665-Hs', 'Bleu Marine', NULL, '1500-DTEX'),
  ('PP-1500 Dtex-L.Beige 44377-Hs', 'L.Beige', 'C5', '1500-DTEX'),
  ('PP-1500 Dtex-Pink 7623-Hs', 'Rose', NULL, '1500-DTEX'),
  ('PP-1750*2 Dtex-Sh Beige 44414 Hs', 'Beige', 'C5', '1750*2 DTEX'),
  ('PP-1750*2 Dtex-Sh Brown 44415 Hs', 'Marron', 'CM', '1750*2 DTEX'),
  ('PP-1750*2 Dtex-Sh Creme 2981 Hs', 'Cream', 'C5N', '1750*2 DTEX'),
  ('PP-1900 Dtex- Cream 2951-Hs', 'C5N', 'C5N', '1900-DTEX'),
  ('PP-1900 Dtex-D.Green 5455-Hs', 'Cvr', 'CVR', '1900-DTEX'),
  ('PP-1900 Dtex-L.Beige 44377-Hs', 'Taupe', 'TAUPE', '1900-DTEX'),
  ('PP FRZ-2900 Dtex-Beige 44360-Hs', 'Beige (C5S)', NULL, '2900-DTEX'),
  ('PP FRZ-2900 Dtex-Brown 44361-Hs', 'Marron (CMS)', 'C6', '2900-DTEX'),
  ('PP FRZ-2900 Dtex-Camel 44416-Hs', 'Camel', NULL, '2900-DTEX'),
  ('PP FRZ-2900 Dtex-Cream 44412-Hs', 'Cream', 'C5N', '2900-DTEX'),
  ('PP FRZ-2900 Dtex-D.Bleu 6417-Hs', 'Bleu Marine', NULL, '2900-DTEX'),
  ('PP FRZ-2900 Dtex-D.Green 5463-Hs', 'Vert Fonce', 'CVR', '2900-DTEX'),
  ('PP FRZ-2900 Dtex-Grey 10575-Hs', 'Gris Mouchte', NULL, '2900-DTEX'),
  ('PP FRZ-2900 Dtex- Grey 8933-Hs', 'Gris Claire', 'CG', '2900-DTEX'),
  ('PP FRZ-2900 Dtex-Pink 7639-Hs', 'Rose', 'C7', '2900-DTEX'),
  ('PP FRZ-2900 Dtex- Red 7612-Hs', 'Rouge', 'C3', '2900-DTEX'),
  ('PP-1000*2 Dtex-Beige Mn-3203 L-Tat', 'L.Beige', 'C5', '1000X2-DTEX'),
  ('PP-1000*2 Dtex-Cream Mn-1201-Tat', 'Cream', NULL, '1000X2-DTEX'),
  ('PP-1775*2 Dtex-Cream 1072-Tat', 'Cream', NULL, '1775*2-DTEX'),
  ('PP-1775*2 Dtex-White 1073-Tat', 'Blanc', NULL, '1775*2-DTEX'),
  ('PP FRZ-2900 Dtex-Gold 3034-Oz', 'Or', 'C1', '2900-DTEX'),
  ('PP FRZ-2900 Dtex-Green Mlt 18-Tat', 'Vert', 'CV', '2900-DTEX'),
  ('PP FRZ-2900 Dtex-Navy Bleu 1697-Tat', 'Bleu', 'C4', '2900-DTEX'),
  ('PP-1500 Dtex-Bleu 7201-Oz', 'Bleu', 'C4', '1500-DTEX'),
  ('PP-1500 Dtex-Yellow 3151-Oz', 'Or', 'C1', '1500-DTEX'),
  ('PP FRZ-2900 Dtex-A/Green 8068-Oz', 'Vert Fonce', 'CVR', '2900-DTEX'),
  ('PP FRZ-2900 Dtex-Beige 2204-Oz', 'Beige (C5S)', NULL, '2900-DTEX'),
  ('PP FRZ-2900 Dtex-Black 9000-Oz', 'Noir', 'C2', '2900-DTEX'),
  ('PP FRZ-2900 Dtex-Brown 6161-Oz', 'Marron (CMS)', 'C6', '2900-DTEX'),
  ('PP FRZ-2900 Dtex- Grey 9095-Oz', 'Gris Claire', 'CG', '2900-DTEX'),
  ('PP FRZ-2900 Dtex-Navy 7062 -Oz', 'D.Turkoi', NULL, '2900-DTEX'),
  ('PP FRZ-2900 Dtex- Red 5001-Oz', 'Rouge', 'C3', '2900-DTEX'),
  ('PP-1500 Dtex-Yellow 3430-Hs', 'Or', 'C1', '1500-DTEX'),
  ('PP FRZ-2900 Dtex-Black 8001-Hs', 'Noir', 'C2', '2900-DTEX'),
  ('PP FRZ-2900 Dtex-Gold 3423-Hs', 'Or', 'C1', '2900-DTEX'),
  ('PP-1500 Dtex-D.Bleu 7200-Oz', 'Bleu Marine', NULL, '1500-DTEX'),
  ('PP FRZ-2900 Dtex-Cream 1104-Tat', 'Cream', NULL, '2900-DTEX'),
  ('Hotmelt', 'Blanc', 'C00', NULL),
  ('SBR 821', 'Blanc', 'C00', 'SBR-821');

DO $$
DECLARE manquantes text;
BEGIN
    SELECT string_agg(e.code, ', ') INTO manquantes FROM exact e
     WHERE NOT EXISTS (SELECT 1 FROM reference r WHERE r.code_reference = e.code);
    IF manquantes IS NOT NULL THEN
        RAISE EXCEPTION 'references du fichier absentes du catalogue : %', manquantes;
    END IF;
END $$;

-- --- 1. La couleur de chaque reference, case pour case ----------------------
UPDATE reference r
   SET couleur = e.couleur, code_couleur_interne = e.interne
  FROM exact e WHERE r.code_reference = e.code;

-- --- 2. Les familles : la page affiche le libelle, le fichier donne le code --
UPDATE famille f SET libelle = f.code_famille
 WHERE f.code_famille IN (SELECT famille FROM exact WHERE famille IS NOT NULL)
   AND f.libelle IS DISTINCT FROM f.code_famille;

-- --- 3. Les codes fournisseur ------------------------------------------------
-- Le fichier range Brown 44361-Hs (HASIRCI) et Brown 6161-Oz (OZKARALAR) en C6 :
-- leurs codes chez le fournisseur suivent, avant que CMS ne disparaisse.
UPDATE couleur_fournisseur SET code_couleur_interne = 'C6'
 WHERE (code_fournisseur, code_couleur) IN (('FRS-001', 'BROWN - 44361'), ('FRS-005', 'BROWN OZ 6161'));

-- Les correspondances que NOS migrations avaient deduites d'un libelle (« Bleu »
-- -> C4, « Beige (C5S) » -> C5S) et que le fichier ne porte pas. Les codes venus
-- du classeur GESTION FIL (« RED 7612 »...) ne sont pas touches.
DELETE FROM couleur_fournisseur cf
 WHERE cf.id_couleur_fournisseur LIKE 'CF-%'
   AND NOT EXISTS (SELECT 1 FROM exact e JOIN reference r ON r.code_reference = e.code
                    WHERE r.code_fournisseur = cf.code_fournisseur
                      AND upper(e.couleur) = cf.code_couleur
                      AND e.interne = cf.code_couleur_interne);

-- --- 4. Le nuancier : les codes du fichier, et eux seuls ---------------------
-- C00, C1, C2, C3, C4, C5, C5N, C6, C7, CG, CM, CV, CVR, TAUPE
-- Garde : un code encore porte par une reference n'est jamais retire.
DELETE FROM couleur c
 WHERE c.code_couleur_interne NOT IN ('C00', 'C1', 'C2', 'C3', 'C4', 'C5', 'C5N', 'C6', 'C7', 'CG', 'CM', 'CV', 'CVR', 'TAUPE')
   AND NOT EXISTS (SELECT 1 FROM reference r WHERE r.code_couleur_interne = c.code_couleur_interne);

COMMIT;
