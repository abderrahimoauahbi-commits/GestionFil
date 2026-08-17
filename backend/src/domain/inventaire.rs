//! Inventaire physique (CDC G6).
//!
//! Le trigger J6 du CDC etait inoperant sur deux points :
//!   * `ligne_numero` code en dur a 1 sous contrainte `UNIQUE(id_mouvement,
//!     ligne_numero)` : l'inventaire echouait des le deuxieme ecart ;
//!   * `NEW.date_cloture := NOW()` dans un trigger AFTER, ou l'affectation de
//!     NEW n'a aucun effet : la date de cloture n'etait jamais renseignee.
//!
//! Les ecarts positifs et negatifs sont par ailleurs portes par deux types de
//! mouvement distincts (AJUST_INV_POS / AJUST_INV_NEG) : le type `AJUST_INV`
//! "+/-1" du CDC etait instockable sous `CHECK(signe IN (-1,0,1))`.

use crate::auth::Utilisateur;
use crate::db::{arrondi_kg, arrondi_mad, maintenant, Db};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, FromRow)]
struct LigneEcart {
    id_ligne_inv: String,
    code_reference: String,
    lot_fournisseur: Option<String>,
    ecart_kg: f64,
    cmup_mad: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct ResultatInventaire {
    pub numero_inventaire: String,
    pub lignes_ajustees: usize,
    pub ecart_positif_kg: f64,
    pub ecart_negatif_kg: f64,
    pub impact_valorisation_mad: f64,
    pub mouvements_crees: Vec<String>,
}

/// Prend la photo du stock theorique et ouvre le comptage.
pub async fn ouvrir(db: &Db, user: &Utilisateur, id_inventaire: &str) -> AppResult<i64> {
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let (statut, magasin): (String, String) =
        sqlx::query_as("SELECT statut, code_magasin FROM inventaire WHERE id_inventaire = ?1")
            .bind(id_inventaire)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("inventaire {id_inventaire}")))?;

    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(format!(
            "Seul un inventaire au statut BROUILLON peut etre ouvert (statut actuel : {statut})."
        )));
    }

    // Photo du theorique : un inventaire compte ce que la base croit detenir.
    //
    // Le comptage se fait AU LOT pour les references qui en font l'objet : on
    // compte des bobines portant un numero de bain de teinture, pas un total
    // abstrait. Sans cette distinction, l'ajustement genere ensuite serait un
    // mouvement sans lot, que le suivi de lot refuse.
    let res = sqlx::query(
        "INSERT INTO ligne_inventaire
             (id_inventaire, code_reference, code_magasin, lot_fournisseur, quantite_theorique_kg)
         SELECT ?1, sl.code_reference, sl.code_magasin, sl.lot_fournisseur, sl.quantite_kg
           FROM stock_lot sl
           JOIN reference r ON r.code_reference = sl.code_reference AND r.suivi_lot = 1
          WHERE sl.code_magasin = ?2 AND sl.quantite_kg > 0
         UNION ALL
         SELECT ?1, sm.code_reference, sm.code_magasin, NULL, sm.quantite_kg
           FROM stock_magasin sm
           JOIN reference r ON r.code_reference = sm.code_reference AND r.suivi_lot = 0
          WHERE sm.code_magasin = ?2 AND sm.quantite_kg > 0",
    )
    .bind(id_inventaire)
    .bind(&magasin)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE inventaire SET statut = 'EN_COURS' WHERE id_inventaire = ?1")
        .bind(id_inventaire)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(res.rows_affected() as i64)
}

/// Cloture l'inventaire et genere les mouvements d'ajustement.
pub async fn cloturer(
    db: &Db,
    user: &Utilisateur,
    id_inventaire: &str,
) -> AppResult<ResultatInventaire> {
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let (numero, statut, magasin): (String, String, String) = sqlx::query_as(
        "SELECT numero_inventaire, statut, code_magasin FROM inventaire WHERE id_inventaire = ?1",
    )
    .bind(id_inventaire)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("inventaire {id_inventaire}")))?;

    if statut != "EN_COURS" {
        return Err(AppError::RegleMetier(format!(
            "Seul un inventaire EN_COURS peut etre cloture (statut actuel : {statut})."
        )));
    }

    let non_comptees: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ligne_inventaire
          WHERE id_inventaire = ?1 AND statut_ligne = 'A_TRAITER'",
    )
    .bind(id_inventaire)
    .fetch_one(&mut *tx)
    .await?;

    if non_comptees > 0 {
        return Err(AppError::RegleMetier(format!(
            "{non_comptees} ligne(s) non comptee(s) : cloture impossible."
        )));
    }

    // Un ecart hors tolerance doit etre justifie (CDC G6).
    let injustifiees: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ligne_inventaire
          WHERE id_inventaire = ?1
            AND ecart_pct IS NOT NULL
            AND abs(ecart_pct) > (SELECT CAST(valeur_courante AS REAL) FROM parametre
                                   WHERE code_parametre = 'P_TolerEcartPesee')
            AND (motif_ecart IS NULL OR trim(motif_ecart) = '')",
    )
    .bind(id_inventaire)
    .fetch_one(&mut *tx)
    .await?;

    if injustifiees > 0 {
        return Err(AppError::RegleMetier(format!(
            "{injustifiees} ecart(s) hors tolerance sans motif : justification obligatoire."
        )));
    }

    let ecarts: Vec<LigneEcart> = sqlx::query_as(
        "SELECT li.id_ligne_inv, li.code_reference, li.lot_fournisseur,
                li.ecart_kg, sm.cmup_mad
           FROM ligne_inventaire li
           LEFT JOIN stock_magasin sm ON sm.code_reference = li.code_reference
                                     AND sm.code_magasin   = li.code_magasin
          WHERE li.id_inventaire = ?1
            AND li.ecart_kg IS NOT NULL AND li.ecart_kg <> 0
          ORDER BY li.code_reference",
    )
    .bind(id_inventaire)
    .fetch_all(&mut *tx)
    .await?;

    let horodatage = maintenant();
    let mut mouvements = Vec::new();
    let mut positif = 0.0_f64;
    let mut negatif = 0.0_f64;
    let mut impact = 0.0_f64;

    // Deux mouvements au plus : un pour les excedents, un pour les manquants.
    for (signe, type_mvt, suffixe) in [
        (1.0_f64, "AJUST_INV_POS", "P"),
        (-1.0_f64, "AJUST_INV_NEG", "N"),
    ] {
        let concernees: Vec<&LigneEcart> = ecarts
            .iter()
            .filter(|l| l.ecart_kg.signum() == signe)
            .collect();
        if concernees.is_empty() {
            continue;
        }

        let id_mouvement = uuid::Uuid::new_v4().to_string();
        let numero_mouvement = format!("MVT-INV-{numero}-{suffixe}");

        // `date_mouvement` est volontairement laissee a la valeur par defaut de
        // la colonne : c'est la base qui horodate. Fournir un instant calcule
        // cote Rust le fait comparer, par le trigger C06, au « maintenant » de
        // SQLite — deux horloges et deux troncatures a la milliseconde, donc un
        // refus intermittent pour datation dans le futur.
        sqlx::query(
            "INSERT INTO mouvement
                 (id_mouvement, numero_mouvement, code_type_mvt,
                  code_magasin, code_motif, reference_document, id_utilisateur)
             VALUES (?1, ?2, ?3, ?4, 'INVENTAIRE', ?5, ?6)",
        )
        .bind(&id_mouvement)
        .bind(&numero_mouvement)
        .bind(type_mvt)
        .bind(&magasin)
        .bind(&numero)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;

        // Numerotation sequentielle : c'est precisement ce que le trigger J6 du
        // CDC ne faisait pas (valeur 1 codee en dur).
        for (i, l) in concernees.iter().enumerate() {
            let quantite = arrondi_kg(l.ecart_kg.abs());

            sqlx::query(
                "INSERT INTO ligne_mouvement
                     (id_mouvement, ligne_numero, code_reference, quantite_kg,
                      lot_fournisseur, code_motif_ligne)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'R6')",
            )
            .bind(&id_mouvement)
            .bind((i + 1) as i64)
            .bind(&l.code_reference)
            .bind(quantite)
            .bind(&l.lot_fournisseur)
            .execute(&mut *tx)
            .await?;

            let valeur = arrondi_mad(l.ecart_kg * l.cmup_mad.unwrap_or(0.0));
            impact += valeur;
            if signe > 0.0 {
                positif += quantite;
            } else {
                negatif += quantite;
            }

            sqlx::query(
                "UPDATE ligne_inventaire
                    SET statut_ligne = 'AJUSTE', ecart_mad = ?2
                  WHERE id_ligne_inv = ?1",
            )
            .bind(&l.id_ligne_inv)
            .bind(valeur)
            .execute(&mut *tx)
            .await?;
        }

        mouvements.push(numero_mouvement);
    }

    sqlx::query(
        "UPDATE stock_magasin SET date_dernier_inventaire = ?2 WHERE code_magasin = ?1",
    )
    .bind(&magasin)
    .bind(&horodatage)
    .execute(&mut *tx)
    .await?;

    // date_cloture est renseignee explicitement : le CHECK de la table l'exige,
    // et le trigger AFTER du CDC ne pouvait pas le faire.
    sqlx::query(
        "UPDATE inventaire SET statut = 'CLOTURE', date_cloture = ?2 WHERE id_inventaire = ?1",
    )
    .bind(id_inventaire)
    .bind(&horodatage)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(ResultatInventaire {
        numero_inventaire: numero,
        lignes_ajustees: ecarts.len(),
        ecart_positif_kg: arrondi_kg(positif),
        ecart_negatif_kg: arrondi_kg(negatif),
        impact_valorisation_mad: arrondi_mad(impact),
        mouvements_crees: mouvements,
    })
}
