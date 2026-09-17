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

CREATE OR REPLACE FUNCTION fn_trg_audit_immuable_r() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM audit_log WHERE id_audit = NEW.id_audit) THEN
        RAISE EXCEPTION 'R03 : remplacement interdit dans le journal d audit.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_immuable_r
BEFORE INSERT ON audit_log FOR EACH ROW
EXECUTE FUNCTION fn_trg_audit_immuable_r();

CREATE OR REPLACE FUNCTION fn_trg_audit_immuable_u() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Le journal d''''audit est immuable.';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_immuable_u
BEFORE UPDATE ON audit_log FOR EACH ROW
EXECUTE FUNCTION fn_trg_audit_immuable_u();

CREATE OR REPLACE FUNCTION fn_trg_audit_immuable_d() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Suppression interdite dans le journal d''''audit.';
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_immuable_d
BEFORE DELETE ON audit_log FOR EACH ROW
EXECUTE FUNCTION fn_trg_audit_immuable_d();

CREATE OR REPLACE FUNCTION fn_trg_audit_parametre() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('parametre', 'UPDATE', NEW.code_parametre,
                json_build_object('valeur_courante', OLD.valeur_courante),
                json_build_object('valeur_courante', NEW.valeur_courante),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_parametre
AFTER UPDATE ON parametre FOR EACH ROW
WHEN (OLD.valeur_courante IS DISTINCT FROM NEW.valeur_courante)
EXECUTE FUNCTION fn_trg_audit_parametre();

CREATE OR REPLACE FUNCTION fn_trg_audit_reference() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('reference', 'UPDATE', NEW.code_reference,
                json_build_object('prix_catalogue', OLD.prix_catalogue, 'code_fournisseur', OLD.code_fournisseur, 'actif', OLD.actif),
                json_build_object('prix_catalogue', NEW.prix_catalogue, 'code_fournisseur', NEW.code_fournisseur, 'actif', NEW.actif),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_reference
AFTER UPDATE ON reference FOR EACH ROW
WHEN (OLD.prix_catalogue IS DISTINCT FROM NEW.prix_catalogue
  OR OLD.code_fournisseur IS DISTINCT FROM NEW.code_fournisseur
  OR OLD.actif IS DISTINCT FROM NEW.actif)
EXECUTE FUNCTION fn_trg_audit_reference();

CREATE OR REPLACE FUNCTION fn_trg_audit_bc_statut() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('bon_commande', 'UPDATE', NEW.id_bc,
                json_build_object('statut', OLD.statut),
                json_build_object('statut', NEW.statut, 'montant_total_mad', NEW.montant_total_mad,
                            'id_utilisateur_validation', NEW.id_utilisateur_validation),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_bc_statut
AFTER UPDATE OF statut ON bon_commande FOR EACH ROW
WHEN (OLD.statut IS DISTINCT FROM NEW.statut)
EXECUTE FUNCTION fn_trg_audit_bc_statut();

CREATE OR REPLACE FUNCTION fn_trg_audit_reception_statut() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('reception', 'UPDATE', NEW.id_reception,
                json_build_object('statut', OLD.statut),
                json_build_object('statut', NEW.statut, 'id_utilisateur_controle', NEW.id_utilisateur_controle),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_reception_statut
AFTER UPDATE OF statut ON reception FOR EACH ROW
WHEN (OLD.statut IS DISTINCT FROM NEW.statut)
EXECUTE FUNCTION fn_trg_audit_reception_statut();

CREATE OR REPLACE FUNCTION fn_trg_audit_qualite_statut() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('qualite', 'UPDATE', NEW.code_qualite,
                json_build_object('statut', OLD.statut),
                json_build_object('statut', NEW.statut, 'nom', NEW.nom),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_qualite_statut
AFTER UPDATE OF statut ON qualite FOR EACH ROW
WHEN (OLD.statut IS DISTINCT FROM NEW.statut)
EXECUTE FUNCTION fn_trg_audit_qualite_statut();

CREATE OR REPLACE FUNCTION fn_trg_audit_plan_statut() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('plan_production', 'UPDATE', NEW.id_plan,
                json_build_object('statut', OLD.statut),
                json_build_object('statut', NEW.statut, 'annee', NEW.annee, 'numero_version', NEW.numero_version),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_plan_statut
AFTER UPDATE OF statut ON plan_production FOR EACH ROW
WHEN (OLD.statut IS DISTINCT FROM NEW.statut)
EXECUTE FUNCTION fn_trg_audit_plan_statut();

CREATE OR REPLACE FUNCTION fn_trg_audit_utilisateur() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('utilisateur', 'UPDATE', NEW.id_utilisateur,
                json_build_object('code_role_user', OLD.code_role_user, 'actif', OLD.actif),
                json_build_object('code_role_user', NEW.code_role_user, 'actif', NEW.actif),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_utilisateur
AFTER UPDATE ON utilisateur FOR EACH ROW
WHEN (OLD.code_role_user IS DISTINCT FROM NEW.code_role_user OR OLD.actif IS DISTINCT FROM NEW.actif)
EXECUTE FUNCTION fn_trg_audit_utilisateur();

CREATE OR REPLACE FUNCTION fn_trg_audit_droit_champ_i() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               nouvelles_valeurs, id_utilisateur, adresse_ip, session_id)
        VALUES ('droit_champ', 'INSERT', NEW.id_utilisateur,
                json_build_object('module', NEW.module, 'champ', NEW.champ, 'niveau', NEW.niveau),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_droit_champ_i
AFTER INSERT ON droit_champ FOR EACH ROW
EXECUTE FUNCTION fn_trg_audit_droit_champ_i();

CREATE OR REPLACE FUNCTION fn_trg_audit_droit_champ_u() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('droit_champ', 'UPDATE', NEW.id_utilisateur,
                json_build_object('module', NEW.module, 'champ', NEW.champ, 'niveau', OLD.niveau),
                json_build_object('module', NEW.module, 'champ', NEW.champ, 'niveau', NEW.niveau),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_droit_champ_u
AFTER UPDATE OF niveau ON droit_champ FOR EACH ROW
WHEN (OLD.niveau IS DISTINCT FROM NEW.niveau)
EXECUTE FUNCTION fn_trg_audit_droit_champ_u();

CREATE OR REPLACE FUNCTION fn_trg_audit_permission_i() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               nouvelles_valeurs, id_utilisateur, adresse_ip, session_id)
        VALUES ('permission', 'INSERT', NEW.id_permission,
                json_build_object('role', NEW.code_role_user, 'module', NEW.module, 'action', NEW.action),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_permission_i
AFTER INSERT ON permission FOR EACH ROW
EXECUTE FUNCTION fn_trg_audit_permission_i();

CREATE OR REPLACE FUNCTION fn_trg_audit_permission_d() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, id_utilisateur, adresse_ip, session_id)
        VALUES ('permission', 'DELETE', OLD.id_permission,
                json_build_object('role', OLD.code_role_user, 'module', OLD.module, 'action', OLD.action),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_permission_d
AFTER DELETE ON permission FOR EACH ROW
EXECUTE FUNCTION fn_trg_audit_permission_d();

CREATE OR REPLACE FUNCTION fn_trg_audit_mouvement() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('mouvement', 'INSERT', NEW.id_mouvement,
                NULL,
                json_build_object('numero_mouvement', NEW.numero_mouvement,
                            'code_type_mvt',    NEW.code_type_mvt,
                            'code_magasin',     NEW.code_magasin,
                            'date_mouvement',   NEW.date_mouvement,
                            'auteur_declare',   NEW.id_utilisateur),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_mouvement
AFTER INSERT ON mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_audit_mouvement();

CREATE OR REPLACE FUNCTION fn_trg_audit_inventaire_i() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('inventaire', 'INSERT', NEW.id_inventaire,
                NULL,
                json_build_object('numero_inventaire', NEW.numero_inventaire,
                            'code_magasin',      NEW.code_magasin,
                            'type_inventaire',   NEW.type_inventaire,
                            'statut',            NEW.statut),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_inventaire_i
AFTER INSERT ON inventaire FOR EACH ROW
EXECUTE FUNCTION fn_trg_audit_inventaire_i();

CREATE OR REPLACE FUNCTION fn_trg_audit_inventaire_statut() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('inventaire', 'UPDATE', NEW.id_inventaire,
                json_build_object('statut', OLD.statut),
                json_build_object('statut', NEW.statut, 'numero_inventaire', NEW.numero_inventaire),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_inventaire_statut
AFTER UPDATE OF statut ON inventaire FOR EACH ROW
WHEN (OLD.statut IS DISTINCT FROM NEW.statut)
EXECUTE FUNCTION fn_trg_audit_inventaire_statut();

CREATE OR REPLACE FUNCTION fn_trg_audit_transfert_i() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('transfert', 'INSERT', NEW.id_transfert,
                NULL,
                json_build_object('numero_transfert', NEW.numero_transfert,
                            'magasin_source',   NEW.code_magasin_source,
                            'magasin_dest',     NEW.code_magasin_dest,
                            'statut',           NEW.statut),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_transfert_i
AFTER INSERT ON transfert FOR EACH ROW
EXECUTE FUNCTION fn_trg_audit_transfert_i();

CREATE OR REPLACE FUNCTION fn_trg_audit_transfert_statut() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('transfert', 'UPDATE', NEW.id_transfert,
                json_build_object('statut', OLD.statut),
                json_build_object('statut', NEW.statut, 'numero_transfert', NEW.numero_transfert),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_transfert_statut
AFTER UPDATE OF statut ON transfert FOR EACH ROW
WHEN (OLD.statut IS DISTINCT FROM NEW.statut)
EXECUTE FUNCTION fn_trg_audit_transfert_statut();

CREATE OR REPLACE FUNCTION fn_trg_audit_plan_achat_figement() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('plan_achat', 'UPDATE', NEW.id_proposition,
                json_build_object('figee', OLD.figee, 'quantite_suggeree_kg', OLD.quantite_suggeree_kg),
                json_build_object('figee', NEW.figee, 'quantite_suggeree_kg', NEW.quantite_suggeree_kg,
                            'code_reference', NEW.code_reference, 'motif', NEW.motif_figement),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_plan_achat_figement
AFTER UPDATE OF figee ON plan_achat FOR EACH ROW
WHEN (OLD.figee IS DISTINCT FROM NEW.figee)
EXECUTE FUNCTION fn_trg_audit_plan_achat_figement();

CREATE OR REPLACE FUNCTION fn_trg_audit_recette_i() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('recette', 'INSERT', NEW.id_recette,
                NULL,
                json_build_object('code_qualite', NEW.code_qualite, 'code_reference', NEW.code_reference,
                            'code_role', NEW.code_role, 'pourcentage', NEW.pourcentage_composition),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_recette_i
AFTER INSERT ON recette FOR EACH ROW
EXECUTE FUNCTION fn_trg_audit_recette_i();

CREATE OR REPLACE FUNCTION fn_trg_audit_recette_u() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('recette', 'UPDATE', NEW.id_recette,
                json_build_object('code_reference', OLD.code_reference,
                            'pourcentage', OLD.pourcentage_composition),
                json_build_object('code_qualite', NEW.code_qualite, 'code_reference', NEW.code_reference,
                            'pourcentage', NEW.pourcentage_composition),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_recette_u
AFTER UPDATE ON recette FOR EACH ROW
WHEN (OLD.pourcentage_composition IS DISTINCT FROM NEW.pourcentage_composition
  OR OLD.code_reference IS DISTINCT FROM NEW.code_reference)
EXECUTE FUNCTION fn_trg_audit_recette_u();

CREATE OR REPLACE FUNCTION fn_trg_audit_recette_d() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('recette', 'DELETE', OLD.id_recette,
                json_build_object('code_qualite', OLD.code_qualite, 'code_reference', OLD.code_reference,
                            'code_role', OLD.code_role, 'pourcentage', OLD.pourcentage_composition),
                NULL,
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_recette_d
AFTER DELETE ON recette FOR EACH ROW
EXECUTE FUNCTION fn_trg_audit_recette_d();

CREATE OR REPLACE FUNCTION fn_trg_audit_ligne_qualite() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('ligne_qualite', 'UPDATE', NEW.code_qualite || '/' || NEW.code_role,
                json_build_object('densite', OLD.densite),
                json_build_object('densite', NEW.densite, 'unite_densite', NEW.unite_densite),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_ligne_qualite
AFTER UPDATE OF densite ON ligne_qualite FOR EACH ROW
WHEN (OLD.densite IS DISTINCT FROM NEW.densite)
EXECUTE FUNCTION fn_trg_audit_ligne_qualite();

CREATE OR REPLACE FUNCTION fn_trg_audit_fournisseur() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('fournisseur', 'UPDATE', NEW.code_fournisseur,
                json_build_object('delai_livraison_jours', OLD.delai_livraison_jours,
                            'code_devise', OLD.code_devise, 'actif', OLD.actif),
                json_build_object('delai_livraison_jours', NEW.delai_livraison_jours,
                            'code_devise', NEW.code_devise, 'actif', NEW.actif),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_fournisseur
AFTER UPDATE ON fournisseur FOR EACH ROW
WHEN (OLD.delai_livraison_jours IS DISTINCT FROM NEW.delai_livraison_jours
  OR OLD.code_devise           IS DISTINCT FROM NEW.code_devise
  OR OLD.actif                 IS DISTINCT FROM NEW.actif)
EXECUTE FUNCTION fn_trg_audit_fournisseur();
