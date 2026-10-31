//! LE STOCK PROJETÉ (spécification du 30/10/2026, `docs/A-DECIDER-of-supply-chain.md`
//! § 16) : COMBIEN COMMANDER pour être couvert selon la cible. Il n'est PAS
//! chronologique : ni date de rupture, ni frise, ni date limite — le « quand ça
//! casse » est l'affaire de la Surveillance (moteur v2, `domain/couverture.rs`).
//!
//! Calcul PUR, sur des structures en mémoire ; la lecture est dans
//! `routes/couverture.rs`. L'écran /stock et la génération du plan d'achat
//! appellent la MÊME fonction (§ 16.6).
//!
//! FRONTIÈRE (§ 16, verrouillée). La couverture estimative tient compte des
//! consommations planifiées entre aujourd'hui et chaque approvisionnement prévu ;
//! un approvisionnement n'augmente la couverture qu'à partir de sa date prévue
//! d'arrivée ; un manque entre deux approvisionnements est traité selon l'option
//! de RATTRAPAGE.
//!
//! NOTATIONS (§ 16.2). Le jour 0 est aujourd'hui.
//!
//! * p(t) : le plan du jour (`couverture::plan_au_jour`), aucune moyenne.
//! * A(t) : les commandes ouvertes à leur date (une date passée compte au jour 0).
//! * Rattrapage INCLUS : E(t) = S0 + Σ_{k≤t} (A(k) − p(k)) — le manque reste dû.
//!   Rattrapage EXCLU : E(t) = max(E(t−1), 0) + A(t) − p(t) — le manque est perdu.
//! * Un jour de plan est SERVI si E(t) ≥ 0, MANQUANT sinon (les jours sans plan
//!   ne comptent ni pour l'un ni pour l'autre).
//! * T, la couverture projetée : le premier jour manquant après le dernier jour
//!   servi ; aucun jour manquant ⇒ couvert sur tout l'horizon.
//! * Déclenchement : T < C. Q = la plus petite quantité qui, reçue à aujourd'hui
//!   + L, porte T à C + N (même option de rattrapage), puis minimum, multiple.
//! * Seuil d'alerte = S + stock minimum en jours de plan ; ALERTE si T − L < seuil.
//!
//! Le stock minimum ne change JAMAIS une quantité ; il n'entre que dans le seuil
//! d'alerte. Le moteur propose, l'utilisateur décide.

use chrono::{Duration, NaiveDate};
use serde::Serialize;

/// Tolérance de comparaison des kilos (p(t) est un quotient).
const EPS: f64 = 1e-6;

/// LES ÉTATS du stock projeté (§ 16.4), le plus grave d'abord.
pub mod etat {
    pub const ALERTE: &str = "ALERTE";
    pub const SOUS_CIBLE: &str = "SOUS_CIBLE";
    pub const COUVERT: &str = "COUVERT";
    /// Tous les états, du plus grave au moins grave.
    pub const TOUS: [&str; 3] = [ALERTE, SOUS_CIBLE, COUVERT];
}

/// LES PALIERS DE RUPTURE (31/10/2026) : dans combien de jours le fil manque,
/// échelonné par les seuils globaux `P_SeuilImminent` (30 j), `P_SeuilCritique`
/// (60 j) et `P_SeuilAlerte` (90 j). Une autre question que l'état : l'état dit
/// combien commander, le palier dit quand ça casse. Le plus grave d'abord.
pub mod palier {
    /// Sans fil dès aujourd'hui.
    pub const RUPTURE: &str = "RUPTURE";
    pub const IMMINENTE: &str = "IMMINENTE";
    pub const CRITIQUE: &str = "CRITIQUE";
    pub const ATTENTION: &str = "ATTENTION";
}

/// Les signaux du stock projeté, à part de l'état, jamais bloquants.
pub mod signal {
    pub const CIBLE_NON_DEFINIE: &str = "CIBLE_NON_DEFINIE";
    pub const HORIZON_COURT: &str = "HORIZON_COURT";
}

/// Rang d'un état pour les tris : le plus grave d'abord.
pub fn rang_etat(e: &str) -> u8 {
    etat::TOUS.iter().position(|x| *x == e).map_or(9, |i| i as u8)
}

/// Ce que le calcul reçoit (une référence).
#[derive(Debug, Clone)]
pub struct Entrees {
    pub aujourdhui: NaiveDate,
    /// p(t), t ∈ [0, n[ : le plan au jour jusqu'à la fin de l'horizon.
    pub conso: Vec<f64>,
    /// S0 : le stock compté (magasins au MRP hors bloqués, machine, restes).
    pub stock_kg: f64,
    /// Les commandes ouvertes : (date d'arrivée, kg). Une date passée compte
    /// aujourd'hui ; une date au-delà de l'horizon entre dans la position, pas
    /// dans la couverture (aucun plan n'y est connu).
    pub arrivees: Vec<(NaiveDate, f64)>,
    /// C (jours) ; `None` : cible non définie, aucune quantité.
    pub cible_j: Option<i64>,
    /// N (jours) : la couverture d'une commande.
    pub couverture_j: i64,
    /// L (jours) : le délai.
    pub delai_j: i64,
    /// S (jours) : la sécurité de la classe ABC.
    pub jours_securite: i64,
    pub stock_min_kg: Option<f64>,
    pub moq_kg: Option<f64>,
    /// Le multiple résolu (multiple d'achat, sinon la palette si la fiche le demande).
    pub multiple_kg: Option<f64>,
    pub kg_palette: Option<f64>,
    /// Un article actif au plan en service : sans cible, c'est un signal.
    pub soumis_mrp: bool,
    /// L'option de rattrapage (§ 16.1-4) : inclus par défaut.
    pub rattrapage: bool,
    /// L'option RESTES (31/10/2026) : les restes sont-ils dans `stock_kg` ? Le
    /// calcul ne fait que la rendre ; c'est l'appelant qui les retire du stock.
    pub restes: bool,
    /// Les seuils des paliers de rupture, en jours : [imminente, critique, attention].
    pub seuils_rupture: [i64; 3],
}

/// LE TROU AVANT LE CAMION (31/10/2026) : le premier épisode où le fil manque
/// avant un arrivage connu qui rétablit le stock — à faire avancer, ou à acheter
/// sur place.
#[derive(Debug, Clone, Serialize)]
pub struct ASec {
    /// Le premier jour sans fil.
    pub date_sec: NaiveDate,
    /// L'arrivage qui rétablit le stock.
    pub date_arrivage: NaiveDate,
    /// Les jours sans fil entre les deux.
    pub jours: i64,
    /// Le plan non servi pendant ces jours.
    pub manque_kg: f64,
}

/// Une étape de la formation de la couverture (« Où se trouve la matière »).
#[derive(Debug, Clone, Serialize)]
pub struct Etape {
    /// La date de l'arrivage, ou celle de l'épuisement (dernière étape).
    pub date: NaiveDate,
    /// `ARRIVAGE` ou `EPUISEMENT` (`None` : couvert sur tout l'horizon).
    pub nature: &'static str,
    /// Le plan consommé depuis l'étape précédente.
    pub conso_kg: f64,
    /// La part de ce plan qui n'a pas été servie (stock épuisé avant l'arrivage).
    pub manque_kg: f64,
    pub arrivee_kg: f64,
    /// Le stock après l'arrivage, avant la consommation du jour (négatif : un
    /// manque reporté, rattrapage inclus).
    pub solde_kg: f64,
}

/// La quantité proposée et sa décomposition (§ 16.3).
#[derive(Debug, Clone, Serialize)]
pub struct Quantite {
    /// La date théorique de réception : aujourd'hui + L.
    pub date_reception: NaiveDate,
    /// Le niveau visé : C + N jours.
    pub niveau_vise_j: i64,
    /// Le besoin, avant minimum et multiple.
    pub besoin_kg: f64,
    pub moq_kg: Option<f64>,
    pub apres_minimum_kg: f64,
    pub multiple_kg: Option<f64>,
    /// Ce que le multiple ajoute après le minimum.
    pub complement_multiple_kg: f64,
    pub quantite_kg: f64,
    pub palettes: Option<f64>,
}

/// LE PONT de la fenêtre (31/10/2026) : du stock compté au niveau visé C + N,
/// en kilos. Il n'entre dans aucun calcul : il explique la quantité. Quand la
/// quantité dépasse le manque du solde, l'écart tient au calendrier (un arrivage
/// après l'épuisement, une commande reçue seulement à aujourd'hui + L).
#[derive(Debug, Clone, Serialize)]
pub struct Pont {
    /// C + N jours, borné à l'horizon du plan.
    pub vise_j: i64,
    pub date_vise: NaiveDate,
    /// Les arrivages datés avant le jour visé.
    pub arrivages_kg: f64,
    /// Le plan des jours [0, vise[.
    pub plan_kg: f64,
    /// Stock compté + arrivages − plan (négatif : un manque).
    pub solde_kg: f64,
}

/// Le résultat (§ 16.2 à 16.4).
#[derive(Debug, Clone, Serialize)]
pub struct Projete {
    pub rattrapage: bool,
    /// L'option restes reçue (comptés ou exclus du stock).
    pub restes: bool,
    pub horizon_j: i64,
    /// Σ A, toutes les commandes ouvertes.
    pub arrivages_kg: f64,
    /// S0 + Σ A.
    pub position_kg: f64,
    /// P(0, L) : le plan pendant le délai.
    pub besoin_delai_kg: f64,
    /// T ; `None` : couvert sur tout l'horizon.
    pub couverture_j: Option<i64>,
    pub couvert_jusqu_au: Option<NaiveDate>,
    /// Le plan non servi avant T (kg, sans date).
    pub manque_kg: f64,
    /// LES JOURS SANS FIL jusqu'au prochain approvisionnement (31/10/2026) : avant
    /// T, du premier jour manquant jusqu'à l'arrivage qui rétablit le stock
    /// (jours sans plan compris) ; à T, faute d'arrivage connu, jusqu'à une
    /// commande passée aujourd'hui (aujourd'hui + L). L'écran les montre en
    /// négatif à la place de la couverture.
    pub jours_sans_fil: i64,
    pub cible_j: Option<i64>,
    pub ecart_cible_j: Option<i64>,
    /// « Avant le » : aujourd'hui + (T − C).
    pub avant_le: Option<NaiveDate>,
    pub stock_min_j: Option<i64>,
    pub seuil_alerte_j: i64,
    /// T − L.
    pub couverture_livraison_j: Option<i64>,
    pub etat: &'static str,
    pub raison: String,
    pub signaux: Vec<&'static str>,
    pub quantite: Option<Quantite>,
    /// Pourquoi aucune quantité, quand la cible est franchie.
    pub motif_sans_quantite: Option<&'static str>,
    pub etapes: Vec<Etape>,
    /// `None` : cible non définie.
    pub pont: Option<Pont>,
    /// Les jours jusqu'au premier jour sans fil (arrivages comptés) ; `None` :
    /// jamais sur l'horizon.
    pub rupture_j: Option<i64>,
    pub rupture_le: Option<NaiveDate>,
    /// Le palier de rupture ; `None` : au-delà du seuil d'attention.
    pub palier: Option<&'static str>,
    /// Le palier plus grave qui suit, et le jour où la référence y passe.
    pub palier_suivant: Option<&'static str>,
    pub date_palier_suivant: Option<NaiveDate>,
    /// Le premier trou avant un camion ; `None` : aucun.
    pub a_sec: Option<ASec>,
}

/// Le palier d'une rupture dans `r` jours, et le palier suivant avec le
/// nombre de jours avant d'y passer. `seuils` = [imminente, critique, attention].
fn paliers(r: Option<i64>, seuils: [i64; 3]) -> (Option<&'static str>, Option<(&'static str, i64)>) {
    let [imminente, critique, attention] = seuils;
    match r {
        None => (None, None),
        Some(r) if r <= 0 => (Some(palier::RUPTURE), None),
        Some(r) if r < imminente => (Some(palier::IMMINENTE), Some((palier::RUPTURE, r))),
        Some(r) if r < critique => (Some(palier::CRITIQUE), Some((palier::IMMINENTE, r - imminente))),
        Some(r) if r < attention => (Some(palier::ATTENTION), Some((palier::CRITIQUE, r - critique))),
        Some(r) => (None, Some((palier::ATTENTION, r - attention))),
    }
}

/// Le premier trou avant un camion : un jour manquant ouvre le trou, un
/// arrivage qui rétablit le stock le ferme (même règle que `jours_sans_fil`).
fn premier_trou(conso: &[f64], arr: &[f64], e: &[f64]) -> Option<(usize, usize, f64)> {
    let mut debut: Option<usize> = None;
    for t in 0..conso.len() {
        if conso[t] > EPS && e[t] < -EPS {
            debut.get_or_insert(t);
        } else if e[t] >= -EPS && (conso[t] > EPS || arr[t] > EPS) {
            if let Some(u) = debut {
                if arr[t] > EPS {
                    let manque = (u..t).map(|k| conso[k].min((-e[k]).max(0.0))).sum();
                    return Some((u, t, manque));
                }
                debut = None;
            }
        }
    }
    None
}

fn r4(v: f64) -> f64 {
    (v * 10_000.0).round() / 10_000.0 + 0.0
}

/// E(t) pour t ∈ [0, n[, selon l'option de rattrapage.
fn soldes(stock: f64, conso: &[f64], arr: &[f64], rattrapage: bool) -> Vec<f64> {
    let mut e = Vec::with_capacity(conso.len());
    let mut s = stock;
    for (p, a) in conso.iter().zip(arr) {
        if !rattrapage {
            s = s.max(0.0);
        }
        s += a - p;
        e.push(s);
    }
    e
}

/// T : le premier jour manquant après le dernier jour servi ; `None` si aucun
/// jour n'est manquant.
fn couverture(conso: &[f64], e: &[f64]) -> Option<usize> {
    let manquant = |t: usize| conso[t] > EPS && e[t] < -EPS;
    let servi = |t: usize| conso[t] > EPS && e[t] >= -EPS;
    let depart = (0..conso.len()).rev().find(|&t| servi(t)).map_or(0, |t| t + 1);
    (depart..conso.len()).find(|&t| manquant(t))
}

/// Le plan non servi des jours [0, fin[.
fn manque(conso: &[f64], e: &[f64], fin: usize) -> f64 {
    (0..fin.min(conso.len())).map(|t| conso[t].min((-e[t]).max(0.0))).sum()
}

/// Les jours sans fil des jours [0, fin[ : un jour manquant ouvre le manque, un
/// jour servi ou un arrivage qui rétablit le stock le ferme ; les jours sans
/// plan entre les deux comptent (le magasin est vide).
fn jours_sans_fil(conso: &[f64], arr: &[f64], e: &[f64], fin: usize) -> i64 {
    let mut en_manque = false;
    let mut jours = 0;
    for t in 0..fin.min(conso.len()) {
        if conso[t] > EPS && e[t] < -EPS {
            en_manque = true;
        } else if e[t] >= -EPS && (conso[t] > EPS || arr[t] > EPS) {
            en_manque = false;
        }
        if en_manque {
            jours += 1;
        }
    }
    jours
}

/// Calcule le stock projeté d'une référence.
pub fn calculer(x: &Entrees) -> Projete {
    let n = x.conso.len().max(1);
    let conso: Vec<f64> = (0..n).map(|t| x.conso.get(t).copied().unwrap_or(0.0)).collect();
    let date = |t: i64| x.aujourdhui + Duration::days(t);
    let mut arr = vec![0.0; n];
    let mut arrivages_kg = 0.0;
    for (d, kg) in &x.arrivees {
        if *kg <= 0.0 {
            continue;
        }
        arrivages_kg += kg;
        let k = (*d - x.aujourdhui).num_days().max(0) as usize;
        if k < n {
            arr[k] += kg;
        }
    }
    let e = soldes(x.stock_kg, &conso, &arr, x.rattrapage);
    let t = couverture(&conso, &e);
    let fin = t.unwrap_or(n);
    let manque_kg = r4(manque(&conso, &e, fin));
    let couverture_j = t.map(|t| t as i64);
    let delai = x.delai_j.max(0);
    // Après T, aucun arrivage connu ne rétablit le stock : le prochain
    // approvisionnement est une commande passée aujourd'hui, reçue à + L.
    let jours_sans_fil = jours_sans_fil(&conso, &arr, &e, fin) + couverture_j.map_or(0, |tj| (delai - tj).max(0));
    let besoin_delai_kg = r4(conso.iter().take(delai as usize).sum());

    // ---- La quantité (§ 16.3) -----------------------------------------------
    let mut signaux = Vec::new();
    let mut quantite = None;
    let mut motif = None;
    if x.cible_j.is_none() && x.soumis_mrp {
        signaux.push(signal::CIBLE_NON_DEFINIE);
    }
    if let (Some(c), Some(tj)) = (x.cible_j, couverture_j) {
        if tj < c {
            let vise = c + x.couverture_j.max(0);
            if vise > (n as i64) - 1 {
                signaux.push(signal::HORIZON_COURT);
            }
            if delai as usize >= n {
                motif = Some("aujourd'hui + délai tombe au-delà de l'horizon du plan");
            } else {
                // Atteint : T ≥ vise, ou couvert sur tout l'horizon.
                let atteint = |q: f64| {
                    let mut a = arr.clone();
                    a[delai as usize] += q;
                    let e2 = soldes(x.stock_kg, &conso, &a, x.rattrapage);
                    couverture(&conso, &e2).is_none_or(|t2| (t2 as i64) >= vise)
                };
                let mut haut: f64 = conso.iter().sum::<f64>() + (-x.stock_kg).max(0.0) + 1.0;
                if !atteint(haut) {
                    motif = Some("aucune réception à aujourd'hui + délai n'atteint la cible");
                } else {
                    let mut bas = 0.0;
                    for _ in 0..80 {
                        let milieu = (bas + haut) / 2.0;
                        if atteint(milieu) {
                            haut = milieu;
                        } else {
                            bas = milieu;
                        }
                    }
                    let besoin = r4(haut);
                    if besoin > EPS {
                        let moq = x.moq_kg.filter(|m| *m > 0.0);
                        let apres_minimum = moq.map_or(besoin, |m| besoin.max(m));
                        let multiple = x.multiple_kg.filter(|m| *m > 0.0);
                        let q = match multiple {
                            Some(m) => (apres_minimum / m - 1e-9).ceil() * m,
                            None => apres_minimum,
                        };
                        quantite = Some(Quantite {
                            date_reception: date(delai),
                            niveau_vise_j: vise,
                            besoin_kg: besoin,
                            moq_kg: moq,
                            apres_minimum_kg: r4(apres_minimum),
                            multiple_kg: multiple,
                            complement_multiple_kg: r4((q - apres_minimum).max(0.0)),
                            quantite_kg: r4(q),
                            palettes: x.kg_palette.filter(|p| *p > 0.0).map(|p| ((q / p) * 100.0).round() / 100.0),
                        });
                    }
                }
            }
        }
    }

    // ---- L'alerte et l'état (§ 16.4) ----------------------------------------
    let stock_min_j = x.stock_min_kg.filter(|m| *m > EPS).map(|m| {
        let mut cumul = 0.0;
        let mut jours = 0i64;
        for p in conso.iter().skip(delai as usize) {
            if cumul >= m - EPS {
                break;
            }
            cumul += p;
            jours += 1;
        }
        jours
    });
    let seuil_alerte_j = x.jours_securite.max(0) + stock_min_j.unwrap_or(0);
    let couverture_livraison_j = couverture_j.map(|tj| tj - delai);
    let ecart_cible_j = match (couverture_j, x.cible_j) {
        (Some(tj), Some(c)) => Some(tj - c),
        _ => None,
    };
    let (etat_, raison) = match (couverture_livraison_j, couverture_j, x.cible_j) {
        (Some(liv), _, _) if liv < seuil_alerte_j => (
            etat::ALERTE,
            format!(
                "{liv} j de couverture à la livraison (délai {delai} j) pour un seuil d'alerte de {seuil_alerte_j} j"
            ),
        ),
        (_, Some(tj), Some(c)) if tj < c => {
            (etat::SOUS_CIBLE, format!("couverture projetée {tj} j pour une cible de {c} j"))
        }
        (_, Some(tj), Some(c)) => (etat::COUVERT, format!("couverture projetée {tj} j, cible {c} j")),
        (_, Some(tj), None) => (etat::COUVERT, format!("couverture projetée {tj} j, sans cible")),
        (_, None, _) => (etat::COUVERT, "couvert sur tout l'horizon du plan".to_string()),
    };

    // ---- La formation de la couverture, arrivage par arrivage ---------------
    let mut etapes = Vec::new();
    let mut debut = 0usize;
    for k in 0..n {
        if arr[k] <= EPS {
            continue;
        }
        let veille = if k == 0 { x.stock_kg } else { e[k - 1] };
        let avant = if x.rattrapage { veille } else { veille.max(0.0) };
        etapes.push(Etape {
            date: date(k as i64),
            nature: "ARRIVAGE",
            conso_kg: r4(conso[debut..k].iter().sum()),
            manque_kg: r4((debut..k).map(|u| conso[u].min((-e[u]).max(0.0))).sum()),
            arrivee_kg: r4(arr[k]),
            solde_kg: r4(avant + arr[k]),
        });
        debut = k;
    }
    if let Some(tj) = t {
        if tj >= debut {
            etapes.push(Etape {
                date: date(tj as i64),
                nature: "EPUISEMENT",
                conso_kg: r4(conso[debut..tj].iter().sum()),
                manque_kg: r4((debut..tj).map(|u| conso[u].min((-e[u]).max(0.0))).sum()),
                arrivee_kg: 0.0,
                solde_kg: 0.0,
            });
        }
    }

    let pont = x.cible_j.map(|c| {
        let fin = ((c + x.couverture_j.max(0)).max(0) as usize).min(n);
        let arrivages: f64 = arr[..fin].iter().sum();
        let plan: f64 = conso[..fin].iter().sum();
        Pont {
            vise_j: fin as i64,
            date_vise: date(fin as i64),
            arrivages_kg: r4(arrivages),
            plan_kg: r4(plan),
            solde_kg: r4(x.stock_kg + arrivages - plan),
        }
    });

    // ---- Les paliers de rupture et le trou avant le camion (31/10/2026) ------
    let rupture_j = (0..n).find(|&t| conso[t] > EPS && e[t] < -EPS).map(|t| t as i64);
    let (palier_, suivant) = paliers(rupture_j, x.seuils_rupture);
    let a_sec = premier_trou(&conso, &arr, &e).map(|(u, k, m)| ASec {
        date_sec: date(u as i64),
        date_arrivage: date(k as i64),
        jours: (k - u) as i64,
        manque_kg: r4(m),
    });

    Projete {
        rupture_j,
        rupture_le: rupture_j.map(date),
        palier: palier_,
        palier_suivant: suivant.map(|(p, _)| p),
        date_palier_suivant: suivant.map(|(_, j)| date(j.max(0))),
        a_sec,
        rattrapage: x.rattrapage,
        restes: x.restes,
        horizon_j: n as i64 - 1,
        arrivages_kg: r4(arrivages_kg),
        position_kg: r4(x.stock_kg + arrivages_kg),
        besoin_delai_kg,
        couverture_j,
        couvert_jusqu_au: couverture_j.map(date),
        manque_kg,
        jours_sans_fil,
        cible_j: x.cible_j,
        ecart_cible_j,
        avant_le: match (couverture_j, x.cible_j) {
            (Some(tj), Some(c)) => Some(date(tj - c)),
            _ => None,
        },
        stock_min_j,
        seuil_alerte_j,
        couverture_livraison_j,
        etat: etat_,
        raison,
        signaux,
        quantite,
        motif_sans_quantite: motif,
        etapes,
        pont,
    }
}

// ============================================================================
// Les tests de la spécification (§ 16.9) : plan 25 kg/j, C = 60 j, N = 30 j,
// L = 30 j, S = 30 j. Les chiffres sont ceux du document, au kilo près.
// ============================================================================
#[cfg(test)]
mod tests {
    use super::*;

    fn auj() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 1, 1).unwrap()
    }

    fn j(t: i64) -> NaiveDate {
        auj() + Duration::days(t)
    }

    fn entrees(stock: f64, arrivees: &[(i64, f64)], rattrapage: bool) -> Entrees {
        Entrees {
            aujourdhui: auj(),
            conso: vec![25.0; 400],
            stock_kg: stock,
            arrivees: arrivees.iter().map(|(t, kg)| (j(*t), *kg)).collect(),
            cible_j: Some(60),
            couverture_j: 30,
            delai_j: 30,
            jours_securite: 30,
            stock_min_kg: None,
            moq_kg: None,
            multiple_kg: None,
            kg_palette: None,
            soumis_mrp: true,
            rattrapage,
            restes: true,
            seuils_rupture: [30, 60, 90],
        }
    }

    #[test]
    fn paliers_de_rupture_et_palier_suivant() {
        // 25 kg/j, aucun arrivage : stock pour 75 j → rupture au jour 75,
        // ATTENTION (< 90), passe CRITIQUE à 75 − 60 = jour 15.
        let p = calculer(&entrees(1875.0, &[], true));
        assert_eq!(p.rupture_j, Some(75));
        assert_eq!(p.palier, Some(palier::ATTENTION));
        assert_eq!((p.palier_suivant, p.date_palier_suivant), (Some(palier::CRITIQUE), Some(j(15))));
        // Stock pour 20 j : IMMINENTE, rupture au jour 20.
        let p = calculer(&entrees(500.0, &[], true));
        assert_eq!((p.palier, p.palier_suivant, p.date_palier_suivant), (Some(palier::IMMINENTE), Some(palier::RUPTURE), Some(j(20))));
        // Aucun stock : RUPTURE, plus rien après.
        let p = calculer(&entrees(0.0, &[], true));
        assert_eq!((p.palier, p.palier_suivant), (Some(palier::RUPTURE), None));
        // Stock pour 200 j : aucun palier, passe ATTENTION au jour 110.
        let p = calculer(&entrees(5000.0, &[], true));
        assert_eq!((p.palier, p.palier_suivant, p.date_palier_suivant), (None, Some(palier::ATTENTION), Some(j(110))));
    }

    #[test]
    fn a_sec_avant_le_camion() {
        // T2 : épuisé après le jour 39, camion au jour 50 : 10 j à sec, 250 kg.
        for r in [true, false] {
            let p = calculer(&entrees(1000.0, &[(50, 1500.0)], r));
            let s = p.a_sec.expect("un trou avant le camion");
            assert_eq!((s.date_sec, s.date_arrivage, s.jours, s.manque_kg), (j(40), j(50), 10, 250.0));
            // La première rupture est le jour 40, quoi qu'en dise la couverture.
            assert_eq!((p.rupture_j, p.palier), (Some(40), Some(palier::CRITIQUE)));
        }
        // Arrivage avant l'épuisement : aucun trou.
        assert!(calculer(&entrees(1000.0, &[(20, 1500.0)], true)).a_sec.is_none());
        // Aucun arrivage : un épuisement, pas un trou avant un camion.
        assert!(calculer(&entrees(500.0, &[], true)).a_sec.is_none());
    }

    fn q(p: &Projete) -> f64 {
        p.quantite.as_ref().map_or(0.0, |q| q.quantite_kg)
    }

    #[test]
    fn t1_arrivage_avant_epuisement() {
        for r in [true, false] {
            let p = calculer(&entrees(1000.0, &[(20, 1500.0)], r));
            assert_eq!(p.couverture_j, Some(100));
            assert_eq!(q(&p), 0.0);
            assert_eq!(p.etat, etat::COUVERT);
            assert_eq!(p.position_kg, 2500.0);
            assert_eq!(p.jours_sans_fil, 0);
            // Le pont à C + N = 90 j : 1 000 + 1 500 − 2 250 = 250.
            let pont = p.pont.as_ref().unwrap();
            assert_eq!((pont.vise_j, pont.arrivages_kg, pont.plan_kg, pont.solde_kg), (90, 1500.0, 2250.0, 250.0));
        }
    }

    #[test]
    fn t2_arrivage_apres_epuisement_le_rattrapage_decide() {
        let inclus = calculer(&entrees(1000.0, &[(50, 1500.0)], true));
        let exclu = calculer(&entrees(1000.0, &[(50, 1500.0)], false));
        assert_eq!(inclus.couverture_j, Some(100));
        assert_eq!(exclu.couverture_j, Some(110));
        assert_eq!(inclus.manque_kg, 250.0);
        assert_eq!(exclu.manque_kg, 250.0);
        // Épuisé après le jour 39, arrivage au jour 50 : 10 jours sans fil (la
        // couverture, 100 ou 110 j, dépasse le délai de 30 j : rien après T).
        assert_eq!(inclus.jours_sans_fil, 10);
        assert_eq!(exclu.jours_sans_fil, 10);
        // La formation : 1 000 − 1 250 (dont 250 non servis) + 1 500.
        assert_eq!(inclus.etapes[0].conso_kg, 1250.0);
        assert_eq!(inclus.etapes[0].manque_kg, 250.0);
        assert_eq!(inclus.etapes[0].solde_kg, 1250.0);
        assert_eq!(exclu.etapes[0].solde_kg, 1500.0);
        assert_eq!(q(&inclus), 0.0);
    }

    #[test]
    fn jours_sans_fil_jusqu_au_prochain_approvisionnement() {
        // Sans arrivage, le prochain approvisionnement est une commande passée
        // aujourd'hui, reçue au bout du délai (65 j ici).
        let sans_arrivage = |stock: f64| {
            let mut x = entrees(stock, &[], true);
            x.delai_j = 65;
            calculer(&x)
        };
        // Stock pour 20 j : 65 − 20 = 45 j sans fil.
        let p = sans_arrivage(500.0);
        assert_eq!((p.couverture_j, p.jours_sans_fil), (Some(20), 45));
        // Aucun stock : tout le délai.
        assert_eq!(sans_arrivage(0.0).jours_sans_fil, 65);
        // Couvert au-delà du délai : aucun jour sans fil.
        assert_eq!(sans_arrivage(2000.0).jours_sans_fil, 0);
    }

    #[test]
    fn t3_deux_arrivages() {
        let p = calculer(&entrees(1000.0, &[(20, 1500.0), (50, 2000.0)], true));
        assert_eq!(p.couverture_j, Some(180));
        assert_eq!(p.etapes[0].solde_kg, 2000.0);
        assert_eq!(p.etapes[1].solde_kg, 3250.0);
    }

    #[test]
    fn t4_aucun_effet_de_seuil() {
        let a = calculer(&entrees(1000.0, &[(85, 1500.0)], true));
        let b = calculer(&entrees(1000.0, &[(95, 1500.0)], true));
        assert_eq!(a.couverture_j, Some(100));
        assert_eq!(b.couverture_j, Some(100));
        assert_eq!(calculer(&entrees(1000.0, &[(85, 1500.0)], false)).couverture_j, Some(145));
        assert_eq!(calculer(&entrees(1000.0, &[(95, 1500.0)], false)).couverture_j, Some(155));
    }

    #[test]
    fn t5_un_bon_en_retard_compte_aujourdhui() {
        let p = calculer(&entrees(1000.0, &[(-5, 1500.0)], true));
        assert_eq!(p.couverture_j, Some(100));
        assert_eq!(q(&p), 0.0);
    }

    #[test]
    fn t6_declenchement_puis_une_seule_commande() {
        let p = calculer(&entrees(1475.0, &[], true));
        assert_eq!(p.couverture_j, Some(59));
        assert_eq!(q(&p), 775.0);
        assert_eq!(p.etat, etat::ALERTE);
        assert_eq!(p.quantite.as_ref().unwrap().date_reception, j(30));
        // Le lendemain, la commande passée est dans la position.
        let lendemain = calculer(&entrees(1450.0, &[(29, 775.0)], true));
        assert_eq!(lendemain.couverture_j, Some(89));
        assert_eq!(q(&lendemain), 0.0);
        assert_eq!(lendemain.etat, etat::COUVERT);
    }

    #[test]
    fn t7_le_stock_minimum_ne_change_pas_la_quantite() {
        let mut x = entrees(1475.0, &[], true);
        x.stock_min_kg = Some(300.0);
        let p = calculer(&x);
        assert_eq!(q(&p), 775.0);
        assert_eq!(p.stock_min_j, Some(12));
    }

    #[test]
    fn t8_alerte_minimum_et_palette() {
        let mut x = entrees(1200.0, &[], true);
        x.stock_min_kg = Some(300.0);
        x.multiple_kg = Some(400.0);
        x.kg_palette = Some(400.0);
        let p = calculer(&x);
        assert_eq!(p.couverture_j, Some(48));
        let qt = p.quantite.as_ref().unwrap();
        assert_eq!(qt.besoin_kg, 1050.0);
        assert_eq!(qt.quantite_kg, 1200.0);
        assert_eq!(qt.palettes, Some(3.0));
        assert_eq!(p.seuil_alerte_j, 42);
        assert_eq!(p.couverture_livraison_j, Some(18));
        assert_eq!(p.etat, etat::ALERTE);
        assert_eq!(p.avant_le, Some(j(-12)));
    }

    #[test]
    fn t9_sans_cible_aucune_quantite() {
        let mut x = entrees(1475.0, &[], true);
        x.cible_j = None;
        let p = calculer(&x);
        assert!(p.quantite.is_none());
        assert!(p.signaux.contains(&signal::CIBLE_NON_DEFINIE));
    }

    #[test]
    fn t10_le_rattrapage_change_la_quantite() {
        let inclus = calculer(&entrees(1000.0, &[(50, 400.0)], true));
        let exclu = calculer(&entrees(1000.0, &[(50, 400.0)], false));
        assert_eq!(inclus.couverture_j, Some(56));
        assert_eq!(exclu.couverture_j, Some(66));
        assert_eq!(q(&inclus), 850.0);
        assert_eq!(q(&exclu), 0.0);
        assert_eq!(inclus.etat, etat::ALERTE);
        assert_eq!(exclu.etat, etat::COUVERT);
    }

    #[test]
    fn sans_plan_couvert_sur_tout_horizon() {
        let mut x = entrees(0.0, &[], true);
        x.conso = vec![0.0; 100];
        let p = calculer(&x);
        assert_eq!(p.couverture_j, None);
        assert_eq!(p.etat, etat::COUVERT);
    }

    /// Propriété (§ 16.10-2) : sur des plans et arrivages tirés au hasard, sans
    /// arrivage après l'épuisement, l'option de rattrapage ne change pas T ; le
    /// stock minimum ne change jamais Q.
    #[test]
    fn proprietes_sur_plans_aleatoires() {
        let mut graine: u64 = 0x5eed;
        let mut hasard = |m: u64| {
            graine = graine.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (graine >> 33) % m
        };
        for _ in 0..200 {
            let conso: Vec<f64> = (0..365).map(|_| hasard(40) as f64).collect();
            let stock = hasard(3000) as f64;
            let mut arrivees = Vec::new();
            for _ in 0..hasard(4) {
                arrivees.push((j(hasard(200) as i64), hasard(2000) as f64));
            }
            let mut x = entrees(stock, &[], true);
            x.conso = conso.clone();
            x.arrivees = arrivees.clone();
            let inclus = calculer(&x);
            x.rattrapage = false;
            let exclu = calculer(&x);
            // Aucun arrivage tardif : ni manque avant T, ni arrivage après T.
            let tardif = inclus.couverture_j.is_some_and(|t| arrivees.iter().any(|(d, _)| *d > j(t)));
            if inclus.manque_kg < EPS && !tardif {
                assert_eq!(inclus.couverture_j, exclu.couverture_j);
            }
            x.rattrapage = true;
            x.stock_min_kg = Some(hasard(5000) as f64);
            let avec_min = calculer(&x);
            assert_eq!(q(&inclus), q(&avec_min));
        }
    }
}
