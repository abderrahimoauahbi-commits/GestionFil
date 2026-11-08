-- =============================================================================
-- 2026-11-07e — Les versions de la recette : un historique a chaque modification
-- =============================================================================
-- Revue des 22 domaines, point 9 (decision de l'utilisateur, 07/11/2026) :
-- « historique a chaque modif ». Modifier la composition ou les densites d'une
-- qualite cree une nouvelle version numerotee (V1, V2…), avec sa date, son
-- auteur et son motif ; l'ancienne reste consultable et comparable. Les calculs
-- (plan, besoin, OF) utilisent toujours la recette en cours : rien ne change
-- dans le moteur. Un OF lance garde de toute facon son etalon (`of_etalon`).
--
-- La version est un INSTANTANE (jsonb) de la composition et des densites, pose
-- par le serveur (routes/production.rs) ; la base la garde immuable. Chaque
-- qualite existante recoit ici sa V1, sa recette du jour.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS recette_version (
    id_version        text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    code_qualite      text NOT NULL REFERENCES qualite(code_qualite) ON DELETE CASCADE,
    numero            integer NOT NULL CHECK (numero > 0),
    date_version      timestamptz NOT NULL DEFAULT now(),
    id_utilisateur    text REFERENCES utilisateur(id_utilisateur),
    motif             text NOT NULL CHECK (length(btrim(motif)) >= 3),
    composition       jsonb NOT NULL,
    densites          jsonb NOT NULL,
    poids_commercial_m2 numeric(12,4),
    UNIQUE (code_qualite, numero)
);
ALTER TABLE recette_version OWNER TO gestionfil;
COMMENT ON TABLE recette_version IS
  'Versions d''une recette (07/11/2026) : instantane de la composition et des densites a chaque modification.';
CREATE INDEX IF NOT EXISTS ix_fk_recette_version_utilisateur ON recette_version (id_utilisateur);

-- L'instantane d'une qualite, tel que la base le lit : la meme fonction sert a
-- poser une version et a savoir si la recette a change depuis la derniere.
CREATE OR REPLACE FUNCTION fn_recette_instantane(p_qualite text, OUT composition jsonb, OUT densites jsonb) AS $$
    SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object(
                         'code_reference', r.code_reference, 'code_role', r.code_role,
                         'pourcentage', r.pourcentage_composition, 'couleur', r.couleur,
                         'code_groupe_equiv', r.code_groupe_equiv) ORDER BY r.ligne_numero)
                      FROM recette r WHERE r.code_qualite = p_qualite AND r.actif = 1), '[]'::jsonb),
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
                         'code_role', l.code_role, 'densite', l.densite, 'unite_densite', l.unite_densite,
                         'entre_poids_commercial', l.entre_poids_commercial) ORDER BY l.code_role)
                      FROM ligne_qualite l WHERE l.code_qualite = p_qualite AND l.actif = 1), '[]'::jsonb);
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_recette_instantane(text) OWNER TO gestionfil;

-- Une version est une trace : elle ne se modifie pas et ne s'efface qu'avec sa qualite.
CREATE OR REPLACE FUNCTION fn_trg_recette_version_immuable() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'RECETTE-VERSION : une version de recette ne se modifie pas.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM qualite q WHERE q.code_qualite = OLD.code_qualite) THEN
        RETURN OLD;  -- la qualite s'efface (brouillon jamais servi) : ses versions avec elle
    END IF;
    RAISE EXCEPTION 'RECETTE-VERSION : une version de recette ne s''efface pas.' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_recette_version_immuable() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_recette_version_immuable ON recette_version;
CREATE TRIGGER trg_recette_version_immuable BEFORE UPDATE OR DELETE ON recette_version
FOR EACH ROW EXECUTE FUNCTION fn_trg_recette_version_immuable();

DROP TRIGGER IF EXISTS trg_audit_modification ON recette_version;
CREATE TRIGGER trg_audit_modification AFTER INSERT ON recette_version
FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();

-- La V1 de chaque qualite : sa recette du jour.
INSERT INTO recette_version (code_qualite, numero, motif, composition, densites, poids_commercial_m2)
SELECT q.code_qualite, 1, 'Version initiale : la recette au 07/11/2026', i.composition, i.densites, q.poids_commercial_m2
  FROM qualite q CROSS JOIN LATERAL fn_recette_instantane(q.code_qualite) i
 WHERE NOT EXISTS (SELECT 1 FROM recette_version v WHERE v.code_qualite = q.code_qualite);

-- Les champs que l'ecran lit (un champ non declare est masque).
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'QUALITES', c.champ, c.libelle, 'LECTURE', 0, 990
  FROM (VALUES ('numero',        'Version'),
               ('date_version',  'Date de la version'),
               ('auteur',        'Auteur'),
               ('motif',         'Motif'),
               ('composition',   'Composition'),
               ('densites',      'Densités')) c(champ, libelle)
ON CONFLICT DO NOTHING;

-- Temoin
DO $$
BEGIN
    IF to_regclass('public.recette_version') IS NULL
       OR EXISTS (SELECT 1 FROM qualite q WHERE NOT EXISTS
                  (SELECT 1 FROM recette_version v WHERE v.code_qualite = q.code_qualite)) THEN
        RAISE EXCEPTION '2026-11-07e : migration incomplete';
    END IF;
END $$;

COMMIT;
