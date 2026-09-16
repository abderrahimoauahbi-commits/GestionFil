-- ===========================================================================
-- LE CATALOGUE REMIS SUR LE CLASSEUR « Liste ref fil.xlsx » (16 septembre 2026)
--
-- Le classeur est un export du catalogue du 15 septembre, retravaille a la main :
-- les plastiques y sont dedoublonnes et rattaches a leur fournisseur, les
-- familles et les references fournisseur sont renseignees, et 94 lignes
-- recoivent un stock minimum.
--
-- CE QUI N'EST PAS DEVINE. La couleur interne n'est posee que la ou le classeur
-- la donne. 69 references gardent le nom de couleur de leur fournisseur sans
-- couleur de la maison : c'est un travail de classement qui se fait a l'ecran
-- « Completer les references », pas par un rapprochement automatique. Une
-- couleur fausse range du stock sous la mauvaise teinte, et cela ne se voit pas.
--
-- LE PRIX ET LE STOCK NE SONT PAS TOUCHES : la mise a jour ne touche jamais
-- `prix_catalogue`. La seule reference CREEE ici — Jute 10/1 — part a zero,
-- parce que le classeur ne donne pas son prix et qu'un prix invente fausse le
-- cout de revient sans laisser de trace. L'assistant de completion la signale.
-- ===========================================================================

BEGIN;

-- --- 1. Les familles que le classeur introduit ------------------------------
-- La famille est le TITRAGE a l'interieur d'une categorie : « 1500-DTEX »,
-- « 12/1 ». C'est sur elle que l'atelier raisonne, et c'est elle qui portait
-- jusqu'ici le vide sur presque tout le catalogue.
INSERT INTO famille (code_categorie, code_famille, libelle, actif) VALUES
  ('CUI', 'IMITATION-CUIR', 'IMITATION-CUIR', 1),
  ('JUT', '12/1', '12/1', 1),
  ('JUT', '16/2', '16/2', 1),
  ('JUT', '20/2', '20/2', 1),
  ('JUT', '24/1', '24/1', 1),
  ('JUT', '30/1', '30/1', 1),
  ('JUT', '9,6/1', '9,6/1', 1),
  ('JUT', '10/1', '10/1', 1),
  ('LAI', 'LAINE', 'LAINE', 1),
  ('PES', '1500-FDY', '1500-FDY', 1),
  ('PES', '1800-FDY', '1800-FDY', 1),
  ('PES', 'MICRO-PES-3600-DENIERS', 'MICRO-PES-3600-DENIERS', 1),
  ('PES', 'MICRO-PES-7360', 'MICRO-PES-7360', 1),
  ('PES', 'VERONA-1500', 'VERONA-1500', 1),
  ('PES', '1200-DENIERS', '1200-DENIERS', 1),
  ('PES', '1100-POLY', '1100-POLY', 1),
  ('PES-CH', '12/2', '12/2', 1),
  ('PES-CH', '12/4', '12/4', 1),
  ('PES-PO', '1500-DENIERS', '1500-DENIERS', 1),
  ('PES-SH', '1200-DENIERS-SHRINK', '1200-DENIERS-SHRINK', 1),
  ('PES-SH', '1500-DENIERS-SHRINK', '1500-DENIERS-SHRINK', 1),
  ('PP', '1500-DTEX', '1500-DTEX', 1),
  ('PP', '1750*2 DTEX', '1750*2 DTEX', 1),
  ('PP', '1900-DTEX', '1900-DTEX', 1),
  ('PP', '2900-DTEX', '2900-DTEX', 1),
  ('PP', '1000X2-DTEX', '1000X2-DTEX', 1),
  ('PP', '1775*2-DTEX', '1775*2-DTEX', 1)
ON CONFLICT (code_famille) DO NOTHING;   -- la cle primaire porte sur le seul code

-- --- 2. Les renommages ------------------------------------------------------
-- `Plastique-100` (CHEMS) et `Plastique 100` (EXTRA PLAST) ne se distinguaient
-- que par un trait d'union : personne ne pouvait choisir la bonne a la saisie.
-- Elles deviennent `PLA 100 CHE` et `PLA 100 EXT`.
--
-- ON NE SUPPRIME PAS POUR RECREER. 65 lignes de composition de qualite citent
-- ces codes, plus 15 rattachements d'equivalence et une proposition d'achat :
-- les detruire viderait les recettes de l'atelier. Les cles etrangeres ne
-- propagent pas (NO ACTION), donc on pose la fiche neuve, on fait suivre les
-- 22 colonnes qui la citent, et on retire l'ancienne. Dans CETTE transaction.
CREATE TEMP TABLE renom (ancien text PRIMARY KEY, neuf text NOT NULL) ON COMMIT DROP;
INSERT INTO renom (ancien, neuf) VALUES
  ('Micro PES-3600 Deniers Shade 25 -Tat', 'Micro PES-3600 Deniers Shade 25-Tat'),
  ('Plastique 100', 'PLA 100 EXT'),
  ('Plastique 140', 'PLA 140 EXT'),
  ('Plastique 35', 'PLA 35 EXT'),
  ('Plastique 45', 'PLA 45 EXT'),
  ('Plastique 50', 'PLA 50 EXT'),
  ('Plastique 65', 'PLA 65 EXT'),
  ('Plastique 80', 'PLA 80 EXT'),
  ('Plastique-100', 'PLA 100 CHE'),
  ('Plastique-140', 'PLA 140 CHE'),
  ('Plastique-35', 'PLA 35 CHE'),
  ('Plastique-45', 'PLA 45 CHE'),
  ('Plastique-50', 'PLA 50 CHE'),
  ('Plastique-65', 'PLA 65 CHE'),
  ('Plastique-80', 'PLA 80 CHE');

-- La fiche neuve est une COPIE CONFORME de l'ancienne, code mis a part : tout
-- ce qu'elle portait — prix, seuils, conditionnement — doit survivre.
--
-- LES COLONNES SE NOMMENT UNE A UNE, et ce n'est pas de la verbosite :
-- `facteur_kg` et `prix_catalogue_kg` sont CALCULEES par la base, et PostgreSQL
-- refuse qu'on leur donne une valeur. Un `SELECT *` les emporte avec le reste.
INSERT INTO reference (
  code_reference, code_categorie, code_fournisseur, designation, type_fil,
  couleur, titrage, unite_catalogue, poids_bobine_kg, bobines_par_palette,
  densite_kg_ml, prix_catalogue, code_devise_catalogue,
  date_prix_catalogue, stock_min_kg, couverture_min_mois,
  marge_securite_pct, moq_kg, multiple_achat_kg, classe_abc, classe_xyz,
  date_dernier_abc, cmup_mad, date_dernier_cmup, suivi_lot, actif,
  date_creation, id_utilisateur_creation, code_couleur, code_famille,
  code_couleur_interne, reference_fournisseur, supplement_teinture,
  origine
)
SELECT
  n.neuf, r.code_categorie, r.code_fournisseur, r.designation, r.type_fil,
  r.couleur, r.titrage, r.unite_catalogue, r.poids_bobine_kg,
  r.bobines_par_palette, r.densite_kg_ml, r.prix_catalogue,
  r.code_devise_catalogue, r.date_prix_catalogue, r.stock_min_kg,
  r.couverture_min_mois, r.marge_securite_pct, r.moq_kg,
  r.multiple_achat_kg, r.classe_abc, r.classe_xyz, r.date_dernier_abc,
  r.cmup_mad, r.date_dernier_cmup, r.suivi_lot, r.actif, r.date_creation,
  r.id_utilisateur_creation, r.code_couleur, r.code_famille,
  r.code_couleur_interne, r.reference_fournisseur, r.supplement_teinture,
  r.origine
  FROM reference r JOIN renom n ON n.ancien = r.code_reference;

UPDATE archive_reception        x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE besoin_mrp               x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE historique_prix          x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE import_ajustements_cump  x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE import_facture_lignes    x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE ligne_bc                 x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE ligne_inventaire         x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE ligne_mouvement          x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE ligne_reception          x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE ligne_transfert          x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE machine_cliche           x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE machine_consommation     x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE machine_etat             x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE machine_fiche_ligne      x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE plan_achat               x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE plan_achat               x SET code_reference_origine = n.neuf FROM renom n WHERE x.code_reference_origine = n.ancien;
UPDATE recette                  x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE reference_groupe_equiv   x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE snapshot_mrp             x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE stock_lot                x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE stock_magasin            x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;
UPDATE valorisation_stock       x SET code_reference         = n.neuf FROM renom n WHERE x.code_reference = n.ancien;

DELETE FROM reference r USING renom n WHERE r.code_reference = n.ancien;

-- --- 3. Chaque reference, telle que le classeur la decrit --------------------
-- ON MET A JOUR, ON NE REINSERE PAS. Un `INSERT ... ON CONFLICT` doit d'abord
-- former la ligne proposee ENTIERE, et cette ligne doit franchir toutes les
-- contraintes : `prix_catalogue > 0`, et une unite en « ml » exige sa densite.
-- Le classeur ne porte ni prix ni densite — il decrit un classement, pas un
-- tarif. La ligne proposee tombait donc a zero et la base la refusait, a juste
-- titre. On corrige ce que le classeur dit, et RIEN D'AUTRE.
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
  ('PES Fdy -1800 Deniers-Gold Cf-101 Turk', 'PES', 'FRS-007', 'FIL-1800-FDY', 'Cf-101', 'kg', 'C1', 2822),
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
  ('PES -1500 Deniers-Grey 1274-Gzm', 'PES-PO', 'FRS-003', '1500-DENIERS', '1274', 'kg', NULL, 3360),
  ('PES -1500 Deniers-Green 1272-Gzm', 'PES-PO', 'FRS-003', '1500-DENIERS', '1272', 'kg', NULL, 3360),
  ('PES -1500 Deniers-L.Beige 1273-Gzm', 'PES-PO', 'FRS-003', '1500-DENIERS', '1273', 'kg', NULL, 3360),
  ('PES -1500 Deniers-D.Bleu 1271-Gzm', 'PES-PO', 'FRS-003', '1500-DENIERS', '1271', 'kg', NULL, 3360),
  ('PES -1500 Deniers-Bordeau 61043-Gzm', 'PES-PO', 'FRS-003', '1500-DENIERS', '61043', 'kg', 'C3', 10750),
  ('PES-1500 Deniers-Gold Cb-4016 Sf', 'PES-PO', 'FRS-002', '1500-DENIERS', 'Cb-4016', 'kg', 'C1', 3360),
  ('PES Sh-1200 Deniers-Cream B-Cb -1005 Sf', 'PES-SH', 'FRS-002', '1200-DENIERS-SHRINK', 'Cb -1005', 'kg', NULL, 8900),
  ('PES Sh-1200 Deniers-Beige Cp-1432 Sf', 'PES-SH', 'FRS-002', '1200-DENIERS-SHRINK', 'Cp-1432', 'kg', 'C5', 3000),
  ('PES Sh-1500 Deniers-D.Vizon Cp-2068 Sf', 'PES-SH', 'FRS-002', '1500-DENIERS-SHRINK', 'Cp-2068', 'kg', 'CM', 2950),
  ('PES Sh-1500 Deniers-Vizon Cp-2018 Sf', 'PES-SH', 'FRS-002', '1500-DENIERS-SHRINK', 'Cp-2018', 'kg', NULL, 2950),
  ('PES Sh-1200 Deniers-Antrasit 802-Tat', 'PES-SH', 'FRS-004', '1200-DENIERS-SHRINK', '802', 'kg', NULL, 2688),
  ('PES Sh-1200 Deniers-Cpbt Grey 801-Tat', 'PES-SH', 'FRS-004', '1200-DENIERS-SHRINK', '801', 'kg', NULL, 2688),
  ('PES Sh-1200 Deniers- Cream Dtbc-H69-Gzm', 'PES-SH', 'FRS-003', '1200-DENIERS-SHRINK', 'Dtbc-H69', 'kg', NULL, 2688),
  ('PES Sh-1500 Deniers-Beige Cp-2039 Sf', 'PES-SH', 'FRS-002', '1500-DENIERS-SHRINK', 'Cp-2039', 'kg', 'C5', 2950),
  ('PES Sh-1500 Deniers- L.Beige H-2000-Tat', 'PES-SH', 'FRS-004', '1500-DENIERS-SHRINK', 'H-2000', 'kg', 'C5', 3544),
  ('PES Sh -1200 Deniers-Cream B Cp-1005Turk', 'PES-SH', 'FRS-007', '1200-DENIERS-SHRINK', 'Cp-1005', 'kg', NULL, 16934),
  ('PES Sh -1200 Deniers-Cream Cb-1056 Turk', 'PES-SH', 'FRS-007', '1200-DENIERS-SHRINK', 'Cb-1056', 'kg', NULL, 2822),
  ('PES Sh -1200 Deniers-Cream Cb-1426 Turk', 'PES-SH', 'FRS-007', '1200-DENIERS-SHRINK', 'Cb-1426', 'kg', 'C5', 5644),
  ('PES Sh -1200 Deniers-Grey Cb-7A Turk', 'PES-SH', 'FRS-007', '1200-DENIERS-SHRINK', 'Cb-7A', 'kg', NULL, 2822),
  ('PES Sh-1500 Deniers-D.VizonTex-7521 Text', 'PES-SH', 'FRS-008', '1500-DENIERS-SHRINK', 'Tex-7521', 'kg', 'CM', 5913),
  ('PES Sh-1500 Deniers-VizonTex-7530 Text', 'PES-SH', 'FRS-008', '1500-DENIERS-SHRINK', 'Tex-7530', 'kg', NULL, 5913),
  ('PES Sh-1500 Deniers-Beige H-2001-Tat', 'PES-SH', 'FRS-004', '1500-DENIERS-SHRINK', 'H-2001', 'kg', 'C5N', 3544),
  ('PES Sh-1500 Deniers-Beige Tex-7500 Text', 'PES-SH', 'FRS-008', '1500-DENIERS-SHRINK', 'Tex-7500', 'kg', 'C5', 2956),
  ('PES Sh-1500 Deniers-Cream H-1008-Tat', 'PES-SH', 'FRS-004', '1500-DENIERS-SHRINK', 'H-1008', 'kg', NULL, 3544),
  ('PLA 100 EXT', 'PLA', 'FRS-012', 'PLA-100', '100', 'kg', NULL, NULL),
  ('PLA 140 EXT', 'PLA', 'FRS-012', 'PLA-140', '140', 'kg', NULL, NULL),
  ('PLA 35 EXT', 'PLA', 'FRS-012', 'PLA-35', '35', 'kg', NULL, NULL),
  ('PLA 35 CHE', 'PLA', 'FRS-011', 'PLA-35', '35', 'kg', NULL, NULL),
  ('PLA 45 EXT', 'PLA', 'FRS-012', 'PLA-45', '45', 'kg', NULL, NULL),
  ('PLA 50 EXT', 'PLA', 'FRS-012', 'PLA-50', '50', 'kg', NULL, NULL),
  ('PLA 65 EXT', 'PLA', 'FRS-012', 'PLA-65', '65', 'kg', NULL, NULL),
  ('PLA 80 EXT', 'PLA', 'FRS-012', 'PLA-80', '80', 'kg', NULL, NULL),
  ('PLA 100 CHE', 'PLA', 'FRS-011', 'PLA-100', '100', 'kg', NULL, NULL),
  ('PLA 140 CHE', 'PLA', 'FRS-011', 'PLA-140', '140', 'kg', NULL, NULL),
  ('PLA 45 CHE', 'PLA', 'FRS-011', 'PLA-45', '45', 'kg', NULL, NULL),
  ('PLA 50 CHE', 'PLA', 'FRS-011', 'PLA-50', '50', 'kg', NULL, NULL),
  ('PLA 65 CHE', 'PLA', 'FRS-011', 'PLA-65', '65', 'kg', NULL, NULL),
  ('PLA 80 CHE', 'PLA', 'FRS-011', 'PLA-80', '80', 'kg', NULL, NULL),
  ('PP-1500 Dtex-Bleu 6666-Hs', 'PP', 'FRS-001', '1500-DTEX', '6666', 'kg', 'C4', 4400),
  ('PP-1500 Dtex-Cream 2951-Hs', 'PP', 'FRS-001', '1500-DTEX', '2951', 'kg', 'C5N', 8400),
  ('PP-1500 Dtex-D.Bleu 6665-Hs', 'PP', 'FRS-001', '1500-DTEX', '6665', 'kg', NULL, 4400),
  ('PP-1500 Dtex-L.Beige 44377-Hs', 'PP', 'FRS-001', '1500-DTEX', '44377', 'kg', NULL, 4400),
  ('PP-1500 Dtex-Pink 7623-Hs', 'PP', 'FRS-001', '1500-DTEX', '7623', 'kg', NULL, 4400),
  ('PP-1750*2 Dtex-Sh Beige 44414 Hs', 'PP', 'FRS-001', '1750*2 DTEX', '44414', 'kg', 'C5', 8332),
  ('PP-1750*2 Dtex-Sh Brown 44415 Hs', 'PP', 'FRS-001', '1750*2 DTEX', '44415', 'kg', 'CM', 8332),
  ('PP-1750*2 Dtex-Sh Creme 2981 Hs', 'PP', 'FRS-001', '1750*2 DTEX', '2981', 'kg', 'C5N', 8332),
  ('PP-1900 Dtex- Cream 2951-Hs', 'PP', 'FRS-001', '1900-DTEX', '2951', 'kg', 'C5N', 4200),
  ('PP-1900 Dtex-D.Green 5455-Hs', 'PP', 'FRS-001', '1900-DTEX', '5455', 'kg', 'CVR', 8400),
  ('PP-1900 Dtex-L.Beige 44377-Hs', 'PP', 'FRS-001', '1900-DTEX', '44377', 'kg', 'TAUPE', 12600),
  ('PP FRZ-2900 Dtex-Beige 44360-Hs', 'PP', 'FRS-001', '2900-DTEX', '44360', 'kg', 'C5S', 12900),
  ('PP FRZ-2900 Dtex-Brown 44361-Hs', 'PP', 'FRS-001', '2900-DTEX', '44361', 'kg', 'CMS', 12900),
  ('PP FRZ-2900 Dtex-Camel 44416-Hs', 'PP', 'FRS-001', '2900-DTEX', '44416', 'kg', NULL, 4300),
  ('PP FRZ-2900 Dtex-Cream 44412-Hs', 'PP', 'FRS-001', '2900-DTEX', '44412', 'kg', 'C5N', 8600),
  ('PP FRZ-2900 Dtex-D.Bleu 6417-Hs', 'PP', 'FRS-001', '2900-DTEX', '6417', 'kg', NULL, 4300),
  ('PP FRZ-2900 Dtex-D.Green 5463-Hs', 'PP', 'FRS-001', '2900-DTEX', '5463', 'kg', 'CVR', 4300),
  ('PP FRZ-2900 Dtex-Grey 10575-Hs', 'PP', 'FRS-001', '2900-DTEX', '10575', 'kg', NULL, 8600),
  ('PP FRZ-2900 Dtex- Grey 8933-Hs', 'PP', 'FRS-001', '2900-DTEX', '8933', 'kg', NULL, 8600),
  ('PP FRZ-2900 Dtex-Pink 7639-Hs', 'PP', 'FRS-001', '2900-DTEX', '7639', 'kg', NULL, 4300),
  ('PP FRZ-2900 Dtex- Red 7612-Hs', 'PP', 'FRS-001', '2900-DTEX', '7612', 'kg', 'C3', 12900),
  ('PP-1000*2 Dtex-Beige Mn-3203 L-Tat', 'PP', 'FRS-004', '1000X2-DTEX', 'Mn-3203', 'kg', 'C5', 7765),
  ('PP-1000*2 Dtex-Cream Mn-1201-Tat', 'PP', 'FRS-004', '1000X2-DTEX', 'Mn-1201', 'kg', NULL, 7765),
  ('PP-1775*2 Dtex-Cream 1072-Tat', 'PP', 'FRS-004', '1775*2-DTEX', '1072', 'kg', NULL, 7800),
  ('PP-1775*2 Dtex-White 1073-Tat', 'PP', 'FRS-004', '1775*2-DTEX', '1073', 'kg', NULL, 7800),
  ('PP FRZ-2900 Dtex-Gold 3034-Oz', 'PP', 'FRS-005', '2900-DTEX', '3034', 'kg', 'C1', 8333),
  ('PP FRZ-2900 Dtex-Green Mlt 18-Tat', 'PP', 'FRS-004', '2900-DTEX', '18', 'kg', NULL, 2688),
  ('PP FRZ-2900 Dtex-Navy Bleu 1697-Tat', 'PP', 'FRS-004', '2900-DTEX', '1697', 'kg', 'C4', 2688),
  ('PP-1500 Dtex-Bleu 7201-Oz', 'PP', 'FRS-005', '1500-DTEX', '7201', 'kg', 'C4', 4400),
  ('PP-1500 Dtex-Yellow 3151-Oz', 'PP', 'FRS-005', '1500-DTEX', '3151', 'kg', 'C1', 4400),
  ('PP FRZ-2900 Dtex-A/Green 8068-Oz', 'PP', 'FRS-005', '2900-DTEX', '8068', 'kg', 'CVR', 4166),
  ('PP FRZ-2900 Dtex-Beige 2204-Oz', 'PP', 'FRS-005', '2900-DTEX', '2204', 'kg', 'C5S', 12500),
  ('PP FRZ-2900 Dtex-Black 9000-Oz', 'PP', 'FRS-005', '2900-DTEX', '9000', 'kg', 'C2', 8333),
  ('PP FRZ-2900 Dtex-Brown 6161-Oz', 'PP', 'FRS-005', '2900-DTEX', '6161', 'kg', 'CMS', 12500),
  ('PP FRZ-2900 Dtex- Grey 9095-Oz', 'PP', 'FRS-005', '2900-DTEX', '9095', 'kg', NULL, 8333),
  ('PP FRZ-2900 Dtex-Navy 7062 -Oz', 'PP', 'FRS-005', '2900-DTEX', '7062', 'kg', NULL, 4166),
  ('PP FRZ-2900 Dtex- Red 5001-Oz', 'PP', 'FRS-005', '2900-DTEX', '5001', 'kg', 'C3', 12500),
  ('PP-1500 Dtex-Yellow 3430-Hs', 'PP', 'FRS-001', '1500-DTEX', '3430', 'kg', 'C1', 4400),
  ('PP FRZ-2900 Dtex-Black 8001-Hs', 'PP', 'FRS-001', '2900-DTEX', '8001', 'kg', 'C2', 8600),
  ('PP FRZ-2900 Dtex-Gold 3423-Hs', 'PP', 'FRS-001', '2900-DTEX', '3423', 'kg', 'C1', 8600),
  ('PP-1500 Dtex-D.Bleu 7200-Oz', 'PP', 'FRS-005', '1500-DTEX', '7200', 'kg', NULL, 4400),
  ('PP FRZ-2900 Dtex-Cream 1104-Tat', 'PP', 'FRS-004', '2900-DTEX', '1104', 'kg', NULL, 5376),
  ('Hotmelt', 'SBR', 'FRS-002', NULL, NULL, 'kg', NULL, NULL),
  ('SBR 821', 'SBR', 'FRS-009', 'SBR-821', '821', 'kg', NULL, NULL);

-- La couleur interne se pose TELLE QUELLE, NULL compris : le classeur fait foi.
-- Le simili cuir y porte « C0 », qui ne designe aucune couleur — il se decrit
-- par son origine, comme le jute et le plastique. Il repasse donc a vide.
--
-- Le stock minimum, lui, passe par COALESCE : une case vide du classeur veut
-- dire « je ne l'ai pas saisi », pas « remets le seuil a rien ».
UPDATE reference r SET
    code_categorie        = m.cat,
    code_fournisseur      = m.frs,
    code_famille          = m.fam,
    reference_fournisseur = m.reffrs,
    unite_catalogue       = m.unite,
    code_couleur_interne  = m.couleur,
    stock_min_kg          = COALESCE(m.smin, r.stock_min_kg)
  FROM maj m WHERE r.code_reference = m.code;

-- --- 3b. Ce que le classeur ajoute au catalogue ------------------------------
-- Une reference absente du catalogue : Jute 10/1.
--
-- ELLE N'EST PAS CREEE ICI, ET C'EST DELIBERE. La base exige un prix
-- strictement positif ; le classeur n'en donne aucun, et les autres jutes de
-- GLOBALTEX s'echelonnent de 1,29 a 2,18 USD. Prendre la moyenne, ou le prix
-- du voisin, fabriquerait un cout de revient faux que plus personne ne
-- pourrait distinguer d'un vrai. Le prix se demande a l'acheteur ; la
-- reference se cree ensuite, en une ligne.
--
-- Le modele, a completer :
--   INSERT INTO reference (code_reference, designation, code_categorie,
--       code_fournisseur, code_famille, reference_fournisseur,
--       unite_catalogue, code_couleur_interne, stock_min_kg,
--       prix_catalogue, code_devise_catalogue, actif)
--   VALUES ('Jute 10/1', 'Jute 10/1', 'JUT', 'FRS-010',
--           '10/1', '2250/1', 'kg', 'C5', NULL,
--           <PRIX>, 'USD', 1);

-- --- 4. Les couleurs, fournisseur par fournisseur ---------------------------
-- Le classeur donne, pour chaque reference, le nom que SON fournisseur donne a
-- la couleur : « Gold », « Cream », « L.Beige ». C'est ce nom qui figure sur la
-- facture turque, et c'est par lui qu'on reconnait la marchandise au quai.
--
-- On ne cree la correspondance que la ou la couleur de la maison est connue :
-- sans elle, il n'y a rien a relier.
INSERT INTO couleur_fournisseur (id_couleur_fournisseur, code_couleur_interne,
                                 code_fournisseur, code_couleur, libelle, actif) VALUES
  ('CF-C1-FRS-001-OR', 'C1', 'FRS-001', 'OR', 'Or', 1),
  ('CF-C1-FRS-002-OR', 'C1', 'FRS-002', 'OR', 'Or', 1),
  ('CF-C1-FRS-003-OR', 'C1', 'FRS-003', 'OR', 'Or', 1),
  ('CF-C1-FRS-005-OR', 'C1', 'FRS-005', 'OR', 'Or', 1),
  ('CF-C1-FRS-006-OR', 'C1', 'FRS-006', 'OR', 'Or', 1),
  ('CF-C1-FRS-007-OR', 'C1', 'FRS-007', 'OR', 'Or', 1),
  ('CF-C2-FRS-001-NOIR', 'C2', 'FRS-001', 'NOIR', 'Noir', 1),
  ('CF-C2-FRS-005-NOIR', 'C2', 'FRS-005', 'NOIR', 'Noir', 1),
  ('CF-C3-FRS-001-ROUGE', 'C3', 'FRS-001', 'ROUGE', 'Rouge', 1),
  ('CF-C3-FRS-003-ROUGE', 'C3', 'FRS-003', 'ROUGE', 'Rouge', 1),
  ('CF-C3-FRS-005-ROUGE', 'C3', 'FRS-005', 'ROUGE', 'Rouge', 1),
  ('CF-C3-FRS-006-ROUGE', 'C3', 'FRS-006', 'ROUGE', 'Rouge', 1),
  ('CF-C4-FRS-001-BLEU', 'C4', 'FRS-001', 'BLEU', 'Bleu', 1),
  ('CF-C4-FRS-003-BLEU', 'C4', 'FRS-003', 'BLEU', 'Bleu', 1),
  ('CF-C4-FRS-004-BLEU', 'C4', 'FRS-004', 'BLEU', 'Bleu', 1),
  ('CF-C4-FRS-005-BLEU', 'C4', 'FRS-005', 'BLEU', 'Bleu', 1),
  ('CF-C4-FRS-006-BLEU', 'C4', 'FRS-006', 'BLEU', 'Bleu', 1),
  ('CF-C4-FRS-008-BLEU', 'C4', 'FRS-008', 'BLEU', 'Bleu', 1),
  ('CF-C5-FRS-001-BEIGE', 'C5', 'FRS-001', 'BEIGE', 'Beige', 1),
  ('CF-C5-FRS-002-BEIGE', 'C5', 'FRS-002', 'BEIGE', 'Beige', 1),
  ('CF-C5-FRS-003-BEIGE', 'C5', 'FRS-003', 'BEIGE', 'Beige', 1),
  ('CF-C5-FRS-004-BEIGE', 'C5', 'FRS-004', 'BEIGE', 'Beige', 1),
  ('CF-C5-FRS-004-LBEIGE', 'C5', 'FRS-004', 'L.BEIGE', 'L.Beige', 1),
  ('CF-C5-FRS-006-BEIGE', 'C5', 'FRS-006', 'BEIGE', 'Beige', 1),
  ('CF-C5-FRS-007-BEIGE', 'C5', 'FRS-007', 'BEIGE', 'Beige', 1),
  ('CF-C5-FRS-008-BEIGE', 'C5', 'FRS-008', 'BEIGE', 'Beige', 1),
  ('CF-C5-FRS-010-BEIGE', 'C5', 'FRS-010', 'BEIGE', 'Beige', 1),
  ('CF-C5N-FRS-001-C5N', 'C5N', 'FRS-001', 'C5N', 'C5N', 1),
  ('CF-C5N-FRS-001-CREAM', 'C5N', 'FRS-001', 'CREAM', 'Cream', 1),
  ('CF-C5N-FRS-004-BEIGEFONCE', 'C5N', 'FRS-004', 'BEIGE FONCE', 'Beige Fonce', 1),
  ('CF-C5S-FRS-001-BEIGEC5S', 'C5S', 'FRS-001', 'BEIGE (C5S)', 'Beige (C5S)', 1),
  ('CF-C5S-FRS-005-BEIGEC5S', 'C5S', 'FRS-005', 'BEIGE (C5S)', 'Beige (C5S)', 1),
  ('CF-CM-FRS-001-MARRON', 'CM', 'FRS-001', 'MARRON', 'Marron', 1),
  ('CF-CM-FRS-002-MARRON', 'CM', 'FRS-002', 'MARRON', 'Marron', 1),
  ('CF-CM-FRS-003-MARRON', 'CM', 'FRS-003', 'MARRON', 'Marron', 1),
  ('CF-CM-FRS-008-MARRON', 'CM', 'FRS-008', 'MARRON', 'Marron', 1),
  ('CF-CMS-FRS-001-MARRONCMS', 'CMS', 'FRS-001', 'MARRON (CMS)', 'Marron (CMS)', 1),
  ('CF-CMS-FRS-005-MARRONCMS', 'CMS', 'FRS-005', 'MARRON (CMS)', 'Marron (CMS)', 1),
  ('CF-CVR-FRS-001-CVR', 'CVR', 'FRS-001', 'CVR', 'Cvr', 1),
  ('CF-CVR-FRS-001-VERTFONCE', 'CVR', 'FRS-001', 'VERT FONCE', 'Vert Fonce', 1),
  ('CF-CVR-FRS-005-VERTFONCE', 'CVR', 'FRS-005', 'VERT FONCE', 'Vert Fonce', 1),
  ('CF-TAUPE-FRS-001-TAUPE', 'TAUPE', 'FRS-001', 'TAUPE', 'Taupe', 1)
ON CONFLICT (code_fournisseur, code_couleur) DO NOTHING;

COMMIT;
