-- =============================================================================
-- 2026-10-14a — ADR-003 phase A : la réception est un ARRIVAGE (un BL)
-- =============================================================================
-- Décision D2 du 14/10/2026, raffinée le même jour : une réception n'est pas
-- « un bon de commande reçu », c'est UN ARRIVAGE — un camion, un conteneur, un
-- bon de livraison. Ce sont ses LIGNES qui se rattachent chacune à une ligne de
-- bon de commande (`ligne_reception.id_ligne_bc`, déjà en place), et un même
-- arrivage couvre donc un bon (cas local) ou plusieurs (groupage d'import).
--
-- Ce que cette migration ajoute, c'est ce qui manquait à l'en-tête pour que
-- l'import passe par le MÊME document que le local :
--
--   * `reception.id_dossier_import` — le dossier d'import auquel l'arrivage se
--     rattache (DUM, conteneurs, régime douanier). Il se RATTACHE, il ne
--     remplace pas la commande : le prix vient toujours de la ligne de bon.
--     Un seul dossier par arrivage : la DUM est celle du dossier (décision du
--     01/10/2026), et un conteneur dédouané deux fois n'existe pas.
--
--   * `import_dossiers.circuit_reception` — par quel circuit un dossier reçoit
--     sa marchandise. `FACTURE` : par ses lignes de facture, dans l'écran des
--     réceptions d'import. `BON` : sa marchandise se pèse dans la réception
--     unifiée, contre les lignes du bon de commande qui l'a engagée.
--
--     LE DÉFAUT RESTE `FACTURE`, ET C'EST DÉLIBÉRÉ. La chaîne des frais
--     d'import — clôture du dossier, répartition, CUMP définitif — lit ses
--     kilos reçus dans `import_facture_lignes.quantite_recue_kg`, que SEUL
--     l'ancien circuit alimente. Basculer l'import dès maintenant aurait
--     empêché tout dossier neuf de se clôturer : ses frais n'auraient jamais
--     atteint le CUMP. On ne ferme une porte que quand l'autre mène au bout —
--     ce sera la phase C, qui apprendra à cette chaîne à lire les arrivages et
--     posera alors `BON` par défaut.
--
--     Le marqueur est porté par le DOSSIER et non par une date : un dossier
--     ouvert la veille dont le conteneur arrive dans deux mois doit finir par
--     le circuit où il a commencé, et une date de bascule l'en aurait privé.
--
--   * `P_BasculeReceptionGR` — le jour où la réception est devenue un arrivage.
--     Il ne garde rien (c'est la colonne qui décide), il le DIT : l'écran s'en
--     sert pour expliquer où se pèse désormais une livraison.
--
-- La devise de l'arrivage n'est PAS stockée ici : chaque ligne porte déjà la
-- sienne, prise à sa ligne de bon (`ligne_reception.code_devise`). Une colonne
-- d'en-tête ne pourrait que divergir des lignes ; l'API l'agrège à la lecture.
--
-- Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- --- Le dossier d'import rattaché à l'arrivage -------------------------------
ALTER TABLE reception
  ADD COLUMN IF NOT EXISTS id_dossier_import text;

ALTER TABLE reception DROP CONSTRAINT IF EXISTS fk_reception_dossier_import;
ALTER TABLE reception
  ADD CONSTRAINT fk_reception_dossier_import
  FOREIGN KEY (id_dossier_import) REFERENCES import_dossiers(id_dossier);

CREATE INDEX IF NOT EXISTS ix_reception_dossier_import
    ON reception(id_dossier_import) WHERE id_dossier_import IS NOT NULL;

COMMENT ON COLUMN reception.id_dossier_import IS
  'Dossier d''import de cet arrivage (DUM, conteneurs, régime). ADR-003 D2 : '
  'il se rattache, il ne remplace pas le bon de commande — le prix de chaque '
  'ligne vient de sa ligne de bon.';

-- --- L'invariant est en base (ADR-001 D-04) ---------------------------------
-- Un arrivage ne se rattache pas à un dossier CLOS (sa valeur est déjà portée
-- au CUMP), et son rattachement ne change plus une fois la marchandise entrée
-- en stock : les frais du dossier se répartiront sur ces lignes-là.
CREATE OR REPLACE FUNCTION fn_trg_reception_dossier() RETURNS trigger AS $$
DECLARE
    v_statut  text;
    v_numero  text;
BEGIN
    -- OLD n'existe pas a l'INSERT : ne jamais le lire hors du UPDATE, sinon
    -- plpgsql leve « record old is not assigned yet » et toute creation de
    -- reception tombe en erreur interne.
    IF TG_OP = 'UPDATE' AND NEW.id_dossier_import IS DISTINCT FROM OLD.id_dossier_import
       AND OLD.statut IN ('VALIDE', 'CLOTURE') THEN
        RAISE EXCEPTION 'La reception % est % : son dossier d''import ne change plus (les frais se repartissent sur ces lignes).',
            OLD.numero_reception, OLD.statut USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.id_dossier_import IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.id_dossier_import IS DISTINCT FROM OLD.id_dossier_import) THEN
        SELECT statut, numero INTO v_statut, v_numero
          FROM import_dossiers WHERE id_dossier = NEW.id_dossier_import;
        IF v_statut = 'CLOTURE' THEN
            RAISE EXCEPTION 'Le dossier d''import % est clos : sa valeur est deja portee au CUMP, on ne peut plus y rattacher un arrivage.',
                v_numero USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reception_dossier ON reception;
CREATE TRIGGER trg_reception_dossier
    BEFORE INSERT OR UPDATE OF id_dossier_import, statut ON reception
    FOR EACH ROW EXECUTE FUNCTION fn_trg_reception_dossier();

-- --- Le bon né d'un arrivage sans commande ----------------------------------
-- ADR-003 D2 : plus de réception « hors commande ». Quand le camion apporte ce
-- que personne n'a commandé, on ne refuse pas la marchandise — elle est au
-- quai — et on ne la fait pas entrer sans engagement : on crée le bon qui
-- manque, en BROUILLON, et la réception ne se VALIDERA qu'une fois ce bon
-- régularisé. Ce bon dit maintenant DE QUEL ARRIVAGE il est né : l'acheteur le
-- retrouve, et le service y rattache les lignes suivantes du même camion au
-- lieu d'ouvrir un bon par ligne.
ALTER TABLE bon_commande
  ADD COLUMN IF NOT EXISTS id_reception_regularisee text;

ALTER TABLE bon_commande DROP CONSTRAINT IF EXISTS fk_bc_reception_regularisee;
ALTER TABLE bon_commande
  ADD CONSTRAINT fk_bc_reception_regularisee
  FOREIGN KEY (id_reception_regularisee) REFERENCES reception(id_reception);

CREATE INDEX IF NOT EXISTS ix_bc_reception_regularisee
    ON bon_commande(id_reception_regularisee) WHERE id_reception_regularisee IS NOT NULL;

COMMENT ON COLUMN bon_commande.id_reception_regularisee IS
  'Arrivage qui a fait naître ce bon (marchandise arrivée sans commande). '
  'ADR-003 D2 : un seul bon de régularisation par arrivage.';

-- --- Le jour de la bascule --------------------------------------------------
-- POSE EN PREMIER, et une seule fois (`ON CONFLICT DO NOTHING`) : c'est lui qui
-- FIXE la date, et la reprise ci-dessous s'y adosse. Rejouée un autre jour, une
-- reprise qui aurait comparé à `current_date` aurait rangé du mauvais côté de la
-- bascule les dossiers nés depuis.
-- Verrouillé : c'est un fait historique, pas un réglage. Il n'interdit rien —
-- c'est `circuit_reception` qui décide — il explique.
INSERT INTO parametre
    (code_parametre, libelle, valeur_courante, type_donnee, unite,
     categorie, modifiable_par, verrouille, description)
VALUES
    ('P_BasculeReceptionGR', 'Jour de la bascule vers la réception unifiée',
     to_char(current_date, 'YYYY-MM-DD'), 'DATE', NULL,
     'SYSTEME', 'AUCUN', 1,
     'ADR-003 phase A. Le jour où la réception est devenue un arrivage : ses '
     'LIGNES se rattachent chacune à une ligne de bon de commande, un bon ou '
     'plusieurs. L''import garde son circuit (circuit_reception = FACTURE) '
     'jusqu''à la phase C, qui apprendra aux frais à lire les arrivages.')
ON CONFLICT (code_parametre) DO NOTHING;

-- --- Par quel circuit un dossier d'import reçoit sa marchandise -------------
-- `FACTURE` pour tout le monde aujourd'hui : la chaîne des frais d'import ne
-- sait lire que ce circuit, et la phase C posera `BON` par défaut quand elle
-- saura lire les arrivages. La colonne existe dès maintenant parce que c'est
-- elle qui gardera la frontière, dossier par dossier, le jour de la bascule.
ALTER TABLE import_dossiers
  ADD COLUMN IF NOT EXISTS circuit_reception text NOT NULL DEFAULT 'FACTURE';

ALTER TABLE import_dossiers DROP CONSTRAINT IF EXISTS ck_import_dossiers_circuit;
ALTER TABLE import_dossiers ADD CONSTRAINT ck_import_dossiers_circuit
    CHECK (circuit_reception IN ('BON', 'FACTURE'));

COMMENT ON COLUMN import_dossiers.circuit_reception IS
  'ADR-003. FACTURE (le défaut aujourd''hui) : le dossier reçoit par ses lignes '
  'de facture, seul circuit que la chaîne des frais sait lire. BON : la '
  'marchandise se pèse dans la réception unifiée, contre les lignes du bon de '
  'commande — posé par défaut en phase C, quand les frais sauront lire les '
  'arrivages.';

-- --- Les colonnes nouvelles se déclarent, sinon elles sont invisibles --------
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'RECEPTIONS', c.champ, c.libelle, 'LECTURE', 0, c.ordre
  FROM (VALUES ('dossier_numero', 'Dossier d''import', 36),
               ('numero_dum',     'Numéro de DUM',     37),
               ('conteneurs',     'Conteneurs',        38)) c(champ, libelle, ordre)
ON CONFLICT DO NOTHING;

COMMIT;
