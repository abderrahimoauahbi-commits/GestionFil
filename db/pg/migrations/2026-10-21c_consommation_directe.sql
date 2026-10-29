-- =============================================================================
-- 2026-10-21c — La consommation directe (decision de l'utilisateur, 21/10/2026)
-- =============================================================================
-- LE PROBLEME. Depuis la regle 1 du 09/10, la sortie production n'est plus que
-- le DECHET, et la seule autre sortie libre est la sortie hors machine, plafonnee
-- a 50 kg cumules par jour et par reference (P_DechetSeuilValiderKg) au-dela
-- desquels il faut le droit VALIDER de l'inventaire. Or la jute, le latex, le
-- SBR, le plastique et le simili cuir ne se chargent PAS sur machine : ils se
-- consomment a l'atelier, plusieurs centaines de kilos par jour. Le magasinier
-- ne pouvait plus les sortir.
--
-- LA DECISION.
--   1. La fiche article porte un MODE DE CONSOMMATION : MACHINE (le fil, qui
--      sort par les fiches machine) ou DIRECTE (la matiere qui se consomme sans
--      machine). Par defaut MACHINE ; initialise ici par categorie.
--   2. Un type de mouvement CONSO_DIRECTE : sortie (-) au CMUP du magasin, sans
--      seuil, ordre / plan facultatif en texte libre (numero_of).
--   3. LA GARANTIE EST EN BASE : un article en mode MACHINE ne sort pas par une
--      consommation directe (trg_lmvt_conso_directe). Le service le dit avant.
--   4. Contre-passation comme toute sortie libre.
--   5. La consommation reelle (v_conso_reelle : plan d'achat, ABC) la compte.
--      Les dechets et les sorties hors machine gardent leur seuil, inchanges.
--
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Le mode de consommation de la fiche article ------------------------------
-- L'initialisation par categorie ne se fait qu'a la creation de la colonne :
-- rejouee, la migration ne defait pas un reglage fait depuis sur une fiche.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'reference'
                      AND column_name = 'mode_consommation') THEN
        ALTER TABLE reference ADD COLUMN mode_consommation text NOT NULL DEFAULT 'MACHINE';
        -- Jute, latex, SBR, plastique, simili cuir : rien de cela ne va sur machine.
        UPDATE reference SET mode_consommation = 'DIRECTE'
         WHERE code_categorie IN ('JUT', 'LAT', 'SBR', 'PLA', 'CUI');
    END IF;
END $$;
ALTER TABLE reference DROP CONSTRAINT IF EXISTS reference_mode_consommation_check;
ALTER TABLE reference ADD CONSTRAINT reference_mode_consommation_check
    CHECK (mode_consommation IN ('MACHINE', 'DIRECTE'));
COMMENT ON COLUMN reference.mode_consommation IS
  'MACHINE : la matiere sort par les fiches machine (le fil). DIRECTE : elle se consomme sans machine '
  '(jute, latex, SBR, plastique, simili cuir) et sort par une consommation directe (CONSO_DIRECTE), '
  'sans le seuil des dechets. Decision du 21/10/2026.';

-- Un champ non declare est masque a l'ecran : sans ces lignes, la liste
-- n'arriverait jamais sur la fiche article. Meme niveau que le type de lot.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('CATALOGUE', 'mode_consommation', 'Mode de consommation', 'ECRITURE', 0, 3018)
ON CONFLICT (module, champ) DO UPDATE SET libelle = excluded.libelle, ordre = excluded.ordre;
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'CATALOGUE', 'mode_consommation', m.niveau
  FROM modele_droit_champ m WHERE m.module = 'CATALOGUE' AND m.champ = 'type_lot'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, 'CATALOGUE', 'mode_consommation', d.niveau
  FROM droit_champ d WHERE d.module = 'CATALOGUE' AND d.champ = 'type_lot'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- 2. Le type de mouvement ------------------------------------------------------
-- Ni prix (le CMUP du magasin, pose par trg_lmvt_cout_sortie), ni effet sur le
-- CMUP, ni OF exige (l'ordre ou le plan est un texte facultatif), ni motif de ligne.
INSERT INTO type_mouvement (code_type_mvt, libelle, signe, exige_prix, impacte_cmup, exige_of,
                            exige_motif_ligne, couleur, actif, interne) VALUES
  ('CONSO_DIRECTE', 'Consommation directe', -1, 0, 0, 0, 0, '#b45309', 1, 0)
ON CONFLICT (code_type_mvt) DO UPDATE
   SET libelle = EXCLUDED.libelle, signe = EXCLUDED.signe, exige_prix = EXCLUDED.exige_prix,
       impacte_cmup = EXCLUDED.impacte_cmup, exige_of = EXCLUDED.exige_of,
       exige_motif_ligne = EXCLUDED.exige_motif_ligne, interne = EXCLUDED.interne, actif = 1;

-- 3. La garantie en base -------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_lmvt_conso_directe() RETURNS trigger AS $$
DECLARE
    v_type text;
    v_mode text;
BEGIN
    SELECT code_type_mvt INTO v_type FROM mouvement WHERE id_mouvement = NEW.id_mouvement;
    IF v_type = 'CONSO_DIRECTE' THEN
        SELECT mode_consommation INTO v_mode FROM reference WHERE code_reference = NEW.code_reference;
        IF COALESCE(v_mode, 'MACHINE') <> 'DIRECTE' THEN
            RAISE EXCEPTION 'CONSO-DIRECTE : % est en mode de consommation MACHINE : le fil sort par les fiches machine, pas par une consommation directe.', NEW.code_reference;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lmvt_conso_directe() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_lmvt_conso_directe ON ligne_mouvement;
CREATE TRIGGER trg_lmvt_conso_directe
BEFORE INSERT ON ligne_mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_lmvt_conso_directe();

-- 4. La consommation reelle la compte ------------------------------------------
-- Meme vue qu'avant (dechets, sorties hors machine sauf le pret, ecarts machine
-- consommes), plus la consommation directe. Une sortie contre-passee n'a pas
-- eu lieu : elle ne compte plus (la contre-passation, un ajustement positif,
-- n'y figurait pas pour l'annuler).
CREATE OR REPLACE VIEW v_conso_reelle AS
 WITH conso AS (
         SELECT lm.code_reference,
            lm.quantite_kg AS kg_prod,
            (0)::numeric AS kg_machine,
            (m.date_mouvement)::text AS quand
           FROM ((ligne_mouvement lm
             JOIN mouvement m ON ((m.id_mouvement = lm.id_mouvement)))
             JOIN type_mouvement tm ON ((tm.code_type_mvt = m.code_type_mvt)))
          WHERE tm.signe = '-1'::integer
            AND (m.code_type_mvt = 'SORTIE_PROD'::text
                 OR m.code_type_mvt = 'CONSO_DIRECTE'::text
                 OR (m.code_type_mvt = 'SORTIE_HORS_MACHINE'::text
                     AND COALESCE(lm.code_motif_ligne, ''::text) <> 'HM_PRET'::text))
            AND NOT EXISTS (SELECT 1 FROM mouvement c WHERE c.id_mouvement_contrepasse = m.id_mouvement)
        UNION ALL
         SELECT e.code_reference,
            (0)::numeric AS "numeric",
            e.ecart_kg,
            fn_iso(e.date_decision) AS date_decision
           FROM v_machine_ecart e
          WHERE ((e.effet_ecart = 'CONSOMMATION'::text) AND (e.ecart_kg > (0)::numeric))
        )
 SELECT code_reference,
    round(sum((kg_prod + kg_machine)), 4) AS sorties_cumulees_kg,
    GREATEST((1)::bigint, ((((CURRENT_DATE - (min(substr(quand, 1, 10)))::date))::numeric / 30.44))::bigint) AS nb_mois_ecoules,
    round((sum((kg_prod + kg_machine)) / (GREATEST((1)::bigint, ((((CURRENT_DATE - (min(substr(quand, 1, 10)))::date))::numeric / 30.44))::bigint))::numeric), 4) AS conso_mensuelle_kg,
    min(quand) AS premiere_sortie,
    max(quand) AS derniere_sortie,
    round(sum(kg_prod), 4) AS sorties_prod_kg,
    round(sum(kg_machine), 4) AS conso_machine_kg
   FROM conso
  GROUP BY code_reference;
ALTER VIEW v_conso_reelle OWNER TO gestionfil;

-- 5. Temoin ---------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lmvt_conso_directe')
       OR NOT EXISTS (SELECT 1 FROM type_mouvement WHERE code_type_mvt = 'CONSO_DIRECTE' AND actif = 1)
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'reference'
                         AND column_name = 'mode_consommation')
       OR position('CONSO_DIRECTE' IN pg_get_viewdef('v_conso_reelle'::regclass)) = 0 THEN
        RAISE EXCEPTION '2026-10-21c : la consommation directe n''est pas en place';
    END IF;
END $$;

COMMIT;
