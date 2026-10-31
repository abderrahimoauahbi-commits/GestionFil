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
pub(crate) mod auth_routes;
mod consultation;
pub(crate) mod couverture;
mod devalidation;
mod entites;
mod factures;
mod importation;
mod etiquettes;
mod lots;
mod machines;
pub(crate) mod json;
mod operations;
pub mod pieces;
mod production;
mod referentiels;
mod retours;
mod roles;
pub(crate) mod stock;
mod transferts;
mod inventaires;
mod ordres_fabrication;
pub(crate) mod bons_commande;
mod receptions;
mod recherche;
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
        ])
        // LA LISTE COUPEE SE DIT (24/10/2026) : un poste de bureau (autre origine)
        // doit pouvoir lire ces en-tetes, sinon il ne sait pas qu'il manque des lignes.
        .expose_headers([
            axum::http::HeaderName::from_static("x-total-count"),
            axum::http::HeaderName::from_static("x-liste-tronquee"),
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
        .route("/api/auth/preferences", get(auth_routes::lire_preferences).put(auth_routes::enregistrer_preferences))
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
        // Le verrou et la deconnexion tenus par le serveur (audit du 13/10/2026).
        .route("/api/auth/verrouiller", post(auth_routes::verrouiller))
        .route("/api/auth/deconnexion", post(auth_routes::deconnexion))
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
        .route("/api/admin/roles", get(admin::lister_roles).post(roles::creer))
        // Roles et permissions (13/10/2026), reserves a l'Administrateur.
        .route("/api/admin/roles/{code}",
               get(roles::lire).put(roles::modifier).delete(roles::supprimer))
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
        // Les ordres de fabrication (22/10/2026) : cycle et consommation réelle.
        .route("/api/ordres-fabrication",
               get(ordres_fabrication::lister).post(ordres_fabrication::creer))
        .route("/api/ordres-fabrication/qualites", get(ordres_fabrication::qualites))
        .route("/api/ordres-fabrication/consommation-qualites",
               get(ordres_fabrication::consommation_qualites))
        .route("/api/ordres-fabrication/{id}",
               get(ordres_fabrication::lire).patch(ordres_fabrication::modifier))
        .route("/api/ordres-fabrication/{id}/statut", put(ordres_fabrication::changer_statut))
        .route("/api/ordres-fabrication/{id}/consommation", get(ordres_fabrication::consommation))
        // --- Stock et mouvements ----------------------------------------------
        // Les retours fournisseur, document libre (12/10/2026).
        .route("/api/retours-fournisseur", get(retours::lister).post(retours::creer))
        .route("/api/retours-fournisseur/disponible", get(retours::disponible))
        .route("/api/retours-fournisseur/{id}",
               get(retours::lire).put(retours::modifier).delete(retours::supprimer))
        .route("/api/retours-fournisseur/{id}/valider", post(retours::valider))
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
        .route("/api/import/dossiers/{id}/engagements", post(importation::ajouter_engagement))
        .route("/api/import/engagements/{id}", delete(importation::supprimer_engagement))
        .route("/api/import/dossiers/{id}/cloturer", post(importation::cloturer))
        .route("/api/import/dossiers/{id}/cout-revient-reel", get(importation::cout_revient_reel))
        .route("/api/import/dossiers/{id}/avoir", post(importation::avoir))
        .route("/api/import/factures/{id}/paiements", post(importation::ajouter_paiement))
        .route("/api/import/paiements/{id}", axum::routing::delete(importation::supprimer_paiement))
        .route("/api/import/dossiers/{id}/frais-post-cloture", post(importation::frais_post_cloture))
        .route("/api/import/dossiers/{id}/valider", post(importation::valider_dossier))
        .route("/api/import/factures/{id}",
               patch(importation::modifier_facture).delete(importation::supprimer_facture))
        .route("/api/import/factures/{id}/lignes", post(importation::ajouter_ligne))
        .route("/api/import/lignes/{id}",
               patch(importation::modifier_ligne).delete(importation::supprimer_ligne))
        .route("/api/import/lignes/{id}/solder", post(importation::solder_ligne))
        .route("/api/import/lignes-bc", get(importation::lignes_bc_ouvertes))
        // Le taux propose a la saisie d'une facture : cours Bank Al-Maghrib du
        // jour, a defaut le taux de l'ERP (05/10/2026).
        .route("/api/import/taux-reference", get(importation::taux_reference_facture))
        .route("/api/import/frais/{id}",
               patch(importation::modifier_frais).delete(importation::supprimer_frais))
        // La repartition MANUELLE d'un frais (12/10/2026) : le montant de chaque ligne.
        .route("/api/import/frais/{id}/repartition", put(importation::repartir_frais))
        // La reception est un document A PART : elle ne passe pas par un
        // dossier, et ses lignes peuvent venir de plusieurs.
        // Les pieces du dossier : scans, PDF, photos. La limite de corps est
        // posee sur la seule route qui recoit un fichier — ailleurs, un envoi
        // volumineux n'a aucune raison d'etre accepte.
        .route("/api/import/dossiers/{id}/pieces", post(pieces::deposer)
               .layer(axum::extract::DefaultBodyLimit::max(pieces::TAILLE_MAX + 1024 * 1024)))
        // La lecture assistee : GestionAi lit la piece, l'ERP garde le resultat.
        .route("/api/import/pieces/{id}/lecture",
               get(pieces::lecture).post(pieces::lire))
        .route("/api/import/pieces/{id}",
               get(pieces::telecharger).delete(pieces::supprimer))
        // LA RECEPTION D'IMPORT N'EST PLUS UN CIRCUIT (ADR-003, 16/10/2026) :
        // la marchandise importee entre par la RECEPTION UNIFIEE — un arrivage
        // dont chaque ligne pege a une ligne de bon de commande. Les routes
        // /api/import/a-recevoir et /api/import/receptions* sont donc retirees.
        // Leurs handlers restent dans importation.rs, sans appelant : on ne
        // supprime pas l'historique, on ferme seulement la porte.
        .route("/api/machines", get(machines::lister).post(machines::creer_machine))
        .route("/api/machines/consommation", get(machines::journal_consommation))
        .route("/api/machines/{code}/mouvements", get(machines::mouvements_machine))
        .route("/api/machines/fiches/{id}/retrait-apercu", get(machines::apercu_retrait))
        .route("/api/machines/fiches",
               get(machines::lister_fiches).post(machines::creer_fiche))
        .route("/api/machines/fiches/{id}",
               get(machines::lire_fiche)
                   .put(machines::remplacer_fiche)
                   .delete(machines::supprimer_fiche))
        .route("/api/machines/fiches/{id}/valider", post(machines::valider_fiche))
        .route("/api/machines/fiches/{id}/annuler", post(machines::annuler_fiche))
        // LES DECISIONS MACHINE (05/10/2026) : l'apercu calcule sans rien
        // ecrire ; la devalidation ramene l'etage a l'etat precedent et la
        // fiche en brouillon ; la matrice des motifs nourrit l'ecran.
        .route("/api/machines/fiches/{id}/apercu", post(machines::apercu_fiche))
        .route("/api/machines/fiches/{id}/devalider", post(machines::devalider_fiche))
        .route("/api/machines/motifs", get(machines::lister_motifs))
        // Les OF qu'une fiche (machine ou hors machine) peut choisir (22/10/2026).
        .route("/api/machines/of-ouverts", get(machines::of_ouverts))
        .route("/api/machines/of-ouverts/{id}/hors-machine", get(machines::of_hors_machine))
        // La qualite explicite (23/10/2026) : les qualites ouvertes, et ce
        // qu'une qualite a sorti et rendu sans OF.
        .route("/api/machines/qualites", get(machines::qualites_ouvertes))
        .route("/api/machines/qualites/{code}/hors-machine", get(machines::qualite_hors_machine))
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
        .route("/api/prets-en-cours", get(stock::prets_en_cours))
        .route("/api/mouvements/{id}", get(stock::dossier_mouvement))
        // DEFAIRE SANS EFFACER : le grand livre ne se corrige que par son
        // inverse, comme dans tous les ERP depuis trente ans.
        .route("/api/mouvements/{id}/contre-passer", post(stock::contre_passer))
        // FAIRE RECULER UN DOCUMENT : valider se delegue, defaire la
        // validation d'un autre est un acte de direction.
        .route("/api/devalider", get(devalidation::documents_reversibles))
        .route("/api/devalider/{document}/{id}", post(devalidation::devalider))
        .route("/api/transferts",
               get(transferts::lister_transferts).post(transferts::creer_transfert))
        .route("/api/transferts/{id}/lignes", post(transferts::ajouter_ligne_transfert))
        .route(
            "/api/transferts/{id}",
            get(transferts::dossier_transfert)
                .put(transferts::modifier_transfert)
                .delete(transferts::annuler_transfert),
        )
        .route("/api/transferts/{id}/expedier", post(operations::expedier_transfert))
        // La date prevue de disponibilite, revisable tant que le transfert roule
        // (27/10/2026) : le moteur de couverture le compte a cette date.
        .route(
            "/api/transferts/{id}/date-disponibilite",
            post(transferts::reviser_date_disponibilite),
        )
        .route(
            "/api/transferts/{id}/receptionner",
            post(operations::receptionner_transfert),
        )
        // Alias historique : l'expedition etait appelee « validation ».
        .route("/api/transferts/{id}/valider", post(operations::expedier_transfert))
        .route("/api/inventaires",
               get(inventaires::lister_inventaires).post(inventaires::creer_inventaire))
        .route("/api/inventaires/{id}/lignes",
               get(inventaires::lignes_inventaire).put(inventaires::saisir_comptage))
        .route("/api/inventaires/ouverts", get(inventaires::inventaires_ouverts))
        .route("/api/inventaires/candidats", get(inventaires::candidats_inventaire))
        .route("/api/inventaires/{id}/references",
               get(inventaires::references_inventaire).put(inventaires::choisir_references_inventaire))
        .route("/api/inventaires/{id}", get(inventaires::lire_inventaire))
        .route("/api/inventaires/{id}/preparer", post(operations::preparer_inventaire))
        .route("/api/inventaires/{id}/valider", post(operations::valider_inventaire))
        .route("/api/inventaires/{id}/renvoyer", post(operations::renvoyer_inventaire))
        .route("/api/inventaires/{id}/cloturer", post(operations::cloturer_inventaire))
        .route("/api/inventaires/{id}/annuler", post(operations::annuler_inventaire))
        // --- Achats et receptions ---------------------------------------------
        .route("/api/bons-commande",
               get(bons_commande::lister_bc).post(bons_commande::creer_bc))
        .route("/api/bons-commande/{id}",
               patch(bons_commande::modifier_bc).delete(bons_commande::supprimer_bc))
        // Sans `{id}` : la liste sert AUSSI a la creation, quand le bon n'existe
        // pas encore et qu'on vient de choisir le fournisseur.
        .route("/api/references-commandables", get(bons_commande::references_commandables))
        .route("/api/bons-commande/{id}/lignes",
               get(bons_commande::lignes_bc).post(bons_commande::ajouter_ligne_bc))
        .route("/api/bons-commande/{id}/lignes/{ligne}",
               patch(bons_commande::modifier_ligne_bc).delete(bons_commande::supprimer_ligne_bc))
        .route("/api/bons-commande/{id}/statut", put(bons_commande::changer_statut_bc))
        .route("/api/receptions",
               get(receptions::lister_receptions).post(receptions::creer_reception))
        .route("/api/receptions/{id}", patch(receptions::modifier_reception))
        // Sans `{id}` : sert aussi a la creation, quand la reception n'existe pas
        // encore et qu'on vient de designer le bon de commande.
        .route("/api/lignes-attendues", get(receptions::lignes_attendues))
        // Les dossiers d'import ouverts, pour l'en-tete d'un arrivage (ADR-003
        // phase A). Garde par RECEPTIONS : le magasinier dit quel conteneur il
        // vide sans avoir a lire les dossiers d'import.
        .route("/api/receptions-dossiers-import", get(receptions::dossiers_import_ouverts))
        .route("/api/receptions/{id}/lignes",
               get(receptions::lignes_reception).post(receptions::ajouter_ligne_reception))
        .route(
            "/api/receptions/{id}/lignes/{ligne}",
            patch(receptions::modifier_ligne_reception).delete(receptions::supprimer_ligne_reception),
        )
        .route("/api/receptions/{id}/statut", put(receptions::changer_statut_reception))
        // Les etiquettes de lot a code-barres (audit P3, 19/10/2026).
        .route("/api/receptions/{id}/etiquettes",
               get(etiquettes::lister).post(etiquettes::generer))
        .route("/api/etiquettes/{code}", get(etiquettes::lire))
        .route("/api/receptions/{id}/valider", post(operations::valider_reception))
        .route("/api/receptions/{id}/cloturer", post(operations::cloturer_reception))
        .route("/api/receptions/{id}/facture-contexte", get(operations::contexte_facture_reception))
        .route("/api/receptions/{id}/avoir", post(operations::corriger_reception))
        // --- La facture fournisseur, document (ADR-003 phase B) --------------
        // `a-facturer` AVANT `{id}` : un chemin fixe ne doit pas se faire
        // prendre pour un identifiant.
        .route("/api/factures-fournisseur/a-facturer", get(factures::a_facturer))
        .route("/api/factures-fournisseur",
               get(factures::lister).post(factures::creer))
        .route("/api/factures-fournisseur/{id}",
               get(factures::lire).patch(factures::modifier).delete(factures::supprimer))
        .route("/api/factures-fournisseur/{id}/valider", post(factures::valider))
        // LA COUVERTURE DU PLAN (moteur du 26/10/2026) : le plan seul, le stock du
        // jour, les arrivages dates, la proposition. Depuis le 27/10/2026, la seule
        // source de verite du besoin : l'ancien calcul (`GET /api/plan-achat`,
        // `/api/plan-achat/detail`, v_plan_achat) est retire.
        .route("/api/couverture", get(couverture::liste))
        .route("/api/couverture/{reference}", get(couverture::detail))
        .route("/api/couverture/{reference}/classement", get(couverture::classement))
        // L'espace « Simulation » (27/10/2026) : un POST qui ne fait que LIRE.
        .route("/api/couverture/{reference}/simulation", post(couverture::simulation))
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
        .route("/api/ecarts-prix", get(consultation::ecarts_prix))
        .route("/api/frais-approche",
             get(consultation::frais_approche).post(operations::creer_frais_approche))
        // Un frais se retire tant qu'il n'est pas porte au CUMP (ADR-003 phase C).
        .route("/api/frais-approche/{id}", delete(operations::supprimer_frais_approche))
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
        .route("/api/stock/projete/complements", get(consultation::stock_projete_complements))
        // Le besoin d'une reference, plan / au-dela du plan, et ses OF (22/10/2026).
        .route("/api/stock/besoin", get(consultation::besoin_reference))
        .route("/api/stock/dormant", get(consultation::stock_dormant))
        .route("/api/stock/lots", get(consultation::lots))
        // LA RECHERCHE DES REFERENTIELS (24/10/2026) : le choix d'une valeur dans une
        // liste qui grandit, cherche par le serveur, qui dit s'il en reste.
        .route("/api/recherche/{type}", get(recherche::rechercher))
        // Le registre des lots (02/10/2026) : vues, fiche de vie, decisions.
        .route("/api/lots", get(lots::lister))
        .route("/api/lots/compteurs", get(lots::compteurs))
        .route("/api/lots/vie", get(lots::vie))
        .route("/api/lots/statut", post(lots::changer_statut))
        .route("/api/lots/basculer", post(lots::basculer))
        .route("/api/lots/dormant", post(lots::decider_dormant))
        .route("/api/lots/fusion", post(lots::fusionner))
        .route("/api/lots/identifier", post(lots::identifier))
        // Chaque lot a son conditionnement (23/10/2026) : lu par les ecrans de
        // saisie, corrige sur la fiche du lot.
        .route("/api/lots/conditionnement", get(lots::conditionnements).post(lots::corriger_conditionnement))
        .route("/api/autorisations", get(lots::lister_demandes).post(lots::creer_demande))
        .route("/api/autorisations/{id}/decider", post(lots::decider))
        .route("/api/stats/lots", get(lots::statistiques))
        .route("/api/cockpit/lots", get(lots::cockpit))
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
        // UNE REQUETE, UN IDENTIFIANT (audit C2, 17/10/2026). Chaque requete recoit
        // un `x-request-id` — repris de nginx s'il en pose un, sinon tire ici — renvoye
        // au client et porte par toutes les lignes de journal de la requete, avec la
        // methode, le chemin et l'utilisateur. Une ligne par reponse dit le statut et
        // la duree. Le chemin seul, jamais la requete complete : une recherche peut
        // contenir un nom, un jeton ne doit jamais finir dans un journal.
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(|req: &axum::extract::Request| {
                    let id = req.headers().get("x-request-id").and_then(|v| v.to_str().ok()).unwrap_or("-");
                    tracing::info_span!(
                        "requete",
                        id = %id,
                        methode = %req.method(),
                        chemin = %req.uri().path(),
                        utilisateur = tracing::field::Empty,
                    )
                })
                .on_response(
                    tower_http::trace::DefaultOnResponse::new()
                        .level(tracing::Level::INFO)
                        .latency_unit(tower_http::LatencyUnit::Millis),
                ),
        )
        .layer(tower_http::request_id::PropagateRequestIdLayer::x_request_id())
        // Pose AVANT la trace (les couches s'executent de la derniere ajoutee a la
        // premiere) : le span doit pouvoir lire l'identifiant.
        .layer(tower_http::request_id::SetRequestIdLayer::x_request_id(
            tower_http::request_id::MakeRequestUuid,
        ))
        // UN DELAI PAR REQUETE (audit v4) : au-dela, le client recoit 408 au
        // lieu d'attendre une reponse qui ne viendra pas. Cinq minutes par
        // defaut (GESTIONFIL_DELAI_HTTP_S) : un calcul de plan ou un depot de
        // piece y tiennent largement.
        .layer(tower_http::timeout::TimeoutLayer::with_status_code(
            axum::http::StatusCode::REQUEST_TIMEOUT,
            std::time::Duration::from_secs(crate::db::delai_env("GESTIONFIL_DELAI_HTTP_S", 300)),
        ))
        .layer(cors);

    // LA POLITIQUE DE CONTENU (CSP) ET NOSNIFF, POSES PAR LE SERVEUR LUI-MEME
    // (audit de securite du 13/10/2026) : derriere nginx comme en direct sur le
    // poste, sur l'API comme sur les pages. L'interface ne charge rien
    // d'ailleurs : une injection de script ne pourrait ni s'executer ni envoyer
    // le jeton hors du serveur. Les styles en ligne restent permis (attributs
    // `style` des graphiques) ; les scripts, jamais.
    use axum::http::{header, HeaderValue};
    use tower_http::set_header::SetResponseHeaderLayer;
    let en_tetes = |r: Router| {
        r.layer(SetResponseHeaderLayer::if_not_present(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
                 img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; \
                 worker-src 'self'; manifest-src 'self'; frame-src 'self' blob:; \
                 object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
            ),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
    };

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

            en_tetes(routeur
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
                .with_state(state))
        }
        None => {
            tracing::info!("aucune interface a servir : API seule");
            en_tetes(
                routeur
                    .layer(axum::middleware::from_fn(nommer_route_inconnue))
                    .with_state(state),
            )
        }
    }
}

/// LA DATE DU FAIT d'un document (10/10/2026) : une vraie date AAAA-MM-JJ,
/// jamais dans le futur — on ne recoit pas demain ce qui n'est pas arrive.
/// Vide : None (le document prend la date du jour). Commune aux receptions
/// locales et d'import, a la creation comme a la modification.
pub fn date_du_fait(d: Option<&str>, quoi: &str) -> crate::error::AppResult<Option<String>> {
    match d.map(str::trim) {
        Some(d) if !d.is_empty() => {
            let jour = chrono::NaiveDate::parse_from_str(d.get(..10).unwrap_or(d), "%Y-%m-%d").map_err(|_| {
                crate::error::AppError::Invalide(format!("{quoi} invalide : {d} (attendu AAAA-MM-JJ)"))
            })?;
            if jour > crate::db::jour_casablanca() {
                return Err(crate::error::AppError::RegleMetier(format!("La {quoi} ne peut pas etre dans le futur.")));
            }
            Ok(Some(jour.format("%Y-%m-%d").to_string()))
        }
        _ => Ok(None),
    }
}
