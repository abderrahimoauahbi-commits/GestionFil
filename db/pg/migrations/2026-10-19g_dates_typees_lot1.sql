-- =============================================================================
-- 2026-10-19g — Les dates en vrai type : premier lot (A1, decision du 19/10/2026)
-- =============================================================================
-- Les quatre colonnes qui melaient une date et un horodatage deviennent des
-- `date` (un JOUR) ; `taux_change.date_fin` suit `date_debut`, a laquelle elle
-- se compare. Un horodatage existant devient le jour de CASABLANCA — un
-- mouvement de 0 h 30 le 1er octobre au Maroc (23 h 30 UTC le 30/09) est du
-- 1er octobre, comme le compte deja la cloture de periode (fn_date_metier).
-- Rien ne se perd : l'instant de saisie reste dans date_creation et au journal.
--
--   bon_commande.date_bc               161 dates,   1 horodatage
--   mouvement.date_mouvement           322 dates,  77 horodatages
--   stock_magasin.date_derniere_sortie  79 dates,  57 horodatages
--   taux_change.date_debut / date_fin  136 dates,   1 horodatage
--
-- LES VUES NE SONT PAS REECRITES A LA MAIN. PostgreSQL refuse de changer le
-- type d'une colonne qu'une vue lit : fn_retyper_colonnes_date met de cote les
-- vues qui en dependent (et celles qui dependent d'elles), les supprime,
-- change le type, puis les recree a l'identique en lisant la colonne
-- `(x.col)::text` — le meme texte AAAA-MM-JJ qu'avant. Les ecrans et le
-- serveur continuent de lire ce qu'ils lisaient ; la base, elle, garantit
-- desormais le type. L'outil sert aux lots suivants.
--
-- Deux adaptateurs gardent le code qui traitait ces dates en texte :
-- substr(date, …) et fn_date_metier(date).
-- Rejouable (chaque colonne deja en `date` est sautee). Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---- Les adaptateurs ---------------------------------------------------------
-- substr(col, 1, 10) sur une date : le meme texte qu'avant la conversion.
CREATE OR REPLACE FUNCTION public.substr(date, integer, integer) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$ SELECT substr(to_char($1, 'YYYY-MM-DD'), $2, $3) $$;
CREATE OR REPLACE FUNCTION public.substr(date, integer) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$ SELECT substr(to_char($1, 'YYYY-MM-DD'), $2) $$;
ALTER FUNCTION public.substr(date, integer, integer) OWNER TO gestionfil;
ALTER FUNCTION public.substr(date, integer) OWNER TO gestionfil;

-- Le jour metier d'une date est cette date.
CREATE OR REPLACE FUNCTION fn_date_metier(date) RETURNS date
    LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
ALTER FUNCTION fn_date_metier(date) OWNER TO gestionfil;

-- Le jour de Casablanca d'un texte : une date telle quelle, un horodatage ramene
-- au jour marocain. Le serveur ecrit par lui les colonnes devenues `date` : la
-- meme regle que la conversion des donnees ci-dessous.
CREATE OR REPLACE FUNCTION fn_jour_casablanca(text) RETURNS date
    LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN NULLIF(btrim($1), '') IS NULL THEN NULL
                WHEN $1 ~ 'T' THEN (($1)::timestamptz AT TIME ZONE 'Africa/Casablanca')::date
                ELSE ($1)::date END $$;
ALTER FUNCTION fn_jour_casablanca(text) OWNER TO gestionfil;

-- ---- L'outil : retyper des colonnes en `date`, vues comprises ---------------
-- Plusieurs colonnes d'une meme table passent en UNE instruction : un controle
-- `date_fin > date_debut` ne se compare pas entre une date et un texte.
CREATE OR REPLACE FUNCTION fn_retyper_colonnes_date(p_table text, p_cols text[], p_defaut text)
RETURNS integer AS $$
DECLARE
    v_cols   text[] := '{}';
    v_attnums smallint[];
    v_noms   text[] := '{}';
    v_defs   text[] := '{}';
    v_decl   text[] := '{}';
    v_ctrl   text[] := '{}';
    v_alter  text[] := '{}';
    r        record;
    i        integer;
    c        text;
    v_def    text;
BEGIN
    -- Les colonnes encore en texte (rejouable : celles deja en `date` sont sautees).
    FOREACH c IN ARRAY p_cols LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = p_table AND column_name = c) THEN
            RAISE EXCEPTION 'fn_retyper_colonnes_date : %.% introuvable', p_table, c;
        END IF;
        IF (SELECT data_type FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = p_table AND column_name = c) <> 'date' THEN
            v_cols := v_cols || c;
        END IF;
    END LOOP;
    IF coalesce(array_length(v_cols, 1), 0) = 0 THEN
        RETURN 0;
    END IF;
    SELECT array_agg(attnum) INTO v_attnums FROM pg_attribute
     WHERE attrelid = p_table::regclass AND attname = ANY (v_cols);

    -- Les vues qui lisent ces colonnes, puis celles qui lisent ces vues.
    FOR r IN
        WITH RECURSIVE dep(oid, prof) AS (
            SELECT DISTINCT v.oid, 1
              FROM pg_depend d
              JOIN pg_rewrite rw ON rw.oid = d.objid
              JOIN pg_class v ON v.oid = rw.ev_class
             WHERE d.refobjid = p_table::regclass AND d.refobjsubid = ANY (v_attnums)
               AND v.relkind = 'v'
            UNION
            SELECT DISTINCT v.oid, dep.prof + 1
              FROM dep
              JOIN pg_depend d ON d.refobjid = dep.oid
              JOIN pg_rewrite rw ON rw.oid = d.objid
              JOIN pg_class v ON v.oid = rw.ev_class
             WHERE v.oid <> dep.oid AND v.relkind = 'v' AND dep.prof < 30
        )
        SELECT oid, max(prof) AS prof FROM dep GROUP BY oid ORDER BY max(prof), oid
    LOOP
        v_noms := v_noms || r.oid::regclass::text;
        v_defs := v_defs || pg_get_viewdef(r.oid);
    END LOOP;
    FOR i IN REVERSE coalesce(array_length(v_noms, 1), 0) .. 1 LOOP
        EXECUTE format('DROP VIEW IF EXISTS %s CASCADE', v_noms[i]);
    END LOOP;

    -- Les controles qui citent ces colonnes : ceux de FORMAT texte (ck_date_*,
    -- chk_iso_* de 2026-10-17f) disparaissent, le type les remplace ; les autres
    -- (date_fin > date_debut) sont recrees a l'identique apres.
    FOR r IN SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
              WHERE conrelid = p_table::regclass AND contype = 'c'
                AND conkey && v_attnums
    LOOP
        IF r.conname NOT LIKE 'chk_iso_%' AND r.conname NOT LIKE 'ck_date_%' THEN
            v_ctrl := v_ctrl || format('ALTER TABLE %I ADD CONSTRAINT %I %s', p_table, r.conname, r.def);
        END IF;
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', p_table, r.conname);
    END LOOP;

    -- Les declencheurs qui citent ces colonnes (UPDATE OF …, WHEN …).
    FOR r IN SELECT t.tgname, pg_get_triggerdef(t.oid) AS def
               FROM pg_trigger t
              WHERE t.tgrelid = p_table::regclass AND NOT t.tgisinternal
                AND (t.tgattr::smallint[] && v_attnums
                     OR EXISTS (SELECT 1 FROM unnest(v_cols) x
                                 WHERE pg_get_triggerdef(t.oid) ~ ('WHEN .*\m' || x || '\M')))
    LOOP
        v_decl := v_decl || r.def;
        EXECUTE format('DROP TRIGGER %I ON %I', r.tgname, p_table);
    END LOOP;

    -- Le changement de type, toutes les colonnes ensemble. Un horodatage devient
    -- le jour de Casablanca.
    FOREACH c IN ARRAY v_cols LOOP
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', p_table, c);
        v_alter := v_alter || format(
            'ALTER COLUMN %I TYPE date USING (
                 CASE WHEN NULLIF(btrim(%I), '''') IS NULL THEN NULL
                      WHEN %I ~ ''T'' THEN ((%I)::timestamptz AT TIME ZONE ''Africa/Casablanca'')::date
                      ELSE (%I)::date END)', c, c, c, c, c);
    END LOOP;
    EXECUTE format('ALTER TABLE %I %s', p_table, array_to_string(v_alter, ', '));
    IF p_defaut IS NOT NULL THEN
        FOREACH c IN ARRAY v_cols LOOP
            EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT %s', p_table, c, p_defaut);
        END LOOP;
    END IF;

    FOR i IN 1 .. coalesce(array_length(v_ctrl, 1), 0) LOOP
        EXECUTE v_ctrl[i];
    END LOOP;
    -- Un declencheur dont la condition WHEN compare la colonne a du texte
    -- (C06 : « pas de mouvement date dans le futur ») la lit en texte, comme
    -- avant ; sa liste UPDATE OF, elle, reste telle quelle.
    FOR i IN 1 .. coalesce(array_length(v_decl, 1), 0) LOOP
        v_def := v_decl[i];
        IF position(' WHEN ' IN v_def) > 0 THEN
            c := substr(v_def, position(' WHEN ' IN v_def));
            FOREACH v_def IN ARRAY v_cols LOOP
                c := regexp_replace(c, '(?<![\w.])((\w+\.)?' || v_def || ')\M(?!\s*\()', '(\1)::text', 'g');
            END LOOP;
            v_def := substr(v_decl[i], 1, position(' WHEN ' IN v_decl[i]) - 1) || c;
        END IF;
        EXECUTE v_def;
    END LOOP;

    -- Les vues, recreees a l'identique : les colonnes y sont lues en texte, comme avant.
    FOR i IN 1 .. coalesce(array_length(v_noms, 1), 0) LOOP
        v_def := v_defs[i];
        FOREACH c IN ARRAY v_cols LOOP
            v_def := regexp_replace(v_def,
                                    '(?<![Aa][Ss] )(?<![\w.])((\w+\.)?' || c || ')\M(?!\s*\()',
                                    '(\1)::text', 'g');
        END LOOP;
        EXECUTE format('CREATE VIEW %s AS %s', v_noms[i], v_def);
        EXECUTE format('ALTER VIEW %s OWNER TO gestionfil', v_noms[i]);
    END LOOP;
    RETURN coalesce(array_length(v_noms, 1), 0);
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_retyper_colonnes_date(text, text[], text) OWNER TO gestionfil;

-- ---- Les fonctions qui melaient la date et le texte -------------------------
-- La date de derniere sortie recoit le jour du mouvement (v_date reste du texte
-- pour les colonnes encore en texte : derniere entree, premiere entree du lot).
DO $$
DECLARE
    v_src text;
BEGIN
    v_src := pg_get_functiondef('fn_trg_lmvt_appliquer'::regproc);
    IF position('THEN v_date::date' IN v_src) = 0 THEN
        v_src := replace(v_src,
            'date_derniere_sortie = CASE WHEN v_signe = -1 THEN v_date',
            'date_derniere_sortie = CASE WHEN v_signe = -1 THEN v_date::date');
        EXECUTE v_src;
    END IF;
    v_src := pg_get_functiondef('fn_dernier_prix_achat_mad'::regproc);
    IF position('bc.date_bc::text' IN v_src) = 0 THEN
        v_src := replace(v_src, 'COALESCE(bc.date_validation, bc.date_bc)',
                                'COALESCE(bc.date_validation, bc.date_bc::text)');
        EXECUTE v_src;
    END IF;
END $$;

-- ---- Le premier lot -----------------------------------------------------------
SELECT fn_retyper_colonnes_date('stock_magasin', ARRAY['date_derniere_sortie'], NULL);
-- UN TAUX REMPLACE LE JOUR MEME (debut le 17/09, fin le 17/09 a 16 h 05) : en
-- texte, « fin > debut » tenait par l'heure ; en jours, fin = debut. La regle
-- en jours est fin >= debut — le taux reste a l'historique et n'est en vigueur
-- sur aucune journee (debut <= jour < fin), donc jamais retenu.
-- Et deux taux d'une devise qui commencent le meme jour (le premier corrige
-- dans la journee) ont, en jours, la meme date de debut : l'unicite ne vise
-- plus que les taux EN VIGUEUR sur au moins une journee (fin vide ou apres le
-- debut). Le taux corrige le jour meme reste a l'historique sans conflit.
ALTER TABLE taux_change DROP CONSTRAINT IF EXISTS taux_change_check;
DROP INDEX IF EXISTS ux_taux_devise_debut;
SELECT fn_retyper_colonnes_date('taux_change', ARRAY['date_debut', 'date_fin'], NULL);
ALTER TABLE taux_change DROP CONSTRAINT IF EXISTS taux_change_check;
ALTER TABLE taux_change ADD CONSTRAINT taux_change_check
    CHECK (date_fin IS NULL OR date_fin >= date_debut);
CREATE UNIQUE INDEX IF NOT EXISTS ux_taux_devise_debut ON taux_change (code_devise, date_debut)
    WHERE date_fin IS NULL OR date_fin > date_debut;
SELECT fn_retyper_colonnes_date('bon_commande', ARRAY['date_bc'],
                                '((now() AT TIME ZONE ''Africa/Casablanca'')::date)');
SELECT fn_retyper_colonnes_date('mouvement', ARRAY['date_mouvement'],
                                '((now() AT TIME ZONE ''Africa/Casablanca'')::date)');

-- Temoin
DO $$
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND data_type = 'date'
           AND (table_name, column_name) IN (('bon_commande', 'date_bc'), ('mouvement', 'date_mouvement'),
                                             ('stock_magasin', 'date_derniere_sortie'),
                                             ('taux_change', 'date_debut'), ('taux_change', 'date_fin'))) <> 5
       OR to_regclass('public.v_controles') IS NULL THEN
        RAISE EXCEPTION '2026-10-19g : migration incomplete';
    END IF;
END $$;

COMMIT;
