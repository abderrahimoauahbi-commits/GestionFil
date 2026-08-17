//! Enveloppe de bureau de l'ERP Gestion Fil.
//!
//! L'application reste un client du serveur : elle n'embarque ni base de
//! donnees ni logique metier. Une seule source de verite dans l'usine, donc
//! aucun conflit de synchronisation possible sur le stock ou le CMUP.
//!
//! L'URL du serveur est configurable a l'execution : sur un poste d'atelier,
//! elle pointe vers le serveur de l'usine, pas vers localhost.

use tauri::Manager;

/// Adresse du serveur, lue de l'environnement ou repliee sur le poste local.
#[tauri::command]
fn adresse_serveur() -> String {
    std::env::var("GESTIONFIL_API").unwrap_or_else(|_| "http://127.0.0.1:8080".into())
}

/// Informations affichees dans l'ecran « A propos ».
#[tauri::command]
fn version_application() -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "plateforme": std::env::consts::OS,
        "architecture": std::env::consts::ARCH,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![adresse_serveur, version_application])
        .setup(|app| {
            // En developpement, ouvrir les outils evite d'avoir a les chercher
            // dans un menu que la fenetre sans decoration n'expose pas.
            #[cfg(debug_assertions)]
            if let Some(fenetre) = app.get_webview_window("main") {
                fenetre.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("demarrage de l'application impossible");
}
