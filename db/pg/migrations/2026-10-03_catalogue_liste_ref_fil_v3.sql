-- =============================================================================
-- MIGRATION 2026-10-03 — le catalogue complete depuis « Liste ref fil.xlsx »
--                        (classeur mis a jour le 03/10/2026)
--
-- CE QUI VIENT DU CLASSEUR (feuille 1, sinon feuille 2), sur les references
-- qui y figurent : couleur du fournisseur, couleur interne, famille (si elle
-- existe), reference fournisseur, DESCRIPTION COMMERCIALE (celle du bon de
-- commande), stock minimum, couverture minimale, titrage (seulement s'il est
-- vide en base). 14 couleurs internes que le classeur emploie sont creees, avec
-- le nom que le classeur leur donne.
--
-- CE QUI VIENT DES REGLES quand le classeur ne dit rien — rien ne reste vide :
--   * couverture minimale  : P_CouvMinMois (2 mois) ;
--   * marge de securite    : P_MargeSecurite (20 %) ;
--   * stock minimum        : la formule F3 (v_stock_min_dynamique), MAX de la
--                            couverture, du delai fournisseur et de la securite
--                            ABC, sur la consommation retenue ;
--   * minimum d'un lot pour produire : un etage (P_LotSeuilBobines, 1 344
--                            bobines) ; 5 000 kg (P_LotSeuilRestesKg) pour un
--                            article sans poids par unite.
--
-- CE QUI N'EST PAS TOUCHE : la designation (la colonne « Designation » de la
-- feuille 2 porte le nom de la couleur, pas celui de l'article), le prix et le
-- stock.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-10-03_catalogue_liste_ref_fil_v3.sql
-- =============================================================================
BEGIN;

-- --- 1. Les couleurs internes manquantes -----------------------------------
INSERT INTO couleur (code_couleur_interne, libelle, description) VALUES
  ('C0', 'Noir (C0)', 'Cree depuis le classeur Liste ref fil (03/10/2026)'),
  ('C5I', 'Beige clair', 'Cree depuis le classeur Liste ref fil (03/10/2026)'),
  ('C5L', 'Creme', 'Cree depuis le classeur Liste ref fil (03/10/2026)'),
  ('C5S', 'Beige (C5S)', 'Cree depuis le classeur Liste ref fil (03/10/2026)'),
  ('CB', 'Brique', 'Cree depuis le classeur Liste ref fil (03/10/2026)'),
  ('CBM', 'Camel (marron clair)', 'Cree depuis le classeur Liste ref fil (03/10/2026)'),
  ('CBR', 'Bleu fonce', 'Cree depuis le classeur Liste ref fil (03/10/2026)'),
  ('CGL', 'Gris clair (CGL)', 'Cree depuis le classeur Liste ref fil (03/10/2026)'),
  ('CGM', 'Gris mouchete', 'Cree depuis le classeur Liste ref fil (03/10/2026)'),
  ('CMG', 'Taupe (CMG)', 'Cree depuis le classeur Liste ref fil (03/10/2026)'),
  ('CML', 'Marron clair', 'Cree depuis le classeur Liste ref fil (03/10/2026)'),
  ('CR', 'Rose', 'Cree depuis le classeur Liste ref fil (03/10/2026)'),
  ('CT', 'Turquoise', 'Cree depuis le classeur Liste ref fil (03/10/2026)'),
  ('CZ', 'Vison', 'Cree depuis le classeur Liste ref fil (03/10/2026)')
ON CONFLICT (code_couleur_interne) DO NOTHING;

-- --- 2. Les donnees du classeur ---------------------------------------------
CREATE TEMP TABLE classeur (
    code_reference text, couleur text, couleur_interne text, famille text,
    reference_fournisseur text, description_commerciale text,
    stock_min_kg numeric, couverture_min_mois numeric, titrage text
) ON COMMIT DROP;
INSERT INTO classeur VALUES
  ('Jute 12/1', 'Beige', 'C5', '12/1', '12/1', 'FIL DE JUTE 12/1', NULL, NULL, '12/1'),
  ('Jute 16/2', 'Beige', 'C5', '16/2', '1800/2', 'FIL DE JUTE 16/2', NULL, NULL, '16/2'),
  ('Jute 20/2', 'Beige', 'C5', '20/2', '1440/2', 'FIL DE JUTE 20/2', NULL, NULL, '20/2'),
  ('Jute 24/1', 'Beige', 'C5', '24/1', '1200/1', 'FIL DE JUTE 24/1', NULL, NULL, '24/1'),
  ('Jute 30/1', 'Beige', 'C5', '30/1', '30/1', 'FIL DE JUTE 30/1', NULL, NULL, '30/1'),
  ('Jute 9,6/1', 'Beige', 'C5', '9,6/1', '3000/1', 'FIL DE JUTE 9,6/1', NULL, NULL, '9,6/1'),
  ('Jute 10/1', 'Beige', 'C5', '10/1', '2250/1', 'FIL DE JUTE 10/1', NULL, NULL, NULL),
  ('Bande', 'Beige', 'C5', 'LAINE', 'Bande', 'TAPE FROM NONWOVEN', NULL, NULL, NULL),
  ('PES Fdy-1500 Deniers-Taupe Fdy-811100-Gzm', 'Beige', 'C5', '1500-FDY', 'Fdy-811100', '1500 Denier polyester floss yarn Taupe', 3360.0, 2.5, '1500'),
  ('PES Fdy -1800 Deniers-Taupe Cf-4001 Turk', 'Beige', 'C5', '1800-FDY', 'Cf-4001', '100% POLYESTER FDY FLOSH', 2822.0, 2.5, '1800'),
  ('Micro PES-7360 Deniers-Multi Beige 1305-129-Suj', 'Beige', 'C5', 'MICRO-PES-7360', '1305-129', 'Pes Micro 7360D Soft Touch-5 1305-129 Multi Beige', 5956.0, 2.5, '7360'),
  ('PES Sh-1200 Deniers-Beige Cp-1432 Sf', 'Beige', 'C5', '1200-DENIERS-SHRINK', 'Cp-1432', '100% POLYESTER SHRINK 1200*1 Denier yarn 96*4 Filament', 3000.0, 2.0, '1200'),
  ('PES Sh-1500 Deniers-Beige Cp-2039 Sf', 'Beige', 'C5', '1500-DENIERS-SHRINK', 'Cp-2039', '100% POLYESTER DTY 1500*1 Denier (300*5);144 Filament', 2950.0, 1.0, '1500'),
  ('PES Sh-1500 Deniers- L.Beige H-2000-Tat', 'Beige', 'C5', '1500-DENIERS-SHRINK', 'H-2000', '1500 DENIER SHRINK POLYESTER', 3544.0, 2.5, '1500'),
  ('PES Sh-1500 Deniers-Beige Tex-7500 Text', 'Beige', 'C5', '1500-DENIERS-SHRINK', 'Tex-7500', 'PES DRAW TEXTURING YARN KRİNKIL 1500 DNY', 2956.0, 2.5, '1500'),
  ('PP-1750*2 Dtex-Sh Beige 44414 Hs', 'Beige', 'C5', '1750*2 DTEX', '44414', '100% PP FRISE YARN 1750*2 DTEX 460 FILAMENTS 205 TPM FINAL -S - 1,5 % softer', 8332.0, 2.0, '1750*2'),
  ('PP-1750*2 Dtex-Sh Beige 2204 Oz', 'Beige', 'C5', '1750*2 DTEX', '2204', '100% PP FRISE YARN 1750*2 DTEX 460 FILAMENTS 205 TPM FINAL -S - 1,5 % softer', 8332.0, NULL, NULL),
  ('PP FRZ-2900 Dtex-Beige 2204-Oz', 'Beige (C5S)', 'C5S', '2900-DTEX', '2204', '100% POLYPROPYLENE YARN 2900  DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 12500.0, 2.0, '2900'),
  ('PES Sh-1500 Deniers-Beige H-2001-Tat', 'Beige Fonce', 'C5N', '1500-DENIERS-SHRINK', 'H-2001', '1500 DENIER SHRINK POLYESTER', 3544.0, 2.5, '1500'),
  ('PES Fdy -1800 Deniers-White Cf-1001 Turk', 'Blanc', 'C00', '1800-FDY', 'Cf-1001', '100% POLYESTER FDY FLOSH', 2822.0, 2.5, '1800'),
  ('Micro PES-3600 Deniers Ivory 15-Tat', 'Blanc', 'C00', 'MICRO-PES-3600-DENIERS', '15', '300X2X6 MICRO POLYESTER', 3900.0, 2.5, '3600'),
  ('PES-3000 Deniers- WhiteSsl2331-Suj', 'Blanc', 'C00', '3000-DENIERS', 'Ssl2331', 'Dyed Multiply Polyester Tuxtured Yarn', 6720.0, 2.5, '3000'),
  ('PES Nylon', 'Blanc', 'C00', '1100-POLY', '1100', 'Polyester Yarn For Swing', NULL, NULL, '1100'),
  ('PES-Nylon', 'Blanc', 'C00', '1100-POLY', '1100', 'Polyester Yarn For Swing', NULL, NULL, '1100'),
  ('PES-20/2 GLOBALTEX', 'Blanc', 'C00', '12/2', '20/2', 'Polyester Spun 20/2', NULL, NULL, '20/2'),
  ('PES-20/2 LOMAT', 'Blanc', 'C00', '12/2', '20/2', 'Polyester Spun 20/2', NULL, NULL, '20/2'),
  ('PES-20/4 GLOBALTEX', 'Blanc', 'C00', '12/4', '20/4', 'Polyester Spun 20/4', NULL, NULL, '20/4'),
  ('PES-20/4 LOMAT', 'Blanc', 'C00', '12/4', '20/4', 'Polyester Spun 20/4', NULL, NULL, '20/4'),
  ('PLA 100 EXT', 'Blanc', 'C00', 'PLA-100', '100', 'GAINE EN P.E TRANSPARENT INDUSTRIEL 100 CM  (Ouvert  pérforé - 9 Micro avec grand trou)', NULL, NULL, NULL),
  ('PLA  EXT', 'Blanc', 'C00', 'PLA-140', '140', 'GAINE EN P.E TRANSPARENT INDUSTRIEL 1M et 40 cm  (Ouvert  pérforé - 9 Micro sans trou)', NULL, NULL, NULL),
  ('PLA  EXT', 'Blanc', 'C00', 'PLA-35', '35', 'GAINE EN P.E TRANSPARENT INDUSTRIEL SHRINK 35 CM  ( Ouvert à Droit ; pérforé - 8 Micro  avec petite trou))', NULL, NULL, NULL),
  ('PLA  CHE', 'Blanc', 'C00', 'PLA-35', '35', 'GAINE EN P.E TRANSPARENT INDUSTRIEL SHRINK 35 CM  ( Ouvert à Droit ; pérforé - 8 Micro  avec petite trou))', NULL, NULL, NULL),
  ('PLA  EXT', 'Blanc', 'C00', 'PLA-45', '45', 'GAINE EN P.E TRANSPARENT INDUSTRIEL SHRINK 45 CM  ( Ouvert à Droit ; pérforé - 8 Micro  avec petite trou))', NULL, NULL, NULL),
  ('PLA  EXT', 'Blanc', 'C00', 'PLA-50', '50', 'GAINE EN P.E TRANSPARENT INDUSTRIEL SHRINK 50 CM  ( Ouvert à Droit ; pérforé - 8 Micro  avec petite trou))', NULL, NULL, NULL),
  ('PLA  EXT', 'Blanc', 'C00', 'PLA-65', '65', 'GAINE EN P.E TRANSPARENT INDUSTRIEL SHRINK 65 CM  ( Ouvert à Droit ; pérforé - 8 Micro  avec petite trou))', NULL, NULL, NULL),
  ('PLA  EXT', 'Blanc', 'C00', 'PLA-80', '80', 'GAINE EN P.E TRANSPARENT INDUSTRIEL SHRINK 80 CM  ( Ouvert à Droit ; pérforé - 8 Micro  avec petite trou))', NULL, NULL, NULL),
  ('PLA  CHE', 'Blanc', 'C00', 'PLA-100', '100', 'GAINE EN P.E TRANSPARENT INDUSTRIEL 100 CM  (Ouvert  pérforé - 9 Micro avec grand trou)', NULL, NULL, NULL),
  ('PLA  CHE', 'Blanc', 'C00', 'PLA-140', '140', 'GAINE EN P.E TRANSPARENT INDUSTRIEL 1M et 40 cm  (Ouvert  pérforé - 9 Micro sans trou)', NULL, NULL, NULL),
  ('PLA  CHE', 'Blanc', 'C00', 'PLA-45', '45', 'GAINE EN P.E TRANSPARENT INDUSTRIEL SHRINK 45 CM  ( Ouvert à Droit ; pérforé - 8 Micro  avec petite trou))', NULL, NULL, NULL),
  ('PLA  CHE', 'Blanc', 'C00', 'PLA-50', '50', 'GAINE EN P.E TRANSPARENT INDUSTRIEL SHRINK 50 CM  ( Ouvert à Droit ; pérforé - 8 Micro  avec petite trou))', NULL, NULL, NULL),
  ('PLA  CHE', 'Blanc', 'C00', 'PLA-65', '65', 'GAINE EN P.E TRANSPARENT INDUSTRIEL SHRINK 65 CM  ( Ouvert à Droit ; pérforé - 8 Micro  avec petite trou))', NULL, NULL, NULL),
  ('PLA  CHE', 'Blanc', 'C00', 'PLA-80', '80', 'GAINE EN P.E TRANSPARENT INDUSTRIEL SHRINK 80 CM  ( Ouvert à Droit ; pérforé - 8 Micro  avec petite trou))', NULL, NULL, NULL),
  ('PP-1775*2 Dtex-White 1073-Tat', 'Blanc', 'C00', '1775*2-DTEX', '1073', 'REPALL/FINAL 1775DX2 FRZ- 300 FLAMENTS 165/S TPM', 7800.0, 2.5, '1775*2'),
  ('SBR 821', 'Blanc', 'C00', 'SBR-821', '821', 'Colle 821', NULL, NULL, '821'),
  ('Micro PES-3600 Deniers Shade 25-Tat', 'Blanc Mouchte', 'CG', 'MICRO-PES-3600-DENIERS', '25', '300X2X6 MICRO POLYESTER', 3900.0, NULL, NULL),
  ('PES Fdy-1500 Deniers-Bleu  Fdy-542030-Gzm', 'Bleu', 'C4', '1500-FDY', 'Fdy-542030', '1500 Denier polyester floss yarn Gold', 3360.0, 2.5, '1500'),
  ('PES-3000 Deniers- Bleu Ssl2244-Suj', 'Bleu', 'C4', '3000-DENIERS', 'Ssl2244', 'Dyed Multiply Polyester Tuxtured Yarn', 3360.0, 2.5, '3000'),
  ('PES Ver-1500 Deniers-BleuTex-8100 Text', 'Bleu', 'C4', 'VERONA-1500', 'Tex-8100', 'POLYESTER YARN VERRONA 1500 DENIERS', 2419.0, 2.5, '1500'),
  ('PP-1500 Dtex-Bleu 6666-Hs', 'Bleu', 'C4', '1500-DTEX', '6666', '100% PP 1500 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer', 4400.0, 2.0, '1500'),
  ('PP FRZ-2900 Dtex-Navy Bleu 1697-Tat', 'Bleu', 'C4', '2900-DTEX', '1697', '100% POLYPROPYLENE YARN 2900 DTEX FRIEZE,', 2688.0, 2.5, '2900'),
  ('PES -1500 Deniers-D.Bleu 1271-Gzm', 'Bleu Marine', 'C2', '1500-DENIERS', '1271', '100% POLYESTER DTY 1500*1 DENIER (300*5); 144 Flaments', 3360.0, 2.5, '1500'),
  ('PP-1500 Dtex-D.Bleu 6665-Hs', 'Bleu Marine', 'C2', '1500-DTEX', '6665', '100% PP 1500 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer', 4400.0, 2.0, '1500'),
  ('PP FRZ-2900 Dtex-D.Bleu 6417-Hs', 'Bleu Marine', 'C2', '2900-DTEX', '6417', '100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 4300.0, 2.0, '2900'),
  ('PP-1500 Dtex-D.Bleu 7200-Oz', 'Bleu Marine', 'C2', '1500-DTEX', '7200', '100% PP 1900 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer', 4400.0, 2.0, '1500'),
  ('PES Ver-1500 Deniers-TerraTex-8000 Text', 'Brique', 'CB', 'VERONA-1500', 'Tex-8000', 'POLYESTER YARN VERRONA 1500 DENIERS', 2419.0, 2.5, '1500'),
  ('PP-1900 Dtex- Cream 2951-Hs', 'C5N', 'C5N', '1900-DTEX', '2951', '100% PP 1900 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer', 4200.0, 2.0, '1900'),
  ('PP FRZ-2900 Dtex-Camel 44416-Hs', 'Camel(Marron Claire)', 'CBM', '2900-DTEX', '44416', '100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 4300.0, 2.0, '2900'),
  ('PES-3000 Deniers- Seker Cream Ssl2081-Suj', 'Cream', 'C5L', '3000-DENIERS', 'Ssl2081', 'Dyed Multiply Polyester Tuxtured Yarn', 6720.0, 2.5, '3000'),
  ('PES Sh-1200 Deniers-Cream B-Cb -1005 Sf', 'Cream', 'C5L', '1200-DENIERS-SHRINK', 'Cb -1005', '100% POLYESTER SHRINK 1200*1 Denier yarn 96*4 Filament', 8900.0, 2.0, '1200'),
  ('PES Sh-1500 Deniers-Vizon Cp-2018 Sf', 'Cream', 'C5L', '1500-DENIERS-SHRINK', 'Cp-2018', '100% POLYESTER DTY 1500*1 Denier (300*5);144 Filament', 2950.0, 1.0, '1500'),
  ('PES Sh-1200 Deniers- Cream Dtbc-H69-Gzm', 'Cream', 'C5L', '1200-DENIERS-SHRINK', 'Dtbc-H69', '100% POLYESTER SHRINK 1200*1 Denier yarn 96*4 Filament', 2688.0, 2.5, '1200'),
  ('PES Sh-1500 Deniers-Cream H-1008-Tat', 'Cream', 'C5L', '1500-DENIERS-SHRINK', 'H-1008', '1500 DENIER SHRINK POLYESTER', 3544.0, 2.5, '1500'),
  ('PP-1500 Dtex-Cream 2951-Hs', 'Cream', 'C5L', '1500-DTEX', '2951', '100% PP 1500 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer', 4400.0, 2.0, '1500'),
  ('PP-1750*2 Dtex-Sh Creme 2981 Hs', 'Cream', 'C5L', '1750*2 DTEX', '2981', '100% PP FRISE YARN 1750*2 DTEX 460 FILAMENTS 205 TPM FINAL -S - 1,5 % softer', 8332.0, 2.0, '1750*2'),
  ('PP FRZ-2900 Dtex-Cream 44412-Hs', 'Cream', 'C5L', '2900-DTEX', '44412', '100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 8600.0, 2.0, '2900'),
  ('PP-1000*2 Dtex-Cream Mn-1201-Tat', 'Cream', 'C5L', '1000X2-DTEX', 'Mn-1201', 'MN Final 1000x2 Dtex HS-360 FIL, 300/S TPM', 7765.0, 2.5, '1000*2'),
  ('PP-1775*2 Dtex-Cream 1072-Tat', 'Cream', 'C5L', '1775*2-DTEX', '1072', 'REPALL/FINAL 1775DX2 FRZ- 300 FLAMENTS 165/S TPM', 7800.0, 2.5, '1775*2'),
  ('PP FRZ-2900 Dtex-Cream 1104-Tat', 'Cream', 'C5L', '2900-DTEX', '1104', '100% POLYPROPYLENE YARN 2900 DTEX FRIEZE,', 5376.0, 2.5, '2900'),
  ('PES Sh -1200 Deniers-Cream Cb-1056 Turk', 'Cream CR', 'C5L', '1200-DENIERS-SHRINK', 'Cb-1056', '100% POLYESTER SHRINK 1200*1 Denier yarn 96*4 Filament', 2822.0, 2.5, '1200'),
  ('PP-1900 Dtex-D.Green 5455-Hs', 'Cvr', 'CVR', '1900-DTEX', '5455', '100% PP 1900 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer', 8400.0, 2.0, '1900'),
  ('PP-1500 Dtex-D.Bleu 7201-Oz', 'D.Bleu', 'CBR', '1500-DTEX', '7201', '100% PP 1900 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer', 4400.0, NULL, NULL),
  ('PP FRZ-2900 Dtex-Navy 7062 -Oz', 'D.Turkoi', 'CT', '2900-DTEX', '7062', '100% POLYPROPYLENE YARN 2900  DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 4166.0, 1.0, '2900'),
  ('PES-3000 Deniers- Dk.Vison Ssl2176-Suj', 'Dk Vison', 'CZ', '3000-DENIERS', 'Ssl2176', 'Dyed Multiply Polyester Tuxtured Yarn', 6720.0, 2.5, '3000'),
  ('PES -1500 Deniers-Grey 1274-Gzm', 'Gris', 'CG', '1500-DENIERS', '1274', '100% POLYESTER DTY 1500*1 DENIER (300*5); 144 Flaments', 3360.0, 2.5, '1500'),
  ('PES Sh-1200 Deniers-Cpbt Grey 801-Tat', 'Gris', 'CG', '1200-DENIERS-SHRINK', '801', '1200 DENIER SHRINK POLYESTER', 2688.0, 2.5, '1200'),
  ('PES Sh -1200 Deniers-Grey Cb-7A Turk', 'Gris', 'CG', '1200-DENIERS-SHRINK', 'Cb-7A', '100% POLYESTER SHRINK 1200*1 Denier yarn 96*4 Filament', 2822.0, 2.5, '1200'),
  ('PP-1750*2 Dtex-Sh Gris 9168 Oz', 'Gris', 'CG', '1750*2 DTEX', '9168', '100% PP FRISE YARN 1750*2 DTEX 460 FILAMENTS 205 TPM FINAL -S - 1,5 % softer', 8332.0, NULL, NULL),
  ('PP FRZ-2900 Dtex- Grey 8933-Hs', 'Gris Claire', 'CGL', '2900-DTEX', '8933', '100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 8600.0, 2.0, '2900'),
  ('PP FRZ-2900 Dtex- Grey 9095-Oz', 'Gris Claire', 'CGL', '2900-DTEX', '9095', '100% POLYPROPYLENE YARN 2900  DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 8333.0, 2.0, '2900'),
  ('PES Sh-1200 Deniers-Antrasit 802-Tat', 'Gris Mouchte', 'CGM', '1200-DENIERS-SHRINK', '802', '1200 DENIER SHRINK POLYESTER', 2688.0, 2.5, '1200'),
  ('PP FRZ-2900 Dtex-Grey 10575-Hs', 'Gris Mouchte', 'CG', '2900-DTEX', '10575', '100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 8600.0, 2.0, '2900'),
  ('PP FRZ-2900 Dtex-Grey 39025-Oz', 'Gris Mouchte', 'CG', '2900-DTEX', '39025', '100% POLYPROPYLENE YARN 2900  DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 8333.0, NULL, NULL),
  ('PES-3000 Deniers- Dark Grey Ssl2069-Suj', 'Grris', 'CG', '3000-DENIERS', 'Ssl2069', 'Dyed Multiply Polyester Tuxtured Yarn', 6720.0, 2.5, '3000'),
  ('PES-3000 Deniers- Khave Ssl2279-Suj', 'Khave', 'CM', '3000-DENIERS', 'Ssl2279', 'Dyed Multiply Polyester Tuxtured Yarn', 3360.0, 2.5, '3000'),
  ('Micro PES-7360 Deniers-Multi L.Beige 1305-130-Suj', 'L.Beige', 'C5I', 'MICRO-PES-7360', '1305-130', 'Pes Micro 7360D Soft Touch-5 1305-130 Multi L.Beige', 5956.0, 2.5, '7360'),
  ('PES -1500 Deniers-L.Beige 1273-Gzm', 'L.Beige', 'C5I', '1500-DENIERS', '1273', '100% POLYESTER DTY 1500*1 DENIER (300*5); 144 Flaments', 3360.0, 2.5, '1500'),
  ('PP-1500 Dtex-L.Beige 44377-Hs', 'L.Beige', 'C5L', '1500-DTEX', '44377', '100% PP 1500 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer', 4400.0, 2.0, '1500'),
  ('PP-1000*2 Dtex-Beige Mn-3203 L-Tat', 'L.Beige', 'C5I', '1000X2-DTEX', 'Mn-3203', 'MN Final 1000x2 Dtex HS-360 FIL, 300/S TPM', 7765.0, 2.5, '1000*2'),
  ('Micro PES-7360 Deniers-Multi L.Brown 1305-61-Suj', 'L.Brown', 'CML', 'MICRO-PES-7360', '1305-61', 'Pes Micro 7360D Soft Touch-5 1305-61 Multi L.Brown', 2960.0, 2.5, '7360'),
  ('PES Fdy-1500 Deniers-Marron Fdy-36005-Gzm', 'Marron', 'CM', '1500-FDY', 'Fdy-36005', '1500 Denier polyester floss yarn Marron', 3360.0, 2.5, '1500'),
  ('PES Sh-1500 Deniers-D.Vizon Cp-2068 Sf', 'Marron', 'CM', '1500-DENIERS-SHRINK', 'Cp-2068', '100% POLYESTER DTY 1500*1 Denier (300*5);144 Filament', 2950.0, 1.0, '1500'),
  ('PES Sh-1500 Deniers-D.VizonTex-7521 Text', 'Marron', 'CM', '1500-DENIERS-SHRINK', 'Tex-7521', 'PES DRAW TEXTURING YARN KRİNKIL 1500 DNY', 5913.0, 2.5, '1500'),
  ('PP-1750*2 Dtex-Sh Brown 44415 Hs', 'Marron', 'CM', '1750*2 DTEX', '44415', '100% PP FRISE YARN 1750*2 DTEX 460 FILAMENTS 205 TPM FINAL -S - 1,5 % softer', 8332.0, 2.0, '1750*2'),
  ('PP-1750*2 Dtex-Sh Brown 6161 Oz', 'Marron', 'CM', '1750*2 DTEX', '6161', '100% PP FRISE YARN 1750*2 DTEX 460 FILAMENTS 205 TPM FINAL -S - 1,5 % softer', 8332.0, NULL, NULL),
  ('PP FRZ-2900 Dtex-Brown 44361-Hs', 'Marron (CMS)', 'CM', '2900-DTEX', '44361', '100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 12900.0, 2.0, '2900'),
  ('PP FRZ-2900 Dtex-Brown 6161-Oz', 'Marron (CMS)', 'CM', '2900-DTEX', '6161', '100% POLYPROPYLENE YARN 2900  DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 12500.0, 2.0, '2900'),
  ('Cuir', 'Noir', 'C0', 'IMITATION-CUIR', 'CUIR', 'IMITATION LEATHER', NULL, NULL, NULL),
  ('PP FRZ-2900 Dtex-Black 8001-Hs', 'Noir', 'C2', '2900-DTEX', '8001', '100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 8600.0, 2.0, '2900'),
  ('PP FRZ-2900 Dtex-Black 9000-Oz', 'Noir', 'C2', '2900-DTEX', '9000', '100% POLYPROPYLENE YARN 2900  DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 8333.0, 2.0, '2900'),
  ('PES Fdy-1500 Deniers-Olive Fdy-93005-Gzm', 'Olive', 'CVR', '1500-FDY', 'Fdy-93005', '1500 Denier polyester floss yarn Olive', 3360.0, 2.5, '1500'),
  ('PES Fdy-1500 Deniers-Gold Fdy-33005-Gzm', 'Or', 'C1', '1500-FDY', 'Fdy-33005', '1500 Denier polyester floss yarn GOLD', 6720.0, 2.5, '1500'),
  ('PES Fdy -1800 Deniers-Gold Cf-101 Turk', 'Or', 'C1', '1800-FDY', 'Cf-101', '100% POLYESTER FDY FLOSH', 2822.0, 2.5, '1800'),
  ('PES-3000 Deniers- Dk.Beige Ssl2271-Suj', 'Or', 'C1', '3000-DENIERS', 'Ssl2271', 'Dyed Multiply Polyester Tuxtured Yarn', 6720.0, 2.5, '3000'),
  ('PES-1500 Deniers-Gold Cb-4016 Sf', 'Or', 'C1', '1500-DENIERS', 'Cb-4016', '100% POLYESTER DTY 1500*1 Denier (300*5);144 Filament', 3360.0, 2.0, '1500'),
  ('PP-1500 Dtex-Yellow 3430-Hs', 'Or', 'C1', '1500-DTEX', '3430', '100% PP 1500 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer', 4400.0, 2.0, '1500'),
  ('PP FRZ-2900 Dtex-Gold 3423-Hs', 'Or', 'C1', '2900-DTEX', '3423', '100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 8600.0, 2.0, '2900'),
  ('PP-1500 Dtex-Yellow 3151-Oz', 'Or', 'C1', '1500-DTEX', '3151', '100% PP 1900 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer', 4400.0, 2.0, '1500'),
  ('PP FRZ-2900 Dtex-Gold 3034-Oz', 'Or', 'C1', '2900-DTEX', '3034', '100% POLYPROPYLENE YARN 2900  DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 8333.0, 2.0, '2900'),
  ('PES Fdy-1500 Deniers-Rose Fdy-423020-Gzm', 'Rose', 'CR', '1500-FDY', 'Fdy-423020', '1500 Denier polyester floss yarn Rose', 3360.0, 2.5, '1500'),
  ('PES-3000 Deniers- Pink Ssl2259-Suj', 'Rose', 'CR', '3000-DENIERS', 'Ssl2259', 'Dyed Multiply Polyester Tuxtured Yarn', 3360.0, 2.5, '3000'),
  ('PP-1500 Dtex-Pink 7623-Hs', 'Rose', 'CR', '1500-DTEX', '7623', '100% PP 1500 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer', 4400.0, 1.0, '1500'),
  ('PP FRZ-2900 Dtex-Pink 7639-Hs', 'Rose', 'CR', '2900-DTEX', '7639', '100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 4300.0, 1.0, '2900'),
  ('PES-3000 Deniers- Rouge Ssl2232-Suj', 'Rouge', 'C3', '3000-DENIERS', 'Ssl2232', 'Dyed Multiply Polyester Tuxtured Yarn', 6720.0, 2.5, '3000'),
  ('PES -1200 Deniers-Anty Bordeau 61043-Gzm', 'Rouge', 'C3', '1200-DENIERS', '61043', '100% POLYESTER DTY ANATOLIA 1200*1 DENIER (300*4); 144 filament', 11500.0, 2.5, '1200'),
  ('PES -1500 Deniers-Bordeau 61043-Gzm', 'Rouge', 'C3', '1500-DENIERS', '61043', '100% POLYESTER DTY ANATOLIA 1500*1 DENIER (300*5); 144 Flaments', 10750.0, 2.5, '1500'),
  ('PP FRZ-2900 Dtex- Red 7612-Hs', 'Rouge', 'C3', '2900-DTEX', '7612', '100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 12900.0, 2.0, '2900'),
  ('PP FRZ-2900 Dtex- Red 5009-Oz', 'Rouge', 'C3', '2900-DTEX', '5009', '100% POLYPROPYLENE YARN 2900  DTEX FRISE, 360 FIL.115 TPM, "S" TWIST', 12500.0, NULL, NULL),
  ('PP-1900 Dtex-L.Beige 44377-Hs', 'Taupe', 'CMG', '1900-DTEX', '44377', '100% PP 1900 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer', 12600.0, 2.0, '1900'),
  ('PES Fdy-1500 Deniers-Turkoise Fdy-513020-Gzm', 'Turkoise', 'CT', '1500-FDY', 'Fdy-513020', '1500 Denier polyester floss yarn Turkoise', 3360.0, 2.5, '1500'),
  ('PES -1500 Deniers-Green 1272-Gzm', 'Vert', 'CV', '1500-DENIERS', '1272', '100% POLYESTER DTY 1500*1 DENIER (300*5); 144 Flaments', 3360.0, 2.5, '1500'),
  ('PP FRZ-2900 Dtex-Green Mlt 18-Tat', 'Vert', 'CV', '2900-DTEX', '18', '100% POLYPROPYLENE YARN 2900 DTEX FRIEZE,', 2688.0, 2.5, '2900'),
  ('PES-3000 Deniers- Vison Ssl2247-Suj', 'Vison', 'CZ', '3000-DENIERS', 'Ssl2247', 'Dyed Multiply Polyester Tuxtured Yarn', 6720.0, 2.5, '3000'),
  ('PES Sh-1500 Deniers-VizonTex-7530 Text', 'Vizon', 'CZ', '1500-DENIERS-SHRINK', 'Tex-7530', 'PES DRAW TEXTURING YARN KRİNKIL 1500 DNY', 5913.0, 2.5, '1500');

UPDATE reference r SET
    couleur                 = COALESCE(c.couleur, r.couleur),
    code_couleur_interne    = COALESCE((SELECT x.code_couleur_interne FROM couleur x
                                         WHERE x.code_couleur_interne = c.couleur_interne), r.code_couleur_interne),
    code_famille            = COALESCE((SELECT x.code_famille FROM famille x
                                         WHERE x.code_famille = c.famille), r.code_famille),
    reference_fournisseur   = COALESCE(c.reference_fournisseur, r.reference_fournisseur),
    description_commerciale = COALESCE(c.description_commerciale, r.description_commerciale),
    stock_min_kg            = COALESCE(c.stock_min_kg, r.stock_min_kg),
    couverture_min_mois     = COALESCE(c.couverture_min_mois, r.couverture_min_mois),
    titrage                 = COALESCE(NULLIF(btrim(r.titrage), ''), c.titrage)
  FROM classeur c
 WHERE c.code_reference = r.code_reference;

-- --- 3. Ce que le classeur ne dit pas : les regles des parametres -----------
-- Le titrage du jute EST sa famille (Jute 12/1 : 12/1) : la regle comble Jute 10/1.
UPDATE reference SET titrage = code_famille
 WHERE code_categorie = 'JUT' AND COALESCE(btrim(titrage), '') = '' AND code_famille IS NOT NULL;
UPDATE reference SET couverture_min_mois =
       (SELECT valeur_courante::numeric FROM parametre WHERE code_parametre = 'P_CouvMinMois')
 WHERE couverture_min_mois IS NULL;
UPDATE reference SET marge_securite_pct =
       (SELECT valeur_courante::numeric FROM parametre WHERE code_parametre = 'P_MargeSecurite')
 WHERE marge_securite_pct IS NULL;
-- F3, calculee AVANT d'etre ecrite : le stock minimum saisi est vide, la vue
-- rend donc le MAX des trois autres securites.
UPDATE reference r SET stock_min_kg = round(v.stock_min_kg, 0)
  FROM v_stock_min_dynamique v
 WHERE v.code_reference = r.code_reference AND r.stock_min_kg IS NULL;
UPDATE reference SET seuil_lot_valeur =
       CASE WHEN COALESCE(poids_bobine_kg, 0) > 0
            THEN (SELECT valeur_courante::numeric FROM parametre WHERE code_parametre = 'P_LotSeuilBobines')
            ELSE (SELECT valeur_courante::numeric FROM parametre WHERE code_parametre = 'P_LotSeuilRestesKg') END
 WHERE seuil_lot_valeur IS NULL;

-- --- 4. Preuve ----------------------------------------------------------------
SELECT 'references : ' || count(*)
    || ' ; sans description commerciale : ' || count(*) FILTER (WHERE COALESCE(description_commerciale, '') = '')
    || ' ; sans couleur interne : ' || count(*) FILTER (WHERE code_couleur_interne IS NULL)
    || ' ; sans stock minimum : ' || count(*) FILTER (WHERE stock_min_kg IS NULL)
    || ' ; stock minimum a zero : ' || count(*) FILTER (WHERE stock_min_kg = 0)
    || ' ; sans couverture : ' || count(*) FILTER (WHERE couverture_min_mois IS NULL)
    || ' ; sans marge : ' || count(*) FILTER (WHERE marge_securite_pct IS NULL)
    || ' ; sans minimum de lot : ' || count(*) FILTER (WHERE seuil_lot_valeur IS NULL)
    || ' ; sans titrage : ' || count(*) FILTER (WHERE COALESCE(titrage, '') = '') AS bilan
  FROM reference;

COMMIT;
