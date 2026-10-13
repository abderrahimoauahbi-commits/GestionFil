-- =============================================================================
-- 2026-10-08m — Les dates au format ISO, garanti par la base (audit v4, P3 action 23)
-- =============================================================================
-- Les dates sont du texte ISO (« 2026-10-08 » ou « 2026-10-08T14:58:33.440Z ») :
-- le service et les vues les comparent et les decoupent comme du texte, dans
-- plus de cent requetes. Les convertir en type date les reecrirait toutes ;
-- c'est un chantier a part. Ce qui compte d'abord est garanti ici : une date
-- mal formee (« 08/10/2026 », « demain ») ne peut plus entrer — elle fausserait
-- les tris et les comparaisons sans erreur visible.
--
-- Une contrainte par colonne de date (date_*, *_le, horodatage*, *_jusqu_a).
-- Elle est posee NOT VALID puis validee : si une base porte deja une valeur
-- malformee, la contrainte reste posee pour les ecritures nouvelles et un
-- avis nomme la colonne a corriger.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    c       record;
    nom     text;
    motif   text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$';
    poses   int := 0;
    a_voir  text[] := '{}';
BEGIN
    FOR c IN
        SELECT col.table_name AS tbl, col.column_name AS colonne
          FROM information_schema.columns col
          JOIN information_schema.tables t USING (table_schema, table_name)
         WHERE col.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND col.data_type = 'text'
           AND (col.column_name LIKE 'date%' OR col.column_name LIKE '%\_le'
                OR col.column_name LIKE 'horodatage%' OR col.column_name LIKE '%jusqu\_a')
    LOOP
        nom := left('ck_date_' || c.tbl || '_' || c.colonne, 54) || '_' || left(md5(c.tbl || '.' || c.colonne), 8);
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = nom) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I IS NULL OR %I ~ %L) NOT VALID',
                           c.tbl, nom, c.colonne, c.colonne, motif);
            poses := poses + 1;
        END IF;
        BEGIN
            EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', c.tbl, nom);
        EXCEPTION WHEN check_violation THEN
            a_voir := a_voir || (c.tbl || '.' || c.colonne);
        END;
    END LOOP;
    RAISE NOTICE 'contraintes de format de date posees : %', poses;
    IF array_length(a_voir, 1) > 0 THEN
        RAISE NOTICE 'DATES MAL FORMEES a corriger (contrainte posee, non validee) : %', array_to_string(a_voir, ', ');
    END IF;
END $$;

COMMIT;
