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
//! référence qu'elle est couverte, en rupture, sous la sécurité ou « à commander »
//! vient d'ici — `etats()` pour les écrans et les compteurs (cockpit, briefing,
//! stock projeté, mur de risques, indicateurs du plan d'achat, assistant, saisie
//! d'un bon) et `controles_moteur()` pour les contrôles qui en dépendent (C05,
//! C25). L'ancien calcul (`v_stock_projete`, `v_plan_achat`, `v_encours_fiable`,
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
use crate::domain::couverture::{
    self, jours_du_mois, Arrivee, Couverture, MoisPlan, Reglages, Source, MAX_PROPOSITIONS,
};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use chrono::{Datelike, NaiveDate};
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
    "La fenêtre d'une commande est [D, F[ : D inclus, F exclu, F = D + couverture du fournisseur, sinon P_MargeJours (30 jours pleins par défaut).",
    "Une référence sans classe ABC prend la plus longue des trois sécurités ; le défaut de données est signalé sur la ligne.",
];

/// Les trois états d'une référence au sens du moteur (arbitrage du 27/10/2026) :
/// ils remplacent RUPTURE / CRITIQUE / ATTENTION / OK de l'ancien calcul partout
/// où une référence est dite couverte ou non.
pub mod statut {
    /// Une rupture est prévue sur l'horizon : une part du plan ne sera pas couverte.
    pub const PLAN_NON_COUVERT: &str = "PLAN_NON_COUVERT";
    /// Le solde projeté passe sous la sécurité, sans rupture sur l'horizon.
    pub const SOUS_SECURITE: &str = "SOUS_SECURITE";
    /// Ni rupture ni passage sous la sécurité sur l'horizon.
    pub const COUVERT: &str = "COUVERT";
}

// ============================================================================
// Ce qui se lit
// ============================================================================

struct Parametres {
    securite: [f64; 3],
    delai_defaut: i64,
    marge_jours: i64,
}

struct PlanEnService {
    id_plan: String,
    libelle: Option<String>,
    date_debut: Option<NaiveDate>,
    date_fin: Option<NaiveDate>,
    date_photo: Option<NaiveDate>,
    fin_horizon: NaiveDate,
}

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
}

struct LigneMagasin {
    code_magasin: String,
    nom: Option<String>,
    inclure_mrp: bool,
    quarantaine: bool,
    quantite_kg: f64,
    bloque_kg: f64,
    restes_kg: f64,
}

struct LigneMachine {
    code_emplacement: String,
    lot_fournisseur: Option<String>,
    kg: f64,
    date_constat: Option<NaiveDate>,
    mode_constat: Option<String>,
    bloque: bool,
    reste: bool,
}

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
}

struct LignePort {
    id_dossier: String,
    numero_dossier: Option<String>,
    statut_dossier: Option<String>,
    numero_facture: Option<String>,
    lot_fournisseur: Option<String>,
    reste_kg: f64,
    date_arrivee: Option<NaiveDate>,
}

struct LigneTransit {
    id_transfert: String,
    numero_transfert: Option<String>,
    code_magasin_source: Option<String>,
    code_magasin_dest: Option<String>,
    lot_fournisseur: Option<String>,
    kg: f64,
    date_expedition: Option<NaiveDate>,
    /// La date prévue de disponibilité au magasin destinataire (27/10/2026).
    date_prevue: Option<NaiveDate>,
}

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
                (SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_MargeJours') AS marge",
    )
    .fetch_one(db)
    .await?;
    let aujourdhui: NaiveDate = ctx.try_get("aujourdhui")?;
    // Un paramètre absent prend la valeur livrée par le socle (30 j, 60 j, 30 j).
    let parametres = Parametres {
        securite: [
            entier(ctx.try_get("sec_a")?, 30) as f64,
            entier(ctx.try_get("sec_b")?, 30) as f64,
            entier(ctx.try_get("sec_c")?, 30) as f64,
        ],
        delai_defaut: entier(ctx.try_get("delai")?, 60),
        marge_jours: entier(ctx.try_get("marge")?, 30),
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
                r.poids_bobine_kg::float8 AS poids_bobine_kg, r.bobines_par_palette
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
        "SELECT lt.code_reference, t.id_transfert, t.numero_transfert, t.code_magasin_source, t.code_magasin_dest,
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
            numero_transfert: l.try_get("numero_transfert")?,
            code_magasin_source: l.try_get("code_magasin_source")?,
            code_magasin_dest: l.try_get("code_magasin_dest")?,
            lot_fournisseur: l.try_get("lot_fournisseur")?,
            kg: l.try_get("kg")?,
            date_expedition: l.try_get("date_expedition")?,
            date_prevue: l.try_get("date_prevue")?,
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
    /// Un DÉFAUT DE DONNÉES de la fiche qui a imposé un réglage par défaut
    /// (aujourd'hui : pas de classe ABC). Signalé sur la ligne, jamais bloquant.
    defaut_donnees: Option<String>,
    magasin_compte_kg: f64,
    machine_compte_kg: f64,
    restes_kg: f64,
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
        statut_de(&self.resultat)
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
}

/// L'état d'une référence au sens du moteur : une rupture prévue sur l'horizon
/// l'emporte sur un passage sous la sécurité.
fn statut_de(c: &Couverture) -> &'static str {
    if c.premiere_rupture.is_some() {
        statut::PLAN_NON_COUVERT
    } else if c.premier_passage_securite.is_some() {
        statut::SOUS_SECURITE
    } else {
        statut::COUVERT
    }
}

fn analyser<'a>(d: &'a Donnees, fiche: &'a Fiche) -> Analyse<'a> {
    let code = fiche.code_reference.as_str();
    let auj = d.aujourdhui;
    let fin = d.plan.as_ref().map_or(auj, |p| p.fin_horizon.max(auj));
    let p = &d.parametres;

    // Délai et couverture : le fournisseur, sinon le paramètre global (source affichée).
    let (delai_j, source_delai) = match fiche.delai_fournisseur.filter(|x| *x >= 0) {
        Some(x) => (x, Source::Fournisseur),
        None => (p.delai_defaut, Source::ParametreGlobal),
    };
    // Une couverture de 0 jour ne couvrirait rien : elle vaut « non renseignée ».
    let (couverture_j, source_couverture) = match fiche.couverture_fournisseur.filter(|x| *x > 0) {
        Some(x) => (x, Source::Fournisseur),
        None => (p.marge_jours, Source::ParametreGlobal),
    };
    // Les jours de sécurité de la classe ABC ; sans classe, la plus prudente des
    // trois (décision du 27/10/2026 : on la garde), et le défaut de données est
    // signalé sur la ligne, jamais bloquant.
    let (jours_securite, source_securite, defaut_donnees) = match fiche.classe_abc.as_deref().map(str::trim) {
        Some("A") => (p.securite[0], "classe A (P_SecuriteA)".to_string(), None),
        Some("B") => (p.securite[1], "classe B (P_SecuriteB)".to_string(), None),
        Some("C") => (p.securite[2], "classe C (P_SecuriteC)".to_string(), None),
        autre => {
            let jours = p.securite.iter().cloned().fold(0.0, f64::max);
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
    let reglages = Reglages {
        aujourdhui: auj,
        fin_horizon: fin,
        delai_j,
        couverture_j,
        jours_securite,
        moq_kg: fiche.moq_kg.filter(|m| *m > 0.0),
        multiple_kg,
        kg_palette,
        max_propositions: MAX_PROPOSITIONS,
    };

    // ---- Les ressources d'aujourd'hui -----------------------------------------
    let (mut magasin_compte_kg, mut quarantaine_kg, mut bloque_kg, mut hors_plan_kg, mut restes_kg) =
        (0.0, 0.0, 0.0, 0.0, 0.0);
    for m in d.magasins.get(code).into_iter().flatten() {
        if m.quarantaine {
            quarantaine_kg += m.quantite_kg;
        } else if !m.inclure_mrp {
            hors_plan_kg += m.quantite_kg;
        } else {
            magasin_compte_kg += (m.quantite_kg - m.bloque_kg).max(0.0);
            bloque_kg += m.bloque_kg;
            restes_kg += m.restes_kg;
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
    let resultat = couverture::calculer(magasin_compte_kg + machine_compte_kg, &plan, &arrivees, &reglages);

    Analyse {
        fiche,
        reglages,
        source_delai,
        source_couverture,
        source_securite,
        source_multiple,
        defaut_donnees,
        magasin_compte_kg,
        machine_compte_kg,
        restes_kg,
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
        "date_limite_commande": premiere.map(|p| p.date_limite_commande),
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
    // L'état au sens du moteur (27/10/2026), le même pour tout l'ERP.
    if let Some(o) = v.as_object_mut() {
        o.insert("statut".into(), json!(a.statut()));
        o.insert("jours_couverture".into(), json!(a.jours_couverture()));
        o.insert("a_commander_aujourdhui".into(), json!(a.a_commander_aujourdhui()));
        o.insert("arrivages_comptes_kg".into(), json!(a.arrivages_comptes_kg()));
        o.insert("plan_mois_kg".into(), json!(a.plan_mois_kg()));
        o.insert("defaut_donnees".into(), json!(a.defaut_donnees));
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

/// Les premières propositions du moteur, une par référence ACTIVE qui en a une
/// (toutes, ou la seule référence demandée), avec la date du jour du calcul.
pub async fn premieres_propositions(
    db: &Db,
    reference: Option<&str>,
) -> AppResult<(NaiveDate, Vec<PremiereProposition>)> {
    let d = charger(db, reference).await?;
    let mut sortie = Vec::new();
    for fiche in d.fiches.values().filter(|f| f.actif) {
        let a = analyser(&d, fiche);
        if let Some(p) = a.resultat.propositions.first().filter(|p| p.quantite_proposee_kg > 0.0) {
            sortie.push(PremiereProposition {
                code_reference: fiche.code_reference.clone(),
                quantite_kg: arrondi_kg(p.quantite_proposee_kg),
                date_disponibilite: p.date_disponibilite,
                date_limite_commande: p.date_limite_commande,
                complement_multiple_kg: arrondi_kg((p.quantite_proposee_kg - p.apres_minimum_kg).max(0.0)),
            });
        }
    }
    Ok((d.aujourdhui, sortie))
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
    /// La ligne de sécurité au même jour.
    pub securite_kg: f64,
    pub plan_non_couvert_kg: f64,
    /// PLAN_NON_COUVERT si une part du plan du mois n'est pas couverte, SOUS_SECURITE
    /// si le solde passe sous la sécurité un jour du mois, COUVERT sinon.
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
    pub jours_couverture: Option<i64>,
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
    /// La ligne complète de la liste « À commander » (mêmes champs).
    pub ligne: Value,
    pub mois: Vec<MoisFrise>,
}

impl Etat {
    /// Les COLONNES DU MOTEUR qu'un écran ajoute à ses propres lignes : mêmes
    /// noms partout (stock projeté, état des stocks, cockpit, analyses…).
    pub fn colonnes(&self) -> serde_json::Map<String, Value> {
        let v = json!({
            "statut": self.statut,
            "jours_couverture": self.jours_couverture,
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

    /// Classe A ET plan non couvert.
    pub fn classe_a_en_rupture(&self) -> bool {
        self.statut == statut::PLAN_NON_COUVERT && self.classe_abc.as_deref().map(str::trim) == Some("A")
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
        statut::PLAN_NON_COUVERT => 0,
        statut::SOUS_SECURITE => 1,
        _ => 2,
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

    /// Les références suivies en tension, les plus graves d'abord : plan non
    /// couvert puis sous la sécurité, la rupture (ou le passage sous la sécurité)
    /// la plus proche en tête.
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
        let (mut total, mut pnc, mut sous, mut couvert, mut aujourdhui, mut classe_a) = (0, 0, 0, 0, 0, 0);
        for e in self.suivies() {
            total += 1;
            match e.statut {
                statut::PLAN_NON_COUVERT => pnc += 1,
                statut::SOUS_SECURITE => sous += 1,
                _ => couvert += 1,
            }
            if e.a_commander_aujourdhui {
                aujourdhui += 1;
            }
            if e.classe_a_en_rupture() {
                classe_a += 1;
            }
        }
        json!({
            "nb_references": total,
            "nb_plan_non_couvert": pnc,
            "nb_sous_securite": sous,
            "nb_couvert": couvert,
            "nb_a_commander_aujourdhui": aujourdhui,
            "nb_classe_a_en_rupture": classe_a,
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
            "statut", "jours_couverture", "premiere_rupture", "couvert_jusqu_au", "premier_passage_securite",
            "plan_horizon_kg", "plan_mois_kg", "plan_non_couvert_kg", "arrivages_comptes_kg", "qte_a_commander_kg",
            "date_limite_commande", "a_commander_aujourdhui", "defaut_donnees",
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
                statut: statut::COUVERT,
            });
            sous_jour.push(false);
        }
        let (m, sous) = (mois.last_mut().expect("mois"), sous_jour.last_mut().expect("mois"));
        m.besoin_kg += j.conso_prevue_kg;
        m.entrees_kg += j.arrivee_kg;
        m.plan_non_couvert_kg += j.plan_non_couvert_kg;
        m.stock_fin_kg = j.solde_kg;
        m.securite_kg = j.securite_kg;
        if j.solde_kg < j.securite_kg - 1e-6 {
            *sous = true;
        }
    }
    for (m, sous) in mois.iter_mut().zip(sous_jour) {
        m.besoin_kg = arrondi_kg(m.besoin_kg) + 0.0;
        m.entrees_kg = arrondi_kg(m.entrees_kg) + 0.0;
        m.plan_non_couvert_kg = arrondi_kg(m.plan_non_couvert_kg) + 0.0;
        m.statut = if m.plan_non_couvert_kg > 1e-6 {
            statut::PLAN_NON_COUVERT
        } else if sous {
            statut::SOUS_SECURITE
        } else {
            statut::COUVERT
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
        jours_couverture: a.jours_couverture(),
        premiere_rupture: r.premiere_rupture,
        couvert_jusqu_au: r.couvert_jusqu_au,
        premier_passage_securite: r.premier_passage_securite,
        plan_horizon_kg: r.plan_horizon_kg,
        plan_mois_kg: a.plan_mois_kg(),
        plan_non_couvert_kg: r.plan_non_couvert_kg,
        disponible_kg: arrondi_kg(a.magasin_compte_kg + a.machine_compte_kg),
        arrivages_comptes_kg: a.arrivages_comptes_kg(),
        qte_a_commander_kg: premiere.map(|p| p.quantite_proposee_kg),
        date_limite_commande: premiere.map(|p| p.date_limite_commande),
        a_commander_aujourdhui: a.a_commander_aujourdhui(),
        delai_j: a.reglages.delai_j,
        defaut_donnees: a.defaut_donnees.clone(),
        ligne: ligne(a),
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
/// mêmes codes et la même forme. C05 « plan non couvert sur l'horizon » remplace
/// « stock projeté négatif sur 12 mois » ; C25 garde son sens (du stock qui dort
/// face à un équivalent interchangeable en tension), la tension étant celle du
/// moteur.
pub const CONTROLES_MOTEUR: &[(&str, &str, &str)] = &[
    ("C05", "Plan non couvert sur l'horizon (moteur de couverture)", "CRITIQUE"),
    ("C25", "Stock mobilisable face a un equivalent en tension (moteur de couverture)", "ATTENTION"),
];

/// Les lignes d'un contrôle du moteur (`None` : ce code n'en est pas un).
pub async fn controle_moteur_detail(db: &Db, e: &Etats, code: &str) -> AppResult<Option<Value>> {
    match code.to_ascii_uppercase().as_str() {
        "C05" => Ok(Some(Value::Array(
            e.suivies()
                .filter(|x| x.statut == statut::PLAN_NON_COUVERT)
                .map(|x| {
                    json!({
                        "code_reference": x.code_reference, "designation": x.designation,
                        "statut": x.statut, "premiere_rupture": x.premiere_rupture,
                        "plan_non_couvert_kg": x.plan_non_couvert_kg, "disponible_kg": x.disponible_kg,
                        "plan_horizon_kg": x.plan_horizon_kg, "arrivages_comptes_kg": x.arrivages_comptes_kg,
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

/// `GET /api/couverture/{reference}` — le détail : ressources, arrivages comptés
/// et non comptés avec leur raison, événements, propositions avec toutes leurs
/// étapes, plan mois par mois (et par qualité, selon les recettes actuelles),
/// et la projection jour par jour pour la courbe.
pub async fn detail(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(reference): Path<String>,
) -> AppResult<Json<Value>> {
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
            "SELECT lpp.annee_mois, lpp.code_qualite,
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

    let mut v = entete(&d);
    v["reference"] = json!({
        "code_reference": fiche.code_reference, "designation": fiche.designation,
        "classe_abc": fiche.classe_abc, "actif": fiche.actif,
        "code_fournisseur": fiche.code_fournisseur, "fournisseur_nom": fiche.fournisseur_nom,
        "moq_kg": fiche.moq_kg, "multiple_achat_kg": fiche.multiple_achat_kg,
        "arrondi_palette": fiche.arrondi_palette, "poids_bobine_kg": fiche.poids_bobine_kg,
        "bobines_par_palette": fiche.bobines_par_palette,
    });
    v["reglages"] = json!({
        "delai_j": a.reglages.delai_j, "source_delai": a.source_delai,
        "couverture_commande_j": a.reglages.couverture_j, "source_couverture": a.source_couverture,
        "jours_securite": a.reglages.jours_securite, "source_securite": a.source_securite,
        "moq_kg": a.reglages.moq_kg,
        "multiple_kg": a.reglages.multiple_kg, "source_multiple": a.source_multiple,
        "kg_palette": a.reglages.kg_palette,
        "defaut_donnees": a.defaut_donnees,
    });
    v["synthese"] = ligne(&a);
    v["ressources"] = json!({
        "compte_kg": arrondi_kg(a.magasin_compte_kg + a.machine_compte_kg),
        "magasin_kg": arrondi_kg(a.magasin_compte_kg),
        "machine_kg": arrondi_kg(a.machine_compte_kg),
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
    v["arrivages"] = Value::Array(a.arrivages.iter().map(|x| x.detail.clone()).collect());
    v["evenements"] = serde_json::to_value(&r.evenements).unwrap_or(Value::Null);
    v["propositions"] = serde_json::to_value(&r.propositions).unwrap_or(Value::Null);
    v["propositions_plafonnees"] = json!(r.propositions_plafonnees);
    v["motif_sans_proposition"] = json!(r.motif_sans_proposition);
    v["plan_mois"] = Value::Array(plan_mois);
    v["jours"] = serde_json::to_value(&r.jours).unwrap_or(Value::Null);
    user.masquer(&state.db, module::PLAN_ACHAT, &mut v).await?;
    // La quantité à commander masquée l'est aussi dans les étapes du calcul : le
    // masquage se fait par nom de champ, et les propositions portent la même
    // quantité sous d'autres noms (audit du 27/10/2026).
    if v["synthese"].get("qte_a_commander_kg").is_none() {
        if let Some(props) = v["propositions"].as_array_mut() {
            for p in props.iter_mut().filter_map(Value::as_object_mut) {
                for champ in ["besoin_theorique_kg", "apres_minimum_kg", "quantite_proposee_kg", "palettes_equivalentes"] {
                    p.remove(champ);
                }
            }
        }
    }
    Ok(Json(v))
}
