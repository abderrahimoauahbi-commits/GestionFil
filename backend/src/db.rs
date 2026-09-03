//! Pool de connexions PostgreSQL et contexte de session.
//!
//! # Le contexte d'audit, et pourquoi il a change de forme
//!
//! Les declencheurs d'audit doivent savoir QUI ecrit. Sous SQLite, l'identite
//! etait posee dans `_contexte_session`, une table a une seule ligne :
//! l'ecriture etant serialisee par le moteur, un seul redacteur pouvait s'y
//! trouver a la fois.
//!
//! POSTGRESQL ECRIT EN CONCURRENCE, ET LE PROCEDE NE TIENT PLUS. Seize
//! connexions du pool peuvent ecrire en meme temps : le magasinier pose son
//! identite, l'assistante pose la sienne une milliseconde plus tard, et le
//! declencheur du magasinier lit celle de l'assistante. Le journal attribuerait
//! alors l'action a la mauvaise personne, sans panne et sans signal — le pire
//! defaut possible pour une trace, puisqu'il ne se decouvre que le jour ou elle
//! sert.
//!
//! L'identite voyage donc dans une VARIABLE DE TRANSACTION, posee par
//! `set_config(..., true)` et lue par `current_setting(..., true)`. Elle est
//! portee par la transaction, invisible aux autres sessions, et disparait au
//! COMMIT. Les declencheurs ont ete portes en consequence (66 lectures).

use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use std::str::FromStr;
use std::time::Duration;

/// L'URL de connexion, sans son mot de passe.
///
/// A ECRIRE DANS TOUT JOURNAL A LA PLACE DE L'URL BRUTE. Le journal systemd est
/// lisible par tout administrateur de la machine et conserve des mois : une URL
/// tracee au demarrage y depose le mot de passe de la base en clair, autant de
/// fois que le service redemarre. Vu dans `journalctl` apres la premiere
/// publication — corrige ici, pas dans chaque appelant.
pub fn url_sans_mot_de_passe(url: &str) -> String {
    let Some(debut) = url.find("://") else { return url.to_string() };
    let apres = debut + 3;
    let Some(arobase) = url[apres..].find('@') else { return url.to_string() };
    let identite = &url[apres..apres + arobase];
    match identite.find(':') {
        Some(deux_points) => format!(
            "{}{}:***{}",
            &url[..apres],
            &identite[..deux_points],
            &url[apres + arobase..]
        ),
        None => url.to_string(),
    }
}

pub type Db = PgPool;

pub async fn connect(database_url: &str) -> anyhow::Result<Db> {
    let options = PgConnectOptions::from_str(database_url)?
        // Le fuseau de la SESSION, pas celui du serveur. Toutes les dates du
        // schema sont du texte ISO-8601 en UTC (ADR-001 D-11) : un serveur
        // regle sur Europe/Paris ferait rendre a `current_date` une date
        // decalee d'un jour pendant deux heures chaque nuit.
        .options([("timezone", "UTC")]);

    let pool = PgPoolOptions::new()
        // Seize connexions pour la cible « 50 utilisateurs simultanes » du
        // CDC L3 : un ERP passe l'essentiel de son temps a lire, et les
        // lectures sont courtes.
        .max_connections(16)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(options)
        .await?;

    verifier_schema(&pool).await?;
    Ok(pool)
}

/// Verifie au demarrage que la base chargee est bien celle attendue.
///
/// Mieux vaut refuser de demarrer que servir des ecrans vides sur une base
/// incomplete : l'erreur se lit alors dans le journal du service, pas dans le
/// support utilisateur trois jours plus tard.
async fn verifier_schema(pool: &Db) -> anyhow::Result<()> {
    let tables: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    )
    .fetch_one(pool)
    .await?;
    if tables < 40 {
        anyhow::bail!(
            "schema incomplet ({} tables) : charger db/pg avec charger.py avant de demarrer",
            tables
        );
    }

    let vues: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.views WHERE table_schema = 'public'",
    )
    .fetch_one(pool)
    .await?;
    if vues < 60 {
        anyhow::bail!(
            "vues manquantes ({} sur 73) : le pilotage serait muet sans erreur visible",
            vues
        );
    }

    // Les declencheurs d'audit portent la tracabilite : sans eux le service
    // fonctionne parfaitement et n'enregistre rien. C'est exactement le genre
    // d'absence qu'on ne remarque pas.
    let declencheurs: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT trigger_name) FROM information_schema.triggers
          WHERE trigger_schema = 'public'",
    )
    .fetch_one(pool)
    .await?;
    if declencheurs < 70 {
        anyhow::bail!(
            "declencheurs manquants ({} sur 76) : les regles metier ne seraient plus appliquees",
            declencheurs
        );
    }

    Ok(())
}

/// Renseigne l'identite de l'appelant pour les declencheurs d'audit.
///
/// A appeler en TOUT DEBUT de transaction ecrivante, avant la premiere
/// ecriture : les declencheurs lisent ces variables au moment ou ils
/// s'executent.
///
/// Le troisieme argument de `set_config` vaut `true` : la variable est LOCALE A
/// LA TRANSACTION. Elle disparait au COMMIT et reste invisible aux autres
/// connexions du pool — c'est ce qui empeche deux utilisateurs simultanes de se
/// voler leur identite dans le journal.
pub async fn poser_contexte(
    tx: &mut sqlx::PgConnection,
    id_utilisateur: &str,
    adresse_ip: Option<&str>,
    session_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "SELECT set_config('gestionfil.id_utilisateur', $1, true),
                set_config('gestionfil.adresse_ip',     COALESCE($2, ''), true),
                set_config('gestionfil.session_id',     COALESCE($3, ''), true)",
    )
    .bind(id_utilisateur)
    .bind(adresse_ip)
    .bind(session_id)
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Horodatage au format canonique de la base : ISO-8601 UTC (ADR-001 D-11).
pub fn maintenant() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// Date calendaire du jour, format base.
pub fn aujourdhui() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

/// Arrondi a 4 decimales : quantites en kg et CMUP (ADR-001 D-10).
pub fn arrondi_kg(v: f64) -> f64 {
    (v * 10_000.0).round() / 10_000.0
}

/// Arrondi a 2 decimales : montants en MAD (ADR-001 D-10).
pub fn arrondi_mad(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
