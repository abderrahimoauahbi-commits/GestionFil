//! Etat partage entre les handlers.

use crate::config::Config;
use crate::db::Db;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db: Db,
    pub config: Arc<Config>,
    /// La garde de la connexion (audit de securite du 13/10/2026).
    pub garde: Arc<crate::auth::garde::Garde>,
}

impl AppState {
    pub fn new(db: Db, config: Config) -> Self {
        Self {
            db,
            config: Arc::new(config),
            garde: Arc::new(crate::auth::garde::Garde::new()),
        }
    }
}
