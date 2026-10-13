-- =============================================================================
-- MIGRATION 2026-09-18e — LE PRIX CHANGE, TOUT LE RESTE SUIT
-- -----------------------------------------------------------------------------
-- CONSTAT DU 18/09/2026. Changer le prix, l'unite ou la devise d'une reference
-- ne deplacait rien : la fiche affichait 6,00 USD la bobine, et le CMUP restait
-- a la valeur du kilo d'avant. Avec lui restaient le solde de stock, la
-- valorisation, le cout de la qualite, le plan d'achat et les statistiques —
-- tous lisent `cmup_mad`, qui est une colonne ENREGISTREE.
--
-- Exemple mesure : prix porte de 3,00 a 6,00 USD, unite passee au kg -> bobine
-- de 30 kg, devise passee a l'euro. Le prix catalogue en dirhams suivait
-- (27,81 -> 55,62 -> 1,85 -> 2,17), le CMUP affichait toujours 27,8112.
--
-- LA REGLE, DESORMAIS TENUE PAR LA BASE : tant qu'aucun achat n'a fixe le CMUP,
-- il vaut le prix catalogue au taux en vigueur, et il suit ce prix. Des qu'une
-- ligne de mouvement porte un prix, le CMUP est une moyenne d'achats reels :
-- ni un tarif, ni un taux de change n'y touchent plus.
--
-- DEUX DECLENCHEURS, parce qu'il y a deux facons de deplacer ce prix :
--   * la fiche de la reference (prix, unite, conditionnement, densite, devise) ;
--   * le taux de change de sa devise.
--
-- Rejouable : CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- =============================================================================

BEGIN;

-- La regle, en un seul endroit : appelee par les deux declencheurs.
CREATE OR REPLACE FUNCTION fn_cmup_suivre_catalogue(p_reference text) RETURNS void AS $$
DECLARE
    v_prix       numeric;
    v_maintenant text := to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
    -- UN ACHAT L'A FIXE : on ne touche a rien. Le CMUP est alors une moyenne
    -- ponderee d'entrees valorisees, et le tarif du fournisseur n'a pas a la
    -- reecrire — c'est toute la difference entre un prix et un cout.
    IF EXISTS (SELECT 1 FROM ligne_mouvement lm
                WHERE lm.code_reference = p_reference AND lm.prix_kg_mad IS NOT NULL) THEN
        RETURN;
    END IF;

    v_prix := fn_prix_catalogue_mad(p_reference);

    UPDATE stock_magasin
       SET cmup_mad = v_prix, date_maj = v_maintenant
     WHERE code_reference = p_reference
       AND cmup_mad IS DISTINCT FROM v_prix;

    UPDATE reference
       SET cmup_mad = v_prix, date_dernier_cmup = CASE WHEN v_prix IS NULL THEN NULL ELSE v_maintenant END
     WHERE code_reference = p_reference
       AND cmup_mad IS DISTINCT FROM v_prix;
END;
$$ LANGUAGE plpgsql;


-- --- 1. La fiche de la reference ----------------------------------------------
-- `UPDATE OF` nomme les colonnes qui changent le prix au kilo : le declencheur
-- ne se rappelle donc pas lui-meme quand il ecrit `cmup_mad`.
CREATE OR REPLACE FUNCTION fn_trg_reference_cmup() RETURNS trigger AS $$
BEGIN
    PERFORM fn_cmup_suivre_catalogue(NEW.code_reference);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reference_cmup ON reference;
CREATE TRIGGER trg_reference_cmup
AFTER UPDATE OF prix_catalogue, code_devise_catalogue, unite_catalogue,
                poids_bobine_kg, bobines_par_palette, bobines_par_lot, densite_kg_ml
ON reference FOR EACH ROW
EXECUTE FUNCTION fn_trg_reference_cmup();


-- --- 2. Le taux de change --------------------------------------------------------
-- Un taux neuf change le prix en dirhams de TOUTES les references de cette
-- devise. C'est ce que faisait la migration 2026-09-18c a la main ; la base le
-- fait desormais seule, a chaque taux saisi.
CREATE OR REPLACE FUNCTION fn_trg_taux_cmup() RETURNS trigger AS $$
DECLARE r record;
BEGIN
    FOR r IN SELECT code_reference FROM reference WHERE code_devise_catalogue = NEW.code_devise
    LOOP
        PERFORM fn_cmup_suivre_catalogue(r.code_reference);
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_taux_cmup ON taux_change;
CREATE TRIGGER trg_taux_cmup
AFTER INSERT OR UPDATE OF taux, date_debut, date_fin ON taux_change FOR EACH ROW
EXECUTE FUNCTION fn_trg_taux_cmup();


-- --- 3. Ce qui traine deja ----------------------------------------------------
-- Une fiche dont le prix a ete change avant ce jour porte encore l'ancien CMUP.
DO $$
DECLARE r record; n bigint := 0;
BEGIN
    FOR r IN SELECT code_reference FROM reference
    LOOP
        PERFORM fn_cmup_suivre_catalogue(r.code_reference);
    END LOOP;
    SELECT count(*) INTO n FROM reference
     WHERE cmup_mad IS DISTINCT FROM fn_prix_catalogue_mad(code_reference)
       AND NOT EXISTS (SELECT 1 FROM ligne_mouvement lm
                        WHERE lm.code_reference = reference.code_reference
                          AND lm.prix_kg_mad IS NOT NULL);
    IF n > 0 THEN
        RAISE EXCEPTION '% reference(s) sans achat gardent un CMUP different du catalogue', n;
    END IF;
    RAISE NOTICE 'CMUP aligne sur le catalogue partout ou aucun achat ne l''a fixe';
END $$;

COMMIT;
