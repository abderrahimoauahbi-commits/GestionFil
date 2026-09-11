-- =============================================================================
-- MIGRATION 2026-09-08 — LA FICHE DE CHARGE ET DE DECHARGE
-- -----------------------------------------------------------------------------
-- UN DOCUMENT, TROIS ETATS. Brouillon, valide, annule.
--
-- POURQUOI CE CYCLE PLUTOT QU'UNE SAISIE DIRECTE. Un magasinier devant sa
-- machine saisit six ou huit lignes, se trompe sur l'une, la reprend, en ajoute
-- une autre. Si chaque frappe touchait le stock, il faudrait annuler et
-- ressaisir pour une faute de doigt — et le grand livre porterait la trace de
-- chaque hesitation. Tant que la fiche est en BROUILLON, elle ne touche a rien :
-- on la corrige comme un papier. C'est la VALIDATION qui ecrit.
--
-- CE QUE LA VALIDATION ECRIT, EN UNE FOIS ET EN TOUT OU RIEN :
--
--   1. le MOUVEMENT — `CHARGE_MACHINE` a l'aller, `RETOUR_MACHINE` au retour.
--      Le magasin est debite ou credite ; le stock global ne bouge pas.
--   2. le CONSTAT — `machine_etat`, ecrase pour chaque reference et lot touche.
--   3. la CONSOMMATION — `machine_consommation`, le residu entre l'etat
--      d'avant, ce qui a ete charge, et l'etat constate.
--
-- L'ANNULATION defait les trois, sans rien effacer : le mouvement est
-- contre-passe, l'etat revient a ce que le journal de consommation avait
-- conserve, et une ligne d'annulation reste. On ne gomme pas une erreur, on
-- ecrit qu'elle a ete vue.
--
--     cd /tmp
--     cat /home/sysadmin/gestionfil/db/pg/migrations/2026-09-08_machine_fiche.sql |
--         sudo -u postgres psql -d gestionfil -v ON_ERROR_STOP=1
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS machine_fiche (
    id_fiche            text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    numero_fiche        text    NOT NULL UNIQUE,

    -- CHARGE ou DECHARGE. Meme entete, memes lignes, sens oppose : les separer
    -- en deux tables aurait duplique la moitie du module pour un seul champ.
    type_fiche          text    NOT NULL CHECK (type_fiche IN ('CHARGE','DECHARGE')),
    statut              text    NOT NULL DEFAULT 'BROUILLON'
                                CHECK (statut IN ('BROUILLON','VALIDE','ANNULE')),

    code_machine        text    NOT NULL REFERENCES machine(code_machine),
    -- LA ZONE EST OBLIGATOIRE, y compris a la decharge : on decharge un etage
    -- precis, pas une machine en general.
    code_emplacement    text    NOT NULL REFERENCES machine_emplacement(code_emplacement),

    date_fiche          text    NOT NULL,
    -- LA DATE DU CONSTAT PRECEDENT, figee a la creation. C'est elle qui donne
    -- son sens a l'ecart : 1 500 kg en un mois ne se lisent pas comme 1 500 kg
    -- en trois jours.
    date_constat_precedent text,

    -- Le magasin d'origine a la charge, de retour a la decharge.
    code_magasin        text    NOT NULL REFERENCES magasin(code_magasin),

    -- LE COMPTE DE L'ETAGE, CONFIRME PAR L'OPERATEUR. C'est une saisie, pas un
    -- calcul : s'il differe de la somme des lignes, l'ecran le dit plutot que
    -- de choisir tout seul lequel a raison.
    nb_bobines_etage    bigint  CHECK (nb_bobines_etage IS NULL OR nb_bobines_etage >= 0),
    nb_palettes         bigint  CHECK (nb_palettes IS NULL OR nb_palettes >= 0),

    numero_of           text,
    responsable         text    NOT NULL,
    observations        text,

    -- Qui a fait quoi, et quand.
    id_utilisateur      text    NOT NULL REFERENCES utilisateur(id_utilisateur),
    date_creation       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC',
                                                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_utilisateur_validation text REFERENCES utilisateur(id_utilisateur),
    date_validation     text,
    motif_annulation    text,
    date_annulation     text,

    -- UNE FICHE ANNULEE DOIT DIRE POURQUOI. Sans motif, l'annulation devient un
    -- moyen commode de faire disparaitre une erreur sans l'expliquer.
    CHECK (statut <> 'ANNULE' OR motif_annulation IS NOT NULL),
    CHECK (statut <> 'VALIDE' OR date_validation IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_fiche_machine
    ON machine_fiche(code_machine, date_fiche);
CREATE INDEX IF NOT EXISTS ix_fiche_statut
    ON machine_fiche(statut) WHERE statut = 'BROUILLON';


CREATE TABLE IF NOT EXISTS machine_fiche_ligne (
    id_ligne            text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    id_fiche            text    NOT NULL REFERENCES machine_fiche(id_fiche) ON DELETE CASCADE,
    ligne_numero        bigint  NOT NULL CHECK (ligne_numero > 0),

    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    lot_fournisseur     text    NOT NULL,

    nb_bobines          bigint  NOT NULL CHECK (nb_bobines > 0),
    nb_palettes         bigint  CHECK (nb_palettes IS NULL OR nb_palettes >= 0),
    poids_unitaire_kg   numeric(18,4) CHECK (poids_unitaire_kg IS NULL
                                          OR poids_unitaire_kg > 0),

    -- LE POURCENTAGE EST PAR REFERENCE, jamais par zone. Un etage qui porte
    -- deux articles porte deux taux differents : l'un vient d'etre charge a
    -- 100 %, l'autre tourne depuis trois semaines.
    pourcentage         numeric(6,2) CHECK (pourcentage IS NULL
                                         OR pourcentage BETWEEN 0 AND 100),

    -- LE POIDS CONSTATE. En estimation il se calcule, en pesee il commande.
    -- La contrainte du bas verifie l'arithmetique dans le premier cas : sans
    -- elle, un client pourrait annoncer un pourcentage et enregistrer autre
    -- chose, et la regle ne serait qu'une intention dans du code.
    total_kg            numeric(18,4) NOT NULL CHECK (total_kg >= 0),
    mode_constat        text    NOT NULL DEFAULT 'ESTIMATION'
                                CHECK (mode_constat IN ('ESTIMATION','PESEE')),

    notes               text,

    UNIQUE (id_fiche, ligne_numero),
    CHECK (mode_constat <> 'ESTIMATION'
        OR pourcentage IS NULL OR poids_unitaire_kg IS NULL
        OR abs(total_kg - nb_bobines * poids_unitaire_kg * pourcentage / 100.0) < 0.01)
);

CREATE INDEX IF NOT EXISTS ix_fiche_ligne_fiche ON machine_fiche_ligne(id_fiche);
CREATE INDEX IF NOT EXISTS ix_fiche_ligne_ref
    ON machine_fiche_ligne(code_reference, lot_fournisseur);

ALTER TABLE machine_fiche       OWNER TO gestionfil;
ALTER TABLE machine_fiche_ligne OWNER TO gestionfil;

-- La fiche qui a produit un constat : on doit pouvoir remonter de l'un a
-- l'autre, dans les deux sens.
ALTER TABLE machine_consommation
    ADD COLUMN IF NOT EXISTS id_fiche text REFERENCES machine_fiche(id_fiche);
ALTER TABLE machine_etat
    ADD COLUMN IF NOT EXISTS id_fiche text REFERENCES machine_fiche(id_fiche);

COMMIT;
