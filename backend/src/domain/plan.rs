//! Deploiement d'un plan de production sur une periode glissante.
//!
//! Reprend la formule de la feuille `📊 Production_Plan` du classeur
//! GESTION FIL.xlsx (cellule C26, matricielle sur toute la grille) :
//!
//! ```text
//! m2(qualite, mois k) = ARRONDI(
//!        base_mensuelle(qualite)                       <- colonne B
//!      x coef_saisonnalite[mois calendaire][qualite]   <- grille B10:S21
//!      x (1 + croissance_annuelle)^(k / 12)            <- cellule B6
//!    , 0)
//! ```
//!
//! ou `k` est le rang du mois dans la periode (0 pour le mois de depart M0).
//! Le classeur calcule `k` par `(YEAR(mois)-YEAR(M0))*12 + (MONTH(mois)-MONTH(M0))`,
//! ce qui revient exactement au rang de la colonne.
//!
//! Deux points que le classeur laissait implicites, et qui sont ici explicites :
//!
//!   * la saisonnalite est indexee sur le mois CALENDAIRE, pas sur le rang :
//!     decembre reste un mois haut, que la periode demarre en janvier ou en aout ;
//!   * la croissance s'applique au prorata des mois ecoules, pas par paliers
//!     annuels — c'est bien `^(k/12)` et non `^(k div 12)`.

use chrono::{Datelike, NaiveDate};

/// Une qualite retenue par le plan, avec sa base mensuelle.
#[derive(Debug, Clone)]
pub struct BaseQualite {
    pub code_qualite: String,
    pub m2_base_mensuel: f64,
}

/// Une case de la grille deployee.
#[derive(Debug, Clone, PartialEq)]
pub struct CaseP1an {
    /// Rang dans la periode : 0 = mois de depart.
    pub rang: i64,
    /// Mois calendaire, 1..12.
    pub mois: u32,
    /// Mois date, au format AAAA-MM.
    pub annee_mois: String,
    pub code_qualite: String,
    pub m2_base_mensuel: f64,
    pub saisonnalite: f64,
    pub facteur_croissance: f64,
    pub m2_prevus: f64,
}

/// Premier jour du mois `n` mois apres `depart`.
///
/// Chronologie a la main plutot que par ajout de jours : ajouter 30 jours douze
/// fois ne retombe pas sur le meme mois, et le classeur raisonne bien en mois
/// calendaires (EDATE).
pub fn mois_decale(depart: NaiveDate, n: i64) -> NaiveDate {
    let total = depart.year() as i64 * 12 + (depart.month() as i64 - 1) + n;
    let annee = total.div_euclid(12) as i32;
    let mois = total.rem_euclid(12) as u32 + 1;
    NaiveDate::from_ymd_opt(annee, mois, 1).expect("mois calendaire valide")
}

/// Dernier jour du mois de `date`.
pub fn fin_de_mois(date: NaiveDate) -> NaiveDate {
    mois_decale(date, 1).pred_opt().expect("jour precedent valide")
}

/// Deploie la grille du plan.
///
/// `coefficient` renvoie le coefficient de saisonnalite du couple
/// (qualite, mois calendaire). Un couple non renseigne vaut 1,0 : une
/// saisonnalite absente ne doit pas annuler la production, seulement la laisser
/// a son niveau de base.
pub fn deployer(
    depart: NaiveDate,
    mois_horizon: i64,
    croissance_annuelle_pct: f64,
    bases: &[BaseQualite],
    coefficient: impl Fn(&str, u32) -> Option<f64>,
) -> Vec<CaseP1an> {
    let mut cases = Vec::with_capacity((mois_horizon as usize) * bases.len());
    let taux = 1.0 + croissance_annuelle_pct / 100.0;

    for rang in 0..mois_horizon {
        let date = mois_decale(depart, rang);
        let mois = date.month();
        let facteur = taux.powf(rang as f64 / 12.0);

        for base in bases {
            let coef = coefficient(&base.code_qualite, mois).unwrap_or(1.0);
            let m2 = (base.m2_base_mensuel * coef * facteur).round();
            cases.push(CaseP1an {
                rang,
                mois,
                annee_mois: format!("{:04}-{:02}", date.year(), mois),
                code_qualite: base.code_qualite.clone(),
                m2_base_mensuel: base.m2_base_mensuel,
                saisonnalite: coef,
                // Arrondi a 6 decimales : le facteur n'est qu'une trace du
                // calcul, il n'a pas a trainer les 17 chiffres d'un f64.
                facteur_croissance: (facteur * 1e6).round() / 1e6,
                m2_prevus: m2,
            });
        }
    }
    cases
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(code: &str, m2: f64) -> BaseQualite {
        BaseQualite { code_qualite: code.into(), m2_base_mensuel: m2 }
    }

    #[test]
    fn mois_decale_traverse_l_annee() {
        let d = NaiveDate::from_ymd_opt(2026, 11, 1).unwrap();
        assert_eq!(mois_decale(d, 0), d);
        assert_eq!(mois_decale(d, 2), NaiveDate::from_ymd_opt(2027, 1, 1).unwrap());
        assert_eq!(mois_decale(d, 11), NaiveDate::from_ymd_opt(2027, 10, 1).unwrap());
    }

    #[test]
    fn fin_de_mois_gere_fevrier_bissextile() {
        let f = fin_de_mois(NaiveDate::from_ymd_opt(2028, 2, 1).unwrap());
        assert_eq!(f, NaiveDate::from_ymd_opt(2028, 2, 29).unwrap());
    }

    /// Sans saisonnalite ni croissance, chaque mois vaut la base.
    #[test]
    fn deploiement_neutre() {
        let cases = deployer(
            NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
            12,
            0.0,
            &[base("SH", 2500.0)],
            |_, _| None,
        );
        assert_eq!(cases.len(), 12);
        assert!(cases.iter().all(|c| c.m2_prevus == 2500.0));
        assert_eq!(cases[0].annee_mois, "2026-08");
        assert_eq!(cases[11].annee_mois, "2027-07");
    }

    /// La saisonnalite suit le mois CALENDAIRE, pas le rang dans la periode.
    #[test]
    fn saisonnalite_indexee_sur_le_mois_calendaire() {
        let cases = deployer(
            NaiveDate::from_ymd_opt(2026, 11, 1).unwrap(),
            3,
            0.0,
            &[base("SH", 1000.0)],
            // Decembre a 1,2 ; les autres mois a 1,0.
            |_, mois| if mois == 12 { Some(1.2) } else { Some(1.0) },
        );
        assert_eq!(cases[0].m2_prevus, 1000.0); // novembre
        assert_eq!(cases[1].m2_prevus, 1200.0); // decembre
        assert_eq!(cases[2].m2_prevus, 1000.0); // janvier
    }

    /// Croissance au prorata : 12 % l'an -> facteur 1,12 au douzieme mois.
    #[test]
    fn croissance_au_prorata_des_mois() {
        let cases = deployer(
            NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            12,
            12.0,
            &[base("SH", 10_000.0)],
            |_, _| Some(1.0),
        );
        assert_eq!(cases[0].m2_prevus, 10_000.0);
        // 10 000 x 1,12^(11/12) = 11 093,9...
        assert_eq!(cases[11].m2_prevus, (10_000.0 * 1.12f64.powf(11.0 / 12.0)).round());
        assert!(cases[11].m2_prevus > cases[0].m2_prevus);
    }

    /// Reproduction d'une ligne du classeur : base 2 500, janvier a 1,2,
    /// croissance nulle -> 3 000 m2.
    #[test]
    fn reproduit_la_grille_du_classeur() {
        let cases = deployer(
            NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            1,
            0.0,
            &[base("LP", 2500.0)],
            |q, mois| if q == "LP" && mois == 1 { Some(1.2) } else { None },
        );
        assert_eq!(cases[0].m2_prevus, 3000.0);
        assert_eq!(cases[0].saisonnalite, 1.2);
    }

    /// Croissance COMPOSEE, pas lineaire.
    ///
    /// A 5 %/an et dix mois ecoules :
    ///     annees_ecoulees = 10 / 12          = 0,8333
    ///     facteur         = 1,05^0,8333      = 1,0415
    ///     m2              = ARRONDI(1270,83 x 0,80 x 1,0415) = 1059
    ///
    /// Une croissance lineaire (1 + 0,05 x 0,8333 = 1,0417) donnerait 1059 ici
    /// aussi — l'ecart ne se voit qu'au-dela d'un an. Le test suivant s'en
    /// charge : c'est la ou les deux formules divergent vraiment.
    #[test]
    fn croissance_composee_exemple_chiffre() {
        let cases = deployer(
            NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            11,
            5.0,
            &[base("SH", 1270.83)],
            |_, mois| if mois == 11 { Some(0.80) } else { Some(1.0) },
        );
        let novembre = cases.iter().find(|c| c.rang == 10).unwrap();
        assert_eq!(novembre.m2_prevus, 1059.0);
        assert!((novembre.facteur_croissance - 1.041_5).abs() < 0.000_2);
    }

    /// Au-dela de douze mois, la composition se distingue nettement du lineaire.
    ///
    /// A 10 %/an sur trois ans (rang 35, soit 2,9167 annees) :
    ///     compose  : 1,10^2,9167 = 1,3199  -> 13 199 m2
    ///     lineaire : 1 + 0,10 x 2,9167 = 1,2917 -> 12 917 m2
    /// Presque 300 m2 d'ecart sur une base de 10 000 : c'est ce que corrige la
    /// formule exponentielle, et c'est ce qui rend les plans pluriannuels justes.
    #[test]
    fn croissance_composee_sur_trois_ans() {
        let cases = deployer(
            NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            36,
            10.0,
            &[base("SH", 10_000.0)],
            |_, _| Some(1.0),
        );
        assert_eq!(cases.len(), 36);
        let dernier = cases.iter().find(|c| c.rang == 35).unwrap();
        let compose = 10_000.0 * 1.10f64.powf(35.0 / 12.0);
        let lineaire = 10_000.0 * (1.0 + 0.10 * 35.0 / 12.0);
        assert_eq!(dernier.m2_prevus, compose.round());
        assert!(dernier.m2_prevus - lineaire > 250.0);
    }

    /// Le profil saisonnier se REPETE d'une annee sur l'autre : c'est un
    /// parametre annuel, pas une valeur par mois de la periode.
    #[test]
    fn saisonnalite_repetee_chaque_annee() {
        let cases = deployer(
            NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            24,
            0.0,
            &[base("SH", 1000.0)],
            |_, mois| if mois == 5 { Some(0.50) } else { Some(1.0) },
        );
        // Mai de l'an 1 (rang 4) et mai de l'an 2 (rang 16) : meme coefficient.
        assert_eq!(cases.iter().find(|c| c.rang == 4).unwrap().m2_prevus, 500.0);
        assert_eq!(cases.iter().find(|c| c.rang == 16).unwrap().m2_prevus, 500.0);
        assert_eq!(cases.iter().find(|c| c.rang == 5).unwrap().m2_prevus, 1000.0);
    }

    /// Les m2 sont des entiers : on ne produit pas un demi-tapis.
    #[test]
    fn arrondi_a_l_unite() {
        let cases = deployer(
            NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            1,
            0.0,
            &[base("SH", 1270.83)],
            |_, _| Some(0.80),
        );
        // 1270,83 x 0,80 = 1016,664 -> 1017
        assert_eq!(cases[0].m2_prevus, 1017.0);
        assert_eq!(cases[0].m2_prevus.fract(), 0.0);
    }

    /// Un coefficient nul met le mois a zero : c'est le cas des qualites
    /// saisonnieres arretees plusieurs mois dans le classeur (K13 = 0).
    #[test]
    fn coefficient_nul_arrete_la_production() {
        let cases = deployer(
            NaiveDate::from_ymd_opt(2026, 4, 1).unwrap(),
            1,
            50.0,
            &[base("BR", 2000.0)],
            |_, _| Some(0.0),
        );
        assert_eq!(cases[0].m2_prevus, 0.0);
    }
}
