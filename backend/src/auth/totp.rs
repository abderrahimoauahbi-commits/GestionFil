//! LE SECOND FACTEUR — un code a six chiffres, calcule hors ligne.
//!
//! RIEN NE SORT, RIEN N'ENTRE. Le telephone ne parle a personne : il garde un
//! secret et le combine avec l'heure. Le serveur fait le meme calcul de son
//! cote et compare. C'est ce qui rend cette methode utilisable sur un reseau
//! sans acces internet — et c'est pour cela qu'elle est retenue ici plutot
//! qu'un code envoye par SMS ou par courriel.
//!
//! LE SEUL PREALABLE EST L'HEURE. Les deux horloges doivent s'accorder a une
//! demi-minute pres. Le serveur est synchronise par NTP, les telephones le sont
//! par leur operateur ; on accepte malgre tout la fenetre precedente et la
//! suivante, ce qui laisse une minute et demie de tolerance. Elargir davantage
//! rendrait un code intercepte utilisable trop longtemps.
//!
//! C'EST LA NORME RFC 6238, celle que lisent toutes les applications
//! d'authentification — l'algorithme est fige a SHA-1 et six chiffres parce que
//! Google Authenticator ignore les autres reglages, quoi qu'en dise l'adresse
//! `otpauth://` qu'on lui donne.

use hmac::{Hmac, Mac};
use sha1::Sha1;

type HmacSha1 = Hmac<Sha1>;

/// La duree d'un code, en secondes. Trente est la valeur universelle.
const PAS: u64 = 30;
/// Le nombre de fenetres acceptees de part et d'autre de l'instant present.
const TOLERANCE: i64 = 1;

/// L'alphabet base32 de la RFC 4648, celui qu'attendent les applications.
const B32: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// Un secret neuf, en base32 — vingt caracteres, soit cent bits.
///
/// On ne descend pas en dessous : un secret court se retrouve par force brute
/// hors ligne, et il n'est jamais renouvele une fois pose sur un telephone.
pub fn nouveau_secret() -> String {
    use rand::RngCore;
    let mut octets = [0u8; 20];
    rand::thread_rng().fill_bytes(&mut octets);
    encoder_base32(&octets)
}

/// Encode en base32 sans remplissage : c'est la forme que les applications
/// acceptent, et le remplissage `=` en fait trebucher plusieurs.
fn encoder_base32(octets: &[u8]) -> String {
    let mut sortie = String::new();
    let mut tampon: u32 = 0;
    let mut bits = 0;
    for o in octets {
        tampon = (tampon << 8) | u32::from(*o);
        bits += 8;
        while bits >= 5 {
            sortie.push(B32[((tampon >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        sortie.push(B32[((tampon << (5 - bits)) & 31) as usize] as char);
    }
    sortie
}

/// Decode un secret base32. Rend `None` sur un caractere etranger a l'alphabet
/// plutot que de l'ignorer : un secret mal recopie doit echouer franchement, pas
/// produire un code qui ne marchera jamais sans qu'on sache pourquoi.
fn decoder_base32(texte: &str) -> Option<Vec<u8>> {
    let mut octets = Vec::new();
    let mut tampon: u32 = 0;
    let mut bits = 0;
    for c in texte.chars().filter(|c| *c != '=' && !c.is_whitespace()) {
        let v = B32.iter().position(|b| *b as char == c.to_ascii_uppercase())? as u32;
        tampon = (tampon << 5) | v;
        bits += 5;
        if bits >= 8 {
            octets.push(((tampon >> (bits - 8)) & 0xFF) as u8);
            bits -= 8;
        }
    }
    Some(octets)
}

/// Le code a six chiffres pour une fenetre donnee.
fn code_pour(secret: &[u8], fenetre: u64) -> String {
    let mut mac = HmacSha1::new_from_slice(secret).expect("HMAC accepte toute longueur de cle");
    mac.update(&fenetre.to_be_bytes());
    let somme = mac.finalize().into_bytes();

    // La « troncature dynamique » de la norme : les quatre derniers bits
    // designent l'endroit ou lire les quatre octets qui donnent le code.
    let decalage = (somme[19] & 0x0F) as usize;
    let binaire = ((u32::from(somme[decalage]) & 0x7F) << 24)
        | (u32::from(somme[decalage + 1]) << 16)
        | (u32::from(somme[decalage + 2]) << 8)
        | u32::from(somme[decalage + 3]);
    format!("{:06}", binaire % 1_000_000)
}

/// Le code saisi correspond-il au secret, maintenant ?
///
/// LA COMPARAISON NE S'ARRETE PAS AU PREMIER CARACTERE DIFFERENT. Comparer deux
/// codes avec `==` laisse fuir, par le temps de reponse, combien de chiffres
/// sont justes — et six chiffres se retrouvent alors un par un.
pub fn verifier(secret_base32: &str, code: &str, instant: u64) -> bool {
    let code = code.trim().replace(' ', "");
    if code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    let Some(secret) = decoder_base32(secret_base32) else {
        return false;
    };
    if secret.is_empty() {
        return false;
    }
    let fenetre = (instant / PAS) as i64;
    let mut juste = false;
    for d in -TOLERANCE..=TOLERANCE {
        let f = (fenetre + d).max(0) as u64;
        // Pas de sortie anticipee : on parcourt toujours les trois fenetres.
        juste |= egalite_constante(&code_pour(&secret, f), &code);
    }
    juste
}

/// Compare deux chaines en parcourant toute leur longueur.
fn egalite_constante(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut ecart = 0u8;
    for (x, y) in a.bytes().zip(b.bytes()) {
        ecart |= x ^ y;
    }
    ecart == 0
}

/// L'adresse que l'application mobile lit dans le QR code.
///
/// L'emetteur apparait dans la liste du telephone : sans lui, l'utilisateur qui
/// a trois comptes a deux facteurs voit trois lignes identiques.
pub fn adresse_otpauth(emetteur: &str, login: &str, secret: &str) -> String {
    let e = urlencoder(emetteur);
    format!(
        "otpauth://totp/{e}:{}?secret={secret}&issuer={e}&algorithm=SHA1&digits=6&period=30",
        urlencoder(login)
    )
}

/// Encodage minimal pour une adresse : seuls les caracteres rencontres ici —
/// espaces, accents, ponctuation — ont besoin d'etre echappes.
fn urlencoder(s: &str) -> String {
    let mut sortie = String::new();
    for o in s.as_bytes() {
        match o {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                sortie.push(*o as char)
            }
            _ => sortie.push_str(&format!("%{o:02X}")),
        }
    }
    sortie
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Les vecteurs de la RFC 6238, avec le secret « 12345678901234567890 ».
    /// S'ils passent, une application du commerce donnera les memes codes.
    #[test]
    fn suit_la_norme() {
        let secret = encoder_base32(b"12345678901234567890");
        assert_eq!(code_pour(&decoder_base32(&secret).unwrap(), 1), "287082");
        assert_eq!(
            code_pour(&decoder_base32(&secret).unwrap(), 0x00000000023523EC),
            "081804"
        );
        assert_eq!(
            code_pour(&decoder_base32(&secret).unwrap(), 0x0000000000000001),
            "287082"
        );
    }

    #[test]
    fn base32_fait_l_aller_retour() {
        let secret = nouveau_secret();
        assert_eq!(secret.len(), 32);
        assert_eq!(decoder_base32(&secret).unwrap().len(), 20);
        assert!(decoder_base32("PAS!VALIDE").is_none());
    }

    /// La tolerance couvre la fenetre precedente et la suivante — celui qui
    /// tape son code a la seconde ou il change ne doit pas etre refuse.
    #[test]
    fn accepte_la_fenetre_voisine() {
        let secret = encoder_base32(b"12345678901234567890");
        let maintenant = 59u64;
        let code = code_pour(&decoder_base32(&secret).unwrap(), maintenant / PAS);
        assert!(verifier(&secret, &code, maintenant));
        assert!(verifier(&secret, &code, maintenant + 30));
        assert!(verifier(&secret, &code, maintenant.saturating_sub(30)));
        // Deux fenetres plus loin, c'est refuse.
        assert!(!verifier(&secret, &code, maintenant + 90));
    }

    #[test]
    fn refuse_ce_qui_n_est_pas_un_code() {
        let secret = nouveau_secret();
        assert!(!verifier(&secret, "", 0));
        assert!(!verifier(&secret, "12345", 0));
        assert!(!verifier(&secret, "abcdef", 0));
        assert!(!verifier(&secret, "1234567", 0));
    }
}
