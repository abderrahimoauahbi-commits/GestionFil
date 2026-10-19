-- =============================================================================
-- 2026-10-19f — Un bon de commande : un seul recepteur a la fois (19/10/2026)
-- =============================================================================
-- Decision de l'utilisateur : une reception se controle a l'oeil, deux
-- personnes ne tiennent pas la meme mission sur le meme bon. Un bon en
-- reception (brouillon ou a controler) chez un recepteur est bloque pour les
-- AUTRES, jusqu'a la validation ou l'annulation de ses receptions. Le meme
-- recepteur peut en tenir plusieurs (deux camions) : la regle est « un seul
-- recepteur », pas « une seule reception » — comme Odoo, ou une commande n'a
-- qu'une reception ouverte a la fois.
--
-- Remplace le calcul par ligne de 2026-10-19e (reste moins les autres pesees en
-- cours) : plus simple et plus strict. Pas de derogation : c'est la regle
-- d'organisation, pas un ecart de pesee. Le refus a la validation et le signal
-- C58 de 2026-10-19e restent.
--
-- Le bon est verrouille (ligne de bon_commande) le temps de la verification :
-- deux receptions qui prennent le meme bon au meme instant passent l'une apres
-- l'autre, la seconde est refusee.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_trg_ligne_reception_en_cours() RETURNS trigger AS $$
DECLARE
    v_bc   text;
    v_num  text;
    v_qui  text;
    v_moi  text;
BEGIN
    IF NEW.id_ligne_bc IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.id_ligne_bc IS NOT DISTINCT FROM OLD.id_ligne_bc THEN
        RETURN NEW;
    END IF;
    -- Le bon de la ligne, verrouille le temps de la verification.
    SELECT b.id_bc, b.numero_bc INTO v_bc, v_num
      FROM ligne_bc lb JOIN bon_commande b ON b.id_bc = lb.id_bc
     WHERE lb.id_ligne_bc = NEW.id_ligne_bc
       FOR UPDATE OF b;

    SELECT id_utilisateur_reception INTO v_moi FROM reception WHERE id_reception = NEW.id_reception;

    SELECT string_agg(DISTINCT r.numero_reception || ' (' || COALESCE(u.nom, 'un autre compte') || ')', ', ')
      INTO v_qui
      FROM ligne_reception l
      JOIN ligne_bc lb ON lb.id_ligne_bc = l.id_ligne_bc
      JOIN reception r ON r.id_reception = l.id_reception
      LEFT JOIN utilisateur u ON u.id_utilisateur = r.id_utilisateur_reception
     WHERE lb.id_bc = v_bc
       AND l.id_reception <> NEW.id_reception
       AND r.statut IN ('BROUILLON', 'A_CONTROLER')
       AND r.id_utilisateur_reception IS DISTINCT FROM v_moi;

    IF v_qui IS NOT NULL THEN
        RAISE EXCEPTION 'R-REC : le bon % est deja en reception dans %. Un seul recepteur a la fois par bon : attendez la validation ou l''annulation de ses receptions.',
            v_num, v_qui;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_ligne_reception_en_cours() OWNER TO gestionfil;

-- Le declencheur ne regarde plus que la ligne de bon visee.
DROP TRIGGER IF EXISTS trg_ligne_reception_en_cours ON ligne_reception;
CREATE TRIGGER trg_ligne_reception_en_cours
    BEFORE INSERT OR UPDATE OF id_ligne_bc ON ligne_reception
    FOR EACH ROW EXECUTE FUNCTION fn_trg_ligne_reception_en_cours();

-- Le signal, au niveau du bon : quelle reception le tient, et qui.
CREATE OR REPLACE VIEW v_bon_en_reception AS
SELECT lb.id_bc,
       string_agg(DISTINCT r.numero_reception || ' (' || COALESCE(u.nom, '?') || ')', ', ') AS en_reception_dans,
       array_agg(DISTINCT r.id_reception) AS receptions
  FROM ligne_reception l
  JOIN ligne_bc lb ON lb.id_ligne_bc = l.id_ligne_bc
  JOIN reception r ON r.id_reception = l.id_reception
  LEFT JOIN utilisateur u ON u.id_utilisateur = r.id_utilisateur_reception
 WHERE r.statut IN ('BROUILLON', 'A_CONTROLER')
 GROUP BY lb.id_bc;
ALTER VIEW v_bon_en_reception OWNER TO gestionfil;

COMMIT;
