-- =============================================================================
-- MIGRATION 2026-09-08c — LE SENS DES DEUX TYPES MACHINE
-- -----------------------------------------------------------------------------
-- LE MOUVEMENT S'ECRIT DU COTE MAGASIN, ET DE CE COTE-LA SEULEMENT. La machine
-- n'est pas un magasin dans ce modele : son contenu est un cliche constate, pas
-- un solde de grand livre. Il n'y a donc aucune contre-ecriture a lui opposer.
--
-- Vus du magasin :
--   CHARGE_MACHINE  le fil PART      -> signe -1
--   RETOUR_MACHINE  le fil REVIENT   -> signe +1
--
-- Je les avais poses a l'envers, en raisonnant du point de vue de la machine.
-- Le stock global ne bouge pas pour autant : ce qui sort du magasin entre dans
-- le cliche de la machine, et le total se lit toujours magasins + machines.
--
-- `exige_prix` et `impacte_cmup` suivent le sens : une sortie n'a pas besoin de
-- prix, une entree si — sans quoi le fil qui redescend rentrerait au magasin
-- valorise a zero et ferait fondre le CMUP.
-- =============================================================================

BEGIN;

UPDATE type_mouvement
   SET signe = -1, exige_prix = 0, impacte_cmup = 0
 WHERE code_type_mvt = 'CHARGE_MACHINE';

UPDATE type_mouvement
   SET signe = 1, exige_prix = 1, impacte_cmup = 1
 WHERE code_type_mvt = 'RETOUR_MACHINE';

COMMIT;
