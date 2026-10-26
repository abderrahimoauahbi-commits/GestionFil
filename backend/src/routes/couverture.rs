//! LA COUVERTURE DU PLAN PAR RÉFÉRENCE (étape 1 du plan du 26/10/2026) :
//! `GET /api/couverture` (la liste) et `GET /api/couverture/{reference}` (le détail).
//!
//! Ce module LIT ; le calcul est dans `domain/couverture.rs` (pur, testé sans
//! base). Il tourne en parallèle de `v_plan_achat` / `v_stock_projete`, qu'il ne
//! touche pas. Une seule lecture sert les deux routes (toutes les références, ou
//! une seule) : la liste et le détail ne peuvent pas diverger.
//!
//! Ce qui est COMPTÉ aujourd'hui (décisions du 26/10/2026) :
//!   * le stock des magasins comptés au plan (`inclure_mrp = 1`, hors
//!     quarantaine), lots libres — restes et dormants compris —, lots BLOQUÉS exclus ;
//!   * le fil sur les machines au dernier constat (`machine_etat.kg`), QUEL QUE
//!     SOIT son âge, restes chargés compris, lots bloqués exclus ;
//!   * les lignes de bon VALIDÉ / ENVOYÉ / LIVRÉ PARTIEL, à la date de livraison
//!     prévue de la ligne, sinon de l'en-tête (règle PROVISOIRE).
//!
//! Ce qui est AFFICHÉ À PART, jamais compté : quarantaine, bloqué, magasins hors
//! plan, bons en retard ou sans date, bons non validés, import en route sans bon,
//! transferts en route. Ni les prêts ni les réceptions non validées n'entrent.
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
    "Un transfert en route est hors couverture jusqu'à sa réception.",
];

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

    // Les transferts en route vers un magasin compté (la CTE `en_route` de v_stock_physique).
    let mut transits: HashMap<String, Vec<LigneTransit>> = HashMap::new();
    for l in sqlx::query(
        "SELECT lt.code_reference, t.id_transfert, t.numero_transfert, t.code_magasin_source, t.code_magasin_dest,
                lt.lot_fournisseur, lt.quantite_kg::float8 AS kg,
                COALESCE(t.date_sortie::date, t.date_transfert) AS date_expedition
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
    // Les jours de sécurité de la classe ABC ; sans classe, la plus prudente des trois.
    let (jours_securite, source_securite) = match fiche.classe_abc.as_deref().map(str::trim) {
        Some("A") => (p.securite[0], "classe A (P_SecuriteA)".to_string()),
        Some("B") => (p.securite[1], "classe B (P_SecuriteB)".to_string()),
        Some("C") => (p.securite[2], "classe C (P_SecuriteC)".to_string()),
        autre => (
            p.securite.iter().cloned().fold(0.0, f64::max),
            format!("classe {} inconnue : la plus longue des trois", autre.unwrap_or("vide")),
        ),
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
    for t in d.transits.get(code).into_iter().flatten() {
        arrivages.push(ArrivageClasse {
            detail: json!({
                "origine": "TRANSFERT",
                "id_transfert": t.id_transfert, "numero_transfert": t.numero_transfert,
                "code_magasin_source": t.code_magasin_source, "code_magasin_dest": t.code_magasin_dest,
                "lot_fournisseur": t.lot_fournisseur,
                "date_expedition": t.date_expedition,
                "date": Value::Null, "source_date": Value::Null,
                "kg": arrondi_kg(t.kg),
                "compte": false, "categorie": "TRANSIT",
                "raison": "transfert en route : hors couverture jusqu'à sa réception",
            }),
            date: None,
            kg: t.kg,
            categorie: "TRANSIT",
            compte: false,
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
    json!({
        "code_reference": a.fiche.code_reference,
        "designation": a.fiche.designation,
        "classe_abc": a.fiche.classe_abc,
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
    })
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
// Les routes
// ============================================================================

/// `GET /api/couverture` — une ligne par référence qui a une demande au plan ou
/// du stock (compté ou non), triée par date limite de commande puis rupture.
pub async fn liste(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Lire).await?;
    let d = charger(&state.db, None).await?;
    let mut analyses: Vec<Analyse> = d
        .fiches
        .values()
        .map(|f| analyser(&d, f))
        .filter(|a| a.resultat.plan_horizon_kg > 0.0 || a.a_du_stock())
        .collect();
    analyses.sort_by(|x, y| {
        let cle = |a: &Analyse| {
            (
                a.resultat.propositions.first().map(|p| p.date_limite_commande).unwrap_or(NaiveDate::MAX),
                a.resultat.premiere_rupture.unwrap_or(NaiveDate::MAX),
            )
        };
        cle(x).cmp(&cle(y)).then_with(|| x.fiche.code_reference.cmp(&y.fiche.code_reference))
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
    Ok(Json(v))
}
