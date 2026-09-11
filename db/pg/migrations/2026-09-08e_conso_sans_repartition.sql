-- =============================================================================
-- MIGRATION 2026-09-08e — LA REPARTITION PAR FICHE DISPARAIT
-- -----------------------------------------------------------------------------
-- `machine_consommation.consommation_kg` pretendait dire combien chaque fiche
-- avait revele de fil tisse. C'etait une invention : personne ne sait quel
-- chargement a ete tisse quand, et vouloir le decider a produit une cascade de
-- cas particuliers qui n'existent pas dans l'atelier.
--
-- La table reste, mais pour ce qu'elle est vraiment : LA TRACE DE L'ETAT AVANT
-- ET APRES CHAQUE FICHE. C'est elle qui permet d'annuler une fiche validee en
-- restaurant l'etat precedent. La consommation, elle, se lit dans
-- `v_machine_consommation` — en cumul, comme il se doit.
-- =============================================================================

BEGIN;

ALTER TABLE machine_consommation DROP COLUMN IF EXISTS consommation_kg;

COMMENT ON TABLE machine_consommation IS
    'Trace de l''etat avant et apres chaque fiche, pour l''annulation et l''audit. '
    'La consommation se lit dans v_machine_consommation, en cumul.';

COMMIT;
