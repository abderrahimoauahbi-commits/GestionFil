//! LA VALORISATION EN DEUX TEMPS D'UNE RECEPTION LOCALE (regle 6, 08/10/2026).
//!
//! A la validation, la marchandise entre au PRIX DU BON : c'est une valeur
//! PROVISOIRE. La facture du fournisseur arrive ensuite, avec ses frais :
//! c'est la valeur DEFINITIVE. La cloture de la reception porte la difference,
//! a la maniere SAP :
//!
//!   * au STOCK ENCORE PRESENT, a hauteur de min(stock, recu) / recu, entre les
//!     magasins au prorata de ce qu'ils portent — le CMUP en tient compte ;
//!   * en ECART DE PRIX pour la part des kilos deja sortis : elle est TRACEE,
//!     pas reinjectee dans le CMUP — on ne revalorise pas un tapis deja tisse.
//!
//! Meme moteur que la cloture d'un dossier d'import (regle 7). Le journal
//! `reception_ajustements_cmup` est immuable. Une reception cloturee ne se
//! contre-passe plus : sa correction passe par un avoir (regle 8).

use crate::auth::Utilisateur;
use crate::db::{arrondi_kg, maintenant, Db};
use crate::domain::importation::repartir_centimes;
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};

/// Repartit un montant SIGNE : une facture plus basse que le bon fait baisser
/// le CMUP, au meme prorata.
fn repartir_signe(montant: i64, bases: &[i64]) -> Vec<i64> {
    if montant >= 0 {
        repartir_centimes(montant, bases)
    } else {
        repartir_centimes(-montant, bases).into_iter().map(|p| -p).collect()
    }
}

pub async fn cloturer(
    db: &Db,
    user: &Utilisateur,
    id_reception: &str,
    numero_facture: &str,
    montant_facture_mad: f64,
    frais_mad: f64,
    simuler: bool,
) -> AppResult<Value> {
    let numero_facture = numero_facture.trim();
    if numero_facture.is_empty() {
        return Err(AppError::Invalide("Le numero de la facture est obligatoire.".into()));
    }
    if !(montant_facture_mad > 0.0) || frais_mad < 0.0 {
        return Err(AppError::Invalide(
            "Le montant de la facture doit etre positif, les frais nuls ou positifs.".into(),
        ));
    }

    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let (numero, statut): (String, String) = sqlx::query_as(
        "SELECT numero_reception, statut FROM reception WHERE id_reception = $1 FOR UPDATE",
    )
    .bind(id_reception)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("reception {id_reception}")))?;
    if statut != "VALIDE" {
        return Err(AppError::RegleMetier(format!(
            "La reception {numero} est {statut} : seule une reception validee se cloture avec sa facture."
        )));
    }

    // La valeur provisoire, par reference : ce que la validation a fait entrer,
    // au prix du bon (l'archive figee de la reception).
    let provisoire: Vec<(String, i64, f64)> = sqlx::query_as(
        "SELECT a.code_reference, (sum(a.total_mad) * 100)::bigint, sum(a.quantite_stock_kg)::float8
           FROM archive_reception a
           JOIN ligne_reception lr ON lr.id_ligne_reception = a.id_ligne_reception
          WHERE lr.id_reception = $1
          GROUP BY a.code_reference
          ORDER BY a.code_reference",
    )
    .bind(id_reception)
    .fetch_all(&mut *tx)
    .await?;
    if provisoire.is_empty() {
        return Err(AppError::RegleMetier(format!("La reception {numero} n'a fait entrer aucune ligne.")));
    }
    let provisoire_c: i64 = provisoire.iter().map(|(_, v, _)| v).sum();
    let definitif_c = ((montant_facture_mad + frais_mad) * 100.0).round() as i64;
    let difference_c = definitif_c - provisoire_c;

    let bases: Vec<i64> = provisoire.iter().map(|(_, v, _)| *v).collect();
    let parts = repartir_signe(difference_c, &bases);

    let horodatage = maintenant();
    let mut detail = Vec::new();
    let mut total_stock_c: i64 = 0;
    let mut total_ecart_c: i64 = 0;

    for ((code_reference, valeur_c, recu), part_c) in provisoire.iter().zip(parts.iter()) {
        let stocks: Vec<(String, f64, Option<f64>)> = sqlx::query_as(
            "SELECT code_magasin, quantite_kg::float8, cmup_mad::float8
               FROM stock_magasin
              WHERE code_reference = $1 AND quantite_kg > 0
              ORDER BY code_magasin
                FOR UPDATE",
        )
        .bind(code_reference)
        .fetch_all(&mut *tx)
        .await?;
        let q_stock: f64 = stocks.iter().map(|(_, q, _)| q).sum();
        let stock_c: i64 = if *recu > 0.0 {
            ((*part_c as f64) * q_stock.min(*recu) / recu).round() as i64
        } else {
            0
        };
        let ecart_c = part_c - stock_c;

        let poids: Vec<i64> = stocks.iter().map(|(_, q, _)| (q * 10_000.0).round() as i64).collect();
        let parts_mag = repartir_signe(stock_c, &poids);
        let mut magasins = Vec::new();
        for ((magasin, q, cmup), p_c) in stocks.iter().zip(parts_mag.iter()) {
            let avant = cmup.unwrap_or(0.0);
            let apres = arrondi_kg((avant + (*p_c as f64 / 100.0) / q).max(0.0));
            sqlx::query("UPDATE stock_magasin SET cmup_mad = $3, date_maj = $4 WHERE code_reference = $1 AND code_magasin = $2")
                .bind(code_reference)
                .bind(magasin)
                .bind(apres)
                .bind(&horodatage)
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                "INSERT INTO reception_ajustements_cmup
                        (id_reception, code_reference, nature, code_magasin, quantite_recue_kg,
                         stock_kg, cmup_avant, cmup_apres, montant_mad, id_utilisateur)
                 VALUES ($1, $2, 'STOCK', $3, $4, $5, $6, $7, $8 / 100.0, $9)",
            )
            .bind(id_reception)
            .bind(code_reference)
            .bind(magasin)
            .bind(*recu)
            .bind(*q)
            .bind(*cmup)
            .bind(apres)
            .bind(*p_c)
            .bind(&user.id)
            .execute(&mut *tx)
            .await?;
            magasins.push(json!({ "code_magasin": magasin, "stock_kg": q, "cmup_avant": cmup, "cmup_apres": apres }));
        }
        sqlx::query(
            "INSERT INTO reception_ajustements_cmup
                    (id_reception, code_reference, nature, code_magasin, quantite_recue_kg,
                     stock_kg, montant_mad, id_utilisateur)
             VALUES ($1, $2, 'ECART_PRIX', NULL, $3, $4, $5 / 100.0, $6)",
        )
        .bind(id_reception)
        .bind(code_reference)
        .bind(*recu)
        .bind(q_stock)
        .bind(ecart_c)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;
        if q_stock > 0.0 {
            sqlx::query(
                "UPDATE reference
                    SET cmup_mad = (SELECT round(SUM(sm.quantite_kg * sm.cmup_mad) / SUM(sm.quantite_kg), 4)
                                      FROM stock_magasin sm
                                     WHERE sm.code_reference = $1 AND sm.quantite_kg > 0
                                       AND sm.cmup_mad IS NOT NULL),
                        date_dernier_cmup = $2
                  WHERE code_reference = $1",
            )
            .bind(code_reference)
            .bind(&horodatage)
            .execute(&mut *tx)
            .await?;
        }
        total_stock_c += stock_c;
        total_ecart_c += ecart_c;
        detail.push(json!({
            "code_reference": code_reference,
            "valeur_provisoire_mad": *valeur_c as f64 / 100.0,
            "difference_mad": *part_c as f64 / 100.0,
            "recu_kg": recu,
            "stock_kg": arrondi_kg(q_stock),
            "au_stock_mad": stock_c as f64 / 100.0,
            "ecart_prix_mad": ecart_c as f64 / 100.0,
            "magasins": magasins,
        }));
    }

    sqlx::query(
        "UPDATE reception
            SET statut = 'CLOTURE', numero_facture = $2, montant_facture_mad = $3, frais_facture_mad = $4,
                date_cloture = $5, id_utilisateur_cloture = $6
          WHERE id_reception = $1",
    )
    .bind(id_reception)
    .bind(numero_facture)
    .bind(montant_facture_mad)
    .bind(frais_mad)
    .bind(&horodatage)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    let resultat = json!({
        "id_reception": id_reception,
        "numero_reception": numero,
        "simulation": simuler,
        "valeur_provisoire_mad": provisoire_c as f64 / 100.0,
        "valeur_definitive_mad": definitif_c as f64 / 100.0,
        "difference_mad": difference_c as f64 / 100.0,
        "au_stock_mad": total_stock_c as f64 / 100.0,
        "ecart_prix_mad": total_ecart_c as f64 / 100.0,
        "references": detail,
    });
    if simuler {
        tx.rollback().await?;
    } else {
        tx.commit().await?;
    }
    Ok(resultat)
}

#[cfg(test)]
mod tests {
    use super::repartir_signe;

    #[test]
    fn une_facture_plus_basse_se_repartit_en_negatif() {
        let p = repartir_signe(-1001, &[100, 200, 700]);
        assert_eq!(p.iter().sum::<i64>(), -1001);
        assert!(p.iter().all(|x| *x <= 0));
        assert_eq!(repartir_signe(0, &[1, 2]), vec![0, 0]);
    }
}
