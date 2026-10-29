-- =============================================================================
-- 2026-10-19b — Etiquettes de lot a code-barres (audit P3)
-- =============================================================================
-- Decision du 19/10/2026 : « Etiquettes de lot imprimees par l'ERP ». A la
-- reception, l'ERP imprime une etiquette par bobine ou par palette ; on la
-- scanne a la sortie et au chargement machine, au lieu de taper la reference
-- et le lot — la ou naissent les erreurs de lot que FIFO et tracabilite
-- paient ensuite.
--
-- L'ETIQUETTE NE PORTE PAS LA MARCHANDISE EN CLAIR : elle porte un CODE court
-- (« E » + 9 chiffres, Code 128) qui renvoie a la ligne de reception — donc a
-- la reference, au lot, a l'arrivage. Un code court se lit vite et de loin ;
-- une reference de 30 caracteres avec espaces ne passe pas sur une etiquette
-- de 50 mm. Et la base, pas l'etiquette, reste la verite : un lot corrige
-- apres coup (renommage provisoire, lots.rs) est relu au scan.
--
-- LE NOMBRE D'ETIQUETTES : le colisage compte sur le quai (nb_bobines_saisi,
-- nb_palettes_saisi), a defaut le theorique du catalogue. LE POIDS imprime est
-- la moyenne de la ligne (kilos peses / nombre) : une indication pour
-- l'operateur, pas une quantite — le kilogramme du grand livre ne vient
-- jamais d'une etiquette.
--
-- Les etiquettes ne se modifient pas (elles sont collees sur la marchandise) ;
-- elles disparaissent avec la ligne d'une reception encore en brouillon.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Une sequence, pas un compteur : des trous sont sans consequence ici (une
-- etiquette n'est pas une piece comptable), et la sequence ne serialise pas
-- les receptions entre elles comme le ferait la ligne d'un compteur.
CREATE SEQUENCE IF NOT EXISTS seq_etiquette_lot;
ALTER SEQUENCE seq_etiquette_lot OWNER TO gestionfil;

CREATE TABLE IF NOT EXISTS etiquette_lot (
    code                text    NOT NULL PRIMARY KEY
                                DEFAULT 'E' || lpad(nextval('seq_etiquette_lot')::text, 9, '0')
                                CONSTRAINT ck_etq_code CHECK (code ~ '^E[0-9]{9}$'),
    id_ligne_reception  text    NOT NULL
                                REFERENCES ligne_reception(id_ligne_reception) ON DELETE CASCADE,
    nature              text    NOT NULL CONSTRAINT ck_etq_nature CHECK (nature IN ('BOBINE', 'PALETTE')),
    rang                integer NOT NULL CONSTRAINT ck_etq_rang CHECK (rang > 0),
    nombre              integer NOT NULL,
    poids_kg            numeric(18,4) CONSTRAINT ck_etq_poids CHECK (poids_kg IS NULL OR poids_kg > 0),
    id_utilisateur_creation text NOT NULL REFERENCES utilisateur(id_utilisateur),
    -- Un vrai type de date, pas du texte (cliquet A1 du 17/10/2026).
    date_creation       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_etq_rang_nombre CHECK (rang <= nombre),
    CONSTRAINT uq_etq_ligne_rang UNIQUE (id_ligne_reception, nature, rang)
);
ALTER TABLE etiquette_lot OWNER TO gestionfil;
CREATE INDEX IF NOT EXISTS ix_fk_etq_utilisateur ON etiquette_lot (id_utilisateur_creation);

-- IMMUABLE : collee sur une bobine, une etiquette ne change plus. Seule la
-- suppression de sa ligne (reception en brouillon) l'emporte.
CREATE OR REPLACE FUNCTION fn_trg_etiquette_immuable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'R-ETQ : une etiquette imprimee ne se modifie pas (%).', OLD.code
        USING ERRCODE = 'P0001';
END $$;
ALTER FUNCTION fn_trg_etiquette_immuable() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_etiquette_immuable ON etiquette_lot;
CREATE TRIGGER trg_etiquette_immuable BEFORE UPDATE ON etiquette_lot
    FOR EACH ROW EXECUTE FUNCTION fn_trg_etiquette_immuable();

-- Ce que le scan relit : la marchandise de l'etiquette, telle que la base la
-- connait MAINTENANT (lot corrige compris), et ce qu'il faut a l'ecran pour
-- convertir bobines et palettes en kilos.
CREATE OR REPLACE VIEW v_etiquette_lot AS
SELECT e.code, e.nature, e.rang, e.nombre, e.poids_kg,
       lr.id_ligne_reception, lr.code_reference, ref.designation,
       NULLIF(btrim(lr.lot_fournisseur), '') AS lot_fournisseur,
       lr.code_magasin_dest, r.id_reception, r.numero_reception, r.statut AS statut_reception,
       r.date_reception, r.code_fournisseur,
       ref.unite_catalogue, ref.poids_bobine_kg, ref.bobines_par_palette, ref.suivi_lot,
       e.date_creation, ref.bobines_par_lot, ref.densite_kg_ml
  FROM etiquette_lot e
  JOIN ligne_reception lr ON lr.id_ligne_reception = e.id_ligne_reception
  JOIN reception r        ON r.id_reception = lr.id_reception
  JOIN reference ref      ON ref.code_reference = lr.code_reference;
ALTER VIEW v_etiquette_lot OWNER TO gestionfil;

-- Temoin
DO $$
BEGIN
    IF to_regclass('public.etiquette_lot') IS NULL OR to_regclass('public.v_etiquette_lot') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_etiquette_immuable') THEN
        RAISE EXCEPTION '2026-10-19b : migration incomplete';
    END IF;
END $$;

COMMIT;
