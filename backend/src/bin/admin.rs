//! Outil d'administration hors ligne.
//!
//! Usage :
//!     gestionfil-admin definir-mot-de-passe <login>
//!     gestionfil-admin lister-comptes
//!     gestionfil-admin verifier

// Modules partages avec le serveur, inclus par chemin : cet outil n'en utilise
// qu'une partie, d'ou l'allow.
#[allow(dead_code, unused_imports)]
#[path = "../db.rs"]
mod db;

#[allow(dead_code)]
#[path = "../auth/password.rs"]
mod password;

// La sauvegarde et sa purge sont partagees avec le serveur : les reecrire ici
// ferait deux versions du meme `VACUUM INTO`, et c'est exactement le genre de
// duplication qui finit par diverger sur un detail — le nom du dossier, le
// nombre de copies conservees.
#[allow(dead_code, unused_imports)]
#[path = "../error.rs"]
mod error;

#[allow(dead_code)]
#[path = "../domain/sauvegarde.rs"]
mod sauvegarde;

use anyhow::{bail, Context, Result};
use db::{maintenant, Db};

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let _ = dotenvy::dotenv();

    // Cette commande doit fonctionner AVANT toute configuration : c'est elle
    // qui la cree.
    if args.first().map(String::as_str) == Some("init-config") {
        return init_config();
    }

    // Ces deux-la doivent s'executer SANS OUVRIR LA BASE.
    //
    // `restaurer` remplace le fichier : l'avoir ouvert le verrouille, et la
    // commande echouerait sur sa propre connexion. `lister-sauvegardes` ne lit
    // qu'un dossier et n'a aucune raison de se connecter.
    match args.first().map(String::as_str) {
        Some("restaurer") => {
            let fichier = args.get(1).context("usage : restaurer <fichier de sauvegarde>")?;
            return restaurer(fichier);
        }
        Some("lister-sauvegardes") => return lister_sauvegardes(),
        _ => {}
    }

    let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://../db/gestionfil.db".into());
    let pool = db::connect(&url)
        .await
        .context("connexion a la base impossible")?;

    match args.first().map(String::as_str) {
        Some("definir-mot-de-passe") => {
            let login = args.get(1).context("usage : definir-mot-de-passe <login>")?;
            definir_mot_de_passe(&pool, login).await?;
        }
        Some("lister-comptes") => lister_comptes(&pool).await?,
        Some("verifier") => verifier(&pool).await?,
        Some("sauvegarder") => sauvegarder(&pool).await?,
        Some("diagnostic") => diagnostic(&pool).await?,
        Some("reparer") => reparer(&pool).await?,
        _ => {
            eprintln!("Commandes :");
            eprintln!("  init-config                    Cree le fichier .env avec un secret genere");
            eprintln!("  definir-mot-de-passe <login>   Definit le mot de passe d'un compte");
            eprintln!("  lister-comptes                 Liste les comptes et leur etat");
            eprintln!("  verifier                       Execute les controles metier");
            eprintln!();
            eprintln!("  sauvegarder                    Ecrit une copie complete de la base");
            eprintln!("  lister-sauvegardes             Liste les copies disponibles");
            eprintln!("  restaurer <fichier>            Remplace la base par une sauvegarde");
            eprintln!();
            eprintln!("  diagnostic                     Verifie l'integrite sans rien modifier");
            eprintln!("  reparer                        Reindexe, compacte et reanalyse la base");
            bail!("commande inconnue");
        }
    }
    Ok(())
}

/// Cree `.env` avec un JWT_SECRET aleatoire.
///
/// Le secret n'est jamais une valeur par defaut du code : un secret partage
/// entre toutes les installations ne protege rien.
fn init_config() -> Result<()> {
    use rand::RngCore;

    let chemin = std::path::Path::new(".env");
    if chemin.exists() {
        bail!(".env existe deja — le supprimer d'abord pour le regenerer");
    }

    let mut octets = [0u8; 48];
    rand::thread_rng().fill_bytes(&mut octets);
    let secret: String = octets.iter().map(|o| format!("{o:02x}")).collect();

    let contenu = format!(
        "# Genere par `gestionfil-admin init-config`. Ne pas versionner.\n\
         DATABASE_URL=sqlite://../db/gestionfil.db\n\
         BIND_ADDR=127.0.0.1:8080\n\
         JWT_SECRET={secret}\n\
         JWT_TTL_MINUTES=480\n\
         CORS_ORIGINS=http://localhost:5173\n\
         RUST_LOG=gestionfil=info,tower_http=info,sqlx=warn\n"
    );

    std::fs::write(chemin, contenu).context("ecriture de .env impossible")?;

    println!(".env cree avec un secret aleatoire de 96 caracteres.");
    println!("Etape suivante :");
    println!("  cargo run --bin gestionfil-admin -- definir-mot-de-passe direction");
    Ok(())
}

async fn definir_mot_de_passe(pool: &db::Db, login: &str) -> Result<()> {
    let existe: Option<String> =
        sqlx::query_scalar("SELECT nom FROM utilisateur WHERE login = ?1")
            .bind(login)
            .fetch_optional(pool)
            .await?;
    let nom = existe.with_context(|| format!("compte introuvable : {login}"))?;

    // Mode non interactif pour l'amorcage automatise (CI, script de deploiement).
    // La variable est lue puis retiree de l'environnement du processus.
    let mdp = match std::env::var("GESTIONFIL_MOT_DE_PASSE") {
        Ok(v) => {
            std::env::remove_var("GESTIONFIL_MOT_DE_PASSE");
            v
        }
        Err(_) => {
            let saisie = rpassword::prompt_password(format!("Mot de passe pour {nom} ({login}) : "))?;
            let confirmation = rpassword::prompt_password("Confirmer : ")?;
            if saisie != confirmation {
                bail!("les deux saisies different");
            }
            saisie
        }
    };
    if mdp.chars().count() < 12 {
        bail!("mot de passe trop court : 12 caracteres minimum");
    }

    let hash = password::hacher(&mdp)?;
    sqlx::query("UPDATE utilisateur SET mot_de_passe_hash = ?2 WHERE login = ?1")
        .bind(login)
        .bind(&hash)
        .execute(pool)
        .await?;

    println!("Mot de passe defini pour {login}.");
    Ok(())
}

async fn lister_comptes(pool: &db::Db) -> Result<()> {
    let comptes: Vec<(String, String, String, i64, String)> = sqlx::query_as(
        "SELECT login, nom, code_role_user, actif, mot_de_passe_hash
           FROM utilisateur ORDER BY code_role_user, login",
    )
    .fetch_all(pool)
    .await?;

    println!("{:<12} {:<30} {:<10} {:<8} {}", "LOGIN", "NOM", "ROLE", "ACTIF", "MOT DE PASSE");
    for (login, nom, role, actif, hash) in comptes {
        let etat = if hash == "!A_DEFINIR!" { "A DEFINIR" } else { "defini" };
        println!(
            "{:<12} {:<30} {:<10} {:<8} {}",
            login,
            nom,
            role,
            if actif == 1 { "oui" } else { "non" },
            etat
        );
    }
    Ok(())
}

async fn verifier(pool: &db::Db) -> Result<()> {
    let controles: Vec<(String, String, String, i64)> =
        sqlx::query_as("SELECT code, controle, criticite, anomalies FROM v_controles")
            .fetch_all(pool)
            .await?;

    let mut bloquants = 0;
    println!("{:<6} {:<50} {:<10} {}", "CODE", "CONTROLE", "CRITICITE", "ANOMALIES");
    for (code, libelle, criticite, n) in &controles {
        if criticite == "BLOQUANT" && *n > 0 {
            bloquants += n;
        }
        println!("{code:<6} {libelle:<50} {criticite:<10} {n}");
    }

    println!();
    if bloquants > 0 {
        bail!("{bloquants} anomalie(s) bloquante(s) : mise en production impossible");
    }
    println!("Aucune anomalie bloquante.");
    Ok(())
}

/* -------------------------------------------------------------------------- */
/* Sauvegarde et restauration                                                  */
/* -------------------------------------------------------------------------- */

fn url_base() -> String {
    std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://../db/gestionfil.db".into())
}

fn chemin_base() -> String {
    let u = url_base();
    u.strip_prefix("sqlite://")
        .unwrap_or(&u)
        .split('?')
        .next()
        .unwrap_or_default()
        .to_string()
}

async fn sauvegarder(pool: &Db) -> Result<()> {
    let s = sauvegarde::creer(pool, &url_base())
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    println!("Sauvegarde ecrite : {}", s.chemin);
    println!("  {} octets", s.octets);
    Ok(())
}

fn lister_sauvegardes() -> Result<()> {
    let liste = sauvegarde::lister(&url_base()).map_err(|e| anyhow::anyhow!("{e}"))?;
    if liste.is_empty() {
        println!("Aucune sauvegarde. Executer `sauvegarder` pour en creer une.");
        return Ok(());
    }
    println!("{:<36} {:>12}  {}", "FICHIER", "OCTETS", "DATE");
    for s in &liste {
        println!("{:<36} {:>12}  {}", s.fichier, s.octets, s.date);
    }
    Ok(())
}

/// Remplace la base vivante par une sauvegarde.
///
/// TROIS PRECAUTIONS, ET AUCUNE N'EST FACULTATIVE.
///
/// La sauvegarde est VERIFIEE avant d'etre posee : une copie corrompue
/// remplacerait une base saine, et l'operation ne se rattrape pas dans ce sens.
///
/// La base ACTUELLE est mise de cote, jamais ecrasee. Si la restauration se
/// revele etre une erreur — mauvaise sauvegarde, mauvaise journee — le fichier
/// ecarte est encore la, sous un nom horodate qui dit ce qu'il est.
///
/// Le SERVEUR DOIT ETRE ARRETE. Un autre processus ne peut pas le verifier de
/// facon certaine : on refuse donc si un journal WAL non vide accompagne la
/// base, ce qui est le signe d'une base ouverte. C'est une heuristique, et le
/// message le dit plutot que de laisser croire a une garantie.
fn restaurer(fichier: &str) -> Result<()> {
    use std::path::{Path, PathBuf};

    let base_txt = chemin_base();
    let base = Path::new(&base_txt);
    let dossier = base.parent().context("dossier de base introuvable")?;

    let source: PathBuf =
        if Path::new(fichier).is_absolute() || fichier.contains('/') || fichier.contains('\\') {
            PathBuf::from(fichier)
        } else {
            dossier.join("sauvegardes").join(fichier)
        };

    if !source.exists() {
        bail!("sauvegarde introuvable : {}", source.display());
    }

    // 1. Le serveur tourne-t-il ? Le journal WAL le trahit.
    let wal = base.with_extension("db-wal");
    if wal.exists() && std::fs::metadata(&wal).map(|m| m.len()).unwrap_or(0) > 0 {
        bail!(
            "un journal WAL non vide accompagne la base : le serveur est probablement en cours \
             d'execution. Arretez-le, puis relancez cette commande."
        );
    }

    // 2. La sauvegarde est-elle saine ?
    println!("Verification de la sauvegarde...");
    match std::process::Command::new("sqlite3")
        .arg(&source)
        .arg("PRAGMA integrity_check;")
        .output()
    {
        Ok(o) if String::from_utf8_lossy(&o.stdout).trim() == "ok" => {
            println!("  integrite : ok");
        }
        Ok(o) => bail!(
            "la sauvegarde ne passe pas le controle d'integrite : {}",
            String::from_utf8_lossy(&o.stdout).trim()
        ),
        Err(_) => {
            println!("  sqlite3 absent du PATH : verification impossible.");
            println!("  La restauration se poursuit, mais la sauvegarde n'a PAS ete verifiee.");
        }
    }

    // 3. Mettre la base actuelle de cote, sous un nom qui dit ce que c'est.
    if base.exists() {
        let horodatage: String = maintenant()
            .chars()
            .filter(|c| c.is_ascii_digit())
            .take(14)
            .collect();
        let ecartee = dossier.join(format!("gestionfil-remplacee-{horodatage}.db"));
        std::fs::rename(base, &ecartee).context("impossible d'ecarter la base actuelle")?;
        println!("Base actuelle mise de cote : {}", ecartee.display());
    }

    std::fs::copy(&source, base).context("copie de la sauvegarde impossible")?;
    println!("Base restauree depuis {}", source.display());
    println!();
    println!("Relancez le serveur. Si le resultat ne convient pas, la base precedente");
    println!("est encore dans le dossier, sous le nom `gestionfil-remplacee-*.db`.");
    Ok(())
}

/* -------------------------------------------------------------------------- */
/* Diagnostic et reparation                                                    */
/* -------------------------------------------------------------------------- */

/// Verifie la base sans rien y modifier.
async fn diagnostic(pool: &Db) -> Result<()> {
    println!("DIAGNOSTIC DE LA BASE");
    println!("=====================");
    println!();

    let integrite: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(pool)
        .await?;
    println!("Integrite physique      : {integrite}");

    let cles: Vec<(String, i64, String, i64)> = sqlx::query_as("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    println!(
        "Cles etrangeres         : {}",
        if cles.is_empty() {
            "ok".to_string()
        } else {
            format!("{} violation(s)", cles.len())
        }
    );
    for (table, rowid, cible, _) in cles.iter().take(10) {
        println!("   {table} ligne {rowid} vers {cible}");
    }

    let tables: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
        .fetch_one(pool)
        .await?;
    let vues: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='view'")
        .fetch_one(pool)
        .await?;
    let declencheurs: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'")
            .fetch_one(pool)
            .await?;
    println!("Structure               : {tables} tables, {vues} vues, {declencheurs} declencheurs");

    println!();
    println!("CONTROLES METIER");
    let lignes: Vec<(String, String, String, i64)> =
        sqlx::query_as("SELECT code, controle, criticite, anomalies FROM v_controles ORDER BY code")
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    let total: i64 = lignes.iter().map(|l| l.3).sum();
    for (code, libelle, crit, n) in lignes.iter().filter(|l| l.3 > 0) {
        println!("   {code}  {crit:9} {n:5}  {libelle}");
    }
    println!(
        "   {} controles, {} en anomalie, {} ligne(s) concernee(s)",
        lignes.len(),
        lignes.iter().filter(|l| l.3 > 0).count(),
        total
    );

    println!();
    println!("Rien n'a ete modifie. Utiliser `reparer` pour compacter et reindexer.");
    Ok(())
}

/// Reindexe, compacte et reanalyse.
///
/// CE QUE CETTE COMMANDE NE FAIT PAS : corriger une donnee. Elle ne touche
/// qu'aux structures internes de SQLite — index, pages libres, statistiques.
/// Une anomalie metier ne se repare pas par une commande de maintenance : elle
/// se corrige dans l'application, par quelqu'un qui sait ce que la ligne devrait
/// porter. Laisser croire le contraire ferait plus de degats que le probleme.
async fn reparer(pool: &Db) -> Result<()> {
    println!("Reindexation...");
    sqlx::query("REINDEX").execute(pool).await?;

    println!("Recalcul des statistiques...");
    sqlx::query("ANALYZE").execute(pool).await?;

    println!("Compactage...");
    sqlx::query("VACUUM").execute(pool).await?;

    let integrite: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(pool)
        .await?;
    println!();
    println!("Integrite apres reparation : {integrite}");
    println!();
    println!("Les index sont reconstruits et l'espace libre rendu au disque.");
    println!("Les anomalies METIER ne sont pas affectees : voir `diagnostic`.");
    Ok(())
}
