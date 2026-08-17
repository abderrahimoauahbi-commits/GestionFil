//! ERP Gestion Fil - serveur HTTP.
//!
//! Polyfashions Carpet Morocco.
//! Pilotage des achats, stocks et production de matieres premieres.

mod auth;
mod config;
mod crud;
mod db;
mod domain;
mod error;
mod routes;
mod state;

use anyhow::Context;
use config::Config;
use state::AppState;
use std::net::SocketAddr;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "gestionfil=info,tower_http=info,sqlx=warn".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env().context("configuration invalide")?;
    tracing::info!(base = %config.database_url, "connexion a la base");

    let pool = db::connect(&config.database_url)
        .await
        .context("connexion a la base impossible â€” executer db/build.ps1 ?")?;

    alerter_si_comptes_non_initialises(&pool).await?;

    let bind: SocketAddr = config.bind_addr.parse().context("BIND_ADDR invalide")?;
    let app = routes::router(AppState::new(pool, config));

    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(adresse = %bind, "serveur demarre");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(arret_gracieux())
    .await?;

    Ok(())
}

/// Les comptes du seed portent un marqueur de hash invalide : aucune connexion
/// n'est possible tant qu'un mot de passe reel n'a pas ete defini. On le
/// signale au demarrage plutot que de laisser chercher pourquoi la connexion
/// echoue.
async fn alerter_si_comptes_non_initialises(pool: &db::Db) -> anyhow::Result<()> {
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM utilisateur WHERE actif = 1 AND mot_de_passe_hash = '!A_DEFINIR!'",
    )
    .fetch_one(pool)
    .await?;

    if n > 0 {
        tracing::warn!(
            comptes = n,
            "comptes sans mot de passe : executer `cargo run --bin gestionfil-admin -- definir-mot-de-passe <login>`"
        );
    }
    Ok(())
}

async fn arret_gracieux() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("impossible d'ecouter Ctrl+C");
    };
    ctrl_c.await;
    tracing::info!("arret demande, fermeture des connexions");
}

