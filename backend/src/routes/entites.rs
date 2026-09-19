//! Exposition HTTP du moteur CRUD generique.
//!
//! Un seul jeu de routes sert toutes les entites du registre :
//!     GET    /api/{entite}          liste, filtrable
//!     POST   /api/{entite}          creation
//!     GET    /api/{entite}/{id}     lecture
//!     PATCH  /api/{entite}/{id}     modification partielle
//!     DELETE /api/{entite}/{id}     suppression reelle, si rien ne retient
//!     GET    /api/{entite}/{id}/retenants   ce qui empeche la suppression
//!     POST   /api/{entite}/{id}/activation  mettre de cote, ou remettre en service

use crate::auth::Utilisateur;
use crate::crud::{self, Filtre};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
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

/// `GET /api/{entite}/{id}/retenants` — CE QUI EMPECHE D'EFFACER, AVANT D'ESSAYER.
///
/// L'ecran demandait la suppression, la base refusait, et l'on decouvrait la
/// premiere table qui retenait. On la detachait, on relancait, une deuxieme
/// apparaissait. Autant d'allers-retours que de dependances — et aucune facon
/// de savoir, avant de commencer, si l'affaire prendrait deux minutes ou deux
/// heures.
///
/// Cette route repond a la question posee AVANT le clic : qui s'en sert, et
/// combien de fois. L'ecran peut alors annoncer ce qui sera detruit, ou
/// expliquer pourquoi il ne le sera pas.
pub async fn retenants(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((chemin, id)): Path<(String, String)>,
) -> AppResult<Json<Value>> {
    let e = crud::entite(&chemin)?;
    // LIRE SUFFIT POUR SAVOIR. Refuser cette reponse a qui peut deja lire la
    // ligne ne protegerait rien : il verrait les memes liens en ouvrant les
    // ecrans concernes, simplement plus lentement.
    user.exiger(&state.db, e.module, crate::auth::rbac::Action::Lire).await?;

    let liste = crud::retenants(&state.db, e.table, &id).await;
    let total: i64 = liste.iter().map(|(_, n)| n).sum();
    Ok(Json(serde_json::json!({
        "entite": e.chemin,
        "cle": id,
        "supprimable": liste.is_empty(),
        // QUAND ON NE PEUT PAS EFFACER, IL RESTE A METTRE DE COTE. L'ecran a
        // besoin de le savoir AVANT de proposer quoi que ce soit : offrir une
        // desactivation sur une table qui n'a pas de colonne `actif` serait un
        // bouton qui echoue, et annoncer un refus sec quand une sortie existe
        // serait un mensonge par omission.
        "desactivable": matches!(e.suppression, crud::Suppression::Logique(_)),
        "total": total,
        "retenants": liste
            .iter()
            .map(|(table, n)| serde_json::json!({ "table": table, "nb": n }))
            .collect::<Vec<_>>(),
    })))
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

#[derive(Deserialize)]
pub struct DemandeActivation {
    pub actif: bool,
}

/// `POST /api/{entite}/{id}/activation` — mettre de cote sans effacer.
///
/// POURQUOI UNE ROUTE A PART. Supprimer et desactiver ne sont pas la meme
/// decision, et la seconde n'est pas un lot de consolation : une couleur qu'on
/// ne commande plus mais qui dort encore en magasin doit disparaitre des listes
/// de saisie SANS disparaitre des mouvements qui la citent. C'est la seule issue
/// quand la suppression est retenue, et elle se prend en connaissance de cause.
///
/// ELLE SE FAIT DANS LES DEUX SENS. Une ligne mise de cote se remet en service ;
/// sinon la desactivation serait une suppression deguisee et definitive, ce que
/// personne n'accepterait de faire deliberement.
pub async fn activation(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((chemin, id)): Path<(String, String)>,
    Json(d): Json<DemandeActivation>,
) -> AppResult<Json<Value>> {
    let e = crud::entite(&chemin)?;
    user.exiger(&state.db, e.module, crate::auth::rbac::Action::Ecrire)
        .await?;

    let crud::Suppression::Logique(colonne) = e.suppression else {
        return Err(AppError::RegleMetier(format!(
            "« {} » n'a pas d'etat actif/inactif : cette ligne s'efface ou se garde,              il n'y a pas d'entre-deux.",
            e.chemin
        )));
    };

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let res = sqlx::query(&format!(
        "UPDATE {} SET {colonne} = $2 WHERE {} = $1",
        e.table, e.cle
    ))
    .bind(&id)
    .bind(i32::from(d.actif))
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Introuvable(format!("{} {id}", e.chemin)));
    }
    tx.commit().await?;

    Ok(Json(serde_json::json!({
        "entite": e.chemin,
        "cle": id,
        "actif": d.actif,
    })))
}
