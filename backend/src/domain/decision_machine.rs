//! Les operations machine sont des DECISIONS (modele valide le 05/10/2026).
//!
//!     etat precedent valide -> constat et decision par ligne Reference + Lot
//!     -> validation -> etat resultant
//!
//! Rien n'est saisi « apres » : l'etat resultant est le RESULTAT de la decision.
//!
//! * CHARGEMENT : a charger, poids retenu (nominal propose), % de TOUTE la ligne
//!   apres. Le fil sort du magasin au CMUP du moment, fige sur la decision.
//! * DECHARGEMENT : a retirer, % des bobines retirees (pas de pesee),
//!   destination (magasin, perte, dechet, casse), % des restantes. Retirer
//!   toutes les bobines vide la ligne dans la meme decision.
//! * CONSTAT (MAJ) : nb present, % ou poids.
//!
//! L'ECART de chaque ligne — kg avant + charges - retires - apres — est
//! qualifie par la MATRICE des motifs (`machine_motif`). Un ecart negatif est
//! toujours une regularisation.
//!
//! RETIRER UNE DECISION (annulation, devalidation) revient au dernier etat
//! valide qui la precedait, seulement si elle n'a servi de base a aucune autre.
//! Cote magasin, une ecriture d'annulation ADMINISTRATIVE est rattachee au
//! mouvement d'origine, a sa valeur d'origine : jamais un faux mouvement
//! physique. Une chaine d'erreurs ne se reconstruit pas : constat « Correction »,
//! correction de stock, nouveau chargement.

use crate::auth::Utilisateur;
use crate::db::arrondi_kg;
use crate::error::{AppError, AppResult};
use crate::routes::stock::numeroter;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;

/// Une ligne telle que l'utilisateur l'a saisie sur la fiche.
#[derive(Clone)]
pub struct Saisie {
    pub reference: String,
    pub lot: String,
    pub nb_mouvementees: i64,
    pub poids_retenu: Option<f64>,
    pub pct_retirees: Option<f64>,
    pub destination: Option<String>,
    pub pourcentage: Option<f64>,
    pub nb_present: i64,
    pub code_motif: Option<String>,
    pub motif_texte: Option<String>,
    pub effet_ecart: Option<String>,
}

/// L'etat d'une ligne de l'etage.
#[derive(Clone, Serialize)]
pub struct EtatLigne {
    pub code_reference: String,
    pub lot_fournisseur: String,
    pub nb_bobines: i64,
    pub poids_unitaire_kg: Option<f64>,
    pub pourcentage: Option<f64>,
    pub kg: f64,
}

/// Une ligne calculee : ce que la decision fera, et ce qui sera fige.
#[derive(Clone, Serialize)]
pub struct Calculee {
    pub ligne_numero: i64,
    pub code_reference: String,
    pub lot_fournisseur: String,
    pub poids_nominal_kg: f64,
    pub nb_avant: i64,
    pub kg_avant: f64,
    pub nb_mouvementees: i64,
    pub poids_retenu_kg: Option<f64>,
    pub pct_retirees: Option<f64>,
    pub kg_mouvementes: f64,
    pub destination: Option<String>,
    pub nb_apres: i64,
    pub pourcentage_apres: Option<f64>,
    pub kg_apres: f64,
    /// Le % que la ligne aurait apres l'operation si rien n'avait ete consomme
    /// ni constate : ce que l'ecran montre a cote du % declare.
    pub pourcentage_theorique: Option<f64>,
    pub ecart_kg: f64,
    pub effet_ecart: String,
    pub code_motif: String,
    pub motif_texte: Option<String>,
    #[serde(skip)]
    pub lot_force: bool,
    #[serde(skip)]
    pub motif_lot_force: Option<String>,
}

#[derive(Serialize)]
pub struct Calcul {
    pub lignes: Vec<Calculee>,
    pub avant: Vec<EtatLigne>,
    pub apres: Vec<EtatLigne>,
    pub capacite: i64,
    pub bobines_apres: i64,
    /// Ce qui bloque la validation, dit en clair. Vide : la decision passe.
    pub blocages: Vec<String>,
}

/// La fiche, telle que le calcul en a besoin.
pub struct FicheDecision {
    pub id_fiche: String,
    pub numero: String,
    pub type_fiche: String,
    pub code_machine: String,
    pub code_emplacement: String,
    pub code_magasin: Option<String>,
    pub date_fiche: String,
    pub numero_of: Option<String>,
    pub responsable: String,
    pub nb_validations: i64,
}

fn cle(r: &str, l: &str) -> String {
    format!("{r}\u{1}{l}")
}

/// L'ecart que produit a lui seul l'arrondi d'un % saisi au centieme : la
/// moitie d'un centieme de pourcent de la ligne.
fn tolerance_arrondi(nb: i64, nominal: f64) -> f64 {
    nb.max(0) as f64 * nominal * 0.00005 + 0.0005
}

fn pct_moyen(kg: f64, nb: i64, nominal: f64) -> Option<f64> {
    if nb > 0 && nominal > 0.0 {
        Some(((kg / (nb as f64 * nominal)) * 10000.0).round() / 100.0)
    } else {
        None
    }
}

pub async fn etat_etage(c: &mut sqlx::PgConnection, zone: &str) -> AppResult<Vec<EtatLigne>> {
    let l = sqlx::query_as::<_, (String, String, i64, Option<f64>, Option<f64>, f64)>(
        "SELECT code_reference, lot_fournisseur, nb_bobines, poids_unitaire_kg::float8,
                pourcentage::float8, kg::float8
           FROM machine_etat WHERE code_emplacement = $1
          ORDER BY code_reference, lot_fournisseur",
    )
    .bind(zone)
    .fetch_all(&mut *c)
    .await?;
    Ok(l.into_iter()
        .map(|t| EtatLigne {
            code_reference: t.0,
            lot_fournisseur: t.1,
            nb_bobines: t.2,
            poids_unitaire_kg: t.3,
            pourcentage: t.4,
            kg: t.5,
        })
        .collect())
}

struct Motif {
    type_fiche: String,
    libelle: String,
    destinations: Vec<String>,
    effet_defaut: Option<String>,
    effets_permis: Vec<String>,
}

async fn motifs(c: &mut sqlx::PgConnection) -> AppResult<HashMap<String, Motif>> {
    let l = sqlx::query_as::<_, (String, String, String, Vec<String>, Option<String>, Vec<String>)>(
        "SELECT code_motif, type_fiche, libelle, destinations, effet_defaut, effets_permis
           FROM machine_motif WHERE actif = 1",
    )
    .fetch_all(&mut *c)
    .await?;
    Ok(l.into_iter()
        .map(|t| {
            (t.0, Motif { type_fiche: t.1, libelle: t.2, destinations: t.3, effet_defaut: t.4, effets_permis: t.5 })
        })
        .collect())
}

/// LE CALCUL D'UNE DECISION, sans rien ecrire. Sert a l'apercu ET a la
/// validation : l'ecran montre exactement ce qui sera enregistre.
/// `privilegie` : l'administrateur ou le directeur, seuls admis a rendre au
/// magasin plus de kilos que la ligne n'en portait (correction de leur fait).
pub async fn calculer(
    c: &mut sqlx::PgConnection,
    f: &FicheDecision,
    saisies: &[Saisie],
    capacite: i64,
    privilegie: bool,
) -> AppResult<Calcul> {
    let avant = etat_etage(c, &f.code_emplacement).await?;
    let par_cle: HashMap<String, EtatLigne> =
        avant.iter().map(|e| (cle(&e.code_reference, &e.lot_fournisseur), e.clone())).collect();
    let motifs = motifs(c).await?;
    let mut blocages = Vec::new();
    let mut lignes = Vec::new();
    let mut vues = std::collections::HashSet::new();

    if saisies.is_empty() {
        blocages.push("la fiche ne porte aucune ligne".into());
    }

    for (i, s) in saisies.iter().enumerate() {
        let lib = format!("{} (lot {})", s.reference, s.lot);
        if !vues.insert(cle(&s.reference, &s.lot)) {
            blocages.push(format!("{lib} figure deux fois sur la fiche : une seule ligne par reference et lot"));
            continue;
        }
        let e = par_cle.get(&cle(&s.reference, &s.lot));
        let nb_avant = e.map(|e| e.nb_bobines).unwrap_or(0);
        let kg_avant = e.map(|e| e.kg).unwrap_or(0.0);
        // LE POIDS NOMINAL EST CELUI DE L'ETAGE (06/10/2026). Le catalogue est
        // reecrit a chaque reception par le suivi du conditionnement : le relire
        // ici ferait naitre un ecart sur une ligne que personne n'a touchee. Il
        // ne sert que pour une ligne qui arrive sur l'etage.
        let nominal_etage = e.and_then(|e| e.poids_unitaire_kg).filter(|p| *p > 0.0);
        let nominal: Option<f64> = match nominal_etage {
            Some(p) => Some(p),
            None => sqlx::query_scalar::<_, Option<f64>>(
                "SELECT poids_bobine_kg::float8 FROM reference WHERE code_reference = $1",
            )
            .bind(&s.reference)
            .fetch_optional(&mut *c)
            .await?
            .flatten()
            .filter(|p| *p > 0.0),
        };
        let Some(nominal) = nominal else {
            blocages.push(format!("{lib} : la reference n'a pas de poids nominal de bobine au catalogue"));
            continue;
        };

        // LE MOTIF : obligatoire, et du bon type de fiche.
        let Some(code_motif) = s.code_motif.clone().filter(|m| !m.trim().is_empty()) else {
            blocages.push(format!("{lib} : le motif est obligatoire"));
            continue;
        };
        let Some(motif) = motifs.get(&code_motif) else {
            blocages.push(format!("{lib} : motif inconnu ({code_motif})"));
            continue;
        };
        if motif.type_fiche != f.type_fiche {
            blocages.push(format!("{lib} : le motif « {} » ne s'emploie pas sur ce type de fiche", motif.libelle));
            continue;
        }

        let mut calc = Calculee {
            ligne_numero: i as i64 + 1,
            code_reference: s.reference.clone(),
            lot_fournisseur: s.lot.clone(),
            poids_nominal_kg: nominal,
            nb_avant,
            kg_avant,
            nb_mouvementees: 0,
            poids_retenu_kg: None,
            pct_retirees: None,
            kg_mouvementes: 0.0,
            destination: None,
            nb_apres: nb_avant,
            pourcentage_apres: None,
            kg_apres: kg_avant,
            pourcentage_theorique: None,
            ecart_kg: 0.0,
            effet_ecart: "AUCUN".into(),
            code_motif: code_motif.clone(),
            motif_texte: s.motif_texte.clone().filter(|t| !t.trim().is_empty()),
            // PAS DE FORCAGE DE LOT SUR UNE FICHE MACHINE (06/10/2026) : un lot
            // que le magasin ne couvre pas bloque, comme un stock insuffisant.
            lot_force: false,
            motif_lot_force: None,
        };

        match f.type_fiche.as_str() {
            "CHARGE" => {
                let n = s.nb_mouvementees;
                if n <= 0 {
                    blocages.push(format!("{lib} : indiquez combien de bobines sont chargees"));
                    continue;
                }
                let Some(pct) = s.pourcentage else {
                    blocages.push(format!("{lib} : indiquez le % de toute la ligne apres le chargement"));
                    continue;
                };
                let poids = s.poids_retenu.filter(|p| *p > 0.0).unwrap_or(nominal);
                calc.nb_mouvementees = n;
                calc.poids_retenu_kg = Some(poids);
                calc.kg_mouvementes = arrondi_kg(n as f64 * poids);
                calc.nb_apres = nb_avant + n;
                calc.pourcentage_apres = Some(pct);
                calc.kg_apres = arrondi_kg(calc.nb_apres as f64 * nominal * pct / 100.0);
                calc.pourcentage_theorique = pct_moyen(kg_avant + calc.kg_mouvementes, calc.nb_apres, nominal);
                calc.ecart_kg = arrondi_kg(kg_avant + calc.kg_mouvementes - calc.kg_apres);
            }
            "DECHARGE" => {
                let n = s.nb_mouvementees;
                if n <= 0 {
                    blocages.push(format!("{lib} : indiquez combien de bobines sont retirees"));
                    continue;
                }
                if n > nb_avant {
                    blocages.push(format!(
                        "{lib} : {n} bobines a retirer, la ligne n'en porte que {nb_avant}"
                    ));
                    continue;
                }
                let Some(pct_ret) = s.pct_retirees else {
                    blocages.push(format!("{lib} : indiquez le % des bobines retirees"));
                    continue;
                };
                // La destination : celle saisie, ou la seule que le motif admet.
                let dest = s.destination.clone().filter(|d| !d.is_empty()).or_else(|| {
                    (motif.destinations.len() == 1).then(|| motif.destinations[0].clone())
                });
                let Some(dest) = dest else {
                    blocages.push(format!("{lib} : choisissez la destination des bobines retirees"));
                    continue;
                };
                if !motif.destinations.contains(&dest) {
                    blocages.push(format!(
                        "{lib} : le motif « {} » n'envoie pas les bobines vers {}",
                        motif.libelle,
                        dest.to_lowercase()
                    ));
                    continue;
                }
                calc.nb_mouvementees = n;
                calc.pct_retirees = Some(pct_ret);
                calc.kg_mouvementes = arrondi_kg(n as f64 * nominal * pct_ret / 100.0);
                // ON NE RETIRE PAS PLUS QUE LA LIGNE NE PORTAIT (06/10/2026) : le
                // surplus serait du fil cree au magasin. Seuls l'administrateur et
                // le directeur passent outre, pour corriger une derive connue.
                let plafond = kg_avant + tolerance_arrondi(nb_avant, nominal);
                if calc.kg_mouvementes > plafond && !privilegie {
                    blocages.push(format!(
                        "{lib} : {} kg retires, la ligne n'en porte que {} kg. Verifiez le % des bobines retirees ; si l'etage est faux, l'administrateur ou le directeur corrige",
                        calc.kg_mouvementes,
                        arrondi_kg(kg_avant)
                    ));
                    continue;
                }
                calc.destination = Some(dest);
                calc.nb_apres = nb_avant - n;
                if calc.nb_apres == 0 {
                    // TOUT EST RETIRE : la ligne disparait dans la meme decision.
                    calc.pourcentage_apres = None;
                    calc.kg_apres = 0.0;
                } else {
                    let Some(pct) = s.pourcentage else {
                        blocages.push(format!("{lib} : indiquez le % des bobines qui restent"));
                        continue;
                    };
                    calc.pourcentage_apres = Some(pct);
                    calc.kg_apres = arrondi_kg(calc.nb_apres as f64 * nominal * pct / 100.0);
                }
                calc.pourcentage_theorique =
                    pct_moyen((kg_avant - calc.kg_mouvementes).max(0.0), calc.nb_apres, nominal);
                calc.ecart_kg = arrondi_kg(kg_avant - calc.kg_mouvementes - calc.kg_apres);
            }
            _ => {
                // CONSTAT : nb present, et % ou poids.
                let n = s.nb_present;
                if n < 0 {
                    blocages.push(format!("{lib} : le nombre present ne peut pas etre negatif"));
                    continue;
                }
                calc.nb_apres = n;
                if n == 0 {
                    calc.kg_apres = 0.0;
                } else if let Some(p) = s.poids_retenu.filter(|p| *p > 0.0) {
                    calc.poids_retenu_kg = Some(p);
                    calc.kg_apres = arrondi_kg(n as f64 * p);
                    calc.pourcentage_apres = pct_moyen(calc.kg_apres, n, nominal);
                } else if let Some(pct) = s.pourcentage {
                    calc.pourcentage_apres = Some(pct);
                    calc.kg_apres = arrondi_kg(n as f64 * nominal * pct / 100.0);
                } else {
                    blocages.push(format!("{lib} : indiquez le % restant ou le poids par bobine"));
                    continue;
                }
                calc.pourcentage_theorique = pct_moyen(kg_avant, n, nominal);
                calc.ecart_kg = arrondi_kg(kg_avant - calc.kg_apres);
            }
        }

        // L'ARRONDI DU % N'EST PAS UN ECART (06/10/2026). Le % se saisit au
        // centieme : sur 1 444 bobines de 2,5 kg, un centieme vaut 0,36 kg. Un
        // ecart plus petit que l'arrondi est nul, et l'etage garde ses kilos.
        if calc.nb_apres > 0 && calc.ecart_kg.abs() <= tolerance_arrondi(calc.nb_apres, nominal) {
            calc.kg_apres = arrondi_kg(calc.kg_apres + calc.ecart_kg);
            calc.ecart_kg = 0.0;
        } else if calc.nb_apres == 0
            && f.type_fiche == "DECHARGE"
            && calc.ecart_kg.abs() <= tolerance_arrondi(nb_avant, nominal)
        {
            // TOUT RETIRER AU % AFFICHE (arrondi au centieme) rendait quelques
            // grammes de plus ou de moins que la ligne n'en portait : on rend
            // exactement ce qu'elle portait.
            calc.kg_mouvementes = arrondi_kg(calc.kg_mouvementes + calc.ecart_kg);
            calc.ecart_kg = 0.0;
        }

        // L'EFFET DE L'ECART, selon la matrice.
        calc.effet_ecart = if calc.ecart_kg.abs() < 0.0005 {
            "AUCUN".into()
        } else if calc.ecart_kg < 0.0 {
            "REGULARISATION".into()
        } else if let Some(d) = &motif.effet_defaut {
            d.clone()
        } else {
            match s.effet_ecart.clone().filter(|e| motif.effets_permis.contains(e)) {
                Some(e) => e,
                None => {
                    blocages.push(format!(
                        "{lib} : pour le motif « {} », dites ce que compte l'ecart de {} kg ({})",
                        motif.libelle,
                        calc.ecart_kg,
                        motif.effets_permis.join(", ").to_lowercase()
                    ));
                    continue;
                }
            }
        };
        lignes.push(calc);
    }

    // L'ETAT RESULTANT : les lignes non touchees restent telles quelles.
    let mut apres: HashMap<String, EtatLigne> = par_cle.clone();
    for l in &lignes {
        let k = cle(&l.code_reference, &l.lot_fournisseur);
        if l.nb_apres == 0 {
            apres.remove(&k);
        } else {
            apres.insert(
                k,
                EtatLigne {
                    code_reference: l.code_reference.clone(),
                    lot_fournisseur: l.lot_fournisseur.clone(),
                    nb_bobines: l.nb_apres,
                    poids_unitaire_kg: Some(l.poids_nominal_kg),
                    pourcentage: pct_moyen(l.kg_apres, l.nb_apres, l.poids_nominal_kg),
                    kg: l.kg_apres,
                },
            );
        }
    }
    let mut apres: Vec<EtatLigne> = apres.into_values().collect();
    apres.sort_by(|a, b| (&a.code_reference, &a.lot_fournisseur).cmp(&(&b.code_reference, &b.lot_fournisseur)));
    let bobines_apres: i64 = apres.iter().map(|e| e.nb_bobines).sum();
    // LA CAPACITE EST UNE LIMITE HAUTE : des places libres sont permises.
    if bobines_apres > capacite {
        blocages.push(format!(
            "l'etage porterait {bobines_apres} bobines pour {capacite} places : depassement de {}",
            bobines_apres - capacite
        ));
    }
    Ok(Calcul { lignes, avant, apres, capacite, bobines_apres, blocages })
}

/// LE STOCK NE DEVIENT JAMAIS NEGATIF. Un chargement que le magasin ne couvre
/// pas est BLOQUE : le magasinier previent le directeur ou l'administrateur,
/// qui font et valident la correction de stock (05/10/2026).
pub async fn controler_stock(
    c: &mut sqlx::PgConnection,
    magasin: &str,
    calc: &Calcul,
) -> AppResult<Vec<String>> {
    let mut besoin: HashMap<String, f64> = HashMap::new();
    for l in &calc.lignes {
        *besoin.entry(l.code_reference.clone()).or_default() += l.kg_mouvementes;
    }
    let mut manques = Vec::new();
    for (reference, kg) in besoin {
        let stock: f64 = sqlx::query_scalar(
            "SELECT COALESCE((SELECT quantite_kg::float8 FROM stock_magasin
                               WHERE code_reference = $1 AND code_magasin = $2), 0)",
        )
        .bind(&reference)
        .bind(magasin)
        .fetch_one(&mut *c)
        .await?;
        let manque = arrondi_kg(kg - stock);
        if manque > 0.0005 {
            manques.push(format!(
                "{reference} : {} kg a charger, {} kg en stock au magasin {magasin}, il manque {manque} kg",
                arrondi_kg(kg),
                arrondi_kg(stock)
            ));
        }
    }
    Ok(manques)
}

/// CE QUE LA BASE REFUSERAIT A L'ECRITURE DES MOUVEMENTS, dit avant : date
/// future, magasin absent, lot bloque par la qualite, lot que le magasin ne
/// couvre pas (06/10/2026). L'apercu les montre ; la validation les rejoue.
pub async fn controles_complementaires(
    c: &mut sqlx::PgConnection,
    f: &FicheDecision,
    calc: &Calcul,
) -> AppResult<Vec<String>> {
    let mut refus = Vec::new();
    let futur: bool = sqlx::query_scalar(
        "SELECT $1::text > to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')",
    )
    .bind(&f.date_fiche)
    .fetch_one(&mut *c)
    .await?;
    if futur {
        refus.push(format!("la fiche est datee du {} : une decision ne se date pas dans le futur", &f.date_fiche[..f.date_fiche.len().min(10)]));
    }
    let magasin = f.code_magasin.clone().unwrap_or_default();
    if f.type_fiche != "MAJ" && magasin.is_empty() {
        refus.push("le magasin est requis pour un chargement ou un dechargement".into());
        return Ok(refus);
    }

    // Les lignes qui ecriront un mouvement de magasin, et leurs kilos par lot.
    let mut par_lot: HashMap<(String, String), f64> = HashMap::new();
    for l in &calc.lignes {
        let ecrit = match f.type_fiche.as_str() {
            "CHARGE" => l.kg_mouvementes > 0.0,
            "DECHARGE" => l.destination.as_deref() == Some("MAGASIN") && l.kg_mouvementes > 0.0,
            _ => false,
        };
        if ecrit {
            *par_lot.entry((l.code_reference.clone(), l.lot_fournisseur.clone())).or_default() += l.kg_mouvementes;
        }
    }
    let mut cles: Vec<_> = par_lot.keys().cloned().collect();
    cles.sort();
    for (reference, lot) in cles {
        let statut: Option<String> = sqlx::query_scalar(
            "SELECT statut FROM lot WHERE code_reference = $1 AND lot_fournisseur = $2",
        )
        .bind(&reference)
        .bind(&lot)
        .fetch_optional(&mut *c)
        .await?;
        if statut.as_deref() == Some("BLOQUE") {
            refus.push(format!(
                "LOT-BLOQUE : le lot {lot} de {reference} est bloque par la qualite ; seul le responsable qualite peut le debloquer"
            ));
            continue;
        }
        if f.type_fiche == "CHARGE" {
            let kg = par_lot[&(reference.clone(), lot.clone())];
            let solde: f64 = sqlx::query_scalar(
                "SELECT COALESCE((SELECT quantite_kg::float8 FROM stock_lot
                                   WHERE code_reference = $1 AND lot_fournisseur = $2
                                     AND code_magasin = $3), 0)",
            )
            .bind(&reference)
            .bind(&lot)
            .bind(&magasin)
            .fetch_one(&mut *c)
            .await?;
            if kg > solde + 0.0001 {
                refus.push(format!(
                    "LOT-INSUFFISANT : {reference}, lot {lot} : {} kg a charger, {} kg de ce lot au magasin {magasin}. Prevenez le directeur ou l'administrateur : la correction du stock du lot se fait et se valide par eux avant ce chargement",
                    arrondi_kg(kg),
                    arrondi_kg(solde)
                ));
            }
        }
    }
    Ok(refus)
}

async fn cmup(c: &mut sqlx::PgConnection, magasin: &str, reference: &str) -> AppResult<Option<f64>> {
    if let Some(Some(p)) = sqlx::query_scalar::<_, Option<f64>>(
        "SELECT cmup_mad::float8 FROM stock_magasin WHERE code_magasin = $1 AND code_reference = $2",
    )
    .bind(magasin)
    .bind(reference)
    .fetch_optional(&mut *c)
    .await?
    {
        return Ok(Some(p));
    }
    Ok(sqlx::query_scalar::<_, Option<f64>>("SELECT cmup_mad::float8 FROM reference WHERE code_reference = $1")
        .bind(reference)
        .fetch_optional(&mut *c)
        .await?
        .flatten())
}

async fn tete(c: &mut sqlx::PgConnection, zone: &str) -> AppResult<Option<String>> {
    Ok(sqlx::query_scalar("SELECT id_decision FROM machine_decision WHERE code_emplacement = $1 AND est_tete = 1")
        .bind(zone)
        .fetch_optional(&mut *c)
        .await?)
}

async fn ecrire_etats(
    c: &mut sqlx::PgConnection,
    id_decision: &str,
    moment: &str,
    etats: &[EtatLigne],
) -> AppResult<()> {
    for e in etats {
        sqlx::query(
            "INSERT INTO machine_decision_etat
                 (id_decision, moment, code_reference, lot_fournisseur, nb_bobines,
                  poids_unitaire_kg, pourcentage, kg)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        )
        .bind(id_decision)
        .bind(moment)
        .bind(&e.code_reference)
        .bind(&e.lot_fournisseur)
        .bind(e.nb_bobines)
        .bind(e.poids_unitaire_kg)
        .bind(e.pourcentage)
        .bind(arrondi_kg(e.kg))
        .execute(&mut *c)
        .await?;
    }
    Ok(())
}

/// L'etat de l'etage remplace par `etats`, ligne a ligne.
async fn poser_etage(
    c: &mut sqlx::PgConnection,
    user: &Utilisateur,
    zone: &str,
    etats: &[EtatLigne],
    date: &str,
    responsable: &str,
    id_fiche: Option<&str>,
) -> AppResult<()> {
    sqlx::query("DELETE FROM machine_etat WHERE code_emplacement = $1")
        .bind(zone)
        .execute(&mut *c)
        .await?;
    for e in etats {
        sqlx::query(
            "INSERT INTO machine_etat
                 (code_emplacement, code_reference, lot_fournisseur, nb_bobines, poids_unitaire_kg,
                  pourcentage, kg, mode_constat, date_constat, responsable, id_utilisateur, id_fiche)
             VALUES ($1,$2,$3,$4,$5,COALESCE($6,0),$7,'ESTIMATION',$8,$9,$10,$11)",
        )
        .bind(zone)
        .bind(&e.code_reference)
        .bind(&e.lot_fournisseur)
        .bind(e.nb_bobines)
        .bind(e.poids_unitaire_kg)
        .bind(e.pourcentage.map(|p| p.min(500.0)))
        .bind(arrondi_kg(e.kg))
        .bind(date)
        .bind(responsable)
        .bind(&user.id)
        .bind(id_fiche)
        .execute(&mut *c)
        .await?;
    }
    Ok(())
}

async fn journal(
    c: &mut sqlx::PgConnection,
    user: &Utilisateur,
    id_fiche: Option<&str>,
    id_decision: Option<&str>,
    evenement: &str,
    zone: &str,
    motif: Option<&str>,
    detail: Value,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO machine_fiche_journal
             (id_fiche, id_decision, evenement, code_emplacement, motif, id_utilisateur, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(id_fiche)
    .bind(id_decision)
    .bind(evenement)
    .bind(zone)
    .bind(motif)
    .bind(&user.id)
    .bind(detail)
    .execute(&mut *c)
    .await?;
    Ok(())
}

/// Le mouvement de magasin d'une decision. Renvoie (id, numero).
#[allow(clippy::too_many_arguments)]
async fn ecrire_mouvement(
    c: &mut sqlx::PgConnection,
    user: &Utilisateur,
    f: &FicheDecision,
    id_decision: &str,
    type_mvt: &str,
    magasin: &str,
    lignes: &[(&Calculee, Option<f64>)],
) -> AppResult<(String, String)> {
    let numero = numeroter(c, "mouvement", "numero_mouvement", "MVT").await?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO mouvement
             (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt, code_magasin, code_motif,
              reference_document, numero_of, responsable, id_utilisateur, id_decision_machine)
         VALUES ($1,$2,$3,$4,$5,'MACHINE',$6,$7,$8,$9,$10)",
    )
    .bind(&id)
    .bind(&numero)
    .bind(&f.date_fiche)
    .bind(type_mvt)
    .bind(magasin)
    .bind(&f.numero)
    .bind(&f.numero_of)
    .bind(&f.responsable)
    .bind(&user.id)
    .bind(id_decision)
    .execute(&mut *c)
    .await?;
    for (i, (l, prix)) in lignes.iter().enumerate() {
        sqlx::query(
            "INSERT INTO ligne_mouvement
                 (id_mouvement, ligne_numero, code_reference, quantite_kg, prix_kg_mad,
                  lot_fournisseur, nb_bobines, lot_force, motif_lot_force)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(&id)
        .bind(i as i64 + 1)
        .bind(&l.code_reference)
        .bind(l.kg_mouvementes)
        .bind(prix)
        .bind(&l.lot_fournisseur)
        .bind(l.nb_mouvementees)
        .bind(i32::from(l.lot_force))
        .bind(l.motif_lot_force.as_deref())
        .execute(&mut *c)
        .await?;
    }
    Ok((id, numero))
}

/// VALIDER : la decision est prise. La fiche et l'etage sont deja verrouilles.
pub async fn valider(
    c: &mut sqlx::PgConnection,
    user: &Utilisateur,
    f: &FicheDecision,
    saisies: &[Saisie],
    capacite: i64,
) -> AppResult<Value> {
    let privilegie = matches!(user.role.as_str(), "ADMIN" | "DIRECTION");
    let calc = calculer(c, f, saisies, capacite, privilegie).await?;
    if !calc.blocages.is_empty() {
        return Err(AppError::RegleMetier(calc.blocages.join(" ; ")));
    }
    let magasin = f.code_magasin.clone().unwrap_or_default();
    if f.type_fiche == "CHARGE" {
        let manques = controler_stock(c, &magasin, &calc).await?;
        if !manques.is_empty() {
            return Err(AppError::RegleMetier(format!(
                "STOCK-INSUFFISANT : chargement bloque — {}. Prevenez le directeur ou \
                 l'administrateur : la correction de stock doit etre faite et validee par \
                 eux avant le chargement.",
                manques.join(" ; ")
            )));
        }
    }

    let refus = controles_complementaires(c, f, &calc).await?;
    if !refus.is_empty() {
        return Err(AppError::RegleMetier(refus.join(" ; ")));
    }

    // LA DECISION, chainee a la tete de l'etage.
    let precedente = tete(c, &f.code_emplacement).await?;
    if let Some(p) = &precedente {
        sqlx::query("UPDATE machine_decision SET est_tete = 0 WHERE id_decision = $1")
            .bind(p)
            .execute(&mut *c)
            .await?;
    }
    let numero_validation = f.nb_validations + 1;
    let id_decision: String = sqlx::query_scalar(
        "INSERT INTO machine_decision
             (id_fiche, numero_validation, nature, code_machine, code_emplacement, code_magasin,
              id_decision_precedente, statut, est_tete, id_utilisateur, responsable)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',1,$8,$9)
         RETURNING id_decision",
    )
    .bind(&f.id_fiche)
    .bind(numero_validation)
    .bind(&f.type_fiche)
    .bind(&f.code_machine)
    .bind(&f.code_emplacement)
    .bind(f.code_magasin.as_deref().filter(|m| !m.is_empty()))
    .bind(&precedente)
    .bind(&user.id)
    .bind(&f.responsable)
    .fetch_one(&mut *c)
    .await?;
    ecrire_etats(c, &id_decision, "AVANT", &calc.avant).await?;
    ecrire_etats(c, &id_decision, "APRES", &calc.apres).await?;

    // LE MAGASIN : la sortie au CMUP fige, ou le retour quand la destination
    // est le magasin. Perte, dechet, casse : aucun mouvement, le fil etait deja
    // sorti du magasin au chargement.
    let mut prix: HashMap<String, Option<f64>> = HashMap::new();
    for l in &calc.lignes {
        if !prix.contains_key(&l.code_reference) && !magasin.is_empty() {
            let p = cmup(c, &magasin, &l.code_reference).await?;
            prix.insert(l.code_reference.clone(), p);
        }
    }
    let mut id_mvt: HashMap<i64, String> = HashMap::new();
    let mut numero_mvt: Option<String> = None;
    let a_mouvementer: Vec<(&Calculee, Option<f64>)> = calc
        .lignes
        .iter()
        .filter(|l| match f.type_fiche.as_str() {
            "CHARGE" => l.kg_mouvementes > 0.0,
            "DECHARGE" => l.destination.as_deref() == Some("MAGASIN") && l.kg_mouvementes > 0.0,
            _ => false,
        })
        .map(|l| (l, prix.get(&l.code_reference).cloned().flatten()))
        .collect();
    if !a_mouvementer.is_empty() {
        let type_mvt = if f.type_fiche == "CHARGE" { "CHARGE_MACHINE" } else { "RETOUR_MACHINE" };
        let (id, numero) = ecrire_mouvement(c, user, f, &id_decision, type_mvt, &magasin, &a_mouvementer).await?;
        for (l, _) in &a_mouvementer {
            id_mvt.insert(l.ligne_numero, id.clone());
        }
        numero_mvt = Some(numero);
    }

    for l in &calc.lignes {
        sqlx::query(
            "INSERT INTO machine_decision_ligne
                 (id_decision, ligne_numero, code_reference, lot_fournisseur, poids_nominal_kg,
                  nb_avant, kg_avant, nb_mouvementees, poids_retenu_kg, pct_retirees, kg_mouvementes,
                  destination, nb_apres, pourcentage_apres, kg_apres, ecart_kg, effet_ecart,
                  code_motif, motif_texte, cmup_mad, id_mouvement, pourcentage_theorique)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
                     round($22::numeric, 2))",
        )
        .bind(&id_decision)
        .bind(l.ligne_numero)
        .bind(&l.code_reference)
        .bind(&l.lot_fournisseur)
        .bind(l.poids_nominal_kg)
        .bind(l.nb_avant)
        .bind(l.kg_avant)
        .bind(l.nb_mouvementees)
        .bind(l.poids_retenu_kg)
        .bind(l.pct_retirees)
        .bind(l.kg_mouvementes)
        .bind(&l.destination)
        .bind(l.nb_apres)
        .bind(l.pourcentage_apres)
        .bind(l.kg_apres)
        .bind(l.ecart_kg)
        .bind(&l.effet_ecart)
        .bind(&l.code_motif)
        .bind(&l.motif_texte)
        .bind(prix.get(&l.code_reference).cloned().flatten())
        .bind(id_mvt.get(&l.ligne_numero))
        .bind(l.pourcentage_theorique)
        .execute(&mut *c)
        .await?;
    }

    poser_etage(c, user, &f.code_emplacement, &calc.apres, &f.date_fiche, &f.responsable, Some(&f.id_fiche))
        .await?;

    let passee = sqlx::query(
        "UPDATE machine_fiche
            SET statut = 'VALIDE', id_utilisateur_validation = $2, nb_validations = $3,
                date_validation = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
          WHERE id_fiche = $1 AND statut = 'BROUILLON'",
    )
    .bind(&f.id_fiche)
    .bind(&user.id)
    .bind(numero_validation)
    .execute(&mut *c)
    .await?
    .rows_affected();
    if passee != 1 {
        return Err(AppError::RegleMetier(format!(
            "la fiche {} n'est plus un brouillon : rien n'a ete enregistre",
            f.numero
        )));
    }

    let consomme: f64 = calc.lignes.iter().filter(|l| l.effet_ecart == "CONSOMMATION").map(|l| l.ecart_kg).sum();
    journal(
        c,
        user,
        Some(&f.id_fiche),
        Some(&id_decision),
        "VALIDATION",
        &f.code_emplacement,
        None,
        json!({ "numero_validation": numero_validation, "mouvement": numero_mvt,
                "consommation_kg": arrondi_kg(consomme), "lignes": calc.lignes.len() }),
    )
    .await?;

    Ok(json!({
        "id_fiche": f.id_fiche,
        "numero_fiche": f.numero,
        "statut": "VALIDE",
        "id_decision": id_decision,
        "numero_validation": numero_validation,
        "mouvement": numero_mvt,
        // + 0.0 : un « -0 » n'a rien a faire a l'ecran.
        "consomme_kg": arrondi_kg(consomme) + 0.0,
    }))
}

#[derive(Clone, Copy, PartialEq)]
pub enum Retrait {
    Annulation,
    Devalidation,
}

/// RETIRER UNE DECISION ISOLEE : retour au dernier etat valide qui la
/// precedait. La fiche et l'etage sont deja verrouilles.
pub async fn retirer(
    c: &mut sqlx::PgConnection,
    user: &Utilisateur,
    f: &FicheDecision,
    mode: Retrait,
    motif: &str,
) -> AppResult<Value> {
    let action = if mode == Retrait::Annulation { "annulee" } else { "devalidee" };
    let decision: Option<(String, i64, String, Option<String>, String, Option<String>)> = sqlx::query_as(
        "SELECT id_decision, est_tete, date_decision, id_utilisateur, nature, id_decision_precedente
           FROM machine_decision
          WHERE id_fiche = $1 AND statut = 'ACTIVE'
          ORDER BY numero_validation DESC LIMIT 1",
    )
    .bind(&f.id_fiche)
    .fetch_optional(&mut *c)
    .await?;
    let Some((id_decision, est_tete, date_decision, auteur, _, precedente)) = decision else {
        return Err(AppError::RegleMetier(format!(
            "la fiche {} a ete validee avant le modele de decisions (05/10/2026) : elle ne \
             peut pas etre {action}. Pour corriger l'etage, faites un constat avec le motif \
             « Correction ».",
            f.numero
        )));
    };

    // 1. ELLE N'A SERVI DE BASE A AUCUNE AUTRE DECISION.
    if est_tete != 1 {
        let suivante: Option<(Option<String>, String)> = sqlx::query_as(
            "SELECT f.numero_fiche, d.date_decision
               FROM machine_decision d LEFT JOIN machine_fiche f ON f.id_fiche = d.id_fiche
              WHERE d.code_emplacement = $1 AND d.statut = 'ACTIVE' AND d.date_decision > $2
              ORDER BY d.date_decision LIMIT 1",
        )
        .bind(&f.code_emplacement)
        .bind(&date_decision)
        .fetch_optional(&mut *c)
        .await?;
        let qui = suivante
            .map(|(n, d)| format!("la fiche {} du {}", n.unwrap_or_else(|| "?".into()), d.replace('T', " ").get(..16).unwrap_or("").to_string()))
            .unwrap_or_else(|| "une decision ulterieure".into());
        return Err(AppError::RegleMetier(format!(
            "cette decision a servi de base a {qui} : elle ne se retire pas seule. Procedure : \
             correction de stock si besoin, constat avec le motif « Correction », puis nouveau \
             chargement correct."
        )));
    }

    // 2. LES DROITS : l'auteur le jour meme, sinon ADMIN ou DIRECTION.
    if motif.trim().chars().count() < 5 {
        return Err(AppError::Invalide("le motif doit dire pourquoi (5 caracteres au moins)".into()));
    }
    let meme_jour: bool = sqlx::query_scalar(
        "SELECT (($1::timestamptz) AT TIME ZONE 'Africa/Casablanca')::date
              = (now() AT TIME ZONE 'Africa/Casablanca')::date",
    )
    .bind(&date_decision)
    .fetch_one(&mut *c)
    .await?;
    let responsable = matches!(user.role.as_str(), "ADMIN" | "DIRECTION");
    let auteur_du_jour = auteur.as_deref() == Some(user.id.as_str()) && meme_jour;
    if !responsable && !auteur_du_jour {
        return Err(AppError::RegleMetier(
            "seul l'auteur de la validation, le jour meme, ou un administrateur ou un directeur \
             peut retirer cette decision"
                .into(),
        ));
    }

    // 3. L'ETAGE N'A PAS DERIVE DEPUIS.
    let resultat: Vec<(String, String, i64, f64)> = sqlx::query_as(
        "SELECT code_reference, lot_fournisseur, nb_bobines, kg::float8
           FROM machine_decision_etat WHERE id_decision = $1 AND moment = 'APRES'
          ORDER BY 1, 2",
    )
    .bind(&id_decision)
    .fetch_all(&mut *c)
    .await?;
    let courant = etat_etage(c, &f.code_emplacement).await?;
    let identique = resultat.len() == courant.len()
        && resultat.iter().zip(courant.iter()).all(|(a, b)| {
            a.0 == b.code_reference && a.1 == b.lot_fournisseur && a.2 == b.nb_bobines && (a.3 - b.kg).abs() < 0.001
        });
    if !identique {
        return Err(AppError::RegleMetier(
            "l'etage ne correspond plus a l'etat issu de cette decision : elle ne se retire pas \
             seule. Procedure : constat avec le motif « Correction »."
                .into(),
        ));
    }

    // 4. LE FIL RENDU AU MAGASIN Y EST TOUJOURS.
    let retours: Vec<(String, String, f64, String)> = sqlx::query_as(
        "SELECT l.code_reference, l.lot_fournisseur, l.kg_mouvementes::float8, m.code_magasin
           FROM machine_decision_ligne l JOIN mouvement m ON m.id_mouvement = l.id_mouvement
          WHERE l.id_decision = $1 AND l.destination = 'MAGASIN'",
    )
    .bind(&id_decision)
    .fetch_all(&mut *c)
    .await?;
    for (reference, lot, kg, magasin) in &retours {
        let reste: f64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(quantite_kg), 0)::float8 FROM stock_lot
              WHERE code_reference = $1 AND lot_fournisseur = $2 AND code_magasin = $3",
        )
        .bind(reference)
        .bind(lot)
        .bind(magasin)
        .fetch_one(&mut *c)
        .await?;
        if reste + 0.0005 < *kg {
            return Err(AppError::RegleMetier(format!(
                "le fil rendu au magasin {magasin} a deja ete utilise ({reference}, lot {lot} : \
                 {kg} kg rendus, {reste} kg restent) : la decision ne se retire pas seule. \
                 Procedure : correction de stock, constat avec le motif « Correction »."
            )));
        }
    }

    // 5. L'ETAGE REVIENT A L'ETAT AVANT.
    let avant: Vec<EtatLigne> = sqlx::query_as::<_, (String, String, i64, Option<f64>, Option<f64>, f64)>(
        "SELECT code_reference, lot_fournisseur, nb_bobines, poids_unitaire_kg::float8,
                pourcentage::float8, kg::float8
           FROM machine_decision_etat WHERE id_decision = $1 AND moment = 'AVANT'",
    )
    .bind(&id_decision)
    .fetch_all(&mut *c)
    .await?
    .into_iter()
    .map(|t| EtatLigne {
        code_reference: t.0,
        lot_fournisseur: t.1,
        nb_bobines: t.2,
        poids_unitaire_kg: t.3,
        pourcentage: t.4,
        kg: t.5,
    })
    .collect();
    poser_etage(
        c,
        user,
        &f.code_emplacement,
        &avant,
        &crate::db::aujourdhui(),
        &format!("retour avant la fiche {}", f.numero),
        None,
    )
    .await?;

    // 6. L'ANNULATION ADMINISTRATIVE des mouvements de la decision.
    let mouvements: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT m.id_mouvement, m.numero_mouvement, m.code_type_mvt, m.code_magasin
           FROM mouvement m
          WHERE m.id_decision_machine = $1
            AND m.code_type_mvt IN ('CHARGE_MACHINE', 'RETOUR_MACHINE')
            AND NOT EXISTS (SELECT 1 FROM mouvement x WHERE x.id_mouvement_contrepasse = m.id_mouvement)",
    )
    .bind(&id_decision)
    .fetch_all(&mut *c)
    .await?;
    let mut annulations = Vec::new();
    for (id_origine, numero_origine, type_origine, magasin) in mouvements {
        let type_annul =
            if type_origine == "CHARGE_MACHINE" { "ANNUL_CHARGE_MACHINE" } else { "ANNUL_RETOUR_MACHINE" };
        let numero = numeroter(c, "mouvement", "numero_mouvement", "MVT").await?;
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO mouvement
                 (id_mouvement, numero_mouvement, code_type_mvt, code_magasin, code_motif,
                  reference_document, observations_globales, responsable, id_utilisateur,
                  id_mouvement_contrepasse, motif_contrepassation, id_decision_machine)
             VALUES ($1,$2,$3,$4,'CONTREPASSATION',$5,$6,$7,$8,$9,$10,$11)",
        )
        .bind(&id)
        .bind(&numero)
        .bind(type_annul)
        .bind(&magasin)
        .bind(&f.numero)
        .bind(format!("Annulation administrative de {numero_origine} (fiche {} {action})", f.numero))
        .bind(&f.responsable)
        .bind(&user.id)
        .bind(&id_origine)
        .bind(motif.trim())
        .bind(&id_decision)
        .execute(&mut *c)
        .await?;
        // Les memes lignes, a la VALEUR D'ORIGINE (le CMUP fige au chargement).
        let lignes: Vec<(i64, String, f64, Option<f64>, Option<String>, Option<i64>)> = sqlx::query_as(
            "SELECT ligne_numero, code_reference, quantite_kg::float8, prix_kg_mad::float8,
                    lot_fournisseur, nb_bobines
               FROM ligne_mouvement WHERE id_mouvement = $1 ORDER BY ligne_numero",
        )
        .bind(&id_origine)
        .fetch_all(&mut *c)
        .await?;
        for (n, reference, kg, prix_origine, lot, bobines) in lignes {
            let prix = if type_annul == "ANNUL_CHARGE_MACHINE" {
                match prix_origine {
                    Some(p) => Some(p),
                    None => cmup(c, &magasin, &reference).await?,
                }
            } else {
                None
            };
            sqlx::query(
                "INSERT INTO ligne_mouvement
                     (id_mouvement, ligne_numero, code_reference, quantite_kg, prix_kg_mad,
                      lot_fournisseur, nb_bobines)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)",
            )
            .bind(&id)
            .bind(n)
            .bind(&reference)
            .bind(kg)
            .bind(prix)
            .bind(&lot)
            .bind(bobines)
            .execute(&mut *c)
            .await?;
        }
        annulations.push(numero);
    }

    // 7. LA DECISION SORT DE L'ETAT COURANT ; LA PRECEDENTE REDEVIENT LA TETE.
    sqlx::query(
        "UPDATE machine_decision
            SET statut = $2, est_tete = 0, motif_retrait = $3, id_utilisateur_retrait = $4,
                date_retrait = to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
          WHERE id_decision = $1",
    )
    .bind(&id_decision)
    .bind(if mode == Retrait::Annulation { "ANNULEE" } else { "RETIREE" })
    .bind(motif.trim())
    .bind(&user.id)
    .execute(&mut *c)
    .await?;
    if let Some(p) = &precedente {
        sqlx::query("UPDATE machine_decision SET est_tete = 1 WHERE id_decision = $1")
            .bind(p)
            .execute(&mut *c)
            .await?;
    }

    // 8. LA FICHE.
    if mode == Retrait::Annulation {
        sqlx::query(
            "UPDATE machine_fiche
                SET statut = 'ANNULE', motif_annulation = $2,
                    date_annulation = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
              WHERE id_fiche = $1 AND statut = 'VALIDE'",
        )
        .bind(&f.id_fiche)
        .bind(motif.trim())
        .execute(&mut *c)
        .await?;
    } else {
        sqlx::query(
            "UPDATE machine_fiche
                SET statut = 'BROUILLON', id_utilisateur_validation = NULL, date_validation = NULL
              WHERE id_fiche = $1 AND statut = 'VALIDE'",
        )
        .bind(&f.id_fiche)
        .execute(&mut *c)
        .await?;
    }
    journal(
        c,
        user,
        Some(&f.id_fiche),
        Some(&id_decision),
        if mode == Retrait::Annulation { "ANNULATION" } else { "DEVALIDATION" },
        &f.code_emplacement,
        Some(motif.trim()),
        json!({ "annulations": annulations }),
    )
    .await?;

    Ok(json!({
        "id_fiche": f.id_fiche,
        "statut": if mode == Retrait::Annulation { "ANNULE" } else { "BROUILLON" },
        "annulations": annulations,
    }))
}

/// Un changement d'etage d'une fiche devalidee laisse sa trace au journal.
pub async fn journal_changement_etage(
    c: &mut sqlx::PgConnection,
    user: &Utilisateur,
    id_fiche: &str,
    ancien: &str,
    nouveau: &str,
) -> AppResult<()> {
    journal(c, user, Some(id_fiche), None, "CHANGEMENT_ETAGE", nouveau, None, json!({ "ancien": ancien, "nouveau": nouveau }))
        .await
}
