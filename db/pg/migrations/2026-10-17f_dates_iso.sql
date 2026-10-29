-- =============================================================================
-- 2026-10-17f — Le format des dates garanti en base (audit A1, premier pas)
-- =============================================================================
-- LE DEFAUT. Les dates sont stockees en TEXTE : un heritage de SQLite, abandonne
-- le 04/09/2026, ou le type date n'existe pas. Une colonne `text` accepte
-- « demain », « 17/10/2026 » ou une chaine vide sans broncher : rien ne garantit
-- qu'une date en soit une.
--
-- CE QUE L'INVENTAIRE DU 17/10 A MONTRE (gestionfil_saisie) :
--   134 colonnes de date en texte dans les TABLES (l'audit disait 181 : il
--   comptait aussi 47 colonnes de VUES, qui heritent du type de leurs tables) ;
--   55 vides, 21 de dates seules, 54 d'horodatages, 4 melangeant les deux ;
--   AUCUNE valeur hors format ISO.
--
-- POURQUOI PAS LA CONVERSION DE TYPE, MAINTENANT. Ces colonnes sont citees 579
-- fois dans 39 fichiers Rust et 945 fois dans le SQL. Changer leur type casse
-- chaque lecture en `String` A L'EXECUTION, jamais a la compilation (le piege
-- n° 1 de CLAUDE.md). Et 4 colonnes melangent dates et horodatages : decider si
-- une date de mouvement est une date ou un instant est un choix metier. La
-- conversion est chiffree et documentee (rapport de decision, section I).
--
-- CE QUE FAIT CETTE MIGRATION, ET QUI SUFFIT A ECARTER LE RISQUE : une
-- contrainte CHECK sur chacune de ces colonnes, qui n'admet que le format ISO —
-- AAAA-MM-JJ, ou AAAA-MM-JJ suivi d'une heure (T ou espace), fuseau facultatif.
-- NULL reste permis. Plus rien de mal forme ne peut entrer, par aucun chemin.
--
-- PAS DE BLOC EXCEPTION : la contrainte s'evalue a chaque ecriture, et un bloc
-- EXCEPTION ouvrirait une sous-transaction par ligne. Une expression reguliere
-- suffit — mois 01-12, jour 01-31. Elle laisse passer un 30 fevrier : la
-- contrainte garde le FORMAT, le calendrier est l'affaire de la saisie (chrono
-- dans `date_du_fait`).
--
-- REJOUABLE : une contrainte n'est ajoutee que si elle manque.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_texte_date_iso(p text) RETURNS boolean AS $$
    SELECT p IS NULL
        OR p ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]{1,6})?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$';
$$ LANGUAGE sql IMMUTABLE;
ALTER FUNCTION fn_texte_date_iso(text) OWNER TO gestionfil;

DO $$
DECLARE
    c       record;
    v_nom   text;
    v_ajout integer := 0;
BEGIN
    FOR c IN
        SELECT col.table_name, col.column_name
          FROM information_schema.columns col
          JOIN information_schema.tables t
            ON t.table_schema = col.table_schema AND t.table_name = col.table_name
         WHERE col.table_schema = 'public' AND t.table_type = 'BASE TABLE'
           AND col.data_type = 'text'
           AND (col.column_name ~ '^date_' OR col.column_name ~ '_date$')
         ORDER BY 1, 2
    LOOP
        -- Un nom de contrainte tient en 63 caracteres : on le tronque, puis on
        -- lui ajoute une empreinte courte pour qu'il reste unique.
        v_nom := left('chk_iso_' || c.table_name || '_' || c.column_name, 54)
                 || '_' || left(md5(c.table_name || '.' || c.column_name), 8);
        IF NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conname = v_nom AND conrelid = format('public.%I', c.table_name)::regclass) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (fn_texte_date_iso(%I))',
                           c.table_name, v_nom, c.column_name);
            v_ajout := v_ajout + 1;
        END IF;
    END LOOP;
    RAISE NOTICE '2026-10-17f : % contrainte(s) de format ISO ajoutee(s).', v_ajout;
END $$;

-- ---- Temoin : chaque colonne de date en texte porte sa contrainte -----------
DO $$
DECLARE
    v_sans integer;
BEGIN
    SELECT count(*) INTO v_sans
      FROM information_schema.columns col
      JOIN information_schema.tables t
        ON t.table_schema = col.table_schema AND t.table_name = col.table_name
     WHERE col.table_schema = 'public' AND t.table_type = 'BASE TABLE'
       AND col.data_type = 'text'
       AND (col.column_name ~ '^date_' OR col.column_name ~ '_date$')
       AND NOT EXISTS (
             SELECT 1 FROM pg_constraint k
              WHERE k.conrelid = format('public.%I', col.table_name)::regclass
                AND k.contype = 'c'
                AND pg_get_constraintdef(k.oid) LIKE '%fn_texte_date_iso(' || col.column_name || ')%');
    IF v_sans > 0 THEN
        RAISE EXCEPTION 'Dates ISO : % colonne(s) de date en texte sans contrainte de format.', v_sans;
    END IF;
END $$;

COMMIT;
