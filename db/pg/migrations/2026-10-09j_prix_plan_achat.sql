-- =============================================================================
-- 2026-10-09j — Le prix d'une proposition d'achat (regle 8, 09/10/2026)
-- =============================================================================
-- Le plan d'achat estimait 124 propositions sur 125 au CMUP : un prix qui dit
-- ce que vaut le stock (anciens prix, frais deja payes), pas ce que coutera la
-- prochaine commande — et que la grille de l'assistante achats lui masque
-- partout ailleurs. Arbitrage, dans cet ordre strict :
--   1. le DERNIER PRIX D'ACHAT : le dernier bon VALIDE de la reference chez ce
--      fournisseur, en devise, converti au taux de reference du jour ;
--   2. le PRIX CATALOGUE ;
--   3. le CMUP — et dans ce seul cas, le service le masque a qui ne voit pas
--      le CMUP et marque la proposition « prix a saisir ».
-- C'est la logique de SAP (fiche article-fournisseur avant le prix moyen).
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_dernier_prix_achat_mad(p_reference text, p_fournisseur text)
RETURNS numeric AS $$
    SELECT round(lb.prix_kg_devise
                 * CASE WHEN bc.code_devise = 'MAD' THEN 1
                        ELSE (SELECT t.taux FROM taux_change t
                               WHERE t.code_devise = bc.code_devise
                                 AND to_char(current_date, 'YYYY-MM-DD') >= substr(t.date_debut, 1, 10)
                                 AND (t.date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(t.date_fin, 1, 10))
                               ORDER BY t.date_debut DESC LIMIT 1) END, 4)
      FROM ligne_bc lb
      JOIN bon_commande bc ON bc.id_bc = lb.id_bc
     WHERE lb.code_reference = p_reference AND bc.code_fournisseur = p_fournisseur
       AND lb.type_ligne = 'MARCHANDISE' AND lb.prix_kg_devise > 0
       AND bc.statut IN ('VALIDE', 'ENVOYE', 'LIVRE_PARTIEL', 'CLOTURE')
     ORDER BY COALESCE(bc.date_validation, bc.date_bc::text) DESC, lb.ligne_numero
     LIMIT 1;
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_dernier_prix_achat_mad(text, text) OWNER TO gestionfil;

-- Les propositions enregistrees gardent leur source.
ALTER TABLE plan_achat DROP CONSTRAINT IF EXISTS plan_achat_source_prix_check;
ALTER TABLE plan_achat ADD CONSTRAINT plan_achat_source_prix_check
    CHECK (source_prix = ANY (ARRAY['DERNIER_ACHAT', 'CATALOGUE', 'CMUP', 'NEGOCIE', 'AUCUN']));

DO $$
DECLARE
    def text;
    prix_avant   text := 'COALESCE(r.cmup_mad, round((r.prix_catalogue_kg * COALESCE(tc.taux, 1.0)), 4)) AS prix_retenu_mad,';
    prix_apres   text := 'COALESCE(fn_dernier_prix_achat_mad(r.code_reference, r.code_fournisseur), round((r.prix_catalogue_kg * tc.taux), 4), r.cmup_mad) AS prix_retenu_mad,';
    source_avant text := 'WHEN (r.cmup_mad IS NOT NULL) THEN ''CMUP''::text
                    ELSE ''CATALOGUE''::text';
    source_apres text := 'WHEN (fn_dernier_prix_achat_mad(r.code_reference, r.code_fournisseur) IS NOT NULL) THEN ''DERNIER_ACHAT''::text
                    WHEN ((r.prix_catalogue_kg IS NOT NULL) AND (tc.taux IS NOT NULL)) THEN ''CATALOGUE''::text
                    WHEN (r.cmup_mad IS NOT NULL) THEN ''CMUP''::text
                    ELSE ''AUCUN''::text';
BEGIN
    def := pg_get_viewdef('v_plan_achat'::regclass);
    IF position('fn_dernier_prix_achat_mad' IN def) > 0 THEN
        RETURN;
    END IF;
    IF position(prix_avant IN def) = 0 OR position(source_avant IN def) = 0 THEN
        RAISE EXCEPTION 'v_plan_achat : l''expression du prix est introuvable, la vue a change';
    END IF;
    def := replace(replace(def, prix_avant, prix_apres), source_avant, source_apres);
    EXECUTE 'CREATE OR REPLACE VIEW v_plan_achat AS ' || rtrim(rtrim(def), ';');
END $$;

COMMIT;
