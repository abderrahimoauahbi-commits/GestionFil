//! Exposition HTTP du moteur CRUD generique.
//!
//! Un seul jeu de routes sert toutes les entites du registre :
//!     GET    /api/{entite}          liste, filtrable
//!     POST   /api/{entite}          creation
//!     GET    /api/{entite}/{id}     lecture
//!     PATCH  /api/{entite}/{id}     modification partielle
//!     DELETE /api/{entite}/{id}     desactivation (ou suppression reelle)

use crate::auth::Utilisateur;
use crate::crud::{self, Filtre};
use crate::error::AppResult;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde_json::{Map, Value};
use std::collections::HashMap;

/// Extrait les filtres de la chaine de requete.
///
/// Tout parametre inconnu de `limite`, `offset`, `recherche`, `actif`, `tri` et
/// `sens` est traite comme une egalite sur colonne, validee ensuite contre la
/// liste blanche de l'entite.
///
/// `offset` a un effet de bord assume : sa presence fait passer la reponse en
/// enveloppe paginee. C'est ce qui permet d'ajouter la pagination sans casser
/// les ecrans qui attendent un tableau.
fn filtre(params: HashMap<String, String>) -> Filtre {
    let mut f = Filtre {
        limite: 500,
        offset: None,
        recherche: None,
        actif: None,
        egalites: Vec::new(),
        tri: None,
        sens: None,
    };
    for (cle, valeur) in params {
        match cle.as_str() {
            "limite" => f.limite = valeur.parse().unwrap_or(500),
            "offset" => f.offset = Some(valeur.parse().unwrap_or(0)),
            "tri" => {
                if !valeur.trim().is_empty() {
                    f.tri = Some(valeur.trim().to_string())
                }
            }
            "sens" => f.sens = Some(valeur.to_lowercase()),
            "recherche" => {
                if !valeur.trim().is_empty() {
                    f.recherche = Some(valeur.trim().to_string())
                }
            }
            "actif" => f.actif = valeur.parse().ok(),
            _ => f.egalites.push((cle, valeur)),
        }
    }
    f
}

pub async fn lister(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(chemin): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    let e = crud::entite(&chemin)?;
    Ok(Json(crud::lister(&state.db, &user, e, &filtre(params)).await?))
}

pub async fn creer(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(chemin): Path<String>,
    Json(charge): Json<Map<String, Value>>,
) -> AppResult<Json<Value>> {
    let e = crud::entite(&chemin)?;
    Ok(Json(crud::creer(&state.db, &user, e, &charge).await?))
}

pub async fn lire(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((chemin, id)): Path<(String, String)>,
) -> AppResult<Json<Value>> {
    let e = crud::entite(&chemin)?;
    Ok(Json(crud::lire(&state.db, &user, e, &id).await?))
}

pub async fn modifier(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((chemin, id)): Path<(String, String)>,
    Json(charge): Json<Map<String, Value>>,
) -> AppResult<Json<Value>> {
    let e = crud::entite(&chemin)?;
    Ok(Json(crud::modifier(&state.db, &user, e, &id, &charge).await?))
}

pub async fn supprimer(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((chemin, id)): Path<(String, String)>,
) -> AppResult<Json<Value>> {
    let e = crud::entite(&chemin)?;
    Ok(Json(crud::supprimer(&state.db, &user, e, &id).await?))
}

/// Metadonnees du registre : le frontend s'en sert pour construire ses
/// formulaires sans coder en dur la liste des champs.
pub async fn registre(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    let mut sortie = Vec::new();
    for e in crud::ENTITES {
        // On n'expose que ce que l'utilisateur peut au moins lire.
        if !crate::auth::rbac::a_permission(
            &state.db,
            &user.role,
            e.module,
            crate::auth::rbac::Action::Lire,
        )
        .await?
        {
            continue;
        }
        sortie.push(serde_json::json!({
            "chemin": e.chemin,
            "module": e.module,
            "cle": e.cle,
            "cle_generee": e.cle_generee,
            "creation": e.creation,
            "modification": e.modification,
            "suppression": match e.suppression {
                crud::Suppression::Logique(_) => "DESACTIVATION",
                crud::Suppression::Physique => "SUPPRESSION",
                crud::Suppression::Interdite => "INTERDITE",
            },
        }));
    }
    Ok(Json(Value::Array(sortie)))
}
