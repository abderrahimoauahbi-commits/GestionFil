-- =============================================================================
-- Une machine peut n'avoir aucun etage — 9 septembre 2026
-- -----------------------------------------------------------------------------
-- L'ATELIER PORTE UN METIER QUI NE FILE QUE CHAINE ET TRAME. Pas de creel a
-- etages, donc pas d'etage du tout. La contrainte `nb_etages > 0` datait d'une
-- epoque ou l'on supposait que toute machine en avait ; elle rendait cette
-- machine-la indeclarable.
--
-- Zero etage reste une machine valide tant qu'elle porte AU MOINS UNE ZONE :
-- c'est le code qui l'exige a la creation, pas la base, parce que la regle
-- porte sur l'ensemble machine + emplacements et qu'aucune contrainte de table
-- ne sait l'exprimer.
-- =============================================================================

BEGIN;

ALTER TABLE machine DROP CONSTRAINT machine_nb_etages_check;
ALTER TABLE machine ADD CONSTRAINT machine_nb_etages_check CHECK (nb_etages >= 0);

-- La capacite, elle, reste strictement positive : une machine qui ne porte
-- aucune bobine n'est pas une machine, c'est une ligne dans un tableau.
-- (machine_capacite_bobines_check, inchangee.)

COMMIT;
