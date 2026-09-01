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

    // Gardes pour la sauvegarde de fermeture : l'etat consomme le pool et la
    // configuration, on en conserve de quoi ecrire une derniere copie.
    let pool_arret = pool.clone();
    let base_arret = config.database_url.clone();

    let app = routes::router(AppState::new(pool, config));

    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(adresse = %bind, "serveur demarre");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(arret_gracieux())
    .await?;

    sauvegarder_a_la_fermeture(&pool_arret, &base_arret).await;

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

/// Une copie complete de la base avant de rendre la main.
///
/// POURQUOI A LA FERMETURE PLUTOT QU'A HEURE FIXE. Le serveur de cette usine
/// n'est pas allume la nuit : une sauvegarde programmee a deux heures ne se
/// declencherait jamais. La fermeture, elle, arrive tous les soirs.
///
/// ELLE NE PEUT PAS FAIRE ECHOUER L'ARRET. Un disque plein ou un dossier en
/// lecture seule ne doit pas empecher le serveur de s'eteindre : l'echec est
/// journalise, l'arret se poursuit. Une sauvegarde manquee se rattrape ; un
/// serveur qui refuse de s'arreter bloque la machine.
///
/// Les dix dernieres sont conservees. Au-dela, une base de cinq megaoctets
/// remplirait le disque sans que personne ne le remarque avant la panne.
async fn sauvegarder_a_la_fermeture(pool: &db::Db, database_url: &str) {
    match domain::sauvegarde::creer(pool, database_url).await {
        Ok(s) => {
            tracing::info!(fichier = %s.fichier, octets = s.octets, "sauvegarde de fermeture");
            match domain::sauvegarde::purger(database_url, 10) {
                Ok(0) => {}
                Ok(n) => tracing::info!(supprimees = n, "anciennes sauvegardes purgees"),
                Err(e) => tracing::warn!(erreur = %e, "purge impossible"),
            }
        }
        Err(e) => tracing::error!(erreur = %e, "SAUVEGARDE DE FERMETURE IMPOSSIBLE"),
    }
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

