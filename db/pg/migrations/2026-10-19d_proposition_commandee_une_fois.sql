-- =============================================================================
-- 2026-10-19d — Une proposition d'achat ne se commande qu'une fois (19/10/2026)
-- =============================================================================
-- Decision de l'utilisateur : « signal et refus ». Deux personnes preparent des
-- bons a partir du meme plan d'achat. Le verrou d'en-tete (2026-10-17d) protege
-- un bon que deux personnes MODIFIENT ; il ne voit pas deux personnes qui
-- CREENT chacune un bon pour la meme proposition — deux documents differents.
-- Constate dans le code : A commande, la proposition passe COMMANDE ; B, dont
-- l'ecran l'affichait encore, cree son bon sans erreur, simplement sans lien au
-- plan. La meme matiere est commandee deux fois, en silence.
--
--   1. LE REFUS, en base, quel que soit le chemin (ecran du bon, conversion
--      depuis le plan d'achat, ligne ajoutee a un bon existant) : une ligne de
--      bon ne peut servir une proposition deja servie par un bon non annule.
--      La proposition est verrouillee le temps de la verification : deux
--      creations simultanees passent l'une apres l'autre, la seconde est refusee.
--   2. LE SIGNAL C57 : ce qui passerait quand meme — une meme reference sur
--      plusieurs bons ouverts, dont l'un sert le plan. Un fractionnement voulu
--      y apparait aussi : c'est un avis a relire, pas un refus.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_trg_ligne_bc_proposition() RETURNS trigger AS $$
DECLARE
    v_bon  text;
    v_nom  text;
    v_ref  text;
BEGIN
    IF NEW.id_proposition IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.id_proposition IS NOT DISTINCT FROM NEW.id_proposition THEN
        RETURN NEW;
    END IF;
    -- Serialise les creations concurrentes sur la meme proposition.
    PERFORM 1 FROM plan_achat WHERE id_proposition = NEW.id_proposition FOR UPDATE;

    SELECT b.numero_bc, u.nom, l.code_reference
      INTO v_bon, v_nom, v_ref
      FROM ligne_bc l
      JOIN bon_commande b ON b.id_bc = l.id_bc
      LEFT JOIN utilisateur u ON u.id_utilisateur = b.id_utilisateur_creation
     WHERE l.id_proposition = NEW.id_proposition
       AND l.id_ligne_bc <> NEW.id_ligne_bc
       -- Un AUTRE bon : la meme reference sur deux lignes d'un meme bon (deux
       -- dates de livraison) reste une seule commande.
       AND l.id_bc <> NEW.id_bc
       AND b.statut <> 'ANNULE'
     LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'R-PROP : la proposition d''achat de % est deja commandee dans % (bon cree par %). Ouvrez ce bon plutot que d''en faire un second.',
            v_ref, v_bon, COALESCE(v_nom, 'un autre compte');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_ligne_bc_proposition() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_ligne_bc_proposition ON ligne_bc;
CREATE TRIGGER trg_ligne_bc_proposition BEFORE INSERT OR UPDATE OF id_proposition ON ligne_bc
    FOR EACH ROW EXECUTE FUNCTION fn_trg_ligne_bc_proposition();

-- Le signal : une reference sur plusieurs bons ouverts, dont l'un sert le plan.
CREATE OR REPLACE VIEW v_ctl_c57 AS
SELECT l.code_reference,
       string_agg(DISTINCT b.numero_bc, ', ') AS bons,
       count(DISTINCT b.id_bc) AS nb_bons
  FROM ligne_bc l
  JOIN bon_commande b ON b.id_bc = l.id_bc
 WHERE b.statut <> 'ANNULE'
   AND l.code_reference IS NOT NULL
   AND l.quantite_restante_kg > 0
 GROUP BY l.code_reference
HAVING count(DISTINCT b.id_bc) > 1
   AND count(*) FILTER (WHERE l.id_proposition IS NOT NULL) > 0;
ALTER VIEW v_ctl_c57 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C57' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C57''::text, ''Reference sur plusieurs bons ouverts, dont un sert le plan d''''achat''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c57)';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ligne_bc_proposition')
       OR position('C57' IN pg_get_viewdef('v_controles'::regclass)) = 0 THEN
        RAISE EXCEPTION '2026-10-19d : migration incomplete';
    END IF;
END $$;

COMMIT;
