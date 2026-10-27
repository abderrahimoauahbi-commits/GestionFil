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

-- La consommation directe ne vaut que pour un article en mode DIRECTE : le fil
-- sort par les fiches machine (decision du 21/10/2026, migration 2026-10-21c).
CREATE OR REPLACE FUNCTION fn_trg_lmvt_conso_directe() RETURNS trigger AS $$
DECLARE
    v_type text;
    v_mode text;
BEGIN
    SELECT code_type_mvt INTO v_type FROM mouvement WHERE id_mouvement = NEW.id_mouvement;
    IF v_type = 'CONSO_DIRECTE' THEN
        SELECT mode_consommation INTO v_mode FROM reference WHERE code_reference = NEW.code_reference;
        IF COALESCE(v_mode, 'MACHINE') <> 'DIRECTE' THEN
            RAISE EXCEPTION 'CONSO-DIRECTE : % est en mode de consommation MACHINE : le fil sort par les fiches machine, pas par une consommation directe.', NEW.code_reference;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lmvt_conso_directe
BEFORE INSERT ON ligne_mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_lmvt_conso_directe();

-- LE RETOUR D'UNE CONSOMMATION DIRECTE (22/10/2026) : un article DIRECTE, un OF
-- (mouvement.id_of, socle 2026-10-22a), et jamais plus que ce que cet OF a sorti
-- de cette reference et pas encore rendu ; la sortie ne se contre-passe pas tant
-- qu'un retour en depend. Definis dans db/pg/migrations/2026-10-22d_of_machines_hors_machine.sql
-- (ils citent l'OF, absent des fichiers d'origine) : fn_of_conso_directe_reste,
-- fn_trg_lmvt_retour_conso (trg_lmvt_retour_conso, BEFORE INSERT ON ligne_mouvement),
-- fn_trg_mouvement_conso_rendue (trg_mouvement_conso_rendue, BEFORE INSERT ON mouvement),
-- et fn_bobines_voie(capacite, largeur_machine, largeur_voie) = floor(capacite x voie / largeur).
--
-- LA QUALITE EXPLICITE (23/10/2026, migration 2026-10-23b_qualite_explicite.sql) :
-- trg_mouvement_qualite (BEFORE INSERT ON mouvement) — une consommation directe ou
-- son retour porte la qualite de son OF, sans OF une qualite obligatoire ; les
-- autres mouvements n'en portent pas. Le retour sans OF est borne par la qualite
-- (fn_qualite_conso_directe_reste) : fn_trg_lmvt_retour_conso et
-- fn_trg_mouvement_conso_rendue y sont redefinies. Machine : trg_machine_etat_qualite,
-- trg_machine_decision_etat_qualite (fn_trg_machine_qualite_of) et
-- trg_machine_decision_ligne_qualite (fn_trg_mdl_qualite : qualite nouvelle et de la
-- periode coherentes avec leurs OF, obligatoire sur une ligne de chargement).
--
-- LE CONDITIONNEMENT DU LOT (23/10/2026, migration 2026-10-23a_lot_conditionnement.sql) :
-- trg_10_lot_conditionnement_naissance (BEFORE INSERT ON lot : la fiche article),
-- fn_lot_conditionnement_reception (appelee par le service a la validation d'une
-- reception), fn_lot_poids_bobine / fn_lot_bobines_palette (le lot, sinon la fiche),
-- journal immuable lot_conditionnement_journal (trg_lot_conditionnement_journal_immuable).

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

-- TRF-DATE (arbitrage du 27/10/2026, migration 2026-10-27d) : le fil en route
-- est un arrivage, il porte sa date prevue de disponibilite au magasin
-- destinataire. Obligatoire a l'expedition (passage en VALIDE), revisable tant
-- que le transfert est en route, jamais apres sa reception ni sur un transfert
-- abandonne ; en route, elle se revise, elle ne s'efface pas.
-- (Sa revision est journalisee par `trg_audit_transfert_date`, qui reste dans la
-- migration : `fn_trg_audit_modification` n'existe que par les migrations
-- 2026-10-08d et suivantes.)
CREATE OR REPLACE FUNCTION fn_trg_transfert_date_disponibilite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- L'expédition (passage en VALIDE) exige la date.
    IF NEW.statut = 'VALIDE'
       AND (TG_OP = 'INSERT' OR OLD.statut IS DISTINCT FROM 'VALIDE')
       AND NEW.date_disponibilite_prevue IS NULL THEN
        RAISE EXCEPTION 'TRF-DATE : le transfert % ne part pas sans date prévue de disponibilité au magasin destinataire. Saisissez-la avant d''expédier.',
            NEW.numero_transfert;
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.date_disponibilite_prevue IS DISTINCT FROM OLD.date_disponibilite_prevue THEN
        -- Reçu ou abandonné : la date est figée.
        IF OLD.statut NOT IN ('BROUILLON', 'VALIDE') THEN
            RAISE EXCEPTION 'TRF-DATE : le transfert % est %, sa date prévue de disponibilité ne se révise plus (seulement tant qu''il est en route).',
                NEW.numero_transfert, lower(OLD.statut);
        END IF;
        -- En route, on la révise, on ne l'efface pas.
        IF OLD.statut = 'VALIDE' AND NEW.date_disponibilite_prevue IS NULL THEN
            RAISE EXCEPTION 'TRF-DATE : le transfert % est en route : sa date prévue de disponibilité se révise, elle ne s''efface pas.',
                NEW.numero_transfert;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_transfert_date_disponibilite
    BEFORE INSERT OR UPDATE ON transfert
    FOR EACH ROW EXECUTE FUNCTION fn_trg_transfert_date_disponibilite();

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

-- LA TOLERANCE DE PESEE A UNE SEULE SOURCE (regle 14, 08/10/2026) : le reglage
-- du fournisseur, et a defaut le parametre P_TolerEcartPesee (2 %).
CREATE OR REPLACE FUNCTION fn_tolerance_pesee(p_id_reception text) RETURNS numeric AS $$
    SELECT COALESCE(
        (SELECT f.tolerance_pesee_pct FROM reception rc
           JOIN fournisseur f ON f.code_fournisseur = rc.code_fournisseur
          WHERE rc.id_reception = p_id_reception),
        (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_TolerEcartPesee'),
        2);
$$ LANGUAGE sql STABLE;

-- LA TOLERANCE D'UN FOURNISSEUR (audit v4) : la meme source pour la reception
-- d'import, qui la figeait a 2 % dans le code.
CREATE OR REPLACE FUNCTION fn_tolerance_fournisseur(p_code_fournisseur text) RETURNS numeric AS $$
    SELECT COALESCE(
        (SELECT f.tolerance_pesee_pct FROM fournisseur f WHERE f.code_fournisseur = p_code_fournisseur),
        (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_TolerEcartPesee'),
        2);
$$ LANGUAGE sql STABLE;

-- SEUL L'EXCEDENT EXIGE UNE DEROGATION (08/10/2026). Le controle refusait tout
-- ecart a la quantite attendue, dans les deux sens : 1 000 kg livres sur 8 400
-- restant a recevoir etaient refuses comme « hors tolerance ». Une livraison
-- partielle n'est pas une faute de pesee : le bon reste LIVRE_PARTIEL et le
-- reliquat viendra. Ce qui doit etre justifie, c'est de faire entrer PLUS que
-- commande au-dela de la tolerance du fournisseur.
-- A l'insertion ET a la modification : corriger une pesee sur la fiche ne doit
-- pas contourner le controle.
CREATE OR REPLACE FUNCTION fn_trg_ligne_reception_ecart() RETURNS trigger AS $$
DECLARE
    v_tol numeric;
BEGIN
    IF NEW.quantite_commandee_kg IS NOT NULL AND NEW.derogation_ecart = 0 THEN
        v_tol := fn_tolerance_pesee(NEW.id_reception);
        IF NEW.quantite_stock_kg > NEW.quantite_commandee_kg * (1 + v_tol / 100.0) + 0.0005 THEN
            RAISE EXCEPTION 'C10 : % kg peses pour % kg attendus, au-dela de la tolerance de % %%. Une derogation motivee est requise.',
                round(NEW.quantite_stock_kg, 2), round(NEW.quantite_commandee_kg, 2), round(v_tol, 2);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ligne_reception_ecart
BEFORE INSERT OR UPDATE OF quantite_stock_kg, quantite_commandee_kg, derogation_ecart
ON ligne_reception FOR EACH ROW
EXECUTE FUNCTION fn_trg_ligne_reception_ecart();

-- -----------------------------------------------------------------------------
-- LA COHERENCE DU COLISAGE (08/10/2026)
-- -----------------------------------------------------------------------------
-- Kilos, bobines et palettes disent la meme marchandise. Une facture saisie a
-- 4 032 kg, 1 920 bobines et 20 palettes pour un fil de 2,1 kg la bobine et
-- 336 bobines par palette ne decrit rien de reel : il faut 6 palettes, pas 20
-- (des colis ou des cartons avaient ete saisis comme palettes). Le controle
-- raisonne a partir de la fiche article :
--   * le poids moyen d'une bobine (kilos / bobines) ne s'ecarte pas de la fiche
--     de plus de P_ColisageTolRefusPct (25 %) ;
--   * les palettes ne depassent pas le minimum necessaire plus une palette
--     entamee, et aucune palette ne porte plus que sa capacite (+ la meme
--     tolerance).
-- Sans bobines, le nombre de bobines se deduit des kilos. Une fiche sans poids
-- de bobine ou sans colisage ne permet pas de juger : on ne juge pas.
-- Rend NULL si la ligne est coherente, sinon le message qui explique.
-- ON SIGNALE, ON NE BLOQUE PAS (decision du 08/10/2026) : l'ecran l'affiche sur
-- la ligne a la saisie, et le controle C43 liste les documents ouverts qui
-- portent encore une ligne incoherente.
CREATE OR REPLACE FUNCTION fn_controle_colisage(p_ref text, p_kg numeric, p_bob numeric, p_pal numeric)
RETURNS text AS $$
DECLARE
    v_pb    numeric;
    v_bpp   numeric;
    v_tol   numeric;
    v_beff  numeric;
    v_ecart numeric;
    v_pmin  numeric;
BEGIN
    IF p_ref IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT NULLIF(poids_bobine_kg, 0), NULLIF(bobines_par_palette, 0) INTO v_pb, v_bpp
      FROM reference WHERE code_reference = p_ref;
    v_tol := COALESCE((SELECT CAST(valeur_courante AS numeric) FROM parametre
                        WHERE code_parametre = 'P_ColisageTolRefusPct'), 25);

    IF COALESCE(p_bob, 0) > 0 AND v_pb IS NOT NULL AND COALESCE(p_kg, 0) > 0 THEN
        v_ecart := (p_kg / p_bob - v_pb) / v_pb * 100;
        IF abs(v_ecart) > v_tol THEN
            RETURN format('%s : %s kg pour %s bobines, soit %s kg par bobine, alors que la fiche en annonce %s (ecart %s %%, refus au-dela de %s %%). Verifiez les kilos et les bobines ; si le fournisseur a change de bobine, corrigez d''abord la fiche article.',
                          p_ref, round(p_kg, 2), round(p_bob), round(p_kg / p_bob, 3), round(v_pb, 3),
                          round(v_ecart, 1), round(v_tol));
        END IF;
    END IF;

    v_beff := COALESCE(NULLIF(p_bob, 0), CASE WHEN v_pb IS NOT NULL THEN p_kg / v_pb END);
    IF COALESCE(p_pal, 0) > 0 AND v_bpp IS NOT NULL AND COALESCE(v_beff, 0) > 0 THEN
        v_pmin := ceil(v_beff / v_bpp - 0.000001);
        IF p_pal > v_pmin + 1 THEN
            RETURN format('%s : %s palettes pour %s bobines. A %s bobines par palette, il en faut %s (%s au plus avec une palette entamee). Des colis ou des cartons ont-ils ete saisis comme palettes ?',
                          p_ref, round(p_pal), round(v_beff), round(v_bpp), v_pmin, v_pmin + 1);
        END IF;
        IF v_beff / p_pal > v_bpp * (1 + v_tol / 100.0) THEN
            RETURN format('%s : %s bobines sur %s palette(s), soit %s par palette, alors qu''une palette en porte %s. Il faut au moins %s palettes.',
                          p_ref, round(v_beff), round(p_pal), round(v_beff / p_pal), round(v_bpp), v_pmin);
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- La date ou une proposition est ecartee : elle expire ensuite (regle 17).
CREATE OR REPLACE FUNCTION fn_trg_plan_achat_date_ecartee() RETURNS trigger AS $$
BEGIN
    IF NEW.statut = 'IGNORE' AND OLD.statut IS DISTINCT FROM 'IGNORE' THEN
        NEW.date_ecartee := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_plan_achat_date_ecartee
BEFORE UPDATE OF statut ON plan_achat FOR EACH ROW EXECUTE FUNCTION fn_trg_plan_achat_date_ecartee();

CREATE TRIGGER trg_rec_ajust_immuable
BEFORE UPDATE OR DELETE ON reception_ajustements_cmup FOR EACH ROW
EXECUTE FUNCTION fn_refuser('Le journal des ajustements de CMUP d''une reception est immuable.');

CREATE TRIGGER trg_plan_achat_figement_trace
BEFORE UPDATE OF figee ON plan_achat FOR EACH ROW
WHEN (NEW.figee = 1
 AND (NEW.id_utilisateur_figement IS NULL OR NEW.date_figement IS NULL))
EXECUTE FUNCTION fn_refuser('Figement refuse : une proposition figee doit porter son auteur et sa date.');

CREATE TRIGGER trg_plan_achat_figement_statut
BEFORE UPDATE OF figee ON plan_achat FOR EACH ROW
WHEN (NEW.figee = 1 AND NEW.statut IN ('COMMANDE','IGNORE','ANNULE_BC'))
EXECUTE FUNCTION fn_refuser('Figement refuse : cette proposition est deja commandee, ecartee ou annulee avec son bon.');

-- ANNULEE AVEC LE BON (decision du 27/10/2026, 2026-10-27f) : un etat final. La
-- proposition reste liee au bon annule ; la regeneration en cree une neuve.
CREATE TRIGGER trg_plan_achat_annule_bc_final
BEFORE UPDATE OF statut ON plan_achat FOR EACH ROW
WHEN (OLD.statut = 'ANNULE_BC' AND NEW.statut IS DISTINCT FROM 'ANNULE_BC')
EXECUTE FUNCTION fn_refuser('PA-ANNULE-BC : cette proposition a ete annulee avec son bon ; elle reste a l''historique. Regenerez le plan d''achat : le moteur en proposera une neuve s''il le faut.');

-- Portes a la main :
-- trg_lmvt_appliquer : porte a la main (010b_declencheurs_logique.sql)
-- trg_parametre_historiser : porte a la main (010b_declencheurs_logique.sql)


-- =============================================================================
-- VERROU OPTIMISTE DES DOCUMENTS A WORKFLOW (A2, migration 2026-10-17d)
-- =============================================================================
-- Chaque modification de l'un des six documents qui passent de main en main
-- incremente sa `version`. Le service compare la version que le client a lue a
-- celle de la base (`domain/concurrence.rs`) : si quelqu'un est passe entre-temps,
-- il refuse en le nommant au lieu d'ecraser sa saisie en silence.
--
-- La version n'est pas une donnee de saisie : quoi que le client envoie, la
-- nouvelle est l'ancienne plus un. `trg_aa_` la fait passer avant les declencheurs
-- metier (PostgreSQL execute les BEFORE par ordre de nom).
CREATE OR REPLACE FUNCTION fn_trg_version_incrementer() RETURNS trigger AS $$
BEGIN
    NEW.version := OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_aa_version BEFORE UPDATE ON bon_commande
FOR EACH ROW EXECUTE FUNCTION fn_trg_version_incrementer();
CREATE TRIGGER trg_aa_version BEFORE UPDATE ON reception
FOR EACH ROW EXECUTE FUNCTION fn_trg_version_incrementer();
CREATE TRIGGER trg_aa_version BEFORE UPDATE ON inventaire
FOR EACH ROW EXECUTE FUNCTION fn_trg_version_incrementer();
CREATE TRIGGER trg_aa_version BEFORE UPDATE ON transfert
FOR EACH ROW EXECUTE FUNCTION fn_trg_version_incrementer();
CREATE TRIGGER trg_aa_version BEFORE UPDATE ON plan_production
FOR EACH ROW EXECUTE FUNCTION fn_trg_version_incrementer();
CREATE TRIGGER trg_aa_version BEFORE UPDATE ON qualite
FOR EACH ROW EXECUTE FUNCTION fn_trg_version_incrementer();


-- =============================================================================
-- CLOTURE DE PERIODE (A3, migration 2026-10-17e)
-- =============================================================================
-- Recopie de la migration, au caractere pres. Le reglage P_PeriodeCloseJusqua
-- et le controle C55 restent dans la migration, comme les autres reglages et
-- controles venus apres C44 : sans le reglage, fn_periode_close_jusqua() rend
-- NULL et la cloture est inerte — le schema d'origine se charge donc seul.

-- ---- 1. La date metier d'une date du grand livre ----------------------------
-- STABLE et sans bloc EXCEPTION : elle s'execute a chaque ligne ecrite, et un
-- bloc EXCEPTION ouvrirait une sous-transaction par ligne. Un format inconnu
-- rend NULL : la cloture ne tranche pas ce qu'elle ne sait pas lire, d'autres
-- gardes (trg_mouvement_date_future) s'occupent des dates mal formees.
CREATE OR REPLACE FUNCTION fn_date_metier(p text) RETURNS date AS $$
BEGIN
    IF p ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}' THEN
        RETURN (p::timestamptz AT TIME ZONE 'Africa/Casablanca')::date;
    ELSIF p ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
        RETURN substr(p, 1, 10)::date;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- La limite courante : NULL si le reglage manque (base anterieure a cette
-- migration rechargee partiellement) — rien n'est alors refuse.
CREATE OR REPLACE FUNCTION fn_periode_close_jusqua() RETURNS date AS $$
    SELECT valeur_courante::date FROM parametre
     WHERE code_parametre = 'P_PeriodeCloseJusqua' AND actif = 1;
$$ LANGUAGE sql STABLE;

-- ---- 3. Qui peut clore, et jusqu'ou -----------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_parametre_cloture() RETURNS trigger AS $$
DECLARE
    v_user    text := NULLIF(current_setting('gestionfil.id_utilisateur', true), '');
    v_role    text;
    v_nouvelle date := NEW.valeur_courante::date;   -- format deja controle par trg_00_parametre_type
    v_ancienne date := OLD.valeur_courante::date;
    v_aujourdhui date := (now() AT TIME ZONE 'Africa/Casablanca')::date;
BEGIN
    IF v_nouvelle = v_ancienne THEN
        RETURN NEW;
    END IF;

    -- LA DIRECTION, ET L'ADMINISTRATEUR. Sans contexte applicatif (migration,
    -- script d'administration en psql), la garde s'efface : c'est la convention
    -- des autres gardes par role (fn_trg_inventaire_separation).
    IF v_user IS NOT NULL THEN
        SELECT code_role_user INTO v_role FROM utilisateur WHERE id_utilisateur = v_user;
        IF v_role IS NULL OR v_role NOT IN ('DIRECTION', 'ADMIN') THEN
            RAISE EXCEPTION 'PERIODE : clore ou rouvrir une période revient à la direction.';
        END IF;
    END IF;

    -- ON NE CLOT PAS LE JOUR MEME. Clore aujourd'hui refuserait les mouvements
    -- de la journee en cours ; clore demain, ceux de demain sans raison.
    IF v_nouvelle >= v_aujourdhui THEN
        RAISE EXCEPTION 'PERIODE : on ne clôt que des jours passés ; le % n''est pas encore terminé.',
            to_char(v_nouvelle, 'DD/MM/YYYY');
    END IF;

    -- ROUVRIR EST L'EXCEPTION, ET SE JUSTIFIE. Reculer la date redonne acces a
    -- des mois arretes : le motif reste dans parametre_historique.
    IF v_nouvelle < v_ancienne AND length(btrim(COALESCE(NEW.motif_modif, ''))) < 3 THEN
        RAISE EXCEPTION 'PERIODE : rouvrir la période close jusqu''au % exige un motif.',
            to_char(v_ancienne, 'DD/MM/YYYY');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_parametre_cloture
    BEFORE UPDATE OF valeur_courante ON parametre
    FOR EACH ROW
    WHEN (NEW.code_parametre = 'P_PeriodeCloseJusqua')
    EXECUTE FUNCTION fn_trg_parametre_cloture();

-- ---- 4. Le grand livre refuse d'ecrire dans le passe clos -------------------
CREATE OR REPLACE FUNCTION fn_trg_mouvement_periode_close() RETURNS trigger AS $$
DECLARE
    v_limite date := fn_periode_close_jusqua();
    v_jour   date := fn_date_metier(NEW.date_mouvement);
BEGIN
    IF v_limite IS NOT NULL AND v_jour IS NOT NULL AND v_jour <= v_limite THEN
        RAISE EXCEPTION 'PERIODE-CLOSE : la période jusqu''au % est close, rien ne s''y écrit plus (mouvement du %). Datez-le après la clôture, ou demandez à la direction de rouvrir la période.',
            to_char(v_limite, 'DD/MM/YYYY'), to_char(v_jour, 'DD/MM/YYYY');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mouvement_periode_close
    BEFORE INSERT ON mouvement
    FOR EACH ROW EXECUTE FUNCTION fn_trg_mouvement_periode_close();

-- LES LIGNES AUSSI. `ligne_mouvement` est immuable en modification et en
-- suppression (R03), mais une INSERTION sur un en-tete ancien reste possible :
-- sans cette garde, on pourrait faire entrer du stock dans un mois clos en
-- greffant une ligne a un mouvement de mars. La garantie vaut quel que soit le
-- chemin, pas seulement celui des ecrans.
CREATE OR REPLACE FUNCTION fn_trg_lmvt_periode_close() RETURNS trigger AS $$
DECLARE
    v_limite date := fn_periode_close_jusqua();
    v_jour   date;
BEGIN
    IF v_limite IS NULL OR v_limite <= DATE '2000-01-01' THEN
        RETURN NEW;    -- rien de clos : pas de lecture d'en-tete a chaque ligne
    END IF;
    SELECT fn_date_metier(m.date_mouvement) INTO v_jour
      FROM mouvement m WHERE m.id_mouvement = NEW.id_mouvement;
    IF v_jour IS NOT NULL AND v_jour <= v_limite THEN
        RAISE EXCEPTION 'PERIODE-CLOSE : la période jusqu''au % est close ; on n''ajoute pas de ligne à un mouvement du %.',
            to_char(v_limite, 'DD/MM/YYYY'), to_char(v_jour, 'DD/MM/YYYY');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lmvt_periode_close
    BEFORE INSERT ON ligne_mouvement
    FOR EACH ROW EXECUTE FUNCTION fn_trg_lmvt_periode_close();

-- =============================================================================
-- INVENTAIRE OUVERT : LE GEL (decision du 23/10/2026, migrations 2026-10-23g et 2026-10-24a)
-- =============================================================================
-- Recopie des migrations (23g sections 1 a 4, 24a sections 1 a 4, 24b sections
-- 3 a 6 — la liste d'un tournant ou d'un cible), sans les OWNER TO. Le controle C65 reste dans les migrations, comme les autres
-- controles venus apres C44. Tant qu'un inventaire du magasin est ouvert
-- (BROUILLON ou VALIDE) : un GLOBAL gele tout le magasin ; un TOURNANT ou un
-- CIBLE gele ses seules references (celles de ses lignes, a l'instant du
-- mouvement) — sans aucune ligne, tout le magasin. Seuls passent les
-- ajustements de sa cloture, rattaches par `mouvement.id_inventaire`
-- (domain/inventaire.rs::cloturer).
-- Sur les fichiers d'origine seuls (statut EN_COURS de 008), la garde est inerte :
-- les etats BROUILLON / VALIDE viennent de 2026-10-13b.

-- ---- 1. L'ajustement porte son inventaire --------------------------------------
ALTER TABLE mouvement ADD COLUMN IF NOT EXISTS id_inventaire text REFERENCES inventaire(id_inventaire);
CREATE INDEX IF NOT EXISTS ix_mouvement_inventaire ON mouvement(id_inventaire) WHERE id_inventaire IS NOT NULL;

-- ---- 2. L'inventaire ouvert d'un magasin ---------------------------------------
-- Au plus un (ux_inventaire_ouvert, 2026-10-13b) ; LIMIT 1 si l'index manquait.
CREATE OR REPLACE FUNCTION fn_inventaire_ouvert(p_magasin text) RETURNS text AS $$
    SELECT id_inventaire FROM inventaire
     WHERE code_magasin = p_magasin AND statut IN ('BROUILLON', 'VALIDE')
     ORDER BY date_creation LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ---- 2b. L'étendue du gel d'un inventaire ---------------------------------------
-- Vrai : le gel porte sur ses références (un tournant ou un ciblé qui a sa liste,
-- 2026-10-24b) ; faux : sur tout le magasin (un global, ou un tournant / ciblé sans liste).
CREATE OR REPLACE FUNCTION fn_inventaire_gel_par_reference(p_id text) RETURNS boolean AS $$
    SELECT COALESCE(
        (SELECT i.type_inventaire IN ('TOURNANT', 'CIBLE')
                AND EXISTS (SELECT 1 FROM inventaire_reference s WHERE s.id_inventaire = i.id_inventaire)
           FROM inventaire i WHERE i.id_inventaire = p_id),
        false);
$$ LANGUAGE sql STABLE;

-- La référence est-elle comptée par cet inventaire : choisie, ou sur l'une de ses
-- lignes (les lignes sont dans la liste ; l'union est la prudence).
CREATE OR REPLACE FUNCTION fn_inventaire_compte_reference(p_id text, p_reference text) RETURNS boolean AS $$
    SELECT EXISTS (SELECT 1 FROM inventaire_reference s
                    WHERE s.id_inventaire = p_id AND s.code_reference = p_reference)
        OR EXISTS (SELECT 1 FROM ligne_inventaire li
                    WHERE li.id_inventaire = p_id AND li.code_reference = p_reference);
$$ LANGUAGE sql STABLE;

-- ---- 2c. Les messages ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_inventaire_type_libelle(p_type text) RETURNS text AS $$
    SELECT CASE p_type WHEN 'GLOBAL' THEN 'global' WHEN 'TOURNANT' THEN 'tournant'
                       WHEN 'CIBLE' THEN 'ciblé' ELSE lower(COALESCE(p_type, '?')) END;
$$ LANGUAGE sql IMMUTABLE;

-- Le gel du magasin entier : un global, ou un tournant / ciblé encore sans liste.
CREATE OR REPLACE FUNCTION fn_inventaire_ouvert_message(p_id text) RETURNS text AS $$
    SELECT 'INVENTAIRE-OUVERT : l''inventaire ' || i.numero_inventaire
           || ' (' || fn_inventaire_type_libelle(i.type_inventaire) || ')'
           || ' est ouvert sur le magasin ' || i.code_magasin
           || CASE i.statut WHEN 'VALIDE' THEN ' (comptage validé, à clôturer)' ELSE ' (en comptage)' END
           || CASE WHEN i.type_inventaire IN ('TOURNANT', 'CIBLE')
                   THEN ', encore sans référence choisie (tout le magasin est gelé jusqu''à la validation de sa liste)'
                   ELSE '' END
           || ' : aucun mouvement de stock jusqu''à sa clôture ou son annulation.'
      FROM inventaire i WHERE i.id_inventaire = p_id;
$$ LANGUAGE sql STABLE;

-- Le gel d'une référence : un tournant ou un ciblé qui la compte.
CREATE OR REPLACE FUNCTION fn_inventaire_ouvert_message(p_id text, p_reference text) RETURNS text AS $$
    SELECT 'INVENTAIRE-OUVERT : la référence ' || p_reference
           || ' est comptée par l''inventaire ' || i.numero_inventaire
           || ' (' || fn_inventaire_type_libelle(i.type_inventaire) || ')'
           || ' ouvert sur le magasin ' || i.code_magasin
           || CASE i.statut WHEN 'VALIDE' THEN ' (comptage validé, à clôturer)' ELSE ' (en comptage)' END
           || ' : aucun mouvement de cette référence dans ce magasin jusqu''à sa clôture ou son annulation'
           || ' (les autres références du magasin restent libres).'
      FROM inventaire i WHERE i.id_inventaire = p_id;
$$ LANGUAGE sql STABLE;

-- ---- 3. L'en-tête : refusé seulement pour un gel du magasin entier ----------------
CREATE OR REPLACE FUNCTION fn_trg_mouvement_inventaire_ouvert() RETURNS trigger AS $$
DECLARE
    v_ouvert text;
    v_inv    record;
BEGIN
    -- UN MOUVEMENT RATTACHÉ À UN INVENTAIRE n'est qu'un ajustement de sa clôture.
    IF NEW.id_inventaire IS NOT NULL THEN
        SELECT numero_inventaire, code_magasin, statut INTO v_inv
          FROM inventaire WHERE id_inventaire = NEW.id_inventaire;
        IF NEW.code_type_mvt NOT IN ('AJUST_INV_POS', 'AJUST_INV_NEG')
           OR v_inv.code_magasin IS DISTINCT FROM NEW.code_magasin
           OR v_inv.statut IS DISTINCT FROM 'VALIDE' THEN
            RAISE EXCEPTION 'INVENTAIRE-OUVERT : seul un ajustement (AJUST_INV_POS / AJUST_INV_NEG) du magasin de l''inventaire %, écrit à sa clôture, se rattache à lui (mouvement %, magasin %, inventaire %).',
                COALESCE(v_inv.numero_inventaire, NEW.id_inventaire), NEW.code_type_mvt, NEW.code_magasin,
                lower(COALESCE(v_inv.statut, 'introuvable'));
        END IF;
        -- Un seul ajustement vivant par sens : un second appliquerait deux fois
        -- les écarts. Après une dévalidation, les premiers sont contre-passés.
        IF EXISTS (SELECT 1 FROM mouvement m
                    WHERE m.id_inventaire = NEW.id_inventaire
                      AND m.code_type_mvt = NEW.code_type_mvt
                      AND NOT EXISTS (SELECT 1 FROM mouvement c
                                       WHERE c.id_mouvement_contrepasse = m.id_mouvement)) THEN
            RAISE EXCEPTION 'INVENTAIRE-OUVERT : les ajustements % de l''inventaire % sont déjà écrits.',
                NEW.code_type_mvt, v_inv.numero_inventaire;
        END IF;
        RETURN NEW;
    END IF;

    -- L'en-tête ne porte pas de référence : un gel par référence (tournant, ciblé)
    -- se juge sur chaque ligne (section 4).
    v_ouvert := fn_inventaire_ouvert(NEW.code_magasin);
    IF v_ouvert IS NOT NULL AND NOT fn_inventaire_gel_par_reference(v_ouvert) THEN
        RAISE EXCEPTION '%', fn_inventaire_ouvert_message(v_ouvert);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_01_mouvement_inventaire_ouvert ON mouvement;
CREATE TRIGGER trg_01_mouvement_inventaire_ouvert
    BEFORE INSERT ON mouvement
    FOR EACH ROW EXECUTE FUNCTION fn_trg_mouvement_inventaire_ouvert();

-- ---- 4. Les lignes : la garantie ---------------------------------------------
-- `ligne_mouvement` est la seule écriture qui touche le stock (trg_lmvt_appliquer).
-- Une ligne greffée à un en-tête écrit avant l'ouverture de l'inventaire serait
-- passée sans cette garde. Pour un gel par référence, c'est ici seulement qu'il se juge.
CREATE OR REPLACE FUNCTION fn_trg_lmvt_inventaire_ouvert() RETURNS trigger AS $$
DECLARE
    v_magasin text;
    v_inv_mvt text;
    v_signe   integer;
    v_ouvert  text;
    v_ecarts  bigint;
    v_deja    bigint;
BEGIN
    SELECT m.code_magasin, m.id_inventaire, tm.signe
      INTO v_magasin, v_inv_mvt, v_signe
      FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     WHERE m.id_mouvement = NEW.id_mouvement;

    v_ouvert := fn_inventaire_ouvert(v_magasin);
    IF v_ouvert IS NULL THEN
        RETURN NEW;
    END IF;

    IF v_inv_mvt IS DISTINCT FROM v_ouvert THEN
        -- UN MOUVEMENT ORDINAIRE. Gel du magasin entier : refusé. Gel par
        -- référence : refusé si l'inventaire compte cette référence, à l'instant.
        IF NOT fn_inventaire_gel_par_reference(v_ouvert) THEN
            RAISE EXCEPTION '%', fn_inventaire_ouvert_message(v_ouvert);
        END IF;
        IF fn_inventaire_compte_reference(v_ouvert, NEW.code_reference) THEN
            RAISE EXCEPTION '%', fn_inventaire_ouvert_message(v_ouvert, NEW.code_reference);
        END IF;
        RETURN NEW;
    END IF;

    -- L'AJUSTEMENT DE LA CLÔTURE : chaque ligne est un écart de l'inventaire,
    -- même référence, même lot, même sens, même quantité — et pas plus de fois
    -- que l'inventaire n'en porte.
    SELECT count(*) INTO v_ecarts
      FROM ligne_inventaire li
     WHERE li.id_inventaire = v_ouvert
       AND li.code_reference = NEW.code_reference
       AND li.lot_fournisseur IS NOT DISTINCT FROM NEW.lot_fournisseur
       AND sign(li.ecart_kg) = v_signe
       AND abs(abs(li.ecart_kg) - NEW.quantite_kg) < 0.00005;
    SELECT count(*) INTO v_deja
      FROM ligne_mouvement lm
     WHERE lm.id_mouvement = NEW.id_mouvement
       AND lm.code_reference = NEW.code_reference
       AND lm.lot_fournisseur IS NOT DISTINCT FROM NEW.lot_fournisseur
       AND abs(lm.quantite_kg - NEW.quantite_kg) < 0.00005;
    IF v_ecarts > v_deja THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'INVENTAIRE-OUVERT : % kg de % (%) ne correspond à aucun écart restant de l''inventaire % : un ajustement ne porte que les écarts du comptage.',
        NEW.quantite_kg, NEW.code_reference, COALESCE('lot ' || NEW.lot_fournisseur, 'sans lot'),
        (SELECT numero_inventaire FROM inventaire WHERE id_inventaire = v_ouvert);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_01_lmvt_inventaire_ouvert ON ligne_mouvement;
CREATE TRIGGER trg_01_lmvt_inventaire_ouvert
    BEFORE INSERT ON ligne_mouvement
    FOR EACH ROW EXECUTE FUNCTION fn_trg_lmvt_inventaire_ouvert();

-- ---- 5. La liste d'un tournant ou d'un ciblé (2026-10-24b) --------------------
-- Elle se choisit en brouillon, avant les lignes ; un global n'en a pas.
CREATE OR REPLACE FUNCTION fn_trg_inventaire_reference_garde() RETURNS trigger AS $$
DECLARE
    v_id  text := COALESCE(NEW.id_inventaire, OLD.id_inventaire);
    v_inv record;
BEGIN
    SELECT numero_inventaire, type_inventaire, statut INTO v_inv
      FROM inventaire WHERE id_inventaire = v_id;
    IF NOT FOUND THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'INV-SELECTION : inventaire % introuvable.', v_id;
    END IF;
    IF v_inv.type_inventaire NOT IN ('TOURNANT', 'CIBLE') THEN
        RAISE EXCEPTION 'INV-SELECTION : l''inventaire % est global : il compte tout le magasin, il ne choisit pas ses références.',
            v_inv.numero_inventaire;
    END IF;
    IF v_inv.statut <> 'BROUILLON' THEN
        RAISE EXCEPTION 'INV-SELECTION : l''inventaire % est % : sa liste de références ne change plus.',
            v_inv.numero_inventaire, lower(v_inv.statut);
    END IF;
    IF EXISTS (SELECT 1 FROM ligne_inventaire WHERE id_inventaire = v_id) THEN
        RAISE EXCEPTION 'INV-SELECTION : les lignes de l''inventaire % sont préparées : sa liste de références est figée (pour compter une autre liste, annulez-le et créez-en un autre).',
            v_inv.numero_inventaire;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventaire_reference_garde
    BEFORE INSERT OR UPDATE OR DELETE ON inventaire_reference
    FOR EACH ROW EXECUTE FUNCTION fn_trg_inventaire_reference_garde();

-- (Son journal d'audit, `trg_audit_modification`, reste dans la migration :
-- `fn_trg_audit_modification` n'existe que par les migrations 2026-10-08d et suivantes.)

-- Les lignes d'un tournant ou d'un ciblé : des références de sa liste.
CREATE OR REPLACE FUNCTION fn_trg_ligne_inventaire_selection() RETURNS trigger AS $$
DECLARE
    v_inv record;
BEGIN
    SELECT numero_inventaire, type_inventaire INTO v_inv
      FROM inventaire WHERE id_inventaire = NEW.id_inventaire;
    IF v_inv.type_inventaire IN ('TOURNANT', 'CIBLE')
       AND NOT EXISTS (SELECT 1 FROM inventaire_reference s
                        WHERE s.id_inventaire = NEW.id_inventaire
                          AND s.code_reference = NEW.code_reference) THEN
        IF NOT EXISTS (SELECT 1 FROM inventaire_reference s WHERE s.id_inventaire = NEW.id_inventaire) THEN
            RAISE EXCEPTION 'INV-SELECTION : l''inventaire % (%) n''a aucune référence choisie : choisissez et validez sa liste avant de préparer ses lignes.',
                v_inv.numero_inventaire, fn_inventaire_type_libelle(v_inv.type_inventaire);
        END IF;
        RAISE EXCEPTION 'INV-SELECTION : la référence % n''est pas dans la liste de l''inventaire % (%) : un inventaire tournant ou ciblé ne compte que les références choisies à sa préparation. Comptez-la dans un autre inventaire.',
            NEW.code_reference, v_inv.numero_inventaire, fn_inventaire_type_libelle(v_inv.type_inventaire);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ligne_inventaire_selection
    BEFORE INSERT OR UPDATE OF code_reference, id_inventaire ON ligne_inventaire
    FOR EACH ROW EXECUTE FUNCTION fn_trg_ligne_inventaire_selection();

-- Sans liste, pas de validation ; le type ne change plus une fois liste ou lignes posées.
CREATE OR REPLACE FUNCTION fn_trg_inventaire_selection_validation() RETURNS trigger AS $$
BEGIN
    IF NEW.type_inventaire IS DISTINCT FROM OLD.type_inventaire
       AND (EXISTS (SELECT 1 FROM inventaire_reference WHERE id_inventaire = OLD.id_inventaire)
            OR EXISTS (SELECT 1 FROM ligne_inventaire WHERE id_inventaire = OLD.id_inventaire)) THEN
        RAISE EXCEPTION 'INV-SELECTION : l''inventaire % a sa liste ou ses lignes : son type ne change plus.',
            OLD.numero_inventaire;
    END IF;
    IF NEW.statut = 'VALIDE' AND OLD.statut = 'BROUILLON'
       AND NEW.type_inventaire IN ('TOURNANT', 'CIBLE')
       AND NOT EXISTS (SELECT 1 FROM inventaire_reference WHERE id_inventaire = NEW.id_inventaire) THEN
        RAISE EXCEPTION 'INV-SELECTION : l''inventaire % (%) n''a aucune référence choisie : il ne se valide pas.',
            NEW.numero_inventaire, fn_inventaire_type_libelle(NEW.type_inventaire);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventaire_selection_validation
    BEFORE UPDATE OF statut, type_inventaire ON inventaire
    FOR EACH ROW EXECUTE FUNCTION fn_trg_inventaire_selection_validation();
-- (`fn_comptage_tournant_jours`, `v_inventaire_candidat` — la proposition du
-- tournant — et les parametres P_ComptageTournantA/B/C restent dans la migration
-- 2026-10-24b.)

-- (La vue `v_inventaire_gel`, lue par les écrans, reste dans la migration 2026-10-24a.)
