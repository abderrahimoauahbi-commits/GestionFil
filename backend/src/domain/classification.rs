//! Classification ABC / XYZ (CDC F6).
//!
//! ABC : cumul de la valeur de consommation annuelle (80 % / 95 %).
//! XYZ : coefficient de variation de la consommation sur les 12 DERNIERS MOIS
//!       GLISSANTS — c'est la correction N4 du 11/06/2026, que le CDC enonce
//!       mais que ses vues n'appliquaient pas (elles agregeaient par numero de
//!       mois, toutes annees confondues).

use crate::auth::Utilisateur;
use crate::db::{maintenant, Db};
use crate::error::AppResult;
use serde::Serialize;
use sqlx::FromRow;
use std::collections::HashMap;

#[derive(Debug, FromRow)]
struct ConsoAnnuelle {
    code_reference: String,
    valeur_mad: f64,
}

#[derive(Debug, FromRow)]
struct ConsoMensuelle {
    code_reference: String,
    #[allow(dead_code)]
    mois: String,
    quantite_kg: f64,
}

#[derive(Debug, Serialize)]
pub struct ResultatClassification {
    pub references_classees: usize,
    pub classe_a: usize,
    pub classe_b: usize,
    pub classe_c: usize,
    pub classe_x: usize,
    pub classe_y: usize,
    pub classe_z: usize,
    pub sans_historique: usize,
}

pub async fn classifier(db: &Db, user: &Utilisateur) -> AppResult<ResultatClassification> {
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let seuil_a: f64 = lire_param(&mut tx, "P_SeuilABCA").await?;
    let seuil_b: f64 = lire_param(&mut tx, "P_SeuilABCB").await?;
    let seuil_x: f64 = lire_param(&mut tx, "P_SeuilXYZ_X").await?;
    let seuil_y: f64 = lire_param(&mut tx, "P_SeuilXYZ_Y").await?;

    // ---- ABC : valeur de consommation annuelle ------------------------------
    //
    // DEUX CORRECTIONS PAR RAPPORT A LA PREMIERE VERSION, toutes deux constatees
    // en confrontant le resultat au classeur.
    //
    // LE REPLI SUR LE BESOIN PLANIFIE. La version precedente ne lisait que les
    // sorties reelles du grand livre. Tant que la production n'y ecrit pas, la
    // requete ne rend rien et la classification annonce « 124 references sans
    // historique » — ce qu'elle a fait pendant des mois sans que personne
    // s'en apercoive, les colonnes restant a NULL.
    //
    // Le reste de l'ERP applique deja la bonne regle : `v_stock_projete` retient
    // le MAXIMUM entre consommation constatee et besoin planifie. Une reference
    // qu'on n'a pas encore consommee mais que le plan reclame n'est pas une
    // reference sans demande. On reprend donc `conso_mensuelle_kg` de cette vue
    // plutot que de refaire un calcul qui divergerait du sien.
    //
    // LA CONVERSION DE DEVISE. `prix_catalogue_kg` ne convertit que l'UNITE, pas
    // la monnaie : pour 107 references sur 119 il porte des dollars. Le
    // multiplier par une quantite donnait une « valeur MAD » neuf fois trop
    // basse, et faussait le rang de toute reference sans CMUP.
    let mut consos: Vec<ConsoAnnuelle> = sqlx::query_as(
        "SELECT sp.code_reference,
                sp.conso_mensuelle_kg * 12
                  * COALESCE(r.cmup_mad,
                             r.prix_catalogue_kg * COALESCE(
                                 (SELECT tc.taux FROM taux_change tc
                                   WHERE tc.code_devise = r.code_devise_catalogue
                                     AND date('now') BETWEEN tc.date_debut
                                                         AND COALESCE(tc.date_fin, '9999-12-31')
                                   LIMIT 1), 1.0),
                             0) AS valeur_mad
           FROM v_stock_projete sp
           JOIN reference r ON r.code_reference = sp.code_reference
          WHERE sp.conso_mensuelle_kg IS NOT NULL
          ORDER BY valeur_mad DESC",
    )
    .fetch_all(&mut *tx)
    .await?;

    consos.retain(|c| c.valeur_mad > 0.0);
    let total: f64 = consos.iter().map(|c| c.valeur_mad).sum();

    let mut classes_abc: HashMap<String, &str> = HashMap::new();
    let mut cumul = 0.0_f64;
    let (mut na, mut nb, mut nc) = (0usize, 0usize, 0usize);

    for c in &consos {
        cumul += c.valeur_mad;
        let pct = if total > 0.0 { cumul / total * 100.0 } else { 100.0 };
        let classe = if pct <= seuil_a {
            na += 1;
            "A"
        } else if pct <= seuil_b {
            nb += 1;
            "B"
        } else {
            nc += 1;
            "C"
        };
        classes_abc.insert(c.code_reference.clone(), classe);
    }

    // ---- XYZ : coefficient de variation sur 12 mois glissants ---------------
    // Meme repli pour la regularite : les sorties reelles quand il y en a, le
    // besoin planifie sinon. UNION ALL puis MAX par mois — une reference qui a
    // les deux garde la plus forte des deux valeurs, comme pour la moyenne.
    let mensuelles: Vec<ConsoMensuelle> = sqlx::query_as(
        "SELECT code_reference, mois, MAX(quantite_kg) AS quantite_kg
           FROM (
             SELECT lm.code_reference,
                    strftime('%Y-%m', m.date_mouvement) AS mois,
                    SUM(lm.quantite_kg)                 AS quantite_kg
               FROM ligne_mouvement lm
               JOIN mouvement      m  ON m.id_mouvement   = lm.id_mouvement
               JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
              WHERE tm.signe = -1
                AND m.code_type_mvt = 'SORTIE_PROD'
                AND m.date_mouvement >= datetime('now','-12 months')
              GROUP BY lm.code_reference, mois
             UNION ALL
             SELECT bm.code_reference, bm.annee_mois, SUM(bm.quantite_kg)
               FROM besoin_mrp bm
               JOIN plan_production pp ON pp.id_plan = bm.id_plan
                                      AND pp.statut  = 'EN_COURS'
              GROUP BY bm.code_reference, bm.annee_mois
           )
          GROUP BY code_reference, mois",
    )
    .fetch_all(&mut *tx)
    .await?;

    let mut series: HashMap<String, Vec<f64>> = HashMap::new();
    for c in mensuelles {
        series.entry(c.code_reference).or_default().push(c.quantite_kg);
    }

    let mut classes_xyz: HashMap<String, &str> = HashMap::new();
    let (mut nx, mut ny, mut nz) = (0usize, 0usize, 0usize);

    for (code, valeurs) in &series {
        // Les mois sans sortie comptent comme zero : c'est ce qui distingue une
        // consommation reguliere d'une consommation erratique.
        let mut serie = valeurs.clone();
        serie.resize(12, 0.0);

        if let Some(cv) = coefficient_variation(&serie) {
            let classe = if cv < seuil_x {
                nx += 1;
                "X"
            } else if cv < seuil_y {
                ny += 1;
                "Y"
            } else {
                nz += 1;
                "Z"
            };
            classes_xyz.insert(code.clone(), classe);
        }
    }

    // ---- Ecriture -----------------------------------------------------------
    let horodatage = maintenant();
    let references: Vec<String> =
        sqlx::query_scalar("SELECT code_reference FROM reference WHERE actif = 1")
            .fetch_all(&mut *tx)
            .await?;

    let mut sans_historique = 0usize;
    for code in &references {
        // Une reference sans aucune consommation est classee C, pas laissee
        // vide. Elle est au bas du Pareto par definition — c'est zero pour cent
        // de la valeur consommee — et le dire permet aux ecrans de couvrir tout
        // le catalogue. Laisser NULL forcait chaque graphique a inventer une
        // categorie « non classe » qui ne veut rien dire pour l'acheteur.
        // `sans_historique` continue de compter ces references a part : le
        // chiffre reste lisible dans le compte rendu.
        let abc = classes_abc.get(code).copied().or(Some("C"));
        let xyz = classes_xyz.get(code).copied();
        if !classes_abc.contains_key(code) {
            sans_historique += 1;
            nc += 1;
        }
        sqlx::query(
            "UPDATE reference
                SET classe_abc = ?2, classe_xyz = ?3, date_dernier_abc = ?4
              WHERE code_reference = ?1",
        )
        .bind(code)
        .bind(abc)
        .bind(xyz)
        .bind(&horodatage)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    Ok(ResultatClassification {
        references_classees: references.len(),
        classe_a: na,
        classe_b: nb,
        classe_c: nc,
        classe_x: nx,
        classe_y: ny,
        classe_z: nz,
        sans_historique,
    })
}

async fn lire_param(tx: &mut sqlx::SqliteConnection, code: &str) -> AppResult<f64> {
    let v: String =
        sqlx::query_scalar("SELECT valeur_courante FROM parametre WHERE code_parametre = ?1")
            .bind(code)
            .fetch_one(&mut *tx)
            .await?;
    Ok(v.parse().unwrap_or(0.0))
}

/// Ecart-type / moyenne. `None` si la moyenne est nulle (aucune consommation).
fn coefficient_variation(serie: &[f64]) -> Option<f64> {
    if serie.is_empty() {
        return None;
    }
    let n = serie.len() as f64;
    let moyenne = serie.iter().sum::<f64>() / n;
    if moyenne <= 0.0 {
        return None;
    }
    let variance = serie.iter().map(|v| (v - moyenne).powi(2)).sum::<f64>() / n;
    Some(variance.sqrt() / moyenne)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consommation_parfaitement_stable() {
        let cv = coefficient_variation(&[100.0; 12]).unwrap();
        assert!(cv.abs() < 1e-9, "CV attendu nul, obtenu {cv}");
    }

    #[test]
    fn consommation_erratique() {
        let mut serie = vec![0.0; 12];
        serie[0] = 1200.0; // tout consomme en un seul mois
        let cv = coefficient_variation(&serie).unwrap();
        assert!(cv > 0.5, "serie erratique attendue en classe Z, CV = {cv}");
    }

    #[test]
    fn serie_vide_ou_nulle() {
        assert!(coefficient_variation(&[]).is_none());
        assert!(coefficient_variation(&[0.0; 12]).is_none());
    }
}
