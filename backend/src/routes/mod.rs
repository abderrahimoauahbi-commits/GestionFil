//! Routage HTTP.
//!
//! Trois familles :
//!   * `entites`     — CRUD generique, pilote par le registre `crate::crud`
//!   * `production`  — entites a workflow (qualites, recettes, plans)
//!   * `operations`  — cascades et calculs (MRP, reception, transfert, ...)

mod admin;
mod assistant;
mod auth_routes;
mod consultation;
mod entites;
pub(crate) mod json;
mod operations;
mod production;
mod referentiels;
mod stock;

use crate::state::AppState;
use axum::routing::{delete, get, patch, post, put};
use axum::Router;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

pub fn router(state: AppState) -> Router {
    let origines: Vec<_> = state
        .config
        .cors_origins
        .iter()
        .filter_map(|o| o.parse::<axum::http::HeaderValue>().ok())
        .collect();

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origines))
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PUT,
            axum::http::Method::PATCH,
            axum::http::Method::DELETE,
        ])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
        ]);

    Router::new()
        .route("/api/sante", get(consultation::sante))
        // --- Assistant de direction (lecture seule, role DIRECTION) -----------
        .route("/api/assistant", get(assistant::catalogue))
        .route("/api/assistant/{id}", get(assistant::repondre))
        // --- Authentification -------------------------------------------------
        .route("/api/auth/connexion", post(auth_routes::connexion))
        .route("/api/auth/moi", get(auth_routes::moi))
        // --- Administration ---------------------------------------------------
        .route("/api/admin/utilisateurs",
               get(admin::lister_utilisateurs).post(admin::creer_utilisateur))
        .route("/api/admin/utilisateurs/{id}", patch(admin::modifier_utilisateur))
        .route("/api/admin/utilisateurs/{id}/droits",
               get(admin::lire_droits).put(admin::enregistrer_droits))
        .route("/api/admin/utilisateurs/{id}/droits/appliquer-modele",
               post(admin::appliquer_modele_role))
        .route("/api/admin/sauvegardes",
             get(admin::lister_sauvegardes).post(admin::sauvegarder))
        .route("/api/admin/champs", get(admin::lister_champs))
        .route("/api/admin/roles", get(admin::lister_roles))
        .route("/api/admin/registre", get(entites::registre))
        // --- Referentiels a traitement particulier ----------------------------
        .route("/api/devises", get(referentiels::devises))
        .route("/api/devises/{code}/taux",
               get(referentiels::taux_change).post(referentiels::creer_taux))
        .route("/api/parametres", get(referentiels::parametres))
        .route(
            "/api/transitions",
            get(referentiels::transitions)
                .post(referentiels::creer_transition)
                .patch(referentiels::modifier_transition)
                .delete(referentiels::supprimer_transition),
        )
        .route("/api/roles-utilisateur", get(referentiels::roles_utilisateur))
        .route("/api/parametres/{code}", patch(referentiels::modifier_parametre))
        .route("/api/parametres/{code}/historique", get(referentiels::historique_parametre))
        // --- Production -------------------------------------------------------
        // PUT enregistre l'entete ET les lignes en une transaction : c'est le
        // mode de saisie normal. POST/PATCH restent pour les appels cibles.
        .route("/api/qualites",
               get(production::lister_qualites)
                   .post(production::creer_qualite)
                   .put(production::enregistrer_qualite))
        .route("/api/qualites/{code}",
               patch(production::modifier_qualite).delete(production::supprimer_qualite))
        .route("/api/qualites/{code}/cloturer", post(production::cloturer_qualite))
        .route("/api/qualites/{code}/densites",
               get(production::lister_densites).put(production::definir_densite))
        .route("/api/qualites/{code}/densites/{role}", delete(production::supprimer_densite))
        // La composition appartient a la qualite : elle s'enregistre avec elle
        // (PUT /api/qualites). Ici, seule la lecture.
        .route("/api/qualites/{code}/composition", get(production::composition_qualite))
        // Vue transversale : ou telle matiere est-elle employee ?
        .route("/api/recettes", get(production::lister_recettes))
        .route("/api/plans",
               get(production::lister_plans)
                   .post(production::creer_plan)
                   .put(production::enregistrer_plan))
        .route("/api/plans/qualites-disponibles", get(production::qualites_disponibles))
        .route("/api/plans/{id}", delete(production::supprimer_plan))
        .route("/api/plans/{id}/entete", get(production::entete_plan))
        .route("/api/plans/{id}/cloturer", post(production::cloturer_plan))
        .route("/api/plans/{id}/recalculer", post(production::recalculer_plan))
        .route("/api/plans/{id}/production-besoins", get(consultation::production_besoins))
        // Lecture seule : la grille se deduit de l'entete (PUT /api/plans) et se
        // refait par /recalculer. La saisir a la main la ferait diverger de sa
        // propre formule des que la base, un coefficient ou la croissance change.
        .route("/api/plans/{id}/lignes", get(production::lignes_plan))
        .route("/api/plans/{id}/statut", put(production::changer_statut_plan))
        .route("/api/plans/{id}/figer-recettes", post(operations::figer_recettes))
        .route("/api/plans/{id}/mrp", post(operations::calculer_mrp))
        .route("/api/plans/{id}/snapshot", post(operations::snapshot_mrp))
        .route("/api/plans/{id}/besoins", get(consultation::besoins_mrp))
        // --- Stock et mouvements ----------------------------------------------
        .route("/api/mouvements",
               get(consultation::mouvements).post(stock::creer_mouvement))
        .route("/api/transferts",
               get(stock::lister_transferts).post(stock::creer_transfert))
        .route("/api/transferts/{id}/lignes", post(stock::ajouter_ligne_transfert))
        .route(
            "/api/transferts/{id}",
            get(stock::dossier_transfert)
                .put(stock::modifier_transfert)
                .delete(stock::annuler_transfert),
        )
        .route("/api/transferts/{id}/expedier", post(operations::expedier_transfert))
        .route(
            "/api/transferts/{id}/receptionner",
            post(operations::receptionner_transfert),
        )
        // Alias historique : l'expedition etait appelee « validation ».
        .route("/api/transferts/{id}/valider", post(operations::expedier_transfert))
        .route("/api/inventaires",
               get(stock::lister_inventaires).post(stock::creer_inventaire))
        .route("/api/inventaires/{id}/lignes",
               get(stock::lignes_inventaire).put(stock::saisir_comptage))
        .route("/api/inventaires/{id}/ouvrir", post(operations::ouvrir_inventaire))
        .route("/api/inventaires/{id}/cloturer", post(operations::cloturer_inventaire))
        // --- Achats et receptions ---------------------------------------------
        .route("/api/bons-commande",
               get(stock::lister_bc).post(stock::creer_bc))
        .route("/api/bons-commande/{id}", patch(stock::modifier_bc))
        // Sans `{id}` : la liste sert AUSSI a la creation, quand le bon n'existe
        // pas encore et qu'on vient de choisir le fournisseur.
        .route("/api/references-commandables", get(stock::references_commandables))
        .route("/api/bons-commande/{id}/lignes",
               get(stock::lignes_bc).post(stock::ajouter_ligne_bc))
        .route("/api/bons-commande/{id}/lignes/{ligne}",
               patch(stock::modifier_ligne_bc).delete(stock::supprimer_ligne_bc))
        .route("/api/bons-commande/{id}/statut", put(stock::changer_statut_bc))
        .route("/api/receptions",
               get(stock::lister_receptions).post(stock::creer_reception))
        .route("/api/receptions/{id}", patch(stock::modifier_reception))
        // Sans `{id}` : sert aussi a la creation, quand la reception n'existe pas
        // encore et qu'on vient de designer le bon de commande.
        .route("/api/lignes-attendues", get(stock::lignes_attendues))
        .route("/api/receptions/{id}/lignes",
               get(stock::lignes_reception).post(stock::ajouter_ligne_reception))
        .route("/api/receptions/{id}/lignes/{ligne}", delete(stock::supprimer_ligne_reception))
        .route("/api/receptions/{id}/statut", put(stock::changer_statut_reception))
        .route("/api/receptions/{id}/valider", post(operations::valider_reception))
        .route("/api/plan-achat", get(consultation::plan_achat))
        .route("/api/plan-achat/generer", post(operations::generer_plan_achat))
        .route("/api/plan-achat/commander", post(operations::convertir_plan_achat))
        .route("/api/plan-achat/kpi", get(consultation::kpi_plan_achat))
        .route("/api/historique-prix", get(consultation::historique_prix))
        .route("/api/matrice-prix", get(consultation::matrice_prix))
        .route("/api/plan-achat/propositions", get(consultation::propositions_achat))
        .route("/api/plan-achat/propositions/{id}", patch(consultation::modifier_proposition))
        .route("/api/plan-achat/propositions/{id}/ignorer",
               post(consultation::ignorer_proposition))
        // Figer protege du recalcul ; defiger rend la ligne au calcul.
        .route("/api/plan-achat/propositions/{id}/figer",
               post(consultation::figer_proposition)
                   .delete(consultation::defiger_proposition))
        // --- Consultation -----------------------------------------------------
        .route("/api/cockpit", get(consultation::cockpit))
        .route("/api/cockpit/risques", get(consultation::risques_rupture))
        .route("/api/cockpit/analyse", get(consultation::cockpit_analyse))
        .route("/api/stats/mouvements", get(consultation::stats_mouvements))
        .route("/api/stats/prix", get(consultation::stats_prix))
        .route("/api/stats/fournisseurs", get(consultation::stats_fournisseurs))
        .route("/api/stats/qualites", get(consultation::stats_qualites))
        .route("/api/controles", get(consultation::controles))
        .route("/api/controles/{code}", get(consultation::controle_detail))
        .route("/api/fournisseurs/scorecard", get(consultation::scorecard))
        .route("/api/stock", get(consultation::stock))
        .route("/api/stock/projete", get(consultation::stock_projete))
        .route("/api/stock/dormant", get(consultation::stock_dormant))
        .route("/api/stock/lots", get(consultation::lots))
        .route("/api/substitutions", get(consultation::substitutions))
        .route("/api/equivalences", get(consultation::equivalences))
        .route(
            "/api/plan-achat/{id}/substituer",
            post(consultation::substituer_proposition),
        )
        .route("/api/groupes-equivalence", get(consultation::groupes_equivalence))
        .route(
            "/api/groupes-equivalence/{code}/ordre",
            put(consultation::reordonner_groupe),
        )
        .route("/api/audit", get(consultation::audit))
        .route("/api/classification", post(operations::classifier))
        // Doit preceder la route generique /api/{entite}/{id}.
        .route("/api/catalogue/{code}/usages", get(consultation::usages_reference))
        .route("/api/catalogue/{code}/definitivement",
               axum::routing::delete(operations::supprimer_reference_definitivement))
        // --- CRUD generique ---------------------------------------------------
        // Enregistre en dernier : les segments statiques ci-dessus ont priorite
        // sur ce motif dynamique.
        .route("/api/{entite}",
               get(entites::lister).post(entites::creer))
        .route("/api/{entite}/{id}",
               get(entites::lire).patch(entites::modifier).delete(entites::supprimer))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}
