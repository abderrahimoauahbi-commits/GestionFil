-- =============================================================================
-- 2026-10-09u — Le bon de commande apres une contre-passation (audit v5, U2)
-- =============================================================================
--   * Contre-passer l'entree d'une reception retranchait ses kilos de la ligne
--     du bon, sans tenir compte du plafond pose a la reception (le recu ne
--     depasse jamais le commande) : le recu derivait. Et le bon restait
--     CLOTURE. fn_recaler_lignes_bc recalcule le recu de chaque ligne depuis les
--     receptions qui tiennent (locales VALIDE / CLOTURE, import VALIDEE, entrees
--     non contre-passees), son statut, puis celui du bon : CLOTURE, LIVRE_PARTIEL
--     ou ENVOYE.
--   * Ce retour du bon (CLOTURE -> LIVRE_PARTIEL...) n'est pas une transition
--     offerte a l'ecran : le declencheur ne l'admet que sous le drapeau
--     gestionfil.recalcul_bc, pose par la fonction.
--   * C52 : une reception validee dont une entree est contre-passee (une
--     reception d'import sur plusieurs magasins le reste tant qu'une entree
--     tient). Un signal.
-- Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_trg_transition_bc() RETURNS trigger AS $$
BEGIN
    IF OLD.statut <> NEW.statut
       AND NOT EXISTS (SELECT 1 FROM transition_statut
                        WHERE entite = 'bon_commande' AND statut_source = OLD.statut AND statut_cible = NEW.statut)
       -- Le recalage apres contre-passation (fn_recaler_lignes_bc), et lui seul.
       AND NOT (COALESCE(current_setting('gestionfil.recalcul_bc', true), '') = 'on'
                AND OLD.statut IN ('CLOTURE', 'LIVRE_PARTIEL')
                AND NEW.statut IN ('LIVRE_PARTIEL', 'ENVOYE')) THEN
        RAISE EXCEPTION 'Transition de statut interdite sur le bon de commande.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_transition_bc() OWNER TO gestionfil;

CREATE OR REPLACE FUNCTION fn_recaler_lignes_bc(p_lignes text[]) RETURNS void AS $$
DECLARE
    v_bc text;
BEGIN
    PERFORM set_config('gestionfil.recalcul_bc', 'on', true);
    UPDATE ligne_bc lb
       SET quantite_recue_kg = LEAST(lb.quantite_commandee_kg, round(
               COALESCE((SELECT sum(lr.quantite_stock_kg)
                           FROM ligne_reception lr JOIN reception r ON r.id_reception = lr.id_reception
                          WHERE lr.id_ligne_bc = lb.id_ligne_bc AND r.statut IN ('VALIDE', 'CLOTURE')
                            AND lr.id_mouvement_genere IS NOT NULL
                            AND NOT EXISTS (SELECT 1 FROM mouvement inv
                                             WHERE inv.id_mouvement_contrepasse = lr.id_mouvement_genere)), 0)
             + COALESCE((SELECT sum(rl.quantite_recue_kg)
                           FROM import_reception_lignes rl
                           JOIN import_facture_lignes fl ON fl.id_ligne = rl.id_ligne
                           JOIN import_receptions ir ON ir.id_reception = rl.id_reception
                          WHERE fl.id_ligne_bc = lb.id_ligne_bc AND ir.statut = 'VALIDEE'
                            AND rl.id_mouvement IS NOT NULL
                            AND NOT EXISTS (SELECT 1 FROM mouvement inv
                                             WHERE inv.id_mouvement_contrepasse = rl.id_mouvement)), 0), 4))
     WHERE lb.id_ligne_bc = ANY (p_lignes);
    UPDATE ligne_bc lb
       SET statut = CASE
               WHEN lb.quantite_recue_kg >= lb.quantite_commandee_kg
                        * (1 - fn_tolerance_fournisseur((SELECT b.code_fournisseur FROM bon_commande b
                                                          WHERE b.id_bc = lb.id_bc)) / 100.0) - 0.001
                    AND lb.quantite_recue_kg > 0 THEN 'SOLDE'
               WHEN lb.quantite_recue_kg > 0 THEN 'PARTIEL'
               ELSE 'EN_ATTENTE' END
     WHERE lb.id_ligne_bc = ANY (p_lignes) AND lb.statut <> 'ANNULE';
    FOR v_bc IN SELECT DISTINCT id_bc FROM ligne_bc WHERE id_ligne_bc = ANY (p_lignes) LOOP
        UPDATE bon_commande b
           SET statut = n.nouveau
          FROM (SELECT CASE
                         WHEN NOT EXISTS (SELECT 1 FROM ligne_bc l
                                           WHERE l.id_bc = v_bc AND l.type_ligne = 'MARCHANDISE'
                                             AND l.statut NOT IN ('SOLDE', 'ANNULE')) THEN 'CLOTURE'
                         WHEN EXISTS (SELECT 1 FROM ligne_bc l
                                       WHERE l.id_bc = v_bc AND l.type_ligne = 'MARCHANDISE'
                                         AND l.quantite_recue_kg > 0) THEN 'LIVRE_PARTIEL'
                         ELSE 'ENVOYE' END AS nouveau) n
         WHERE b.id_bc = v_bc AND b.statut IN ('ENVOYE', 'LIVRE_PARTIEL', 'CLOTURE')
           AND b.statut <> n.nouveau;
    END LOOP;
    PERFORM set_config('gestionfil.recalcul_bc', '', true);
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_recaler_lignes_bc(text[]) OWNER TO gestionfil;

-- C52 : une reception validee dont une entree est contre-passee.
CREATE OR REPLACE VIEW v_ctl_c52 AS
SELECT 'LOCALE'::text AS circuit, r.numero_reception AS numero, r.statut,
       count(*) AS lignes_contrepassees
  FROM reception r
  JOIN ligne_reception lr ON lr.id_reception = r.id_reception
 WHERE r.statut IN ('VALIDE', 'CLOTURE') AND lr.id_mouvement_genere IS NOT NULL
   AND EXISTS (SELECT 1 FROM mouvement inv WHERE inv.id_mouvement_contrepasse = lr.id_mouvement_genere)
 GROUP BY r.numero_reception, r.statut
UNION ALL
SELECT 'IMPORT', ir.numero, ir.statut, count(*)
  FROM import_receptions ir
  JOIN import_reception_lignes rl ON rl.id_reception = ir.id_reception
 WHERE ir.statut = 'VALIDEE' AND rl.id_mouvement IS NOT NULL
   AND EXISTS (SELECT 1 FROM mouvement inv WHERE inv.id_mouvement_contrepasse = rl.id_mouvement)
 GROUP BY ir.numero, ir.statut;
ALTER VIEW v_ctl_c52 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C52' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C52''::text, ''Reception validee dont une entree est contre-passee''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c52)';
    END IF;
END $$;

COMMIT;
