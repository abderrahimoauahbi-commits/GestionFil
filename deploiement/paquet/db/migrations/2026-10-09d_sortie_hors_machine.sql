-- =============================================================================
-- 2026-10-09d — La sortie hors machine et le pret a une autre usine (regle 1,
-- arbitrage du 09/10/2026)
-- =============================================================================
-- Arbitrage de l'utilisateur : ces sorties sont negligeables mais reelles. Le
-- fil peut sortir hors machine (echantillon, essai, reparation), la jute, le
-- latex, le plastique et le cuir se consomment a l'atelier, et le magasinier
-- prete parfois du fil a une autre usine, qui le rend en nature. L'OF reste un
-- texte libre, jamais verifie : l'ERP ne gere pas la production.
--
-- 1. Deux types de mouvement saisis a la main :
--    SORTIE_HORS_MACHINE (-1) : un motif par ligne (HM_*), OF facultatif ;
--    RETOUR_PRET (+1)         : le fil prete revient, au CMUP en cours (neutre).
-- 2. Les motifs HM_* ; le pret porte l'usine (`mouvement.tiers`).
-- 3. v_prets_en_cours : ce qui reste a rendre, par usine et par reference ;
--    C47 signale un pret non rendu au-dela de P_PretJoursAlerte (60 j).
-- 4. La consommation reelle (MRP, ABC/XYZ) compte ces sorties, sauf le pret.
-- 5. Un lot bloque peut revenir d'un pret (il s'isole, il ne s'emploie pas).
-- Le seuil (50 kg cumules par jour et par reference -> droit VALIDER) est tenu
-- par le service, comme pour le dechet.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Les types -----------------------------------------------------------------
INSERT INTO type_mouvement (code_type_mvt, libelle, signe, exige_prix, impacte_cmup, exige_of,
                            exige_motif_ligne, couleur, actif, interne) VALUES
  ('SORTIE_HORS_MACHINE', 'Sortie hors machine', -1, 0, 0, 0, 1, '#d97706', 1, 0),
  ('RETOUR_PRET',         'Retour d''un pret',     1, 0, 0, 0, 0, '#0d9488', 1, 0)
ON CONFLICT (code_type_mvt) DO UPDATE
   SET libelle = EXCLUDED.libelle, signe = EXCLUDED.signe, exige_of = EXCLUDED.exige_of,
       exige_motif_ligne = EXCLUDED.exige_motif_ligne, actif = 1;

-- 2. Les motifs et l'usine -------------------------------------------------------
INSERT INTO motif_ligne (code_motif_ligne, libelle, categorie, actif) VALUES
  ('HM_ATELIER',     'Consommation atelier (jute, latex, plastique, cuir)', 'HORS_MACHINE', 1),
  ('HM_ECHANTILLON', 'Echantillon',                                          'HORS_MACHINE', 1),
  ('HM_ESSAI',       'Essai',                                                'HORS_MACHINE', 1),
  ('HM_REPARATION',  'Reparation',                                           'HORS_MACHINE', 1),
  ('HM_PRET',        'Pret a une autre usine (rendu en nature)',             'HORS_MACHINE', 1),
  ('HM_AUTRE',       'Autre (dites pourquoi)',                               'HORS_MACHINE', 1)
ON CONFLICT (code_motif_ligne) DO UPDATE SET libelle = EXCLUDED.libelle, categorie = EXCLUDED.categorie, actif = 1;

INSERT INTO motif_mouvement (code_motif, libelle, categorie, signe_default, actif) VALUES
  ('HORS_MACHINE', 'Sortie hors machine (atelier, echantillon, essai, reparation, pret)', 'PRODUCTION', -1, 1),
  ('PRET',         'Pret de fil a une autre usine, et son retour',                         'LOGISTIQUE',  1, 1)
ON CONFLICT (code_motif) DO UPDATE SET libelle = EXCLUDED.libelle, actif = 1;

ALTER TABLE mouvement ADD COLUMN IF NOT EXISTS tiers text;
COMMENT ON COLUMN mouvement.tiers IS
  'Pour un pret (HM_PRET) et son retour (RETOUR_PRET) : l''usine qui emprunte et rend.';

INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description,
                       categorie, modifiable_par) VALUES
  ('P_PretJoursAlerte', 'Pret a une autre usine : delai avant alerte', '60', 'ENTIER', 'jours',
   'Au-dela, le controle C47 signale un pret de fil non rendu (il ne bloque rien).',
   'STOCK', 'DIRECTION')
ON CONFLICT (code_parametre) DO NOTHING;

-- 3. Ce qui reste a rendre --------------------------------------------------------
CREATE OR REPLACE VIEW v_prets_en_cours AS
WITH flux AS (
    SELECT m.tiers, lm.code_reference,
           CASE WHEN m.code_type_mvt = 'RETOUR_PRET' THEN -lm.quantite_kg ELSE lm.quantite_kg END AS kg,
           CASE WHEN m.code_type_mvt = 'SORTIE_HORS_MACHINE' THEN m.date_mouvement END AS date_pret,
           CASE WHEN m.code_type_mvt = 'SORTIE_HORS_MACHINE'
                THEN lm.quantite_kg * COALESCE(lm.prix_kg_mad, 0) END AS valeur_pretee_mad
      FROM mouvement m
      JOIN ligne_mouvement lm ON lm.id_mouvement = m.id_mouvement
     WHERE m.tiers IS NOT NULL
       AND ((m.code_type_mvt = 'SORTIE_HORS_MACHINE' AND lm.code_motif_ligne = 'HM_PRET')
            OR m.code_type_mvt = 'RETOUR_PRET')
       -- Une contre-passation annule le pret ou le retour : ni l'un ni l'autre ne compte.
       AND m.id_mouvement_contrepasse IS NULL
       AND NOT EXISTS (SELECT 1 FROM mouvement c WHERE c.id_mouvement_contrepasse = m.id_mouvement)
)
SELECT tiers, code_reference,
       round(sum(kg), 4)                         AS reste_kg,
       min(date_pret)                            AS premier_pret,
       round(sum(COALESCE(valeur_pretee_mad, 0)), 2) AS valeur_pretee_mad
  FROM flux
 GROUP BY tiers, code_reference
HAVING sum(kg) > 0.0005;
ALTER VIEW v_prets_en_cours OWNER TO gestionfil;

CREATE OR REPLACE VIEW v_ctl_c47 AS
SELECT p.tiers, p.code_reference, p.reste_kg, p.premier_pret
  FROM v_prets_en_cours p
 WHERE substr(p.premier_pret, 1, 10)::date
       < current_date - COALESCE((SELECT CAST(valeur_courante AS integer) FROM parametre
                                   WHERE code_parametre = 'P_PretJoursAlerte'), 60);
ALTER VIEW v_ctl_c47 OWNER TO gestionfil;

DO $$
DECLARE def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C47' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C47''::text, ''Fil prete a une autre usine, non rendu dans le delai''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c47)';
    END IF;
END $$;

-- 4. La consommation reelle compte ces sorties, sauf le pret --------------------
DO $$
DECLARE def text;
BEGIN
    def := pg_get_viewdef('v_conso_reelle'::regclass);
    IF position('SORTIE_HORS_MACHINE' IN def) = 0 THEN
        IF position('(m.code_type_mvt = ''SORTIE_PROD''::text)' IN def) = 0 THEN
            RAISE EXCEPTION 'v_conso_reelle : la clause des sorties production est introuvable';
        END IF;
        def := replace(def, '(m.code_type_mvt = ''SORTIE_PROD''::text)',
            '((m.code_type_mvt = ''SORTIE_PROD''::text) OR ((m.code_type_mvt = ''SORTIE_HORS_MACHINE''::text)'
            ' AND (COALESCE(lm.code_motif_ligne, ''''::text) <> ''HM_PRET''::text)))');
        EXECUTE 'CREATE OR REPLACE VIEW v_conso_reelle AS ' || rtrim(rtrim(def), ';');
    END IF;
END $$;

-- 5. Un lot bloque revient d'un pret ----------------------------------------------
DO $$
DECLARE src text;
BEGIN
    src := pg_get_functiondef('fn_trg_lmvt_lot_controle'::regproc);
    IF position('RETOUR_PRET' IN src) = 0 THEN
        IF position('''RETOUR_MACHINE'', ''ANNUL_CHARGE_MACHINE'', ''RETOUR_FOURN'',' IN src) = 0 THEN
            RAISE EXCEPTION 'fn_trg_lmvt_lot_controle : la liste des mouvements admis est introuvable';
        END IF;
        EXECUTE replace(src, '''RETOUR_MACHINE'', ''ANNUL_CHARGE_MACHINE'', ''RETOUR_FOURN'',',
                             '''RETOUR_MACHINE'', ''ANNUL_CHARGE_MACHINE'', ''RETOUR_FOURN'', ''RETOUR_PRET'',');
    END IF;
END $$;

COMMIT;
