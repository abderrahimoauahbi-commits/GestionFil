//! LES RETOURS ARRIERE EXIGENT LE DROIT VALIDER (regle 15, 08/10/2026).
//!
//! La table `transition_statut` dit quels enchainements existent, et le
//! declencheur de la base refuse les autres. Elle porte aussi un `role_requis`
//! que personne ne lisait — et dont les roles (ACHAT, QUALITE, PLANIF) ne
//! correspondent a aucun compte. Resultat constate a l'audit du 08/10 : avec le
//! seul droit ECRIRE, un magasinier remettait une reception validee « a
//! controler » puis l'annulait, la marchandise restant au magasin ; un bon
//! envoye redevenait brouillon ; un plan en service redevenait brouillon et les
//! besoins tombaient a zero.
//!
//! La regle tient en deux phrases :
//!
//!   * un document qui QUITTE UN ETAT ENGAGE (valide, envoye, en service,
//!     cloture) pour revenir en arriere ou etre annule, c'est un acte de
//!     validation : il exige VALIDER sur le module ;
//!   * quand ce retour a sa procedure — `/api/devalider`, qui exige un motif et
//!     refuse tant que le stock tient — les routes de statut le refusent et y
//!     renvoient. Une seule porte, celle qui verifie le stock.
//!
//! Annuler son propre brouillon, retirer une demande de validation, ramener
//! une simulation en brouillon restent de simples ecritures.

use crate::auth::rbac::Action;
use crate::auth::Utilisateur;
use crate::db::Db;
use crate::error::{AppError, AppResult};

/// Le rang d'un etat dans la vie du document : plus il est haut, plus le
/// document engage. `None` pour l'annulation, qui se juge a part.
fn rang(entite: &str, statut: &str) -> Option<u8> {
    let ordre: &[&str] = match entite {
        "bon_commande" => &["BROUILLON", "EN_ATTENTE_VALIDATION", "VALIDE", "ENVOYE", "LIVRE_PARTIEL", "CLOTURE"],
        "reception" => &["BROUILLON", "A_CONTROLER", "VALIDE", "CLOTURE"],
        "plan_production" => &["BROUILLON", "SIMULATION", "EN_COURS", "CLOTURE"],
        "qualite" => &["BROUILLON", "ACTIF", "CLOTURE"],
        "inventaire" => &["BROUILLON", "VALIDE", "CLOTURE"],
        _ => &[],
    };
    ordre.iter().position(|s| *s == statut).map(|p| p as u8)
}

/// Le premier etat qui engage : en dessous, tout se defait par simple ecriture.
fn seuil_engage(entite: &str) -> u8 {
    match entite {
        "bon_commande" => 2,    // VALIDE
        "reception" => 2,       // VALIDE : la marchandise est en stock
        "plan_production" => 2, // EN_COURS : il alimente le MRP
        "qualite" => 1,         // ACTIF : elle se planifie
        "inventaire" => 1,      // VALIDE : le comptage est fige (13/10/2026)
        _ => u8::MAX,
    }
}

/// SORTIR DE SERVICE SANS EXECUTION (audit v4) : clore un bon envoye qui n'a
/// pas tout recu, ou un plan encore en service, abandonne un engagement — les
/// besoins tombent, la commande s'arrete. C'est un acte de validation, comme
/// un retour arriere, meme si l'etat « avance ».
fn est_sortie_de_service(entite: &str, source: &str, cible: &str) -> bool {
    matches!(
        (entite, source, cible),
        ("bon_commande", "ENVOYE" | "LIVRE_PARTIEL", "CLOTURE") | ("plan_production", "EN_COURS", "CLOTURE")
    )
}

/// Vrai si passer de `source` a `cible` fait reculer un document engage.
pub fn est_retour_arriere(entite: &str, source: &str, cible: &str) -> bool {
    if est_sortie_de_service(entite, source, cible) {
        return true;
    }
    let Some(rs) = rang(entite, source) else { return false };
    if rs < seuil_engage(entite) {
        return false;
    }
    match rang(entite, cible) {
        Some(rc) => rc < rs,
        // ANNULE, ANNULEE : quitter un etat engage par l'annulation.
        None => cible.starts_with("ANNUL"),
    }
}

/// Les retours que `/api/devalider` sait faire, avec son motif et sa garde de
/// stock : `(entite, etats de depart, etat retrouve, segment d'URL)`.
const PAR_DEVALIDATION: &[(&str, &[&str], &str, &str)] = &[
    ("bon_commande", &["VALIDE", "ENVOYE"], "BROUILLON", "bons-commande"),
    ("reception", &["VALIDE"], "A_CONTROLER", "receptions"),
    ("plan_production", &["EN_COURS", "CLOTURE"], "BROUILLON", "plans"),
    ("qualite", &["CLOTURE"], "ACTIF", "qualites"),
    ("inventaire", &["CLOTURE"], "VALIDE", "inventaires"),
];

/// A appeler par toute route qui change un statut, avant l'UPDATE.
///
/// Refuse un retour arriere que la devalidation doit faire, et exige VALIDER
/// pour tout autre retour arriere. Ne dit rien d'un passage en avant : celui-la
/// a ses propres droits, poses par la route.
pub async fn exiger_transition(
    db: &Db,
    user: &Utilisateur,
    module: &str,
    entite: &str,
    source: &str,
    cible: &str,
) -> AppResult<()> {
    if !est_retour_arriere(entite, source, cible) {
        return Ok(());
    }
    if entite == "reception" && source == "CLOTURE" {
        return Err(AppError::RegleMetier(
            "Une reception cloturee avec sa facture ne revient plus en arriere : sa valeur se corrige \
             par un avoir ou une facture complementaire (« Avoir » sur la reception)."
                .into(),
        ));
    }
    // Une reception validee a fait entrer de la marchandise : aucun statut ne
    // la fait reculer sans passer par la devalidation, qui verifie le stock.
    let par_devalidation = PAR_DEVALIDATION
        .iter()
        .find(|(e, depuis, vers, _)| *e == entite && depuis.contains(&source) && (*vers == cible || entite == "reception"));
    if let Some((_, _, vers, chemin)) = par_devalidation {
        let stock = if matches!(entite, "reception" | "inventaire") {
            ", une fois ses mouvements de stock contre-passes"
        } else {
            ""
        };
        return Err(AppError::RegleMetier(format!(
            "Retour de {source} a {cible} : passez par « Dévalider » (motif obligatoire, droit VALIDER). \
             Le document revient a {vers}{stock} — /api/devalider/{chemin}."
        )));
    }
    user.exiger(db, module, Action::Valider).await
}

#[cfg(test)]
mod tests {
    use super::est_retour_arriere;

    #[test]
    fn avancer_n_est_pas_reculer() {
        assert!(!est_retour_arriere("bon_commande", "BROUILLON", "EN_ATTENTE_VALIDATION"));
        assert!(!est_retour_arriere("bon_commande", "VALIDE", "ENVOYE"));
        assert!(!est_retour_arriere("reception", "BROUILLON", "A_CONTROLER"));
        assert!(!est_retour_arriere("plan_production", "SIMULATION", "EN_COURS"));
    }

    #[test]
    fn defaire_un_brouillon_reste_une_ecriture() {
        assert!(!est_retour_arriere("bon_commande", "BROUILLON", "ANNULE"));
        assert!(!est_retour_arriere("bon_commande", "EN_ATTENTE_VALIDATION", "BROUILLON"));
        assert!(!est_retour_arriere("reception", "A_CONTROLER", "BROUILLON"));
        assert!(!est_retour_arriere("reception", "A_CONTROLER", "ANNULE"));
        assert!(!est_retour_arriere("plan_production", "SIMULATION", "BROUILLON"));
    }

    #[test]
    fn quitter_un_etat_engage_est_un_retour() {
        assert!(est_retour_arriere("bon_commande", "ENVOYE", "BROUILLON"));
        assert!(est_retour_arriere("bon_commande", "VALIDE", "ANNULE"));
        assert!(est_retour_arriere("reception", "VALIDE", "A_CONTROLER"));
        assert!(est_retour_arriere("reception", "VALIDE", "ANNULE"));
        assert!(est_retour_arriere("plan_production", "EN_COURS", "BROUILLON"));
        assert!(est_retour_arriere("qualite", "ACTIF", "BROUILLON"));
        assert!(est_retour_arriere("inventaire", "VALIDE", "ANNULE"));
    }

    #[test]
    fn sortir_de_service_sans_execution_exige_valider() {
        assert!(est_retour_arriere("bon_commande", "ENVOYE", "CLOTURE"));
        assert!(est_retour_arriere("bon_commande", "LIVRE_PARTIEL", "CLOTURE"));
        assert!(est_retour_arriere("plan_production", "EN_COURS", "CLOTURE"));
        assert!(!est_retour_arriere("plan_production", "SIMULATION", "CLOTURE"));
    }
}
