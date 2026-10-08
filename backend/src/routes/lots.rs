//! LES LOTS — registre, fiche de vie, decisions et autorisations.
//!
//! Le cahier « Gestion des lots » (02/10/2026) en est la source : un lot est
//! une production du fournisseur ; il est LIBRE, BLOQUE (qualite) ou SOLDE ; il
//! compte pour le plan d'achat (PROJET) ou n'est plus qu'un reste (RESTES) ;
//! il devient DORMANT apres un an sans activite (calcule, jamais stocke).
//!
//! RIEN NE S'EFFACE. Chaque decision ecrit un evenement avec son motif ; un
//! solde ou une destruction passe par un mouvement, jamais par une ecriture
//! directe dans le stock.
//!
//! LES ROLES « responsable qualite » et « chef d'atelier » n'existent pas
//! encore : bloquer, debloquer et decider d'une autorisation demandent le
//! droit VALIDER sur le stock, en attendant ces profils [A DEFINIR].

use super::json::lignes_en_json;
use super::stock::numeroter;
use crate::auth::{rbac, rbac::module, rbac::Action, Utilisateur};
use crate::db::{arrondi_kg, maintenant};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

fn texte_requis(s: &str, quoi: &str) -> AppResult<String> {
    let t = s.trim();
    if t.is_empty() {
        return Err(AppError::Invalide(format!("{quoi} est obligatoire.")));
    }
    Ok(t.to_string())
}

/// Un evenement dans la vie d'un lot, motif compris.
async fn evenement(
    tx: &mut sqlx::PgConnection,
    user: &Utilisateur,
    reference: &str,
    lot: &str,
    type_evenement: &str,
    motif: &str,
    details: Value,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO lot_evenement (code_reference, lot_fournisseur, type_evenement, motif, details, id_utilisateur)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(reference)
    .bind(lot)
    .bind(type_evenement)
    .bind(motif)
    .bind(details)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Le lot tel que le registre le connait ; introuvable : une erreur claire.
async fn lire_lot(
    tx: &mut sqlx::PgConnection,
    reference: &str,
    lot: &str,
) -> AppResult<(String, String, Option<String>)> {
    sqlx::query_as::<_, (String, String, Option<String>)>(
        "SELECT statut, categorie, code_fournisseur FROM lot
          WHERE code_reference = $1 AND lot_fournisseur = $2 FOR UPDATE",
    )
    .bind(reference)
    .bind(lot)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("lot {lot} de {reference}")))
}

// ============================================================================
// Lecture
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct FiltreLots {
    /// comptable (defaut), projet, restes, a_basculer, dormants, bloques, derive
    pub vue: Option<String>,
    pub code_reference: Option<String>,
    pub code_fournisseur: Option<String>,
    /// 1 : garder aussi les lots a solde nul (historique).
    pub tous: Option<String>,
    pub limite: Option<i64>,
}

/// `GET /api/lots` — LES TROIS VUES DE STOCK, et les listes d'alerte.
///
/// Comptable : tout lot qui porte du stock. Projet et Restes : les lots
/// LIBRES et actifs de chaque categorie — les bloques et les dormants ne se
/// lisent qu'en vue comptable (decision n° 7 du cahier). La somme Projet +
/// Restes + bloques + dormants refait donc la vue comptable.
pub async fn lister(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<FiltreLots>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let vue = f.vue.as_deref().unwrap_or("comptable");
    let condition = match vue {
        "comptable" => "TRUE",
        "projet" => "categorie = 'PROJET' AND statut = 'LIBRE' AND NOT dormant",
        "restes" => "categorie = 'RESTES' AND statut = 'LIBRE' AND NOT dormant",
        "a_basculer" => "a_basculer",
        "dormants" => "dormant",
        "bloques" => "statut = 'BLOQUE'",
        "derive" => "alerte_derive IN ('ORANGE','ROUGE')",
        autre => return Err(AppError::Invalide(format!("vue inconnue : {autre}"))),
    };
    let tous = matches!(f.tous.as_deref(), Some("1" | "true"));
    let sql = format!(
        "SELECT * FROM v_lot
          WHERE {condition}
            AND ($1::text IS NULL OR code_reference = $1)
            AND ($2::text IS NULL OR code_fournisseur = $2)
            AND ($3 OR solde_kg > 0)
          ORDER BY code_reference, date_creation
          LIMIT $4"
    );
    let rows = sqlx::query(&sql)
        .bind(&f.code_reference)
        .bind(&f.code_fournisseur)
        .bind(tous)
        .bind(f.limite.unwrap_or(2000).clamp(1, 10000))
        .fetch_all(&state.db)
        .await?;
    let mut v = lignes_en_json(&rows);
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/lots/compteurs` — ce que chaque vue contient, pour les onglets.
pub async fn compteurs(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let row = sqlx::query(
        "SELECT count(*) FILTER (WHERE solde_kg > 0)                                              AS comptable,
                count(*) FILTER (WHERE solde_kg > 0 AND categorie = 'PROJET' AND statut = 'LIBRE' AND NOT dormant) AS projet,
                count(*) FILTER (WHERE solde_kg > 0 AND categorie = 'RESTES' AND statut = 'LIBRE' AND NOT dormant) AS restes,
                count(*) FILTER (WHERE a_basculer)                                                AS a_basculer,
                count(*) FILTER (WHERE dormant)                                                   AS dormants,
                count(*) FILTER (WHERE solde_kg > 0 AND statut = 'BLOQUE')                        AS bloques,
                count(*) FILTER (WHERE solde_kg > 0 AND alerte_derive IN ('ORANGE','ROUGE'))      AS derive,
                (SELECT count(*) FROM demande_autorisation WHERE statut = 'EN_ATTENTE')           AS autorisations
           FROM v_lot",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&row).get(0).cloned().unwrap_or(Value::Null)))
}

#[derive(Debug, Deserialize)]
pub struct CleLot {
    pub reference: String,
    pub lot: String,
}

/// `GET /api/lots/vie?reference=…&lot=…` — LA FICHE DE VIE : identite, solde
/// par lieu, et tout ce qui est arrive au lot, dans l'ordre.
pub async fn vie(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(c): Query<CleLot>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let lot = sqlx::query("SELECT * FROM v_lot WHERE code_reference = $1 AND lot_fournisseur = $2")
        .bind(&c.reference)
        .bind(&c.lot)
        .fetch_all(&state.db)
        .await?;
    if lot.is_empty() {
        return Err(AppError::Introuvable(format!("lot {} de {}", c.lot, c.reference)));
    }
    let lieux = sqlx::query(
        "SELECT sl.code_magasin, m.nom AS magasin_nom, sl.quantite_kg, sl.nb_bobines, sl.code_couleur
           FROM stock_lot sl JOIN magasin m ON m.code_magasin = sl.code_magasin
          WHERE sl.code_reference = $1 AND sl.lot_fournisseur = $2 AND sl.quantite_kg > 0
          ORDER BY sl.code_magasin",
    )
    .bind(&c.reference)
    .bind(&c.lot)
    .fetch_all(&state.db)
    .await?;
    let machines = sqlx::query(
        "SELECT e.code_emplacement, me.libelle AS zone, me.code_machine, e.nb_bobines, e.kg
           FROM machine_etat e LEFT JOIN machine_emplacement me ON me.code_emplacement = e.code_emplacement
          WHERE e.code_reference = $1 AND e.lot_fournisseur = $2 AND e.nb_bobines > 0",
    )
    .bind(&c.reference)
    .bind(&c.lot)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let evenements = sqlx::query(
        "SELECT * FROM v_lot_vie WHERE code_reference = $1 AND lot_fournisseur = $2
          ORDER BY date_evenement, nature",
    )
    .bind(&c.reference)
    .bind(&c.lot)
    .fetch_all(&state.db)
    .await?;
    let mut v = json!({
        "lot": lignes_en_json(&lot).get(0).cloned().unwrap_or(Value::Null),
        "magasins": lignes_en_json(&lieux),
        "machines": lignes_en_json(&machines),
        "evenements": lignes_en_json(&evenements),
    });
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

// ============================================================================
// Decisions sur un lot
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct DecisionStatut {
    pub code_reference: String,
    pub lot_fournisseur: String,
    /// BLOQUER ou DEBLOQUER
    pub action: String,
    pub motif: String,
}

/// DECIDER D'UN LOT (regle 5, 08/10/2026) : accorder une derogation, bloquer,
/// debloquer, trancher un dormant. Ces decisions demandaient STOCK / VALIDER,
/// que seul l'administrateur detenait : la Direction ne pouvait pas repondre.
/// L'autorite est desormais le droit VALIDER du module LOTS, ou la Direction.
async fn exiger_decision_lot(state: &AppState, user: &Utilisateur) -> AppResult<()> {
    if user.role == "DIRECTION" {
        return Ok(());
    }
    user.exiger(&state.db, module::LOTS, Action::Valider).await
}

/// `POST /api/lots/statut` — BLOCAGE QUALITE (regle 4). Un lot bloque ne bouge
/// plus du tout : la base refuse le mouvement (LOT-BLOQUE). Seul un
/// responsable le debloque, avec un motif.
pub async fn changer_statut(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(d): Json<DecisionStatut>,
) -> AppResult<Json<Value>> {
    exiger_decision_lot(&state, &user).await?;
    let motif = texte_requis(&d.motif, "Le motif")?;
    let (nouveau, evt) = match d.action.as_str() {
        "BLOQUER" => ("BLOQUE", "BLOCAGE"),
        "DEBLOQUER" => ("LIBRE", "DEBLOCAGE"),
        a => return Err(AppError::Invalide(format!("action inconnue : {a}"))),
    };
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let (statut, _, _) = lire_lot(&mut tx, &d.code_reference, &d.lot_fournisseur).await?;
    if statut == "SOLDE" {
        return Err(AppError::RegleMetier("Ce lot est solde : il n'a plus de stock a bloquer.".into()));
    }
    if statut == nouveau {
        return Err(AppError::RegleMetier(format!("Le lot est deja {}.", nouveau.to_lowercase())));
    }
    sqlx::query("UPDATE lot SET statut = $3 WHERE code_reference = $1 AND lot_fournisseur = $2")
        .bind(&d.code_reference)
        .bind(&d.lot_fournisseur)
        .bind(nouveau)
        .execute(&mut *tx)
        .await?;
    evenement(&mut tx, &user, &d.code_reference, &d.lot_fournisseur, evt, &motif, json!({ "avant": statut })).await?;
    tx.commit().await?;
    Ok(Json(json!({ "statut": nouveau })))
}

#[derive(Debug, Deserialize)]
pub struct DecisionCategorie {
    pub code_reference: String,
    pub lot_fournisseur: String,
    /// RESTES ou PROJET
    pub categorie: String,
    pub motif: Option<String>,
}

/// `POST /api/lots/basculer` — PROJET -> RESTES, geste MANUEL mais obligatoire
/// quand le lot passe sous le seuil (regle 5). Le retour en Projet demande un
/// motif : c'est un choix contre la regle.
pub async fn basculer(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(d): Json<DecisionCategorie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Ecrire).await?;
    let (evt, motif) = match d.categorie.as_str() {
        "RESTES" => ("BASCULEMENT_RESTES", d.motif.clone().filter(|m| !m.trim().is_empty())
            .unwrap_or_else(|| "Lot passe sous le seuil de l'article".into())),
        "PROJET" => ("RETOUR_PROJET", texte_requis(d.motif.as_deref().unwrap_or(""), "Le motif du retour en Projet")?),
        c => return Err(AppError::Invalide(format!("categorie inconnue : {c}"))),
    };
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let (_, categorie, _) = lire_lot(&mut tx, &d.code_reference, &d.lot_fournisseur).await?;
    if categorie == d.categorie {
        return Err(AppError::RegleMetier(format!("Le lot est deja en {}.", d.categorie.to_lowercase())));
    }
    sqlx::query("UPDATE lot SET categorie = $3 WHERE code_reference = $1 AND lot_fournisseur = $2")
        .bind(&d.code_reference)
        .bind(&d.lot_fournisseur)
        .bind(&d.categorie)
        .execute(&mut *tx)
        .await?;
    evenement(&mut tx, &user, &d.code_reference, &d.lot_fournisseur, evt, &motif, json!({ "avant": categorie })).await?;
    tx.commit().await?;
    Ok(Json(json!({ "categorie": d.categorie })))
}

#[derive(Debug, Deserialize)]
pub struct DecisionDormant {
    pub code_reference: String,
    pub lot_fournisseur: String,
    /// GARDER, SOLDER ou DETRUIRE
    pub decision: String,
    pub motif: String,
}

/// `POST /api/lots/dormant` — LA DECISION SUR UN LOT DORMANT (regle 3).
/// Garder remet le compteur a zero ; solder ou detruire sort tout le stock du
/// lot par un ajustement d'inventaire motive, magasin par magasin.
pub async fn decider_dormant(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(d): Json<DecisionDormant>,
) -> AppResult<Json<Value>> {
    exiger_decision_lot(&state, &user).await?;
    let motif = texte_requis(&d.motif, "Le motif")?;
    if !matches!(d.decision.as_str(), "GARDER" | "SOLDER" | "DETRUIRE") {
        return Err(AppError::Invalide(format!("decision inconnue : {}", d.decision)));
    }
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let (statut, _, _) = lire_lot(&mut tx, &d.code_reference, &d.lot_fournisseur).await?;
    if statut == "BLOQUE" && d.decision != "GARDER" {
        return Err(AppError::RegleMetier("Ce lot est bloque : la qualite doit d'abord le debloquer.".into()));
    }
    let mut mouvements = Vec::new();
    if d.decision == "GARDER" {
        sqlx::query("UPDATE lot SET date_derniere_activite = $3 WHERE code_reference = $1 AND lot_fournisseur = $2")
            .bind(&d.code_reference)
            .bind(&d.lot_fournisseur)
            .bind(maintenant())
            .execute(&mut *tx)
            .await?;
    } else {
        let soldes: Vec<(String, f64, i64)> = sqlx::query_as(
            "SELECT code_magasin, quantite_kg::float8, nb_bobines FROM stock_lot
              WHERE code_reference = $1 AND lot_fournisseur = $2 AND quantite_kg > 0",
        )
        .bind(&d.code_reference)
        .bind(&d.lot_fournisseur)
        .fetch_all(&mut *tx)
        .await?;
        for (magasin, kg, bobines) in soldes {
            let numero = numeroter(&mut tx, "mouvement", "numero_mouvement", "MVT").await?;
            let id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO mouvement (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt, code_magasin,
                                        code_motif, reference_document, observations_globales, id_utilisateur)
                 VALUES ($1, $2, $3, 'AJUST_INV_NEG', $4, 'INVENTAIRE', $5, $6, $7)",
            )
            .bind(&id)
            .bind(&numero)
            .bind(chrono::Utc::now().format("%Y-%m-%d").to_string())
            .bind(&magasin)
            .bind(format!("LOT {}", d.lot_fournisseur))
            .bind(format!("{} du lot dormant {} : {motif}", if d.decision == "SOLDER" { "Solde" } else { "Destruction" }, d.lot_fournisseur))
            .bind(&user.id)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO ligne_mouvement (id_mouvement, ligne_numero, code_reference, quantite_kg,
                                              lot_fournisseur, nb_bobines, code_motif_ligne)
                 VALUES ($1, 1, $2, $3, $4, NULLIF($5, 0), $6)",
            )
            .bind(&id)
            .bind(&d.code_reference)
            .bind(arrondi_kg(kg))
            .bind(&d.lot_fournisseur)
            .bind(bobines)
            .bind(if d.decision == "DETRUIRE" { "R4" } else { "R6" })
            .execute(&mut *tx)
            .await?;
            mouvements.push(numero);
        }
        sqlx::query("UPDATE lot SET statut = 'SOLDE' WHERE code_reference = $1 AND lot_fournisseur = $2")
            .bind(&d.code_reference)
            .bind(&d.lot_fournisseur)
            .execute(&mut *tx)
            .await?;
    }
    evenement(&mut tx, &user, &d.code_reference, &d.lot_fournisseur, "DECISION_DORMANT", &motif,
        json!({ "decision": d.decision, "mouvements": mouvements })).await?;
    tx.commit().await?;
    Ok(Json(json!({ "decision": d.decision, "mouvements": mouvements })))
}

#[derive(Debug, Deserialize)]
pub struct DemandeFusion {
    pub code_reference: String,
    /// Le lot qui recoit ; il garde son numero.
    pub lot_cible: String,
    pub lots_sources: Vec<String>,
    pub code_magasin: String,
    pub motif: String,
}

/// `POST /api/lots/fusion` — LA FUSION (regle 7) : au choix de l'utilisateur,
/// seulement entre lots du meme article, du meme fournisseur et de la meme
/// couleur. Les kilos passent d'un lot a l'autre DANS LE MEME MAGASIN par deux
/// mouvements internes, sans effet sur le cout moyen.
pub async fn fusionner(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(d): Json<DemandeFusion>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    let motif = texte_requis(&d.motif, "Le motif")?;
    if d.lots_sources.is_empty() {
        return Err(AppError::Invalide("Choisissez au moins un lot a fusionner.".into()));
    }
    if d.lots_sources.iter().any(|s| s == &d.lot_cible) {
        return Err(AppError::Invalide("Un lot ne se fusionne pas avec lui-meme.".into()));
    }
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    // LA FUSION SE PERMET ARTICLE PAR ARTICLE (fiche article, « Gestion des
    // lots ») : un fil dont les bains ne se melangent pas la refuse.
    let permise: Option<i64> = sqlx::query_scalar("SELECT fusion_lot FROM reference WHERE code_reference = $1")
        .bind(&d.code_reference)
        .fetch_optional(&mut *tx)
        .await?;
    if permise != Some(1) {
        return Err(AppError::RegleMetier(format!(
            "La fusion des lots n'est pas autorisee pour {} (fiche article, Gestion des lots).",
            d.code_reference
        )));
    }
    let (st_cible, _, frs_cible) = lire_lot(&mut tx, &d.code_reference, &d.lot_cible).await?;
    if st_cible != "LIBRE" {
        return Err(AppError::RegleMetier(format!("Le lot {} est {} : il ne recoit pas de fusion.", d.lot_cible, st_cible.to_lowercase())));
    }
    let couleur_cible: Option<String> = sqlx::query_scalar(
        "SELECT code_couleur FROM stock_lot WHERE code_reference = $1 AND lot_fournisseur = $2 AND code_magasin = $3",
    )
    .bind(&d.code_reference)
    .bind(&d.lot_cible)
    .bind(&d.code_magasin)
    .fetch_optional(&mut *tx)
    .await?
    .flatten();

    // Les sorties d'abord, en un mouvement ; l'entree ensuite, en un autre.
    let mut sorties: Vec<(String, f64, i64)> = Vec::new();
    for source in &d.lots_sources {
        let (st, _, frs) = lire_lot(&mut tx, &d.code_reference, source).await?;
        if st != "LIBRE" {
            return Err(AppError::RegleMetier(format!("Le lot {source} est {} : il ne se fusionne pas.", st.to_lowercase())));
        }
        if frs.is_some() && frs_cible.is_some() && frs != frs_cible {
            return Err(AppError::RegleMetier(format!("Le lot {source} vient d'un autre fournisseur : la fusion est refusee.")));
        }
        let (kg, bobines, couleur): (f64, i64, Option<String>) = sqlx::query_as(
            "SELECT quantite_kg::float8, nb_bobines, code_couleur FROM stock_lot
              WHERE code_reference = $1 AND lot_fournisseur = $2 AND code_magasin = $3",
        )
        .bind(&d.code_reference)
        .bind(source)
        .bind(&d.code_magasin)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::RegleMetier(format!("Le lot {source} n'a pas de stock dans ce magasin.")))?;
        if couleur.is_some() && couleur_cible.is_some() && couleur != couleur_cible {
            return Err(AppError::RegleMetier(format!("Le lot {source} n'a pas la meme couleur : la fusion est refusee.")));
        }
        if kg > 0.0 {
            sorties.push((source.clone(), kg, bobines));
        }
    }
    if sorties.is_empty() {
        return Err(AppError::RegleMetier("Les lots choisis n'ont aucun stock a fusionner dans ce magasin.".into()));
    }

    let reference_doc = format!("FUSION {}", d.lot_cible);
    let numeros = deplacer_entre_lots(
        &mut tx, &user, &d.code_reference, &d.code_magasin, &sorties, &d.lot_cible,
        &couleur_cible, "FUSION", &reference_doc, &motif,
    )
    .await?;
    for (source, kg, _) in &sorties {
        let reste: f64 = sqlx::query_scalar(
            "SELECT COALESCE(sum(quantite_kg), 0)::float8 FROM stock_lot WHERE code_reference = $1 AND lot_fournisseur = $2",
        )
        .bind(&d.code_reference)
        .bind(source)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE lot SET fusionne_dans = $3, statut = CASE WHEN $4 <= 0.0005 THEN 'SOLDE' ELSE statut END
              WHERE code_reference = $1 AND lot_fournisseur = $2",
        )
        .bind(&d.code_reference)
        .bind(source)
        .bind(&d.lot_cible)
        .bind(reste)
        .execute(&mut *tx)
        .await?;
        evenement(&mut tx, &user, &d.code_reference, source, "FUSION", &motif,
            json!({ "vers": d.lot_cible, "kg": arrondi_kg(*kg), "magasin": d.code_magasin })).await?;
        evenement(&mut tx, &user, &d.code_reference, &d.lot_cible, "FUSION", &motif,
            json!({ "depuis": source, "kg": arrondi_kg(*kg), "magasin": d.code_magasin })).await?;
    }
    sqlx::query("UPDATE lot SET origine = CASE WHEN origine = 'SANS_LOT' THEN origine ELSE 'FUSION' END WHERE code_reference = $1 AND lot_fournisseur = $2")
        .bind(&d.code_reference)
        .bind(&d.lot_cible)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({ "lot": d.lot_cible, "mouvements": numeros, "lots_fusionnes": sorties.len() })))
}

/// DEPLACER DU STOCK D'UN LOT A L'AUTRE, DANS UN MAGASIN : une sortie des lots
/// sources, puis une entree dans le lot cible, en deux mouvements INTERNES (sans
/// effet sur le cout moyen ni sur les statistiques). C'est la meme ecriture
/// pour la fusion et pour l'identification d'un lot.
#[allow(clippy::too_many_arguments)]
async fn deplacer_entre_lots(
    tx: &mut sqlx::PgConnection,
    user: &Utilisateur,
    reference: &str,
    magasin: &str,
    sorties: &[(String, f64, i64)],
    cible: &str,
    couleur: &Option<String>,
    code_motif: &str,
    reference_doc: &str,
    observations: &str,
) -> AppResult<Vec<String>> {
    let jour = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let mut numeros = Vec::new();
    for (type_mvt, entree) in [("FUSION_SORTIE", false), ("FUSION_ENTREE", true)] {
        let numero = numeroter(&mut *tx, "mouvement", "numero_mouvement", "MVT").await?;
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO mouvement (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt, code_magasin,
                                    code_motif, reference_document, observations_globales, id_utilisateur)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(&id)
        .bind(&numero)
        .bind(&jour)
        .bind(type_mvt)
        .bind(magasin)
        .bind(code_motif)
        .bind(reference_doc)
        .bind(observations)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;
        for (i, (source, kg, bobines)) in sorties.iter().enumerate() {
            sqlx::query(
                "INSERT INTO ligne_mouvement (id_mouvement, ligne_numero, code_reference, quantite_kg,
                                              lot_fournisseur, nb_bobines, code_couleur)
                 VALUES ($1, $2, $3, $4, $5, NULLIF($6, 0), $7)",
            )
            .bind(&id)
            .bind(i as i64 + 1)
            .bind(reference)
            .bind(arrondi_kg(*kg))
            .bind(if entree { cible } else { source.as_str() })
            .bind(*bobines)
            .bind(couleur)
            .execute(&mut *tx)
            .await?;
        }
        numeros.push(numero);
    }
    Ok(numeros)
}

#[derive(Debug, Deserialize)]
pub struct DemandeIdentification {
    pub code_reference: String,
    /// Le lot a renommer ; par defaut « SANS-LOT ».
    pub lot_source: Option<String>,
    /// Le numero lu sur l'etiquette du fournisseur.
    pub lot_cible: String,
    pub motif: Option<String>,
}

/// `POST /api/lots/identifier` — IDENTIFIER UN LOT : du stock range sous « Sans
/// lot » (ou sous un numero provisoire) recoit le numero lu sur l'etiquette du
/// fournisseur. Rien n'est renomme en silence : dans chaque magasin, le stock
/// sort du lot source et entre dans le lot identifie par deux mouvements
/// internes, et la vie des deux lots le dit.
pub async fn identifier(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(d): Json<DemandeIdentification>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    let source = d.lot_source.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or("SANS-LOT").to_string();
    let cible = d.lot_cible.trim().to_string();
    if cible.is_empty() || cible.eq_ignore_ascii_case("SANS-LOT") {
        return Err(AppError::Invalide("Saisissez le numero de lot lu sur l'etiquette.".into()));
    }
    if cible == source {
        return Err(AppError::Invalide("Le lot porte deja ce numero.".into()));
    }
    let motif = d.motif.as_deref().map(str::trim).filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| format!("Numero de lot identifie : {cible}"));

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let (st_source, _, frs_source) = lire_lot(&mut tx, &d.code_reference, &source).await?;
    if st_source == "BLOQUE" {
        return Err(AppError::RegleMetier(format!("Le lot {source} est bloque : debloquez-le avant de l'identifier.")));
    }
    let existe: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT statut, code_fournisseur FROM lot WHERE code_reference = $1 AND lot_fournisseur = $2 FOR UPDATE",
    )
    .bind(&d.code_reference)
    .bind(&cible)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((st, frs)) = &existe {
        if st == "BLOQUE" {
            return Err(AppError::RegleMetier(format!("Le lot {cible} existe et il est bloque.")));
        }
        if frs.is_some() && frs_source.is_some() && frs != &frs_source {
            return Err(AppError::RegleMetier(format!("Le lot {cible} existe chez un autre fournisseur.")));
        }
    }

    // Magasin par magasin : un mouvement porte un seul magasin.
    let stocks: Vec<(String, f64, i64, Option<String>)> = sqlx::query_as(
        "SELECT code_magasin, quantite_kg::float8, nb_bobines, code_couleur FROM stock_lot
          WHERE code_reference = $1 AND lot_fournisseur = $2 AND quantite_kg > 0
          ORDER BY code_magasin",
    )
    .bind(&d.code_reference)
    .bind(&source)
    .fetch_all(&mut *tx)
    .await?;
    if stocks.is_empty() {
        return Err(AppError::RegleMetier(format!("Le lot {source} n'a pas de stock a identifier.")));
    }
    let reference_doc = format!("IDENTIFICATION {cible}");
    let mut mouvements = Vec::new();
    let mut total = 0.0;
    for (magasin, kg, bobines, couleur) in &stocks {
        let sorties = vec![(source.clone(), *kg, *bobines)];
        mouvements.extend(
            deplacer_entre_lots(&mut tx, &user, &d.code_reference, magasin, &sorties, &cible,
                couleur, "IDENTIFICATION", &reference_doc, &motif).await?,
        );
        total += kg;
    }
    // Le lot identifie porte le numero du fournisseur ; la source videe est soldee.
    sqlx::query(
        "UPDATE lot l SET origine = 'FOURNISSEUR',
                          code_fournisseur = COALESCE(l.code_fournisseur, $3, r.code_fournisseur)
           FROM reference r
          WHERE r.code_reference = l.code_reference AND l.code_reference = $1 AND l.lot_fournisseur = $2",
    )
    .bind(&d.code_reference)
    .bind(&cible)
    .bind(&frs_source)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE lot SET statut = 'SOLDE'
          WHERE code_reference = $1 AND lot_fournisseur = $2
            AND NOT EXISTS (SELECT 1 FROM stock_lot sl WHERE sl.code_reference = $1
                               AND sl.lot_fournisseur = $2 AND sl.quantite_kg > 0)",
    )
    .bind(&d.code_reference)
    .bind(&source)
    .execute(&mut *tx)
    .await?;
    let details = json!({ "depuis": source, "vers": cible, "kg": arrondi_kg(total), "mouvements": mouvements });
    evenement(&mut tx, &user, &d.code_reference, &source, "IDENTIFICATION", &motif, details.clone()).await?;
    evenement(&mut tx, &user, &d.code_reference, &cible, "IDENTIFICATION", &motif, details).await?;
    tx.commit().await?;
    Ok(Json(json!({ "lot": cible, "kg": arrondi_kg(total), "mouvements": mouvements })))
}

// ============================================================================
// Autorisations
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct FiltreDemandes {
    pub statut: Option<String>,
    pub document: Option<String>,
}

/// `GET /api/autorisations` — la file des demandes, la plus ancienne d'abord.
pub async fn lister_demandes(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<FiltreDemandes>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT d.*, ud.login AS demandeur, uc.login AS decideur
           FROM demande_autorisation d
           LEFT JOIN utilisateur ud ON ud.id_utilisateur = d.id_demandeur
           LEFT JOIN utilisateur uc ON uc.id_utilisateur = d.id_decideur
          WHERE ($1::text IS NULL OR d.statut = $1)
            AND ($2::text IS NULL OR d.document = $2)
          ORDER BY (d.statut = 'EN_ATTENTE') DESC, d.date_demande
          LIMIT 1000",
    )
    .bind(&f.statut)
    .bind(&f.document)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&rows)))
}

#[derive(Debug, Deserialize)]
pub struct NouvelleDemande {
    pub type_demande: String,
    pub niveau: Option<String>,
    pub code_reference: Option<String>,
    pub lot_fournisseur: Option<String>,
    pub document: Option<String>,
    pub motif: String,
    pub details: Option<Value>,
}

/// `POST /api/autorisations` — une demande ROUGE (ou ORANGE tracee), motif
/// obligatoire. Une meme demande en attente pour le meme document et le meme
/// lot n'est pas dupliquee : on reprend celle qui existe.
pub async fn creer_demande(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(d): Json<NouvelleDemande>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let motif = texte_requis(&d.motif, "Le motif")?;
    let existante: Option<String> = sqlx::query_scalar(
        "SELECT id_demande FROM demande_autorisation
          WHERE statut = 'EN_ATTENTE' AND type_demande = $1
            AND document IS NOT DISTINCT FROM $2
            AND lot_fournisseur IS NOT DISTINCT FROM $3 AND code_reference IS NOT DISTINCT FROM $4",
    )
    .bind(&d.type_demande)
    .bind(&d.document)
    .bind(&d.lot_fournisseur)
    .bind(&d.code_reference)
    .fetch_optional(&state.db)
    .await?;
    if let Some(id) = existante {
        return Ok(Json(json!({ "id_demande": id, "reprise": true })));
    }
    let id: String = sqlx::query_scalar(
        "INSERT INTO demande_autorisation (type_demande, niveau, code_reference, lot_fournisseur, document,
                                           details, motif, id_demandeur)
         VALUES ($1, COALESCE($2, 'ROUGE'), $3, $4, $5, $6, $7, $8) RETURNING id_demande",
    )
    .bind(&d.type_demande)
    .bind(&d.niveau)
    .bind(&d.code_reference)
    .bind(&d.lot_fournisseur)
    .bind(&d.document)
    .bind(&d.details)
    .bind(&motif)
    .bind(&user.id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({ "id_demande": id, "reprise": false })))
}

#[derive(Debug, Deserialize)]
pub struct Decision {
    /// ACCORDEE, REFUSEE ou ANNULEE (le demandeur retire sa demande)
    pub decision: String,
    pub motif: Option<String>,
}

/// `POST /api/autorisations/{id}/decider` — la reponse d'un responsable. On
/// n'autorise pas sa propre demande (sauf l'administrateur, comme pour la
/// validation des bons). Un refus demande un motif.
pub async fn decider(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(d): Json<Decision>,
) -> AppResult<Json<Value>> {
    let (statut, demandeur, reference, lot, type_demande): (String, String, Option<String>, Option<String>, String) =
        sqlx::query_as(
            "SELECT statut, id_demandeur, code_reference, lot_fournisseur, type_demande
               FROM demande_autorisation WHERE id_demande = $1",
        )
        .bind(&id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("demande {id}")))?;
    if statut != "EN_ATTENTE" {
        return Err(AppError::RegleMetier(format!("Cette demande est deja {}.", statut.to_lowercase())));
    }
    match d.decision.as_str() {
        "ANNULEE" => {
            if demandeur != user.id {
                return Err(AppError::RegleMetier("Seul le demandeur retire sa demande.".into()));
            }
        }
        "ACCORDEE" | "REFUSEE" => {
            exiger_decision_lot(&state, &user).await?;
            if demandeur == user.id && user.role != "ADMIN" {
                return Err(AppError::RegleMetier("On n'autorise pas sa propre demande : un autre responsable doit repondre.".into()));
            }
        }
        x => return Err(AppError::Invalide(format!("decision inconnue : {x}"))),
    }
    let motif = d.motif.clone().filter(|m| !m.trim().is_empty());
    if d.decision == "REFUSEE" && motif.is_none() {
        return Err(AppError::Invalide("Un refus s'explique : le motif est obligatoire.".into()));
    }
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    sqlx::query(
        "UPDATE demande_autorisation
            SET statut = $2, id_decideur = $3, date_decision = $4, motif_decision = $5
          WHERE id_demande = $1 AND statut = 'EN_ATTENTE'",
    )
    .bind(&id)
    .bind(&d.decision)
    .bind(&user.id)
    .bind(maintenant())
    .bind(&motif)
    .execute(&mut *tx)
    .await?;
    // Une derogation accordee laisse aussi sa trace sur la fiche du lot.
    if d.decision == "ACCORDEE" {
        if let (Some(r), Some(l)) = (reference.as_deref(), lot.as_deref()) {
            let existe: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM lot WHERE code_reference = $1 AND lot_fournisseur = $2)")
                .bind(r).bind(l).fetch_one(&mut *tx).await?;
            if existe {
                evenement(&mut tx, &user, r, l, "DEROGATION",
                    motif.as_deref().unwrap_or("Autorisation accordee"),
                    json!({ "demande": id, "type": type_demande })).await?;
            }
        }
    }
    tx.commit().await?;
    Ok(Json(json!({ "id_demande": id, "statut": d.decision })))
}

// ============================================================================
// Statistiques et cockpit
// ============================================================================

/// `GET /api/stats/lots` — tout ce que l'analyse lit sur les lots, en un appel.
pub async fn statistiques(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let db = &state.db;
    let lire = |sql: &'static str| async move {
        sqlx::query(sql).fetch_all(db).await.map(|r| lignes_en_json(&r))
    };
    let mut v = json!({
        "categories": lire("SELECT * FROM v_stat_lot_categorie ORDER BY total_kg DESC").await?,
        "ages": lire("SELECT * FROM v_stat_lot_age ORDER BY ordre, categorie").await?,
        "divergence_fournisseur": lire("SELECT * FROM v_stat_divergence_fournisseur ORDER BY abs(ecart_moyen_pct) DESC NULLS LAST").await?,
        "divergence_article": lire("SELECT * FROM v_stat_divergence_article ORDER BY abs(ecart_moyen_pct) DESC NULLS LAST LIMIT 200").await?,
        "divergence_mois": lire("SELECT * FROM v_stat_divergence_mois ORDER BY mois").await?,
        "derive_fournisseur": lire("SELECT * FROM v_stat_derive_fournisseur ORDER BY abs(ecart_moyen_pct) DESC NULLS LAST").await?,
        "autorisations": lire("SELECT * FROM v_stat_autorisations ORDER BY type_demande, niveau").await?,
        "cockpit": lire("SELECT * FROM v_cockpit_lots").await?.get(0).cloned().unwrap_or(Value::Null),
        // Poids d'une bobine, colisage et prix, reception par reception, et
        // l'evaluation des fournisseurs qui en decoule.
        "evaluation_conditionnement": lire("SELECT * FROM v_evaluation_conditionnement ORDER BY nb_receptions DESC").await?,
        "suivi_conditionnement": lire("SELECT code_reference, designation, fournisseur_nom, numero_document, source, date_evenement, kg, nb_bobines, nb_palettes, poids_bobine_avant, poids_bobine_mesure, variation_poids_pct, poids_applique, bobines_palette_avant, bobines_palette_observe, variation_colisage, colisage_applique, prix_kg_devise, code_devise, variation_prix_pct FROM v_suivi_conditionnement ORDER BY date_evenement DESC LIMIT 300").await?,
    });
    // Les valeurs par categorie (`projet_mad`, `restes_mad`, `total_mad`) ne
    // sont pas declarees dans la grille des champs : elles suivent `valeur_mad`.
    // Qui ne voit pas la valeur du stock ne la lit pas non plus ici.
    let mut droits = user.droits(db, module::STOCK).await?;
    // Le prix en devise du suivi de conditionnement est declare au catalogue :
    // les montants masques ailleurs le sont ici aussi.
    for (champ, niveau) in rbac::sensibles_masques(db, &user.id).await? {
        droits.insert(champ, niveau);
    }
    if droits.get("valeur_mad") == Some(&rbac::Niveau::Masque) {
        for c in ["projet_mad", "restes_mad", "total_mad"] {
            droits.insert(c.to_string(), rbac::Niveau::Masque);
        }
    }
    rbac::masquer(&mut v, &droits);
    Ok(Json(v))
}

/// `GET /api/cockpit/lots` — les compteurs du poste de travail.
pub async fn cockpit(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let r = sqlx::query("SELECT * FROM v_cockpit_lots").fetch_all(&state.db).await?;
    Ok(Json(lignes_en_json(&r).get(0).cloned().unwrap_or(Value::Null)))
}
