-- =============================================================================
-- 2026-10-09w — Une reception cloturee ne se rouvre plus (audit v5, T9)
-- =============================================================================
-- La table des transitions admettait encore CLOTURE -> A_CONTROLER (ajoutee le
-- 19/09 pour « rouvrir une reception cloturee trop tot »). Depuis la regle 8 du
-- 08/10, une reception cloturee avec sa facture a sa valeur definitive au
-- CMUP : elle se corrige par un avoir ou un retour, jamais en la rouvrant. Le
-- service le refusait deja ; la base aussi, desormais. Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

DELETE FROM transition_statut
 WHERE entite = 'reception' AND statut_source = 'CLOTURE' AND statut_cible = 'A_CONTROLER';

COMMIT;
