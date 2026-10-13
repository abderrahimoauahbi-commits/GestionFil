-- =============================================================================
-- MIGRATION 2026-09-04 — MACHINES, EMPLACEMENTS ET POIDS REEL
-- -----------------------------------------------------------------------------
-- CE QUI CHANGE ET POURQUOI.
--
-- Jusqu'ici le stock ne pouvait porter qu'un poids THEORIQUE : une contrainte
-- de `ligne_mouvement` imposait `quantite_kg = quantite_saisie x facteur`, ce
-- qui interdisait litteralement d'enregistrer « 200 bobines qui pesent 528 kg »
-- quand le catalogue en annonce 540. Les ecarts de stock naissaient la, et
-- l'inventaire les decouvrait trois mois plus tard sans pouvoir les expliquer.
--
-- Cette migration installe trois choses :
--
--   1. LA MACHINE COMME EMPLACEMENT DE STOCK. Chaque etage, plus la chaine et
--      la trame, possede sa ligne dans `magasin`. Le fil pose sur un metier vit
--      donc dans `stock_magasin` et `stock_lot` comme tout autre stock : meme
--      grand livre, meme CMUP, meme interdiction de negatif (R02), meme
--      inventaire, meme audit. AUCUN nouveau type de mouvement n'est cree — un
--      chargement est un transfert, une consommation un SORTIE_PROD.
--
--   2. LE POIDS REEL. `quantite_kg` porte desormais ce qui a ete constate, et
--      `mode_pesee` dit COMMENT : bascule ou estimation. Une contrainte refait
--      le calcul de l'operateur et refuse la ligne qui ne correspond pas au
--      mode annonce — la regle d'or tient quel que soit l'appelant, pas
--      seulement quand le client applicatif veut bien la respecter.
--
--   3. LE COMPTE DE BOBINES comme etat de stock, sans quoi verifier la capacite
--      d'un etage imposerait de relire tout l'historique a chaque saisie.
--
-- LE GRAND LIVRE RESTE IMMUABLE (R03) : rien ici ne touche aux declencheurs qui
-- interdisent UPDATE et DELETE sur `mouvement` et `ligne_mouvement`.
--
-- Application, sur le serveur — le compte `postgres` ne lit pas /home/sysadmin,
-- d'ou le passage par l'entree standard plutot que `psql -f` :
--
--     cd /tmp
--     cat /home/sysadmin/gestionfil/db/pg/migrations/2026-09-04_machines.sql |
--         sudo -u postgres psql -d gestionfil -v ON_ERROR_STOP=1
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. LES TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS machine (
    code_machine        text    NOT NULL PRIMARY KEY,
    nom                 text    NOT NULL,
    -- Capacite physique TOTALE : etages, chaine et trame confondus. Elle n'est
    -- PAS la somme des capacites d'emplacement — on repartit 600 bobines comme
    -- on veut sur quatre etages de 200 places. Les deux plafonds s'appliquent.
    capacite_bobines    bigint  NOT NULL CHECK (capacite_bobines > 0),
    -- Compte les ETAGES SEULEMENT : la chaine et la trame sont des emplacements
    -- de la machine, pas des etages.
    nb_etages           bigint  NOT NULL CHECK (nb_etages > 0),
    code_atelier        text    REFERENCES magasin(code_magasin),
    notes               text,
    actif               bigint  NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
);

CREATE TABLE IF NOT EXISTS machine_emplacement (
    code_emplacement    text    NOT NULL PRIMARY KEY,
    code_machine        text    NOT NULL REFERENCES machine(code_machine),
    role                text    NOT NULL CHECK (role IN ('ETAGE','CHAINE','TRAME')),
    numero_etage        bigint  NOT NULL CHECK (numero_etage >= 0),
    capacite_bobines    bigint  NOT NULL CHECK (capacite_bobines > 0),
    libelle             text    GENERATED ALWAYS AS (
                            CASE role
                                WHEN 'ETAGE'  THEN 'Etage ' || CAST(numero_etage AS text)
                                WHEN 'CHAINE' THEN 'Chaine'
                                WHEN 'TRAME'  THEN 'Trame'
                            END) STORED,
    -- L'EMPLACEMENT EST UN MAGASIN. Tout le stock de la machine passe par la.
    code_magasin        text    NOT NULL UNIQUE REFERENCES magasin(code_magasin),
    actif               bigint  NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
    CHECK (role =  'ETAGE' OR numero_etage = 0),
    CHECK (role <> 'ETAGE' OR numero_etage > 0),
    UNIQUE (code_machine, role, numero_etage)
);

CREATE INDEX IF NOT EXISTS ix_empl_machine ON machine_emplacement(code_machine);

-- Une seule chaine et une seule trame par machine.
CREATE UNIQUE INDEX IF NOT EXISTS ux_empl_role_unique
    ON machine_emplacement(code_machine, role)
    WHERE role IN ('CHAINE','TRAME');

-- LE PROPRIETAIRE. Une table creee par `postgres` reste a `postgres`, et le
-- compte applicatif se voit refuser l'ecriture avec un « droit refuse » que
-- rien n'explique cote metier. La lecon a deja ete payee sur `telechargement`.
ALTER TABLE machine             OWNER TO gestionfil;
ALTER TABLE machine_emplacement OWNER TO gestionfil;


-- =============================================================================
-- 2. LE POIDS REEL SUR LA LIGNE DE MOUVEMENT
-- =============================================================================

ALTER TABLE ligne_mouvement
  ADD COLUMN IF NOT EXISTS mode_pesee text
      CHECK (mode_pesee IS NULL OR mode_pesee IN ('PESEE','ESTIMATION','THEORIQUE')),
  -- Le poids catalogue FIGE au moment du geste : le catalogue evoluera, l'ecart
  -- constate ce jour-la doit rester lisible dans dix ans.
  ADD COLUMN IF NOT EXISTS poids_unitaire_theorique_kg numeric(18,4)
      CHECK (poids_unitaire_theorique_kg IS NULL OR poids_unitaire_theorique_kg > 0),
  -- MODE A : ce que la bascule affiche. MODE B : le pourcentage estime.
  ADD COLUMN IF NOT EXISTS poids_total_pese_kg numeric(18,4)
      CHECK (poids_total_pese_kg IS NULL OR poids_total_pese_kg >= 0),
  ADD COLUMN IF NOT EXISTS pourcentage_restant numeric(6,2)
      CHECK (pourcentage_restant IS NULL OR pourcentage_restant BETWEEN 0 AND 100);

-- Les deux colonnes derivees. Separees des precedentes : une colonne generee ne
-- peut pas se calculer sur une colonne ajoutee dans le meme ALTER.
ALTER TABLE ligne_mouvement
  ADD COLUMN IF NOT EXISTS poids_reel_moyen_bobine_kg numeric(18,4)
      GENERATED ALWAYS AS (
          CASE WHEN nb_bobines > 0 THEN quantite_kg / nb_bobines END) STORED;

ALTER TABLE ligne_mouvement
  ADD COLUMN IF NOT EXISTS ecart_theorique_pct numeric(9,4)
      GENERATED ALWAYS AS (
          CASE WHEN nb_bobines > 0 AND poids_unitaire_theorique_kg > 0
               THEN (quantite_kg - nb_bobines * poids_unitaire_theorique_kg)
                    / (nb_bobines * poids_unitaire_theorique_kg) * 100.0 END) STORED;

-- LA CONTRAINTE QUI INTERDISAIT LE POIDS REEL.
--
-- Elle a ete creee sans nom : PostgreSQL l'a donc appelee `ligne_mouvement_check`
-- ou une variante numerotee, et le nom n'est pas garanti d'une base a l'autre.
-- On la retrouve par sa DEFINITION, ce qui est exact et ne depend d'aucune
-- convention de nommage.
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'ligne_mouvement'::regclass
           AND contype = 'c'
           AND conname <> 'ck_lmvt_conversion'
           AND pg_get_constraintdef(oid) LIKE '%quantite_saisie%facteur_conversion%'
    LOOP
        EXECUTE format('ALTER TABLE ligne_mouvement DROP CONSTRAINT %I', r.conname);
        RAISE NOTICE 'Contrainte de conversion theorique retiree : %', r.conname;
    END LOOP;
END $$;

ALTER TABLE ligne_mouvement DROP CONSTRAINT IF EXISTS ck_lmvt_conversion;
ALTER TABLE ligne_mouvement ADD CONSTRAINT ck_lmvt_conversion CHECK (
    -- COALESCE et non `mode_pesee IN (...)` : avec un mode nul, `IN` vaut NULL,
    -- un CHECK ne refuse que ce qui est FAUX, et la verification cesserait
    -- silencieusement de s'appliquer a tous les mouvements ordinaires.
    COALESCE(mode_pesee,'') IN ('PESEE','ESTIMATION')
    OR quantite_saisie IS NULL OR facteur_conversion IS NULL
    OR abs(quantite_kg - quantite_saisie * facteur_conversion) < 0.001);

-- LA BASE REFAIT LE CALCUL DE L'OPERATEUR.
--
-- Sans elle, un client mal ecrit — ou une application mobile pressee — pourrait
-- annoncer 'PESEE' et enregistrer le poids theorique. La regle d'or ne serait
-- qu'une intention dans du code ; ici elle tient quel que soit l'appelant.
ALTER TABLE ligne_mouvement DROP CONSTRAINT IF EXISTS ck_lmvt_mode_pesee;
ALTER TABLE ligne_mouvement ADD CONSTRAINT ck_lmvt_mode_pesee CHECK (
    mode_pesee IS NULL
    OR mode_pesee = 'THEORIQUE'
    OR (mode_pesee = 'PESEE'
        AND poids_total_pese_kg IS NOT NULL
        AND pourcentage_restant IS NULL
        AND abs(quantite_kg - poids_total_pese_kg) < 0.001)
    OR (mode_pesee = 'ESTIMATION'
        AND pourcentage_restant IS NOT NULL
        AND poids_total_pese_kg IS NULL
        AND nb_bobines IS NOT NULL AND nb_bobines > 0
        AND poids_unitaire_theorique_kg IS NOT NULL
        AND abs(quantite_kg - nb_bobines * poids_unitaire_theorique_kg
                              * pourcentage_restant / 100.0) < 0.01));


-- =============================================================================
-- 3. LE COMPTE DE BOBINES DANS LES DEUX CACHES DE STOCK
-- =============================================================================
-- COMPTEUR SECONDAIRE : il ne doit JAMAIS empecher un mouvement de kilos
-- legitime. Les mouvements anterieurs a ce module ne portent aucun nombre de
-- bobines, donc les magasins ordinaires demarrent a zero et resteront en retard
-- sur la realite ; le declencheur borne a zero et C37 signale les incoherences,
-- mais seulement sur les emplacements de machine, ou le compte est exact.

ALTER TABLE stock_lot     ADD COLUMN IF NOT EXISTS nb_bobines bigint
                          NOT NULL DEFAULT 0 CHECK (nb_bobines >= 0);
ALTER TABLE stock_magasin ADD COLUMN IF NOT EXISTS nb_bobines bigint
                          NOT NULL DEFAULT 0 CHECK (nb_bobines >= 0);


-- =============================================================================
-- 4. LES DECLENCHEURS
-- =============================================================================
-- fn_trg_lmvt_appliquer est reecrite EN ENTIER : elle gagne l'entretien du
-- compte de bobines. Le texte est identique a celui de
-- db/pg/010b_declencheurs_logique.sql, qui reste la source pour une base neuve.

CREATE OR REPLACE FUNCTION fn_trg_lmvt_appliquer() RETURNS trigger AS $$
DECLARE
    v_magasin       text;
    v_date          text;
    v_signe         integer;
    v_impacte_cmup  smallint;
    v_maintenant    text := to_char((now() AT TIME ZONE 'UTC'),
                                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
    SELECT m.code_magasin, m.date_mouvement, tm.signe, tm.impacte_cmup
      INTO v_magasin, v_date, v_signe, v_impacte_cmup
      FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     WHERE m.id_mouvement = NEW.id_mouvement;

    -- (a1) garantir l'existence de la ligne de solde, a zero
    INSERT INTO stock_magasin (code_reference, code_magasin, quantite_kg, cmup_mad)
    VALUES (NEW.code_reference, v_magasin, 0, NULL)
    ON CONFLICT (code_reference, code_magasin) DO NOTHING;

    -- (a2) appliquer le delta signe, puis le CMUP si entree valorisee (R04)
    UPDATE stock_magasin
       SET cmup_mad = CASE
               WHEN v_impacte_cmup = 1
                AND NEW.prix_kg_mad IS NOT NULL
                AND quantite_kg + NEW.quantite_kg > 0
               THEN round(( quantite_kg * COALESCE(cmup_mad, NEW.prix_kg_mad)
                          + NEW.quantite_kg * NEW.prix_kg_mad )
                          / (quantite_kg + NEW.quantite_kg), 4)
               ELSE cmup_mad
           END,
           quantite_kg = round(quantite_kg + v_signe * NEW.quantite_kg, 4),
           -- LE COMPTE DE BOBINES SUIT LES KILOS, avec le meme signe. GREATEST
           -- borne a zero : un magasin peut contenir 400 kg pour un compte de 0,
           -- et sans la borne la premiere sortie chiffree bloquerait un
           -- mouvement parfaitement legitime.
           nb_bobines = GREATEST(0, nb_bobines + v_signe * COALESCE(NEW.nb_bobines, 0)),
           date_derniere_entree = CASE WHEN v_signe =  1 THEN v_date
                                       ELSE date_derniere_entree END,
           date_derniere_sortie = CASE WHEN v_signe = -1 THEN v_date
                                       ELSE date_derniere_sortie END,
           date_maj = v_maintenant
     WHERE code_reference = NEW.code_reference
       AND code_magasin   = v_magasin;

    -- (b) solde par lot, seulement si la ligne porte un lot
    IF NEW.lot_fournisseur IS NOT NULL THEN
        INSERT INTO stock_lot (code_reference, code_magasin, lot_fournisseur, quantite_kg,
                               prix_entree_mad, date_fabrication, date_peremption)
        VALUES (NEW.code_reference, v_magasin, NEW.lot_fournisseur, 0,
                NEW.prix_kg_mad, NEW.date_fabrication, NEW.date_peremption)
        ON CONFLICT (code_reference, code_magasin, lot_fournisseur) DO NOTHING;

        UPDATE stock_lot
           SET quantite_kg      = round(quantite_kg + v_signe * NEW.quantite_kg, 4),
               -- C'est CE compte-ci que lit le declencheur de capacite : sur un
               -- emplacement de machine, ou la saisie impose toujours le nombre
               -- de bobines, il est exact des la premiere ecriture.
               nb_bobines       = GREATEST(0, nb_bobines + v_signe * COALESCE(NEW.nb_bobines, 0)),
               prix_entree_mad  = COALESCE(prix_entree_mad, NEW.prix_kg_mad),
               date_fabrication = COALESCE(date_fabrication, NEW.date_fabrication),
               date_peremption  = COALESCE(date_peremption, NEW.date_peremption),
               date_maj         = v_maintenant
         WHERE code_reference  = NEW.code_reference
           AND lot_fournisseur = NEW.lot_fournisseur
           AND code_magasin    = v_magasin;
    END IF;

    -- (c) CMUP consolide tous magasins sur la fiche reference (RG-08)
    IF v_impacte_cmup = 1 THEN
        UPDATE reference
           SET cmup_mad = (
                   SELECT round(SUM(sm.quantite_kg * sm.cmup_mad) / SUM(sm.quantite_kg), 4)
                     FROM stock_magasin sm
                    WHERE sm.code_reference = NEW.code_reference
                      AND sm.quantite_kg > 0
                      AND sm.cmup_mad IS NOT NULL),
               date_dernier_cmup = v_maintenant
         WHERE code_reference = NEW.code_reference;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;


-- LA CAPACITE, VERIFIEE AVANT L'ECRITURE.
--
-- Le backend calcule deja la place restante pour pouvoir refuser avec une
-- phrase que le magasinier comprend. C'est le bon message, mais ce n'est pas
-- une garantie : il ne vaut que pour l'appelant qui prend la peine de le
-- demander. Ici la regle tient pour tout le monde, import compris.
--
-- BEFORE INSERT, donc avant fn_trg_lmvt_appliquer qui est AFTER : la place est
-- lue sur l'etat courant du cache, et les lignes d'un meme document s'empilent
-- correctement puisque chaque ligne voit l'effet de la precedente.
CREATE OR REPLACE FUNCTION fn_trg_lmvt_capacite() RETURNS trigger AS $$
DECLARE
    v_empl  machine_emplacement%ROWTYPE;
    v_signe integer;
    v_apres bigint;
    v_max   bigint;
BEGIN
    IF COALESCE(NEW.nb_bobines, 0) = 0 THEN
        RETURN NEW;
    END IF;

    SELECT e.* INTO v_empl
      FROM machine_emplacement e
      JOIN mouvement m ON m.code_magasin = e.code_magasin
     WHERE m.id_mouvement = NEW.id_mouvement;

    IF NOT FOUND THEN
        RETURN NEW;                    -- magasin ordinaire : aucun plafond
    END IF;

    SELECT tm.signe INTO v_signe
      FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     WHERE m.id_mouvement = NEW.id_mouvement;

    IF v_signe < 0 THEN
        RETURN NEW;                    -- on ne deborde pas en retirant
    END IF;

    SELECT COALESCE(SUM(nb_bobines), 0) INTO v_apres
      FROM stock_lot WHERE code_magasin = v_empl.code_magasin;

    IF v_apres + NEW.nb_bobines > v_empl.capacite_bobines THEN
        RAISE EXCEPTION 'C33 : % plein. Capacite % bobines, il y en aurait %.',
            v_empl.libelle, v_empl.capacite_bobines, v_apres + NEW.nb_bobines;
    END IF;

    SELECT COALESCE(SUM(sl.nb_bobines), 0) INTO v_apres
      FROM stock_lot sl
      JOIN machine_emplacement e ON e.code_magasin = sl.code_magasin
     WHERE e.code_machine = v_empl.code_machine;

    SELECT capacite_bobines INTO v_max
      FROM machine WHERE code_machine = v_empl.code_machine;

    IF v_apres + NEW.nb_bobines > v_max THEN
        RAISE EXCEPTION 'C34 : machine % pleine. Capacite % bobines, il y en aurait %.',
            v_empl.code_machine, v_max, v_apres + NEW.nb_bobines;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lmvt_capacite ON ligne_mouvement;
CREATE TRIGGER trg_lmvt_capacite
BEFORE INSERT ON ligne_mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_lmvt_capacite();


-- COHERENCE ENTRE UN ETAGE ET LE NOMBRE D'ETAGES DE SA MACHINE.
-- `numero_etage <= machine.nb_etages` porte sur deux tables : un CHECK ne sait
-- pas l'exprimer. Les deux sens sont gardes — on ne cree pas un etage au-dela
-- du compte declare, et on ne reduit pas le compte sous un etage existant.
CREATE OR REPLACE FUNCTION fn_trg_empl_numero() RETURNS trigger AS $$
DECLARE v_nb bigint;
BEGIN
    IF NEW.role <> 'ETAGE' THEN
        RETURN NEW;                    -- la chaine et la trame ne sont pas des etages
    END IF;

    SELECT nb_etages INTO v_nb FROM machine WHERE code_machine = NEW.code_machine;

    IF NEW.numero_etage > v_nb THEN
        RAISE EXCEPTION 'La machine % declare % etages : l''etage % ne peut pas exister.',
            NEW.code_machine, v_nb, NEW.numero_etage;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_empl_numero ON machine_emplacement;
CREATE TRIGGER trg_empl_numero
BEFORE INSERT OR UPDATE ON machine_emplacement FOR EACH ROW
EXECUTE FUNCTION fn_trg_empl_numero();


CREATE OR REPLACE FUNCTION fn_trg_machine_nb_etages() RETURNS trigger AS $$
DECLARE v_haut bigint;
BEGIN
    SELECT COALESCE(MAX(numero_etage), 0) INTO v_haut
      FROM machine_emplacement
     WHERE code_machine = NEW.code_machine AND role = 'ETAGE';

    IF NEW.nb_etages < v_haut THEN
        RAISE EXCEPTION 'La machine % porte deja un etage % : son nombre d''etages ne peut pas descendre a %.',
            NEW.code_machine, v_haut, NEW.nb_etages;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_machine_nb_etages ON machine;
CREATE TRIGGER trg_machine_nb_etages
BEFORE UPDATE OF nb_etages ON machine FOR EACH ROW
EXECUTE FUNCTION fn_trg_machine_nb_etages();


-- =============================================================================
-- 5. LES DEUX PARAMETRES
-- =============================================================================
INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee,
                       unite, categorie, modifiable_par, verrouille) VALUES
 ('P_TolerEstimMachine',  'Tolerance ecart estimation en machine',
  '10', 'DECIMAL', '%',     'MACHINE', 'DIRECTION', 0),
 ('P_JoursInventMachine', 'Anciennete max d''inventaire d''un emplacement',
  '30', 'ENTIER',  'jours', 'MACHINE', 'DIRECTION', 0)
ON CONFLICT (code_parametre) DO NOTHING;


-- =============================================================================
-- 6. LA SECURITE PAR CHAMP
-- =============================================================================
-- UN CHAMP NON DECLARE VAUT MASQUE : la colonne disparait de l'API sans un mot
-- d'erreur. Sans cette section, le poids reel serait invisible pour tout le
-- monde sauf l'administrateur, et le module paraitrait simplement casse.

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('MOUVEMENTS','mode_pesee',                  'Mode de saisie du poids',      'LECTURE', 0, 1730),
 ('MOUVEMENTS','poids_unitaire_theorique_kg', 'Poids catalogue par bobine',   'LECTURE', 0, 1740),
 ('MOUVEMENTS','poids_total_pese_kg',         'Poids total pese',             'LECTURE', 0, 1750),
 ('MOUVEMENTS','pourcentage_restant',         'Pourcentage restant estime',   'LECTURE', 0, 1760),
 ('MOUVEMENTS','poids_reel_moyen_bobine_kg',  'Poids reel moyen par bobine',  'LECTURE', 0, 1770),
 ('MOUVEMENTS','ecart_theorique_pct',         'Ecart au poids catalogue (%)', 'LECTURE', 0, 1780),
 ('MOUVEMENTS','code_machine',                'Machine',                      'LECTURE', 0, 1790),
 ('MOUVEMENTS','emplacement',                 'Emplacement',                  'LECTURE', 0, 1800)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, ordre = excluded.ordre;

-- Meme regle que le seed d'origine : ECRITURE si le role ecrit dans le module,
-- LECTURE s'il le lit, MASQUE sinon. Aucun de ces champs n'est monetaire, donc
-- aucun n'est masque au magasin — c'est precisement lui qui les saisit.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE
           WHEN EXISTS (SELECT 1 FROM permission p
                         WHERE p.code_role_user = r.code_role_user
                           AND p.module = c.module AND p.action = 'ECRIRE') THEN 'ECRITURE'
           WHEN EXISTS (SELECT 1 FROM permission p
                         WHERE p.code_role_user = r.code_role_user
                           AND p.module = c.module AND p.action = 'LIRE') THEN 'LECTURE'
           ELSE 'MASQUE'
       END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'MOUVEMENTS'
   AND c.ordre BETWEEN 1730 AND 1800
   AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

-- LES VALEURS DERIVEES NE SE MODIFIENT PAS A LA MAIN. Les corriger ferait
-- diverger le calcul de son resultat : le poids moyen et l'ecart sont des
-- colonnes generees, la machine et l'emplacement viennent du magasin.
UPDATE modele_droit_champ SET niveau = 'LECTURE'
 WHERE niveau = 'ECRITURE'
   AND module = 'MOUVEMENTS'
   AND champ IN ('poids_reel_moyen_bobine_kg','ecart_theorique_pct',
                 'code_machine','emplacement');

-- La grille des comptes existants : le serveur lit `droit_champ`, et un compte
-- sans ligne serait invisible dans l'ecran des droits.
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champ_configurable c ON c.module = m.module AND c.champ = m.champ
 WHERE m.module = 'MOUVEMENTS'
   AND c.ordre BETWEEN 1730 AND 1800
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- =============================================================================
-- 7. LES CONTROLES C33 A C37
-- =============================================================================
-- C33 et C34 ne devraient JAMAIS rien remonter : trg_lmvt_capacite interdit le
-- depassement a l'ecriture. S'ils sortent, ce n'est pas la capacite qui a ete
-- violee, c'est le CACHE de bobines qui a derive — meme logique que C11 et C15
-- pour les kilos.
--
-- Le texte ci-dessous est extrait de db/pg/012_controles.sql : les deux
-- fichiers ne peuvent pas diverger.

-- =============================================================================
-- MACHINES — C33 a C37
-- -----------------------------------------------------------------------------
-- Les deux premiers ne devraient JAMAIS rien remonter : le declencheur
-- trg_lmvt_capacite interdit le depassement a l'ecriture. S'ils sortent, ce
-- n'est pas la capacite qui a ete violee, c'est le CACHE de bobines qui a
-- derive — meme logique que C11 et C15 pour les kilos.
-- =============================================================================

DROP VIEW IF EXISTS v_ctl_c33 CASCADE;
CREATE VIEW v_ctl_c33 AS
SELECT e.code_machine, e.code_emplacement, e.libelle, e.capacite_bobines,
       COALESCE(SUM(sl.nb_bobines), 0) AS bobines_presentes
FROM machine_emplacement e
LEFT JOIN stock_lot sl ON sl.code_magasin = e.code_magasin
GROUP BY e.code_machine, e.code_emplacement, e.libelle, e.capacite_bobines
HAVING COALESCE(SUM(sl.nb_bobines), 0) > e.capacite_bobines;

DROP VIEW IF EXISTS v_ctl_c34 CASCADE;
CREATE VIEW v_ctl_c34 AS
SELECT m.code_machine, m.nom, m.capacite_bobines,
       COALESCE(SUM(sl.nb_bobines), 0) AS bobines_presentes
FROM machine m
LEFT JOIN machine_emplacement e ON e.code_machine = m.code_machine
LEFT JOIN stock_lot sl ON sl.code_magasin = e.code_magasin
GROUP BY m.code_machine, m.nom, m.capacite_bobines
HAVING COALESCE(SUM(sl.nb_bobines), 0) > m.capacite_bobines;

-- C35 : L'AUDIT DU MODE ESTIMATION.
--
-- C'est le controle qui donne son sens a la colonne `mode_pesee`. L'estimation
-- est legitime — un operateur qui depose des bobines a moitie vides a raison de
-- saisir 50 %, et le bloquer l'empecherait de travailler. Mais une estimation
-- tres eloignee du catalogue est soit une bobine reellement inhabituelle, soit
-- une saisie faite pour aller vite. Les deux meritent d'etre regardees a froid,
-- et celui qui a saisi est nomme.
DROP VIEW IF EXISTS v_ctl_c35 CASCADE;
CREATE VIEW v_ctl_c35 AS
SELECT lm.id_ligne_mouvement, mv.numero_mouvement, mv.date_mouvement,
       e.code_machine, e.libelle,
       lm.code_reference, lm.lot_fournisseur, lm.nb_bobines,
       lm.quantite_kg, lm.pourcentage_restant,
       lm.poids_unitaire_theorique_kg, lm.poids_reel_moyen_bobine_kg,
       ROUND(lm.ecart_theorique_pct, 2) AS ecart_theorique_pct,
       mv.responsable, mv.id_utilisateur
FROM ligne_mouvement lm
JOIN mouvement mv ON mv.id_mouvement = lm.id_mouvement
JOIN machine_emplacement e ON e.code_magasin = mv.code_magasin
WHERE lm.mode_pesee = 'ESTIMATION'
  AND lm.ecart_theorique_pct IS NOT NULL
  AND abs(lm.ecart_theorique_pct) >
      (SELECT CAST(valeur_courante AS numeric) FROM parametre
        WHERE code_parametre = 'P_TolerEstimMachine');

-- C36 : EMPLACEMENT NON INVENTORIE DEPUIS TROP LONGTEMPS.
--
-- Le stock d'une machine repose sur une hypothese : retirer N bobines retire
-- N fois le poids moyen de l'emplacement, faute de suivre les bobines une par
-- une. La correction d'inventaire absorbe l'ecart de cette hypothese. Espacee,
-- elle ne l'absorbe plus, et l'ecart s'installe sans que personne le voie.
--
-- Comparaison de textes ISO-8601 : elle est exacte par construction, les dates
-- s'y ordonnant comme des chaines. Un emplacement vide n'est pas signale — il
-- n'y a rien a compter dessus.
DROP VIEW IF EXISTS v_ctl_c36 CASCADE;
CREATE VIEW v_ctl_c36 AS
SELECT e.code_machine, e.code_emplacement, e.libelle,
       MAX(sm.date_dernier_inventaire) AS dernier_inventaire,
       ROUND(SUM(sm.quantite_kg), 3) AS quantite_kg
FROM machine_emplacement e
JOIN stock_magasin sm ON sm.code_magasin = e.code_magasin
WHERE e.actif = 1
GROUP BY e.code_machine, e.code_emplacement, e.libelle
HAVING SUM(sm.quantite_kg) > 0
   AND (MAX(sm.date_dernier_inventaire) IS NULL
     OR MAX(sm.date_dernier_inventaire) <
        to_char((now() AT TIME ZONE 'UTC')
                - make_interval(days => (SELECT CAST(valeur_courante AS integer)
                                           FROM parametre
                                          WHERE code_parametre = 'P_JoursInventMachine')),
                'YYYY-MM-DD'));

-- C37 : LES DEUX COMPTEURS ONT DIVERGE.
--
-- Des bobines sans kilos, ou des kilos sans bobines : dans les deux cas le
-- poids moyen par bobine devient absurde, et c'est lui qui sert a calculer ce
-- qui quitte l'emplacement lors d'une depose. L'anomalie est donc CRITIQUE :
-- elle fausse silencieusement tous les retraits suivants.
DROP VIEW IF EXISTS v_ctl_c37 CASCADE;
CREATE VIEW v_ctl_c37 AS
SELECT e.code_machine, e.libelle, sl.code_reference, sl.lot_fournisseur,
       sl.quantite_kg, sl.nb_bobines
FROM stock_lot sl
JOIN machine_emplacement e ON e.code_magasin = sl.code_magasin
WHERE (sl.quantite_kg > 0 AND sl.nb_bobines = 0)
   OR (sl.quantite_kg = 0 AND sl.nb_bobines > 0);

DROP VIEW IF EXISTS v_controles CASCADE;
CREATE VIEW v_controles AS
SELECT 'C01' AS code, 'Somme des % <> 100 par role BOM'                AS controle, 'BLOQUANT'  AS criticite, (SELECT COUNT(*) FROM v_ctl_c01) AS anomalies UNION ALL
SELECT 'C02', 'BC envoyes non soldes depuis plus de 30j',              'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c02) UNION ALL
SELECT 'C03', 'Reference de mouvement absente du catalogue',           'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c03) UNION ALL
SELECT 'C04', 'Fournisseur de reference inexistant',                   'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c04) UNION ALL
SELECT 'C05', 'Stock projete negatif sur 12 mois',                     'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c05) UNION ALL
SELECT 'C06', 'Mouvement date dans le futur',                          'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c06) UNION ALL
SELECT 'C07', 'Sortie production sans numero d''OF',                   'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c07) UNION ALL
SELECT 'C08', 'Retour sans motif de ligne',                            'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c08) UNION ALL
SELECT 'C09', 'Mouvement sans utilisateur',                            'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c09) UNION ALL
SELECT 'C10', 'Ecart de pesee hors tolerance sans derogation',         'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c10) UNION ALL
SELECT 'C11', 'Derive solde de stock vs grand livre',                  'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c11) UNION ALL
SELECT 'C12', 'Reference active a prix nul',                           'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c12) UNION ALL
SELECT 'C13', 'Reference active sans fournisseur',                     'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c13) UNION ALL
SELECT 'C14', 'Composant de recette validee a cout nul',               'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c14) UNION ALL
SELECT 'C15', 'Derive stock par lot vs stock par magasin',             'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c15) UNION ALL
SELECT 'C16', 'Role de recette sans densite sur la qualite',           'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c16) UNION ALL
SELECT 'C17', 'Reference active sans recette (orpheline)',             'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c17) UNION ALL
SELECT 'C18', 'Qualite planifiee sans densite de role',                'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c18) UNION ALL
SELECT 'C19', 'Devise catalogue sans taux de change en vigueur',       'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c19) UNION ALL
SELECT 'C20', 'Reference classe A mono-source',                        'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c20) UNION ALL
SELECT 'C21', 'Role avec densite mais sans matiere en recette',        'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c21) UNION ALL
SELECT 'C22', 'Groupe d''equivalence aux references non interchangeables', 'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c22) UNION ALL
SELECT 'C23', 'Groupe d''equivalence sans reference preferentielle',     'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c23) UNION ALL
SELECT 'C24', 'Reception d''une autre reference sans substitution declaree', 'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c24) UNION ALL
SELECT 'C25', 'Stock mobilisable face a un equivalent en tension',        'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c25) UNION ALL
SELECT 'C26', 'Groupe d''equivalence limite a un seul fournisseur',        'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c26) UNION ALL
SELECT 'C27', 'Ecart majeur : couverture confortable, magasin sous le minimum', 'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c27) UNION ALL
SELECT 'C28', 'Commande en retard, retiree du calcul de couverture',      'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c28) UNION ALL
SELECT 'C29', 'Besoins plus anciens que le plan : projection perimee',    'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c29) UNION ALL
-- Les trois derniers viennent de la feuille Tests du classeur (T12, T17, T19).
-- Leurs vues de detail sont definies dans 016_controles_classeur.sql, charge
-- juste avant celui-ci lors de la construction.
SELECT 'C30', 'Delai fournisseur absent, nul ou negatif',                'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c30) UNION ALL
SELECT 'C31', 'Reception validee non repercutee au stock',               'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c31) UNION ALL
SELECT 'C32', 'Reception valorisee absente de l''historique des prix',   'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c32) UNION ALL
-- MACHINES. C33 et C34 traquent une derive du cache de bobines, pas un
-- depassement : le declencheur rend celui-ci impossible a l''ecriture.
SELECT 'C33', 'Emplacement de machine au-dela de sa capacite',          'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c33) UNION ALL
SELECT 'C34', 'Machine au-dela de sa capacite totale',                  'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c34) UNION ALL
SELECT 'C35', 'Estimation de poids hors tolerance en machine',          'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c35) UNION ALL
SELECT 'C36', 'Emplacement de machine sans inventaire recent',          'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c36) UNION ALL
SELECT 'C37', 'Bobines sans kilos, ou kilos sans bobines, en machine',  'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c37);

COMMIT;
