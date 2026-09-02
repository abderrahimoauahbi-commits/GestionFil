//! Sauvegarde de la base.
//!
//! # Pourquoi `pg_dump` et non une copie de fichiers
//!
//! Les fichiers d'un cluster PostgreSQL ne se copient pas a chaud. A tout
//! instant, une partie des ecritures vit dans le journal des transactions et
//! dans les tampons partages ; copier `/var/lib/postgresql` pendant que le
//! serveur tourne produit une sauvegarde incoherente — et rien ne le signale,
//! elle a l'air complete. `pg_dump` demande au serveur lui-meme d'ecrire un
//! instantane transactionnel, sans bloquer les lecteurs ni les redacteurs.
//!
//! # Le format personnalise, pas le SQL en clair
//!
//! `-Fc` produit un fichier compresse et restaurable SELECTIVEMENT :
//! `pg_restore` sait n'en tirer qu'une table, ce qu'un fichier `.sql` ne permet
//! pas. Sur une base de 16 Mo la difference de taille est anecdotique ; la
//! difference le jour ou il faut recuperer une seule table effacee par erreur
//! ne l'est pas.
//!
//! # La sauvegarde n'est pas telechargee par le navigateur
//!
//! Le fichier reste sur le serveur, dans un dossier voisin. Le faire transiter
//! par l'application exposerait les prix, les empreintes de mots de passe et
//! l'audit nominatif a quiconque obtiendrait le jeton d'un compte
//! administrateur. Une sauvegarde se recupere par le systeme de fichiers, par
//! quelqu'un qui y a deja acces.

use crate::db::{maintenant, Db};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Serialize)]
pub struct Sauvegarde {
    pub fichier: String,
    pub chemin: String,
    pub octets: u64,
    pub horodatage: String,
}

#[derive(Debug, Serialize)]
pub struct Existante {
    pub fichier: String,
    pub octets: u64,
    pub date: String,
}

/// Dossier des sauvegardes.
///
/// Il ne se deduit plus du chemin de la base — une URL PostgreSQL n'en designe
/// aucun. Il vient de `GESTIONFIL_SAUVEGARDES`, ou a defaut d'un dossier
/// `sauvegardes/` a cote de l'executable. Un dossier dedie se repere, se
/// sauvegarde a son tour vers un disque externe, et se surveille.
fn dossier() -> PathBuf {
    std::env::var("GESTIONFIL_SAUVEGARDES")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("sauvegardes"))
}

/// Nom du fichier : sujet, date et heure. Trie chronologiquement dans un
/// listing, et deux sauvegardes de la meme seconde ne se marchent pas dessus.
fn nom_fichier() -> String {
    let t = maintenant();
    let propre: String = t.chars().filter(|c| c.is_ascii_digit()).take(14).collect();
    format!("gestionfil-{propre}.dump")
}

/// Ecrit une sauvegarde complete et coherente.
///
/// `db` n'est pas utilise : `pg_dump` ouvre sa propre connexion. Le parametre
/// reste dans la signature pour que l'appelant continue de prouver qu'il tient
/// une base ouverte — sauvegarder une base a laquelle on ne sait pas se
/// connecter n'aurait pas de sens.
pub async fn creer(_db: &Db, database_url: &str) -> AppResult<Sauvegarde> {
    let dossier = dossier();
    std::fs::create_dir_all(&dossier)
        .map_err(|e| AppError::Interne(anyhow::anyhow!("dossier de sauvegarde : {e}")))?;

    let cible = dossier.join(nom_fichier());
    if cible.exists() {
        return Err(AppError::Invalide(
            "une sauvegarde porte deja cet horodatage : reessayez dans une seconde".into(),
        ));
    }

    // L'URL passe en ARGUMENT et non par des variables d'environnement
    // separees : elle contient deja l'hote, le port, la base et le mot de
    // passe, et la decouper pour la recomposer serait une occasion d'erreur.
    //
    // `--no-owner` et `--no-privileges` : la restauration doit pouvoir se faire
    // sous un autre role que `gestionfil` — typiquement `postgres` lors d'une
    // reprise sur un serveur neuf, ou le role applicatif n'existe pas encore.
    let sortie = Command::new("pg_dump")
        .arg("--format=custom")
        .arg("--compress=6")
        .arg("--no-owner")
        .arg("--no-privileges")
        .arg("--file")
        .arg(&cible)
        .arg(database_url)
        .output()
        .map_err(|e| {
            AppError::Interne(anyhow::anyhow!(
                "pg_dump introuvable ou non executable : {e}. \
                 Installer postgresql-client sur le serveur applicatif."
            ))
        })?;

    if !sortie.status.success() {
        // Le fichier partiel part avec l'erreur : une sauvegarde tronquee qui
        // reste dans le dossier serait restauree un jour par quelqu'un qui la
        // croit valide.
        let _ = std::fs::remove_file(&cible);
        return Err(AppError::Interne(anyhow::anyhow!(
            "pg_dump a echoue : {}",
            String::from_utf8_lossy(&sortie.stderr).trim()
        )));
    }

    let octets = std::fs::metadata(&cible).map(|m| m.len()).unwrap_or(0);
    if octets == 0 {
        let _ = std::fs::remove_file(&cible);
        return Err(AppError::Interne(anyhow::anyhow!(
            "pg_dump a produit un fichier vide"
        )));
    }

    Ok(Sauvegarde {
        fichier: cible
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        chemin: cible.to_string_lossy().into_owned(),
        octets,
        horodatage: maintenant(),
    })
}

/// Les sauvegardes deja presentes, de la plus recente a la plus ancienne.
pub fn lister(_database_url: &str) -> AppResult<Vec<Existante>> {
    let dossier = dossier();
    if !dossier.exists() {
        return Ok(Vec::new());
    }

    let mut sorties = Vec::new();
    for entree in std::fs::read_dir(&dossier)
        .map_err(|e| AppError::Interne(anyhow::anyhow!("lecture du dossier : {e}")))?
        .flatten()
    {
        let nom = entree.file_name().to_string_lossy().into_owned();
        if !nom.ends_with(".dump") {
            continue;
        }
        let meta = match entree.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        // La date se lit dans le NOM, pas dans les metadonnees du fichier :
        // une copie vers un disque externe change la date systeme mais pas le
        // nom, et c'est bien la date de la sauvegarde qui interesse.
        let date = nom
            .strip_prefix("gestionfil-")
            .and_then(|r| r.strip_suffix(".dump"))
            .filter(|d| d.len() >= 8)
            .map(|d| {
                format!(
                    "{}-{}-{} {}:{}",
                    &d[0..4],
                    &d[4..6],
                    &d[6..8],
                    d.get(8..10).unwrap_or("00"),
                    d.get(10..12).unwrap_or("00")
                )
            })
            .unwrap_or_else(|| "date inconnue".into());
        sorties.push(Existante { fichier: nom, octets: meta.len(), date });
    }
    sorties.sort_by(|a, b| b.fichier.cmp(&a.fichier));
    Ok(sorties)
}

/// Supprime les sauvegardes au-dela des `garder` plus recentes.
///
/// Appele apres chaque sauvegarde automatique. Jamais apres une sauvegarde
/// manuelle : quelqu'un qui en declenche une avant une operation risquee ne
/// s'attend pas a ce que le geste efface la precedente.
pub fn purger(_database_url: &str, garder: usize) -> AppResult<usize> {
    let existantes = lister("")?;
    if existantes.len() <= garder {
        return Ok(0);
    }
    let dossier = dossier();
    let mut supprimees = 0;
    for e in existantes.iter().skip(garder) {
        if std::fs::remove_file(dossier.join(&e.fichier)).is_ok() {
            supprimees += 1;
        }
    }
    Ok(supprimees)
}
