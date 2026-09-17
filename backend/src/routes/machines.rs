//! Machines : le stock se compte, la consommation se journalise.
//!
//! LE MODELE, EN QUATRE PHRASES.
//!
//! 1. LE STOCK D'UNE MACHINE SE COMPTE. Il ne se deduit pas d'un grand livre :
//!    l'operateur constate, par reference et par lot, un nombre de bobines et
//!    un pourcentage de fil restant. Le poids en decoule. C'est un inventaire
//!    permanent, pas un solde.
//!
//! 2. LE JOURNAL DES MOUVEMENTS NE PORTE QUE LES DEPLACEMENTS, et seulement du
//!    cote magasin : `CHARGE_MACHINE` quand le fil part, `RETOUR_MACHINE` quand
//!    il revient. Aucune contre-ecriture cote machine — elle n'est pas un
//!    magasin, c'est un compte constate.
//!
//! 3. LA CONSOMMATION EST LE RESIDU, et elle a son propre journal :
//!
//!        consommation = etat precedent + charge - retourne - etat constate
//!
//!    Personne ne la saisit. Elle apparait quand l'operateur declare ou en est
//!    sa zone : c'est pourquoi un chargement REVELE une consommation sans la
//!    causer. Faute de compteur au metier, le constat est la seule mesure.
//!
//! 4. STOCK GLOBAL = soldes magasins + cliches machines. Une palette envoyee
//!    sort du magasin et entre dans le compte de la machine ; le total ne bouge
//!    pas. Seul le fil tisse le fait baisser.
//!
//! UNE FICHE, TROIS ETATS. Brouillon, valide, annule. Tant qu'elle est en
//! brouillon elle ne touche a rien : le magasinier la corrige comme un papier.
//! C'est la validation qui ecrit, en tout ou rien.

use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::db::arrondi_kg;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

use super::json::lignes_en_json;
use super::stock::numeroter;

// =============================================================================
// LES FORMES RECUES
// =============================================================================

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TypeFiche {
    /// Magasin vers machine. Debite le magasin.
    Charge,
    /// Machine vers magasin. Credite le magasin.
    Decharge,
    /// Constat pur : seul le pourcentage change. Aucun magasin touche.
    Maj,
    /// Casse, chute, perte — ce qui n'est pas du tissage.
    Conso,
}

impl TypeFiche {
    fn code(self) -> &'static str {
        match self {
            TypeFiche::Charge => "CHARGE",
            TypeFiche::Decharge => "DECHARGE",
            TypeFiche::Maj => "MAJ",
            TypeFiche::Conso => "CONSO",
        }
    }
    fn touche_magasin(self) -> bool {
        matches!(self, TypeFiche::Charge | TypeFiche::Decharge)
    }
}

#[derive(Deserialize)]
pub struct LigneFiche {
    pub code_reference: String,
    pub lot_fournisseur: String,
    /// Ce qui monte sur la machine ou en descend. NE SERT QU'A DEBITER OU
    /// CREDITER LE MAGASIN — jamais a faire l'etat.
    #[serde(default)]
    pub nb_bobines_mouvementees: Option<i64>,
    #[serde(default)]
    pub kg_mouvementes: Option<f64>,
    #[serde(default)]
    pub nb_palettes: Option<i64>,
    /// CE QUE LA ZONE PORTE DE CETTE REFERENCE APRES. C'est lui qui fait
    /// l'etat, avec le pourcentage. Les deux comptes ne se reconcilient pas :
    /// charger 200 bobines sur un etage qui en porte 300 en laisse 300.
    pub nb_bobines_presentes: i64,
    pub poids_unitaire_kg: Option<f64>,
    pub pourcentage: Option<f64>,
    pub total_kg: f64,
    #[serde(default = "estimation")]
    pub mode_constat: String,
    pub notes: Option<String>,
}

fn estimation() -> String {
    "ESTIMATION".into()
}

#[derive(Deserialize)]
pub struct NouvelleFiche {
    pub type_fiche: TypeFiche,
    pub code_machine: String,
    pub code_emplacement: String,
    pub date_fiche: Option<String>,
    pub code_magasin: Option<String>,
    pub nb_bobines_etage: Option<i64>,
    pub nb_palettes: Option<i64>,
    pub numero_of: Option<String>,
    pub responsable: String,
    pub observations: Option<String>,
    #[serde(default)]
    pub lignes: Vec<LigneFiche>,
}

#[derive(Deserialize)]
pub struct Filtre {
    pub code_machine: Option<String>,
    pub statut: Option<String>,
    /// Les bornes de periode. Absentes, le cumul court depuis l'origine
    /// jusqu'a l'etat courant.
    pub debut: Option<String>,
    pub fin: Option<String>,
    pub limite: Option<i64>,
}

#[derive(Deserialize)]
pub struct Annulation {
    pub motif: String,
}

// =============================================================================
// LA CONSULTATION
// =============================================================================

/// `GET /api/machines` — la liste, avec ce que chaque machine porte.
///
/// Le poids vient de `machine_etat`, le compte constate — pas d'un solde de
/// mouvements. C'est toute la difference du modele.
pub async fn lister(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT m.code_machine, m.nom, m.capacite_bobines, m.nb_etages, m.code_atelier,
                m.notes, m.actif, m.etat, m.motif_etat, m.date_etat,
                COALESCE(SUM(e.nb_bobines), 0)::bigint     AS bobines_presentes,
                COALESCE(SUM(e.kg), 0)::float8             AS quantite_kg,
                COUNT(DISTINCT z.code_emplacement)::bigint AS nb_zones,
                MAX(e.date_constat)                        AS dernier_constat
           FROM machine m
           LEFT JOIN machine_emplacement z ON z.code_machine = m.code_machine
           LEFT JOIN machine_etat e ON e.code_emplacement = z.code_emplacement
          GROUP BY m.code_machine, m.nom, m.capacite_bobines, m.nb_etages,
                   m.code_atelier, m.notes, m.actif, m.etat, m.motif_etat, m.date_etat
          ORDER BY m.nom",
    )
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/machines/{code}` — le plan : les zones et ce qu'elles portent.
pub async fn plan(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT z.code_emplacement, z.code_machine, z.role, z.numero_etage, z.libelle,
                z.capacite_bobines, z.actif,
                COALESCE(SUM(e.nb_bobines), 0)::bigint AS bobines_presentes,
                COALESCE(SUM(e.kg), 0)::float8         AS quantite_kg,
                COUNT(e.code_reference)::bigint        AS nb_lots,
                MAX(e.date_constat)                    AS dernier_constat
           FROM machine_emplacement z
           LEFT JOIN machine_etat e ON e.code_emplacement = z.code_emplacement
          WHERE z.code_machine = $1
          GROUP BY z.code_emplacement, z.code_machine, z.role, z.numero_etage,
                   z.libelle, z.capacite_bobines, z.actif
          ORDER BY CASE z.role WHEN 'ETAGE' THEN 0 WHEN 'CHAINE' THEN 1
                               WHEN 'TRAME' THEN 2 ELSE 3 END,
                   z.numero_etage DESC",
    )
    .bind(&code)
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/machines/{code}/zones/{zone}` — le constat courant d'une zone.
///
/// C'est ce que la fiche de mise a jour pre-remplit : l'operateur n'y touche
/// que les pourcentages.
pub async fn etat_zone(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((code, zone)): Path<(String, String)>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT e.code_reference, r.designation, e.lot_fournisseur,
                e.nb_bobines, e.nb_palettes,
                e.poids_unitaire_kg::float8 AS poids_unitaire_kg,
                e.pourcentage::float8       AS pourcentage,
                e.kg::float8                AS kg,
                e.mode_constat, e.date_constat, e.responsable,
                r.poids_bobine_kg::float8   AS poids_catalogue_kg
           FROM machine_etat e
           JOIN machine_emplacement z ON z.code_emplacement = e.code_emplacement
           JOIN reference r ON r.code_reference = e.code_reference
          WHERE z.code_machine = $1 AND e.code_emplacement = $2
          ORDER BY r.designation, e.lot_fournisseur",
    )
    .bind(&code)
    .bind(&zone)
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/machines/consommation` — le cumul, jamais une repartition.
///
///     consommation = tout ce qui a ete charge - ce qui est revenu - l'etat actuel
///
/// Personne ne sait quel chargement a ete tisse quand : repartir la
/// consommation fiche par fiche serait une invention. Le cumul, lui, se
/// verifie a la main.
pub async fn journal_consommation(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<Filtre>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    // LE CLICHE EST LE POINT DE REFERENCE. Sans lui, on ne saurait pas ou en
    // etait la zone au premier jour de la periode, et l'ecart d'un mois serait
    // indiscernable de celui de trois jours.
    let lignes = sqlx::query(
        "SELECT * FROM f_machine_consommation($1, $2, $3)
          ORDER BY machine_nom, zone, designation, lot_fournisseur
          LIMIT $4",
    )
    .bind(&f.code_machine)
    .bind(&f.debut)
    .bind(&f.fin)
    .bind(f.limite.unwrap_or(500).clamp(1, 5000))
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

// =============================================================================
// LES FICHES
// =============================================================================

/// `GET /api/machines/fiches` — la liste, brouillons en tete.
pub async fn lister_fiches(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<Filtre>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT f.id_fiche, f.numero_fiche, f.type_fiche, f.statut, f.code_machine,
                m.nom AS machine_nom, f.code_emplacement, z.libelle AS zone,
                f.date_fiche, f.date_constat_precedent, f.code_magasin,
                f.nb_bobines_etage, f.numero_of, f.responsable, f.observations,
                f.date_creation, f.date_validation, f.motif_annulation,
                (SELECT COUNT(*) FROM machine_fiche_ligne l WHERE l.id_fiche = f.id_fiche)
                    ::bigint AS nb_lignes
           FROM machine_fiche f
           JOIN machine m ON m.code_machine = f.code_machine
           JOIN machine_emplacement z ON z.code_emplacement = f.code_emplacement
          WHERE ($1 IS NULL OR f.code_machine = $1)
            AND ($2 IS NULL OR f.statut = $2)
          ORDER BY CASE f.statut WHEN 'BROUILLON' THEN 0 ELSE 1 END,
                   f.date_fiche DESC, f.date_creation DESC
          LIMIT $3",
    )
    .bind(&f.code_machine)
    .bind(&f.statut)
    .bind(f.limite.unwrap_or(200).clamp(1, 2000))
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/machines/fiches/{id}` — l'entete et ses lignes.
pub async fn lire_fiche(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;

    let entete = sqlx::query(
        "SELECT f.*, m.nom AS machine_nom, z.libelle AS zone, z.capacite_bobines
           FROM machine_fiche f
           JOIN machine m ON m.code_machine = f.code_machine
           JOIN machine_emplacement z ON z.code_emplacement = f.code_emplacement
          WHERE f.id_fiche = $1",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;
    if entete.is_empty() {
        return Err(AppError::Introuvable(format!("fiche {id}")));
    }

    let lignes = sqlx::query(
        "SELECT l.*, r.designation, r.poids_bobine_kg::float8 AS poids_catalogue_kg
           FROM machine_fiche_ligne l
           JOIN reference r ON r.code_reference = l.code_reference
          WHERE l.id_fiche = $1
          ORDER BY l.ligne_numero",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let mut e = lignes_en_json(&entete);
    let mut l = lignes_en_json(&lignes);
    user.masquer(&state.db, module::STOCK, &mut e).await?;
    user.masquer(&state.db, module::STOCK, &mut l).await?;
    Ok(Json(json!({
        "entete": e.get(0).cloned().unwrap_or(Value::Null),
        "lignes": l,
    })))
}

/// `POST /api/machines/fiches` — un brouillon, entete et lignes d'un coup.
///
/// LE BROUILLON NE TOUCHE A RIEN. Un magasinier saisit six lignes, se trompe
/// sur l'une, la reprend : si chaque frappe touchait le stock, il faudrait
/// annuler pour une faute de doigt, et le grand livre porterait la trace de
/// chaque hesitation.
pub async fn creer_fiche(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(f): Json<NouvelleFiche>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    verifier_entete(&f)?;

    let zone = resoudre_zone(&state.db, &f.code_machine, &f.code_emplacement).await?;
    let precedent = dernier_constat(&state.db, &f.code_emplacement).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let numero = numeroter(&mut tx, "machine_fiche", "numero_fiche", "MCH").await?;
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO machine_fiche
             (id_fiche, numero_fiche, type_fiche, statut, code_machine, code_emplacement,
              date_fiche, date_constat_precedent, code_magasin, nb_bobines_etage,
              nb_palettes, numero_of, responsable, observations, id_utilisateur)
         VALUES ($1,$2,$3,'BROUILLON',$4,$5,
                 COALESCE($6, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')),
                 $7,$8,$9,$10,$11,$12,$13,$14)",
    )
    .bind(&id)
    .bind(&numero)
    .bind(f.type_fiche.code())
    .bind(&f.code_machine)
    .bind(&f.code_emplacement)
    .bind(&f.date_fiche)
    .bind(&precedent)
    .bind(&f.code_magasin)
    .bind(f.nb_bobines_etage.or(Some(zone.capacite)))
    .bind(f.nb_palettes)
    .bind(&f.numero_of)
    .bind(f.responsable.trim())
    .bind(&f.observations)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    ecrire_lignes(&mut tx, &id, &f.lignes).await?;
    tx.commit().await?;

    Ok(Json(json!({
        "id_fiche": id, "numero_fiche": numero, "statut": "BROUILLON",
    })))
}

/// `PUT /api/machines/fiches/{id}` — remplace le brouillon en entier.
pub async fn remplacer_fiche(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(f): Json<NouvelleFiche>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    verifier_entete(&f)?;
    exiger_brouillon(&state.db, &id).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    sqlx::query(
        "UPDATE machine_fiche
            SET date_fiche = COALESCE($2, date_fiche), code_magasin = $3,
                nb_bobines_etage = $4, nb_palettes = $5, numero_of = $6,
                responsable = $7, observations = $8
          WHERE id_fiche = $1",
    )
    .bind(&id)
    .bind(&f.date_fiche)
    .bind(&f.code_magasin)
    .bind(f.nb_bobines_etage)
    .bind(f.nb_palettes)
    .bind(&f.numero_of)
    .bind(f.responsable.trim())
    .bind(&f.observations)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM machine_fiche_ligne WHERE id_fiche = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    ecrire_lignes(&mut tx, &id, &f.lignes).await?;
    tx.commit().await?;

    Ok(Json(json!({ "id_fiche": id, "statut": "BROUILLON" })))
}

/// `DELETE /api/machines/fiches/{id}` — jette un brouillon.
pub async fn supprimer_fiche(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    exiger_brouillon(&state.db, &id).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    sqlx::query("DELETE FROM machine_fiche WHERE id_fiche = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({ "supprime": id })))
}

// =============================================================================
// LA VALIDATION — le seul endroit qui ecrit
// =============================================================================

/// `POST /api/machines/fiches/{id}/valider`
///
/// TROIS ECRITURES, EN TOUT OU RIEN :
///   1. le mouvement, cote magasin seulement, et seulement pour une charge ou
///      une decharge ;
///   2. le constat — `machine_etat`, ecrase pour chaque reference touchee ;
///   3. le cliche COMPLET de la zone, puis la consommation qui en decoule.
pub async fn valider_fiche(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;

    let f = charger_fiche(&state.db, &id).await?;
    if f.statut != "BROUILLON" {
        return Err(AppError::RegleMetier(format!(
            "la fiche {} est {} : seul un brouillon se valide",
            f.numero,
            f.statut.to_lowercase()
        )));
    }

    let lignes = charger_lignes(&state.db, &id).await?;
    if lignes.is_empty() {
        return Err(AppError::Invalide("la fiche ne porte aucune ligne".into()));
    }

    let zone = resoudre_zone(&state.db, &f.code_machine, &f.code_emplacement).await?;
    let avant = etat_courant(&state.db, &f.code_emplacement).await?;

    // LES EMPLACEMENTS NE SONT JAMAIS A MOITIE DECLARES.
    //
    // Une zone de 1344 places porte 1344 bobines — pas « au plus 1344 ». Si Y
    // en occupe 1000, X en a forcement 344. Le systeme refuse donc le MANQUE
    // autant que le depassement : c'est ce qui rattrape une ligne oubliee, et
    // un compte incomplet fausserait toute la consommation qui en decoule.
    //
    // LE NOMBRE DE REFERENCE EST CELUI DE L'ENTETE, pas celui du parametrage.
    // Le magasinier constate le physique ; si sa machine porte 1300 places et
    // non 1344, c'est le parametrage qui a tort, et il sera corrige plus bas.
    let mut presentes: HashMap<String, i64> =
        avant.iter().map(|(k, e)| (k.clone(), e.bobines)).collect();
    for l in &lignes {
        presentes.insert(cle(&l.reference, &l.lot), l.presentes);
    }
    let total: i64 = presentes.values().sum();
    let attendu = f.nb_bobines_etage.unwrap_or(zone.capacite);

    // LE COMPTE NE BAISSE PAS SUR UNE CHARGE.
    //
    // Etendre une zone de 1300 a 1344 places, c'est y poser 44 bobines de plus :
    // elles COMPLETENT, elles ne remplacent rien de consomme. L'inverse — passer
    // de 1344 a 1300 — signifie que 44 bobines ont quitte la zone, et du fil est
    // parti avec elles. Ce n'est pas un chargement, c'est un dechargement, et le
    // laisser passer ici ferait disparaitre ce fil dans la consommation sans
    // qu'aucun magasin le recoive.
    if f.type_fiche == "CHARGE" && attendu < zone.capacite {
        return Err(AppError::RegleMetier(format!(
            "{} porte {} emplacements et la fiche en declare {} : des bobines quittent la zone, cela se fait par un dechargement",
            zone.libelle, zone.capacite, attendu
        )));
    }
    if f.type_fiche == "DECHARGE" && attendu > zone.capacite {
        return Err(AppError::RegleMetier(format!(
            "{} porte {} emplacements et la fiche en declare {} : on n en ajoute pas en dechargeant",
            zone.libelle, zone.capacite, attendu
        )));
    }
    // UNE MISE A JOUR NE CHANGE QUE LES POURCENTAGES.
    //
    // Ni le nombre d'emplacements, ni le compte de chaque reference, ni la
    // composition. Le nombre de bobines ne baisse que de deux facons : un
    // DECHARGEMENT — elles quittent la zone avec leur fil — ou une
    // REDISTRIBUTION entre references de la meme zone, qui se fait par un
    // chargement puisque des bobines y arrivent. Laisser une simple mise a jour
    // faire baisser un compte ferait disparaitre du fil sans qu'aucun magasin
    // le recoive et sans qu'aucun mouvement en garde la trace.
    if f.type_fiche == "MAJ" {
        if attendu != zone.capacite {
            return Err(AppError::RegleMetier(format!(
                "une mise a jour ne change que les pourcentages : {} porte {} emplacements, la fiche en declare {}",
                zone.libelle, zone.capacite, attendu
            )));
        }
        for l in &lignes {
            let av = avant.get(&cle(&l.reference, &l.lot));
            match av {
                None => {
                    return Err(AppError::RegleMetier(format!(
                        "{} n est pas sur {} : une mise a jour ne pose pas de nouvelle reference, c est un chargement",
                        l.reference, zone.libelle
                    )))
                }
                Some(e) if e.bobines != l.presentes => {
                    return Err(AppError::RegleMetier(format!(
                        "{} porte {} bobines de {} et la fiche en declare {} : une mise a jour ne change que les pourcentages",
                        zone.libelle, e.bobines, l.reference, l.presentes
                    )))
                }
                _ => {}
            }
        }
        if lignes.len() < avant.len() {
            return Err(AppError::RegleMetier(
                "une mise a jour porte toutes les references de la zone : en retirer une ferait disparaitre son fil sans dechargement"
                    .into(),
            ));
        }
    }

    if total != attendu {
        let manque = attendu - total;
        return Err(AppError::RegleMetier(if manque > 0 {
            format!(
                "{} porte {} emplacements : il manque {} bobines dans la fiche",
                zone.libelle, attendu, manque
            )
        } else {
            format!(
                "{} porte {} emplacements : la fiche en declare {} de trop",
                zone.libelle, attendu, -manque
            )
        }));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // --- 1. LE MOUVEMENT, cote magasin seulement -----------------------------
    let mut numero_mvt: Option<String> = None;
    if f.type_fiche == "CHARGE" || f.type_fiche == "DECHARGE" {
        let magasin = f.code_magasin.clone().ok_or_else(|| {
            AppError::Invalide("le magasin est requis pour une charge ou une decharge".into())
        })?;
        let bougees: Vec<&Ligne> = lignes
            .iter()
            .filter(|l| l.kg_mouvementes.unwrap_or(0.0) > 0.0)
            .collect();
        if !bougees.is_empty() {
            numero_mvt = Some(ecrire_mouvement(&mut tx, &user, &f, &magasin, &bougees).await?);
        }
    }

    // --- 2. LE CONSTAT -------------------------------------------------------
    for l in &lignes {
        poser_etat(&mut tx, &user, &f, l).await?;
    }
    // Une ligne tombee a zero quitte la zone : la garder ferait un lot fantome
    // que chaque cliche suivant recopierait indefiniment.
    sqlx::query(
        "DELETE FROM machine_etat
          WHERE code_emplacement = $1 AND nb_bobines = 0 AND kg = 0",
    )
    .bind(&f.code_emplacement)
    .execute(&mut *tx)
    .await?;

    // --- 2 bis. LE PARAMETRAGE SUIT LE CONSTAT -------------------------------
    //
    // L'ENTETE FAIT AUTORITE, ET CELA DOIT DURER. Le magasinier compte le
    // physique : si son etage porte 1344 places la ou le parametrage en annonce
    // 1300, c'est le parametrage qui a tort, et la validation le corrige.
    //
    // Sans ce report, la correction ne tenait que le temps d'une fiche. La
    // suivante repartait de 1300, le constat en portait 1344, et le meme refus
    // revenait a chaque chargement — l'utilisateur le voyait « toujours ».
    if attendu > 0 && attendu != zone.capacite {
        sqlx::query(
            "UPDATE machine_emplacement SET capacite_bobines = $2
              WHERE code_emplacement = $1",
        )
        .bind(&f.code_emplacement)
        .bind(attendu)
        .execute(&mut *tx)
        .await?;

        // Une machine porte au moins ce que ses zones portent. Agrandir un
        // etage sans remonter la machine rendrait son total plus petit que la
        // somme de ses parties — la regle que `creer_machine` fait respecter a
        // la declaration doit valoir aussi apres coup.
        sqlx::query(
            "UPDATE machine m SET capacite_bobines = z.somme
               FROM (SELECT code_machine, sum(capacite_bobines) AS somme
                       FROM machine_emplacement
                      WHERE code_machine = $1 AND actif = 1
                      GROUP BY code_machine) z
              WHERE m.code_machine = z.code_machine
                AND m.capacite_bobines < z.somme",
        )
        .bind(&f.code_machine)
        .execute(&mut *tx)
        .await?;
    }

    // --- 3. LE CLICHE COMPLET, puis la consommation --------------------------
    //
    // Le cliche porte TOUTE la zone, y compris les references que la fiche n'a
    // pas touchees. Sans elles, l'etat d'une date passee serait incomplet : on
    // saurait ce qui a bouge ce jour-la, pas ce qui etait a cote.
    let apres = etat_courant_tx(&mut tx, &f.code_emplacement).await?;
    for e in apres.values() {
        sqlx::query(
            "INSERT INTO machine_cliche
                 (id_fiche, code_emplacement, date_cliche, code_reference, lot_fournisseur,
                  nb_bobines, poids_unitaire_kg, pourcentage, kg)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (id_fiche, code_reference, lot_fournisseur) DO NOTHING",
        )
        .bind(&id)
        .bind(&f.code_emplacement)
        .bind(&f.date_fiche)
        .bind(&e.reference)
        .bind(&e.lot)
        .bind(e.bobines)
        .bind(e.poids_unitaire)
        .bind(e.pourcentage)
        .bind(e.kg)
        .execute(&mut *tx)
        .await?;
    }

    // ON N'ATTRIBUE PLUS LA CONSOMMATION FICHE PAR FICHE.
    //
    // Personne ne sait quel chargement a ete tisse quand. La consommation se
    // lit en CUMUL — tout ce qui a ete charge, moins ce qui est revenu, moins
    // l'etat constate — et c'est la vue `v_machine_consommation` qui le fait.
    //
    // Ce qu'on ecrit ici n'est donc plus un calcul mais une TRACE : l'etat
    // d'avant et celui d'apres, par reference et par lot. C'est elle qui permet
    // d'annuler une fiche validee en restaurant ce qui etait la.
    for l in &lignes {
        let av = avant.get(&cle(&l.reference, &l.lot));
        let (kg_charge, kg_retourne) = match f.type_fiche.as_str() {
            "CHARGE" => (l.kg_mouvementes.unwrap_or(0.0), 0.0),
            "DECHARGE" => (0.0, l.kg_mouvementes.unwrap_or(0.0)),
            _ => (0.0, 0.0),
        };
        sqlx::query(
            "INSERT INTO machine_consommation
                 (code_machine, code_emplacement, code_reference, lot_fournisseur,
                  date_constat, date_constat_precedent,
                  bobines_avant, pourcentage_avant, kg_avant,
                  kg_charge, kg_retourne,
                  bobines_apres, pourcentage_apres, poids_unitaire_kg, kg_apres,
                  numero_of, responsable, id_utilisateur, mode_constat, id_fiche)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)",
        )
        .bind(&f.code_machine)
        .bind(&f.code_emplacement)
        .bind(&l.reference)
        .bind(&l.lot)
        .bind(&f.date_fiche)
        .bind(&f.date_constat_precedent)
        .bind(av.map(|e| e.bobines).unwrap_or(0))
        .bind(av.and_then(|e| e.pourcentage))
        .bind(av.map(|e| e.kg).unwrap_or(0.0))
        .bind(kg_charge)
        .bind(kg_retourne)
        .bind(l.presentes)
        .bind(l.pourcentage)
        .bind(l.poids_unitaire)
        .bind(l.total_kg)
        .bind(&f.numero_of)
        .bind(&f.responsable)
        .bind(&user.id)
        .bind(&l.mode_constat)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        "UPDATE machine_fiche
            SET statut = 'VALIDE', id_utilisateur_validation = $2,
                date_validation = to_char(now() AT TIME ZONE 'UTC',
                                          'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
          WHERE id_fiche = $1",
    )
    .bind(&id)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({
        "id_fiche": id,
        "numero_fiche": f.numero,
        "statut": "VALIDE",
        "mouvement": numero_mvt,
    })))
}

/// `POST /api/machines/fiches/{id}/annuler`
///
/// ON NE GOMME PAS UNE ERREUR, ON ECRIT QU'ELLE A ETE VUE. Le mouvement est
/// contre-passe, l'etat revient a ce que le journal de consommation avait
/// conserve — c'est precisement pour cela qu'il conserve l'etat d'avant.
pub async fn annuler_fiche(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(a): Json<Annulation>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    if a.motif.trim().is_empty() {
        return Err(AppError::Invalide(
            "une annulation doit dire pourquoi : sans motif, elle sert a faire \
             disparaitre une erreur sans l expliquer"
                .into(),
        ));
    }

    let f = charger_fiche(&state.db, &id).await?;
    if f.statut == "ANNULE" {
        return Err(AppError::RegleMetier("cette fiche est deja annulee".into()));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    if f.statut == "VALIDE" {
        let avant = sqlx::query_as::<_, (String, String, i64, Option<f64>, Option<f64>, f64)>(
            "SELECT code_reference, lot_fournisseur, bobines_avant,
                    pourcentage_avant::float8, poids_unitaire_kg::float8, kg_avant::float8
               FROM machine_consommation WHERE id_fiche = $1",
        )
        .bind(&id)
        .fetch_all(&mut *tx)
        .await?;

        for (reference, lot, bobines, pourcentage, unitaire, kg) in &avant {
            if *bobines == 0 && *kg == 0.0 {
                sqlx::query(
                    "DELETE FROM machine_etat
                      WHERE code_emplacement = $1 AND code_reference = $2
                        AND lot_fournisseur = $3",
                )
                .bind(&f.code_emplacement)
                .bind(reference)
                .bind(lot)
                .execute(&mut *tx)
                .await?;
            } else {
                sqlx::query(
                    "INSERT INTO machine_etat
                         (code_emplacement, code_reference, lot_fournisseur, nb_bobines,
                          poids_unitaire_kg, pourcentage, date_constat, responsable,
                          id_utilisateur)
                     VALUES ($1,$2,$3,$4,$5,COALESCE($6,100),$7,$8,$9)
                     ON CONFLICT (code_emplacement, code_reference, lot_fournisseur)
                     DO UPDATE SET nb_bobines = excluded.nb_bobines,
                                   poids_unitaire_kg = excluded.poids_unitaire_kg,
                                   pourcentage = excluded.pourcentage,
                                   date_constat = excluded.date_constat,
                                   responsable = excluded.responsable",
                )
                .bind(&f.code_emplacement)
                .bind(reference)
                .bind(lot)
                .bind(bobines)
                .bind(unitaire)
                .bind(pourcentage)
                .bind(&f.date_fiche)
                .bind(format!("annulation {}", f.numero))
                .bind(&user.id)
                .execute(&mut *tx)
                .await?;
            }
        }

        contre_passer(&mut tx, &user, &f).await?;

        // La consommation de cette fiche est annulee par une ligne miroir : on
        // n'efface pas, on ecrit l'inverse.
        sqlx::query(
            "INSERT INTO machine_consommation
                 (code_machine, code_emplacement, code_reference, lot_fournisseur,
                  date_constat, bobines_avant, kg_avant, kg_charge, kg_retourne,
                  bobines_apres, kg_apres, responsable, id_utilisateur, mode_constat, id_fiche)
             SELECT code_machine, code_emplacement, code_reference, lot_fournisseur,
                    to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'),
                    bobines_apres, kg_apres, kg_retourne, kg_charge,
                    bobines_avant, kg_avant, $2, $3, mode_constat, id_fiche
               FROM machine_consommation
              WHERE id_fiche = $1 AND responsable <> $2",
        )
        .bind(&id)
        .bind(format!("annulation {}", f.numero))
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        "UPDATE machine_fiche
            SET statut = 'ANNULE', motif_annulation = $2,
                date_annulation = to_char(now() AT TIME ZONE 'UTC',
                                          'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
          WHERE id_fiche = $1",
    )
    .bind(&id)
    .bind(a.motif.trim())
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "id_fiche": id, "statut": "ANNULE" })))
}

// =============================================================================
// LES ROUAGES
// =============================================================================

struct Zone {
    libelle: String,
    capacite: i64,
}

struct Fiche {
    numero: String,
    /// LE NOMBRE D'EMPLACEMENTS CONSTATE, saisi a l'entete. Il fait autorite
    /// sur le parametrage : c'est lui qui dit combien la zone porte vraiment.
    nb_bobines_etage: Option<i64>,
    type_fiche: String,
    statut: String,
    code_machine: String,
    code_emplacement: String,
    date_fiche: String,
    date_constat_precedent: Option<String>,
    code_magasin: Option<String>,
    numero_of: Option<String>,
    responsable: String,
}

struct Ligne {
    reference: String,
    lot: String,
    mouvementees: Option<i64>,
    kg_mouvementes: Option<f64>,
    presentes: i64,
    poids_unitaire: Option<f64>,
    pourcentage: Option<f64>,
    total_kg: f64,
    mode_constat: String,
}

struct Etat {
    reference: String,
    lot: String,
    bobines: i64,
    poids_unitaire: Option<f64>,
    pourcentage: Option<f64>,
    kg: f64,
}

/// Le couple (reference, lot) tient lieu de cle. Le separateur est un
/// caractere de controle : aucun code de reference ni de lot ne le contient.
fn cle(reference: &str, lot: &str) -> String {
    format!("{reference}\u{1}{lot}")
}

fn verifier_entete(f: &NouvelleFiche) -> AppResult<()> {
    if f.responsable.trim().is_empty() {
        return Err(AppError::Invalide("le responsable est requis".into()));
    }
    if f.type_fiche.touche_magasin() && f.code_magasin.as_deref().unwrap_or("").is_empty() {
        return Err(AppError::Invalide(
            "le magasin d origine ou de retour est requis".into(),
        ));
    }
    Ok(())
}

async fn resoudre_zone(db: &crate::db::Db, machine: &str, zone: &str) -> AppResult<Zone> {
    sqlx::query_as::<_, (String, i64)>(
        "SELECT libelle, capacite_bobines FROM machine_emplacement
          WHERE code_machine = $1 AND code_emplacement = $2 AND actif = 1",
    )
    .bind(machine)
    .bind(zone)
    .fetch_optional(db)
    .await?
    .map(|(libelle, capacite)| Zone { libelle, capacite })
    .ok_or_else(|| AppError::Introuvable(format!("la machine {machine} n a pas de zone {zone}")))
}

async fn dernier_constat(db: &crate::db::Db, zone: &str) -> AppResult<Option<String>> {
    Ok(sqlx::query_scalar::<_, Option<String>>(
        "SELECT MAX(date_constat) FROM machine_etat WHERE code_emplacement = $1",
    )
    .bind(zone)
    .fetch_one(db)
    .await?)
}

async fn exiger_brouillon(db: &crate::db::Db, id: &str) -> AppResult<()> {
    let statut: Option<String> =
        sqlx::query_scalar("SELECT statut FROM machine_fiche WHERE id_fiche = $1")
            .bind(id)
            .fetch_optional(db)
            .await?;
    match statut.as_deref() {
        None => Err(AppError::Introuvable(format!("fiche {id}"))),
        Some("BROUILLON") => Ok(()),
        Some(s) => Err(AppError::RegleMetier(format!(
            "cette fiche est {} : elle ne se modifie plus",
            s.to_lowercase()
        ))),
    }
}

type FicheBrute = (
    String, String, String, String, String, String,
    Option<String>, Option<String>, Option<String>, String, Option<i64>,
);

async fn charger_fiche(db: &crate::db::Db, id: &str) -> AppResult<Fiche> {
    sqlx::query_as::<_, FicheBrute>(
        "SELECT numero_fiche, type_fiche, statut, code_machine, code_emplacement,
                date_fiche, date_constat_precedent, code_magasin, numero_of, responsable,
                nb_bobines_etage
           FROM machine_fiche WHERE id_fiche = $1",
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .map(|t| Fiche {
        numero: t.0,
        type_fiche: t.1,
        statut: t.2,
        code_machine: t.3,
        code_emplacement: t.4,
        date_fiche: t.5,
        date_constat_precedent: t.6,
        code_magasin: t.7,
        numero_of: t.8,
        responsable: t.9,
        nb_bobines_etage: t.10,
    })
    .ok_or_else(|| AppError::Introuvable(format!("fiche {id}")))
}

type LigneBrute = (
    String, String, Option<i64>, Option<f64>, i64, Option<f64>, Option<f64>, f64, String,
);

async fn charger_lignes(db: &crate::db::Db, id: &str) -> AppResult<Vec<Ligne>> {
    let l = sqlx::query_as::<_, LigneBrute>(
        "SELECT code_reference, lot_fournisseur, nb_bobines_mouvementees,
                kg_mouvementes::float8, nb_bobines_presentes,
                poids_unitaire_kg::float8, pourcentage::float8, total_kg::float8, mode_constat
           FROM machine_fiche_ligne WHERE id_fiche = $1 ORDER BY ligne_numero",
    )
    .bind(id)
    .fetch_all(db)
    .await?;
    Ok(l.into_iter()
        .map(|t| Ligne {
            reference: t.0,
            lot: t.1,
            mouvementees: t.2,
            kg_mouvementes: t.3,
            presentes: t.4,
            poids_unitaire: t.5,
            pourcentage: t.6,
            total_kg: t.7,
            mode_constat: t.8,
        })
        .collect())
}

type EtatBrut = (String, String, i64, Option<f64>, Option<f64>, f64);

const SQL_ETAT: &str = "SELECT code_reference, lot_fournisseur, nb_bobines,
        poids_unitaire_kg::float8, pourcentage::float8, kg::float8
   FROM machine_etat WHERE code_emplacement = $1";

async fn etat_courant(db: &crate::db::Db, zone: &str) -> AppResult<HashMap<String, Etat>> {
    let l = sqlx::query_as::<_, EtatBrut>(SQL_ETAT)
        .bind(zone)
        .fetch_all(db)
        .await?;
    Ok(vers_carte(l))
}

async fn etat_courant_tx(
    tx: &mut sqlx::PgConnection,
    zone: &str,
) -> AppResult<HashMap<String, Etat>> {
    let l = sqlx::query_as::<_, EtatBrut>(SQL_ETAT)
        .bind(zone)
        .fetch_all(&mut *tx)
        .await?;
    Ok(vers_carte(l))
}

fn vers_carte(l: Vec<EtatBrut>) -> HashMap<String, Etat> {
    l.into_iter()
        .map(|t| {
            (
                cle(&t.0, &t.1),
                Etat {
                    reference: t.0,
                    lot: t.1,
                    bobines: t.2,
                    poids_unitaire: t.3,
                    pourcentage: t.4,
                    kg: t.5,
                },
            )
        })
        .collect()
}

async fn ecrire_lignes(
    tx: &mut sqlx::PgConnection,
    id: &str,
    lignes: &[LigneFiche],
) -> AppResult<()> {
    for (i, l) in lignes.iter().enumerate() {
        if l.lot_fournisseur.trim().is_empty() {
            return Err(AppError::Invalide(format!(
                "le lot est requis pour {} : sans lui le stock ne se suit plus",
                l.code_reference
            )));
        }
        sqlx::query(
            "INSERT INTO machine_fiche_ligne
                 (id_fiche, ligne_numero, code_reference, lot_fournisseur,
                  nb_bobines_mouvementees, kg_mouvementes, nb_palettes,
                  nb_bobines_presentes, poids_unitaire_kg, pourcentage, total_kg,
                  mode_constat, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        )
        .bind(id)
        .bind(i as i64 + 1)
        .bind(&l.code_reference)
        .bind(l.lot_fournisseur.trim())
        .bind(l.nb_bobines_mouvementees)
        .bind(l.kg_mouvementes)
        .bind(l.nb_palettes)
        .bind(l.nb_bobines_presentes)
        .bind(l.poids_unitaire_kg)
        .bind(l.pourcentage)
        .bind(arrondi_kg(l.total_kg))
        .bind(&l.mode_constat)
        .bind(&l.notes)
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}

async fn poser_etat(
    tx: &mut sqlx::PgConnection,
    user: &Utilisateur,
    f: &Fiche,
    l: &Ligne,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO machine_etat
             (code_emplacement, code_reference, lot_fournisseur, nb_bobines,
              poids_unitaire_kg, pourcentage, mode_constat, date_constat,
              responsable, id_utilisateur)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,100),$7,$8,$9,$10)
         ON CONFLICT (code_emplacement, code_reference, lot_fournisseur)
         DO UPDATE SET nb_bobines = excluded.nb_bobines,
                       poids_unitaire_kg = excluded.poids_unitaire_kg,
                       pourcentage = excluded.pourcentage,
                       mode_constat = excluded.mode_constat,
                       date_constat = excluded.date_constat,
                       responsable = excluded.responsable,
                       id_utilisateur = excluded.id_utilisateur,
                       date_maj = to_char(now() AT TIME ZONE 'UTC',
                                          'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')",
    )
    .bind(&f.code_emplacement)
    .bind(&l.reference)
    .bind(&l.lot)
    .bind(l.presentes)
    .bind(l.poids_unitaire)
    .bind(l.pourcentage)
    .bind(&l.mode_constat)
    .bind(&f.date_fiche)
    .bind(&f.responsable)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Le mouvement, cote magasin seulement — il n'y a rien a ecrire en face.
async fn ecrire_mouvement(
    tx: &mut sqlx::PgConnection,
    user: &Utilisateur,
    f: &Fiche,
    magasin: &str,
    lignes: &[&Ligne],
) -> AppResult<String> {
    let type_mvt = if f.type_fiche == "CHARGE" {
        "CHARGE_MACHINE"
    } else {
        "RETOUR_MACHINE"
    };
    let numero = numeroter(tx, "mouvement", "numero_mouvement", "MVT").await?;
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO mouvement
             (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt, code_magasin,
              code_motif, reference_document, numero_of, responsable, id_utilisateur)
         VALUES ($1,$2,$3,$4,$5,'MACHINE',$6,$7,$8,$9)",
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
    .execute(&mut *tx)
    .await?;

    for (i, l) in lignes.iter().enumerate() {
        // Un retour rentre au magasin au CMUP connu. Sans CMUP nulle part — un
        // stock de depart jamais achete —, il rentre sans prix : les kilos
        // reviennent et le CMUP reste vide, il ne fond pas (2026-09-17b).
        let prix = if type_mvt == "RETOUR_MACHINE" {
            cmup(&mut *tx, magasin, &l.reference).await?
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
        .bind(i as i64 + 1)
        .bind(&l.reference)
        .bind(arrondi_kg(l.kg_mouvementes.unwrap_or(0.0)))
        .bind(prix)
        .bind(&l.lot)
        .bind(l.mouvementees)
        .execute(&mut *tx)
        .await?;
    }
    Ok(numero)
}

/// Le cout moyen, du magasin s'il en a un, de la fiche reference sinon.
async fn cmup(
    tx: &mut sqlx::PgConnection,
    magasin: &str,
    reference: &str,
) -> AppResult<Option<f64>> {
    if let Some(Some(p)) = sqlx::query_scalar::<_, Option<f64>>(
        "SELECT cmup_mad::float8 FROM stock_magasin
          WHERE code_magasin = $1 AND code_reference = $2",
    )
    .bind(magasin)
    .bind(reference)
    .fetch_optional(&mut *tx)
    .await?
    {
        return Ok(Some(p));
    }
    Ok(sqlx::query_scalar::<_, Option<f64>>(
        "SELECT cmup_mad::float8 FROM reference WHERE code_reference = $1",
    )
    .bind(reference)
    .fetch_optional(&mut *tx)
    .await?
    .flatten())
}

/// Le miroir du mouvement d'une fiche annulee.
async fn contre_passer(
    tx: &mut sqlx::PgConnection,
    user: &Utilisateur,
    f: &Fiche,
) -> AppResult<()> {
    let lignes = sqlx::query_as::<_, (String, Option<String>, f64, Option<f64>, Option<i64>, String)>(
        "SELECT lm.code_reference, lm.lot_fournisseur, lm.quantite_kg::float8,
                lm.prix_kg_mad::float8, lm.nb_bobines, mv.code_type_mvt
           FROM mouvement mv
           JOIN ligne_mouvement lm ON lm.id_mouvement = mv.id_mouvement
          WHERE mv.reference_document = $1",
    )
    .bind(&f.numero)
    .fetch_all(&mut *tx)
    .await?;
    if lignes.is_empty() {
        return Ok(());
    }

    let inverse = if lignes[0].5 == "CHARGE_MACHINE" {
        "RETOUR_MACHINE"
    } else {
        "CHARGE_MACHINE"
    };
    let magasin = f.code_magasin.clone().unwrap_or_default();
    let numero = numeroter(tx, "mouvement", "numero_mouvement", "MVT").await?;
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO mouvement
             (id_mouvement, numero_mouvement, code_type_mvt, code_magasin, code_motif,
              reference_document, observations_globales, responsable, id_utilisateur)
         VALUES ($1,$2,$3,$4,'MACHINE',$5,$6,$7,$8)",
    )
    .bind(&id)
    .bind(&numero)
    .bind(inverse)
    .bind(&magasin)
    .bind(format!("Annulation {}", f.numero))
    .bind(format!("Annulation de la fiche {}", f.numero))
    .bind(&f.responsable)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    for (i, (reference, lot, kg, prix, bobines, _)) in lignes.iter().enumerate() {
        let prix_retour = if inverse == "RETOUR_MACHINE" {
            match prix {
                Some(p) => Some(*p),
                None => cmup(&mut *tx, &magasin, reference).await?,
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
        .bind(i as i64 + 1)
        .bind(reference)
        .bind(kg)
        .bind(prix_retour)
        .bind(lot)
        .bind(bobines)
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}


// =============================================================================
// DECLARER ET CORRIGER UNE MACHINE
// -----------------------------------------------------------------------------
// LA MACHINE SE DECRIT PAR SES ZONES, ET RIEN D'AUTRE. La version precedente
// demandait un nombre d'etages, une capacite par etage identique partout, et une
// capacite totale saisie a la main — trois chiffres qui pouvaient se contredire,
// et qui se contredisaient. Ici l'atelier decrit ce qu'il voit, zone par zone :
// six etages de 1344 bobines, six bobines de trame, un fil de chaine, une
// reserve. Le total se calcule, il ne se saisit pas.
//
// CE QUI CHANGE POUR L'ATELIER :
//   - les etages n'ont plus la meme capacite les uns que les autres ;
//   - la chaine et la trame varient d'une machine a l'autre, ce qui est le cas ;
//   - une machine peut n'avoir AUCUN etage — le metier qui ne file que chaine et
//     trame se declare comme les autres.
//
// LES ZONES NE SONT PLUS DES MAGASINS. L'ancienne creation posait un magasin par
// zone : c'est ce qui donnait dix-sept magasins pour deux magasins reels, et le
// magasinier les voyait tous dans sa liste. Une zone est une position sur un
// metier, pas un lieu de stockage.
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct ZoneSaisie {
    /// ETAGE, CHAINE, TRAME ou RESERVE.
    pub role: String,
    /// Requis et strictement positif pour un etage ; ignore sinon.
    pub numero_etage: Option<i64>,
    pub capacite_bobines: i64,
}

#[derive(Debug, Deserialize)]
pub struct MachineSaisie {
    /// Ignore en modification : le code d'une machine ne change pas.
    pub code_machine: Option<String>,
    pub nom: String,
    pub code_atelier: Option<String>,
    pub notes: Option<String>,
    pub zones: Vec<ZoneSaisie>,
}

/// Une zone validee, prete a etre ecrite.
struct ZonePrete {
    code: String,
    role: String,
    numero: i64,
    capacite: i64,
}

// PAS DE LIBELLE ICI. `machine_emplacement.libelle` est une colonne GENERATED :
// la base la compose depuis le role et le numero — « Etage 1 », « Chaine »,
// « Trame », « Reserve ». Lui en fournir un fait echouer l'insertion.

/// Verifie la saisie et compose les zones. Commun a la creation et a la reprise.
fn preparer(code_machine: &str, m: &MachineSaisie) -> AppResult<Vec<ZonePrete>> {
    if m.nom.trim().is_empty() {
        return Err(AppError::Invalide("le nom de la machine est requis".into()));
    }
    if m.zones.is_empty() {
        return Err(AppError::Invalide(
            "une machine porte au moins une zone : un etage, un fil de chaine, \
             une trame ou une reserve"
                .into(),
        ));
    }

    let mut pretes: Vec<ZonePrete> = Vec::new();
    let mut etages: Vec<i64> = Vec::new();
    let mut uniques: Vec<String> = Vec::new();

    for z in &m.zones {
        let role = z.role.trim().to_uppercase();
        if z.capacite_bobines <= 0 {
            return Err(AppError::Invalide(format!(
                "la zone {role} doit porter au moins une bobine : \
                 une zone vide ne se declare pas, elle se supprime"
            )));
        }
        match role.as_str() {
            "ETAGE" => {
                let n = z.numero_etage.unwrap_or(0);
                if n <= 0 {
                    return Err(AppError::Invalide(
                        "un etage porte un numero a partir de 1".into(),
                    ));
                }
                if etages.contains(&n) {
                    return Err(AppError::Invalide(format!(
                        "l etage {n} est declare deux fois"
                    )));
                }
                etages.push(n);
                pretes.push(ZonePrete {
                    code: format!("{code_machine}-E{n}"),
                    role,
                    numero: n,
                    capacite: z.capacite_bobines,
                });
            }
            "CHAINE" | "TRAME" | "RESERVE" => {
                // UNE SEULE PAR MACHINE. Deux reserves rendraient le compte de
                // bobines ambigu, et c'est ce compte qui fait la consommation.
                if uniques.contains(&role) {
                    return Err(AppError::Invalide(format!(
                        "une machine ne porte qu une zone {role}"
                    )));
                }
                let suffixe = match role.as_str() {
                    "CHAINE" => "CH",
                    "TRAME" => "TR",
                    _ => "RS",
                };
                pretes.push(ZonePrete {
                    code: format!("{code_machine}-{suffixe}"),
                    role: role.clone(),
                    numero: 0,
                    capacite: z.capacite_bobines,
                });
                uniques.push(role);
            }
            autre => {
                return Err(AppError::Invalide(format!(
                    "role de zone inconnu : {autre}. \
                     Les roles sont ETAGE, CHAINE, TRAME et RESERVE"
                )))
            }
        }
    }

    // LES ETAGES SE SUIVENT. Un metier n'a pas d'etage 1, 2 puis 5 : un trou
    // signale une saisie incomplete, et le declencheur `trg_empl_numero` le
    // refuserait de toute facon, avec un message bien moins clair.
    etages.sort_unstable();
    for (i, n) in etages.iter().enumerate() {
        if *n != i as i64 + 1 {
            return Err(AppError::Invalide(format!(
                "les etages se suivent a partir de 1 : l etage {} manque",
                i + 1
            )));
        }
    }

    Ok(pretes)
}

async fn ecrire_zone(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    code_machine: &str,
    z: &ZonePrete,
) -> AppResult<()> {
    // `code_magasin` reste NUL : une zone n'est pas un magasin. Voir la
    // migration 2026-09-09_initialisation_exploitation.
    sqlx::query(
        "INSERT INTO machine_emplacement
             (code_emplacement, code_machine, role, numero_etage,
              capacite_bobines, code_magasin, actif)
         VALUES ($1,$2,$3,$4,$5,NULL,1)
         ON CONFLICT (code_emplacement) DO UPDATE
            SET role = excluded.role,
                numero_etage = excluded.numero_etage,
                capacite_bobines = excluded.capacite_bobines,
                actif = 1",
    )
    .bind(&z.code)
    .bind(code_machine)
    .bind(&z.role)
    .bind(z.numero)
    .bind(z.capacite)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// `POST /api/machines` — declarer une machine.
///
/// Reserve a `PARAMETRES/ECRIRE`, c'est-a-dire a la direction et aux
/// super-utilisateurs : le parc machine est du parametrage, pas de la saisie
/// quotidienne. Un magasinier qui se tromperait de capacite fausserait toute la
/// consommation de la machine.
pub async fn creer_machine(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(m): Json<MachineSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Ecrire)
        .await?;

    let code = m
        .code_machine
        .clone()
        .unwrap_or_default()
        .trim()
        .to_uppercase();
    if code.is_empty() {
        return Err(AppError::Invalide("le code de la machine est requis".into()));
    }

    let zones = preparer(&code, &m)?;
    let capacite: i64 = zones.iter().map(|z| z.capacite).sum();
    let nb_etages = zones.iter().filter(|z| z.role == "ETAGE").count() as i64;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    sqlx::query(
        // `actif` est une colonne GENEREE depuis `etat` : l'ecrire echouerait.
        "INSERT INTO machine (code_machine, nom, capacite_bobines, nb_etages,
                              code_atelier, notes, etat, date_etat)
         VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',
                 to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))",
    )
    .bind(&code)
    .bind(m.nom.trim())
    .bind(capacite)
    .bind(nb_etages)
    .bind(&m.code_atelier)
    .bind(&m.notes)
    .execute(&mut *tx)
    .await?;

    for z in &zones {
        ecrire_zone(&mut tx, &code, z).await?;
    }

    tx.commit().await?;
    Ok(Json(json!({
        "code_machine": code,
        "capacite_bobines": capacite,
        "nb_etages": nb_etages,
        "zones": zones.iter().map(|z| json!({
            "code_emplacement": z.code,
            "role": z.role,
            "capacite_bobines": z.capacite,
        })).collect::<Vec<_>>(),
    })))
}

/// `PUT /api/machines/{code}` — corriger une machine declaree.
///
/// ON NE CORRIGE PAS UNE MACHINE QUI PORTE DU FIL, du moins pas n'importe
/// comment. Deux refus, et ils protegent la meme chose :
///
///   - retirer une zone qui porte des bobines les ferait disparaitre sans
///     qu'aucun magasin les recoive ;
///   - reduire une capacite sous le nombre de bobines constatees mettrait la
///     zone en contradiction avec elle-meme, et la prochaine fiche serait
///     refusee sans que personne comprenne pourquoi.
///
/// Dans les deux cas la reponse est la meme : dechargez d'abord, corrigez
/// ensuite. Le fil qui quitte une machine passe par un mouvement, toujours.
pub async fn modifier_machine(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
    Json(m): Json<MachineSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Ecrire)
        .await?;

    let code = code.trim().to_uppercase();
    let existe: Option<(String,)> =
        sqlx::query_as("SELECT code_machine FROM machine WHERE code_machine = $1")
            .bind(&code)
            .fetch_optional(&state.db)
            .await?;
    if existe.is_none() {
        return Err(AppError::Introuvable(format!("machine {code}")));
    }

    let zones = preparer(&code, &m)?;
    let capacite: i64 = zones.iter().map(|z| z.capacite).sum();
    let nb_etages = zones.iter().filter(|z| z.role == "ETAGE").count() as i64;

    // Ce que chaque zone porte reellement, avant de la toucher.
    let portees: Vec<(String, i64)> = sqlx::query_as(
        "SELECT e.code_emplacement,
                -- `sum()` rend du NUMERIC, que sqlx ne sait pas decoder en i64 :
                -- la conversion est explicite, comme partout ailleurs.
                COALESCE((SELECT sum(s.nb_bobines) FROM machine_etat s
                           WHERE s.code_emplacement = e.code_emplacement), 0)::bigint
           FROM machine_emplacement e
          WHERE e.code_machine = $1 AND e.actif = 1",
    )
    .bind(&code)
    .fetch_all(&state.db)
    .await?;

    for (zone, bobines) in &portees {
        match zones.iter().find(|z| &z.code == zone) {
            None if *bobines > 0 => {
                return Err(AppError::RegleMetier(format!(
                    "{zone} porte {bobines} bobines : \
                     dechargez-la avant de la retirer de la machine"
                )))
            }
            Some(z) if z.capacite < *bobines => {
                return Err(AppError::RegleMetier(format!(
                    "{zone} porte {bobines} bobines et vous la ramenez a {} places : \
                     dechargez la difference d abord",
                    z.capacite
                )))
            }
            _ => {}
        }
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // Les zones retirees — vides, on vient de le verifier.
    let gardees: Vec<String> = zones.iter().map(|z| z.code.clone()).collect();
    sqlx::query(
        "DELETE FROM machine_emplacement
          WHERE code_machine = $1 AND code_emplacement <> ALL($2)",
    )
    .bind(&code)
    .bind(&gardees)
    .execute(&mut *tx)
    .await?;

    // LE NOMBRE D'ETAGES MONTE AVANT LES ZONES, ET DESCEND APRES. Le declencheur
    // `trg_empl_numero` refuse un etage au-dela de `nb_etages`, et
    // `trg_machine_nb_etages` refuse de descendre sous l'etage le plus haut : il
    // faut donc agrandir d'abord, retrecir ensuite.
    sqlx::query("UPDATE machine SET nb_etages = GREATEST(nb_etages, $2) WHERE code_machine = $1")
        .bind(&code)
        .bind(nb_etages)
        .execute(&mut *tx)
        .await?;

    for z in &zones {
        ecrire_zone(&mut tx, &code, z).await?;
    }

    // L'ETAT NE SE CHANGE PAS ICI. Configurer une machine et la declarer en
    // panne sont deux gestes differents, faits a des moments differents et
    // souvent par des gens differents : voir `changer_etat`.
    sqlx::query(
        "UPDATE machine
            SET nom = $2, capacite_bobines = $3, nb_etages = $4,
                code_atelier = $5, notes = $6
          WHERE code_machine = $1",
    )
    .bind(&code)
    .bind(m.nom.trim())
    .bind(capacite)
    .bind(nb_etages)
    .bind(&m.code_atelier)
    .bind(&m.notes)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({
        "code_machine": code,
        "capacite_bobines": capacite,
        "nb_etages": nb_etages,
        "zones": zones.len(),
    })))
}

#[derive(Debug, Deserialize)]
pub struct ChangementEtat {
    /// ACTIVE, PANNE, SOMMEIL ou RETIREE.
    pub etat: String,
    pub motif: Option<String>,
}

/// `PATCH /api/machines/{code}/etat` — declarer une machine en panne, en
/// sommeil, remise en production ou retiree du parc.
///
/// POURQUOI QUATRE ETATS ET PAS UN INTERRUPTEUR. Devant un metier arrete, la
/// question n'est jamais « est-il actif ? » mais « pourquoi ne tourne-t-il
/// pas ? ». Une panne appelle un technicien, un sommeil appelle une commande,
/// un retrait n'appelle rien. Un booleen efface la difference, et avec elle la
/// seule information utile.
///
/// UNE MACHINE RETIREE NE PORTE PLUS RIEN. C'est le seul etat qui refuse : si
/// le metier sort du parc avec ses bobines dessus, le fil disparait des comptes
/// sans qu'aucun magasin le recoive. Les trois autres etats n'imposent rien —
/// on decharge une machine en panne, cela arrive tous les jours.
///
/// LE MOTIF EST EXIGE SAUF POUR UN RETOUR EN PRODUCTION. « En panne » sans
/// raison ne dit rien a celui qui lira la fiche dans trois semaines ; remettre
/// en marche, en revanche, se passe d'explication.
pub async fn changer_etat(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
    Json(c): Json<ChangementEtat>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Ecrire)
        .await?;

    let code = code.trim().to_uppercase();
    let etat = c.etat.trim().to_uppercase();
    if !["ACTIVE", "PANNE", "SOMMEIL", "RETIREE"].contains(&etat.as_str()) {
        return Err(AppError::Invalide(format!(
            "etat inconnu : {etat}. Les etats sont ACTIVE, PANNE, SOMMEIL et RETIREE"
        )));
    }

    let motif = c.motif.unwrap_or_default().trim().to_string();
    if etat != "ACTIVE" && motif.is_empty() {
        return Err(AppError::Invalide(
            "dites pourquoi : une machine arretee sans motif ne se comprend plus \
             au bout de quelques jours"
                .into(),
        ));
    }

    let machine: Option<(String, String)> =
        sqlx::query_as("SELECT nom, etat FROM machine WHERE code_machine = $1")
            .bind(&code)
            .fetch_optional(&state.db)
            .await?;
    let (nom, ancien) = machine.ok_or_else(|| AppError::Introuvable(format!("machine {code}")))?;

    if etat == "RETIREE" {
        let bobines: i64 = sqlx::query_scalar(
            "SELECT COALESCE(sum(s.nb_bobines), 0)::bigint
               FROM machine_emplacement e
               LEFT JOIN machine_etat s ON s.code_emplacement = e.code_emplacement
              WHERE e.code_machine = $1",
        )
        .bind(&code)
        .fetch_one(&state.db)
        .await?;
        if bobines > 0 {
            return Err(AppError::RegleMetier(format!(
                "{nom} porte encore {bobines} bobines : dechargez-la avant de la retirer du parc, \
                 sinon ce fil disparait des comptes sans qu aucun magasin le recoive"
            )));
        }
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    sqlx::query(
        "UPDATE machine
            SET etat = $2, motif_etat = NULLIF($3, ''),
                date_etat = to_char(now() AT TIME ZONE 'UTC',
                                    'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
          WHERE code_machine = $1",
    )
    .bind(&code)
    .bind(&etat)
    .bind(&motif)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(json!({
        "code_machine": code,
        "etat_precedent": ancien,
        "etat": etat,
        "motif": if motif.is_empty() { Value::Null } else { Value::from(motif) },
    })))
}

/// `DELETE /api/machines/{code}` — supprimer une machine jamais utilisee.
///
/// LA SUPPRESSION N'EST PAS L'ARCHIVAGE, et confondre les deux fait perdre de
/// l'historique. Une machine qui a travaille porte des fiches, des mouvements
/// et une consommation qui la citent : elle se RETIRE (etat RETIREE), son passe
/// reste consultable. Une machine creee par erreur, jamais chargee, sans une
/// seule fiche, ne laisse rien derriere elle : celle-la se supprime pour de
/// bon, et c'est le seul cas.
///
/// On refuse donc des qu'il existe la moindre trace, et le message dit laquelle.
pub async fn supprimer_machine(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Ecrire)
        .await?;

    let code = code.trim().to_uppercase();
    let nom: Option<(String,)> =
        sqlx::query_as("SELECT nom FROM machine WHERE code_machine = $1")
            .bind(&code)
            .fetch_optional(&state.db)
            .await?;
    let (nom,) = nom.ok_or_else(|| AppError::Introuvable(format!("machine {code}")))?;

    let fiches: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM machine_fiche WHERE code_machine = $1",
    )
    .bind(&code)
    .fetch_one(&state.db)
    .await?;
    if fiches > 0 {
        return Err(AppError::RegleMetier(format!(
            "{nom} porte {fiches} fiche(s) : elle a travaille, on ne l efface pas. \
             Retirez-la du parc — son historique restera consultable"
        )));
    }

    let bobines: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(s.nb_bobines), 0)::bigint
           FROM machine_emplacement e
           LEFT JOIN machine_etat s ON s.code_emplacement = e.code_emplacement
          WHERE e.code_machine = $1",
    )
    .bind(&code)
    .fetch_one(&state.db)
    .await?;
    if bobines > 0 {
        return Err(AppError::RegleMetier(format!(
            "{nom} porte {bobines} bobines : dechargez-la d abord"
        )));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    sqlx::query("DELETE FROM machine_emplacement WHERE code_machine = $1")
        .bind(&code)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM machine WHERE code_machine = $1")
        .bind(&code)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Json(json!({ "code_machine": code, "supprimee": true })))
}
