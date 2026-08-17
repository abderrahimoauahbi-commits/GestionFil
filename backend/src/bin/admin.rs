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

use anyhow::{bail, Context, Result};

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let _ = dotenvy::dotenv();

    // Cette commande doit fonctionner AVANT toute configuration : c'est elle
    // qui la cree.
    if args.first().map(String::as_str) == Some("init-config") {
        return init_config();
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
        _ => {
            eprintln!("Commandes :");
            eprintln!("  init-config                    Cree le fichier .env avec un secret genere");
            eprintln!("  definir-mot-de-passe <login>   Definit le mot de passe d'un compte");
            eprintln!("  lister-comptes                 Liste les comptes et leur etat");
            eprintln!("  verifier                       Execute les controles metier");
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
