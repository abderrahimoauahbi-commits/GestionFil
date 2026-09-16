-- ===========================================================================
-- LES CONDITIONS D'ACHAT, RELEVEES DANS LES ARCHIVES
--
-- Les 109 bons Excel de 2020 a 2026 portent en pied de page ce que l'ERP
-- laissait vide. Ce ne sont pas des deductions : ce sont des relevés.
--
--   INCOTERMS  : « CFR TANGIER » sur les 98 bons qui en portent un. Aucune
--                autre valeur, jamais.
--   CONTENEURS : 18 palettes chez HASIRCI et OZKARALAR, sur dix-sept bons ou
--                le total des palettes et le nombre de conteneurs figurent
--                tous deux — 108/6, 36/2, 18/1, 54/3… le rapport ne bouge pas.
--                TAT annonce 20 palettes par conteneur sur ses trois derniers.
--
-- L'INCOTERM NE VA QU'AUX FOURNISSEURS D'IMPORT. « CFR Tanger » designe une
-- marchandise portee jusqu'au port de Tanger, fret paye : cela n'a aucun sens
-- pour CHEMS PLASTIQUE ou EXTRA PLAST, qui livrent par la route depuis le
-- Maroc. On ne pose donc rien chez eux plutot que d'y mettre une mention qui
-- s'imprimerait a tort sur un bon.
--
-- CE QU'ON NE TOUCHE PAS, ET IL FAUT LE DIRE : la tolerance de pesee. Les
-- archives annoncent « TOLERENCE QUANTITY : +/- 10% » sur 95 bons ; la base
-- porte 2 % pour tout le monde. Les deux chiffres parlent bien de la meme
-- chose — l'ecart admis entre le commande et le livre — et l'ecart entre eux
-- est donc un ECART REEL, pas une donnee manquante. Passer de 2 a 10 %
-- desserrerait le controle a la reception sur les douze fournisseurs d'un
-- coup : c'est une decision d'achat, pas une reprise de donnees. Elle est
-- signalee, elle n'est pas prise ici.
-- ===========================================================================

BEGIN;

-- --- 1. L'incoterm des fournisseurs d'import --------------------------------
-- `COALESCE` : on remplit un vide, on n'ecrase pas un choix. Si quelqu'un a
-- negocie un FOB entre-temps, il reste.
UPDATE fournisseur SET incoterm = COALESCE(incoterm, 'CFR TANGIER')
 WHERE code_fournisseur IN ('FRS-001',  -- HASIRCI TEXTILE   (21 bons)
                            'FRS-003',  -- GZM TEXTIL        (18 bons)
                            'FRS-004',  -- TAT TEXTIL        ( 9 bons)
                            'FRS-005',  -- OZKARALAR         (10 bons)
                            'FRS-006',  -- SUJATA            ( 3 bons)
                            'FRS-007'); -- TURKAN            (21 bons)

-- --- 2. Les palettes par conteneur ------------------------------------------
UPDATE fournisseur SET palettes_par_conteneur = COALESCE(palettes_par_conteneur, 18)
 WHERE code_fournisseur IN ('FRS-001', 'FRS-005');

UPDATE fournisseur SET palettes_par_conteneur = COALESCE(palettes_par_conteneur, 20)
 WHERE code_fournisseur = 'FRS-004';

COMMIT;
