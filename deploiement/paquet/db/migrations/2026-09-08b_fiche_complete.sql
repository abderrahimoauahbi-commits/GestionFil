-- =============================================================================
-- MIGRATION 2026-09-08b — LA FICHE PORTE LES QUATRE TYPES ET LES DEUX COMPTES
-- -----------------------------------------------------------------------------
-- QUATRE FICHES, pas deux : charge, decharge, mise a jour, consommation. Les
-- deux dernieres ne touchent aucun magasin — elles ne font que constater — mais
-- elles prennent un cliche et produisent de la consommation comme les autres.
--
-- DEUX COMPTES PAR LIGNE, et c'est le point qui m'avait echappe :
--
--   `nb_bobines_mouvementees` — ce qui monte sur la machine ou en descend. Ce
--   nombre ne sert qu'a debiter ou crediter le magasin.
--
--   `nb_bobines_presentes`    — ce que la zone porte de cette reference APRES.
--   C'est lui qui fait l'etat, avec le pourcentage.
--
-- Les deux ne se reconcilient pas, et ne doivent pas : charger 200 bobines sur
-- un etage qui en porte 300 laisse 300 presentes — les neuves ont remplace des
-- vides. C'est la somme des PRESENTES qui ne peut pas depasser les emplacements
-- de la zone, jamais ce qu'on charge.
-- =============================================================================

BEGIN;

-- Les quatre types.
ALTER TABLE machine_fiche DROP CONSTRAINT IF EXISTS machine_fiche_type_fiche_check;
ALTER TABLE machine_fiche ADD CONSTRAINT ck_fiche_type
    CHECK (type_fiche IN ('CHARGE','DECHARGE','MAJ','CONSO'));

-- Une mise a jour et une consommation ne touchent aucun magasin : la colonne
-- devient facultative plutot que d'inventer un magasin fictif.
ALTER TABLE machine_fiche ALTER COLUMN code_magasin DROP NOT NULL;
ALTER TABLE machine_fiche ADD CONSTRAINT ck_fiche_magasin
    CHECK (type_fiche IN ('MAJ','CONSO') OR code_magasin IS NOT NULL);

-- Les deux comptes.
ALTER TABLE machine_fiche_ligne
    RENAME COLUMN nb_bobines TO nb_bobines_mouvementees;
ALTER TABLE machine_fiche_ligne
    ALTER COLUMN nb_bobines_mouvementees DROP NOT NULL;
ALTER TABLE machine_fiche_ligne DROP CONSTRAINT IF EXISTS machine_fiche_ligne_nb_bobines_check;
ALTER TABLE machine_fiche_ligne ADD CONSTRAINT ck_ligne_mouvementees
    CHECK (nb_bobines_mouvementees IS NULL OR nb_bobines_mouvementees >= 0);

ALTER TABLE machine_fiche_ligne
    ADD COLUMN IF NOT EXISTS nb_bobines_presentes bigint NOT NULL DEFAULT 0
    CHECK (nb_bobines_presentes >= 0);

-- Le poids de ce qui est mouvemente, distinct du poids de ce qui reste en
-- place : l'un debite le magasin, l'autre fait l'etat.
ALTER TABLE machine_fiche_ligne
    ADD COLUMN IF NOT EXISTS kg_mouvementes numeric(18,4)
    CHECK (kg_mouvementes IS NULL OR kg_mouvementes >= 0);

-- L'ancienne verification portait sur `nb_bobines` : elle doit suivre le
-- renommage et porter desormais sur les PRESENTES, qui font l'etat.
ALTER TABLE machine_fiche_ligne DROP CONSTRAINT IF EXISTS machine_fiche_ligne_check;
ALTER TABLE machine_fiche_ligne ADD CONSTRAINT ck_ligne_estimation CHECK (
    mode_constat <> 'ESTIMATION'
    OR pourcentage IS NULL OR poids_unitaire_kg IS NULL
    OR abs(total_kg - nb_bobines_presentes * poids_unitaire_kg * pourcentage / 100.0) < 0.01);

-- LE CLICHE COMPLET DE LA ZONE, pris a chaque validation.
--
-- Il porte TOUTES les references de la zone, y compris celles que la fiche n'a
-- pas touchees. Sans elles, l'etat d'une date passee serait incomplet : on
-- saurait ce qui a bouge ce jour-la, pas ce qui etait a cote. C'est ce cliche
-- qui rend la consommation calculable exactement entre deux dates.
CREATE TABLE IF NOT EXISTS machine_cliche (
    id_cliche           text    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    id_fiche            text    NOT NULL REFERENCES machine_fiche(id_fiche) ON DELETE CASCADE,
    code_emplacement    text    NOT NULL REFERENCES machine_emplacement(code_emplacement),
    date_cliche         text    NOT NULL,
    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    lot_fournisseur     text    NOT NULL,
    nb_bobines          bigint  NOT NULL DEFAULT 0 CHECK (nb_bobines >= 0),
    poids_unitaire_kg   numeric(18,4),
    pourcentage         numeric(6,2),
    kg                  numeric(18,4) NOT NULL DEFAULT 0,
    UNIQUE (id_fiche, code_reference, lot_fournisseur)
);

CREATE INDEX IF NOT EXISTS ix_cliche_zone
    ON machine_cliche(code_emplacement, date_cliche);

ALTER TABLE machine_cliche OWNER TO gestionfil;

COMMIT;
