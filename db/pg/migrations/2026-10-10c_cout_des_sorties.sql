-- =============================================================================
-- 2026-10-10c — Chaque sortie porte son cout : le CMUP du moment
-- =============================================================================
-- Le grand livre ne disait pas ce que valait ce qui sortait : sur une copie
-- migree, 0 sortie de transfert sur 19, 3 sorties de production sur 16, 49
-- chargements machine sur 106 avaient un prix. La valeur consommee d'une
-- periode ne se relisait donc pas dans `ligne_mouvement` (il fallait deviner le
-- CMUP d'alors). Comme dans les ERP du marche (couche de valorisation), une
-- ligne de SORTIE sans prix recoit, a l'ecriture, le CMUP de son magasin a cet
-- instant.
--
-- SANS EFFET SUR LE CMUP : une sortie ne le touche jamais (type_mouvement :
-- impacte_cmup = 0 pour tout signe -1, contrainte type_mouvement_cmup_entree).
-- La contre-passation reecrit ses lignes sans prix (routes/stock.rs) : elle
-- n'est pas concernee. Une sortie qui porte deja un prix le garde.
-- Rejouable. Les lignes passees ne sont pas reecrites (le grand livre est
-- immuable) : seules les sorties a venir portent leur cout.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_trg_lmvt_cout_sortie() RETURNS trigger AS $$
DECLARE
    v_signe   integer;
    v_magasin text;
BEGIN
    IF NEW.prix_kg_mad IS NOT NULL THEN
        RETURN NEW;
    END IF;
    SELECT tm.signe, m.code_magasin INTO v_signe, v_magasin
      FROM mouvement m JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     WHERE m.id_mouvement = NEW.id_mouvement;
    IF v_signe = -1 THEN
        SELECT sm.cmup_mad INTO NEW.prix_kg_mad
          FROM stock_magasin sm
         WHERE sm.code_reference = NEW.code_reference AND sm.code_magasin = v_magasin;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lmvt_cout_sortie() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_lmvt_cout_sortie ON ligne_mouvement;
CREATE TRIGGER trg_lmvt_cout_sortie BEFORE INSERT ON ligne_mouvement
    FOR EACH ROW EXECUTE FUNCTION fn_trg_lmvt_cout_sortie();

COMMIT;
