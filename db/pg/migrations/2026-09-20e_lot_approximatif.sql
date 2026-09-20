-- =============================================================================
-- LE LOT EST APPROXIMATIF EN MACHINE : ON CHARGE QUAND MEME, ET ON LE DIT
-- =============================================================================
--
-- CE QUE L'ATELIER FAIT REELLEMENT, et que l'ERP refusait.
--
-- Quand une bobine redescend d'un metier, PERSONNE NE SAIT DE QUEL LOT ELLE
-- VENAIT. Elle a tourne des semaines, elle a ete complete par d'autres, son
-- etiquette est partie avec le carton. Le retour est donc impute a un lot
-- choisi au jugé — et les soldes par lot derivent, doucement, inevitablement.
--
-- Consequence : au chargement suivant, l'ERP annonce « quantite insuffisante
-- sur ce lot » alors que la matiere EST dans le magasin. Le magasinier a les
-- bobines devant lui, il les monte sur le metier, et l'ERP lui dit non. Il
-- cesse alors de saisir — ce qui coute infiniment plus cher que l'imprecision
-- qu'on cherchait a eviter.
--
-- CE QUI EST RELACHE, ET CE QUI NE L'EST PAS.
--
--   LE SOLDE DU MAGASIN RESTE INTOUCHABLE. On ne sort pas trois tonnes d'un
--   magasin qui en tient une : ce serait du stock invente, et toute la
--   valorisation s'effondrerait. Cette garde ne bouge pas.
--
--   LE SOLDE DU LOT DEVIENT FRANCHISSABLE, sur confirmation explicite. Le lot
--   sert a la tracabilite — savoir d'ou venait une matiere — pas a compter. Il
--   compte deja mal, puisque les retours lui sont imputes au jugé.
--
-- LA CONFIRMATION LAISSE UNE TRACE. `lot_force` dit qu'on est passe outre, et
-- le motif dit pourquoi. Sans cela on ne saurait plus, six mois plus tard,
-- distinguer un solde de lot juste d'un solde force — et l'on ferait confiance
-- au mauvais.
-- =============================================================================

BEGIN;

ALTER TABLE ligne_mouvement
    ADD COLUMN IF NOT EXISTS lot_force integer NOT NULL DEFAULT 0
        CHECK (lot_force IN (0, 1)),
    ADD COLUMN IF NOT EXISTS motif_lot_force text;

COMMENT ON COLUMN ligne_mouvement.lot_force IS
'1 : la sortie depasse le solde connu de ce lot, et l operateur a confirme.
 Le lot sert a la tracabilite, pas au comptage — les retours de machine lui
 sont imputes au juge, donc son solde derive. Le solde du MAGASIN, lui, reste
 verifie : il n est jamais franchissable.';

COMMENT ON COLUMN ligne_mouvement.motif_lot_force IS
'Pourquoi on est passe outre. Sans lui, un solde de lot force ne se
 distinguerait plus d un solde juste.';

-- -----------------------------------------------------------------------------
-- La garde du lot laisse passer ce qui est confirme
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_trg_lmvt_stock_lot_suffisant() RETURNS trigger AS $$
BEGIN
    -- LA CONFIRMATION PASSE AVANT LE CALCUL : inutile d'aller lire le solde
    -- d'un lot dont on a deja decide qu'on s'en ecartait.
    IF NEW.lot_force = 1 THEN
        RETURN NEW;
    END IF;

    IF NEW.lot_fournisseur IS NOT NULL
 AND (SELECT tm.signe FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      WHERE m.id_mouvement = NEW.id_mouvement) = -1
 AND NEW.quantite_kg > COALESCE((
        SELECT sl.quantite_kg FROM stock_lot sl
        WHERE sl.code_reference = NEW.code_reference
          AND sl.lot_fournisseur = NEW.lot_fournisseur
          AND sl.code_magasin = (SELECT code_magasin FROM mouvement WHERE id_mouvement = NEW.id_mouvement)
     ), 0) + 0.0001 THEN
        -- LE MESSAGE DIT CE QU'ON PEUT FAIRE, pas seulement ce qui est refuse.
        -- « Quantite insuffisante sur ce lot » laissait le magasinier sans
        -- issue devant des bobines qu'il avait dans les mains.
        RAISE EXCEPTION 'R02-LOT : le solde connu de ce lot ne couvre pas cette sortie. '
                        'La matiere est peut-etre la malgre tout — les retours de machine '
                        'sont imputes au juge. Confirmez pour charger quand meme.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Le solde du lot ne descend pas sous zero, meme force
-- -----------------------------------------------------------------------------
-- Passer outre la VERIFICATION ne doit pas produire un lot negatif : ce serait
-- remplacer une gene par une incoherence. Le solde tombe a zero et s'y arrete ;
-- l'ecart est porte par le magasin, qui lui est juste.

CREATE OR REPLACE FUNCTION fn_lot_plancher() RETURNS trigger AS $$
BEGIN
    IF NEW.quantite_kg < 0 THEN
        NEW.quantite_kg := 0;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lot_plancher ON stock_lot;
CREATE TRIGGER trg_lot_plancher
BEFORE INSERT OR UPDATE ON stock_lot FOR EACH ROW
EXECUTE FUNCTION fn_lot_plancher();

DO $$
BEGIN
    RAISE NOTICE 'lot approximatif : la garde du lot se confirme, celle du magasin tient';
END $$;

COMMIT;

-- =============================================================================
-- LA CONFIRMATION SE GARDE SUR LA FICHE, PAS SEULEMENT EN MEMOIRE
-- =============================================================================
--
-- La fiche se saisit en brouillon, se relit, puis se valide — parfois par
-- quelqu'un d'autre et plusieurs heures plus tard. A la validation, les lignes
-- sont RELUES en base : une confirmation qui n'aurait vecu que dans l'appel de
-- creation serait perdue, et le chargement se ferait refuser au dernier moment.
-- Elle est donc portee par la ligne de fiche, comme le reste.

BEGIN;

ALTER TABLE machine_fiche_ligne
    ADD COLUMN IF NOT EXISTS lot_force integer NOT NULL DEFAULT 0
        CHECK (lot_force IN (0, 1)),
    ADD COLUMN IF NOT EXISTS motif_lot_force text;

COMMENT ON COLUMN machine_fiche_ligne.lot_force IS
'1 : l operateur a confirme le chargement malgre un solde de lot insuffisant.
 Se reporte sur la ligne de mouvement a la validation.';

COMMIT;
