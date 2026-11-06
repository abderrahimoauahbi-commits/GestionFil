-- =============================================================================
-- 2026-11-06f — Le lot derive : la forme physique dans le meme lot (phase 1)
-- =============================================================================
-- Revue des 22 domaines (06/11/2026), domaines 10, 17, 18, 20 : la gestion des
-- lots reste TELLE QUELLE ; on y ajoute le DERIVE, le plus simple possible.
-- Un derive n'est pas un nouveau lot : c'est une forme physique (contenant,
-- poids unitaire, unites par palette) a l'interieur du MEME lot fournisseur ou
-- interne. Exemple reel (gestion-mp-pro) : SBR 821, lot CO-2026-0001,
-- 2 futs de 600 kg + 90 futs de 1000 kg = deux derives, D1 et D2.
--
-- PHASE 1 — LE SOCLE, sans changer ce que voient les ecrans :
--   1. `lot_derive` : D1, D2… par lot ; statut LIBRE / BLOQUE (un derive seul
--      peut etre bloque ou mis de cote, comme le lot entier).
--   2. CHAQUE LOT A SON D1 : les lots existants le recoivent de leur
--      conditionnement actuel ; un lot qui nait le recoit a sa naissance. Tant
--      qu'un lot n'a qu'un derive, D1 suit le conditionnement du lot (mesure de
--      reception, correction) : rien ne change pour lui.
--   3. LE GRAND LIVRE PORTE LE DERIVE (`ligne_mouvement.code_derive`). Une
--      ligne passee n'est jamais reecrite (le grand livre est immuable) : sans
--      derive, elle vaut D1, le derive d'origine. Une ligne nouvelle :
--        * lot a un seul derive : il est pose d'office (aucun choix a faire) ;
--        * lot a plusieurs derives : le derive est OBLIGATOIRE (DERIVE-REQUIS) ;
--        * derive bloque : il ne part ni en production ni sur machine, il peut
--          etre isole (memes exceptions que le lot bloque) ;
--        * sortie au-dela du solde du derive : R02-DERIVE, qui se confirme
--          comme R02-LOT (`lot_force`).
--   4. `v_stock_derive` : le stock par derive et par magasin, lu du grand livre.
--
-- Viendront (phases 2 a 4) : le derive propose a la reception (contenant
-- different, ou poids a plus de P_SeuilDerivePoidsPct de l'existant), le
-- mouvement RECONDITIONNEMENT, l'etiquette, les machines, l'inventaire.
--
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- -----------------------------------------------------------------------------
-- 1. La table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lot_derive (
    code_reference        text          NOT NULL,
    lot_fournisseur       text          NOT NULL,
    code_derive           text          NOT NULL CHECK (code_derive ~ '^D[0-9]+$'),
    -- Le contenant ; a defaut, celui de la fiche article.
    code_conditionnement  text          REFERENCES conditionnement(code_conditionnement),
    poids_unitaire_kg     numeric(18,4) CHECK (poids_unitaire_kg IS NULL OR poids_unitaire_kg > 0),
    unites_par_palette    bigint        CHECK (unites_par_palette IS NULL OR unites_par_palette > 0),
    statut                text          NOT NULL DEFAULT 'LIBRE' CHECK (statut IN ('LIBRE', 'BLOQUE')),
    motif_statut          text,
    date_creation         timestamptz   NOT NULL DEFAULT now(),
    id_utilisateur        text          REFERENCES utilisateur(id_utilisateur),
    PRIMARY KEY (code_reference, lot_fournisseur, code_derive),
    FOREIGN KEY (code_reference, lot_fournisseur) REFERENCES lot(code_reference, lot_fournisseur)
);
ALTER TABLE lot_derive OWNER TO gestionfil;
COMMENT ON TABLE lot_derive IS
  'Lot derive (06/11/2026) : une forme physique (contenant, poids unitaire, unites par palette) dans le meme lot.';

DROP TRIGGER IF EXISTS trg_audit_modification ON lot_derive;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE OR DELETE ON lot_derive
FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();

-- -----------------------------------------------------------------------------
-- 2. Chaque lot a son D1
-- -----------------------------------------------------------------------------
INSERT INTO lot_derive (code_reference, lot_fournisseur, code_derive, code_conditionnement,
                        poids_unitaire_kg, unites_par_palette)
SELECT l.code_reference, l.lot_fournisseur, 'D1', r.code_conditionnement,
       l.poids_bobine_kg, l.bobines_par_palette
  FROM lot l
  JOIN reference r ON r.code_reference = l.code_reference
ON CONFLICT DO NOTHING;

-- A la naissance d'un lot (apres trg_10_lot_conditionnement_naissance, qui lui
-- a donne le conditionnement de la fiche article).
CREATE OR REPLACE FUNCTION fn_trg_lot_derive_naissance() RETURNS trigger AS $$
BEGIN
    INSERT INTO lot_derive (code_reference, lot_fournisseur, code_derive, code_conditionnement,
                            poids_unitaire_kg, unites_par_palette, id_utilisateur)
    SELECT NEW.code_reference, NEW.lot_fournisseur, 'D1', r.code_conditionnement,
           NEW.poids_bobine_kg, NEW.bobines_par_palette,
           NULLIF(current_setting('gestionfil.id_utilisateur', true), '')
      FROM reference r WHERE r.code_reference = NEW.code_reference
    ON CONFLICT DO NOTHING;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lot_derive_naissance() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_20_lot_derive_naissance ON lot;
CREATE TRIGGER trg_20_lot_derive_naissance AFTER INSERT ON lot
FOR EACH ROW EXECUTE FUNCTION fn_trg_lot_derive_naissance();

-- Un lot a un seul derive : D1 suit son conditionnement (mesure, correction).
CREATE OR REPLACE FUNCTION fn_trg_lot_derive_suit_lot() RETURNS trigger AS $$
BEGIN
    IF (SELECT count(*) FROM lot_derive
         WHERE code_reference = NEW.code_reference AND lot_fournisseur = NEW.lot_fournisseur) = 1 THEN
        UPDATE lot_derive
           SET poids_unitaire_kg  = NEW.poids_bobine_kg,
               unites_par_palette = NEW.bobines_par_palette
         WHERE code_reference = NEW.code_reference AND lot_fournisseur = NEW.lot_fournisseur
           AND (poids_unitaire_kg IS DISTINCT FROM NEW.poids_bobine_kg
                OR unites_par_palette IS DISTINCT FROM NEW.bobines_par_palette);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lot_derive_suit_lot() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_20_lot_derive_suit_lot ON lot;
CREATE TRIGGER trg_20_lot_derive_suit_lot AFTER UPDATE ON lot FOR EACH ROW
WHEN (OLD.poids_bobine_kg IS DISTINCT FROM NEW.poids_bobine_kg
      OR OLD.bobines_par_palette IS DISTINCT FROM NEW.bobines_par_palette)
EXECUTE FUNCTION fn_trg_lot_derive_suit_lot();

-- -----------------------------------------------------------------------------
-- 3. Le grand livre porte le derive
-- -----------------------------------------------------------------------------
ALTER TABLE ligne_mouvement ADD COLUMN IF NOT EXISTS code_derive text;
ALTER TABLE ligne_mouvement DROP CONSTRAINT IF EXISTS ligne_mouvement_derive_fkey;
ALTER TABLE ligne_mouvement ADD CONSTRAINT ligne_mouvement_derive_fkey
    FOREIGN KEY (code_reference, lot_fournisseur, code_derive)
    REFERENCES lot_derive(code_reference, lot_fournisseur, code_derive);
CREATE INDEX IF NOT EXISTS ix_lmvt_derive ON ligne_mouvement (code_reference, lot_fournisseur, code_derive);

CREATE OR REPLACE FUNCTION fn_trg_lmvt_derive() RETURNS trigger AS $$
DECLARE
    v_n      bigint;
    v_seul   text;
    v_statut text;
    v_type   text;
    v_doc    text;
    v_signe  bigint;
    v_mag    text;
    v_dest_q bigint;
    v_solde  numeric;
BEGIN
    IF NEW.lot_fournisseur IS NULL OR btrim(NEW.lot_fournisseur) = '' THEN
        IF NEW.code_derive IS NOT NULL THEN
            RAISE EXCEPTION 'DERIVE-SANS-LOT : un derive se rapporte a un lot ; cette ligne n''en a pas.';
        END IF;
        RETURN NEW;
    END IF;
    SELECT count(*), min(code_derive) INTO v_n, v_seul FROM lot_derive
     WHERE code_reference = NEW.code_reference AND lot_fournisseur = NEW.lot_fournisseur;
    IF NEW.code_derive IS NULL THEN
        IF v_n > 1 THEN
            RAISE EXCEPTION 'DERIVE-REQUIS : le lot % de % a plusieurs conditionnements (derives) : choisissez celui qui bouge.',
                NEW.lot_fournisseur, NEW.code_reference USING ERRCODE = 'check_violation';
        END IF;
        -- Un seul derive : pose d'office. Lot qui nait avec cette ligne : D1 (cree apres elle).
        NEW.code_derive := v_seul;
        RETURN NEW;
    END IF;
    IF v_n <= 1 THEN
        RETURN NEW;    -- le derive unique : le lot dit deja tout (blocage, solde)
    END IF;

    SELECT m.code_type_mvt, m.reference_document, tm.signe, m.code_magasin
      INTO v_type, v_doc, v_signe, v_mag
      FROM mouvement m JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     WHERE m.id_mouvement = NEW.id_mouvement;

    -- Un derive bloque : memes exceptions que le lot bloque (il s'isole, il ne s'emploie pas).
    SELECT statut INTO v_statut FROM lot_derive
     WHERE code_reference = NEW.code_reference AND lot_fournisseur = NEW.lot_fournisseur
       AND code_derive = NEW.code_derive;
    IF v_statut = 'BLOQUE'
       AND v_type NOT IN ('RETOUR_MACHINE', 'ANNUL_CHARGE_MACHINE', 'RETOUR_FOURN', 'RETOUR_PRET',
                          'AJUST_INV_POS', 'AJUST_INV_NEG', 'ENTREE_REC') THEN
        IF v_type IN ('TRANSFERT_SORTIE', 'TRANSFERT_ENTREE') THEN
            SELECT mg.est_quarantaine INTO v_dest_q
              FROM transfert t JOIN magasin mg ON mg.code_magasin = t.code_magasin_dest
             WHERE t.numero_transfert = v_doc;
        END IF;
        IF COALESCE(v_dest_q, 0) <> 1 THEN
            RAISE EXCEPTION 'DERIVE-BLOQUE : le derive % du lot % de % est bloque : il ne part ni en production ni sur machine. Il peut revenir d''une machine, aller en quarantaine ou retourner au fournisseur.',
                NEW.code_derive, NEW.lot_fournisseur, NEW.code_reference USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    -- Le solde du derive au magasin (une ligne sans derive vaut D1).
    IF v_signe = -1 AND COALESCE(NEW.lot_force, 0) <> 1 THEN
        SELECT COALESCE(sum(lm.quantite_kg * tm.signe), 0) INTO v_solde
          FROM ligne_mouvement lm
          JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
          JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
         WHERE lm.code_reference = NEW.code_reference AND lm.lot_fournisseur = NEW.lot_fournisseur
           AND COALESCE(lm.code_derive, 'D1') = NEW.code_derive AND m.code_magasin = v_mag;
        IF NEW.quantite_kg > v_solde + 0.0001 THEN
            RAISE EXCEPTION 'R02-DERIVE : le solde connu du derive % de ce lot ne couvre pas cette sortie. '
                            'La matiere est peut-etre la malgre tout : confirmez pour sortir quand meme.',
                NEW.code_derive;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lmvt_derive() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_lmvt_derive ON ligne_mouvement;
CREATE TRIGGER trg_lmvt_derive BEFORE INSERT ON ligne_mouvement
FOR EACH ROW EXECUTE FUNCTION fn_trg_lmvt_derive();

-- -----------------------------------------------------------------------------
-- 4. Le stock par derive, lu du grand livre
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_stock_derive AS
SELECT d.code_reference, d.lot_fournisseur, d.code_derive, m.code_magasin,
       d.code_conditionnement, d.poids_unitaire_kg, d.unites_par_palette, d.statut,
       round(sum(lm.quantite_kg * tm.signe), 4) AS quantite_kg,
       CASE WHEN d.poids_unitaire_kg > 0
            THEN round(sum(lm.quantite_kg * tm.signe) / d.poids_unitaire_kg, 2) END AS unites
  FROM lot_derive d
  JOIN ligne_mouvement lm ON lm.code_reference = d.code_reference
                         AND lm.lot_fournisseur = d.lot_fournisseur
                         AND COALESCE(lm.code_derive, 'D1') = d.code_derive
  JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
  JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
 GROUP BY d.code_reference, d.lot_fournisseur, d.code_derive, m.code_magasin,
          d.code_conditionnement, d.poids_unitaire_kg, d.unites_par_palette, d.statut;
ALTER VIEW v_stock_derive OWNER TO gestionfil;

-- Le temoin : chaque lot a son D1.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM lot l WHERE NOT EXISTS (
                   SELECT 1 FROM lot_derive d
                    WHERE d.code_reference = l.code_reference AND d.lot_fournisseur = l.lot_fournisseur)) THEN
        RAISE EXCEPTION '2026-11-06f : un lot n''a pas son derive D1.';
    END IF;
END $$;

COMMIT;
