-- =============================================================================
-- ERP GESTION FIL — audit des operations de stock, d'inventaire et de plan
-- -----------------------------------------------------------------------------
-- CE QUI MANQUAIT. Onze declencheurs d'audit couvraient huit tables : les bons
-- de commande, les receptions, les qualites, les plans, les parametres, les
-- comptes et les droits. Douze tables metier n'en portaient aucun — dont le
-- grand livre des mouvements, les inventaires et les transferts.
--
-- L'IMMUABILITE N'EST PAS LA TRACABILITE. Le grand livre est deja protege par
-- R03 : aucun UPDATE, aucun DELETE, aucun INSERT OR REPLACE. Rien ne peut donc
-- etre modifie apres coup. Mais rien ne disait QUI avait saisi la ligne depuis
-- l'ecran : `mouvement.id_utilisateur` porte l'auteur declare, pas la session
-- qui a ecrit. Sur un poste partage au quai, c'est la difference entre savoir
-- et supposer.
--
-- POURQUOI SUR L'INSERT ET NON SUR L'UPDATE. Pour les tables immuables, la
-- creation est le seul evenement : l'auditer suffit. Pour les autres —
-- inventaires, plan d'achat — c'est le changement d'etat qui compte, et on
-- audite alors la transition plutot que chaque retouche de champ.
--
-- CE QUI N'EST PAS AUDITE, ET POURQUOI. `stock_magasin` et `stock_lot` sont
-- des soldes recalcules par le declencheur d'application : ils n'ont pas
-- d'auteur propre, et les auditer doublerait chaque mouvement d'une ligne sans
-- information nouvelle. Le mouvement qui les a fait bouger, lui, est audite.
-- `besoin_mrp` est integralement reconstruit a chaque recalcul : c'est le
-- recalcul qui merite une trace, pas ses milliers de lignes.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Le grand livre des mouvements
-- -----------------------------------------------------------------------------
-- Une seule ligne d'audit par mouvement, sur l'entete. Auditer aussi chaque
-- ligne de detail multiplierait le journal par le nombre d'articles pour
-- redire la meme session.

DROP TRIGGER IF EXISTS trg_audit_mouvement;
CREATE TRIGGER trg_audit_mouvement
AFTER INSERT ON mouvement FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('mouvement', 'INSERT', NEW.id_mouvement,
            NULL,
            json_object('numero_mouvement', NEW.numero_mouvement,
                        'code_type_mvt',    NEW.code_type_mvt,
                        'code_magasin',     NEW.code_magasin,
                        'date_mouvement',   NEW.date_mouvement,
                        'auteur_declare',   NEW.id_utilisateur),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;


-- -----------------------------------------------------------------------------
-- 2. Les inventaires
-- -----------------------------------------------------------------------------
-- Deux moments comptent : l'ouverture, qui gele un magasin, et la cloture, qui
-- genere les ajustements. Le comptage ligne a ligne se relit dans l'inventaire
-- lui-meme et n'a pas besoin du journal.

DROP TRIGGER IF EXISTS trg_audit_inventaire_i;
CREATE TRIGGER trg_audit_inventaire_i
AFTER INSERT ON inventaire FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('inventaire', 'INSERT', NEW.id_inventaire,
            NULL,
            json_object('numero_inventaire', NEW.numero_inventaire,
                        'code_magasin',      NEW.code_magasin,
                        'type_inventaire',   NEW.type_inventaire,
                        'statut',            NEW.statut),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;

DROP TRIGGER IF EXISTS trg_audit_inventaire_statut;
CREATE TRIGGER trg_audit_inventaire_statut
AFTER UPDATE OF statut ON inventaire FOR EACH ROW
WHEN OLD.statut IS NOT NEW.statut
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('inventaire', 'UPDATE', NEW.id_inventaire,
            json_object('statut', OLD.statut),
            json_object('statut', NEW.statut, 'numero_inventaire', NEW.numero_inventaire),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;


-- -----------------------------------------------------------------------------
-- 3. Les transferts entre magasins
-- -----------------------------------------------------------------------------
-- Le transfert est en deux temps : la marchandise sort d'un magasin, puis entre
-- dans l'autre. Entre les deux elle n'est nulle part — c'est la periode ou une
-- disparition ne se voit pas. Chaque changement d'etat est donc trace.

DROP TRIGGER IF EXISTS trg_audit_transfert_i;
CREATE TRIGGER trg_audit_transfert_i
AFTER INSERT ON transfert FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('transfert', 'INSERT', NEW.id_transfert,
            NULL,
            json_object('numero_transfert', NEW.numero_transfert,
                        'magasin_source',   NEW.code_magasin_source,
                        'magasin_dest',     NEW.code_magasin_destination,
                        'statut',           NEW.statut),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;

DROP TRIGGER IF EXISTS trg_audit_transfert_statut;
CREATE TRIGGER trg_audit_transfert_statut
AFTER UPDATE OF statut ON transfert FOR EACH ROW
WHEN OLD.statut IS NOT NEW.statut
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('transfert', 'UPDATE', NEW.id_transfert,
            json_object('statut', OLD.statut),
            json_object('statut', NEW.statut, 'numero_transfert', NEW.numero_transfert),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;


-- -----------------------------------------------------------------------------
-- 4. Le plan d'achat
-- -----------------------------------------------------------------------------
-- Le recalcul rase et reconstruit les propositions : l'auditer ligne a ligne
-- noierait le journal. Ce qui merite une trace, c'est l'INTERVENTION HUMAINE —
-- figer une proposition, la retoucher, la basculer sur un equivalent. Ce sont
-- les seuls moments ou quelqu'un s'ecarte du calcul, et donc les seuls a
-- expliquer plus tard.

DROP TRIGGER IF EXISTS trg_audit_plan_achat_figement;
CREATE TRIGGER trg_audit_plan_achat_figement
AFTER UPDATE OF figee ON plan_achat FOR EACH ROW
WHEN OLD.figee IS NOT NEW.figee
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('plan_achat', 'UPDATE', NEW.id_proposition,
            json_object('figee', OLD.figee, 'quantite_suggeree_kg', OLD.quantite_suggeree_kg),
            json_object('figee', NEW.figee, 'quantite_suggeree_kg', NEW.quantite_suggeree_kg,
                        'code_reference', NEW.code_reference, 'motif', NEW.motif_figement),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;


-- -----------------------------------------------------------------------------
-- 5. Les recettes et les densites
-- -----------------------------------------------------------------------------
-- Une composition decide de ce qu'on achete pour douze mois. La modifier
-- deplace des centaines de milliers de dirhams de besoin sans qu'aucun
-- mouvement ne soit saisi : c'est l'ecriture la plus lourde de consequences de
-- tout l'ERP, et elle n'etait pas tracee.

DROP TRIGGER IF EXISTS trg_audit_recette_i;
CREATE TRIGGER trg_audit_recette_i
AFTER INSERT ON recette FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('recette', 'INSERT', NEW.id_recette,
            NULL,
            json_object('code_qualite', NEW.code_qualite, 'code_reference', NEW.code_reference,
                        'code_role', NEW.code_role, 'pourcentage', NEW.pourcentage_composition),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;

DROP TRIGGER IF EXISTS trg_audit_recette_u;
CREATE TRIGGER trg_audit_recette_u
AFTER UPDATE ON recette FOR EACH ROW
WHEN OLD.pourcentage_composition IS NOT NEW.pourcentage_composition
  OR OLD.code_reference IS NOT NEW.code_reference
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('recette', 'UPDATE', NEW.id_recette,
            json_object('code_reference', OLD.code_reference,
                        'pourcentage', OLD.pourcentage_composition),
            json_object('code_qualite', NEW.code_qualite, 'code_reference', NEW.code_reference,
                        'pourcentage', NEW.pourcentage_composition),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;

DROP TRIGGER IF EXISTS trg_audit_recette_d;
CREATE TRIGGER trg_audit_recette_d
AFTER DELETE ON recette FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('recette', 'DELETE', OLD.id_recette,
            json_object('code_qualite', OLD.code_qualite, 'code_reference', OLD.code_reference,
                        'code_role', OLD.code_role, 'pourcentage', OLD.pourcentage_composition),
            NULL,
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;

DROP TRIGGER IF EXISTS trg_audit_ligne_qualite;
CREATE TRIGGER trg_audit_ligne_qualite
AFTER UPDATE OF densite ON ligne_qualite FOR EACH ROW
WHEN OLD.densite IS NOT NEW.densite
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('ligne_qualite', 'UPDATE', NEW.code_qualite || '/' || NEW.code_role,
            json_object('densite', OLD.densite),
            json_object('densite', NEW.densite, 'unite_densite', NEW.unite_densite),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;


-- -----------------------------------------------------------------------------
-- 6. Les fournisseurs
-- -----------------------------------------------------------------------------
-- Le delai et la devise entrent dans le calcul de couverture et dans la
-- valorisation. Les changer deplace les alertes de toute une famille de
-- references sans qu'on sache pourquoi, si rien ne le note.

DROP TRIGGER IF EXISTS trg_audit_fournisseur;
CREATE TRIGGER trg_audit_fournisseur
AFTER UPDATE ON fournisseur FOR EACH ROW
WHEN OLD.delai_livraison_jours IS NOT NEW.delai_livraison_jours
  OR OLD.code_devise           IS NOT NEW.code_devise
  OR OLD.actif                 IS NOT NEW.actif
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('fournisseur', 'UPDATE', NEW.code_fournisseur,
            json_object('delai_livraison_jours', OLD.delai_livraison_jours,
                        'code_devise', OLD.code_devise, 'actif', OLD.actif),
            json_object('delai_livraison_jours', NEW.delai_livraison_jours,
                        'code_devise', NEW.code_devise, 'actif', NEW.actif),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;
