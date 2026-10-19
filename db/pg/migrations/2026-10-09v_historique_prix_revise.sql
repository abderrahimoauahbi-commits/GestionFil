-- =============================================================================
-- 2026-10-09v — L'historique des prix suit la revalidation (audit v5, U3)
-- =============================================================================
-- historique_prix est immuable et unique par ligne de reception : une
-- reception devalidee, corrigee (prix, poids) puis revalidee gardait le prix
-- de sa premiere validation, et les statistiques de prix avec. La correction
-- s'ecrit desormais a cote, sans rien remplacer :
--   * historique_prix_revision : une version par revalidation qui change le
--     prix ou la quantite (immuable elle aussi) ;
--   * v_historique_prix_courant : l'historique, chaque ligne a sa derniere
--     version — memes colonnes que la table, plus `version` ;
--   * les statistiques de prix (v_stat_prix_mois, v_stat_prix_reference) et la
--     supervision lisent la vue courante.
-- Les types de la vue sont ceux de la table : les vues qui en dependent
-- gardent les leurs. Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS historique_prix_revision (
    id_revision         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    id_ligne_reception  text NOT NULL REFERENCES historique_prix(id_ligne_reception),
    version             int  NOT NULL CHECK (version >= 2),
    prix_kg_devise      numeric(18, 4),
    code_devise         text,
    taux_change         numeric(9, 4),
    prix_kg_mad         numeric(18, 4) NOT NULL,
    quantite_achetee_kg numeric(18, 4) NOT NULL,
    total_mad           numeric(18, 2) NOT NULL,
    date_enregistrement text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_utilisateur      text REFERENCES utilisateur(id_utilisateur),
    UNIQUE (id_ligne_reception, version)
);
ALTER TABLE historique_prix_revision OWNER TO gestionfil;
CREATE INDEX IF NOT EXISTS ix_fk_historique_prix_revision_utilisateur ON historique_prix_revision(id_utilisateur);

CREATE OR REPLACE FUNCTION fn_trg_histo_revision_immuable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'R03 : une revision de l''historique des prix ne se modifie ni ne se supprime.';
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_histo_revision_immuable() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_histo_revision_immuable ON historique_prix_revision;
CREATE TRIGGER trg_histo_revision_immuable BEFORE UPDATE OR DELETE ON historique_prix_revision
FOR EACH ROW EXECUTE FUNCTION fn_trg_histo_revision_immuable();

CREATE OR REPLACE VIEW v_historique_prix_courant AS
SELECT h.id_histo_prix, h.id_ligne_reception, h.code_reference, h.code_fournisseur, h.date_achat::text AS date_achat,
       COALESCE(r.prix_kg_devise, h.prix_kg_devise)::numeric(18,4) AS prix_kg_devise,
       COALESCE(r.code_devise, h.code_devise) AS code_devise,
       COALESCE(r.taux_change, h.taux_change)::numeric(9,4) AS taux_change,
       COALESCE(r.prix_kg_mad, h.prix_kg_mad)::numeric(18,4) AS prix_kg_mad,
       COALESCE(r.quantite_achetee_kg, h.quantite_achetee_kg)::numeric(18,4) AS quantite_achetee_kg,
       COALESCE(r.total_mad, h.total_mad)::numeric(18,2) AS total_mad,
       h.conditions,
       COALESCE(r.date_enregistrement, h.date_enregistrement) AS date_enregistrement,
       COALESCE(r.version, 1) AS version
  FROM historique_prix h
  LEFT JOIN LATERAL (SELECT * FROM historique_prix_revision x
                      WHERE x.id_ligne_reception = h.id_ligne_reception
                      ORDER BY x.version DESC LIMIT 1) r ON true;
ALTER VIEW v_historique_prix_courant OWNER TO gestionfil;

DO $$
DECLARE
    v text;
    def text;
BEGIN
    FOREACH v IN ARRAY ARRAY['v_stat_prix_mois', 'v_stat_prix_reference', 'v_supervision_valeurs'] LOOP
        def := pg_get_viewdef(v::regclass);
        IF position('v_historique_prix_courant' IN def) = 0 THEN
            def := regexp_replace(rtrim(rtrim(def), ';'), '\mhistorique_prix\M', 'v_historique_prix_courant', 'g');
            EXECUTE format('CREATE OR REPLACE VIEW %I AS %s', v, def);
        END IF;
    END LOOP;
END $$;

COMMIT;
