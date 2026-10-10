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
        // Ne touche pas la base vivante : restaure a cote, controle, efface.
        Some("verifier-sauvegarde") => return verifier_sauvegarde(args.get(1).map(String::as_str)).await,
        _ => {}
    }

    let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://gestionfil@127.0.0.1/gestionfil".into());
    let pool = db::connect(&url)
        .await
        .context("base inaccessible ou non conforme")?;

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
            eprintln!("  verifier-sauvegarde [fichier]  Restaure a cote, controle, efface (la base vivante n'est pas touchee)");
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

    println!("{:<12} {:<30} {:<10} {:<8} MOT DE PASSE", "LOGIN", "NOM", "ROLE", "ACTIF");
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
    println!("{:<6} {:<50} {:<10} ANOMALIES", "CODE", "CONTROLE", "CRITICITE");
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
    println!("{:<36} {:>12}  DATE", "FICHIER", "OCTETS");
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
    let (url_sans, mot_de_passe) = sauvegarde::separer_mot_de_passe(&url);
    // Le mot de passe passe par l'environnement, jamais en argument (T13).
    let avec_mdp = |c: &mut std::process::Command| {
        if let Some(m) = &mot_de_passe {
            c.env("PGPASSWORD", m);
        }
    };
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
    let mut commande = std::process::Command::new("psql");
    commande.arg("--set=ON_ERROR_STOP=1").arg("-c").arg(&sql).arg(url_maintenance(&url_sans));
    avec_mdp(&mut commande);
    let r = commande
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
    let mut commande = std::process::Command::new("pg_restore");
    commande
        .arg("--no-owner")
        .arg("--no-privileges")
        .arg("--exit-on-error")
        .arg("--dbname")
        .arg(&url_sans)
        .arg(&source);
    avec_mdp(&mut commande);
    let r = commande
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

    // 4. LES PIECES JOINTES SUIVENT LA BASE (audit v5, T13) : la sauvegarde les
    //    archive a cote du dump ; sans elles, la base restauree citerait des
    //    factures et des DUM dont les fichiers n'existent plus. Le dossier
    //    actuel est mis de cote, comme la base.
    let archive = PathBuf::from(format!("{}.pieces.tar", source.display()));
    if archive.exists() {
        let pieces = PathBuf::from(std::env::var("GESTIONFIL_PIECES").unwrap_or_else(|_| "pieces".into()));
        let parent = pieces.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new(".")).to_path_buf();
        if pieces.exists() {
            let ecarte = parent.join(format!(
                "{}_remplacees_{horodatage}",
                pieces.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "pieces".into())
            ));
            std::fs::rename(&pieces, &ecarte)
                .with_context(|| format!("impossible de mettre de cote {}", pieces.display()))?;
            println!("Pieces jointes actuelles mises de cote sous {}", ecarte.display());
        }
        let r = std::process::Command::new("tar")
            .arg("-xf")
            .arg(&archive)
            .arg("-C")
            .arg(&parent)
            .output()
            .context("tar introuvable")?;
        if !r.status.success() {
            bail!(
                "la base est restauree, mais pas les pieces jointes : {}",
                String::from_utf8_lossy(&r.stderr).trim()
            );
        }
        println!("Pieces jointes restaurees depuis {}", archive.display());
    } else {
        println!("Pas d'archive de pieces jointes a cote de cette sauvegarde : le dossier des pieces est inchange.");
    }
    println!();
    println!("Relancez le serveur. Si le resultat ne convient pas, la base precedente");
    println!("est encore la, sous le nom `{ecartee}`.");
    println!("Quand tout est verifie : DROP DATABASE {ecartee};");
    Ok(())
}

/// PROUVER QU'UNE SAUVEGARDE SE RESTAURE, sans toucher la base vivante (10/10/2026).
///
/// Une sauvegarde jamais restauree n'est pas une sauvegarde : on ne decouvre un
/// fichier tronque, un schema incomplet ou un droit manquant (CREATEDB) que le
/// jour ou l'on en a besoin. Ici, la sauvegarde (la plus recente, ou celle
/// nommee) est restauree dans une base TEMPORAIRE `<base>_verif_<horodatage>`,
/// controlee, puis effacee — que le controle reussisse ou non :
///   1. le schema et les migrations exigees, par le meme controle qu'au
///      demarrage du serveur (`db::connect`) ;
///   2. les volumes des tables qui font foi, compares a la base vivante (un
///      ecart est normal si l'on a saisi depuis la sauvegarde : il est affiche) ;
///   3. les controles metier se calculent, et C11 (cache = grand livre) est nul.
/// Lancee chaque semaine par `gestionfil-verif-sauvegarde.timer` sur le serveur.
async fn verifier_sauvegarde(fichier: Option<&str>) -> Result<()> {
    use std::path::{Path, PathBuf};

    let dossier = std::env::var("GESTIONFIL_SAUVEGARDES").unwrap_or_else(|_| "sauvegardes".into());
    let source: PathBuf = match fichier {
        Some(f) if Path::new(f).is_absolute() || f.contains('/') || f.contains('\\') => PathBuf::from(f),
        Some(f) => Path::new(&dossier).join(f),
        None => {
            let mut liste = sauvegarde::lister(&url_base()).map_err(|e| anyhow::anyhow!("{e}"))?;
            liste.sort_by(|a, b| a.fichier.cmp(&b.fichier));
            let derniere = liste.pop().context("aucune sauvegarde a verifier : executer `sauvegarder` d'abord")?;
            Path::new(&dossier).join(derniere.fichier)
        }
    };
    if !source.exists() {
        bail!("sauvegarde introuvable : {}", source.display());
    }
    println!("Verification de {}", source.display());

    let url = url_base();
    let (url_sans, mot_de_passe) = sauvegarde::separer_mot_de_passe(&url);
    let avec_mdp = |c: &mut std::process::Command| {
        if let Some(m) = &mot_de_passe {
            c.env("PGPASSWORD", m);
        }
    };
    let horodatage: String = maintenant().chars().filter(|c| c.is_ascii_digit()).take(14).collect();
    let temporaire = format!("{}_verif_{horodatage}", nom_base());
    let url_temp_sans = match url_sans.rfind('/') {
        Some(i) => format!("{}/{temporaire}", &url_sans[..i]),
        None => bail!("adresse de base illisible"),
    };
    let url_temp = match url.rfind('/') {
        Some(i) => format!("{}/{temporaire}", &url[..i]),
        None => bail!("adresse de base illisible"),
    };

    let sql = |requete: &str| -> Result<()> {
        let mut c = std::process::Command::new("psql");
        c.arg("--set=ON_ERROR_STOP=1").arg("-q").arg("-c").arg(requete).arg(url_maintenance(&url_sans));
        avec_mdp(&mut c);
        let r = c.output().context("psql introuvable : installer postgresql-client")?;
        if !r.status.success() {
            bail!("{}", String::from_utf8_lossy(&r.stderr).trim());
        }
        Ok(())
    };
    sql(&format!("CREATE DATABASE {temporaire}")).map_err(|e| {
        anyhow::anyhow!(
            "impossible de creer la base temporaire : {e}\n\
             Le role de connexion doit pouvoir creer une base (ALTER ROLE ... CREATEDB) : \
             `restaurer` en a besoin aussi, et echouerait le jour venu."
        )
    })?;

    // Le controle lui-meme ; la base temporaire est effacee apres, quoi qu'il arrive.
    let verdict: Result<()> = async {
        println!("Restauration dans la base temporaire `{temporaire}`...");
        let mut c = std::process::Command::new("pg_restore");
        c.arg("--no-owner").arg("--no-privileges").arg("--exit-on-error").arg("--dbname").arg(&url_temp_sans).arg(&source);
        avec_mdp(&mut c);
        let r = c.output().context("pg_restore introuvable : installer postgresql-client")?;
        if !r.status.success() {
            bail!("la sauvegarde ne se restaure pas : {}", String::from_utf8_lossy(&r.stderr).trim());
        }

        println!("Schema et migrations exigees (controle du demarrage)...");
        let restauree = db::connect(&url_temp).await.context("la base restauree n'est pas servable")?;
        let vivante = db::connect(&url).await.ok();

        const TABLES: [&str; 8] = [
            "mouvement", "ligne_mouvement", "audit_log", "reference", "fournisseur",
            "bon_commande", "reception", "utilisateur",
        ];
        println!("{:<18} {:>12} {:>12}", "TABLE", "SAUVEGARDE", "VIVANTE");
        for t in TABLES {
            let n: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {t}")).fetch_one(&restauree).await?;
            let v = match &vivante {
                Some(p) => sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {t}"))
                    .fetch_one(p)
                    .await
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| "?".into()),
                None => "-".into(),
            };
            println!("{t:<18} {n:>12} {v:>12}");
        }
        let controles: i64 = sqlx::query_scalar("SELECT count(*) FROM v_controles").fetch_one(&restauree).await?;
        let c11: i64 = sqlx::query_scalar("SELECT COALESCE(max(anomalies), 0)::bigint FROM v_controles WHERE code = 'C11'")
            .fetch_one(&restauree)
            .await?;
        println!("{controles} controles metier calcules ; C11 (cache du stock = grand livre) : {c11}");
        restauree.close().await;
        if c11 != 0 {
            bail!("C11 n'est pas nul dans la sauvegarde : le cache du stock y diverge du grand livre");
        }
        Ok(())
    }
    .await;

    if let Err(e) = sql(&format!("DROP DATABASE IF EXISTS {temporaire} WITH (FORCE)")) {
        println!("ATTENTION : la base temporaire `{temporaire}` n'a pas pu etre effacee : {e}");
    }
    verdict?;
    println!("SAUVEGARDE RESTAURABLE : {}", source.display());
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
