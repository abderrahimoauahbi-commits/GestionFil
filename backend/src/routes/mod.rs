//! Routage HTTP.
//!
//! Trois familles :
//!   * `entites`     — CRUD generique, pilote par le registre `crate::crud`
//!   * `production`  — entites a workflow (qualites, recettes, plans)
//!   * `operations`  — cascades et calculs (MRP, reception, transfert, ...)

mod admin;
mod assistant;
mod briefing;
mod completion;
mod auth_routes;
mod consultation;
mod devalidation;
mod entites;
mod importation;
mod machines;
pub(crate) mod json;
mod operations;
pub mod pieces;
mod production;
mod referentiels;
mod stock;
mod telechargements;

use crate::state::AppState;
use axum::routing::{delete, get, patch, post, put};
use axum::{Json, Router};
use serde_json::json;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

/// UNE ADRESSE D'API SANS ROUTE DOIT LE DIRE.
///
/// Sans ce filet, un appel vers une route disparue ne rencontre aucune route et
/// tombe sur le service de fichiers, qui repond 405 a tout ce qui n'est pas un
/// GET. C'est le cas le plus courant apres une mise a jour : l'ecran garde en
/// cache par le navigateur appelle l'adresse d'hier, et l'utilisateur lit
/// « erreur 405 » sans rien pour la comprendre.
///
/// Le filtre ne touche QUE `/api/...` : le reste appartient a l'interface.
async fn nommer_route_inconnue(
    requete: axum::extract::Request,
    suite: axum::middleware::Next,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let chemin = requete.uri().path().to_string();
    let est_api = chemin.starts_with("/api/");
    let reponse = suite.run(requete).await;
    if est_api && reponse.status() == axum::http::StatusCode::METHOD_NOT_ALLOWED {
        return (
            axum::http::StatusCode::METHOD_NOT_ALLOWED,
            Json(json!({
                "code": "ROUTE_INCONNUE",
                "message": format!(
                    "L'adresse {chemin} n'existe pas, ou pas pour cette action. \
                     Rechargez la page avec Ctrl+F5 : l'écran affiché est probablement \
                     une ancienne version gardée en cache."
                ),
            })),
        )
            .into_response();
    }
    reponse
}

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

    // L'interface, quand elle est deployee a cote du serveur.
    //
    // LE REPLI SUR index.html EST INDISPENSABLE, et c'est le piege classique :
    // l'application tient sa navigation cote client. Un utilisateur qui recharge
    // la page sur /plans/12 demande au serveur un fichier `plans/12` qui n'existe
    // pas ; sans repli il obtient 404 au lieu de son ecran. `not_found_service`
    // renvoie index.html, et le routeur du navigateur reprend la main.
    //
    // Il ne masque jamais l'API : ces routes sont enregistrees avant, et Axum
    // sert la plus specifique.
    let interface = state.config.frontend_dir.clone();

    let routeur = Router::new()
        .route("/api/sante", get(consultation::sante))
        // L'identite de l'entreprise : pied de page et etats imprimes.
        .route("/api/entreprise", get(consultation::entreprise))
        // CE QUI S'EST PASSE : le fil de la page d'accueil.
        .route("/api/actualite", get(consultation::actualite))
        // --- Paquets clients ---------------------------------------------------
        // La LISTE et le TELECHARGEMENT sont ouverts a tout compte connecte :
        // refuser a un magasinier de reinstaller son poste ne protege rien. Le
        // JOURNAL nomme des personnes, il reste dans PARAMETRES.
        .route("/api/telechargements", get(telechargements::lister))
        .route("/api/telechargements/journal",
               get(telechargements::journal).post(telechargements::inscrire))
        // CE QUI EXISTE DE PLUS RECENT. L'application de bureau embarque son
        // interface et se fige au jour de son installation ; sans cette route,
        // un poste installe en septembre ne saurait jamais qu'il a vieilli.
        .route("/api/mise-a-jour", get(telechargements::mise_a_jour))
        // LE POSTE INTERROGE LUI-MEME, SANS JETON : le greffon de mise a jour
        // s'execute avant toute connexion, et un manifeste qui ne dit que
        // « telle version existe » n'apprend rien a qui l'intercepte. Ce qui
        // protege, c'est la signature du paquet, pas le secret du manifeste.
        .route("/api/maj/{cible}/{arch}/{version}", get(telechargements::manifeste_maj))
        // --- Assistant de direction (lecture seule, role DIRECTION) -----------
        // L'ANCIEN ASSISTANT RESTE, en second. C'est un catalogue ferme de
        // questions : il repond sans modele de langage, donc il repond meme si
        // le moteur est arrete ou injoignable. Le chatbot le remplace a
        // l'usage, il ne le supprime pas.
        .route("/api/assistant", get(assistant::catalogue))
        .route("/api/assistant/{id}", get(assistant::repondre))
        // --- Le chatbot --------------------------------------------------------
        // Le robot de connexion : ce qui attend l'utilisateur, filtre par ses
        // droits. Des comptes, pas une conversation — il doit s'afficher
        // meme si le moteur de langage est arrete.
        .route("/api/briefing", get(briefing::briefing))
        .route("/api/catalogue/completion", get(completion::completion))
        .route("/api/chat", post(crate::assistant::discuter))
        .route("/api/chat/etat", get(crate::assistant::etat))
        .route("/api/chat/competences", get(crate::assistant::liste_competences))
        .route("/api/chat/modeles",
               get(crate::assistant::modeles).post(crate::assistant::choisir_modele))
        // --- Authentification -------------------------------------------------
        .route("/api/auth/connexion", post(auth_routes::connexion))
        .route("/api/auth/moi", get(auth_routes::moi))
        // Changer SON mot de passe : aucun droit particulier, mais
        // l'ancien mot de passe est exige (voir auth_routes).
        .route("/api/auth/mot-de-passe", post(auth_routes::changer_mot_de_passe))
        // Le second facteur : poser, exiger, retirer. Trois gestes distincts,
        // pour qu'un QR mal scanne n'enferme personne dehors.
        .route("/api/auth/2fa/preparer", post(auth_routes::preparer_2fa))
        .route("/api/auth/2fa/activer", post(auth_routes::activer_2fa))
        .route("/api/auth/2fa/desactiver", post(auth_routes::desactiver_2fa))
        .route("/api/auth/connexions", get(auth_routes::journal_connexions))
        // Le verrou d'inactivite : verifie le mot de passe sans prolonger la
        // session. Voir auth_routes::deverrouiller.
        .route("/api/auth/deverrouiller", post(auth_routes::deverrouiller))
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
        .route("/api/devises/cours-bam", get(referentiels::cours_bam))
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
        // LE DOCUMENT A COTE DU GRAND LIVRE, pas a sa place. `/api/mouvements`
        // rend une ligne par reference — la vue de l'auditeur ; `/documents`
        // rend un bon par ligne, avec ses totaux — la vue du magasin. Le
        // segment fixe passe avant `{id}` : axum donne priorite au statique.
        // MACHINES. Le stock s'y compte, la consommation s'y journalise —
        // et jamais dans le journal des mouvements.
        // --- Dossiers d'importation : MRP, stock, CUMP -------------------------
        // Lecture pour la saisie d'un dossier ; l'administration du catalogue
        // passe par le referentiel generique /api/types-frais (PARAMETRES).
        .route("/api/parametres-frais", get(importation::lister_parametres_frais))
        .route("/api/import/dossiers",
               get(importation::lister_dossiers).post(importation::creer_dossier))
        .route("/api/import/dossiers/{id}",
               get(importation::lire_dossier)
                   .patch(importation::modifier_dossier)
                   .delete(importation::supprimer_dossier))
        .route("/api/import/dossiers/{id}/factures", post(importation::creer_facture))
        .route("/api/import/dossiers/{id}/frais", post(importation::ajouter_frais))
        .route("/api/import/dossiers/{id}/cloturer", post(importation::cloturer))
        .route("/api/import/factures/{id}",
               patch(importation::modifier_facture).delete(importation::supprimer_facture))
        .route("/api/import/factures/{id}/lignes", post(importation::ajouter_ligne))
        .route("/api/import/lignes/{id}",
               patch(importation::modifier_ligne).delete(importation::supprimer_ligne))
        .route("/api/import/lignes/{id}/solder", post(importation::solder_ligne))
        .route("/api/import/lignes-bc", get(importation::lignes_bc_ouvertes))
        .route("/api/import/frais/{id}",
               patch(importation::modifier_frais).delete(importation::supprimer_frais))
        // La reception est un document A PART : elle ne passe pas par un
        // dossier, et ses lignes peuvent venir de plusieurs.
        // Les pieces du dossier : scans, PDF, photos. La limite de corps est
        // posee sur la seule route qui recoit un fichier — ailleurs, un envoi
        // volumineux n'a aucune raison d'etre accepte.
        .route("/api/import/dossiers/{id}/pieces", post(pieces::deposer)
               .layer(axum::extract::DefaultBodyLimit::max(pieces::TAILLE_MAX + 1024 * 1024)))
        .route("/api/import/pieces/{id}",
               get(pieces::telecharger).delete(pieces::supprimer))
        .route("/api/import/a-recevoir", get(importation::a_recevoir))
        .route("/api/import/receptions",
               get(importation::lister_receptions).post(importation::creer_reception))
        .route("/api/import/receptions/{id}",
               get(importation::lire_reception)
                   .put(importation::modifier_reception)
                   .delete(importation::supprimer_reception))
        .route("/api/import/receptions/{id}/valider", post(importation::valider_reception))
        .route("/api/machines", get(machines::lister).post(machines::creer_machine))
        .route("/api/machines/consommation", get(machines::journal_consommation))
        .route("/api/machines/fiches",
               get(machines::lister_fiches).post(machines::creer_fiche))
        .route("/api/machines/fiches/{id}",
               get(machines::lire_fiche)
                   .put(machines::remplacer_fiche)
                   .delete(machines::supprimer_fiche))
        .route("/api/machines/fiches/{id}/valider", post(machines::valider_fiche))
        .route("/api/machines/fiches/{id}/annuler", post(machines::annuler_fiche))
        // Lire le plan d une machine, ou le corriger. La correction exige
        // PARAMETRES/ECRIRE — la direction et les super-utilisateurs — parce
        // qu une capacite fausse fausse toute la consommation qui en decoule.
        .route("/api/machines/{code}",
               get(machines::plan)
                   .put(machines::modifier_machine)
                   // Supprimer n'est possible que sur une machine jamais
                   // utilisee : une machine qui a travaille se RETIRE.
                   .delete(machines::supprimer_machine))
        // En panne, en sommeil, remise en production, retiree du parc.
        .route("/api/machines/{code}/etat", patch(machines::changer_etat))
        .route("/api/machines/{code}/contenu", get(machines::contenu_machine))
        .route("/api/machines/{code}/zones/{zone}", get(machines::etat_zone))
        .route("/api/mouvements/documents", get(stock::documents_mouvement))
        .route("/api/mouvements/{id}", get(stock::dossier_mouvement))
        // DEFAIRE SANS EFFACER : le grand livre ne se corrige que par son
        // inverse, comme dans tous les ERP depuis trente ans.
        .route("/api/mouvements/{id}/contre-passer", post(stock::contre_passer))
        // FAIRE RECULER UN DOCUMENT : valider se delegue, defaire la
        // validation d'un autre est un acte de direction.
        .route("/api/devalider", get(devalidation::documents_reversibles))
        .route("/api/devalider/{document}/{id}", post(devalidation::devalider))
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
        .route("/api/bons-commande/{id}",
               patch(stock::modifier_bc).delete(stock::supprimer_bc))
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
        .route(
            "/api/receptions/{id}/lignes/{ligne}",
            patch(stock::modifier_ligne_reception).delete(stock::supprimer_ligne_reception),
        )
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
        .route("/api/coherence-recettes", get(consultation::coherence_recettes))
        .route("/api/risques-sourcing", get(consultation::risques_sourcing))
        .route("/api/analyse-abc-xyz", get(consultation::analyse_abc_xyz))
        .route("/api/cout-revient", get(consultation::cout_revient))
        .route("/api/frais-approche",
             get(consultation::frais_approche).post(operations::creer_frais_approche))
        .route("/api/stats/mouvements", get(consultation::stats_mouvements))
        .route("/api/stats/familles", get(consultation::stats_familles))
        .route("/api/stats/prix", get(consultation::stats_prix))
        .route("/api/stats/fournisseurs", get(consultation::stats_fournisseurs))
        .route("/api/stats/qualites", get(consultation::stats_qualites))
        .route("/api/controles", get(consultation::controles))
        .route("/api/supervision", get(consultation::supervision))
        .route("/api/controles/{code}", get(consultation::controle_detail))
        .route("/api/fournisseurs/scorecard", get(consultation::scorecard))
        .route("/api/stock", get(consultation::stock))
        .route("/api/etat-stock", get(consultation::etat_stock))
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
        // CE QUI RETIENT CETTE LIGNE, demande AVANT d'essayer de l'effacer.
        // Enregistree apres le motif a deux segments : un chemin plus precis
        // doit etre declare apres celui qu'il precise, sinon il ne sert jamais.
        .route("/api/{entite}/{id}/retenants", get(entites::retenants))
        .route("/api/{entite}/{id}/activation", post(entites::activation))
        .layer(TraceLayer::new_for_http())
        .layer(cors);

    match interface {
        Some(rep) => {
            let index = rep.join("index.html");
            tracing::info!(repertoire = %rep.display(), "interface servie par le serveur");

            // LES PAQUETS SONT DES FICHIERS, SERVIS COMME TELS.
            //
            // Ils passaient par une route d'API qui exigeait un jeton dans un
            // en-tete : le bouton ne pouvait donc pas etre un lien, il fallait
            // telecharger en memoire puis rendre le contenu au navigateur par un
            // lien temporaire. Un detour invisible, mais un detour — et un
            // bouton qui n'est pas un lien ne s'ouvre pas dans un nouvel onglet,
            // ne se copie pas, ne se colle pas dans un courriel.
            //
            // UN INSTALLATEUR N'EST PAS UN SECRET : c'est ce que tout editeur
            // met derriere une adresse publique. Ce qui est protege, ce sont les
            // donnees de l'entreprise, pas le programme qui les affiche.
            let routeur = routeur.nest_service(
                "/telechargements",
                ServeDir::new(
                    std::env::var("GESTIONFIL_PAQUETS")
                        .unwrap_or_else(|_| "./telechargements".into()),
                ),
            );

            routeur
                // LES RESSOURCES CONSTRUITES SE SERVENT A PART, sans repli : un
                // fichier absent doit repondre 404. Avec le repli general, un
                // `.js` manquant renverrait la page HTML avec un code 200, et le
                // navigateur echouerait sur « Unexpected token < » — une panne
                // illisible pour une simple ressource oubliee.
                .nest_service("/assets", ServeDir::new(rep.join("assets")))
                // `fallback` et NON `not_found_service` : le second impose un
                // code 404 a la reponse de repli. L'ecran s'affichait donc, mais
                // chaque adresse de l'application repondait « 404 » — de quoi
                // tromper un cache, une sonde ou un service worker.
                .fallback_service(ServeDir::new(&rep).fallback(ServeFile::new(index)))
                .layer(axum::middleware::from_fn(nommer_route_inconnue))
                .with_state(state)
        }
        None => {
            tracing::info!("aucune interface a servir : API seule");
            routeur
                .layer(axum::middleware::from_fn(nommer_route_inconnue))
                .with_state(state)
        }
    }
}
