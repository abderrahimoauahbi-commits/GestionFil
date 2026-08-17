//! Pool de connexions SQLite et contexte de session.
//!
//! Deux contraintes d'integration imposees par la couche SQL (db/README.md) :
//!
//!   1. `PRAGMA foreign_keys = ON` sur CHAQUE connexion. SQLite le desactive par
//!      defaut ; sans lui les controles C03/C04 ne protegent rien.
//!   2. `recursive_triggers` doit rester desactive : l'historisation des
//!      parametres s'appuie sur son etat par defaut.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Executor, SqlitePool};
use std::str::FromStr;
use std::time::Duration;

pub type Db = SqlitePool;

pub async fn connect(database_url: &str) -> anyhow::Result<Db> {
    let options = SqliteConnectOptions::from_str(database_url)?
        .foreign_keys(true)
        .synchronous(SqliteSynchronous::Full)
        .busy_timeout(Duration::from_secs(10))
        // WAL : lectures concurrentes pendant une ecriture. Necessaire pour la
        // cible "50 utilisateurs simultanes" du CDC L3.
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

    let pool = SqlitePoolOptions::new()
        .max_connections(16)
        .acquire_timeout(Duration::from_secs(10))
        .after_connect(|conn, _meta| {
            Box::pin(async move {
                // Ceinture et bretelles : `foreign_keys(true)` ci-dessus le fait
                // deja, mais une regression silencieuse ici corromprait
                // l'integrite referentielle sans aucun signal.
                conn.execute("PRAGMA foreign_keys = ON;").await?;
                conn.execute("PRAGMA recursive_triggers = OFF;").await?;
                Ok(())
            })
        })
        .connect_with(options)
        .await?;

    verifier_schema(&pool).await?;
    Ok(pool)
}

/// Verifie au demarrage que la base chargee est bien celle attendue.
async fn verifier_schema(pool: &Db) -> anyhow::Result<()> {
    let fk: i64 = sqlx::query_scalar("PRAGMA foreign_keys;")
        .fetch_one(pool)
        .await?;
    if fk != 1 {
        anyhow::bail!("PRAGMA foreign_keys n'est pas actif sur la connexion");
    }

    let tables: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .fetch_one(pool)
    .await?;
    if tables < 40 {
        anyhow::bail!(
            "schema incomplet ({} tables) : executer db/build.ps1 avant de demarrer",
            tables
        );
    }

    let ctx: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _contexte_session WHERE id = 1")
        .fetch_one(pool)
        .await?;
    if ctx != 1 {
        anyhow::bail!("_contexte_session absente : le journal d'audit serait anonyme");
    }

    Ok(())
}

/// Renseigne l'identite de l'appelant pour les triggers d'audit.
///
/// A appeler en TOUT DEBUT de transaction ecrivante, avant la premiere ecriture :
/// les triggers d'audit lisent cette table au moment ou ils s'executent.
/// Equivalent SQLite de `SET LOCAL app.id_utilisateur` sous PostgreSQL.
pub async fn poser_contexte(
    tx: &mut sqlx::SqliteConnection,
    id_utilisateur: &str,
    adresse_ip: Option<&str>,
    session_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE _contexte_session
            SET id_utilisateur = ?1, adresse_ip = ?2, session_id = ?3
          WHERE id = 1",
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
