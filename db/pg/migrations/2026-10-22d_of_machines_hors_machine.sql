-- =============================================================================
-- 2026-10-22d — L'OF sur les machines, la voie, et la fiche hors machine (lot C)
-- =============================================================================
-- docs/A-DECIDER-of-supply-chain.md §5, §6, §6 bis, §6 ter, §6 quater, §8.
-- Le socle (2026-10-22a) a pose les colonnes ; ici, ce qui les fait vivre :
--
--   1. L'ETAT ARCHIVE D'UNE DECISION porte l'OF et la voie de chaque ligne
--      (`machine_decision_etat`) : retirer une decision tete rend l'etage tel
--      qu'il etait, OF compris.
--   2. LE NOMBRE DE BOBINES D'UNE VOIE : capacite de l'etage / largeur de la
--      machine x largeur de la voie, entier arrondi a l'inferieur (une bobine ne
--      se coupe pas). 1 344 / 4,20 x 1,20 = 384. Une aide au magasinier, JAMAIS
--      une consommation. Meme calcul en Rust (decision_machine::bobines_voie) et
--      a l'ecran (noyau.ts, bobinesVoie).
--   3. LE RETOUR AU MAGASIN DE LA MATIERE HORS MACHINE (decide le 22/10/2026 :
--      le reste revient au magasin ; consommation de l'OF = sorti - rendu).
--      Un type a part, RETOUR_CONSO, symetrique de CONSO_DIRECTE : entree au
--      CMUP du magasin, sans effet sur le CMUP, reservee aux articles en mode
--      DIRECTE, avec l'OF, et jamais plus que ce que l'OF a sorti de cette
--      reference (garanti en base, au retour ET a la contre-passation de la
--      sortie). Pourquoi pas RETOUR_PROD : il a ete retire de la saisie libre
--      (regle 12, 08/10/2026), exige un motif R1-R6 et son historique dit « retour
--      d'atelier du fil » ; le rouvrir sous condition melangerait deux sens dans
--      le meme code.
--   4. LA CONSOMMATION REELLE (v_conso_reelle) deduit les retours : une matiere
--      rendue n'a pas ete consommee.
--   5. DEUX SIGNAUX (jamais un blocage) : C62 consommation directe sans OF ;
--      C63 ligne d'etage au-dela de la capacite de sa voie, ou voies d'un etage
--      plus larges que la machine.
--   6. Les colonnes affichees, declarees (champ_configurable).
--
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- 1. L'etat archive porte l'OF et la voie ------------------------------------
ALTER TABLE machine_decision_etat ADD COLUMN IF NOT EXISTS id_of text REFERENCES ordre_fabrication(id_of);
ALTER TABLE machine_decision_etat ADD COLUMN IF NOT EXISTS largeur_voie_m numeric(6,3);
CREATE INDEX IF NOT EXISTS ix_fk_machine_decision_etat_of ON machine_decision_etat (id_of);
ALTER TABLE machine_decision_ligne DROP CONSTRAINT IF EXISTS machine_decision_ligne_voie_positive;
ALTER TABLE machine_decision_ligne ADD CONSTRAINT machine_decision_ligne_voie_positive
    CHECK (largeur_voie_m IS NULL OR largeur_voie_m > 0) NOT VALID;

-- 2. Le nombre de bobines d'une voie -------------------------------------------
CREATE OR REPLACE FUNCTION fn_bobines_voie(p_capacite numeric, p_largeur_machine numeric, p_largeur_voie numeric)
RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p_capacite IS NULL OR p_capacite <= 0
                  OR p_largeur_machine IS NULL OR p_largeur_machine <= 0
                  OR p_largeur_voie IS NULL OR p_largeur_voie <= 0
                THEN NULL
                ELSE floor(p_capacite * p_largeur_voie / p_largeur_machine)::bigint END
$$;
ALTER FUNCTION fn_bobines_voie(numeric, numeric, numeric) OWNER TO gestionfil;
COMMENT ON FUNCTION fn_bobines_voie(numeric, numeric, numeric) IS
  'Bobines d''une voie : capacite de l''etage / largeur de la machine x largeur de la voie, a l''entier '
  'inferieur. Aide au magasinier, jamais une consommation (22/10/2026). Meme calcul : '
  'decision_machine::bobines_voie (Rust), bobinesVoie (noyau.ts).';

-- 3. Le retour de consommation directe -----------------------------------------
INSERT INTO type_mouvement (code_type_mvt, libelle, signe, exige_prix, impacte_cmup, exige_of,
                            exige_motif_ligne, couleur, actif, interne) VALUES
  ('RETOUR_CONSO', 'Retour de consommation directe', 1, 0, 0, 0, 0, '#0d9488', 1, 0)
ON CONFLICT (code_type_mvt) DO UPDATE
   SET libelle = EXCLUDED.libelle, signe = EXCLUDED.signe, exige_prix = EXCLUDED.exige_prix,
       impacte_cmup = EXCLUDED.impacte_cmup, exige_of = EXCLUDED.exige_of,
       exige_motif_ligne = EXCLUDED.exige_motif_ligne, interne = EXCLUDED.interne, actif = 1;

-- Ce que l'OF a sorti de cette reference et pas encore rendu (contre-passations exclues).
CREATE OR REPLACE FUNCTION fn_of_conso_directe_reste(p_of text, p_reference text, p_sauf_mouvement text DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT COALESCE(sum(CASE m.code_type_mvt WHEN 'CONSO_DIRECTE' THEN lm.quantite_kg
                                             ELSE -lm.quantite_kg END), 0)
      FROM ligne_mouvement lm
      JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
     WHERE m.id_of = p_of
       AND lm.code_reference = p_reference
       AND m.code_type_mvt IN ('CONSO_DIRECTE', 'RETOUR_CONSO')
       AND m.id_mouvement IS DISTINCT FROM p_sauf_mouvement
       AND NOT EXISTS (SELECT 1 FROM mouvement c WHERE c.id_mouvement_contrepasse = m.id_mouvement)
$$;
ALTER FUNCTION fn_of_conso_directe_reste(text, text, text) OWNER TO gestionfil;

CREATE OR REPLACE FUNCTION fn_trg_lmvt_retour_conso() RETURNS trigger AS $$
DECLARE
    v_type   text;
    v_of     text;
    v_numero text;
    v_mode   text;
    v_reste  numeric;
BEGIN
    SELECT m.code_type_mvt, m.id_of INTO v_type, v_of FROM mouvement m WHERE m.id_mouvement = NEW.id_mouvement;
    IF v_type IS DISTINCT FROM 'RETOUR_CONSO' THEN
        RETURN NEW;
    END IF;
    SELECT mode_consommation INTO v_mode FROM reference WHERE code_reference = NEW.code_reference;
    IF COALESCE(v_mode, 'MACHINE') <> 'DIRECTE' THEN
        RAISE EXCEPTION 'RETOUR-CONSO : % est en mode de consommation MACHINE : le fil revient par le dechargement d''une fiche machine.', NEW.code_reference
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_of IS NULL THEN
        RAISE EXCEPTION 'RETOUR-CONSO : un retour de consommation directe nomme l''OF qui avait sorti la matiere.'
            USING ERRCODE = 'check_violation';
    END IF;
    -- Deux retours simultanes du meme OF et de la meme reference : le second attend le premier.
    PERFORM pg_advisory_xact_lock(hashtext('retour_conso|' || v_of || '|' || NEW.code_reference));
    v_reste := fn_of_conso_directe_reste(v_of, NEW.code_reference);
    IF NEW.quantite_kg > v_reste + 0.0001 THEN
        SELECT numero INTO v_numero FROM ordre_fabrication WHERE id_of = v_of;
        RAISE EXCEPTION 'RETOUR-CONSO : % kg de % rendus pour l''OF %, qui n''en a sorti que % kg non encore rendus. Un surplus n''est pas un retour : c''est un ajustement d''inventaire.',
            round(NEW.quantite_kg, 4), NEW.code_reference, COALESCE(v_numero, v_of), round(greatest(v_reste, 0), 4)
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lmvt_retour_conso() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_lmvt_retour_conso ON ligne_mouvement;
CREATE TRIGGER trg_lmvt_retour_conso
BEFORE INSERT ON ligne_mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_lmvt_retour_conso();

-- Contre-passer une consommation directe dont l'OF a deja rendu une partie
-- laisserait des retours sans sortie : on contre-passe d'abord le retour.
CREATE OR REPLACE FUNCTION fn_trg_mouvement_conso_rendue() RETURNS trigger AS $$
DECLARE
    v_type   text;
    v_of     text;
    v_ligne  record;
BEGIN
    IF NEW.id_mouvement_contrepasse IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT code_type_mvt, id_of INTO v_type, v_of FROM mouvement WHERE id_mouvement = NEW.id_mouvement_contrepasse;
    IF v_type IS DISTINCT FROM 'CONSO_DIRECTE' OR v_of IS NULL THEN
        RETURN NEW;
    END IF;
    FOR v_ligne IN
        SELECT DISTINCT code_reference FROM ligne_mouvement WHERE id_mouvement = NEW.id_mouvement_contrepasse
    LOOP
        PERFORM pg_advisory_xact_lock(hashtext('retour_conso|' || v_of || '|' || v_ligne.code_reference));
        IF fn_of_conso_directe_reste(v_of, v_ligne.code_reference, NEW.id_mouvement_contrepasse) < -0.0001 THEN
            RAISE EXCEPTION 'RETOUR-CONSO : l''OF a deja rendu au magasin une partie de % sortie par ce mouvement : contre-passez d''abord le retour.', v_ligne.code_reference
                USING ERRCODE = 'check_violation';
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_mouvement_conso_rendue() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_mouvement_conso_rendue ON mouvement;
CREATE TRIGGER trg_mouvement_conso_rendue
BEFORE INSERT ON mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_mouvement_conso_rendue();

-- 4. La consommation reelle deduit les retours ----------------------------------
CREATE OR REPLACE VIEW v_conso_reelle AS
 WITH conso AS (
         SELECT lm.code_reference,
            CASE WHEN m.code_type_mvt = 'RETOUR_CONSO'::text THEN - lm.quantite_kg ELSE lm.quantite_kg END AS kg_prod,
            (0)::numeric AS kg_machine,
            (m.date_mouvement)::text AS quand
           FROM ((ligne_mouvement lm
             JOIN mouvement m ON ((m.id_mouvement = lm.id_mouvement)))
             JOIN type_mouvement tm ON ((tm.code_type_mvt = m.code_type_mvt)))
          WHERE ((tm.signe = '-1'::integer
                  AND (m.code_type_mvt = 'SORTIE_PROD'::text
                       OR m.code_type_mvt = 'CONSO_DIRECTE'::text
                       OR (m.code_type_mvt = 'SORTIE_HORS_MACHINE'::text
                           AND COALESCE(lm.code_motif_ligne, ''::text) <> 'HM_PRET'::text)))
                 OR m.code_type_mvt = 'RETOUR_CONSO'::text)
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

-- 5. Les signaux ------------------------------------------------------------------
-- C62 : une consommation directe sans OF n'est attribuee a aucune qualite.
CREATE OR REPLACE VIEW v_ctl_c62 AS
SELECT m.numero_mouvement, m.date_mouvement, m.code_magasin, m.numero_of,
       round(sum(lm.quantite_kg), 4) AS quantite_kg
  FROM mouvement m
  JOIN ligne_mouvement lm ON lm.id_mouvement = m.id_mouvement
 WHERE m.code_type_mvt = 'CONSO_DIRECTE'
   AND m.id_of IS NULL
   AND NOT EXISTS (SELECT 1 FROM mouvement c WHERE c.id_mouvement_contrepasse = m.id_mouvement)
 GROUP BY m.id_mouvement, m.numero_mouvement, m.date_mouvement, m.code_magasin, m.numero_of;
ALTER VIEW v_ctl_c62 OWNER TO gestionfil;

-- C63 : sur l'etat courant des etages, une ligne qui porte plus de bobines que sa
-- voie n'en tient, ou des voies d'un meme etage plus larges, ensemble, que la
-- machine. Une voie se reconnait a son OF et a sa largeur : deux references du
-- meme OF sur 1,20 m font une seule voie.
CREATE OR REPLACE VIEW v_ctl_c63 AS
SELECT 'LIGNE'::text AS nature, z.code_machine, e.code_emplacement, e.code_reference, e.lot_fournisseur,
       e.id_of, e.largeur_voie_m, e.nb_bobines,
       fn_bobines_voie(z.capacite_bobines, m.largeur_m, e.largeur_voie_m) AS bobines_voie,
       NULL::numeric AS somme_voies_m, m.largeur_m
  FROM machine_etat e
  JOIN machine_emplacement z ON z.code_emplacement = e.code_emplacement
  JOIN machine m ON m.code_machine = z.code_machine
 WHERE e.nb_bobines > fn_bobines_voie(z.capacite_bobines, m.largeur_m, e.largeur_voie_m)
UNION ALL
SELECT 'ETAGE'::text, z.code_machine, v.code_emplacement, NULL, NULL, NULL, NULL, NULL, NULL,
       sum(v.largeur_voie_m), m.largeur_m
  FROM (SELECT DISTINCT code_emplacement, id_of, largeur_voie_m
          FROM machine_etat WHERE largeur_voie_m IS NOT NULL) v
  JOIN machine_emplacement z ON z.code_emplacement = v.code_emplacement
  JOIN machine m ON m.code_machine = z.code_machine
 WHERE m.largeur_m IS NOT NULL
 GROUP BY z.code_machine, v.code_emplacement, m.largeur_m
HAVING sum(v.largeur_voie_m) > m.largeur_m;
ALTER VIEW v_ctl_c63 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('v_ctl_c62' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C62''::text, ''Consommation directe sans OF : non attribuee a une qualite''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c62)';
    END IF;
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('v_ctl_c63' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C63''::text, ''Ligne d''''etage au-dela de la capacite de sa voie, ou voies plus larges que la machine''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c63)';
    END IF;
END $$;

-- 6. Les colonnes affichees, declarees -------------------------------------------
-- Un champ non declare est masque a l'ecran. Meme niveau que des champs voisins
-- deja declares : le poids d'une bobine (STOCK), le numero d'OF (MOUVEMENTS).
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('STOCK', 'largeur_m',       'Largeur de la machine (m)',            'LECTURE', 0, 4410),
 ('STOCK', 'id_of',           'Ordre de fabrication (ligne machine)', 'LECTURE', 0, 4420),
 ('STOCK', 'id_of_periode',   'OF de la période mesurée',             'LECTURE', 0, 4430),
 ('STOCK', 'largeur_voie_m',  'Largeur de la voie (m)',               'LECTURE', 0, 4440),
 ('STOCK', 'bobines_voie',    'Bobines de la voie',                   'LECTURE', 0, 4450),
 ('MOUVEMENTS', 'id_of',      'Ordre de fabrication (lien)',          'LECTURE', 0, 4170)
ON CONFLICT (module, champ) DO UPDATE SET libelle = excluded.libelle, ordre = excluded.ordre;
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'STOCK', c.champ, m.niveau
  FROM modele_droit_champ m
 CROSS JOIN (VALUES ('largeur_m'), ('id_of'), ('id_of_periode'), ('largeur_voie_m'), ('bobines_voie')) c(champ)
 WHERE m.module = 'STOCK' AND m.champ = 'poids_bobine_kg'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, 'STOCK', c.champ, d.niveau
  FROM droit_champ d
 CROSS JOIN (VALUES ('largeur_m'), ('id_of'), ('id_of_periode'), ('largeur_voie_m'), ('bobines_voie')) c(champ)
 WHERE d.module = 'STOCK' AND d.champ = 'poids_bobine_kg'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'MOUVEMENTS', 'id_of', m.niveau
  FROM modele_droit_champ m WHERE m.module = 'MOUVEMENTS' AND m.champ = 'numero_of'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, 'MOUVEMENTS', 'id_of', d.niveau
  FROM droit_champ d WHERE d.module = 'MOUVEMENTS' AND d.champ = 'numero_of'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- 7. Temoin -------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'machine_decision_etat' AND column_name = 'id_of')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lmvt_retour_conso')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mouvement_conso_rendue')
       OR NOT EXISTS (SELECT 1 FROM type_mouvement WHERE code_type_mvt = 'RETOUR_CONSO' AND actif = 1)
       OR fn_bobines_voie(1344, 4.20, 1.20) <> 384
       OR position('RETOUR_CONSO' IN pg_get_viewdef('v_conso_reelle'::regclass)) = 0
       OR position('v_ctl_c62' IN pg_get_viewdef('v_controles'::regclass)) = 0
       OR position('v_ctl_c63' IN pg_get_viewdef('v_controles'::regclass)) = 0 THEN
        RAISE EXCEPTION '2026-10-22d : migration incomplete';
    END IF;
END $$;

COMMIT;
