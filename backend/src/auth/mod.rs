//! Authentification et autorisation.

pub mod garde;
pub mod jwt;
pub mod password;
pub mod rbac;
pub mod totp;

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
    /// Le role exige la double authentification et le compte ne l'a pas.
    pub totp_requis: bool,
    /// La session est verrouillee (inactivite).
    pub verrouillee: bool,
}

/// Ce qu'une session verrouillee peut encore faire : se voir, se deverrouiller,
/// se fermer.
const PERMIS_VERROUILLE: &[&str] = &[
    "/api/auth/moi",
    "/api/auth/deverrouiller",
    "/api/auth/verrouiller",
    "/api/auth/deconnexion",
    "/api/auth/preferences",
];

/// Ce qu'un compte sans la double authentification exigee peut encore faire :
/// la poser, changer son mot de passe, se fermer.
const PERMIS_SANS_TOTP: &[&str] = &[
    "/api/auth/moi",
    "/api/auth/2fa/preparer",
    "/api/auth/2fa/activer",
    "/api/auth/mot-de-passe",
    "/api/auth/deverrouiller",
    "/api/auth/verrouiller",
    "/api/auth/deconnexion",
    "/api/auth/preferences",
];

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
        // LE ROLE EST RELU AVEC LUI (06/10/2026), pas pris dans le jeton : un
        // compte retrograde perdait sinon ses droits huit heures plus tard
        // seulement, avec les permissions de l'ancien role et la grille de
        // champs du nouveau.
        // LE CHANGEMENT DE MOT DE PASSE FERME LES SESSIONS ANTERIEURES (audit
        // v4) : un jeton emis avant reste refuse, meme non expire.
        // LA SESSION EST TENUE PAR LE SERVEUR (audit du 13/10/2026) : un jeton
        // dont la session est absente ou revoquee (deconnexion) est refuse ; une
        // session verrouillee (inactivite) ne sert plus qu'a se deverrouiller,
        // meme apres un rechargement de la page.
        #[allow(clippy::type_complexity)]
        let compte: Option<(i64, String, Option<i64>, i64, i64, Option<i64>, Option<String>, Option<String>)> =
            sqlx::query_as(
                "SELECT u.actif, u.code_role_user, u.mot_de_passe_change_le, u.totp_actif,
                        COALESCE(r.exige_totp, 0)::int8, s.expire_le, s.revoquee_le, s.verrouillee_le
                   FROM utilisateur u
                   LEFT JOIN role_utilisateur r ON r.code_role_user = u.code_role_user
                   LEFT JOIN session_ouverte s ON s.sid = $2 AND s.id_utilisateur = u.id_utilisateur
                  WHERE u.id_utilisateur = $1",
            )
            .bind(&claims.sub)
            .bind(&claims.sid)
            .fetch_optional(&state.db)
            .await?;
        let Some((actif, role, change, totp_actif, exige_totp, session, revoquee, verrou)) = compte else {
            return Err(AppError::NonAuthentifie);
        };
        if actif != 1 || change.is_some_and(|c| claims.iat < c) || session.is_none() || revoquee.is_some() {
            return Err(AppError::NonAuthentifie);
        }
        let chemin = parts.uri.path();
        let verrouillee = verrou.is_some();
        if verrouillee && !PERMIS_VERROUILLE.contains(&chemin) {
            return Err(AppError::SessionVerrouillee);
        }
        let totp_requis = exige_totp == 1 && totp_actif != 1;
        if totp_requis && !PERMIS_SANS_TOTP.contains(&chemin) {
            return Err(AppError::DoubleAuthRequise);
        }

        // L'adresse du poste, telle que nginx la transmet (audit v4 : l'audit
        // inscrivait 127.0.0.1, l'adresse du proxy).
        let directe = parts.extensions.get::<ConnectInfo<SocketAddr>>().map(|ConnectInfo(a)| a.ip());
        let adresse_ip = crate::routes::auth_routes::adresse_client(&parts.headers, directe);

        Ok(Utilisateur {
            id: claims.sub,
            login: claims.login,
            role,
            session_id: claims.sid,
            adresse_ip,
            totp_requis,
            verrouillee,
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

    /// Retire de la reponse les champs masques pour cet utilisateur : ceux du
    /// module, et — pour les champs que CE module ne declare pas — les montants
    /// qu'il ne voit dans aucun autre.
    ///
    /// LA GRILLE DU MODULE L'EMPORTE (audit v4, 08/10/2026). L'union ecrasait
    /// tout : l'assistante, a qui la grille des bons ouvre `montant_total_mad`
    /// en ECRITURE, le perdait parce que la valorisation le lui masque, et son
    /// bon affichait « 0,00 MAD ». Un champ declare dans le module garde le
    /// niveau que le module lui donne ; l'union ne couvre que les champs que le
    /// module ignore (complétion, detail des controles, analyses).
    pub async fn masquer(
        &self,
        db: &crate::db::Db,
        module: &str,
        valeur: &mut serde_json::Value,
    ) -> AppResult<()> {
        let mut droits = self.droits(db, module).await?;
        for (champ, niveau) in rbac::sensibles_masques(db, &self.id).await? {
            droits.entry(champ).or_insert(niveau);
        }
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
    /// LE PRIX D'ACHAT ESTIME AU CMUP SE MASQUE A QUI NE VOIT PAS LE CMUP (regle 8,
    /// 09/10/2026). Le plan d'achat estime d'abord au dernier prix d'achat, puis au
    /// catalogue ; le CMUP n'est qu'un dernier recours — et la grille de
    /// l'assistante le lui masque partout ailleurs. Une telle ligne perd ses
    /// montants et se marque « prix a saisir ».
    pub async fn masquer_prix_au_cmup(&self, db: &crate::db::Db, valeur: &mut serde_json::Value) -> AppResult<()> {
        let stock = rbac::droits_champ(db, &self.id, crate::auth::rbac::module::STOCK).await?;
        if !matches!(stock.get("cmup_mad"), Some(rbac::Niveau::Masque)) {
            return Ok(());
        }
        let masquer_ligne = |l: &mut serde_json::Value| {
            if l.get("source_prix").and_then(|v| v.as_str()) == Some("CMUP") {
                if let Some(o) = l.as_object_mut() {
                    for champ in [
                        "prix_estime_mad", "montant_estime_mad", "prix_devise", "montant_devise",
                        "montant_total_mad", "prix_retenu_mad", "prix_mad_suggere", "prix_suggere_devise",
                    ] {
                        if o.contains_key(champ) {
                            o.insert(champ.into(), serde_json::Value::Null);
                        }
                    }
                    o.insert("prix_a_saisir".into(), serde_json::Value::Bool(true));
                }
            }
        };
        match valeur {
            serde_json::Value::Array(a) => a.iter_mut().for_each(masquer_ligne),
            v => masquer_ligne(v),
        }
        Ok(())
    }

    pub async fn poser_contexte(&self, tx: &mut sqlx::PgConnection) -> AppResult<()> {
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
