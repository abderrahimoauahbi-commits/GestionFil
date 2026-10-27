-- =============================================================================
-- 2026-10-27j — Les paramètres MRP sans lecteur sont supprimés
-- =============================================================================
-- ARBITRAGE DU 27/10/2026 (direction) : « Paramètres MRP sans lecteur →
-- supprimer, après dernier contrôle des lecteurs ; conserver uniquement ceux
-- encore utilisés. » Conservés : ceux que lit le moteur de couverture
-- (domain/couverture.rs, routes/couverture.rs, domain/plan_achat.rs) et ceux qui
-- servent de valeur par défaut au paramétrage d'une qualité. L'ancien calcul du
-- stock minimum n'est pas réintroduit.
--
-- RELEVÉ DES LECTEURS (27/10/2026, sur une copie de gestionfil_saisie : toutes les
-- vues, fonctions, déclencheurs et contrôles par pg_get_viewdef /
-- pg_get_functiondef ; le serveur, l'interface, l'assistant, les scripts) :
-- aucun lecteur pour les quatre paramètres ci-dessous, laissés « à décider » par
-- 2026-10-27e quand l'ancien calcul a été retiré :
--
--   * P_RetardBCJours        — tolérance de retard de v_encours_fiable (retirée,
--                              27e) ; C28 suit la règle du moteur (date dépassée).
--   * P_EncoursRetardInclus  — libellé de C28 et en-cours de v_encours_fiable
--                              (retirés, 27e) ; le moteur ne compte jamais un bon
--                              en retard.
--   * P_HorizonProlonge      — prolongation du plan dans v_besoin_horizon et
--                              v_besoin_mois (retirées / redéfinies, 27b et 27e) ;
--                              le moteur n'a pas de prolongation.
--   * P_EcartCouvertureJours — seuil du contrôle C27 (retiré, 27e).
--
-- GARDÉS (ils ont un lecteur) : P_SecuriteA/B/C, P_DelaiDefaut, P_MargeJours
-- (moteur), P_DureeEcartJours (plan d'achat), P_SeuilAlerte (moteur, affichage)
-- et P_MargeSecurite, P_CouvMinMois, P_SeuilAlerte, P_SeuilCritique, P_TauxPerte,
-- P_SecuriteA (défauts d'une qualité et du plan de production, NOT NULL au plan).
-- Les colonnes de la fiche article (stock_min_kg, couverture_min_mois,
-- marge_securite_pct) restent : routes/couverture.rs les lit (réglages affichés
-- en alerte) et v_stocks_minimums_a_revoir lit les deux premières.
--
-- La suppression est journalisée (trg_audit_suppression) ; l'historique de
-- valeurs d'un paramètre, s'il en a, part avec lui (clé étrangère).
-- Aucun objet créé : pas d'OWNER à poser.
-- Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

DELETE FROM parametre_historique
 WHERE code_parametre IN ('P_RetardBCJours', 'P_EncoursRetardInclus',
                          'P_HorizonProlonge', 'P_EcartCouvertureJours');
DELETE FROM parametre
 WHERE code_parametre IN ('P_RetardBCJours', 'P_EncoursRetardInclus',
                          'P_HorizonProlonge', 'P_EcartCouvertureJours');

-- -----------------------------------------------------------------------------
-- Témoin : les quatre sont partis, et aucune vue ni fonction ne les lisait.
-- -----------------------------------------------------------------------------
DO $$
DECLARE v_lecteurs text;
BEGIN
    IF EXISTS (SELECT 1 FROM parametre
                WHERE code_parametre IN ('P_RetardBCJours', 'P_EncoursRetardInclus',
                                         'P_HorizonProlonge', 'P_EcartCouvertureJours')) THEN
        RAISE EXCEPTION '2026-10-27j : migration incomplète';
    END IF;

    SELECT string_agg(objet, ', ') INTO v_lecteurs
      FROM (SELECT c.relname::text AS objet, pg_get_viewdef(c.oid) AS def
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
            UNION ALL
            SELECT p.proname::text, p.prosrc
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public') d
     WHERE d.def ~ 'P_RetardBCJours|P_EncoursRetardInclus|P_HorizonProlonge|P_EcartCouvertureJours';
    IF v_lecteurs IS NOT NULL THEN
        RAISE EXCEPTION '2026-10-27j : un paramètre supprimé est encore lu par : %', v_lecteurs;
    END IF;
END $$;

COMMIT;
