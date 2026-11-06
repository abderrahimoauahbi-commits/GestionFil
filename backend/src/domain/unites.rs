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

    /// LE CONDITIONNEMENT DU LOT PRIME SUR LA FICHE ARTICLE (23/10/2026) : le
    /// poids d'une bobine et les bobines par palette varient d'un lot a l'autre.
    /// Un facteur que le lot ne porte pas reste celui de la fiche ; aucun des
    /// deux : la conversion est refusee, jamais un repli sur 1. Meme regle en
    /// base (`fn_lot_poids_bobine`, `fn_lot_bobines_palette`) et a l'ecran
    /// (`conditionnementDuLot`).
    pub fn avec_lot(mut self, poids_lot: Option<f64>, bobines_palette_lot: Option<i64>) -> Self {
        if let Some(p) = poids_lot.filter(|p| *p > 0.0) {
            self.poids_bobine_kg = Some(p);
        }
        if let Some(n) = bobines_palette_lot.filter(|n| *n > 0) {
            self.bobines_par_palette = Some(n);
        }
        self
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

/// Les facteurs d'une reference POUR UN LOT : ceux du lot, sinon ceux de la
/// fiche article (23/10/2026). Sans lot, la fiche article seule.
pub async fn charger_pour_lot(db: &Db, code_reference: &str, lot: Option<&str>) -> AppResult<FacteursReference> {
    charger_pour_derive(db, code_reference, lot, None).await
}

/// LE CONDITIONNEMENT DU DÉRIVÉ (06/11/2026) : la forme physique choisie dans le
/// lot (fût de 600 kg ou de 1000 kg du même lot). Sans dérivé : D1, celui
/// d'origine, qui suit le lot tant qu'il est seul. Une valeur absente du dérivé
/// reprend celle du lot, puis de la fiche article — jamais un facteur 1.
pub async fn charger_pour_derive(
    db: &Db,
    code_reference: &str,
    lot: Option<&str>,
    derive: Option<&str>,
) -> AppResult<FacteursReference> {
    let facteurs = charger(db, code_reference).await?;
    let Some(lot) = lot.map(str::trim).filter(|l| !l.is_empty()) else {
        return Ok(facteurs);
    };
    let derive = derive.map(str::trim).filter(|d| !d.is_empty());
    let du_lot: Option<(Option<f64>, Option<i64>, Option<f64>, Option<i64>)> = sqlx::query_as(
        "SELECT l.poids_bobine_kg::float8, l.bobines_par_palette,
                d.poids_unitaire_kg::float8, d.unites_par_palette
           FROM lot l
           LEFT JOIN lot_derive d ON d.code_reference = l.code_reference
                                 AND d.lot_fournisseur = l.lot_fournisseur
                                 AND d.code_derive = $3
          WHERE l.code_reference = $1 AND l.lot_fournisseur = $2",
    )
    .bind(code_reference)
    .bind(lot)
    .bind(derive)
    .fetch_optional(db)
    .await?;
    Ok(match du_lot {
        Some((p, n, dp, dn)) => facteurs.avec_lot(dp.or(p), dn.or(n)),
        None => facteurs,
    })
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
    fn le_lot_prime_sur_la_fiche_article() {
        // Le lot pese 3,0729 kg la bobine (fiche : 3,2) et tient 200 bobines par
        // palette (fiche : 240) : 2 palettes = 2 x 200 x 3,0729 = 1 229,16 kg.
        let r = ref_pp().avec_lot(Some(3.0729), Some(200));
        assert_eq!(r.facteur(Unite::Bobine).unwrap(), 3.0729);
        assert_eq!(r.vers_kg(2.0, Unite::Palette).unwrap(), 1229.16);
        // Un facteur que le lot ne porte pas reste celui de la fiche.
        let r = ref_pp().avec_lot(None, Some(200));
        assert_eq!(r.facteur(Unite::Bobine).unwrap(), 3.2);
        assert_eq!(r.facteur(Unite::Palette).unwrap(), 640.0);
        // Ni le lot ni la fiche : refus, jamais un facteur 1.
        let mut sans = ref_pp();
        sans.poids_bobine_kg = None;
        let sans = sans.avec_lot(None, None);
        assert!(sans.facteur(Unite::Bobine).is_err());
        // Un zero du lot n'est pas un facteur.
        assert_eq!(ref_pp().avec_lot(Some(0.0), Some(0)).facteur(Unite::Palette).unwrap(), 768.0);
    }

    #[test]
    fn quantite_negative_refusee() {
        assert!(ref_pp().vers_kg(-1.0, Unite::Kg).is_err());
        assert!(ref_pp().vers_kg(0.0, Unite::Kg).is_err());
    }
}
