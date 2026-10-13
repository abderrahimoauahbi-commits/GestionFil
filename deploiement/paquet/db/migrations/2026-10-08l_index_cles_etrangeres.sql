-- =============================================================================
-- 2026-10-08l — Un index par cle etrangere (audit v4, P3 action 23)
-- =============================================================================
-- 116 cles etrangeres sans index au 08/10/2026. Sans lui, chaque suppression
-- ou modification de cle d'un parent (un utilisateur, une devise, un magasin)
-- parcourt toute la table enfant en tenant ses verrous, et les jointures de
-- l'enfant vers le parent se font en balayage complet. La liste se recalcule a
-- chaque passage : rejouee plus tard, la migration couvre aussi les cles
-- ajoutees depuis. Les noms sont bornes a 63 caracteres (limite PostgreSQL),
-- avec une empreinte courte pour rester uniques.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    fk  record;
    nom text;
    n   int := 0;
BEGIN
    FOR fk IN
        SELECT c.conrelid::regclass::text AS tbl,
               string_agg(quote_ident(a.attname), ', ' ORDER BY x.n) AS cols,
               string_agg(a.attname, '_' ORDER BY x.n) AS cols_nom
          FROM pg_constraint c
          CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS x(attnum, n)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum
         WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
           AND NOT EXISTS (
               SELECT 1 FROM pg_index i
                WHERE i.indrelid = c.conrelid
                  AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
                  AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey)
         GROUP BY c.oid, c.conrelid
    LOOP
        nom := left('ix_fk_' || fk.tbl || '_' || fk.cols_nom, 54) || '_' || left(md5(fk.tbl || fk.cols), 8);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (%s)', nom, fk.tbl, fk.cols);
        n := n + 1;
    END LOOP;
    RAISE NOTICE 'index de cles etrangeres poses : %', n;
END $$;

COMMIT;
