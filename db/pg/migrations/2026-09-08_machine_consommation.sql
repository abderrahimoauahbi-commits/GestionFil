-- =============================================================================
-- MIGRATION 2026-09-08 — LE STOCK MACHINE SE COMPTE, LA CONSOMMATION SE JOURNALISE
-- -----------------------------------------------------------------------------
-- CE QUI ETAIT FAUX. Le module ecrivait la consommation d'une machine dans
-- `mouvement`, sous le type SORTIE_PROD. C'est interdit : le journal des
-- mouvements porte les DEPLACEMENTS de matiere, pas ce qu'un metier a tisse.
-- Les deux se lisent differemment et se corrigent differemment ; les melanger
-- rend l'un et l'autre illisibles.
--
-- LE MODELE JUSTE, EN TROIS PHRASES.
--
--   1. Le stock d'une machine SE COMPTE. Il ne se deduit pas d'un grand livre :
--      l'operateur constate, par reference et par lot, un nombre de bobines et
--      un pourcentage de fil restant. Le poids en decoule.
--
--   2. Le journal des mouvements ne porte que les DEPLACEMENTS entre le magasin
--      et la machine : `CHARGE_MACHINE` a l'aller, `RETOUR_MACHINE` au retour.
--      Ni l'un ni l'autre ne change le stock global — la matiere change
--      d'endroit, pas de proprietaire.
--
--   3. LA CONSOMMATION EST LE RESIDU, et elle a son propre journal :
--
--          consommation = etat precedent + charge - retourne - etat constate
--
--      Personne ne la saisit. Elle apparait quand l'operateur declare ou en est
--      sa zone — et c'est pour cela qu'un chargement REVELE une consommation
--      sans la causer : faute de compteur au metier, le constat est la seule
--      mesure dont on dispose.
--
-- STOCK GLOBAL = soldes magasins + stock machines. Une palette envoyee sort du
-- magasin et entre dans le compte de la machine ; le total ne bouge pas. Seul
-- le fil tisse le fait baisser.
--
--     cd /tmp
--     cat /home/sysadmin/gestionfil/db/pg/migrations/2026-09-08_machine_consommation.sql |
--         sudo -u postgres psql -d gestionfil -v ON_ERROR_STOP=1
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. LES DEUX TYPES DE MOUVEMENT QUI TOUCHENT UNE MACHINE
-- -----------------------------------------------------------------------------
-- Ils portent leur propre nom A DESSEIN. Reutiliser TRANSFERT_ENTREE et
-- TRANSFERT_SORTIE marchait, mais rendait un chargement de metier
-- indiscernable d'un transfert entre deux magasins dans tous les etats — et
-- c'est precisement ce qu'on veut pouvoir distinguer.
--
-- `impacte_cmup = 1` a l'entree, comme pour un transfert : la valeur suit la
-- marchandise, sans quoi le fil pose sur un metier disparaitrait des etats de
-- valorisation.
INSERT INTO type_mouvement
    (code_type_mvt, libelle, signe, exige_prix, impacte_cmup, exige_of,
     exige_motif_ligne, couleur) VALUES
 ('CHARGE_MACHINE',  'Charge machine',  1, 1, 1, 0, 0, '#7c3aed'),
 ('RETOUR_MACHINE',  'Retour machine', -1, 0, 0, 0, 0, '#7c3aed')
ON CONFLICT (code_type_mvt) DO UPDATE SET
    libelle = excluded.libelle, couleur = excluded.couleur;

-- Le motif qui va avec : un chargement de metier n'est pas un transfert
-- logistique, et le lire comme tel fausserait toutes les analyses par motif.
INSERT INTO motif_mouvement (code_motif, libelle, categorie, signe_default) VALUES
 ('MACHINE', 'Chargement / retour machine', 'PRODUCTION', 1)
ON CONFLICT (code_motif) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 2. LE JOURNAL DE CONSOMMATION
-- -----------------------------------------------------------------------------
-- SEPARE DU GRAND LIVRE, et c'est tout l'objet de cette migration.
--
-- Une ligne par constat, par reference et par lot. On y garde l'etat d'AVANT
-- autant que celui d'APRES : sans le point de depart, la consommation n'est
-- qu'un nombre que personne ne peut verifier trois mois plus tard. La date du
-- constat precedent y figure aussi — un ecart de 1 500 kg en un mois ne se lit
-- pas comme le meme ecart en trois jours.
CREATE TABLE IF NOT EXISTS machine_consommation (
    id_consommation     text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    code_machine        text    NOT NULL REFERENCES machine(code_machine),
    code_emplacement    text    NOT NULL REFERENCES machine_emplacement(code_emplacement),
    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    lot_fournisseur     text    NOT NULL,

    -- QUAND, et depuis quand.
    date_constat        text    NOT NULL,
    date_constat_precedent text,

    -- L'ETAT D'AVANT, tel qu'il avait ete constate.
    bobines_avant       bigint  NOT NULL DEFAULT 0 CHECK (bobines_avant >= 0),
    pourcentage_avant   numeric(6,2) CHECK (pourcentage_avant IS NULL
                                         OR pourcentage_avant BETWEEN 0 AND 100),
    kg_avant            numeric(18,4) NOT NULL DEFAULT 0 CHECK (kg_avant >= 0),

    -- CE QUI A BOUGE ENTRE LES DEUX CONSTATS.
    kg_charge           numeric(18,4) NOT NULL DEFAULT 0 CHECK (kg_charge >= 0),
    kg_retourne         numeric(18,4) NOT NULL DEFAULT 0 CHECK (kg_retourne >= 0),

    -- L'ETAT CONSTATE MAINTENANT.
    bobines_apres       bigint  NOT NULL DEFAULT 0 CHECK (bobines_apres >= 0),
    pourcentage_apres   numeric(6,2) CHECK (pourcentage_apres IS NULL
                                         OR pourcentage_apres BETWEEN 0 AND 100),
    poids_unitaire_kg   numeric(18,4) CHECK (poids_unitaire_kg IS NULL
                                          OR poids_unitaire_kg > 0),
    kg_apres            numeric(18,4) NOT NULL DEFAULT 0 CHECK (kg_apres >= 0),

    -- LE RESIDU. Colonne GENEREE : elle ne peut pas mentir, et une reprise de
    -- donnees ne peut pas la poser de travers.
    --
    -- Elle peut etre NEGATIVE : cela signifie qu'on a constate plus de matiere
    -- qu'il ne devrait y en avoir. Ce n'est pas une consommation negative,
    -- c'est un chargement qui n'a pas ete declare — et le controle le releve
    -- plutot que de le maquiller en zero.
    consommation_kg     numeric(18,4) GENERATED ALWAYS AS
                            (kg_avant + kg_charge - kg_retourne - kg_apres) STORED,

    -- A QUI L'IMPUTER, et qui l'a constate.
    numero_of           text,
    responsable         text    NOT NULL,
    id_utilisateur      text    NOT NULL REFERENCES utilisateur(id_utilisateur),

    -- LE MODE DU CONSTAT : au pourcentage, ou a la bascule. Distinguer six mois
    -- plus tard un chiffre pese d'un chiffre juge a l'oeil est exactement la
    -- question que pose un ecart.
    mode_constat        text    NOT NULL DEFAULT 'ESTIMATION'
                                CHECK (mode_constat IN ('ESTIMATION','PESEE')),

    -- La marque du geste : elle relie ce constat aux mouvements de charge ou de
    -- retour ecrits au meme moment.
    marque_geste        text,
    notes               text,
    date_creation       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC',
                                                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE INDEX IF NOT EXISTS ix_conso_machine
    ON machine_consommation(code_machine, date_constat);
CREATE INDEX IF NOT EXISTS ix_conso_reference
    ON machine_consommation(code_reference, lot_fournisseur);
CREATE INDEX IF NOT EXISTS ix_conso_of
    ON machine_consommation(numero_of) WHERE numero_of IS NOT NULL;

ALTER TABLE machine_consommation OWNER TO gestionfil;


-- -----------------------------------------------------------------------------
-- 3. LE CONSTAT COURANT — le stock machine, compte et non deduit
-- -----------------------------------------------------------------------------
-- UNE LIGNE PAR (machine, zone, reference, lot), ECRASEE A CHAQUE CONSTAT.
--
-- C'est un inventaire permanent, pas un solde de grand livre. Le poids est une
-- colonne generee : bobines x poids unitaire x pourcentage. Il ne peut donc pas
-- diverger de ce que l'operateur a declare, et personne ne peut l'ajuster a la
-- main sans changer l'une des trois valeurs qui le composent.
CREATE TABLE IF NOT EXISTS machine_etat (
    code_emplacement    text    NOT NULL REFERENCES machine_emplacement(code_emplacement),
    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    lot_fournisseur     text    NOT NULL,

    nb_bobines          bigint  NOT NULL DEFAULT 0 CHECK (nb_bobines >= 0),
    nb_palettes         bigint  CHECK (nb_palettes IS NULL OR nb_palettes >= 0),
    poids_unitaire_kg   numeric(18,4) CHECK (poids_unitaire_kg IS NULL
                                          OR poids_unitaire_kg > 0),
    pourcentage         numeric(6,2) NOT NULL DEFAULT 100
                                CHECK (pourcentage BETWEEN 0 AND 100),

    -- LE POIDS NE SE SAISIT PAS, IL SE CALCULE — sauf en pesee directe, ou
    -- c'est lui qui commande et ou le pourcentage s'en deduit a l'inverse.
    -- Une seule verite par ligne, jamais deux.
    kg                  numeric(18,4) GENERATED ALWAYS AS
                            (ROUND(nb_bobines * COALESCE(poids_unitaire_kg, 0)
                                   * pourcentage / 100.0, 4)) STORED,

    mode_constat        text    NOT NULL DEFAULT 'ESTIMATION'
                                CHECK (mode_constat IN ('ESTIMATION','PESEE')),
    date_constat        text    NOT NULL,
    responsable         text,
    id_utilisateur      text    REFERENCES utilisateur(id_utilisateur),
    date_maj            text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC',
                                                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),

    PRIMARY KEY (code_emplacement, code_reference, lot_fournisseur)
);

CREATE INDEX IF NOT EXISTS ix_etat_reference
    ON machine_etat(code_reference, lot_fournisseur);

ALTER TABLE machine_etat OWNER TO gestionfil;

COMMIT;
