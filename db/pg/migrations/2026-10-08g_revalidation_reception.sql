-- =============================================================================
-- 2026-10-08g — Une reception devalidee se revalide (audit v4, P2 action 13)
-- =============================================================================
-- L'IMPASSE (relevee aux audits v3 et v4, reproduite par le banc) : une
-- reception locale contre-passee puis devalidee ne se revalidait plus — le
-- numero du mouvement d'entree etait fixe (corrige dans le service), et
-- l'archive figee n'admettait qu'une ligne par ligne de reception.
--
-- L'archive reste IMMUABLE : elle se VERSIONNE. La revalidation ecrit la
-- version 2 ; v_archive_reception_courante donne la derniere version de chaque
-- ligne a ceux qui lisent (cloture par facture, fiche fournisseur, tableau de
-- bord). L'historique de prix garde l'entree d'origine (meme prix de bon).
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE archive_reception ADD COLUMN IF NOT EXISTS version smallint NOT NULL DEFAULT 1;
ALTER TABLE archive_reception DROP CONSTRAINT IF EXISTS archive_reception_id_ligne_reception_key;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archive_reception_ligne_version_key') THEN
        ALTER TABLE archive_reception ADD CONSTRAINT archive_reception_ligne_version_key
            UNIQUE (id_ligne_reception, version);
    END IF;
END $$;

CREATE OR REPLACE VIEW v_archive_reception_courante AS
SELECT a.*
  FROM archive_reception a
 WHERE NOT EXISTS (SELECT 1 FROM archive_reception b
                    WHERE b.id_ligne_reception = a.id_ligne_reception AND b.version > a.version);
ALTER VIEW v_archive_reception_courante OWNER TO gestionfil;

-- La fiche fournisseur lit la version courante.
DO $$
DECLARE def text;
BEGIN
    def := pg_get_viewdef('v_fournisseur_scorecard'::regclass);
    IF position('v_archive_reception_courante' IN def) = 0 THEN
        def := replace(def, 'FROM archive_reception ar', 'FROM v_archive_reception_courante ar');
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_fournisseur_scorecard AS ' || def;
    END IF;
END $$;

COMMIT;
