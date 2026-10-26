-- =============================================================================
-- 2026-10-24c — Une ligne de facture d'import REÇUE est figée tout entière
-- =============================================================================
-- DÉCISION DE L'UTILISATEUR (recommandations validées le 24/10/2026).
--
-- CE QUI EXISTAIT. `trg_import_ligne_figee` (2026-10-08f) refusait, sur une ligne
-- déjà reçue (quantite_recue_kg > 0), de changer la référence, le type, l'unité,
-- la quantité, le poids net, le prix, la remise et la ligne de bon. Il laissait
-- passer le lot, le code et le libellé de la couleur, les bobines, les palettes et
-- le libellé : l'écran les figeait déjà (commit d5db71b), la base non.
--
-- CE QUE FAIT CETTE MIGRATION. La base refuse aussi ces colonnes-là (IMPORT-FIGEE),
-- et le message NOMME la ou les colonnes touchées :
--   - le lot et la couleur sont ceux que la réception a pesés et mis en stock :
--     les changer ferait diverger la facture de la réception sans trace ;
--   - les bobines et palettes sont le colisage annoncé que le contrôle C43 compare
--     au poids : les retoucher après l'entrée effacerait l'écart qu'il signale.
-- Restent libres, parce que le serveur les tient lui-même : `quantite_recue_kg`
-- (relue depuis les arrivages, contre-passation), `pct_dossier` (répartition),
-- `soldee` / `motif_solde` (solde du reliquat). Aucun chemin du serveur n'écrit
-- les colonnes nouvellement figées hors de la saisie de la ligne
-- (PATCH /api/import/lignes/{id}) : aucune exemption.
-- Une correction passe, comme avant, par le solde, les frais du dossier, ou la
-- contre-passation de la réception avant la DUM.
--
-- Rejouable : CREATE OR REPLACE, déclencheur déposé puis recréé. Enregistrée par
-- migrer.py. Source : db/pg/018_schema_import.sql.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_trg_import_ligne_figee() RETURNS trigger AS $$
DECLARE
    v_colonnes text[] := ARRAY[]::text[];
BEGIN
    IF OLD.quantite_recue_kg > 0 THEN
        IF NEW.code_reference       IS DISTINCT FROM OLD.code_reference       THEN v_colonnes := v_colonnes || 'référence'::text; END IF;
        IF NEW.type_ligne           IS DISTINCT FROM OLD.type_ligne           THEN v_colonnes := v_colonnes || 'type'::text; END IF;
        IF NEW.libelle              IS DISTINCT FROM OLD.libelle              THEN v_colonnes := v_colonnes || 'libellé'::text; END IF;
        IF NEW.unite                IS DISTINCT FROM OLD.unite                THEN v_colonnes := v_colonnes || 'unité'::text; END IF;
        IF NEW.quantite             IS DISTINCT FROM OLD.quantite             THEN v_colonnes := v_colonnes || 'quantité'::text; END IF;
        IF NEW.poids_net_kg         IS DISTINCT FROM OLD.poids_net_kg         THEN v_colonnes := v_colonnes || 'poids net'::text; END IF;
        IF NEW.prix_unitaire_devise IS DISTINCT FROM OLD.prix_unitaire_devise THEN v_colonnes := v_colonnes || 'prix'::text; END IF;
        IF NEW.remise_pct           IS DISTINCT FROM OLD.remise_pct           THEN v_colonnes := v_colonnes || 'remise'::text; END IF;
        IF NEW.id_ligne_bc          IS DISTINCT FROM OLD.id_ligne_bc          THEN v_colonnes := v_colonnes || 'ligne de bon'::text; END IF;
        IF NEW.lot_fournisseur      IS DISTINCT FROM OLD.lot_fournisseur      THEN v_colonnes := v_colonnes || 'lot'::text; END IF;
        IF NEW.code_couleur         IS DISTINCT FROM OLD.code_couleur         THEN v_colonnes := v_colonnes || 'code couleur'::text; END IF;
        IF NEW.libelle_couleur      IS DISTINCT FROM OLD.libelle_couleur      THEN v_colonnes := v_colonnes || 'libellé couleur'::text; END IF;
        IF NEW.nb_bobines           IS DISTINCT FROM OLD.nb_bobines           THEN v_colonnes := v_colonnes || 'bobines'::text; END IF;
        IF NEW.nb_palettes          IS DISTINCT FROM OLD.nb_palettes          THEN v_colonnes := v_colonnes || 'palettes'::text; END IF;
        IF cardinality(v_colonnes) > 0 THEN
            RAISE EXCEPTION 'IMPORT-FIGEE : la ligne % de la facture est déjà reçue (% kg) : modification refusée (%). Une ligne reçue garde sa référence, son poids, son prix, son bon, son lot, sa couleur, ses bobines et ses palettes ; soldez-la, ou contre-passez la réception avant la DUM.',
                COALESCE(OLD.code_reference, OLD.libelle), OLD.quantite_recue_kg,
                array_to_string(v_colonnes, ', ') USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_import_ligne_figee() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_import_ligne_figee ON import_facture_lignes;
CREATE TRIGGER trg_import_ligne_figee BEFORE UPDATE ON import_facture_lignes
FOR EACH ROW EXECUTE FUNCTION fn_trg_import_ligne_figee();

-- ---- Témoin ------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_import_ligne_figee')
       OR position('libelle_couleur' IN pg_get_functiondef('fn_trg_import_ligne_figee'::regproc)) = 0
       OR position('nb_palettes' IN pg_get_functiondef('fn_trg_import_ligne_figee'::regproc)) = 0 THEN
        RAISE EXCEPTION '2026-10-24c : déclencheur de la ligne d''import reçue incomplet.';
    END IF;
END $$;

COMMIT;
