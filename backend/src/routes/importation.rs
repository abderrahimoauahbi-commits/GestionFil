//! Dossiers d'importation — l'API.
//!
//! Module de droits `IMPORT` pour le dossier, ses factures et ses frais ; la
//! reception physique passe par `RECEPTIONS`, comme toute reception : creer
//! demande ECRIRE, faire entrer en stock demande VALIDER. La cloture — qui
//! change le CUMP — demande `IMPORT` VALIDER.
//!
//! Chaque modification d'une ligne ou d'un frais recalcule la repartition dans
//! la meme transaction : elle n'est jamais saisie, elle se deduit.

use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::domain::importation as metier;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

use super::json::lignes_en_json;
use super::stock::numeroter;

const IMPORT: &str = "IMPORT";

/// Le dossier d'une facture, pour recalculer apres une modification.
async fn dossier_de_facture(tx: &mut sqlx::PgConnection, id_facture: &str) -> AppResult<String> {
    sqlx::query_scalar("SELECT id_dossier FROM import_factures WHERE id_facture = $1")
        .bind(id_facture)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("facture {id_facture}")))
}

async fn dossier_de_ligne(tx: &mut sqlx::PgConnection, id_ligne: &str) -> AppResult<String> {
    sqlx::query_scalar(
        "SELECT f.id_dossier FROM import_facture_lignes l
           JOIN import_factures f ON f.id_facture = l.id_facture
          WHERE l.id_ligne = $1",
    )
    .bind(id_ligne)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("ligne {id_ligne}")))
}

// ============================================================================
// Catalogue des frais
// ============================================================================

/// `GET /api/parametres-frais` — le catalogue tel que l'ecran de saisie en a
/// besoin. Son administration passe par le referentiel `/api/types-frais`
/// (module PARAMETRES) : ici, on lit, avec le module IMPORT.
pub async fn lister_parametres_frais(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT id_frais, libelle, categorie, piece_justificative, recuperable, commun,
                methode_repartition, inclus_dans_cout, ordre, actif
           FROM parametres_frais WHERE actif = 1 ORDER BY ordre, libelle",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&lignes)))
}

// ============================================================================
// Dossiers
// ============================================================================

/// `GET /api/import/dossiers` — la liste, avec ce qu'on veut lire d'un coup
/// d'oeil : fournisseurs, valeur, frais, avancement de la reception.
pub async fn lister_dossiers(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(q): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT d.id_dossier, d.numero, d.numero_bl, d.conteneurs, d.code_devise, d.taux_change,
                d.date_arrivee, d.statut, d.date_creation, d.date_cloture,
                (SELECT count(*) FROM import_factures f WHERE f.id_dossier = d.id_dossier) AS nb_factures,
                (SELECT string_agg(DISTINCT fo.nom, ', ')
                   FROM import_factures f JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
                  WHERE f.id_dossier = d.id_dossier) AS fournisseurs,
                v.valeur_dhs, v.poids_kg, v.recu_kg, v.nb_palettes, v.nb_bobines,
                fr.frais_dhs, fr.tva_dhs,
                CASE WHEN v.valeur_dhs > 0 THEN round(fr.frais_dhs * 100 / v.valeur_dhs, 2) END AS coef_frais_pct
           FROM import_dossiers d
           LEFT JOIN LATERAL (
                SELECT COALESCE(sum(round(l.montant_devise * f.taux_change, 2)), 0) AS valeur_dhs,
                       COALESCE(sum(l.poids_net_kg) FILTER (WHERE l.type_ligne = 'ERP'), 0) AS poids_kg,
                       COALESCE(sum(l.quantite_recue_kg), 0) AS recu_kg,
                       COALESCE(sum(l.nb_palettes), 0) AS nb_palettes,
                       COALESCE(sum(l.nb_bobines), 0) AS nb_bobines
                  FROM import_facture_lignes l JOIN import_factures f ON f.id_facture = l.id_facture
                 WHERE f.id_dossier = d.id_dossier) v ON true
           LEFT JOIN LATERAL (
                SELECT COALESCE(sum(x.montant_dhs) FILTER (WHERE p.inclus_dans_cout = 1), 0) AS frais_dhs,
                       COALESCE(sum(x.montant_dhs) FILTER (WHERE p.inclus_dans_cout = 0), 0) AS tva_dhs
                  FROM dossier_lignes_frais x JOIN parametres_frais p ON p.id_frais = x.id_frais
                 WHERE x.id_dossier = d.id_dossier) fr ON true
          WHERE ($1::text IS NULL OR d.statut = $1)
          ORDER BY d.date_creation DESC",
    )
    .bind(q.get("statut"))
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, IMPORT, &mut v).await?;
    Ok(Json(v))
}

#[derive(Deserialize)]
pub struct DossierSaisie {
    numero: Option<String>,
    numero_bl: Option<String>,
    conteneurs: Option<String>,
    code_devise: Option<String>,
    taux_change: Option<f64>,
    date_arrivee: Option<String>,
    notes: Option<String>,
}

/// Le numero suivant, au format du classeur : « 06/26 ».
async fn prochain_numero(tx: &mut sqlx::PgConnection) -> AppResult<String> {
    let annee = chrono::Utc::now().format("%y").to_string();
    let rang: i64 = sqlx::query_scalar(
        "SELECT COALESCE(max(split_part(numero, '/', 1)::bigint), 0) + 1
           FROM import_dossiers WHERE numero ~ ('^[0-9]+/' || $1 || '$')",
    )
    .bind(&annee)
    .fetch_one(&mut *tx)
    .await?;
    Ok(format!("{rang:02}/{annee}"))
}

/// `POST /api/import/dossiers`
pub async fn creer_dossier(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(d): Json<DossierSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let code_devise = d.code_devise.unwrap_or_else(|| "USD".into());
    let taux = d.taux_change.filter(|t| *t > 0.0)
        .ok_or_else(|| AppError::Invalide("Taux de change du dossier obligatoire.".into()))?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let numero = match d.numero.filter(|s| !s.trim().is_empty()) {
        Some(n) => n.trim().to_string(),
        None => prochain_numero(&mut tx).await?,
    };
    let id: String = sqlx::query_scalar(
        "INSERT INTO import_dossiers (numero, numero_bl, conteneurs, code_devise, taux_change,
                                      date_arrivee, notes, id_utilisateur_creation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id_dossier",
    )
    .bind(&numero)
    .bind(&d.numero_bl)
    .bind(&d.conteneurs)
    .bind(&code_devise)
    .bind(taux)
    .bind(&d.date_arrivee)
    .bind(&d.notes)
    .bind(&user.id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_dossier": id, "numero": numero })))
}

/// `GET /api/import/dossiers/{id}` — tout le dossier : en-tete, factures,
/// lignes avec leur cout de revient, frais, repartition. Les receptions n'en
/// font pas partie : elles ont leur propre liste.
pub async fn lire_dossier(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Lire).await?;
    let db = &state.db;

    let entete = sqlx::query(
        "SELECT d.*, u.login AS cree_par, uc.login AS cloture_par
           FROM import_dossiers d
           LEFT JOIN utilisateur u  ON u.id_utilisateur  = d.id_utilisateur_creation
           LEFT JOIN utilisateur uc ON uc.id_utilisateur = d.id_utilisateur_cloture
          WHERE d.id_dossier = $1",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;
    if entete.is_empty() {
        return Err(AppError::Introuvable(format!("dossier {id}")));
    }

    let factures = sqlx::query(
        "SELECT f.*, fo.nom AS fournisseur_nom,
                (SELECT COALESCE(sum(l.montant_devise), 0) FROM import_facture_lignes l
                  WHERE l.id_facture = f.id_facture) AS montant_lignes_devise,
                (SELECT count(*) FROM import_facture_lignes l WHERE l.id_facture = f.id_facture) AS nb_lignes
           FROM import_factures f
           JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
          WHERE f.id_dossier = $1
          ORDER BY f.date_creation",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;

    let lignes = sqlx::query(
        "SELECT * FROM v_import_cout_revient WHERE id_dossier = $1
          ORDER BY numero_facture, ligne_numero",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;

    let frais = sqlx::query(
        "SELECT x.id_ligne_frais, x.id_frais, p.libelle AS frais_libelle, p.categorie,
                p.inclus_dans_cout, x.libelle, x.numero_piece, x.montant_devise, x.code_devise,
                x.cours_change, x.montant_dhs, x.date_creation,
                -- En jsonb : le convertisseur de lignes lit le json, pas les
                -- tableaux PostgreSQL, qui ressortiraient a null.
                COALESCE((SELECT jsonb_agg(c.id_ligne) FROM dossier_lignes_frais_cibles c
                           WHERE c.id_ligne_frais = x.id_ligne_frais), '[]'::jsonb) AS cibles
           FROM dossier_lignes_frais x
           JOIN parametres_frais p ON p.id_frais = x.id_frais
          WHERE x.id_dossier = $1
          ORDER BY p.ordre, x.date_creation",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;

    let repartition = sqlx::query(
        "SELECT r.id_ligne_frais, r.id_article_dossier, r.pourcentage, r.montant_alloue_dhs
           FROM lignes_frais_repartition r
           JOIN dossier_lignes_frais x ON x.id_ligne_frais = r.id_ligne_frais
          WHERE x.id_dossier = $1",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;

    let ajustements = sqlx::query(
        "SELECT code_reference, nature, code_magasin, quantite_recue_kg, stock_kg,
                cump_avant, cump_apres, montant_dhs, date_ajustement
           FROM import_ajustements_cump WHERE id_dossier = $1
          ORDER BY code_reference, nature DESC, code_magasin",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;

    let pieces = super::pieces::lister_du_dossier(db, &id).await?;

    let mut v = json!({
        "dossier": lignes_en_json(&entete).get(0).cloned().unwrap_or(Value::Null),
        "pieces": pieces,
        "factures": lignes_en_json(&factures),
        "lignes": lignes_en_json(&lignes),
        "frais": lignes_en_json(&frais),
        "repartition": lignes_en_json(&repartition),
        "ajustements": lignes_en_json(&ajustements),
    });
    user.masquer(db, IMPORT, &mut v).await?;
    Ok(Json(v))
}

/// `PATCH /api/import/dossiers/{id}` — l'en-tete. Le statut ne se touche pas
/// ici : il avance par les receptions et la cloture.
pub async fn modifier_dossier(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(d): Json<DossierSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let n = sqlx::query(
        "UPDATE import_dossiers
            SET numero = COALESCE($2, numero), numero_bl = COALESCE($3, numero_bl),
                conteneurs = COALESCE($4, conteneurs), code_devise = COALESCE($5, code_devise),
                taux_change = COALESCE($6, taux_change), date_arrivee = COALESCE($7, date_arrivee),
                notes = COALESCE($8, notes)
          WHERE id_dossier = $1",
    )
    .bind(&id)
    .bind(&d.numero)
    .bind(&d.numero_bl)
    .bind(&d.conteneurs)
    .bind(&d.code_devise)
    .bind(d.taux_change)
    .bind(&d.date_arrivee)
    .bind(&d.notes)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(AppError::Introuvable(format!("dossier {id}")));
    }
    tx.commit().await?;
    Ok(Json(json!({ "id_dossier": id })))
}

/// `DELETE /api/import/dossiers/{id}` — un brouillon seulement (declencheur).
pub async fn supprimer_dossier(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    // Un dossier en brouillon n'a rien fait entrer en stock : ses lignes ne
    // peuvent etre que dans des receptions en brouillon. Elles en sortent, et
    // une reception qui n'avait qu'elles disparait avec.
    let touchees: Vec<String> = sqlx::query_scalar(
        "DELETE FROM import_reception_lignes rl
          USING import_facture_lignes l, import_factures f, import_receptions r
          WHERE rl.id_ligne = l.id_ligne AND l.id_facture = f.id_facture AND f.id_dossier = $1
            AND r.id_reception = rl.id_reception AND r.statut = 'BROUILLON'
      RETURNING rl.id_reception",
    )
    .bind(&id)
    .fetch_all(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM import_receptions r
          WHERE r.id_reception = ANY($1) AND r.statut = 'BROUILLON'
            AND NOT EXISTS (SELECT 1 FROM import_reception_lignes x WHERE x.id_reception = r.id_reception)",
    )
    .bind(&touchees)
    .execute(&mut *tx)
    .await?;
    let n = sqlx::query("DELETE FROM import_dossiers WHERE id_dossier = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::Introuvable(format!("dossier {id}")));
    }
    tx.commit().await?;
    Ok(Json(json!({ "supprime": id })))
}

// ============================================================================
// Factures
// ============================================================================

#[derive(Deserialize)]
pub struct FactureSaisie {
    code_fournisseur: Option<String>,
    numero_facture: Option<String>,
    date_facture: Option<String>,
    code_devise: Option<String>,
    taux_change: Option<f64>,
    montant_devise: Option<f64>,
    nb_palettes: Option<i64>,
    nb_bobines: Option<i64>,
}

/// `POST /api/import/dossiers/{id}/factures` — devise et taux du dossier par
/// defaut : c'est le cas ordinaire, et l'exception se saisit.
pub async fn creer_facture(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id_dossier): Path<String>,
    Json(f): Json<FactureSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let fournisseur = f.code_fournisseur
        .ok_or_else(|| AppError::Invalide("Fournisseur obligatoire.".into()))?;
    let numero = f.numero_facture.filter(|s| !s.trim().is_empty())
        .ok_or_else(|| AppError::Invalide("Numéro de facture obligatoire.".into()))?;
    let date = f.date_facture.ok_or_else(|| AppError::Invalide("Date de facture obligatoire.".into()))?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id: String = sqlx::query_scalar(
        "INSERT INTO import_factures (id_dossier, code_fournisseur, numero_facture, date_facture,
                                      code_devise, taux_change, montant_devise, nb_palettes,
                                      nb_bobines, id_utilisateur_creation)
         SELECT d.id_dossier, $2, $3, $4, COALESCE($5, d.code_devise), COALESCE($6, d.taux_change),
                $7, $8, $9, $10
           FROM import_dossiers d WHERE d.id_dossier = $1
         RETURNING id_facture",
    )
    .bind(&id_dossier)
    .bind(&fournisseur)
    .bind(numero.trim())
    .bind(&date)
    .bind(&f.code_devise)
    .bind(f.taux_change)
    .bind(f.montant_devise)
    .bind(f.nb_palettes)
    .bind(f.nb_bobines)
    .bind(&user.id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("dossier {id_dossier}")))?;
    tx.commit().await?;
    Ok(Json(json!({ "id_facture": id })))
}

/// `PATCH /api/import/factures/{id}` — le taux change la base : on recalcule.
pub async fn modifier_facture(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(f): Json<FactureSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id_dossier = dossier_de_facture(&mut tx, &id).await?;
    sqlx::query(
        "UPDATE import_factures
            SET code_fournisseur = COALESCE($2, code_fournisseur),
                numero_facture = COALESCE($3, numero_facture), date_facture = COALESCE($4, date_facture),
                code_devise = COALESCE($5, code_devise), taux_change = COALESCE($6, taux_change),
                montant_devise = COALESCE($7, montant_devise), nb_palettes = COALESCE($8, nb_palettes),
                nb_bobines = COALESCE($9, nb_bobines)
          WHERE id_facture = $1",
    )
    .bind(&id)
    .bind(&f.code_fournisseur)
    .bind(&f.numero_facture)
    .bind(&f.date_facture)
    .bind(&f.code_devise)
    .bind(f.taux_change)
    .bind(f.montant_devise)
    .bind(f.nb_palettes)
    .bind(f.nb_bobines)
    .execute(&mut *tx)
    .await?;
    metier::recalculer_repartition(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_facture": id })))
}

/// `DELETE /api/import/factures/{id}` — tant qu'aucune de ses lignes n'est
/// entree en stock.
pub async fn supprimer_facture(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id_dossier = dossier_de_facture(&mut tx, &id).await?;
    let recues: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM import_reception_lignes rl
           JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
          WHERE l.id_facture = $1",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    if recues > 0 {
        return Err(AppError::RegleMetier(
            "Cette facture a déjà des lignes en réception : elle ne se supprime plus.".into(),
        ));
    }
    sqlx::query("DELETE FROM import_factures WHERE id_facture = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    metier::recalculer_repartition(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "supprime": id })))
}

// ============================================================================
// Lignes de facture
// ============================================================================

#[derive(Deserialize)]
pub struct LigneSaisie {
    type_ligne: Option<String>,
    code_reference: Option<String>,
    libelle: Option<String>,
    /// La ligne du bon de commande dont vient cette ligne — s'il y en a une.
    id_ligne_bc: Option<String>,
    lot_fournisseur: Option<String>,
    code_couleur: Option<String>,
    libelle_couleur: Option<String>,
    unite: Option<String>,
    quantite: Option<f64>,
    poids_net_kg: Option<f64>,
    nb_bobines: Option<i64>,
    nb_palettes: Option<i64>,
    prix_unitaire_devise: Option<f64>,
}

/// `POST /api/import/factures/{id}/lignes`
///
/// Facturee au kg, la quantite EST le poids net : on ne la demande pas deux
/// fois. Le code couleur, s'il n'est pas saisi, vient de la fiche reference.
pub async fn ajouter_ligne(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id_facture): Path<String>,
    Json(l): Json<LigneSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let type_ligne = l.type_ligne.unwrap_or_else(|| "ERP".into());
    let unite = l.unite.unwrap_or_else(|| "kg".into());
    let quantite = match (unite.as_str(), l.quantite, l.poids_net_kg) {
        (_, Some(q), _) => q,
        ("kg", None, Some(p)) => p,
        _ => return Err(AppError::Invalide("Quantité facturée obligatoire.".into())),
    };
    let prix = l.prix_unitaire_devise
        .ok_or_else(|| AppError::Invalide("Prix unitaire obligatoire.".into()))?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id_dossier = dossier_de_facture(&mut tx, &id_facture).await?;
    let id: String = sqlx::query_scalar(
        "INSERT INTO import_facture_lignes
                (id_facture, ligne_numero, type_ligne, code_reference, libelle, id_ligne_bc,
                 lot_fournisseur, code_couleur, unite, quantite, poids_net_kg,
                 nb_bobines, nb_palettes, prix_unitaire_devise, libelle_couleur)
         SELECT $1,
                COALESCE((SELECT max(ligne_numero) FROM import_facture_lignes WHERE id_facture = $1), 0) + 1,
                -- Chaine vide = rien : une ligne « libre » arrive avec un BC
                -- vide, qui sinon echouerait sur la cle etrangere.
                $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''),
                COALESCE(NULLIF($7, ''), (SELECT code_couleur FROM reference WHERE code_reference = $3)),
                $8, $9, $10, COALESCE($11, 0), COALESCE($12, 0), $13,
                COALESCE(NULLIF($14, ''), (SELECT couleur FROM reference WHERE code_reference = $3))
         RETURNING id_ligne",
    )
    .bind(&id_facture)
    .bind(&type_ligne)
    .bind(&l.code_reference)
    .bind(&l.libelle)
    .bind(&l.id_ligne_bc)
    .bind(&l.lot_fournisseur)
    .bind(&l.code_couleur)
    .bind(&unite)
    .bind(quantite)
    .bind(l.poids_net_kg)
    .bind(l.nb_bobines)
    .bind(l.nb_palettes)
    .bind(prix)
    .bind(&l.libelle_couleur)
    .fetch_one(&mut *tx)
    .await?;
    metier::recalculer_repartition(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_ligne": id })))
}

/// `PATCH /api/import/lignes/{id}`
pub async fn modifier_ligne(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(l): Json<LigneSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id_dossier = dossier_de_ligne(&mut tx, &id).await?;
    sqlx::query(
        "UPDATE import_facture_lignes
            SET code_reference = COALESCE($2, code_reference), libelle = COALESCE($3, libelle),
                -- Chaine vide = retirer : c'est ainsi qu'une ligne redevient
                -- un achat libre, ou perd un lot saisi par erreur.
                id_ligne_bc = CASE WHEN $4 IS NULL THEN id_ligne_bc ELSE NULLIF($4, '') END,
                lot_fournisseur = CASE WHEN $5 IS NULL THEN lot_fournisseur ELSE NULLIF($5, '') END,
                code_couleur = CASE WHEN $6 IS NULL THEN code_couleur ELSE NULLIF($6, '') END,
                libelle_couleur = CASE WHEN $13 IS NULL THEN libelle_couleur ELSE NULLIF($13, '') END,
                unite = COALESCE($7, unite),
                quantite = COALESCE($8, CASE WHEN COALESCE($7, unite) = 'kg' THEN $9 END, quantite),
                poids_net_kg = COALESCE($9, poids_net_kg),
                nb_bobines = COALESCE($10, nb_bobines), nb_palettes = COALESCE($11, nb_palettes),
                prix_unitaire_devise = COALESCE($12, prix_unitaire_devise)
          WHERE id_ligne = $1",
    )
    .bind(&id)
    .bind(&l.code_reference)
    .bind(&l.libelle)
    .bind(&l.id_ligne_bc)
    .bind(&l.lot_fournisseur)
    .bind(&l.code_couleur)
    .bind(&l.unite)
    .bind(l.quantite)
    .bind(l.poids_net_kg)
    .bind(l.nb_bobines)
    .bind(l.nb_palettes)
    .bind(l.prix_unitaire_devise)
    .bind(&l.libelle_couleur)
    .execute(&mut *tx)
    .await?;
    metier::recalculer_repartition(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_ligne": id })))
}

/// `DELETE /api/import/lignes/{id}` — tant qu'elle n'est pas en reception.
pub async fn supprimer_ligne(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id_dossier = dossier_de_ligne(&mut tx, &id).await?;
    let recue: i64 = sqlx::query_scalar("SELECT count(*) FROM import_reception_lignes WHERE id_ligne = $1")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    if recue > 0 {
        return Err(AppError::RegleMetier(
            "Cette ligne est déjà en réception : soldez-la plutôt que de la supprimer.".into(),
        ));
    }
    sqlx::query("DELETE FROM import_facture_lignes WHERE id_ligne = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    metier::recalculer_repartition(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "supprime": id })))
}

#[derive(Deserialize)]
pub struct Solde {
    motif: Option<String>,
}

/// `POST /api/import/lignes/{id}/solder` — le reliquat ne viendra pas.
pub async fn solder_ligne(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(s): Json<Solde>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let motif = s.motif.filter(|m| !m.trim().is_empty())
        .ok_or_else(|| AppError::Invalide("Le motif du solde est obligatoire.".into()))?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id_dossier = dossier_de_ligne(&mut tx, &id).await?;
    sqlx::query("UPDATE import_facture_lignes SET soldee = 1, motif_solde = $2 WHERE id_ligne = $1")
        .bind(&id)
        .bind(motif.trim())
        .execute(&mut *tx)
        .await?;
    metier::statuer_factures(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_ligne": id, "soldee": 1 })))
}

/// `GET /api/import/lignes-bc?fournisseur=X` — les lignes de commande encore
/// ouvertes d'un fournisseur : c'est la liste ou choisir « de quel bon vient
/// cette ligne ».
pub async fn lignes_bc_ouvertes(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(q): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Lire).await?;
    let fournisseur = q.get("fournisseur")
        .ok_or_else(|| AppError::Invalide("Paramètre fournisseur obligatoire.".into()))?;
    let lignes = sqlx::query(
        "SELECT lb.id_ligne_bc, b.numero_bc, b.date_bc, b.statut AS statut_bc, lb.ligne_numero,
                lb.code_reference, r.designation, r.code_couleur, lb.quantite_commandee_kg,
                lb.quantite_restante_kg, lb.prix_kg_devise, lb.code_devise
           FROM ligne_bc lb
           JOIN bon_commande b ON b.id_bc = lb.id_bc
           JOIN reference r ON r.code_reference = lb.code_reference
          WHERE b.code_fournisseur = $1
            AND b.statut IN ('VALIDE','ENVOYE','LIVRE_PARTIEL')
            AND lb.statut NOT IN ('SOLDE','ANNULE')
          ORDER BY b.date_bc DESC, lb.ligne_numero",
    )
    .bind(fournisseur)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&lignes)))
}

// ============================================================================
// Frais
// ============================================================================

#[derive(Deserialize)]
pub struct FraisSaisie {
    id_frais: Option<String>,
    libelle: Option<String>,
    numero_piece: Option<String>,
    montant_devise: Option<f64>,
    code_devise: Option<String>,
    cours_change: Option<f64>,
    /// Vide ou absent : tout le dossier.
    cibles: Option<Vec<String>>,
}

async fn poser_cibles(tx: &mut sqlx::PgConnection, id_ligne_frais: &str, cibles: &[String]) -> AppResult<()> {
    sqlx::query("DELETE FROM dossier_lignes_frais_cibles WHERE id_ligne_frais = $1")
        .bind(id_ligne_frais)
        .execute(&mut *tx)
        .await?;
    if !cibles.is_empty() {
        sqlx::query(
            "INSERT INTO dossier_lignes_frais_cibles (id_ligne_frais, id_ligne)
             SELECT $1, unnest($2::text[])",
        )
        .bind(id_ligne_frais)
        .bind(cibles)
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}

/// `POST /api/import/dossiers/{id}/frais` — en dirhams par defaut, cours 1.
pub async fn ajouter_frais(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id_dossier): Path<String>,
    Json(f): Json<FraisSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let id_frais = f.id_frais.ok_or_else(|| AppError::Invalide("Type de frais obligatoire.".into()))?;
    let montant = f.montant_devise.filter(|m| *m > 0.0)
        .ok_or_else(|| AppError::Invalide("Montant du frais obligatoire.".into()))?;
    let devise = f.code_devise.unwrap_or_else(|| "MAD".into());
    let cours = if devise == "MAD" { 1.0 } else {
        f.cours_change.filter(|c| *c > 0.0)
            .ok_or_else(|| AppError::Invalide("Cours de change obligatoire hors dirham.".into()))?
    };

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id: String = sqlx::query_scalar(
        "INSERT INTO dossier_lignes_frais (id_dossier, id_frais, libelle, numero_piece,
                                           montant_devise, code_devise, cours_change,
                                           id_utilisateur_creation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id_ligne_frais",
    )
    .bind(&id_dossier)
    .bind(&id_frais)
    .bind(&f.libelle)
    .bind(&f.numero_piece)
    .bind(montant)
    .bind(&devise)
    .bind(cours)
    .bind(&user.id)
    .fetch_one(&mut *tx)
    .await?;
    poser_cibles(&mut tx, &id, f.cibles.as_deref().unwrap_or(&[])).await?;
    metier::recalculer_repartition(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_ligne_frais": id })))
}

/// `PATCH /api/import/frais/{id}`
pub async fn modifier_frais(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(f): Json<FraisSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id_dossier: String = sqlx::query_scalar(
        "UPDATE dossier_lignes_frais
            SET id_frais = COALESCE($2, id_frais), libelle = COALESCE($3, libelle),
                numero_piece = COALESCE($4, numero_piece),
                montant_devise = COALESCE($5, montant_devise),
                code_devise = COALESCE($6, code_devise),
                cours_change = CASE WHEN COALESCE($6, code_devise) = 'MAD' THEN 1
                                    ELSE COALESCE($7, cours_change) END
          WHERE id_ligne_frais = $1
      RETURNING id_dossier",
    )
    .bind(&id)
    .bind(&f.id_frais)
    .bind(&f.libelle)
    .bind(&f.numero_piece)
    .bind(f.montant_devise)
    .bind(&f.code_devise)
    .bind(f.cours_change)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("frais {id}")))?;
    if let Some(c) = &f.cibles {
        poser_cibles(&mut tx, &id, c).await?;
    }
    metier::recalculer_repartition(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_ligne_frais": id })))
}

/// `DELETE /api/import/frais/{id}`
pub async fn supprimer_frais(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id_dossier: String = sqlx::query_scalar(
        "DELETE FROM dossier_lignes_frais WHERE id_ligne_frais = $1 RETURNING id_dossier",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("frais {id}")))?;
    metier::recalculer_repartition(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "supprime": id })))
}

// ============================================================================
// Receptions
// ============================================================================

/// `GET /api/import/a-recevoir[?dossier=]` — ce qui reste a recevoir, ligne a
/// ligne, TOUS DOSSIERS NON CLOS confondus : la reception choisit parmi elles.
pub async fn a_recevoir(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(q): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT l.id_ligne, f.id_facture, f.numero_facture, f.code_fournisseur,
                fo.nom AS fournisseur_nom, d.id_dossier, d.numero AS numero_dossier,
                l.ligne_numero, l.code_reference, r.designation, l.lot_fournisseur, l.code_couleur,
                l.libelle_couleur,
                l.poids_net_kg, l.quantite_recue_kg, l.reste_kg, l.nb_bobines, l.nb_palettes,
                bc.numero_bc
           FROM import_facture_lignes l
           JOIN import_factures f ON f.id_facture = l.id_facture
           JOIN import_dossiers d ON d.id_dossier = f.id_dossier
           JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
           JOIN reference r ON r.code_reference = l.code_reference
           LEFT JOIN ligne_bc lb ON lb.id_ligne_bc = l.id_ligne_bc
           LEFT JOIN bon_commande bc ON bc.id_bc = lb.id_bc
          WHERE d.statut <> 'CLOTURE' AND ($1::text IS NULL OR d.id_dossier = $1)
            AND l.type_ligne = 'ERP' AND l.soldee = 0 AND l.reste_kg > 0
          ORDER BY d.numero, f.numero_facture, l.ligne_numero",
    )
    .bind(q.get("dossier").filter(|s| !s.is_empty()))
    .fetch_all(&state.db)
    .await?;
    // Le numero de facture peut etre masque au magasin (droits RECEPTIONS).
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, module::RECEPTIONS, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/import/receptions` — la liste des receptions d'import. Dossiers,
/// fournisseurs et factures se lisent a travers les lignes.
pub async fn lister_receptions(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT r.id_reception, r.numero AS numero_reception, r.date_reception, r.statut,
                r.litige, r.motif_litige, r.date_validation,
                uc.login AS cree_par, uv.login AS valide_par,
                count(rl.id_reception_ligne) AS nb_lignes,
                COALESCE(sum(rl.quantite_recue_kg), 0)::float8 AS quantite_kg,
                COALESCE(sum(rl.ecart_kg), 0)::float8 AS ecart_kg,
                COALESCE(sum(rl.nb_bobines), 0)::bigint AS nb_bobines,
                COALESCE(sum(rl.nb_palettes), 0)::bigint AS nb_palettes,
                string_agg(DISTINCT d.numero, ', ' ORDER BY d.numero) AS dossiers,
                string_agg(DISTINCT fo.nom, ', ' ORDER BY fo.nom) AS fournisseur_nom,
                string_agg(DISTINCT f.numero_facture, ', ' ORDER BY f.numero_facture) AS numero_facture
           FROM import_receptions r
           LEFT JOIN import_reception_lignes rl ON rl.id_reception = r.id_reception
           LEFT JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
           LEFT JOIN import_factures f ON f.id_facture = l.id_facture
           LEFT JOIN import_dossiers d ON d.id_dossier = f.id_dossier
           LEFT JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
           LEFT JOIN utilisateur uc ON uc.id_utilisateur = r.id_utilisateur_creation
           LEFT JOIN utilisateur uv ON uv.id_utilisateur = r.id_utilisateur_validation
          GROUP BY r.id_reception, uc.login, uv.login
          ORDER BY r.date_reception DESC, r.numero DESC",
    )
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, module::RECEPTIONS, &mut v).await?;
    Ok(Json(v))
}

#[derive(Deserialize)]
pub struct LigneRecue {
    id_ligne: String,
    quantite_recue_kg: f64,
    nb_bobines: Option<i64>,
    nb_palettes: Option<i64>,
    lot_fournisseur: Option<String>,
    code_couleur: Option<String>,
    libelle_couleur: Option<String>,
    code_magasin: String,
}

#[derive(Deserialize)]
pub struct ReceptionSaisie {
    date_reception: Option<String>,
    litige: Option<i64>,
    motif_litige: Option<String>,
    notes: Option<String>,
    lignes: Vec<LigneRecue>,
}

/// `POST /api/import/receptions` — une reception en brouillon. Ses lignes
/// peuvent venir de plusieurs factures, de plusieurs dossiers. Le lot et la
/// couleur sont repris de la facture quand ils ne sont pas saisis.
pub async fn creer_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(r): Json<ReceptionSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;
    if r.lignes.is_empty() {
        return Err(AppError::Invalide("Une réception porte au moins une ligne.".into()));
    }
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let numero = numeroter(&mut tx, "import_receptions", "numero", "RIM").await?;
    let id: String = sqlx::query_scalar(
        "INSERT INTO import_receptions (numero, date_reception, litige, motif_litige,
                                        notes, id_utilisateur_creation)
         VALUES ($1, COALESCE($2, to_char(current_date, 'YYYY-MM-DD')), COALESCE($3, 0), $4, $5, $6)
         RETURNING id_reception",
    )
    .bind(&numero)
    .bind(&r.date_reception)
    .bind(r.litige)
    .bind(&r.motif_litige)
    .bind(&r.notes)
    .bind(&user.id)
    .fetch_one(&mut *tx)
    .await?;

    inserer_lignes_reception(&mut tx, &id, &r.lignes).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_reception": id, "numero": numero })))
}

/// Les lignes d'une reception. Le lot et la couleur viennent de la facture
/// quand ils ne sont pas saisis ; l'attendu est le reste de la ligne a cet
/// instant, et c'est contre lui que l'ecart se lit.
async fn inserer_lignes_reception(
    tx: &mut sqlx::PgConnection,
    id_reception: &str,
    lignes: &[LigneRecue],
) -> AppResult<()> {
    for l in lignes {
        sqlx::query(
            "INSERT INTO import_reception_lignes
                    (id_reception, id_ligne, quantite_recue_kg, quantite_attendue_kg,
                     nb_bobines, nb_palettes, lot_fournisseur, code_couleur, code_magasin,
                     libelle_couleur)
             SELECT $1, fl.id_ligne, $3, fl.reste_kg, COALESCE($4, 0), COALESCE($5, 0),
                    COALESCE(NULLIF($6, ''), fl.lot_fournisseur),
                    COALESCE(NULLIF($7, ''), fl.code_couleur), $8,
                    COALESCE(NULLIF($9, ''), fl.libelle_couleur)
               FROM import_facture_lignes fl WHERE fl.id_ligne = $2",
        )
        .bind(id_reception)
        .bind(&l.id_ligne)
        .bind(l.quantite_recue_kg)
        .bind(l.nb_bobines)
        .bind(l.nb_palettes)
        .bind(&l.lot_fournisseur)
        .bind(&l.code_couleur)
        .bind(&l.code_magasin)
        .bind(&l.libelle_couleur)
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}

/// `GET /api/import/receptions/{id}` — l'en-tete et ses lignes, chacune avec
/// ce que sa ligne de facture a deja recu et attend encore.
pub async fn lire_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;
    let entete = sqlx::query(
        "SELECT r.*, uc.login AS cree_par, uv.login AS valide_par
           FROM import_receptions r
           LEFT JOIN utilisateur uc ON uc.id_utilisateur = r.id_utilisateur_creation
           LEFT JOIN utilisateur uv ON uv.id_utilisateur = r.id_utilisateur_validation
          WHERE r.id_reception = $1",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;
    if entete.is_empty() {
        return Err(AppError::Introuvable(format!("reception {id}")));
    }
    let lignes = sqlx::query(
        "SELECT rl.id_reception_ligne, rl.id_ligne, rl.quantite_recue_kg, rl.quantite_attendue_kg,
                rl.ecart_kg, rl.nb_bobines, rl.nb_palettes, rl.lot_fournisseur, rl.code_couleur,
                rl.libelle_couleur,
                rl.code_magasin, rl.id_mouvement,
                d.id_dossier, d.numero AS numero_dossier, d.statut AS statut_dossier,
                f.numero_facture, fo.nom AS fournisseur_nom, fl.code_reference,
                ref.designation, fl.poids_net_kg, fl.quantite_recue_kg AS deja_recu_kg,
                fl.reste_kg, fl.nb_bobines AS bobines_facturees,
                fl.nb_palettes AS palettes_facturees, bc.numero_bc
           FROM import_reception_lignes rl
           JOIN import_facture_lignes fl ON fl.id_ligne = rl.id_ligne
           JOIN import_factures f ON f.id_facture = fl.id_facture
           JOIN import_dossiers d ON d.id_dossier = f.id_dossier
           JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
           JOIN reference ref ON ref.code_reference = fl.code_reference
           LEFT JOIN ligne_bc lb ON lb.id_ligne_bc = fl.id_ligne_bc
           LEFT JOIN bon_commande bc ON bc.id_bc = lb.id_bc
          WHERE rl.id_reception = $1
          ORDER BY d.numero, f.numero_facture, fl.ligne_numero",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;
    let mut v = json!({
        "reception": lignes_en_json(&entete).get(0).cloned().unwrap_or(Value::Null),
        "lignes": lignes_en_json(&lignes),
    });
    user.masquer(&state.db, module::RECEPTIONS, &mut v).await?;
    Ok(Json(v))
}

/// `PUT /api/import/receptions/{id}` — un brouillon se reecrit entier :
/// l'en-tete, et ses lignes remplacees d'un bloc. Validee, elle est figee.
pub async fn modifier_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(r): Json<ReceptionSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;
    if r.lignes.is_empty() {
        return Err(AppError::Invalide("Une réception porte au moins une ligne.".into()));
    }
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let statut: String = sqlx::query_scalar(
        "SELECT statut FROM import_receptions WHERE id_reception = $1 FOR UPDATE",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("reception {id}")))?;
    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(
            "Une réception validée ne se modifie plus : le stock l'a déjà prise en compte.".into(),
        ));
    }
    sqlx::query(
        "UPDATE import_receptions
            SET date_reception = COALESCE($2, date_reception), litige = COALESCE($3, litige),
                motif_litige = $4, notes = $5
          WHERE id_reception = $1",
    )
    .bind(&id)
    .bind(&r.date_reception)
    .bind(r.litige)
    .bind(&r.motif_litige)
    .bind(&r.notes)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM import_reception_lignes WHERE id_reception = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    inserer_lignes_reception(&mut tx, &id, &r.lignes).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_reception": id })))
}

/// `POST /api/import/receptions/{id}/valider` — l'entree en stock.
pub async fn valider_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Valider).await?;
    Ok(Json(metier::valider_reception(&state.db, &user, &id).await?))
}

/// `DELETE /api/import/receptions/{id}` — un brouillon seulement.
pub async fn supprimer_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;
    let n = sqlx::query("DELETE FROM import_receptions WHERE id_reception = $1 AND statut = 'BROUILLON'")
        .bind(&id)
        .execute(&state.db)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::RegleMetier(
            "Seule une réception en brouillon se supprime.".into(),
        ));
    }
    Ok(Json(json!({ "supprime": id })))
}

// ============================================================================
// Cloture
// ============================================================================

/// `POST /api/import/dossiers/{id}/cloturer?simuler=1`
///
/// Avec `simuler`, tout est calcule et rien n'est ecrit : c'est l'apercu que
/// l'ecran montre avant de demander la confirmation.
pub async fn cloturer(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Valider).await?;
    let simuler = matches!(q.get("simuler").map(String::as_str), Some("1" | "true"));
    let mut v = metier::cloturer(&state.db, &user, &id, simuler).await?;
    user.masquer(&state.db, IMPORT, &mut v).await?;
    Ok(Json(v))
}
