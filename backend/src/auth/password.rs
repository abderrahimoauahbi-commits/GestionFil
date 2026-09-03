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
/// HUIT, SUR DECISION DE LA DIRECTION, ET C'EST UN COMPROMIS ASSUME.
///
/// La valeur etait douze. Ce que coute ce passage a huit, dit franchement : un
/// mot de passe de huit caracteres tombe en quelques heures sur une carte
/// graphique grand public si l'empreinte est volee, la ou douze tient des
/// annees. La longueur est le seul facteur qui compte vraiment — bien avant les
/// majuscules et les chiffres, qui poussent surtout a choisir `Password1!`.
///
/// CE QUI REND LE COMPROMIS TENABLE ICI, et seulement ici : la base n'est
/// joignable que depuis le reseau local de l'usine, PostgreSQL n'ecoute que sur
/// la boucle locale, et Argon2id rend chaque essai en ligne assez lent pour
/// qu'une attaque par le formulaire de connexion n'aboutisse pas. Le risque
/// reel est donc celui d'une empreinte exfiltree — c'est-a-dire d'un serveur
/// deja compromis.
///
/// EN DESSOUS DE HUIT, ON NE DESCEND PAS. C'est le plancher de toutes les
/// recommandations publiques, et le franchir ferait basculer l'attaque en ligne
/// dans le domaine du faisable.
///
/// Pour les comptes de direction, qui voient les prix et valident les engagements,
/// une phrase longue reste vivement conseillee : la regle autorise huit
/// caracteres, elle n'oblige personne a s'y tenir.
pub const LONGUEUR_MINIMALE: usize = 8;

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
