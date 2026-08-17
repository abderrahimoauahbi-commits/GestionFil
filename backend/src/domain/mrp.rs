//! Calcul MRP : explosion du plan de production par les recettes.
//!
//! La formule (CDC F2) est portee par la vue `v_besoin_mrp_calcule`, deja
//! verifiee par `db/tests/run-tests.ps1` : elle reproduit exactement l'exemple
//! du cahier des charges (500 m2 de SH -> 56,32 kg de PP-3430). Le service ne
//! la reimplemente pas ; il l'execute dans une transaction et materialise le
//! resultat.
//!
//! Le recalcul est IDEMPOTENT : `DELETE` puis `INSERT`, sous la contrainte
//! `UNIQUE (id_plan, mois, code_reference)`. Le CDC empilait les recalculs, si
//! bien que chaque relance doublait les besoins — et le budget d'achat.

use crate::auth::Utilisateur;
use crate::db::{aujourdhui, maintenant, Db};
use crate::error::{AppError, AppResult};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ResultatMrp {
    pub id_plan: String,
    pub lignes_generees: i64,
    pub references_couvertes: i64,
    pub total_kg: f64,
    pub date_reference: String,
}

/// Confirme le figement des qualites retenues par l'entete du plan.
///
/// Depuis que l'entete porte explicitement le choix des qualites, cette etape ne
/// SELECTIONNE plus rien : elle verifie que le choix tient toujours — chaque
/// qualite planifiee figure bien dans l'entete, et elle est encore ACTIVE — puis
/// rehorodate le figement. Une qualite cloturee entre le choix et la mise en
/// service doit etre remplacee a la main : la remplacer d'office changerait la
/// composition d'un plan sans que personne l'ait decide.
pub async fn figer_recettes(db: &Db, user: &Utilisateur, id_plan: &str) -> AppResult<i64> {
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: String = sqlx::query_scalar("SELECT statut FROM plan_production WHERE id_plan = ?1")
        .bind(id_plan)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("plan {id_plan}")))?;

    if statut == "EN_COURS" || statut == "CLOTURE" {
        return Err(AppError::RegleMetier(
            "Les qualites d'un plan en service sont figees et ne peuvent plus etre modifiees.".into(),
        ));
    }

    // Qualites planifiees dont l'entete ne designe aucune recette.
    let manquantes: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT lpp.code_qualite
           FROM ligne_plan_production lpp
          WHERE lpp.id_plan = ?1 AND lpp.m2_prevus > 0
            AND NOT EXISTS (SELECT 1 FROM plan_qualite pq
                             WHERE pq.id_plan = ?1 AND pq.code_qualite = lpp.code_qualite)",
    )
    .bind(id_plan)
    .fetch_all(&mut *tx)
    .await?;

    if !manquantes.is_empty() {
        return Err(AppError::RegleMetier(format!(
            "Ces qualites sont planifiees sans figurer dans l'entete du plan : {}.",
            manquantes.join(", ")
        )));
    }

    // Qualites retenues qui ne sont plus en service.
    let perimees: Vec<String> = sqlx::query_scalar(
        "SELECT pq.code_qualite || ' (' || q.statut || ')'
           FROM plan_qualite pq
           JOIN qualite q ON q.code_qualite = pq.code_qualite
          WHERE pq.id_plan = ?1 AND q.statut <> 'ACTIF'",
    )
    .bind(id_plan)
    .fetch_all(&mut *tx)
    .await?;

    if !perimees.is_empty() {
        return Err(AppError::RegleMetier(format!(
            "Ces qualites retenues ne sont plus actives : {}. Remplacez-les dans l'entete du plan.",
            perimees.join(", ")
        )));
    }

    let res = sqlx::query("UPDATE plan_qualite SET date_figee = ?2 WHERE id_plan = ?1")
        .bind(id_plan)
        .bind(maintenant())
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(res.rows_affected() as i64)
}

/// Recalcule les besoins matiere du plan.
pub async fn calculer(db: &Db, user: &Utilisateur, id_plan: &str) -> AppResult<ResultatMrp> {
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let existe: Option<String> =
        sqlx::query_scalar("SELECT statut FROM plan_production WHERE id_plan = ?1")
            .bind(id_plan)
            .fetch_optional(&mut *tx)
            .await?;
    let statut = existe.ok_or_else(|| AppError::Introuvable(format!("plan {id_plan}")))?;

    if statut == "CLOTURE" {
        return Err(AppError::RegleMetier(
            "Un plan cloture ne peut plus etre recalcule.".into(),
        ));
    }

    // Garde-fou : sans qualite figee, la vue ne renverrait simplement aucune
    // ligne pour la qualite concernee — un besoin manquant est bien plus
    // dangereux qu'une erreur.
    let sans_recette: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT lpp.code_qualite
           FROM ligne_plan_production lpp
          WHERE lpp.id_plan = ?1 AND lpp.m2_prevus > 0
            AND NOT EXISTS (SELECT 1 FROM plan_qualite pq
                             WHERE pq.id_plan = ?1 AND pq.code_qualite = lpp.code_qualite)",
    )
    .bind(id_plan)
    .fetch_all(&mut *tx)
    .await?;

    if !sans_recette.is_empty() {
        return Err(AppError::RegleMetier(format!(
            "Qualite non figee dans l'entete : {}. Executer d'abord /figer-recettes.",
            sans_recette.join(", ")
        )));
    }

    let date_reference = aujourdhui();

    sqlx::query("DELETE FROM besoin_mrp WHERE id_plan = ?1")
        .bind(id_plan)
        .execute(&mut *tx)
        .await?;

    let res = sqlx::query(
        "INSERT INTO besoin_mrp
             (id_plan, mois, rang_mois, annee_mois, code_reference, quantite_brute_kg,
              taux_perte_applique, quantite_kg, date_calcul, date_reference)
         SELECT id_plan, mois, rang_mois, annee_mois, code_reference, quantite_brute_kg,
                taux_perte_pct, quantite_kg, ?2, ?3
           FROM v_besoin_mrp_calcule
          WHERE id_plan = ?1",
    )
    .bind(id_plan)
    .bind(maintenant())
    .bind(&date_reference)
    .execute(&mut *tx)
    .await?;

    let (refs, total): (i64, Option<f64>) = sqlx::query_as(
        "SELECT COUNT(DISTINCT code_reference), SUM(quantite_kg)
           FROM besoin_mrp WHERE id_plan = ?1",
    )
    .bind(id_plan)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(ResultatMrp {
        id_plan: id_plan.to_string(),
        lignes_generees: res.rows_affected() as i64,
        references_couvertes: refs,
        total_kg: crate::db::arrondi_kg(total.unwrap_or(0.0)),
        date_reference,
    })
}

/// Photo figee des besoins au moment de la validation d'un plan (CDC B1).
pub async fn prendre_snapshot(db: &Db, user: &Utilisateur, id_plan: &str) -> AppResult<i64> {
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let horodatage = maintenant();
    let res = sqlx::query(
        "INSERT INTO snapshot_mrp
             (date_snapshot, id_plan, code_reference, mois, rang_mois, annee_mois,
              quantite_besoin_kg, stock_projete_kg, statut_couleur)
         SELECT ?2, bm.id_plan, bm.code_reference, bm.mois, bm.rang_mois, bm.annee_mois,
                bm.quantite_kg, sp.stock_projete_kg, sp.statut
           FROM besoin_mrp bm
           LEFT JOIN v_stock_projete sp ON sp.code_reference = bm.code_reference
          WHERE bm.id_plan = ?1",
    )
    .bind(id_plan)
    .bind(&horodatage)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(res.rows_affected() as i64)
}
