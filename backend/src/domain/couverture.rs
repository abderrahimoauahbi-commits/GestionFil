//! LE MOTEUR DE COUVERTURE (étape 1 du plan validé le 26/10/2026).
//!
//! Calcul PUR, sur des structures en mémoire : il ne lit ni n'écrit la base
//! (la lecture est dans `routes/couverture.rs`). Depuis le basculement du
//! 27/10/2026, sa première proposition par référence est celle que la génération
//! du plan d'achat enregistre (`domain/plan_achat.rs`) et que « Commander » envoie
//! au bon ; `v_plan_achat` ne sert plus qu'aux indicateurs de l'onglet Situation.
//!
//! Les règles, décidées par la direction (mémoire « restes-informatifs-projection ») :
//!
//! * LA DEMANDE est le PLAN SEUL : la photo `besoin_mrp` du plan en service,
//!   mois par mois. Consommation prévue d'un jour = kg du mois ÷ nombre de jours
//!   réels du mois. Le mois en cours ne compte qu'à partir d'aujourd'hui : le plan
//!   des jours passés est perdu, jamais reporté. Le moteur ne modifie jamais le plan.
//! * LA PROJECTION se fait jour par jour : solde(j) = solde(j−1) + arrivages du
//!   jour − consommation prévue du jour. Le solde ne descend JAMAIS sous zéro : un
//!   déficit est un « plan non couvert », pas une dette ; il n'est jamais reporté.
//! * LA SÉCURITÉ est une ligne de seuil distincte de la rupture (à zéro) : jours de
//!   sécurité de la classe ABC × consommation moyenne prévue du plan sur la
//!   fenêtre de couverture. Sur la courbe, la ligne d'un jour t est calculée sur
//!   [t, t + couverture[ (bornée à l'horizon) : au jour D d'une proposition, elle
//!   vaut exactement la sécurité de la proposition.
//! * « À COMMANDER » : D = MAX(aujourd'hui + délai, première date où le solde
//!   passe sous la sécurité) ; F = D + couverture (bornée à l'horizon), fenêtre
//!   [D, F[ ; S(D) = solde au début de D, arrivages du jour D compris, jamais
//!   négatif ; besoin = MAX(0, MAX sur t ∈ [D, F[ de [Sécurité + Plan(D→t) −
//!   Arrivages(]D, t]) − S(D)]) ; puis minimum de commande, puis arrondi VERS LE
//!   HAUT au multiple de la fiche. Les propositions suivantes ajoutent la
//!   précédente aux ressources à son D et recommencent, jusqu'à la fin de
//!   l'horizon, dans la limite de `max_propositions`.
//!
//! Le jour 0 est AUJOURD'HUI ; tout se compte en jours entiers.

use chrono::{Datelike, Duration, NaiveDate};
use serde::Serialize;
use std::collections::HashMap;

/// Tolérance de comparaison des kilos (les consommations journalières sont des
/// quotients : 3 100 kg / 31 j ne tombe pas toujours juste en flottant).
const EPS: f64 = 1e-6;

/// Nombre de propositions enchaînées au plus (au-delà, le calcul le dit).
pub const MAX_PROPOSITIONS: usize = 12;

/// D'où vient une valeur de réglage (délai, couverture) : affichée à l'écran.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Source {
    #[serde(rename = "fournisseur")]
    Fournisseur,
    #[serde(rename = "paramètre global")]
    ParametreGlobal,
}

/// Un mois du plan pour une référence : les kilos de la photo `besoin_mrp`.
#[derive(Debug, Clone, Copy)]
pub struct MoisPlan {
    pub annee: i32,
    pub mois: u32,
    pub kg: f64,
}

/// Un arrivage COMPTÉ (daté, dans l'horizon ou non : le moteur ignore ce qui
/// tombe hors de [aujourd'hui, fin de l'horizon]).
#[derive(Debug, Clone, Copy)]
pub struct Arrivee {
    pub date: NaiveDate,
    pub kg: f64,
}

/// Les réglages d'une référence, déjà résolus (fiche, fournisseur, paramètres).
#[derive(Debug, Clone)]
pub struct Reglages {
    pub aujourdhui: NaiveDate,
    /// Dernier jour de l'horizon, INCLUS (fin du plan en service).
    pub fin_horizon: NaiveDate,
    pub delai_j: i64,
    pub couverture_j: i64,
    pub jours_securite: f64,
    /// Minimum de commande de la fiche (`reference.moq_kg`), s'il est renseigné.
    pub moq_kg: Option<f64>,
    /// Multiple d'achat résolu : `multiple_achat_kg`, sinon la palette de la fiche
    /// si `arrondi_palette = 1` ; `None` = pas d'arrondi (kg).
    pub multiple_kg: Option<f64>,
    /// Kilos d'une palette ordinaire de la fiche (information seulement).
    pub kg_palette: Option<f64>,
    pub max_propositions: usize,
}

/// Un jour de la projection (sans les propositions).
#[derive(Debug, Clone, Serialize)]
pub struct Jour {
    pub date: NaiveDate,
    pub conso_prevue_kg: f64,
    pub arrivee_kg: f64,
    /// Solde en fin de journée, jamais négatif.
    pub solde_kg: f64,
    pub securite_kg: f64,
    /// Plan du jour que le solde n'a pas pu couvrir (perdu, jamais reporté).
    pub plan_non_couvert_kg: f64,
}

/// Natures d'événement (codes stables, l'écran les traduit).
pub mod nature {
    pub const AUJOURDHUI: &str = "AUJOURDHUI";
    pub const ARRIVAGE: &str = "ARRIVAGE";
    pub const RUPTURE: &str = "RUPTURE";
    pub const REPRISE: &str = "REPRISE";
    pub const SOUS_SECURITE: &str = "SOUS_SECURITE";
    pub const FIN_DE_MOIS: &str = "FIN_DE_MOIS";
    pub const DELAI: &str = "AUJOURDHUI_PLUS_DELAI";
    pub const FIN_HORIZON: &str = "FIN_HORIZON";
}

/// Un événement rendu (pas les 365 jours) : tout ce qui s'est passé depuis
/// l'événement précédent (exclu) jusqu'à ce jour (inclus).
#[derive(Debug, Clone, Serialize)]
pub struct Evenement {
    pub date: NaiveDate,
    pub natures: Vec<&'static str>,
    pub conso_prevue_kg: f64,
    pub arrivee_kg: f64,
    pub solde_apres_kg: f64,
    pub securite_kg: f64,
    pub plan_non_couvert_kg: f64,
}

/// Une proposition « À commander », avec toutes ses étapes.
#[derive(Debug, Clone, Serialize)]
pub struct Proposition {
    pub rang: usize,
    /// Première date où le solde projeté (propositions précédentes comprises)
    /// passe sous la sécurité.
    pub date_sous_securite: NaiveDate,
    pub date_au_plus_tot: NaiveDate,
    /// D : date de disponibilité de la commande.
    pub date_disponibilite: NaiveDate,
    /// « délai » si D = aujourd'hui + délai (le délai impose la date, même quand la
    /// sécurité est franchie ce jour-là ou avant) ; « sécurité » si le passage sous
    /// la sécurité tombe APRÈS aujourd'hui + délai et fixe D.
    pub motif_date: &'static str,
    /// F : fin de la fenêtre, EXCLUE (la fenêtre est [D, F[).
    pub date_fin_fenetre: NaiveDate,
    pub dernier_jour_couvert: NaiveDate,
    pub fenetre_bornee_horizon: bool,
    pub jours_fenetre: i64,
    pub plan_fenetre_kg: f64,
    pub conso_moyenne_kg_j: f64,
    pub jours_securite: f64,
    pub securite_kg: f64,
    pub solde_debut_d_kg: f64,
    pub arrivages_fenetre_kg: f64,
    pub besoin_theorique_kg: f64,
    pub jour_determinant: NaiveDate,
    pub moq_kg: Option<f64>,
    pub apres_minimum_kg: f64,
    pub multiple_kg: Option<f64>,
    pub quantite_proposee_kg: f64,
    pub palettes_equivalentes: Option<f64>,
    pub date_limite_commande: NaiveDate,
}

/// Le résultat du moteur pour une référence.
#[derive(Debug, Clone, Serialize)]
pub struct Couverture {
    pub stock_initial_kg: f64,
    pub plan_horizon_kg: f64,
    pub plan_non_couvert_kg: f64,
    pub premiere_rupture: Option<NaiveDate>,
    /// Dernier jour couvert avant la première rupture ; la fin de l'horizon sans
    /// rupture ; `None` si la rupture est dès aujourd'hui.
    pub couvert_jusqu_au: Option<NaiveDate>,
    pub couvert_tout_horizon: bool,
    pub premier_passage_securite: Option<NaiveDate>,
    pub jours: Vec<Jour>,
    pub evenements: Vec<Evenement>,
    pub propositions: Vec<Proposition>,
    pub propositions_plafonnees: bool,
    pub motif_sans_proposition: Option<&'static str>,
}

/// Arrondi à 4 décimales (kg).
fn r4(v: f64) -> f64 {
    // « + 0.0 » efface le zéro négatif (−0,00001 arrondi s'afficherait « -0 »).
    (v * 10_000.0).round() / 10_000.0 + 0.0
}

/// Le motif de la date D (indices de jours, 0 = aujourd'hui) : D = MAX(délai,
/// passage sous la sécurité). Quand D tombe sur aujourd'hui + délai, c'est le délai
/// qui l'impose — même si la sécurité est franchie ce jour-là ou avant (27/10/2026).
fn motif_date(d: usize, delai: usize) -> &'static str {
    if d == delai {
        "délai"
    } else {
        "sécurité"
    }
}

/// L'ORDRE DE LA LISTE « À COMMANDER » (27/10/2026) : d'abord la première rupture
/// la plus proche (une rupture aujourd'hui en tête, une référence sans rupture en
/// dernier), puis la date limite de commande de la première proposition (sans
/// proposition : après). Une référence en rupture aujourd'hui ne descend jamais en
/// bas de liste parce que sa proposition est lointaine.
pub fn cle_tri(c: &Couverture) -> (NaiveDate, NaiveDate) {
    (
        c.premiere_rupture.unwrap_or(NaiveDate::MAX),
        c.propositions.first().map(|p| p.date_limite_commande).unwrap_or(NaiveDate::MAX),
    )
}

/// Nombre de jours réels d'un mois.
pub fn jours_du_mois(annee: i32, mois: u32) -> u32 {
    let debut = NaiveDate::from_ymd_opt(annee, mois, 1).expect("mois valide");
    let suivant = if mois == 12 {
        NaiveDate::from_ymd_opt(annee + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(annee, mois + 1, 1)
    }
    .expect("mois valide");
    (suivant - debut).num_days() as u32
}

/// Le dernier jour d'un mois.
pub fn fin_du_mois(annee: i32, mois: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(annee, mois, jours_du_mois(annee, mois)).expect("mois valide")
}

/// Solde de fin de journée et plan non couvert, jour par jour. Le déficit d'un
/// jour n'est jamais reporté sur le suivant : le solde repart de zéro.
fn projeter(stock: f64, conso: &[f64], arr: &[f64]) -> (Vec<f64>, Vec<f64>) {
    let mut solde = Vec::with_capacity(conso.len());
    let mut deficit = Vec::with_capacity(conso.len());
    let mut s = stock.max(0.0);
    for (c, a) in conso.iter().zip(arr) {
        let brut = s + a - c;
        if brut < -EPS {
            deficit.push(-brut);
            s = 0.0;
        } else {
            deficit.push(0.0);
            s = brut.max(0.0);
        }
        solde.push(s);
    }
    (solde, deficit)
}

/// Calcule la couverture d'une référence.
pub fn calculer(stock_initial: f64, plan: &[MoisPlan], arrivees: &[Arrivee], r: &Reglages) -> Couverture {
    let auj = r.aujourdhui;
    // Un plan déjà terminé ne projette rien : un seul jour, sans consommation.
    let fin = r.fin_horizon.max(auj);
    let n = ((fin - auj).num_days() + 1) as usize;
    let date = |i: usize| auj + Duration::days(i as i64);

    // La consommation prévue de chaque jour : kg du mois / jours réels du mois.
    let mut par_mois: HashMap<(i32, u32), f64> = HashMap::new();
    for m in plan {
        *par_mois.entry((m.annee, m.mois)).or_default() += m.kg;
    }
    let mut conso = vec![0.0; n];
    for (i, c) in conso.iter_mut().enumerate() {
        let d = date(i);
        if let Some(kg) = par_mois.get(&(d.year(), d.month())).filter(|kg| **kg > 0.0) {
            *c = kg / jours_du_mois(d.year(), d.month()) as f64;
        }
    }
    // Les arrivages comptés, au jour près ; hors de l'horizon, ignorés.
    let mut arr = vec![0.0; n];
    for a in arrivees {
        let k = (a.date - auj).num_days();
        if k >= 0 && (k as usize) < n && a.kg > 0.0 {
            arr[k as usize] += a.kg;
        }
    }
    // Sommes cumulées du plan : cumul[i] = plan des jours [0, i[.
    let mut cumul = vec![0.0; n + 1];
    for (i, c) in conso.iter().enumerate() {
        cumul[i + 1] = cumul[i] + c;
    }
    // Une couverture de 0 jour ne ferait aucune fenêtre : un jour au moins.
    let couv = r.couverture_j.max(1) as usize;
    let delai = r.delai_j.max(0) as usize;
    let fenetre = |d: usize| (d + couv).min(n);
    let securite_du_jour = |t: usize| {
        let f = fenetre(t);
        r.jours_securite * (cumul[f] - cumul[t]) / (f - t) as f64
    };
    let securite: Vec<f64> = (0..n).map(securite_du_jour).collect();

    let (solde, deficit) = projeter(stock_initial, &conso, &arr);

    // ---- Synthèse ------------------------------------------------------------
    let premiere_rupture_i = (0..n).find(|&i| deficit[i] > EPS);
    let premier_passage_i = (0..n).find(|&i| solde[i] < securite[i] - EPS);
    let (couvert_jusqu_au, couvert_tout_horizon) = match premiere_rupture_i {
        None => (Some(fin), true),
        Some(0) => (None, false),
        Some(i) => (Some(date(i - 1)), false),
    };

    // ---- Événements ----------------------------------------------------------
    let mut evenements = Vec::new();
    let (mut c_acc, mut a_acc, mut d_acc) = (0.0, 0.0, 0.0);
    // En rupture depuis la dernière RUPTURE : la couverture ne REPREND qu'un jour
    // où il y a du stock ou un plan couvert (la fin du plan ne « reprend » rien).
    let mut en_rupture = false;
    for i in 0..n {
        c_acc += conso[i];
        a_acc += arr[i];
        d_acc += deficit[i];
        let d = date(i);
        let mut natures = Vec::new();
        if i == 0 {
            natures.push(nature::AUJOURDHUI);
        }
        if arr[i] > EPS {
            natures.push(nature::ARRIVAGE);
        }
        if deficit[i] > EPS {
            if !en_rupture {
                natures.push(nature::RUPTURE);
            }
            en_rupture = true;
        } else if en_rupture && (solde[i] > EPS || conso[i] > EPS) {
            natures.push(nature::REPRISE);
            en_rupture = false;
        }
        let sous = solde[i] < securite[i] - EPS;
        let veille_sous = i > 0 && solde[i - 1] < securite[i - 1] - EPS;
        if sous && !veille_sous {
            natures.push(nature::SOUS_SECURITE);
        }
        if delai > 0 && i == delai {
            natures.push(nature::DELAI);
        }
        if d.day() == jours_du_mois(d.year(), d.month()) {
            natures.push(nature::FIN_DE_MOIS);
        }
        if i == n - 1 {
            natures.push(nature::FIN_HORIZON);
        }
        if !natures.is_empty() {
            evenements.push(Evenement {
                date: d,
                natures,
                conso_prevue_kg: r4(c_acc),
                arrivee_kg: r4(a_acc),
                solde_apres_kg: r4(solde[i]),
                securite_kg: r4(securite[i]),
                plan_non_couvert_kg: r4(d_acc),
            });
            c_acc = 0.0;
            a_acc = 0.0;
            d_acc = 0.0;
        }
    }

    // ---- Propositions --------------------------------------------------------
    let mut propositions = Vec::new();
    let mut plafonnees = false;
    let mut motif_sans_proposition = None;
    let mut arr_p = arr.clone();
    let mut debut = 0usize;
    loop {
        let (solde_p, _) = projeter(stock_initial, &conso, &arr_p);
        let Some(t) = (debut..n).find(|&t| solde_p[t] < securite[t] - EPS) else {
            if propositions.is_empty() {
                motif_sans_proposition = Some("aucun passage sous la sécurité sur l'horizon du plan");
            }
            break;
        };
        let d = delai.max(t);
        if d >= n {
            if propositions.is_empty() {
                motif_sans_proposition =
                    Some("aujourd'hui + délai tombe au-delà de l'horizon du plan : aucune commande ne peut y arriver");
            }
            break;
        }
        if propositions.len() >= r.max_propositions {
            plafonnees = true;
            break;
        }
        let f = fenetre(d);
        // S(D) : le solde au début de D, arrivages du jour D compris, jamais négatif.
        let s_d = if d == 0 { stock_initial.max(0.0) } else { solde_p[d - 1] } + arr_p[d];
        let moyenne = (cumul[f] - cumul[d]) / (f - d) as f64;
        let secu = r.jours_securite * moyenne;
        let (mut net, mut meilleur, mut determinant, mut arrivages_fenetre) = (0.0, f64::NEG_INFINITY, d, 0.0);
        for (k, (c, a)) in conso[d..f].iter().zip(&arr_p[d..f]).enumerate() {
            net += c;
            if k > 0 {
                net -= a;
                arrivages_fenetre += a;
            }
            let v = secu + net - s_d;
            if v > meilleur + EPS {
                meilleur = v;
                determinant = d + k;
            }
        }
        let besoin = meilleur.max(0.0);
        if besoin <= EPS {
            // Ce D ne demande rien (un arrivage le couvre) : on cherche plus loin.
            debut = d + 1;
            continue;
        }
        let moq = r.moq_kg.filter(|m| *m > 0.0);
        let apres_minimum = moq.map_or(besoin, |m| besoin.max(m));
        let multiple = r.multiple_kg.filter(|m| *m > 0.0);
        let quantite = match multiple {
            Some(m) => (apres_minimum / m - 1e-9).ceil() * m,
            None => apres_minimum,
        };
        arr_p[d] += quantite;
        propositions.push(Proposition {
            rang: propositions.len() + 1,
            date_sous_securite: date(t),
            date_au_plus_tot: date(delai.min(n - 1)),
            date_disponibilite: date(d),
            motif_date: motif_date(d, delai),
            date_fin_fenetre: date(f),
            dernier_jour_couvert: date(f - 1),
            fenetre_bornee_horizon: d + couv > n,
            jours_fenetre: (f - d) as i64,
            plan_fenetre_kg: r4(cumul[f] - cumul[d]),
            conso_moyenne_kg_j: r4(moyenne),
            jours_securite: r.jours_securite,
            securite_kg: r4(secu),
            solde_debut_d_kg: r4(s_d),
            arrivages_fenetre_kg: r4(arrivages_fenetre),
            besoin_theorique_kg: r4(besoin),
            jour_determinant: date(determinant),
            moq_kg: moq,
            apres_minimum_kg: r4(apres_minimum),
            multiple_kg: multiple,
            quantite_proposee_kg: r4(quantite),
            palettes_equivalentes: r
                .kg_palette
                .filter(|p| *p > 0.0)
                .map(|p| (quantite / p * 100.0).round() / 100.0),
            date_limite_commande: date(d) - Duration::days(r.delai_j.max(0)),
        });
        debut = d + 1;
    }

    let jours = (0..n)
        .map(|i| Jour {
            date: date(i),
            conso_prevue_kg: r4(conso[i]),
            arrivee_kg: r4(arr[i]),
            solde_kg: r4(solde[i]),
            securite_kg: r4(securite[i]),
            plan_non_couvert_kg: r4(deficit[i]),
        })
        .collect();

    Couverture {
        stock_initial_kg: r4(stock_initial),
        plan_horizon_kg: r4(cumul[n]),
        plan_non_couvert_kg: r4(deficit.iter().sum()),
        premiere_rupture: premiere_rupture_i.map(date),
        couvert_jusqu_au,
        couvert_tout_horizon,
        premier_passage_securite: premier_passage_i.map(date),
        jours,
        evenements,
        propositions,
        propositions_plafonnees: plafonnees,
        motif_sans_proposition,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// J1 = aujourd'hui = 01/01/2026 ; l'horizon court jusqu'au 30/06/2026.
    fn j(n: i64) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 1, 1).unwrap() + Duration::days(n - 1)
    }

    /// Un plan à 100 kg par jour exactement, de janvier à juin 2026.
    fn plan_100() -> Vec<MoisPlan> {
        (1..=6)
            .map(|m| MoisPlan { annee: 2026, mois: m, kg: 100.0 * jours_du_mois(2026, m) as f64 })
            .collect()
    }

    /// Délai 10 j, couverture 30 j, sécurité 5 j, sans minimum ni multiple.
    fn reglages() -> Reglages {
        Reglages {
            aujourdhui: j(1),
            fin_horizon: NaiveDate::from_ymd_opt(2026, 6, 30).unwrap(),
            delai_j: 10,
            couverture_j: 30,
            jours_securite: 5.0,
            moq_kg: None,
            multiple_kg: None,
            kg_palette: None,
            max_propositions: MAX_PROPOSITIONS,
        }
    }

    fn proche(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn exemple_valide_1_arrivage_de_800_a_j25() {
        let c = calculer(2000.0, &plan_100(), &[Arrivee { date: j(25), kg: 800.0 }], &reglages());
        let p = &c.propositions[0];
        assert_eq!(p.date_disponibilite, j(16), "D");
        assert_eq!(p.date_fin_fenetre, j(46), "F");
        assert!(proche(p.securite_kg, 500.0), "sécurité {}", p.securite_kg);
        assert!(proche(p.solde_debut_d_kg, 500.0), "S(D) {}", p.solde_debut_d_kg);
        assert!(proche(p.besoin_theorique_kg, 2200.0), "besoin {}", p.besoin_theorique_kg);
        assert_eq!(p.jour_determinant, j(45), "jour déterminant : fin de J45");
        assert_eq!(p.motif_date, "sécurité");
        assert!(proche(p.quantite_proposee_kg, 2200.0));
        assert_eq!(p.date_limite_commande, j(6), "D − délai");
    }

    #[test]
    fn exemple_valide_2_arrivage_de_3000_a_j44() {
        let c = calculer(2000.0, &plan_100(), &[Arrivee { date: j(44), kg: 3000.0 }], &reglages());
        let p = &c.propositions[0];
        assert_eq!(p.date_disponibilite, j(16));
        assert!(proche(p.solde_debut_d_kg, 500.0));
        assert!(proche(p.besoin_theorique_kg, 2800.0), "besoin {}", p.besoin_theorique_kg);
        assert_eq!(p.jour_determinant, j(43), "jour déterminant : la veille de l'arrivage");
    }

    #[test]
    fn rupture_avant_d_le_deficit_nest_pas_reporte() {
        // 300 kg pour 100 kg/j : rupture à J4, D = aujourd'hui + délai = J11.
        let c = calculer(300.0, &plan_100(), &[], &reglages());
        assert_eq!(c.premiere_rupture, Some(j(4)));
        assert_eq!(c.couvert_jusqu_au, Some(j(3)));
        let p = &c.propositions[0];
        assert_eq!(p.date_disponibilite, j(11));
        assert_eq!(p.motif_date, "délai");
        assert_eq!(p.date_sous_securite, j(1));
        assert!(proche(p.solde_debut_d_kg, 0.0), "S(D) jamais négatif : {}", p.solde_debut_d_kg);
        // Sécurité 500 + plan de J11 à J40 (3 000) − 0 : le déficit de J4 à J10 n'y est pas.
        assert!(proche(p.besoin_theorique_kg, 3500.0), "besoin {}", p.besoin_theorique_kg);
        // Le plan non couvert de J4 à J10 (7 × 100) est affiché, jamais rattrapé ; sans
        // commande, il court jusqu'à la fin de l'horizon.
        let jusqu_a_j10: f64 = c.jours[..10].iter().map(|x| x.plan_non_couvert_kg).sum();
        assert!(proche(jusqu_a_j10, 700.0), "non couvert J4-J10 : {jusqu_a_j10}");
        assert!(c.jours.iter().all(|x| x.solde_kg >= 0.0));
        let e = c.evenements.iter().find(|e| e.date == j(4)).expect("événement de rupture");
        assert!(e.natures.contains(&nature::RUPTURE));
    }

    #[test]
    fn arrivage_pile_a_d_compte_dans_s_de_d() {
        // Délai 20 : D = J21 (le passage sous la sécurité est à J16) ; 1 000 kg arrivent à J21.
        let mut r = reglages();
        r.delai_j = 20;
        let c = calculer(2000.0, &plan_100(), &[Arrivee { date: j(21), kg: 1000.0 }], &r);
        let p = &c.propositions[0];
        assert_eq!(p.date_disponibilite, j(21));
        assert!(proche(p.solde_debut_d_kg, 1000.0), "S(D) {}", p.solde_debut_d_kg);
        assert!(proche(p.besoin_theorique_kg, 2500.0), "besoin {}", p.besoin_theorique_kg);
        assert!(proche(p.arrivages_fenetre_kg, 0.0), "l'arrivage de D est dans S(D), pas dans ]D, t]");
    }

    #[test]
    fn aucune_rupture_sur_l_horizon_pas_de_proposition() {
        let c = calculer(100_000.0, &plan_100(), &[], &reglages());
        assert!(c.propositions.is_empty());
        assert!(c.premiere_rupture.is_none());
        assert!(c.couvert_tout_horizon);
        assert_eq!(c.couvert_jusqu_au, Some(NaiveDate::from_ymd_opt(2026, 6, 30).unwrap()));
        assert!(c.motif_sans_proposition.is_some());
        assert!(proche(c.plan_horizon_kg, 18_100.0), "plan {}", c.plan_horizon_kg);
    }

    #[test]
    fn securite_deja_franchie_aujourdhui() {
        let c = calculer(400.0, &plan_100(), &[], &reglages());
        assert_eq!(c.premier_passage_securite, Some(j(1)));
        let p = &c.propositions[0];
        assert_eq!(p.date_disponibilite, j(11), "D = aujourd'hui + délai");
        assert_eq!(p.date_limite_commande, j(1), "commander aujourd'hui");
        let e = &c.evenements[0];
        assert!(e.natures.contains(&nature::AUJOURDHUI) && e.natures.contains(&nature::SOUS_SECURITE));
    }

    #[test]
    fn minimum_puis_multiple() {
        let mut r = reglages();
        r.moq_kg = Some(2500.0);
        r.multiple_kg = Some(1000.0);
        let c = calculer(2000.0, &plan_100(), &[Arrivee { date: j(25), kg: 800.0 }], &r);
        let p = &c.propositions[0];
        assert!(proche(p.besoin_theorique_kg, 2200.0));
        assert!(proche(p.apres_minimum_kg, 2500.0));
        assert!(proche(p.quantite_proposee_kg, 3000.0));
        // Un besoin déjà multiple ne prend pas un multiple de plus.
        r.moq_kg = None;
        r.multiple_kg = Some(1100.0);
        let c = calculer(2000.0, &plan_100(), &[Arrivee { date: j(25), kg: 800.0 }], &r);
        assert!(proche(c.propositions[0].quantite_proposee_kg, 2200.0));
    }

    #[test]
    fn arrondi_a_la_palette() {
        // 5 kg × 90 bobines = 450 kg la palette : 2 200 → 5 palettes = 2 250 kg.
        let mut r = reglages();
        r.multiple_kg = Some(450.0);
        r.kg_palette = Some(450.0);
        let c = calculer(2000.0, &plan_100(), &[Arrivee { date: j(25), kg: 800.0 }], &r);
        let p = &c.propositions[0];
        assert!(proche(p.quantite_proposee_kg, 2250.0), "quantité {}", p.quantite_proposee_kg);
        assert_eq!(p.palettes_equivalentes, Some(5.0));
        // Sans multiple : pas d'arrondi, les palettes restent une information.
        r.multiple_kg = None;
        let c = calculer(2000.0, &plan_100(), &[Arrivee { date: j(25), kg: 800.0 }], &r);
        let p = &c.propositions[0];
        assert!(proche(p.quantite_proposee_kg, 2200.0));
        assert_eq!(p.palettes_equivalentes, Some(4.89));
    }

    #[test]
    fn propositions_suivantes_enchainees() {
        // Sans arrivage : 3 000 à J16 (sécurité 500 + 30 jours de plan − S(D) 500), puis
        // 3 000 tous les 30 jours ; la dernière fenêtre est bornée à l'horizon (16 jours).
        let c = calculer(2000.0, &plan_100(), &[], &reglages());
        let d: Vec<_> = c.propositions.iter().map(|p| p.date_disponibilite).collect();
        assert_eq!(d, vec![j(16), j(46), j(76), j(106), j(136), j(166)]);
        let q: Vec<_> = c.propositions.iter().map(|p| p.quantite_proposee_kg).collect();
        assert!(proche(q[0], 3000.0) && proche(q[1], 3000.0) && proche(q[4], 3000.0), "{q:?}");
        let derniere = c.propositions.last().unwrap();
        assert!(derniere.fenetre_bornee_horizon);
        assert_eq!(derniere.jours_fenetre, 16);
        assert!(proche(derniere.besoin_theorique_kg, 1600.0), "{}", derniere.besoin_theorique_kg);
        assert!(!c.propositions_plafonnees);
        // Plafonnées à 3, et le calcul le dit.
        let mut r = reglages();
        r.max_propositions = 3;
        let c = calculer(2000.0, &plan_100(), &[], &r);
        assert_eq!(c.propositions.len(), 3);
        assert!(c.propositions_plafonnees);
    }

    #[test]
    fn plan_vide() {
        let c = calculer(500.0, &[], &[Arrivee { date: j(10), kg: 100.0 }], &reglages());
        assert!(c.propositions.is_empty());
        assert!(c.premiere_rupture.is_none());
        assert!(proche(c.plan_horizon_kg, 0.0));
        assert!(c.jours.iter().all(|x| proche(x.securite_kg, 0.0)));
        assert!(proche(c.jours.last().unwrap().solde_kg, 600.0));
    }

    #[test]
    fn mois_en_cours_compte_a_partir_d_aujourdhui() {
        // Aujourd'hui 26/10 : il reste 6 jours d'octobre ; 3 100 kg en octobre = 100 kg/j.
        let mut r = reglages();
        r.aujourdhui = NaiveDate::from_ymd_opt(2026, 10, 26).unwrap();
        r.fin_horizon = NaiveDate::from_ymd_opt(2026, 11, 30).unwrap();
        let plan = [
            MoisPlan { annee: 2026, mois: 9, kg: 9_999.0 },
            MoisPlan { annee: 2026, mois: 10, kg: 3100.0 },
            MoisPlan { annee: 2026, mois: 11, kg: 3000.0 },
        ];
        let c = calculer(100_000.0, &plan, &[], &r);
        assert!(proche(c.plan_horizon_kg, 600.0 + 3000.0), "{}", c.plan_horizon_kg);
        let fins: Vec<_> = c
            .evenements
            .iter()
            .filter(|e| e.natures.contains(&nature::FIN_DE_MOIS))
            .map(|e| e.date)
            .collect();
        assert_eq!(fins.len(), 2);
        // La somme des périodes rend le plan de l'horizon.
        let total: f64 = c.evenements.iter().map(|e| e.conso_prevue_kg).sum();
        assert!(proche(total, c.plan_horizon_kg));
    }

    #[test]
    fn reprise_seulement_quand_le_plan_est_de_nouveau_couvert() {
        // 300 kg, plan de janvier seul : rupture à J4, la fin du plan n'est pas une reprise ;
        // un arrivage à J20 l'est.
        let plan = [MoisPlan { annee: 2026, mois: 1, kg: 3100.0 }];
        let c = calculer(300.0, &plan, &[], &reglages());
        let natures: Vec<_> = c.evenements.iter().flat_map(|e| e.natures.clone()).collect();
        assert_eq!(natures.iter().filter(|n| **n == nature::RUPTURE).count(), 1);
        assert!(!natures.contains(&nature::REPRISE), "{natures:?}");
        let c = calculer(300.0, &plan, &[Arrivee { date: j(20), kg: 5000.0 }], &reglages());
        let e = c.evenements.iter().find(|e| e.date == j(20)).unwrap();
        assert!(e.natures.contains(&nature::REPRISE) && e.natures.contains(&nature::ARRIVAGE));
        let non_couvert: f64 = c.jours.iter().map(|x| x.plan_non_couvert_kg).sum();
        assert!(proche(non_couvert, 1600.0), "J4 à J19 : {non_couvert}");
        assert!(proche(c.plan_non_couvert_kg, 1600.0));
    }

    #[test]
    fn motif_delai_quand_la_securite_tombe_pile_a_aujourdhui_plus_delai() {
        // 1 550 kg pour 100 kg/j, sécurité 500 : sous la sécurité en fin de J11 (indice 10),
        // c'est-à-dire pile à aujourd'hui + délai (10 j). Le délai impose la date : « délai ».
        let c = calculer(1550.0, &plan_100(), &[], &reglages());
        let p = &c.propositions[0];
        assert_eq!(p.date_sous_securite, j(11));
        assert_eq!(p.date_disponibilite, j(11));
        assert_eq!(p.motif_date, "délai");
    }

    #[test]
    fn motif_delai_quand_la_securite_est_franchie_avant() {
        // Sous la sécurité dès aujourd'hui : D = aujourd'hui + délai, motif « délai ».
        let c = calculer(400.0, &plan_100(), &[], &reglages());
        assert_eq!(c.propositions[0].motif_date, "délai");
        // Délai nul et sécurité franchie aujourd'hui : D = aujourd'hui = aujourd'hui + 0, « délai ».
        let mut r = reglages();
        r.delai_j = 0;
        let c = calculer(400.0, &plan_100(), &[], &r);
        assert_eq!(c.propositions[0].date_disponibilite, j(1));
        assert_eq!(c.propositions[0].motif_date, "délai");
    }

    #[test]
    fn motif_securite_seulement_apres_aujourdhui_plus_delai() {
        // 1 650 kg : sous la sécurité en fin de J12, un jour après aujourd'hui + délai.
        let c = calculer(1650.0, &plan_100(), &[], &reglages());
        let p = &c.propositions[0];
        assert_eq!(p.date_sous_securite, j(12));
        assert_eq!(p.date_disponibilite, j(12));
        assert_eq!(p.motif_date, "sécurité");
        // Les propositions suivantes tombent au-delà du délai : « sécurité ».
        assert!(c.propositions[1..].iter().all(|p| p.motif_date == "sécurité"));
    }

    #[test]
    fn tri_rupture_la_plus_proche_puis_date_limite() {
        // A : rupture aujourd'hui (stock nul) ; B : rupture lointaine mais commande à passer
        // aujourd'hui ; C : aucune rupture, aucune proposition.
        let a = calculer(0.0, &plan_100(), &[Arrivee { date: j(5), kg: 100_000.0 }], &reglages());
        let b = calculer(1550.0, &plan_100(), &[], &reglages());
        let c = calculer(100_000.0, &plan_100(), &[], &reglages());
        assert_eq!(a.premiere_rupture, Some(j(1)));
        assert!(a.propositions.is_empty() || a.propositions[0].date_limite_commande > b.propositions[0].date_limite_commande);
        let mut v = [(&c, "C"), (&b, "B"), (&a, "A")];
        v.sort_by_key(|(x, _)| cle_tri(x));
        assert_eq!(v.map(|(_, n)| n), ["A", "B", "C"], "rupture d'aujourd'hui en tête, sans rupture en dernier");
        // La rupture la plus proche passe devant, quelle que soit la date limite.
        let d = calculer(1650.0, &plan_100(), &[], &reglages());
        assert_eq!(b.premiere_rupture, d.premiere_rupture.map(|x| x - Duration::days(1)));
        assert!(cle_tri(&b) < cle_tri(&d));
        // À rupture égale, la date limite de commande départage : délai 5 j, commander le J6.
        let mut r5 = reglages();
        r5.delai_j = 5;
        let e = calculer(1550.0, &plan_100(), &[], &r5);
        assert_eq!(e.premiere_rupture, b.premiere_rupture);
        assert_eq!(e.propositions[0].date_limite_commande, j(6));
        assert!(cle_tri(&b) < cle_tri(&e));
    }

    #[test]
    fn delai_au_dela_de_l_horizon() {
        let mut r = reglages();
        r.delai_j = 400;
        let c = calculer(100.0, &plan_100(), &[], &r);
        assert!(c.propositions.is_empty());
        assert!(c.motif_sans_proposition.unwrap().contains("délai"));
    }
}
