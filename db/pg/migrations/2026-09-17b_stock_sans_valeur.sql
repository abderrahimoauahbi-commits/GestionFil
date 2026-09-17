-- =============================================================================
-- MIGRATION 2026-09-17b — LE STOCK PEUT ENTRER SANS VALEUR
-- -----------------------------------------------------------------------------
-- DECISION DU 17 SEPTEMBRE 2026. Le stock de depart n'a connu ni entree ni
-- sortie dans l'ERP : on ne lui invente pas de cout. Il entrait jusqu'ici au
-- prix catalogue converti a un taux de cahier des charges (9,50) — une valeur
-- qui, moyennee avec les vrais achats, aurait fausse le CMUP pendant des mois.
--
-- CE QUI CHANGE :
--   * STOCK_INIT      prix facultatif. Sans prix : les kilos entrent, le CMUP
--                     reste vide.
--   * TRANSFERT_ENTREE prix facultatif. Un stock sans CMUP doit pouvoir passer
--                     de Morocco a l'usine ; sinon il ne bougerait jamais.
--   * RETOUR_MACHINE  prix facultatif. Le fil charge sans valeur doit pouvoir
--                     redescendre.
--
-- CE QUI NE CHANGE PAS :
--   * ENTREE_REC exige toujours un prix : une reception a une facture.
--   * Une entree AVEC prix recalcule le CMUP comme avant.
--
-- POURQUOI VIDE ET PAS ZERO. `fn_trg_lmvt_appliquer` fait
-- COALESCE(cmup_mad, prix_entree) : un CMUP vide prend le prix de la premiere
-- entree valorisee, pour tout le stock du magasin. Un CMUP a 0 entrerait dans
-- la moyenne : 26 346,6 kg a 0 + 10 000 kg a 29,14 donneraient 8,02 MAD/kg.
--
-- Rejouable : la contrainte est retiree sous ses deux noms avant d'etre posee.
-- =============================================================================

BEGIN;

ALTER TABLE type_mouvement DROP CONSTRAINT IF EXISTS type_mouvement_check;
ALTER TABLE type_mouvement DROP CONSTRAINT IF EXISTS type_mouvement_cmup_entree;
ALTER TABLE type_mouvement
  ADD CONSTRAINT type_mouvement_cmup_entree CHECK (impacte_cmup = 0 OR signe = 1);

UPDATE type_mouvement
   SET exige_prix = 0
 WHERE code_type_mvt IN ('STOCK_INIT', 'TRANSFERT_ENTREE', 'RETOUR_MACHINE');

COMMIT;
