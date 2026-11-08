-- =============================================================================
-- 2026-11-07d — Revue des 22 domaines : les lacunes mineures du tableau final
-- =============================================================================
-- Demande de l'utilisateur (07/11/2026) : faire les modifications proposees au
-- tableau final de la revue et restees en plan.
--   3.  Parametres : P_BasculeReceptionGR, lu nulle part, est desactive (jamais
--       supprime) ; des seuils lies ne s'inversent plus (PARAM-ORDRE) :
--       P_SeuilImminent < P_SeuilCritique < P_SeuilAlerte, P_SeuilABCA < P_SeuilABCB.
--       Inverses, le Stock projete classait faux, en silence.
--   8.  Import : a la cloture d'un dossier, le code SH, la position et le taux
--       de droits de chaque ligne sont FIGES (`import_droits_fige`). Avant,
--       `v_import_droits` relisait le referentiel : le corriger reecrivait les
--       droits attendus d'un dossier passe. Les dossiers deja clotures sont
--       figes ici, a leurs valeurs du jour.
--   11. Equivalences : C71 signale un groupe a un seul membre actif — ce
--       n'est pas une equivalence, il fausse le multi-source (un signal).
--   13. Nomenclatures : le role FIL_SURJET (repris de gestion-mp-pro) entre au
--       depot, pour qu'une base neuve l'ait aussi.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 3. Parametres
-- ---------------------------------------------------------------------------
UPDATE parametre
   SET actif = 0,
       motif_modif = 'Revue du 07/11/2026 : lu nulle part (ni code, ni vue, ni fonction)'
 WHERE code_parametre = 'P_BasculeReceptionGR' AND actif = 1;

CREATE OR REPLACE FUNCTION fn_trg_parametre_ordre() RETURNS trigger AS $$
DECLARE
    v_paires text[][] := ARRAY[['P_SeuilImminent', 'P_SeuilCritique'],
                               ['P_SeuilCritique', 'P_SeuilAlerte'],
                               ['P_SeuilABCA', 'P_SeuilABCB']];
    i int;
    v_bas numeric;
    v_haut numeric;
BEGIN
    FOR i IN 1 .. array_length(v_paires, 1) LOOP
        IF NEW.code_parametre IN (v_paires[i][1], v_paires[i][2]) THEN
            SELECT CASE WHEN p.code_parametre = NEW.code_parametre THEN NEW.valeur_courante ELSE p.valeur_courante END::numeric
              INTO v_bas FROM parametre p WHERE p.code_parametre = v_paires[i][1];
            SELECT CASE WHEN p.code_parametre = NEW.code_parametre THEN NEW.valeur_courante ELSE p.valeur_courante END::numeric
              INTO v_haut FROM parametre p WHERE p.code_parametre = v_paires[i][2];
            IF v_bas IS NOT NULL AND v_haut IS NOT NULL AND v_bas >= v_haut THEN
                RAISE EXCEPTION 'PARAM-ORDRE : % (%) doit rester inferieur a % (%).',
                    v_paires[i][1], v_bas, v_paires[i][2], v_haut USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_parametre_ordre() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_parametre_ordre ON parametre;
CREATE TRIGGER trg_parametre_ordre BEFORE UPDATE OF valeur_courante ON parametre
FOR EACH ROW WHEN (NEW.valeur_courante IS DISTINCT FROM OLD.valeur_courante)
EXECUTE FUNCTION fn_trg_parametre_ordre();

-- ---------------------------------------------------------------------------
-- 8. Les droits d'un dossier clos sont figes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_droits_fige (
    id_ligne          text PRIMARY KEY REFERENCES import_facture_lignes(id_ligne) ON DELETE CASCADE,
    id_dossier        text NOT NULL,
    code_sh           text,
    libelle_position  text,
    position_active   bigint,
    taux_droit_pct    numeric(7,4),
    date_figee        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE import_droits_fige OWNER TO gestionfil;
COMMENT ON TABLE import_droits_fige IS
  'Code SH et taux de droits d''une ligne d''import, figes a la cloture du dossier (07/11/2026).';
CREATE INDEX IF NOT EXISTS ix_import_droits_fige_dossier ON import_droits_fige (id_dossier);

CREATE OR REPLACE FUNCTION fn_figer_droits_dossier(p_dossier text) RETURNS void AS $$
    INSERT INTO import_droits_fige (id_ligne, id_dossier, code_sh, libelle_position, position_active, taux_droit_pct)
    SELECT l.id_ligne, f.id_dossier, ref.code_sh, pt.libelle, pt.actif, pt.taux_droit_pct
      FROM import_facture_lignes l
      JOIN import_factures f ON f.id_facture = l.id_facture
      LEFT JOIN reference ref ON ref.code_reference = l.code_reference
      LEFT JOIN position_tarifaire pt ON pt.code_sh = ref.code_sh
     WHERE f.id_dossier = p_dossier
    ON CONFLICT (id_ligne) DO NOTHING;
$$ LANGUAGE sql;
ALTER FUNCTION fn_figer_droits_dossier(text) OWNER TO gestionfil;

CREATE OR REPLACE FUNCTION fn_trg_import_dossier_droits() RETURNS trigger AS $$
BEGIN
    IF NEW.statut = 'CLOTURE' AND OLD.statut IS DISTINCT FROM 'CLOTURE' THEN
        PERFORM fn_figer_droits_dossier(NEW.id_dossier);
    ELSIF OLD.statut = 'CLOTURE' AND NEW.statut IS DISTINCT FROM 'CLOTURE' THEN
        -- Rouvert : il se refigera a sa prochaine cloture.
        DELETE FROM import_droits_fige WHERE id_dossier = NEW.id_dossier;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_import_dossier_droits() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_import_dossier_droits ON import_dossiers;
CREATE TRIGGER trg_import_dossier_droits AFTER UPDATE OF statut ON import_dossiers
FOR EACH ROW EXECUTE FUNCTION fn_trg_import_dossier_droits();

-- Les dossiers deja clos : figes a leurs valeurs d'aujourd'hui.
SELECT fn_figer_droits_dossier(d.id_dossier) FROM import_dossiers d WHERE d.statut = 'CLOTURE';

-- Meme vue, memes colonnes : le fige d'abord, le referentiel pour un dossier ouvert.
CREATE OR REPLACE VIEW v_import_droits AS
WITH frais_vd AS (
    SELECT r.id_article_dossier AS id_ligne, sum(r.montant_alloue_dhs) AS montant_dhs
      FROM lignes_frais_repartition r
      JOIN dossier_lignes_frais d ON d.id_ligne_frais = r.id_ligne_frais
      JOIN parametres_frais p ON p.id_frais = d.id_frais
     WHERE p.entre_valeur_douane = 1 AND COALESCE(d.methode_repartition, p.methode_repartition) <> 'DROITS'::text
     GROUP BY r.id_article_dossier
), base AS (
    SELECT f.id_dossier, f.id_facture, l.id_ligne, l.ligne_numero, l.code_reference,
           CASE WHEN fg.id_ligne IS NOT NULL THEN fg.code_sh ELSE ref.code_sh END AS code_sh,
           CASE WHEN fg.id_ligne IS NOT NULL THEN fg.libelle_position ELSE pt.libelle END AS libelle_position,
           CASE WHEN fg.id_ligne IS NOT NULL THEN fg.position_active ELSE pt.actif END AS position_active,
           (CASE WHEN fg.id_ligne IS NOT NULL THEN fg.taux_droit_pct ELSE pt.taux_droit_pct END)::numeric(7,4) AS taux_droit_pct,
           round(l.montant_devise * f.taux_change, 2) AS valeur_dhs,
           COALESCE(v.montant_dhs, 0::numeric) AS frais_valeur_douane_dhs
      FROM import_facture_lignes l
      JOIN import_factures f ON f.id_facture = l.id_facture
      LEFT JOIN import_droits_fige fg ON fg.id_ligne = l.id_ligne
      LEFT JOIN reference ref ON ref.code_reference = l.code_reference
      LEFT JOIN position_tarifaire pt ON pt.code_sh = ref.code_sh
      LEFT JOIN frais_vd v ON v.id_ligne = l.id_ligne
)
SELECT id_dossier, id_facture, id_ligne, ligne_numero, code_reference, code_sh, libelle_position,
       taux_droit_pct, valeur_dhs, frais_valeur_douane_dhs,
       valeur_dhs + frais_valeur_douane_dhs AS valeur_douane_dhs,
       CASE WHEN position_active = 1
            THEN round((valeur_dhs + frais_valeur_douane_dhs) * taux_droit_pct / 100::numeric, 2)
            ELSE NULL::numeric END AS droits_attendus_dhs
  FROM base b;
ALTER VIEW v_import_droits OWNER TO gestionfil;

-- ---------------------------------------------------------------------------
-- 11. C71 : un groupe d'equivalence a un seul membre actif
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_ctl_c71 AS
SELECT g.code_groupe_equiv, g.libelle AS groupe_libelle, min(rg.code_reference) AS code_reference
  FROM groupe_equiv g
  JOIN reference_groupe_equiv rg ON rg.code_groupe_equiv = g.code_groupe_equiv AND rg.actif = 1
  JOIN reference r ON r.code_reference = rg.code_reference AND r.actif = 1
 WHERE g.actif = 1
 GROUP BY g.code_groupe_equiv, g.libelle
HAVING count(*) = 1;
ALTER VIEW v_ctl_c71 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('v_ctl_c71' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C71''::text, ''Groupe d''''equivalence a un seul membre actif''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c71)';
    END IF;
END $$;

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'COCKPIT', c.champ, c.libelle, 'LECTURE', 0, 998
  FROM (VALUES ('code_groupe_equiv', 'Groupe d''équivalence'),
               ('groupe_libelle',    'Libellé du groupe')) c(champ, libelle)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 13. Le role FIL_SURJET
-- ---------------------------------------------------------------------------
INSERT INTO role_bom (code_role, libelle, description, ordre_affichage, actif)
VALUES ('FIL_SURJET', 'Fil surjet', 'Fil de surjet des bordures (repris de gestion-mp-pro)', 75, 1)
ON CONFLICT (code_role) DO NOTHING;

-- Temoin
DO $$
BEGIN
    IF to_regclass('public.import_droits_fige') IS NULL
       OR NOT EXISTS (SELECT 1 FROM v_controles WHERE code = 'C71')
       OR NOT EXISTS (SELECT 1 FROM role_bom WHERE code_role = 'FIL_SURJET')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_parametre_ordre') THEN
        RAISE EXCEPTION '2026-11-07d : migration incomplete';
    END IF;
END $$;

COMMIT;
