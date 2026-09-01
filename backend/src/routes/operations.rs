//! Endpoints d'ecriture : cascades et calculs.
//!
//! Les operations irreversibles (validation d'une reception, cloture d'un
//! inventaire) exigent la permission VALIDER, distincte d'ECRIRE : c'est sur
//! cette separation que repose toute la segregation des taches du CDC B4.

use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::domain::{classification, inventaire, mrp, plan_achat, reception, transfert};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
pub struct ParamsPlanAchat {
    pub id_plan: Option<String>,
}

pub async fn figer_recettes(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLANS, Action::Ecrire).await?;
    let n = mrp::figer_recettes(&state.db, &user, &id).await?;
    Ok(Json(json!({ "id_plan": id, "recettes_figees": n })))
}

pub async fn calculer_mrp(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MRP, Action::Ecrire).await?;
    let r = mrp::calculer(&state.db, &user, &id).await?;
    Ok(Json(serde_json::to_value(r)?))
}

pub async fn snapshot_mrp(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MRP, Action::Ecrire).await?;
    let n = mrp::prendre_snapshot(&state.db, &user, &id).await?;
    Ok(Json(json!({ "id_plan": id, "lignes_figees": n })))
}

pub async fn generer_plan_achat(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(p): Query<ParamsPlanAchat>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Ecrire).await?;
    let r = plan_achat::generer(&state.db, &user, p.id_plan.as_deref()).await?;
    Ok(Json(serde_json::to_value(r)?))
}

#[derive(Debug, Deserialize)]
pub struct DemandeConversion {
    /// Propositions a convertir. Vide ou absent : toutes celles ouvertes.
    pub propositions: Option<Vec<String>>,
}

/// Convertit des propositions d'achat en bons de commande.
///
/// Deux permissions sont exigees, et ce n'est pas une precaution excessive :
/// l'operation consomme des propositions ET cree des engagements. Qui n'a que
/// l'une des deux ne doit pas pouvoir franchir la frontiere entre les deux.
pub async fn convertir_plan_achat(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(d): Json<DemandeConversion>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Ecrire).await?;
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Ecrire).await?;
    let r = plan_achat::convertir(&state.db, &user, d.propositions.as_deref()).await?;
    Ok(Json(serde_json::to_value(r)?))
}

pub async fn valider_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Valider).await?;
    let r = reception::valider(&state.db, &user, &id).await?;
    Ok(Json(serde_json::to_value(r)?))
}

/// Expedition : la marchandise quitte le magasin source.
///
/// L'ancien nom `valider` est conserve comme alias, mais il decrivait mal ce
/// qui se passe — il ecrivait les DEUX mouvements d'un coup, et la marchandise
/// arrivait a destination avant d'avoir voyage.
pub async fn expedier_transfert(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Valider).await?;
    let r = transfert::expedier(&state.db, &user, &id).await?;
    Ok(Json(serde_json::to_value(r)?))
}

/// Reception : quelqu'un constate l'arrivee au magasin destinataire.
pub async fn receptionner_transfert(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Valider).await?;
    let r = transfert::receptionner(&state.db, &user, &id).await?;
    Ok(Json(serde_json::to_value(r)?))
}

pub async fn ouvrir_inventaire(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::INVENTAIRE, Action::Ecrire).await?;
    let n = inventaire::ouvrir(&state.db, &user, &id).await?;
    Ok(Json(json!({ "id_inventaire": id, "lignes_a_compter": n })))
}

pub async fn cloturer_inventaire(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::INVENTAIRE, Action::Valider).await?;
    let r = inventaire::cloturer(&state.db, &user, &id).await?;
    Ok(Json(serde_json::to_value(r)?))
}

pub async fn classifier(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::CATALOGUE, Action::Ecrire).await?;
    let r = classification::classifier(&state.db, &user).await?;
    Ok(Json(serde_json::to_value(r)?))
}

/// Suppression definitive d'une reference jamais utilisee.
///
/// La suppression ordinaire du registre est *logique* : elle desactive, parce
/// que mouvements, recettes et commandes passees pointent vers la reference et
/// que les effacer romprait l'historique (R03).
///
/// Reste le cas d'une reference creee par erreur — une faute de frappe qui a
/// produit un doublon — qui n'a jamais servi a rien. La desactiver laisse une
/// ligne morte dans le catalogue pour toujours. Ici, l'effacer ne detruit
/// aucune histoire, puisqu'il n'y en a pas.
///
/// Les usages sont recomptes ICI, jamais sur la foi de l'appelant : l'ecran
/// n'affiche le bouton que lorsqu'il aboutira, mais c'est le serveur qui
/// tranche.
pub async fn supprimer_reference_definitivement(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::CATALOGUE, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let retenants: [(&str, &str); 7] = [
        ("ligne_mouvement", "mouvement(s) de stock"),
        ("recette", "ligne(s) de recette"),
        ("ligne_bc", "ligne(s) de bon de commande"),
        ("ligne_reception", "ligne(s) de reception"),
        ("plan_achat", "proposition(s) d'achat"),
        ("historique_prix", "entree(s) d'historique de prix"),
        ("ligne_inventaire", "ligne(s) d'inventaire"),
    ];

    let mut motifs: Vec<String> = Vec::new();
    for (table, libelle) in retenants {
        let n: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM {table} WHERE code_reference = ?1"
        ))
        .bind(&code)
        .fetch_one(&mut *tx)
        .await?;
        if n > 0 {
            motifs.push(format!("{n} {libelle}"));
        }
    }

    let stock: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(quantite_kg), 0) FROM stock_magasin WHERE code_reference = ?1",
    )
    .bind(&code)
    .fetch_one(&mut *tx)
    .await?;
    if stock.abs() > 0.0001 {
        motifs.push(format!("{stock} kg en stock"));
    }

    if !motifs.is_empty() {
        return Err(AppError::RegleMetier(format!(
            "{code} ne peut pas etre supprimee : elle est retenue par {}. \
             Desactivez-la plutot, son passage doit rester lisible.",
            motifs.join(", ")
        )));
    }

    /* Le rattachement a un groupe d'equivalence ne porte pas d'histoire : il se
       defait sans perte, et le laisser empecherait la suppression par cle
       etrangere. */
    sqlx::query("DELETE FROM reference_groupe_equiv WHERE code_reference = ?1")
        .bind(&code)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM stock_magasin WHERE code_reference = ?1 AND quantite_kg = 0")
        .bind(&code)
        .execute(&mut *tx)
        .await?;

    let res = sqlx::query("DELETE FROM reference WHERE code_reference = ?1")
        .bind(&code)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Introuvable(format!("Reference {code}")));
    }

    tx.commit().await?;
    Ok(Json(json!({ "code_reference": code, "supprime": true, "mode": "definitive" })))
}


/* -------------------------------------------------------------------------- */
/* Frais d'approche                                                            */
/* -------------------------------------------------------------------------- */

#[derive(Debug, serde::Deserialize)]
pub struct NouveauFrais {
    pub id_reception: String,
    pub type_frais: String,
    pub libelle: Option<String>,
    pub montant_devise: f64,
    pub code_devise: String,
    pub taux_change: f64,
    pub cle_repartition: Option<String>,
    pub reference_externe: Option<String>,
    pub notes: Option<String>,
}

/// Enregistre un frais d'approche sur une reception.
///
/// LE FRAIS PORTE SUR L'ENVOI, PAS SUR LA LIGNE. Un conteneur transporte dix
/// references ; le fret se repartit entre elles selon la cle choisie. Demander
/// la repartition a la saisie obligerait a la refaire a chaque correction.
///
/// LA RECEPTION DOIT ETRE VALIDEE. Avant validation, les quantites pesees
/// peuvent encore changer : repartir un fret sur des poids provisoires
/// donnerait un cout de revient qu'il faudrait recalculer sans que rien ne le
/// signale.
pub async fn creer_frais_approche(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(f): Json<NouveauFrais>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::VALORISATION, Action::Ecrire).await?;

    if f.montant_devise < 0.0 {
        return Err(AppError::Invalide("le montant ne peut pas etre negatif".into()));
    }
    if f.taux_change <= 0.0 {
        return Err(AppError::Invalide("le taux de change doit etre positif".into()));
    }

    let statut: Option<String> =
        sqlx::query_scalar("SELECT statut FROM reception WHERE id_reception = ?1")
            .bind(&f.id_reception)
            .fetch_optional(&state.db)
            .await?;
    match statut.as_deref() {
        None => return Err(AppError::Invalide("reception introuvable".into())),
        Some("VALIDE") => {}
        Some(autre) => {
            return Err(AppError::Invalide(format!(
                "la reception est en statut {autre} : les frais ne se repartissent que sur une                  reception validee, dont les poids ne bougent plus"
            )))
        }
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    sqlx::query(
        "INSERT INTO frais_approche (id_reception, type_frais, libelle, montant_devise,
                                     code_devise, taux_change, cle_repartition,
                                     reference_externe, id_utilisateur, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(?7, 'POIDS'), ?8, ?9, ?10)",
    )
    .bind(&f.id_reception)
    .bind(&f.type_frais)
    .bind(&f.libelle)
    .bind(f.montant_devise)
    .bind(&f.code_devise)
    .bind(f.taux_change)
    .bind(&f.cle_repartition)
    .bind(&f.reference_externe)
    .bind(&user.id)
    .bind(&f.notes)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(serde_json::json!({ "enregistre": true })))
}
