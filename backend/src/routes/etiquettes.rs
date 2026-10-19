//! LES ETIQUETTES DE LOT A CODE-BARRES (audit P3, 19/10/2026).
//!
//! A la reception, une etiquette par bobine ou par palette ; a la sortie et au
//! chargement machine, on la scanne au lieu de taper la reference et le lot.
//! L'etiquette porte un code court (« E000001234 ») ; la reference, le lot et
//! l'arrivage se relisent en base au moment du scan (migration 2026-10-19b).
//!
//! Generer est idempotent : une ligne qui a deja ses etiquettes de cette
//! nature les garde (on les reimprime, on n'en fabrique pas d'autres — celles
//! deja collees resteraient sans double).

use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use super::json::{ligne_en_json, lignes_en_json};
use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Au-dela, ce n'est plus un colisage, c'est une erreur de saisie : 5 000
/// etiquettes partiraient a l'imprimante.
const MAX_PAR_LIGNE: i64 = 5000;

#[derive(Debug, Deserialize)]
pub struct Nature {
    pub nature: Option<String>,
}

fn nature_de(n: &Option<String>) -> AppResult<&'static str> {
    match n.as_deref().map(str::trim).map(str::to_uppercase).as_deref() {
        None | Some("") | Some("BOBINE") => Ok("BOBINE"),
        Some("PALETTE") => Ok("PALETTE"),
        Some(x) => Err(AppError::Invalide(format!(
            "Nature d'etiquette inconnue : « {x} » (BOBINE ou PALETTE)."
        ))),
    }
}

/// Le nombre d'etiquettes d'une ligne : le colisage compte sur le quai, a
/// defaut le theorique du catalogue. SQL partage par la generation et la liste.
const NOMBRE: &str = "CASE $2
         WHEN 'BOBINE' THEN COALESCE(lr.nb_bobines_saisi,
                                     round(lr.quantite_stock_kg / NULLIF(ref.poids_bobine_kg, 0)))
         ELSE COALESCE(ceil(lr.nb_palettes_saisi),
                       ceil(lr.quantite_stock_kg
                            / NULLIF(ref.poids_bobine_kg * ref.bobines_par_palette, 0)))
     END::bigint";

async fn lister_reception(
    db: &crate::db::Db,
    id_reception: &str,
    nature: &str,
) -> AppResult<Value> {
    let etiquettes = sqlx::query(
        "SELECT v.code, v.nature, v.rang, v.nombre, v.poids_kg::float8 AS poids_kg,
                v.code_reference, v.designation, v.lot_fournisseur, v.code_magasin_dest,
                v.numero_reception, v.date_reception, v.code_fournisseur
           FROM v_etiquette_lot v
           JOIN ligne_reception lr ON lr.id_ligne_reception = v.id_ligne_reception
          WHERE v.id_reception = $1 AND v.nature = $2
          ORDER BY lr.ligne_numero, v.rang",
    )
    .bind(id_reception)
    .bind(nature)
    .fetch_all(db)
    .await?;
    // Les lignes qui n'en ont pas : sans colisage connu, ou trop nombreuses.
    let sans = sqlx::query(&format!(
        "SELECT lr.ligne_numero, lr.code_reference, {NOMBRE} AS nombre
           FROM ligne_reception lr
           JOIN reference ref ON ref.code_reference = lr.code_reference
          WHERE lr.id_reception = $1
            AND NOT EXISTS (SELECT 1 FROM etiquette_lot e
                             WHERE e.id_ligne_reception = lr.id_ligne_reception AND e.nature = $2)
          ORDER BY lr.ligne_numero"
    ))
    .bind(id_reception)
    .bind(nature)
    .fetch_all(db)
    .await?;
    Ok(json!({
        "nature": nature,
        "etiquettes": lignes_en_json(&etiquettes),
        "lignes_sans_etiquette": lignes_en_json(&sans),
        "max_par_ligne": MAX_PAR_LIGNE,
    }))
}

/// GET /api/receptions/{id}/etiquettes?nature=BOBINE — ce qui est deja genere.
pub async fn lister(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Query(q): Query<Nature>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;
    let nature = nature_de(&q.nature)?;
    Ok(Json(lister_reception(&state.db, &id, nature).await?))
}

/// POST /api/receptions/{id}/etiquettes {nature} — genere ce qui manque.
pub async fn generer(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(q): Json<Nature>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;
    let nature = nature_de(&q.nature)?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let statut: Option<String> =
        sqlx::query_scalar("SELECT statut FROM reception WHERE id_reception = $1 FOR UPDATE")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?;
    match statut.as_deref() {
        None => return Err(AppError::Introuvable(format!("reception {id}"))),
        Some("ANNULE") => {
            return Err(AppError::RegleMetier(
                "Reception annulee : sa marchandise n'est pas entree, il n'y a rien a etiqueter.".into(),
            ))
        }
        _ => {}
    }
    // Dans l'ordre des lignes puis des rangs : les codes se suivent sur la planche.
    sqlx::query(&format!(
        "INSERT INTO etiquette_lot (id_ligne_reception, nature, rang, nombre, poids_kg,
                                    id_utilisateur_creation)
         SELECT l.id_ligne_reception, $2, g, l.n, round(l.kg / l.n, 4), $3
           FROM (SELECT lr.id_ligne_reception, lr.ligne_numero, lr.quantite_stock_kg AS kg,
                        {NOMBRE} AS n
                   FROM ligne_reception lr
                   JOIN reference ref ON ref.code_reference = lr.code_reference
                  WHERE lr.id_reception = $1
                    AND NOT EXISTS (SELECT 1 FROM etiquette_lot e
                                     WHERE e.id_ligne_reception = lr.id_ligne_reception
                                       AND e.nature = $2)) l
           CROSS JOIN LATERAL generate_series(1, l.n) g
          WHERE l.n > 0 AND l.n <= $4
          ORDER BY l.ligne_numero, g"
    ))
    .bind(&id)
    .bind(nature)
    .bind(&user.id)
    .bind(MAX_PAR_LIGNE)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(lister_reception(&state.db, &id, nature).await?))
}

/// GET /api/etiquettes/{code} — le scan : ce que porte l'etiquette, relu en base.
pub async fn lire(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    // Une douchette ajoute parfois un espace, ou tape en minuscules.
    let code = code.trim().to_uppercase();
    let ligne = sqlx::query(
        "SELECT code, nature, rang, nombre, poids_kg::float8 AS poids_kg,
                code_reference, designation, lot_fournisseur, code_magasin_dest,
                numero_reception, statut_reception, date_reception,
                unite_catalogue, poids_bobine_kg::float8 AS poids_bobine_kg,
                bobines_par_palette::float8 AS bobines_par_palette,
                bobines_par_lot::float8 AS bobines_par_lot,
                densite_kg_ml::float8 AS densite_kg_ml, suivi_lot
           FROM v_etiquette_lot WHERE code = $1",
    )
    .bind(&code)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("etiquette {code}")))?;
    Ok(Json(ligne_en_json(&ligne)))
}

#[cfg(test)]
mod tests {
    use super::nature_de;

    #[test]
    fn la_nature_par_defaut_est_la_bobine() {
        assert_eq!(nature_de(&None).unwrap(), "BOBINE");
        assert_eq!(nature_de(&Some(" palette ".into())).unwrap(), "PALETTE");
        assert!(nature_de(&Some("CARTON".into())).is_err());
    }
}
