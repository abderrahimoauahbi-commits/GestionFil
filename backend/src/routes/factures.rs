//! LES ROUTES DE LA FACTURE FOURNISSEUR (ADR-003 phase B).
//!
//! Un document : on l'ouvre en brouillon, on le relit, on le valide — et la
//! validation EST la cloture des receptions qu'il couvre. Le moteur de
//! valorisation est celui de toujours (`domain/facture_locale`), appele par
//! `domain/facture_fournisseur`.
//!
//! L'EN-TETE ET LES LIGNES PARTENT ENSEMBLE, dans une seule transaction, comme
//! les autres documents de l'ERP : une facture ouverte sans ligne, avec un
//! numero deja pris, serait un document fantome au milieu de la numerotation.
//!
//! LE TAUX EST CONTROLE comme a l'import : jamais 1 en devise, et un ecart de
//! plus de 3 % avec le cours Bank Al-Maghrib se confirme (`TAUX-ECART`), il ne
//! se glisse pas.
//!
//! Droits : `RECEPTIONS` — ECRIRE pour saisir, VALIDER pour valider. Les
//! montants restent masques a qui ne voit pas la valeur du stock (grille des
//! champs), a la lecture comme a la sortie.

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::auth::rbac::{module, Action};
use crate::auth::Utilisateur;
use crate::error::{AppError, AppResult};
use crate::routes::json::lignes_en_json;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct LigneSaisie {
    pub id_ligne_reception: String,
    pub quantite_facturee_kg: f64,
    pub prix_kg_devise: f64,
    #[serde(default)]
    pub remise_pct: Option<f64>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FactureSaisie {
    pub numero_facture: String,
    pub code_fournisseur: String,
    #[serde(default)]
    pub date_facture: Option<String>,
    #[serde(default)]
    pub code_devise: Option<String>,
    #[serde(default)]
    pub taux_change: Option<f64>,
    #[serde(default)]
    pub montant_devise: Option<f64>,
    #[serde(default)]
    pub frais_devise: Option<f64>,
    /// Regle 3 (09/10) : la facture porte-t-elle les kilos rendus (brute) ou
    /// non (nette) ? Laisse vide quand aucun retour n'est en jeu.
    #[serde(default)]
    pub facture_nette: Option<bool>,
    #[serde(default)]
    pub id_dossier_import: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    /// Un ecart de plus de 3 % au cours de reference se confirme.
    #[serde(default)]
    pub confirmer_taux: bool,
    #[serde(default)]
    pub lignes: Vec<LigneSaisie>,
}

/// La devise d'une facture : celle qu'on dit, sinon celle du fournisseur.
async fn devise_de(
    c: &mut sqlx::PgConnection,
    saisie: &FactureSaisie,
) -> AppResult<String> {
    if let Some(d) = saisie.code_devise.as_deref().filter(|d| !d.trim().is_empty()) {
        return Ok(d.to_string());
    }
    Ok(sqlx::query_scalar(
        "SELECT COALESCE(code_devise, 'MAD') FROM fournisseur WHERE code_fournisseur = $1",
    )
    .bind(&saisie.code_fournisseur)
    .fetch_optional(&mut *c)
    .await?
    .unwrap_or_else(|| "MAD".to_string()))
}

/// `GET /api/factures-fournisseur` — la liste.
pub async fn lister(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT f.*, fo.nom AS fournisseur_nom,
                uc.login AS saisie_par, uv.login AS valide_par,
                d.numero AS dossier_numero,
                (SELECT count(*) FROM ligne_facture_fournisseur l
                  WHERE l.id_facture = f.id_facture) AS nb_lignes,
                (SELECT count(DISTINCT lr.id_reception)
                   FROM ligne_facture_fournisseur l
                   JOIN ligne_reception lr ON lr.id_ligne_reception = l.id_ligne_reception
                  WHERE l.id_facture = f.id_facture) AS nb_receptions,
                -- Les arrivages couverts, pour les reconnaitre sans ouvrir.
                (SELECT string_agg(DISTINCT r.numero_reception, ', ')
                   FROM ligne_facture_fournisseur l
                   JOIN ligne_reception lr ON lr.id_ligne_reception = l.id_ligne_reception
                   JOIN reception r ON r.id_reception = lr.id_reception
                  WHERE l.id_facture = f.id_facture) AS receptions,
                (SELECT COALESCE(sum(l.montant_devise), 0) FROM ligne_facture_fournisseur l
                  WHERE l.id_facture = f.id_facture)::float8 AS montant_lignes_devise
           FROM facture_fournisseur f
           JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
           LEFT JOIN utilisateur uc ON uc.id_utilisateur = f.id_utilisateur_creation
           LEFT JOIN utilisateur uv ON uv.id_utilisateur = f.id_utilisateur_validation
           LEFT JOIN import_dossiers d ON d.id_dossier = f.id_dossier_import
          WHERE ($1::text IS NULL OR f.statut = $1)
            AND ($2::text IS NULL OR f.code_fournisseur = $2)
          ORDER BY f.date_facture DESC, f.numero_facture DESC
          LIMIT 300",
    )
    .bind(f.get("statut").filter(|s| !s.is_empty()))
    .bind(f.get("fournisseur").filter(|s| !s.is_empty()))
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&rows);
    user.masquer(&state.db, module::RECEPTIONS, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/factures-fournisseur/{id}` — l'en-tete, ses lignes, le 3-way.
pub async fn lire(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;
    let entete = sqlx::query(
        "SELECT f.*, fo.nom AS fournisseur_nom, d.numero AS dossier_numero,
                uc.login AS saisie_par, uv.login AS valide_par
           FROM facture_fournisseur f
           JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
           LEFT JOIN utilisateur uc ON uc.id_utilisateur = f.id_utilisateur_creation
           LEFT JOIN utilisateur uv ON uv.id_utilisateur = f.id_utilisateur_validation
           LEFT JOIN import_dossiers d ON d.id_dossier = f.id_dossier_import
          WHERE f.id_facture = $1",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("facture {id}")))?;

    // LE RAPPROCHEMENT 3-WAY : facture / pesee / engage, et les deux ecarts.
    let lignes = sqlx::query(
        "SELECT * FROM v_facture_rapprochement WHERE id_facture = $1 ORDER BY ligne_numero",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let mut v = json!({
        "entete": lignes_en_json(std::slice::from_ref(&entete)).get(0).cloned().unwrap_or(Value::Null),
        "lignes": lignes_en_json(&lignes),
    });
    user.masquer(&state.db, module::RECEPTIONS, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/factures-fournisseur/a-facturer` — les pesees d'un fournisseur
/// qu'aucune facture vivante ne couvre encore.
///
/// C'est l'equivalent, pour la facture, de ce que « lignes attendues » est pour
/// la reception : on ne saisit pas une facture en cherchant des references dans
/// un catalogue, on la saisit en face de ce qui est entre.
pub async fn a_facturer(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(q): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT lr.id_ligne_reception, lr.code_reference, lr.designation,
                lr.quantite_stock_kg::float8, lr.prix_kg_devise::float8, lr.code_devise,
                lr.lot_fournisseur, lr.code_magasin_dest,
                r.id_reception, r.numero_reception, r.date_reception, r.num_bon_livraison,
                r.code_fournisseur, bc.numero_bc, lb.id_ligne_bc,
                d.numero AS dossier_numero,
                round(lr.quantite_stock_kg * lr.prix_kg_mad, 2)::float8 AS provisoire_mad
           FROM ligne_reception lr
           JOIN reception r ON r.id_reception = lr.id_reception
           LEFT JOIN ligne_bc lb ON lb.id_ligne_bc = lr.id_ligne_bc
           LEFT JOIN bon_commande bc ON bc.id_bc = lb.id_bc
           LEFT JOIN import_dossiers d ON d.id_dossier = r.id_dossier_import
          WHERE r.statut = 'VALIDE'
            AND ($1::text IS NULL OR r.code_fournisseur = $1)
            AND ($2::text IS NULL OR lr.code_devise = $2)
            -- `sauf` : LA FACTURE QU'ON EST EN TRAIN DE SAISIR. Sans elle, le
            -- brouillon qu'on reouvre ne retrouvait pas ses propres lignes dans
            -- la liste a cocher — elles paraissaient avoir disparu.
            AND NOT EXISTS (SELECT 1 FROM ligne_facture_fournisseur l
                              JOIN facture_fournisseur f ON f.id_facture = l.id_facture
                             WHERE l.id_ligne_reception = lr.id_ligne_reception
                               AND f.statut <> 'ANNULEE'
                               AND ($3::text IS NULL OR f.id_facture <> $3))
          ORDER BY r.date_reception DESC, r.numero_reception, lr.ligne_numero
          LIMIT 500",
    )
    .bind(q.get("fournisseur").filter(|s| !s.is_empty()))
    .bind(q.get("devise").filter(|s| !s.is_empty()))
    .bind(q.get("sauf").filter(|s| !s.is_empty()))
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&rows);
    user.masquer(&state.db, module::RECEPTIONS, &mut v).await?;
    Ok(Json(v))
}

/// `POST /api/factures-fournisseur` — l'en-tete et ses lignes, d'un bloc.
pub async fn creer(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(f): Json<FactureSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;
    if f.numero_facture.trim().is_empty() {
        return Err(AppError::Invalide("Le numero de la facture est obligatoire.".into()));
    }
    if f.lignes.is_empty() {
        return Err(AppError::Invalide(
            "Une facture porte au moins une ligne : ce qu'elle facture.".into(),
        ));
    }
    let date = crate::routes::date_du_fait(f.date_facture.as_deref(), "date de facture")?
        .unwrap_or_else(crate::db::aujourdhui);

    let (devise, taux) = {
        let mut c = state.db.acquire().await?;
        let devise = devise_de(&mut c, &f).await?;
        let saisi = match f.taux_change {
            Some(t) => Some(t),
            None if devise == "MAD" => None,
            None => crate::routes::importation::taux_reference(&mut c, &devise, &date)
                .await?
                .map(|r| r.valeur),
        };
        let objet = format!("La facture {}", f.numero_facture.trim());
        let taux = crate::routes::importation::controler_taux(
            &mut c, &objet, &devise, saisi, &date, f.confirmer_taux,
        )
        .await?;
        (devise, taux)
    };

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let id: String = sqlx::query_scalar(
        "INSERT INTO facture_fournisseur
             (numero_facture, code_fournisseur, date_facture, code_devise, taux_change,
              montant_devise, frais_devise, facture_nette, id_dossier_import, notes,
              id_utilisateur_creation)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 0), $8, NULLIF($9, ''), $10, $11)
         RETURNING id_facture",
    )
    .bind(f.numero_facture.trim())
    .bind(&f.code_fournisseur)
    .bind(&date)
    .bind(&devise)
    .bind(taux)
    .bind(f.montant_devise)
    .bind(f.frais_devise)
    .bind(f.facture_nette.map(i16::from))
    .bind(f.id_dossier_import.as_deref().unwrap_or(""))
    .bind(&f.notes)
    .bind(&user.id)
    .fetch_one(&mut *tx)
    .await?;

    poser_lignes(&mut tx, &id, &f.lignes).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_facture": id, "lignes": f.lignes.len() })))
}

/// Les lignes d'une facture : on remplace, on ne fusionne pas. L'ecran envoie
/// l'etat complet du brouillon, comme les autres documents.
async fn poser_lignes(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id_facture: &str,
    lignes: &[LigneSaisie],
) -> AppResult<()> {
    sqlx::query("DELETE FROM ligne_facture_fournisseur WHERE id_facture = $1")
        .bind(id_facture)
        .execute(&mut **tx)
        .await?;
    for (i, l) in lignes.iter().enumerate() {
        if !(l.quantite_facturee_kg > 0.0) || !(l.prix_kg_devise > 0.0) {
            return Err(AppError::Invalide(
                "Chaque ligne porte une quantite et un prix strictement positifs.".into(),
            ));
        }
        sqlx::query(
            "INSERT INTO ligne_facture_fournisseur
                 (id_facture, ligne_numero, id_ligne_reception, quantite_facturee_kg,
                  prix_kg_devise, remise_pct, notes)
             VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), $7)",
        )
        .bind(id_facture)
        .bind((i + 1) as i64)
        .bind(&l.id_ligne_reception)
        .bind(l.quantite_facturee_kg)
        .bind(l.prix_kg_devise)
        .bind(l.remise_pct)
        .bind(&l.notes)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// `PATCH /api/factures-fournisseur/{id}` — tant qu'elle est en brouillon.
pub async fn modifier(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(f): Json<FactureSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;
    let date = crate::routes::date_du_fait(f.date_facture.as_deref(), "date de facture")?
        .unwrap_or_else(crate::db::aujourdhui);

    let (devise, taux) = {
        let mut c = state.db.acquire().await?;
        let devise = devise_de(&mut c, &f).await?;
        let objet = format!("La facture {}", f.numero_facture.trim());
        let taux = crate::routes::importation::controler_taux(
            &mut c, &objet, &devise, f.taux_change, &date, f.confirmer_taux,
        )
        .await?;
        (devise, taux)
    };

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: String =
        sqlx::query_scalar("SELECT statut FROM facture_fournisseur WHERE id_facture = $1 FOR UPDATE")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("facture {id}")))?;
    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(format!(
            "Cette facture est {statut} : seule une facture en brouillon se modifie. \
             Une facture validee se corrige par un avoir ou une facture complementaire."
        )));
    }

    sqlx::query(
        "UPDATE facture_fournisseur
            SET numero_facture = $2, date_facture = $3, code_devise = $4, taux_change = $5,
                montant_devise = $6, frais_devise = COALESCE($7, 0), facture_nette = $8,
                id_dossier_import = NULLIF($9, ''), notes = $10
          WHERE id_facture = $1",
    )
    .bind(&id)
    .bind(f.numero_facture.trim())
    .bind(&date)
    .bind(&devise)
    .bind(taux)
    .bind(f.montant_devise)
    .bind(f.frais_devise)
    .bind(f.facture_nette.map(i16::from))
    .bind(f.id_dossier_import.as_deref().unwrap_or(""))
    .bind(&f.notes)
    .execute(&mut *tx)
    .await?;

    poser_lignes(&mut tx, &id, &f.lignes).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_facture": id, "lignes": f.lignes.len() })))
}

/// `DELETE /api/factures-fournisseur/{id}` — un brouillon seulement.
///
/// Validee, elle a bouge un CUMP : elle ne se supprime pas. C'est la doctrine
/// de l'ERP — on contre-passe, on devalide, on met de cote ; l'historique
/// comptable ne disparait pas.
pub async fn supprimer(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let statut: String =
        sqlx::query_scalar("SELECT statut FROM facture_fournisseur WHERE id_facture = $1 FOR UPDATE")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("facture {id}")))?;
    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(format!(
            "Cette facture est {statut} : elle a bouge un CUMP et ne se supprime plus."
        )));
    }
    sqlx::query("DELETE FROM facture_fournisseur WHERE id_facture = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({ "supprime": true })))
}

#[derive(Debug, Deserialize)]
pub struct Validation {
    #[serde(default)]
    pub simuler: bool,
}

/// `POST /api/factures-fournisseur/{id}/valider` — valider, c'est cloturer.
pub async fn valider(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    corps: Option<Json<Validation>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Valider).await?;
    let simuler = corps.map(|Json(v)| v.simuler).unwrap_or(false);
    let mut v = crate::domain::facture_fournisseur::valider(&state.db, &user, &id, simuler).await?;
    user.masquer(&state.db, module::RECEPTIONS, &mut v).await?;
    Ok(Json(v))
}
