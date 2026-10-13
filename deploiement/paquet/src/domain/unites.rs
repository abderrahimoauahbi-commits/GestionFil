//! Conversion vers l'unite canonique : le kilogramme (CDC R01 / B2).
//!
//! Regle absolue : si le facteur de conversion est absent, la saisie est
//! REFUSEE. Jamais de repli silencieux sur un facteur de 1 — c'est la
//! discipline la plus importante du cahier des charges, et celle dont la
//! violation serait la plus difficile a detecter apres coup.
//!
//! Le facteur est aussi calcule en base (`reference.facteur_kg`, colonne
//! generee) : cette implementation sert a valider une saisie avant ecriture et
//! a produire un message clair.

// Ces conversions sont exercees par les tests unitaires de ce module et seront
// consommees par les endpoints de saisie (creation de mouvement, de ligne de BC,
// de ligne de reception), qui restent a ecrire.
#![allow(dead_code)]

use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Unite {
    #[serde(rename = "kg")]
    Kg,
    #[serde(rename = "Bobine")]
    Bobine,
    #[serde(rename = "Palette")]
    Palette,
    /// LE LOT EST UNE UNITE D'ACHAT, pas une unite de stock. Le fournisseur
    /// turc produit par bains de 1344 bobines — parfois 1400, 1688, 1720 selon
    /// l'article. Le lot arrive et se defait ; il ne circule pas entre magasins.
    #[serde(rename = "Lot")]
    Lot,
    #[serde(rename = "ml")]
    Ml,
}

impl Unite {
    pub fn as_str(self) -> &'static str {
        match self {
            Unite::Kg => "kg",
            Unite::Bobine => "Bobine",
            Unite::Palette => "Palette",
            Unite::Lot => "Lot",
            Unite::Ml => "ml",
        }
    }

    pub fn depuis(s: &str) -> Option<Self> {
        match s {
            "kg" => Some(Unite::Kg),
            "Bobine" => Some(Unite::Bobine),
            "Palette" => Some(Unite::Palette),
            "Lot" => Some(Unite::Lot),
            "ml" => Some(Unite::Ml),
            _ => None,
        }
    }
}

/// Facteurs de conversion d'une reference du catalogue.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct FacteursReference {
    pub code_reference: String,
    pub unite_catalogue: String,
    pub poids_bobine_kg: Option<f64>,
    pub bobines_par_palette: Option<i64>,
    pub bobines_par_lot: Option<i64>,
    pub densite_kg_ml: Option<f64>,
}

impl FacteursReference {
    /// Facteur multiplicateur vers le kg pour l'unite demandee.
    pub fn facteur(&self, unite: Unite) -> AppResult<f64> {
        match unite {
            Unite::Kg => Ok(1.0),
            Unite::Bobine => self.poids_bobine_kg.filter(|v| *v > 0.0).ok_or_else(|| {
                AppError::RegleMetier(format!(
                    "R01 : poids_bobine_kg absent sur {} — saisie en bobines refusee.",
                    self.code_reference
                ))
            }),
            Unite::Palette => {
                let poids = self.poids_bobine_kg.filter(|v| *v > 0.0);
                let nb = self.bobines_par_palette.filter(|v| *v > 0);
                match (poids, nb) {
                    (Some(p), Some(n)) => Ok(p * n as f64),
                    _ => Err(AppError::RegleMetier(format!(
                        "R01 : poids_bobine_kg et/ou bobines_par_palette absents sur {} — saisie en palettes refusee.",
                        self.code_reference
                    ))),
                }
            }
            Unite::Lot => {
                let poids = self.poids_bobine_kg.filter(|v| *v > 0.0);
                let nb = self.bobines_par_lot.filter(|v| *v > 0);
                match (poids, nb) {
                    (Some(p), Some(n)) => Ok(p * n as f64),
                    _ => Err(AppError::RegleMetier(format!(
                        "R01 : poids_bobine_kg et/ou bobines_par_lot absents sur {} — saisie au lot refusee.",
                        self.code_reference
                    ))),
                }
            }
            Unite::Ml => self.densite_kg_ml.filter(|v| *v > 0.0).ok_or_else(|| {
                AppError::RegleMetier(format!(
                    "R01 : densite_kg_ml absente sur {} — saisie en metres lineaires refusee.",
                    self.code_reference
                ))
            }),
        }
    }

    /// Convertit une quantite saisie vers le kg.
    pub fn vers_kg(&self, quantite: f64, unite: Unite) -> AppResult<f64> {
        if quantite <= 0.0 {
            return Err(AppError::Invalide(
                "la quantite saisie doit etre strictement positive".into(),
            ));
        }
        Ok(crate::db::arrondi_kg(quantite * self.facteur(unite)?))
    }
}

pub async fn charger(db: &Db, code_reference: &str) -> AppResult<FacteursReference> {
    sqlx::query_as(
        // LES CASTS `::float8` NE SONT PAS COSMETIQUES. Les colonnes sont
        // `numeric` en PostgreSQL — le type juste pour un poids, qui ne doit
        // pas deriver a l'arrondi binaire. sqlx refuse de les decoder vers
        // `f64` sans conversion explicite, et l'echec ne se voit qu'a
        // l'execution : la saisie en palettes tombait en « erreur interne »,
        // sans un mot sur la cause.
        "SELECT code_reference, unite_catalogue,
                poids_bobine_kg::float8    AS poids_bobine_kg,
                bobines_par_palette,
                bobines_par_lot,
                densite_kg_ml::float8      AS densite_kg_ml
           FROM reference WHERE code_reference = $1",
    )
    .bind(code_reference)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("reference {code_reference}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ref_pp() -> FacteursReference {
        FacteursReference {
            code_reference: "PP-3430".into(),
            unite_catalogue: "Bobine".into(),
            poids_bobine_kg: Some(3.2),
            bobines_par_palette: Some(240),
            bobines_par_lot: Some(1344),
            densite_kg_ml: None,
        }
    }

    #[test]
    fn conversions_nominales() {
        let r = ref_pp();
        assert_eq!(r.facteur(Unite::Kg).unwrap(), 1.0);
        assert_eq!(r.facteur(Unite::Bobine).unwrap(), 3.2);
        // Exemple F1 du CDC : 3.2 x 240 = 768 kg/palette, 10 palettes = 7680 kg.
        assert_eq!(r.facteur(Unite::Palette).unwrap(), 768.0);
        assert_eq!(r.vers_kg(10.0, Unite::Palette).unwrap(), 7680.0);
    }

    #[test]
    fn facteur_manquant_refuse_sans_repli() {
        let r = ref_pp();
        // densite_kg_ml absente : la saisie en ml doit etre REFUSEE, et surtout
        // pas retomber sur un facteur de 1.
        let err = r.facteur(Unite::Ml).unwrap_err();
        assert!(matches!(err, AppError::RegleMetier(_)));
        assert!(err.to_string().contains("densite_kg_ml"));
    }

    #[test]
    fn palette_incomplete_refusee() {
        let mut r = ref_pp();
        r.bobines_par_palette = None;
        assert!(r.facteur(Unite::Palette).is_err());
        // La conversion en bobines reste possible : seule la palette est bloquee.
        assert_eq!(r.facteur(Unite::Bobine).unwrap(), 3.2);
    }

    #[test]
    fn le_lot_se_convertit_et_se_refuse_sans_facteur() {
        let r = ref_pp();
        // 3,2 kg par bobine x 1344 bobines = 4300,8 kg le lot.
        assert_eq!(r.facteur(Unite::Lot).unwrap(), 3.2 * 1344.0);
        assert_eq!(r.vers_kg(2.0, Unite::Lot).unwrap(), 8601.6);

        // Sans `bobines_par_lot`, la saisie au lot est REFUSEE — jamais un
        // repli sur la palette, qui produirait un bon de commande six fois
        // trop petit sans que rien ne le signale.
        let mut sans = ref_pp();
        sans.bobines_par_lot = None;
        let err = sans.facteur(Unite::Lot).unwrap_err();
        assert!(err.to_string().contains("bobines_par_lot"));
        assert_eq!(sans.facteur(Unite::Palette).unwrap(), 768.0);
    }

    #[test]
    fn quantite_negative_refusee() {
        assert!(ref_pp().vers_kg(-1.0, Unite::Kg).is_err());
        assert!(ref_pp().vers_kg(0.0, Unite::Kg).is_err());
    }
}
