//! Point d'entree de l'application de bureau.

// Sous Windows, empeche l'ouverture d'une console derriere la fenetre en
// production. En debug, la console reste utile pour lire les traces.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    gestionfil_bureau_lib::run()
}
