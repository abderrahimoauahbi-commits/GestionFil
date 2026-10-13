-- LES CODES COULEUR DE CHAQUE FOURNISSEUR, 14 septembre 2026.
--
-- Le rouge de la maison est C3. Chez Hasirci il s'ecrit « RED - 7612 », chez
-- Ozkaralar « RED OZ 5109 », chez Sofia « CB 1004 ». Cette table est ce qui
-- permet de reconnaitre une couleur sur une facture et de rapprocher deux
-- fournisseurs du meme fil.
--
-- POURQUOI CE FICHIER EXISTE. La table a ete creee le 12 septembre
-- (2026-09-12e) mais ses lignes avaient ete ecrites directement dans la base de
-- developpement par un script d'extraction. La production a donc recu une table
-- vide, et rien ne pouvait la remplir : une donnee de referentiel qui ne vit
-- que dans une base n'est pas reproductible.
--
-- Le supplement de teinture est en DOLLARS PAR TONNE, pas en pourcentage :
-- l'or a 200 $/t et le rouge a 530 $/t se lisent tels quels sur les feuilles de
-- prix (2,02 - 200/1000 = 2,35 - 530/1000 = 1,82 $/kg de base).
--
-- Rejouable : la contrainte d'unicite porte sur (fournisseur, code couleur).

INSERT INTO couleur_fournisseur
    (code_fournisseur, code_couleur, libelle, code_couleur_interne,
     supplement_teinture, actif) VALUES
    ('FRS-001', '2951', 'CREAM', 'C5N', NULL, 1),
    ('FRS-001', '5455', 'D.GREEN', 'CVR', NULL, 1),
    ('FRS-001', '6666', 'BLUE', 'C4', NULL, 1),
    ('FRS-001', 'BEIGE - 44360', 'BEIGE', 'C5S', 150.0000, 1),
    ('FRS-001', 'BLACK - 8001', 'NOIRE', 'C2', 100.0000, 1),
    ('FRS-001', 'BROWN - 44361', 'MARRON', 'CMS', 200.0000, 1),
    ('FRS-001', 'CREAM -44412', 'BEIGE', 'C5', NULL, 1),
    ('FRS-001', 'D. GREEN- 5449', 'VERT FONCE', 'CVR', 400.0000, 1),
    ('FRS-001', 'GOLD - 3423', 'OR', 'C1', 200.0000, 1),
    ('FRS-001', 'GREY - 8933', 'GRIS CLAIR', 'CG', 150.0000, 1),
    ('FRS-001', 'RED - 7612', 'ROUGE', 'C3', 530.0000, 1),
    ('FRS-004', 'CREAM 1104', NULL, 'C5N', NULL, 1),
    ('FRS-005', 'A/GREEN OZ8068', 'Vert Roi', 'CVR', 330.0000, 1),
    ('FRS-005', 'BEJ OZ 2204', 'SH. biege', 'C5S', 150.0000, 1),
    ('FRS-005', 'BLACK OZ 9000', 'NOIR', 'C2', 100.0000, 1),
    ('FRS-005', 'BROWN OZ 6161', 'SH. brown', 'CMS', 150.0000, 1),
    ('FRS-005', 'GOLD OZ 3034', 'OR', 'C1', 150.0000, 1),
    ('FRS-005', 'GREY OZ 9055', 'GRIS', 'CG', 100.0000, 1),
    ('FRS-005', 'OZ 7201', 'BLUE', 'C4', NULL, 1),
    ('FRS-005', 'RED OZ 5109', 'ROUGE', 'C3', NULL, 1),
    ('FRS-007', 'CB-118', 'BEIGE', 'C6', NULL, 1),
    ('FRS-007', 'CB 1004', 'RED', 'C3', NULL, 1),
    ('FRS-007', 'CB 118', 'L.BEIGE', 'C6', NULL, 1),
    ('FRS-007', 'CB 1206', 'BLUE', 'C4', NULL, 1),
    ('FRS-007', 'CB 153', 'BEIGE', 'C5', NULL, 1),
    ('FRS-007', 'CB 284', 'GOLD', 'C1', NULL, 1),
    ('FRS-007', 'CB 72', 'BEIGE', 'C8', NULL, 1),
    ('FRS-008', 'TEX-1140', 'BEIGE', 'C8', NULL, 1),
    ('FRS-008', 'TEX-1142', 'BEIGE', 'C5', NULL, 1),
    ('FRS-008', 'TEX-1431', 'GRIS', 'CG', NULL, 1),
    ('FRS-008', 'TEX-1470', 'TURQUOISE', 'C4', NULL, 1),
    ('FRS-008', 'TEX-1531', 'ROSE', 'C7', NULL, 1),
    ('FRS-008', 'TEX-1595', 'VERT', 'CV', NULL, 1),
    ('FRS-008', 'TEX-1714', 'MARRON', 'CM', NULL, 1),
    ('FRS-008', 'TEX-1755', 'BORDEAUX', 'C3', NULL, 1),
    ('FRS-008', 'TEX-2040', 'VISON', 'CMS', NULL, 1),
    ('FRS-008', 'TEX 1012', 'CREAM', 'C5', NULL, 1),
    ('FRS-008', 'TEX 1042', 'MARRON', 'C6', NULL, 1)
ON CONFLICT (code_fournisseur, code_couleur) DO UPDATE SET
    libelle              = excluded.libelle,
    code_couleur_interne = excluded.code_couleur_interne,
    supplement_teinture  = excluded.supplement_teinture,
    actif                = excluded.actif;
