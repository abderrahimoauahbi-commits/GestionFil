-- ===========================================================================
-- LE CATALOGUE REMIS SUR « Liste ref fil.xlsx », VERSION CORRIGEE DU 17/09/2026
--
-- Le classeur a ete retravaille apres la premiere passe (2026-09-16) : 34
-- couleurs internes, la famille d'une reference, la reference fournisseur de
-- Jute 10/1. Cette migration le rejoue EN ENTIER, avec les memes regles :
-- ce qui n'a pas change se reecrit a l'identique.
--
-- LE PRIX ET LE STOCK NE SONT PAS TOUCHES.
--
-- Rejouable : couleur en ON CONFLICT, mises a jour idempotentes, familles
-- retirees seulement si elles sont vides.
-- ===========================================================================

BEGIN;

-- --- 1. La couleur que le classeur introduit --------------------------------
-- « C00 » est le Blanc des plastiques, du SBR 821 et du Hotmelt (17 lignes
-- libellees « Blanc »). SANS classe de teinture : ces matieres ne se teignent
-- pas, et la classe pilote un supplement de prix.
INSERT INTO couleur (code_couleur_interne, libelle, classe_teinture, description, ordre_affichage, actif) VALUES
  ('C00', 'Blanc', NULL, 'Plastiques, colles : matiere non teinte', 5, 1)
ON CONFLICT (code_couleur_interne) DO NOTHING;

-- --- 2. Chaque reference, telle que le classeur la decrit --------------------
CREATE TEMP TABLE maj (
    code    text PRIMARY KEY,
    cat     text NOT NULL,
    frs     text NOT NULL,
    fam     text,
    reffrs  text,
    unite   text NOT NULL,
    couleur text,
    smin    numeric
) ON COMMIT DROP;
INSERT INTO maj (code, cat, frs, fam, reffrs, unite, couleur, smin) VALUES
  ('Cuir', 'CUI', 'FRS-002', 'IMITATION-CUIR', 'CUIR', 'ml', NULL, NULL),
  ('Jute 12/1', 'JUT', 'FRS-010', '12/1', '12/1', 'kg', 'C5', NULL),
  ('Jute 16/2', 'JUT', 'FRS-010', '16/2', '1800/2', 'kg', 'C5', NULL),
  ('Jute 20/2', 'JUT', 'FRS-010', '20/2', '1440/2', 'kg', 'C5', NULL),
  ('Jute 24/1', 'JUT', 'FRS-010', '24/1', '1200/1', 'kg', 'C5', NULL),
  ('Jute 30/1', 'JUT', 'FRS-010', '30/1', '30/1', 'kg', 'C5', NULL),
  ('Jute 9,6/1', 'JUT', 'FRS-010', '9,6/1', '3000/1', 'kg', 'C5', NULL),
  ('Jute 10/1', 'JUT', 'FRS-010', '10/1', '2250/1', 'kg', 'C5', NULL),
  ('Bande', 'LAI', 'FRS-002', 'LAINE', 'Bande', 'ml', 'C5', NULL),
  ('PES Fdy-1500 Deniers-Gold Fdy-33005-Gzm', 'PES', 'FRS-003', '1500-FDY', 'Fdy-33005', 'kg', 'C1', 6720),
  ('PES Fdy-1500 Deniers-Marron Fdy-36005-Gzm', 'PES', 'FRS-003', '1500-FDY', 'Fdy-36005', 'kg', 'CM', 3360),
  ('PES Fdy-1500 Deniers-Olive Fdy-93005-Gzm', 'PES', 'FRS-003', '1500-FDY', 'Fdy-93005', 'kg', NULL, 3360),
  ('PES Fdy-1500 Deniers-Rose Fdy-423020-Gzm', 'PES', 'FRS-003', '1500-FDY', 'Fdy-423020', 'kg', NULL, 3360),
  ('PES Fdy-1500 Deniers-Taupe Fdy-811100-Gzm', 'PES', 'FRS-003', '1500-FDY', 'Fdy-811100', 'kg', 'C5', 3360),
  ('PES Fdy-1500 Deniers-Turkoise Fdy-513020-Gzm', 'PES', 'FRS-003', '1500-FDY', 'Fdy-513020', 'kg', NULL, 3360),
  ('PES Fdy -1800 Deniers-Gold Cf-101 Turk', 'PES', 'FRS-007', '1800-FDY', 'Cf-101', 'kg', 'C1', 2822),
  ('PES Fdy -1800 Deniers-Taupe Cf-4001 Turk', 'PES', 'FRS-007', '1800-FDY', 'Cf-4001', 'kg', 'C5', 2822),
  ('PES Fdy -1800 Deniers-White Cf-1001 Turk', 'PES', 'FRS-007', '1800-FDY', 'Cf-1001', 'kg', NULL, 2822),
  ('Micro PES-3600 Deniers Shade 25-Tat', 'PES', 'FRS-004', 'MICRO-PES-3600-DENIERS', '25', 'kg', NULL, 3900),
  ('Micro PES-3600 Deniers Ivory 15-Tat', 'PES', 'FRS-004', 'MICRO-PES-3600-DENIERS', '15', 'kg', NULL, 3900),
  ('Micro PES-7360 Deniers-Multi Beige 1305-129-Suj', 'PES', 'FRS-006', 'MICRO-PES-7360', '1305-129', 'kg', 'C5', 5956),
  ('Micro PES-7360 Deniers-Multi L.Beige 1305-130-Suj', 'PES', 'FRS-006', 'MICRO-PES-7360', '1305-130', 'kg', NULL, 5956),
  ('Micro PES-7360 Deniers-Multi L.Brown 1305-61-Suj', 'PES', 'FRS-006', 'MICRO-PES-7360', '1305-61', 'kg', NULL, 2960),
  ('PES-3000 Deniers- Bleu Ssl2244-Suj', 'PES', 'FRS-006', '3000-DENIERS', 'Ssl2244', 'kg', 'C4', 3360),
  ('PES-3000 Deniers- Dark Grey Ssl2069-Suj', 'PES', 'FRS-006', '3000-DENIERS', 'Ssl2069', 'kg', NULL, 6720),
  ('PES-3000 Deniers- Dk.Vison Ssl2176-Suj', 'PES', 'FRS-006', '3000-DENIERS', 'Ssl2176', 'kg', NULL, 6720),
  ('PES-3000 Deniers- Khave Ssl2279-Suj', 'PES', 'FRS-006', '3000-DENIERS', 'Ssl2279', 'kg', NULL, 3360),
  ('PES-3000 Deniers- Pink Ssl2259-Suj', 'PES', 'FRS-006', '3000-DENIERS', 'Ssl2259', 'kg', NULL, 3360),
  ('PES-3000 Deniers- Rouge Ssl2232-Suj', 'PES', 'FRS-006', '3000-DENIERS', 'Ssl2232', 'kg', 'C3', 6720),
  ('PES-3000 Deniers- Seker Cream Ssl2081-Suj', 'PES', 'FRS-006', '3000-DENIERS', 'Ssl2081', 'kg', NULL, 6720),
  ('PES-3000 Deniers- Vison Ssl2247-Suj', 'PES', 'FRS-006', '3000-DENIERS', 'Ssl2247', 'kg', NULL, 6720),
  ('PES-3000 Deniers- WhiteSsl2331-Suj', 'PES', 'FRS-006', '3000-DENIERS', 'Ssl2331', 'kg', NULL, 6720),
  ('PES Ver-1500 Deniers-BleuTex-8100 Text', 'PES', 'FRS-008', 'VERONA-1500', 'Tex-8100', 'kg', 'C4', 2419),
  ('PES Ver-1500 Deniers-TerraTex-8000 Text', 'PES', 'FRS-008', 'VERONA-1500', 'Tex-8000', 'kg', NULL, 2419),
  ('PES -1200 Deniers-Anty Bordeau 61043-Gzm', 'PES', 'FRS-003', '1200-DENIERS', '61043', 'kg', 'C3', 11500),
  ('PES Nylon', 'PES', 'FRS-002', '1100-POLY', '1100', 'kg', NULL, NULL),
  ('PES-Nylon', 'PES', 'FRS-010', '1100-POLY', '1100', 'kg', NULL, NULL),
  ('PES-3000 Deniers- Dk.Beige Ssl2271-Suj', 'PES', 'FRS-006', '3000-DENIERS', 'Ssl2271', 'kg', 'C1', 6720),
  ('PES Fdy-1500 Deniers-Bleu  Fdy-542030-Gzm', 'PES', 'FRS-003', '1500-FDY', 'Fdy-542030', 'kg', 'C4', 3360),
  ('PES-20/2 GLOBALTEX', 'PES-CH', 'FRS-010', '12/2', '20/2', 'kg', NULL, NULL),
  ('PES-20/2 LOMAT', 'PES-CH', 'FRS-009', '12/2', '20/2', 'kg', NULL, NULL),
  ('PES-20/4 GLOBALTEX', 'PES-CH', 'FRS-010', '12/4', '20/4', 'kg', NULL, NULL),
  ('PES-20/4 LOMAT', 'PES-CH', 'FRS-009', '12/4', '20/4', 'kg', NULL, NULL),
  ('PES -1500 Deniers-Grey 1274-Gzm', 'PES-PO', 'FRS-003', '1500-DENIERS', '1274', 'kg', 'CG', 3360),
  ('PES -1500 Deniers-Green 1272-Gzm', 'PES-PO', 'FRS-003', '1500-DENIERS', '1272', 'kg', 'CV', 3360),
  ('PES -1500 Deniers-L.Beige 1273-Gzm', 'PES-PO', 'FRS-003', '1500-DENIERS', '1273', 'kg', NULL, 3360),
  ('PES -1500 Deniers-D.Bleu 1271-Gzm', 'PES-PO', 'FRS-003', '1500-DENIERS', '1271', 'kg', NULL, 3360),
  ('PES -1500 Deniers-Bordeau 61043-Gzm', 'PES-PO', 'FRS-003', '1500-DENIERS', '61043', 'kg', 'C3', 10750),
  ('PES-1500 Deniers-Gold Cb-4016 Sf', 'PES-PO', 'FRS-002', '1500-DENIERS', 'Cb-4016', 'kg', 'C1', 3360),
  ('PES Sh-1200 Deniers-Cream B-Cb -1005 Sf', 'PES-SH', 'FRS-002', '1200-DENIERS-SHRINK', 'Cb -1005', 'kg', NULL, 8900),
  ('PES Sh-1200 Deniers-Beige Cp-1432 Sf', 'PES-SH', 'FRS-002', '1200-DENIERS-SHRINK', 'Cp-1432', 'kg', 'C5', 3000),
  ('PES Sh-1500 Deniers-D.Vizon Cp-2068 Sf', 'PES-SH', 'FRS-002', '1500-DENIERS-SHRINK', 'Cp-2068', 'kg', 'CM', 2950),
  ('PES Sh-1500 Deniers-Vizon Cp-2018 Sf', 'PES-SH', 'FRS-002', '1500-DENIERS-SHRINK', 'Cp-2018', 'kg', NULL, 2950),
  ('PES Sh-1200 Deniers-Antrasit 802-Tat', 'PES-SH', 'FRS-004', '1200-DENIERS-SHRINK', '802', 'kg', NULL, 2688),
  ('PES Sh-1200 Deniers-Cpbt Grey 801-Tat', 'PES-SH', 'FRS-004', '1200-DENIERS-SHRINK', '801', 'kg', 'CG', 2688),
  ('PES Sh-1200 Deniers- Cream Dtbc-H69-Gzm', 'PES-SH', 'FRS-003', '1200-DENIERS-SHRINK', 'Dtbc-H69', 'kg', NULL, 2688),
  ('PES Sh-1500 Deniers-Beige Cp-2039 Sf', 'PES-SH', 'FRS-002', '1500-DENIERS-SHRINK', 'Cp-2039', 'kg', 'C5', 2950),
  ('PES Sh-1500 Deniers- L.Beige H-2000-Tat', 'PES-SH', 'FRS-004', '1500-DENIERS-SHRINK', 'H-2000', 'kg', 'C5', 3544),
  ('PES Sh -1200 Deniers-Cream B Cp-1005Turk', 'PES-SH', 'FRS-007', '1200-DENIERS-SHRINK', 'Cp-1005', 'kg', NULL, 16934),
  ('PES Sh -1200 Deniers-Cream Cb-1056 Turk', 'PES-SH', 'FRS-007', '1200-DENIERS-SHRINK', 'Cb-1056', 'kg', NULL, 2822),
  ('PES Sh -1200 Deniers-Cream Cb-1426 Turk', 'PES-SH', 'FRS-007', '1200-DENIERS-SHRINK', 'Cb-1426', 'kg', 'C5', 5644),
  ('PES Sh -1200 Deniers-Grey Cb-7A Turk', 'PES-SH', 'FRS-007', '1200-DENIERS-SHRINK', 'Cb-7A', 'kg', 'CG', 2822),
  ('PES Sh-1500 Deniers-D.VizonTex-7521 Text', 'PES-SH', 'FRS-008', '1500-DENIERS-SHRINK', 'Tex-7521', 'kg', 'CM', 5913),
  ('PES Sh-1500 Deniers-VizonTex-7530 Text', 'PES-SH', 'FRS-008', '1500-DENIERS-SHRINK', 'Tex-7530', 'kg', NULL, 5913),
  ('PES Sh-1500 Deniers-Beige H-2001-Tat', 'PES-SH', 'FRS-004', '1500-DENIERS-SHRINK', 'H-2001', 'kg', 'C5N', 3544),
  ('PES Sh-1500 Deniers-Beige Tex-7500 Text', 'PES-SH', 'FRS-008', '1500-DENIERS-SHRINK', 'Tex-7500', 'kg', 'C5', 2956),
  ('PES Sh-1500 Deniers-Cream H-1008-Tat', 'PES-SH', 'FRS-004', '1500-DENIERS-SHRINK', 'H-1008', 'kg', NULL, 3544),
  ('PLA 100 EXT', 'PLA', 'FRS-012', 'PLA-100', '100', 'kg', 'C00', NULL),
  ('PLA 140 EXT', 'PLA', 'FRS-012', 'PLA-140', '140', 'kg', 'C00', NULL),
  ('PLA 35 EXT', 'PLA', 'FRS-012', 'PLA-35', '35', 'kg', 'C00', NULL),
  ('PLA 35 CHE', 'PLA', 'FRS-011', 'PLA-35', '35', 'kg', 'C00', NULL),
  ('PLA 45 EXT', 'PLA', 'FRS-012', 'PLA-45', '45', 'kg', 'C00', NULL),
  ('PLA 50 EXT', 'PLA', 'FRS-012', 'PLA-50', '50', 'kg', 'C00', NULL),
  ('PLA 65 EXT', 'PLA', 'FRS-012', 'PLA-65', '65', 'kg', 'C00', NULL),
  ('PLA 80 EXT', 'PLA', 'FRS-012', 'PLA-80', '80', 'kg', 'C00', NULL),
  ('PLA 100 CHE', 'PLA', 'FRS-011', 'PLA-100', '100', 'kg', 'C00', NULL),
  ('PLA 140 CHE', 'PLA', 'FRS-011', 'PLA-140', '140', 'kg', 'C00', NULL),
  ('PLA 45 CHE', 'PLA', 'FRS-011', 'PLA-45', '45', 'kg', 'C00', NULL),
  ('PLA 50 CHE', 'PLA', 'FRS-011', 'PLA-50', '50', 'kg', 'C00', NULL),
  ('PLA 65 CHE', 'PLA', 'FRS-011', 'PLA-65', '65', 'kg', 'C00', NULL),
  ('PLA 80 CHE', 'PLA', 'FRS-011', 'PLA-80', '80', 'kg', 'C00', NULL),
  ('PP-1500 Dtex-Bleu 6666-Hs', 'PP', 'FRS-001', '1500-DTEX', '6666', 'kg', 'C4', 4400),
  ('PP-1500 Dtex-Cream 2951-Hs', 'PP', 'FRS-001', '1500-DTEX', '2951', 'kg', 'C5N', 8400),
  ('PP-1500 Dtex-D.Bleu 6665-Hs', 'PP', 'FRS-001', '1500-DTEX', '6665', 'kg', NULL, 4400),
  ('PP-1500 Dtex-L.Beige 44377-Hs', 'PP', 'FRS-001', '1500-DTEX', '44377', 'kg', 'C5', 4400),
  ('PP-1500 Dtex-Pink 7623-Hs', 'PP', 'FRS-001', '1500-DTEX', '7623', 'kg', NULL, 4400),
  ('PP-1750*2 Dtex-Sh Beige 44414 Hs', 'PP', 'FRS-001', '1750*2 DTEX', '44414', 'kg', 'C5', 8332),
  ('PP-1750*2 Dtex-Sh Brown 44415 Hs', 'PP', 'FRS-001', '1750*2 DTEX', '44415', 'kg', 'CM', 8332),
  ('PP-1750*2 Dtex-Sh Creme 2981 Hs', 'PP', 'FRS-001', '1750*2 DTEX', '2981', 'kg', 'C5N', 8332),
  ('PP-1900 Dtex- Cream 2951-Hs', 'PP', 'FRS-001', '1900-DTEX', '2951', 'kg', 'C5N', 4200),
  ('PP-1900 Dtex-D.Green 5455-Hs', 'PP', 'FRS-001', '1900-DTEX', '5455', 'kg', 'CVR', 8400),
  ('PP-1900 Dtex-L.Beige 44377-Hs', 'PP', 'FRS-001', '1900-DTEX', '44377', 'kg', 'TAUPE', 12600),
  ('PP FRZ-2900 Dtex-Beige 44360-Hs', 'PP', 'FRS-001', '2900-DTEX', '44360', 'kg', 'C5S', 12900),
  ('PP FRZ-2900 Dtex-Brown 44361-Hs', 'PP', 'FRS-001', '2900-DTEX', '44361', 'kg', 'C6', 12900),
  ('PP FRZ-2900 Dtex-Camel 44416-Hs', 'PP', 'FRS-001', '2900-DTEX', '44416', 'kg', NULL, 4300),
  ('PP FRZ-2900 Dtex-Cream 44412-Hs', 'PP', 'FRS-001', '2900-DTEX', '44412', 'kg', 'C5N', 8600),
  ('PP FRZ-2900 Dtex-D.Bleu 6417-Hs', 'PP', 'FRS-001', '2900-DTEX', '6417', 'kg', NULL, 4300),
  ('PP FRZ-2900 Dtex-D.Green 5463-Hs', 'PP', 'FRS-001', '2900-DTEX', '5463', 'kg', 'CVR', 4300),
  ('PP FRZ-2900 Dtex-Grey 10575-Hs', 'PP', 'FRS-001', '2900-DTEX', '10575', 'kg', NULL, 8600),
  ('PP FRZ-2900 Dtex- Grey 8933-Hs', 'PP', 'FRS-001', '2900-DTEX', '8933', 'kg', 'CG', 8600),
  ('PP FRZ-2900 Dtex-Pink 7639-Hs', 'PP', 'FRS-001', '2900-DTEX', '7639', 'kg', 'C7', 4300),
  ('PP FRZ-2900 Dtex- Red 7612-Hs', 'PP', 'FRS-001', '2900-DTEX', '7612', 'kg', 'C3', 12900),
  ('PP-1000*2 Dtex-Beige Mn-3203 L-Tat', 'PP', 'FRS-004', '1000X2-DTEX', 'Mn-3203', 'kg', 'C5', 7765),
  ('PP-1000*2 Dtex-Cream Mn-1201-Tat', 'PP', 'FRS-004', '1000X2-DTEX', 'Mn-1201', 'kg', NULL, 7765),
  ('PP-1775*2 Dtex-Cream 1072-Tat', 'PP', 'FRS-004', '1775*2-DTEX', '1072', 'kg', NULL, 7800),
  ('PP-1775*2 Dtex-White 1073-Tat', 'PP', 'FRS-004', '1775*2-DTEX', '1073', 'kg', NULL, 7800),
  ('PP FRZ-2900 Dtex-Gold 3034-Oz', 'PP', 'FRS-005', '2900-DTEX', '3034', 'kg', 'C1', 8333),
  ('PP FRZ-2900 Dtex-Green Mlt 18-Tat', 'PP', 'FRS-004', '2900-DTEX', '18', 'kg', 'CV', 2688),
  ('PP FRZ-2900 Dtex-Navy Bleu 1697-Tat', 'PP', 'FRS-004', '2900-DTEX', '1697', 'kg', 'C4', 2688),
  ('PP-1500 Dtex-Bleu 7201-Oz', 'PP', 'FRS-005', '1500-DTEX', '7201', 'kg', 'C4', 4400),
  ('PP-1500 Dtex-Yellow 3151-Oz', 'PP', 'FRS-005', '1500-DTEX', '3151', 'kg', 'C1', 4400),
  ('PP FRZ-2900 Dtex-A/Green 8068-Oz', 'PP', 'FRS-005', '2900-DTEX', '8068', 'kg', 'CVR', 4166),
  ('PP FRZ-2900 Dtex-Beige 2204-Oz', 'PP', 'FRS-005', '2900-DTEX', '2204', 'kg', 'C5S', 12500),
  ('PP FRZ-2900 Dtex-Black 9000-Oz', 'PP', 'FRS-005', '2900-DTEX', '9000', 'kg', 'C2', 8333),
  ('PP FRZ-2900 Dtex-Brown 6161-Oz', 'PP', 'FRS-005', '2900-DTEX', '6161', 'kg', 'C6', 12500),
  ('PP FRZ-2900 Dtex- Grey 9095-Oz', 'PP', 'FRS-005', '2900-DTEX', '9095', 'kg', 'CG', 8333),
  ('PP FRZ-2900 Dtex-Navy 7062 -Oz', 'PP', 'FRS-005', '2900-DTEX', '7062', 'kg', NULL, 4166),
  ('PP FRZ-2900 Dtex- Red 5001-Oz', 'PP', 'FRS-005', '2900-DTEX', '5001', 'kg', 'C3', 12500),
  ('PP-1500 Dtex-Yellow 3430-Hs', 'PP', 'FRS-001', '1500-DTEX', '3430', 'kg', 'C1', 4400),
  ('PP FRZ-2900 Dtex-Black 8001-Hs', 'PP', 'FRS-001', '2900-DTEX', '8001', 'kg', 'C2', 8600),
  ('PP FRZ-2900 Dtex-Gold 3423-Hs', 'PP', 'FRS-001', '2900-DTEX', '3423', 'kg', 'C1', 8600),
  ('PP-1500 Dtex-D.Bleu 7200-Oz', 'PP', 'FRS-005', '1500-DTEX', '7200', 'kg', NULL, 4400),
  ('PP FRZ-2900 Dtex-Cream 1104-Tat', 'PP', 'FRS-004', '2900-DTEX', '1104', 'kg', NULL, 5376),
  ('Hotmelt', 'SBR', 'FRS-002', NULL, NULL, 'kg', 'C00', NULL),
  ('SBR 821', 'SBR', 'FRS-009', 'SBR-821', '821', 'kg', 'C00', NULL);

-- Une reference du classeur absente de la base arreterait tout : une mise a
-- jour partielle laisserait le catalogue a moitie sur l'ancienne version.
DO $$
DECLARE manquantes text;
BEGIN
    SELECT string_agg(m.code, ', ') INTO manquantes
      FROM maj m WHERE NOT EXISTS (SELECT 1 FROM reference r WHERE r.code_reference = m.code);
    IF manquantes IS NOT NULL THEN
        RAISE EXCEPTION 'references du classeur absentes du catalogue : %', manquantes;
    END IF;
END $$;

-- REJOUABLE APRES 2026-09-17f, qui retire du nuancier les codes que le fichier
-- n'emploie pas (C5S, CMS...). Une couleur disparue n'est pas reposee : la
-- reference garde celle qu'elle porte, et 17f la remettra a sa valeur exacte.
UPDATE reference r SET
    code_categorie        = m.cat,
    code_fournisseur      = m.frs,
    code_famille          = m.fam,
    reference_fournisseur = m.reffrs,
    unite_catalogue       = m.unite,
    code_couleur_interne  = CASE
        WHEN m.couleur IS NULL THEN NULL
        WHEN EXISTS (SELECT 1 FROM couleur c WHERE c.code_couleur_interne = m.couleur)
             THEN m.couleur
        ELSE r.code_couleur_interne END,
    stock_min_kg          = COALESCE(m.smin, r.stock_min_kg)
  FROM maj m WHERE r.code_reference = m.code;

-- --- 3. Les couleurs, fournisseur par fournisseur ---------------------------
-- LE CLASSEUR FAIT FOI : une correspondance existante qui pointe vers une autre
-- couleur de la maison est CORRIGEE. Chez HASIRCI et OZKARALAR, « Marron (CMS) »
-- est desormais saisi C6.
-- Meme garde : une correspondance vers une couleur retiree du nuancier ne se
-- repose pas (la cle etrangere la refuserait au second passage).
INSERT INTO couleur_fournisseur (id_couleur_fournisseur, code_couleur_interne,
                                 code_fournisseur, code_couleur, libelle, actif)
SELECT v.id, v.interne, v.frs, v.code, v.libelle, 1
  FROM (VALUES
  ('CF-C5-FRS-001-BEIGE', 'C5', 'FRS-001', 'BEIGE', 'Beige', 1),
  ('CF-C5S-FRS-001-BEIGEC5S', 'C5S', 'FRS-001', 'BEIGE (C5S)', 'Beige (C5S)', 1),
  ('CF-C4-FRS-001-BLEU', 'C4', 'FRS-001', 'BLEU', 'Bleu', 1),
  ('CF-C5N-FRS-001-C5N', 'C5N', 'FRS-001', 'C5N', 'C5N', 1),
  ('CF-C5N-FRS-001-CREAM', 'C5N', 'FRS-001', 'CREAM', 'Cream', 1),
  ('CF-CVR-FRS-001-CVR', 'CVR', 'FRS-001', 'CVR', 'Cvr', 1),
  ('CF-CG-FRS-001-GRISCLAIRE', 'CG', 'FRS-001', 'GRIS CLAIRE', 'Gris Claire', 1),
  ('CF-C5-FRS-001-LBEIGE', 'C5', 'FRS-001', 'L.BEIGE', 'L.Beige', 1),
  ('CF-CM-FRS-001-MARRON', 'CM', 'FRS-001', 'MARRON', 'Marron', 1),
  ('CF-C6-FRS-001-MARRONCMS', 'C6', 'FRS-001', 'MARRON (CMS)', 'Marron (CMS)', 1),
  ('CF-C2-FRS-001-NOIR', 'C2', 'FRS-001', 'NOIR', 'Noir', 1),
  ('CF-C1-FRS-001-OR', 'C1', 'FRS-001', 'OR', 'Or', 1),
  ('CF-C7-FRS-001-ROSE', 'C7', 'FRS-001', 'ROSE', 'Rose', 1),
  ('CF-C3-FRS-001-ROUGE', 'C3', 'FRS-001', 'ROUGE', 'Rouge', 1),
  ('CF-TAUPE-FRS-001-TAUPE', 'TAUPE', 'FRS-001', 'TAUPE', 'Taupe', 1),
  ('CF-CVR-FRS-001-VERTFONCE', 'CVR', 'FRS-001', 'VERT FONCE', 'Vert Fonce', 1),
  ('CF-C5-FRS-002-BEIGE', 'C5', 'FRS-002', 'BEIGE', 'Beige', 1),
  ('CF-C00-FRS-002-BLANC', 'C00', 'FRS-002', 'BLANC', 'Blanc', 1),
  ('CF-CM-FRS-002-MARRON', 'CM', 'FRS-002', 'MARRON', 'Marron', 1),
  ('CF-C1-FRS-002-OR', 'C1', 'FRS-002', 'OR', 'Or', 1),
  ('CF-C5-FRS-003-BEIGE', 'C5', 'FRS-003', 'BEIGE', 'Beige', 1),
  ('CF-C4-FRS-003-BLEU', 'C4', 'FRS-003', 'BLEU', 'Bleu', 1),
  ('CF-CG-FRS-003-GRIS', 'CG', 'FRS-003', 'GRIS', 'Gris', 1),
  ('CF-CM-FRS-003-MARRON', 'CM', 'FRS-003', 'MARRON', 'Marron', 1),
  ('CF-C1-FRS-003-OR', 'C1', 'FRS-003', 'OR', 'Or', 1),
  ('CF-C3-FRS-003-ROUGE', 'C3', 'FRS-003', 'ROUGE', 'Rouge', 1),
  ('CF-CV-FRS-003-VERT', 'CV', 'FRS-003', 'VERT', 'Vert', 1),
  ('CF-C5-FRS-004-BEIGE', 'C5', 'FRS-004', 'BEIGE', 'Beige', 1),
  ('CF-C5N-FRS-004-BEIGEFONCE', 'C5N', 'FRS-004', 'BEIGE FONCE', 'Beige Fonce', 1),
  ('CF-C4-FRS-004-BLEU', 'C4', 'FRS-004', 'BLEU', 'Bleu', 1),
  ('CF-CG-FRS-004-GRIS', 'CG', 'FRS-004', 'GRIS', 'Gris', 1),
  ('CF-C5-FRS-004-LBEIGE', 'C5', 'FRS-004', 'L.BEIGE', 'L.Beige', 1),
  ('CF-CV-FRS-004-VERT', 'CV', 'FRS-004', 'VERT', 'Vert', 1),
  ('CF-C5S-FRS-005-BEIGEC5S', 'C5S', 'FRS-005', 'BEIGE (C5S)', 'Beige (C5S)', 1),
  ('CF-C4-FRS-005-BLEU', 'C4', 'FRS-005', 'BLEU', 'Bleu', 1),
  ('CF-CG-FRS-005-GRISCLAIRE', 'CG', 'FRS-005', 'GRIS CLAIRE', 'Gris Claire', 1),
  ('CF-C6-FRS-005-MARRONCMS', 'C6', 'FRS-005', 'MARRON (CMS)', 'Marron (CMS)', 1),
  ('CF-C2-FRS-005-NOIR', 'C2', 'FRS-005', 'NOIR', 'Noir', 1),
  ('CF-C1-FRS-005-OR', 'C1', 'FRS-005', 'OR', 'Or', 1),
  ('CF-C3-FRS-005-ROUGE', 'C3', 'FRS-005', 'ROUGE', 'Rouge', 1),
  ('CF-CVR-FRS-005-VERTFONCE', 'CVR', 'FRS-005', 'VERT FONCE', 'Vert Fonce', 1),
  ('CF-C5-FRS-006-BEIGE', 'C5', 'FRS-006', 'BEIGE', 'Beige', 1),
  ('CF-C4-FRS-006-BLEU', 'C4', 'FRS-006', 'BLEU', 'Bleu', 1),
  ('CF-C1-FRS-006-OR', 'C1', 'FRS-006', 'OR', 'Or', 1),
  ('CF-C3-FRS-006-ROUGE', 'C3', 'FRS-006', 'ROUGE', 'Rouge', 1),
  ('CF-C5-FRS-007-BEIGE', 'C5', 'FRS-007', 'BEIGE', 'Beige', 1),
  ('CF-CG-FRS-007-GRIS', 'CG', 'FRS-007', 'GRIS', 'Gris', 1),
  ('CF-C1-FRS-007-OR', 'C1', 'FRS-007', 'OR', 'Or', 1),
  ('CF-C5-FRS-008-BEIGE', 'C5', 'FRS-008', 'BEIGE', 'Beige', 1),
  ('CF-C4-FRS-008-BLEU', 'C4', 'FRS-008', 'BLEU', 'Bleu', 1),
  ('CF-CM-FRS-008-MARRON', 'CM', 'FRS-008', 'MARRON', 'Marron', 1),
  ('CF-C00-FRS-009-BLANC', 'C00', 'FRS-009', 'BLANC', 'Blanc', 1),
  ('CF-C5-FRS-010-BEIGE', 'C5', 'FRS-010', 'BEIGE', 'Beige', 1),
  ('CF-C00-FRS-011-BLANC', 'C00', 'FRS-011', 'BLANC', 'Blanc', 1),
  ('CF-C00-FRS-012-BLANC', 'C00', 'FRS-012', 'BLANC', 'Blanc', 1)
       ) AS v(id, interne, frs, code, libelle, actif)
 WHERE EXISTS (SELECT 1 FROM couleur c WHERE c.code_couleur_interne = v.interne)
ON CONFLICT (code_fournisseur, code_couleur) DO UPDATE
   SET code_couleur_interne = excluded.code_couleur_interne,
       libelle              = excluded.libelle,
       actif                = 1;

-- --- 4. Les familles que le classeur ne connait pas -------------------------
-- Retirees SEULEMENT si aucune reference ne les porte : la garde NOT EXISTS
-- tient aussi sur le serveur, ou une fiche aurait pu en adopter une entre-temps.
DELETE FROM famille f
 WHERE f.code_famille NOT IN (
   '10/1',
   '1000X2-DTEX',
   '1100-POLY',
   '12/1',
   '12/2',
   '12/4',
   '1200-DENIERS',
   '1200-DENIERS-SHRINK',
   '1500-DENIERS',
   '1500-DENIERS-SHRINK',
   '1500-DTEX',
   '1500-FDY',
   '16/2',
   '1750*2 DTEX',
   '1775*2-DTEX',
   '1800-FDY',
   '1900-DTEX',
   '20/2',
   '24/1',
   '2900-DTEX',
   '30/1',
   '3000-DENIERS',
   '9,6/1',
   'IMITATION-CUIR',
   'LAINE',
   'MICRO-PES-3600-DENIERS',
   'MICRO-PES-7360',
   'PLA-100',
   'PLA-140',
   'PLA-35',
   'PLA-45',
   'PLA-50',
   'PLA-65',
   'PLA-80',
   'SBR-821',
   'VERONA-1500'
 )
   AND NOT EXISTS (SELECT 1 FROM reference r WHERE r.code_famille = f.code_famille);

COMMIT;
