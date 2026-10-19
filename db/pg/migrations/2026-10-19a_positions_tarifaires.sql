-- =============================================================================
-- 2026-10-19a — Positions tarifaires et droits de douane calcules (audit P3)
-- =============================================================================
-- Decision du 19/10/2026 : « Referentiel + droits calcules ». Jusqu'ici la
-- douane d'un dossier d'import etait un montant (la quittance), reparti a la
-- valeur sur toutes les lignes — ou a la main, « la douane par nature de
-- reference » (12/10). Or deux marchandises du meme conteneur ne paient pas le
-- meme droit : le fil a un taux, l'accessoire un autre. Repartir a la valeur
-- fait porter au fil la douane de l'accessoire.
--
-- Ce qui change :
--   1. LE REFERENTIEL : `position_tarifaire` (la nomenclature douaniere, code
--      SH/NGP), avec son taux de droit d'importation. Chaque reference du
--      catalogue designe la sienne (`reference.code_sh`).
--   2. LA VALEUR EN DOUANE d'une ligne : sa valeur facture en dirhams, plus sa
--      part des frais que le catalogue des frais marque « entre dans la valeur
--      en douane » (`parametres_frais.entre_valeur_douane` : le fret
--      international, l'assurance — la valeur CAF). Meme definition que
--      gestion-mp-pro (`services/importations/lignes.py`, `droits`).
--   3. LES DROITS ATTENDUS d'une ligne = valeur en douane x taux de sa
--      position (`v_import_droits`), et par dossier, face aux droits payes
--      (`v_import_droits_dossier`) : l'ecart se LIT, il ne bloque rien.
--   4. UNE CINQUIEME REPARTITION, « DROITS » : un frais de douane reparti au
--      prorata des droits attendus de chaque ligne. Une POSSIBILITE du
--      parametrage, pas une decision : le type DOUANE garde sa repartition a la
--      valeur ; on choisit « Droits » sur le type ou sur la ligne de frais du
--      dossier. Une ligne sans position ne peut pas recevoir sa part : le frais
--      reste non reparti, et la cloture le refuse en le disant.
--   5. LE SIGNAL C56 : une ligne d'un dossier ouvert dont la reference n'a pas
--      de position tarifaire (ou une position desactivee).
--
-- Le moteur (domain/importation.rs) lit la meme valeur en douane que la vue.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---- 1. Le referentiel -------------------------------------------------------
CREATE TABLE IF NOT EXISTS position_tarifaire (
    -- Le code de la nomenclature : 6 chiffres (SH international) a 10 (NGP
    -- marocaine), sans points ni espaces — c'est ainsi qu'il se compare.
    code_sh             text    NOT NULL PRIMARY KEY
                                CONSTRAINT ck_pt_code CHECK (code_sh ~ '^[0-9]{6,10}$'),
    libelle             text    NOT NULL CONSTRAINT ck_pt_libelle CHECK (btrim(libelle) <> ''),
    -- Le droit d'importation, en pour cent de la valeur en douane.
    taux_droit_pct      numeric(7,4) NOT NULL DEFAULT 0
                                CONSTRAINT ck_pt_taux CHECK (taux_droit_pct <> 'NaN'
                                                             AND taux_droit_pct >= 0
                                                             AND taux_droit_pct <= 100),
    notes               text,
    actif               bigint  NOT NULL DEFAULT 1 CONSTRAINT ck_pt_actif CHECK (actif IN (0, 1)),
    -- Un vrai type de date, pas du texte (cliquet A1 du 17/10/2026).
    date_creation       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE position_tarifaire OWNER TO gestionfil;

-- Un taux change le cout de revient des dossiers ouverts : qui, quand, de
-- combien, au journal.
DROP TRIGGER IF EXISTS trg_audit_modification ON position_tarifaire;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE OR DELETE ON position_tarifaire
    FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();

ALTER TABLE reference ADD COLUMN IF NOT EXISTS code_sh text;
ALTER TABLE reference DROP CONSTRAINT IF EXISTS fk_reference_position;
ALTER TABLE reference ADD CONSTRAINT fk_reference_position
    FOREIGN KEY (code_sh) REFERENCES position_tarifaire(code_sh);
CREATE INDEX IF NOT EXISTS ix_fk_reference_code_sh ON reference (code_sh);

-- ---- 2. Les frais qui entrent dans la valeur en douane -----------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'parametres_frais'
                      AND column_name = 'entre_valeur_douane') THEN
        ALTER TABLE parametres_frais ADD COLUMN entre_valeur_douane bigint NOT NULL DEFAULT 0
            CONSTRAINT ck_pf_valeur_douane CHECK (entre_valeur_douane IN (0, 1));
        -- Le fret international entre dans la valeur CAF. Pose UNE fois, a la
        -- creation de la colonne : un rejeu ne defait pas un reglage.
        UPDATE parametres_frais SET entre_valeur_douane = 1 WHERE id_frais = 'FRET';
    END IF;
END $$;

-- ---- 3. La repartition « au taux des droits » --------------------------------
ALTER TABLE parametres_frais DROP CONSTRAINT IF EXISTS parametres_frais_methode_check;
ALTER TABLE parametres_frais ADD CONSTRAINT parametres_frais_methode_check
    CHECK (methode_repartition = ANY (ARRAY['VALEUR', 'POIDS', 'QUANTITE', 'PARTS_EGALES', 'DROITS']));
-- Un frais reparti au prorata des droits ne peut pas, en meme temps, entrer
-- dans la valeur qui calcule ces droits : le calcul tournerait en rond.
ALTER TABLE parametres_frais DROP CONSTRAINT IF EXISTS ck_pf_droits_circulaire;
ALTER TABLE parametres_frais ADD CONSTRAINT ck_pf_droits_circulaire
    CHECK (NOT (methode_repartition = 'DROITS' AND entre_valeur_douane = 1));

ALTER TABLE dossier_lignes_frais DROP CONSTRAINT IF EXISTS ck_dlf_methode;
ALTER TABLE dossier_lignes_frais ADD CONSTRAINT ck_dlf_methode
    CHECK (methode_repartition IS NULL
           OR methode_repartition = ANY (ARRAY['VALEUR', 'POIDS', 'QUANTITE', 'PARTS_EGALES', 'MANUEL', 'DROITS']));

-- ---- 4. Les droits attendus --------------------------------------------------
-- Par ligne de facture d'import. La part des frais « valeur en douane » est
-- celle que la repartition a deja posee — hors frais eux-memes repartis aux
-- droits (une ligne de frais du dossier peut choisir « Droits » ; elle ne
-- compte alors pas dans la base, comme dans le moteur).
CREATE OR REPLACE VIEW v_import_droits AS
WITH frais_vd AS (
    SELECT r.id_article_dossier AS id_ligne, sum(r.montant_alloue_dhs) AS montant_dhs
      FROM lignes_frais_repartition r
      JOIN dossier_lignes_frais d ON d.id_ligne_frais = r.id_ligne_frais
      JOIN parametres_frais p     ON p.id_frais = d.id_frais
     WHERE p.entre_valeur_douane = 1
       AND COALESCE(d.methode_repartition, p.methode_repartition) <> 'DROITS'
     GROUP BY r.id_article_dossier
), base AS (
    SELECT f.id_dossier, f.id_facture, l.id_ligne, l.ligne_numero, l.code_reference,
           ref.code_sh, pt.libelle AS libelle_position, pt.actif AS position_active,
           pt.taux_droit_pct,
           round(l.montant_devise * f.taux_change, 2) AS valeur_dhs,
           COALESCE(v.montant_dhs, 0) AS frais_valeur_douane_dhs
      FROM import_facture_lignes l
      JOIN import_factures f        ON f.id_facture = l.id_facture
      LEFT JOIN reference ref       ON ref.code_reference = l.code_reference
      LEFT JOIN position_tarifaire pt ON pt.code_sh = ref.code_sh
      LEFT JOIN frais_vd v          ON v.id_ligne = l.id_ligne
)
SELECT b.id_dossier, b.id_facture, b.id_ligne, b.ligne_numero, b.code_reference,
       b.code_sh, b.libelle_position, b.taux_droit_pct,
       b.valeur_dhs, b.frais_valeur_douane_dhs,
       b.valeur_dhs + b.frais_valeur_douane_dhs AS valeur_douane_dhs,
       -- Sans position active, pas de droit attendu : NULL, pas zero. Zero
       -- dirait « exonere », ce qui serait une affirmation.
       CASE WHEN b.position_active = 1
            THEN round((b.valeur_dhs + b.frais_valeur_douane_dhs) * b.taux_droit_pct / 100, 2)
       END AS droits_attendus_dhs
  FROM base b;
ALTER VIEW v_import_droits OWNER TO gestionfil;

-- Par dossier : attendus face aux payes (les frais de categorie DOUANE).
CREATE OR REPLACE VIEW v_import_droits_dossier AS
SELECT d.id_dossier, d.numero, d.statut,
       (SELECT count(*) FROM v_import_droits v WHERE v.id_dossier = d.id_dossier) AS nb_lignes,
       (SELECT count(*) FROM v_import_droits v
         WHERE v.id_dossier = d.id_dossier AND v.droits_attendus_dhs IS NULL) AS nb_lignes_sans_position,
       (SELECT COALESCE(sum(v.droits_attendus_dhs), 0) FROM v_import_droits v
         WHERE v.id_dossier = d.id_dossier) AS droits_attendus_dhs,
       (SELECT COALESCE(sum(f.montant_dhs), 0) FROM dossier_lignes_frais f
          JOIN parametres_frais p ON p.id_frais = f.id_frais
         WHERE f.id_dossier = d.id_dossier AND p.categorie = 'DOUANE') AS droits_payes_dhs
  FROM import_dossiers d;
ALTER VIEW v_import_droits_dossier OWNER TO gestionfil;

-- ---- 5. Le signal C56 --------------------------------------------------------
CREATE OR REPLACE VIEW v_ctl_c56 AS
SELECT d.numero AS dossier, v.ligne_numero, v.code_reference, v.code_sh
  FROM v_import_droits v
  JOIN import_dossiers d ON d.id_dossier = v.id_dossier
 WHERE d.statut <> 'CLOTURE'
   AND v.droits_attendus_dhs IS NULL;
ALTER VIEW v_ctl_c56 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C56' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C56''::text, ''Ligne d''''import sans position tarifaire''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c56)';
    END IF;
END $$;

-- ---- 6. Les champs, declares (un champ non declare est masque) -------------
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
    ('CATALOGUE',  'code_sh',             'Position tarifaire (SH)',         'ECRITURE', 0, 706),
    ('PARAMETRES', 'code_sh',             'Position tarifaire (SH)',         'ECRITURE', 0, 2140),
    ('PARAMETRES', 'taux_droit_pct',      'Droit d''importation (%)',        'ECRITURE', 0, 2141),
    ('PARAMETRES', 'notes',               'Notes',                           'ECRITURE', 0, 2142),
    ('PARAMETRES', 'nb_references',       'References rattachees',           'LECTURE',  0, 2143),
    ('PARAMETRES', 'entre_valeur_douane', 'Entre dans la valeur en douane',  'ECRITURE', 0, 926),
    ('IMPORT',     'droits_attendus_dhs', 'Droits attendus (DH)',            'LECTURE',  1, 2230),
    ('IMPORT',     'droits_payes_dhs',    'Droits payes (DH)',               'LECTURE',  1, 2231),
    ('IMPORT',     'valeur_douane_dhs',   'Valeur en douane (DH)',           'LECTURE',  1, 2232),
    ('IMPORT',     'code_sh',             'Position tarifaire (SH)',         'LECTURE',  0, 2233),
    ('IMPORT',     'taux_droit_pct',      'Droit d''importation (%)',        'LECTURE',  0, 2234)
ON CONFLICT (module, champ) DO NOTHING;

-- Report dans les modeles de role : les montants restent masques au
-- magasinier, comme les autres montants du dossier ; le reste suit le niveau
-- par defaut.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE WHEN c.sensible = 1 AND r.code_role_user = 'MAGASIN' THEN 'MASQUE'
            WHEN r.code_role_user IN ('DIRECTION', 'ADMIN') THEN 'ECRITURE'
            ELSE c.niveau_defaut END
  FROM (SELECT DISTINCT code_role_user FROM modele_droit_champ) r
  CROSS JOIN champ_configurable c
 WHERE (c.module, c.champ) IN (('CATALOGUE', 'code_sh'), ('PARAMETRES', 'code_sh'),
                               ('PARAMETRES', 'taux_droit_pct'), ('PARAMETRES', 'notes'),
                               ('PARAMETRES', 'nb_references'), ('PARAMETRES', 'entre_valeur_douane'),
                               ('IMPORT', 'droits_attendus_dhs'), ('IMPORT', 'droits_payes_dhs'),
                               ('IMPORT', 'valeur_douane_dhs'), ('IMPORT', 'code_sh'),
                               ('IMPORT', 'taux_droit_pct'))
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE (m.module, m.champ) IN (('CATALOGUE', 'code_sh'), ('PARAMETRES', 'code_sh'),
                               ('PARAMETRES', 'taux_droit_pct'), ('PARAMETRES', 'notes'),
                               ('PARAMETRES', 'nb_references'), ('PARAMETRES', 'entre_valeur_douane'),
                               ('IMPORT', 'droits_attendus_dhs'), ('IMPORT', 'droits_payes_dhs'),
                               ('IMPORT', 'valeur_douane_dhs'), ('IMPORT', 'code_sh'),
                               ('IMPORT', 'taux_droit_pct'))
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- ---- 7. Temoin ---------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.position_tarifaire') IS NULL
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'reference' AND column_name = 'code_sh')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'parametres_frais' AND column_name = 'entre_valeur_douane')
       OR to_regclass('public.v_import_droits_dossier') IS NULL
       OR position('C56' IN pg_get_viewdef('v_controles'::regclass)) = 0 THEN
        RAISE EXCEPTION '2026-10-19a : migration incomplete';
    END IF;
END $$;

COMMIT;
