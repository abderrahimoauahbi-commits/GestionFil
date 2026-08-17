//! Erreurs applicatives et leur traduction HTTP.
//!
//! Les messages metier leves par les triggers SQLite (`RAISE(ABORT, ...)`)
//! remontent ici via `sqlx::Error::Database`. Ils sont volontairement renvoyes
//! tels quels au client : ce sont des messages redigees pour l'utilisateur
//! ("R02 : stock insuffisant..."), pas des details d'implementation.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    RegleMetier(String),

    #[error("Ressource introuvable : {0}")]
    Introuvable(String),

    #[error("Requete invalide : {0}")]
    Invalide(String),

    #[error("Authentification requise")]
    NonAuthentifie,

    #[error("Identifiants invalides")]
    IdentifiantsInvalides,

    #[error("Acces refuse : permission {action} manquante sur le module {module}")]
    NonAutorise { module: String, action: String },

    /// Refus PAR CHAMP. Le loger dans `NonAutorise` en glissant la liste des
    /// champs a la place du module produisait « sur le module champs
    /// prix_catalogue_kg » — un message qui ne nomme ni le bon objet ni la
    /// bonne cause, et qui envoie chercher un droit de module inexistant.
    #[error("Champ(s) non modifiable(s) avec vos droits : {champs}")]
    ChampNonModifiable { champs: String },

    #[error("Conflit : {0}")]
    Conflit(String),

    #[error("Erreur interne")]
    Interne(#[from] anyhow::Error),

    #[error("Erreur base de donnees")]
    Sqlx(#[source] sqlx::Error),
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Interne(anyhow::anyhow!("serialisation JSON : {e}"))
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        match &e {
            sqlx::Error::RowNotFound => AppError::Introuvable("enregistrement".into()),
            sqlx::Error::Database(db) => {
                let msg = db.message().to_string();
                // Message metier explicite leve par un trigger.
                if msg.starts_with('R')
                    || msg.starts_with('C')
                    || msg.starts_with('B')
                    || msg.contains("Transition")
                    || msg.contains("Parametre")
                    || msg.contains("recette")
                    || msg.contains("quarantaine")
                    || msg.contains("Tracabilite")
                {
                    AppError::RegleMetier(msg)
                } else if msg.contains("UNIQUE constraint failed") {
                    AppError::Conflit(msg)
                } else if msg.contains("CHECK constraint failed")
                    || msg.contains("FOREIGN KEY constraint failed")
                    || msg.contains("NOT NULL constraint failed")
                {
                    AppError::Invalide(msg)
                } else {
                    AppError::Sqlx(e)
                }
            }
            _ => AppError::Sqlx(e),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            AppError::RegleMetier(_) => (StatusCode::UNPROCESSABLE_ENTITY, "REGLE_METIER"),
            AppError::Introuvable(_) => (StatusCode::NOT_FOUND, "INTROUVABLE"),
            AppError::Invalide(_) => (StatusCode::BAD_REQUEST, "INVALIDE"),
            AppError::NonAuthentifie => (StatusCode::UNAUTHORIZED, "NON_AUTHENTIFIE"),
            AppError::IdentifiantsInvalides => (StatusCode::UNAUTHORIZED, "IDENTIFIANTS_INVALIDES"),
            AppError::NonAutorise { .. } => (StatusCode::FORBIDDEN, "NON_AUTORISE"),
            AppError::ChampNonModifiable { .. } => (StatusCode::FORBIDDEN, "CHAMP_NON_MODIFIABLE"),
            AppError::Conflit(_) => (StatusCode::CONFLICT, "CONFLIT"),
            AppError::Interne(_) | AppError::Sqlx(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "ERREUR_INTERNE")
            }
        };

        // Les erreurs internes sont journalisees mais jamais detaillees au client.
        if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(erreur = ?self, "erreur interne");
        }

        let message = match &self {
            AppError::Interne(_) | AppError::Sqlx(_) => {
                "Une erreur interne est survenue.".to_string()
            }
            autre => autre.to_string(),
        };

        (status, Json(json!({ "code": code, "message": message }))).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
