-- =============================================================================
-- 2026-11-06g — Le lot derive, phase 2 : les documents portent le derive
-- =============================================================================
-- Suite de 2026-11-06f. Avant qu'un lot puisse avoir un second derive, chaque
-- document qui fait bouger un lot doit dire QUEL derive il fait bouger : sinon la
-- base (DERIVE-REQUIS) refuserait ses lignes. Ici, le socle commun :
--
--   1. `code_derive` sur les lignes de transfert, de retour fournisseur, de
--      reception, de fiche machine et d'inventaire (sans derive : D1, comme au
--      grand livre — aucune ligne passee n'est reecrite).
--   2. Une ligne d'inventaire par derive : la cle unique devient (inventaire,
--      reference, magasin, lot, derive).
--   3. `fn_derive_poids_unitaire` / `fn_derive_unites_palette` : le
--      conditionnement du derive, sinon celui du lot (fn_lot_poids_bobine,
--      fn_lot_bobines_palette), sinon la fiche article ; jamais un facteur 1.
--
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['ligne_transfert', 'ligne_retour_fournisseur', 'ligne_reception',
                             'machine_fiche_ligne', 'ligne_inventaire']
    LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS code_derive text', t);
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_derive_fkey');
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (code_reference, lot_fournisseur, code_derive) '
                       'REFERENCES lot_derive(code_reference, lot_fournisseur, code_derive)', t, t || '_derive_fkey');
    END LOOP;
END $$;

-- Une ligne d'inventaire par derive.
ALTER TABLE ligne_inventaire
    DROP CONSTRAINT IF EXISTS ligne_inventaire_id_inventaire_code_reference_code_magasin__key;
DROP INDEX IF EXISTS ligne_inventaire_id_inventaire_code_reference_code_magasin__key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ligne_inventaire_derive
    ON ligne_inventaire (id_inventaire, code_reference, code_magasin, lot_fournisseur, COALESCE(code_derive, 'D1'));

-- Le conditionnement du derive (06/11/2026).
CREATE OR REPLACE FUNCTION fn_derive_poids_unitaire(p_reference text, p_lot text, p_derive text)
RETURNS numeric AS $$
    SELECT COALESCE(
        (SELECT d.poids_unitaire_kg FROM lot_derive d
          WHERE d.code_reference = p_reference AND d.lot_fournisseur = p_lot
            AND d.code_derive = COALESCE(p_derive, 'D1')),
        fn_lot_poids_bobine(p_reference, p_lot))
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_derive_poids_unitaire(text, text, text) OWNER TO gestionfil;

CREATE OR REPLACE FUNCTION fn_derive_unites_palette(p_reference text, p_lot text, p_derive text)
RETURNS bigint AS $$
    SELECT COALESCE(
        (SELECT d.unites_par_palette FROM lot_derive d
          WHERE d.code_reference = p_reference AND d.lot_fournisseur = p_lot
            AND d.code_derive = COALESCE(p_derive, 'D1')),
        fn_lot_bobines_palette(p_reference, p_lot)::bigint)
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_derive_unites_palette(text, text, text) OWNER TO gestionfil;

-- Le stock par lot, decoupe par derive quand le lot en a plusieurs : ce que
-- l'inventaire compte (une ligne par derive) et ce que les ecrans proposent.
-- Un lot a derive unique garde sa ligne de `stock_lot`, avec son derive.
CREATE OR REPLACE VIEW v_stock_lot_derive AS
SELECT sl.code_reference, sl.code_magasin, sl.lot_fournisseur, d1.code_derive,
       sl.quantite_kg, sl.nb_bobines, COALESCE(d1.n, 0) AS nb_derives
  FROM stock_lot sl
  LEFT JOIN LATERAL (
        SELECT min(d.code_derive) AS code_derive, count(*) AS n
          FROM lot_derive d
         WHERE d.code_reference = sl.code_reference AND d.lot_fournisseur = sl.lot_fournisseur) d1 ON true
 WHERE COALESCE(d1.n, 0) <= 1
UNION ALL
SELECT vd.code_reference, vd.code_magasin, vd.lot_fournisseur, vd.code_derive,
       vd.quantite_kg, round(vd.unites)::bigint AS nb_bobines,
       (SELECT count(*) FROM lot_derive d
         WHERE d.code_reference = vd.code_reference AND d.lot_fournisseur = vd.lot_fournisseur) AS nb_derives
  FROM v_stock_derive vd
 WHERE (SELECT count(*) FROM lot_derive d
         WHERE d.code_reference = vd.code_reference AND d.lot_fournisseur = vd.lot_fournisseur) > 1;
ALTER VIEW v_stock_lot_derive OWNER TO gestionfil;

-- Les champs de l'ecran (une colonne non declaree est masquee a la sortie).
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT m.module, c.champ, c.libelle, 'LECTURE', 0, 997
  FROM (VALUES ('STOCK'), ('MOUVEMENTS'), ('INVENTAIRE'), ('RECEPTIONS')) m(module)
 CROSS JOIN (VALUES ('code_derive', 'Dérivé'),
                    ('conditionnement_derive', 'Conditionnement du dérivé'),
                    ('nb_derives', 'Dérivés du lot')) c(champ, libelle)
ON CONFLICT DO NOTHING;

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'STOCK', c.champ, c.libelle, 'LECTURE', 0, 998
  FROM (VALUES ('code_derive', 'Dérivé'),
               ('code_conditionnement', 'Conditionnement'),
               ('conditionnement_libelle', 'Conditionnement'),
               ('unite_singulier', 'Unité'),
               ('poids_unitaire_kg', 'Poids d''une unité (kg)'),
               ('unites_par_palette', 'Unités par palette'),
               ('motif_statut', 'Motif du statut'),
               ('date_creation', 'Créé le')) c(champ, libelle)
ON CONFLICT DO NOTHING;

-- LE RECONDITIONNEMENT (06/11/2026) : transvaser, defaire une palette, changer
-- de contenant — la matiere passe d'un derive a un autre du meme lot, par les
-- mouvements internes FUSION_SORTIE / FUSION_ENTREE (sans effet sur le CMUP).
INSERT INTO motif_mouvement (code_motif, libelle, categorie, signe_default, actif)
VALUES ('RECONDITIONNEMENT', 'Reconditionnement (derive du lot)', 'LOGISTIQUE', 1, 1)
ON CONFLICT (code_motif) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'ligne_transfert' AND column_name = 'code_derive') THEN
        RAISE EXCEPTION '2026-11-06g : ligne_transfert.code_derive absente.';
    END IF;
END $$;

COMMIT;
