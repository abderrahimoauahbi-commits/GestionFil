//! Jetons JWT (HS256).

use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// Identifiant technique de l'utilisateur.
    pub sub: String,
    pub login: String,
    pub role: String,
    /// Identifiant de session, repris dans le journal d'audit.
    pub sid: String,
    pub iat: i64,
    pub exp: i64,
}

pub fn emettre(
    secret: &str,
    id_utilisateur: &str,
    login: &str,
    role: &str,
    ttl_minutes: i64,
) -> anyhow::Result<(String, Claims)> {
    let maintenant = chrono::Utc::now();
    let claims = Claims {
        sub: id_utilisateur.to_string(),
        login: login.to_string(),
        role: role.to_string(),
        sid: uuid::Uuid::new_v4().to_string(),
        iat: maintenant.timestamp(),
        exp: (maintenant + chrono::Duration::minutes(ttl_minutes)).timestamp(),
    };
    let jeton = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?;
    Ok((jeton, claims))
}

pub fn verifier(secret: &str, jeton: &str) -> Option<Claims> {
    decode::<Claims>(
        jeton,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .ok()
    .map(|d| d.claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "un-secret-de-test-suffisamment-long-32";

    #[test]
    fn aller_retour() {
        let (jeton, _) = emettre(SECRET, "u1", "achat", "ACHAT", 60).unwrap();
        let claims = verifier(SECRET, &jeton).expect("jeton valide");
        assert_eq!(claims.sub, "u1");
        assert_eq!(claims.role, "ACHAT");
    }

    #[test]
    fn secret_different_rejete() {
        let (jeton, _) = emettre(SECRET, "u1", "achat", "ACHAT", 60).unwrap();
        assert!(verifier("un-autre-secret-de-test-de-32-caract", &jeton).is_none());
    }

    #[test]
    fn jeton_expire_rejete() {
        // jsonwebtoken tolere 60 s de derive d'horloge par defaut : l'expiration
        // doit depasser cette marge pour que le rejet soit reellement teste.
        let (jeton, _) = emettre(SECRET, "u1", "achat", "ACHAT", -10).unwrap();
        assert!(verifier(SECRET, &jeton).is_none());
    }
}
