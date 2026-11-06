-- =============================================================================
-- 2026-11-06d — C70 : le titrage de la reference contredit celui de sa famille
-- =============================================================================
-- Revue des 22 domaines (06/11/2026), arbitrage 6 : le titrage reste un
-- LIBELLE (aucune unite normalisee, aucun calcul ne le lit), mais la meme
-- information vit a deux endroits — `reference.titrage` et `famille.titrage`.
-- Quand ils se contredisent, on le SIGNALE (jamais un refus) : un controle de
-- plus, ATTENTION.
--
-- La comparaison porte sur la valeur en tete du libelle (« 1500 », « 16/2 »,
-- « 1750*2 »), l'unite ecrite ou non : « 1500 » et « 1500 dtex » s'accordent,
-- « 1750*2 » et « 1750 dtex » non. Sans chiffre en tete, le libelle entier.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE VIEW v_ctl_c70 AS
WITH x AS (
    SELECT r.code_reference, r.designation, r.code_categorie, r.code_famille,
           btrim(r.titrage) AS titrage_reference,
           btrim(f.titrage) AS titrage_famille,
           substring(btrim(r.titrage) FROM '^[0-9]+(?:[.,][0-9]+)?(?:\s*[*/xX]\s*[0-9]+)?') AS tete_reference,
           substring(btrim(f.titrage) FROM '^[0-9]+(?:[.,][0-9]+)?(?:\s*[*/xX]\s*[0-9]+)?') AS tete_famille
      FROM reference r
      JOIN famille f ON f.code_famille = r.code_famille
     WHERE r.actif = 1
       AND btrim(COALESCE(r.titrage, '')) <> ''
       AND btrim(COALESCE(f.titrage, '')) <> ''
)
SELECT code_reference, designation, code_categorie, code_famille, titrage_reference, titrage_famille
  FROM x
 WHERE regexp_replace(lower(COALESCE(tete_reference, titrage_reference)), '\s', '', 'g')
    <> regexp_replace(lower(COALESCE(tete_famille, titrage_famille)), '\s', '', 'g');
ALTER VIEW v_ctl_c70 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('v_ctl_c70' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C70''::text, ''Titrage de la reference different de celui de sa famille''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c70)';
    END IF;
END $$;

-- Les colonnes du detail (une colonne non declaree est masquee a l'ecran).
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'COCKPIT', c.champ, c.libelle, 'LECTURE', 0, 996
  FROM (VALUES ('code_reference',    'Référence'),
               ('designation',       'Désignation'),
               ('code_categorie',    'Catégorie'),
               ('code_famille',      'Famille'),
               ('titrage_reference', 'Titrage de la référence'),
               ('titrage_famille',   'Titrage de la famille')) c(champ, libelle)
ON CONFLICT DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM v_controles WHERE code = 'C70') THEN
        RAISE EXCEPTION '2026-11-06d : C70 absent de v_controles.';
    END IF;
END $$;

COMMIT;
