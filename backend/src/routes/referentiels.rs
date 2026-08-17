//! Referentiels a traitement particulier : devises et parametres systeme.
//!
//! Categories, roles BOM, magasins, fournisseurs, catalogue et groupes
//! d'equivalence passent par le moteur CRUD generique (`crate::crud`).
//! Ne restent ici que les entites dont la lecture ou l'ecriture demande une
//! logique propre.

use super::json::lignes_en_json;
use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

// ============================================================================
// Devises et taux de change
// ============================================================================

pub async fn devises(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT d.*,
                (SELECT t.taux FROM taux_change t
                  WHERE t.code_devise = d.code_devise
                    AND date('now') >= date(t.date_debut)
                    AND (t.date_fin IS NULL OR date('now') < date(t.date_fin))
                  ORDER BY t.date_debut DESC LIMIT 1) AS taux_courant
           FROM devise d WHERE d.actif = 1
          ORDER BY d.est_pivot DESC, d.code_devise",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&rows)))
}

pub async fn taux_change(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(devise): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT * FROM taux_change WHERE code_devise = ?1 ORDER BY date_debut DESC",
    )
    .bind(&devise)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&rows)))
}

#[derive(Debug, Deserialize)]
pub struct NouveauTaux {
    pub taux: f64,
    pub date_debut: Option<String>,
    pub source: Option<String>,
}

/// Enregistre un nouveau taux et cloture le precedent.
///
/// RG-09 exige un taux non ambigu a toute date : deux periodes ne peuvent pas
/// se chevaucher (un trigger le garantit). Clore l'ancienne periode a la date
/// de debut de la nouvelle est donc obligatoire, pas optionnel.
pub async fn creer_taux(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(devise): Path<String>,
    Json(t): Json<NouveauTaux>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Ecrire).await?;
    if t.taux <= 0.0 {
        return Err(AppError::Invalide("le taux doit etre strictement positif".into()));
    }

    let debut = t
        .date_debut
        .clone()
        .unwrap_or_else(crate::db::maintenant);

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    sqlx::query(
        "UPDATE taux_change SET date_fin = ?2
          WHERE code_devise = ?1 AND date_fin IS NULL AND date_debut < ?2",
    )
    .bind(&devise)
    .bind(&debut)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO taux_change (code_devise, taux, date_debut, source)
         VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(&devise)
    .bind(t.taux)
    .bind(&debut)
    .bind(&t.source)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "code_devise": devise, "taux": t.taux, "date_debut": debut })))
}

// ============================================================================
// Parametres systeme
// ============================================================================

/// La machine a etats.
///
/// `transition_statut` decide de tout ce qui peut arriver a un bon de commande,
/// a une reception ou a un plan : c'est ce tableau qui autorise un bon valide a
/// partir chez le fournisseur, et qui interdit de le ramener en brouillon.
///
/// Elle est desormais modifiable, a la demande — mais deux garde-fous restent :
/// l'entite doit exister, et le retrait d'une transition est confirme, parce
/// qu'il ferme une porte que des utilisateurs empruntent peut-etre tous les
/// jours sans que rien d'autre ne le signale.
pub async fn transitions(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT entite, statut_source, statut_cible, role_requis, description
           FROM transition_statut
          ORDER BY entite, statut_source, statut_cible",
    )
    .fetch_all(&state.db)
    .await?;
    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::PARAMETRES, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Les roles, avec le nombre de comptes et de permissions attaches.
///
/// Ajouter un role n'aurait aucun effet tant qu'aucune permission ne lui est
/// rattachee, et en retirer un romprait les comptes qui s'y referent. Le jeu de
/// roles est structurel : on le consulte, on l'attribue depuis les utilisateurs,
/// on ne le redessine pas depuis un ecran de parametres.
pub async fn roles_utilisateur(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT r.code_role_user, r.libelle, r.description,
                (SELECT COUNT(*) FROM utilisateur u
                  WHERE u.code_role_user = r.code_role_user AND u.actif = 1) AS nb_utilisateurs,
                (SELECT COUNT(*) FROM permission p
                  WHERE p.code_role_user = r.code_role_user)                 AS nb_permissions,
                (SELECT COUNT(DISTINCT p.module) FROM permission p
                  WHERE p.code_role_user = r.code_role_user)                 AS nb_modules
           FROM role_utilisateur r
          ORDER BY r.code_role_user",
    )
    .fetch_all(&state.db)
    .await?;
    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::PARAMETRES, &mut valeur).await?;
    Ok(Json(valeur))
}

#[derive(Debug, Deserialize)]
pub struct NouvelleTransition {
    pub entite: String,
    pub statut_source: String,
    pub statut_cible: String,
    pub role_requis: Option<String>,
    pub description: Option<String>,
}

/// Ouvre un chemin dans la machine a etats.
///
/// L'entite doit deja figurer dans la table : inventer « bon_livraison » ne
/// creerait aucun comportement, seulement une ligne que personne ne lit. Les
/// statuts, eux, restent libres — mais chaque table porte sa propre contrainte
/// CHECK, qui refusera un statut qu'elle ne connait pas. Mieux vaut ce refus,
/// explicite, qu'une liste figee ici qui divergerait du schema.
pub async fn creer_transition(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(t): Json<NouvelleTransition>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Ecrire).await?;

    if t.statut_source == t.statut_cible {
        return Err(AppError::Invalide(
            "une transition doit relier deux statuts differents".into(),
        ));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let connue: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM transition_statut WHERE entite = ?1")
            .bind(&t.entite)
            .fetch_one(&mut *tx)
            .await?;
    if connue == 0 {
        return Err(AppError::RegleMetier(format!(
            "Entite inconnue : {}. Une transition ne vaut que pour une entite que le code sait \
             faire changer d'etat.",
            t.entite
        )));
    }

    sqlx::query(
        "INSERT INTO transition_statut
             (entite, statut_source, statut_cible, role_requis, description)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(&t.entite)
    .bind(&t.statut_source)
    .bind(&t.statut_cible)
    .bind(&t.role_requis)
    .bind(&t.description)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "cree": true })))
}

#[derive(Debug, Deserialize)]
pub struct CibleTransition {
    pub entite: String,
    pub statut_source: String,
    pub statut_cible: String,
    pub role_requis: Option<String>,
    pub description: Option<String>,
}

/// Modifie ce qui est modifiable : le role exige et la description.
///
/// Le triplet (entite, source, cible) EST l'identite de la transition. Le
/// changer reviendrait a en supprimer une et a en creer une autre, et le faire
/// passer pour une modification masquerait la fermeture d'un chemin.
pub async fn modifier_transition(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(t): Json<CibleTransition>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let r = sqlx::query(
        "UPDATE transition_statut
            SET role_requis = ?4, description = ?5
          WHERE entite = ?1 AND statut_source = ?2 AND statut_cible = ?3",
    )
    .bind(&t.entite)
    .bind(&t.statut_source)
    .bind(&t.statut_cible)
    .bind(&t.role_requis)
    .bind(&t.description)
    .execute(&mut *tx)
    .await?;

    if r.rows_affected() == 0 {
        return Err(AppError::Introuvable("transition".into()));
    }
    tx.commit().await?;
    Ok(Json(json!({ "modifie": true })))
}

/// Ferme un chemin de la machine a etats.
///
/// Rien ne signale ensuite l'absence : l'utilisateur verra simplement un bouton
/// disparaitre, ou un refus qu'il ne comprendra pas. C'est pourquoi l'operation
/// renvoie ce qu'elle a retire, pour que l'ecran puisse le redire.
pub async fn supprimer_transition(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(q): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Ecrire).await?;

    // Le triplet identifie la transition : il passe donc par l'URL, comme
    // n'importe quelle cle. Un DELETE porteur d'un corps est mal supporte par
    // les clients HTTP et n'apporte rien ici.
    let lire = |cle: &str| -> AppResult<String> {
        q.get(cle)
            .filter(|v: &&String| !v.is_empty())
            .cloned()
            .ok_or_else(|| AppError::Invalide(format!("parametre manquant : {cle}")))
    };
    let t = CibleTransition {
        entite: lire("entite")?,
        statut_source: lire("statut_source")?,
        statut_cible: lire("statut_cible")?,
        role_requis: None,
        description: None,
    };

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let restantes: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM transition_statut WHERE entite = ?1 AND statut_source = ?2",
    )
    .bind(&t.entite)
    .bind(&t.statut_source)
    .fetch_one(&mut *tx)
    .await?;

    let r = sqlx::query(
        "DELETE FROM transition_statut
          WHERE entite = ?1 AND statut_source = ?2 AND statut_cible = ?3",
    )
    .bind(&t.entite)
    .bind(&t.statut_source)
    .bind(&t.statut_cible)
    .execute(&mut *tx)
    .await?;

    if r.rows_affected() == 0 {
        return Err(AppError::Introuvable("transition".into()));
    }
    tx.commit().await?;

    // Retirer la DERNIERE sortie d'un statut y enferme les enregistrements : ils
    // ne pourront plus jamais en bouger. On le dit plutot que de le laisser
    // decouvrir.
    Ok(Json(json!({
        "supprime": true,
        "statut_sans_issue": restantes <= 1,
        "entite": t.entite,
        "statut_source": t.statut_source
    })))
}

pub async fn parametres(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT * FROM parametre WHERE actif = 1 ORDER BY categorie, code_parametre",
    )
    .fetch_all(&state.db)
    .await?;
    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::PARAMETRES, &mut valeur).await?;
    Ok(Json(valeur))
}

#[derive(Debug, Deserialize)]
pub struct ModifParametre {
    pub valeur_courante: String,
    pub motif: Option<String>,
}

pub async fn modifier_parametre(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
    Json(m): Json<ModifParametre>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // Les triggers refusent les parametres verrouilles (P_DateSaisie) et
    // historisent tout changement.
    let res = sqlx::query(
        "UPDATE parametre
            SET valeur_courante = ?2, id_utilisateur_modif = ?3, motif_modif = ?4
          WHERE code_parametre = ?1",
    )
    .bind(&code)
    .bind(&m.valeur_courante)
    .bind(&user.id)
    .bind(&m.motif)
    .execute(&mut *tx)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::Introuvable(format!("parametre {code}")));
    }
    tx.commit().await?;

    Ok(Json(json!({ "code_parametre": code, "valeur": m.valeur_courante })))
}

pub async fn historique_parametre(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT h.*, u.login AS auteur
           FROM parametre_historique h
           LEFT JOIN utilisateur u ON u.id_utilisateur = h.id_utilisateur
          WHERE h.code_parametre = ?1
          ORDER BY h.date_modification DESC",
    )
    .bind(&code)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&rows)))
}
