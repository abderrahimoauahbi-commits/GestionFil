//! Classification ABC / XYZ (CDC F6).
//!
//! ABC : cumul de la valeur de consommation annuelle (80 % / 95 %).
//! XYZ : coefficient de variation de la consommation sur les 12 DERNIERS MOIS
//!       GLISSANTS — c'est la correction N4 du 11/06/2026, que le CDC enonce
//!       mais que ses vues n'appliquaient pas (elles agregeaient par numero de
//!       mois, toutes annees confondues).
//!
//! 27/10/2026 : ABC et XYZ lisent la MEME source, le grand livre de la
//! consommation, sur la MEME fenetre (12 mois pleins glissants), rebut compris ;
//! le plan n'y entre plus (« deux chiffres separes »).

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

    // ---- ABC : la valeur REELLE des 12 mois pleins ---------------------------
    //
    // LE REEL CORRIGE (decisions du 27/10/2026, Q1, Q2, Q5, Q6, Q11). La valeur
    // annuelle est celle du GRAND LIVRE DE LA CONSOMMATION (`v_consommation_fait`,
    // agrege par `v_conso_reelle`) : les 12 MOIS PLEINS glissants (les 12 mois
    // calendaires complets avant le mois en cours), consommation machine datee au
    // jour de la FICHE, consommation directe et hors machine, REBUT COMPRIS,
    // retours deduits, corrections et ajustements HORS reel ; valorisee au livre
    // (prix de sortie du mouvement ; un fait machine au CMUP du jour du fait).
    //
    // LE « PLUS GRAND DES DEUX » EST SUPPRIME. L'ABC lisait `v_conso_retenue`,
    // max(reel, plan moyen) : une reference que le plan reclame mais qu'on n'a pas
    // consommee prenait le poids du plan, et une consommation machine datee au jour
    // de validation pesait vingt-neuf mois en un. Le plan regarde l'avenir (moteur
    // de couverture) ; l'ABC constate le passe. Une reference sans consommation
    // reelle sur la fenetre est rangee en C (zero pour cent de la depense).
    let consos: Vec<ConsoAnnuelle> = sqlx::query_as(
        "SELECT c.code_reference, c.valeur_12m_mad::float8 AS valeur_mad
           FROM v_conso_reelle c
           JOIN reference r ON r.code_reference = c.code_reference AND r.actif = 1
          WHERE c.valeur_12m_mad > 0
          ORDER BY c.valeur_12m_mad DESC, c.code_reference",
    )
    .fetch_all(&mut *tx)
    .await?;

    let valeurs: Vec<(String, f64)> = consos.into_iter().map(|c| (c.code_reference, c.valeur_mad)).collect();
    let (classes_abc, (na, nb, mut nc)) = classer_abc(&valeurs, seuil_a, seuil_b);

    // ---- XYZ : coefficient de variation, MEME SOURCE ET MEME FENETRE ----------
    // Les 12 mois pleins du grand livre (`v_conso_reelle_mois`, reel d'achat :
    // machine comprise, rebut compris, retours deduits). Le plan n'y entre plus :
    // la regularite se mesure sur ce qui a ete consomme.
    let mensuelles: Vec<ConsoMensuelle> = sqlx::query_as(
        "SELECT code_reference, mois, kg_reel::float8 AS quantite_kg
           FROM v_conso_reelle_mois",
    )
    .fetch_all(&mut *tx)
    .await?;

    let mut series: HashMap<String, Vec<f64>> = HashMap::new();
    for c in mensuelles {
        series.entry(c.code_reference).or_default().push(c.quantite_kg);
    }

    let mut classes_xyz: HashMap<String, &str> = HashMap::new();
    // LE CV EST CONSERVÉ (décision du 30/10/2026, § 16) : l'onglet Risques du
    // stock projeté l'affiche à côté de la classe qu'il fixe.
    let mut cvs: HashMap<String, f64> = HashMap::new();
    let (mut nx, mut ny, mut nz) = (0usize, 0usize, 0usize);

    for (code, valeurs) in &series {
        if let Some(cv) = cv_sur_12_mois(valeurs) {
            cvs.insert(code.clone(), cv);
        }
        if let Some(classe) = classe_xyz(valeurs, seuil_x, seuil_y) {
            match classe {
                "X" => nx += 1,
                "Y" => ny += 1,
                _ => nz += 1,
            }
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
                SET classe_abc = $2, classe_xyz = $3, date_dernier_abc = fn_instant($4),
                    coef_variation_xyz = ROUND($5::numeric, 4)
              WHERE code_reference = $1",
        )
        .bind(code)
        .bind(abc)
        .bind(xyz)
        .bind(&horodatage)
        .bind(cvs.get(code).copied())
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

async fn lire_param(tx: &mut sqlx::PgConnection, code: &str) -> AppResult<f64> {
    // La base convertit deja en float8 : le lire comme texte faisait echouer le
    // decodage, et avec lui toute la classification.
    let v: f64 = sqlx::query_scalar(
        "SELECT valeur_courante::float8 FROM parametre WHERE code_parametre = $1",
    )
    .bind(code)
    .fetch_one(&mut *tx)
    .await?;
    Ok(v)
}

/// Le classement ABC par cumul de valeur : les references triees de la plus forte
/// a la plus faible ; A jusqu'a `seuil_a` % du total cumule, B jusqu'a `seuil_b` %,
/// C au-dela. Une valeur nulle ou negative n'est pas classee. Rend les classes et
/// les effectifs (A, B, C).
pub fn classer_abc(
    valeurs: &[(String, f64)],
    seuil_a: f64,
    seuil_b: f64,
) -> (HashMap<String, &'static str>, (usize, usize, usize)) {
    let mut triees: Vec<&(String, f64)> = valeurs.iter().filter(|(_, v)| *v > 0.0).collect();
    triees.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let total: f64 = triees.iter().map(|(_, v)| v).sum();
    let mut classes = HashMap::new();
    let (mut na, mut nb, mut nc) = (0usize, 0usize, 0usize);
    let mut cumul = 0.0_f64;
    for (code, v) in triees {
        cumul += v;
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
        classes.insert(code.clone(), classe);
    }
    (classes, (na, nb, nc))
}

/// La classe XYZ d'une serie mensuelle sur les 12 mois pleins : les mois absents
/// (sans consommation) comptent pour zero — c'est ce qui distingue une
/// consommation reguliere d'une consommation erratique. `None` sans consommation.
pub fn classe_xyz(mois: &[f64], seuil_x: f64, seuil_y: f64) -> Option<&'static str> {
    cv_sur_12_mois(mois).map(|cv| {
        if cv < seuil_x {
            "X"
        } else if cv < seuil_y {
            "Y"
        } else {
            "Z"
        }
    })
}

/// Le coefficient de variation d'une serie mensuelle sur les 12 mois pleins, les
/// mois absents comptant pour zero (celui qui fixe la classe XYZ).
pub fn cv_sur_12_mois(mois: &[f64]) -> Option<f64> {
    let mut serie = mois.to_vec();
    serie.resize(serie.len().max(12), 0.0);
    coefficient_variation(&serie)
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
    fn abc_par_cumul_de_valeur() {
        let v = vec![
            ("a".to_string(), 700.0),
            ("b".to_string(), 200.0),
            ("c".to_string(), 60.0),
            ("d".to_string(), 40.0),
            ("zero".to_string(), 0.0),
        ];
        let (classes, (na, nb, nc)) = classer_abc(&v, 80.0, 95.0);
        // 70 % -> A ; 90 % -> B ; 96 % et 100 % -> C ; la valeur nulle n'est pas classee.
        assert_eq!(classes.get("a"), Some(&"A"));
        assert_eq!(classes.get("b"), Some(&"B"));
        assert_eq!(classes.get("c"), Some(&"C"));
        assert_eq!(classes.get("d"), Some(&"C"));
        assert_eq!(classes.get("zero"), None);
        assert_eq!((na, nb, nc), (1, 1, 2));
    }

    #[test]
    fn xyz_sur_douze_mois_pleins_mois_vides_a_zero() {
        // Douze mois egaux : X.
        assert_eq!(classe_xyz(&[100.0; 12], 0.25, 0.5), Some("X"));
        // Six mois a 100, six mois sans consommation : CV = 1 -> Z.
        assert_eq!(classe_xyz(&[100.0; 6], 0.25, 0.5), Some("Z"));
        // Aucune consommation : pas de classe.
        assert_eq!(classe_xyz(&[], 0.25, 0.5), None);
        // Un retour qui annule la sortie du mois : moyenne nulle, pas de classe.
        assert_eq!(classe_xyz(&[0.0, 0.0], 0.25, 0.5), None);
    }

    #[test]
    fn serie_vide_ou_nulle() {
        assert!(coefficient_variation(&[]).is_none());
        assert!(coefficient_variation(&[0.0; 12]).is_none());
    }
}
