//! Configuration de l'application, lue depuis l'environnement.

use anyhow::Result;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub bind_addr: String,
    pub jwt_secret: String,
    pub jwt_ttl_minutes: i64,
    /// Secondes d'inactivite avant que l'ecran ne se verrouille.
    pub verrou_inactivite_secondes: i64,
    pub cors_origins: Vec<String>,
    /// Repertoire de l'interface compilee, servie par le meme processus.
    ///
    /// PRESENT, LE SERVEUR SUFFIT A LUI SEUL : un navigateur sur
    /// http://<serveur>:8080 obtient l'application, et l'API est sur la meme
    /// origine — donc pas de CORS, pas de proxy, rien a installer sur les
    /// postes. ABSENT, le serveur ne rend que l'API : c'est le mode
    /// developpement, ou Vite sert l'interface sur son propre port.
    pub frontend_dir: Option<std::path::PathBuf>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let _ = dotenvy::dotenv();

        let jwt_secret = std::env::var("JWT_SECRET").map_err(|_| {
            anyhow::anyhow!(
                "JWT_SECRET absent. Generer la configuration avec :\n\
                 \x20   cargo run --bin gestionfil-admin -- init-config"
            )
        })?;
        if jwt_secret.len() < 32 {
            anyhow::bail!("JWT_SECRET doit faire au moins 32 caracteres");
        }

        Ok(Self {
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://gestionfil@127.0.0.1/gestionfil".into()),
            bind_addr: std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".into()),
            jwt_secret,
            jwt_ttl_minutes: std::env::var("JWT_TTL_MINUTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(480),
            // LE VERROU D'INACTIVITE, en secondes.
            //
            // Reglable sans recompiler, et c'est voulu : la bonne valeur ne se
            // decide pas au bureau. Deux minutes protegent bien un poste de
            // bureau ; au quai, un magasinier qui va peser une palette revient
            // au bout de trois et retrouve un ecran verrouille. Si le verrou
            // gene, on l'allonge — un verrou contourne ne protege plus rien.
            verrou_inactivite_secondes: std::env::var("VERROU_INACTIVITE_SECONDES")
                .ok()
                .and_then(|v| v.parse().ok())
                .filter(|v: &i64| *v > 0)
                .unwrap_or(120),
            cors_origins: std::env::var("CORS_ORIGINS")
                .unwrap_or_else(|_| "http://localhost:5173".into())
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            // Le defaut vise `web/` a cote de l'executable : c'est la forme que
            // prend le paquet de deploiement. Un repertoire absent n'est pas
            // une erreur — il signifie simplement « API seule ».
            frontend_dir: std::env::var("FRONTEND_DIR")
                .map(std::path::PathBuf::from)
                .ok()
                .or_else(|| {
                    let a_cote = std::path::PathBuf::from("web");
                    a_cote.is_dir().then_some(a_cote)
                })
                .filter(|p| p.is_dir()),
        })
    }
}

