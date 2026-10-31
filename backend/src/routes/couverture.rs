//! LA COUVERTURE DU PLAN PAR RÉFÉRENCE (étape 1 du plan du 26/10/2026) :
//! `GET /api/couverture` (la liste) et `GET /api/couverture/{reference}` (le détail).
//!
//! Ce module LIT ; le calcul est dans `domain/couverture.rs` (pur, testé sans
//! base). Une seule lecture sert les deux routes (toutes les références, ou une
//! seule) et la génération du plan d'achat (`premieres_propositions`, 27/10/2026 :
//! « Commander » part de la première proposition du moteur) : la liste, le détail
//! et la proposition enregistrée ne peuvent pas diverger.
//!
//! UNE SEULE SOURCE DE VÉRITÉ (arbitrage du 27/10/2026) : tout ce qui dit d'une
//! référence qu'elle est couverte, en rupture inévitable, sous la sécurité, sous la
//! cible ou « à commander » (moteur v2, 27/10/2026, soir)
//! vient d'ici — `etats()` pour les écrans et les compteurs (cockpit, briefing,
//! stock projeté, mur de risques, indicateurs du plan d'achat, assistant, saisie
//! d'un bon) et `controles_moteur()` pour les contrôles qui en dépendent (C05,
//! C25, C68, C69). L'ancien calcul (`v_stock_projete`, `v_plan_achat`, `v_encours_fiable`,
//! `v_besoin_horizon`…) est retiré par 2026-10-27e.
//!
//! Ce qui est COMPTÉ aujourd'hui (décisions du 26/10/2026 et du 27/10/2026) :
//!   * le stock des magasins comptés au plan (`inclure_mrp = 1`, hors
//!     quarantaine), lots libres — restes et dormants compris —, lots BLOQUÉS exclus ;
//!   * le fil sur les machines au dernier constat (`machine_etat.kg`), QUEL QUE
//!     SOIT son âge, restes chargés compris, lots bloqués exclus ;
//!   * les lignes de bon VALIDÉ / ENVOYÉ / LIVRÉ PARTIEL, à la date de livraison
//!     prévue de la ligne, sinon de l'en-tête (règle PROVISOIRE) ;
//!   * le fil EN ROUTE (transfert expédié vers un magasin compté), à sa DATE
//!     PRÉVUE DE DISPONIBILITÉ (`transfert.date_disponibilite_prevue`, obligatoire
//!     à l'expédition, révisable tant qu'il roule) : catégorie TRANSIT. Jamais une
//!     date déduite d'un constat machine ni d'autre chose.
//!
//! Ce qui est AFFICHÉ À PART, jamais compté : quarantaine, bloqué, magasins hors
//! plan, bons et transferts en retard ou sans date, bons non validés, import en
//! route sans bon. Ni les prêts ni les réceptions non validées n'entrent.
//!
//! Aucun montant ne sort d'ici (des kilos et des dates) ; le masquage par champ
//! s'applique quand même à la sortie, comme sur les routes voisines.

use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::db::{arrondi_kg, Db};
use crate::domain::projete;
use crate::domain::couverture::{
    self, jours_du_mois, signal, Arrivee, Couverture, MoisPlan, Reglages, Signal, Source, MAX_PROPOSITIONS,
    trop_tard_pour_commander,
};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{Datelike, NaiveDate};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use std::collections::{BTreeMap, HashMap};

/// Les règles de date d'arrivage, provisoires (26/10/2026) : l'écran les affiche
/// telles quelles.
const REGLES_PROVISOIRES: &[&str] = &[
    "Un bon VALIDÉ, ENVOYÉ ou LIVRÉ PARTIEL arrive à la date de livraison prévue de sa ligne, sinon à celle de l'en-tête du bon.",
    "Une date de livraison dépassée met la ligne EN RETARD : hors couverture, listée à part, tant qu'aucune nouvelle date n'existe.",
    "Un bon sans date de livraison prévue est hors couverture, listé à part.",
    "Un bon non validé (brouillon, contrôle, demande de prix, attente de validation) ne compte pas.",
    "L'import en route sans bon n'a pas de date fiable : hors couverture, listé à part.",
    "Un transfert en route arrive au magasin destinataire à sa date prévue de disponibilité, saisie à l'expédition et révisable tant qu'il roule : il est compté à cette date.",
    "Une date prévue de disponibilité dépassée met le transfert EN RETARD : hors couverture tant qu'aucune nouvelle date n'est saisie. Un transfert en route sans date (expédié avant la règle) est hors couverture, listé « sans date ».",
    "La réception normale arrive C jours avant la rupture (C = couverture cible de la fiche article) ; la commande couvre la fenêtre [R, R + N[, N = couverture du fournisseur, sinon P_MargeJours (30 jours pleins par défaut).",
    "Une référence sans classe ABC prend la plus longue des trois sécurités ; le défaut de données est signalé sur la ligne.",
    "Un article actif au besoin du plan en service sans couverture cible n'a pas de proposition : la configuration MRP est incomplète (signal).",
];

/// LES QUATRE ÉTATS d'une référence au sens du moteur v2 (§ 15.4, 27/10/2026) :
/// RUPTURE_INEVITABLE, SOUS_SECURITE, SOUS_CIBLE, COUVERT — le plus grave
/// l'emporte. Ils remplacent PLAN_NON_COUVERT / SOUS_SECURITE / COUVERT partout
/// où une référence est dite couverte ou non. Les signaux sont à part.
pub mod statut {
    pub use crate::domain::couverture::etat::*;
}

/// LES ÉTATS D'UN MOIS de la frise (mur de risques, photo du plan) : une part du
/// plan du mois n'est pas couverte, le point bas passe sous le seuil de sécurité
/// un jour du mois, ou rien de cela. Une lecture de la projection, pas l'état
/// d'une référence.
pub mod statut_mois {
    pub const PLAN_NON_COUVERT: &str = "PLAN_NON_COUVERT";
    pub const SOUS_SECURITE: &str = "SOUS_SECURITE";
    pub const COUVERT: &str = "COUVERT";
}

// ============================================================================
// Ce qui se lit
// ============================================================================

#[derive(Clone)]
struct Parametres {
    securite: [i64; 3],
    delai_defaut: i64,
    marge_jours: i64,
    /// Les paliers de rupture du stock projeté (31/10/2026) : [imminente,
    /// critique, attention] = P_SeuilImminent, P_SeuilCritique, P_SeuilAlerte.
    seuils_rupture: [i64; 3],
    /// Les restes comptés dans le stock du projeté, par défaut (31/10/2026,
    /// `P_ProjeteRestes`, oui sauf réglage) : le plan d'achat suit ce réglage,
    /// l'écran peut le basculer.
    restes: bool,
    /// Les réglages du stock projeté (31/10/2026), chacun à son comportement
    /// d'avant tant qu'on n'y touche pas.
    projete: ReglagesProjete,
}

/// LES RÉGLAGES DU STOCK PROJETÉ (31/10/2026) — le plan d'achat les suit ; les
/// boutons de l'écran (rattrapage, restes) ne changent que l'affichage.
#[derive(Clone)]
struct ReglagesProjete {
    /// `P_ProjeteRattrapage` (1) : le rattrapage par défaut.
    rattrapage: bool,
    /// `P_ProjeteAgeConstatMax` (0 = sans limite) : au-delà de cet âge, le fil
    /// d'un constat machine ne compte plus.
    age_constat_max_j: i64,
    /// `P_ProjeteQuarantaine` (0) : la quarantaine comptée (en urgence).
    quarantaine: bool,
    /// `P_ProjeteRetardJours` (0) : un bon en retard compte à aujourd'hui + N.
    retard_j: i64,
    /// `P_ProjeteSansDate` (0) : un arrivage sans date compte à aujourd'hui + délai.
    sans_date: bool,
    /// `P_ProjeteMinMultiple` (1) : minimum de commande et multiple appliqués.
    min_multiple: bool,
    /// `P_ProjeteMinimumAlerte` (1) : le stock minimum dans le seuil d'alerte.
    minimum_alerte: bool,
}

/// Un réglage oui / non : `0`, `non`, `false`, `faux` disent non ; absent, le défaut.
fn oui(v: Option<String>, defaut: bool) -> bool {
    match v.map(|s| s.trim().to_lowercase()).as_deref() {
        None | Some("") => defaut,
        Some("0" | "non" | "false" | "faux") => false,
        Some(_) => true,
    }
}

#[derive(Clone)]
struct PlanEnService {
    id_plan: String,
    libelle: Option<String>,
    date_debut: Option<NaiveDate>,
    date_fin: Option<NaiveDate>,
    date_photo: Option<NaiveDate>,
    fin_horizon: NaiveDate,
}

#[derive(Clone)]
struct Fiche {
    code_reference: String,
    designation: Option<String>,
    classe_abc: Option<String>,
    actif: bool,
    code_fournisseur: Option<String>,
    fournisseur_nom: Option<String>,
    delai_fournisseur: Option<i64>,
    couverture_fournisseur: Option<i64>,
    moq_kg: Option<f64>,
    multiple_achat_kg: Option<f64>,
    arrondi_palette: bool,
    poids_bobine_kg: Option<f64>,
    bobines_par_palette: Option<i64>,
    /// La couverture cible de la fiche (mois) : C = 30 × mois. Absente : aucune proposition.
    couverture_cible_mois: Option<f64>,
    /// Le stock minimum de la fiche : un garde-fou, un signal seulement.
    stock_min_kg: Option<f64>,
}

#[derive(Clone)]
struct LigneMagasin {
    code_magasin: String,
    nom: Option<String>,
    inclure_mrp: bool,
    quarantaine: bool,
    quantite_kg: f64,
    bloque_kg: f64,
    restes_kg: f64,
}

#[derive(Clone)]
struct LigneMachine {
    code_emplacement: String,
    lot_fournisseur: Option<String>,
    kg: f64,
    date_constat: Option<NaiveDate>,
    mode_constat: Option<String>,
    bloque: bool,
    reste: bool,
}

#[derive(Clone)]
struct LigneBon {
    id_bc: String,
    numero_bc: Option<String>,
    statut_bc: String,
    code_fournisseur: Option<String>,
    id_ligne_bc: String,
    ligne_numero: Option<i64>,
    reste_kg: f64,
    date_ligne: Option<NaiveDate>,
    date_entete: Option<NaiveDate>,
    /// Une ligne née d'une hypothèse de l'espace « Simulation » (« arrivage
    /// ajouté », « commande simulée ») : jamais lue de la base, jamais écrite.
    hypothese: Option<&'static str>,
}

#[derive(Clone)]
struct LignePort {
    id_dossier: String,
    numero_dossier: Option<String>,
    statut_dossier: Option<String>,
    numero_facture: Option<String>,
    lot_fournisseur: Option<String>,
    reste_kg: f64,
    date_arrivee: Option<NaiveDate>,
}

#[derive(Clone)]
struct LigneTransit {
    id_transfert: String,
    id_ligne_transfert: String,
    numero_transfert: Option<String>,
    code_magasin_source: Option<String>,
    code_magasin_dest: Option<String>,
    lot_fournisseur: Option<String>,
    kg: f64,
    date_expedition: Option<NaiveDate>,
    /// La date prévue de disponibilité au magasin destinataire (27/10/2026).
    date_prevue: Option<NaiveDate>,
    /// Modifié par une hypothèse de la simulation (jamais lu de la base).
    hypothese: Option<&'static str>,
}

#[derive(Clone)]
struct Donnees {
    aujourdhui: NaiveDate,
    parametres: Parametres,
    plan: Option<PlanEnService>,
    fiches: BTreeMap<String, Fiche>,
    besoin: HashMap<String, Vec<(String, MoisPlan)>>,
    magasins: HashMap<String, Vec<LigneMagasin>>,
    machine: HashMap<String, Vec<LigneMachine>>,
    bons: HashMap<String, Vec<LigneBon>>,
    port: HashMap<String, Vec<LignePort>>,
    transits: HashMap<String, Vec<LigneTransit>>,
}

fn entier(v: Option<String>, defaut: i64) -> i64 {
    v.and_then(|s| s.trim().parse::<f64>().ok()).map_or(defaut, |x| x.round() as i64)
}

/// Lit tout ce que le moteur demande, pour toutes les références (`None`) ou
/// une seule. Neuf requêtes simples, sans vue lourde : la liste entière se lit
/// en une fois.
async fn charger(db: &Db, filtre: Option<&str>) -> AppResult<Donnees> {
    let ctx = sqlx::query(
        "SELECT CURRENT_DATE AS aujourdhui,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_SecuriteA') AS sec_a,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_SecuriteB') AS sec_b,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_SecuriteC') AS sec_c,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_DelaiDefaut') AS delai,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_MargeJours') AS marge,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_SeuilImminent') AS seuil_imminent,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_SeuilCritique') AS seuil_critique,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_SeuilAlerte') AS seuil_attention,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_ProjeteRestes') AS restes,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_ProjeteRattrapage') AS pj_rattrapage,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_ProjeteAgeConstatMax') AS pj_age,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_ProjeteQuarantaine') AS pj_quarantaine,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_ProjeteRetardJours') AS pj_retard,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_ProjeteSansDate') AS pj_sans_date,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_ProjeteMinMultiple') AS pj_min_multiple,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_ProjeteMinimumAlerte') AS pj_minimum_alerte",
    )
    .fetch_one(db)
    .await?;
    let aujourdhui: NaiveDate = ctx.try_get("aujourdhui")?;
    // Un paramètre absent prend la valeur livrée par le socle (30 j, 60 j, 30 j).
    let parametres = Parametres {
        securite: [
            entier(ctx.try_get("sec_a")?, 30),
            entier(ctx.try_get("sec_b")?, 30),
            entier(ctx.try_get("sec_c")?, 30),
        ],
        delai_defaut: entier(ctx.try_get("delai")?, 60),
        marge_jours: entier(ctx.try_get("marge")?, 30),
        seuils_rupture: [
            entier(ctx.try_get("seuil_imminent")?, 30),
            entier(ctx.try_get("seuil_critique")?, 60),
            entier(ctx.try_get("seuil_attention")?, 90),
        ],
        // Absent : oui (les restes comptent, décision du 26/10/2026).
        restes: oui(ctx.try_get("restes")?, true),
        projete: ReglagesProjete {
            rattrapage: oui(ctx.try_get("pj_rattrapage")?, true),
            age_constat_max_j: entier(ctx.try_get("pj_age")?, 0).max(0),
            quarantaine: oui(ctx.try_get("pj_quarantaine")?, false),
            retard_j: entier(ctx.try_get("pj_retard")?, 0).max(0),
            sans_date: oui(ctx.try_get("pj_sans_date")?, false),
            min_multiple: oui(ctx.try_get("pj_min_multiple")?, true),
            minimum_alerte: oui(ctx.try_get("pj_minimum_alerte")?, true),
        },
    };

    // Le plan en service (un seul : ux_plan_unique_en_cours).
    let plan = sqlx::query(
        "SELECT p.id_plan, p.libelle, p.date_debut, p.date_fin,
                (SELECT max(b.annee_mois) FROM besoin_mrp b WHERE b.id_plan = p.id_plan) AS dernier_mois,
                (SELECT max(b.date_reference) FROM besoin_mrp b WHERE b.id_plan = p.id_plan) AS date_photo
           FROM plan_production p
          WHERE p.statut = 'EN_COURS'",
    )
    .fetch_optional(db)
    .await?;
    let plan = match plan {
        None => None,
        Some(p) => {
            let date_fin: Option<NaiveDate> = p.try_get("date_fin")?;
            let dernier_mois: Option<String> = p.try_get("dernier_mois")?;
            // L'horizon est celui du plan : sa date de fin, ou la fin de son dernier
            // mois de besoin si elle va plus loin (aucun mois du plan n'est perdu).
            let fin_dernier_mois = dernier_mois.as_deref().and_then(annee_mois).map(|(a, m)| couverture::fin_du_mois(a, m));
            let fin_horizon = match (date_fin, fin_dernier_mois) {
                (Some(a), Some(b)) => a.max(b),
                (Some(a), None) => a,
                (None, Some(b)) => b,
                (None, None) => aujourdhui,
            };
            Some(PlanEnService {
                id_plan: p.try_get("id_plan")?,
                libelle: p.try_get("libelle")?,
                date_debut: p.try_get("date_debut")?,
                date_fin,
                date_photo: p.try_get("date_photo")?,
                fin_horizon,
            })
        }
    };

    let mut besoin: HashMap<String, Vec<(String, MoisPlan)>> = HashMap::new();
    if let Some(p) = &plan {
        let lignes = sqlx::query(
            "SELECT code_reference, annee_mois, sum(quantite_kg)::float8 AS kg
               FROM besoin_mrp
              WHERE id_plan = $1 AND ($2::text IS NULL OR code_reference = $2)
              GROUP BY 1, 2
              ORDER BY 1, 2",
        )
        .bind(&p.id_plan)
        .bind(filtre)
        .fetch_all(db)
        .await?;
        for l in lignes {
            let am: String = l.try_get("annee_mois")?;
            if let Some((annee, mois)) = annee_mois(&am) {
                besoin
                    .entry(l.try_get("code_reference")?)
                    .or_default()
                    .push((am, MoisPlan { annee, mois, kg: l.try_get("kg")? }));
            }
        }
    }

    let mut fiches = BTreeMap::new();
    for l in sqlx::query(
        "SELECT r.code_reference, r.designation, r.classe_abc, COALESCE(r.actif, 1) = 1 AS actif,
                r.code_fournisseur, f.nom AS fournisseur_nom,
                f.delai_livraison_jours, f.couverture_commande_j,
                r.moq_kg::float8 AS moq_kg, r.multiple_achat_kg::float8 AS multiple_achat_kg,
                COALESCE(r.arrondi_palette, 0) = 1 AS arrondi_palette,
                r.poids_bobine_kg::float8 AS poids_bobine_kg, r.bobines_par_palette,
                r.couverture_cible_mois::float8 AS couverture_cible_mois, r.stock_min_kg::float8 AS stock_min_kg
           FROM reference r
           LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
          WHERE ($1::text IS NULL OR r.code_reference = $1)",
    )
    .bind(filtre)
    .fetch_all(db)
    .await?
    {
        let code: String = l.try_get("code_reference")?;
        fiches.insert(
            code.clone(),
            Fiche {
                code_reference: code,
                designation: l.try_get("designation")?,
                classe_abc: l.try_get("classe_abc")?,
                actif: l.try_get("actif")?,
                code_fournisseur: l.try_get("code_fournisseur")?,
                fournisseur_nom: l.try_get("fournisseur_nom")?,
                delai_fournisseur: l.try_get("delai_livraison_jours")?,
                couverture_fournisseur: l.try_get("couverture_commande_j")?,
                moq_kg: l.try_get("moq_kg")?,
                multiple_achat_kg: l.try_get("multiple_achat_kg")?,
                arrondi_palette: l.try_get("arrondi_palette")?,
                poids_bobine_kg: l.try_get("poids_bobine_kg")?,
                bobines_par_palette: l.try_get("bobines_par_palette")?,
                couverture_cible_mois: l.try_get("couverture_cible_mois")?,
                stock_min_kg: l.try_get("stock_min_kg")?,
            },
        );
    }

    // Le stock des magasins, avec ses lots bloqués et ses restes (même lecture
    // que v_stock_physique, mais les restes y restent comptés).
    let mut magasins: HashMap<String, Vec<LigneMagasin>> = HashMap::new();
    for l in sqlx::query(
        "WITH lots AS (
             SELECT sl.code_reference, sl.code_magasin,
                    COALESCE(sum(sl.quantite_kg) FILTER (WHERE l.statut = 'BLOQUE'), 0) AS bloque,
                    COALESCE(sum(sl.quantite_kg) FILTER (WHERE l.categorie = 'RESTES' AND l.statut <> 'BLOQUE'
                                                          AND rr.suivi_lot = 1), 0) AS restes
               FROM stock_lot sl
               JOIN lot l ON l.code_reference = sl.code_reference AND l.lot_fournisseur = sl.lot_fournisseur
               JOIN reference rr ON rr.code_reference = sl.code_reference
              WHERE ($1::text IS NULL OR sl.code_reference = $1)
              GROUP BY 1, 2)
         SELECT sm.code_reference, sm.code_magasin, mg.nom,
                mg.inclure_mrp = 1 AS inclure_mrp, mg.est_quarantaine = 1 AS quarantaine,
                sm.quantite_kg::float8 AS quantite_kg,
                COALESCE(lo.bloque, 0)::float8 AS bloque_kg, COALESCE(lo.restes, 0)::float8 AS restes_kg
           FROM stock_magasin sm
           JOIN magasin mg ON mg.code_magasin = sm.code_magasin
           LEFT JOIN lots lo ON lo.code_reference = sm.code_reference AND lo.code_magasin = sm.code_magasin
          WHERE sm.quantite_kg <> 0 AND ($1::text IS NULL OR sm.code_reference = $1)
          ORDER BY sm.code_reference, sm.code_magasin",
    )
    .bind(filtre)
    .fetch_all(db)
    .await?
    {
        magasins.entry(l.try_get("code_reference")?).or_default().push(LigneMagasin {
            code_magasin: l.try_get("code_magasin")?,
            nom: l.try_get("nom")?,
            inclure_mrp: l.try_get("inclure_mrp")?,
            quarantaine: l.try_get("quarantaine")?,
            quantite_kg: l.try_get("quantite_kg")?,
            bloque_kg: l.try_get("bloque_kg")?,
            restes_kg: l.try_get("restes_kg")?,
        });
    }

    // Le fil sur les machines : l'état au dernier constat, quel que soit son âge.
    let mut machine: HashMap<String, Vec<LigneMachine>> = HashMap::new();
    for l in sqlx::query(
        "SELECT e.code_reference, e.code_emplacement, e.lot_fournisseur, e.kg::float8 AS kg,
                e.date_constat, e.mode_constat,
                COALESCE(l.statut, 'LIBRE') = 'BLOQUE' AS bloque,
                COALESCE(l.categorie, '') = 'RESTES' AS reste
           FROM machine_etat e
           LEFT JOIN lot l ON l.code_reference = e.code_reference AND l.lot_fournisseur = e.lot_fournisseur
          WHERE e.kg > 0 AND ($1::text IS NULL OR e.code_reference = $1)
          ORDER BY e.code_reference, e.code_emplacement, e.lot_fournisseur",
    )
    .bind(filtre)
    .fetch_all(db)
    .await?
    {
        machine.entry(l.try_get("code_reference")?).or_default().push(LigneMachine {
            code_emplacement: l.try_get("code_emplacement")?,
            lot_fournisseur: l.try_get("lot_fournisseur")?,
            kg: l.try_get("kg")?,
            date_constat: l.try_get("date_constat")?,
            mode_constat: l.try_get("mode_constat")?,
            bloque: l.try_get("bloque")?,
            reste: l.try_get("reste")?,
        });
    }

    // Les lignes de bon ouvertes, quel que soit le statut du bon (le classement
    // compté / non compté se fait plus bas, avec sa raison).
    let mut bons: HashMap<String, Vec<LigneBon>> = HashMap::new();
    for l in sqlx::query(
        "SELECT lb.code_reference, bc.id_bc, bc.numero_bc, bc.statut AS statut_bc, bc.code_fournisseur,
                lb.id_ligne_bc, lb.ligne_numero, lb.quantite_restante_kg::float8 AS reste_kg,
                lb.date_livraison_prevue AS date_ligne, bc.date_livraison_prevue AS date_entete
           FROM ligne_bc lb
           JOIN bon_commande bc ON bc.id_bc = lb.id_bc
          WHERE bc.statut NOT IN ('CLOTURE', 'ANNULE') AND lb.statut NOT IN ('ANNULE', 'SOLDE')
            AND lb.type_ligne = 'MARCHANDISE' AND lb.quantite_restante_kg > 0
            AND ($1::text IS NULL OR lb.code_reference = $1)
          ORDER BY lb.code_reference, COALESCE(lb.date_livraison_prevue, bc.date_livraison_prevue) NULLS LAST,
                   bc.numero_bc, lb.ligne_numero",
    )
    .bind(filtre)
    .fetch_all(db)
    .await?
    {
        bons.entry(l.try_get("code_reference")?).or_default().push(LigneBon {
            id_bc: l.try_get("id_bc")?,
            numero_bc: l.try_get("numero_bc")?,
            statut_bc: l.try_get("statut_bc")?,
            code_fournisseur: l.try_get("code_fournisseur")?,
            id_ligne_bc: l.try_get("id_ligne_bc")?,
            ligne_numero: l.try_get("ligne_numero")?,
            reste_kg: l.try_get("reste_kg")?,
            date_ligne: l.try_get("date_ligne")?,
            date_entete: l.try_get("date_entete")?,
            hypothese: None,
        });
    }

    // L'import en route SANS bon (la CTE `port` de v_encours_fiable, ligne à ligne).
    let mut port: HashMap<String, Vec<LignePort>> = HashMap::new();
    for l in sqlx::query(
        "SELECT fl.code_reference, d.id_dossier, d.numero AS numero_dossier, d.statut AS statut_dossier,
                f.numero_facture, fl.lot_fournisseur, fl.reste_kg::float8 AS reste_kg, d.date_arrivee
           FROM import_facture_lignes fl
           JOIN import_factures f ON f.id_facture = fl.id_facture
           JOIN import_dossiers d ON d.id_dossier = f.id_dossier
          WHERE d.statut NOT IN ('CLOTURE', 'BROUILLON') AND fl.type_ligne = 'ERP'
            AND fl.soldee = 0 AND fl.id_ligne_bc IS NULL AND fl.reste_kg > 0
            AND ($1::text IS NULL OR fl.code_reference = $1)
          ORDER BY fl.code_reference, d.numero, f.numero_facture",
    )
    .bind(filtre)
    .fetch_all(db)
    .await?
    {
        port.entry(l.try_get("code_reference")?).or_default().push(LignePort {
            id_dossier: l.try_get("id_dossier")?,
            numero_dossier: l.try_get("numero_dossier")?,
            statut_dossier: l.try_get("statut_dossier")?,
            numero_facture: l.try_get("numero_facture")?,
            lot_fournisseur: l.try_get("lot_fournisseur")?,
            reste_kg: l.try_get("reste_kg")?,
            date_arrivee: l.try_get("date_arrivee")?,
        });
    }

    // Les transferts en route vers un magasin compté (la CTE `en_route` de
    // v_stock_physique), avec leur date prévue de disponibilité (27/10/2026).
    let mut transits: HashMap<String, Vec<LigneTransit>> = HashMap::new();
    for l in sqlx::query(
        "SELECT lt.code_reference, t.id_transfert, lt.id_ligne_transfert, t.numero_transfert, t.code_magasin_source, t.code_magasin_dest,
                lt.lot_fournisseur, lt.quantite_kg::float8 AS kg,
                COALESCE(t.date_sortie::date, t.date_transfert) AS date_expedition,
                t.date_disponibilite_prevue AS date_prevue
           FROM transfert t
           JOIN ligne_transfert lt ON lt.id_transfert = t.id_transfert
           JOIN magasin md ON md.code_magasin = t.code_magasin_dest
          WHERE t.statut = 'VALIDE' AND md.inclure_mrp = 1 AND md.est_quarantaine = 0
            AND ($1::text IS NULL OR lt.code_reference = $1)
          ORDER BY lt.code_reference, t.numero_transfert",
    )
    .bind(filtre)
    .fetch_all(db)
    .await?
    {
        transits.entry(l.try_get("code_reference")?).or_default().push(LigneTransit {
            id_transfert: l.try_get("id_transfert")?,
            id_ligne_transfert: l.try_get("id_ligne_transfert")?,
            numero_transfert: l.try_get("numero_transfert")?,
            code_magasin_source: l.try_get("code_magasin_source")?,
            code_magasin_dest: l.try_get("code_magasin_dest")?,
            lot_fournisseur: l.try_get("lot_fournisseur")?,
            kg: l.try_get("kg")?,
            date_expedition: l.try_get("date_expedition")?,
            date_prevue: l.try_get("date_prevue")?,
            hypothese: None,
        });
    }

    Ok(Donnees { aujourdhui, parametres, plan, fiches, besoin, magasins, machine, bons, port, transits })
}

/// « 2026-10 » → (2026, 10).
fn annee_mois(s: &str) -> Option<(i32, u32)> {
    let (a, m) = s.trim().split_once('-')?;
    let (a, m) = (a.parse().ok()?, m.get(..2).unwrap_or(m).parse().ok()?);
    (1..=12).contains(&m).then_some((a, m))
}

// ============================================================================
// L'analyse d'une référence
// ============================================================================

/// Un arrivage classé : compté au jour près, ou listé à part avec sa raison.
struct ArrivageClasse {
    detail: Value,
    date: Option<NaiveDate>,
    kg: f64,
    categorie: &'static str,
    compte: bool,
}

struct Analyse<'a> {
    fiche: &'a Fiche,
    reglages: Reglages,
    source_delai: Source,
    source_couverture: Source,
    source_securite: String,
    source_multiple: &'static str,
    /// La cible en mois (fiche ou simulation) et sa source ; `None` : non définie.
    cible_mois: Option<f64>,
    source_cible: Option<Source>,
    /// Un DÉFAUT DE DONNÉES de la fiche qui a imposé un réglage par défaut
    /// (aujourd'hui : pas de classe ABC). Signalé sur la ligne, jamais bloquant.
    defaut_donnees: Option<String>,
    magasin_compte_kg: f64,
    machine_compte_kg: f64,
    restes_kg: f64,
    /// LES RESTES COMPTÉS, par où ils sont (27/10/2026, stock projeté) : la part
    /// de `magasin_compte_kg` et la part de `machine_compte_kg` qui sont des
    /// restes. Le stock projeté les montre dans une colonne « Restant » ; les
    /// colonnes « disponible » et « sur machine » les retirent, et la somme des
    /// trois rend exactement le disponible du moteur (aucun double comptage).
    restes_magasin_kg: f64,
    restes_machine_kg: f64,
    quarantaine_kg: f64,
    bloque_kg: f64,
    hors_plan_kg: f64,
    arrivages: Vec<ArrivageClasse>,
    resultat: Couverture,
}

impl Analyse<'_> {
    fn somme(&self, categorie: &str) -> f64 {
        // « + 0.0 » : la somme vide de Rust vaut −0,0, qui s'afficherait « -0.0 ».
        arrondi_kg(self.arrivages.iter().filter(|a| a.categorie == categorie).map(|a| a.kg).sum::<f64>()) + 0.0
    }
    fn a_du_stock(&self) -> bool {
        self.magasin_compte_kg + self.machine_compte_kg + self.quarantaine_kg + self.bloque_kg + self.hors_plan_kg
            > 1e-9
    }
    /// Un arrivage quel qu'il soit, compté ou non (en retard, sans date, import sans
    /// bon, transfert en route, bon non validé, après l'horizon).
    fn a_un_arrivage(&self) -> bool {
        self.arrivages.iter().any(|a| a.kg > 1e-9)
    }
    /// LA LISTE (27/10/2026) : une demande au plan, du stock, OU un arrivage — même
    /// hors couverture. Une référence sans plan ni stock mais avec 1 250 kg d'import
    /// sans bon en route doit se voir, avec ses kilos hors couverture.
    fn a_lister(&self) -> bool {
        self.resultat.plan_horizon_kg > 0.0 || self.a_du_stock() || self.a_un_arrivage()
    }
    /// L'état de la référence au sens du moteur (voir `statut`).
    fn statut(&self) -> &'static str {
        self.resultat.etat
    }
    /// La raison de l'état, en une phrase chiffrée.
    fn raison_etat(&self) -> String {
        couverture::raison_etat(&self.resultat, self.reglages.aujourdhui, self.reglages.delai_j)
    }
    /// L'indice de jour de la réception proposée (la 1re proposition).
    fn indice_reception(&self) -> Option<usize> {
        self.resultat
            .propositions
            .first()
            .map(|p| (p.date_disponibilite - self.reglages.aujourdhui).num_days().max(0) as usize)
    }
    /// LE BESOIN JUSQU'À RÉCEPTION : le plan daté de [aujourd'hui, D[, D la
    /// réception proposée ; `None` sans réception proposée.
    fn besoin_jusqu_reception_kg(&self) -> Option<f64> {
        self.indice_reception()
            .map(|d| arrondi_kg(couverture::plan_des_premiers_jours(&self.resultat, d as i64)) + 0.0)
    }
    /// LE STOCK À LA RÉCEPTION : B(D − 1), le solde au soir de la veille de D,
    /// avant la commande proposée (la projection sans proposition).
    fn stock_a_la_reception_kg(&self) -> Option<f64> {
        let stock = self.magasin_compte_kg + self.machine_compte_kg;
        self.indice_reception().map(|d| {
            if d == 0 {
                arrondi_kg(stock) + 0.0
            } else {
                self.resultat.jours.get(d - 1).map_or(0.0, |j| j.solde_kg)
            }
        })
    }
    /// Les codes des signaux (indépendants de l'état).
    fn codes_signaux(&self) -> Vec<&'static str> {
        self.resultat.signaux.iter().map(|s| s.code).collect()
    }
    /// Les jours couverts à partir d'aujourd'hui : jusqu'à la veille de la
    /// première rupture (0 = rupture aujourd'hui) ; `None` sans rupture sur l'horizon.
    fn jours_couverture(&self) -> Option<i64> {
        self.resultat.premiere_rupture.map(|r| (r - self.reglages.aujourdhui).num_days())
    }
    /// « À commander aujourd'hui » : la date limite de commande de la première
    /// proposition est atteinte ou dépassée.
    fn a_commander_aujourdhui(&self) -> bool {
        self.resultat
            .propositions
            .first()
            .is_some_and(|p| p.date_limite_commande <= self.reglages.aujourdhui)
    }
    /// LE PLAN PAR MOIS que le moteur consomme (27/10/2026) : le plan de l'horizon
    /// ramené à un mois de 30 jours (plan de l'horizon × 30 ÷ jours de l'horizon,
    /// aujourd'hui compris). Il remplace la « conso / mois » de l'ancienne
    /// consommation retenue dans les listes pilotées par le moteur.
    fn plan_mois_kg(&self) -> f64 {
        let n = self.resultat.jours.len();
        if n == 0 {
            return 0.0;
        }
        arrondi_kg(self.resultat.plan_horizon_kg * 30.0 / n as f64) + 0.0
    }
    /// Les kilos des arrivages comptés (bons datés, transferts en route datés).
    fn arrivages_comptes_kg(&self) -> f64 {
        arrondi_kg(self.arrivages.iter().filter(|a| a.compte).map(|a| a.kg).sum::<f64>()) + 0.0
    }
    /// LES COLONNES DU STOCK PROJETÉ (27/10/2026), tirées de ce que le moteur
    /// compte, sans autre règle : disponible en magasin hors restes, sur machine
    /// hors restes, restant (les restes comptés), arrivages comptés, et leur
    /// somme — le stock d'aujourd'hui du moteur plus ses arrivages comptés.
    fn colonnes_stock_projete(&self) -> [(&'static str, f64); 4] {
        let magasin = (self.magasin_compte_kg - self.restes_magasin_kg).max(0.0);
        let machine = (self.machine_compte_kg - self.restes_machine_kg).max(0.0);
        let restant = self.restes_magasin_kg + self.restes_machine_kg;
        let arrivages: f64 = self.arrivages.iter().filter(|a| a.compte).map(|a| a.kg).sum();
        [
            ("magasin_hors_restes_kg", arrondi_kg(magasin) + 0.0),
            ("machine_hors_restes_kg", arrondi_kg(machine) + 0.0),
            ("restant_kg", arrondi_kg(restant) + 0.0),
            ("stock_total_projete_kg", arrondi_kg(magasin + machine + restant + arrivages) + 0.0),
        ]
    }
    /// LE BESOIN JUSQU'À LIVRAISON : le plan des jours [aujourd'hui, aujourd'hui
    /// + délai[, lu sur la projection du moteur.
    fn besoin_jusqu_livraison_kg(&self) -> f64 {
        arrondi_kg(couverture::plan_des_premiers_jours(&self.resultat, self.reglages.delai_j)) + 0.0
    }
}

/// LES HYPOTHÈSES DE RÉGLAGE de l'espace « Simulation » (27/10/2026) : elles
/// remplacent, en mémoire, une entrée que le moteur reçoit déjà — jamais une
/// règle. `None` : la valeur de la fiche, du fournisseur ou des paramètres.
#[derive(Debug, Default, Clone)]
struct Surcharges {
    delai_j: Option<i64>,
    couverture_j: Option<i64>,
    jours_securite: Option<i64>,
    /// La couverture cible C, en mois (§ 15.7-6).
    couverture_cible_mois: Option<f64>,
    /// 0 = aucun minimum.
    moq_kg: Option<f64>,
    /// 0 = pas d'arrondi.
    multiple_kg: Option<f64>,
}

fn analyser<'a>(d: &'a Donnees, fiche: &'a Fiche) -> Analyse<'a> {
    analyser_avec(d, fiche, &Surcharges::default())
}

/// L'analyse d'une référence, avec les hypothèses de réglage de la simulation
/// (aucune, d'ordinaire). Les arrivages simulés passent, eux, par `Donnees` :
/// ils sont classés par les mêmes règles que les vrais.
fn analyser_avec<'a>(d: &'a Donnees, fiche: &'a Fiche, s: &Surcharges) -> Analyse<'a> {
    let code = fiche.code_reference.as_str();
    let auj = d.aujourdhui;
    let fin = d.plan.as_ref().map_or(auj, |p| p.fin_horizon.max(auj));
    let p = &d.parametres;

    // Délai et couverture : le fournisseur, sinon le paramètre global (source affichée).
    let (delai_j, source_delai) = match (s.delai_j, fiche.delai_fournisseur.filter(|x| *x >= 0)) {
        (Some(x), _) => (x, Source::Simulation),
        (None, Some(x)) => (x, Source::Fournisseur),
        (None, None) => (p.delai_defaut, Source::ParametreGlobal),
    };
    // Une couverture de 0 jour ne couvrirait rien : elle vaut « non renseignée ».
    let (couverture_j, source_couverture) = match (s.couverture_j, fiche.couverture_fournisseur.filter(|x| *x > 0)) {
        (Some(x), _) => (x, Source::Simulation),
        (None, Some(x)) => (x, Source::Fournisseur),
        (None, None) => (p.marge_jours, Source::ParametreGlobal),
    };
    // Les jours de sécurité de la classe ABC ; sans classe, la plus prudente des
    // trois (décision du 27/10/2026 : on la garde), et le défaut de données est
    // signalé sur la ligne, jamais bloquant.
    let (jours_securite, source_securite, defaut_donnees) = match fiche.classe_abc.as_deref().map(str::trim) {
        Some("A") => (p.securite[0], "classe A (P_SecuriteA)".to_string(), None),
        Some("B") => (p.securite[1], "classe B (P_SecuriteB)".to_string(), None),
        Some("C") => (p.securite[2], "classe C (P_SecuriteC)".to_string(), None),
        autre => {
            let jours = p.securite.iter().copied().max().unwrap_or(0);
            let classe = autre.filter(|c| !c.is_empty());
            (
                jours,
                format!("classe {} : la plus longue des trois", classe.unwrap_or("absente")),
                Some(match classe {
                    Some(c) => format!("classe ABC « {c} » inconnue : sécurité par défaut de {jours} j (la plus longue des trois)"),
                    None => format!("sans classe ABC : sécurité par défaut de {jours} j (la plus longue des trois)"),
                }),
            )
        }
    };
    let kg_palette = match (fiche.poids_bobine_kg, fiche.bobines_par_palette) {
        (Some(pb), Some(bp)) if pb > 0.0 && bp > 0 => Some(arrondi_kg(pb * bp as f64)),
        _ => None,
    };
    let (multiple_kg, source_multiple) = match fiche.multiple_achat_kg.filter(|m| *m > 0.0) {
        Some(m) => (Some(m), "multiple d'achat de la fiche"),
        None if fiche.arrondi_palette && kg_palette.is_some() => (kg_palette, "palette de la fiche (arrondi à la palette)"),
        None if fiche.arrondi_palette => (None, "arrondi à la palette demandé, palette inconnue de la fiche : pas d'arrondi"),
        None => (None, "aucun multiple sur la fiche : kg"),
    };
    // Les hypothèses de la simulation remplacent l'entrée, et la source le dit.
    let (jours_securite, source_securite) = match s.jours_securite {
        Some(j) => (j, "simulation".to_string()),
        None => (jours_securite, source_securite),
    };
    let (multiple_kg, source_multiple) = match s.multiple_kg {
        Some(m) if m > 0.0 => (Some(m), "simulation : multiple saisi"),
        Some(_) => (None, "simulation : sans arrondi (kg)"),
        None => (multiple_kg, source_multiple),
    };
    let moq_kg = match s.moq_kg {
        Some(m) => Some(m).filter(|m| *m > 0.0),
        None => fiche.moq_kg.filter(|m| *m > 0.0),
    };
    // LA COUVERTURE CIBLE (§ 15.2) : la fiche article, obligatoire pour un
    // article soumis au MRP ; absente, aucune proposition et aucun repli.
    let (cible_mois, source_cible) = match (s.couverture_cible_mois, fiche.couverture_cible_mois.filter(|m| *m >= 0.0)) {
        (Some(m), _) => (Some(m), Some(Source::Simulation)),
        (None, Some(m)) => (Some(m), Some(Source::Fiche)),
        (None, None) => (None, None),
    };
    // Soumis au MRP : actif ET présent dans le besoin du plan en service (§ 15.9 bis-1).
    let soumis_mrp = fiche.actif && d.besoin.contains_key(code);
    let reglages = Reglages {
        aujourdhui: auj,
        fin_horizon: fin,
        delai_j,
        couverture_j,
        jours_securite,
        cible_j: cible_mois.map(|m| (m * 30.0).round() as i64),
        stock_min_kg: fiche.stock_min_kg,
        soumis_mrp,
        moq_kg,
        multiple_kg,
        kg_palette,
        max_propositions: MAX_PROPOSITIONS,
    };

    // ---- Les ressources d'aujourd'hui -----------------------------------------
    let (mut magasin_compte_kg, mut quarantaine_kg, mut bloque_kg, mut hors_plan_kg, mut restes_kg) =
        (0.0, 0.0, 0.0, 0.0, 0.0);
    let (mut restes_magasin_kg, mut restes_machine_kg) = (0.0, 0.0);
    for m in d.magasins.get(code).into_iter().flatten() {
        if m.quarantaine {
            quarantaine_kg += m.quantite_kg;
        } else if !m.inclure_mrp {
            hors_plan_kg += m.quantite_kg;
        } else {
            let compte = (m.quantite_kg - m.bloque_kg).max(0.0);
            magasin_compte_kg += compte;
            bloque_kg += m.bloque_kg;
            restes_kg += m.restes_kg;
            // Jamais plus de restes que de kilos comptés dans ce magasin.
            restes_magasin_kg += m.restes_kg.clamp(0.0, compte);
        }
    }
    let mut machine_compte_kg = 0.0;
    for e in d.machine.get(code).into_iter().flatten() {
        if e.bloque {
            bloque_kg += e.kg;
        } else {
            machine_compte_kg += e.kg;
            if e.reste {
                restes_kg += e.kg;
                restes_machine_kg += e.kg;
            }
        }
    }

    // ---- Les arrivages, classés -------------------------------------------------
    let mut arrivages = Vec::new();
    for b in d.bons.get(code).into_iter().flatten() {
        let (date, source_date) = match (b.date_ligne, b.date_entete) {
            (Some(x), _) => (Some(x), Some("ligne")),
            (None, Some(x)) => (Some(x), Some("en-tête")),
            (None, None) => (None, None),
        };
        let valide = matches!(b.statut_bc.as_str(), "VALIDE" | "ENVOYE" | "LIVRE_PARTIEL");
        let (categorie, raison): (&'static str, String) = if !valide {
            ("NON_VALIDE", format!("bon non validé ({}) : ne compte pas", b.statut_bc))
        } else {
            match date {
                None => ("SANS_DATE", "aucune date de livraison prévue (ni sur la ligne ni sur l'en-tête)".into()),
                Some(x) if x < auj => (
                    "EN_RETARD",
                    format!("date de livraison prévue dépassée de {} j : hors couverture", (auj - x).num_days()),
                ),
                Some(_) if d.plan.is_none() => ("APRES_HORIZON", "aucun plan en service : pas d'horizon".into()),
                Some(x) if x > fin => ("APRES_HORIZON", "livrée après la fin de l'horizon du plan".into()),
                Some(_) => ("DATE", "bon validé, daté : compté à sa date".into()),
            }
        };
        let compte = categorie == "DATE";
        arrivages.push(ArrivageClasse {
            detail: json!({
                "origine": "BON",
                "cle": format!("BON:{}", b.id_ligne_bc),
                "hypothese": b.hypothese,
                "id_bc": b.id_bc, "numero_bc": b.numero_bc, "statut_bc": b.statut_bc,
                "code_fournisseur": b.code_fournisseur,
                "id_ligne_bc": b.id_ligne_bc, "ligne_numero": b.ligne_numero,
                "date_ligne": b.date_ligne, "date_entete": b.date_entete,
                "date": date, "source_date": source_date,
                "kg": arrondi_kg(b.reste_kg),
                "compte": compte, "categorie": categorie, "raison": raison,
            }),
            date,
            kg: b.reste_kg,
            categorie,
            compte,
        });
    }
    for l in d.port.get(code).into_iter().flatten() {
        arrivages.push(ArrivageClasse {
            detail: json!({
                "origine": "IMPORT_SANS_BON",
                "cle": format!("IMPORT:{}:{}:{}", l.id_dossier, l.numero_facture.as_deref().unwrap_or(""),
                               l.lot_fournisseur.as_deref().unwrap_or("")),
                "id_dossier": l.id_dossier, "numero_dossier": l.numero_dossier,
                "statut_dossier": l.statut_dossier, "numero_facture": l.numero_facture,
                "lot_fournisseur": l.lot_fournisseur,
                "date_arrivee_dossier": l.date_arrivee,
                "date": Value::Null, "source_date": Value::Null,
                "kg": arrondi_kg(l.reste_kg),
                "compte": false, "categorie": "SANS_DATE",
                "raison": "import en route sans bon : aucune date fiable, hors couverture",
            }),
            date: None,
            kg: l.reste_kg,
            categorie: "SANS_DATE",
            compte: false,
        });
    }
    // LE FIL EN ROUTE EST UN ARRIVAGE (27/10/2026) : compté à sa date prévue de
    // disponibilité, comme un bon à sa date ; en retard ou sans date, à part.
    for t in d.transits.get(code).into_iter().flatten() {
        let (categorie, raison): (&'static str, String) = match t.date_prevue {
            None => (
                "SANS_DATE",
                "transfert en route sans date prévue de disponibilité (expédié avant la règle) : hors couverture, à dater".into(),
            ),
            Some(x) if x < auj => (
                "EN_RETARD",
                format!(
                    "date prévue de disponibilité dépassée de {} j : hors couverture tant qu'aucune nouvelle date n'est saisie",
                    (auj - x).num_days()
                ),
            ),
            Some(_) if d.plan.is_none() => ("APRES_HORIZON", "aucun plan en service : pas d'horizon".into()),
            Some(x) if x > fin => ("APRES_HORIZON", "disponible après la fin de l'horizon du plan".into()),
            Some(_) => ("TRANSIT", "transfert en route : compté à sa date prévue de disponibilité".into()),
        };
        let compte = categorie == "TRANSIT";
        arrivages.push(ArrivageClasse {
            detail: json!({
                "origine": "TRANSFERT",
                "cle": format!("TRANSFERT:{}", t.id_ligne_transfert),
                "hypothese": t.hypothese,
                "id_transfert": t.id_transfert, "numero_transfert": t.numero_transfert,
                "code_magasin_source": t.code_magasin_source, "code_magasin_dest": t.code_magasin_dest,
                "lot_fournisseur": t.lot_fournisseur,
                "date_expedition": t.date_expedition,
                "date_disponibilite_prevue": t.date_prevue,
                "date": t.date_prevue,
                "source_date": t.date_prevue.map(|_| "date prévue de disponibilité"),
                "kg": arrondi_kg(t.kg),
                "compte": compte, "categorie": categorie, "raison": raison,
            }),
            date: t.date_prevue,
            kg: t.kg,
            categorie,
            compte,
        });
    }

    let plan: Vec<MoisPlan> = d.besoin.get(code).into_iter().flatten().map(|(_, m)| *m).collect();
    let arrivees: Vec<Arrivee> = arrivages
        .iter()
        .filter(|a| a.compte)
        .filter_map(|a| a.date.map(|date| Arrivee { date, kg: a.kg }))
        .collect();
    let mut resultat = couverture::calculer(magasin_compte_kg + machine_compte_kg, &plan, &arrivees, &reglages);
    // Les données manquantes déjà connues (classe ABC absente…) : un signal aussi.
    if let Some(msg) = &defaut_donnees {
        resultat.signaux.push(Signal { code: signal::DEFAUT_DONNEES, date: None, message: msg.clone() });
    }

    Analyse {
        fiche,
        reglages,
        source_delai,
        source_couverture,
        source_securite,
        source_multiple,
        cible_mois,
        source_cible,
        defaut_donnees,
        magasin_compte_kg,
        machine_compte_kg,
        restes_kg,
        restes_magasin_kg,
        restes_machine_kg,
        quarantaine_kg,
        bloque_kg,
        hors_plan_kg,
        arrivages,
        resultat,
    }
}

/// La ligne de la liste (et la synthèse du détail).
fn ligne(a: &Analyse) -> Value {
    let r = &a.resultat;
    let prochain = r.jours.iter().find(|j| j.arrivee_kg > 0.0);
    let premiere = r.propositions.first();
    let mut v = json!({
        "code_reference": a.fiche.code_reference,
        "designation": a.fiche.designation,
        "classe_abc": a.fiche.classe_abc,
        // Une référence inactive se lit, mais ne se commande pas (generer() l'écarte).
        "actif": a.fiche.actif,
        "code_fournisseur": a.fiche.code_fournisseur,
        "fournisseur_nom": a.fiche.fournisseur_nom,
        "disponible_kg": arrondi_kg(a.magasin_compte_kg + a.machine_compte_kg),
        "magasin_kg": arrondi_kg(a.magasin_compte_kg),
        "machine_kg": arrondi_kg(a.machine_compte_kg),
        "plan_horizon_kg": r.plan_horizon_kg,
        "couvert_jusqu_au": r.couvert_jusqu_au,
        "couvert_tout_horizon": r.couvert_tout_horizon,
        "premiere_rupture": r.premiere_rupture,
        "plan_non_couvert_kg": r.plan_non_couvert_kg,
        "premier_passage_securite": r.premier_passage_securite,
        "prochain_arrivage_date": prochain.map(|j| j.date),
        "prochain_arrivage_kg": prochain.map(|j| j.arrivee_kg),
        "delai_j": a.reglages.delai_j,
        "source_delai": a.source_delai,
        "couverture_commande_j": a.reglages.couverture_j,
        "source_couverture": a.source_couverture,
        "jours_securite": a.reglages.jours_securite,
        "qte_a_commander_kg": premiere.map(|p| p.quantite_proposee_kg),
        "palettes_equivalentes": premiere.and_then(|p| p.palettes_equivalentes),
        "date_disponibilite": premiere.map(|p| p.date_disponibilite),
        // La date limite de la 1re rupture (D* − L), même sans proposition.
        "date_limite_commande": r.date_limite_commande,
        "nb_propositions": r.propositions.len(),
        "propositions_plafonnees": r.propositions_plafonnees,
        "motif_sans_proposition": r.motif_sans_proposition,
        "restes_kg": arrondi_kg(a.restes_kg),
        "quarantaine_kg": arrondi_kg(a.quarantaine_kg),
        "bloque_kg": arrondi_kg(a.bloque_kg),
        "hors_plan_kg": arrondi_kg(a.hors_plan_kg),
        "en_retard_kg": a.somme("EN_RETARD"),
        "sans_date_kg": a.somme("SANS_DATE"),
        "transit_kg": a.somme("TRANSIT"),
        "non_valide_kg": a.somme("NON_VALIDE"),
        "apres_horizon_kg": a.somme("APRES_HORIZON"),
    });
    // L'état au sens du moteur (27/10/2026), le même pour tout l'ERP, et ses
    // signaux, à part (codes et messages).
    if let Some(o) = v.as_object_mut() {
        o.insert("statut".into(), json!(a.statut()));
        o.insert("signaux".into(), json!(r.signaux));
        o.insert("raison_etat".into(), json!(a.raison_etat()));
        // LE STOCK PROJETÉ (21 colonnes, 27/10/2026) : la réception proposée D (la
        // 1re proposition), « en retard » quand la cible l'est, et le plan daté
        // jusqu'à elle ; l'horizon en jours pour dire « > N j » sans rupture.
        o.insert("reception_en_retard".into(), json!(premiere.map(|p| p.en_retard)));
        o.insert("besoin_jusqu_reception_kg".into(), json!(a.besoin_jusqu_reception_kg()));
        o.insert("horizon_j".into(), json!(r.jours.len().saturating_sub(1)));
        // LA COUVERTURE CIBLE (§ 15.5) : couverture actuelle, cible, écart.
        o.insert("date_besoin".into(), json!(r.date_besoin));
        o.insert("couverture_cible_j".into(), json!(r.cible_j));
        o.insert("couverture_cible_mois".into(), json!(a.cible_mois));
        o.insert("source_cible".into(), json!(a.source_cible));
        o.insert("ecart_cible_j".into(), json!(r.ecart_cible_j));
        o.insert("securite_x_kg".into(), json!(r.securite.x_kg));
        o.insert("stock_min_kg".into(), json!(r.stock_minimum.kg));
        o.insert("sous_minimum_le".into(), json!(r.stock_minimum.franchi_le));
        o.insert("jours_couverture".into(), json!(a.jours_couverture()));
        o.insert("a_commander_aujourdhui".into(), json!(a.a_commander_aujourdhui()));
        o.insert("arrivages_comptes_kg".into(), json!(a.arrivages_comptes_kg()));
        o.insert("plan_mois_kg".into(), json!(a.plan_mois_kg()));
        o.insert("defaut_donnees".into(), json!(a.defaut_donnees));
        // LE STOCK PROJETÉ (27/10/2026) : ses colonnes, tirées du moteur.
        for (cle, kg) in a.colonnes_stock_projete() {
            o.insert(cle.into(), json!(kg));
        }
        o.insert("besoin_jusqu_livraison_kg".into(), json!(a.besoin_jusqu_livraison_kg()));
        o.insert(
            "securite_aujourdhui_kg".into(),
            json!(r.jours.first().map(|j| j.securite_kg).unwrap_or(0.0)),
        );
    }
    v
}

fn entete(d: &Donnees) -> Value {
    json!({
        "aujourdhui": d.aujourdhui,
        "plan": d.plan.as_ref().map(|p| json!({
            "id_plan": p.id_plan, "libelle": p.libelle,
            "date_debut": p.date_debut, "date_fin": p.date_fin,
            "date_photo_mrp": p.date_photo,
        })),
        "fin_horizon": d.plan.as_ref().map(|p| p.fin_horizon.max(d.aujourdhui)),
        "max_propositions": MAX_PROPOSITIONS,
        "parametres": {
            "securite_j": { "A": d.parametres.securite[0], "B": d.parametres.securite[1], "C": d.parametres.securite[2] },
            "delai_defaut_j": d.parametres.delai_defaut,
            "marge_jours": d.parametres.marge_jours,
        },
        "regles_provisoires": REGLES_PROVISOIRES,
    })
}

// ============================================================================
// Ce que le plan d'achat reprend (« Commander », 27/10/2026)
// ============================================================================

/// La PREMIÈRE proposition du moteur pour une référence, telle que la génération
/// du plan d'achat (`domain/plan_achat.rs`) l'enregistre : quantité et dates
/// viennent d'ici ; prix, devise, unité et fournisseur restent ceux d'avant.
#[derive(Debug, Clone)]
pub struct PremiereProposition {
    pub code_reference: String,
    pub quantite_kg: f64,
    /// D, la date de disponibilité : elle devient la date de besoin de la
    /// proposition, puis la date de livraison prévue de la ligne de bon.
    pub date_disponibilite: NaiveDate,
    pub date_limite_commande: NaiveDate,
    /// Ce que l'arrondi au multiple (palette de la fiche, ou multiple d'achat) a
    /// ajouté au besoin après le minimum de commande : jamais une palette imposée.
    pub complement_multiple_kg: f64,
}

/// Les propositions du STOCK PROJETÉ (§ 16.6, 30/10/2026), une par référence
/// ACTIVE qui en a une (toutes, ou la seule référence demandée), avec la date du
/// jour du calcul. La MÊME fonction que l'écran /stock, rattrapage INCLUS : même
/// référence, mêmes entrées, même quantité. La réception est la date théorique
/// aujourd'hui + délai ; « avant le », s'il est passé, vaut aujourd'hui.
pub async fn premieres_propositions(
    db: &Db,
    reference: Option<&str>,
) -> AppResult<(NaiveDate, Vec<PremiereProposition>)> {
    let d = charger(db, reference).await?;
    let mut sortie = Vec::new();
    for fiche in d.fiches.values().filter(|f| f.actif) {
        let a = analyser(&d, fiche);
        let p = projete_de(&d, &a, d.parametres.projete.rattrapage, d.parametres.restes);
        if let Some(q) = p.quantite.as_ref().filter(|q| q.quantite_kg > 0.0) {
            sortie.push(PremiereProposition {
                code_reference: fiche.code_reference.clone(),
                quantite_kg: arrondi_kg(q.quantite_kg),
                date_disponibilite: q.date_reception,
                date_limite_commande: p.avant_le.map_or(d.aujourdhui, |x| x.max(d.aujourdhui)),
                complement_multiple_kg: arrondi_kg(q.complement_multiple_kg),
            });
        }
    }
    Ok((d.aujourdhui, sortie))
}

// ============================================================================
// Le STOCK PROJETÉ (§ 16, 30/10/2026) : combien commander, sans chronologie
// ============================================================================

/// LE STOCK PROJETÉ d'une analyse (`domain/projete.rs`) : le même stock compté
/// et les mêmes arrivages que la lecture du moteur, mais TOUTES les commandes
/// ouvertes datées (une date passée compte aujourd'hui, aucun filtre d'horizon) ;
/// seuls un bon non validé et un arrivage sans date restent à part.
///
/// `restes` (31/10/2026) : les restes comptés dans le stock (par défaut,
/// `P_ProjeteRestes`), ou exclus — le bouton de l'écran.
/// L'option RESTES lue dans une requête (31/10/2026) : `exclus` ou `comptes` ;
/// absente ou autre, `None` (le réglage `P_ProjeteRestes` s'applique).
pub fn restes_demandes(v: Option<&str>) -> Option<bool> {
    match v.map(str::trim) {
        Some("exclus") => Some(false),
        Some("comptes") => Some(true),
        _ => None,
    }
}

/// L'option RATTRAPAGE lue dans une requête : `exclu` ou `inclus` ; absente ou
/// autre, `None` (le réglage `P_ProjeteRattrapage` s'applique).
pub fn rattrapage_demande(v: Option<&str>) -> Option<bool> {
    match v.map(str::trim) {
        Some("exclu") => Some(false),
        Some("inclus") => Some(true),
        _ => None,
    }
}

/// LE STOCK DU PROJETÉ, magasins et machines (31/10/2026) : le stock compté,
/// moins les restes s'ils sont exclus, moins le fil d'un constat machine plus
/// vieux que `P_ProjeteAgeConstatMax`, plus la quarantaine si
/// `P_ProjeteQuarantaine`. Le calcul et la ligne affichée lisent la même chose,
/// pour que stock disponible + sur machine + arrivages = position.
fn stock_du_projete(d: &Donnees, a: &Analyse, restes: bool) -> (f64, f64) {
    let o = &d.parametres.projete;
    let (mut perime, mut perime_restes) = (0.0, 0.0);
    if o.age_constat_max_j > 0 {
        for e in d.machine.get(a.fiche.code_reference.as_str()).into_iter().flatten() {
            let vieux = e.date_constat.is_none_or(|dc| (d.aujourdhui - dc).num_days() > o.age_constat_max_j);
            if !e.bloque && vieux {
                perime += e.kg;
                if e.reste {
                    perime_restes += e.kg;
                }
            }
        }
    }
    let retrait_machine = if restes { perime } else { a.restes_machine_kg + (perime - perime_restes) };
    let retrait_magasin = if restes { 0.0 } else { a.restes_magasin_kg };
    let quarantaine = if o.quarantaine { a.quarantaine_kg } else { 0.0 };
    (
        (a.magasin_compte_kg - retrait_magasin).max(0.0) + quarantaine,
        (a.machine_compte_kg - retrait_machine).max(0.0),
    )
}

fn projete_de(d: &Donnees, a: &Analyse, rattrapage: bool, restes: bool) -> projete::Projete {
    let code = a.fiche.code_reference.as_str();
    let o = &d.parametres.projete;
    let (magasin, machine) = stock_du_projete(d, a, restes);
    let conso = match &d.plan {
        Some(p) => {
            let plan: Vec<MoisPlan> = d.besoin.get(code).into_iter().flatten().map(|(_, m)| *m).collect();
            couverture::plan_au_jour(&plan, d.aujourdhui, p.fin_horizon)
        }
        None => vec![0.0],
    };
    let arrivees = a
        .arrivages
        .iter()
        .filter(|x| x.categorie != "NON_VALIDE")
        .filter_map(|x| match x.date {
            // Un bon en retard : aujourd'hui + P_ProjeteRetardJours (0 : aujourd'hui).
            Some(dt) if dt < d.aujourdhui => Some((d.aujourdhui + chrono::Duration::days(o.retard_j), x.kg)),
            Some(dt) => Some((dt, x.kg)),
            // Sans date : hors calcul, sauf P_ProjeteSansDate (aujourd'hui + délai).
            None if o.sans_date => Some((d.aujourdhui + chrono::Duration::days(a.reglages.delai_j.max(0)), x.kg)),
            None => None,
        })
        .collect();
    projete::calculer(&projete::Entrees {
        aujourdhui: d.aujourdhui,
        conso,
        stock_kg: magasin + machine,
        arrivees,
        cible_j: a.reglages.cible_j,
        couverture_j: a.reglages.couverture_j,
        delai_j: a.reglages.delai_j,
        jours_securite: a.reglages.jours_securite,
        stock_min_kg: a.reglages.stock_min_kg.filter(|_| o.minimum_alerte),
        moq_kg: a.reglages.moq_kg.filter(|_| o.min_multiple),
        multiple_kg: a.reglages.multiple_kg.filter(|_| o.min_multiple),
        kg_palette: a.reglages.kg_palette,
        soumis_mrp: a.reglages.soumis_mrp,
        rattrapage,
        restes,
        seuils_rupture: d.parametres.seuils_rupture,
    })
}

/// Les signaux du stock projeté, avec leur message (même forme que ceux du moteur).
fn signaux_projete(p: &projete::Projete) -> Value {
    Value::Array(
        p.signaux
            .iter()
            .map(|code| {
                let message = match *code {
                    projete::signal::CIBLE_NON_DEFINIE => {
                        "configuration MRP incomplète : couverture cible non définie, aucune quantité proposée"
                    }
                    projete::signal::HORIZON_COURT => {
                        "le plan s'arrête avant cible + couverture d'une commande : la quantité s'arrête à l'horizon"
                    }
                    _ => "",
                };
                json!({ "code": code, "date": Value::Null, "message": message })
            })
            .collect(),
    )
}

/// LA LIGNE DU STOCK PROJETÉ (§ 16.5, 19 colonnes) : les colonnes du stock
/// gardent leurs noms ; « Position projetée » (`stock_total_projete_kg`) et
/// « Couverture projetée » (`jours_couverture`) viennent du calcul du projeté.
fn ligne_projete(d: &Donnees, a: &Analyse, p: &projete::Projete) -> Value {
    // L'ONGLET EMPLACEMENTS (31/10/2026) : chaque magasin au plan, compté hors
    // bloqués et hors restes (les restes ont leur colonne) ; la somme des
    // magasins, de la machine et des restes rend le disponible.
    let mut par_magasin = serde_json::Map::new();
    for m in d.magasins.get(a.fiche.code_reference.as_str()).into_iter().flatten() {
        if m.quarantaine || !m.inclure_mrp {
            continue;
        }
        let compte = (m.quantite_kg - m.bloque_kg).max(0.0);
        let kg = compte - m.restes_kg.clamp(0.0, compte);
        let cumul = par_magasin.get(&m.code_magasin).and_then(Value::as_f64).unwrap_or(0.0);
        par_magasin.insert(m.code_magasin.clone(), json!(arrondi_kg(cumul + kg) + 0.0));
    }
    // En route = les transferts entre magasins ; commandé = les autres
    // arrivages du projeté (bons validés, datés).
    let transit = a.somme("TRANSIT");
    // Le stock montré est celui du calcul (restes, constat trop vieux,
    // quarantaine) : stock disponible + sur machine + en route = position.
    let (magasin, machine) = stock_du_projete(d, a, p.restes);
    let disponible = magasin + machine;
    let emplacements = json!({
        // L'onglet Approvisionnement (31/10/2026) : magasins et machine restes
        // compris, pour que disponible + machine + arrivages = position.
        "magasin_kg": arrondi_kg(magasin) + 0.0,
        "machine_kg": arrondi_kg(machine) + 0.0,
        "restes_comptes": p.restes,
        "stock_par_magasin": par_magasin,
        "jours_sans_fil": p.jours_sans_fil,
        "commande_kg": arrondi_kg((p.arrivages_kg - transit).max(0.0)) + 0.0,
        "stock_apres_arrivage_kg": arrondi_kg(disponible + a.quarantaine_kg + p.arrivages_kg) + 0.0,
        // Ce qui arrive après aujourd'hui + délai : trop tard pour éviter une
        // rupture qu'une commande passée aujourd'hui ne couvrirait pas non plus.
        "en_route_apres_delai_kg": arrondi_kg(
            a.arrivages
                .iter()
                .filter(|x| x.categorie != "NON_VALIDE")
                .filter(|x| x.date.is_some_and(|dt| (dt - d.aujourdhui).num_days() > a.reglages.delai_j))
                .map(|x| x.kg)
                .sum::<f64>(),
        ) + 0.0,
    });
    // LES PALIERS DE RUPTURE et le trou avant le camion (31/10/2026).
    let rupture = json!({
        "rupture_j": p.rupture_j,
        "rupture_le": p.rupture_le,
        "palier_rupture": p.palier,
        "palier_suivant": p.palier_suivant,
        "date_palier_suivant": p.date_palier_suivant,
        "a_sec": p.a_sec,
    });
    let mut v = json!({
        "code_reference": a.fiche.code_reference,
        "designation": a.fiche.designation,
        "classe_abc": a.fiche.classe_abc,
        "actif": a.fiche.actif,
        "code_fournisseur": a.fiche.code_fournisseur,
        "fournisseur_nom": a.fiche.fournisseur_nom,
        "disponible_kg": arrondi_kg(disponible) + 0.0,
        "arrivages_comptes_kg": p.arrivages_kg,
        "stock_total_projete_kg": p.position_kg,
        "besoin_delai_kg": p.besoin_delai_kg,
        "jours_couverture": p.couverture_j,
        "horizon_j": p.horizon_j,
        "couvert_jusqu_au": p.couvert_jusqu_au,
        "couverture_cible_j": p.cible_j,
        "couverture_cible_mois": a.cible_mois,
        "source_cible": a.source_cible,
        "ecart_cible_j": p.ecart_cible_j,
        "delai_j": a.reglages.delai_j,
        "source_delai": a.source_delai,
        "couverture_commande_j": a.reglages.couverture_j,
        "source_couverture": a.source_couverture,
        "jours_securite": a.reglages.jours_securite,
        "source_securite": a.source_securite,
    });
    let suite = json!({
        "qte_a_commander_kg": p.quantite.as_ref().map(|q| q.quantite_kg),
        "palettes_equivalentes": p.quantite.as_ref().and_then(|q| q.palettes),
        "date_reception_theorique": p.quantite.as_ref().map(|q| q.date_reception),
        "avant_le": p.avant_le,
        "statut": p.etat,
        "raison_etat": p.raison,
        "signaux": signaux_projete(p),
        "rattrapage": p.rattrapage,
        "manque_kg": p.manque_kg,
        "seuil_alerte_j": p.seuil_alerte_j,
        "couverture_livraison_j": p.couverture_livraison_j,
        "stock_min_kg": a.reglages.stock_min_kg,
        "quarantaine_kg": arrondi_kg(a.quarantaine_kg),
        "bloque_kg": arrondi_kg(a.bloque_kg),
        "hors_plan_kg": arrondi_kg(a.hors_plan_kg),
        "restes_kg": arrondi_kg(a.restes_kg),
        "sans_date_kg": a.somme("SANS_DATE"),
        "non_valide_kg": a.somme("NON_VALIDE"),
        "plan_mois_kg": a.plan_mois_kg(),
        "defaut_donnees": a.defaut_donnees,
    });
    if let (Some(o), Value::Object(s)) = (v.as_object_mut(), suite) {
        o.extend(s);
    }
    if let (Some(o), Value::Object(s)) = (v.as_object_mut(), emplacements) {
        o.extend(s);
    }
    if let (Some(o), Value::Object(s)) = (v.as_object_mut(), rupture) {
        o.extend(s);
    }
    if let Some(o) = v.as_object_mut() {
        o.insert("transit_kg".into(), json!(transit));
        for (cle, kg) in a.colonnes_stock_projete().into_iter().take(3) {
            o.insert(cle.into(), json!(kg));
        }
    }
    v
}

/// Une ligne du stock projeté, avec ce qu'il faut pour la trier et la compléter.
pub struct LigneProjetee {
    pub code_reference: String,
    pub statut: &'static str,
    pub qte_a_commander_kg: Option<f64>,
    pub ligne: Value,
}

/// LE STOCK PROJETÉ de toutes les références listées (§ 16) : `rattrapage` est
/// l'option de la barre d'outils ; les références de `inverses` prennent
/// l'option contraire (le bouton de la ligne).
pub async fn stock_projete(
    db: &Db,
    rattrapage: Option<bool>,
    inverses: &std::collections::HashSet<String>,
    restes: Option<bool>,
) -> AppResult<(NaiveDate, Vec<LigneProjetee>)> {
    let d = charger(db, None).await?;
    let restes = restes.unwrap_or(d.parametres.restes);
    let rattrapage = rattrapage.unwrap_or(d.parametres.projete.rattrapage);
    let lignes = d
        .fiches
        .values()
        .map(|f| analyser(&d, f))
        .filter(Analyse::a_lister)
        .map(|a| {
            let option = rattrapage != inverses.contains(&a.fiche.code_reference);
            let p = projete_de(&d, &a, option, restes);
            LigneProjetee {
                code_reference: a.fiche.code_reference.clone(),
                statut: p.etat,
                qte_a_commander_kg: p.quantite.as_ref().map(|q| q.quantite_kg),
                ligne: ligne_projete(&d, &a, &p),
            }
        })
        .collect();
    Ok((d.aujourdhui, lignes))
}

// ============================================================================
// L'état de chaque référence, pour tout l'ERP (une seule source, 27/10/2026)
// ============================================================================

/// Un mois de la frise d'une référence (mur de risques, photo du plan) : ce que
/// le moteur projette, regroupé par mois de calendrier dans l'horizon.
#[derive(Debug, Clone)]
pub struct MoisFrise {
    pub annee_mois: String,
    pub rang_mois: usize,
    /// Le plan du mois compris dans l'horizon (depuis aujourd'hui pour le mois en cours).
    pub besoin_kg: f64,
    /// Les arrivages comptés du mois.
    pub entrees_kg: f64,
    /// Le solde projeté en fin de mois (ou au dernier jour de l'horizon), jamais négatif.
    pub stock_fin_kg: f64,
    /// Le seuil de sécurité NS au même jour.
    pub securite_kg: f64,
    pub plan_non_couvert_kg: f64,
    /// `statut_mois` : PLAN_NON_COUVERT si une part du plan du mois n'est pas
    /// couverte, SOUS_SECURITE si le point bas passe sous NS un jour du mois,
    /// COUVERT sinon.
    pub statut: &'static str,
}

/// L'état d'une référence au sens du moteur, détaché de la lecture.
#[derive(Debug, Clone)]
pub struct Etat {
    pub code_reference: String,
    pub designation: Option<String>,
    pub classe_abc: Option<String>,
    /// Suivie = active ET listée par le moteur (une demande au plan, du stock ou
    /// un arrivage) : c'est l'ensemble que comptent les indicateurs.
    pub suivie: bool,
    pub code_fournisseur: Option<String>,
    pub fournisseur_nom: Option<String>,
    pub statut: &'static str,
    /// La raison de l'état, en une phrase chiffrée.
    pub raison_etat: String,
    /// Les codes des signaux (§ 15.4), indépendants de l'état.
    pub signaux: Vec<&'static str>,
    /// La couverture actuelle (jours jusqu'à la 1re rupture ; `None` : tout l'horizon).
    pub jours_couverture: Option<i64>,
    /// C, la couverture cible (jours), et l'écart couverture − C.
    pub couverture_cible_j: Option<i64>,
    pub ecart_cible_j: Option<i64>,
    pub premiere_rupture: Option<NaiveDate>,
    pub couvert_jusqu_au: Option<NaiveDate>,
    pub premier_passage_securite: Option<NaiveDate>,
    pub plan_horizon_kg: f64,
    /// Le plan ramené à un mois de 30 jours (voir `Analyse::plan_mois_kg`).
    pub plan_mois_kg: f64,
    pub plan_non_couvert_kg: f64,
    pub disponible_kg: f64,
    pub arrivages_comptes_kg: f64,
    pub qte_a_commander_kg: Option<f64>,
    pub date_limite_commande: Option<NaiveDate>,
    pub a_commander_aujourdhui: bool,
    pub delai_j: i64,
    pub defaut_donnees: Option<String>,
    /// LA SÉCURITÉ DU JOUR : NS(aujourd'hui), le plan des S jours suivants.
    pub securite_aujourdhui_kg: f64,
    /// Le stock minimum de la fiche (garde-fou) et le jour où le point bas le
    /// franchit dans [aujourd'hui, aujourd'hui + délai] (signal SOUS_MINIMUM).
    pub stock_min_kg: Option<f64>,
    pub sous_minimum_le: Option<NaiveDate>,
    /// « Trop tard pour commander » : 1re rupture avant aujourd'hui + délai —
    /// l'état RUPTURE_INEVITABLE (`domain::couverture::trop_tard_pour_commander`).
    pub trop_tard: bool,
    pub mois: Vec<MoisFrise>,
}

impl Etat {
    /// Les COLONNES DU MOTEUR qu'un écran ajoute à ses propres lignes : mêmes
    /// noms partout (stock projeté, état des stocks, cockpit, analyses…).
    pub fn colonnes(&self) -> serde_json::Map<String, Value> {
        let v = json!({
            "statut": self.statut,
            "raison_etat": self.raison_etat,
            "signaux": self.signaux,
            "jours_couverture": self.jours_couverture,
            "couverture_cible_j": self.couverture_cible_j,
            "ecart_cible_j": self.ecart_cible_j,
            "premiere_rupture": self.premiere_rupture,
            "couvert_jusqu_au": self.couvert_jusqu_au,
            "premier_passage_securite": self.premier_passage_securite,
            "plan_horizon_kg": self.plan_horizon_kg,
            "plan_mois_kg": self.plan_mois_kg,
            "plan_non_couvert_kg": self.plan_non_couvert_kg,
            "arrivages_comptes_kg": self.arrivages_comptes_kg,
            "qte_a_commander_kg": self.qte_a_commander_kg,
            "date_limite_commande": self.date_limite_commande,
            "a_commander_aujourdhui": self.a_commander_aujourdhui,
            "defaut_donnees": self.defaut_donnees,
            "trop_tard": self.trop_tard,
        });
        match v {
            Value::Object(m) => m,
            _ => serde_json::Map::new(),
        }
    }

    /// En tension = tout sauf COUVERT.
    pub fn en_tension(&self) -> bool {
        self.statut != statut::COUVERT
    }

    /// Classe A ET rupture inévitable.
    pub fn classe_a_en_rupture(&self) -> bool {
        self.statut == statut::RUPTURE_INEVITABLE && self.classe_abc.as_deref().map(str::trim) == Some("A")
    }

    /// Un signal de ce code est levé.
    pub fn a_le_signal(&self, code: &str) -> bool {
        self.signaux.contains(&code)
    }
}

/// L'état de toutes les références, calculé en une lecture.
pub struct Etats {
    pub aujourdhui: NaiveDate,
    pub fin_horizon: Option<NaiveDate>,
    /// Le plan en service, dont le moteur projette la demande.
    pub id_plan: Option<String>,
    references: BTreeMap<String, Etat>,
}

/// Rang d'un statut pour les tris : le plus grave d'abord.
pub fn rang_statut(s: &str) -> u8 {
    match s {
        statut::RUPTURE_INEVITABLE => 0,
        statut::SOUS_SECURITE => 1,
        statut::SOUS_CIBLE => 2,
        _ => 3,
    }
}

impl Etats {
    pub fn get(&self, code: &str) -> Option<&Etat> {
        self.references.get(code.trim())
    }

    /// Les références que comptent les indicateurs (actives, listées par le moteur).
    pub fn suivies(&self) -> impl Iterator<Item = &Etat> {
        self.references.values().filter(|e| e.suivie)
    }

    /// Les références suivies en tension, les plus graves d'abord : rupture
    /// inévitable, sous la sécurité, sous la cible ; la rupture (ou le passage
    /// sous la sécurité) la plus proche en tête.
    pub fn en_tension(&self) -> Vec<&Etat> {
        let mut v: Vec<&Etat> = self.suivies().filter(|e| e.en_tension()).collect();
        v.sort_by(|a, b| {
            rang_statut(a.statut)
                .cmp(&rang_statut(b.statut))
                .then_with(|| {
                    a.premiere_rupture
                        .or(a.premier_passage_securite)
                        .unwrap_or(NaiveDate::MAX)
                        .cmp(&b.premiere_rupture.or(b.premier_passage_securite).unwrap_or(NaiveDate::MAX))
                })
                .then_with(|| a.code_reference.cmp(&b.code_reference))
        });
        v
    }

    /// Les compteurs du moteur (cockpit, briefing, Situation du plan d'achat).
    pub fn compteurs(&self) -> Value {
        let (mut total, mut inevitable, mut sous, mut sous_cible, mut couvert) = (0, 0, 0, 0, 0);
        let (mut aujourdhui, mut classe_a, mut trop_tard) = (0, 0, 0);
        let (mut sans_cible, mut sous_minimum, mut retard) = (0, 0, 0);
        for e in self.suivies() {
            total += 1;
            match e.statut {
                statut::RUPTURE_INEVITABLE => inevitable += 1,
                statut::SOUS_SECURITE => sous += 1,
                statut::SOUS_CIBLE => sous_cible += 1,
                _ => couvert += 1,
            }
            if e.a_le_signal(signal::CIBLE_NON_DEFINIE) {
                sans_cible += 1;
            }
            if e.a_le_signal(signal::SOUS_MINIMUM) {
                sous_minimum += 1;
            }
            if e.a_le_signal(signal::RETARD_CIBLE) {
                retard += 1;
            }
            if e.a_commander_aujourdhui {
                aujourdhui += 1;
            }
            if e.classe_a_en_rupture() {
                classe_a += 1;
            }
            if e.trop_tard {
                trop_tard += 1;
            }
        }
        json!({
            "nb_references": total,
            "nb_rupture_inevitable": inevitable,
            "nb_sous_securite": sous,
            "nb_sous_cible": sous_cible,
            "nb_couvert": couvert,
            "nb_cible_non_definie": sans_cible,
            "nb_sous_minimum": sous_minimum,
            "nb_retard_cible": retard,
            "nb_a_commander_aujourdhui": aujourdhui,
            "nb_classe_a_en_rupture": classe_a,
            "nb_trop_tard": trop_tard,
        })
    }

    /// Ajoute les colonnes du moteur à chaque objet portant `code_reference` (un
    /// tableau d'objets ou un objet seul). L'état se range sous `cle_statut`
    /// (`statut` d'ordinaire ; `statut_stock` là où `statut` dit autre chose).
    /// Une référence que le moteur ne connaît pas reçoit des colonnes vides.
    pub fn enrichir(&self, v: &mut Value, cle_statut: &str) {
        let un = |o: &mut serde_json::Map<String, Value>| {
            let code = o.get("code_reference").and_then(Value::as_str).map(str::to_string);
            let Some(code) = code else { return };
            match self.get(&code) {
                Some(e) => {
                    for (k, val) in e.colonnes() {
                        let cle = if k == "statut" { cle_statut.to_string() } else { k };
                        o.insert(cle, val);
                    }
                }
                None => {
                    for k in Etat::noms_colonnes() {
                        let cle = if *k == "statut" { cle_statut.to_string() } else { k.to_string() };
                        o.insert(cle, Value::Null);
                    }
                }
            }
        };
        match v {
            Value::Array(items) => {
                for i in items.iter_mut() {
                    if let Some(o) = i.as_object_mut() {
                        un(o);
                    }
                }
            }
            Value::Object(o) => un(o),
            _ => {}
        }
    }
}

impl Etat {
    fn noms_colonnes() -> &'static [&'static str] {
        &[
            "statut", "raison_etat", "signaux", "jours_couverture", "couverture_cible_j", "ecart_cible_j", "premiere_rupture",
            "couvert_jusqu_au", "premier_passage_securite",
            "plan_horizon_kg", "plan_mois_kg", "plan_non_couvert_kg", "arrivages_comptes_kg", "qte_a_commander_kg",
            "date_limite_commande", "a_commander_aujourdhui", "defaut_donnees", "trop_tard",
        ]
    }
}

/// La frise mensuelle d'une analyse : les jours du moteur regroupés par mois.
fn frise(c: &Couverture) -> Vec<MoisFrise> {
    let mut mois: Vec<MoisFrise> = Vec::new();
    let mut sous_jour: Vec<bool> = Vec::new();
    for j in &c.jours {
        let am = format!("{:04}-{:02}", j.date.year(), j.date.month());
        if mois.last().map(|m| m.annee_mois != am).unwrap_or(true) {
            mois.push(MoisFrise {
                annee_mois: am,
                rang_mois: mois.len() + 1,
                besoin_kg: 0.0,
                entrees_kg: 0.0,
                stock_fin_kg: 0.0,
                securite_kg: 0.0,
                plan_non_couvert_kg: 0.0,
                statut: statut_mois::COUVERT,
            });
            sous_jour.push(false);
        }
        let (m, sous) = (mois.last_mut().expect("mois"), sous_jour.last_mut().expect("mois"));
        m.besoin_kg += j.conso_prevue_kg;
        m.entrees_kg += j.arrivee_kg;
        m.plan_non_couvert_kg += j.plan_non_couvert_kg;
        m.stock_fin_kg = j.solde_kg;
        m.securite_kg = j.securite_kg;
        if j.point_bas_kg < j.securite_kg - 1e-6 {
            *sous = true;
        }
    }
    for (m, sous) in mois.iter_mut().zip(sous_jour) {
        m.besoin_kg = arrondi_kg(m.besoin_kg) + 0.0;
        m.entrees_kg = arrondi_kg(m.entrees_kg) + 0.0;
        m.plan_non_couvert_kg = arrondi_kg(m.plan_non_couvert_kg) + 0.0;
        m.statut = if m.plan_non_couvert_kg > 1e-6 {
            statut_mois::PLAN_NON_COUVERT
        } else if sous {
            statut_mois::SOUS_SECURITE
        } else {
            statut_mois::COUVERT
        };
    }
    mois
}

fn etat_de(a: &Analyse) -> Etat {
    let r = &a.resultat;
    let premiere = r.propositions.first();
    Etat {
        code_reference: a.fiche.code_reference.clone(),
        designation: a.fiche.designation.clone(),
        classe_abc: a.fiche.classe_abc.clone(),
        suivie: a.fiche.actif && a.a_lister(),
        code_fournisseur: a.fiche.code_fournisseur.clone(),
        fournisseur_nom: a.fiche.fournisseur_nom.clone(),
        statut: a.statut(),
        raison_etat: a.raison_etat(),
        signaux: a.codes_signaux(),
        jours_couverture: a.jours_couverture(),
        couverture_cible_j: r.cible_j,
        ecart_cible_j: r.ecart_cible_j,
        premiere_rupture: r.premiere_rupture,
        couvert_jusqu_au: r.couvert_jusqu_au,
        premier_passage_securite: r.premier_passage_securite,
        plan_horizon_kg: r.plan_horizon_kg,
        plan_mois_kg: a.plan_mois_kg(),
        plan_non_couvert_kg: r.plan_non_couvert_kg,
        disponible_kg: arrondi_kg(a.magasin_compte_kg + a.machine_compte_kg),
        arrivages_comptes_kg: a.arrivages_comptes_kg(),
        qte_a_commander_kg: premiere.map(|p| p.quantite_proposee_kg),
        date_limite_commande: r.date_limite_commande,
        a_commander_aujourdhui: a.a_commander_aujourdhui(),
        delai_j: a.reglages.delai_j,
        defaut_donnees: a.defaut_donnees.clone(),
        securite_aujourdhui_kg: r.jours.first().map(|j| j.securite_kg).unwrap_or(0.0),
        stock_min_kg: r.stock_minimum.kg,
        sous_minimum_le: r.stock_minimum.franchi_le,
        trop_tard: trop_tard_pour_commander(r.premiere_rupture, a.reglages.aujourdhui, a.reglages.delai_j),
        mois: frise(r),
    }
}

/// L'état de toutes les références (actives ou non), au sens du moteur.
pub async fn etats(db: &Db) -> AppResult<Etats> {
    let d = charger(db, None).await?;
    let references = d
        .fiches
        .values()
        .map(|f| {
            let e = etat_de(&analyser(&d, f));
            (e.code_reference.clone(), e)
        })
        .collect();
    Ok(Etats {
        aujourdhui: d.aujourdhui,
        fin_horizon: d.plan.as_ref().map(|p| p.fin_horizon.max(d.aujourdhui)),
        id_plan: d.plan.as_ref().map(|p| p.id_plan.clone()),
        references,
    })
}

/// LES CONTRÔLES QUI DÉPENDENT DU MOTEUR (27/10/2026) : ils ne peuvent plus vivre
/// en SQL (le moteur est en Rust) et se servent à côté de `v_controles`, sous les
/// mêmes codes et la même forme. Moteur v2 (§ 15.4) : C05 liste les ruptures
/// INÉVITABLES (1re rupture avant aujourd'hui + délai) ; C25 garde son sens (du
/// stock qui dort face à un équivalent interchangeable en tension, c.-à-d. pas
/// COUVERT) ; C68 et C69 sont les signaux SOUS_MINIMUM et CIBLE_NON_DEFINIE. Des
/// signaux : aucun ne bloque.
pub const CONTROLES_MOTEUR: &[(&str, &str, &str)] = &[
    ("C05", "Rupture inevitable : 1re rupture avant aujourd'hui + delai (moteur de couverture)", "CRITIQUE"),
    ("C25", "Stock mobilisable face a un equivalent en tension (moteur de couverture)", "ATTENTION"),
    ("C68", "Stock minimum franchi avant aujourd'hui + delai : verifier le plan (moteur de couverture)", "ATTENTION"),
    ("C69", "Article au plan sans couverture cible : aucune proposition (moteur de couverture)", "ATTENTION"),
];

/// Les lignes d'un contrôle du moteur (`None` : ce code n'en est pas un).
pub async fn controle_moteur_detail(db: &Db, e: &Etats, code: &str) -> AppResult<Option<Value>> {
    match code.to_ascii_uppercase().as_str() {
        "C05" => Ok(Some(Value::Array(
            e.suivies()
                .filter(|x| x.statut == statut::RUPTURE_INEVITABLE)
                .map(|x| {
                    json!({
                        "code_reference": x.code_reference, "designation": x.designation,
                        "statut": x.statut, "premiere_rupture": x.premiere_rupture, "delai_j": x.delai_j,
                        "plan_non_couvert_kg": x.plan_non_couvert_kg, "disponible_kg": x.disponible_kg,
                        "plan_horizon_kg": x.plan_horizon_kg, "arrivages_comptes_kg": x.arrivages_comptes_kg,
                    })
                })
                .collect(),
        ))),
        "C68" => Ok(Some(Value::Array(
            e.suivies()
                .filter(|x| x.a_le_signal(signal::SOUS_MINIMUM))
                .map(|x| {
                    json!({
                        "code_reference": x.code_reference, "designation": x.designation,
                        "statut": x.statut, "stock_min_kg": x.stock_min_kg, "sous_minimum_le": x.sous_minimum_le,
                        "disponible_kg": x.disponible_kg, "delai_j": x.delai_j,
                    })
                })
                .collect(),
        ))),
        "C69" => Ok(Some(Value::Array(
            e.suivies()
                .filter(|x| x.a_le_signal(signal::CIBLE_NON_DEFINIE))
                .map(|x| {
                    json!({
                        "code_reference": x.code_reference, "designation": x.designation,
                        "statut": x.statut, "premiere_rupture": x.premiere_rupture,
                        "plan_horizon_kg": x.plan_horizon_kg,
                    })
                })
                .collect(),
        ))),
        "C25" => {
            let lignes = sqlx::query(
                "SELECT e.code_reference, e.designation, e.stock_kg::float8 AS stock_kg,
                        e.equivalent_reference, e.equivalent_besoin_12m_kg::float8 AS equivalent_besoin_12m_kg
                   FROM v_equivalence e
                  WHERE e.stock_kg > 0 AND e.besoin_12m_kg = 0 AND e.interchangeable = 1
                  ORDER BY e.code_reference, e.equivalent_reference",
            )
            .fetch_all(db)
            .await?;
            let mut sortie = Vec::new();
            for l in lignes {
                let equivalent: String = l.try_get("equivalent_reference")?;
                let Some(eq) = e.get(&equivalent).filter(|x| x.en_tension()) else { continue };
                sortie.push(json!({
                    "code_reference": l.try_get::<String, _>("code_reference")?,
                    "designation": l.try_get::<Option<String>, _>("designation")?,
                    "stock_kg": l.try_get::<Option<f64>, _>("stock_kg")?,
                    "equivalent_reference": equivalent,
                    "equivalent_statut": eq.statut,
                    "equivalent_premiere_rupture": eq.premiere_rupture,
                    "equivalent_besoin_12m_kg": l.try_get::<Option<f64>, _>("equivalent_besoin_12m_kg")?,
                }));
            }
            Ok(Some(Value::Array(sortie)))
        }
        _ => Ok(None),
    }
}

/// Les contrôles du moteur, sous la forme de `v_controles` (code, controle,
/// criticite, anomalies).
pub async fn controles_moteur(db: &Db, e: &Etats) -> AppResult<Vec<Value>> {
    let mut sortie = Vec::new();
    for (code, controle, criticite) in CONTROLES_MOTEUR {
        let n = controle_moteur_detail(db, e, code)
            .await?
            .and_then(|v| v.as_array().map(Vec::len))
            .unwrap_or(0);
        sortie.push(json!({ "code": code, "controle": controle, "criticite": criticite, "anomalies": n }));
    }
    Ok(sortie)
}

/// `v_controles` et les contrôles du moteur, triés par code : la liste que
/// lisent l'écran des contrôles, le briefing et l'assistant.
pub async fn tous_les_controles(db: &Db, e: &Etats) -> AppResult<Vec<Value>> {
    let lignes = sqlx::query("SELECT code, controle, criticite, anomalies::bigint AS anomalies FROM v_controles")
        .fetch_all(db)
        .await?;
    let mut sortie = Vec::with_capacity(lignes.len() + CONTROLES_MOTEUR.len());
    for l in lignes {
        sortie.push(json!({
            "code": l.try_get::<String, _>("code")?,
            "controle": l.try_get::<String, _>("controle")?,
            "criticite": l.try_get::<String, _>("criticite")?,
            "anomalies": l.try_get::<i64, _>("anomalies")?,
        }));
    }
    sortie.extend(controles_moteur(db, e).await?);
    sortie.sort_by(|a, b| a["code"].as_str().cmp(&b["code"].as_str()));
    Ok(sortie)
}

/// Le besoin d'une référence au sens du moteur (`GET /api/stock/besoin`) : le plan
/// seul sur l'horizon, mois par mois (la part dans l'horizon : le mois en cours
/// depuis aujourd'hui), ce qui n'en est pas couvert, la première rupture, le délai
/// et la couverture d'une commande. Non masqué : l'appelant masque.
pub async fn besoin_reference(db: &Db, reference: &str) -> AppResult<Value> {
    let d = charger(db, Some(reference)).await?;
    let fiche = d
        .fiches
        .get(reference)
        .ok_or_else(|| AppError::Introuvable(format!("référence {reference}")))?;
    let a = analyser(&d, fiche);
    let r = &a.resultat;
    let mois: Vec<Value> = d
        .besoin
        .get(reference)
        .into_iter()
        .flatten()
        .map(|(am, m)| {
            let jours = jours_du_mois(m.annee, m.mois);
            let comptes = r.jours.iter().filter(|j| j.date.year() == m.annee && j.date.month() == m.mois).count();
            json!({
                "annee_mois": am,
                "besoin_plan_kg": arrondi_kg(m.kg),
                "jours_dans_horizon": comptes,
                "kg_dans_horizon": arrondi_kg(m.kg * comptes as f64 / jours as f64),
            })
        })
        .collect();
    Ok(json!({
        "synthese": {
            "code_reference": fiche.code_reference,
            "designation": fiche.designation,
            "statut": a.statut(),
            "plan_horizon_kg": r.plan_horizon_kg,
            "plan_non_couvert_kg": r.plan_non_couvert_kg,
            "premiere_rupture": r.premiere_rupture,
            "couvert_jusqu_au": r.couvert_jusqu_au,
            "disponible_kg": arrondi_kg(a.magasin_compte_kg + a.machine_compte_kg),
            "arrivages_comptes_kg": a.arrivages_comptes_kg(),
            "delai_j": a.reglages.delai_j,
            "couverture_commande_j": a.reglages.couverture_j,
            "fin_horizon": d.plan.as_ref().map(|p| p.fin_horizon.max(d.aujourdhui)),
        },
        "mois": mois,
    }))
}

/// Les colonnes de la frise d'une référence, telles que les lit le mur de risques.
pub fn frise_json(e: &Etat) -> Value {
    Value::Array(
        e.mois
            .iter()
            .map(|m| {
                json!({
                    "code_reference": e.code_reference,
                    "annee_mois": m.annee_mois, "rang_mois": m.rang_mois,
                    "besoin_kg": m.besoin_kg, "entrees_kg": m.entrees_kg,
                    "stock_fin_kg": m.stock_fin_kg, "stock_min_kg": m.securite_kg,
                    "securite_kg": m.securite_kg,
                    "plan_non_couvert_kg": m.plan_non_couvert_kg, "statut": m.statut,
                })
            })
            .collect(),
    )
}

// ============================================================================
// Les routes
// ============================================================================

/// `GET /api/couverture` — une ligne par référence qui a une demande au plan, du
/// stock (compté ou non) ou un arrivage (compté ou non), triée par PREMIÈRE
/// RUPTURE (la plus proche en tête, sans rupture en dernier) puis par date limite
/// de commande (27/10/2026).
pub async fn liste(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Lire).await?;
    let d = charger(&state.db, None).await?;
    let mut analyses: Vec<Analyse> = d.fiches.values().map(|f| analyser(&d, f)).filter(Analyse::a_lister).collect();
    analyses.sort_by(|x, y| {
        couverture::cle_tri(&x.resultat)
            .cmp(&couverture::cle_tri(&y.resultat))
            .then_with(|| x.fiche.code_reference.cmp(&y.fiche.code_reference))
    });
    let mut v = entete(&d);
    v["lignes"] = Value::Array(analyses.iter().map(ligne).collect());
    user.masquer(&state.db, module::PLAN_ACHAT, &mut v).await?;
    Ok(Json(v))
}

/// LA VUE D'UNE ANALYSE : ce que le détail et la simulation rendent de la même
/// façon — réglages et leur source, synthèse (la ligne de la liste), arrivages
/// classés, événements, propositions avec toutes leurs étapes, projection jour
/// par jour. Un seul texte : le « avant » d'une simulation est le détail.
fn vue_analyse(a: &Analyse) -> Value {
    let r = &a.resultat;
    json!({
        "reglages": {
            "delai_j": a.reglages.delai_j, "source_delai": a.source_delai,
            "couverture_commande_j": a.reglages.couverture_j, "source_couverture": a.source_couverture,
            "jours_securite": a.reglages.jours_securite, "source_securite": a.source_securite,
            "moq_kg": a.reglages.moq_kg,
            "multiple_kg": a.reglages.multiple_kg, "source_multiple": a.source_multiple,
            "kg_palette": a.reglages.kg_palette,
            "defaut_donnees": a.defaut_donnees,
            "couverture_cible_j": a.reglages.cible_j,
            "couverture_cible_mois": a.cible_mois,
            "source_cible": a.source_cible,
            "stock_min_kg": a.reglages.stock_min_kg,
        },
        // LA SITUATION (§ 15.5) : couverture actuelle, cible, écart, rupture, D*,
        // date limite, sécurité X (tS, b, NS), stock minimum, état et signaux.
        "situation": {
            "etat": r.etat,
            "signaux": r.signaux,
            "couverture_actuelle_j": r.couverture_actuelle_j,
            "premiere_rupture": r.premiere_rupture,
            "reste_rupture_kg": r.reste_rupture_kg,
            "couverture_cible_j": r.cible_j,
            "ecart_cible_j": r.ecart_cible_j,
            "date_besoin": r.date_besoin,
            "date_limite_commande": r.date_limite_commande,
            "securite": r.securite,
            "stock_minimum": r.stock_minimum,
            "plan_mois_kg": a.plan_mois_kg(),
            "source": "moteur de couverture, plan daté",
        },
        "synthese": ligne(a),
        "arrivages": a.arrivages.iter().map(|x| x.detail.clone()).collect::<Vec<_>>(),
        "evenements": serde_json::to_value(&r.evenements).unwrap_or(Value::Null),
        "propositions": serde_json::to_value(&r.propositions).unwrap_or(Value::Null),
        "propositions_plafonnees": r.propositions_plafonnees,
        "motif_sans_proposition": r.motif_sans_proposition,
        "jours": serde_json::to_value(&r.jours).unwrap_or(Value::Null),
    })
}

/// Après le masquage : la quantité à commander masquée l'est aussi dans les
/// étapes du calcul et dans le montant. Le masquage se fait par nom de champ, et
/// les propositions portent la même quantité sous d'autres noms (audit du
/// 27/10/2026).
fn retirer_quantites_masquees(v: &mut Value) {
    if v["synthese"].get("qte_a_commander_kg").is_some() {
        return;
    }
    if let Some(props) = v["propositions"].as_array_mut() {
        for p in props.iter_mut().filter_map(Value::as_object_mut) {
            for champ in [
                "besoin_net_kg", "securite_kg", "apres_minimum_kg", "arrondi_kg", "quantite_proposee_kg",
                "palettes_equivalentes", "stock_apres_reception_kg", "stock_fin_fenetre_kg",
            ] {
                p.remove(champ);
            }
            if let Some(fenetres) = p.get_mut("fenetres").and_then(Value::as_array_mut) {
                for w in fenetres.iter_mut().filter_map(Value::as_object_mut) {
                    w.remove("besoin_net_kg");
                }
            }
        }
    }
    if let Some(achat) = v.get_mut("achat").and_then(Value::as_object_mut) {
        achat.remove("montant_estime_mad");
    }
    // Le stock projeté porte la même quantité sous d'autres noms (§ 16).
    if let Some(p) = v.get_mut("projete").and_then(Value::as_object_mut) {
        for champ in ["quantite", "montant_estime_mad", "montant_devise"] {
            p.remove(champ);
        }
        if let Some(l) = p.get_mut("ligne").and_then(Value::as_object_mut) {
            l.remove("qte_a_commander_kg");
            l.remove("palettes_equivalentes");
        }
    }
}

fn json_reference(f: &Fiche) -> Value {
    json!({
        "code_reference": f.code_reference, "designation": f.designation,
        "classe_abc": f.classe_abc, "actif": f.actif,
        "code_fournisseur": f.code_fournisseur, "fournisseur_nom": f.fournisseur_nom,
        "moq_kg": f.moq_kg, "multiple_achat_kg": f.multiple_achat_kg,
        "arrondi_palette": f.arrondi_palette, "poids_bobine_kg": f.poids_bobine_kg,
        "bobines_par_palette": f.bobines_par_palette,
    })
}

/// `GET /api/couverture/{reference}` — le détail : ressources, arrivages comptés
/// et non comptés avec leur raison, événements, propositions avec toutes leurs
/// étapes, plan mois par mois (et par qualité, selon les recettes actuelles),
/// et la projection jour par jour pour la courbe. Depuis le 27/10/2026, aussi ce
/// que la fenêtre du stock projeté montre en plus : le prix et le montant de la
/// proposition (le prix du plan d'achat), et les réglages de la fiche qui ne sont
/// que des repères (stock minimum = garde-fou, couverture cible, seuil d'alerte).
pub async fn detail(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(reference): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    // L'option de rattrapage du stock projeté (§ 16.1-4) : `inclus` ou `exclu` ;
    // absente, le réglage P_ProjeteRattrapage.
    let rattrapage_demande = rattrapage_demande(q.get("rattrapage").map(String::as_str));
    // `?leger=1` (la fenêtre du stock projeté) : sans le classement, lu à part.
    let leger = matches!(q.get("leger").map(String::as_str), Some("1") | Some("true"));
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Lire).await?;
    let reference = reference.trim();
    let d = charger(&state.db, Some(reference)).await?;
    let fiche = d
        .fiches
        .get(reference)
        .ok_or_else(|| AppError::Introuvable(format!("référence {reference}")))?;
    let a = analyser(&d, fiche);
    let r = &a.resultat;

    // Le plan mois par mois, et sa part dans l'horizon (le passé est perdu).
    let mut qualites: HashMap<String, Vec<Value>> = HashMap::new();
    if let Some(p) = &d.plan {
        for l in sqlx::query(
            "SELECT lpp.annee_mois, lpp.code_qualite, max(rc.kg_m2)::float8 AS kg_m2,
                    sum(lpp.m2_prevus * rc.kg_m2 * (1 + COALESCE(pp.taux_perte_pct, 0) / 100.0))::float8 AS kg
               FROM plan_production pp
               JOIN ligne_plan_production lpp ON lpp.id_plan = pp.id_plan
               JOIN plan_qualite pq ON pq.id_plan = pp.id_plan AND pq.code_qualite = lpp.code_qualite
               JOIN v_recette_calculee rc ON rc.code_qualite = pq.code_qualite
              WHERE pp.id_plan = $1 AND rc.code_reference = $2 AND lpp.m2_prevus > 0
              GROUP BY 1, 2
              ORDER BY 1, 2",
        )
        .bind(&p.id_plan)
        .bind(reference)
        .fetch_all(&state.db)
        .await?
        {
            let kg: Option<f64> = l.try_get("kg")?;
            qualites.entry(l.try_get("annee_mois")?).or_default().push(json!({
                "code_qualite": l.try_get::<String, _>("code_qualite")?,
                "kg_m2": l.try_get::<Option<f64>, _>("kg_m2")?,
                "kg": arrondi_kg(kg.unwrap_or(0.0)),
            }));
        }
    }
    let plan_mois: Vec<Value> = d
        .besoin
        .get(reference)
        .into_iter()
        .flatten()
        .map(|(am, m)| {
            let jours = jours_du_mois(m.annee, m.mois);
            let comptes = r
                .jours
                .iter()
                .filter(|j| j.date.year() == m.annee && j.date.month() == m.mois)
                .count();
            let par_qualite = qualites.remove(am).unwrap_or_default();
            let total_qualites: f64 = par_qualite.iter().filter_map(|q| q["kg"].as_f64()).sum();
            json!({
                "annee_mois": am,
                "kg_mois": arrondi_kg(m.kg),
                "jours_mois": jours,
                "kg_jour": arrondi_kg(m.kg / jours as f64),
                "jours_dans_horizon": comptes,
                "kg_dans_horizon": arrondi_kg(m.kg * comptes as f64 / jours as f64),
                "qualites": par_qualite,
                "kg_qualites": arrondi_kg(total_qualites),
            })
        })
        .collect();

    // Les ressources, ligne à ligne, chacune avec ce qu'elle apporte.
    let magasins: Vec<Value> = d
        .magasins
        .get(reference)
        .into_iter()
        .flatten()
        .map(|m| {
            let (etat, compte, raison) = if m.quarantaine {
                ("QUARANTAINE", 0.0, "magasin de quarantaine : jamais compté")
            } else if !m.inclure_mrp {
                ("HORS_PLAN", 0.0, "magasin non compté au plan (inclure_mrp = 0)")
            } else if m.bloque_kg > 0.0 {
                ("COMPTE", (m.quantite_kg - m.bloque_kg).max(0.0), "compté, lots bloqués exclus")
            } else {
                ("COMPTE", m.quantite_kg, "compté (restes et dormants compris)")
            };
            json!({
                "code_magasin": m.code_magasin, "nom": m.nom,
                "quantite_kg": arrondi_kg(m.quantite_kg), "bloque_kg": arrondi_kg(m.bloque_kg),
                "restes_kg": arrondi_kg(m.restes_kg), "compte_kg": arrondi_kg(compte),
                "etat": etat, "raison": raison,
            })
        })
        .collect();
    let machine: Vec<Value> = d
        .machine
        .get(reference)
        .into_iter()
        .flatten()
        .map(|e| {
            json!({
                "code_emplacement": e.code_emplacement, "lot_fournisseur": e.lot_fournisseur,
                "kg": arrondi_kg(e.kg), "date_constat": e.date_constat,
                "age_constat_j": e.date_constat.map(|x| (d.aujourdhui - x).num_days()),
                "mode_constat": e.mode_constat, "reste": e.reste, "bloque": e.bloque,
                "compte": !e.bloque,
                "raison": if e.bloque { "lot bloqué : non compté" }
                          else if e.reste { "reste chargé : compté, quel que soit l'âge du constat" }
                          else { "compté au dernier constat, quel que soit son âge" },
            })
        })
        .collect();
    let lots: Vec<Value> = sqlx::query(
        "SELECT sl.code_magasin, sl.lot_fournisseur, sl.quantite_kg::float8 AS kg, l.statut AS statut_lot, l.categorie
           FROM stock_lot sl
           JOIN lot l ON l.code_reference = sl.code_reference AND l.lot_fournisseur = sl.lot_fournisseur
          WHERE sl.code_reference = $1 AND sl.quantite_kg <> 0 AND (l.statut = 'BLOQUE' OR l.categorie = 'RESTES')
          ORDER BY sl.code_magasin, sl.lot_fournisseur",
    )
    .bind(reference)
    .fetch_all(&state.db)
    .await?
    .iter()
    .map(|l| -> AppResult<Value> {
        let bloque = l.try_get::<String, _>("statut_lot")? == "BLOQUE";
        Ok(json!({
            "code_magasin": l.try_get::<String, _>("code_magasin")?,
            "lot_fournisseur": l.try_get::<String, _>("lot_fournisseur")?,
            "kg": arrondi_kg(l.try_get("kg")?),
            "statut_lot": l.try_get::<String, _>("statut_lot")?,
            "categorie": l.try_get::<Option<String>, _>("categorie")?,
            "compte": !bloque,
            "raison": if bloque { "lot bloqué : non compté" } else { "reste : compté" },
        }))
    })
    .collect::<AppResult<_>>()?;

    // LE PRIX ET LE MONTANT (27/10/2026) : le prix que la proposition du plan
    // d'achat retiendrait (`domain::plan_achat::PRIX_MAD_SQL`), × la quantité de
    // la première proposition du moteur.
    let (prix_mad, source_prix) = crate::domain::plan_achat::prix_estimes(&state.db, Some(reference))
        .await?
        .remove(reference)
        .unwrap_or((None, "AUCUN".into()));
    let qte = r.propositions.first().map(|p| p.quantite_proposee_kg);
    // LE PRIX EN DEVISE (27/10/2026) : celui que la proposition du plan d'achat
    // porte (`domain/plan_achat.rs` : la devise et le prix du catalogue).
    let (code_devise, prix_devise): (Option<String>, Option<f64>) = sqlx::query_as(
        "SELECT code_devise_catalogue, prix_catalogue_kg::float8 FROM reference WHERE code_reference = $1",
    )
    .bind(reference)
    .fetch_optional(&state.db)
    .await?
    .unwrap_or((None, None));
    // LES RÉGLAGES DE LA FICHE (moteur v2, 27/10/2026) : la couverture cible
    // (terme du calcul : la date de réception), le stock minimum (un garde-fou,
    // un signal, jamais une quantité). Et le réel du grand livre, pour le
    // distinguer du plan.
    let fiche_alertes = sqlx::query(
        "SELECT r.stock_min_kg::float8 AS stock_min_kg, r.couverture_cible_mois::float8 AS couverture_cible_mois,
                r.unite_catalogue,
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_SeuilAlerte') AS seuil_alerte,
                (SELECT s.reel_mois_kg::float8 FROM v_stock_reference s WHERE s.code_reference = r.code_reference)
                    AS reel_mois_kg
           FROM reference r
          WHERE r.code_reference = $1",
    )
    .bind(reference)
    .fetch_optional(&state.db)
    .await?;
    let nombre = |s: Option<String>| s.and_then(|x| x.trim().replace(',', ".").parse::<f64>().ok());
    let approvisionnement = match fiche_alertes {
        Some(l) => json!({
            "stock_min_fiche_kg": l.try_get::<Option<f64>, _>("stock_min_kg")?,
            "couverture_cible_fiche_mois": l.try_get::<Option<f64>, _>("couverture_cible_mois")?,
            "seuil_alerte_j": nombre(l.try_get("seuil_alerte")?),
            "unite_catalogue": l.try_get::<Option<String>, _>("unite_catalogue")?,
            "reel_mois_kg": l.try_get::<Option<f64>, _>("reel_mois_kg")?,
        }),
        None => Value::Null,
    };

    let mut v = entete(&d);
    v["reference"] = json_reference(fiche);
    if let (Some(o), Value::Object(vue)) = (v.as_object_mut(), vue_analyse(&a)) {
        o.extend(vue);
    }
    v["ressources"] = json!({
        "compte_kg": arrondi_kg(a.magasin_compte_kg + a.machine_compte_kg),
        "magasin_kg": arrondi_kg(a.magasin_compte_kg),
        "machine_kg": arrondi_kg(a.machine_compte_kg),
        // Tout le stock physique de la référence, compté ou non (quarantaine,
        // bloqué, magasins hors plan compris) : pour situer le disponible.
        "stock_physique_kg": arrondi_kg(
            a.magasin_compte_kg + a.machine_compte_kg + a.quarantaine_kg + a.bloque_kg + a.hors_plan_kg
        ),
        "magasins": magasins,
        "machine": machine,
        "lots": lots,
        "information": {
            "restes_kg": arrondi_kg(a.restes_kg),
            "quarantaine_kg": arrondi_kg(a.quarantaine_kg),
            "bloque_kg": arrondi_kg(a.bloque_kg),
            "hors_plan_kg": arrondi_kg(a.hors_plan_kg),
        },
    });
    v["plan_mois"] = Value::Array(plan_mois);
    v["achat"] = json!({
        "prix_estime_mad": prix_mad,
        "source_prix": source_prix,
        "montant_estime_mad": crate::domain::plan_achat::montant_estime(qte, prix_mad),
        "code_devise": code_devise,
        "prix_devise": prix_devise,
        "montant_devise": crate::domain::plan_achat::montant_estime(qte, prix_devise),
    });
    v["stock_projete"] = stock_projete_detail(&state.db, &user, &d, &a, !leger).await?;
    v["approvisionnement"] = approvisionnement;
    // LE STOCK PROJETÉ (§ 16, 30/10/2026) : la formation de la couverture,
    // l'alerte et la quantité, avec l'option de rattrapage demandée. Le montant
    // suit la quantité du projeté.
    let rattrapage = rattrapage_demande.unwrap_or(d.parametres.projete.rattrapage);
    let p = projete_de(&d, &a, rattrapage, restes_demandes(q.get("restes").map(String::as_str)).unwrap_or(d.parametres.restes));
    // Les réglages appliqués, pour que la fenêtre dise ce qu'elle compte.
    let options = json!({
        "sans_date": d.parametres.projete.sans_date,
        "retard_j": d.parametres.projete.retard_j,
        "quarantaine": d.parametres.projete.quarantaine,
        "age_constat_max_j": d.parametres.projete.age_constat_max_j,
        "min_multiple": d.parametres.projete.min_multiple,
        "minimum_alerte": d.parametres.projete.minimum_alerte,
    });
    let qte_projete = p.quantite.as_ref().map(|q| q.quantite_kg);
    v["projete"] = serde_json::to_value(&p).unwrap_or(Value::Null);
    v["projete"]["ligne"] = ligne_projete(&d, &a, &p);
    v["projete"]["signaux"] = signaux_projete(&p);
    v["projete"]["options"] = options;
    v["projete"]["montant_estime_mad"] = json!(crate::domain::plan_achat::montant_estime(qte_projete, prix_mad));
    v["projete"]["montant_devise"] = json!(crate::domain::plan_achat::montant_estime(qte_projete, prix_devise));
    user.masquer(&state.db, module::PLAN_ACHAT, &mut v).await?;
    user.masquer(&state.db, module::STOCK, &mut v["stock_projete"]["classement"]).await?;
    user.masquer_prix_au_cmup(&state.db, &mut v["achat"]).await?;
    retirer_quantites_masquees(&mut v);
    Ok(Json(v))
}

/// LE CLASSEMENT ET LE RISQUE d'une référence (fenêtre du stock projeté) : ce
/// que les vues fournissent déjà — ABC, rang, XYZ et CV, politique, palier,
/// sources, groupe d'équivalence, dormance. La lecture coûte plus d'une seconde
/// (le classement ABC se recalcule sur toutes les références) : la fenêtre la
/// demande à part (`GET /api/couverture/{ref}/classement`) et s'ouvre sans elle.
async fn classement_de(db: &Db, code: &str) -> AppResult<Value> {
    let classement = sqlx::query(
        "SELECT a.classe_abc, a.rang, a.pct_cumule::float8 AS pct_cumule,
                a.valeur_conso_annuelle_mad::float8 AS valeur_conso_annuelle_mad, a.classe_xyz, a.politique,
                (SELECT r.coef_variation_xyz::float8 FROM reference r WHERE r.code_reference = a.code_reference)
                    AS coef_variation_xyz,
                s.nb_sources, s.risque_source, s.tier,
                (SELECT e.code_groupe_equiv FROM v_equivalence e WHERE e.code_reference = a.code_reference LIMIT 1)
                    AS code_groupe_equiv,
                (SELECT e.groupe_libelle FROM v_equivalence e WHERE e.code_reference = a.code_reference LIMIT 1)
                    AS groupe_libelle,
                (SELECT g.nb_fournisseurs FROM v_equivalence e
                   JOIN v_groupe_equiv_detail g ON g.code_groupe_equiv = e.code_groupe_equiv
                  WHERE e.code_reference = a.code_reference LIMIT 1) AS nb_fournisseurs_groupe,
                es.derniere_sortie, es.jours_sans_mouvement::bigint AS jours_sans_mouvement,
                EXISTS (SELECT 1 FROM v_stock_dormant sd WHERE sd.code_reference = a.code_reference) AS dormant
           FROM v_analyse_abc_xyz a
           LEFT JOIN v_risque_sourcing s ON s.code_reference = a.code_reference
           LEFT JOIN v_etat_stock es ON es.code_reference = a.code_reference
          WHERE a.code_reference = $1",
    )
    .bind(code)
    .fetch_optional(db)
    .await?;
    let classement = match classement {
        None => Value::Null,
        Some(l) => json!({
            "classe_abc": l.try_get::<Option<String>, _>("classe_abc")?,
            "rang": l.try_get::<Option<i64>, _>("rang")?,
            "pct_cumule": l.try_get::<Option<f64>, _>("pct_cumule")?,
            "valeur_conso_annuelle_mad": l.try_get::<Option<f64>, _>("valeur_conso_annuelle_mad")?,
            "classe_xyz": l.try_get::<Option<String>, _>("classe_xyz")?,
            "politique": l.try_get::<Option<String>, _>("politique")?,
            "coef_variation_xyz": l.try_get::<Option<f64>, _>("coef_variation_xyz")?,
            "tier": l.try_get::<Option<String>, _>("tier")?,
            "nb_sources": l.try_get::<Option<i64>, _>("nb_sources")?,
            "risque_source": l.try_get::<Option<String>, _>("risque_source")?,
            "code_groupe_equiv": l.try_get::<Option<String>, _>("code_groupe_equiv")?,
            "groupe_libelle": l.try_get::<Option<String>, _>("groupe_libelle")?,
            "nb_fournisseurs_groupe": l.try_get::<Option<i64>, _>("nb_fournisseurs_groupe")?,
            "derniere_sortie": l.try_get::<Option<String>, _>("derniere_sortie")?,
            "jours_sans_mouvement": l.try_get::<Option<i64>, _>("jours_sans_mouvement")?,
            "dormant": l.try_get::<bool, _>("dormant")?,
        }),
    };

    Ok(classement)
}

/// `GET /api/couverture/{reference}/classement` — le classement et le risque
/// d'une référence, lus à part de la fenêtre du stock projeté (voir `classement_de`).
pub async fn classement(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(reference): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Lire).await?;
    let mut v = classement_de(&state.db, reference.trim()).await?;
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

/// LA FENÊTRE DU STOCK PROJETÉ (décision du 27/10/2026) : ce qu'elle montre en
/// plus du détail commun, tiré du moteur et des vues existantes, sans calcul
/// nouveau — les tuiles, la cascade « où se trouve la matière » (chaque total
/// est la somme exacte des lignes au-dessus), le classement et le risque (ce que
/// les vues fournissent déjà), les lots, et l'historique (avec le droit de lire
/// les mouvements).
async fn stock_projete_detail(
    db: &Db,
    user: &Utilisateur,
    d: &Donnees,
    a: &Analyse<'_>,
    avec_classement: bool,
) -> AppResult<Value> {
    let code = a.fiche.code_reference.as_str();
    let r = &a.resultat;
    let premiere = r.propositions.first();
    let d_idx = a.indice_reception();
    let disponible = a.magasin_compte_kg + a.machine_compte_kg;

    // ---- La cascade -----------------------------------------------------------
    let magasins: Vec<Value> = d
        .magasins
        .get(code)
        .into_iter()
        .flatten()
        .filter(|m| !m.quarantaine && m.inclure_mrp)
        .map(|m| {
            let compte = (m.quantite_kg - m.bloque_kg).max(0.0);
            json!({
                "code_magasin": m.code_magasin, "nom": m.nom,
                "kg": arrondi_kg(compte - m.restes_kg.clamp(0.0, compte)) + 0.0,
            })
        })
        .collect();
    let machine_hors_restes = (a.machine_compte_kg - a.restes_machine_kg).max(0.0);
    let restes = a.restes_magasin_kg + a.restes_machine_kg;
    let avant = |x: &ArrivageClasse| match (x.date, d_idx) {
        (Some(dt), Some(i)) => ((dt - a.reglages.aujourdhui).num_days() as usize) < i,
        _ => false,
    };
    let arrivages_avant: f64 = a.arrivages.iter().filter(|x| x.compte && avant(x)).map(|x| x.kg).sum();
    let arrivages_apres: Vec<Value> =
        a.arrivages.iter().filter(|x| x.compte && !avant(x)).map(|x| x.detail.clone()).collect();
    let non_comptes: Vec<Value> = a.arrivages.iter().filter(|x| !x.compte).map(|x| x.detail.clone()).collect();
    let cascade = json!({
        "magasins": magasins,
        "sur_metiers_kg": arrondi_kg(machine_hors_restes) + 0.0,
        "restes_kg": arrondi_kg(restes) + 0.0,
        "disponible_kg": arrondi_kg(disponible) + 0.0,
        "date_reception": premiere.map(|p| p.date_disponibilite),
        "arrivages_avant_reception_kg": d_idx.map(|_| arrondi_kg(arrivages_avant) + 0.0),
        "besoin_jusqu_reception_kg": a.besoin_jusqu_reception_kg(),
        "stock_a_la_reception_kg": a.stock_a_la_reception_kg(),
        "arrivages_apres": arrivages_apres,
        "arrivages_non_comptes": non_comptes,
        "quarantaine_kg": arrondi_kg(a.quarantaine_kg) + 0.0,
        "bloque_kg": arrondi_kg(a.bloque_kg) + 0.0,
        "hors_plan_kg": arrondi_kg(a.hors_plan_kg) + 0.0,
    });

    // ---- Les tuiles -------------------------------------------------------------
    let tuiles = json!({
        "stock_total_kg": arrondi_kg(disponible + a.quarantaine_kg + a.bloque_kg + a.hors_plan_kg) + 0.0,
        "sur_metiers_kg": arrondi_kg(a.machine_compte_kg) + 0.0,
        "disponible_kg": arrondi_kg(disponible) + 0.0,
        "date_reception": premiere.map(|p| p.date_disponibilite),
        "reception_en_retard": premiere.map(|p| p.en_retard),
        "besoin_jusqu_reception_kg": a.besoin_jusqu_reception_kg(),
        // P(R, R + N) : ce que couvre une commande (la 1re fenêtre).
        "plan_commande_kg": premiere.and_then(|p| p.fenetres.first()).map(|w| w.plan_kg),
        "couverture_commande_j": a.reglages.couverture_j,
        "stock_a_la_reception_kg": a.stock_a_la_reception_kg(),
        "couverture_actuelle_j": r.couverture_actuelle_j,
        "couverture_cible_j": r.cible_j,
        "ecart_cible_j": r.ecart_cible_j,
        "horizon_j": r.jours.len().saturating_sub(1),
        "qte_a_commander_kg": premiere.map(|p| p.quantite_proposee_kg),
        "palettes_equivalentes": premiere.and_then(|p| p.palettes_equivalentes),
        "date_limite_commande": r.date_limite_commande,
        "raison_etat": a.raison_etat(),
    });

    let classement = if avec_classement { classement_de(db, code).await? } else { Value::Null };

    // ---- Les lots (tous, comptés ou non) ----------------------------------------
    let lots: Vec<Value> = sqlx::query(
        "SELECT sl.code_magasin, mg.nom AS magasin_nom, sl.lot_fournisseur, sl.quantite_kg::float8 AS kg,
                sl.nb_bobines, l.statut AS statut_lot, l.categorie,
                sl.date_premiere_entree::text AS date_premiere_entree, sl.date_peremption::text AS date_peremption,
                mg.est_quarantaine = 1 AS quarantaine, mg.inclure_mrp = 1 AS inclure_mrp
           FROM stock_lot sl
           JOIN lot l ON l.code_reference = sl.code_reference AND l.lot_fournisseur = sl.lot_fournisseur
           JOIN magasin mg ON mg.code_magasin = sl.code_magasin
          WHERE sl.code_reference = $1 AND sl.quantite_kg <> 0
          ORDER BY sl.date_premiere_entree NULLS LAST, sl.code_magasin, sl.lot_fournisseur",
    )
    .bind(code)
    .fetch_all(db)
    .await?
    .iter()
    .map(|l| -> AppResult<Value> {
        Ok(json!({
            "code_magasin": l.try_get::<String, _>("code_magasin")?,
            "magasin_nom": l.try_get::<Option<String>, _>("magasin_nom")?,
            "lot_fournisseur": l.try_get::<String, _>("lot_fournisseur")?,
            "kg": arrondi_kg(l.try_get("kg")?),
            "nb_bobines": l.try_get::<Option<i64>, _>("nb_bobines")?,
            "statut_lot": l.try_get::<Option<String>, _>("statut_lot")?,
            "categorie": l.try_get::<Option<String>, _>("categorie")?,
            "date_premiere_entree": l.try_get::<Option<String>, _>("date_premiere_entree")?,
            "date_peremption": l.try_get::<Option<String>, _>("date_peremption")?,
            "quarantaine": l.try_get::<bool, _>("quarantaine")?,
            "inclure_mrp": l.try_get::<bool, _>("inclure_mrp")?,
        }))
    })
    .collect::<AppResult<_>>()?;

    // ---- L'historique : les derniers mouvements (droit de lire les mouvements) --
    let historique = if crate::auth::rbac::a_permission(db, &user.role, module::MOUVEMENTS, Action::Lire).await? {
        let lignes: Vec<Value> = sqlx::query(
            "SELECT m.numero_mouvement, m.date_mouvement::text AS date_mouvement, m.code_type_mvt,
                    t.libelle AS type_libelle, t.signe, m.code_magasin, lm.lot_fournisseur,
                    lm.quantite_kg::float8 AS kg
               FROM ligne_mouvement lm
               JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
               LEFT JOIN type_mouvement t ON t.code_type_mvt = m.code_type_mvt
              WHERE lm.code_reference = $1
              ORDER BY m.date_mouvement DESC, m.numero_mouvement DESC
              LIMIT 20",
        )
        .bind(code)
        .fetch_all(db)
        .await?
        .iter()
        .map(|l| -> AppResult<Value> {
            Ok(json!({
                "numero_mouvement": l.try_get::<Option<String>, _>("numero_mouvement")?,
                "date_mouvement": l.try_get::<Option<String>, _>("date_mouvement")?,
                "code_type_mvt": l.try_get::<Option<String>, _>("code_type_mvt")?,
                "type_libelle": l.try_get::<Option<String>, _>("type_libelle")?,
                "signe": l.try_get::<Option<i64>, _>("signe")?,
                "code_magasin": l.try_get::<Option<String>, _>("code_magasin")?,
                "lot_fournisseur": l.try_get::<Option<String>, _>("lot_fournisseur")?,
                "kg": arrondi_kg(l.try_get::<Option<f64>, _>("kg")?.unwrap_or(0.0)),
            }))
        })
        .collect::<AppResult<_>>()?;
        Value::Array(lignes)
    } else {
        Value::Null
    };

    Ok(json!({
        "tuiles": tuiles,
        "cascade": cascade,
        "classement": classement,
        "lots": lots,
        "historique": historique,
    }))
}

// ============================================================================
// La simulation (27/10/2026) : « et si », en mémoire, jamais enregistrée
// ============================================================================

/// Au plus tant d'hypothèses d'arrivage par simulation.
const MAX_HYPOTHESES: usize = 50;
/// Une hypothèse de date reste dans dix ans autour d'aujourd'hui.
const PORTEE_DATES_J: i64 = 3660;

/// Un arrivage ajouté, ou une commande simulée : une date, des kilos.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArriveeSimulee {
    pub date: NaiveDate,
    pub kg: f64,
}

/// Un arrivage existant (sa `cle`, rendue par le détail) que l'hypothèse date
/// autrement, change de kilos ou retire.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModificationArrivage {
    pub cle: String,
    #[serde(default)]
    pub date: Option<NaiveDate>,
    #[serde(default)]
    pub kg: Option<f64>,
    #[serde(default)]
    pub retirer: bool,
}

/// LES HYPOTHÈSES D'UNE SIMULATION : rien que des entrées que le moteur reçoit
/// déjà (arrivages datés, délai L, couverture d'une commande N, jours de
/// sécurité S, couverture cible C en mois, minimum, multiple). Aucune règle nouvelle : un arrivage simulé est classé
/// par les règles des vrais (daté dans l'horizon : compté ; date passée : en
/// retard, hors couverture).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Hypotheses {
    #[serde(default)]
    pub arrivages_ajoutes: Vec<ArriveeSimulee>,
    #[serde(default)]
    pub commandes: Vec<ArriveeSimulee>,
    #[serde(default)]
    pub arrivages_modifies: Vec<ModificationArrivage>,
    #[serde(default)]
    pub delai_j: Option<i64>,
    #[serde(default)]
    pub couverture_j: Option<i64>,
    #[serde(default)]
    pub jours_securite: Option<i64>,
    /// C, la couverture cible, en mois (comme la fiche article).
    #[serde(default)]
    pub couverture_cible_mois: Option<f64>,
    #[serde(default)]
    pub moq_kg: Option<f64>,
    #[serde(default)]
    pub multiple_kg: Option<f64>,
}

fn kg_lisible(kg: f64) -> String {
    let k = (kg * 100.0).round() / 100.0;
    if (k - k.round()).abs() < 1e-9 {
        format!("{} kg", k.round() as i64)
    } else {
        format!("{} kg", format!("{k:.2}").replace('.', ","))
    }
}

/// APPLIQUE LES HYPOTHÈSES EN MÉMOIRE, sur une copie des données lues : les
/// arrivages ajoutés deviennent des lignes de bon VALIDÉ datées (classées par les
/// mêmes règles que les vraies), les modifications changent la date ou les
/// kilos d'un arrivage lu, les réglages passent par `Surcharges`. Rend les
/// surcharges et, pour l'écran, une phrase par hypothèse appliquée. Une
/// hypothèse illisible ou hors bornes est refusée en entier (rien n'est appliqué
/// à moitié). Ne lit ni n'écrit la base.
fn appliquer_hypotheses(d: &mut Donnees, code: &str, h: &Hypotheses) -> AppResult<(Surcharges, Vec<String>)> {
    let auj = d.aujourdhui;
    let mut dites = Vec::new();
    let nb = h.arrivages_ajoutes.len() + h.commandes.len() + h.arrivages_modifies.len();
    if nb > MAX_HYPOTHESES {
        return Err(AppError::Invalide(format!(
            "{nb} hypothèses d'arrivage : {MAX_HYPOTHESES} au plus par simulation."
        )));
    }
    let date_ok = |x: NaiveDate| (x - auj).num_days().abs() <= PORTEE_DATES_J;
    let kg_ok = |k: f64| k.is_finite() && (0.0..=1e9).contains(&k);

    for m in &h.arrivages_modifies {
        let cle = m.cle.trim();
        if m.date.is_none() && m.kg.is_none() && !m.retirer {
            return Err(AppError::Invalide(format!("arrivage {cle} : rien à modifier (date, kilos ou retrait).")));
        }
        if let Some(x) = m.date.filter(|x| !date_ok(*x)) {
            return Err(AppError::Invalide(format!("arrivage {cle} : date {x} hors de portée.")));
        }
        if let Some(k) = m.kg.filter(|k| !kg_ok(*k)) {
            return Err(AppError::Invalide(format!("arrivage {cle} : {k} kg n'est pas une quantité.")));
        }
        let (origine, id) = cle.split_once(':').unwrap_or((cle, ""));
        match origine {
            "BON" => {
                let lignes = d.bons.entry(code.to_string()).or_default();
                let Some(i) = lignes.iter().position(|b| b.id_ligne_bc == id && !b.id_ligne_bc.starts_with("SIMULATION"))
                else {
                    return Err(AppError::Invalide(format!("arrivage {cle} inconnu pour {code}.")));
                };
                let nom = format!(
                    "bon {}{}",
                    lignes[i].numero_bc.as_deref().unwrap_or("?"),
                    lignes[i].ligne_numero.map(|n| format!(", ligne {n}")).unwrap_or_default()
                );
                if m.retirer {
                    let b = lignes.remove(i);
                    dites.push(format!("Retiré : {nom} ({}).", kg_lisible(b.reste_kg)));
                    continue;
                }
                let b = &mut lignes[i];
                b.hypothese = Some("modifié par l'hypothèse");
                if let Some(x) = m.date {
                    b.date_ligne = Some(x);
                    dites.push(format!("Date de {nom} : {}.", x.format("%d/%m/%Y")));
                }
                if let Some(k) = m.kg {
                    b.reste_kg = k;
                    dites.push(format!("Kilos de {nom} : {}.", kg_lisible(k)));
                }
            }
            "TRANSFERT" => {
                let lignes = d.transits.entry(code.to_string()).or_default();
                let Some(i) = lignes.iter().position(|t| t.id_ligne_transfert == id) else {
                    return Err(AppError::Invalide(format!("arrivage {cle} inconnu pour {code}.")));
                };
                let nom = format!("transfert {}", lignes[i].numero_transfert.as_deref().unwrap_or("?"));
                if m.retirer {
                    let t = lignes.remove(i);
                    dites.push(format!("Retiré : {nom} ({}).", kg_lisible(t.kg)));
                    continue;
                }
                let t = &mut lignes[i];
                t.hypothese = Some("modifié par l'hypothèse");
                if let Some(x) = m.date {
                    t.date_prevue = Some(x);
                    dites.push(format!("Disponibilité de {nom} : {}.", x.format("%d/%m/%Y")));
                }
                if let Some(k) = m.kg {
                    t.kg = k;
                    dites.push(format!("Kilos de {nom} : {}.", kg_lisible(k)));
                }
            }
            "IMPORT" => {
                return Err(AppError::Invalide(
                    "l'import en route sans bon n'a pas de date fiable : la règle le laisse hors couverture, \
                     une hypothèse ne le date pas. Simulez plutôt un arrivage."
                        .into(),
                ))
            }
            _ => return Err(AppError::Invalide(format!("arrivage {cle} : clé illisible."))),
        }
    }

    for (liste, nature) in [(&h.arrivages_ajoutes, "arrivage ajouté"), (&h.commandes, "commande simulée")] {
        for (n, a) in liste.iter().enumerate() {
            if !date_ok(a.date) {
                return Err(AppError::Invalide(format!("{nature} : date {} hors de portée.", a.date)));
            }
            if !kg_ok(a.kg) || a.kg <= 0.0 {
                return Err(AppError::Invalide(format!("{nature} : {} kg n'est pas une quantité positive.", a.kg)));
            }
            let rang = n + 1;
            d.bons.entry(code.to_string()).or_default().push(LigneBon {
                id_bc: format!("SIMULATION-{nature}-{rang}"),
                numero_bc: Some(format!("{} {rang}", if nature == "commande simulée" { "Commande simulée" } else { "Arrivage ajouté" })),
                statut_bc: "VALIDE".into(),
                code_fournisseur: None,
                id_ligne_bc: format!("SIMULATION-{nature}-{rang}"),
                ligne_numero: None,
                reste_kg: a.kg,
                date_ligne: Some(a.date),
                date_entete: None,
                hypothese: Some(if nature == "commande simulée" { "commande simulée" } else { "arrivage ajouté" }),
            });
            let premier = nature.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default();
            dites.push(format!(
                "{premier}{} : {} le {}.",
                &nature[1..],
                kg_lisible(a.kg),
                a.date.format("%d/%m/%Y")
            ));
        }
    }

    let mut s = Surcharges::default();
    if let Some(x) = h.delai_j {
        if !(0..=730).contains(&x) {
            return Err(AppError::Invalide(format!("délai de {x} j : entre 0 et 730 jours.")));
        }
        s.delai_j = Some(x);
        dites.push(format!("Délai fournisseur : {x} j."));
    }
    if let Some(x) = h.couverture_j {
        if !(1..=730).contains(&x) {
            return Err(AppError::Invalide(format!("couverture de {x} j : entre 1 et 730 jours.")));
        }
        s.couverture_j = Some(x);
        dites.push(format!("Couverture d'une commande : {x} j."));
    }
    if let Some(x) = h.jours_securite {
        if !(0..=365).contains(&x) {
            return Err(AppError::Invalide(format!("sécurité de {x} j : entre 0 et 365 jours.")));
        }
        s.jours_securite = Some(x);
        dites.push(format!("Sécurité : {x} j."));
    }
    if let Some(x) = h.couverture_cible_mois {
        if !x.is_finite() || !(0.0..=24.0).contains(&x) {
            return Err(AppError::Invalide(format!("couverture cible de {x} mois : entre 0 et 24 mois.")));
        }
        s.couverture_cible_mois = Some(x);
        dites.push(format!(
            "Couverture cible : {} mois ({} j).",
            format!("{x}").replace('.', ","),
            (x * 30.0).round() as i64
        ));
    }
    if let Some(x) = h.moq_kg {
        if !kg_ok(x) {
            return Err(AppError::Invalide(format!("minimum de commande de {x} kg : une quantité positive ou nulle.")));
        }
        s.moq_kg = Some(x);
        dites.push(if x > 0.0 { format!("Minimum de commande : {}.", kg_lisible(x)) } else { "Sans minimum de commande.".into() });
    }
    if let Some(x) = h.multiple_kg {
        if !kg_ok(x) {
            return Err(AppError::Invalide(format!("multiple de {x} kg : une quantité positive ou nulle.")));
        }
        s.multiple_kg = Some(x);
        dites.push(if x > 0.0 { format!("Arrondi au multiple de {}.", kg_lisible(x)) } else { "Sans arrondi (kg).".into() });
    }
    Ok((s, dites))
}

/// `POST /api/couverture/{reference}/simulation` — L'ESPACE « ET SI »
/// (27/10/2026). Il LIT comme le détail, applique les hypothèses du corps EN
/// MÉMOIRE et appelle le même moteur : la situation réelle et la situation
/// simulée, côte à côte. Rien n'est enregistré : ni transaction, ni écriture, ni
/// journal — un POST seulement parce que les hypothèses sont un corps. Droit :
/// PLAN_ACHAT / LIRE, comme le détail.
pub async fn simulation(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(reference): Path<String>,
    Json(corps): Json<Value>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Lire).await?;
    let h: Hypotheses = serde_json::from_value(corps)
        .map_err(|e| AppError::Invalide(format!("hypothèses illisibles : {e}")))?;
    let reference = reference.trim();
    let d = charger(&state.db, Some(reference)).await?;
    let fiche = d
        .fiches
        .get(reference)
        .ok_or_else(|| AppError::Introuvable(format!("référence {reference}")))?;
    let mut d_simulee = d.clone();
    let (surcharges, dites) = appliquer_hypotheses(&mut d_simulee, reference, &h)?;
    let reelle = analyser(&d, fiche);
    let simulee = analyser_avec(&d_simulee, fiche, &surcharges);

    let mut v = entete(&d);
    v["simulation"] = json!(true);
    v["avertissement"] = json!("Simulation — rien n'est enregistré");
    v["reference"] = json_reference(fiche);
    v["hypotheses"] = json!(dites);
    v["reelle"] = vue_analyse(&reelle);
    v["simulee"] = vue_analyse(&simulee);
    user.masquer(&state.db, module::PLAN_ACHAT, &mut v).await?;
    retirer_quantites_masquees(&mut v["reelle"]);
    retirer_quantites_masquees(&mut v["simulee"]);
    Ok(Json(v))
}

#[cfg(test)]
mod tests_simulation {
    use super::*;
    use chrono::Duration;

    /// J1 = aujourd'hui = 01/01/2026, horizon jusqu'au 30/06/2026.
    fn j(n: i64) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 1, 1).unwrap() + Duration::days(n - 1)
    }

    /// Une référence REF : 2 000 kg comptés, plan de 100 kg par jour, délai 10 j,
    /// couverture 30 j, sécurité de la classe A à 5 j, couverture cible 0,5 mois
    /// (15 j) ; un bon validé de 800 kg à J25, un transfert en route de 300 kg à
    /// J70, un import sans bon de 50 kg.
    ///
    /// Au moteur v2 : B(t) = 2 000 − 100 (t + 1) (+ 800 dès J25) : R = J21 (indice
    /// 20), D* = J6 < aujourd'hui + 10 j : D = J11 (cible en retard) ; fenêtre
    /// [J21, J51[, Q0 = le manque de son dernier jour = 5 000 − 2 000 − 800 = 2 200.
    fn donnees() -> Donnees {
        let code = "REF".to_string();
        let mut fiches = BTreeMap::new();
        fiches.insert(
            code.clone(),
            Fiche {
                code_reference: code.clone(),
                designation: Some("Fil d'essai".into()),
                classe_abc: Some("A".into()),
                actif: true,
                code_fournisseur: Some("FRS".into()),
                fournisseur_nom: Some("Fournisseur".into()),
                delai_fournisseur: Some(10),
                couverture_fournisseur: Some(30),
                moq_kg: None,
                multiple_achat_kg: None,
                arrondi_palette: false,
                poids_bobine_kg: None,
                bobines_par_palette: None,
                couverture_cible_mois: Some(0.5),
                stock_min_kg: None,
            },
        );
        let besoin = HashMap::from([(
            code.clone(),
            (1..=6)
                .map(|m| {
                    (
                        format!("2026-{m:02}"),
                        MoisPlan { annee: 2026, mois: m, kg: 100.0 * jours_du_mois(2026, m) as f64 },
                    )
                })
                .collect(),
        )]);
        let magasins = HashMap::from([(
            code.clone(),
            vec![LigneMagasin {
                code_magasin: "MP".into(),
                nom: None,
                inclure_mrp: true,
                quarantaine: false,
                quantite_kg: 2000.0,
                bloque_kg: 0.0,
                restes_kg: 150.0,
            }],
        )]);
        let bons = HashMap::from([(
            code.clone(),
            vec![LigneBon {
                id_bc: "BC1".into(),
                numero_bc: Some("BC-1".into()),
                statut_bc: "ENVOYE".into(),
                code_fournisseur: Some("FRS".into()),
                id_ligne_bc: "L1".into(),
                ligne_numero: Some(1),
                reste_kg: 800.0,
                date_ligne: Some(j(25)),
                date_entete: None,
                hypothese: None,
            }],
        )]);
        let transits = HashMap::from([(
            code.clone(),
            vec![LigneTransit {
                id_transfert: "T1".into(),
                id_ligne_transfert: "LT1".into(),
                numero_transfert: Some("TR-1".into()),
                code_magasin_source: Some("A".into()),
                code_magasin_dest: Some("MP".into()),
                lot_fournisseur: None,
                kg: 300.0,
                date_expedition: Some(j(1)),
                date_prevue: Some(j(70)),
                hypothese: None,
            }],
        )]);
        let port = HashMap::from([(
            code.clone(),
            vec![LignePort {
                id_dossier: "D1".into(),
                numero_dossier: Some("IMP-1".into()),
                statut_dossier: Some("EN_ROUTE".into()),
                numero_facture: Some("F1".into()),
                lot_fournisseur: None,
                reste_kg: 50.0,
                date_arrivee: None,
            }],
        )]);
        Donnees {
            aujourdhui: j(1),
            parametres: Parametres { securite: [5, 5, 5], delai_defaut: 60, marge_jours: 30, seuils_rupture: [30, 60, 90], restes: true,
                projete: ReglagesProjete { rattrapage: true, age_constat_max_j: 0, quarantaine: false, retard_j: 0,
                    sans_date: false, min_multiple: true, minimum_alerte: true } },
            plan: Some(PlanEnService {
                id_plan: "P1".into(),
                libelle: None,
                date_debut: None,
                date_fin: None,
                date_photo: None,
                fin_horizon: NaiveDate::from_ymd_opt(2026, 6, 30).unwrap(),
            }),
            fiches,
            besoin,
            magasins,
            machine: HashMap::new(),
            bons,
            port,
            transits,
        }
    }

    fn premiere(a: &Analyse) -> f64 {
        a.resultat.propositions[0].quantite_proposee_kg
    }

    fn simuler(h: &Hypotheses) -> AppResult<(Donnees, Surcharges, Vec<String>)> {
        let mut d = donnees();
        let (s, dites) = appliquer_hypotheses(&mut d, "REF", h)?;
        Ok((d, s, dites))
    }

    #[test]
    fn sans_hypothese_la_simulation_rend_le_detail() {
        let d = donnees();
        let fiche = &d.fiches["REF"];
        let (ds, s, dites) = simuler(&Hypotheses::default()).unwrap();
        assert!(dites.is_empty());
        assert_eq!(vue_analyse(&analyser(&d, fiche)), vue_analyse(&analyser_avec(&ds, fiche, &s)));
        // D = J11 (aujourd'hui + délai, la cible en retard), 2 200 kg (le bon de
        // 800 kg à J25 dans la fenêtre [J21, J51[).
        let a = analyser(&d, fiche);
        assert_eq!(a.resultat.propositions[0].date_disponibilite, j(11));
        assert_eq!(a.resultat.premiere_rupture, Some(j(21)));
        assert!((premiere(&a) - 2200.0).abs() < 1e-6, "{}", premiere(&a));
        assert_eq!(a.statut(), statut::COUVERT, "20 j de couverture ≥ cible de 15 j");
        assert!(a.codes_signaux().contains(&signal::RETARD_CIBLE));
    }

    #[test]
    fn un_arrivage_dans_la_fenetre_reduit_la_proposition_d_autant() {
        let d = donnees();
        let fiche = &d.fiches["REF"];
        let avant = premiere(&analyser(&d, fiche));
        let h = Hypotheses {
            arrivages_ajoutes: vec![ArriveeSimulee { date: j(30), kg: 400.0 }],
            ..Default::default()
        };
        let (ds, s, dites) = simuler(&h).unwrap();
        let apres = analyser_avec(&ds, fiche, &s);
        assert!((avant - premiere(&apres) - 400.0).abs() < 1e-6, "{avant} → {}", premiere(&apres));
        assert_eq!(dites.len(), 1);
        // L'arrivage simulé est classé comme un vrai : compté à sa date, et dit.
        let simule = apres.arrivages.iter().find(|a| a.detail["hypothese"] == "arrivage ajouté").unwrap();
        assert!(simule.compte);
        // Les données lues ne bougent pas : le réel reste ce qu'il était.
        assert!((premiere(&analyser(&d, fiche)) - avant).abs() < 1e-6);
    }

    #[test]
    fn une_commande_simulee_a_d_couvre_la_proposition() {
        let d = donnees();
        let fiche = &d.fiches["REF"];
        let p = analyser(&d, fiche).resultat.propositions[0].clone();
        let h = Hypotheses {
            commandes: vec![ArriveeSimulee { date: p.date_disponibilite, kg: p.quantite_proposee_kg }],
            ..Default::default()
        };
        let (ds, s, _) = simuler(&h).unwrap();
        let apres = analyser_avec(&ds, fiche, &s);
        // La première proposition commandée : la suivante devient la première.
        assert!(apres.resultat.propositions[0].date_disponibilite > p.date_disponibilite);
    }

    #[test]
    fn un_arrivage_au_passe_est_en_retard_comme_un_vrai() {
        let d = donnees();
        let fiche = &d.fiches["REF"];
        let h = Hypotheses { arrivages_ajoutes: vec![ArriveeSimulee { date: j(1) - Duration::days(3), kg: 900.0 }], ..Default::default() };
        let (ds, s, _) = simuler(&h).unwrap();
        let apres = analyser_avec(&ds, fiche, &s);
        let simule = apres.arrivages.iter().find(|a| a.detail["hypothese"] == "arrivage ajouté").unwrap();
        assert_eq!(simule.categorie, "EN_RETARD");
        assert!(!simule.compte);
        assert!((premiere(&apres) - premiere(&analyser(&d, fiche))).abs() < 1e-6);
    }

    #[test]
    fn modifier_date_kilos_ou_retirer_un_arrivage() {
        let d = donnees();
        let fiche = &d.fiches["REF"];
        let sans_bon = 3000.0; // sans l'arrivage de 800 kg : le manque de J50 (5 000 − 2 000)
        // Retiré : la proposition reprend les 800 kg.
        let retirer = Hypotheses {
            arrivages_modifies: vec![ModificationArrivage { cle: "BON:L1".into(), date: None, kg: None, retirer: true }],
            ..Default::default()
        };
        let (ds, s, _) = simuler(&retirer).unwrap();
        assert!((premiere(&analyser_avec(&ds, fiche, &s)) - sans_bon).abs() < 1e-6);
        // Daté hors de la fenêtre [J21, J51[ (la fin exclue) : il ne réduit plus le besoin.
        let tard = Hypotheses {
            arrivages_modifies: vec![ModificationArrivage { cle: "BON:L1".into(), date: Some(j(51)), kg: None, retirer: false }],
            ..Default::default()
        };
        let (ds, s, dites) = simuler(&tard).unwrap();
        assert!((premiere(&analyser_avec(&ds, fiche, &s)) - sans_bon).abs() < 1e-6);
        assert!(dites[0].contains("BC-1"));
        // 500 kg au lieu de 800 : 300 kg de plus à commander.
        let moins = Hypotheses {
            arrivages_modifies: vec![ModificationArrivage { cle: "BON:L1".into(), date: None, kg: Some(500.0), retirer: false }],
            ..Default::default()
        };
        let (ds, s, _) = simuler(&moins).unwrap();
        assert!((premiere(&analyser_avec(&ds, fiche, &s)) - 2500.0).abs() < 1e-6);
        // Le transfert ramené à J20 : compté plus tôt, il repousse la rupture de
        // 3 jours (300 kg à 100 kg/j) ; la fenêtre glisse d'autant.
        let transfert = Hypotheses {
            arrivages_modifies: vec![ModificationArrivage { cle: "TRANSFERT:LT1".into(), date: Some(j(20)), kg: None, retirer: false }],
            ..Default::default()
        };
        let (ds, s, _) = simuler(&transfert).unwrap();
        assert_eq!(analyser_avec(&ds, fiche, &s).resultat.premiere_rupture, Some(j(24)));
    }

    #[test]
    fn reglages_simules_avec_leur_source() {
        let d = donnees();
        let fiche = &d.fiches["REF"];
        let h = Hypotheses { delai_j: Some(20), moq_kg: Some(2500.0), multiple_kg: Some(1000.0), ..Default::default() };
        // (D* = J6 : la réception attend aujourd'hui + 20 j.)
        let (ds, s, dites) = simuler(&h).unwrap();
        let a = analyser_avec(&ds, fiche, &s);
        assert_eq!(a.reglages.delai_j, 20);
        assert_eq!(a.source_delai, Source::Simulation);
        assert_eq!(a.resultat.propositions[0].date_disponibilite, j(21), "D = aujourd'hui + 20 j");
        assert_eq!(a.resultat.propositions[0].quantite_proposee_kg % 1000.0, 0.0, "arrondi au multiple simulé");
        assert!(a.resultat.propositions[0].quantite_proposee_kg >= 2500.0, "minimum simulé");
        assert_eq!(dites.len(), 3);
        // Un minimum ou un multiple à 0 : aucun.
        let h0 = Hypotheses { multiple_kg: Some(0.0), ..Default::default() };
        let (ds, s, _) = simuler(&h0).unwrap();
        assert_eq!(analyser_avec(&ds, fiche, &s).reglages.multiple_kg, None);
    }

    #[test]
    fn hypotheses_refusees() {
        let refus = |h: Hypotheses| simuler(&h).is_err();
        let m = |cle: &str| ModificationArrivage { cle: cle.into(), date: Some(j(20)), kg: None, retirer: false };
        assert!(refus(Hypotheses { arrivages_modifies: vec![m("IMPORT:D1:F1:")], ..Default::default() }), "import sans bon");
        assert!(refus(Hypotheses { arrivages_modifies: vec![m("BON:INCONNUE")], ..Default::default() }));
        assert!(refus(Hypotheses { arrivages_modifies: vec![m("n'importe quoi")], ..Default::default() }));
        assert!(refus(Hypotheses {
            arrivages_modifies: vec![ModificationArrivage { cle: "BON:L1".into(), date: None, kg: None, retirer: false }],
            ..Default::default()
        }));
        assert!(refus(Hypotheses { arrivages_ajoutes: vec![ArriveeSimulee { date: j(10), kg: -5.0 }], ..Default::default() }));
        assert!(refus(Hypotheses { arrivages_ajoutes: vec![ArriveeSimulee { date: j(10), kg: f64::NAN }], ..Default::default() }));
        assert!(refus(Hypotheses { commandes: vec![ArriveeSimulee { date: j(10), kg: 0.0 }], ..Default::default() }));
        assert!(refus(Hypotheses { arrivages_ajoutes: vec![ArriveeSimulee { date: j(1) + Duration::days(5000), kg: 5.0 }], ..Default::default() }));
        assert!(refus(Hypotheses { delai_j: Some(-1), ..Default::default() }));
        assert!(refus(Hypotheses { couverture_j: Some(0), ..Default::default() }));
        assert!(refus(Hypotheses { jours_securite: Some(400), ..Default::default() }));
        assert!(refus(Hypotheses { couverture_cible_mois: Some(-1.0), ..Default::default() }));
        assert!(refus(Hypotheses { couverture_cible_mois: Some(f64::NAN), ..Default::default() }));
        assert!(refus(Hypotheses {
            arrivages_ajoutes: vec![ArriveeSimulee { date: j(10), kg: 1.0 }; MAX_HYPOTHESES + 1],
            ..Default::default()
        }));
        // Un champ inconnu dans le corps est refusé, pas ignoré.
        assert!(serde_json::from_value::<Hypotheses>(json!({ "delai": 5 })).is_err());
        assert!(serde_json::from_value::<Hypotheses>(json!({ "delai_j": 5, "commandes": [{ "date": "2026-02-01", "kg": 10 }] })).is_ok());
    }

    #[test]
    fn colonnes_du_stock_projete_sans_double_comptage() {
        let d = donnees();
        let a = analyser(&d, &d.fiches["REF"]);
        let l = ligne(&a);
        let somme = l["magasin_hors_restes_kg"].as_f64().unwrap()
            + l["machine_hors_restes_kg"].as_f64().unwrap()
            + l["restant_kg"].as_f64().unwrap();
        assert!((somme - l["disponible_kg"].as_f64().unwrap()).abs() < 1e-6, "{l}");
        assert!((l["restant_kg"].as_f64().unwrap() - 150.0).abs() < 1e-6);
        assert!(
            (l["stock_total_projete_kg"].as_f64().unwrap() - (2000.0 + l["arrivages_comptes_kg"].as_f64().unwrap())).abs()
                < 1e-6
        );
        // Bon de 800 (J25) et transfert de 300 (J70) comptés ; l'import sans bon, non.
        assert!((l["arrivages_comptes_kg"].as_f64().unwrap() - 1100.0).abs() < 1e-6);
        // Le besoin jusqu'à livraison : 10 jours de plan à 100 kg.
        assert!((l["besoin_jusqu_livraison_kg"].as_f64().unwrap() - 1000.0).abs() < 1e-6);
        // La sécurité du jour : NS(0), le plan des 5 jours suivants.
        assert!((l["securite_aujourdhui_kg"].as_f64().unwrap() - 500.0).abs() < 1e-6);
        // La couverture cible et l'écart (§ 15.5) : 20 j de couverture, cible 15 j.
        assert_eq!(l["jours_couverture"], json!(20));
        assert_eq!(l["couverture_cible_j"], json!(15));
        assert_eq!(l["ecart_cible_j"], json!(5));
        assert_eq!(l["source_cible"], json!("fiche article"));
    }

    /// LA CIBLE EN SIMULATION (§ 15.7-6) : C modifiable comme hypothèse, mêmes
    /// formules. Cible 1 mois (30 j) : D* = J21 − 30 j, toujours en retard ; cible
    /// 0 : D* = R = J21, la réception à la rupture (au-delà du délai).
    #[test]
    fn la_cible_se_simule() {
        let d = donnees();
        let fiche = &d.fiches["REF"];
        let h = Hypotheses { couverture_cible_mois: Some(0.0), ..Default::default() };
        let (ds, s, dites) = simuler(&h).unwrap();
        let a = analyser_avec(&ds, fiche, &s);
        assert_eq!(a.source_cible, Some(Source::Simulation));
        assert_eq!(a.resultat.propositions[0].date_disponibilite, j(21), "D = D* = R");
        assert_eq!(dites.len(), 1);
        let h = Hypotheses { couverture_cible_mois: Some(1.0), ..Default::default() };
        let (ds, s, _) = simuler(&h).unwrap();
        let a = analyser_avec(&ds, fiche, &s);
        assert_eq!(a.statut(), statut::SOUS_CIBLE, "20 j < 30 j");
        assert_eq!(a.resultat.ecart_cible_j, Some(-10));
    }

    /// § 15.9 bis-1 : un article au besoin du plan, actif, sans cible : un signal,
    /// aucune proposition, aucun repli ; « Commander » n'a rien à reprendre.
    #[test]
    fn sans_cible_ni_proposition_ni_repli() {
        let mut d = donnees();
        d.fiches.get_mut("REF").unwrap().couverture_cible_mois = None;
        let fiche = &d.fiches["REF"];
        let a = analyser(&d, fiche);
        assert!(a.resultat.propositions.is_empty());
        assert!(a.codes_signaux().contains(&signal::CIBLE_NON_DEFINIE));
        let e = etat_de(&a);
        assert!(e.a_le_signal(signal::CIBLE_NON_DEFINIE));
        assert_eq!(e.qte_a_commander_kg, None);
        // Inactif : plus soumis au MRP, plus de signal.
        d.fiches.get_mut("REF").unwrap().actif = false;
        let a = analyser(&d, &d.fiches["REF"]);
        assert!(!a.codes_signaux().contains(&signal::CIBLE_NON_DEFINIE));
    }
}
