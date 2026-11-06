-- =============================================================================
-- 2026-11-06e — La fin de vie d'une reference ; l'audit de la fiche article
-- =============================================================================
-- Revue des 22 domaines (06/11/2026), arbitrages 3 et 7.
--
--   1. LA FIN DE VIE (`reference.fin_de_vie`, 0 / 1) : un etat distinct de
--      l'inactif. La reference reste active : on consomme son stock, ses
--      recettes et ses mouvements vivent. Mais on ne la rachete plus : le moteur
--      de couverture et le stock projete ne proposent plus rien pour elle, et
--      le plan d'achat ne la genere plus. Ce n'est JAMAIS un refus : un bon
--      reste saisissable (l'ecran le signale), et un manque avant la fin du plan
--      est signale (FIN_DE_VIE), pour decider de la remplacer.
--   2. L'AUDIT DE LA FICHE ARTICLE : `trg_audit_reference` ne suivait que le
--      prix catalogue, le fournisseur et l'etat actif. Le stock minimum, la
--      couverture cible, le MOQ, le multiple d'achat (la quantite Q du stock
--      projete), le conditionnement, le suivi de lot, la fin de vie changeaient
--      sans trace. Un second declencheur journalise les colonnes que l'ecran
--      modifie, sauf les trois deja suivies (pas de double ligne) ; la condition
--      WHEN ne porte que sur ces colonnes : le CMUP et les caches recalcules par
--      le systeme ne declenchent rien.
--
-- Rejouable. Enregistree par migrer.py. Exigee au demarrage (MIGRATIONS_REQUISES).
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 1. La fin de vie
-- -----------------------------------------------------------------------------
ALTER TABLE reference ADD COLUMN IF NOT EXISTS fin_de_vie bigint NOT NULL DEFAULT 0;
ALTER TABLE reference DROP CONSTRAINT IF EXISTS reference_fin_de_vie_check;
ALTER TABLE reference ADD CONSTRAINT reference_fin_de_vie_check CHECK (fin_de_vie IN (0, 1));
COMMENT ON COLUMN reference.fin_de_vie IS
  'Fin de vie (06/11/2026) : on consomme le stock, on ne rachete plus ; aucune proposition d''achat. Un signal, jamais un refus.';

-- Le champ de la fiche article, declare comme l'etat actif.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'CATALOGUE', 'fin_de_vie', 'Fin de vie', j.niveau_defaut, j.sensible, j.ordre + 1
  FROM champ_configurable j WHERE j.module = 'CATALOGUE' AND j.champ = 'actif'
ON CONFLICT (module, champ) DO NOTHING;
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, m.module, 'fin_de_vie', m.niveau
  FROM modele_droit_champ m WHERE m.module = 'CATALOGUE' AND m.champ = 'actif'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, d.module, 'fin_de_vie', d.niveau
  FROM droit_champ d WHERE d.module = 'CATALOGUE' AND d.champ = 'actif'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- Et a la saisie d'un bon (les references commandables passent par le masquage
-- du module BONS_COMMANDE) : l'avis « fin de vie » doit y arriver.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'BONS_COMMANDE', 'fin_de_vie', 'Fin de vie', j.niveau_defaut, j.sensible, j.ordre + 1
  FROM champ_configurable j WHERE j.module = 'BONS_COMMANDE' AND j.champ = 'code_reference'
ON CONFLICT (module, champ) DO NOTHING;
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, m.module, 'fin_de_vie', m.niveau
  FROM modele_droit_champ m WHERE m.module = 'BONS_COMMANDE' AND m.champ = 'code_reference'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, d.module, 'fin_de_vie', d.niveau
  FROM droit_champ d WHERE d.module = 'BONS_COMMANDE' AND d.champ = 'code_reference'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. L'audit de la fiche article : les colonnes que l'ecran modifie (crud.rs)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_modification ON reference;
CREATE TRIGGER trg_audit_modification
AFTER UPDATE ON reference FOR EACH ROW
WHEN (   OLD.code_categorie         IS DISTINCT FROM NEW.code_categorie
      OR OLD.designation            IS DISTINCT FROM NEW.designation
      OR OLD.type_fil               IS DISTINCT FROM NEW.type_fil
      OR OLD.couleur                IS DISTINCT FROM NEW.couleur
      OR OLD.origine                IS DISTINCT FROM NEW.origine
      OR OLD.titrage                IS DISTINCT FROM NEW.titrage
      OR OLD.code_famille           IS DISTINCT FROM NEW.code_famille
      OR OLD.code_couleur_interne   IS DISTINCT FROM NEW.code_couleur_interne
      OR OLD.code_couleur           IS DISTINCT FROM NEW.code_couleur
      OR OLD.reference_fournisseur  IS DISTINCT FROM NEW.reference_fournisseur
      OR OLD.supplement_teinture    IS DISTINCT FROM NEW.supplement_teinture
      OR OLD.unite_catalogue        IS DISTINCT FROM NEW.unite_catalogue
      OR OLD.code_conditionnement   IS DISTINCT FROM NEW.code_conditionnement
      OR OLD.poids_bobine_kg        IS DISTINCT FROM NEW.poids_bobine_kg
      OR OLD.bobines_par_palette    IS DISTINCT FROM NEW.bobines_par_palette
      OR OLD.bobines_par_lot        IS DISTINCT FROM NEW.bobines_par_lot
      OR OLD.seuil_lot_valeur       IS DISTINCT FROM NEW.seuil_lot_valeur
      OR OLD.type_lot               IS DISTINCT FROM NEW.type_lot
      OR OLD.fusion_lot             IS DISTINCT FROM NEW.fusion_lot
      OR OLD.arrondi_palette        IS DISTINCT FROM NEW.arrondi_palette
      OR OLD.mode_consommation      IS DISTINCT FROM NEW.mode_consommation
      OR OLD.densite_kg_ml          IS DISTINCT FROM NEW.densite_kg_ml
      OR OLD.description_commerciale IS DISTINCT FROM NEW.description_commerciale
      OR OLD.code_devise_catalogue  IS DISTINCT FROM NEW.code_devise_catalogue
      OR OLD.date_prix_catalogue    IS DISTINCT FROM NEW.date_prix_catalogue
      OR OLD.stock_min_kg           IS DISTINCT FROM NEW.stock_min_kg
      OR OLD.couverture_cible_mois  IS DISTINCT FROM NEW.couverture_cible_mois
      OR OLD.moq_kg                 IS DISTINCT FROM NEW.moq_kg
      OR OLD.multiple_achat_kg      IS DISTINCT FROM NEW.multiple_achat_kg
      OR OLD.suivi_lot              IS DISTINCT FROM NEW.suivi_lot
      OR OLD.code_sh                IS DISTINCT FROM NEW.code_sh
      OR OLD.fin_de_vie             IS DISTINCT FROM NEW.fin_de_vie)
EXECUTE FUNCTION fn_trg_audit_modification('version', 'prix_catalogue', 'code_fournisseur', 'actif');

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'reference' AND column_name = 'fin_de_vie') THEN
        RAISE EXCEPTION '2026-11-06e : reference.fin_de_vie absente.';
    END IF;
END $$;

COMMIT;
