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
    /// L'archive des pieces jointes, a cote du dump (audit v4) : la base ne
    /// porte que leurs references, les fichiers sont sur le disque.
    pub pieces: Option<String>,
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
/// L'URL SANS SON MOT DE PASSE, et le mot de passe a part (audit v5, T13).
///
/// Passe en argument, le mot de passe se lisait dans la liste des processus
/// (`ps aux`) le temps de la sauvegarde. Les outils PostgreSQL le prennent dans
/// PGPASSWORD : l'URL leur arrive sans lui. Le mot de passe d'une URL est
/// encode (%XX) ; PGPASSWORD l'attend en clair.
pub fn separer_mot_de_passe(url: &str) -> (String, Option<String>) {
    let Some(schema_fin) = url.find("://") else { return (url.to_string(), None) };
    let (schema, reste) = url.split_at(schema_fin + 3);
    let fin_autorite = reste.find('/').unwrap_or(reste.len());
    let (autorite, chemin) = reste.split_at(fin_autorite);
    let Some(arobase) = autorite.rfind('@') else { return (url.to_string(), None) };
    let (identite, hote) = autorite.split_at(arobase);
    let Some((utilisateur, mdp)) = identite.split_once(':') else { return (url.to_string(), None) };
    let mut clair = Vec::with_capacity(mdp.len());
    let octets = mdp.as_bytes();
    let mut i = 0;
    while i < octets.len() {
        if octets[i] == b'%' && i + 2 < octets.len() {
            if let Ok(v) = u8::from_str_radix(&mdp[i + 1..i + 3], 16) {
                clair.push(v);
                i += 3;
                continue;
            }
        }
        clair.push(octets[i]);
        i += 1;
    }
    (
        format!("{schema}{utilisateur}{hote}{chemin}"),
        Some(String::from_utf8_lossy(&clair).into_owned()),
    )
}

/// Reserve un nom de sauvegarde libre — ATOMIQUEMENT (17/10/2026).
///
/// DEUX DEFAUTS, UN REMEDE. Le nom est horodate a la seconde. Or le serveur
/// sauvegarde a sa fermeture (`main.rs`), et `03-publier.sh` sauvegarde juste
/// apres l'avoir arrete : sur une petite base les deux tombaient dans la meme
/// seconde, la seconde etait REFUSEE, et la publication du 17/10 s'est arretee
/// la — service coupe 17 s. Et en cherchant, pire : deux sauvegardes lancees
/// ENSEMBLE verifiaient toutes deux que le nom etait libre, avant que l'une ne
/// l'ait cree, puis ecrivaient le MEME fichier — deux « succes » pour une seule
/// sauvegarde, et deux `pg_dump` dans un meme fichier peuvent l'entrelacer.
///
/// Le nom se RESERVE donc par une creation exclusive (`create_new`, soit
/// O_EXCL) : un seul appelant peut gagner un nom ; l'autre attend la seconde
/// suivante. Le nom garde son format — la liste des sauvegardes le lit, et son
/// tri reste chronologique. `pg_dump` ecrit ensuite dans le fichier reserve ; s'il
/// echoue, `creer` le supprime.
async fn reserver_nom(dossier: &std::path::Path) -> AppResult<PathBuf> {
    for _ in 0..5 {
        let cible = dossier.join(nom_fichier());
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&cible) {
            Ok(_) => return Ok(cible),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
            }
            Err(e) => {
                return Err(AppError::Interne(anyhow::anyhow!("reservation du fichier de sauvegarde : {e}")));
            }
        }
    }
    Err(AppError::Invalide(
        "cinq sauvegardes sont en cours en meme temps : reessayez dans quelques secondes".into(),
    ))
}

pub async fn creer(_db: &Db, database_url: &str) -> AppResult<Sauvegarde> {
    let dossier = dossier();
    std::fs::create_dir_all(&dossier)
        .map_err(|e| AppError::Interne(anyhow::anyhow!("dossier de sauvegarde : {e}")))?;

    let cible = reserver_nom(&dossier).await?;

    // L'URL passe en ARGUMENT et non par des variables d'environnement
    // separees : elle contient deja l'hote, le port, la base et le mot de
    // passe, et la decouper pour la recomposer serait une occasion d'erreur.
    //
    // `--no-owner` et `--no-privileges` : la restauration doit pouvoir se faire
    // sous un autre role que `gestionfil` — typiquement `postgres` lors d'une
    // reprise sur un serveur neuf, ou le role applicatif n'existe pas encore.
    let (url_sans, mot_de_passe) = separer_mot_de_passe(database_url);
    let mut commande = Command::new("pg_dump");
    commande
        .arg("--format=custom")
        .arg("--compress=6")
        .arg("--no-owner")
        .arg("--no-privileges")
        .arg("--file")
        .arg(&cible)
        .arg(&url_sans);
    if let Some(m) = mot_de_passe {
        commande.env("PGPASSWORD", m);
    }
    let sortie = commande
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
        pieces: archiver_pieces(&cible),
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
            // L'archive des pieces part avec son dump.
            let _ = std::fs::remove_file(dossier.join(format!("{}.pieces.tar", e.fichier)));
        }
    }
    Ok(supprimees)
}

/// LES PIECES JOINTES SE SAUVEGARDENT AVEC LA BASE (audit v4). Une restauration
/// rendait des factures et des DUM dont les fichiers n'existaient plus : la
/// base ne garde que leur chemin. L'archive `<dump>.pieces.tar` est ecrite a
/// cote du dump ; son echec ne fait pas echouer la sauvegarde de la base, il
/// est signale.
pub fn archiver_pieces(dump: &std::path::Path) -> Option<String> {
    let pieces = std::path::PathBuf::from(std::env::var("GESTIONFIL_PIECES").unwrap_or_else(|_| "pieces".into()));
    let vide = std::fs::read_dir(&pieces).map(|mut d| d.next().is_none()).unwrap_or(true);
    if vide {
        return None;
    }
    let cible = std::path::PathBuf::from(format!("{}.pieces.tar", dump.display()));
    let parent = pieces.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(std::path::Path::new("."));
    let nom = pieces.file_name()?.to_os_string();
    let sortie = Command::new("tar").arg("-cf").arg(&cible).arg("-C").arg(parent).arg(&nom).output();
    match sortie {
        Ok(s) if s.status.success() => Some(cible.file_name()?.to_string_lossy().into_owned()),
        Ok(s) => {
            tracing::warn!(erreur = %String::from_utf8_lossy(&s.stderr).trim(), "archive des pieces jointes impossible");
            let _ = std::fs::remove_file(&cible);
            None
        }
        Err(e) => {
            tracing::warn!(erreur = %e, "tar introuvable : pieces jointes non sauvegardees");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::separer_mot_de_passe;

    #[test]
    fn le_mot_de_passe_sort_de_l_url() {
        let (u, m) = separer_mot_de_passe("postgres://gestionfil:p%40ss%3Aw@127.0.0.1:5432/gestionfil?sslmode=disable");
        assert_eq!(u, "postgres://gestionfil@127.0.0.1:5432/gestionfil?sslmode=disable");
        assert_eq!(m.as_deref(), Some("p@ss:w"));
        let (u, m) = separer_mot_de_passe("postgres://gestionfil@127.0.0.1/gestionfil");
        assert_eq!(u, "postgres://gestionfil@127.0.0.1/gestionfil");
        assert!(m.is_none());
    }
}
