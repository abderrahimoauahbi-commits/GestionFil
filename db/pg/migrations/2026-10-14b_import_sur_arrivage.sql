-- =============================================================================
-- 2026-10-14b — ADR-003 phase C (1/2) : l'import se reçoit par l'ARRIVAGE
-- =============================================================================
-- La phase A a fait de la réception un arrivage dont chaque ligne pege à une
-- ligne de bon de commande. L'import, lui, recevait encore contre ses lignes de
-- FACTURE — et il le devait : toute sa chaîne de frais (clôture du dossier,
-- répartition, CUMP définitif) lit ses kilos reçus dans
-- `import_facture_lignes.quantite_recue_kg`, que seul ce circuit alimentait.
-- Basculer l'import avant elle aurait empêché tout dossier neuf de se clôturer.
--
-- Cette migration apprend à la chaîne à lire les arrivages, et bascule :
--
--   * L'ÉTANCHÉITÉ DEVIENT CONDITIONNELLE AU CIRCUIT. Les deux déclencheurs du
--     08/10 interdisaient à une ligne de bon servie par un dossier d'être reçue
--     en réception locale, et réciproquement. C'était juste quand l'import avait
--     son propre circuit ; pour un dossier en `BON`, la réception unifiée est
--     justement la bonne porte. Le garde ne vise donc plus que les dossiers en
--     `FACTURE` — et il garde toute sa force pour eux : une même marchandise
--     n'entre jamais par deux portes.
--
--   * `circuit_reception` PASSE À `BON` PAR DÉFAUT. Les dossiers déjà en base
--     gardent `FACTURE` : leur marchandise est en route, leurs factures portent
--     déjà des kilos reçus, et leur valorisation ne doit pas changer de pied en
--     cours de route. Ils finiront par l'écran qui les a vus naître.
--
-- Côté service, `importation::synchroniser_recu_arrivages` recalcule les kilos
-- reçus d'un dossier en `BON` depuis ses arrivages validés — à la validation
-- d'un arrivage et au seuil de la clôture. Un RECALCUL, pas un incrément : la
-- facture arrive souvent après le camion, et un compteur incrémental aurait
-- raté les kilos entrés avant qu'elle soit saisie.
--
-- Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- --- L'étanchéité, dans les deux sens, mais seulement pour le circuit FACTURE
CREATE OR REPLACE FUNCTION fn_trg_reception_locale_hors_import() RETURNS trigger AS $$
DECLARE v_dossier text;
BEGIN
    IF NEW.id_ligne_bc IS NOT NULL THEN
        SELECT d.numero INTO v_dossier
          FROM import_facture_lignes fl
          JOIN import_factures f ON f.id_facture = fl.id_facture
          JOIN import_dossiers d ON d.id_dossier = f.id_dossier
         WHERE fl.id_ligne_bc = NEW.id_ligne_bc
           -- ADR-003 phase C : un dossier en BON se recoit ICI, c'est sa porte.
           AND d.circuit_reception = 'FACTURE'
         LIMIT 1;
        IF v_dossier IS NOT NULL THEN
            RAISE EXCEPTION 'ETANCHEITE : cette ligne de bon (%) est servie par le dossier d''import % : elle se recoit par la reception d''import, pas en reception locale.',
                NEW.code_reference, v_dossier USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_reception_locale_hors_import() OWNER TO gestionfil;

CREATE OR REPLACE FUNCTION fn_trg_import_hors_reception_locale() RETURNS trigger AS $$
DECLARE
    v_reception text;
    v_circuit   text;
BEGIN
    IF NEW.id_ligne_bc IS NOT NULL THEN
        SELECT d.circuit_reception INTO v_circuit
          FROM import_factures f
          JOIN import_dossiers d ON d.id_dossier = f.id_dossier
         WHERE f.id_facture = NEW.id_facture;
        -- Pour un dossier en BON, rattacher une ligne de facture a un bon DEJA
        -- recu est le cas ORDINAIRE : la facture arrive apres le camion.
        IF v_circuit = 'FACTURE' THEN
            SELECT r.numero_reception INTO v_reception
              FROM ligne_reception lr JOIN reception r ON r.id_reception = lr.id_reception
             WHERE lr.id_ligne_bc = NEW.id_ligne_bc AND r.statut <> 'ANNULE'
             LIMIT 1;
            IF v_reception IS NOT NULL THEN
                RAISE EXCEPTION 'ETANCHEITE : cette ligne de bon est deja recue en reception locale (%) : elle ne se rattache pas a un dossier d''import.',
                    v_reception USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_import_hors_reception_locale() OWNER TO gestionfil;

-- --- C45 ne voit plus une anomalie dans le cas devenu normal -----------------
-- « Ligne de bon recue a la fois en local et a l'import » (08/10) : c'etait une
-- anomalie quand l'import avait son propre circuit. Pour un dossier en `BON`,
-- la ligne de facture DOIT viser le bon que l'arrivage a recu — c'est le
-- chainon qui relie les frais a la marchandise. Le controle ne garde donc que
-- les dossiers restes en `FACTURE`, ou le double circuit reste une faute.
CREATE OR REPLACE VIEW v_ctl_c45 AS
SELECT bc.numero_bc, lb.code_reference, lb.id_ligne_bc
  FROM ligne_bc lb
  JOIN bon_commande bc ON bc.id_bc = lb.id_bc
 WHERE EXISTS (SELECT 1
                 FROM import_facture_lignes fl
                 JOIN import_factures f ON f.id_facture = fl.id_facture
                 JOIN import_dossiers d ON d.id_dossier = f.id_dossier
                WHERE fl.id_ligne_bc = lb.id_ligne_bc
                  AND d.circuit_reception = 'FACTURE')
   AND EXISTS (SELECT 1 FROM ligne_reception lr JOIN reception r ON r.id_reception = lr.id_reception
                WHERE lr.id_ligne_bc = lb.id_ligne_bc AND r.statut <> 'ANNULE');
ALTER VIEW v_ctl_c45 OWNER TO gestionfil;

-- --- La bascule ---------------------------------------------------------------
-- Les dossiers DEJA LA gardent `FACTURE` (aucun UPDATE ici, et c'est le point) :
-- leur marchandise est en route et leurs factures portent deja des kilos recus.
ALTER TABLE import_dossiers ALTER COLUMN circuit_reception SET DEFAULT 'BON';

COMMIT;
