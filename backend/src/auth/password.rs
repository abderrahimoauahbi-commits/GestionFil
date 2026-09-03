//! Hachage et verification des mots de passe (Argon2id, CDC L1/L4).

use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use password_hash::{rand_core::OsRng, SaltString};

/// Utilise par le binaire `gestionfil-admin` (unite de compilation distincte)
/// et par les tests.
#[allow(dead_code)]
pub fn hacher(mot_de_passe: &str) -> anyhow::Result<String> {
    let sel = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(mot_de_passe.as_bytes(), &sel)
        .map(|h| h.to_string())
        .map_err(|e| anyhow::anyhow!("hachage impossible : {e}"))
}

/// Renvoie `false` — jamais une erreur — si le hash stocke est invalide.
///
/// Les comptes livres par le seed portent le marqueur `!A_DEFINIR!`, qui n'est
/// pas un hash Argon2 valide : ils doivent echouer proprement, pas faire tomber
/// la requete.
pub fn verifier(mot_de_passe: &str, hash_stocke: &str) -> bool {
    match PasswordHash::new(hash_stocke) {
        Ok(hash) => Argon2::default()
            .verify_password(mot_de_passe.as_bytes(), &hash)
            .is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hachage_puis_verification() {
        let h = hacher("Motdepasse!2026").unwrap();
        assert!(verifier("Motdepasse!2026", &h));
        assert!(!verifier("mauvais", &h));
    }

    #[test]
    fn hash_invalide_renvoie_faux_sans_paniquer() {
        assert!(!verifier("peu importe", "!A_DEFINIR!"));
        assert!(!verifier("peu importe", ""));
    }
}

/// Longueur minimale d'un mot de passe.
///
/// DOUZE, ET NON HUIT. Un mot de passe de huit caracteres se casse aujourd'hui
/// en quelques heures sur une carte graphique grand public, meme hache en
/// Argon2 : la longueur est le seul facteur qui rende l'attaque hors de portee,
/// bien avant la complexite. Exiger une majuscule et un chiffre pousse surtout
/// a choisir `Password1!`, que les dictionnaires connaissent.
pub const LONGUEUR_MINIMALE: usize = 12;

/// Verifie la longueur, en CARACTERES et non en octets.
///
/// `len()` compterait les octets : « été2026motdepasse » ferait 20 octets pour
/// 17 caracteres, et un mot de passe court en caracteres accentues passerait.
pub fn valider_longueur(mot_de_passe: &str) -> Result<(), String> {
    if mot_de_passe.chars().count() < LONGUEUR_MINIMALE {
        return Err(format!(
            "mot de passe trop court : {LONGUEUR_MINIMALE} caracteres minimum"
        ));
    }
    Ok(())
}
