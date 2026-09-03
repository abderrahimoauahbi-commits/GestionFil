//! Les paquets clients : bureau, mobile, et la trace de qui les prend.
//!
//! POURQUOI LE SERVEUR LES SERT LUI-MEME. L'application tourne sur un reseau
//! local, sans acces internet garanti. Renvoyer les gens vers un lien externe
//! reviendrait a leur demander d'aller chercher dehors ce qui est deja ici, et
//! rendrait la mise a jour impossible le jour ou la ligne tombe.
//!
//! LES FICHIERS NE SONT PAS EN BASE. Un installateur pese des megaoctets ; il
//! vit dans un dossier du serveur (`GESTIONFIL_PAQUETS`, par defaut
//! `./telechargements`). La base ne porte que le JOURNAL — qui a pris quelle
//! version, quand. Ce n'est pas de la statistique d'usage : c'est la reponse a
//! la seule question qu'on se pose apres coup, « sur quelle version tourne ce
//! poste ».
//!
//! LE NOM DU FICHIER EST LE CATALOGUE. `gestionfil-windows-0.1.0.exe` se lit
//! seul : plateforme et version en sortent sans qu'aucune table ne les
//! declare. Deposer un fichier suffit a le publier, et c'est exactement ce
//! qu'on veut d'un serveur qu'on administre en SSH.

use crate::auth::rbac::{module, Action};
use crate::auth::Utilisateur;
use crate::error::{AppError, AppResult};
use crate::routes::json::lignes_en_json;
use crate::AppState;
use axum::extract::State;
use axum::Json;
use serde_json::{json, Value};

/// Le dossier des paquets, cree au besoin.
fn dossier() -> std::path::PathBuf {
    std::env::var("GESTIONFIL_PAQUETS")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("./telechargements"))
}

/// Ce qu'un nom de fichier apprend : plateforme et version.
///
/// Convention : `gestionfil-<plateforme>-<version>.<extension>`. Un fichier
/// qui ne la suit pas est ignore plutot que devine — un paquet mal etiquete
/// installe sur un poste est pire qu'un paquet absent.
fn decrire(nom: &str) -> Option<(String, String)> {
    let tronc = nom.rsplit_once('.').map(|(t, _)| t).unwrap_or(nom);
    let reste = tronc.strip_prefix("gestionfil-")?;
    let (plateforme, version) = reste.split_once('-')?;
    if plateforme.is_empty() || version.is_empty() {
        return None;
    }
    Some((plateforme.to_string(), version.to_string()))
}

/// Le libelle d'une plateforme, tel qu'on le montre.
fn libelle(plateforme: &str) -> &'static str {
    match plateforme {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux (.deb)",
        "linuxportable" => "Linux portable (AppImage)",
        "android" => "Android",
        "ios" => "iOS",
        _ => "Autre",
    }
}

/// CE QUE LE PAQUET EXIGE DU POSTE, dit avant le telechargement.
///
/// POURQUOI CE N'EST PAS UN DETAIL. Un installateur qui refuse de demarrer sur
/// un poste trop ancien ne dit jamais pourquoi : il affiche une erreur de
/// bibliotheque manquante, ou ne fait rien du tout. L'utilisateur conclut que
/// le fichier est casse et rappelle. Annoncer la version minimale coute une
/// ligne et evite l'appel.
///
/// Les seuils viennent des dependances reelles de l'application, pas d'une
/// prudence de principe : WebView2 est fourni d'origine a partir de Windows 10
/// 1803 ; webkit2gtk 4.1 arrive avec Ubuntu 22.04 ; Tauri 2 pose macOS 10.15,
/// Android 8 et iOS 13 comme planchers.
fn compatibilite(plateforme: &str) -> &'static str {
    match plateforme {
        "windows" => "Windows 10 version 1803 ou plus recent, 64 bits. \
                      WebView2 est fourni d'origine ; sur une machine plus \
                      ancienne, l'installateur le telecharge.",
        "linux" => "Paquet Debian, pour Ubuntu 22.04 / Debian 12 et plus recents, \
                    64 bits. Demande webkit2gtk 4.1, present d'origine sur ces \
                    versions. Installation : sudo apt install ./gestionfil-linux-*.deb",
        // L'AppImage est une SECONDE FORME DU MEME CLIENT, pas une autre
        // plateforme : un fichier unique, executable sans installation ni
        // droits d'administrateur. Elle pese trente fois plus que le .deb
        // parce qu'elle embarque ses bibliotheques au lieu de les emprunter
        // au systeme — c'est exactement ce qui la rend portable.
        "linuxportable" => "Fichier unique, sans installation ni droits \
                            d'administrateur. Toute distribution 64 bits munie \
                            de FUSE. Rendre executable (chmod +x), puis lancer.",
        "macos" => "macOS 10.15 Catalina ou plus recent. Paquet universel \
                    Intel et Apple Silicon.",
        "android" => "Android 8.0 Oreo ou plus recent (API 26).",
        "ios" => "iOS 13 ou plus recent.",
        _ => "",
    }
}

/// Les paquets disponibles, avec le nombre de fois qu'ils ont ete pris.
///
/// LISIBLE PAR TOUT COMPTE CONNECTE, et c'est deliberé : refuser a un
/// magasinier le droit de reinstaller son propre poste ne protege rien et
/// bloque tout. Le JOURNAL, lui, reste reserve — voir `journal`.
pub async fn lister(
    State(state): State<AppState>,
    _user: Utilisateur,
) -> AppResult<Json<Value>> {
    let dossier = dossier();
    let mut paquets: Vec<Value> = Vec::new();

    if let Ok(entrees) = std::fs::read_dir(&dossier) {
        for e in entrees.flatten() {
            let nom = e.file_name().to_string_lossy().to_string();
            let Some((plateforme, version)) = decrire(&nom) else { continue };
            let taille = e.metadata().map(|m| m.len() as i64).unwrap_or(0);

            let pris: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM telechargement WHERE fichier = $1",
            )
            .bind(&nom)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);

            paquets.push(json!({
                "fichier": nom,
                "plateforme": plateforme,
                "plateforme_libelle": libelle(&plateforme),
                "compatibilite": compatibilite(&plateforme),
                "version": version,
                "taille_octets": taille,
                "nb_telechargements": pris,
                "disponible": 1,
            }));
        }
    }

    // Par plateforme puis version decroissante : la derniere en tete, qui est
    // celle qu'on veut dans quatre-vingt-dix-neuf cas sur cent.
    paquets.sort_by(|a, b| {
        let cle = |v: &Value| {
            (
                v["plateforme"].as_str().unwrap_or("").to_string(),
                std::cmp::Reverse(v["version"].as_str().unwrap_or("").to_string()),
            )
        };
        cle(a).cmp(&cle(b))
    });

    Ok(Json(Value::Array(paquets)))
}

/// Inscrit un telechargement au journal.
///
/// LE FICHIER NE PASSE PLUS PAR ICI. Il est servi en statique sous
/// `/telechargements/`, pour que le bouton de l'ecran soit un VRAI LIEN — qui
/// s'ouvre dans un onglet, se copie, se colle dans un courriel. Cette route ne
/// porte plus que la trace, ecrite par l'ecran au moment du clic.
///
/// ON INSCRIT L'INTENTION, PAS L'OCTET. Un telechargement interrompu laisse sa
/// ligne : la question a laquelle ce journal repond est « qui a voulu quelle
/// version », pas « combien d'octets sont passes ».
pub async fn inscrire(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(d): Json<InscriptionTelechargement>,
) -> AppResult<Json<Value>> {
    let Some((plateforme, version)) = decrire(&d.fichier) else {
        return Err(AppError::Invalide(format!(
            "nom de paquet non conforme : {}",
            d.fichier
        )));
    };
    // Le fichier doit exister : inscrire un nom invente remplirait le journal
    // de lignes qui ne correspondent a rien.
    let chemin = dossier().join(&d.fichier);
    let taille = std::fs::metadata(&chemin)
        .map(|m| m.len() as i64)
        .map_err(|_| AppError::Introuvable(format!("paquet {}", d.fichier)))?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    sqlx::query(
        "INSERT INTO telechargement
             (fichier, plateforme, version, taille_octets, id_utilisateur)
         VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(&d.fichier)
    .bind(&plateforme)
    .bind(&version)
    .bind(taille)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(json!({ "inscrit": true })))
}

#[derive(Debug, serde::Deserialize)]
pub struct InscriptionTelechargement {
    pub fichier: String,
}

/// Le journal : qui a pris quoi, et quand.
///
/// Reserve au module PARAMETRES, parce qu'il nomme des personnes. Savoir qui a
/// telecharge quoi est une donnee d'exploitation, pas une information de
/// gestion que tout le monde consulte.
pub async fn journal(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Lire).await?;

    let rows = sqlx::query(
        "SELECT t.fichier, t.plateforme, t.version, t.taille_octets,
                t.date_telechargement, t.adresse_ip, u.login AS utilisateur
           FROM telechargement t
           JOIN utilisateur u ON u.id_utilisateur = t.id_utilisateur
          ORDER BY t.date_telechargement DESC
          LIMIT 500",
    )
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::PARAMETRES, &mut valeur).await?;
    Ok(Json(valeur))
}

#[cfg(test)]
mod tests {
    use super::decrire;

    #[test]
    fn lit_plateforme_et_version() {
        assert_eq!(
            decrire("gestionfil-windows-0.1.0.exe"),
            Some(("windows".into(), "0.1.0".into()))
        );
        assert_eq!(
            decrire("gestionfil-android-1.2.3-beta.apk"),
            Some(("android".into(), "1.2.3-beta".into()))
        );
    }

    #[test]
    fn refuse_ce_qui_ne_suit_pas_la_convention() {
        // Mieux vaut ignorer un fichier que deviner sa plateforme : un paquet
        // mal etiquete installe sur un poste est pire qu'un paquet absent.
        assert_eq!(decrire("setup.exe"), None);
        assert_eq!(decrire("gestionfil.exe"), None);
        assert_eq!(decrire("gestionfil-windows.exe"), None);
    }
}
