-- =============================================================================
-- ERP GESTION FIL — declencheurs, cible PostgreSQL
-- -----------------------------------------------------------------------------
-- Genere depuis 010_triggers.sql et 006_schema_achats.sql par
-- db/pg/porter_declencheurs.py. Ne pas editer a la main : regenerer.
--
-- Les trois declencheurs a vraie logique sont dans
-- 010b_declencheurs_logique.sql, ecrits a la main.
--
-- Trois formes, selon ce que PostgreSQL autorise :
--   * condition simple    -> WHEN (...) EXECUTE FUNCTION fn_refuser('message')
--     La regle reste lisible sur le declencheur, comme en SQLite.
--   * condition a SELECT  -> la condition descend dans le corps d'une fonction
--     dediee : PostgreSQL interdit les sous-requetes dans un WHEN.
--   * corps d'ecriture    -> fonction dediee, WHEN conserve quand il le peut.
-- =============================================================================

-- Refus partage. Le message voyage en argument plutot que dans le corps : une
-- fonction par garde ferait cinquante endroits ou une correction peut manquer.
CREATE OR REPLACE FUNCTION fn_refuser() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '%', TG_ARGV[0];
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mouvement_date_future
BEFORE INSERT ON mouvement FOR EACH ROW
WHEN (NEW.date_mouvement > to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
EXECUTE FUNCTION fn_refuser('C06 : un mouvement ne peut pas etre date dans le futur.');

CREATE OR REPLACE FUNCTION fn_trg_lmvt_prix_requis() RETURNS trigger AS $$
BEGIN
    IF NEW.prix_kg_mad IS NULL
 AND (SELECT tm.exige_prix FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      WHERE m.id_mouvement = NEW.id_mouvement) = 1 THEN
        RAISE EXCEPTION 'RG-07 : prix_kg_mad (en MAD) obligatoire pour ce type de mouvement.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lmvt_prix_requis
BEFORE INSERT ON ligne_mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_lmvt_prix_requis();

CREATE OR REPLACE FUNCTION fn_trg_lmvt_of_requis() RETURNS trigger AS $$
BEGIN
    IF COALESCE(NEW.numero_of, (SELECT numero_of FROM mouvement WHERE id_mouvement = NEW.id_mouvement)) IS NULL
 AND (SELECT tm.exige_of FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      WHERE m.id_mouvement = NEW.id_mouvement) = 1 THEN
        RAISE EXCEPTION 'C07 : numero d''''OF obligatoire pour une sortie production.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lmvt_of_requis
BEFORE INSERT ON ligne_mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_lmvt_of_requis();

CREATE OR REPLACE FUNCTION fn_trg_lmvt_motif_requis() RETURNS trigger AS $$
BEGIN
    IF NEW.code_motif_ligne IS NULL
 AND (SELECT tm.exige_motif_ligne FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      WHERE m.id_mouvement = NEW.id_mouvement) = 1 THEN
        RAISE EXCEPTION 'C08 : motif de ligne (R1-R6) obligatoire pour un retour.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lmvt_motif_requis
BEFORE INSERT ON ligne_mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_lmvt_motif_requis();

CREATE OR REPLACE FUNCTION fn_trg_lmvt_lot_requis() RETURNS trigger AS $$
BEGIN
    IF NEW.lot_fournisseur IS NULL
 AND (SELECT suivi_lot FROM reference WHERE code_reference = NEW.code_reference) = 1 THEN
        RAISE EXCEPTION 'Tracabilite : lot_fournisseur obligatoire pour cette reference (suivi_lot = 1).';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lmvt_lot_requis
BEFORE INSERT ON ligne_mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_lmvt_lot_requis();

CREATE OR REPLACE FUNCTION fn_trg_lmvt_stock_suffisant() RETURNS trigger AS $$
BEGIN
    IF (SELECT tm.signe FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      WHERE m.id_mouvement = NEW.id_mouvement) = -1
 AND NEW.quantite_kg > COALESCE((
        SELECT sm.quantite_kg FROM stock_magasin sm
        WHERE sm.code_reference = NEW.code_reference
          AND sm.code_magasin = (SELECT code_magasin FROM mouvement WHERE id_mouvement = NEW.id_mouvement)
     ), 0) + 0.0001 THEN
        RAISE EXCEPTION 'R02 : stock insuffisant dans ce magasin. Sortie refusee — regulariser par inventaire ou mouvement inverse.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lmvt_stock_suffisant
BEFORE INSERT ON ligne_mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_lmvt_stock_suffisant();

CREATE OR REPLACE FUNCTION fn_trg_lmvt_stock_lot_suffisant() RETURNS trigger AS $$
BEGIN
    IF NEW.lot_fournisseur IS NOT NULL
 AND (SELECT tm.signe FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      WHERE m.id_mouvement = NEW.id_mouvement) = -1
 AND NEW.quantite_kg > COALESCE((
        SELECT sl.quantite_kg FROM stock_lot sl
        WHERE sl.code_reference = NEW.code_reference
          AND sl.lot_fournisseur = NEW.lot_fournisseur
          AND sl.code_magasin = (SELECT code_magasin FROM mouvement WHERE id_mouvement = NEW.id_mouvement)
     ), 0) + 0.0001 THEN
        RAISE EXCEPTION 'R02 : quantite insuffisante sur ce lot dans ce magasin.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lmvt_stock_lot_suffisant
BEFORE INSERT ON ligne_mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_lmvt_stock_lot_suffisant();

CREATE OR REPLACE FUNCTION fn_trg_mouvement_immuable_r() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM mouvement WHERE id_mouvement = NEW.id_mouvement) THEN
        RAISE EXCEPTION 'R03 : remplacement interdit dans le grand livre des mouvements. Corriger par un mouvement inverse.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mouvement_immuable_r
BEFORE INSERT ON mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_mouvement_immuable_r();

CREATE OR REPLACE FUNCTION fn_trg_lmvt_immuable_r() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM ligne_mouvement WHERE id_ligne_mouvement = NEW.id_ligne_mouvement) THEN
        RAISE EXCEPTION 'R03 : remplacement interdit sur une ligne de mouvement.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lmvt_immuable_r
BEFORE INSERT ON ligne_mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_lmvt_immuable_r();

CREATE OR REPLACE FUNCTION fn_trg_archive_immuable_r() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM archive_reception WHERE id_archive = NEW.id_archive) THEN
        RAISE EXCEPTION 'R03 : remplacement interdit sur une archive de reception.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_archive_immuable_r
BEFORE INSERT ON archive_reception FOR EACH ROW
EXECUTE FUNCTION fn_trg_archive_immuable_r();

CREATE OR REPLACE FUNCTION fn_trg_histo_prix_immuable_r() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM historique_prix WHERE id_histo_prix = NEW.id_histo_prix) THEN
        RAISE EXCEPTION 'R03 : remplacement interdit dans l historique des prix.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_histo_prix_immuable_r
BEFORE INSERT ON historique_prix FOR EACH ROW
EXECUTE FUNCTION fn_trg_histo_prix_immuable_r();

CREATE OR REPLACE FUNCTION fn_trg_param_histo_immuable_r() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM parametre_historique WHERE id_histo_param = NEW.id_histo_param) THEN
        RAISE EXCEPTION 'R03 : remplacement interdit dans l historique des parametres.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_param_histo_immuable_r
BEFORE INSERT ON parametre_historique FOR EACH ROW
EXECUTE FUNCTION fn_trg_param_histo_immuable_r();

CREATE OR REPLACE FUNCTION fn_trg_mouvement_immuable_u() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'R03 : le grand livre des mouvements est immuable. Corriger par un mouvement inverse.';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mouvement_immuable_u
BEFORE UPDATE ON mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_mouvement_immuable_u();

CREATE OR REPLACE FUNCTION fn_trg_mouvement_immuable_d() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'R03 : suppression interdite dans le grand livre des mouvements.';
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mouvement_immuable_d
BEFORE DELETE ON mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_mouvement_immuable_d();

CREATE OR REPLACE FUNCTION fn_trg_lmvt_immuable_u() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'R03 : les lignes de mouvement sont immuables.';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lmvt_immuable_u
BEFORE UPDATE ON ligne_mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_lmvt_immuable_u();

CREATE OR REPLACE FUNCTION fn_trg_lmvt_immuable_d() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'R03 : suppression interdite sur les lignes de mouvement.';
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lmvt_immuable_d
BEFORE DELETE ON ligne_mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_lmvt_immuable_d();

CREATE OR REPLACE FUNCTION fn_trg_archive_immuable_u() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'R03 : l''''archive de reception est figee.';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_archive_immuable_u
BEFORE UPDATE ON archive_reception FOR EACH ROW
EXECUTE FUNCTION fn_trg_archive_immuable_u();

CREATE OR REPLACE FUNCTION fn_trg_archive_immuable_d() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'R03 : suppression interdite sur l''''archive de reception.';
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_archive_immuable_d
BEFORE DELETE ON archive_reception FOR EACH ROW
EXECUTE FUNCTION fn_trg_archive_immuable_d();

CREATE OR REPLACE FUNCTION fn_trg_histo_prix_immuable_u() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'R03 : l''''historique des prix est immuable (base du CMUP).';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_histo_prix_immuable_u
BEFORE UPDATE ON historique_prix FOR EACH ROW
EXECUTE FUNCTION fn_trg_histo_prix_immuable_u();

CREATE OR REPLACE FUNCTION fn_trg_histo_prix_immuable_d() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'R03 : suppression interdite sur l''''historique des prix.';
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_histo_prix_immuable_d
BEFORE DELETE ON historique_prix FOR EACH ROW
EXECUTE FUNCTION fn_trg_histo_prix_immuable_d();

CREATE OR REPLACE FUNCTION fn_trg_param_histo_immuable_u() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'R03 : l''''historique des parametres est immuable.';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_param_histo_immuable_u
BEFORE UPDATE ON parametre_historique FOR EACH ROW
EXECUTE FUNCTION fn_trg_param_histo_immuable_u();

CREATE OR REPLACE FUNCTION fn_trg_param_histo_immuable_d() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'R03 : suppression interdite sur l''''historique des parametres.';
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_param_histo_immuable_d
BEFORE DELETE ON parametre_historique FOR EACH ROW
EXECUTE FUNCTION fn_trg_param_histo_immuable_d();

CREATE TRIGGER trg_parametre_verrouille
BEFORE UPDATE OF valeur_courante ON parametre FOR EACH ROW
WHEN (OLD.verrouille = 1 AND OLD.valeur_courante IS DISTINCT FROM NEW.valeur_courante)
EXECUTE FUNCTION fn_refuser('Parametre verrouille : sa valeur est figee et ne peut pas etre modifiee.');

CREATE OR REPLACE FUNCTION fn_trg_taux_change_chevauchement() RETURNS trigger AS $$
BEGIN
    IF EXISTS (
    SELECT 1 FROM taux_change t
    WHERE t.code_devise = NEW.code_devise
      AND NEW.date_debut < COALESCE(t.date_fin, '9999-12-31')
      AND COALESCE(NEW.date_fin, '9999-12-31') > t.date_debut) THEN
        RAISE EXCEPTION 'RG-09 : periodes de taux de change chevauchantes pour cette devise.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_taux_change_chevauchement
BEFORE INSERT ON taux_change FOR EACH ROW
EXECUTE FUNCTION fn_trg_taux_change_chevauchement();

CREATE OR REPLACE FUNCTION fn_trg_taux_pivot() RETURNS trigger AS $$
BEGIN
    IF (SELECT est_pivot FROM devise WHERE code_devise = NEW.code_devise) = 1
 AND NEW.taux <> 1.0 THEN
        RAISE EXCEPTION 'La devise pivot doit avoir un taux de 1.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_taux_pivot
BEFORE INSERT ON taux_change FOR EACH ROW
EXECUTE FUNCTION fn_trg_taux_pivot();

CREATE OR REPLACE FUNCTION fn_trg_transition_qualite() RETURNS trigger AS $$
BEGIN
    IF OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'qualite' AND statut_source = OLD.statut AND statut_cible = NEW.statut) THEN
        RAISE EXCEPTION 'Transition de statut interdite sur la qualite.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transition_qualite
BEFORE UPDATE OF statut ON qualite FOR EACH ROW
EXECUTE FUNCTION fn_trg_transition_qualite();

CREATE OR REPLACE FUNCTION fn_trg_transition_plan() RETURNS trigger AS $$
BEGIN
    IF OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'plan_production' AND statut_source = OLD.statut AND statut_cible = NEW.statut) THEN
        RAISE EXCEPTION 'Transition de statut interdite sur le plan de production.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transition_plan
BEFORE UPDATE OF statut ON plan_production FOR EACH ROW
EXECUTE FUNCTION fn_trg_transition_plan();

CREATE OR REPLACE FUNCTION fn_trg_transition_bc() RETURNS trigger AS $$
BEGIN
    IF OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'bon_commande' AND statut_source = OLD.statut AND statut_cible = NEW.statut) THEN
        RAISE EXCEPTION 'Transition de statut interdite sur le bon de commande.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transition_bc
BEFORE UPDATE OF statut ON bon_commande FOR EACH ROW
EXECUTE FUNCTION fn_trg_transition_bc();

CREATE OR REPLACE FUNCTION fn_trg_transition_reception() RETURNS trigger AS $$
BEGIN
    IF OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'reception' AND statut_source = OLD.statut AND statut_cible = NEW.statut) THEN
        RAISE EXCEPTION 'Transition de statut interdite sur la reception.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transition_reception
BEFORE UPDATE OF statut ON reception FOR EACH ROW
EXECUTE FUNCTION fn_trg_transition_reception();

CREATE OR REPLACE FUNCTION fn_trg_transition_transfert() RETURNS trigger AS $$
BEGIN
    IF OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'transfert' AND statut_source = OLD.statut AND statut_cible = NEW.statut) THEN
        RAISE EXCEPTION 'Transition de statut interdite sur le transfert.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transition_transfert
BEFORE UPDATE OF statut ON transfert FOR EACH ROW
EXECUTE FUNCTION fn_trg_transition_transfert();

CREATE OR REPLACE FUNCTION fn_trg_transition_inventaire() RETURNS trigger AS $$
BEGIN
    IF OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'inventaire' AND statut_source = OLD.statut AND statut_cible = NEW.statut) THEN
        RAISE EXCEPTION 'Transition de statut interdite sur l''''inventaire.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transition_inventaire
BEFORE UPDATE OF statut ON inventaire FOR EACH ROW
EXECUTE FUNCTION fn_trg_transition_inventaire();

CREATE OR REPLACE FUNCTION fn_trg_qualite_activer_somme() RETURNS trigger AS $$
BEGIN
    IF NEW.statut = 'ACTIF' AND OLD.statut <> 'ACTIF'
 AND EXISTS (
    SELECT 1 FROM recette r
    WHERE r.code_qualite = NEW.code_qualite AND r.actif = 1
    GROUP BY r.code_role
    HAVING abs(SUM(r.pourcentage_composition) - 100.0) > 0.5) THEN
        RAISE EXCEPTION 'R07 : la somme des pourcentages de composition doit valoir 100%% pour chaque role BOM.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_qualite_activer_somme
BEFORE UPDATE OF statut ON qualite FOR EACH ROW
EXECUTE FUNCTION fn_trg_qualite_activer_somme();

CREATE OR REPLACE FUNCTION fn_trg_qualite_activer_non_vide() RETURNS trigger AS $$
BEGIN
    IF NEW.statut = 'ACTIF' AND OLD.statut <> 'ACTIF'
 AND NOT EXISTS (SELECT 1 FROM recette WHERE code_qualite = NEW.code_qualite AND actif = 1) THEN
        RAISE EXCEPTION 'Une qualite sans ligne de composition ne peut pas etre mise en service.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_qualite_activer_non_vide
BEFORE UPDATE OF statut ON qualite FOR EACH ROW
EXECUTE FUNCTION fn_trg_qualite_activer_non_vide();

CREATE OR REPLACE FUNCTION fn_trg_qualite_activer_roles() RETURNS trigger AS $$
BEGIN
    IF NEW.statut = 'ACTIF' AND OLD.statut <> 'ACTIF'
 AND EXISTS (
    SELECT 1 FROM recette r
    WHERE r.code_qualite = NEW.code_qualite AND r.actif = 1
      AND NOT EXISTS (SELECT 1 FROM ligne_qualite lq
                      WHERE lq.code_qualite = NEW.code_qualite
                        AND lq.code_role = r.code_role
                        AND lq.actif = 1)) THEN
        RAISE EXCEPTION 'Role BOM sans densite definie sur la qualite : le MRP calculerait un besoin nul en silence.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_qualite_activer_roles
BEFORE UPDATE OF statut ON qualite FOR EACH ROW
EXECUTE FUNCTION fn_trg_qualite_activer_roles();

CREATE OR REPLACE FUNCTION fn_trg_qualite_activer_densite_ml() RETURNS trigger AS $$
BEGIN
    IF NEW.statut = 'ACTIF' AND OLD.statut <> 'ACTIF'
 AND EXISTS (
    SELECT 1 FROM recette r
    JOIN ligne_qualite lq ON lq.code_qualite = NEW.code_qualite AND lq.code_role = r.code_role
    JOIN reference ref    ON ref.code_reference = r.code_reference
    WHERE r.code_qualite = NEW.code_qualite AND r.actif = 1
      AND lq.unite_densite = 'ml_m2' AND ref.densite_kg_ml IS NULL) THEN
        RAISE EXCEPTION 'R01 : role en ml/m2 — densite_kg_ml obligatoire sur la reference pour convertir en kg.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_qualite_activer_densite_ml
BEFORE UPDATE OF statut ON qualite FOR EACH ROW
EXECUTE FUNCTION fn_trg_qualite_activer_densite_ml();

CREATE OR REPLACE FUNCTION fn_trg_recette_verrou_plan_i() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM plan_qualite pq
             JOIN plan_production pp ON pp.id_plan = pq.id_plan
             WHERE pq.code_qualite = NEW.code_qualite AND pp.statut = 'EN_COURS') THEN
        RAISE EXCEPTION 'Composition verrouillee : cette qualite est produite par le plan en service. Creer une nouvelle qualite pour changer la composition.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recette_verrou_plan_i
BEFORE INSERT ON recette FOR EACH ROW
EXECUTE FUNCTION fn_trg_recette_verrou_plan_i();

CREATE OR REPLACE FUNCTION fn_trg_recette_verrou_plan_u() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM plan_qualite pq
             JOIN plan_production pp ON pp.id_plan = pq.id_plan
             WHERE pq.code_qualite = OLD.code_qualite AND pp.statut = 'EN_COURS') THEN
        RAISE EXCEPTION 'Composition verrouillee : cette qualite est produite par le plan en service. Creer une nouvelle qualite pour changer la composition.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recette_verrou_plan_u
BEFORE UPDATE ON recette FOR EACH ROW
EXECUTE FUNCTION fn_trg_recette_verrou_plan_u();

CREATE OR REPLACE FUNCTION fn_trg_recette_verrou_plan_d() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM plan_qualite pq
             JOIN plan_production pp ON pp.id_plan = pq.id_plan
             WHERE pq.code_qualite = OLD.code_qualite AND pp.statut = 'EN_COURS') THEN
        RAISE EXCEPTION 'Composition verrouillee : cette qualite est produite par le plan en service. Creer une nouvelle qualite pour changer la composition.';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recette_verrou_plan_d
BEFORE DELETE ON recette FOR EACH ROW
EXECUTE FUNCTION fn_trg_recette_verrou_plan_d();

CREATE OR REPLACE FUNCTION fn_trg_plan_qualite_exclusive_i() RETURNS trigger AS $$
BEGIN
    IF EXISTS (
    SELECT 1 FROM plan_qualite pq
    JOIN plan_production pp ON pp.id_plan = pq.id_plan
    WHERE pq.code_qualite = NEW.code_qualite
      AND pq.id_plan <> NEW.id_plan
      AND pp.statut <> 'CLOTURE') THEN
        RAISE EXCEPTION 'Cette qualite figure deja dans un autre plan actif : un plan doit etre cloture avant que sa qualite soit reprise ailleurs.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_plan_qualite_exclusive_i
BEFORE INSERT ON plan_qualite FOR EACH ROW
EXECUTE FUNCTION fn_trg_plan_qualite_exclusive_i();

CREATE OR REPLACE FUNCTION fn_trg_plan_qualite_exclusive_u() RETURNS trigger AS $$
BEGIN
    IF EXISTS (
    SELECT 1 FROM plan_qualite pq
    JOIN plan_production pp ON pp.id_plan = pq.id_plan
    WHERE pq.code_qualite = NEW.code_qualite
      AND pq.id_plan <> NEW.id_plan
      AND NOT (pq.id_plan = OLD.id_plan AND pq.code_qualite = OLD.code_qualite)
      AND pp.statut <> 'CLOTURE') THEN
        RAISE EXCEPTION 'Cette qualite figure deja dans un autre plan actif : un plan doit etre cloture avant que sa qualite soit reprise ailleurs.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_plan_qualite_exclusive_u
BEFORE UPDATE OF code_qualite, id_plan ON plan_qualite FOR EACH ROW
EXECUTE FUNCTION fn_trg_plan_qualite_exclusive_u();

CREATE OR REPLACE FUNCTION fn_trg_plan_qualite_active_i() RETURNS trigger AS $$
BEGIN
    IF (SELECT statut FROM qualite WHERE code_qualite = NEW.code_qualite) <> 'ACTIF' THEN
        RAISE EXCEPTION 'R08 : seule une qualite ACTIVE peut etre retenue par un plan.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_plan_qualite_active_i
BEFORE INSERT ON plan_qualite FOR EACH ROW
EXECUTE FUNCTION fn_trg_plan_qualite_active_i();

CREATE OR REPLACE FUNCTION fn_trg_plan_qualite_active_u() RETURNS trigger AS $$
BEGIN
    IF (SELECT statut FROM qualite WHERE code_qualite = NEW.code_qualite) <> 'ACTIF' THEN
        RAISE EXCEPTION 'R08 : seule une qualite ACTIVE peut etre retenue par un plan.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_plan_qualite_active_u
BEFORE UPDATE OF code_qualite ON plan_qualite FOR EACH ROW
EXECUTE FUNCTION fn_trg_plan_qualite_active_u();

CREATE OR REPLACE FUNCTION fn_trg_plan_valider_recettes() RETURNS trigger AS $$
BEGIN
    IF NEW.statut = 'EN_COURS' AND OLD.statut <> 'EN_COURS'
 AND EXISTS (
    SELECT 1 FROM ligne_plan_production lpp
    WHERE lpp.id_plan = NEW.id_plan AND lpp.m2_prevus > 0
      AND NOT EXISTS (SELECT 1 FROM plan_qualite pq
                      WHERE pq.id_plan = NEW.id_plan AND pq.code_qualite = lpp.code_qualite)) THEN
        RAISE EXCEPTION 'R08 : chaque qualite planifiee doit figurer dans l''''entete du plan (table plan_qualite) avant mise en service.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_plan_valider_recettes
BEFORE UPDATE OF statut ON plan_production FOR EACH ROW
EXECUTE FUNCTION fn_trg_plan_valider_recettes();

CREATE OR REPLACE FUNCTION fn_trg_reception_sod_acheteur() RETURNS trigger AS $$
BEGIN
    IF NEW.statut = 'VALIDE'
 AND NEW.id_utilisateur_controle IS NOT NULL
 AND NEW.id_utilisateur_controle = (SELECT id_utilisateur_creation FROM bon_commande WHERE id_bc = NEW.id_bc) THEN
        RAISE EXCEPTION 'B4 regle 2 : le createur du bon de commande ne peut pas controler sa propre reception.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reception_sod_acheteur
BEFORE UPDATE OF statut ON reception FOR EACH ROW
EXECUTE FUNCTION fn_trg_reception_sod_acheteur();

CREATE OR REPLACE FUNCTION fn_trg_ligne_reception_quarantaine() RETURNS trigger AS $$
BEGIN
    IF NEW.statut_qualite IN ('NON_CONFORME','QUARANTAINE')
 AND (SELECT est_quarantaine FROM magasin WHERE code_magasin = NEW.code_magasin_dest) = 0 THEN
        RAISE EXCEPTION 'Une ligne non conforme ou en quarantaine doit etre dirigee vers un magasin de quarantaine.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ligne_reception_quarantaine
BEFORE INSERT ON ligne_reception FOR EACH ROW
EXECUTE FUNCTION fn_trg_ligne_reception_quarantaine();

CREATE OR REPLACE FUNCTION fn_trg_ligne_reception_substitution() RETURNS trigger AS $$
DECLARE
    v_type      text;
    v_commandee text;
BEGIN
    IF NEW.id_ligne_bc IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT type_ligne, code_reference INTO v_type, v_commandee
      FROM ligne_bc WHERE id_ligne_bc = NEW.id_ligne_bc;

    -- Une ligne de service n'attend aucune marchandise : rien ne s'y pese.
    IF v_type = 'SERVICE' THEN
        RAISE EXCEPTION 'La ligne de commande visee est une prestation, pas de la marchandise : on ne peut pas y receptionner %.', NEW.code_reference;
    END IF;

    -- `IS DISTINCT FROM` ET NON `<>`. Compare a une ligne qui ne porte pas de
    -- reference, `<>` rend NULL — donc jamais vrai — et le garde-fou s'ouvrait
    -- en grand : n'importe quelle marchandise pouvait se rattacher a une ligne
    -- de transport, sans un mot.
    IF NEW.code_reference IS DISTINCT FROM v_commandee
 AND (NEW.substitution_acceptee = 0
      OR NOT EXISTS (
          SELECT 1 FROM v_equivalence e
           WHERE e.code_reference = v_commandee
             AND e.equivalent_reference = NEW.code_reference
             AND e.interchangeable = 1)) THEN
        RAISE EXCEPTION 'Reference recue differente de la reference commandee. Elle n''est acceptable que si les deux references appartiennent au meme groupe d''equivalence, sont interchangeables (meme unite, meme densite, meme categorie), et que la substitution est explicitement confirmee.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ligne_reception_substitution
BEFORE INSERT ON ligne_reception FOR EACH ROW
EXECUTE FUNCTION fn_trg_ligne_reception_substitution();

CREATE OR REPLACE FUNCTION fn_trg_ligne_reception_ecart() RETURNS trigger AS $$
BEGIN
    IF NEW.quantite_commandee_kg IS NOT NULL
 AND NEW.derogation_ecart = 0
 AND abs((NEW.quantite_stock_kg - NEW.quantite_commandee_kg) / NEW.quantite_commandee_kg * 100.0) >
     COALESCE(
        (SELECT f.tolerance_pesee_pct FROM reception rc
         JOIN fournisseur f ON f.code_fournisseur = rc.code_fournisseur
         WHERE rc.id_reception = NEW.id_reception),
        (SELECT CAST(valeur_courante AS REAL) FROM parametre WHERE code_parametre = 'P_TolerEcartPesee')) THEN
        RAISE EXCEPTION 'C10 : ecart de pesee hors tolerance. Une derogation tracee est requise (derogation_ecart = 1).';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ligne_reception_ecart
BEFORE INSERT ON ligne_reception FOR EACH ROW
EXECUTE FUNCTION fn_trg_ligne_reception_ecart();

CREATE TRIGGER trg_plan_achat_figement_trace
BEFORE UPDATE OF figee ON plan_achat FOR EACH ROW
WHEN (NEW.figee = 1
 AND (NEW.id_utilisateur_figement IS NULL OR NEW.date_figement IS NULL))
EXECUTE FUNCTION fn_refuser('Figement refuse : une proposition figee doit porter son auteur et sa date.');

CREATE TRIGGER trg_plan_achat_figement_statut
BEFORE UPDATE OF figee ON plan_achat FOR EACH ROW
WHEN (NEW.figee = 1 AND NEW.statut IN ('COMMANDE','IGNORE'))
EXECUTE FUNCTION fn_refuser('Figement refuse : cette proposition est deja commandee ou ecartee.');

-- Portes a la main :
-- trg_lmvt_appliquer : porte a la main (010b_declencheurs_logique.sql)
-- trg_parametre_historiser : porte a la main (010b_declencheurs_logique.sql)
