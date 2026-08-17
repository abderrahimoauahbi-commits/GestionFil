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
    #[serde(rename = "ml")]
    Ml,
}

impl Unite {
    pub fn as_str(self) -> &'static str {
        match self {
            Unite::Kg => "kg",
            Unite::Bobine => "Bobine",
            Unite::Palette => "Palette",
            Unite::Ml => "ml",
        }
    }

    pub fn depuis(s: &str) -> Option<Self> {
        match s {
            "kg" => Some(Unite::Kg),
            "Bobine" => Some(Unite::Bobine),
            "Palette" => Some(Unite::Palette),
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
        "SELECT code_reference, unite_catalogue, poids_bobine_kg,
                bobines_par_palette, densite_kg_ml
           FROM reference WHERE code_reference = ?1",
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
    fn quantite_negative_refusee() {
        assert!(ref_pp().vers_kg(-1.0, Unite::Kg).is_err());
        assert!(ref_pp().vers_kg(0.0, Unite::Kg).is_err());
    }
}
