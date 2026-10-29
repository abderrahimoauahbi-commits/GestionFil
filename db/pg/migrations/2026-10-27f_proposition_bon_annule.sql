-- =============================================================================
-- 2026-10-27f — La proposition d'achat se clôt avec son bon annulé
-- =============================================================================
-- DÉCISION DU 27/10/2026 (« close avec le bon »). « Commander » crée un bon de
-- commande depuis une proposition du plan d'achat ; la proposition passe alors
-- à COMMANDE et la ligne du bon la désigne (`ligne_bc.id_proposition`).
--
-- Jusqu'ici, ANNULER ce bon remettait la proposition à PROPOSE (et effaçait
-- `id_bc_genere`) : elle redevenait « ouverte » alors que la ligne du bon annulé
-- la désignait toujours. La régénération suivante (`domain/plan_achat.rs`,
-- `generer`), qui purge les propositions PROPOSE non figées, butait sur la clé
-- `fk_ligne_bc_id_proposition` et échouait en 400.
--
-- RÈGLE : quand son bon est annulé, la proposition passe au statut
-- « Annulée avec le bon » (ANNULE_BC) :
--   * elle reste liée au bon annulé (`id_bc_genere`, et la ligne du bon qui la
--     désigne) — l'historique est intact ;
--   * elle n'est plus OUVERTE : ni purgée par la régénération, ni comptée dans
--     les indicateurs, ni concernée par l'index `ux_plan_achat_ouvert` (qui ne
--     vise que PROPOSE, EN_REVISION, VALIDE) ;
--   * la régénération suivante crée une proposition NEUVE si le moteur de
--     couverture en propose une ;
--   * c'est un état final : la base refuse d'en sortir (PA-ANNULE-BC) et de la
--     figer (comme COMMANDE et IGNORE).
--
-- REPRISE : les propositions déjà remises à PROPOSE par l'ancienne annulation
-- (ouvertes, non figées, non arbitrées — celles que la purge tente d'effacer — et
-- désignées par une ligne d'un bon ANNULÉ, sans ligne d'un bon encore actif)
-- passent à ANNULE_BC, rattachées au dernier bon annulé qui les désigne.
--
-- Rejouable. Enregistrée par migrer.py. Exigée au démarrage (backend/src/db.rs).
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- -----------------------------------------------------------------------------
-- Le statut
-- -----------------------------------------------------------------------------
ALTER TABLE plan_achat DROP CONSTRAINT IF EXISTS plan_achat_statut_check;
ALTER TABLE plan_achat ADD CONSTRAINT plan_achat_statut_check
    CHECK (statut IN ('PROPOSE','EN_REVISION','VALIDE','COMMANDE','IGNORE','ANNULE_BC'));

COMMENT ON COLUMN plan_achat.statut IS
    'PROPOSE, EN_REVISION, VALIDE (ouvertes) ; COMMANDE (sur un bon) ; IGNORE (écartée) ; ANNULE_BC (annulée avec son bon, liée à lui, état final — décision du 27/10/2026).';

-- -----------------------------------------------------------------------------
-- Une proposition close ne se fige pas
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_plan_achat_figement_statut ON plan_achat;
CREATE TRIGGER trg_plan_achat_figement_statut
BEFORE UPDATE OF figee ON plan_achat FOR EACH ROW
WHEN (NEW.figee = 1 AND NEW.statut IN ('COMMANDE','IGNORE','ANNULE_BC'))
EXECUTE FUNCTION fn_refuser('Figement refuse : cette proposition est deja commandee, ecartee ou annulee avec son bon.');

-- -----------------------------------------------------------------------------
-- ANNULE_BC est un état final (PA-ANNULE-BC)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_plan_achat_annule_bc_final ON plan_achat;
CREATE TRIGGER trg_plan_achat_annule_bc_final
BEFORE UPDATE OF statut ON plan_achat FOR EACH ROW
WHEN (OLD.statut = 'ANNULE_BC' AND NEW.statut IS DISTINCT FROM 'ANNULE_BC')
EXECUTE FUNCTION fn_refuser('PA-ANNULE-BC : cette proposition a ete annulee avec son bon ; elle reste a l''historique. Regenerez le plan d''achat : le moteur en proposera une neuve s''il le faut.');

-- -----------------------------------------------------------------------------
-- Reprise : les propositions rouvertes par l'ancienne annulation
-- -----------------------------------------------------------------------------
UPDATE plan_achat pa
   SET statut = 'ANNULE_BC',
       id_bc_genere = (SELECT l.id_bc
                         FROM ligne_bc l
                         JOIN bon_commande b ON b.id_bc = l.id_bc
                        WHERE l.id_proposition = pa.id_proposition AND b.statut = 'ANNULE'
                        ORDER BY b.date_bc DESC, l.id_bc DESC
                        LIMIT 1)
 WHERE pa.statut IN ('PROPOSE','EN_REVISION','VALIDE')
   AND pa.figee = 0
   AND pa.code_reference_origine IS NULL
   AND EXISTS (SELECT 1 FROM ligne_bc l JOIN bon_commande b ON b.id_bc = l.id_bc
                WHERE l.id_proposition = pa.id_proposition AND b.statut = 'ANNULE')
   AND NOT EXISTS (SELECT 1 FROM ligne_bc l JOIN bon_commande b ON b.id_bc = l.id_bc
                    WHERE l.id_proposition = pa.id_proposition AND b.statut <> 'ANNULE');

-- -----------------------------------------------------------------------------
-- Témoin
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'plan_achat_statut_check'
                      AND pg_get_constraintdef(oid) LIKE '%ANNULE_BC%')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_plan_achat_annule_bc_final')
       OR EXISTS (SELECT 1 FROM plan_achat pa
                   WHERE pa.statut IN ('PROPOSE','EN_REVISION','VALIDE')
                     AND pa.figee = 0 AND pa.code_reference_origine IS NULL
                     AND EXISTS (SELECT 1 FROM ligne_bc l JOIN bon_commande b ON b.id_bc = l.id_bc
                                  WHERE l.id_proposition = pa.id_proposition AND b.statut = 'ANNULE')
                     AND NOT EXISTS (SELECT 1 FROM ligne_bc l JOIN bon_commande b ON b.id_bc = l.id_bc
                                      WHERE l.id_proposition = pa.id_proposition AND b.statut <> 'ANNULE')) THEN
        RAISE EXCEPTION '2026-10-27f : migration incomplete';
    END IF;
END $$;

COMMIT;
