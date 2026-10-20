-- =============================================================================
-- 2026-10-20a — Les dates en vrai type : les horodatages (A1, dernier lot)
-- =============================================================================
-- Les 93 colonnes de date restees en texte designent un INSTANT (creation,
-- validation, cloture, journal…) : elles passent en `timestamptz`. 54 sont
-- remplies — toutes en texte ISO UTC « AAAA-MM-JJTHH:MI:SS.mmmZ » (inventaire
-- du 20/10 sur la base de saisie) —, 39 sont vides. La conversion est sans
-- perte : le texte UTC devient l'instant qu'il nommait.
--
-- LE TEXTE SERVI NE CHANGE PAS. Le texte natif d'un timestamptz
-- (« 2026-10-19 12:09:00.123+00 ») n'est pas celui que lisent les ecrans ;
-- fn_iso le rend a l'identique de l'ancien (« 2026-10-19T12:09:00.123Z »).
-- Les vues sont recreees en lisant fn_iso(col) ; le serveur lit fn_iso(col)
-- la ou il attend du texte, et routes/json.rs sert deja un timestamptz sous
-- cette forme.
--
-- Adaptateurs : fn_iso (timestamptz, date, texte), substr(timestamptz, …),
-- fn_date_metier(timestamptz), fn_instant(texte) pour les ecritures du serveur.
-- Les defauts (to_char(now() …)) deviennent now() ; clock_timestamp() reste.
-- Rejouable (une colonne deja en timestamptz est sautee). Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';
-- Le texte sans fuseau (aucun dans la base de saisie) est de l'UTC, comme
-- l'ecrivaient le serveur et les declencheurs.
SET LOCAL TimeZone = 'UTC';

-- ---- Les adaptateurs ---------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_iso(timestamptz) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$ SELECT to_char($1 AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;
CREATE OR REPLACE FUNCTION fn_iso(date) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$ SELECT to_char($1, 'YYYY-MM-DD') $$;
CREATE OR REPLACE FUNCTION fn_iso(text) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
ALTER FUNCTION fn_iso(timestamptz) OWNER TO gestionfil;
ALTER FUNCTION fn_iso(date) OWNER TO gestionfil;
ALTER FUNCTION fn_iso(text) OWNER TO gestionfil;

CREATE OR REPLACE FUNCTION public.substr(timestamptz, integer, integer) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$ SELECT substr(fn_iso($1), $2, $3) $$;
CREATE OR REPLACE FUNCTION public.substr(timestamptz, integer) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$ SELECT substr(fn_iso($1), $2) $$;
ALTER FUNCTION public.substr(timestamptz, integer, integer) OWNER TO gestionfil;
ALTER FUNCTION public.substr(timestamptz, integer) OWNER TO gestionfil;

CREATE OR REPLACE FUNCTION fn_date_metier(timestamptz) RETURNS date
    LANGUAGE sql STABLE AS $$ SELECT ($1 AT TIME ZONE 'Africa/Casablanca')::date $$;
ALTER FUNCTION fn_date_metier(timestamptz) OWNER TO gestionfil;

-- L'instant d'un texte ISO envoye par le serveur ; le reste est refuse, comme
-- fn_jour_casablanca. Un texte sans fuseau est de l'UTC.
CREATE OR REPLACE FUNCTION fn_instant(text) RETURNS timestamptz
    LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF NULLIF(btrim($1), '') IS NULL THEN
        RETURN NULL;
    END IF;
    IF $1 !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$' THEN
        RAISE EXCEPTION 'Date illisible : « % » (format attendu AAAA-MM-JJTHH:MI:SSZ).', $1
            USING ERRCODE = 'check_violation';
    END IF;
    IF $1 ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN
        RETURN ($1)::timestamptz;
    END IF;
    RETURN (($1)::timestamp) AT TIME ZONE 'UTC';
END $$;
ALTER FUNCTION fn_instant(text) OWNER TO gestionfil;

-- ---- L'outil : retyper des colonnes en `timestamptz`, vues comprises ---------
-- Meme mecanique que fn_retyper_colonnes_date (2026-10-19g). Deux differences :
-- le defaut (to_char(now() …)) devient now() ; et une vue lit fn_iso(col),
-- nommee `AS col` quand la colonne est un element de sa liste de sortie, pour
-- garder le nom que lisent les vues, le serveur et les ecrans.
CREATE OR REPLACE FUNCTION fn_retyper_colonnes_instant(p_table text, p_cols text[])
RETURNS integer AS $$
DECLARE
    v_cols    text[] := '{}';
    v_defaut  text[] := '{}';
    v_horloge text[] := '{}';
    v_attnums smallint[];
    v_noms    text[] := '{}';
    v_defs    text[] := '{}';
    v_decl    text[] := '{}';
    v_ctrl    text[] := '{}';
    v_alter   text[] := '{}';
    r         record;
    i         integer;
    c         text;
    v_def     text;
BEGIN
    FOREACH c IN ARRAY p_cols LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = p_table AND column_name = c) THEN
            RAISE EXCEPTION 'fn_retyper_colonnes_instant : %.% introuvable', p_table, c;
        END IF;
        IF (SELECT data_type FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = p_table AND column_name = c)
           <> 'timestamp with time zone' THEN
            v_cols := v_cols || c;
        END IF;
    END LOOP;
    IF coalesce(array_length(v_cols, 1), 0) = 0 THEN
        RETURN 0;
    END IF;
    SELECT array_agg(attnum) INTO v_attnums FROM pg_attribute
     WHERE attrelid = p_table::regclass AND attname = ANY (v_cols);

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

    FOR r IN SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
              WHERE conrelid = p_table::regclass AND contype = 'c'
                AND conkey && v_attnums
    LOOP
        IF r.conname NOT LIKE 'chk_iso_%' AND r.conname NOT LIKE 'ck_date_%'
           AND r.def !~ ' ~ ' AND r.def !~ 'fn_texte_date_iso' THEN
            v_ctrl := v_ctrl || format('ALTER TABLE %I ADD CONSTRAINT %I %s', p_table, r.conname, r.def);
        END IF;
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', p_table, r.conname);
    END LOOP;

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

    -- Le type ; un defaut qui datait la ligne (to_char(now() …)) devient now().
    FOREACH c IN ARRAY v_cols LOOP
        SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
          FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
         WHERE d.adrelid = p_table::regclass AND a.attname = c;
        IF v_def ~* 'clock_timestamp\(\)' THEN
            v_horloge := v_horloge || c;
        ELSIF v_def ~* '(now\(\)|current_)' THEN
            v_defaut := v_defaut || c;
        END IF;
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', p_table, c);
        v_alter := v_alter || format(
            'ALTER COLUMN %I TYPE timestamptz USING (
                 CASE WHEN NULLIF(btrim(%I), '''') IS NULL THEN NULL ELSE (%I)::timestamptz END)', c, c, c);
    END LOOP;
    EXECUTE format('ALTER TABLE %I %s', p_table, array_to_string(v_alter, ', '));
    FOREACH c IN ARRAY v_defaut LOOP
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT now()', p_table, c);
    END LOOP;
    -- L'heure d'horloge (decisions machine : deux dans la meme transaction
    -- se suivent) reste l'heure d'horloge.
    FOREACH c IN ARRAY v_horloge LOOP
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT clock_timestamp()', p_table, c);
    END LOOP;

    FOR i IN 1 .. coalesce(array_length(v_ctrl, 1), 0) LOOP
        EXECUTE v_ctrl[i];
    END LOOP;
    FOR i IN 1 .. coalesce(array_length(v_decl, 1), 0) LOOP
        v_def := v_decl[i];
        IF position(' WHEN ' IN v_def) > 0 THEN
            c := substr(v_def, position(' WHEN ' IN v_def));
            FOREACH v_def IN ARRAY v_cols LOOP
                c := regexp_replace(c, '(?<![\w.])((\w+\.)?' || v_def || ')\M(?!\s*\()', 'fn_iso(\1)', 'g');
            END LOOP;
            v_def := substr(v_decl[i], 1, position(' WHEN ' IN v_decl[i]) - 1) || c;
        END IF;
        EXECUTE v_def;
    END LOOP;

    -- Les vues : d'abord les elements de liste de sortie qui ne sont que la
    -- colonne (« x.col, » ou « x.col FROM ») deviennent « fn_iso(x.col) AS col »,
    -- puis toute autre lecture devient fn_iso(x.col). fn_iso d'un texte (la
    -- colonne d'une vue amont qui porte le meme nom) le rend tel quel.
    FOR i IN 1 .. coalesce(array_length(v_noms, 1), 0) LOOP
        v_def := v_defs[i];
        FOREACH c IN ARRAY v_cols LOOP
            v_def := regexp_replace(v_def,
                '((?:SELECT|SELECT DISTINCT|,)\s+)((\w+\.)?' || c || ')(?=,\s*\n|\s+FROM\M|\s*$|\s*\)\s*(?:SELECT|UNION|EXCEPT|INTERSECT|$)|\s+(?:UNION|EXCEPT|INTERSECT)\M)',
                '\1fn_iso(\2) AS ' || c, 'g');
            v_def := regexp_replace(v_def,
                '(?<![Aa][Ss] )(?<!fn_iso\()(?<![\w.])((\w+\.)?' || c || ')\M(?!\s*\()',
                'fn_iso(\1)', 'g');
        END LOOP;
        EXECUTE format('CREATE VIEW %s AS %s', v_noms[i], v_def);
        EXECUTE format('ALTER VIEW %s OWNER TO gestionfil', v_noms[i]);
    END LOOP;
    RETURN coalesce(array_length(v_noms, 1), 0);
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_retyper_colonnes_instant(text, text[]) OWNER TO gestionfil;

-- ---- Les colonnes ---------------------------------------------------------------
SELECT fn_retyper_colonnes_instant(t, c) FROM (VALUES
    ('alerte',                       ARRAY['date_acquittement', 'date_detection']),
    ('archive_reception',            ARRAY['date_archive']),
    ('audit_log',                    ARRAY['date_operation']),
    ('besoin_mrp',                   ARRAY['date_calcul']),
    ('bon_commande',                 ARRAY['date_creation', 'date_envoi', 'date_taux_engage', 'date_validation']),
    ('cockpit_kpi',                  ARRAY['date_calcul']),
    ('cours_bam',                    ARRAY['date_lecture']),
    ('demande_autorisation',         ARRAY['date_consommation', 'date_decision', 'date_demande']),
    ('dossier_lignes_frais',         ARRAY['date_creation']),
    ('droit_champ',                  ARRAY['date_modification']),
    ('entreprise',                   ARRAY['date_creation']),
    ('facture_fournisseur',          ARRAY['date_creation', 'date_validation']),
    ('fournisseur',                  ARRAY['date_creation']),
    ('frais_approche',               ARRAY['date_creation', 'date_portee']),
    ('historique_conditionnement',   ARRAY['date_evenement']),
    ('historique_prix',              ARRAY['date_enregistrement']),
    ('historique_prix_revision',     ARRAY['date_enregistrement']),
    ('import_ajustements_cump',      ARRAY['date_ajustement']),
    ('import_dossiers',              ARRAY['date_cloture', 'date_creation']),
    ('import_engagements',           ARRAY['date_creation']),
    ('import_factures',              ARRAY['date_creation']),
    ('import_receptions',            ARRAY['date_creation', 'date_renvoi', 'date_validation']),
    ('inventaire',                   ARRAY['date_annulation', 'date_cloture', 'date_creation', 'date_inventaire', 'date_validation']),
    ('ligne_inventaire',             ARRAY['date_comptage']),
    ('lot',                          ARRAY['date_creation', 'date_derniere_activite']),
    ('lot_evenement',                ARRAY['date_evenement']),
    ('machine',                      ARRAY['date_etat']),
    ('machine_cliche',               ARRAY['date_cliche']),
    ('machine_consommation',         ARRAY['date_creation']),
    ('machine_decision',             ARRAY['date_decision', 'date_retrait']),
    ('machine_etat',                 ARRAY['date_maj']),
    ('machine_fiche',                ARRAY['date_annulation', 'date_creation', 'date_validation']),
    ('migration_appliquee',          ARRAY['date_application']),
    ('mouvement',                    ARRAY['date_creation']),
    ('paiement_facture_import',      ARRAY['date_creation']),
    ('parametre',                    ARRAY['date_derniere_modif']),
    ('parametre_historique',         ARRAY['date_modification']),
    ('piece_jointe',                 ARRAY['date_depot']),
    ('piece_lecture',                ARRAY['date_lecture']),
    ('plan_achat',                   ARRAY['date_ecartee', 'date_figement', 'date_generation', 'date_validation']),
    ('plan_production',              ARRAY['date_cloture', 'date_creation', 'date_modification', 'date_validation']),
    ('plan_qualite',                 ARRAY['date_figee']),
    ('qualite',                      ARRAY['date_cloture', 'date_creation', 'date_modification']),
    ('reception',                    ARRAY['date_cloture', 'date_controle', 'date_creation', 'date_renvoi']),
    ('reception_ajustements_cmup',   ARRAY['date_ajustement']),
    ('reference',                    ARRAY['date_creation', 'date_dernier_abc', 'date_dernier_cmup']),
    ('reference_groupe_equiv',       ARRAY['date_debut', 'date_fin']),
    ('retour_fournisseur',           ARRAY['date_creation', 'date_validation']),
    ('saison_mois',                  ARRAY['date_modification']),
    ('snapshot_mrp',                 ARRAY['date_snapshot']),
    ('stock_lot',                    ARRAY['date_maj']),
    ('stock_magasin',                ARRAY['date_dernier_inventaire', 'date_maj']),
    ('taux_change',                  ARRAY['date_creation']),
    ('telechargement',               ARRAY['date_telechargement']),
    ('transfert',                    ARRAY['date_reception_dest', 'date_sortie']),
    ('utilisateur',                  ARRAY['date_creation']),
    ('valorisation_stock',           ARRAY['date_calcul'])
) AS l(t, c);

-- ---- Les fonctions qui ecrivaient ou lisaient ces instants en texte ------------
-- Apres les conversions : une fonction SQL est validee a sa creation.
CREATE OR REPLACE FUNCTION fn_jour_casablanca(timestamptz) RETURNS date
    LANGUAGE sql STABLE AS $$ SELECT ($1 AT TIME ZONE 'Africa/Casablanca')::date $$;
ALTER FUNCTION fn_jour_casablanca(timestamptz) OWNER TO gestionfil;
DO $$
DECLARE
    r     record;
    v_src text;
    v_neu text;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        -- « maintenant » tenu en texte UTC : il devient l'instant.
        ('fn_cmup_annuler_entree',   '(v_quand\s+)text\s*:=\s*to_char\(\(now\(\) AT TIME ZONE ''UTC''\),\s*''YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"''\)', '\1timestamptz := now()'),
        ('fn_cmup_suivre_catalogue', '(v_maintenant\s+)text\s*:=\s*to_char\(\(now\(\) AT TIME ZONE ''UTC''\),\s*''YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"''\)', '\1timestamptz := now()'),
        ('fn_recalculer_cmup',       '(v_quand\s+)text\s*:=\s*to_char\(\(now\(\) AT TIME ZONE ''UTC''\),\s*''YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"''\)', '\1timestamptz := now()'),
        ('fn_trg_lmvt_appliquer',    '(v_maintenant\s+)text\s*:=\s*to_char\(\(now\(\) AT TIME ZONE ''UTC''\),\s*''YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"''\)', '\1timestamptz := now()'),
        ('fn_trg_lmvt_lot_registre', 'date_derniere_activite = to_char\(now\(\) AT TIME ZONE ''UTC'',\s*''YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"''\)', 'date_derniere_activite = now()'),
        -- Le plus recent des bons : l'instant de validation, sinon le jour du bon.
        ('fn_dernier_prix_achat_mad', 'COALESCE\(bc\.date_validation, bc\.date_bc::text\)', 'COALESCE(fn_iso(bc.date_validation), bc.date_bc::text)'),
        -- La consommation machine rend ses bornes en texte.
        ('f_machine_consommation',   'COALESCE\(fi\.date_fiche::text, e\.date_decision\)', 'COALESCE(fi.date_fiche::text, fn_iso(e.date_decision))'),
        ('f_machine_consommation',   'p\.date_decision AS (date_debut|date_fin)', 'fn_iso(p.date_decision) AS \1')
    ) AS x(fonction, motif, remplacement)
    LOOP
        v_src := pg_get_functiondef(r.fonction::regproc);
        v_neu := regexp_replace(v_src, r.motif, r.remplacement, 'g');
        IF v_neu <> v_src THEN
            EXECUTE v_neu;
        END IF;
    END LOOP;
END $$;

-- ---- Temoin : plus une colonne de date en texte ------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns col
                 JOIN information_schema.tables t ON t.table_schema = col.table_schema AND t.table_name = col.table_name
                WHERE col.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND col.data_type = 'text'
                  AND (col.column_name ~ '^date_' OR col.column_name ~ '_date$'))
       OR to_regclass('public.v_controles') IS NULL THEN
        RAISE EXCEPTION '2026-10-20a : migration incomplete';
    END IF;
END $$;

COMMIT;
