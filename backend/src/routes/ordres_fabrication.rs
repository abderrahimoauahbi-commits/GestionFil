//! Les ordres de fabrication (OF Supply Chain, 22/10/2026 — lot A).
//!
//! docs/A-DECIDER-of-supply-chain.md. L'OF (date, qualité, métrage) PRÉVOIT le
//! besoin, ORIENTE les machines et ANALYSE la réalité : il ne déplace jamais le
//! stock. Ce module tient son cycle et lit sa consommation :
//!
//!   * cycle PRÉVU → LANCÉ → CLÔTURÉ ; ANNULÉ depuis PRÉVU ou LANCÉ. La base
//!     refuse toute autre transition et fige l'en-tête d'un OF clôturé ou annulé
//!     (`trg_ordre_fabrication_cycle`, migration 2026-10-22b) ;
//!   * droits : module PLANS — LIRE, ECRIRE (créer, modifier, lancer), VALIDER
//!     (clôturer, annuler) ;
//!   * la consommation RÉELLE (`v_of_consommation`) : écarts des décisions
//!     machine attribués à l'OF de la période, plus le hors machine (sorti −
//!     rendu) ; le PRÉVU (métrage × recette) n'en est que l'étalon.

use super::json::lignes_en_json;
use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::db::maintenant;
use crate::domain::concurrence::{exigee, exiger_version, version_actuelle};
use crate::domain::idempotence::{deja_enregistre, identifiant, Document};
use crate::domain::numerotation::numeroter;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

/// La relecture d'un OF déjà créé par le même envoi (idempotence, audit P3).
const ORDRE_FABRICATION: Document = Document {
    nom: "un ordre de fabrication",
    relecture: "SELECT o.id_of, o.numero, o.statut, o.version::bigint AS version,
                       o.id_utilisateur_creation AS auteur
                  FROM ordre_fabrication o WHERE o.id_of = $1",
};

const STATUTS: &[&str] = &["PREVU", "LANCE", "CLOTURE", "ANNULE"];

/// Un jour saisi : `AAAA-MM-JJ` (les dix premiers caractères suffisent).
fn jour(valeur: Option<&str>, quoi: &str) -> AppResult<Option<String>> {
    match valeur.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(s) => {
            let court = s.get(..10).unwrap_or(s);
            chrono::NaiveDate::parse_from_str(court, "%Y-%m-%d")
                .map(|d| Some(d.format("%Y-%m-%d").to_string()))
                .map_err(|_| AppError::Invalide(format!("{quoi} : « {s} » n'est pas une date (AAAA-MM-JJ).")))
        }
    }
}

fn texte(valeur: Option<&str>) -> Option<String> {
    valeur.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn metrage(m: f64) -> AppResult<f64> {
    if !m.is_finite() || m <= 0.0 {
        return Err(AppError::Invalide("Le métrage de l'OF doit être positif (m²).".into()));
    }
    Ok((m * 100.0).round() / 100.0)
}

/// Le numéro est unique : on le dit avant de buter sur l'index.
async fn numero_libre(tx: &mut sqlx::PgConnection, numero: &str, sauf: Option<&str>) -> AppResult<()> {
    let pris: Option<String> = sqlx::query_scalar(
        "SELECT id_of FROM ordre_fabrication WHERE numero = $1 AND ($2::text IS NULL OR id_of <> $2)",
    )
    .bind(numero)
    .bind(sauf)
    .fetch_optional(&mut *tx)
    .await?;
    if pris.is_some() {
        return Err(AppError::RegleMetier(format!(
            "Le numéro d'OF « {numero} » existe déjà : un numéro de l'ERP Production ne sert qu'une fois."
        )));
    }
    Ok(())
}

async fn qualite_existe(tx: &mut sqlx::PgConnection, code: &str) -> AppResult<()> {
    let existe: Option<String> = sqlx::query_scalar("SELECT code_qualite FROM qualite WHERE code_qualite = $1")
        .bind(code)
        .fetch_optional(&mut *tx)
        .await?;
    existe.map(|_| ()).ok_or_else(|| AppError::Invalide(format!("Qualité inconnue : « {code} ».")))
}

// ---------------------------------------------------------------------------
// Lister, lire
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct FiltresOf {
    pub statut: Option<String>,
    pub qualite: Option<String>,
    pub du: Option<String>,
    pub au: Option<String>,
}

/// `GET /api/ordres-fabrication?statut=&qualite=&du=&au=` — les OF avec leurs totaux.
pub async fn lister(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<FiltresOf>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLANS, Action::Lire).await?;
    let du = jour(f.du.as_deref(), "Début de période")?;
    let au = jour(f.au.as_deref(), "Fin de période")?;
    let rows = sqlx::query(
        "SELECT b.*, o.notes, o.version::bigint AS version, u.login AS cree_par
           FROM v_of_bilan b
           JOIN ordre_fabrication o ON o.id_of = b.id_of
           LEFT JOIN utilisateur u ON u.id_utilisateur = o.id_utilisateur_creation
          WHERE ($1::text IS NULL OR b.statut = $1)
            AND ($2::text IS NULL OR b.code_qualite = $2)
            AND ($3::date IS NULL OR b.date_of >= $3::date)
            AND ($4::date IS NULL OR b.date_of <= $4::date)
          ORDER BY b.date_of DESC, b.numero DESC
          LIMIT 1000",
    )
    .bind(texte(f.statut.as_deref()))
    .bind(texte(f.qualite.as_deref()))
    .bind(du)
    .bind(au)
    .fetch_all(&state.db)
    .await?;
    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::PLANS, &mut valeur).await?;
    Ok(Json(valeur))
}

/// `GET /api/ordres-fabrication/{id}` — l'en-tête et ses totaux.
pub async fn lire(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLANS, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT b.*, o.notes, o.version::bigint AS version, o.date_creation,
                u.login AS cree_par,
                EXISTS (SELECT 1 FROM v_recette_calculee rc
                         WHERE rc.code_qualite = o.code_qualite AND rc.kg_m2 IS NOT NULL) AS a_recette
           FROM v_of_bilan b
           JOIN ordre_fabrication o ON o.id_of = b.id_of
           LEFT JOIN utilisateur u ON u.id_utilisateur = o.id_utilisateur_creation
          WHERE b.id_of = $1",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;
    let mut valeur = lignes_en_json(&rows)
        .get(0)
        .cloned()
        .ok_or_else(|| AppError::Introuvable(format!("ordre de fabrication {id}")))?;
    user.masquer(&state.db, module::PLANS, &mut valeur).await?;
    Ok(Json(valeur))
}

/// `GET /api/ordres-fabrication/{id}/consommation` — par référence : prévu,
/// réel fil, réel hors machine, déchets / pertes / casses, écart.
pub async fn consommation(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLANS, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT * FROM v_of_consommation WHERE id_of = $1
          ORDER BY kg_prevu DESC, kg_reel DESC, code_reference",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;
    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::PLANS, &mut valeur).await?;
    Ok(Json(valeur))
}

#[derive(Debug, Deserialize)]
pub struct FiltresQualite {
    pub qualite: Option<String>,
    /// Mois `AAAA-MM`, bornes comprises.
    pub du: Option<String>,
    pub au: Option<String>,
}

fn mois(valeur: Option<&str>, quoi: &str) -> AppResult<Option<String>> {
    match valeur.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(s) => {
            let court = s.get(..7).unwrap_or(s);
            chrono::NaiveDate::parse_from_str(&format!("{court}-01"), "%Y-%m-%d")
                .map(|_| Some(court.to_string()))
                .map_err(|_| AppError::Invalide(format!("{quoi} : « {s} » n'est pas un mois (AAAA-MM).")))
        }
    }
}

/// `GET /api/ordres-fabrication/consommation-qualites?qualite=&du=AAAA-MM&au=AAAA-MM`
/// — par qualité et par mois de l'OF : prévu, réel, écart (OF annulés exclus).
pub async fn consommation_qualites(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<FiltresQualite>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLANS, Action::Lire).await?;
    let du = mois(f.du.as_deref(), "Premier mois")?;
    let au = mois(f.au.as_deref(), "Dernier mois")?;
    let rows = sqlx::query(
        "SELECT * FROM v_qualite_consommation
          WHERE ($1::text IS NULL OR code_qualite = $1)
            AND ($2::text IS NULL OR mois >= $2)
            AND ($3::text IS NULL OR mois <= $3)
          ORDER BY mois DESC, code_qualite",
    )
    .bind(texte(f.qualite.as_deref()))
    .bind(du)
    .bind(au)
    .fetch_all(&state.db)
    .await?;
    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::PLANS, &mut valeur).await?;
    Ok(Json(valeur))
}

// ---------------------------------------------------------------------------
// Créer, modifier
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct NouvelOf {
    /// L'identifiant tiré par l'écran (idempotence) ; absent : le serveur en tire un.
    #[serde(default)]
    pub id_document: Option<String>,
    /// Le numéro de l'ERP Production ; vide : OF-AAAA-NNNN.
    #[serde(default)]
    pub numero: Option<String>,
    #[serde(default)]
    pub date_of: Option<String>,
    #[serde(default)]
    pub date_fin_prevue: Option<String>,
    pub code_qualite: String,
    pub metrage_m2: f64,
    #[serde(default)]
    pub notes: Option<String>,
}

/// `POST /api/ordres-fabrication` — un OF naît PRÉVU.
pub async fn creer(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(n): Json<NouvelOf>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLANS, Action::Ecrire).await?;
    let id = identifiant(n.id_document.as_deref())?;
    if let Some(v) = deja_enregistre(&state.db, &ORDRE_FABRICATION, &id, &user.id).await? {
        return Ok(Json(v));
    }
    let code_qualite = texte(Some(&n.code_qualite))
        .ok_or_else(|| AppError::Invalide("La qualité de l'OF est obligatoire.".into()))?;
    let m2 = metrage(n.metrage_m2)?;
    let date_of = jour(n.date_of.as_deref(), "Date de l'OF")?
        .unwrap_or_else(|| crate::db::jour_casablanca().format("%Y-%m-%d").to_string());
    let fin = jour(n.date_fin_prevue.as_deref(), "Fin prévue")?;
    if fin.as_deref().is_some_and(|f| f < date_of.as_str()) {
        return Err(AppError::Invalide("La fin prévue précède la date de l'OF.".into()));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    qualite_existe(&mut tx, &code_qualite).await?;
    let numero = match texte(n.numero.as_deref()) {
        Some(num) => {
            numero_libre(&mut tx, &num, None).await?;
            num
        }
        None => numeroter(&mut tx, "ordre_fabrication", "numero", "OF").await?,
    };
    sqlx::query(
        "INSERT INTO ordre_fabrication
             (id_of, numero, date_of, date_fin_prevue, code_qualite, metrage_m2, notes, id_utilisateur_creation)
         VALUES ($1, $2, $3::date, $4::date, $5, $6::numeric, $7, $8)",
    )
    .bind(&id)
    .bind(&numero)
    .bind(&date_of)
    .bind(&fin)
    .bind(&code_qualite)
    .bind(m2)
    .bind(texte(n.notes.as_deref()))
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_of": id, "numero": numero, "statut": "PREVU", "version": 1 })))
}

#[derive(Debug, Deserialize)]
pub struct ModifOf {
    pub version: Option<i64>,
    #[serde(default)]
    pub numero: Option<String>,
    #[serde(default)]
    pub date_of: Option<String>,
    /// `""` efface la fin prévue ; absent la laisse.
    #[serde(default)]
    pub date_fin_prevue: Option<String>,
    #[serde(default)]
    pub code_qualite: Option<String>,
    #[serde(default)]
    pub metrage_m2: Option<f64>,
    /// `""` efface les notes ; absent les laisse.
    #[serde(default)]
    pub notes: Option<String>,
}

/// `PATCH /api/ordres-fabrication/{id}` — l'en-tête, tant que l'OF est PRÉVU ou LANCÉ.
pub async fn modifier(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(m): Json<ModifOf>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLANS, Action::Ecrire).await?;
    let version = exigee(m.version)?;
    let date_of = jour(m.date_of.as_deref(), "Date de l'OF")?;
    let fin_saisie = m.date_fin_prevue.is_some();
    let fin = jour(m.date_fin_prevue.as_deref(), "Fin prévue")?;
    let m2 = m.metrage_m2.map(metrage).transpose()?;
    let numero = texte(m.numero.as_deref());
    let qualite = texte(m.code_qualite.as_deref());

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    exiger_version(&mut tx, "ordre_fabrication", "id_of", &id, Some(version), "Cet ordre de fabrication").await?;
    let statut: String = sqlx::query_scalar("SELECT statut FROM ordre_fabrication WHERE id_of = $1")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    if !matches!(statut.as_str(), "PREVU" | "LANCE") {
        return Err(AppError::RegleMetier(format!(
            "Cet ordre de fabrication est {} : son en-tête ne se modifie plus.",
            if statut == "CLOTURE" { "clôturé" } else { "annulé" }
        )));
    }
    if let Some(num) = &numero {
        numero_libre(&mut tx, num, Some(&id)).await?;
    }
    if let Some(q) = &qualite {
        qualite_existe(&mut tx, q).await?;
    }
    sqlx::query(
        "UPDATE ordre_fabrication SET
             numero          = COALESCE($2, numero),
             date_of         = COALESCE($3::date, date_of),
             date_fin_prevue = CASE WHEN $4 THEN $5::date ELSE date_fin_prevue END,
             code_qualite    = COALESCE($6, code_qualite),
             metrage_m2      = COALESCE($7::numeric, metrage_m2),
             notes           = CASE WHEN $8 THEN $9 ELSE notes END
          WHERE id_of = $1",
    )
    .bind(&id)
    .bind(&numero)
    .bind(&date_of)
    .bind(fin_saisie)
    .bind(&fin)
    .bind(&qualite)
    .bind(m2)
    .bind(m.notes.is_some())
    .bind(texte(m.notes.as_deref()))
    .execute(&mut *tx)
    .await?;
    let version = version_actuelle(&mut tx, "ordre_fabrication", "id_of", &id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_of": id, "version": version })))
}

// ---------------------------------------------------------------------------
// Le cycle
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ChangementStatut {
    pub statut: String,
    pub version: Option<i64>,
}

/// `PUT /api/ordres-fabrication/{id}/statut` — lancer (ECRIRE), clôturer ou
/// annuler (VALIDER). La base garde les transitions.
pub async fn changer_statut(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(t): Json<ChangementStatut>,
) -> AppResult<Json<Value>> {
    let cible = t.statut.trim().to_uppercase();
    if !STATUTS.contains(&cible.as_str()) {
        return Err(AppError::Invalide(format!("Statut inconnu : « {} ».", t.statut)));
    }
    // Clôturer ou annuler arrête la consommation et le besoin de l'OF : un acte de validation.
    let action = if cible == "LANCE" { Action::Ecrire } else { Action::Valider };
    user.exiger(&state.db, module::PLANS, action).await?;
    let version = exigee(t.version)?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    exiger_version(&mut tx, "ordre_fabrication", "id_of", &id, Some(version), "Cet ordre de fabrication").await?;
    // Le déclencheur refuse une transition absente de `transition_statut` (OF-CYCLE).
    sqlx::query(
        "UPDATE ordre_fabrication SET
             statut = $2,
             date_cloture = CASE WHEN $2 = 'CLOTURE' THEN COALESCE(date_cloture, fn_instant($3)) ELSE date_cloture END
          WHERE id_of = $1",
    )
    .bind(&id)
    .bind(&cible)
    .bind(maintenant())
    .execute(&mut *tx)
    .await?;
    let version = version_actuelle(&mut tx, "ordre_fabrication", "id_of", &id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_of": id, "statut": cible, "version": version })))
}

/// `GET /api/ordres-fabrication/qualites` — les qualités qu'un OF peut viser
/// (non clôturées), avec l'indication d'une recette pour le prévu.
pub async fn qualites(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLANS, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT q.code_qualite, q.nom AS qualite_nom, q.statut,
                EXISTS (SELECT 1 FROM v_recette_calculee rc
                         WHERE rc.code_qualite = q.code_qualite AND rc.kg_m2 IS NOT NULL) AS a_recette
           FROM qualite q
          WHERE q.statut <> 'CLOTURE'
          ORDER BY q.code_qualite",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&rows)))
}
