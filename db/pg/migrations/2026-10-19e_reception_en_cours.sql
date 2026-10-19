-- =============================================================================
-- 2026-10-19e — Deux receptions sur la meme ligne de bon (decision du 19/10/2026)
-- =============================================================================
-- Le reste a recevoir d'une ligne de bon ne baisse qu'a la VALIDATION d'une
-- reception. Deux magasiniers qui pesent en meme temps la meme ligne voyaient
-- donc chacun le reste entier ; et a la validation, le recu etait plafonne en
-- silence a la quantite commandee : le stock entrait deux fois, le bon disait
-- « recu en totalite ». Un double invisible.
--
-- Decision : signal et refus, sans verrouiller le bon a l'ouverture (plusieurs
-- camions sur un meme bon restent possibles).
--   1. LE REFUS A LA PESEE (ici) : le reste disponible est le reste du bon MOINS
--      ce que les autres receptions en cours (brouillon, a controler) pesent deja
--      sur cette ligne. Au-dela de la tolerance du fournisseur, refus nommant
--      l'autre reception et son auteur ; la derogation motivee reste possible.
--      La ligne de bon est verrouillee le temps du calcul : deux pesees
--      simultanees passent l'une apres l'autre.
--   2. LE REFUS A LA VALIDATION : domain/reception.rs (le plafond silencieux).
--   3. LE SIGNAL C58 : une ligne de bon recue au-dela de sa commande et de la
--      tolerance — les doubles d'avant ce changement.
-- C10 (l'ecart d'une pesee seule) est inchange.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_trg_ligne_reception_en_cours() RETURNS trigger AS $$
DECLARE
    v_reste    numeric;
    v_en_cours numeric;
    v_qui      text;
    v_tol      numeric;
BEGIN
    IF NEW.id_ligne_bc IS NULL OR NEW.derogation_ecart = 1 THEN
        RETURN NEW;
    END IF;
    -- Une mise a jour qui ne change ni la pesee ni la ligne visee ne se rejuge pas.
    IF TG_OP = 'UPDATE'
       AND NEW.quantite_stock_kg IS NOT DISTINCT FROM OLD.quantite_stock_kg
       AND NEW.id_ligne_bc IS NOT DISTINCT FROM OLD.id_ligne_bc
       AND NEW.derogation_ecart IS NOT DISTINCT FROM OLD.derogation_ecart THEN
        RETURN NEW;
    END IF;
    -- Serialise les pesees concurrentes sur la meme ligne de bon.
    SELECT quantite_restante_kg INTO v_reste
      FROM ligne_bc WHERE id_ligne_bc = NEW.id_ligne_bc FOR UPDATE;

    SELECT COALESCE(sum(l.quantite_stock_kg), 0),
           string_agg(DISTINCT r.numero_reception || ' (' || COALESCE(u.nom, 'un autre compte') || ')', ', ')
      INTO v_en_cours, v_qui
      FROM ligne_reception l
      JOIN reception r ON r.id_reception = l.id_reception
      LEFT JOIN utilisateur u ON u.id_utilisateur = r.id_utilisateur_reception
     WHERE l.id_ligne_bc = NEW.id_ligne_bc
       AND l.id_reception <> NEW.id_reception
       AND r.statut IN ('BROUILLON', 'A_CONTROLER');

    IF v_en_cours > 0 THEN
        v_tol := fn_tolerance_pesee(NEW.id_reception);
        IF NEW.quantite_stock_kg + v_en_cours > v_reste * (1 + v_tol / 100.0) + 0.0005 THEN
            RAISE EXCEPTION 'R-REC : cette ligne de bon est deja en cours de reception dans % (% kg). Il reste % kg a recevoir : % kg de plus depassent la tolerance de % %%. Une derogation motivee est requise.',
                v_qui, round(v_en_cours, 2), round(GREATEST(v_reste - v_en_cours, 0), 2),
                round(NEW.quantite_stock_kg, 2), round(v_tol, 2);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_ligne_reception_en_cours() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_ligne_reception_en_cours ON ligne_reception;
CREATE TRIGGER trg_ligne_reception_en_cours
    BEFORE INSERT OR UPDATE OF quantite_stock_kg, id_ligne_bc, derogation_ecart ON ligne_reception
    FOR EACH ROW EXECUTE FUNCTION fn_trg_ligne_reception_en_cours();

-- Ce que les receptions en cours pesent deja sur chaque ligne de bon : l'ecran
-- le montre au choix des lignes (le signal).
CREATE OR REPLACE VIEW v_ligne_bc_en_cours AS
SELECT l.id_ligne_bc,
       sum(l.quantite_stock_kg) AS en_cours_kg,
       string_agg(DISTINCT r.numero_reception || ' (' || COALESCE(u.nom, '?') || ')', ', ') AS en_cours_dans,
       array_agg(DISTINCT r.id_reception) AS receptions
  FROM ligne_reception l
  JOIN reception r ON r.id_reception = l.id_reception
  LEFT JOIN utilisateur u ON u.id_utilisateur = r.id_utilisateur_reception
 WHERE l.id_ligne_bc IS NOT NULL
   AND r.statut IN ('BROUILLON', 'A_CONTROLER')
 GROUP BY l.id_ligne_bc;
ALTER VIEW v_ligne_bc_en_cours OWNER TO gestionfil;

-- C58 : une ligne de bon recue au-dela de sa commande et de la tolerance.
CREATE OR REPLACE VIEW v_ctl_c58 AS
SELECT b.numero_bc, lb.ligne_numero, lb.code_reference,
       lb.quantite_commandee_kg, sum(l.quantite_stock_kg) AS recu_kg,
       string_agg(DISTINCT r.numero_reception, ', ') AS receptions
  FROM ligne_bc lb
  JOIN bon_commande b ON b.id_bc = lb.id_bc
  JOIN fournisseur f ON f.code_fournisseur = b.code_fournisseur
  JOIN ligne_reception l ON l.id_ligne_bc = lb.id_ligne_bc
  JOIN reception r ON r.id_reception = l.id_reception
 WHERE r.statut IN ('VALIDE', 'CLOTURE')
 GROUP BY b.numero_bc, lb.ligne_numero, lb.code_reference, lb.quantite_commandee_kg, f.tolerance_pesee_pct
HAVING sum(l.quantite_stock_kg)
       > lb.quantite_commandee_kg * (1 + COALESCE(f.tolerance_pesee_pct, 0) / 100.0) + 0.0005;
ALTER VIEW v_ctl_c58 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C58' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C58''::text, ''Ligne de bon recue au-dela de sa commande et de la tolerance''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c58)';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ligne_reception_en_cours')
       OR to_regclass('public.v_ligne_bc_en_cours') IS NULL
       OR position('C58' IN pg_get_viewdef('v_controles'::regclass)) = 0 THEN
        RAISE EXCEPTION '2026-10-19e : migration incomplete';
    END IF;
END $$;

COMMIT;
