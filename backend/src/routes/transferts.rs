//! Les transferts entre magasins : expedition, fil en route, reception.
//! Sortis de `stock.rs` le 17/10/2026 (audit B2).

use super::json::lignes_en_json;
use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::db::arrondi_kg;
use crate::domain::numerotation::numeroter;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use super::stock::vers_kg;
pub async fn lister_transferts(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT t.*, u.login AS auteur, ur.login AS receptionnaire,
                (SELECT COUNT(*) FROM ligne_transfert l WHERE l.id_transfert = t.id_transfert) AS nb_lignes,
                (SELECT ROUND(COALESCE(SUM(l.quantite_kg), 0), 3) FROM ligne_transfert l
                  WHERE l.id_transfert = t.id_transfert) AS quantite_totale_kg,
                -- Depuis combien de jours la marchandise roule-t-elle ? Au-dela
                -- de quelques jours sur un transfert interne, c'est qu'on a
                -- oublie de constater l'arrivee.
                CASE WHEN t.statut = 'VALIDE'
                     THEN CAST((current_date - (t.date_transfert)::date) AS bigint)
                END AS jours_en_transit
           FROM transfert t
           LEFT JOIN utilisateur u  ON u.id_utilisateur = t.id_utilisateur
           LEFT JOIN utilisateur ur ON ur.id_utilisateur = t.id_utilisateur_reception
          ORDER BY t.date_transfert DESC LIMIT 200",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&rows)))
}

#[derive(Debug, Deserialize)]
pub struct NouveauTransfert {
    /// LA VERSION LUE PAR L'ECRAN (verrou optimiste, 19/10/2026) : obligatoire
    /// pour modifier un document existant, ignoree a la creation.
    #[serde(default)]
    pub version: Option<i64>,
    /// L'IDENTIFIANT TIRE PAR L'ECRAN a l'ouverture du formulaire (audit P3,
    /// 19/10/2026) : le meme envoi rejoue rend le meme document, pas un second.
    /// Absent : le serveur en tire un.
    #[serde(default)]
    pub id_document: Option<String>,
    pub code_magasin_source: String,
    pub code_magasin_dest: String,
    pub date_transfert: Option<String>,
    pub responsable: Option<String>,
    pub transporteur: Option<String>,
    pub observations: Option<String>,
    /// Lignes saisies AVEC l'entete. Tout part dans une seule transaction : un
    /// transfert ouvert sans ligne, avec un numero deja attribue, serait un
    /// document fantome au milieu de la numerotation.
    pub lignes: Option<Vec<LigneTransfert>>,
}

/// Le dossier complet d'un transfert : entete, lignes, totaux.
///
/// Un seul appel, parce que c'est ce qu'imprime un bon de sortie ou de
/// reception. Assembler le document depuis trois requetes exposerait a
/// l'imprimer a moitie servi.
pub async fn dossier_transfert(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Lire).await?;

    let entete = sqlx::query(
        "SELECT t.*, ms.nom AS magasin_source_nom, md.nom AS magasin_dest_nom,
                ue.login AS expediteur, ur.login AS receptionnaire,
                (SELECT COUNT(*) FROM ligne_transfert l WHERE l.id_transfert = t.id_transfert)
                    AS nb_lignes,
                (SELECT ROUND(COALESCE(SUM(l.quantite_kg), 0), 3) FROM ligne_transfert l
                  WHERE l.id_transfert = t.id_transfert)            AS quantite_totale_kg,
                (SELECT COALESCE(SUM(l.nb_bobines), 0) FROM ligne_transfert l
                  WHERE l.id_transfert = t.id_transfert)            AS bobines_totales,
                (SELECT COALESCE(SUM(l.nb_palettes), 0) FROM ligne_transfert l
                  WHERE l.id_transfert = t.id_transfert)            AS palettes_totales,
                (SELECT ROUND(COALESCE(SUM(l.quantite_kg * l.prix_kg_mad), 0), 2)
                   FROM ligne_transfert l WHERE l.id_transfert = t.id_transfert)
                                                                    AS valeur_totale_mad,
                -- Duree reelle du trajet, une fois l'arrivee constatee.
                CASE WHEN t.date_sortie IS NOT NULL AND t.date_reception_dest IS NOT NULL
                     THEN CAST(((t.date_reception_dest)::date - (t.date_sortie)::date)
                               AS bigint)
                     WHEN t.date_sortie IS NOT NULL
                     THEN CAST((current_date - (t.date_sortie)::date) AS bigint)
                END                                                 AS jours_en_transit
           FROM transfert t
           LEFT JOIN magasin ms     ON ms.code_magasin = t.code_magasin_source
           LEFT JOIN magasin md     ON md.code_magasin = t.code_magasin_dest
           LEFT JOIN utilisateur ue ON ue.id_utilisateur = t.id_utilisateur
           LEFT JOIN utilisateur ur ON ur.id_utilisateur = t.id_utilisateur_reception
          WHERE t.id_transfert = $1",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("transfert {id}")))?;

    let lignes = sqlx::query(
        "SELECT l.*, r.designation, r.couleur, r.unite_catalogue,
                ROUND(l.quantite_kg * COALESCE(l.prix_kg_mad, 0), 2) AS total_mad
           FROM ligne_transfert l
           JOIN reference r ON r.code_reference = l.code_reference
          WHERE l.id_transfert = $1 ORDER BY l.ligne_numero",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let mut sortie = json!({
        "entete": lignes_en_json(std::slice::from_ref(&entete))
            .as_array().and_then(|a| a.first().cloned()).unwrap_or(Value::Null),
        "lignes": lignes_en_json(&lignes),
    });
    user.masquer(&state.db, module::MOUVEMENTS, &mut sortie).await?;
    Ok(Json(sortie))
}

pub async fn creer_transfert(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(t): Json<NouveauTransfert>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    let id = crate::domain::idempotence::identifiant(t.id_document.as_deref())?;
    if let Some(v) = crate::domain::idempotence::deja_enregistre(
        &state.db, &crate::domain::idempotence::TRANSFERT, &id, &user.id,
    )
    .await?
    {
        return Ok(Json(v));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let numero = numeroter(&mut tx, "transfert", "numero_transfert", "TRF").await?;

    sqlx::query(
        "INSERT INTO transfert
             (id_transfert, numero_transfert, code_magasin_source, code_magasin_dest,
              id_utilisateur, responsable, transporteur, observations, date_transfert)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                 COALESCE(fn_jour_casablanca($9), (now() AT TIME ZONE 'Africa/Casablanca')::date))",
    )
    .bind(&id)
    .bind(&numero)
    .bind(&t.code_magasin_source)
    .bind(&t.code_magasin_dest)
    .bind(&user.id)
    .bind(&t.responsable)
    .bind(&t.transporteur)
    .bind(&t.observations)
    .bind(&t.date_transfert)
    .execute(&mut *tx)
    .await?;

    // --- Lignes saisies avec l'entete ---------------------------------------
    let mut posees = 0i64;
    let mut total_kg = 0.0_f64;
    for (i, l) in t.lignes.iter().flatten().enumerate() {
        if l.quantite_saisie <= 0.0 {
            return Err(AppError::Invalide(format!(
                "{} : la quantite doit etre strictement positive",
                l.code_reference
            )));
        }
        let (kg, facteur) =
            vers_kg(&state.db, &l.code_reference, l.quantite_saisie, &l.unite_saisie).await?;

        sqlx::query(
            "INSERT INTO ligne_transfert
                 (id_transfert, ligne_numero, code_reference, quantite_kg,
                  quantite_saisie, unite_saisie, facteur_conversion, lot_fournisseur,
                  nb_bobines, nb_palettes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(&id)
        .bind((i + 1) as i64)
        .bind(&l.code_reference)
        .bind(kg)
        .bind(l.quantite_saisie)
        .bind(&l.unite_saisie)
        .bind(facteur)
        .bind(&l.lot_fournisseur)
        .bind(l.nb_bobines)
        .bind(l.nb_palettes)
        .execute(&mut *tx)
        .await?;
        posees += 1;
        total_kg += kg;
    }

    tx.commit().await?;
    Ok(Json(json!({
        "id_transfert": id, "numero_transfert": numero,
        "lignes": posees, "quantite_totale_kg": arrondi_kg(total_kg)
    })))
}

#[derive(Debug, Deserialize)]
pub struct LigneTransfert {
    pub code_reference: String,
    pub quantite_saisie: f64,
    pub unite_saisie: String,
    pub lot_fournisseur: Option<String>,
    /// Conditionnement compte au quai, independant de la conversion en kg.
    pub nb_bobines: Option<i64>,
    pub nb_palettes: Option<f64>,
}

pub async fn ajouter_ligne_transfert(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(l): Json<LigneTransfert>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    let (kg, facteur) =
        vers_kg(&state.db, &l.code_reference, l.quantite_saisie, &l.unite_saisie).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: String = sqlx::query_scalar("SELECT statut FROM transfert WHERE id_transfert = $1")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("transfert {id}")))?;
    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(
            "Seul un transfert en brouillon peut recevoir des lignes.".into(),
        ));
    }

    let numero: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(ligne_numero), 0) + 1 FROM ligne_transfert WHERE id_transfert = $1",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO ligne_transfert
             (id_transfert, ligne_numero, code_reference, quantite_kg,
              quantite_saisie, unite_saisie, facteur_conversion, lot_fournisseur,
              nb_bobines, nb_palettes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(&id)
    .bind(numero)
    .bind(&l.code_reference)
    .bind(kg)
    .bind(l.quantite_saisie)
    .bind(&l.unite_saisie)
    .bind(facteur)
    .bind(&l.lot_fournisseur)
    .bind(l.nb_bobines)
    .bind(l.nb_palettes)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "ligne_numero": numero, "quantite_kg": kg })))
}

/// Reprise d'un transfert TANT QU'IL N'EST PAS PARTI.
///
/// Un document de preparation se corrige : une quantite mal comptee, une palette
/// oubliee, un magasin destinataire choisi de travers. Le refuser obligeait a
/// abandonner le transfert et a en ouvrir un autre, ce qui trouait la
/// numerotation pour une faute de frappe.
///
/// La charge recue FAIT AUTORITE : les lignes qu'elle ne contient pas sont
/// retirees, celles qu'elle contient remplacent les anciennes. C'est le meme
/// regime que le document qualite, et pour la meme raison — un ecran qui envoie
/// sa grille entiere ne sait pas exprimer « supprime la ligne 3 » autrement.
///
/// Passe l'expedition, plus rien ne bouge : les mouvements sont au grand livre,
/// que R03 rend immuable. Corriger le document sans corriger le grand livre
/// ferait mentir l'un des deux.
pub async fn modifier_transfert(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(t): Json<NouveauTransfert>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    let version = crate::domain::concurrence::exigee(t.version)?;

    // La conversion se fait AVANT d'ouvrir la transaction : une unite sans
    // facteur doit echouer en nommant sa reference, pas apres avoir efface les
    // lignes existantes.
    let saisies = t.lignes.as_deref().unwrap_or_default();
    let mut converties = Vec::with_capacity(saisies.len());
    for l in saisies {
        if l.quantite_saisie <= 0.0 {
            return Err(AppError::Invalide(format!(
                "{} : la quantite doit etre strictement positive",
                l.code_reference
            )));
        }
        let (kg, facteur) =
            vers_kg(&state.db, &l.code_reference, l.quantite_saisie, &l.unite_saisie).await?;
        converties.push((l, kg, facteur));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    crate::domain::concurrence::exiger_version(
        &mut tx, "transfert", "id_transfert", &id, Some(version), "Ce transfert",
    )
    .await?;

    let statut: String = sqlx::query_scalar("SELECT statut FROM transfert WHERE id_transfert = $1")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("transfert {id}")))?;
    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(
            "Un transfert deja expedie ne se modifie plus : ses mouvements sont \
             au grand livre, que R03 rend immuable. Corriger la marchandise \
             reellement partie passe par un inventaire."
                .into(),
        ));
    }

    sqlx::query(
        "UPDATE transfert
            SET code_magasin_source = $2, code_magasin_dest = $3,
                responsable = $4, transporteur = $5, observations = $6,
                date_transfert = COALESCE(fn_jour_casablanca($7), date_transfert)
          WHERE id_transfert = $1",
    )
    .bind(&id)
    .bind(&t.code_magasin_source)
    .bind(&t.code_magasin_dest)
    .bind(&t.responsable)
    .bind(&t.transporteur)
    .bind(&t.observations)
    .bind(&t.date_transfert)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM ligne_transfert WHERE id_transfert = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    let mut total_kg = 0.0_f64;
    for (i, (l, kg, facteur)) in converties.iter().enumerate() {
        sqlx::query(
            "INSERT INTO ligne_transfert
                 (id_transfert, ligne_numero, code_reference, quantite_kg,
                  quantite_saisie, unite_saisie, facteur_conversion, lot_fournisseur,
                  nb_bobines, nb_palettes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(&id)
        .bind((i + 1) as i64)
        .bind(&l.code_reference)
        .bind(kg)
        .bind(l.quantite_saisie)
        .bind(&l.unite_saisie)
        .bind(facteur)
        .bind(&l.lot_fournisseur)
        .bind(l.nb_bobines)
        .bind(l.nb_palettes)
        .execute(&mut *tx)
        .await?;
        total_kg += kg;
    }

    // La version a jour : l'ecran reste ouvert et la presentera au prochain enregistrement.
    let version: i64 = sqlx::query_scalar("SELECT version::bigint FROM transfert WHERE id_transfert = $1")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({
        "id_transfert": id,
        "version": version,
        "lignes": converties.len(),
        "quantite_totale_kg": arrondi_kg(total_kg)
    })))
}

/// Abandon d'un transfert avant expedition.
///
/// Le document reste, marque ANNULE : son numero a ete attribue, et un trou
/// dans la numerotation se remarque bien plus tard, quand plus personne ne sait
/// s'il manque un bon ou s'il n'a jamais existe.
pub async fn annuler_transfert(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    axum::extract::Query(q): axum::extract::Query<super::entites::VersionLue>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    let version = super::entites::version_exigee(q.version.map(serde_json::Value::String).as_ref())?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    crate::domain::concurrence::exiger_version(
        &mut tx, "transfert", "id_transfert", &id, Some(version), "Ce transfert",
    )
    .await?;

    let statut: String = sqlx::query_scalar("SELECT statut FROM transfert WHERE id_transfert = $1")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("transfert {id}")))?;
    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(
            "Seul un transfert en preparation s'abandonne. Une fois la \
             marchandise partie, elle doit arriver quelque part : la recevoir \
             au destinataire, ou la faire revenir par un transfert inverse."
                .into(),
        ));
    }

    // La transition BROUILLON -> ANNULE est declaree dans `transition_statut` :
    // c'est la base qui l'autorise, pas cette fonction.
    sqlx::query("UPDATE transfert SET statut = 'ANNULE' WHERE id_transfert = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(Json(json!({ "id_transfert": id, "statut": "ANNULE" })))
}

// ============================================================================
// Inventaires
// ============================================================================
