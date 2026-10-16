-- =============================================================================
-- 2026-10-14d — ADR-003 phase B : la FACTURE FOURNISSEUR devient un document
-- =============================================================================
-- Jusqu'ici la facture n'existait pas : elle était un FORMULAIRE accroché à une
-- réception (« clôturer avec sa facture »), qui portait un numéro, un montant
-- et des frais. Le moteur de valorisation, lui, était déjà bon — il couvre
-- plusieurs réceptions, répartit, porte au stock présent et trace l'écart de
-- prix. Ce qui manquait, c'est le document : un brouillon qu'on relit, des
-- LIGNES, et un rapprochement ligne par ligne.
--
--   * `facture_fournisseur` — en-tête : numéro, fournisseur, date, devise, taux
--     (figé, contrôlé contre le cours BAM), montant imprimé, frais portés par la
--     facture, dossier d'import éventuel, statut `BROUILLON → VALIDEE`.
--
--   * `ligne_facture_fournisseur` — chaque ligne **pege à une ligne de
--     réception**. Par elle on remonte à la ligne de bon (le prix ENGAGÉ) et à
--     l'arrivage (les kilos PESÉS) : c'est ce chemin qui rend le rapprochement
--     3-way possible, et c'est le même geste qu'en phase A — le peg est porté
--     par la ligne, jamais par l'en-tête. Une facture couvre donc plusieurs
--     réceptions ET plusieurs bons de commande (décision du 14/10 : c'est rare,
--     mais réel), sans que rien n'ait à le déclarer.
--
--   * `v_facture_rapprochement` — le 3-way, par ligne : facturé / pesé /
--     engagé, et les deux écarts. Ils se LISENT avant de signer ; ils ne
--     bloquent pas (un écart peut être réel), sauf la double facturation.
--
-- LES INVARIANTS SONT EN BASE (ADR-001 D-04) :
--   * une ligne ne facture qu'une réception VALIDÉE, du fournisseur et de la
--     devise de la facture ;
--   * une même ligne de réception n'est facturée qu'une fois par une facture
--     vivante — la double facturation est la seule chose qui se refuse sec ;
--   * validée, la facture est figée : ses montants ont bougé un CUMP.
--
-- L'ancienne saisie reste en place : c'est le MÊME moteur, et la couper d'un
-- coup ferait tomber la valorisation qui marche aujourd'hui.
--
-- Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS facture_fournisseur (
    id_facture          text NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    numero_facture      text NOT NULL CHECK (btrim(numero_facture) <> ''),
    code_fournisseur    text NOT NULL REFERENCES fournisseur(code_fournisseur),
    date_facture        text NOT NULL,
    code_devise         text NOT NULL REFERENCES devise(code_devise),
    taux_change         numeric(9,4) NOT NULL CHECK (taux_change > 0),
    -- Le total IMPRIMÉ sur le papier : il contrôle la saisie des lignes, il ne
    -- la remplace pas. L'écart entre les deux est un signal, pas un refus.
    montant_devise      numeric(18,2) CHECK (montant_devise IS NULL OR montant_devise >= 0),
    -- CE QUE LA FACTURE PORTE EN PLUS DE LA MARCHANDISE (transport refacturé
    -- par le fournisseur). Les frais payés à part — fret, douane, transitaire —
    -- vivent sur l'arrivage, avec leur clé (phase C).
    frais_devise        numeric(18,2) NOT NULL DEFAULT 0 CHECK (frais_devise >= 0),
    -- Règle 3 (09/10) : des kilos ont été rendus. La facture NETTE ne les porte
    -- pas (ils sont soldés) ; la BRUTE les porte, un avoir suivra. NULL : aucun
    -- retour en jeu.
    facture_nette       smallint CHECK (facture_nette IS NULL OR facture_nette IN (0, 1)),
    id_dossier_import   text REFERENCES import_dossiers(id_dossier),
    statut              text NOT NULL DEFAULT 'BROUILLON'
                             CHECK (statut IN ('BROUILLON', 'VALIDEE', 'ANNULEE')),
    notes               text,
    id_utilisateur_creation text NOT NULL REFERENCES utilisateur(id_utilisateur),
    date_creation       text NOT NULL
        DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_utilisateur_validation text REFERENCES utilisateur(id_utilisateur),
    date_validation     text,
    -- La même facture ne se saisit pas deux fois chez le même fournisseur.
    UNIQUE (code_fournisseur, numero_facture),
    CHECK (statut <> 'VALIDEE'
           OR (id_utilisateur_validation IS NOT NULL AND date_validation IS NOT NULL))
);
ALTER TABLE facture_fournisseur OWNER TO gestionfil;

CREATE INDEX IF NOT EXISTS ix_facture_fournisseur_frs
    ON facture_fournisseur(code_fournisseur, date_facture DESC);
CREATE INDEX IF NOT EXISTS ix_facture_fournisseur_statut
    ON facture_fournisseur(statut, date_facture DESC);
CREATE INDEX IF NOT EXISTS ix_facture_fournisseur_dossier
    ON facture_fournisseur(id_dossier_import) WHERE id_dossier_import IS NOT NULL;

CREATE TABLE IF NOT EXISTS ligne_facture_fournisseur (
    id_ligne            text NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    id_facture          text NOT NULL
        REFERENCES facture_fournisseur(id_facture) ON DELETE CASCADE,
    ligne_numero        bigint NOT NULL CHECK (ligne_numero > 0),
    -- LE PEG : la ligne de réception que cette ligne facture. Tout le
    -- rapprochement passe par lui.
    id_ligne_reception  text NOT NULL REFERENCES ligne_reception(id_ligne_reception),
    quantite_facturee_kg numeric(18,4) NOT NULL CHECK (quantite_facturee_kg > 0),
    prix_kg_devise      numeric(18,4) NOT NULL CHECK (prix_kg_devise > 0),
    remise_pct          numeric(5,2) NOT NULL DEFAULT 0
                             CHECK (remise_pct >= 0 AND remise_pct < 100),
    -- NET DE REMISE : c'est lui qui valorise, comme à l'import (2026-09-26c).
    montant_devise      numeric(18,2) GENERATED ALWAYS AS
        (round(quantite_facturee_kg * prix_kg_devise * (1 - remise_pct / 100), 2)) STORED,
    notes               text,
    UNIQUE (id_facture, ligne_numero),
    -- Deux lignes de la même facture pour la même pesée : c'est une faute de
    -- saisie, pas un cas métier.
    UNIQUE (id_facture, id_ligne_reception)
);
ALTER TABLE ligne_facture_fournisseur OWNER TO gestionfil;

CREATE INDEX IF NOT EXISTS ix_lfrs_facture ON ligne_facture_fournisseur(id_facture);
CREATE INDEX IF NOT EXISTS ix_lfrs_ligne_reception
    ON ligne_facture_fournisseur(id_ligne_reception);

-- =============================================================================
-- Les invariants
-- =============================================================================

-- Une ligne ne facture qu'une pesée VALIDÉE, du fournisseur et de la devise de
-- la facture — et une seule fois.
CREATE OR REPLACE FUNCTION fn_trg_lfrs_coherente() RETURNS trigger AS $$
DECLARE
    v_statut    text;
    v_frs_rec   text;
    v_devise    text;
    v_numero    text;
    v_frs_fac   text;
    v_dev_fac   text;
    v_autre     text;
BEGIN
    SELECT r.statut, r.code_fournisseur, lr.code_devise, r.numero_reception
      INTO v_statut, v_frs_rec, v_devise, v_numero
      FROM ligne_reception lr
      JOIN reception r ON r.id_reception = lr.id_reception
     WHERE lr.id_ligne_reception = NEW.id_ligne_reception;

    SELECT code_fournisseur, code_devise INTO v_frs_fac, v_dev_fac
      FROM facture_fournisseur WHERE id_facture = NEW.id_facture;

    IF v_statut NOT IN ('VALIDE', 'CLOTURE') THEN
        RAISE EXCEPTION 'FACTURE-PESEE : la reception % est % : une facture ne porte que des pesees validees, dont les poids ne bougent plus.',
            v_numero, v_statut USING ERRCODE = 'check_violation';
    END IF;
    IF v_frs_rec IS DISTINCT FROM v_frs_fac THEN
        RAISE EXCEPTION 'FACTURE-FOURNISSEUR : la reception % vient de %, la facture de % : une facture ne couvre que les receptions de son fournisseur.',
            v_numero, v_frs_rec, v_frs_fac USING ERRCODE = 'check_violation';
    END IF;
    IF v_devise IS DISTINCT FROM v_dev_fac THEN
        RAISE EXCEPTION 'FACTURE-DEVISE : cette ligne de reception est en %, la facture en % : une facture ne couvre qu''une devise.',
            v_devise, v_dev_fac USING ERRCODE = 'check_violation';
    END IF;

    -- LA DOUBLE FACTURATION SE REFUSE SEC : c'est le seul ecart qu'on ne peut
    -- pas « signaler ». Payer deux fois la meme pesee se voit au bilan, jamais
    -- au quai.
    SELECT f.numero_facture INTO v_autre
      FROM ligne_facture_fournisseur l
      JOIN facture_fournisseur f ON f.id_facture = l.id_facture
     WHERE l.id_ligne_reception = NEW.id_ligne_reception
       AND l.id_facture <> NEW.id_facture
       AND f.statut <> 'ANNULEE'
     LIMIT 1;
    IF v_autre IS NOT NULL THEN
        RAISE EXCEPTION 'FACTURE-DOUBLE : cette pesee de la reception % est deja facturee par % : une meme marchandise ne se facture pas deux fois.',
            v_numero, v_autre USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lfrs_coherente() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_lfrs_coherente ON ligne_facture_fournisseur;
CREATE TRIGGER trg_lfrs_coherente
    BEFORE INSERT OR UPDATE OF id_ligne_reception, id_facture ON ligne_facture_fournisseur
    FOR EACH ROW EXECUTE FUNCTION fn_trg_lfrs_coherente();

-- Validée, la facture est figée : ses montants ont bougé un CUMP. Une
-- correction passe par un avoir ou une facture complémentaire sur la réception
-- (règle 8), journalisés — pas par une réécriture.
CREATE OR REPLACE FUNCTION fn_trg_facture_frs_figee() RETURNS trigger AS $$
BEGIN
    IF TG_TABLE_NAME = 'facture_fournisseur' THEN
        IF OLD.statut = 'VALIDEE'
           AND (NEW.numero_facture, NEW.code_fournisseur, NEW.date_facture, NEW.code_devise,
                NEW.taux_change, NEW.montant_devise, NEW.frais_devise, NEW.facture_nette)
               IS DISTINCT FROM
               (OLD.numero_facture, OLD.code_fournisseur, OLD.date_facture, OLD.code_devise,
                OLD.taux_change, OLD.montant_devise, OLD.frais_devise, OLD.facture_nette) THEN
            RAISE EXCEPTION 'FACTURE-FIGEE : la facture % est validee : elle a bouge un CUMP. Corrigez par un avoir ou une facture complementaire sur la reception.',
                OLD.numero_facture USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_facture_frs_figee() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_facture_frs_figee ON facture_fournisseur;
CREATE TRIGGER trg_facture_frs_figee BEFORE UPDATE ON facture_fournisseur
    FOR EACH ROW EXECUTE FUNCTION fn_trg_facture_frs_figee();

-- Les lignes d'une facture validée ne bougent plus non plus.
CREATE OR REPLACE FUNCTION fn_trg_lfrs_figee() RETURNS trigger AS $$
DECLARE
    v_statut text;
    v_numero text;
BEGIN
    SELECT statut, numero_facture INTO v_statut, v_numero
      FROM facture_fournisseur
     WHERE id_facture = CASE WHEN TG_OP = 'DELETE' THEN OLD.id_facture ELSE NEW.id_facture END;
    IF v_statut = 'VALIDEE' THEN
        RAISE EXCEPTION 'FACTURE-FIGEE : la facture % est validee : ses lignes ne bougent plus.',
            v_numero USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lfrs_figee() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_lfrs_figee ON ligne_facture_fournisseur;
CREATE TRIGGER trg_lfrs_figee
    BEFORE INSERT OR UPDATE OR DELETE ON ligne_facture_fournisseur
    FOR EACH ROW EXECUTE FUNCTION fn_trg_lfrs_figee();

-- Le journal d'audit, comme toute table qui porte de l'argent.
DROP TRIGGER IF EXISTS trg_audit_modification ON facture_fournisseur;
CREATE TRIGGER trg_audit_modification
    AFTER INSERT OR UPDATE OR DELETE ON facture_fournisseur
    FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();
DROP TRIGGER IF EXISTS trg_audit_modification ON ligne_facture_fournisseur;
CREATE TRIGGER trg_audit_modification
    AFTER INSERT OR UPDATE OR DELETE ON ligne_facture_fournisseur
    FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();

-- =============================================================================
-- LE RAPPROCHEMENT 3-WAY, par ligne : facturé / pesé / engagé
-- =============================================================================
CREATE OR REPLACE VIEW v_facture_rapprochement AS
SELECT l.id_ligne, l.id_facture, l.ligne_numero, l.id_ligne_reception,
       f.numero_facture, f.code_devise, f.taux_change, f.statut,
       r.id_reception, r.numero_reception, r.date_reception,
       lr.code_reference, lr.designation,
       bc.numero_bc, lb.id_ligne_bc,
       -- CE QUE LA FACTURE DIT
       l.quantite_facturee_kg, l.prix_kg_devise, l.remise_pct, l.montant_devise,
       round(l.montant_devise * f.taux_change, 2)                       AS montant_mad,
       -- CE QU'ON A PESÉ
       lr.quantite_stock_kg                                             AS quantite_pesee_kg,
       -- CE QU'ON AVAIT ENGAGÉ (le prix du bon, dans la devise du bon)
       lb.prix_kg_devise                                                AS prix_engage_devise,
       -- LES DEUX ÉCARTS, et les confondre serait une faute d'analyse :
       --   la quantité met en cause la livraison ou la facture ;
       --   le prix met en cause la négociation ou la saisie.
       round(l.quantite_facturee_kg - lr.quantite_stock_kg, 4)          AS ecart_quantite_kg,
       round(l.prix_kg_devise - lb.prix_kg_devise, 4)                   AS ecart_prix_devise,
       CASE WHEN lb.prix_kg_devise > 0
            THEN round((l.prix_kg_devise - lb.prix_kg_devise) * 100 / lb.prix_kg_devise, 2)
       END                                                              AS ecart_prix_pct,
       -- La valeur provisoire de cette pesée : ce que la validation a fait
       -- entrer, au prix du bon. C'est contre elle que le CUMP bougera.
       round(lr.quantite_stock_kg * lr.prix_kg_mad, 2)                  AS provisoire_mad
  FROM ligne_facture_fournisseur l
  JOIN facture_fournisseur f ON f.id_facture = l.id_facture
  JOIN ligne_reception lr ON lr.id_ligne_reception = l.id_ligne_reception
  JOIN reception r ON r.id_reception = lr.id_reception
  LEFT JOIN ligne_bc lb ON lb.id_ligne_bc = lr.id_ligne_bc
  LEFT JOIN bon_commande bc ON bc.id_bc = lb.id_bc;
ALTER VIEW v_facture_rapprochement OWNER TO gestionfil;

-- =============================================================================
-- Les colonnes se déclarent, sinon elles n'apparaissent dans aucun écran
-- =============================================================================
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'RECEPTIONS', c.champ, c.libelle, 'LECTURE', c.sensible, c.ordre
  FROM (VALUES ('date_facture',         'Date de la facture',       0, 1010),
               ('quantite_facturee_kg', 'Quantité facturée (kg)',   0, 1020),
               ('ecart_quantite_kg',    'Écart de quantité (kg)',   0, 1030),
               ('prix_engage_devise',   'Prix engagé (devise/kg)',  1, 1040),
               ('ecart_prix_devise',    'Écart de prix (devise)',   1, 1050),
               ('ecart_prix_pct',       'Écart de prix (%)',        1, 1060),
               ('provisoire_mad',       'Valeur provisoire (MAD)',  1, 1070),
               ('montant_mad',          'Montant (MAD)',            1, 1080))
       c(champ, libelle, sensible, ordre)
ON CONFLICT DO NOTHING;

-- Les trois colonnes de prix sont des montants : masquées à qui ne voit pas la
-- valeur du stock, comme les autres (grille des champs, règle 14 du 08/10).
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, 'RECEPTIONS', c.champ,
       CASE WHEN r.code_role_user = 'MAGASIN' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM (SELECT DISTINCT code_role_user FROM modele_droit_champ) r
 CROSS JOIN (VALUES ('prix_engage_devise'), ('ecart_prix_devise'),
                    ('ecart_prix_pct'), ('provisoire_mad'), ('montant_mad')) c(champ)
ON CONFLICT DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'RECEPTIONS' AND m.niveau = 'MASQUE'
   AND m.champ IN ('prix_engage_devise', 'ecart_prix_devise', 'ecart_prix_pct',
                   'provisoire_mad', 'montant_mad')
   AND NOT EXISTS (SELECT 1 FROM droit_champ d
                    WHERE d.id_utilisateur = u.id_utilisateur
                      AND d.module = m.module AND d.champ = m.champ);

COMMIT;
