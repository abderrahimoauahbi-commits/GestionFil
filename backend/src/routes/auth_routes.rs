//! Connexion et identite de l'appelant.

use crate::auth::{jwt, password, rbac, Utilisateur};
use crate::db::maintenant;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Debug, Deserialize)]
pub struct DemandeConnexion {
    pub login: String,
    pub mot_de_passe: String,
}

#[derive(Debug, Serialize)]
pub struct ReponseConnexion {
    pub jeton: String,
    pub expire_le: i64,
    pub utilisateur: serde_json::Value,
}

pub async fn connexion(
    State(state): State<AppState>,
    Json(demande): Json<DemandeConnexion>,
) -> AppResult<Json<ReponseConnexion>> {
    let compte: Option<(String, String, String, String, i64)> = sqlx::query_as(
        "SELECT id_utilisateur, mot_de_passe_hash, nom, code_role_user, actif
           FROM utilisateur WHERE login = $1",
    )
    .bind(&demande.login)
    .fetch_optional(&state.db)
    .await?;

    // Un compte inconnu et un mot de passe faux renvoient la meme erreur : ne
    // pas reveler quels logins existent.
    let (id, hash, nom, role, actif) = compte.ok_or(AppError::IdentifiantsInvalides)?;

    if actif != 1 || !password::verifier(&demande.mot_de_passe, &hash) {
        return Err(AppError::IdentifiantsInvalides);
    }

    let (jeton, claims) = jwt::emettre(
        &state.config.jwt_secret,
        &id,
        &demande.login,
        &role,
        state.config.jwt_ttl_minutes,
    )
    .map_err(AppError::Interne)?;

    sqlx::query("UPDATE utilisateur SET derniere_connexion = $2 WHERE id_utilisateur = $1")
        .bind(&id)
        .bind(maintenant())
        .execute(&state.db)
        .await?;

    Ok(Json(ReponseConnexion {
        jeton,
        expire_le: claims.exp,
        utilisateur: json!({
            "id": id,
            "login": demande.login,
            "nom": nom,
            "role": role,
        }),
    }))
}

/// Identite et droits effectifs de l'appelant — la source de verite du frontend
/// pour n'afficher que ce que l'utilisateur peut reellement faire.
pub async fn moi(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<serde_json::Value>> {
    let permissions: Vec<(String, String)> = sqlx::query_as(
        "SELECT module, action FROM permission
          WHERE code_role_user = $1 AND actif = 1
          ORDER BY module, action",
    )
    .bind(&user.role)
    .fetch_all(&state.db)
    .await?;

    // Grille de visibilite complete : le frontend s'en sert pour ne rendre que
    // les champs autorises et pour desactiver ceux en lecture seule. Le serveur
    // applique de toute facon la meme grille — l'interface ne fait qu'eviter a
    // l'utilisateur de saisir ce qui sera refuse.
    let droits: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT cc.module, cc.champ, COALESCE(dc.niveau, cc.niveau_defaut)
           FROM champ_configurable cc
           LEFT JOIN droit_champ dc
                  ON dc.module = cc.module AND dc.champ = cc.champ
                 AND dc.id_utilisateur = $1
          ORDER BY cc.module, cc.ordre",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await?;

    // Regroupe par module : { "CATALOGUE": { "prix_catalogue": "MASQUE", ... } }
    let mut par_module: BTreeMap<String, serde_json::Map<String, serde_json::Value>> =
        BTreeMap::new();
    for (module, champ, niveau) in droits {
        par_module
            .entry(module)
            .or_default()
            .insert(champ, Value::from(niveau));
    }

    let plafond = rbac::plafond_validation_bc(&state.db, &user.role).await?;

    Ok(Json(json!({
        "id": user.id,
        "login": user.login,
        "role": user.role,
        "plafond_validation_bc_mad": plafond,
        "permissions": permissions.iter()
            .map(|(m, a)| json!({ "module": m, "action": a }))
            .collect::<Vec<_>>(),
        "droits_champ": par_module,
    })))
}

#[derive(Debug, Deserialize)]
pub struct DemandeChangement {
    pub ancien: String,
    pub nouveau: String,
}

/// Change SON PROPRE mot de passe.
///
/// Voir le commentaire du module pour les trois gardes. Celle qui compte le
/// plus est la premiere : l'ancien mot de passe est exige, meme si l'appelant
/// est deja authentifie. Un jeton prouve qu'une session est ouverte, pas que
/// la personne devant l'ecran est bien la bonne.
pub async fn changer_mot_de_passe(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(d): Json<DemandeChangement>,
) -> AppResult<Json<Value>> {
    password::valider_longueur(&d.nouveau).map_err(AppError::Invalide)?;

    if d.nouveau == d.ancien {
        return Err(AppError::Invalide(
            "le nouveau mot de passe doit differer de l'ancien".into(),
        ));
    }

    let hash: String = sqlx::query_scalar(
        "SELECT mot_de_passe_hash FROM utilisateur WHERE id_utilisateur = $1",
    )
    .bind(&user.id)
    .fetch_one(&state.db)
    .await?;

    if !password::verifier(&d.ancien, &hash) {
        // Le meme message que pour un compte inconnu a la connexion : ne rien
        // apprendre a qui essaie.
        return Err(AppError::IdentifiantsInvalides);
    }

    let nouveau_hash = password::hacher(&d.nouveau).map_err(AppError::Interne)?;

    // L'ECRITURE PASSE PAR UNE TRANSACTION AVEC CONTEXTE, comme toute ecriture
    // du service : sans `poser_contexte`, le declencheur d'audit enregistrerait
    // un changement de mot de passe sans savoir qui l'a fait.
    let mut tx = state.db.begin().await?;
    crate::db::poser_contexte(&mut tx, &user.id, None, None).await?;
    sqlx::query(
        "UPDATE utilisateur SET mot_de_passe_hash = $2 WHERE id_utilisateur = $1",
    )
    .bind(&user.id)
    .bind(&nouveau_hash)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    // LE JETON RESTE VALIDE. Le revoquer obligerait a se reconnecter
    // immediatement apres avoir change son mot de passe, ce qui n'apporte rien
    // ici : le jeton appartient deja a la bonne personne, qui vient de prouver
    // qu'elle connait l'ancien mot de passe.
    Ok(Json(json!({
        "change": true,
        "le": maintenant(),
    })))
}
