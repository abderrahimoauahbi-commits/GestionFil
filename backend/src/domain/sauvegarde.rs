//! Sauvegarde de la base.
//!
//! POURQUOI `VACUUM INTO` ET NON UNE COPIE DE FICHIER. La base tourne en mode
//! WAL : a tout instant, une partie des ecritures vit dans un journal separe.
//! Copier le seul fichier `.db` pendant que le serveur tourne produit une
//! sauvegarde amputee des dernieres transactions — et rien ne le signale, la
//! copie s'ouvre normalement. `VACUUM INTO` demande a SQLite lui-meme d'ecrire
//! une base complete et coherente, journal replie, sans bloquer les lecteurs.
//!
//! LA SAUVEGARDE N'EST PAS TELECHARGEE PAR LE NAVIGATEUR. Le fichier reste sur
//! le serveur, dans un dossier voisin de la base. Le faire transiter par
//! l'application exposerait les prix, les mots de passe haches et les onze mille
//! lignes d'audit nominatif a quiconque obtiendrait le jeton d'un compte
//! administrateur. Une sauvegarde se recupere par le systeme de fichiers, par
//! quelqu'un qui y a deja acces.

use crate::db::{maintenant, Db};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::{Path, PathBuf};

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

/// Dossier des sauvegardes, deduit de l'emplacement de la base.
///
/// A cote de la base et non dedans : un dossier `db/sauvegardes/` se repere,
/// se sauvegarde a son tour vers un disque externe, et ne risque pas d'etre
/// confondu avec la base vivante par quelqu'un qui liste le dossier.
fn dossier(database_url: &str) -> AppResult<PathBuf> {
    let brut = database_url
        .strip_prefix("sqlite://")
        .unwrap_or(database_url)
        .split('?')
        .next()
        .unwrap_or_default();
    if brut.is_empty() {
        return Err(AppError::Interne(anyhow::anyhow!("chemin de base introuvable")));
    }
    let base = Path::new(brut);
    let parent = base
        .parent()
        .ok_or_else(|| AppError::Interne(anyhow::anyhow!("dossier de base introuvable")))?;
    Ok(parent.join("sauvegardes"))
}

/// Nom du fichier : sujet, date et heure. Trie chronologiquement dans un
/// listing, et deux sauvegardes de la meme minute ne se marchent pas dessus.
fn nom_fichier() -> String {
    let t = maintenant();
    let propre: String = t
        .chars()
        .filter(|c| c.is_ascii_digit())
        .take(14)
        .collect();
    format!("gestionfil-{propre}.db")
}

/// Ecrit une sauvegarde complete et coherente.
pub async fn creer(db: &Db, database_url: &str) -> AppResult<Sauvegarde> {
    let dossier = dossier(database_url)?;
    std::fs::create_dir_all(&dossier)
        .map_err(|e| AppError::Interne(anyhow::anyhow!("dossier de sauvegarde : {e}")))?;

    let cible = dossier.join(nom_fichier());
    if cible.exists() {
        return Err(AppError::Invalide(
            "une sauvegarde porte deja cet horodatage : reessayez dans une seconde".into(),
        ));
    }

    // SQLite attend le chemin en litteral, avec des barres obliques normales
    // meme sous Windows, et les apostrophes doublees.
    let chemin = cible.to_string_lossy().replace('\\', "/");
    let litteral = chemin.replace('\'', "''");
    sqlx::query(&format!("VACUUM INTO '{litteral}'"))
        .execute(db)
        .await?;

    let octets = std::fs::metadata(&cible).map(|m| m.len()).unwrap_or(0);
    Ok(Sauvegarde {
        fichier: cible
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        chemin,
        octets,
        horodatage: maintenant(),
    })
}

/// Les sauvegardes deja presentes, de la plus recente a la plus ancienne.
pub fn lister(database_url: &str) -> AppResult<Vec<Existante>> {
    let dossier = match dossier(database_url) {
        Ok(d) if d.exists() => d,
        _ => return Ok(Vec::new()),
    };

    let mut sorties = Vec::new();
    for entree in std::fs::read_dir(&dossier)
        .map_err(|e| AppError::Interne(anyhow::anyhow!("lecture du dossier : {e}")))?
        .flatten()
    {
        let nom = entree.file_name().to_string_lossy().into_owned();
        if !nom.ends_with(".db") {
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
            .and_then(|r| r.strip_suffix(".db"))
            .filter(|d| d.len() >= 8)
            .map(|d| format!("{}-{}-{} {}:{}", &d[0..4], &d[4..6], &d[6..8],
                             d.get(8..10).unwrap_or("00"), d.get(10..12).unwrap_or("00")))
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
pub fn purger(database_url: &str, garder: usize) -> AppResult<usize> {
    let existantes = lister(database_url)?;
    if existantes.len() <= garder {
        return Ok(0);
    }
    let dossier = dossier(database_url)?;
    let mut supprimees = 0;
    for e in existantes.iter().skip(garder) {
        if std::fs::remove_file(dossier.join(&e.fichier)).is_ok() {
            supprimees += 1;
        }
    }
    Ok(supprimees)
}
