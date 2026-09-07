//! Machines : le fil pose sur les metiers, tenu au POIDS REEL.
//!
//! LA REGLE D'OR. Le poids catalogue ne sert qu'a proposer et a afficher. Le
//! stock n'enregistre que ce que la bascule ou l'operateur a constate. Elle est
//! portee ici par le TYPE avant de l'etre par une validation : `SaisiePoids`
//! n'offre que la pesee et l'estimation, il n'existe donc aucun chemin, meme par
//! erreur de programmation, pour ecrire un poids theorique sur une machine.
//!
//! LA MACHINE EST UN EMPLACEMENT DE STOCK. Chaque etage, plus la chaine et la
//! trame, possede sa ligne dans `magasin`. Ce module n'ecrit donc aucun registre
//! parallele et n'invente aucun type de mouvement : un chargement est un
//! transfert, une consommation un SORTIE_PROD, une correction un ajustement
//! d'inventaire. Tout ce que le stock sait deja faire — solde, CMUP, refus du
//! negatif, audit, inventaire — s'applique aux machines sans une ligne de plus.
//!
//! CE QUI RESTE UNE HYPOTHESE, ET QUI DOIT SE SAVOIR. L'emplacement ne suit pas
//! les bobines une par une : c'est le prix de la rapidite de saisie. Retirer
//! N bobines suppose donc qu'elles portaient le poids MOYEN de l'emplacement
//! pour ce lot. La correction d'inventaire absorbe l'ecart de cette hypothese,
//! et le controle C36 signale l'emplacement qu'on aurait oublie de compter.

use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::db::arrondi_kg;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use super::json::lignes_en_json;
use super::stock::numeroter;

// =============================================================================
// LA SAISIE DU POIDS
// =============================================================================

/// Les deux facons d'obtenir un poids reel.
///
/// IL N'Y A PAS DE TROISIEME VARIANTE, et c'est tout l'objet du module. Un
/// `Theorique` ouvrirait la porte a ce que la regle d'or interdit ; son absence
/// la ferme au niveau du type, la ou aucune relecture ne peut l'oublier.
#[derive(Deserialize, Clone, Copy)]
#[serde(tag = "mode", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SaisiePoids {
    /// MODE A, prioritaire : ce que la bascule affiche.
    Pesee { poids_total_kg: f64 },
    /// MODE B : le pourcentage moyen restant sur les bobines.
    Estimation { pourcentage_restant: f64 },
}

impl SaisiePoids {
    fn code(&self) -> &'static str {
        match self {
            SaisiePoids::Pesee { .. } => "PESEE",
            SaisiePoids::Estimation { .. } => "ESTIMATION",
        }
    }
}

#[derive(Deserialize)]
pub struct LigneGeste {
    pub code_reference: String,
    pub lot_fournisseur: String,
    pub nb_bobines: i64,
    /// Defaut : `reference.poids_bobine_kg`. Transmis par le client pour etre
    /// FIGE dans la ligne — le catalogue changera, la trace ne doit pas.
    pub poids_unitaire_theorique_kg: Option<f64>,
    pub saisie: SaisiePoids,
}

impl LigneGeste {
    /// Le calcul de la regle d'or. Trois lignes, et tout le module en depend.
    fn poids_reel_kg(&self, unitaire: f64) -> f64 {
        match self.saisie {
            SaisiePoids::Pesee { poids_total_kg } => poids_total_kg,
            SaisiePoids::Estimation { pourcentage_restant } => {
                self.nb_bobines as f64 * unitaire * pourcentage_restant / 100.0
            }
        }
    }

    fn pese(&self) -> Option<f64> {
        match self.saisie {
            SaisiePoids::Pesee { poids_total_kg } => Some(poids_total_kg),
            _ => None,
        }
    }

    fn pourcentage(&self) -> Option<f64> {
        match self.saisie {
            SaisiePoids::Estimation { pourcentage_restant } => Some(pourcentage_restant),
            _ => None,
        }
    }
}

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Motif {
    /// On charge des bobines neuves sur un emplacement vide ou partiel.
    Remplissage,
    /// On depose des bobines finies et on declare ce qui reste dessus.
    BobineTerminee,
    /// ON DEMONTE. Le cantre est vide, la machine change d'article, le fil
    /// redescend au magasin — et RIEN N'A ETE CONSOMME. La difference avec une
    /// bobine terminee n'est pas cosmetique : ici le poids declare est ce qui
    /// quitte la zone, alors qu'une bobine finie laisse derriere elle la part
    /// brulee par la production.
    Sortie,
    /// On echange des bobines epuisees contre des neuves, en un seul passage.
    Remplacage,
    /// On declare ce qui se trouve REELLEMENT sur l'emplacement, maintenant.
    Inventaire,
}

#[derive(Deserialize)]
pub struct Geste {
    pub code_machine: String,
    pub code_emplacement: String,
    pub motif: Motif,
    /// Le magasin d'ou vient la matiere, ou celui vers lequel elle repart.
    pub code_magasin_contrepartie: Option<String>,
    /// L'ordre de fabrication auquel imputer la consommation. `SORTIE_PROD`
    /// l'exige, et c'est ce qui donne un cout matiere reel par ordre.
    pub numero_of: Option<String>,
    pub date_mouvement: Option<String>,
    pub responsable: String,
    #[serde(default)]
    pub retraits: Vec<LigneGeste>,
    #[serde(default)]
    pub ajouts: Vec<LigneGeste>,
    pub notes: Option<String>,
}

// =============================================================================
// L'EMPLACEMENT, RESOLU UNE FOIS
// =============================================================================

struct Emplacement {
    code_magasin: String,
    libelle: String,
    capacite_bobines: i64,
    capacite_machine: i64,
}

async fn resoudre_emplacement(
    db: &crate::db::Db,
    code_machine: &str,
    code_emplacement: &str,
) -> AppResult<Emplacement> {
    let l = sqlx::query_as::<_, (String, String, i64, i64)>(
        "SELECT e.code_magasin, e.libelle, e.capacite_bobines, m.capacite_bobines
           FROM machine_emplacement e
           JOIN machine m ON m.code_machine = e.code_machine
          WHERE e.code_machine = $1 AND e.code_emplacement = $2
            AND e.actif = 1 AND m.actif = 1",
    )
    .bind(code_machine)
    .bind(code_emplacement)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| {
        AppError::Introuvable(format!(
            "la machine {code_machine} n a pas d emplacement actif « {code_emplacement} »"
        ))
    })?;

    Ok(Emplacement {
        code_magasin: l.0,
        libelle: l.1,
        capacite_bobines: l.2,
        capacite_machine: l.3,
    })
}

/// Le poids catalogue d'une bobine, ou le refus explicite.
///
/// Sans lui le mode Estimation n'a rien a multiplier. Le dire ici, en nommant la
/// reference, evite a l'operateur un « erreur interne » devant sa machine.
async fn poids_unitaire(
    db: &crate::db::Db,
    code_reference: &str,
    fourni: Option<f64>,
    saisie: &SaisiePoids,
) -> AppResult<Option<f64>> {
    if let Some(p) = fourni.filter(|p| *p > 0.0) {
        return Ok(Some(p));
    }
    // `::float8` obligatoire : sqlx ne sait pas decoder un NUMERIC en f64, et
    // l'oubli se paie d'une « erreur interne » a l'execution, pas a la
    // compilation.
    let p = sqlx::query_scalar::<_, Option<f64>>(
        "SELECT poids_bobine_kg::float8 FROM reference
          WHERE code_reference = $1 AND actif = 1",
    )
    .bind(code_reference)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("reference {code_reference} inactive ou inconnue")))?
    .filter(|p| *p > 0.0);

    // EN PESEE, LE POIDS CATALOGUE N'ENTRE DANS AUCUN CALCUL. Son absence prive
    // seulement du pourcentage d'ecart — une information, pas une condition. En
    // estimation, au contraire, il EST le calcul : sans lui il n'y a rien a
    // multiplier, et le refus doit dire quoi faire.
    match (p, saisie) {
        (Some(_), _) => Ok(p),
        (None, SaisiePoids::Pesee { .. }) => Ok(None),
        (None, SaisiePoids::Estimation { .. }) => Err(AppError::RegleMetier(format!(
            "la reference {code_reference} n a pas de poids par bobine au catalogue : \
             l estimation en pourcentage est impossible, pesez le lot"
        ))),
    }
}

/// Le CMUP du magasin d'ou part la marchandise.
///
/// LA VALEUR SUIT LA MARCHANDISE. `TRANSFERT_ENTREE` porte `exige_prix = 1` et
/// `impacte_cmup = 1` : sans prix, le declencheur RG-07 refuse la ligne, et le
/// stock de la machine serait valorise a zero — une machine chargee de
/// 500 000 MAD de fil disparaitrait des etats de valorisation.
///
/// Un CMUP nul signifie que la reference n'a jamais ete achetee (RG-08). On le
/// dit ici plutot que de laisser le declencheur le decouvrir : le magasinier
/// saurait qu'il y a un probleme, pas lequel.
async fn cmup(
    db: &crate::db::Db,
    code_magasin: &str,
    code_reference: &str,
) -> AppResult<f64> {
    sqlx::query_scalar::<_, Option<f64>>(
        "SELECT cmup_mad::float8 FROM stock_magasin
          WHERE code_magasin = $1 AND code_reference = $2",
    )
    .bind(code_magasin)
    .bind(code_reference)
    .fetch_optional(db)
    .await?
    .flatten()
    .ok_or_else(|| {
        AppError::RegleMetier(format!(
            "{code_reference} n a pas de cout moyen dans {code_magasin} : \
             la valeur ne peut pas suivre la marchandise"
        ))
    })
}

// =============================================================================
// LE GESTE
// =============================================================================

/// `POST /api/machines/geste` — une transaction, jusqu'a trois mouvements.
pub async fn geste(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(g): Json<Geste>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;

    // --- V1 : la machine et l'emplacement -----------------------------------
    let empl = resoudre_emplacement(&state.db, &g.code_machine, &g.code_emplacement).await?;

    // --- V5 : coherence entre le motif et ce qui est saisi ------------------
    //
    // Verifiee AVANT tout le reste : un remplacage sans depose n'est pas un
    // remplacage, et le dire tout de suite evite de calculer pour rien.
    let (attend_ajouts, attend_retraits) = match g.motif {
        Motif::Remplissage => (true, false),
        Motif::BobineTerminee => (false, true),
        Motif::Sortie => (false, true),
        Motif::Remplacage => (true, true),
        Motif::Inventaire => {
            return Err(AppError::Invalide(
                "la correction d inventaire passe par /api/machines/inventaire".into(),
            ))
        }
    };
    if attend_ajouts && g.ajouts.is_empty() {
        return Err(AppError::Invalide("aucune bobine a charger".into()));
    }
    if attend_retraits && g.retraits.is_empty() {
        return Err(AppError::Invalide("aucune bobine a deposer".into()));
    }
    if !attend_ajouts && !g.ajouts.is_empty() {
        return Err(AppError::Invalide(
            "ce motif ne charge rien : utilisez « remplacage » pour faire les deux".into(),
        ));
    }
    if !attend_retraits && !g.retraits.is_empty() {
        return Err(AppError::Invalide(
            "ce motif ne depose rien : utilisez « remplacage » pour faire les deux".into(),
        ));
    }

    let responsable = g.responsable.trim();
    if responsable.is_empty() {
        return Err(AppError::Invalide("le responsable du geste est requis".into()));
    }

    let contrepartie = g.code_magasin_contrepartie.as_deref().unwrap_or_default();
    if contrepartie.is_empty() {
        return Err(AppError::Invalide(
            "le magasin d ou vient la matiere, ou vers lequel elle repart, est requis".into(),
        ));
    }

    let mut avertissements: Vec<String> = Vec::new();
    let tolerance = tolerance_estimation(&state.db).await?;

    // ------------------------------------------------------------------
    // LES AJOUTS. On calcule tout avant d'ouvrir la transaction : un refus
    // doit porter une phrase metier, pas une violation de contrainte.
    // ------------------------------------------------------------------
    let mut ajouts = Vec::with_capacity(g.ajouts.len());
    for l in &g.ajouts {
        verifier_ligne(l)?;
        let unitaire =
            poids_unitaire(&state.db, &l.code_reference, l.poids_unitaire_theorique_kg, &l.saisie)
                .await?;
        let kg = arrondi_kg(l.poids_reel_kg(unitaire.unwrap_or(0.0)));
        if kg <= 0.0 {
            return Err(AppError::Invalide(format!(
                "le poids reel de {} est nul : un chargement doit porter de la matiere",
                l.code_reference
            )));
        }
        if let Some(a) = avertir_ecart(l, unitaire, kg, tolerance) {
            avertissements.push(a);
        }
        // Le prix vient du magasin QUI FOURNIT : c'est sa valeur qui monte sur
        // la machine, pas le prix catalogue.
        let prix = cmup(&state.db, contrepartie, &l.code_reference).await?;
        ajouts.push((l, unitaire, kg, prix));
    }

    // --- V6 : la capacite, avec un message qui donne la place restante ------
    if !ajouts.is_empty() {
        let entrantes: i64 = ajouts.iter().map(|(l, _, _, _)| l.nb_bobines).sum();
        verifier_capacite(&state.db, &empl, &g.code_machine, entrantes).await?;
    }

    // ------------------------------------------------------------------
    // LES RETRAITS. Ici se joue l'arithmetique de la depose : ce qui quitte
    // l'emplacement, ce qui revient au magasin, et ce qui a ete consomme.
    // ------------------------------------------------------------------
    let mut retraits = Vec::with_capacity(g.retraits.len());
    for l in &g.retraits {
        verifier_ligne(l)?;
        let unitaire =
            poids_unitaire(&state.db, &l.code_reference, l.poids_unitaire_theorique_kg, &l.saisie)
                .await?;

        // --- V7 : l'emplacement porte-t-il bien ce lot, en quantite ? -------
        let etat = sqlx::query_as::<_, (f64, i64)>(
            "SELECT quantite_kg::float8, nb_bobines FROM stock_lot
              WHERE code_magasin = $1 AND code_reference = $2 AND lot_fournisseur = $3",
        )
        .bind(&empl.code_magasin)
        .bind(&l.code_reference)
        .bind(&l.lot_fournisseur)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| {
            AppError::RegleMetier(format!(
                "{} ne porte pas le lot {} de {}",
                empl.libelle, l.lot_fournisseur, l.code_reference
            ))
        })?;

        if etat.1 < l.nb_bobines {
            return Err(AppError::RegleMetier(format!(
                "{} ne porte que {} bobines du lot {} : vous en deposez {}",
                empl.libelle, etat.1, l.lot_fournisseur, l.nb_bobines
            )));
        }

        // Ce que l'operateur declare : le poids REEL de ce qu'il a en main.
        let declare = arrondi_kg(l.poids_reel_kg(unitaire.unwrap_or(0.0)));

        // DEUX ARITHMETIQUES, PARCE QUE CE SONT DEUX GESTES DIFFERENTS.
        //
        // Sur une DEPOSE de bobines finies, le declare est ce qui RESTE sur les
        // bobines ; ce qui quitte la zone est ce qu'elle portait pour ces
        // bobines — N fois son poids moyen — et la difference est partie en
        // production. C'est l'hypothese assumee du module, absorbee ensuite par
        // l'inventaire.
        //
        // Sur une SORTIE, on demonte : le declare EST ce qui quitte la zone, et
        // rien n'a ete consomme. Appliquer ici la moyenne inventerait une
        // consommation qui n'a pas eu lieu.
        let (quitte, restant, consomme) = if g.motif == Motif::Sortie {
            (declare, declare, 0.0)
        } else {
            let moyenne = etat.0 / etat.1 as f64;
            let porte = arrondi_kg(l.nb_bobines as f64 * moyenne);
            if declare > porte + 0.001 {
                return Err(AppError::RegleMetier(format!(
                    "{} bobines de {} pesent {:.3} kg sur {} : elles ne peuvent pas en rendre {:.3}",
                    l.nb_bobines, l.code_reference, porte, empl.libelle, declare
                )));
            }
            (porte, declare, arrondi_kg(porte - declare))
        };

        if restant > 0.0 {
            if let Some(a) = avertir_ecart(l, unitaire, restant, tolerance) {
                avertissements.push(a);
            }
        }
        // Au retour, c'est la valeur portee par l'emplacement qui redescend.
        let prix = cmup(&state.db, &empl.code_magasin, &l.code_reference).await?;
        retraits.push((l, unitaire, quitte, restant, consomme, prix));
    }

    // La consommation exige un ordre de fabrication (type SORTIE_PROD,
    // `exige_of = 1`). Le dire ici plutot que de laisser le declencheur le
    // refuser : le magasinier saurait qu'il y a un probleme, pas lequel.
    let consomme_total: f64 = retraits.iter().map(|(_, _, _, _, c, _)| *c).sum();
    if consomme_total > 0.0 && g.numero_of.as_deref().unwrap_or_default().trim().is_empty() {
        return Err(AppError::RegleMetier(
            "la matiere consommee doit etre imputee a un ordre de fabrication".into(),
        ));
    }

    // ------------------------------------------------------------------
    // L'ECRITURE. Tout ou rien.
    // ------------------------------------------------------------------
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let date = g.date_mouvement.clone();
    // LA MARQUE DU GESTE. Les deux ou trois mouvements d'un meme geste doivent
    // pouvoir se retrouver ensemble — pour les afficher, et surtout pour les
    // annuler d'un bloc. Sans elle, il faudrait deviner lesquels allaient
    // ensemble a partir de leur horodatage, ce qui est faux des que deux
    // operateurs saisissent en meme temps.
    let marque = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let doc = format!("{} / {} #{}", g.code_machine, empl.libelle, marque);
    let mut mouvements: Vec<String> = Vec::new();

    // 1. Le chargement : la matiere quitte le magasin et monte sur la machine.
    //    Les DEUX ecritures portent le poids reel : si le magasin croyait
    //    detenir 540 kg et que la bascule en donne 528, c'est le magasin qui a
    //    tort, et la correction le revelera.
    if !ajouts.is_empty() {
        let lignes: Vec<_> = ajouts.iter().map(|(l, u, kg, p)| (*l, *u, *kg, *p)).collect();
        mouvements.push(
            ecrire_mouvement(&mut tx, &user, "TRANSFERT_SORTIE", "TRANSFERT", contrepartie,
                             &date, responsable, &doc, None, &g.notes, &lignes).await?,
        );
        mouvements.push(
            ecrire_mouvement(&mut tx, &user, "TRANSFERT_ENTREE", "TRANSFERT", &empl.code_magasin,
                             &date, responsable, &doc, None, &g.notes, &lignes).await?,
        );
    }

    // 2. La depose. Elle se scinde en deux ecritures dont la somme vaut ce qui
    //    quitte l'emplacement.
    if !retraits.is_empty() {
        // 2a. Ce qui a ete consomme par la production. AUCUN mode de pesee :
        //     ce poids n'a pas ete mesure, il a ete DEDUIT, et le journal doit
        //     pouvoir le dire.
        let conso: Vec<_> = retraits
            .iter()
            .filter(|(_, _, _, restant, c, _)| *c > 0.0 && *restant > 0.0)
            .map(|(l, u, _, _, c, p)| (*l, *u, *c, *p))
            .collect();
        // Quand rien ne revient, les bobines quittent l'emplacement AVEC la
        // consommation : sans cela leur compte ne redescendrait jamais.
        let conso_vides: Vec<_> = retraits
            .iter()
            .filter(|(_, _, _, restant, c, _)| *c > 0.0 && *restant <= 0.0)
            .map(|(l, u, _, _, c, p)| (*l, *u, *c, *p))
            .collect();

        if !conso.is_empty() || !conso_vides.is_empty() {
            mouvements.push(
                ecrire_consommation(&mut tx, &user, &empl.code_magasin, &date, responsable,
                                    &doc, g.numero_of.as_deref(), &g.notes,
                                    &conso, &conso_vides).await?,
            );
        }

        // 2b. Ce qui revient au magasin, avec ses bobines.
        let retour: Vec<_> = retraits
            .iter()
            .filter(|(_, _, _, restant, _, _)| *restant > 0.0)
            .map(|(l, u, _, restant, _, p)| (*l, *u, *restant, *p))
            .collect();
        if !retour.is_empty() {
            mouvements.push(
                ecrire_mouvement(&mut tx, &user, "TRANSFERT_SORTIE", "RETOUR_PROD",
                                 &empl.code_magasin, &date, responsable, &doc, None,
                                 &g.notes, &retour).await?,
            );
            mouvements.push(
                ecrire_mouvement(&mut tx, &user, "TRANSFERT_ENTREE", "RETOUR_PROD",
                                 contrepartie, &date, responsable, &doc, None,
                                 &g.notes, &retour).await?,
            );
        }
    }

    tx.commit().await?;

    Ok(Json(json!({
        "geste": marque,
        "mouvements": mouvements,
        "charge_kg": arrondi_kg(ajouts.iter().map(|(_, _, kg, _)| *kg).sum::<f64>()) + 0.0,
        "quitte_kg": arrondi_kg(retraits.iter().map(|(_, _, q, _, _, _)| *q).sum::<f64>()) + 0.0,
        "retour_kg": arrondi_kg(retraits.iter().map(|(_, _, _, r, _, _)| *r).sum::<f64>()) + 0.0,
        "consomme_kg": arrondi_kg(consomme_total) + 0.0,
        "avertissements": avertissements,
    })))
}

// =============================================================================
// LES VERIFICATIONS
// =============================================================================

/// V3 et V4 : ce qu'une ligne doit porter, quel que soit le sens du geste.
fn verifier_ligne(l: &LigneGeste) -> AppResult<()> {
    if l.nb_bobines <= 0 {
        return Err(AppError::Invalide(format!(
            "indiquez le nombre de bobines pour {}",
            l.code_reference
        )));
    }
    if l.lot_fournisseur.trim().is_empty() {
        return Err(AppError::Invalide(format!(
            "le lot est requis pour {} : sans lui le stock ne se suit plus",
            l.code_reference
        )));
    }
    match l.saisie {
        SaisiePoids::Pesee { poids_total_kg } if poids_total_kg < 0.0 => Err(AppError::Invalide(
            "le poids pese ne peut pas etre negatif".into(),
        )),
        SaisiePoids::Estimation { pourcentage_restant }
            if !(0.0..=100.0).contains(&pourcentage_restant) =>
        {
            Err(AppError::Invalide(
                "le pourcentage restant se situe entre 0 et 100".into(),
            ))
        }
        _ => Ok(()),
    }
}

/// V6 : la place restante, sur l'emplacement puis sur la machine entiere.
///
/// Le declencheur `trg_lmvt_capacite` refuse deja le depassement. Ce controle-ci
/// existe pour le MESSAGE : « il reste 40 places, vous en chargez 60 » se
/// comprend devant une machine, « C33 : Etage 2 plein » un peu moins.
async fn verifier_capacite(
    db: &crate::db::Db,
    empl: &Emplacement,
    code_machine: &str,
    entrantes: i64,
) -> AppResult<()> {
    let sur_place: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(nb_bobines), 0)::bigint FROM stock_lot WHERE code_magasin = $1",
    )
    .bind(&empl.code_magasin)
    .fetch_one(db)
    .await?;

    if sur_place + entrantes > empl.capacite_bobines {
        return Err(AppError::RegleMetier(format!(
            "{} plein : {} places, {} libres, vous en chargez {}",
            empl.libelle,
            empl.capacite_bobines,
            (empl.capacite_bobines - sur_place).max(0),
            entrantes
        )));
    }

    let sur_machine: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(sl.nb_bobines), 0)::bigint
           FROM stock_lot sl
           JOIN machine_emplacement e ON e.code_magasin = sl.code_magasin
          WHERE e.code_machine = $1",
    )
    .bind(code_machine)
    .fetch_one(db)
    .await?;

    if sur_machine + entrantes > empl.capacite_machine {
        return Err(AppError::RegleMetier(format!(
            "machine {} pleine : {} places au total, {} libres, vous en chargez {}",
            code_machine,
            empl.capacite_machine,
            (empl.capacite_machine - sur_machine).max(0),
            entrantes
        )));
    }
    Ok(())
}

async fn tolerance_estimation(db: &crate::db::Db) -> AppResult<f64> {
    Ok(sqlx::query_scalar::<_, Option<f64>>(
        "SELECT CAST(valeur_courante AS numeric)::float8 FROM parametre
          WHERE code_parametre = 'P_TolerEstimMachine'",
    )
    .fetch_optional(db)
    .await?
    .flatten()
    .unwrap_or(10.0))
}

/// V9 : l'avertissement, JAMAIS un refus.
///
/// Un operateur qui depose des bobines a moitie vides a raison de saisir 50 %,
/// et le bloquer l'empecherait de travailler. C'est le controle C35 qui releve
/// l'anomalie ensuite, a froid, avec le nom de celui qui a saisi.
fn avertir_ecart(l: &LigneGeste, unitaire: Option<f64>, kg: f64, tolerance: f64) -> Option<String> {
    let unitaire = unitaire?;   // sans poids catalogue, il n'y a pas d'ecart a mesurer
    l.pourcentage()?; // les pesees ne s'avertissent pas : elles constatent
    let theorique = l.nb_bobines as f64 * unitaire;
    if theorique <= 0.0 {
        return None;
    }
    let ecart = (kg - theorique) / theorique * 100.0;
    (ecart.abs() > tolerance).then(|| {
        format!(
            "{} : {:.1} % d ecart au catalogue. Pesez si la bascule est accessible.",
            l.code_reference, ecart
        )
    })
}

// =============================================================================
// L'ECRITURE DES MOUVEMENTS
// =============================================================================

type LigneEcrite<'a> = (&'a LigneGeste, Option<f64>, f64, f64);

#[allow(clippy::too_many_arguments)]
async fn ecrire_mouvement(
    tx: &mut sqlx::PgConnection,
    user: &Utilisateur,
    type_mvt: &str,
    motif: &str,
    code_magasin: &str,
    date: &Option<String>,
    responsable: &str,
    document: &str,
    numero_of: Option<&str>,
    notes: &Option<String>,
    lignes: &[LigneEcrite<'_>],
) -> AppResult<String> {
    let numero = numeroter(tx, "mouvement", "numero_mouvement", "MVT").await?;
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO mouvement
             (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt, code_magasin,
              code_motif, reference_document, numero_of, observations_globales,
              responsable, id_utilisateur)
         VALUES ($1,$2,
                 COALESCE($3, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),
                 $4,$5,$6,$7,$8,$9,$10,$11)",
    )
    .bind(&id)
    .bind(&numero)
    .bind(date.as_deref())
    .bind(type_mvt)
    .bind(code_magasin)
    .bind(motif)
    .bind(document)
    .bind(numero_of)
    .bind(notes.as_deref())
    .bind(responsable)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    for (i, (l, unitaire, kg, prix)) in lignes.iter().enumerate() {
        inserer_ligne(tx, &id, i as i64 + 1, l, *unitaire, *kg, Some(*prix),
                      Some(l.saisie.code()), Some(l.nb_bobines)).await?;
    }
    Ok(numero)
}

/// La consommation : ce qui a ete brule par la production.
///
/// `mode_pesee` reste NUL sur ces lignes, et c'est une information, pas un oubli.
/// Ce poids n'a pas ete mesure : il est la DIFFERENCE entre ce que
/// l'emplacement portait et ce que l'operateur a declare rester. Le journal doit
/// pouvoir distinguer un chiffre constate d'un chiffre deduit.
#[allow(clippy::too_many_arguments)]
async fn ecrire_consommation(
    tx: &mut sqlx::PgConnection,
    user: &Utilisateur,
    code_magasin: &str,
    date: &Option<String>,
    responsable: &str,
    document: &str,
    numero_of: Option<&str>,
    notes: &Option<String>,
    avec_retour: &[LigneEcrite<'_>],
    sans_retour: &[LigneEcrite<'_>],
) -> AppResult<String> {
    let numero = numeroter(tx, "mouvement", "numero_mouvement", "MVT").await?;
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO mouvement
             (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt, code_magasin,
              code_motif, reference_document, numero_of, observations_globales,
              responsable, id_utilisateur)
         VALUES ($1,$2,
                 COALESCE($3, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),
                 'SORTIE_PROD',$4,'PRODUCTION',$5,$6,$7,$8,$9)",
    )
    .bind(&id)
    .bind(&numero)
    .bind(date.as_deref())
    .bind(code_magasin)
    .bind(document)
    .bind(numero_of)
    .bind(notes.as_deref())
    .bind(responsable)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    let mut n = 0i64;
    // Les bobines dont il reste quelque chose repartent au magasin : ce n'est
    // pas ici qu'elles quittent l'emplacement, donc pas de compte sur ces lignes.
    for (l, unitaire, kg, _) in avec_retour {
        n += 1;
        // SORTIE_PROD ne porte pas de prix (`exige_prix = 0`) : la valeur est
        // deja sortie du stock avec les kilos.
        inserer_ligne(tx, &id, n, l, *unitaire, *kg, None, None, None).await?;
    }
    // Les tubes vides, eux, ne repartent pas : leur compte descend ici, sans
    // quoi l'emplacement resterait plein de bobines qui n'existent plus.
    for (l, unitaire, kg, _) in sans_retour {
        n += 1;
        inserer_ligne(tx, &id, n, l, *unitaire, *kg, None, None, Some(l.nb_bobines)).await?;
    }
    Ok(numero)
}

#[allow(clippy::too_many_arguments)]
async fn inserer_ligne(
    tx: &mut sqlx::PgConnection,
    id_mouvement: &str,
    numero: i64,
    l: &LigneGeste,
    unitaire: Option<f64>,
    kg: f64,
    prix: Option<f64>,
    mode: Option<&str>,
    nb_bobines: Option<i64>,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO ligne_mouvement
             (id_mouvement, ligne_numero, code_reference, quantite_kg, prix_kg_mad,
              lot_fournisseur, nb_bobines, mode_pesee, poids_unitaire_theorique_kg,
              poids_total_pese_kg, pourcentage_restant)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    )
    .bind(id_mouvement)
    .bind(numero)
    .bind(&l.code_reference)
    .bind(kg)
    .bind(prix)
    .bind(&l.lot_fournisseur)
    .bind(nb_bobines)
    .bind(mode)
    .bind(unitaire)
    // Les deux colonnes de saisie ne sont renseignees que si la ligne porte
    // effectivement le mode : sur une consommation deduite, elles resteraient
    // en contradiction avec `quantite_kg` et la contrainte les refuserait.
    .bind(mode.and_then(|_| l.pese()))
    .bind(mode.and_then(|_| l.pourcentage()))
    .execute(&mut *tx)
    .await?;
    Ok(())
}

// =============================================================================
// LA CONSULTATION
// =============================================================================

/// `GET /api/machines` — la liste, avec le taux de remplissage.
pub async fn lister(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT m.code_machine, m.nom, m.capacite_bobines, m.nb_etages, m.code_atelier,
                m.notes, m.actif,
                COALESCE(SUM(sl.nb_bobines), 0)::bigint       AS bobines_presentes,
                COALESCE(SUM(sl.quantite_kg), 0)::float8      AS quantite_kg,
                COUNT(DISTINCT e.code_emplacement)::bigint    AS nb_emplacements
           FROM machine m
           LEFT JOIN machine_emplacement e ON e.code_machine = m.code_machine
           LEFT JOIN stock_lot sl ON sl.code_magasin = e.code_magasin
          GROUP BY m.code_machine, m.nom, m.capacite_bobines, m.nb_etages,
                   m.code_atelier, m.notes, m.actif
          ORDER BY m.nom",
    )
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/machines/{code}` — le plan : les etages, puis la chaine et la trame.
///
/// L'ordre du tri porte le plan lui-meme : les etages du plus haut au plus bas,
/// comme sur la machine, puis les emplacements hors etages. L'ecran n'a pas a
/// reconstruire cette logique, et deux clients ne peuvent pas l'interpreter
/// differemment.
pub async fn plan(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT e.code_emplacement, e.code_machine, e.role, e.numero_etage, e.libelle,
                e.capacite_bobines, e.code_magasin, e.actif,
                COALESCE(SUM(sl.nb_bobines), 0)::bigint  AS bobines_presentes,
                COALESCE(SUM(sl.quantite_kg), 0)::float8 AS quantite_kg,
                COUNT(sl.id_stock_lot)::bigint           AS nb_lots
           FROM machine_emplacement e
           LEFT JOIN stock_lot sl ON sl.code_magasin = e.code_magasin AND sl.quantite_kg > 0
          WHERE e.code_machine = $1
          GROUP BY e.code_emplacement, e.code_machine, e.role, e.numero_etage,
                   e.libelle, e.capacite_bobines, e.code_magasin, e.actif
          ORDER BY CASE e.role WHEN 'ETAGE' THEN 0 WHEN 'CHAINE' THEN 1
                               WHEN 'TRAME' THEN 2 ELSE 3 END,
                   e.numero_etage DESC",
    )
    .bind(&code)
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/machines/{code}/emplacements/{empl}` — ce qui s'y trouve.
pub async fn contenu(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((code, empl)): Path<(String, String)>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let e = resoudre_emplacement(&state.db, &code, &empl).await?;

    // LA DERNIERE DECLARATION FAITE SUR CE LOT, quelle qu'elle soit : un
    // chargement ou un comptage. C'est le point de reference dont l'operateur a
    // besoin pour juger son propre chiffre — sans lui, il saisit 20 % sans
    // savoir qu'il etait a 60 %, ni depuis quand.
    //
    // DISTINCT ON garde la plus recente par couple (reference, lot) ; l'ordre
    // departage a numero egal de date, car deux gestes du meme jour arrivent
    // dans l'ordre de leur numerotation.
    let lignes = sqlx::query(
        "WITH derniere AS (
             SELECT DISTINCT ON (lm.code_reference, lm.lot_fournisseur)
                    lm.code_reference, lm.lot_fournisseur,
                    mv.date_mouvement            AS d_date,
                    mv.code_motif                AS d_motif,
                    lm.mode_pesee                AS d_mode,
                    lm.nb_bobines                AS d_bobines,
                    lm.poids_unitaire_theorique_kg::float8 AS d_poids_unitaire,
                    lm.pourcentage_restant::float8         AS d_pourcentage,
                    lm.quantite_kg::float8                 AS d_total_kg
               FROM ligne_mouvement lm
               JOIN mouvement mv ON mv.id_mouvement = lm.id_mouvement
              WHERE mv.code_magasin = $1 AND lm.mode_pesee IS NOT NULL
              ORDER BY lm.code_reference, lm.lot_fournisseur,
                       mv.date_mouvement DESC, mv.numero_mouvement DESC
         )
         SELECT sl.code_reference, r.designation, sl.lot_fournisseur,
                sl.nb_bobines,
                sl.quantite_kg::float8 AS quantite_kg,
                CASE WHEN sl.nb_bobines > 0
                     THEN (sl.quantite_kg / sl.nb_bobines)::float8 END AS poids_moyen_bobine_kg,
                r.poids_bobine_kg::float8 AS poids_catalogue_kg,
                CASE WHEN sl.nb_bobines > 0 AND r.poids_bobine_kg > 0
                     THEN ((sl.quantite_kg / sl.nb_bobines - r.poids_bobine_kg)
                           / r.poids_bobine_kg * 100.0)::float8 END AS ecart_pct,
                d.d_date, d.d_motif, d.d_mode, d.d_bobines,
                d.d_poids_unitaire, d.d_pourcentage, d.d_total_kg,
                sl.date_premiere_entree, sl.date_maj
           FROM stock_lot sl
           JOIN reference r ON r.code_reference = sl.code_reference
           LEFT JOIN derniere d ON d.code_reference = sl.code_reference
                               AND d.lot_fournisseur = sl.lot_fournisseur
          WHERE sl.code_magasin = $1 AND (sl.quantite_kg > 0 OR sl.nb_bobines > 0)
          ORDER BY r.designation, sl.lot_fournisseur",
    )
    .bind(&e.code_magasin)
    .fetch_all(&state.db)
    .await?;

    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

// =============================================================================
// LA CONFIGURATION D'UNE MACHINE
// =============================================================================

#[derive(Deserialize)]
pub struct NouvelleMachine {
    pub code_machine: String,
    pub nom: String,
    /// Capacite TOTALE, etages + chaine + trame confondus.
    pub capacite_bobines: i64,
    pub nb_etages: i64,
    /// Capacite d'un etage. Tous les etages d'une machine en ont la meme :
    /// c'est un cantre, pas une etagere de bureau.
    pub capacite_par_etage: i64,
    /// Zero signifie que la machine n'en a pas.
    #[serde(default)]
    pub nb_bobines_chaine: i64,
    #[serde(default)]
    pub nb_bobines_trame: i64,
    /// La reserve : le fil deja sorti du magasin, au pied du metier, pas encore
    /// monte. Zero signifie que la machine n'en a pas.
    #[serde(default)]
    pub nb_bobines_reserve: i64,
    pub code_atelier: Option<String>,
    pub notes: Option<String>,
}

/// `POST /api/machines` — la machine ET ses emplacements, d'un seul geste.
///
/// LA CREATION DES MAGASINS EST FAITE ICI, PAS LAISSEE A L'ADMINISTRATEUR.
/// Un emplacement sans son magasin ne peut porter aucun stock, et l'erreur ne
/// se verrait qu'au premier chargement, devant la machine. Le service garantit
/// que les deux existent ensemble ou pas du tout.
pub async fn creer_machine(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(m): Json<NouvelleMachine>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Ecrire).await?;

    let code = m.code_machine.trim().to_uppercase();
    if code.is_empty() || m.nom.trim().is_empty() {
        return Err(AppError::Invalide("le code et le nom de la machine sont requis".into()));
    }
    if m.nb_etages <= 0 || m.capacite_par_etage <= 0 || m.capacite_bobines <= 0 {
        return Err(AppError::Invalide(
            "le nombre d etages et les capacites doivent etre positifs".into(),
        ));
    }

    // La somme des emplacements ne peut pas depasser le total declare : la
    // machine serait pleine avant que ses etages le soient, et le message de
    // refus parlerait de la machine alors que l'operateur regarde un etage.
    let somme = m.nb_etages * m.capacite_par_etage
        + m.nb_bobines_chaine + m.nb_bobines_trame + m.nb_bobines_reserve;
    if somme > m.capacite_bobines {
        return Err(AppError::RegleMetier(format!(
            "les emplacements totalisent {somme} bobines pour une capacite machine de {} : \
             augmentez la capacite totale, ou reduisez les emplacements",
            m.capacite_bobines
        )));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    sqlx::query(
        "INSERT INTO machine (code_machine, nom, capacite_bobines, nb_etages,
                              code_atelier, notes, actif)
         VALUES ($1,$2,$3,$4,$5,$6,1)",
    )
    .bind(&code)
    .bind(m.nom.trim())
    .bind(m.capacite_bobines)
    .bind(m.nb_etages)
    .bind(&m.code_atelier)
    .bind(&m.notes)
    .execute(&mut *tx)
    .await?;

    // Les etages, puis la chaine et la trame. `role` ne sert qu'au plan : les
    // trois passent exactement par le meme chemin.
    let mut emplacements: Vec<(String, String, i64, i64)> = (1..=m.nb_etages)
        .map(|n| (format!("{code}-E{n}"), "ETAGE".to_string(), n, m.capacite_par_etage))
        .collect();
    if m.nb_bobines_chaine > 0 {
        emplacements.push((format!("{code}-CH"), "CHAINE".into(), 0, m.nb_bobines_chaine));
    }
    if m.nb_bobines_trame > 0 {
        emplacements.push((format!("{code}-TR"), "TRAME".into(), 0, m.nb_bobines_trame));
    }
    if m.nb_bobines_reserve > 0 {
        emplacements.push((format!("{code}-RS"), "RESERVE".into(), 0, m.nb_bobines_reserve));
    }

    for (code_empl, role, numero, capacite) in &emplacements {
        let libelle = match role.as_str() {
            "CHAINE" => format!("{} — chaine", m.nom.trim()),
            "TRAME" => format!("{} — trame", m.nom.trim()),
            "RESERVE" => format!("{} — reserve", m.nom.trim()),
            _ => format!("{} — etage {numero}", m.nom.trim()),
        };
        // Le magasin d'abord : l'emplacement le reference.
        //
        // `inclure_mrp = 1` : le fil pose sur une machine n'est pas consomme, il
        // est reel, et l'exclure du calcul ferait racheter ce qui est deja dans
        // l'atelier. C'est l'arbitrage retenu.
        sqlx::query(
            "INSERT INTO magasin (code_magasin, nom, type, responsable, inclure_mrp,
                                  est_quarantaine, actif)
             VALUES ($1,$2,'MACHINE',$3,1,0,1)",
        )
        .bind(code_empl)
        .bind(&libelle)
        .bind(&m.code_atelier)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO machine_emplacement
                 (code_emplacement, code_machine, role, numero_etage,
                  capacite_bobines, code_magasin, actif)
             VALUES ($1,$2,$3,$4,$5,$1,1)",
        )
        .bind(code_empl)
        .bind(&code)
        .bind(role)
        .bind(numero)
        .bind(capacite)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(Json(json!({
        "code_machine": code,
        "emplacements": emplacements.iter().map(|(c, r, _, _)| json!({"code": c, "role": r}))
                                    .collect::<Vec<_>>(),
    })))
}

// =============================================================================
// LA CORRECTION D'INVENTAIRE
// =============================================================================

#[derive(Deserialize)]
pub struct Inventaire {
    pub code_machine: String,
    pub code_emplacement: String,
    pub responsable: String,
    pub date_mouvement: Option<String>,
    /// CE QUI SE TROUVE REELLEMENT SUR L'EMPLACEMENT, maintenant. Un lot present
    /// au stock mais absent de cette liste est considere comme parti : c'est le
    /// sens d'un inventaire, et l'omettre serait la facon la plus courante de
    /// laisser un manquant en place.
    pub etat: Vec<LigneGeste>,
    /// L'ordre de fabrication auquel imputer ce que la machine a consomme.
    pub numero_of: Option<String>,
    /// UNE BAISSE EST-ELLE UNE CONSOMMATION ? Oui par defaut, et c'est le cas
    /// normal : la machine a tisse. On peut la declarer autrement — une casse,
    /// un vol, une erreur de chargement anterieure — et elle redevient alors un
    /// ajustement d'inventaire, qui ne charge aucun ordre de fabrication.
    #[serde(default = "vrai")]
    pub ecart_est_consommation: bool,
    pub notes: Option<String>,
}

fn vrai() -> bool {
    true
}

/// `POST /api/machines/inventaire` — l'operateur declare, le systeme calcule l'ecart.
///
/// C'est ce geste qui absorbe l'hypothese du poids moyen : sans lui, l'ecart
/// s'installe et personne ne le voit. Il est donc de premier rang, pas une
/// reparation honteuse — et le responsable en est nomme.
pub async fn inventaire(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(inv): Json<Inventaire>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::INVENTAIRE, Action::Ecrire).await?;

    let empl = resoudre_emplacement(&state.db, &inv.code_machine, &inv.code_emplacement).await?;
    let responsable = inv.responsable.trim();
    if responsable.is_empty() {
        return Err(AppError::Invalide(
            "l inventaire doit nommer son responsable : c est ce qui le rend opposable".into(),
        ));
    }

    // --- Ce que la base croit ------------------------------------------------
    let actuel = sqlx::query_as::<_, (String, String, f64, i64)>(
        "SELECT code_reference, lot_fournisseur, quantite_kg::float8, nb_bobines
           FROM stock_lot
          WHERE code_magasin = $1 AND (quantite_kg > 0 OR nb_bobines > 0)",
    )
    .bind(&empl.code_magasin)
    .fetch_all(&state.db)
    .await?;

    // --- Ce que l'operateur constate ----------------------------------------
    let mut declare: std::collections::HashMap<(String, String), (f64, i64, f64)> =
        std::collections::HashMap::new();
    for l in &inv.etat {
        verifier_ligne(l)?;
        let unitaire =
            poids_unitaire(&state.db, &l.code_reference, l.poids_unitaire_theorique_kg, &l.saisie)
                .await?;
        let kg = arrondi_kg(l.poids_reel_kg(unitaire.unwrap_or(0.0)));
        declare.insert(
            (l.code_reference.clone(), l.lot_fournisseur.clone()),
            (kg, l.nb_bobines, unitaire.unwrap_or(0.0)),
        );
    }

    // --- L'ecart, dans les deux sens ----------------------------------------
    let mut hausses: Vec<(String, String, f64, i64)> = Vec::new();
    let mut baisses: Vec<(String, String, f64, i64)> = Vec::new();
    let mut avertissements: Vec<String> = Vec::new();

    let mut vus = std::collections::HashSet::new();
    for (reference, lot, kg_actuel, bob_actuel) in &actuel {
        let cle = (reference.clone(), lot.clone());
        vus.insert(cle.clone());
        let (kg_cible, bob_cible) = declare.get(&cle).map(|(k, b, _)| (*k, *b)).unwrap_or((0.0, 0));
        pousser_ecart(reference, lot, kg_cible - kg_actuel, bob_cible - bob_actuel,
                      &mut hausses, &mut baisses, &mut avertissements);
    }
    for ((reference, lot), (kg, bob, _)) in &declare {
        if !vus.contains(&(reference.clone(), lot.clone())) {
            pousser_ecart(reference, lot, *kg, *bob, &mut hausses, &mut baisses, &mut avertissements);
        }
    }

    // SORTIE_PROD exige un ordre de fabrication. Le dire ici plutot que de
    // laisser le declencheur le refuser : l'operateur saurait qu'il y a un
    // probleme, pas lequel.
    if !baisses.is_empty()
        && inv.ecart_est_consommation
        && inv.numero_of.as_deref().unwrap_or_default().trim().is_empty()
    {
        return Err(AppError::RegleMetier(
            "la matiere consommee par la machine doit etre imputee a un ordre de \
             fabrication — ou l ecart doit etre declare comme ajustement".into(),
        ));
    }

    if hausses.is_empty() && baisses.is_empty() {
        return Ok(Json(json!({
            "mouvements": [],
            "ecart": "aucun",
            "avertissements": avertissements,
        })));
    }

    // --- L'ecriture ----------------------------------------------------------
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let doc = format!("Inventaire {} / {}", inv.code_machine, empl.libelle);
    let mut mouvements = Vec::new();

    // Une hausse est toujours un ajustement : rien n'explique une apparition.
    if !hausses.is_empty() {
        mouvements.push(
            ecrire_ajustement(&mut tx, &user, "AJUST_INV_POS", "INVENTAIRE", Some("R6"),
                              &empl.code_magasin, &inv.date_mouvement, responsable, &doc,
                              None, &inv.notes, &hausses).await?,
        );
    }

    // Une baisse est ce que la machine a consomme — sauf declaration contraire.
    if !baisses.is_empty() {
        let (type_mvt, motif, motif_ligne, ordre) = if inv.ecart_est_consommation {
            ("SORTIE_PROD", "PRODUCTION", None, inv.numero_of.as_deref())
        } else {
            ("AJUST_INV_NEG", "INVENTAIRE", Some("R6"), None)
        };
        mouvements.push(
            ecrire_ajustement(&mut tx, &user, type_mvt, motif, motif_ligne,
                              &empl.code_magasin, &inv.date_mouvement, responsable, &doc,
                              ordre, &inv.notes, &baisses).await?,
        );
    }

    // La date d'inventaire, sans quoi le controle C36 signalerait pour toujours
    // un emplacement qu'on vient de compter.
    sqlx::query(
        "UPDATE stock_magasin
            SET date_dernier_inventaire = to_char(now() AT TIME ZONE 'UTC',
                                                  'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
          WHERE code_magasin = $1",
    )
    .bind(&empl.code_magasin)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    let consomme: f64 = if inv.ecart_est_consommation {
        baisses.iter().map(|(_, _, kg, _)| *kg).sum()
    } else {
        0.0
    };
    Ok(Json(json!({
        "mouvements": mouvements,
        "hausses": hausses.len(),
        "baisses": baisses.len(),
        "consomme_kg": arrondi_kg(consomme) + 0.0,
        "avertissements": avertissements,
    })))
}

/// Range un ecart du bon cote, ou explique pourquoi il n'est pas ecrivable.
///
/// LE CAS QUI NE PASSE PAS : un compte de bobines qui change alors que le poids
/// ne bouge pas. Une ligne de mouvement exige `quantite_kg > 0` — un ajustement
/// de zero kilo n'existe pas dans le grand livre, et en inventer un serait
/// ecrire un mouvement qui n'a pas eu lieu. On le signale plutot que de le
/// maquiller : l'operateur repese, et l'ecart devient exprimable.
fn pousser_ecart(
    reference: &str,
    lot: &str,
    delta_kg: f64,
    delta_bob: i64,
    hausses: &mut Vec<(String, String, f64, i64)>,
    baisses: &mut Vec<(String, String, f64, i64)>,
    avertissements: &mut Vec<String>,
) {
    let kg = arrondi_kg(delta_kg);
    if kg.abs() < 0.001 {
        if delta_bob != 0 {
            avertissements.push(format!(
                "{reference} / {lot} : {delta_bob:+} bobines pour un poids inchange. \
                 Le compte n a pas ete corrige — repesez le lot."
            ));
        }
        return;
    }
    if kg > 0.0 {
        hausses.push((reference.into(), lot.into(), kg, delta_bob.max(0)));
    } else {
        baisses.push((reference.into(), lot.into(), -kg, (-delta_bob).max(0)));
    }
}

#[allow(clippy::too_many_arguments)]
async fn ecrire_ajustement(
    tx: &mut sqlx::PgConnection,
    user: &Utilisateur,
    type_mvt: &str,
    motif: &str,
    motif_ligne: Option<&str>,
    code_magasin: &str,
    date: &Option<String>,
    responsable: &str,
    document: &str,
    numero_of: Option<&str>,
    notes: &Option<String>,
    lignes: &[(String, String, f64, i64)],
) -> AppResult<String> {
    let numero = numeroter(tx, "mouvement", "numero_mouvement", "MVT").await?;
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO mouvement
             (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt, code_magasin,
              code_motif, reference_document, numero_of, observations_globales,
              responsable, id_utilisateur)
         VALUES ($1,$2,
                 COALESCE($3, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),
                 $4,$5,$6,$7,$8,$9,$10,$11)",
    )
    .bind(&id)
    .bind(&numero)
    .bind(date.as_deref())
    .bind(type_mvt)
    .bind(code_magasin)
    .bind(motif)
    .bind(document)
    .bind(numero_of)
    .bind(notes.as_deref())
    .bind(responsable)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    for (i, (reference, lot, kg, bob)) in lignes.iter().enumerate() {
        // `R6 — Ecart d'inventaire` sur les ajustements, qui portent
        // `exige_motif_ligne = 1`. Une sortie de production n'en veut pas : ce
        // n'est pas un ecart, c'est de la matiere tissee.
        sqlx::query(
            "INSERT INTO ligne_mouvement
                 (id_mouvement, ligne_numero, code_reference, quantite_kg,
                  lot_fournisseur, nb_bobines, code_motif_ligne, numero_of)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        )
        .bind(&id)
        .bind(i as i64 + 1)
        .bind(reference)
        .bind(kg)
        .bind(lot)
        .bind((*bob > 0).then_some(*bob))
        .bind(motif_ligne)
        .bind(numero_of)
        .execute(&mut *tx)
        .await?;
    }
    Ok(numero)
}


// =============================================================================
// ANNULER UN GESTE
// =============================================================================

/// `POST /api/machines/geste/{marque}/annuler`
///
/// LE GRAND LIVRE EST IMMUABLE (R03) : on ne corrige pas un mouvement valide,
/// on en ecrit le contraire. C'est la seule facon honnete — la trace de
/// l'erreur reste, et celle de sa correction aussi. Un magasinier qui s'est
/// trompe de lot ou a tape 264 au lieu de 246 annule, puis ressaisit.
///
/// L'ANNULATION EST DATEE DU JOUR, pas du geste d'origine. Antidater une
/// correction ferait mentir les etats deja imprimes ; ce qui compte est qu'on
/// sache quand l'erreur a ete vue.
pub async fn annuler_geste(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(marque): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;

    let details = sqlx::query_as::<_, (String, String, String, f64, Option<f64>, Option<i64>, Option<String>)>(
        "SELECT mv.code_type_mvt, mv.code_magasin, lm.code_reference,
                lm.quantite_kg::float8, lm.prix_kg_mad::float8, lm.nb_bobines, lm.lot_fournisseur
           FROM mouvement mv
           JOIN ligne_mouvement lm ON lm.id_mouvement = mv.id_mouvement
          WHERE mv.reference_document LIKE $1
          ORDER BY mv.numero_mouvement DESC, lm.ligne_numero DESC",
    )
    .bind(format!("%#{marque}"))
    .fetch_all(&state.db)
    .await?;

    if details.is_empty() {
        return Err(AppError::Introuvable(format!(
            "aucun geste portant la marque {marque}"
        )));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let doc = format!("Annulation #{marque}");
    let mut ecrits = Vec::new();

    // ORDRE INVERSE. Un chargement a d'abord vide le magasin puis rempli la
    // machine ; l'annuler dans le meme ordre viderait la machine avant de
    // l'avoir remplie sur une zone deja consommee. On defait dans l'ordre ou
    // l'on a fait, a l'envers.
    for (type_mvt, magasin, reference, kg, prix, bobines, lot) in details {
        // Le miroir : ce qui est entre sort, ce qui est sorti entre.
        let inverse = match type_mvt.as_str() {
            "TRANSFERT_ENTREE" => "TRANSFERT_SORTIE",
            "TRANSFERT_SORTIE" => "TRANSFERT_ENTREE",
            "SORTIE_PROD" => "AJUST_INV_POS",
            "AJUST_INV_POS" => "AJUST_INV_NEG",
            "AJUST_INV_NEG" => "AJUST_INV_POS",
            autre => {
                return Err(AppError::RegleMetier(format!(
                    "le type {autre} ne sait pas s annuler automatiquement"
                )))
            }
        };
        let motif = if inverse.starts_with("AJUST") { "INVENTAIRE" } else { "TRANSFERT" };
        let motif_ligne = if inverse.starts_with("AJUST") { Some("R5") } else { None };

        let numero = numeroter(&mut tx, "mouvement", "numero_mouvement", "MVT").await?;
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO mouvement
                 (id_mouvement, numero_mouvement, code_type_mvt, code_magasin, code_motif,
                  reference_document, observations_globales, responsable, id_utilisateur)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(&id)
        .bind(&numero)
        .bind(inverse)
        .bind(&magasin)
        .bind(motif)
        .bind(&doc)
        .bind(format!("Annulation du geste {marque}"))
        .bind(&user.login)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO ligne_mouvement
                 (id_mouvement, ligne_numero, code_reference, quantite_kg, prix_kg_mad,
                  lot_fournisseur, nb_bobines, code_motif_ligne)
             VALUES ($1,1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(&id)
        .bind(&reference)
        .bind(kg)
        // Le prix ne suit que la ou le type l'exige, comme a l'aller.
        .bind(if inverse == "TRANSFERT_ENTREE" { prix } else { None })
        .bind(&lot)
        .bind(bobines)
        .bind(motif_ligne)
        .execute(&mut *tx)
        .await?;

        ecrits.push(numero);
    }

    tx.commit().await?;
    Ok(Json(json!({ "annule": marque, "mouvements": ecrits })))
}
