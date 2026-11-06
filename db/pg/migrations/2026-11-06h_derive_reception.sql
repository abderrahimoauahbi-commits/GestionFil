-- =============================================================================
-- 2026-11-06h — Le lot derive, phase 3 : il nait a la reception
-- =============================================================================
-- Decisions du 06/11/2026 : deux derives se distinguent par le contenant, ou
-- par un poids d'unite qui s'ecarte de plus de P_SeuilDerivePoidsPct (5 %) de
-- celui du derive existant (en deca : un ecart de mesure, le meme derive). Au-
-- dela, l'ecran PROPOSE un nouveau derive ; la personne confirme (jamais
-- automatique). Le garde-fou des 50 % contre les erreurs de saisie reste.
--
--   1. `P_SeuilDerivePoidsPct` (5 %), modifiable par la Direction.
--   2. `ligne_reception.derive_nouveau` : la ligne confirmee fait naitre, a la
--      validation, le derive suivant du lot (D2, D3…), a son poids mesure
--      (kilos / unites comptees) et ses unites par palette.
--   3. UNE LIGNE PAR REFERENCE, PAR LOT ET PAR DERIVE (la regle du 21/10 vaut
--      pour le meme derive) : deux formes du meme lot font deux lignes.
--   4. LA MESURE DU LOT A LA RECEPTION ne lit plus que les lignes du derive
--      d'origine (D1, qu'elle tient a jour) : un fut de 1000 kg ne se fond plus
--      dans la moyenne des futs de 600 kg.
--
-- Rejouable. Enregistree par migrer.py. Exigee au demarrage (MIGRATIONS_REQUISES).
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- 1. Le seuil
INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description,
                       categorie, modifiable_par, verrouille, actif)
VALUES ('P_SeuilDerivePoidsPct', 'Écart de poids qui propose un nouveau dérivé', '5', 'DECIMAL', '%',
        'Au-delà de cet écart entre le poids d''une unité mesuré à la réception et celui du dérivé du lot, '
        'l''écran propose un nouveau dérivé (même lot, autre forme physique) ; la personne confirme. '
        'En deçà, c''est un écart de mesure : le même dérivé.',
        'RECEPT', 'DIRECTION', 0, 1)
ON CONFLICT (code_parametre) DO NOTHING;

-- 2. La ligne qui fait naitre un derive
ALTER TABLE ligne_reception ADD COLUMN IF NOT EXISTS derive_nouveau bigint NOT NULL DEFAULT 0;
ALTER TABLE ligne_reception DROP CONSTRAINT IF EXISTS ligne_reception_derive_nouveau_check;
ALTER TABLE ligne_reception ADD CONSTRAINT ligne_reception_derive_nouveau_check
    CHECK (derive_nouveau IN (0, 1));

-- 3. Une ligne par reference, lot ET derive
CREATE OR REPLACE FUNCTION fn_trg_ligne_reception_un_lot() RETURNS trigger AS $$
DECLARE
    v_ligne bigint;
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.id_reception = NEW.id_reception
       AND OLD.id_ligne_bc IS NOT DISTINCT FROM NEW.id_ligne_bc
       AND OLD.code_reference = NEW.code_reference
       AND COALESCE(btrim(OLD.lot_fournisseur), '') = COALESCE(btrim(NEW.lot_fournisseur), '')
       AND OLD.code_derive IS NOT DISTINCT FROM NEW.code_derive
       AND OLD.derive_nouveau = NEW.derive_nouveau THEN
        RETURN NEW;
    END IF;
    SELECT l.ligne_numero INTO v_ligne
      FROM ligne_reception l
     WHERE l.id_reception = NEW.id_reception
       AND l.id_ligne_bc IS NOT DISTINCT FROM NEW.id_ligne_bc
       AND l.code_reference = NEW.code_reference
       AND COALESCE(btrim(l.lot_fournisseur), '') = COALESCE(btrim(NEW.lot_fournisseur), '')
       -- Le derive (06/11/2026) : la meme forme physique du meme lot.
       AND l.code_derive IS NOT DISTINCT FROM NEW.code_derive
       AND l.derive_nouveau = 0 AND NEW.derive_nouveau = 0
       AND l.id_ligne_reception <> NEW.id_ligne_reception
     ORDER BY l.ligne_numero
     LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'REC-UNE-LIGNE : % (lot %) est deja pese sur la ligne % de cette reception : ajoutez la quantite a cette ligne. Un autre lot, ou un autre derive, fait une autre ligne.',
            NEW.code_reference, COALESCE(NULLIF(btrim(NEW.lot_fournisseur), ''), 'sans numero'), v_ligne
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_ligne_reception_un_lot() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_ligne_reception_un_lot ON ligne_reception;
CREATE TRIGGER trg_ligne_reception_un_lot
BEFORE INSERT OR UPDATE OF id_reception, id_ligne_bc, code_reference, lot_fournisseur, code_derive, derive_nouveau
ON ligne_reception FOR EACH ROW EXECUTE FUNCTION fn_trg_ligne_reception_un_lot();

-- 4. La mesure du lot : les seules lignes du derive d'origine (memes colonnes qu'en 2026-10-23a)
CREATE OR REPLACE VIEW v_lot_conditionnement_mesure AS
WITH lignes AS (
    SELECT lr.code_reference, lr.lot_fournisseur, lr.id_reception AS id_document,
           lr.quantite_stock_kg AS kg, lr.nb_bobines_saisi AS bobines, lr.nb_palettes_saisi AS palettes
      FROM ligne_reception lr
      JOIN reception rc ON rc.id_reception = lr.id_reception
     WHERE rc.statut = ANY (ARRAY['VALIDE'::text, 'CLOTURE'::text])
       AND btrim(COALESCE(lr.lot_fournisseur, ''::text)) <> ''::text
       AND lr.quantite_stock_kg > 0::numeric
       AND COALESCE(lr.code_derive, 'D1') = 'D1' AND lr.derive_nouveau = 0
    UNION ALL
    SELECT l.code_reference, rl.lot_fournisseur, rl.id_reception,
           rl.quantite_recue_kg, NULLIF(rl.nb_bobines, 0) AS "nullif", NULLIF(rl.nb_palettes, 0)::numeric AS "nullif"
      FROM import_reception_lignes rl
      JOIN import_receptions ir ON ir.id_reception = rl.id_reception
      JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
     WHERE ir.statut = 'VALIDEE'::text AND l.code_reference IS NOT NULL
       AND btrim(COALESCE(rl.lot_fournisseur, ''::text)) <> ''::text AND rl.quantite_recue_kg > 0::numeric
), agg AS (
    SELECT lignes.code_reference, lignes.lot_fournisseur,
           sum(lignes.kg) FILTER (WHERE lignes.bobines > 0) AS kg_compte,
           sum(lignes.bobines) FILTER (WHERE lignes.bobines > 0) AS bobines,
           sum(lignes.bobines) FILTER (WHERE lignes.bobines > 0 AND lignes.palettes > 0::numeric
                                       AND lignes.palettes = trunc(lignes.palettes)) AS bobines_palettisees,
           sum(lignes.palettes) FILTER (WHERE lignes.bobines > 0 AND lignes.palettes > 0::numeric
                                        AND lignes.palettes = trunc(lignes.palettes)) AS palettes
      FROM lignes
     GROUP BY lignes.code_reference, lignes.lot_fournisseur
)
SELECT a.code_reference, a.lot_fournisseur,
       CASE WHEN a.bobines > 0::numeric AND a.kg_compte > 0::numeric THEN round(a.kg_compte / a.bobines, 4)
            ELSE NULL::numeric END AS poids_mesure,
       CASE WHEN a.palettes > 0::numeric AND a.bobines_palettisees > 0::numeric
            THEN round(a.bobines_palettisees / a.palettes)::bigint ELSE NULL::bigint END AS bpp_observe,
       r.poids_bobine_kg AS poids_fiche,
       r.bobines_par_palette AS bpp_fiche
  FROM agg a
  JOIN reference r ON r.code_reference = a.code_reference;
ALTER VIEW v_lot_conditionnement_mesure OWNER TO gestionfil;

-- 5. LE LOT PORTE LE CONDITIONNEMENT DE SON D1 : sa mesure ne lit plus que D1
--    (point 4), sa correction le vise ; D1 le suit donc toujours, meme quand le
--    lot a d'autres derives (2026-11-06f ne le faisait suivre que seul).
CREATE OR REPLACE FUNCTION fn_trg_lot_derive_suit_lot() RETURNS trigger AS $$
BEGIN
    UPDATE lot_derive
       SET poids_unitaire_kg  = NEW.poids_bobine_kg,
           unites_par_palette = NEW.bobines_par_palette
     WHERE code_reference = NEW.code_reference AND lot_fournisseur = NEW.lot_fournisseur
       AND code_derive = 'D1'
       AND (poids_unitaire_kg IS DISTINCT FROM NEW.poids_bobine_kg
            OR unites_par_palette IS DISTINCT FROM NEW.bobines_par_palette);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lot_derive_suit_lot() OWNER TO gestionfil;

-- Les champs de l'ecran.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
VALUES ('RECEPTIONS', 'derive_nouveau', 'Nouveau dérivé', 'LECTURE', 0, 999)
ON CONFLICT DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'ligne_reception' AND column_name = 'derive_nouveau')
       OR NOT EXISTS (SELECT 1 FROM parametre WHERE code_parametre = 'P_SeuilDerivePoidsPct') THEN
        RAISE EXCEPTION '2026-11-06h : la reception des derives n''est pas en place.';
    END IF;
END $$;

COMMIT;
