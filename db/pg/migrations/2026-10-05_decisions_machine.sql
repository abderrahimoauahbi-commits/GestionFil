-- =============================================================================
-- 2026-10-05 — LES OPERATIONS MACHINE DEVIENNENT DES DECISIONS
-- =============================================================================
--
-- Modele valide par l'utilisateur le 05/10/2026 (memoire « modele-decisions-
-- machine ») :
--
--   etat precedent valide -> constat et decision par ligne Reference + Lot
--   -> validation -> etat resultant
--
-- * L'etat d'un etage se tient en BOBINES et en KILOS par reference et lot ; le
--   pourcentage (du poids nominal) se deduit. Les kilos ne sont plus calcules
--   par la base : ils resultent des decisions.
-- * Chaque validation est une decision chainee a la precedente, avec l'etat
--   AVANT et l'etat RESULTANT figes, ses lignes calculees, et un journal. Rien
--   de cela ne se modifie.
-- * L'ecart de chaque ligne (avant + charge - retire - apres) est qualifie par
--   une MATRICE des motifs (validee le 05/10/2026) : consommation, dechet,
--   perte, casse, erreur de saisie, non qualifie, regularisation.
-- * Annuler une decision n'est jamais un faux mouvement physique : deux types
--   d'annulation ADMINISTRATIVE, rattaches au mouvement d'origine.
-- * Chaque etage part d'une decision DEPART : la fiche de depart de mise en
--   production, c'est-a-dire son etat actuel.
--
-- REJOUABLE : IF NOT EXISTS, ON CONFLICT, CREATE OR REPLACE, gardes explicites.
-- A JOUER EN postgres : chaque objet cree est donne a `gestionfil`.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. L'ETAT D'UN ETAGE : les kilos deviennent une donnee
-- -----------------------------------------------------------------------------
-- Jusqu'ici kg = bobines x poids x % / 100, calcule par la base. Avec des
-- bobines chargees a un poids, constatees a un autre, puis retirees a un
-- troisieme, une seule formule ne decrit plus la ligne : ce sont les decisions
-- qui la font. Les valeurs presentes sont conservees telles quelles.
ALTER TABLE machine_etat ALTER COLUMN kg DROP EXPRESSION IF EXISTS;
UPDATE machine_etat SET kg = 0 WHERE kg IS NULL;
ALTER TABLE machine_etat ALTER COLUMN kg SET DEFAULT 0;
ALTER TABLE machine_etat ALTER COLUMN kg SET NOT NULL;
-- Un poids retenu peut depasser le nominal : le % moyen peut passer 100.
ALTER TABLE machine_etat DROP CONSTRAINT IF EXISTS machine_etat_pourcentage_check;
ALTER TABLE machine_etat ADD CONSTRAINT machine_etat_pourcentage_check
    CHECK (pourcentage >= 0 AND pourcentage <= 500);
ALTER TABLE machine_etat DROP CONSTRAINT IF EXISTS ck_machine_etat_kg;
ALTER TABLE machine_etat ADD CONSTRAINT ck_machine_etat_kg CHECK (kg >= 0);

-- -----------------------------------------------------------------------------
-- 2. LA MATRICE DES MOTIFS (validee le 05/10/2026)
-- -----------------------------------------------------------------------------
-- `destinations` : ou partent les bobines retirees (dechargement seulement).
-- `effet_defaut` : ce que compte l'ecart de la ligne ; NULL = au choix parmi
-- `effets_permis`, sur la ligne. Un ecart NEGATIF est toujours une
-- REGULARISATION, quel que soit le motif.
CREATE TABLE IF NOT EXISTS machine_motif (
    code_motif     text    NOT NULL PRIMARY KEY,
    type_fiche     text    NOT NULL CHECK (type_fiche IN ('CHARGE', 'DECHARGE', 'MAJ')),
    libelle        text    NOT NULL,
    destinations   text[]  NOT NULL DEFAULT '{}',
    effet_defaut   text    CHECK (effet_defaut IN ('CONSOMMATION', 'NON_QUALIFIE')),
    effets_permis  text[]  NOT NULL DEFAULT '{}',
    ordre          bigint  NOT NULL DEFAULT 0,
    actif          bigint  NOT NULL DEFAULT 1 CHECK (actif IN (0, 1)),
    CHECK (effet_defaut IS NOT NULL OR cardinality(effets_permis) > 0)
);
ALTER TABLE machine_motif OWNER TO gestionfil;

INSERT INTO machine_motif (code_motif, type_fiche, libelle, destinations, effet_defaut, effets_permis, ordre) VALUES
  ('CH_PRODUCTION', 'CHARGE',   'Pour production',          '{}',                             'CONSOMMATION', '{}', 1),
  ('CH_COMPLEMENT', 'CHARGE',   'Complément de production', '{}',                             'CONSOMMATION', '{}', 2),
  ('CH_AUTRE',      'CHARGE',   'Autre',                    '{}',                             'NON_QUALIFIE', '{}', 9),
  ('DE_CHGT_LOT',   'DECHARGE', 'Changement de lot',        '{MAGASIN}',                      'CONSOMMATION', '{}', 1),
  ('DE_CHGT_PROD',  'DECHARGE', 'Changement de production', '{MAGASIN}',                      'CONSOMMATION', '{}', 2),
  ('DE_PB_FIL',     'DECHARGE', 'Problème de fil',          '{MAGASIN,DECHET}',               'CONSOMMATION', '{}', 3),
  ('DE_DECHET',     'DECHARGE', 'Déchet',                   '{DECHET}',                       'CONSOMMATION', '{}', 4),
  ('DE_PERTE',      'DECHARGE', 'Perte',                    '{PERTE}',                        'CONSOMMATION', '{}', 5),
  ('DE_CASSE',      'DECHARGE', 'Casse',                    '{CASSE}',                        'CONSOMMATION', '{}', 6),
  ('DE_AUTRE',      'DECHARGE', 'Autre',                    '{MAGASIN,PERTE,DECHET,CASSE}',   'NON_QUALIFIE', '{}', 9),
  ('MJ_ORDINAIRE',  'MAJ',      'Constat ordinaire',        '{}',                             'CONSOMMATION', '{}', 1),
  ('MJ_CORRECTION', 'MAJ',      'Correction',               '{}',                             NULL, '{CONSOMMATION,ERREUR_SAISIE}', 2),
  ('MJ_DPC',        'MAJ',      'Déchet / perte / casse',   '{}',                             NULL, '{DECHET,PERTE,CASSE}', 3),
  ('MJ_AUTRE',      'MAJ',      'Autre',                    '{}',                             'NON_QUALIFIE', '{}', 9)
ON CONFLICT (code_motif) DO UPDATE
   SET type_fiche = EXCLUDED.type_fiche, libelle = EXCLUDED.libelle,
       destinations = EXCLUDED.destinations, effet_defaut = EXCLUDED.effet_defaut,
       effets_permis = EXCLUDED.effets_permis, ordre = EXCLUDED.ordre;

-- -----------------------------------------------------------------------------
-- 3. LES LIGNES DE FICHE : ce que l'utilisateur saisit
-- -----------------------------------------------------------------------------
-- Chargement : a charger (nb_bobines_mouvementees), poids retenu, % de TOUTE
-- la ligne apres. Dechargement : a retirer, % des bobines retirees, destination,
-- % des restantes. Constat : nb present (nb_bobines_presentes), % ou poids.
ALTER TABLE machine_fiche_ligne ADD COLUMN IF NOT EXISTS poids_retenu_kg numeric(18,4);
ALTER TABLE machine_fiche_ligne ADD COLUMN IF NOT EXISTS pct_retirees    numeric(6,2);
ALTER TABLE machine_fiche_ligne ADD COLUMN IF NOT EXISTS destination     text;
ALTER TABLE machine_fiche_ligne ADD COLUMN IF NOT EXISTS code_motif      text REFERENCES machine_motif(code_motif);
ALTER TABLE machine_fiche_ligne ADD COLUMN IF NOT EXISTS motif_texte     text;
ALTER TABLE machine_fiche_ligne ADD COLUMN IF NOT EXISTS effet_ecart     text;
ALTER TABLE machine_fiche_ligne DROP CONSTRAINT IF EXISTS ck_ligne_poids_retenu;
ALTER TABLE machine_fiche_ligne ADD CONSTRAINT ck_ligne_poids_retenu
    CHECK (poids_retenu_kg IS NULL OR poids_retenu_kg > 0);
ALTER TABLE machine_fiche_ligne DROP CONSTRAINT IF EXISTS ck_ligne_pct_retirees;
ALTER TABLE machine_fiche_ligne ADD CONSTRAINT ck_ligne_pct_retirees
    CHECK (pct_retirees IS NULL OR (pct_retirees >= 0 AND pct_retirees <= 500));
ALTER TABLE machine_fiche_ligne DROP CONSTRAINT IF EXISTS ck_ligne_destination;
ALTER TABLE machine_fiche_ligne ADD CONSTRAINT ck_ligne_destination
    CHECK (destination IS NULL OR destination IN ('MAGASIN', 'PERTE', 'DECHET', 'CASSE'));
-- La ligne de fiche ne porte plus que la SAISIE ; les kilos calcules vivent
-- dans `machine_decision_ligne`. L'ancienne egalite kg = presentes x poids x %
-- n'a plus d'objet (un chargement n'a pas de « presentes »).
ALTER TABLE machine_fiche_ligne DROP CONSTRAINT IF EXISTS ck_ligne_estimation;
ALTER TABLE machine_fiche_ligne DROP CONSTRAINT IF EXISTS machine_fiche_ligne_pourcentage_check;
ALTER TABLE machine_fiche_ligne ADD CONSTRAINT machine_fiche_ligne_pourcentage_check
    CHECK (pourcentage IS NULL OR (pourcentage >= 0 AND pourcentage <= 500));

-- La fiche compte ses validations : une fiche devalidee puis revalidee porte
-- la decision n°2.
ALTER TABLE machine_fiche ADD COLUMN IF NOT EXISTS nb_validations bigint NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- 4. LES DECISIONS, chainees par etage
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS machine_decision (
    id_decision              text    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    id_fiche                 text    REFERENCES machine_fiche(id_fiche),
    numero_validation        bigint  NOT NULL DEFAULT 1,
    nature                   text    NOT NULL CHECK (nature IN ('DEPART', 'CHARGE', 'DECHARGE', 'MAJ')),
    code_machine             text    NOT NULL REFERENCES machine(code_machine),
    code_emplacement         text    NOT NULL REFERENCES machine_emplacement(code_emplacement),
    code_magasin             text    REFERENCES magasin(code_magasin),
    -- La decision sur laquelle celle-ci s'appuie : l'etat d'avant.
    id_decision_precedente   text    REFERENCES machine_decision(id_decision),
    statut                   text    NOT NULL DEFAULT 'ACTIVE'
                                     CHECK (statut IN ('ACTIVE', 'RETIREE', 'ANNULEE')),
    -- La TETE de l'etage : la decision active dont l'etat fait foi.
    est_tete                 bigint  NOT NULL DEFAULT 1 CHECK (est_tete IN (0, 1)),
    -- A la milliseconde : deux decisions du meme jour s'ordonnent sans ambiguite.
    date_decision            text    NOT NULL
                                     DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC',
                                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_utilisateur           text    REFERENCES utilisateur(id_utilisateur),
    responsable              text,
    date_retrait             text,
    id_utilisateur_retrait   text    REFERENCES utilisateur(id_utilisateur),
    motif_retrait            text,
    CHECK (est_tete = 0 OR statut = 'ACTIVE'),
    CHECK (statut = 'ACTIVE' OR (date_retrait IS NOT NULL AND motif_retrait IS NOT NULL)),
    CHECK ((nature = 'DEPART') = (id_fiche IS NULL))
);
ALTER TABLE machine_decision OWNER TO gestionfil;
CREATE UNIQUE INDEX IF NOT EXISTS ux_machine_decision_tete
    ON machine_decision (code_emplacement) WHERE est_tete = 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_machine_decision_fiche
    ON machine_decision (id_fiche, numero_validation) WHERE id_fiche IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_machine_decision_emplacement
    ON machine_decision (code_emplacement, date_decision);

-- L'etat AVANT et l'etat RESULTANT de chaque decision : l'etage entier.
CREATE TABLE IF NOT EXISTS machine_decision_etat (
    id_decision        text          NOT NULL REFERENCES machine_decision(id_decision),
    moment             text          NOT NULL CHECK (moment IN ('AVANT', 'APRES')),
    code_reference     text          NOT NULL REFERENCES reference(code_reference),
    lot_fournisseur    text          NOT NULL,
    nb_bobines         bigint        NOT NULL CHECK (nb_bobines >= 0),
    poids_unitaire_kg  numeric(18,4),
    pourcentage        numeric(6,2),
    kg                 numeric(18,4) NOT NULL CHECK (kg >= 0),
    PRIMARY KEY (id_decision, moment, code_reference, lot_fournisseur)
);
ALTER TABLE machine_decision_etat OWNER TO gestionfil;

-- Les lignes calculees et validees : ce que la decision a fait, ligne a ligne.
CREATE TABLE IF NOT EXISTS machine_decision_ligne (
    id_decision        text          NOT NULL REFERENCES machine_decision(id_decision),
    ligne_numero       bigint        NOT NULL,
    code_reference     text          NOT NULL REFERENCES reference(code_reference),
    lot_fournisseur    text          NOT NULL,
    poids_nominal_kg   numeric(18,4) NOT NULL CHECK (poids_nominal_kg > 0),
    nb_avant           bigint        NOT NULL CHECK (nb_avant >= 0),
    kg_avant           numeric(18,4) NOT NULL CHECK (kg_avant >= 0),
    nb_mouvementees    bigint        NOT NULL DEFAULT 0 CHECK (nb_mouvementees >= 0),
    poids_retenu_kg    numeric(18,4),
    pct_retirees       numeric(6,2),
    kg_mouvementes     numeric(18,4) NOT NULL DEFAULT 0 CHECK (kg_mouvementes >= 0),
    destination        text          CHECK (destination IN ('MAGASIN', 'PERTE', 'DECHET', 'CASSE')),
    nb_apres           bigint        NOT NULL CHECK (nb_apres >= 0),
    pourcentage_apres  numeric(6,2),
    -- Le % que donnerait le seul calcul (kg / nb x nominal) : l'etalon de l'ecart.
    pourcentage_theorique numeric(12,2),
    kg_apres           numeric(18,4) NOT NULL CHECK (kg_apres >= 0),
    ecart_kg           numeric(18,4) NOT NULL,
    effet_ecart        text          NOT NULL CHECK (effet_ecart IN
                           ('CONSOMMATION', 'ERREUR_SAISIE', 'DECHET', 'PERTE', 'CASSE',
                            'NON_QUALIFIE', 'REGULARISATION', 'AUCUN')),
    code_motif         text          NOT NULL REFERENCES machine_motif(code_motif),
    motif_texte        text,
    -- Le CMUP du magasin au moment de la decision : la valeur a laquelle le fil
    -- est parti, ou revenu. Une annulation remet cette valeur-la.
    cmup_mad           numeric(18,4),
    id_mouvement       text          REFERENCES mouvement(id_mouvement),
    PRIMARY KEY (id_decision, ligne_numero)
);
-- Rejouable sur une base deja passee par une premiere version de ce script.
ALTER TABLE machine_decision_ligne ADD COLUMN IF NOT EXISTS pourcentage_theorique numeric(12,2);
ALTER TABLE machine_decision_ligne OWNER TO gestionfil;
CREATE INDEX IF NOT EXISTS ix_machine_decision_ligne_ref
    ON machine_decision_ligne (code_reference, lot_fournisseur);

-- Le journal de la fiche : qui a fait quoi, quand, pourquoi.
CREATE TABLE IF NOT EXISTS machine_fiche_journal (
    id_evenement      text   NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    id_fiche          text   REFERENCES machine_fiche(id_fiche),
    id_decision       text   REFERENCES machine_decision(id_decision),
    evenement         text   NOT NULL CHECK (evenement IN
                          ('DEPART', 'VALIDATION', 'DEVALIDATION', 'ANNULATION', 'CHANGEMENT_ETAGE')),
    code_emplacement  text   REFERENCES machine_emplacement(code_emplacement),
    motif             text,
    id_utilisateur    text   REFERENCES utilisateur(id_utilisateur),
    horodatage        text   NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC',
                                                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    detail            jsonb
);
ALTER TABLE machine_fiche_journal OWNER TO gestionfil;
CREATE INDEX IF NOT EXISTS ix_machine_fiche_journal_fiche ON machine_fiche_journal (id_fiche, horodatage);

-- Les mouvements de magasin rattaches a leur decision.
ALTER TABLE mouvement ADD COLUMN IF NOT EXISTS id_decision_machine text
    REFERENCES machine_decision(id_decision);
CREATE INDEX IF NOT EXISTS ix_mouvement_decision_machine
    ON mouvement (id_decision_machine) WHERE id_decision_machine IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. L'HISTORIQUE NE SE REECRIT PAS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_machine_historique_immuable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'R03 : l''historique des decisions machine est immuable (%).', TG_TABLE_NAME;
END $$;
ALTER FUNCTION fn_trg_machine_historique_immuable() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_machine_decision_etat_immuable ON machine_decision_etat;
CREATE TRIGGER trg_machine_decision_etat_immuable BEFORE UPDATE OR DELETE ON machine_decision_etat
    FOR EACH ROW EXECUTE FUNCTION fn_trg_machine_historique_immuable();
DROP TRIGGER IF EXISTS trg_machine_decision_ligne_immuable ON machine_decision_ligne;
CREATE TRIGGER trg_machine_decision_ligne_immuable BEFORE UPDATE OR DELETE ON machine_decision_ligne
    FOR EACH ROW EXECUTE FUNCTION fn_trg_machine_historique_immuable();
DROP TRIGGER IF EXISTS trg_machine_fiche_journal_immuable ON machine_fiche_journal;
CREATE TRIGGER trg_machine_fiche_journal_immuable BEFORE UPDATE OR DELETE ON machine_fiche_journal
    FOR EACH ROW EXECUTE FUNCTION fn_trg_machine_historique_immuable();

-- Une decision ne change que de statut (retrait) et de tete ; jamais d'objet.
CREATE OR REPLACE FUNCTION fn_trg_machine_decision_maj() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'R03 : une decision machine ne se supprime pas ; elle se retire.';
    END IF;
    IF (NEW.id_fiche, NEW.numero_validation, NEW.nature, NEW.code_machine, NEW.code_emplacement,
        NEW.code_magasin, NEW.id_decision_precedente, NEW.date_decision, NEW.id_utilisateur)
       IS DISTINCT FROM
       (OLD.id_fiche, OLD.numero_validation, OLD.nature, OLD.code_machine, OLD.code_emplacement,
        OLD.code_magasin, OLD.id_decision_precedente, OLD.date_decision, OLD.id_utilisateur) THEN
        RAISE EXCEPTION 'R03 : une decision machine ne se modifie pas.';
    END IF;
    IF OLD.statut <> 'ACTIVE' AND NEW.statut IS DISTINCT FROM OLD.statut THEN
        RAISE EXCEPTION 'R03 : une decision retiree ou annulee ne revient pas.';
    END IF;
    RETURN NEW;
END $$;
ALTER FUNCTION fn_trg_machine_decision_maj() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_machine_decision_maj ON machine_decision;
CREATE TRIGGER trg_machine_decision_maj BEFORE UPDATE OR DELETE ON machine_decision
    FOR EACH ROW EXECUTE FUNCTION fn_trg_machine_decision_maj();

-- -----------------------------------------------------------------------------
-- 6. L'ANNULATION ADMINISTRATIVE, jamais un faux mouvement physique
-- -----------------------------------------------------------------------------
-- Annuler un chargement remet le fil au magasin A LA VALEUR A LAQUELLE IL ETAIT
-- PARTI (CMUP fige sur la decision) : c'est une entree avec prix. Annuler un
-- retour le retire. Tous deux sont INTERNES (jamais proposes a la saisie) et
-- portent `id_mouvement_contrepasse` vers le mouvement d'origine.
INSERT INTO type_mouvement (code_type_mvt, libelle, signe, exige_prix, impacte_cmup,
                            exige_of, exige_motif_ligne, couleur, actif, interne) VALUES
  ('ANNUL_CHARGE_MACHINE', 'Annulation d''un chargement machine',  1, 1, 1, 0, 0, '#9ca3af', 1, 1),
  ('ANNUL_RETOUR_MACHINE', 'Annulation d''un retour machine',     -1, 0, 0, 0, 0, '#9ca3af', 1, 1)
ON CONFLICT (code_type_mvt) DO UPDATE
   SET libelle = EXCLUDED.libelle, signe = EXCLUDED.signe, exige_prix = EXCLUDED.exige_prix,
       impacte_cmup = EXCLUDED.impacte_cmup, interne = EXCLUDED.interne;

-- -----------------------------------------------------------------------------
-- 7. LA FICHE DE DEPART : l'etat actuel de chaque zone ouvre sa chaine
-- -----------------------------------------------------------------------------
-- Une seule fois par zone : une zone qui a deja une tete n'est pas touchee.
WITH departs AS (
    INSERT INTO machine_decision (nature, code_machine, code_emplacement, responsable, est_tete)
    SELECT 'DEPART', z.code_machine, z.code_emplacement,
           'Fiche de depart de mise en production', 1
      FROM machine_emplacement z
     WHERE NOT EXISTS (SELECT 1 FROM machine_decision d
                        WHERE d.code_emplacement = z.code_emplacement AND d.est_tete = 1)
    RETURNING id_decision, code_emplacement
)
INSERT INTO machine_decision_etat (id_decision, moment, code_reference, lot_fournisseur,
                                   nb_bobines, poids_unitaire_kg, pourcentage, kg)
SELECT d.id_decision, 'APRES', e.code_reference, e.lot_fournisseur,
       e.nb_bobines, e.poids_unitaire_kg, e.pourcentage, e.kg
  FROM departs d
  JOIN machine_etat e ON e.code_emplacement = d.code_emplacement;

INSERT INTO machine_fiche_journal (id_decision, evenement, code_emplacement, motif)
SELECT d.id_decision, 'DEPART', d.code_emplacement, 'Fiche de depart de mise en production'
  FROM machine_decision d
 WHERE d.nature = 'DEPART'
   AND NOT EXISTS (SELECT 1 FROM machine_fiche_journal j WHERE j.id_decision = d.id_decision);

-- -----------------------------------------------------------------------------
-- 8. LA CONSOMMATION : la somme des ecarts qualifies, des decisions actives
-- -----------------------------------------------------------------------------
-- Une decision retiree ou annulee sort du calcul sans rien effacer.
CREATE OR REPLACE VIEW v_machine_ecart AS
SELECT d.id_decision, d.id_fiche, f.numero_fiche, d.nature, d.code_machine, d.code_emplacement,
       z.libelle AS zone, d.date_decision, l.ligne_numero, l.code_reference, r.designation,
       l.lot_fournisseur, l.kg_avant, l.kg_mouvementes, l.destination, l.kg_apres,
       l.ecart_kg, l.effet_ecart, l.code_motif, m.libelle AS motif, l.motif_texte
  FROM machine_decision d
  JOIN machine_decision_ligne l ON l.id_decision = d.id_decision
  JOIN machine_emplacement z    ON z.code_emplacement = d.code_emplacement
  JOIN reference r              ON r.code_reference = l.code_reference
  JOIN machine_motif m          ON m.code_motif = l.code_motif
  LEFT JOIN machine_fiche f     ON f.id_fiche = d.id_fiche
 WHERE d.statut = 'ACTIVE';
ALTER VIEW v_machine_ecart OWNER TO gestionfil;

-- La signature change (colonnes de pertes et d'ecarts non qualifies) : on
-- remplace la fonction. Bornes : dates de decision, texte ISO.
DROP FUNCTION IF EXISTS f_machine_consommation(text, text, text);
CREATE FUNCTION f_machine_consommation(p_machine text DEFAULT NULL, p_debut text DEFAULT NULL,
                                       p_fin text DEFAULT NULL)
RETURNS TABLE (code_machine text, machine_nom text, code_emplacement text, zone text,
               code_reference text, designation text, lot_fournisseur text,
               date_debut text, kg_debut numeric, kg_charge numeric, kg_retourne numeric,
               kg_sorti_autre numeric, date_fin text, kg_fin numeric, consommation_kg numeric,
               dechet_perte_casse_kg numeric, non_qualifie_kg numeric, regularisation_kg numeric,
               erreur_saisie_kg numeric)
LANGUAGE sql STABLE AS $$
    WITH periode AS (
        SELECT e.*, l.nb_mouvementees
          FROM v_machine_ecart e
          JOIN machine_decision_ligne l ON l.id_decision = e.id_decision
                                       AND l.ligne_numero = e.ligne_numero
         WHERE e.nature <> 'DEPART'
           AND (p_machine IS NULL OR e.code_machine = p_machine)
           AND (p_debut   IS NULL OR substr(e.date_decision, 1, 10) >= substr(p_debut, 1, 10))
           AND (p_fin     IS NULL OR substr(e.date_decision, 1, 10) <= substr(p_fin, 1, 10))
    ),
    bornes AS (
        SELECT DISTINCT ON (p.code_emplacement, p.code_reference, p.lot_fournisseur)
               p.code_emplacement, p.code_reference, p.lot_fournisseur,
               p.date_decision AS date_debut, p.kg_avant AS kg_debut
          FROM periode p
         ORDER BY p.code_emplacement, p.code_reference, p.lot_fournisseur, p.date_decision
    ),
    fins AS (
        SELECT DISTINCT ON (p.code_emplacement, p.code_reference, p.lot_fournisseur)
               p.code_emplacement, p.code_reference, p.lot_fournisseur,
               p.date_decision AS date_fin, p.kg_apres AS kg_fin
          FROM periode p
         ORDER BY p.code_emplacement, p.code_reference, p.lot_fournisseur, p.date_decision DESC
    )
    SELECT p.code_machine, m.nom, p.code_emplacement, p.zone, p.code_reference, p.designation,
           p.lot_fournisseur, b.date_debut, ROUND(b.kg_debut, 3),
           ROUND(SUM(CASE WHEN p.nature = 'CHARGE' THEN p.kg_mouvementes ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.nature = 'DECHARGE' AND p.destination = 'MAGASIN'
                          THEN p.kg_mouvementes ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.nature = 'DECHARGE' AND p.destination <> 'MAGASIN'
                          THEN p.kg_mouvementes ELSE 0 END), 3),
           fn.date_fin, ROUND(fn.kg_fin, 3),
           ROUND(SUM(CASE WHEN p.effet_ecart = 'CONSOMMATION' THEN p.ecart_kg ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.effet_ecart IN ('DECHET', 'PERTE', 'CASSE') THEN p.ecart_kg ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.effet_ecart = 'NON_QUALIFIE' THEN p.ecart_kg ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.effet_ecart = 'REGULARISATION' THEN p.ecart_kg ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.effet_ecart = 'ERREUR_SAISIE' THEN p.ecart_kg ELSE 0 END), 3)
      FROM periode p
      JOIN machine m ON m.code_machine = p.code_machine
      JOIN bornes b  ON b.code_emplacement = p.code_emplacement
                    AND b.code_reference = p.code_reference AND b.lot_fournisseur = p.lot_fournisseur
      JOIN fins fn   ON fn.code_emplacement = p.code_emplacement
                    AND fn.code_reference = p.code_reference AND fn.lot_fournisseur = p.lot_fournisseur
     GROUP BY p.code_machine, m.nom, p.code_emplacement, p.zone, p.code_reference, p.designation,
              p.lot_fournisseur, b.date_debut, b.kg_debut, fn.date_fin, fn.kg_fin
$$;
ALTER FUNCTION f_machine_consommation(text, text, text) OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 9. LES CONTROLES
-- -----------------------------------------------------------------------------
-- C38 : consommation negative sur une ligne (constat superieur a l'attendu
--       qualifie de consommation : impossible, c'est une regularisation).
CREATE OR REPLACE VIEW v_ctl_c38 AS
SELECT * FROM v_machine_ecart WHERE effet_ecart = 'CONSOMMATION' AND ecart_kg < -0.001;
-- C39 : l'etat d'un etage differe de l'etat resultant de sa tete.
CREATE OR REPLACE VIEW v_ctl_c39 AS
WITH tete AS (
    SELECT d.id_decision, d.code_emplacement FROM machine_decision d WHERE d.est_tete = 1
), attendu AS (
    SELECT t.code_emplacement, s.code_reference, s.lot_fournisseur, s.nb_bobines, s.kg
      FROM tete t JOIN machine_decision_etat s ON s.id_decision = t.id_decision AND s.moment = 'APRES'
)
SELECT COALESCE(a.code_emplacement, e.code_emplacement) AS code_emplacement,
       COALESCE(a.code_reference, e.code_reference)     AS code_reference,
       COALESCE(a.lot_fournisseur, e.lot_fournisseur)   AS lot_fournisseur,
       a.nb_bobines AS bobines_attendues, e.nb_bobines AS bobines_etat,
       a.kg AS kg_attendus, e.kg AS kg_etat
  FROM attendu a
  FULL JOIN machine_etat e ON e.code_emplacement = a.code_emplacement
                          AND e.code_reference = a.code_reference
                          AND e.lot_fournisseur = a.lot_fournisseur
 WHERE a.nb_bobines IS DISTINCT FROM e.nb_bobines
    OR abs(COALESCE(a.kg, 0) - COALESCE(e.kg, 0)) > 0.001;
-- C40 : ecart non qualifie, a revoir.
CREATE OR REPLACE VIEW v_ctl_c40 AS
SELECT * FROM v_machine_ecart WHERE effet_ecart = 'NON_QUALIFIE' AND abs(ecart_kg) > 0.001;
-- C41 : regularisation (on a constate plus que l'attendu), a revoir.
CREATE OR REPLACE VIEW v_ctl_c41 AS
SELECT * FROM v_machine_ecart WHERE effet_ecart = 'REGULARISATION';
-- C42 : annulation administrative sans mouvement d'origine.
CREATE OR REPLACE VIEW v_ctl_c42 AS
SELECT m.* FROM mouvement m
 WHERE m.code_type_mvt IN ('ANNUL_CHARGE_MACHINE', 'ANNUL_RETOUR_MACHINE')
   AND m.id_mouvement_contrepasse IS NULL;
ALTER VIEW v_ctl_c38 OWNER TO gestionfil;
ALTER VIEW v_ctl_c39 OWNER TO gestionfil;
ALTER VIEW v_ctl_c40 OWNER TO gestionfil;
ALTER VIEW v_ctl_c41 OWNER TO gestionfil;
ALTER VIEW v_ctl_c42 OWNER TO gestionfil;

-- Les cinq contrôles rejoignent le tableau de bord. La definition courante de
-- v_controles est relue et prolongee : rien de ses 37 controles n'est reecrit.
DO $$
DECLARE def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C38' IN def) > 0 THEN RETURN; END IF;
    def := rtrim(rtrim(def), ';');
    EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def || $u$
UNION ALL SELECT 'C38'::text, 'Machine : consommation negative'::text, 'CRITIQUE'::text, (SELECT count(*) FROM v_ctl_c38)
UNION ALL SELECT 'C39'::text, 'Machine : etage different de sa derniere decision'::text, 'BLOQUANT'::text, (SELECT count(*) FROM v_ctl_c39)
UNION ALL SELECT 'C40'::text, 'Machine : ecart non qualifie a revoir'::text, 'ATTENTION'::text, (SELECT count(*) FROM v_ctl_c40)
UNION ALL SELECT 'C41'::text, 'Machine : regularisation (constat superieur a l''attendu)'::text, 'ATTENTION'::text, (SELECT count(*) FROM v_ctl_c41)
UNION ALL SELECT 'C42'::text, 'Machine : annulation sans mouvement d''origine'::text, 'BLOQUANT'::text, (SELECT count(*) FROM v_ctl_c42)$u$;
END $$;
ALTER VIEW v_controles OWNER TO gestionfil;

SELECT 'decisions machine : ' || (SELECT count(*) FROM machine_decision WHERE nature = 'DEPART')
       || ' zones ouvertes par la fiche de depart, ' || (SELECT count(*) FROM machine_motif) || ' motifs';

COMMIT;
