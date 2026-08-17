//! Authentification et autorisation.

pub mod jwt;
pub mod password;
pub mod rbac;

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::request::Parts;
use std::net::SocketAddr;

/// Utilisateur authentifie, extrait du jeton porteur.
///
/// La presence de ce type dans la signature d'un handler garantit que la
/// requete est authentifiee : il n'existe aucun moyen de le construire sans
/// jeton valide.
#[derive(Debug, Clone)]
pub struct Utilisateur {
    pub id: String,
    pub login: String,
    pub role: String,
    pub session_id: String,
    pub adresse_ip: Option<String>,
}

impl FromRequestParts<AppState> for Utilisateur {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let jeton = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or(AppError::NonAuthentifie)?;

        let claims =
            jwt::verifier(&state.config.jwt_secret, jeton).ok_or(AppError::NonAuthentifie)?;

        // Un jeton reste valide jusqu'a son expiration : on revalide le compte a
        // chaque requete pour qu'une desactivation prenne effet immediatement.
        let actif: Option<i64> =
            sqlx::query_scalar("SELECT actif FROM utilisateur WHERE id_utilisateur = ?1")
                .bind(&claims.sub)
                .fetch_optional(&state.db)
                .await?;
        if actif != Some(1) {
            return Err(AppError::NonAuthentifie);
        }

        let adresse_ip = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|ConnectInfo(a)| a.ip().to_string());

        Ok(Utilisateur {
            id: claims.sub,
            login: claims.login,
            role: claims.role,
            session_id: claims.sid,
            adresse_ip,
        })
    }
}

impl Utilisateur {
    /// Verifie une permission, ou echoue avec un 403 explicite.
    pub async fn exiger(
        &self,
        db: &crate::db::Db,
        module: &str,
        action: rbac::Action,
    ) -> AppResult<()> {
        rbac::exiger(db, &self.role, module, action).await
    }

    /// Grille de visibilite des champs de ce module pour CET utilisateur.
    pub async fn droits(
        &self,
        db: &crate::db::Db,
        module: &str,
    ) -> AppResult<std::collections::HashMap<String, rbac::Niveau>> {
        rbac::droits_champ(db, &self.id, module).await
    }

    /// Retire de la reponse les champs masques pour cet utilisateur.
    pub async fn masquer(
        &self,
        db: &crate::db::Db,
        module: &str,
        valeur: &mut serde_json::Value,
    ) -> AppResult<()> {
        let droits = self.droits(db, module).await?;
        rbac::masquer(valeur, &droits);
        Ok(())
    }

    /// Ne conserve d'une charge utile que les champs modifiables par cet
    /// utilisateur ; echoue si l'un d'eux ne l'est pas.
    ///
    /// Appele AVANT toute ecriture : c'est ici que la grille protege reellement,
    /// et non dans le champ grise de l'interface.
    pub async fn filtrer_ecriture(
        &self,
        db: &crate::db::Db,
        module: &str,
        charge: &serde_json::Map<String, serde_json::Value>,
    ) -> AppResult<serde_json::Map<String, serde_json::Value>> {
        let droits = self.droits(db, module).await?;
        rbac::exiger_ecriture(charge, &droits)
    }

    /// Pose l'identite de l'appelant pour les triggers d'audit.
    pub async fn poser_contexte(&self, tx: &mut sqlx::SqliteConnection) -> AppResult<()> {
        crate::db::poser_contexte(
            tx,
            &self.id,
            self.adresse_ip.as_deref(),
            Some(&self.session_id),
        )
        .await?;
        Ok(())
    }
}
