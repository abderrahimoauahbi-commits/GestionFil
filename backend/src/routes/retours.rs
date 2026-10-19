//! Les retours fournisseur, sur leur propre page (12/10/2026) : la liste, le
//! document libre (brouillon, puis validation par un autre compte), et le stock
//! qu'on peut rendre. La cascade est dans `domain::retour_fournisseur`.

use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::domain::retour_fournisseur as metier;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use super::json::lignes_en_json;

#[derive(Deserialize)]
pub struct FiltresRetours {
    statut: Option<String>,
    recherche: Option<String>,
}

/// `GET /api/retours-fournisseur` — un retour par ligne, avec ses kilos et le
/// montant de son avoir (masque au magasinier).
pub async fn lister(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<FiltresRetours>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT r.id_retour, r.numero AS numero_retour, r.statut AS statut_retour, r.date_retour,
                r.code_fournisseur, fo.nom AS fournisseur_nom, r.motif,
                uc.login AS saisi_par, uv.login AS valide_par, r.date_validation,
                COALESCE(sum(l.quantite_kg), 0) AS quantite_totale_kg,
                count(l.id_ligne_retour) AS nb_lignes,
                COALESCE(sum(round(l.quantite_kg * l.prix_kg_mad, 2)), 0) AS montant_avoir_mad
           FROM retour_fournisseur r
           JOIN fournisseur fo ON fo.code_fournisseur = r.code_fournisseur
           JOIN utilisateur uc ON uc.id_utilisateur = r.id_utilisateur_creation
           LEFT JOIN utilisateur uv ON uv.id_utilisateur = r.id_utilisateur_validation
           LEFT JOIN ligne_retour_fournisseur l ON l.id_retour = r.id_retour
          WHERE ($1::text IS NULL OR r.statut = $1)
            AND ($2::text IS NULL OR r.numero ILIKE '%' || $2 || '%' OR fo.nom ILIKE '%' || $2 || '%')
          GROUP BY r.id_retour, fo.nom, uc.login, uv.login
          ORDER BY r.date_creation DESC
          LIMIT 500",
    )
    .bind(f.statut.as_deref().filter(|s| !s.is_empty()))
    .bind(f.recherche.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .fetch_all(&state.db)
    .await?;
    let mut v = json!(lignes_en_json(&lignes));
    user.masquer(&state.db, module::RECEPTIONS, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/retours-fournisseur/disponible` — le stock qu'on peut rendre :
/// par reference et magasin, et par lot quand il y en a (la part sans lot a
/// part), avec le CMUP du magasin, prix propose (masque selon les droits du
/// stock).
pub async fn disponible(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT * FROM (
         WITH lots AS (
             SELECT code_reference, code_magasin, lot_fournisseur, quantite_kg
               FROM stock_lot WHERE quantite_kg > 0
         )
         SELECT sm.code_reference, ref.designation, sm.code_magasin, l.lot_fournisseur,
                COALESCE(l.quantite_kg, sm.quantite_kg - COALESCE(
                    (SELECT sum(x.quantite_kg) FROM lots x
                      WHERE x.code_reference = sm.code_reference AND x.code_magasin = sm.code_magasin), 0))::float8
                    AS quantite_kg,
                sm.cmup_mad::float8 AS cmup_mad
           FROM stock_magasin sm
           JOIN reference ref ON ref.code_reference = sm.code_reference
           LEFT JOIN LATERAL (
                SELECT lot_fournisseur, quantite_kg FROM lots x
                 WHERE x.code_reference = sm.code_reference AND x.code_magasin = sm.code_magasin
                UNION ALL SELECT NULL, NULL) l ON true
          WHERE sm.quantite_kg > 0
         ) x
          -- La part sans lot n'est gardee que si elle reste positive.
          WHERE x.quantite_kg > 0.0005
          ORDER BY x.code_reference, x.code_magasin, x.lot_fournisseur NULLS LAST",
    )
    .fetch_all(&state.db)
    .await?;
    let mut v = json!(lignes_en_json(&lignes));
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/retours-fournisseur/{id}` — le document et ses lignes.
pub async fn lire(State(state): State<AppState>, user: Utilisateur, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;
    let entete = sqlx::query(
        "SELECT r.id_retour, r.numero AS numero_retour, r.statut AS statut_retour, r.date_retour,
                r.code_fournisseur, fo.nom AS fournisseur_nom, r.motif, r.observations,
                uc.login AS saisi_par, r.id_utilisateur_creation, r.date_creation,
                uv.login AS valide_par, r.date_validation,
                (SELECT COALESCE(sum(round(l.quantite_kg * l.prix_kg_mad, 2)), 0)
                   FROM ligne_retour_fournisseur l WHERE l.id_retour = r.id_retour) AS montant_avoir_mad
           FROM retour_fournisseur r
           JOIN fournisseur fo ON fo.code_fournisseur = r.code_fournisseur
           JOIN utilisateur uc ON uc.id_utilisateur = r.id_utilisateur_creation
           LEFT JOIN utilisateur uv ON uv.id_utilisateur = r.id_utilisateur_validation
          WHERE r.id_retour = $1",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;
    if entete.is_empty() {
        return Err(AppError::Introuvable(format!("retour {id}")));
    }
    let lignes = sqlx::query(
        "SELECT l.ligne_numero, l.code_reference, ref.designation, l.code_magasin, l.lot_fournisseur,
                l.quantite_kg, l.prix_kg_mad, round(l.quantite_kg * l.prix_kg_mad, 2) AS montant_ligne_mad,
                l.nb_bobines, l.code_motif_ligne, ml.libelle AS motif_libelle,
                mv.numero_mouvement, l.cmup_avant, l.cmup_apres, l.ecart_mad
           FROM ligne_retour_fournisseur l
           JOIN reference ref ON ref.code_reference = l.code_reference
           JOIN motif_ligne ml ON ml.code_motif_ligne = l.code_motif_ligne
           LEFT JOIN mouvement mv ON mv.id_mouvement = l.id_mouvement
          WHERE l.id_retour = $1
          ORDER BY l.ligne_numero",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;
    let mut v = json!({
        "retour": lignes_en_json(&entete).get(0).cloned().unwrap_or(Value::Null),
        "lignes": lignes_en_json(&lignes),
    });
    user.masquer(&state.db, module::RECEPTIONS, &mut v).await?;
    Ok(Json(v))
}

/// LE PRIX DU RETOUR EST CELUI DES ACHATS (audit de securite du 13/10/2026).
///
/// Un compte qui ne voit pas le prix (le magasinier) l'imposait pourtant en
/// l'envoyant. Son prix est ignore : une ligne deja chiffree garde le sien,
/// une ligne neuve part au CMUP du magasin, comme prevu.
async fn retenir_prix(
    tx: &mut sqlx::PgConnection,
    state: &AppState,
    user: &Utilisateur,
    id: Option<&str>,
    s: &mut metier::RetourSaisie,
) -> AppResult<()> {
    let droits = user.droits(&state.db, module::RECEPTIONS).await?;
    if matches!(droits.get("prix_kg_mad"), Some(crate::auth::rbac::Niveau::Ecriture)) {
        return Ok(());
    }
    let anciens: Vec<(String, String, Option<String>, f64)> = match id {
        Some(id) => sqlx::query_as(
            "SELECT code_reference, code_magasin, lot_fournisseur, prix_kg_mad::float8
               FROM ligne_retour_fournisseur WHERE id_retour = $1",
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await?,
        None => Vec::new(),
    };
    for l in &mut s.lignes {
        l.prix_kg_mad = anciens
            .iter()
            .find(|(r, m, lot, _)| *r == l.code_reference && *m == l.code_magasin && *lot == l.lot_fournisseur)
            .map(|a| a.3);
    }
    Ok(())
}

/// `POST /api/retours-fournisseur` — un brouillon. Droit ECRIRE des receptions.
pub async fn creer(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(mut s): Json<metier::RetourSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;
    let id = crate::domain::idempotence::identifiant(s.id_document.as_deref())?;
    if let Some(v) = crate::domain::idempotence::deja_enregistre(
        &state.db, &crate::domain::idempotence::RETOUR, &id, &user.id,
    )
    .await?
    {
        return Ok(Json(v));
    }
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    retenir_prix(&mut tx, &state, &user, None, &mut s).await?;
    let v = metier::enregistrer(&mut tx, &user, None, &s).await?;
    tx.commit().await?;
    Ok(Json(v))
}

/// `PUT /api/retours-fournisseur/{id}` — le brouillon, en-tete et lignes.
pub async fn modifier(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(mut s): Json<metier::RetourSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    retenir_prix(&mut tx, &state, &user, Some(&id), &mut s).await?;
    let v = metier::enregistrer(&mut tx, &user, Some(&id), &s).await?;
    tx.commit().await?;
    Ok(Json(v))
}

/// `DELETE /api/retours-fournisseur/{id}` — un brouillon seulement (la base).
pub async fn supprimer(State(state): State<AppState>, user: Utilisateur, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let n = sqlx::query("DELETE FROM retour_fournisseur WHERE id_retour = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::Introuvable(format!("retour {id}")));
    }
    tx.commit().await?;
    Ok(Json(json!({ "supprime": id })))
}

/// `POST /api/retours-fournisseur/{id}/valider` — par un autre compte ; droit
/// VALIDER des receptions.
pub async fn valider(State(state): State<AppState>, user: Utilisateur, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Valider).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let v = metier::valider(&mut tx, &user, &id).await?;
    tx.commit().await?;
    let mut v = v;
    user.masquer(&state.db, module::RECEPTIONS, &mut v).await?;
    Ok(Json(v))
}
