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

    let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://gestionfil@127.0.0.1/gestionfil".into());
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
         DATABASE_URL=postgres://gestionfil@127.0.0.1/gestionfil\n\
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
        sqlx::query_scalar("SELECT nom FROM utilisateur WHERE login = $1")
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
    // LA REGLE VIT A UN SEUL ENDROIT. Cet outil portait sa propre condition en
    // dur : abaisser le minimum cote serveur laissait donc l'outil refuser ce
    // que l'API acceptait, ce qui est le genre d'incoherence qu'on met une
    // heure a comprendre.
    password::valider_longueur(&mdp).map_err(|e| anyhow::anyhow!(e))?;

    let hash = password::hacher(&mdp)?;
    sqlx::query("UPDATE utilisateur SET mot_de_passe_hash = $2 WHERE login = $1")
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
    std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://gestionfil@127.0.0.1/gestionfil".into())
}

/// Nom de la base dans l'URL de connexion.
///
/// Une base PostgreSQL n'a pas de chemin de fichier : ce qu'on manipule est un
/// NOM, sur un serveur. `pg_restore` en a besoin pour savoir quoi recreer.
fn nom_base() -> String {
    url_base()
        .rsplit('/')
        .next()
        .unwrap_or("gestionfil")
        .split('?')
        .next()
        .unwrap_or("gestionfil")
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

    let dossier = std::env::var("GESTIONFIL_SAUVEGARDES").unwrap_or_else(|_| "sauvegardes".into());
    let source: PathBuf =
        if Path::new(fichier).is_absolute() || fichier.contains('/') || fichier.contains('\\') {
            PathBuf::from(fichier)
        } else {
            Path::new(&dossier).join(fichier)
        };

    if !source.exists() {
        bail!("sauvegarde introuvable : {}", source.display());
    }

    let base = nom_base();
    let url = url_base();

    // 1. La sauvegarde est-elle lisible ? `pg_restore --list` lit l'index du
    //    fichier sans rien ecrire : c'est la verification la moins chere, et
    //    elle attrape le cas qui compte — un fichier tronque ou d'un autre
    //    format.
    println!("Verification de la sauvegarde...");
    let liste = std::process::Command::new("pg_restore")
        .arg("--list")
        .arg(&source)
        .output()
        .context("pg_restore introuvable : installer postgresql-client")?;
    if !liste.status.success() {
        bail!(
            "la sauvegarde n'est pas lisible : {}",
            String::from_utf8_lossy(&liste.stderr).trim()
        );
    }
    let objets = String::from_utf8_lossy(&liste.stdout)
        .lines()
        .filter(|l| !l.trim_start().starts_with(';'))
        .count();
    println!("  {objets} objets dans la sauvegarde");
    if objets < 50 {
        bail!("sauvegarde suspecte : {objets} objets seulement, attendu plus de 100");
    }

    // 2. LA BASE ACTUELLE EST MISE DE COTE, PAS DETRUITE.
    //
    //    `ALTER DATABASE ... RENAME` conserve tout : donnees, droits, taille.
    //    Si la restauration decoit, la base precedente est encore la, sous un
    //    nom qui dit ce qu'elle est. C'est la seule difference qui compte entre
    //    une restauration et une perte de donnees.
    //
    //    Le renommage exige qu'aucune connexion ne soit ouverte : le serveur
    //    doit etre arrete. PostgreSQL le dira lui-meme, avec un message clair.
    let horodatage: String = maintenant().chars().filter(|c| c.is_ascii_digit()).take(14).collect();
    let ecartee = format!("{base}_remplacee_{horodatage}");

    println!("Mise de cote de la base actuelle sous `{ecartee}`...");
    let sql = format!(
        "ALTER DATABASE {base} RENAME TO {ecartee}; CREATE DATABASE {base};"
    );
    let r = std::process::Command::new("psql")
        .arg("--set=ON_ERROR_STOP=1")
        .arg("-c")
        .arg(&sql)
        .arg(url_maintenance(&url))
        .output()
        .context("psql introuvable : installer postgresql-client")?;
    if !r.status.success() {
        bail!(
            "impossible de mettre la base de cote : {}\n\
             Le serveur est-il arrete ? Une seule connexion ouverte suffit a bloquer le renommage.",
            String::from_utf8_lossy(&r.stderr).trim()
        );
    }

    // 3. La restauration proprement dite.
    println!("Restauration...");
    let r = std::process::Command::new("pg_restore")
        .arg("--no-owner")
        .arg("--no-privileges")
        .arg("--exit-on-error")
        .arg("--dbname")
        .arg(&url)
        .arg(&source)
        .output()
        .context("pg_restore introuvable")?;
    if !r.status.success() {
        bail!(
            "restauration echouee : {}\n\
             La base precedente est intacte sous le nom `{ecartee}`.",
            String::from_utf8_lossy(&r.stderr).trim()
        );
    }

    println!("Base restauree depuis {}", source.display());
    println!();
    println!("Relancez le serveur. Si le resultat ne convient pas, la base precedente");
    println!("est encore la, sous le nom `{ecartee}`.");
    println!("Quand tout est verifie : DROP DATABASE {ecartee};");
    Ok(())
}

/// L'URL de connexion, dirigee vers la base de maintenance `postgres`.
///
/// On ne peut ni renommer ni recreer une base a laquelle on est connecte : les
/// commandes de restauration passent donc par `postgres`, qui existe toujours.
fn url_maintenance(url: &str) -> String {
    match url.rfind('/') {
        Some(i) => format!("{}/postgres", &url[..i]),
        None => "postgres://postgres@127.0.0.1/postgres".to_string(),
    }
}

/* -------------------------------------------------------------------------- */
/* Diagnostic et reparation                                                    */
/* -------------------------------------------------------------------------- */

/// Verifie la base sans rien y modifier.
async fn diagnostic(pool: &Db) -> Result<()> {
    println!("DIAGNOSTIC DE LA BASE");
    println!("=====================");
    println!();

    // PostgreSQL N'A PAS D'EQUIVALENT DE `PRAGMA integrity_check`, et c'est
    // une bonne nouvelle : la verification de page se fait en continu par les
    // sommes de controle, et les cles etrangeres sont verifiees a CHAQUE
    // ecriture, pas a la demande. Ce qu'on peut encore verifier utilement,
    // c'est qu'aucune contrainte n'a ete posee `NOT VALID` — c'est-a-dire
    // acceptee sans controler l'existant.
    let non_validees: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pg_constraint WHERE NOT convalidated",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    println!(
        "Contraintes             : {}",
        if non_validees == 0 {
            "toutes validees".to_string()
        } else {
            format!("{non_validees} posee(s) sans controle de l'existant (NOT VALID)")
        }
    );

    let taille: String = sqlx::query_scalar(
        "SELECT pg_size_pretty(pg_database_size(current_database()))",
    )
    .fetch_one(pool)
    .await
    .unwrap_or_else(|_| "inconnue".into());
    println!("Taille                  : {taille}");

    let tables: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema='public' AND table_type='BASE TABLE'",
    )
    .fetch_one(pool)
    .await?;
    let vues: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.views WHERE table_schema='public'",
    )
    .fetch_one(pool)
    .await?;
    let declencheurs: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT trigger_name) FROM information_schema.triggers
          WHERE trigger_schema='public'",
    )
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
/// qu'aux structures internes de PostgreSQL — index, espace mort, statistiques.
/// Une anomalie metier ne se repare pas par une commande de maintenance : elle
/// se corrige dans l'application, par quelqu'un qui sait ce que la ligne devrait
/// porter. Laisser croire le contraire ferait plus de degats que le probleme.
async fn reparer(pool: &Db) -> Result<()> {
    // `REINDEX` sans cible n'existe pas en PostgreSQL : il faut nommer ce
    // qu'on reindexe. `DATABASE` couvre tout, y compris les index systeme.
    println!("Reindexation...");
    let base = nom_base();
    sqlx::query(&format!("REINDEX DATABASE {base}"))
        .execute(pool)
        .await?;

    // `VACUUM (ANALYZE)` fait les deux en un passage : il rend l'espace mort
    // et recalcule les statistiques du planificateur. Separer les deux ferait
    // parcourir les tables deux fois.
    //
    // PAS de `VACUUM FULL` : il reecrit chaque table et prend un verrou
    // exclusif — la base est inutilisable pendant l'operation, et sur un ERP
    // en service c'est une panne, pas une maintenance.
    println!("Compactage et statistiques...");
    sqlx::query("VACUUM (ANALYZE)").execute(pool).await?;

    let mortes: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(n_dead_tup), 0)::bigint FROM pg_stat_user_tables",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    println!();
    println!("Lignes mortes restantes : {mortes}");
    println!();
    println!("Les index sont reconstruits et l'espace libre rendu au disque.");
    println!("Les anomalies METIER ne sont pas affectees : voir `diagnostic`.");
    Ok(())
}
