//! LE MOTEUR DE COUVERTURE, v2 : LA COUVERTURE CIBLE (spécification du
//! 27/10/2026, `docs/A-DECIDER-of-supply-chain.md` § 15, décisions du soir).
//!
//! Calcul PUR, sur des structures en mémoire : il ne lit ni n'écrit la base
//! (la lecture est dans `routes/couverture.rs`). Sa première proposition par
//! référence est celle que la génération du plan d'achat enregistre
//! (`domain/plan_achat.rs`) et que « Commander » envoie au bon.
//!
//! NOTATIONS (§ 15.1). Le jour 0 est AUJOURD'HUI ; tout se compte en jours entiers.
//!
//! * p(t) : le plan DATÉ du jour t (photo `besoin_mrp` du plan en service, kg du
//!   mois ÷ jours réels du mois ; le mois en cours depuis aujourd'hui).
//!   P(a, b) = Σ p(t), t ∈ [a, b[ : LA SEULE MESURE DU BESOIN. Aucune moyenne.
//! * B(t) : le solde au soir du jour t = S0 + Σ_{k ≤ t} (A(k) − p(k)), SANS
//!   plafonner à 0. b(t) = B(t − 1) − p(t) : le point bas du jour, AVANT ses
//!   arrivages (b(0) = S0 − p(0)).
//! * R : la première rupture, premier t tel que B(t) < 0 ; reste(R) = B(R − 1).
//! * C : couverture cible (jours = 30 × mois de la fiche), L : délai, N :
//!   couverture d'une commande, S : jours de sécurité de la classe ABC.
//!   NS(t) = P(t + 1, t + 1 + S) : le seuil de sécurité du jour t, en kg du plan.
//! * D* = R − C (date de besoin) ; D = max(D*, L) (réception possible) ; date
//!   limite de commande = D* − L ; fenêtre [R, R + N[, ou [D, D + N[ si D > R.
//! * Q0 = besoin net de la fenêtre = min Q tel que, Q reçu en D, aucune rupture
//!   avant la fin de la fenêtre (le plus grand manque de la fenêtre). LA FORMULE
//!   EST DÉMONTRÉE ET FIGÉE (§ 15.6) : elle ne se modifie plus.
//! * X = max_{t ∈ [0, L]} min(NS(t), NS(t) − b(t))⁺ : la sécurité, ajoutée à la
//!   1re proposition seulement. Q = arrondi(Q0 + X) (minimum, multiple, palette).
//!
//! C ≠ N ≠ S ≠ stock minimum : la cible fixe la DATE, N la QUANTITÉ, S un
//! complément X s'il y a un creux, le stock minimum un SIGNAL, jamais une
//! quantité. Le moteur propose, l'utilisateur décide.

use chrono::{Datelike, Duration, NaiveDate};
use serde::Serialize;
use std::collections::HashMap;

/// Tolérance de comparaison des kilos (les consommations journalières sont des
/// quotients : 3 100 kg / 31 j ne tombe pas toujours juste en flottant).
const EPS: f64 = 1e-6;

/// Nombre de propositions enchaînées au plus (au-delà, le calcul le dit).
pub const MAX_PROPOSITIONS: usize = 12;

/// D'où vient une valeur de réglage (délai, couverture, cible) : affichée à l'écran.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Source {
    #[serde(rename = "fournisseur")]
    Fournisseur,
    #[serde(rename = "paramètre global")]
    ParametreGlobal,
    /// La fiche article (la couverture cible, 27/10/2026).
    #[serde(rename = "fiche article")]
    Fiche,
    /// Une hypothèse de l'espace « Simulation » : saisie à l'écran, jamais enregistrée.
    #[serde(rename = "simulation")]
    Simulation,
}

/// L'ÉTAT d'une référence (§ 15.4), calculé SANS proposition ; le plus grave
/// l'emporte. Les signaux sont à part (`signal`).
pub mod etat {
    /// R < aujourd'hui + L : aucune commande passée aujourd'hui n'arrive à temps.
    pub const RUPTURE_INEVITABLE: &str = "RUPTURE_INEVITABLE";
    /// X > 0 : un creux sous NS dans [aujourd'hui, aujourd'hui + L].
    pub const SOUS_SECURITE: &str = "SOUS_SECURITE";
    /// La couverture actuelle est sous la cible C.
    pub const SOUS_CIBLE: &str = "SOUS_CIBLE";
    /// La couverture actuelle atteint la cible (y compris sans rupture sur l'horizon).
    pub const COUVERT: &str = "COUVERT";
}

/// LES SIGNAUX (§ 15.4), indépendants de l'état : ils ne bloquent jamais.
pub mod signal {
    /// Article soumis au MRP sans couverture cible : configuration incomplète, aucune proposition.
    pub const CIBLE_NON_DEFINIE: &str = "CIBLE_NON_DEFINIE";
    /// Le point bas passe sous le stock minimum dans [aujourd'hui, aujourd'hui + L] : vérifier le plan.
    pub const SOUS_MINIMUM: &str = "SOUS_MINIMUM";
    /// La date limite de commande est passée : la réception arrive après la date de besoin.
    pub const RETARD_CIBLE: &str = "RETARD_CIBLE";
    /// L'horizon du plan s'arrête avant aujourd'hui + C : trop court pour juger la cible.
    pub const HORIZON_COURT: &str = "HORIZON_COURT";
    /// Une donnée de la fiche manque (classe ABC…) : un réglage par défaut a servi.
    pub const DEFAUT_DONNEES: &str = "DEFAUT_DONNEES";
}

/// Un mois du plan pour une référence : les kilos de la photo `besoin_mrp`.
#[derive(Debug, Clone, Copy)]
pub struct MoisPlan {
    pub annee: i32,
    pub mois: u32,
    pub kg: f64,
}

/// Un arrivage COMPTÉ (daté). Hors de [aujourd'hui, fin de l'horizon], ignoré.
#[derive(Debug, Clone, Copy)]
pub struct Arrivee {
    pub date: NaiveDate,
    pub kg: f64,
}

/// Les réglages d'une référence, déjà résolus (fiche, fournisseur, paramètres).
#[derive(Debug, Clone)]
pub struct Reglages {
    pub aujourdhui: NaiveDate,
    /// Dernier jour de l'horizon, INCLUS (fin du plan en service) : H.
    pub fin_horizon: NaiveDate,
    /// L, le délai fournisseur (jours).
    pub delai_j: i64,
    /// N, la couverture d'une commande (jours).
    pub couverture_j: i64,
    /// S, les jours de sécurité de la classe ABC.
    pub jours_securite: i64,
    /// C, la couverture cible (jours) ; `None` : non définie (aucune proposition).
    pub cible_j: Option<i64>,
    /// Le stock minimum de la fiche : un garde-fou, un signal seulement.
    pub stock_min_kg: Option<f64>,
    /// Soumis au MRP : actif ET présent dans le besoin du plan en service (§ 15.9 bis-1).
    pub soumis_mrp: bool,
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
    /// B(t), le solde au soir du jour, sans plafond à zéro.
    pub solde_kg: f64,
    /// b(t), le point bas du jour, avant ses arrivages.
    pub point_bas_kg: f64,
    /// NS(t), le seuil de sécurité du jour : le plan des S jours suivants.
    pub securite_kg: f64,
    /// La part du plan du jour que le solde ne couvre pas : min(p(t), (−B(t))⁺).
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

/// Un signal, avec sa date quand il en a une, dit en clair.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Signal {
    pub code: &'static str,
    pub date: Option<NaiveDate>,
    pub message: String,
}

/// LA SÉCURITÉ (§ 15.3-4) : le creux sous NS dans [aujourd'hui, aujourd'hui + L].
#[derive(Debug, Clone, Serialize)]
pub struct Securite {
    /// S, les jours de sécurité.
    pub jours: i64,
    /// X > 0 : la sécurité est appliquée à la 1re proposition.
    pub appliquee: bool,
    /// X, la profondeur du creux le plus bas, plafonnée à NS.
    pub x_kg: f64,
    /// tS, le premier jour de franchissement (b(t) < NS(t)), son point bas et son seuil.
    pub premier_franchissement: Option<NaiveDate>,
    pub point_bas_franchissement_kg: Option<f64>,
    pub seuil_franchissement_kg: Option<f64>,
    /// Le jour du creux le plus bas, son point bas b et son seuil NS.
    pub jour_creux: Option<NaiveDate>,
    pub point_bas_creux_kg: Option<f64>,
    pub seuil_creux_kg: Option<f64>,
}

/// LE STOCK MINIMUM (§ 15.3-5) : un garde-fou, jamais une quantité.
#[derive(Debug, Clone, Serialize)]
pub struct StockMinimum {
    pub kg: Option<f64>,
    /// Le 1er jour de [aujourd'hui, aujourd'hui + L] où b(t) passe sous le minimum.
    pub franchi_le: Option<NaiveDate>,
    pub point_bas_kg: Option<f64>,
}

/// UNE FENÊTRE de commande : une rupture R, sa date de besoin, sa réception et
/// son besoin net Q0. Une proposition en a une ; une proposition CONSOLIDÉE
/// (cible déjà en retard, § 15.9 bis-2) en a plusieurs, reçues le même jour.
#[derive(Debug, Clone, Serialize)]
pub struct Fenetre {
    /// R, la rupture que la fenêtre traite.
    pub date_rupture: NaiveDate,
    /// D* = R − C (peut être passée).
    pub date_besoin: NaiveDate,
    /// D = max(D*, aujourd'hui + L).
    pub date_disponibilite: NaiveDate,
    /// D* − L (peut être passée).
    pub date_limite_commande: NaiveDate,
    /// D > D* : la réception arrive après la date de besoin.
    pub en_retard: bool,
    /// D > R : la rupture arrive avant toute réception possible.
    pub rupture_inevitable: bool,
    /// Le manque d'avant D quand la rupture est inévitable : affiché, pas commandé.
    pub manque_inevitable_kg: f64,
    /// La fenêtre [debut, fin[ : [R, R + N[ ou [D, D + N[ (bornée à l'horizon).
    pub debut: NaiveDate,
    pub fin: NaiveDate,
    pub dernier_jour_couvert: NaiveDate,
    pub jours: i64,
    pub bornee_horizon: bool,
    /// P(fenêtre).
    pub plan_kg: f64,
    /// Le stock au début de la fenêtre : reste(R), ou le stock au début de D si D > R.
    pub reste_kg: f64,
    /// Les arrivages datés et comptés de la fenêtre.
    pub arrivages_kg: f64,
    /// Q0.
    pub besoin_net_kg: f64,
}

/// Une proposition « À commander » : Q0 (besoin net) + X (sécurité) + arrondi = Q.
#[derive(Debug, Clone, Serialize)]
pub struct Proposition {
    pub rang: usize,
    /// Plusieurs fenêtres reçues le même jour (aujourd'hui + L), fusionnées.
    pub consolidee: bool,
    pub date_rupture: NaiveDate,
    pub date_besoin: NaiveDate,
    pub date_disponibilite: NaiveDate,
    pub date_limite_commande: NaiveDate,
    pub en_retard: bool,
    pub rupture_inevitable: bool,
    pub manque_inevitable_kg: f64,
    pub date_debut_fenetre: NaiveDate,
    pub date_fin_fenetre: NaiveDate,
    pub dernier_jour_couvert: NaiveDate,
    pub jours_fenetre: i64,
    pub fenetre_bornee_horizon: bool,
    pub plan_fenetre_kg: f64,
    pub reste_kg: f64,
    pub arrivages_fenetre_kg: f64,
    /// Q0 (somme des fenêtres d'une proposition consolidée).
    pub besoin_net_kg: f64,
    /// X, la sécurité (1re proposition seulement).
    pub securite_kg: f64,
    pub moq_kg: Option<f64>,
    pub apres_minimum_kg: f64,
    pub multiple_kg: Option<f64>,
    /// Ce que le minimum et le multiple ajoutent : Q − Q0 − X.
    pub arrondi_kg: f64,
    pub quantite_proposee_kg: f64,
    pub palettes_equivalentes: Option<f64>,
    /// Le stock projeté au soir de D, la commande reçue.
    pub stock_apres_reception_kg: f64,
    /// Le stock projeté à la fin de la fenêtre (au soir de son dernier jour).
    pub stock_fin_fenetre_kg: f64,
    pub fenetres: Vec<Fenetre>,
}

/// Le résultat du moteur pour une référence.
#[derive(Debug, Clone, Serialize)]
pub struct Couverture {
    pub stock_initial_kg: f64,
    pub plan_horizon_kg: f64,
    pub plan_non_couvert_kg: f64,
    /// R, la première rupture (sans proposition).
    pub premiere_rupture: Option<NaiveDate>,
    /// La veille de R ; la fin de l'horizon sans rupture ; `None` si R = aujourd'hui.
    pub couvert_jusqu_au: Option<NaiveDate>,
    pub couvert_tout_horizon: bool,
    /// LA COUVERTURE ACTUELLE : R − aujourd'hui, en jours ; `None` sans rupture sur l'horizon.
    pub couverture_actuelle_j: Option<i64>,
    /// reste(R) = B(R − 1).
    pub reste_rupture_kg: Option<f64>,
    /// C, la cible (jours).
    pub cible_j: Option<i64>,
    /// L'écart : couverture actuelle − C (jours).
    pub ecart_cible_j: Option<i64>,
    /// D* = R − C, et la date limite D* − L (sans proposition).
    pub date_besoin: Option<NaiveDate>,
    pub date_limite_commande: Option<NaiveDate>,
    /// tS : le 1er jour sous NS dans [aujourd'hui, aujourd'hui + L].
    pub premier_passage_securite: Option<NaiveDate>,
    pub securite: Securite,
    pub stock_minimum: StockMinimum,
    pub etat: &'static str,
    pub signaux: Vec<Signal>,
    pub jours: Vec<Jour>,
    pub evenements: Vec<Evenement>,
    pub propositions: Vec<Proposition>,
    pub propositions_plafonnees: bool,
    pub motif_sans_proposition: Option<&'static str>,
}

/// LA RAISON DE L'ÉTAT, en une phrase chiffrée (27/10/2026) : ce que l'écran
/// montre à côté de l'état (en-tête de la fenêtre, infobulle de la liste).
pub fn raison_etat(c: &Couverture, aujourdhui: NaiveDate, delai_j: i64) -> String {
    let jour = |d: NaiveDate| d.format("%d/%m/%Y").to_string();
    let kg = |v: f64| format!("{}", v.round() as i64);
    let ecart = |e: i64| if e > 0 { format!("+{e}") } else { format!("{e}") };
    let couvre = || match c.couverture_actuelle_j {
        Some(j) => format!("couvre {j} j"),
        None => format!("aucune rupture sur l'horizon (plus de {} j)", c.jours.len().saturating_sub(1)),
    };
    let cible = || match (c.cible_j, c.ecart_cible_j) {
        (Some(cj), Some(e)) => format!("cible {cj} j ({} j)", ecart(e)),
        (Some(cj), None) => format!("cible {cj} j"),
        _ => "cible non définie".to_string(),
    };
    match c.etat {
        etat::RUPTURE_INEVITABLE => format!(
            "rupture le {}, avant la 1re réception possible le {}",
            c.premiere_rupture.map(jour).unwrap_or_default(),
            jour(aujourdhui + Duration::days(delai_j.max(0)))
        ),
        etat::SOUS_SECURITE => format!(
            "creux sous la sécurité le {} : {} kg pour {} kg",
            c.securite.premier_franchissement.map(jour).unwrap_or_default(),
            kg(c.securite.point_bas_franchissement_kg.unwrap_or(0.0)),
            kg(c.securite.seuil_franchissement_kg.unwrap_or(0.0))
        ),
        _ => format!("{}, {}", couvre(), cible()),
    }
}

/// Arrondi à 4 décimales (kg).
fn r4(v: f64) -> f64 {
    // « + 0.0 » efface le zéro négatif (−0,00001 arrondi s'afficherait « -0 »).
    (v * 10_000.0).round() / 10_000.0 + 0.0
}

/// L'ORDRE DE LA LISTE « À COMMANDER » : d'abord la première rupture la plus
/// proche (une rupture aujourd'hui en tête, une référence sans rupture en
/// dernier), puis la date limite de commande (D* − L, celle de la 1re proposition).
pub fn cle_tri(c: &Couverture) -> (NaiveDate, NaiveDate) {
    (
        c.premiere_rupture.unwrap_or(NaiveDate::MAX),
        c.date_limite_commande.unwrap_or(NaiveDate::MAX),
    )
}

/// LE PLAN DES `jours` PREMIERS JOURS — [aujourd'hui, aujourd'hui + jours[ —,
/// lu sur les jours du moteur : avec le délai, le « besoin jusqu'à livraison ».
pub fn plan_des_premiers_jours(c: &Couverture, jours: i64) -> f64 {
    let k = (jours.max(0) as usize).min(c.jours.len());
    r4(c.jours[..k].iter().map(|j| j.conso_prevue_kg).sum())
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

/// B(t) pour t ∈ [0, n[ : S0 + Σ_{k ≤ t} (entrées(k) − p(k)), sans plafond.
fn soldes(stock: f64, conso: &[f64], entrees: &[f64]) -> Vec<f64> {
    let mut b = Vec::with_capacity(conso.len());
    let mut s = stock;
    for (c, a) in conso.iter().zip(entrees) {
        s += a - c;
        b.push(s);
    }
    b
}

/// B(t − 1), avec B(−1) = S0.
fn veille(stock: f64, b: &[f64], t: usize) -> f64 {
    if t == 0 {
        stock
    } else {
        b[t - 1]
    }
}

/// UNE FENÊTRE CALCULÉE sur la projection courante (indices de jours).
#[derive(Debug, Clone)]
struct Calcul {
    r: usize,
    d_etoile: i64,
    d: usize,
    debut: usize,
    fin: usize,
    manque: f64,
    reste: f64,
    q0: f64,
}

/// Q0 d'une rupture `r` sur la projection `b` : la fenêtre [R, R + N[, ou
/// [D, D + N[ si D > R ; Q0 = le plus grand manque de la fenêtre (§ 15.6).
/// Quand la rupture est inévitable (D > R), le manque d'avant D est affiché,
/// pas commandé : le stock au début de D est compté à zéro au plus bas.
fn fenetre_de(stock: f64, b: &[f64], r: usize, cible: i64, delai: usize, couv: usize) -> Calcul {
    let n = b.len();
    let d_etoile = r as i64 - cible;
    let d = d_etoile.max(delai as i64) as usize;
    if d >= n {
        // Aucune réception possible dans l'horizon : l'appelant le dit.
        return Calcul { r, d_etoile, d, debut: n, fin: n, manque: 0.0, reste: 0.0, q0: 0.0 };
    }
    let (debut, manque, reste) = if d > r {
        let avant = veille(stock, b, d);
        (d, (-avant).max(0.0), avant.max(0.0))
    } else {
        (r, 0.0, veille(stock, b, r))
    };
    let fin = (debut + couv).min(n);
    let q0 = (debut..fin).map(|k| -(b[k] + manque)).fold(0.0_f64, f64::max);
    Calcul { r, d_etoile, d, debut, fin, manque, reste, q0 }
}

/// Calcule la couverture d'une référence à partir du plan MENSUEL (la photo
/// `besoin_mrp`), réparti au jour.
pub fn calculer(stock_initial: f64, plan: &[MoisPlan], arrivees: &[Arrivee], r: &Reglages) -> Couverture {
    let auj = r.aujourdhui;
    // Un plan déjà terminé ne projette rien : un seul jour, sans consommation.
    let fin = r.fin_horizon.max(auj);
    let n = ((fin - auj).num_days() + 1) as usize;
    let date = |i: usize| auj + Duration::days(i as i64);
    let mut par_mois: HashMap<(i32, u32), f64> = HashMap::new();
    for m in plan {
        *par_mois.entry((m.annee, m.mois)).or_default() += m.kg;
    }
    let conso: Vec<f64> = (0..n)
        .map(|i| {
            let d = date(i);
            par_mois
                .get(&(d.year(), d.month()))
                .filter(|kg| **kg > 0.0)
                .map_or(0.0, |kg| kg / jours_du_mois(d.year(), d.month()) as f64)
        })
        .collect();
    let mut arr = vec![0.0; n];
    for a in arrivees {
        let k = (a.date - auj).num_days();
        if k >= 0 && (k as usize) < n && a.kg > 0.0 {
            arr[k as usize] += a.kg;
        }
    }
    calculer_jours(stock_initial, &conso, &arr, r)
}

/// LE MOTEUR, sur le plan et les arrivages DÉJÀ DATÉS au jour : `conso[t]` = p(t),
/// `arr[t]` = A(t), t ∈ [0, n[ (le jour 0 est aujourd'hui, n − 1 la fin de l'horizon).
pub fn calculer_jours(stock: f64, conso: &[f64], arr: &[f64], r: &Reglages) -> Couverture {
    let auj = r.aujourdhui;
    let n = conso.len().max(1);
    let conso: Vec<f64> = (0..n).map(|i| conso.get(i).copied().unwrap_or(0.0)).collect();
    let arr: Vec<f64> = (0..n).map(|i| arr.get(i).copied().unwrap_or(0.0)).collect();
    let date = |i: usize| auj + Duration::days(i as i64);
    let datei = |i: i64| auj + Duration::days(i);

    let mut cumul = vec![0.0; n + 1];
    for (i, c) in conso.iter().enumerate() {
        cumul[i + 1] = cumul[i] + c;
    }
    let plan = |a: usize, b: usize| cumul[b.min(n)] - cumul[a.min(n)];
    let delai = r.delai_j.max(0) as usize;
    let couv = r.couverture_j.max(1) as usize;
    let s_j = r.jours_securite.max(0) as usize;
    let cible = r.cible_j.map(|c| c.max(0));

    // ---- La projection sans proposition ----------------------------------------
    let b = soldes(stock, &conso, &arr);
    let point_bas: Vec<f64> = (0..n).map(|t| veille(stock, &b, t) - conso[t]).collect();
    let ns: Vec<f64> = (0..n).map(|t| plan(t + 1, t + 1 + s_j)).collect();
    let r0 = (0..n).find(|&t| b[t] < -EPS);
    let lim = delai.min(n - 1);

    // ---- La sécurité : le creux sous NS dans [0, L] ----------------------------
    let mut x = 0.0_f64;
    let (mut t_s, mut t_creux) = (None, None);
    for t in 0..=lim {
        if t_s.is_none() && point_bas[t] < ns[t] - EPS {
            t_s = Some(t);
        }
        let v = ns[t].min(ns[t] - point_bas[t]).max(0.0);
        if v > x + EPS {
            x = v;
            t_creux = Some(t);
        }
    }
    let securite = Securite {
        jours: s_j as i64,
        appliquee: x > EPS,
        x_kg: r4(x),
        premier_franchissement: t_s.map(date),
        point_bas_franchissement_kg: t_s.map(|t| r4(point_bas[t])),
        seuil_franchissement_kg: t_s.map(|t| r4(ns[t])),
        jour_creux: t_creux.map(date),
        point_bas_creux_kg: t_creux.map(|t| r4(point_bas[t])),
        seuil_creux_kg: t_creux.map(|t| r4(ns[t])),
    };

    // ---- Le stock minimum : un signal, jamais une quantité ---------------------
    let smin = r.stock_min_kg.filter(|m| *m > 0.0);
    let t_min = smin.and_then(|m| (0..=lim).find(|&t| point_bas[t] < m - EPS));
    let stock_minimum = StockMinimum {
        kg: smin,
        franchi_le: t_min.map(date),
        point_bas_kg: t_min.map(|t| r4(point_bas[t])),
    };

    // ---- L'état (sans proposition ; le plus grave l'emporte) -------------------
    let etat = match (r0, cible) {
        (Some(rr), _) if rr < delai => etat::RUPTURE_INEVITABLE,
        _ if x > EPS => etat::SOUS_SECURITE,
        // Sans cible, la rupture reste visible dans l'état (§ 15.9-1).
        (Some(rr), Some(c)) if (rr as i64) < c => etat::SOUS_CIBLE,
        (Some(_), None) => etat::SOUS_CIBLE,
        _ => etat::COUVERT,
    };

    // ---- Les signaux ------------------------------------------------------------
    let mut signaux = Vec::new();
    if cible.is_none() && r.soumis_mrp {
        signaux.push(Signal {
            code: signal::CIBLE_NON_DEFINIE,
            date: None,
            message: "configuration MRP incomplète : la fiche article n'a pas de couverture cible ; aucune proposition".into(),
        });
    }
    if let (Some(t), Some(m)) = (t_min, smin) {
        signaux.push(Signal {
            code: signal::SOUS_MINIMUM,
            date: Some(date(t)),
            message: format!(
                "le point bas passe sous le stock minimum ({} kg) le {} ({} kg) : vérifier le plan",
                m.round() as i64,
                date(t).format("%d/%m/%Y"),
                point_bas[t].round() as i64
            ),
        });
    }
    if let (Some(rr), Some(c)) = (r0, cible) {
        let d_etoile = rr as i64 - c;
        if d_etoile < delai as i64 {
            signaux.push(Signal {
                code: signal::RETARD_CIBLE,
                date: Some(datei(d_etoile - delai as i64)),
                message: format!(
                    "date limite de commande dépassée ({}) : la réception arrive après la date de besoin ({})",
                    datei(d_etoile - delai as i64).format("%d/%m/%Y"),
                    datei(d_etoile).format("%d/%m/%Y")
                ),
            });
        }
    }
    if let Some(c) = cible.filter(|_| r.soumis_mrp) {
        if ((n - 1) as i64) < c {
            signaux.push(Signal {
                code: signal::HORIZON_COURT,
                date: Some(date(n - 1)),
                message: format!(
                    "le plan s'arrête le {} : trop court pour juger une cible de {c} j",
                    date(n - 1).format("%d/%m/%Y")
                ),
            });
        }
    }

    // ---- Les événements ---------------------------------------------------------
    let mut evenements = Vec::new();
    let (mut c_acc, mut a_acc, mut d_acc) = (0.0, 0.0, 0.0);
    let non_couvert: Vec<f64> = (0..n).map(|t| conso[t].min((-b[t]).max(0.0))).collect();
    for i in 0..n {
        c_acc += conso[i];
        a_acc += arr[i];
        d_acc += non_couvert[i];
        let d = date(i);
        let mut natures = Vec::new();
        if i == 0 {
            natures.push(nature::AUJOURDHUI);
        }
        if arr[i] > EPS {
            natures.push(nature::ARRIVAGE);
        }
        let negatif = b[i] < -EPS;
        let veille_negatif = i > 0 && b[i - 1] < -EPS;
        if negatif && !veille_negatif {
            natures.push(nature::RUPTURE);
        } else if !negatif && veille_negatif {
            natures.push(nature::REPRISE);
        }
        let sous = point_bas[i] < ns[i] - EPS;
        let veille_sous = i > 0 && point_bas[i - 1] < ns[i - 1] - EPS;
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
                solde_apres_kg: r4(b[i]),
                securite_kg: r4(ns[i]),
                plan_non_couvert_kg: r4(d_acc),
            });
            c_acc = 0.0;
            a_acc = 0.0;
            d_acc = 0.0;
        }
    }

    // ---- Les propositions -------------------------------------------------------
    let mut propositions: Vec<Proposition> = Vec::new();
    let mut plafonnees = false;
    let mut motif_sans_proposition = None;
    if r0.is_none() {
        motif_sans_proposition = Some("aucune rupture sur l'horizon du plan");
    } else if let Some(c) = cible {
        // arr_p : arrivages comptés + propositions placées ; radie : le manque
        // inévitable d'avant D, radié à D (affiché, jamais commandé).
        let mut arr_p = arr.clone();
        let mut radie = vec![0.0; n];
        let projeter = |arr_p: &[f64], radie: &[f64]| {
            let e: Vec<f64> = arr_p.iter().zip(radie).map(|(a, z)| a + z).collect();
            soldes(stock, &conso, &e)
        };
        let mut debut = 0usize;
        loop {
            let bp = projeter(&arr_p, &radie);
            let Some(rr) = (debut..n).find(|&t| bp[t] < -EPS) else { break };
            let premier = fenetre_de(stock, &bp, rr, c, delai, couv);
            if premier.d >= n {
                if propositions.is_empty() {
                    motif_sans_proposition =
                        Some("aujourd'hui + délai, ou la date de besoin, tombe au-delà de l'horizon du plan");
                }
                break;
            }
            if propositions.len() >= r.max_propositions {
                plafonnees = true;
                break;
            }
            let d = premier.d;
            // LA CONSOLIDATION (§ 15.9 bis-2) : les fenêtres dont la réception tombe
            // à aujourd'hui + L (cible déjà en retard) sont reçues ensemble, en une
            // proposition dont Q0 est la somme ; X et l'arrondi s'appliquent une fois.
            let mut fenetres = vec![premier];
            {
                let w = &fenetres[0];
                arr_p[d] += w.q0;
                radie[d] += w.manque;
            }
            if d == delai {
                loop {
                    let bq = projeter(&arr_p, &radie);
                    let Some(r2) = (d..n).find(|&t| bq[t] < -EPS) else { break };
                    let w = fenetre_de(stock, &bq, r2, c, delai, couv);
                    if w.d != delai {
                        break;
                    }
                    arr_p[d] += w.q0;
                    radie[d] += w.manque;
                    fenetres.push(w);
                }
            }
            let q0: f64 = fenetres.iter().map(|w| w.q0).sum();
            let x_ici = if propositions.is_empty() { x } else { 0.0 };
            let brut = q0 + x_ici;
            debut = d;
            if brut <= EPS {
                // Un arrivage couvre déjà la fenêtre : rien à commander ici.
                continue;
            }
            let moq = r.moq_kg.filter(|m| *m > 0.0);
            let apres_minimum = moq.map_or(brut, |m| brut.max(m));
            let multiple = r.multiple_kg.filter(|m| *m > 0.0);
            let quantite = match multiple {
                Some(m) => (apres_minimum / m - 1e-9).ceil() * m,
                None => apres_minimum,
            };
            arr_p[d] += quantite - q0;
            let apres = projeter(&arr_p, &radie);
            let (w0, wn) = (&fenetres[0], fenetres.last().expect("une fenêtre au moins"));
            let fenetres_json: Vec<Fenetre> = fenetres
                .iter()
                .map(|w| Fenetre {
                    date_rupture: date(w.r),
                    date_besoin: datei(w.d_etoile),
                    date_disponibilite: date(w.d),
                    date_limite_commande: datei(w.d_etoile - delai as i64),
                    en_retard: (w.d as i64) > w.d_etoile,
                    rupture_inevitable: w.d > w.r,
                    manque_inevitable_kg: r4(w.manque),
                    debut: date(w.debut),
                    fin: date(w.fin),
                    dernier_jour_couvert: date(w.fin - 1),
                    jours: (w.fin - w.debut) as i64,
                    bornee_horizon: w.debut + couv > n,
                    plan_kg: r4(plan(w.debut, w.fin)),
                    reste_kg: r4(w.reste),
                    arrivages_kg: r4(arr[w.debut..w.fin].iter().sum()),
                    besoin_net_kg: r4(w.q0),
                })
                .collect();
            propositions.push(Proposition {
                rang: propositions.len() + 1,
                consolidee: fenetres.len() > 1,
                date_rupture: date(w0.r),
                date_besoin: datei(w0.d_etoile),
                date_disponibilite: date(d),
                date_limite_commande: datei(w0.d_etoile - delai as i64),
                en_retard: (d as i64) > w0.d_etoile,
                rupture_inevitable: fenetres.iter().any(|w| w.d > w.r),
                manque_inevitable_kg: r4(fenetres.iter().map(|w| w.manque).sum()),
                date_debut_fenetre: date(w0.debut),
                date_fin_fenetre: date(wn.fin),
                dernier_jour_couvert: date(wn.fin - 1),
                jours_fenetre: fenetres.iter().map(|w| (w.fin - w.debut) as i64).sum(),
                fenetre_bornee_horizon: wn.debut + couv > n,
                plan_fenetre_kg: r4(fenetres.iter().map(|w| plan(w.debut, w.fin)).sum()),
                reste_kg: r4(w0.reste),
                arrivages_fenetre_kg: r4(fenetres.iter().map(|w| arr[w.debut..w.fin].iter().sum::<f64>()).sum()),
                besoin_net_kg: r4(q0),
                securite_kg: r4(x_ici),
                moq_kg: moq,
                apres_minimum_kg: r4(apres_minimum),
                multiple_kg: multiple,
                arrondi_kg: r4(quantite - brut),
                quantite_proposee_kg: r4(quantite),
                palettes_equivalentes: r
                    .kg_palette
                    .filter(|p| *p > 0.0)
                    .map(|p| (quantite / p * 100.0).round() / 100.0),
                stock_apres_reception_kg: r4(apres[d]),
                stock_fin_fenetre_kg: r4(apres[wn.fin - 1]),
                fenetres: fenetres_json,
            });
        }
    } else {
        motif_sans_proposition = Some("couverture cible non définie sur la fiche article : aucune proposition");
    }

    let jours = (0..n)
        .map(|i| Jour {
            date: date(i),
            conso_prevue_kg: r4(conso[i]),
            arrivee_kg: r4(arr[i]),
            solde_kg: r4(b[i]),
            point_bas_kg: r4(point_bas[i]),
            securite_kg: r4(ns[i]),
            plan_non_couvert_kg: r4(non_couvert[i]),
        })
        .collect();

    let (couvert_jusqu_au, couvert_tout_horizon) = match r0 {
        None => (Some(date(n - 1)), true),
        Some(0) => (None, false),
        Some(i) => (Some(date(i - 1)), false),
    };
    Couverture {
        stock_initial_kg: r4(stock),
        plan_horizon_kg: r4(cumul[n]),
        plan_non_couvert_kg: r4(non_couvert.iter().sum()),
        premiere_rupture: r0.map(date),
        couvert_jusqu_au,
        couvert_tout_horizon,
        couverture_actuelle_j: r0.map(|t| t as i64),
        reste_rupture_kg: r0.map(|t| r4(veille(stock, &b, t))),
        cible_j: cible,
        ecart_cible_j: match (r0, cible) {
            (Some(t), Some(c)) => Some(t as i64 - c),
            _ => None,
        },
        date_besoin: match (r0, cible) {
            (Some(t), Some(c)) => Some(datei(t as i64 - c)),
            _ => None,
        },
        date_limite_commande: match (r0, cible) {
            (Some(t), Some(c)) => Some(datei(t as i64 - c - delai as i64)),
            _ => None,
        },
        premier_passage_securite: t_s.map(date),
        securite,
        stock_minimum,
        etat,
        signaux,
        jours,
        evenements,
        propositions,
        propositions_plafonnees: plafonnees,
        motif_sans_proposition,
    }
}

// ============================================================================
// Lectures AU PLAN, tirées du moteur
// ============================================================================

/// « TROP TARD POUR COMMANDER » : la première rupture du plan tombe avant qu'une
/// commande passée aujourd'hui puisse arriver (aujourd'hui + délai) — l'état
/// RUPTURE_INEVITABLE.
pub fn trop_tard_pour_commander(premiere_rupture: Option<NaiveDate>, aujourdhui: NaiveDate, delai_j: i64) -> bool {
    premiere_rupture.is_some_and(|r| r < aujourdhui + Duration::days(delai_j.max(0)))
}

/// LA COUVERTURE DU STOCK, au moteur : la moyenne des jours couverts (jusqu'à la
/// première rupture ; `None` = couvert sur tout l'horizon, compté pour
/// `horizon_j`), pondérée par la valeur en stock de chaque référence.
pub fn couverture_ponderee(lignes: &[(Option<i64>, f64)], horizon_j: i64) -> Option<f64> {
    let (mut somme, mut poids) = (0.0_f64, 0.0_f64);
    for (jours, p) in lignes {
        if *p > 0.0 {
            somme += jours.unwrap_or(horizon_j).max(0) as f64 * p;
            poids += p;
        }
    }
    (poids > 0.0).then(|| (somme / poids * 10.0).round() / 10.0)
}

/// L'ÉCONOMIE AU PLAN d'une référence : l'écart entre son prix et le moins cher
/// de son groupe d'équivalence, appliqué au plan des douze prochains mois (plan /
/// mois du moteur × 12). Une projection : une borne haute, jamais un constat.
pub fn economie_au_plan(prix_actuel: f64, prix_min: f64, plan_mois_kg: f64) -> (f64, f64) {
    let kg = (plan_mois_kg.max(0.0) * 12.0 * 10_000.0).round() / 10_000.0;
    let ecart = (prix_actuel - prix_min).max(0.0);
    (kg + 0.0, (ecart * kg * 100.0).round() / 100.0 + 0.0)
}

#[cfg(test)]
mod tests_au_plan {
    use super::*;

    fn d(j: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, j).unwrap()
    }

    #[test]
    fn trop_tard_quand_la_rupture_precede_l_arrivee_possible() {
        assert!(trop_tard_pour_commander(Some(d(5)), d(1), 10));
        assert!(trop_tard_pour_commander(Some(d(10)), d(1), 10));
        assert!(!trop_tard_pour_commander(Some(d(11)), d(1), 10));
        assert!(!trop_tard_pour_commander(Some(d(20)), d(1), 10));
        assert!(!trop_tard_pour_commander(None, d(1), 10));
        assert!(!trop_tard_pour_commander(Some(d(1)), d(1), -3));
        assert!(trop_tard_pour_commander(Some(d(1)), d(2), -3));
    }

    #[test]
    fn couverture_ponderee_par_la_valeur() {
        assert_eq!(couverture_ponderee(&[(Some(10), 1000.0), (None, 3000.0)], 100), Some(77.5));
        assert_eq!(couverture_ponderee(&[(Some(10), 1000.0), (Some(500), 0.0)], 100), Some(10.0));
        assert_eq!(couverture_ponderee(&[(Some(10), 0.0)], 100), None);
        assert_eq!(couverture_ponderee(&[], 100), None);
    }

    #[test]
    fn economie_au_plan_des_douze_mois() {
        assert_eq!(economie_au_plan(12.0, 10.0, 100.0), (1200.0, 2400.0));
        assert_eq!(economie_au_plan(10.0, 10.0, 100.0), (1200.0, 0.0));
        assert_eq!(economie_au_plan(12.0, 10.0, 0.0), (0.0, 0.0));
    }
}

/// LES CAS DE TEST DE LA SPÉCIFICATION (§ 15.6, § 15.7, § 15.9 bis), aux chiffres
/// exacts. Réglages communs : C = 60 j, N = 30 j, L = 30 j, S = 30 j.
#[cfg(test)]
mod tests {
    use super::*;

    /// L'horizon des cas : 400 jours.
    const H: usize = 400;

    fn auj() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 1, 1).unwrap()
    }
    /// J+k.
    fn j(k: i64) -> NaiveDate {
        auj() + Duration::days(k)
    }

    fn reglages() -> Reglages {
        Reglages {
            aujourdhui: auj(),
            fin_horizon: j(H as i64 - 1),
            delai_j: 30,
            couverture_j: 30,
            jours_securite: 30,
            cible_j: Some(60),
            stock_min_kg: None,
            soumis_mrp: true,
            moq_kg: None,
            multiple_kg: None,
            kg_palette: None,
            max_propositions: MAX_PROPOSITIONS,
        }
    }

    fn plat(kg: f64) -> Vec<f64> {
        vec![kg; H]
    }

    /// Cas 2 : 5 kg/j jusqu'à J+89, 30 kg/j de J+90 à J+149, puis 5 kg/j.
    fn saison() -> Vec<f64> {
        (0..H).map(|t| if (90..=149).contains(&t) { 30.0 } else { 5.0 }).collect()
    }

    fn arrivages(liste: &[(usize, f64)]) -> Vec<f64> {
        let mut a = vec![0.0; H];
        for (t, kg) in liste {
            a[*t] += kg;
        }
        a
    }

    fn proche(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    /// Le stock au soir de `t` quand on ne place QUE la quantité `q` à `d` sur la
    /// projection sans proposition (le « stock à R + N » du tableau du § 15.6).
    fn stock_avec(stock: f64, conso: &[f64], arr: &[f64], d: NaiveDate, q: f64, t: usize) -> f64 {
        let mut a = arr.to_vec();
        a[(d - auj()).num_days() as usize] += q;
        soldes(stock, conso, &a)[t]
    }

    struct Attendu {
        r: i64,
        d_etoile: i64,
        d: i64,
        limite: i64,
        q0: f64,
        x: f64,
        q: f64,
        stock_r_n: f64,
    }

    /// Vérifie une ligne du tableau du § 15.6 sur la 1re fenêtre du moteur.
    fn verifier(stock: f64, conso: &[f64], arr: &[f64], reg: &Reglages, a: Attendu) -> Couverture {
        let c = calculer_jours(stock, conso, arr, reg);
        assert_eq!(c.premiere_rupture, Some(j(a.r)), "R");
        let p = &c.propositions[0];
        let w = &p.fenetres[0];
        assert_eq!(w.date_rupture, j(a.r), "R de la fenêtre");
        assert_eq!(w.date_besoin, j(a.d_etoile), "D*");
        assert_eq!(c.date_besoin, Some(j(a.d_etoile)), "D* de la synthèse");
        assert_eq!(w.date_disponibilite, j(a.d), "D");
        assert_eq!(w.date_limite_commande, j(a.limite), "date limite");
        assert_eq!(c.date_limite_commande, Some(j(a.limite)), "date limite de la synthèse");
        assert!(proche(w.besoin_net_kg, a.q0), "Q0 {} au lieu de {}", w.besoin_net_kg, a.q0);
        assert!(proche(c.securite.x_kg, a.x), "X {} au lieu de {}", c.securite.x_kg, a.x);
        assert!(proche(p.securite_kg, a.x), "X porté par la 1re proposition : {}", p.securite_kg);
        // Q = arrondi(Q0 + X), sans minimum ni multiple ici.
        let q = w.besoin_net_kg + c.securite.x_kg;
        assert!(proche(q, a.q), "Q {q} au lieu de {}", a.q);
        // Le stock à R + N (au soir de R + N − 1), la seule commande Q reçue en D.
        let fin = (a.r + 30 - 1) as usize;
        let s = stock_avec(stock, conso, arr, j(a.d), q, fin);
        assert!(proche(s, a.stock_r_n), "stock à R+N {s} au lieu de {}", a.stock_r_n);
        c
    }

    #[test]
    fn cas_1_regulier() {
        let c = verifier(
            1800.0,
            &plat(15.0),
            &arrivages(&[]),
            &reglages(),
            Attendu { r: 120, d_etoile: 60, d: 60, limite: 30, q0: 450.0, x: 0.0, q: 450.0, stock_r_n: 0.0 },
        );
        assert!(proche(c.propositions[0].quantite_proposee_kg, 450.0));
        assert!(proche(c.propositions[0].stock_fin_fenetre_kg, 0.0), "bilan dans le moteur");
        assert_eq!(c.couverture_actuelle_j, Some(120));
        assert_eq!(c.ecart_cible_j, Some(60));
        assert!(proche(c.reste_rupture_kg.unwrap(), 0.0));
    }

    #[test]
    fn cas_2_saison() {
        let c = verifier(
            600.0,
            &saison(),
            &arrivages(&[]),
            &reglages(),
            Attendu { r: 95, d_etoile: 35, d: 35, limite: 5, q0: 900.0, x: 0.0, q: 900.0, stock_r_n: 0.0 },
        );
        assert!(proche(c.propositions[0].quantite_proposee_kg, 900.0));
    }

    #[test]
    fn cas_3_arrivage_avant_le_pic() {
        let arr = arrivages(&[(85, 1000.0)]);
        let c = verifier(
            600.0,
            &saison(),
            &arr,
            &reglages(),
            Attendu { r: 128, d_etoile: 68, d: 68, limite: 38, q0: 690.0, x: 0.0, q: 690.0, stock_r_n: 0.0 },
        );
        assert!(proche(c.reste_rupture_kg.unwrap(), 10.0), "reste 10");
        assert!(proche(c.propositions[0].fenetres[0].reste_kg, 10.0));
        // 600 + 1 000 + 690 = 2 290 = P(0, 158).
        let p: f64 = saison()[..158].iter().sum();
        assert!(proche(600.0 + 1000.0 + 690.0, p), "P(0, 158) = {p}");
        // La chronologie : 945 kg au soir de D = J+68, 0 au soir de J+157.
        assert!(proche(c.propositions[0].stock_apres_reception_kg, 945.0), "{}", c.propositions[0].stock_apres_reception_kg);
        assert!(proche(c.propositions[0].stock_fin_fenetre_kg, 0.0));
    }

    #[test]
    fn cas_4a_securite_sans_arrivage() {
        let c = verifier(
            600.0,
            &plat(15.0),
            &arrivages(&[]),
            &reglages(),
            Attendu { r: 40, d_etoile: -20, d: 30, limite: -50, q0: 450.0, x: 315.0, q: 765.0, stock_r_n: 315.0 },
        );
        // Le creux dès J+10, le plus bas à J+30 : b(30) = 135 sous NS = 450.
        assert_eq!(c.securite.premier_franchissement, Some(j(10)));
        assert_eq!(
            raison_etat(&c, auj(), 30),
            "creux sous la sécurité le 11/01/2026 : 435 kg pour 450 kg"
        );
        assert_eq!(c.securite.jour_creux, Some(j(30)));
        assert!(proche(c.securite.point_bas_creux_kg.unwrap(), 135.0));
        assert!(proche(c.securite.seuil_creux_kg.unwrap(), 450.0));
        assert!(c.propositions[0].fenetres[0].en_retard);
    }

    #[test]
    fn cas_4b_securite_arrivage_pendant_le_delai() {
        let c = verifier(
            500.0,
            &plat(15.0),
            &arrivages(&[(20, 900.0)]),
            &reglages(),
            Attendu { r: 93, d_etoile: 33, d: 33, limite: 3, q0: 445.0, x: 265.0, q: 710.0, stock_r_n: 265.0 },
        );
        assert!(proche(c.reste_rupture_kg.unwrap(), 5.0), "reste 5");
        // Le creux dès J+3 ; b(20) = 185, mesuré AVANT l'arrivage du jour.
        assert_eq!(c.securite.premier_franchissement, Some(j(3)));
        assert_eq!(c.securite.jour_creux, Some(j(20)));
        assert!(proche(c.securite.point_bas_creux_kg.unwrap(), 185.0));
        assert!(proche(c.propositions[0].quantite_proposee_kg, 710.0));
        assert!(proche(c.propositions[0].stock_fin_fenetre_kg, 265.0), "stock à R+N = X dans le moteur");
    }

    /// § 15.9 bis-2 : une seule proposition consolidée quand la cible est déjà en
    /// retard — 765 + 450 = 1 215 kg à J+30, puis la suivante à J+61.
    #[test]
    fn cas_4a_consolidation_des_propositions_en_retard() {
        let c = calculer_jours(600.0, &plat(15.0), &arrivages(&[]), &reglages());
        let p = &c.propositions[0];
        assert!(p.consolidee);
        assert_eq!(p.fenetres.len(), 2);
        assert_eq!(p.date_disponibilite, j(30));
        assert!(proche(p.besoin_net_kg, 900.0), "Q0 = 450 + 450 : {}", p.besoin_net_kg);
        assert!(proche(p.securite_kg, 315.0), "X une fois");
        assert!(proche(p.quantite_proposee_kg, 1215.0), "Q {}", p.quantite_proposee_kg);
        assert_eq!(p.fenetres[1].date_rupture, j(70));
        assert_eq!(p.fenetres[1].date_disponibilite, j(30));
        assert_eq!(c.propositions[1].date_disponibilite, j(61), "la suivante");
        assert!(!c.propositions[1].consolidee);
        assert!(proche(c.propositions[1].securite_kg, 0.0), "X sur la 1re seulement");
        // À la réception d'après, le stock au début de D vaut de nouveau exactement C
        // (900 kg) : la sécurité ne gonfle pas le stock en permanence.
        let p2 = &c.propositions[1];
        assert!(proche(p2.besoin_net_kg, 450.0));
        assert!(proche(p2.stock_apres_reception_kg - p2.quantite_proposee_kg + 15.0, 900.0));
        // L'arrondi s'applique une fois, sur la somme : multiple de 500 → 1 500.
        let mut r = reglages();
        r.multiple_kg = Some(500.0);
        let c = calculer_jours(600.0, &plat(15.0), &arrivages(&[]), &r);
        assert!(proche(c.propositions[0].quantite_proposee_kg, 1500.0));
        assert!(proche(c.propositions[0].arrondi_kg, 285.0));
    }

    /// Le bilan (§ 15.6) dans le moteur complet : sans sécurité, le stock vaut 0 à
    /// R + N ; la réception suivante remet le stock à C exactement (cas 1).
    #[test]
    fn bilan_stock_a_r_plus_n_et_retour_a_la_cible() {
        let mut r = reglages();
        r.jours_securite = 0;
        let c = calculer_jours(600.0, &plat(15.0), &arrivages(&[]), &r);
        assert!(proche(c.securite.x_kg, 0.0));
        for p in c.propositions.iter().filter(|p| !p.fenetre_bornee_horizon) {
            assert!(proche(p.stock_fin_fenetre_kg, 0.0), "rang {} : {}", p.rang, p.stock_fin_fenetre_kg);
        }
        // Cas 1 : à chaque réception normale, le stock au début de D couvre C (900 kg).
        let c = calculer_jours(1800.0, &plat(15.0), &arrivages(&[]), &reglages());
        for p in c.propositions.iter().filter(|p| !p.en_retard) {
            let avant = p.stock_apres_reception_kg - p.quantite_proposee_kg + 15.0;
            assert!(proche(avant, 900.0), "rang {} : {avant}", p.rang);
        }
    }

    /// L'équivalence avec le calcul classique à t0 = D* − L (§ 15.6) : besoin du
    /// délai + besoin de N + plan des C jours suivants − stock à t0 − arrivages.
    #[test]
    fn equivalence_classique() {
        let cas: [(f64, Vec<f64>, Vec<f64>, f64); 3] = [
            (1800.0, plat(15.0), arrivages(&[]), 450.0),
            (600.0, saison(), arrivages(&[]), 900.0),
            (600.0, saison(), arrivages(&[(85, 1000.0)]), 690.0),
        ];
        for (stock, conso, arr, q0) in cas {
            let c = calculer_jours(stock, &conso, &arr, &reglages());
            let w = &c.propositions[0].fenetres[0];
            let t0 = (w.date_limite_commande - auj()).num_days() as usize;
            let fin = (w.fin - auj()).num_days() as usize;
            let b = soldes(stock, &conso, &arr);
            let classique = conso[t0..fin].iter().sum::<f64>() - b[t0 - 1] - arr[t0..fin].iter().sum::<f64>();
            assert!(proche(classique, q0), "classique {classique}");
            assert!(proche(w.besoin_net_kg, q0));
        }
        // Le découpage du § 15.6, cas 3 : 150 + 350 + 1 600 − 410 − 1 000 = 690.
        let s = saison();
        let p = |a: usize, b: usize| s[a..b].iter().sum::<f64>();
        assert!(proche(p(38, 68), 150.0) && proche(p(68, 98), 350.0) && proche(p(98, 158), 1600.0));
    }

    /// Un générateur pseudo-aléatoire déterministe (LCG), sans dépendance nouvelle.
    struct Alea(u64);
    impl Alea {
        fn suivant(&mut self) -> u64 {
            self.0 = self.0.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
            self.0 >> 33
        }
        fn entre(&mut self, a: u64, b: u64) -> u64 {
            a + self.suivant() % (b - a + 1)
        }
    }

    /// PROPRIÉTÉ (§ 15.7-2), quels que soient le plan et les arrivages :
    /// * le point bas de la fenêtre de la 1re proposition, reçue seule en D ≤ R, vaut
    ///   exactement X ; sans arrivage dans la fenêtre, c'est le stock à R + N ;
    /// * Q0 est le besoin du calcul classique à t0 = D* − L quand la fenêtre n'a
    ///   pas d'arrivage (et ne lui est jamais inférieur) ;
    /// * aucune rupture dans une fenêtre couverte, toutes propositions placées ;
    /// * le stock minimum ne change aucune quantité.
    #[test]
    fn propriete_plans_et_arrivages_aleatoires() {
        let mut g = Alea(20_261_027);
        let mut vus = 0;
        for _ in 0..400 {
            let n = g.entre(60, 260) as usize;
            let conso: Vec<f64> = (0..n)
                .map(|_| if g.entre(0, 9) < 2 { 0.0 } else { g.entre(0, 40) as f64 + g.entre(0, 9) as f64 / 10.0 })
                .collect();
            let mut arr = vec![0.0; n];
            for _ in 0..g.entre(0, 4) {
                arr[g.entre(0, n as u64 - 1) as usize] += g.entre(50, 2000) as f64;
            }
            let stock = g.entre(0, 3000) as f64;
            let mut r = reglages();
            r.fin_horizon = j(n as i64 - 1);
            r.cible_j = Some(g.entre(0, 90) as i64);
            r.couverture_j = g.entre(1, 60) as i64;
            r.delai_j = g.entre(0, 60) as i64;
            r.jours_securite = g.entre(0, 45) as i64;
            let c = calculer_jours(stock, &conso, &arr, &r);

            // Le stock minimum ne change jamais une quantité.
            let mut rm = r.clone();
            rm.stock_min_kg = Some(g.entre(1, 100_000) as f64);
            let cm = calculer_jours(stock, &conso, &arr, &rm);
            let q = |c: &Couverture| c.propositions.iter().map(|p| p.quantite_proposee_kg).collect::<Vec<_>>();
            assert_eq!(q(&c), q(&cm), "le minimum change une quantité");

            // Aucune rupture dans une fenêtre couverte, toutes propositions placées.
            let mut a = arr.clone();
            let mut radie = vec![0.0; n];
            for p in &c.propositions {
                let d = (p.date_disponibilite - auj()).num_days() as usize;
                a[d] += p.quantite_proposee_kg;
                radie[d] += p.manque_inevitable_kg;
            }
            let e: Vec<f64> = a.iter().zip(&radie).map(|(x, y)| x + y).collect();
            let bf = soldes(stock, &conso, &e);
            for p in &c.propositions {
                for w in &p.fenetres {
                    let (w0, w1) = ((w.debut - auj()).num_days() as usize, (w.fin - auj()).num_days() as usize);
                    for (k, v) in bf.iter().enumerate().take(w1).skip(w0) {
                        assert!(*v > -1e-3, "rupture à {k} dans la fenêtre [{w0}, {w1}[ : {v}");
                    }
                }
            }

            let Some(p) = c.propositions.first() else { continue };
            let w = &p.fenetres[0];
            if p.consolidee || w.rupture_inevitable {
                continue;
            }
            vus += 1;
            let (d, w0, w1) = (
                (w.date_disponibilite - auj()).num_days() as usize,
                (w.debut - auj()).num_days() as usize,
                (w.fin - auj()).num_days() as usize,
            );
            let mut a = arr.clone();
            a[d] += w.besoin_net_kg + c.securite.x_kg;
            let b1 = soldes(stock, &conso, &a);
            let bas = b1[w0..w1].iter().cloned().fold(f64::INFINITY, f64::min);
            assert!((bas - c.securite.x_kg).abs() < 1e-3, "point bas {bas}, X {}", c.securite.x_kg);
            let sans_arrivage = arr[w0..w1].iter().all(|x| *x == 0.0);
            if sans_arrivage {
                assert!((b1[w1 - 1] - c.securite.x_kg).abs() < 1e-3, "stock à R+N {} ≠ X", b1[w1 - 1]);
            }
            let t0 = (w.date_limite_commande - auj()).num_days();
            if t0 >= 1 {
                let t0 = t0 as usize;
                let b0 = soldes(stock, &conso, &arr);
                let classique =
                    conso[t0..w1].iter().sum::<f64>() - b0[t0 - 1] - arr[t0..w1].iter().sum::<f64>();
                assert!(w.besoin_net_kg >= classique - 1e-3, "Q0 {} < classique {classique}", w.besoin_net_kg);
                if sans_arrivage {
                    assert!((w.besoin_net_kg - classique).abs() < 1e-3, "Q0 {} ≠ classique {classique}", w.besoin_net_kg);
                }
            }
        }
        assert!(vus > 50, "trop peu de cas vérifiés : {vus}");
    }

    #[test]
    fn stock_minimum_sans_effet_sur_q_mais_signale() {
        let mut r = reglages();
        let sans = calculer_jours(600.0, &plat(15.0), &arrivages(&[]), &r);
        r.stock_min_kg = Some(400.0);
        let avec = calculer_jours(600.0, &plat(15.0), &arrivages(&[]), &r);
        let q = |c: &Couverture| c.propositions.iter().map(|p| p.quantite_proposee_kg).collect::<Vec<_>>();
        assert_eq!(q(&sans), q(&avec));
        // b(t) = 585 − 15 t < 400 dès t = 13.
        assert_eq!(avec.stock_minimum.franchi_le, Some(j(13)));
        assert!(avec.signaux.iter().any(|s| s.code == signal::SOUS_MINIMUM && s.date == Some(j(13))));
        assert!(!sans.signaux.iter().any(|s| s.code == signal::SOUS_MINIMUM));
        assert_eq!(avec.etat, sans.etat, "un signal ne change pas l'état");
    }

    #[test]
    fn article_sans_cible_aucune_proposition_et_signal() {
        let mut r = reglages();
        r.cible_j = None;
        let c = calculer_jours(600.0, &plat(15.0), &arrivages(&[]), &r);
        assert!(c.propositions.is_empty(), "aucune valeur de repli");
        assert!(c.signaux.iter().any(|s| s.code == signal::CIBLE_NON_DEFINIE));
        assert!(c.motif_sans_proposition.unwrap().contains("cible"));
        // R et la couverture actuelle restent calculés.
        assert_eq!(c.premiere_rupture, Some(j(40)));
        assert_eq!(c.couverture_actuelle_j, Some(40));
        assert_eq!(c.ecart_cible_j, None);
        assert_ne!(c.etat, etat::COUVERT, "la rupture reste visible dans l'état");
        // Hors MRP (pas au besoin du plan en service) : pas de signal.
        r.soumis_mrp = false;
        let c = calculer_jours(600.0, &plat(0.0), &arrivages(&[]), &r);
        assert!(c.signaux.is_empty());
        assert_eq!(c.etat, etat::COUVERT);
    }

    #[test]
    fn etats_et_signaux_separes() {
        // Cas 1 : couvert (120 j ≥ 60 j), sans signal.
        let c = calculer_jours(1800.0, &plat(15.0), &arrivages(&[]), &reglages());
        assert_eq!(c.etat, etat::COUVERT);
        assert_eq!(raison_etat(&c, auj(), 30), "couvre 120 j, cible 60 j (+60 j)");
        assert!(c.signaux.is_empty(), "{:?}", c.signaux);
        // Cas 4a : sous la sécurité (X > 0) ; le retard sur la cible est un SIGNAL.
        let c = calculer_jours(600.0, &plat(15.0), &arrivages(&[]), &reglages());
        assert_eq!(c.etat, etat::SOUS_SECURITE);
        assert!(c.signaux.iter().any(|s| s.code == signal::RETARD_CIBLE && s.date == Some(j(-50))));
        // Sans sécurité : sous la cible (40 j < 60 j).
        let mut r = reglages();
        r.jours_securite = 0;
        let c = calculer_jours(600.0, &plat(15.0), &arrivages(&[]), &r);
        assert_eq!(c.etat, etat::SOUS_CIBLE);
        assert_eq!(c.ecart_cible_j, Some(-20));
        assert_eq!(raison_etat(&c, auj(), 30), "couvre 40 j, cible 60 j (-20 j)");
        // Rupture avant aujourd'hui + L : inévitable, quel que soit le reste.
        let c = calculer_jours(300.0, &plat(15.0), &arrivages(&[]), &reglages());
        assert_eq!(c.premiere_rupture, Some(j(20)));
        assert_eq!(c.etat, etat::RUPTURE_INEVITABLE);
        assert_eq!(raison_etat(&c, auj(), 30), "rupture le 21/01/2026, avant la 1re réception possible le 31/01/2026");
        let p = &c.propositions[0];
        assert!(p.rupture_inevitable);
        assert_eq!(p.date_disponibilite, j(30));
        // Le manque d'avant D (J+20 à J+29) est affiché, pas commandé.
        assert!(proche(p.fenetres[0].manque_inevitable_kg, 150.0), "{}", p.fenetres[0].manque_inevitable_kg);
        assert_eq!(p.fenetres[0].debut, j(30), "fenêtre [D, D+N[");
        // Sans rupture sur l'horizon : couvert.
        let c = calculer_jours(100_000.0, &plat(15.0), &arrivages(&[]), &reglages());
        assert_eq!(c.etat, etat::COUVERT);
        assert!(c.propositions.is_empty() && c.couvert_tout_horizon);
        // Horizon trop court pour juger la cible.
        let mut r = reglages();
        r.fin_horizon = j(39);
        let c = calculer_jours(10_000.0, &vec![15.0; 40], &vec![0.0; 40], &r);
        assert!(c.signaux.iter().any(|s| s.code == signal::HORIZON_COURT));
    }

    #[test]
    fn minimum_puis_multiple_et_palettes() {
        let mut r = reglages();
        r.moq_kg = Some(500.0);
        r.multiple_kg = Some(200.0);
        r.kg_palette = Some(200.0);
        let c = calculer_jours(1800.0, &plat(15.0), &arrivages(&[]), &r);
        let p = &c.propositions[0];
        assert!(proche(p.besoin_net_kg, 450.0));
        assert!(proche(p.apres_minimum_kg, 500.0));
        assert!(proche(p.quantite_proposee_kg, 600.0));
        assert!(proche(p.arrondi_kg, 150.0));
        assert_eq!(p.palettes_equivalentes, Some(3.0));
        // L'excédent d'arrondi reste en stock et repousse la rupture suivante (150 kg = 10 j).
        assert_eq!(c.propositions[1].date_rupture, j(160));
    }

    #[test]
    fn propositions_enchainees_et_plafond() {
        let c = calculer_jours(1800.0, &plat(15.0), &arrivages(&[]), &reglages());
        let d: Vec<_> = c.propositions.iter().map(|p| p.date_disponibilite).collect();
        assert_eq!(&d[..3], &[j(60), j(90), j(120)]);
        assert!(!c.propositions_plafonnees);
        let mut r = reglages();
        r.max_propositions = 2;
        let c = calculer_jours(1800.0, &plat(15.0), &arrivages(&[]), &r);
        assert_eq!(c.propositions.len(), 2);
        assert!(c.propositions_plafonnees);
    }

    #[test]
    fn plan_mensuel_reparti_au_jour_et_mois_en_cours() {
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
        let fins = c.evenements.iter().filter(|e| e.natures.contains(&nature::FIN_DE_MOIS)).count();
        assert_eq!(fins, 2);
        let total: f64 = c.evenements.iter().map(|e| e.conso_prevue_kg).sum();
        assert!(proche(total, c.plan_horizon_kg));
    }

    #[test]
    fn plan_vide_et_plan_des_premiers_jours() {
        let c = calculer_jours(500.0, &plat(0.0), &arrivages(&[(10, 100.0)]), &reglages());
        assert!(c.propositions.is_empty());
        assert!(c.premiere_rupture.is_none());
        assert!(proche(c.jours.last().unwrap().solde_kg, 600.0));
        let c = calculer_jours(1800.0, &plat(15.0), &arrivages(&[]), &reglages());
        assert!(proche(plan_des_premiers_jours(&c, 30), 450.0));
        assert!(proche(plan_des_premiers_jours(&c, -5), 0.0));
        assert!(proche(plan_des_premiers_jours(&c, 10_000), c.plan_horizon_kg));
    }

    #[test]
    fn solde_sans_plafond_rupture_et_reprise() {
        // 300 kg pour 15 kg/j : rupture à J+20, le solde descend sous zéro (sans
        // plafond) ; un arrivage de 1 000 kg à J+40 le fait remonter : reprise.
        let c = calculer_jours(300.0, &plat(15.0), &arrivages(&[(40, 1000.0)]), &reglages());
        assert!(c.jours[25].solde_kg < 0.0);
        let natures: Vec<_> = c.evenements.iter().flat_map(|e| e.natures.clone()).collect();
        assert_eq!(natures.iter().filter(|n| **n == nature::RUPTURE).count(), 2, "{natures:?}");
        assert!(natures.contains(&nature::REPRISE));
        // Le plan non couvert de J+20 à J+39 : 300 kg.
        let nc: f64 = c.jours[..40].iter().map(|x| x.plan_non_couvert_kg).sum();
        assert!(proche(nc, 300.0), "{nc}");
    }

    #[test]
    fn tri_rupture_la_plus_proche_puis_date_limite() {
        let a = calculer_jours(0.0, &plat(15.0), &arrivages(&[(5, 100_000.0)]), &reglages());
        let b = calculer_jours(600.0, &plat(15.0), &arrivages(&[]), &reglages());
        let c = calculer_jours(100_000.0, &plat(15.0), &arrivages(&[]), &reglages());
        let mut v = [(&c, "C"), (&b, "B"), (&a, "A")];
        v.sort_by_key(|(x, _)| cle_tri(x));
        assert_eq!(v.map(|(_, n)| n), ["A", "B", "C"]);
    }

    #[test]
    fn delai_au_dela_de_l_horizon() {
        let mut r = reglages();
        r.delai_j = 500;
        let c = calculer_jours(100.0, &plat(15.0), &arrivages(&[]), &r);
        assert!(c.propositions.is_empty());
        assert!(c.motif_sans_proposition.unwrap().contains("délai"));
        assert_eq!(c.etat, etat::RUPTURE_INEVITABLE);
    }
}
