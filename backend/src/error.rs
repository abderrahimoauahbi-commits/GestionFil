//! Erreurs applicatives et leur traduction HTTP.
//!
//! Les messages metier leves par les declencheurs PL/pgSQL (`RAISE EXCEPTION`)
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

    /// TROP DE TENTATIVES. Distincte d'identifiants invalides, et c'est
    /// volontaire : celui qui s'est trompe trois fois de suite doit savoir que
    /// le compte attend, sinon il continue a taper et allonge l'attente sans
    /// comprendre. Le message porte le delai restant.
    #[error("{0}")]
    TropDeTentatives(String),

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

    /// La session est verrouillee (inactivite) : seul le mot de passe la rouvre.
    #[error("Session verrouillée : saisissez votre mot de passe pour reprendre.")]
    SessionVerrouillee,

    /// Le role exige la double authentification et le compte ne l'a pas posee.
    #[error("La double authentification est obligatoire pour votre rôle : activez-la avant de continuer.")]
    DoubleAuthRequise,

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
                // UN RAISE EXCEPTION DE DECLENCHEUR EST UN MESSAGE METIER, ecrit
                // pour l'utilisateur. On le reconnait a sa routine d'origine
                // plutot qu'a sa premiere lettre : « La ligne du bon ... porte
                // la reference ... » tombait sinon en « erreur interne ».
                let leve_par_declencheur = db
                    .try_downcast_ref::<sqlx::postgres::PgDatabaseError>()
                    .and_then(|pg| pg.routine())
                    .is_some_and(|r| r == "exec_stmt_raise");
                // UN CRITERE STABLE, PAS LA PREMIERE LETTRE (10/10/2026). On
                // devinait aussi a la premiere lettre (R, C, B) ou a des mots
                // (« Transition », « recette »...) : une erreur technique dont le
                // message commencait par l'une d'elles passait pour une regle
                // metier, et un message metier sans ces mots tombait en erreur
                // interne. Le critere est maintenant l'origine (un RAISE de
                // PL/pgSQL) ou le code SQLSTATE d'un RAISE sans code propre (P0001).
                if leve_par_declencheur || db.code().as_deref() == Some("P0001") {
                    return AppError::RegleMetier(msg);
                }

                // LES CONTRAINTES SE LISENT PAR LEUR CODE SQLSTATE, pas par leur
                // message : PostgreSQL parle la langue du serveur, et « UNIQUE
                // constraint failed » etait la formule de SQLite. Un numero de
                // facture deja pris tombait ainsi en « erreur interne », sans un
                // mot pour celui qui saisit.
                let detail = db
                    .try_downcast_ref::<sqlx::postgres::PgDatabaseError>()
                    .and_then(|pg| pg.detail())
                    .map(|d| format!(" {d}"))
                    .unwrap_or_default();
                match db.code().as_deref() {
                    Some("23505") => AppError::Conflit(format!("Cet enregistrement existe déjà.{detail}")),
                    Some("23503") => AppError::Invalide(format!(
                        "Référence liée absente, ou encore utilisée ailleurs.{detail}"
                    )),
                    Some("23514") => AppError::Invalide(format!("Valeur refusée par une règle de la base : {msg}")),
                    Some("23502") => AppError::Invalide(format!("Un champ obligatoire manque : {msg}")),
                    // LA CONCURRENCE SE DIT (audit v4) : un interblocage, un
                    // verrou tenu ou un delai depasse tombaient en « erreur
                    // interne ». Rien n'est ecrit ; on peut recommencer.
                    Some("40P01") => AppError::Conflit(
                        "Deux saisies se sont croisées : l'opération a été annulée, rien n'est enregistré. Recommencez.".into(),
                    ),
                    Some("55P03") => AppError::Conflit(
                        "Ce document est en cours de modification par quelqu'un d'autre : réessayez dans un instant.".into(),
                    ),
                    Some("57014") => AppError::Conflit(
                        "L'opération a dépassé le délai autorisé et a été annulée : rien n'est enregistré. Réessayez, ou prévenez l'administrateur si cela se répète.".into(),
                    ),
                    _ => AppError::Sqlx(e),
                }
            }
            _ => AppError::Sqlx(e),
        }
    }
}

/// LE CODE DE LA REGLE, tire du message (10/10/2026) : « R02 : stock
/// insuffisant » -> R02 ; « TAUX-ECART : le taux... » -> TAUX-ECART. L'ecran s'y
/// fie au lieu de decouper le texte, qui peut changer de redaction.
pub fn code_de_regle(message: &str) -> Option<String> {
    let (tete, _) = message.split_once(':')?;
    let tete = tete.trim();
    let valide = (2..=24).contains(&tete.len())
        && tete.starts_with(|c: char| c.is_ascii_uppercase())
        && tete.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-' || c == '_')
        && tete.chars().any(|c| c.is_ascii_digit() || c == '-' || c == '_' || tete.len() <= 6);
    valide.then(|| tete.to_string())
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            AppError::RegleMetier(_) => (StatusCode::UNPROCESSABLE_ENTITY, "REGLE_METIER"),
            AppError::Introuvable(_) => (StatusCode::NOT_FOUND, "INTROUVABLE"),
            AppError::Invalide(_) => (StatusCode::BAD_REQUEST, "INVALIDE"),
            AppError::NonAuthentifie => (StatusCode::UNAUTHORIZED, "NON_AUTHENTIFIE"),
            AppError::IdentifiantsInvalides => (StatusCode::UNAUTHORIZED, "IDENTIFIANTS_INVALIDES"),
            // 429 et non 401 : ce n'est pas le mot de passe qui est refuse,
            // c'est la cadence. Un client qui reessaie en boucle doit pouvoir
            // faire la difference.
            AppError::TropDeTentatives(_) => {
                (StatusCode::TOO_MANY_REQUESTS, "TROP_DE_TENTATIVES")
            }
            AppError::NonAutorise { .. } => (StatusCode::FORBIDDEN, "NON_AUTORISE"),
            AppError::ChampNonModifiable { .. } => (StatusCode::FORBIDDEN, "CHAMP_NON_MODIFIABLE"),
            AppError::Conflit(_) => (StatusCode::CONFLICT, "CONFLIT"),
            AppError::SessionVerrouillee => (StatusCode::LOCKED, "SESSION_VERROUILLEE"),
            AppError::DoubleAuthRequise => (StatusCode::FORBIDDEN, "DOUBLE_AUTH_REQUISE"),
            AppError::Interne(_) | AppError::Sqlx(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "ERREUR_INTERNE")
            }
        };

        // Les erreurs internes sont journalisees mais jamais detaillees au client.
        // UN NUMERO D'INCIDENT (10/10/2026) : le meme au journal et a l'ecran, pour
        // que l'administrateur retrouve la ligne au lieu de chercher a l'heure pres.
        let incident = (status == StatusCode::INTERNAL_SERVER_ERROR)
            .then(|| uuid::Uuid::new_v4().simple().to_string()[..8].to_uppercase());
        if let Some(i) = &incident {
            tracing::error!(incident = %i, erreur = ?self, "erreur interne");
        }

        let message = match &self {
            AppError::Interne(_) | AppError::Sqlx(_) => format!(
                "Une erreur interne est survenue (incident {}). Rien n'a été enregistré ; \
                 si elle revient, donnez ce numéro à l'administrateur.",
                incident.as_deref().unwrap_or("?")
            ),
            autre => autre.to_string(),
        };
        let regle = match &self {
            AppError::RegleMetier(m) | AppError::Conflit(m) | AppError::Invalide(m) => code_de_regle(m),
            _ => None,
        };

        let mut corps = json!({ "code": code, "message": message });
        if let Some(r) = regle {
            corps["regle"] = json!(r);
        }
        if let Some(i) = incident {
            corps["incident"] = json!(i);
        }
        (status, Json(corps)).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::code_de_regle;

    #[test]
    fn le_code_de_la_regle_se_lit_en_tete_du_message() {
        assert_eq!(code_de_regle("R02 : stock insuffisant").as_deref(), Some("R02"));
        assert_eq!(code_de_regle("R02-LOT : le solde du lot").as_deref(), Some("R02-LOT"));
        assert_eq!(code_de_regle("TAUX-ECART : le taux saisi").as_deref(), Some("TAUX-ECART"));
        assert_eq!(code_de_regle("B4-4 : le createur ne valide pas").as_deref(), Some("B4-4"));
        assert_eq!(code_de_regle("IMPORT-DUM : une DUM ne s'efface pas").as_deref(), Some("IMPORT-DUM"));
    }

    #[test]
    fn une_phrase_ordinaire_n_a_pas_de_code() {
        assert_eq!(code_de_regle("Transition de statut interdite sur le bon de commande."), None);
        assert_eq!(code_de_regle("La facture FB-1 : montant incoherent"), None);
        assert_eq!(code_de_regle("PLA 100 CHE : 922.5 kg sortis ce jour"), None);
        assert_eq!(code_de_regle("Valeur refusee par une regle de la base : x"), None);
        assert_eq!(code_de_regle("sans deux-points"), None);
    }
}
