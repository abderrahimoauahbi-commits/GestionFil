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
                (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
                (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
                (SELECT session_id    FROM _contexte_session WHERE id = 1));
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
                (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
                (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
                (SELECT session_id    FROM _contexte_session WHERE id = 1));
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
                (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
                (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
                (SELECT session_id    FROM _contexte_session WHERE id = 1));
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
                            'magasin_dest',     NEW.code_magasin_destination,
                            'statut',           NEW.statut),
                (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
                (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
                (SELECT session_id    FROM _contexte_session WHERE id = 1));
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
                (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
                (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
                (SELECT session_id    FROM _contexte_session WHERE id = 1));
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
                (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
                (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
                (SELECT session_id    FROM _contexte_session WHERE id = 1));
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
                (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
                (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
                (SELECT session_id    FROM _contexte_session WHERE id = 1));
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
                (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
                (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
                (SELECT session_id    FROM _contexte_session WHERE id = 1));
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
                (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
                (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
                (SELECT session_id    FROM _contexte_session WHERE id = 1));
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
                (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
                (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
                (SELECT session_id    FROM _contexte_session WHERE id = 1));
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
                (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
                (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
                (SELECT session_id    FROM _contexte_session WHERE id = 1));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_fournisseur
AFTER UPDATE ON fournisseur FOR EACH ROW
WHEN (OLD.delai_livraison_jours IS DISTINCT FROM NEW.delai_livraison_jours
  OR OLD.code_devise           IS DISTINCT FROM NEW.code_devise
  OR OLD.actif                 IS DISTINCT FROM NEW.actif)
EXECUTE FUNCTION fn_trg_audit_fournisseur();
