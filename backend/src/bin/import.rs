//! Import de reprise depuis GESTION Fil.xlsx.
//!
//! Usage :
//!     gestionfil-import [--fichier <chemin>] [--simuler]
//!
//! `--simuler` execute tout l'import puis annule la transaction : le rapport
//! est identique, la base n'est pas modifiee. A utiliser avant chaque reprise
//! reelle.
//!
//! PORTEE (arbitrage valide) : referentiels + photo de stock au 27/04/2026.
//! L'historique des mouvements, receptions et prix du classeur n'est PAS
//! importe : il reste consultable dans le fichier. Une reprise d'historique
//! ferait entrer dans l'ERP les incoherences accumulees dans le tableur.
//!
//! Les parametres systeme ne sont pas importes non plus : le classeur stocke
//! "Marge de securite = 0.2" et "Taux de perte = 0.02" avec l'unite "%", donc
//! des ratios etiquetes en pourcentages. Le seed porte les valeurs de la table
//! A4 du cahier des charges (20 % et 2 %), non ambigues.

#[allow(dead_code, unused_imports)]
#[path = "../db.rs"]
mod db;

use anyhow::{bail, Context, Result};
use calamine::{open_workbook_auto, Data, Range, Reader};
use std::collections::{BTreeMap, HashMap, HashSet};

const UTILISATEUR_IMPORT: &str = "00000000-0000-4000-a000-000000000010"; // direction
const DATE_PHOTO_STOCK: &str = "2026-04-27T08:00:00.000Z";

// ============================================================================
// Rapport
// ============================================================================

#[derive(Default)]
struct Rapport {
    lignes: Vec<(String, usize, usize)>, // (entite, importees, ignorees)
    rejets: Vec<String>,
    avertissements: Vec<String>,
}

impl Rapport {
    fn ajouter(&mut self, entite: &str, importees: usize, ignorees: usize) {
        self.lignes.push((entite.to_string(), importees, ignorees));
    }
    fn rejet(&mut self, message: String) {
        self.rejets.push(message);
    }
    fn avertir(&mut self, message: String) {
        self.avertissements.push(message);
    }

    fn afficher(&self, simule: bool) {
        println!();
        println!("{:<42} {:>10} {:>10}", "ENTITE", "IMPORTEES", "IGNOREES");
        println!("{}", "-".repeat(64));
        for (e, i, ig) in &self.lignes {
            println!("{e:<42} {i:>10} {ig:>10}");
        }

        if !self.avertissements.is_empty() {
            println!("\nAVERTISSEMENTS ({}) :", self.avertissements.len());
            for a in &self.avertissements {
                println!("  ! {a}");
            }
        }

        if !self.rejets.is_empty() {
            println!("\nREJETS ({}) :", self.rejets.len());
            for r in self.rejets.iter().take(50) {
                println!("  x {r}");
            }
            if self.rejets.len() > 50 {
                println!("  ... et {} autres", self.rejets.len() - 50);
            }
        }

        println!();
        if simule {
            println!(">> SIMULATION : la transaction a ete annulee, la base est inchangee.");
        } else {
            println!(">> Import valide.");
        }
    }
}

// ============================================================================
// Lecture du classeur
// ============================================================================

/// Une feuille lue : en-tetes normalises + lignes indexees par nom de colonne.
struct Feuille {
    nom: String,
    colonnes: HashMap<String, usize>,
    entetes: Vec<String>,
    lignes: Vec<Vec<Data>>,
}

impl Feuille {
    fn txt(&self, ligne: &[Data], colonne: &str) -> Option<String> {
        let i = *self.colonnes.get(colonne)?;
        let v = ligne.get(i)?;
        let s = match v {
            Data::String(s) => s.trim().to_string(),
            Data::Float(f) => {
                if (f.fract()).abs() < f64::EPSILON {
                    format!("{}", *f as i64)
                } else {
                    format!("{f}")
                }
            }
            Data::Int(i) => i.to_string(),
            Data::Bool(b) => b.to_string(),
            _ => String::new(),
        };
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }

    fn nombre(&self, ligne: &[Data], colonne: &str) -> Option<f64> {
        let i = *self.colonnes.get(colonne)?;
        match ligne.get(i)? {
            Data::Float(f) => Some(*f),
            Data::Int(n) => Some(*n as f64),
            Data::String(s) => s.trim().replace(',', ".").parse().ok(),
            _ => None,
        }
    }

    fn entier(&self, ligne: &[Data], colonne: &str) -> Option<i64> {
        self.nombre(ligne, colonne).map(|f| f.round() as i64)
    }

    fn booleen(&self, ligne: &[Data], colonne: &str) -> bool {
        matches!(
            self.txt(ligne, colonne).as_deref().map(str::to_lowercase).as_deref(),
            Some("oui") | Some("true") | Some("1") | Some("o") | Some("x")
        )
    }
}

/// Retire les accents et met en minuscules, pour comparer des libelles saisis
/// a la main ("Chaîne" / "Chaine", "Polypropylène" / "polypropylene").
fn normaliser(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' | 'á' | 'ã' | 'å' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' | 'í' | 'ì' => 'i',
            'ô' | 'ö' | 'ó' | 'ò' | 'õ' => 'o',
            'ù' | 'û' | 'ü' | 'ú' => 'u',
            'ç' => 'c',
            'ÿ' | 'ý' => 'y',
            'ñ' => 'n',
            autre => autre,
        })
        .collect::<String>()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn charger_feuille(chemin: &str, mot_cle: &str) -> Result<Feuille> {
    let mut classeur = open_workbook_auto(chemin)
        .with_context(|| format!("ouverture impossible : {chemin}"))?;

    // Les noms de feuilles portent des emoji : on cherche par mot-cle plutot
    // que par egalite exacte.
    let cible = classeur
        .sheet_names()
        .iter()
        .find(|n| normaliser(n).contains(&normaliser(mot_cle)))
        .cloned()
        .with_context(|| format!("feuille introuvable pour le mot-cle : {mot_cle}"))?;

    let plage: Range<Data> = classeur
        .worksheet_range(&cible)
        .with_context(|| format!("lecture impossible de la feuille {cible}"))?;

    let toutes: Vec<Vec<Data>> = plage.rows().map(|r| r.to_vec()).collect();
    if toutes.is_empty() {
        bail!("feuille {cible} vide");
    }

    // Les feuilles portent un titre et un sous-titre au-dessus de l'en-tete.
    //
    // On repere l'en-tete au nombre de cellules TEXTE, pas au nombre de
    // cellules remplies : un en-tete est integralement textuel, une ligne de
    // donnees melange textes et nombres. Compter les cellules remplies mettait
    // l'en-tete et la premiere ligne de donnees a egalite, et `max_by_key`
    // retenant le DERNIER maximum, c'est la ligne de donnees qui l'emportait.
    // A egalite de score, on garde la ligne la plus haute.
    let score = |i: usize| -> usize {
        toutes[i]
            .iter()
            .filter(|c| matches!(c, Data::String(s) if !s.trim().is_empty()))
            .count()
    };
    let mut idx = 0usize;
    let mut meilleur = 0usize;
    for i in 0..toutes.len().min(8) {
        let s = score(i);
        if s > meilleur {
            meilleur = s;
            idx = i;
        }
    }

    let entetes: Vec<String> = toutes[idx]
        .iter()
        .map(|c| match c {
            Data::String(s) => s.trim().to_string(),
            autre => autre.to_string().trim().to_string(),
        })
        .collect();

    let mut colonnes = HashMap::new();
    for (i, h) in entetes.iter().enumerate() {
        if !h.is_empty() {
            colonnes.entry(h.clone()).or_insert(i);
        }
    }

    Ok(Feuille {
        nom: cible,
        colonnes,
        entetes,
        lignes: toutes.into_iter().skip(idx + 1).collect(),
    })
}

// ============================================================================
// Correspondances Excel -> ERP
// ============================================================================

/// Libelle de role BOM du classeur -> code de la table role_bom.
fn code_role(libelle: &str) -> Option<&'static str> {
    match normaliser(libelle).as_str() {
        "poil" | "fil" => Some("POIL"),
        "trame" => Some("TRAME"),
        "chaine" => Some("CHAINE"),
        "colle" => Some("COLLE"),
        "cuir" => Some("CUIR"),
        "franges" | "frange" => Some("FRANGE"),
        "plastique" => Some("PLAST"),
        "ruban" => Some("RUBAN"),
        _ => None,
    }
}

/// En-tete de la feuille Qualites -> (code role, unite de densite).
///
/// Les colonnes sont de la forme "Trame kg/m2" ou "Cuir ml/m2". C'est cet
/// en-tete qui porte le discriminant d'unite que le modele du cahier des
/// charges n'avait aucun moyen d'exprimer.
fn role_et_unite(entete: &str) -> Option<(&'static str, &'static str)> {
    let n = normaliser(entete);
    let unite = if n.ends_with("ml/m2") || n.ends_with("ml/m²") {
        "ml_m2"
    } else if n.ends_with("kg/m2") || n.ends_with("kg/m²") {
        "kg_m2"
    } else {
        return None;
    };
    let libelle = entete.split_whitespace().next()?;
    code_role(libelle).map(|r| (r, unite))
}

// ============================================================================
// Import
// ============================================================================

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    let args: Vec<String> = std::env::args().skip(1).collect();

    let simuler = args.iter().any(|a| a == "--simuler");
    let chemin = args
        .windows(2)
        .find(|w| w[0] == "--fichier")
        .map(|w| w[1].clone())
        .unwrap_or_else(|| {
            let bureau = std::env::var("USERPROFILE").unwrap_or_default();
            format!("{bureau}\\Desktop\\GESTION FIL.xlsx")
        });

    if !std::path::Path::new(&chemin).exists() {
        bail!("fichier introuvable : {chemin}\nPreciser le chemin avec --fichier <chemin>");
    }

    let url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://../db/gestionfil.db".into());
    let pool = db::connect(&url).await.context("connexion a la base")?;

    println!("Fichier : {chemin}");
    println!("Base    : {url}");
    if simuler {
        println!("Mode    : SIMULATION (aucune ecriture ne sera conservee)");
    }

    let rapport = importer(&pool, &chemin, simuler).await?;
    rapport.afficher(simuler);

    if !rapport.rejets.is_empty() && !simuler {
        println!("\n/!\\ {} ligne(s) rejetee(s) : verifier ci-dessus.", rapport.rejets.len());
    }
    Ok(())
}

async fn importer(pool: &db::Db, chemin: &str, simuler: bool) -> Result<Rapport> {
    let mut r = Rapport::default();
    let mut tx = pool.begin().await?;

    db::poser_contexte(&mut tx, UTILISATEUR_IMPORT, None, Some("import-xlsx")).await?;

    // ---- Catalogue lu d'abord : il determine les fournisseurs reellement utilises
    let f_cat = charger_feuille(chemin, "Catalogue")?;
    println!("  lecture : {} ({} lignes)", f_cat.nom, f_cat.lignes.len());

    let mut fournisseurs_utilises: HashSet<String> = HashSet::new();
    for l in &f_cat.lignes {
        if f_cat.txt(l, "Référence").is_some() {
            if let Some(f) = f_cat.txt(l, "Fournisseur") {
                fournisseurs_utilises.insert(normaliser(&f));
            }
        }
    }

    // ---- 1. Fournisseurs ---------------------------------------------------
    let f_four = charger_feuille(chemin, "Fournisseurs")?;
    println!("  lecture : {} ({} lignes)", f_four.nom, f_four.lignes.len());

    let mut nom_vers_code: HashMap<String, String> = HashMap::new();
    let (mut n_four, mut ig_four) = (0usize, 0usize);
    let mut codes_vus: HashSet<String> = HashSet::new();

    for l in &f_four.lignes {
        let code = f_four.txt(l, "Code");
        let nom = f_four.txt(l, "Nom Fournisseur");

        // La feuille contient, sous la liste, un second bloc de statistiques qui
        // reutilise les memes colonnes avec un autre sens. On s'arrete a la
        // premiere ligne vide une fois la liste commencee, plutot que de tenter
        // d'interpreter ce bloc.
        if code.is_none() && nom.is_none() {
            if n_four > 0 {
                break;
            }
            continue;
        }
        let (Some(code), Some(nom)) = (code, nom) else {
            continue;
        };
        let cle = normaliser(&nom);

        if !fournisseurs_utilises.contains(&cle) {
            ig_four += 1;
            r.avertir(format!(
                "fournisseur '{nom}' ({code}) present dans la liste mais reference par aucun article du catalogue : ignore"
            ));
            continue;
        }
        if !codes_vus.insert(code.clone()) {
            ig_four += 1;
            continue;
        }

        let pays = f_four.txt(l, "Ville / Pays").unwrap_or_else(|| "Maroc".into());
        let devise = f_four.txt(l, "Devise").unwrap_or_else(|| "MAD".into());
        let devise_ok: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM devise WHERE code_devise = ?1")
            .bind(&devise)
            .fetch_one(&mut *tx)
            .await?;
        if devise_ok == 0 {
            r.rejet(format!("fournisseur {code} : devise inconnue '{devise}'"));
            continue;
        }

        sqlx::query(
            "INSERT INTO fournisseur
                 (code_fournisseur, nom, contact_principal, telephone, email, pays,
                  delai_livraison_jours, conditions_paiement, delai_paiement_jours,
                  code_devise, tolerance_pesee_pct)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,2.0)
             ON CONFLICT (code_fournisseur) DO UPDATE SET
                 nom = excluded.nom,
                 contact_principal = excluded.contact_principal,
                 telephone = excluded.telephone,
                 email = excluded.email,
                 pays = excluded.pays,
                 delai_livraison_jours = excluded.delai_livraison_jours,
                 conditions_paiement = excluded.conditions_paiement,
                 delai_paiement_jours = excluded.delai_paiement_jours,
                 code_devise = excluded.code_devise",
        )
        .bind(&code)
        .bind(&nom)
        .bind(f_four.txt(l, "Contact"))
        .bind(f_four.txt(l, "Téléphone"))
        .bind(f_four.txt(l, "Email"))
        .bind(&pays)
        .bind(f_four.entier(l, "Délai (j)"))
        .bind(f_four.txt(l, "Conditions paiement"))
        .bind(f_four.entier(l, "Délai paiement (j)"))
        .bind(&devise)
        .execute(&mut *tx)
        .await?;

        nom_vers_code.insert(cle, code);
        n_four += 1;
    }
    r.ajouter("Fournisseurs", n_four, ig_four);

    // ---- 2. Categories matiere (resolues par libelle) -----------------------
    let cats: Vec<(String, String)> =
        sqlx::query_as("SELECT code_categorie, libelle FROM categorie_matiere")
            .fetch_all(&mut *tx)
            .await?;
    let libelle_vers_cat: HashMap<String, String> = cats
        .into_iter()
        .map(|(c, l)| (normaliser(&l), c))
        .collect();

    // ---- 3. References ------------------------------------------------------
    let mut n_ref = 0usize;
    let ig_ref = 0usize;
    let mut refs_importees: HashSet<String> = HashSet::new();
    // (groupe -> liste de (priorite Excel, reference)) pour renumeroter ensuite
    let mut groupes: BTreeMap<String, Vec<(i64, String)>> = BTreeMap::new();

    for (n, l) in f_cat.lignes.iter().enumerate() {
        let Some(code_ref) = f_cat.txt(l, "Référence") else {
            continue;
        };
        let ligne_excel = n + 5;

        let Some(nature) = f_cat.txt(l, "Nature") else {
            r.rejet(format!("L{ligne_excel} '{code_ref}' : nature absente"));
            continue;
        };
        let Some(code_cat) = libelle_vers_cat.get(&normaliser(&nature)).cloned() else {
            r.rejet(format!("L{ligne_excel} '{code_ref}' : nature inconnue '{nature}'"));
            continue;
        };

        let Some(nom_four) = f_cat.txt(l, "Fournisseur") else {
            r.rejet(format!("L{ligne_excel} '{code_ref}' : fournisseur absent"));
            continue;
        };
        let Some(code_four) = nom_vers_code.get(&normaliser(&nom_four)).cloned() else {
            r.rejet(format!(
                "L{ligne_excel} '{code_ref}' : fournisseur inconnu '{nom_four}'"
            ));
            continue;
        };

        let unite = f_cat.txt(l, "Unité").unwrap_or_else(|| "kg".into());
        let prix = f_cat.nombre(l, "Prix/unité").unwrap_or(0.0);
        if prix <= 0.0 {
            r.rejet(format!("L{ligne_excel} '{code_ref}' : prix nul ou absent"));
            continue;
        }
        let densite_ml = f_cat.nombre(l, "Densité (kg/ml)");
        if unite == "ml" && densite_ml.filter(|d| *d > 0.0).is_none() {
            // R01 : refus plutot que repli silencieux sur un facteur de 1.
            r.rejet(format!(
                "L{ligne_excel} '{code_ref}' : unite 'ml' sans densite (kg/ml) — conversion impossible"
            ));
            continue;
        }

        sqlx::query(
            "INSERT INTO reference
                 (code_reference, code_categorie, code_fournisseur, designation, type_fil,
                  couleur, titrage, unite_catalogue, poids_bobine_kg, bobines_par_palette,
                  densite_kg_ml, prix_catalogue, code_devise_catalogue, stock_min_kg,
                  couverture_min_mois, actif, suivi_lot, id_utilisateur_creation)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,0,?17)
             ON CONFLICT (code_reference) DO UPDATE SET
                 code_categorie = excluded.code_categorie,
                 code_fournisseur = excluded.code_fournisseur,
                 couleur = excluded.couleur,
                 titrage = excluded.titrage,
                 unite_catalogue = excluded.unite_catalogue,
                 poids_bobine_kg = excluded.poids_bobine_kg,
                 bobines_par_palette = excluded.bobines_par_palette,
                 densite_kg_ml = excluded.densite_kg_ml,
                 prix_catalogue = excluded.prix_catalogue,
                 code_devise_catalogue = excluded.code_devise_catalogue,
                 stock_min_kg = excluded.stock_min_kg,
                 couverture_min_mois = excluded.couverture_min_mois,
                 actif = excluded.actif",
        )
        .bind(&code_ref)
        .bind(&code_cat)
        .bind(&code_four)
        .bind(&code_ref) // la Reference EST la designation dans le classeur
        .bind(&nature)
        .bind(f_cat.txt(l, "Désignation"))
        .bind(f_cat.txt(l, "Titrage"))
        .bind(&unite)
        .bind(f_cat.nombre(l, "Poids/bobine (kg)"))
        .bind(f_cat.entier(l, "Bob/palette"))
        .bind(densite_ml)
        .bind(prix)
        .bind(f_cat.txt(l, "Devise").unwrap_or_else(|| "USD".into()))
        .bind(f_cat.nombre(l, "Stock Min").filter(|v| *v > 0.0))
        .bind(f_cat.nombre(l, "Couv Min (mois)"))
        .bind(i64::from(f_cat.booleen(l, "Actif")))
        .bind(UTILISATEUR_IMPORT)
        .execute(&mut *tx)
        .await?;

        if let Some(grp) = f_cat.txt(l, "Groupe Equiv") {
            let prio = f_cat.entier(l, "Priorité Equiv").unwrap_or(1);
            groupes.entry(grp).or_default().push((prio, code_ref.clone()));
        }

        refs_importees.insert(code_ref);
        n_ref += 1;
    }
    r.ajouter("References catalogue", n_ref, ig_ref);

    let sans_stock_min = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM reference WHERE actif = 1 AND stock_min_kg IS NULL",
    )
    .fetch_one(&mut *tx)
    .await?;
    if sans_stock_min > 0 {
        r.avertir(format!(
            "{sans_stock_min} reference(s) sans stock minimum : la formule F3 calculera un minimum dynamique"
        ));
    }

    // ---- 4. Groupes d'equivalence ------------------------------------------
    // Les priorites sont renumerotees 1..n par groupe : le classeur affecte
    // souvent 1 a plusieurs references du meme groupe, ce que la contrainte
    // d'unicite (groupe, priorite) refuse.
    let mut n_grp = 0usize;
    let mut n_liens = 0usize;
    for (code_grp, mut membres) in groupes {
        membres.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));

        sqlx::query(
            "INSERT INTO groupe_equiv (code_groupe_equiv, libelle, description)
             VALUES (?1, ?2, 'Importe de GESTION Fil.xlsx')
             ON CONFLICT (code_groupe_equiv) DO NOTHING",
        )
        .bind(&code_grp)
        .bind(format!("Groupe {code_grp}"))
        .execute(&mut *tx)
        .await?;
        n_grp += 1;

        // La composition du groupe est reprise integralement du classeur, qui
        // en est la source. On vide d'abord : sans cela, des membres deja
        // presents (jeu de demonstration, import precedent partiel) entrent en
        // collision avec les priorites renumerotees ci-dessous.
        sqlx::query("DELETE FROM reference_groupe_equiv WHERE code_groupe_equiv = ?1")
            .bind(&code_grp)
            .execute(&mut *tx)
            .await?;

        for (rang, (_, code_ref)) in membres.iter().enumerate() {
            sqlx::query(
                "INSERT INTO reference_groupe_equiv
                     (code_reference, code_groupe_equiv, priorite, est_preferentielle)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT (code_reference, code_groupe_equiv) DO UPDATE SET
                     priorite = excluded.priorite,
                     est_preferentielle = excluded.est_preferentielle",
            )
            .bind(code_ref)
            .bind(&code_grp)
            .bind((rang + 1) as i64)
            .bind(i64::from(rang == 0))
            .execute(&mut *tx)
            .await?;
            n_liens += 1;
        }
    }
    r.ajouter("Groupes d'equivalence", n_grp, 0);
    r.ajouter("  dont liens reference-groupe", n_liens, 0);

    // ---- 5. Qualites et densites par role ----------------------------------
    let f_qual = charger_feuille(chemin, "Qualit")?;
    println!("  lecture : {} ({} lignes)", f_qual.nom, f_qual.lignes.len());

    // Colonnes de densite : "Trame kg/m2", "Cuir ml/m2", ...
    let colonnes_roles: Vec<(usize, &'static str, &'static str)> = f_qual
        .entetes
        .iter()
        .enumerate()
        .filter_map(|(i, h)| role_et_unite(h).map(|(r, u)| (i, r, u)))
        .collect();

    if colonnes_roles.is_empty() {
        bail!("aucune colonne de densite par role reconnue dans la feuille Qualites");
    }

    let (mut n_qual, mut n_dens) = (0usize, 0usize);
    for l in &f_qual.lignes {
        let (Some(code), Some(nom)) = (f_qual.txt(l, "Code"), f_qual.txt(l, "Nom")) else {
            continue;
        };

        sqlx::query(
            "INSERT INTO qualite
                 (code_qualite, nom, poids_commercial_m2, statut,
                  marge_securite_pct, couv_min_mois, taux_perte_pct,
                  seuil_alerte_jours, seuil_critique_jours, stock_securite_jours,
                  id_utilisateur_creation)
             -- BROUILLON : la mise en service intervient apres l'import de la
             -- composition, en passant par les controles R07 et densites.
             SELECT ?1, ?2, ?3, 'BROUILLON',
                    (SELECT CAST(valeur_courante AS REAL) FROM parametre WHERE code_parametre='P_MargeSecurite'),
                    (SELECT CAST(valeur_courante AS REAL) FROM parametre WHERE code_parametre='P_CouvMinMois'),
                    (SELECT CAST(valeur_courante AS REAL) FROM parametre WHERE code_parametre='P_TauxPerte'),
                    (SELECT CAST(valeur_courante AS INTEGER) FROM parametre WHERE code_parametre='P_SeuilAlerte'),
                    (SELECT CAST(valeur_courante AS INTEGER) FROM parametre WHERE code_parametre='P_SeuilCritique'),
                    (SELECT CAST(valeur_courante AS INTEGER) FROM parametre WHERE code_parametre='P_SecuriteA'),
                    ?4
             ON CONFLICT (code_qualite) DO UPDATE SET
                 nom = excluded.nom,
                 poids_commercial_m2 = excluded.poids_commercial_m2",
        )
        .bind(&code)
        .bind(&nom)
        .bind(f_qual.nombre(l, "Poids commercial/m² (info)").unwrap_or(0.0))
        .bind(UTILISATEUR_IMPORT)
        .execute(&mut *tx)
        .await?;
        n_qual += 1;

        for (i, role, unite) in &colonnes_roles {
            let densite = match l.get(*i) {
                Some(Data::Float(f)) => *f,
                Some(Data::Int(n)) => *n as f64,
                _ => continue,
            };
            if densite <= 0.0 {
                continue;
            }
            sqlx::query(
                "INSERT INTO ligne_qualite
                     (code_qualite, code_role, densite, unite_densite,
                      entre_poids_commercial, ordre_affichage)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT (code_qualite, code_role) DO UPDATE SET
                     densite = excluded.densite,
                     unite_densite = excluded.unite_densite",
            )
            .bind(&code)
            .bind(role)
            .bind(densite)
            .bind(unite)
            // Un role en ml/m2 consomme de la matiere mais n'entre pas dans le
            // poids commercial du tapis (verifie : SH = 2,745 ~ 2,764 kg/m2).
            .bind(i64::from(*unite == "kg_m2"))
            .bind((*i as i64) * 10)
            .execute(&mut *tx)
            .await?;
            n_dens += 1;
        }
    }
    r.ajouter("Qualites", n_qual, 0);
    r.ajouter("  dont densites par role", n_dens, 0);

    // ---- 6. Recettes --------------------------------------------------------
    let f_rec = charger_feuille(chemin, "Recettes")?;
    println!("  lecture : {} ({} lignes)", f_rec.nom, f_rec.lignes.len());

    let mut par_qualite: BTreeMap<String, Vec<&Vec<Data>>> = BTreeMap::new();
    for l in &f_rec.lignes {
        if let (Some(q), Some(_)) = (f_rec.txt(l, "Qualité"), f_rec.txt(l, "Code Réf")) {
            par_qualite.entry(q).or_default().push(l);
        }
    }

    let (mut n_rec, mut n_lig, mut ig_lig) = (0usize, 0usize, 0usize);
    for (code_qualite, lignes) in &par_qualite {
        let existe: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM qualite WHERE code_qualite = ?1")
                .bind(code_qualite)
                .fetch_one(&mut *tx)
                .await?;
        if existe == 0 {
            r.rejet(format!("recette : qualite inconnue '{code_qualite}'"));
            continue;
        }

        // Reprise idempotente : la composition est refaite a neuf. Le trigger
        // trg_recette_verrou_plan_d refusera si la qualite est produite par le
        // plan en service — c'est voulu : on ne reecrit pas sous les pieds d'un
        // plan en cours.
        sqlx::query("DELETE FROM recette WHERE code_qualite = ?1")
            .bind(code_qualite)
            .execute(&mut *tx)
            .await?;

        let mut numero = 0i64;
        let mut vues: HashSet<(String, String)> = HashSet::new();
        for l in lignes {
            let Some(code_ref) = f_rec.txt(l, "Code Réf") else {
                continue;
            };
            if !refs_importees.contains(&code_ref) {
                ig_lig += 1;
                r.rejet(format!(
                    "composition {code_qualite} : reference absente du catalogue '{code_ref}'"
                ));
                continue;
            }
            let Some(role) = f_rec.txt(l, "Rôle BOM").as_deref().and_then(code_role) else {
                ig_lig += 1;
                r.rejet(format!(
                    "composition {code_qualite} / {code_ref} : role BOM non reconnu"
                ));
                continue;
            };
            let pct = f_rec.nombre(l, "% Composition").unwrap_or(0.0);
            if pct <= 0.0 {
                // Le classeur porte une ligne a 0 % pour les roles declares mais
                // non approvisionnes (Franges). Elle est ecartee de la
                // composition et remontee par le controle C21, qui en fait un
                // sujet visible.
                ig_lig += 1;
                continue;
            }
            if !vues.insert((role.to_string(), code_ref.clone())) {
                ig_lig += 1;
                r.avertir(format!(
                    "composition {code_qualite} : doublon {role} / {code_ref} ignore"
                ));
                continue;
            }

            numero += 1;
            sqlx::query(
                "INSERT INTO recette
                     (code_qualite, ligne_numero, code_reference, code_role, code_groupe_equiv,
                      pourcentage_composition, type_composant, couleur)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            )
            .bind(code_qualite)
            .bind(numero)
            .bind(&code_ref)
            .bind(role)
            .bind(f_rec.txt(l, "ID Groupe (opt)"))
            .bind(pct)
            .bind(f_rec.txt(l, "Type"))
            .bind(f_rec.txt(l, "Couleur"))
            .execute(&mut *tx)
            .await?;
            n_lig += 1;
        }

        if numero == 0 {
            r.rejet(format!("composition {code_qualite} : aucune ligne exploitable"));
            continue;
        }

        // Mise en service : declenche les controles R07 (somme = 100 % par role),
        // roles avec densite, et densite_kg_ml presente pour les roles en ml/m2.
        let activation = sqlx::query(
            "UPDATE qualite SET statut = 'ACTIF', date_modification = ?2,
                                id_utilisateur_modification = ?3
              WHERE code_qualite = ?1 AND statut <> 'ACTIF'",
        )
        .bind(code_qualite)
        .bind(db::maintenant())
        .bind(UTILISATEUR_IMPORT)
        .execute(&mut *tx)
        .await;

        match activation {
            Ok(_) => n_rec += 1,
            Err(e) => {
                // La qualite reste en BROUILLON : importee mais pas planifiable
                // tant que l'anomalie n'est pas corrigee.
                r.rejet(format!(
                    "qualite {code_qualite} non mise en service : {}",
                    e.to_string().lines().next().unwrap_or("erreur")
                ));
            }
        }
    }
    r.ajouter("Qualites mises en service", n_rec, 0);
    r.ajouter("  dont lignes de composition", n_lig, ig_lig);

    // ---- 7. Photo du stock initial -----------------------------------------
    let f_stock = charger_feuille(chemin, "Stock")?;
    println!("  lecture : {} ({} lignes)", f_stock.nom, f_stock.lignes.len());

    let mut a_stocker: Vec<(String, f64)> = Vec::new();
    for l in &f_stock.lignes {
        let Some(code_ref) = f_stock.txt(l, "Code Réf") else {
            continue;
        };
        let qte = f_stock.nombre(l, "Stock Init").unwrap_or(0.0);
        if qte <= 0.0 {
            continue;
        }
        if !refs_importees.contains(&code_ref) {
            r.rejet(format!("stock initial : reference inconnue '{code_ref}'"));
            continue;
        }
        a_stocker.push((code_ref, qte));
    }

    if a_stocker.is_empty() {
        r.avertir(
            "aucun stock initial non nul dans le classeur : la photo de stock n'est pas creee \
             (coherent avec les 83 ruptures et la valorisation a 0 du cahier des charges)"
                .into(),
        );
        r.ajouter("Stock initial (lignes)", 0, 0);
    } else {
        let id_mvt = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO mouvement
                 (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt,
                  code_magasin, code_motif, reference_document, id_utilisateur, est_initial)
             VALUES (?1, 'MVT-INIT-XLSX-0001', ?2, 'STOCK_INIT', 'MP-01', 'INIT',
                     'Reprise GESTION Fil.xlsx', ?3, 1)",
        )
        .bind(&id_mvt)
        .bind(DATE_PHOTO_STOCK)
        .bind(UTILISATEUR_IMPORT)
        .execute(&mut *tx)
        .await?;

        let mut n_stock = 0usize;
        for (i, (code_ref, qte)) in a_stocker.iter().enumerate() {
            // STOCK_INIT exige un prix : on prend le prix catalogue converti en
            // MAD, en le tracant comme valeur d'ouverture.
            let prix_mad: Option<f64> = sqlx::query_scalar(
                "SELECT ROUND(r.prix_catalogue_kg * COALESCE(tc.taux, 1.0), 4)
                   FROM reference r
                   LEFT JOIN taux_change tc ON tc.code_devise = r.code_devise_catalogue
                                           AND tc.date_fin IS NULL
                  WHERE r.code_reference = ?1",
            )
            .bind(code_ref)
            .fetch_optional(&mut *tx)
            .await?
            .flatten();

            let Some(prix) = prix_mad.filter(|p| *p > 0.0) else {
                r.rejet(format!("stock initial '{code_ref}' : prix indisponible"));
                continue;
            };

            sqlx::query(
                "INSERT INTO ligne_mouvement
                     (id_mouvement, ligne_numero, code_reference, quantite_kg, prix_kg_mad)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )
            .bind(&id_mvt)
            .bind((i + 1) as i64)
            .bind(code_ref)
            .bind(db::arrondi_kg(*qte))
            .bind(prix)
            .execute(&mut *tx)
            .await?;
            n_stock += 1;
        }
        r.ajouter("Stock initial (lignes)", n_stock, 0);
    }

    // ---- 8. Controle post-import -------------------------------------------
    let orphelins: Vec<(String, String)> = sqlx::query_as(
        "SELECT code_qualite, code_role FROM v_ctl_c21 ORDER BY code_role, code_qualite",
    )
    .fetch_all(&mut *tx)
    .await?;
    if !orphelins.is_empty() {
        let roles: HashSet<&str> = orphelins.iter().map(|(_, r)| r.as_str()).collect();
        let mut roles: Vec<&str> = roles.into_iter().collect();
        roles.sort();
        r.avertir(format!(
            "C21 — {} couple(s) qualite/role declarent une densite sans aucune matiere en recette \
             (roles : {}). Ces matieres sont consommees en production mais ne seront jamais \
             planifiees ni achetees tant qu'une reference du catalogue ne porte pas ce role.",
            orphelins.len(),
            roles.join(", ")
        ));
    }

    if simuler {
        tx.rollback().await?;
    } else {
        tx.commit().await?;
    }

    Ok(r)
}
