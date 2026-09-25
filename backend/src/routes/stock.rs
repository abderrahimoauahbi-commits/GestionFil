//! Saisie : mouvements de stock, transferts, inventaires, bons de commande,
//! receptions.
//!
//! Toutes les quantites saisies passent par la conversion vers le kilogramme
//! (R01). L'unite de saisie et le facteur employe sont conserves sur la ligne :
//! sans eux, on ne saurait pas relire ce que l'operateur a reellement compte.

use super::json::lignes_en_json;
use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::db::{arrondi_kg, arrondi_mad, maintenant, Db};
use crate::domain::unites::{self, Unite};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

/// Numerotation sequentielle par prefixe et par annee.
pub(super) async fn numeroter(
    tx: &mut sqlx::PgConnection,
    table: &str,
    colonne: &str,
    prefixe: &str,
) -> AppResult<String> {
    let annee = chrono::Utc::now().format("%Y").to_string();
    let motif = format!("{prefixe}-{annee}-%");
    // `length(?1) + 1` : substr est indexe a 1, donc la position `length(prefixe)`
    // designe le DERNIER caractere du prefixe — le tiret — et non le premier
    // chiffre. Sans le +1, "BC-2026-0001" donnait "-0001", converti en -1 : le
    // 2e document repartait a 0000 et le 3e retombait sur 0001, deja pris.
    let sql = format!(
        "SELECT COALESCE(MAX(CAST(substr({colonne}, length($1) + 1) AS bigint)), 0) + 1
           FROM {table} WHERE {colonne} LIKE $2"
    );
    let suivant: i64 = sqlx::query_scalar(&sql)
        .bind(format!("{prefixe}-{annee}-"))
        .bind(&motif)
        .fetch_one(&mut *tx)
        .await?;
    Ok(format!("{prefixe}-{annee}-{suivant:04}"))
}

/// Convertit une quantite saisie vers le kg, en refusant tout facteur manquant.
async fn vers_kg(
    db: &Db,
    code_reference: &str,
    quantite: f64,
    unite: &str,
) -> AppResult<(f64, f64)> {
    let u = Unite::depuis(unite)
        .ok_or_else(|| AppError::Invalide(format!("unite inconnue : {unite}")))?;
    let facteurs = unites::charger(db, code_reference).await?;
    let facteur = facteurs.facteur(u)?;
    Ok((arrondi_kg(quantite * facteur), facteur))
}

// ============================================================================
// Mouvements de stock
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct LigneMouvement {
    pub code_reference: String,
    pub quantite_saisie: f64,
    pub unite_saisie: String,
    pub prix_kg_mad: Option<f64>,
    /// Les colis REELLEMENT COMPTES sur le quai.
    ///
    /// Ils ne se deduisent pas du poids : `quantite_saisie` en palettes se
    /// convertit en kg par un facteur theorique, alors qu'une palette
    /// incomplete reste une palette a manutentionner. Le bon imprime porte ce
    /// compte, parce que c'est lui que le cariste verifie.
    pub nb_bobines: Option<i64>,
    pub nb_palettes: Option<i64>,
    pub lot_fournisseur: Option<String>,
    pub date_fabrication: Option<String>,
    pub date_peremption: Option<String>,
    pub code_motif_ligne: Option<String>,
    pub numero_of: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NouveauMouvement {
    pub code_type_mvt: String,
    pub code_magasin: String,
    pub code_motif: String,
    /// LA DATE DU FAIT, distincte de la date de saisie.
    ///
    /// Elle etait imposee par la base a l'instant de l'enregistrement, ce qui
    /// obligeait a tout saisir le jour meme sous peine de fausser le journal.
    /// Un mouvement du samedi saisi le lundi porte desormais ses deux dates ;
    /// le declencheur C06 refuse toujours une date future.
    ///
    /// Absente, la base pose l'instant courant, comme avant.
    pub date_mouvement: Option<String>,
    /// La personne qui a physiquement remis ou recu la marchandise.
    ///
    /// Ce n'est pas le compte qui saisit : le magasinier tape souvent pour un
    /// chef d'equipe ou un chauffeur, et c'est ce dernier qu'on cherche quand
    /// un ecart apparait trois jours plus tard.
    pub responsable: Option<String>,
    pub numero_of: Option<String>,
    pub reference_document: Option<String>,
    pub observations_globales: Option<String>,
    pub lignes: Vec<LigneMouvement>,
}

/// Normalise une date de mouvement vers l'horodatage ISO-8601 du schema.
///
/// Un ecran envoie `2026-09-01` — c'est ce que produit un `<input type="date">`.
/// Le schema stocke `2026-09-01T00:00:00.000Z`, et les vues comparent ces
/// chaines lexicalement : melanger les deux formes ferait passer un mouvement
/// avant ou apres tous les autres du meme jour, selon le sens du tri.
///
/// MINUIT ET NON MIDI : le declencheur C06 refuse une date dans le futur en
/// comparant a l'instant courant. Midi rendrait impossible la saisie du jour
/// meme avant midi — un refus incomprehensible pour celui qui le subit.
fn normaliser_date_mouvement(v: &Option<String>) -> Option<String> {
    v.as_ref().map(|d| {
        let d = d.trim();
        if d.len() == 10 {
            format!("{d}T00:00:00.000Z")
        } else {
            d.to_string()
        }
    })
}

pub async fn creer_mouvement(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(m): Json<NouveauMouvement>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    if m.lignes.is_empty() {
        return Err(AppError::Invalide("au moins une ligne est requise".into()));
    }

    // La conversion se fait avant d'ouvrir la transaction : un facteur manquant
    // doit echouer avant toute ecriture, avec un message qui nomme la reference.
    let mut converties = Vec::with_capacity(m.lignes.len());
    for l in &m.lignes {
        let (kg, facteur) =
            vers_kg(&state.db, &l.code_reference, l.quantite_saisie, &l.unite_saisie).await?;
        converties.push((l, kg, facteur));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let numero = numeroter(&mut tx, "mouvement", "numero_mouvement", "MVT").await?;
    let id = uuid::Uuid::new_v4().to_string();

    // `COALESCE` plutot qu'une requete conditionnelle : la valeur par defaut du
    // schema est l'instant courant, et la reproduire ici la ferait diverger le
    // jour ou elle changera.
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
    .bind(normaliser_date_mouvement(&m.date_mouvement))
    .bind(&m.code_type_mvt)
    .bind(&m.code_magasin)
    .bind(&m.code_motif)
    .bind(&m.reference_document)
    .bind(&m.numero_of)
    .bind(&m.observations_globales)
    .bind(m.responsable.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    // Les triggers appliquent le solde, recalculent le CMUP et refusent une
    // sortie superieure au stock, un OF manquant ou un lot absent.
    for (i, (l, kg, facteur)) in converties.iter().enumerate() {
        sqlx::query(
            "INSERT INTO ligne_mouvement
                 (id_mouvement, ligne_numero, code_reference, quantite_kg, prix_kg_mad,
                  quantite_saisie, unite_saisie, facteur_conversion,
                  nb_bobines, nb_palettes,
                  lot_fournisseur, date_fabrication, date_peremption,
                  code_motif_ligne, numero_of)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
        )
        .bind(&id)
        .bind((i + 1) as i64)
        .bind(&l.code_reference)
        .bind(kg)
        .bind(l.prix_kg_mad)
        .bind(l.quantite_saisie)
        .bind(&l.unite_saisie)
        .bind(facteur)
        .bind(l.nb_bobines)
        .bind(l.nb_palettes)
        .bind(&l.lot_fournisseur)
        .bind(&l.date_fabrication)
        .bind(&l.date_peremption)
        .bind(&l.code_motif_ligne)
        .bind(l.numero_of.clone().or_else(|| m.numero_of.clone()))
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(Json(json!({
        "id_mouvement": id,
        "numero_mouvement": numero,
        "lignes": converties.len(),
        "quantite_totale_kg": arrondi_kg(converties.iter().map(|(_, kg, _)| kg).sum()),
    })))
}

// ----------------------------------------------------------------------------
// Le mouvement comme DOCUMENT
// ----------------------------------------------------------------------------
// Le grand livre — une ligne par reference — reste servi par
// `consultation::mouvements` : c'est la vue de l'auditeur, qui cherche ce
// qu'est devenue une reference. Ce n'est pas celle du magasin, qui manipule des
// camions et des equipes. Les deux endpoints coexistent parce que les deux
// lectures sont legitimes ; les confondre obligeait a additionner de tete les
// lignes d'un meme bon pour savoir combien de kilos etaient sortis.
// ----------------------------------------------------------------------------

/// Les totaux d'un document, calcules en SQL et non a l'ecran.
///
/// Le meme fragment sert la liste et le dossier : deux calculs paralleles
/// finissent toujours par diverger d'un arrondi, et c'est le genre d'ecart
/// qu'on ne remarque qu'au moment ou quelqu'un compare deux impressions.
const TOTAUX_MOUVEMENT: &str = "
    LEFT JOIN (
        SELECT l.id_mouvement,
               CAST(COUNT(*) AS bigint)                          AS nb_lignes,
               CAST(COUNT(DISTINCT l.code_reference) AS bigint)  AS nb_references,
               ROUND(SUM(l.quantite_kg), 3)                      AS quantite_totale_kg,
               CAST(SUM(COALESCE(l.nb_bobines, 0))  AS bigint)   AS bobines_totales,
               CAST(SUM(COALESCE(l.nb_palettes, 0)) AS bigint)   AS palettes_totales,
               ROUND(SUM(COALESCE(l.total_mad, 0)), 2)           AS valeur_totale_mad,
               -- LE REBUT, ISOLE DU RESTE. Un retour d'atelier melange de
               -- l'excedent reutilisable (R3) et de la chute perdue (R4) : les
               -- additionner ferait croire que tout revient en stock utile.
               ROUND(SUM(CASE WHEN l.code_motif_ligne = 'R4'
                              THEN l.quantite_kg ELSE 0 END), 3) AS rebut_kg
          FROM ligne_mouvement l
         GROUP BY l.id_mouvement
    ) tot ON tot.id_mouvement = m.id_mouvement";

/// Les colonnes d'entete, communes a la liste et au dossier.
const ENTETE_MOUVEMENT: &str = "
    m.id_mouvement, m.numero_mouvement, m.date_mouvement, m.date_creation,
    m.code_type_mvt, tm.libelle AS type_libelle, tm.signe, tm.couleur,
    m.code_magasin, mg.nom AS magasin_nom,
    m.code_motif, mo.libelle AS motif_libelle,
    m.reference_document, m.numero_of, m.observations_globales,
    m.responsable, m.est_initial, u.login AS saisi_par,
    CAST((substr(m.date_creation, 1, 10))::date
       - (substr(m.date_mouvement, 1, 10))::date AS bigint) AS jours_de_retard_saisie,
    COALESCE(tot.nb_lignes, 0)          AS nb_lignes,
    COALESCE(tot.nb_references, 0)      AS nb_references,
    COALESCE(tot.quantite_totale_kg, 0) AS quantite_totale_kg,
    COALESCE(tot.bobines_totales, 0)    AS bobines_totales,
    COALESCE(tot.palettes_totales, 0)   AS palettes_totales,
    COALESCE(tot.valeur_totale_mad, 0)  AS valeur_totale_mad,
    COALESCE(tot.rebut_kg, 0)           AS rebut_kg,
    -- LES DEUX SENS DE L'ANNULATION. Un document doit savoir dire qu'il
    -- annule, et savoir dire qu'il a ete annule : sans le second, un bon
    -- defait continue de s'imprimer comme s'il valait encore.
    m.id_mouvement_contrepasse, m.motif_contrepassation,
    (SELECT c.numero_mouvement FROM mouvement c
      WHERE c.id_mouvement_contrepasse = m.id_mouvement) AS contrepasse_par";

const JOINTURES_MOUVEMENT: &str = "
    FROM mouvement m
    JOIN type_mouvement  tm ON tm.code_type_mvt = m.code_type_mvt
    JOIN magasin         mg ON mg.code_magasin  = m.code_magasin
    JOIN motif_mouvement mo ON mo.code_motif    = m.code_motif
    JOIN utilisateur     u  ON u.id_utilisateur = m.id_utilisateur";

#[derive(Debug, Deserialize)]
pub struct FiltresDocuments {
    pub limite: Option<i64>,
    pub code_magasin: Option<String>,
    pub code_type_mvt: Option<String>,
    /// Ne garde que les documents portant cette reference sur l'une de leurs
    /// lignes. C'est ce que demande « voir les bons ou cette matiere apparait ».
    pub code_reference: Option<String>,
    /// Bornes sur la date DU FAIT, pas sur celle de la saisie.
    pub depuis: Option<String>,
    pub jusqu_a: Option<String>,
}

/// La liste des mouvements, un document par ligne.
///
/// L'ECART ENTRE LE FAIT ET SA SAISIE est calcule ici et non a l'ecran. Il ne
/// juge personne : il dit si le journal est tenu au jour le jour, ce qui
/// conditionne la fiabilite du stock projete. Zero est le cas normal.
pub async fn documents_mouvement(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<FiltresDocuments>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Lire).await?;

    let sql = format!(
        "SELECT {ENTETE_MOUVEMENT} {JOINTURES_MOUVEMENT} {TOTAUX_MOUVEMENT}
          WHERE ($1::text IS NULL OR m.code_magasin  = $1)
            AND ($2::text IS NULL OR m.code_type_mvt = $2)
            AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM ligne_mouvement l
                                              WHERE l.id_mouvement   = m.id_mouvement
                                                AND l.code_reference = $3))
            AND ($4::text IS NULL OR m.date_mouvement >= $4)
            AND ($5::text IS NULL OR m.date_mouvement <= $5)
          ORDER BY m.date_mouvement DESC, m.numero_mouvement DESC
          LIMIT $6"
    );

    let rows = sqlx::query(&sql)
        .bind(&f.code_magasin)
        .bind(&f.code_type_mvt)
        .bind(&f.code_reference)
        .bind(&f.depuis)
        // Une borne haute sur une date nue exclurait la journee entiere :
        // '2026-09-02' est plus petit que '2026-09-02T08:00:00.000Z'. On la
        // repousse donc a la fin du jour demande.
        .bind(f.jusqu_a.as_ref().map(|d| {
            let d = d.trim();
            if d.len() == 10 { format!("{d}T23:59:59.999Z") } else { d.to_string() }
        }))
        .bind(f.limite.unwrap_or(300).clamp(1, 2000))
        .fetch_all(&state.db)
        .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::MOUVEMENTS, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Le dossier complet d'un mouvement : entete, lignes, totaux.
///
/// Un seul appel, parce que c'est ce qu'imprime un bon d'entree ou de sortie.
/// Assembler le document depuis trois requetes exposerait a l'imprimer a
/// moitie servi — meme raison que pour le dossier de transfert.
#[derive(Deserialize)]
pub struct DemandeContrePassation {
    /// POURQUOI on defait : obligatoire, et conserve sur la ligne inverse.
    pub motif: String,
}

/// `POST /api/mouvements/{id}/contre-passer` — DEFAIRE SANS EFFACER.
///
/// LE GRAND LIVRE NE S'EFFACE PAS (R03), et ce n'est pas une rigidite : un
/// mouvement efface emporte avec lui la reponse a « que s'est-il passe ce
/// jour-la ». SAP, Oracle et Dynamics font tous la meme chose depuis trente
/// ans — on poste l'INVERSE. Les deux lignes restent, le solde redevient juste,
/// et l'histoire se lit encore dans six mois.
///
/// LE MOUVEMENT INVERSE PORTE UN TYPE D'AJUSTEMENT, jamais le type d'origine.
/// Une reception contre-passee n'est pas une « reception negative » : c'est une
/// correction, et les statistiques d'achat ne doivent pas y voir un achat de
/// moins.
///
/// LE CMUP SE REFAIT ENSUITE. Les types d'ajustement ne le touchent pas : sans
/// ce rappel, contre-passer une reception valorisee rendrait la quantite mais
/// laisserait le cout moyen fige sur un achat qui n'a plus lieu.
///
/// CE QUI PEUT REFUSER, ET C'EST VOULU : si la marchandise entree est deja
/// repartie, le declencheur de stock suffisant refuse la sortie inverse. On ne
/// peut pas defaire une entree dont les kilos ne sont plus la — il faut alors
/// un inventaire, qui constate au lieu de pretendre annuler.
pub async fn contre_passer(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(d): Json<DemandeContrePassation>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Valider).await?;
    // DEFAIRE EST UN ACTE DE DIRECTION. Saisir un mouvement se delegue ;
    // annuler celui d'un autre, non — c'est une decision sur le passe.
    if user.role != "ADMIN" && user.role != "DIRECTION" {
        return Err(AppError::NonAutorise {
            module: module::MOUVEMENTS.into(),
            action: "CONTRE_PASSER".into(),
        });
    }
    let motif = d.motif.trim().to_string();
    if motif.chars().count() < 5 {
        return Err(AppError::Invalide(
            "Le motif de la contre-passation est obligatoire : dites en quelques mots \
             pourquoi ce mouvement est annule."
                .into(),
        ));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // L'ORIGINAL, ET LES TROIS RAISONS DE REFUSER.
    let origine: Option<(String, String, String, i64, Option<String>)> = sqlx::query_as(
        "SELECT m.numero_mouvement, m.code_type_mvt, m.code_magasin, tm.signe,
                m.id_mouvement_contrepasse
           FROM mouvement m
           JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
          WHERE m.id_mouvement = $1",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((numero, type_origine, magasin, signe, deja_inverse)) = origine else {
        return Err(AppError::Introuvable(format!("mouvement {id}")));
    };
    if deja_inverse.is_some() {
        return Err(AppError::RegleMetier(
            "Ce mouvement EST deja une contre-passation : on n'annule pas une annulation, \
             on saisit le mouvement qui manque."
                .into(),
        ));
    }
    let deja: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM mouvement WHERE id_mouvement_contrepasse = $1",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    if deja > 0 {
        return Err(AppError::RegleMetier(format!(
            "{numero} a deja ete contre-passe. Le grand livre porte les deux lignes ; \
             une troisieme ne corrigerait rien."
        )));
    }

    // Le sens s'inverse ; le type devient un ajustement.
    let type_inverse = if signe == 1 { "AJUST_INV_NEG" } else { "AJUST_INV_POS" };

    let numero_inverse = numeroter(&mut tx, "mouvement", "numero_mouvement", "MVT").await?;
    let id_inverse = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO mouvement
             (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt, code_magasin,
              code_motif, reference_document, observations_globales,
              id_utilisateur, id_mouvement_contrepasse, motif_contrepassation)
         VALUES ($1, $2,
                 to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),
                 $3, $4, 'CONTREPASSATION', $5, $6, $7, $8, $9)",
    )
    .bind(&id_inverse)
    .bind(&numero_inverse)
    .bind(type_inverse)
    .bind(&magasin)
    .bind(format!("contre-passation de {numero}"))
    .bind(format!("Annule {numero} ({type_origine}) — {motif}"))
    .bind(&user.id)
    .bind(&id)
    .bind(&motif)
    .execute(&mut *tx)
    .await?;

    // LES MEMES LIGNES, AUX MEMES QUANTITES. Le sens vient du TYPE, jamais du
    // signe des nombres : une quantite negative dans le grand livre rendrait
    // toutes les sommes ambigues. Le lot suit, sinon la tracabilite se perdrait
    // sur la ligne qui corrige.
    let lignes: Vec<(i64, String, f64, Option<String>)> = sqlx::query_as(
        "SELECT ligne_numero, code_reference, quantite_kg::float8, lot_fournisseur
           FROM ligne_mouvement WHERE id_mouvement = $1 ORDER BY ligne_numero",
    )
    .bind(&id)
    .fetch_all(&mut *tx)
    .await?;
    if lignes.is_empty() {
        return Err(AppError::RegleMetier(format!(
            "{numero} ne porte aucune ligne : il n'y a rien a defaire."
        )));
    }
    // LE MOTIF DE LIGNE EST « R5 — ERREUR DE SAISIE », de categorie CORRECTION.
    // Les types d'ajustement l'exigent, et c'est le seul des six qui decrive ce
    // qui se passe ici : on defait NOTRE propre ecriture. R6 dirait « ecart
    // d'inventaire », c'est-a-dire un ecart constate au magasin — le contraire
    // de ce qu'on fait. La raison veritable, en toutes lettres, est portee par
    // le motif du mouvement ; celui-ci n'est qu'une categorie.
    for (numero_ligne, code_reference, kg, lot) in &lignes {
        sqlx::query(
            "INSERT INTO ligne_mouvement
                 (id_mouvement, ligne_numero, code_reference, quantite_kg,
                  lot_fournisseur, mode_pesee, code_motif_ligne)
             VALUES ($1, $2, $3, $4, $5, 'THEORIQUE', 'R5')",
        )
        .bind(&id_inverse)
        .bind(numero_ligne)
        .bind(code_reference)
        .bind(kg)
        .bind(lot)
        .execute(&mut *tx)
        .await?;
    }

    // LE COUT MOYEN SE REFAIT SUR CE QUI TIENT ENCORE, reference par reference.
    let mut refaits: Vec<Value> = Vec::new();
    let mut vues: Vec<&str> = Vec::new();
    for (_, code_reference, _, _) in &lignes {
        if vues.contains(&code_reference.as_str()) {
            continue;
        }
        vues.push(code_reference);
        let prix: Option<f64> = sqlx::query_scalar("SELECT fn_recalculer_cmup($1)::float8")
            .bind(code_reference)
            .fetch_one(&mut *tx)
            .await?;
        refaits.push(json!({ "code_reference": code_reference, "cmup_mad": prix }));
    }

    tx.commit().await?;

    Ok(Json(json!({
        "id_mouvement": id_inverse,
        "numero_mouvement": numero_inverse,
        "annule": numero,
        "type_inverse": type_inverse,
        "lignes": lignes.len(),
        "cmup_refaits": refaits,
    })))
}

pub async fn dossier_mouvement(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Lire).await?;

    let sql = format!(
        "SELECT {ENTETE_MOUVEMENT} {JOINTURES_MOUVEMENT} {TOTAUX_MOUVEMENT}
          WHERE m.id_mouvement = $1"
    );
    let entete = sqlx::query(&sql)
        .bind(&id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("mouvement {id}")))?;

    let lignes = sqlx::query(
        "SELECT l.*, r.designation, r.couleur, r.unite_catalogue,
                ml.libelle AS motif_ligne_libelle
           FROM ligne_mouvement l
           JOIN reference r ON r.code_reference = l.code_reference
           LEFT JOIN motif_ligne ml ON ml.code_motif_ligne = l.code_motif_ligne
          WHERE l.id_mouvement = $1
          ORDER BY l.ligne_numero",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let mut sortie = json!({
        "entete": lignes_en_json(std::slice::from_ref(&entete))
            .as_array().and_then(|a| a.first().cloned()).unwrap_or(Value::Null),
        "lignes": lignes_en_json(&lignes),
    });
    user.masquer(&state.db, module::MOUVEMENTS, &mut sortie).await?;
    Ok(Json(sortie))
}

// ============================================================================
// Transferts
// ============================================================================

pub async fn lister_transferts(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT t.*, u.login AS auteur, ur.login AS receptionnaire,
                (SELECT COUNT(*) FROM ligne_transfert l WHERE l.id_transfert = t.id_transfert) AS nb_lignes,
                (SELECT ROUND(COALESCE(SUM(l.quantite_kg), 0), 3) FROM ligne_transfert l
                  WHERE l.id_transfert = t.id_transfert) AS quantite_totale_kg,
                -- Depuis combien de jours la marchandise roule-t-elle ? Au-dela
                -- de quelques jours sur un transfert interne, c'est qu'on a
                -- oublie de constater l'arrivee.
                CASE WHEN t.statut = 'VALIDE'
                     THEN CAST((current_date - (t.date_transfert)::date) AS bigint)
                END AS jours_en_transit
           FROM transfert t
           LEFT JOIN utilisateur u  ON u.id_utilisateur = t.id_utilisateur
           LEFT JOIN utilisateur ur ON ur.id_utilisateur = t.id_utilisateur_reception
          ORDER BY t.date_transfert DESC LIMIT 200",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&rows)))
}

#[derive(Debug, Deserialize)]
pub struct NouveauTransfert {
    pub code_magasin_source: String,
    pub code_magasin_dest: String,
    pub date_transfert: Option<String>,
    pub responsable: Option<String>,
    pub transporteur: Option<String>,
    pub observations: Option<String>,
    /// Lignes saisies AVEC l'entete. Tout part dans une seule transaction : un
    /// transfert ouvert sans ligne, avec un numero deja attribue, serait un
    /// document fantome au milieu de la numerotation.
    pub lignes: Option<Vec<LigneTransfert>>,
}

/// Le dossier complet d'un transfert : entete, lignes, totaux.
///
/// Un seul appel, parce que c'est ce qu'imprime un bon de sortie ou de
/// reception. Assembler le document depuis trois requetes exposerait a
/// l'imprimer a moitie servi.
pub async fn dossier_transfert(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Lire).await?;

    let entete = sqlx::query(
        "SELECT t.*, ms.nom AS magasin_source_nom, md.nom AS magasin_dest_nom,
                ue.login AS expediteur, ur.login AS receptionnaire,
                (SELECT COUNT(*) FROM ligne_transfert l WHERE l.id_transfert = t.id_transfert)
                    AS nb_lignes,
                (SELECT ROUND(COALESCE(SUM(l.quantite_kg), 0), 3) FROM ligne_transfert l
                  WHERE l.id_transfert = t.id_transfert)            AS quantite_totale_kg,
                (SELECT COALESCE(SUM(l.nb_bobines), 0) FROM ligne_transfert l
                  WHERE l.id_transfert = t.id_transfert)            AS bobines_totales,
                (SELECT COALESCE(SUM(l.nb_palettes), 0) FROM ligne_transfert l
                  WHERE l.id_transfert = t.id_transfert)            AS palettes_totales,
                (SELECT ROUND(COALESCE(SUM(l.quantite_kg * l.prix_kg_mad), 0), 2)
                   FROM ligne_transfert l WHERE l.id_transfert = t.id_transfert)
                                                                    AS valeur_totale_mad,
                -- Duree reelle du trajet, une fois l'arrivee constatee.
                CASE WHEN t.date_sortie IS NOT NULL AND t.date_reception_dest IS NOT NULL
                     THEN CAST(((t.date_reception_dest)::date - (t.date_sortie)::date)
                               AS bigint)
                     WHEN t.date_sortie IS NOT NULL
                     THEN CAST((current_date - (t.date_sortie)::date) AS bigint)
                END                                                 AS jours_en_transit
           FROM transfert t
           LEFT JOIN magasin ms     ON ms.code_magasin = t.code_magasin_source
           LEFT JOIN magasin md     ON md.code_magasin = t.code_magasin_dest
           LEFT JOIN utilisateur ue ON ue.id_utilisateur = t.id_utilisateur
           LEFT JOIN utilisateur ur ON ur.id_utilisateur = t.id_utilisateur_reception
          WHERE t.id_transfert = $1",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("transfert {id}")))?;

    let lignes = sqlx::query(
        "SELECT l.*, r.designation, r.couleur, r.unite_catalogue,
                ROUND(l.quantite_kg * COALESCE(l.prix_kg_mad, 0), 2) AS total_mad
           FROM ligne_transfert l
           JOIN reference r ON r.code_reference = l.code_reference
          WHERE l.id_transfert = $1 ORDER BY l.ligne_numero",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let mut sortie = json!({
        "entete": lignes_en_json(std::slice::from_ref(&entete))
            .as_array().and_then(|a| a.first().cloned()).unwrap_or(Value::Null),
        "lignes": lignes_en_json(&lignes),
    });
    user.masquer(&state.db, module::MOUVEMENTS, &mut sortie).await?;
    Ok(Json(sortie))
}

pub async fn creer_transfert(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(t): Json<NouveauTransfert>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let numero = numeroter(&mut tx, "transfert", "numero_transfert", "TRF").await?;
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO transfert
             (id_transfert, numero_transfert, code_magasin_source, code_magasin_dest,
              id_utilisateur, responsable, transporteur, observations, date_transfert)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                 COALESCE($9, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')))",
    )
    .bind(&id)
    .bind(&numero)
    .bind(&t.code_magasin_source)
    .bind(&t.code_magasin_dest)
    .bind(&user.id)
    .bind(&t.responsable)
    .bind(&t.transporteur)
    .bind(&t.observations)
    .bind(&t.date_transfert)
    .execute(&mut *tx)
    .await?;

    // --- Lignes saisies avec l'entete ---------------------------------------
    let mut posees = 0i64;
    let mut total_kg = 0.0_f64;
    for (i, l) in t.lignes.iter().flatten().enumerate() {
        if l.quantite_saisie <= 0.0 {
            return Err(AppError::Invalide(format!(
                "{} : la quantite doit etre strictement positive",
                l.code_reference
            )));
        }
        let (kg, facteur) =
            vers_kg(&state.db, &l.code_reference, l.quantite_saisie, &l.unite_saisie).await?;

        sqlx::query(
            "INSERT INTO ligne_transfert
                 (id_transfert, ligne_numero, code_reference, quantite_kg,
                  quantite_saisie, unite_saisie, facteur_conversion, lot_fournisseur,
                  nb_bobines, nb_palettes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(&id)
        .bind((i + 1) as i64)
        .bind(&l.code_reference)
        .bind(kg)
        .bind(l.quantite_saisie)
        .bind(&l.unite_saisie)
        .bind(facteur)
        .bind(&l.lot_fournisseur)
        .bind(l.nb_bobines)
        .bind(l.nb_palettes)
        .execute(&mut *tx)
        .await?;
        posees += 1;
        total_kg += kg;
    }

    tx.commit().await?;
    Ok(Json(json!({
        "id_transfert": id, "numero_transfert": numero,
        "lignes": posees, "quantite_totale_kg": arrondi_kg(total_kg)
    })))
}

#[derive(Debug, Deserialize)]
pub struct LigneTransfert {
    pub code_reference: String,
    pub quantite_saisie: f64,
    pub unite_saisie: String,
    pub lot_fournisseur: Option<String>,
    /// Conditionnement compte au quai, independant de la conversion en kg.
    pub nb_bobines: Option<i64>,
    pub nb_palettes: Option<i64>,
}

pub async fn ajouter_ligne_transfert(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(l): Json<LigneTransfert>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    let (kg, facteur) =
        vers_kg(&state.db, &l.code_reference, l.quantite_saisie, &l.unite_saisie).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: String = sqlx::query_scalar("SELECT statut FROM transfert WHERE id_transfert = $1")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("transfert {id}")))?;
    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(
            "Seul un transfert en brouillon peut recevoir des lignes.".into(),
        ));
    }

    let numero: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(ligne_numero), 0) + 1 FROM ligne_transfert WHERE id_transfert = $1",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO ligne_transfert
             (id_transfert, ligne_numero, code_reference, quantite_kg,
              quantite_saisie, unite_saisie, facteur_conversion, lot_fournisseur,
              nb_bobines, nb_palettes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(&id)
    .bind(numero)
    .bind(&l.code_reference)
    .bind(kg)
    .bind(l.quantite_saisie)
    .bind(&l.unite_saisie)
    .bind(facteur)
    .bind(&l.lot_fournisseur)
    .bind(l.nb_bobines)
    .bind(l.nb_palettes)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "ligne_numero": numero, "quantite_kg": kg })))
}

/// Reprise d'un transfert TANT QU'IL N'EST PAS PARTI.
///
/// Un document de preparation se corrige : une quantite mal comptee, une palette
/// oubliee, un magasin destinataire choisi de travers. Le refuser obligeait a
/// abandonner le transfert et a en ouvrir un autre, ce qui trouait la
/// numerotation pour une faute de frappe.
///
/// La charge recue FAIT AUTORITE : les lignes qu'elle ne contient pas sont
/// retirees, celles qu'elle contient remplacent les anciennes. C'est le meme
/// regime que le document qualite, et pour la meme raison — un ecran qui envoie
/// sa grille entiere ne sait pas exprimer « supprime la ligne 3 » autrement.
///
/// Passe l'expedition, plus rien ne bouge : les mouvements sont au grand livre,
/// que R03 rend immuable. Corriger le document sans corriger le grand livre
/// ferait mentir l'un des deux.
pub async fn modifier_transfert(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(t): Json<NouveauTransfert>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;

    // La conversion se fait AVANT d'ouvrir la transaction : une unite sans
    // facteur doit echouer en nommant sa reference, pas apres avoir efface les
    // lignes existantes.
    let saisies = t.lignes.as_deref().unwrap_or_default();
    let mut converties = Vec::with_capacity(saisies.len());
    for l in saisies {
        if l.quantite_saisie <= 0.0 {
            return Err(AppError::Invalide(format!(
                "{} : la quantite doit etre strictement positive",
                l.code_reference
            )));
        }
        let (kg, facteur) =
            vers_kg(&state.db, &l.code_reference, l.quantite_saisie, &l.unite_saisie).await?;
        converties.push((l, kg, facteur));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: String = sqlx::query_scalar("SELECT statut FROM transfert WHERE id_transfert = $1")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("transfert {id}")))?;
    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(
            "Un transfert deja expedie ne se modifie plus : ses mouvements sont \
             au grand livre, que R03 rend immuable. Corriger la marchandise \
             reellement partie passe par un inventaire."
                .into(),
        ));
    }

    sqlx::query(
        "UPDATE transfert
            SET code_magasin_source = $2, code_magasin_dest = $3,
                responsable = $4, transporteur = $5, observations = $6,
                date_transfert = COALESCE($7, date_transfert)
          WHERE id_transfert = $1",
    )
    .bind(&id)
    .bind(&t.code_magasin_source)
    .bind(&t.code_magasin_dest)
    .bind(&t.responsable)
    .bind(&t.transporteur)
    .bind(&t.observations)
    .bind(&t.date_transfert)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM ligne_transfert WHERE id_transfert = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    let mut total_kg = 0.0_f64;
    for (i, (l, kg, facteur)) in converties.iter().enumerate() {
        sqlx::query(
            "INSERT INTO ligne_transfert
                 (id_transfert, ligne_numero, code_reference, quantite_kg,
                  quantite_saisie, unite_saisie, facteur_conversion, lot_fournisseur,
                  nb_bobines, nb_palettes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(&id)
        .bind((i + 1) as i64)
        .bind(&l.code_reference)
        .bind(kg)
        .bind(l.quantite_saisie)
        .bind(&l.unite_saisie)
        .bind(facteur)
        .bind(&l.lot_fournisseur)
        .bind(l.nb_bobines)
        .bind(l.nb_palettes)
        .execute(&mut *tx)
        .await?;
        total_kg += kg;
    }

    tx.commit().await?;
    Ok(Json(json!({
        "id_transfert": id,
        "lignes": converties.len(),
        "quantite_totale_kg": arrondi_kg(total_kg)
    })))
}

/// Abandon d'un transfert avant expedition.
///
/// Le document reste, marque ANNULE : son numero a ete attribue, et un trou
/// dans la numerotation se remarque bien plus tard, quand plus personne ne sait
/// s'il manque un bon ou s'il n'a jamais existe.
pub async fn annuler_transfert(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: String = sqlx::query_scalar("SELECT statut FROM transfert WHERE id_transfert = $1")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("transfert {id}")))?;
    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(
            "Seul un transfert en preparation s'abandonne. Une fois la \
             marchandise partie, elle doit arriver quelque part : la recevoir \
             au destinataire, ou la faire revenir par un transfert inverse."
                .into(),
        ));
    }

    // La transition BROUILLON -> ANNULE est declaree dans `transition_statut` :
    // c'est la base qui l'autorise, pas cette fonction.
    sqlx::query("UPDATE transfert SET statut = 'ANNULE' WHERE id_transfert = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(Json(json!({ "id_transfert": id, "statut": "ANNULE" })))
}

// ============================================================================
// Inventaires
// ============================================================================

pub async fn lister_inventaires(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::INVENTAIRE, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT i.*, u.login AS responsable,
                (SELECT COUNT(*) FROM ligne_inventaire l WHERE l.id_inventaire = i.id_inventaire) AS nb_lignes,
                (SELECT COUNT(*) FROM ligne_inventaire l
                  WHERE l.id_inventaire = i.id_inventaire AND l.statut_ligne = 'A_TRAITER') AS nb_a_compter
           FROM inventaire i
           LEFT JOIN utilisateur u ON u.id_utilisateur = i.id_utilisateur_responsable
          ORDER BY i.date_inventaire DESC LIMIT 200",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&rows)))
}

#[derive(Debug, Deserialize)]
pub struct NouvelInventaire {
    pub code_magasin: String,
    pub type_inventaire: String,
}

pub async fn creer_inventaire(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(i): Json<NouvelInventaire>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::INVENTAIRE, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let numero = numeroter(&mut tx, "inventaire", "numero_inventaire", "INV").await?;
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO inventaire
             (id_inventaire, numero_inventaire, type_inventaire, code_magasin,
              id_utilisateur_responsable)
         VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(&id)
    .bind(&numero)
    .bind(&i.type_inventaire)
    .bind(&i.code_magasin)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "id_inventaire": id, "numero_inventaire": numero })))
}

pub async fn lignes_inventaire(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::INVENTAIRE, Action::Lire).await?;
    let rows = sqlx::query(
        // CE QU'IL FAUT POUR COMPTER, pas seulement pour saisir. Au magasin on
        // compte des palettes et des bobines, jamais des kilos : la feuille de
        // comptage doit porter le conditionnement pour que le bureau convertisse
        // sans rappeler l'allee. Et elle suit l'ORDRE DU MAGASIN — la matiere,
        // puis la famille — parce qu'on parcourt une allee de polypropylene, pas
        // une liste alphabetique de codes.
        "SELECT li.*, r.designation, r.unite_catalogue,
                r.poids_bobine_kg, r.bobines_par_palette,
                r.code_categorie, cat.libelle AS categorie_libelle,
                r.code_famille, r.reference_fournisseur,
                f.nom AS fournisseur_nom
           FROM ligne_inventaire li
           JOIN reference r ON r.code_reference = li.code_reference
           LEFT JOIN categorie_matiere cat ON cat.code_categorie = r.code_categorie
           LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
          WHERE li.id_inventaire = $1
          ORDER BY cat.libelle NULLS LAST, r.code_famille NULLS LAST, li.code_reference",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::INVENTAIRE, &mut valeur).await?;
    Ok(Json(valeur))
}

#[derive(Debug, Deserialize)]
pub struct Comptage {
    pub code_reference: String,
    pub code_magasin: String,
    pub quantite_comptee_kg: f64,
    /// Obligatoire pour une reference sous suivi de lot : c'est le lot qu'on
    /// compte, pas la reference.
    pub lot_fournisseur: Option<String>,
    pub motif_ecart: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LotComptage {
    pub comptages: Vec<Comptage>,
}

/// Enregistre un lot de comptages : sur tablette, on compte une allee entiere
/// avant de valider, pas une reference a la fois.
pub async fn saisir_comptage(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(lot): Json<LotComptage>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::INVENTAIRE, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: String =
        sqlx::query_scalar("SELECT statut FROM inventaire WHERE id_inventaire = $1")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("inventaire {id}")))?;
    if statut != "EN_COURS" {
        return Err(AppError::RegleMetier(format!(
            "Le comptage n'est possible que sur un inventaire EN_COURS (statut actuel : {statut})."
        )));
    }

    let horodatage = maintenant();
    let mut n = 0usize;
    for c in &lot.comptages {
        if c.quantite_comptee_kg < 0.0 {
            return Err(AppError::Invalide(
                "une quantite comptee ne peut pas etre negative".into(),
            ));
        }
        // Le lot fait partie de la cle : deux lots de la meme reference sont
        // deux lignes de comptage distinctes.
        let res = sqlx::query(
            "UPDATE ligne_inventaire
                SET quantite_comptee_kg = $3, motif_ecart = $4, statut_ligne = 'COMPTE',
                    id_utilisateur_comptage = $5, date_comptage = $6
              WHERE id_inventaire = $1 AND code_reference = $2 AND code_magasin = $7
                -- `IS $8` etait du SQLite : PostgreSQL le refuse, et chaque saisie
                -- de comptage tombait en erreur interne.
                AND lot_fournisseur IS NOT DISTINCT FROM $8",
        )
        .bind(&id)
        .bind(&c.code_reference)
        .bind(arrondi_kg(c.quantite_comptee_kg))
        .bind(&c.motif_ecart)
        .bind(&user.id)
        .bind(&horodatage)
        .bind(&c.code_magasin)
        .bind(&c.lot_fournisseur)
        .execute(&mut *tx)
        .await?;

        if res.rows_affected() == 0 {
            return Err(AppError::Introuvable(format!(
                "ligne d'inventaire pour {} au magasin {}{}",
                c.code_reference,
                c.code_magasin,
                c.lot_fournisseur
                    .as_ref()
                    .map(|l| format!(" (lot {l})"))
                    .unwrap_or_default()
            )));
        }
        n += res.rows_affected() as usize;
    }

    tx.commit().await?;
    Ok(Json(json!({ "id_inventaire": id, "lignes_comptees": n })))
}

// ============================================================================
// Bons de commande
// ============================================================================

pub async fn lister_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Lire).await?;
    let rows = sqlx::query(
        // Le pourcentage livre et le statut de livraison sont CALCULES depuis les
        // lignes, comme les colonnes I et K de la feuille Commandes. Les stocker
        // les ferait diverger des receptions a la premiere pesee.
        "SELECT bc.*, f.nom AS fournisseur_nom, f.code_devise AS devise_fournisseur,
                -- CE QUE LE DOCUMENT FOURNISSEUR IMPRIME. Ces trois-la vivent sur la
                -- fiche du fournisseur, et 98 bons sur 109 des archives Excel les
                -- portaient en pied de page. Les recopier sur le bon les figerait ;
                -- on les lit, on ne les stocke pas.
                f.incoterm, f.tolerance_pesee_pct, f.palettes_par_conteneur,
                uc.login AS createur, uv.login AS valideur,
                (SELECT COUNT(*) FROM ligne_bc l WHERE l.id_bc = bc.id_bc) AS nb_lignes,
                (SELECT COALESCE(SUM(l.quantite_restante_kg), 0) FROM ligne_bc l
                  WHERE l.id_bc = bc.id_bc) AS reste_a_livrer_kg,
                (SELECT COALESCE(SUM(l.quantite_commandee_kg), 0) FROM ligne_bc l
                  WHERE l.id_bc = bc.id_bc) AS quantite_commandee_kg,
                (SELECT COALESCE(SUM(l.quantite_recue_kg), 0) FROM ligne_bc l
                  WHERE l.id_bc = bc.id_bc) AS quantite_recue_kg,
                CASE
                    WHEN (SELECT COALESCE(SUM(l.quantite_commandee_kg), 0) FROM ligne_bc l
                           WHERE l.id_bc = bc.id_bc) <= 0 THEN 0
                    ELSE ROUND(100.0
                         * (SELECT COALESCE(SUM(l.quantite_recue_kg), 0) FROM ligne_bc l
                             WHERE l.id_bc = bc.id_bc)
                         / (SELECT SUM(l.quantite_commandee_kg) FROM ligne_bc l
                             WHERE l.id_bc = bc.id_bc), 1)
                END AS pct_livre,
                CASE
                    WHEN bc.statut IN ('BROUILLON','EN_ATTENTE_VALIDATION','ANNULE') THEN 'SANS OBJET'
                    WHEN (SELECT COALESCE(SUM(l.quantite_restante_kg), 0) FROM ligne_bc l
                           WHERE l.id_bc = bc.id_bc) <= 0.001 THEN 'COMPLET'
                    WHEN (SELECT COALESCE(SUM(l.quantite_recue_kg), 0) FROM ligne_bc l
                           WHERE l.id_bc = bc.id_bc) > 0 THEN
                         CASE WHEN bc.date_livraison_prevue IS NOT NULL
                                   AND to_char(current_date, 'YYYY-MM-DD') > substr(bc.date_livraison_prevue, 1, 10)
                              THEN 'PARTIEL EN RETARD' ELSE 'PARTIEL' END
                    WHEN bc.date_livraison_prevue IS NOT NULL
                         AND to_char(current_date, 'YYYY-MM-DD') > substr(bc.date_livraison_prevue, 1, 10) THEN 'EN RETARD'
                    ELSE 'ATTENDU'
                END AS statut_livraison
           FROM bon_commande bc
           JOIN fournisseur f  ON f.code_fournisseur = bc.code_fournisseur
           LEFT JOIN utilisateur uc ON uc.id_utilisateur = bc.id_utilisateur_creation
           LEFT JOIN utilisateur uv ON uv.id_utilisateur = bc.id_utilisateur_validation
          WHERE ($1 IS NULL OR bc.statut = $1)
          ORDER BY bc.date_bc DESC LIMIT 200",
    )
    .bind(f.get("statut"))
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::BONS_COMMANDE, &mut valeur).await?;
    Ok(Json(valeur))
}

#[derive(Debug, Deserialize)]
pub struct NouveauBc {
    pub code_fournisseur: String,
    /// Date du bon. Absente : aujourd'hui. Un bon se saisit parfois apres coup.
    pub date_bc: Option<String>,
    pub date_livraison_prevue: Option<String>,
    pub motif_creation: Option<String>,
    pub notes: Option<String>,
    /// Lignes saisies en meme temps que l'entete. Tout part dans UNE
    /// transaction : un bon a moitie cree, avec un numero attribue et aucune
    /// ligne, serait un document fantome que personne ne saurait interpreter.
    pub lignes: Option<Vec<LigneBc>>,
}

pub async fn creer_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(b): Json<NouveauBc>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let (devise, conditions): (String, Option<String>) = sqlx::query_as(
        "SELECT COALESCE(code_devise, 'MAD'), conditions_paiement
           FROM fournisseur WHERE code_fournisseur = $1",
    )
    .bind(&b.code_fournisseur)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("fournisseur {}", b.code_fournisseur)))?;

    // RG-09 : le taux est fige a la creation puis reevalue a la validation.
    let taux: f64 = sqlx::query_scalar(
        "SELECT taux::float8 FROM taux_change
          WHERE code_devise = $1 AND to_char(current_date, 'YYYY-MM-DD') >= substr(date_debut, 1, 10)
            AND (date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(date_fin, 1, 10))
          ORDER BY date_debut DESC LIMIT 1",
    )
    .bind(&devise)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        AppError::RegleMetier(format!("Aucun taux de change en vigueur pour {devise}."))
    })?;

    let numero = numeroter(&mut tx, "bon_commande", "numero_bc", "BC").await?;
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO bon_commande
             (id_bc, numero_bc, code_fournisseur, code_devise, taux_change_engage,
              date_taux_engage, date_livraison_prevue, conditions_paiement,
              motif_creation, notes, montant_total_devise, montant_total_mad,
              id_utilisateur_creation, date_bc)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,0,$11,
                 COALESCE($12, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')))",
    )
    .bind(&id)
    .bind(&numero)
    .bind(&b.code_fournisseur)
    .bind(&devise)
    .bind(taux)
    .bind(maintenant())
    .bind(&b.date_livraison_prevue)
    .bind(&conditions)
    .bind(b.motif_creation.clone().unwrap_or_else(|| "MANUEL".into()))
    .bind(&b.notes)
    .bind(&user.id)
    .bind(&b.date_bc)
    .execute(&mut *tx)
    .await?;

    // --- Lignes saisies avec l'entete ---------------------------------------
    let mut posees = 0i64;
    for (i, l) in b.lignes.iter().flatten().enumerate() {
        valider_ligne_bc(l)?;
        let (kg, facteur) = poids_ligne_bc(&state.db, l).await?;
        inserer_ligne_bc(
            &mut tx,
            &uuid::Uuid::new_v4().to_string(),
            &id,
            (i + 1) as i64,
            l,
            kg,
            facteur,
            &devise,
            true,
        )
        .await?;
        posees += 1;
    }

    // Les propositions retenues passent a COMMANDE : le lien va dans les deux
    // sens des la creation, sans etape supplementaire.
    //
    // La protection contre le recalcul tombe avec la conversion, ici comme dans
    // domain/plan_achat.rs : ce que la ligne protegeait est desormais dans le
    // bon. Une proposition COMMANDE encore « protegee » serait comptee parmi les
    // arbitrages ouverts alors qu'elle n'engage plus rien.
    if posees > 0 {
        sqlx::query(
            "UPDATE plan_achat SET statut = 'COMMANDE', id_bc_genere = $1, figee = 0
              WHERE id_proposition IN (SELECT id_proposition FROM ligne_bc
                                        WHERE id_bc = $1 AND id_proposition IS NOT NULL)",
        )
        .bind(&id)
        .execute(&mut *tx)
        .await?;
        recalculer_bc(&mut tx, &id).await?;
    }

    tx.commit().await?;
    Ok(Json(json!({
        "id_bc": id, "numero_bc": numero, "code_devise": devise,
        "taux_change_engage": taux, "lignes": posees
    })))
}

pub async fn lignes_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Lire).await?;
    // Le besoin actuel est LU, jamais stocke : une alerte figee serait juste
    // jusqu'au prochain recalcul du MRP, puis mentirait sans le signaler.
    // L'ecart n'existe donc que le temps de l'affichage, et il est toujours vrai.
    let rows = sqlx::query(
        // LE NOM DE LA LIGNE VIENT DE LA REFERENCE, OU DE LA LIGNE ELLE-MEME.
        // Une ligne de service n'a pas de reference : c'est son libelle qui la
        // nomme. Sans ce COALESCE, le transport s'afficherait sans intitule.
        "SELECT l.*, COALESCE(r.designation, l.libelle) AS reference_designation,
                r.unite_catalogue,
                r.couleur, r.code_categorie, cat.libelle AS categorie_libelle,
                -- LES DEUX COLONNES QUE LE FOURNISSEUR LIT EN PREMIER : son code
                -- couleur — « 7612 », « CB-1426 » — et le titrage, qui est chez
                -- nous la FAMILLE : « 2900-DTEX », « 1200-DENIERS-SHRINK ».
                r.code_couleur, r.code_famille,
                r.poids_bobine_kg, r.bobines_par_palette, r.bobines_par_lot,
                -- Ce que le FOURNISSEUR lit sur le document : sa description
                -- commerciale en anglais, pas notre code interne.
                r.description_commerciale,

                -- Montant de la ligne en DIRHAMS. Il n'est pas stocke, et c'est
                -- volontaire : seul le taux ENGAGE du bon fait foi (RG-09), et le
                -- recopier sur la ligne creerait une seconde verite qui divergerait
                -- des que le taux du bon serait reevalue a la validation.
                ROUND(l.total_ligne_devise * bc.taux_change_engage, 2) AS total_ligne_mad,
                bc.taux_change_engage,

                -- Encombrement, pour la logistique : combien de palettes ce que
                -- l'on commande represente-t-il ? Sans les deux caracteristiques
                -- de conditionnement, la question n'a pas de reponse — et l'on
                -- affiche alors rien plutot qu'un zero qui passerait pour vrai.
                -- LE CONSTAT PRIME SUR LE CALCUL. Renseigne, quelqu'un a vu un
                -- colisage que la regle ne sait pas deviner ; son constat vaut
                -- mieux qu'une division.
                COALESCE(
                    l.nb_palettes_saisi,
                    CASE WHEN r.poids_bobine_kg > 0 AND r.bobines_par_palette > 0
                         THEN ROUND(l.quantite_commandee_kg
                                    / (r.poids_bobine_kg * r.bobines_par_palette), 2)
                    END
                ) AS nb_palettes,
                l.nb_bobines_saisi AS nb_bobines,

                COALESCE(b.besoin_12m_kg, 0) AS besoin_kg_actuel,
                CASE WHEN l.besoin_kg_origine IS NULL THEN NULL
                     ELSE ROUND(COALESCE(b.besoin_12m_kg, 0) - l.besoin_kg_origine, 4)
                END AS ecart_besoin_kg
           FROM ligne_bc l
           -- JOINTURE EXTERNE, et non interne : une ligne de service n'a pas de
           -- reference au catalogue. En interne, elle disparaissait purement et
           -- simplement de la fiche du bon ET du bon imprime — c'est-a-dire du
           -- document qu'on envoie au fournisseur et qu'il facture.
           LEFT JOIN reference r  ON r.code_reference = l.code_reference
           JOIN bon_commande bc  ON bc.id_bc = l.id_bc
           LEFT JOIN categorie_matiere cat ON cat.code_categorie = r.code_categorie
           LEFT JOIN v_besoin_12m b ON b.code_reference = l.code_reference
          WHERE l.id_bc = $1 ORDER BY l.ligne_numero",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::BONS_COMMANDE, &mut valeur).await?;
    Ok(Json(valeur))
}

#[derive(Debug, Deserialize)]
pub struct LigneBc {
    /// `MARCHANDISE` (defaut) ou `SERVICE`. Absent : de la marchandise.
    #[serde(default)]
    pub type_ligne: Option<String>,
    /// Nulle sur une ligne de service : il n'y a pas de reference a commander.
    pub code_reference: Option<String>,
    /// Ce que la ligne designe quand aucune reference ne la nomme.
    pub libelle: Option<String>,
    pub unite_commande: String,
    pub quantite_commandee_unite: f64,
    pub prix_unitaire_devise: f64,
    pub date_livraison_prevue: Option<String>,
    /// LE COLISAGE CONSTATE, quand il s'ecarte du calcul.
    ///
    /// La grille permet de DETACHER palettes, bobines et quantite : un
    /// fournisseur livre une palette entamee, et dix-sept palettes pleines plus
    /// une aux trois quarts ne se deduisent d'aucun poids. Sans ces deux
    /// champs, le nombre saisi partait au serveur qui ne le demandait pas : le
    /// detachement ne detachait rien, et le calcul reprenait la main au
    /// rechargement.
    ///
    /// `None` : on calcule, comme avant. C'est le cas courant.
    /// Decimal : une palette entamee se compte 21,64, pas 22.
    #[serde(default)]
    pub nb_palettes: Option<f64>,
    /// Entier : une bobine ne se coupe pas.
    #[serde(default)]
    pub nb_bobines: Option<i64>,
}

impl LigneBc {
    /// Une ligne SANS reference au catalogue : prestation ou ligne libre.
    ///
    /// Les deux se comportent pareil ici — ni poids, ni conversion, ni entree
    /// en stock. Ce qui les separe se joue au quai : un echantillon arrive,
    /// un fret non.
    fn sans_reference(&self) -> bool {
        matches!(self.type_ligne.as_deref(), Some("SERVICE") | Some("LIBRE"))
    }

    /// Ce qui nomme la ligne dans un message d'erreur.
    fn nom(&self) -> String {
        self.code_reference
            .clone()
            .or_else(|| self.libelle.clone())
            .unwrap_or_else(|| "ligne sans intitule".into())
    }
}

/// Ce qu'une ligne doit porter selon son type, dit AVANT d'ecrire.
///
/// La base le verifie aussi — le CHECK `ligne_bc_type_coherent` est la vraie
/// garantie. Mais une violation de contrainte remonte un message de PostgreSQL
/// que personne ne peut interpreter ; ici on nomme ce qui manque.
fn valider_ligne_bc(l: &LigneBc) -> AppResult<()> {
    if l.quantite_commandee_unite <= 0.0 || l.prix_unitaire_devise <= 0.0 {
        return Err(AppError::Invalide(format!(
            "{} : quantite et prix doivent etre strictement positifs",
            l.nom()
        )));
    }
    if l.sans_reference() {
        if l.libelle.as_deref().map(str::trim).unwrap_or("").is_empty() {
            return Err(AppError::Invalide(
                "Une ligne sans reference doit porter un intitule : c'est lui qui la \
                 nomme sur le bon envoye au fournisseur."
                    .into(),
            ));
        }
        if l.code_reference.is_some() {
            return Err(AppError::Invalide(
                "Une prestation ou une ligne libre ne se rattache a aucune reference \
                 du catalogue : elle n'entre jamais en stock."
                    .into(),
            ));
        }
    } else if l.code_reference.is_none() {
        return Err(AppError::Invalide(
            "Une ligne de marchandise exige une reference du catalogue.".into(),
        ));
    }
    Ok(())
}

/// Le poids et le facteur d'une ligne — ou la convention des prestations.
///
/// UNE PRESTATION N'A PAS DE POIDS. Zero kilo la fait sortir d'elle-meme de
/// toutes les vues d'en-cours, qui filtrent `quantite_restante_kg > 0` : il n'y
/// a pas un filtre a ajouter dans chacune. Le facteur vaut 1 pour que la colonne
/// generee `prix_kg_devise` reste calculable sans division par zero.
async fn poids_ligne_bc(db: &Db, l: &LigneBc) -> AppResult<(f64, f64)> {
    if l.sans_reference() {
        return Ok((0.0, 1.0));
    }
    let code = l
        .code_reference
        .as_deref()
        .ok_or_else(|| AppError::Invalide("une ligne de marchandise exige une reference".into()))?;
    vers_kg(db, code, l.quantite_commandee_unite, &l.unite_commande).await
}

/// L'INSERT d'une ligne de bon, marchandise ou prestation.
///
/// `INSERT … VALUES` ET NON `INSERT … SELECT … FROM reference`. L'ancienne forme
/// n'inserait RIEN quand la reference n'existait pas — sans erreur, sans
/// message : le bon sortait avec zero ligne alors que l'utilisateur croyait
/// avoir saisi. Une prestation, qui n'a par definition aucune reference,
/// tombait exactement dans ce piege.
///
/// `rattacher_au_plan` : a la creation, une ligne de marchandise reprend la
/// proposition d'achat qui la justifie et le besoin du moment. Une ligne
/// ajoutee apres coup ne le fait pas — la proposition ne serait alors marquee
/// COMMANDE nulle part, et resterait comptee parmi les arbitrages ouverts.
#[allow(clippy::too_many_arguments)]
async fn inserer_ligne_bc(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id_ligne: &str,
    id_bc: &str,
    numero: i64,
    l: &LigneBc,
    kg: f64,
    facteur: f64,
    devise: &str,
    rattacher_au_plan: bool,
) -> AppResult<()> {
    let (proposition, besoin) = if rattacher_au_plan {
        (
            "(SELECT pa.id_proposition FROM plan_achat pa
                WHERE pa.code_reference = $5
                  AND pa.statut IN ('PROPOSE','EN_REVISION','VALIDE') LIMIT 1)",
            // NULL et non zero sur une prestation : le CHECK de la table exige
            // qu'elle ne porte aucun besoin, et un zero serait un besoin.
            "CASE WHEN $5 IS NULL THEN NULL
                  ELSE COALESCE((SELECT bp.besoin_12m_kg FROM v_besoin_12m bp
                                  WHERE bp.code_reference = $5), 0) END",
        )
    } else {
        ("NULL", "NULL")
    };

    sqlx::query(&format!(
        "INSERT INTO ligne_bc
             (id_ligne_bc, id_bc, ligne_numero, type_ligne, code_reference, libelle,
              designation, unite_commande, facteur_kg, quantite_commandee_unite,
              quantite_commandee_kg, prix_unitaire_devise, code_devise,
              date_livraison_prevue, nb_palettes_saisi, nb_bobines_saisi,
              id_proposition, besoin_kg_origine)
         VALUES ($1, $2, $3, $4, $5, $6,
                 COALESCE((SELECT r.designation FROM reference r
                            WHERE r.code_reference = $5), $6),
                 $7, $8, $9, $10, $11, $12, $13, $14, $15, {proposition}, {besoin})"
    ))
    .bind(id_ligne)
    .bind(id_bc)
    .bind(numero)
    .bind(
        l.type_ligne
            .as_deref()
            .filter(|t| *t == "SERVICE" || *t == "LIBRE")
            .unwrap_or("MARCHANDISE"),
    )
    .bind(&l.code_reference)
    .bind(l.libelle.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(&l.unite_commande)
    .bind(facteur)
    .bind(l.quantite_commandee_unite)
    .bind(kg)
    .bind(l.prix_unitaire_devise)
    .bind(devise)
    .bind(&l.date_livraison_prevue)
    // LES TROIS EXPRESSIONS SE STOCKENT, LIEES OU NON. Quantite, palettes et
    // bobines disent la meme marchandise de trois facons ; n'en garder qu'une
    // obligeait a rededuire les autres, et la deduction se trompe des que le
    // colisage reel s'ecarte du theorique.
    .bind(l.nb_palettes)
    .bind(l.nb_bobines)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Modification partielle d'une ligne : seuls les champs fournis changent.
#[derive(Debug, Deserialize)]
pub struct ModifLigneBc {
    pub quantite_commandee_unite: Option<f64>,
    pub prix_unitaire_devise: Option<f64>,
    pub date_livraison_prevue: Option<String>,
    /// CORRIGER UNE LIGNE DOIT COUTER CE QUE COUTE LA SAISIR, pas davantage.
    ///
    /// Ces trois-la manquaient : on ne pouvait retoucher qu'une quantite et un
    /// prix. Changer la reference, l'unite ou le colisage obligeait a supprimer
    /// la ligne et a la refaire — et l'ecran, lui, les envoyait deja : ils
    /// etaient acceptes puis ignores en silence, ce qui est pire qu'un refus.
    #[serde(default)]
    pub code_reference: Option<String>,
    #[serde(default)]
    pub unite_commande: Option<String>,
    #[serde(default)]
    pub nb_palettes: Option<f64>,
    #[serde(default)]
    pub nb_bobines: Option<i64>,
}

/// Recalcule les totaux de l'entete a partir des lignes.
async fn recalculer_bc(tx: &mut sqlx::PgConnection, id: &str) -> AppResult<()> {
    sqlx::query(
        "UPDATE bon_commande
            SET montant_total_devise = (SELECT COALESCE(SUM(total_ligne_devise), 0)
                                          FROM ligne_bc WHERE id_bc = $1),
                montant_total_mad    = ROUND((SELECT COALESCE(SUM(total_ligne_devise), 0)
                                                FROM ligne_bc WHERE id_bc = $1)
                                             * taux_change_engage, 2)
          WHERE id_bc = $1",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    Ok(())
}

pub async fn ajouter_ligne_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(l): Json<LigneBc>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Ecrire).await?;
    valider_ligne_bc(&l)?;

    // Le facteur est fige sur la ligne : si le conditionnement du fournisseur
    // change, les commandes passees restent reconstituables.
    let (kg, facteur) = poids_ligne_bc(&state.db, &l).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let (statut, devise): (String, String) =
        sqlx::query_as("SELECT statut, code_devise FROM bon_commande WHERE id_bc = $1")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("bon de commande {id}")))?;
    if statut != "BROUILLON" && statut != "EN_ATTENTE_VALIDATION" {
        return Err(AppError::RegleMetier(format!(
            "Un bon de commande {statut} ne peut plus etre modifie."
        )));
    }

    let numero: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(ligne_numero), 0) + 1 FROM ligne_bc WHERE id_bc = $1",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;

    let id_ligne = uuid::Uuid::new_v4().to_string();
    inserer_ligne_bc(&mut tx, &id_ligne, &id, numero, &l, kg, facteur, &devise, false).await?;

    recalculer_bc(&mut tx, &id).await?;
    tx.commit().await?;

    Ok(Json(json!({
        "id_ligne_bc": id_ligne, "ligne_numero": numero,
        "quantite_commandee_kg": kg, "facteur_kg": facteur
    })))
}

pub async fn supprimer_ligne_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((id, ligne)): Path<(String, String)>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let recue: f64 = sqlx::query_scalar(
        "SELECT COALESCE(quantite_recue_kg, 0)::float8 FROM ligne_bc
          WHERE id_ligne_bc = $1",
    )
    .bind(&ligne)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("ligne {ligne}")))?;
    if recue > 0.0 {
        return Err(AppError::RegleMetier(
            "Cette ligne a deja fait l'objet d'une reception : elle ne peut plus etre supprimee.".into(),
        ));
    }

    // La proposition d'origine retourne au pool AVANT la suppression, tant que
    // la ligne existe encore pour la designer. Le lien est porte par la LIGNE :
    // supprimer une ligne libere sa proposition meme si le reste du bon tient.
    // Rattache au bon entier, la reference serait restee bloquee en COMMANDE,
    // invisible pour le MRP, sans qu'aucune commande ne la couvre.
    let liberee: u64 = sqlx::query(
        "UPDATE plan_achat SET statut = 'PROPOSE', id_bc_genere = NULL
          WHERE statut = 'COMMANDE'
            AND id_proposition = (SELECT id_proposition FROM ligne_bc WHERE id_ligne_bc = $1)",
    )
    .bind(&ligne)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    sqlx::query("DELETE FROM ligne_bc WHERE id_ligne_bc = $1")
        .bind(&ligne)
        .execute(&mut *tx)
        .await?;
    recalculer_bc(&mut tx, &id).await?;
    tx.commit().await?;

    Ok(Json(json!({ "supprime": true, "proposition_liberee": liberee > 0 })))
}

#[derive(Debug, Deserialize)]
pub struct StatutBc {
    pub statut: String,
}

/// `DELETE /api/bons-commande/{id}` — la vraie suppression d'un bon non engage.
///
/// POURQUOI UNE SUPPRESSION ET NON UNE ANNULATION. Un bon annule reste dans la
/// liste, dans les etats, dans la numerotation. C'est juste pour un document
/// qui a engage quelque chose : on ne fait pas disparaitre un engagement, on
/// le contre-passe. Mais un BROUILLON n'engage rien, et un bon SOUMIS A
/// VALIDATION non plus — personne n'a signe, aucun fournisseur n'a ete
/// prevenu, aucun stock n'a bouge. Le garder « annule » pour la forme encombre
/// la liste de documents qui n'ont jamais existe pour personne.
///
/// LA LIMITE EST NETTE, ET ELLE NE SE NEGOCIE PAS : des qu'un bon est VALIDE,
/// il a engage l'entreprise. Il ne se supprime plus ; il s'annule, et la trace
/// demeure. Voir `changer_statut_bc`.
///
/// CE QUI EST VERIFIE AVANT D'EFFACER :
///   * le statut — brouillon ou en attente de validation, rien d'autre ;
///   * l'absence de reception : une marchandise deja recue contre ce bon en
///     fait un document engage, quel que soit son statut affiche.
///
/// LES PROPOSITIONS D'ACHAT RETOURNENT AU POOL. Sans ce retour, la reference
/// resterait marquee COMMANDE et le MRP ne la reproposerait jamais : un besoin
/// disparaitrait pour un bon qui n'existe plus.
pub async fn supprimer_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Ecrire).await?;

    let statut: String = sqlx::query_scalar("SELECT statut FROM bon_commande WHERE id_bc = $1")
        .bind(&id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("bon de commande {id}")))?;

    if statut != "BROUILLON" && statut != "EN_ATTENTE_VALIDATION" {
        return Err(AppError::RegleMetier(format!(
            "ce bon est {} : il a engage l'entreprise et ne se supprime plus.              Annulez-le — la trace restera.",
            statut.to_lowercase().replace('_', " ")
        )));
    }

    let receptions: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM reception WHERE id_bc = $1")
            .bind(&id)
            .fetch_one(&state.db)
            .await?;
    if receptions > 0 {
        return Err(AppError::RegleMetier(format!(
            "{receptions} reception(s) se rattachent a ce bon : il a servi, il ne se supprime pas."
        )));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    sqlx::query(
        "UPDATE plan_achat SET statut = 'PROPOSE', id_bc_genere = NULL
          WHERE statut = 'COMMANDE'
            AND id_proposition IN (SELECT id_proposition FROM ligne_bc
                                    WHERE id_bc = $1 AND id_proposition IS NOT NULL)",
    )
    .bind(&id)
    .execute(&mut *tx)
    .await?;

    let lignes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ligne_bc WHERE id_bc = $1")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM ligne_bc WHERE id_bc = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM bon_commande WHERE id_bc = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Json(json!({ "supprime": id, "lignes": lignes, "statut_avant": statut })))
}

pub async fn changer_statut_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(s): Json<StatutBc>,
) -> AppResult<Json<Value>> {
    let action = if s.statut == "VALIDE" { Action::Valider } else { Action::Ecrire };
    user.exiger(&state.db, module::BONS_COMMANDE, action).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let createur: String = sqlx::query_scalar(
        "SELECT id_utilisateur_creation FROM bon_commande WHERE id_bc = $1",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("bon de commande {id}")))?;

    if s.statut == "VALIDE" {
        // B4 regle 4 : la separation des taches. Un declencheur de la base la
        // tient aussi, mais un message metier vaut mieux qu'une exception SQL.
        //
        // LE SUPERVISEUR EN EST DISPENSE, sur decision de la direction. Dans
        // une PME il est souvent seul a saisir ET seul a pouvoir engager : lui
        // interdire de valider ne cree pas un second regard, cela cree un bon
        // bloque — et quelqu'un finit par partager un mot de passe pour en
        // sortir. Une regle qu'on contourne protege moins qu'une regle qu'on
        // assume. La TRACE, elle, reste entiere : le journal montre qui a
        // valide, et donc qu'il s'agissait de l'auteur.
        if createur == user.id && user.role != "ADMIN" {
            return Err(AppError::RegleMetier(
                "B4 regle 4 : vous ne pouvez pas valider un bon de commande que vous avez cree.".into(),
            ));
        }

        let lignes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ligne_bc WHERE id_bc = $1")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
        if lignes == 0 {
            return Err(AppError::RegleMetier(
                "Un bon de commande sans ligne ne peut pas etre valide.".into(),
            ));
        }

        // RG-09 : le taux retenu est celui du jour de la validation, pas celui de
        // la creation. Un bon de commande se prepare sur des semaines ; le change
        // a bouge entre-temps.
        //
        // Le reengagement precede le controle de plafond, et ce n'est pas un
        // detail d'ordre : le plafond doit porter sur ce qui est REELLEMENT
        // engage. Verifie avant, il jugeait un montant calcule au taux de la
        // creation — un acheteur pouvait donc engager au-dela de son plafond des
        // que la devise montait. Si le controle echoue, la transaction est
        // annulee et le taux revient a sa valeur d'origine.
        sqlx::query(
            "UPDATE bon_commande
                SET taux_change_engage = COALESCE((
                        SELECT t.taux FROM taux_change t
                         WHERE t.code_devise = bon_commande.code_devise
                           AND to_char(current_date, 'YYYY-MM-DD') >= substr(t.date_debut, 1, 10)
                           AND (t.date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(t.date_fin, 1, 10))
                         ORDER BY t.date_debut DESC LIMIT 1), taux_change_engage),
                    date_taux_engage = $2
              WHERE id_bc = $1",
        )
        .bind(&id)
        .bind(maintenant())
        .execute(&mut *tx)
        .await?;

        recalculer_bc(&mut tx, &id).await?;

        // B4 regle 3 : validation par paliers de montant, sur le montant reengage.
        let montant: f64 =
            sqlx::query_scalar(
        "SELECT COALESCE(montant_total_mad, 0)::float8 FROM bon_commande WHERE id_bc = $1",
    )
                .bind(&id)
                .fetch_one(&mut *tx)
                .await?;
        if let Some(plafond) =
            crate::auth::rbac::plafond_validation_bc(&state.db, &user.role).await?
        {
            if montant > plafond {
                return Err(AppError::RegleMetier(format!(
                    "Montant de {montant:.2} MAD superieur a votre plafond de validation \
                     ({plafond:.2} MAD). La Direction doit valider ce bon de commande."
                )));
            }
        }

        sqlx::query(
            "UPDATE bon_commande
                SET statut = 'VALIDE', date_validation = $2, id_utilisateur_validation = $3
              WHERE id_bc = $1",
        )
        .bind(&id)
        .bind(maintenant())
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;
    } else {
        let date_envoi = if s.statut == "ENVOYE" { Some(maintenant()) } else { None };
        sqlx::query(
            "UPDATE bon_commande SET statut = $2, date_envoi = COALESCE($3, date_envoi)
              WHERE id_bc = $1",
        )
        .bind(&id)
        .bind(&s.statut)
        .bind(date_envoi)
        .execute(&mut *tx)
        .await?;

        // Un bon annule n'engage plus rien : ses propositions retournent au pool
        // et redeviennent regenerables. Sans ce retour, la reference resterait
        // marquee COMMANDE et le MRP ne la reproposerait jamais — un besoin
        // disparaitrait pour une commande qui n'existe plus.
        if s.statut == "ANNULE" {
            // Le lien passe par les LIGNES : c'est la granularite a laquelle une
            // proposition est engagee. Annuler le bon annule donc chacune de ses
            // lignes, une par une, et non le bon en bloc.
            sqlx::query(
                "UPDATE plan_achat SET statut = 'PROPOSE', id_bc_genere = NULL
                  WHERE statut = 'COMMANDE'
                    AND id_proposition IN (SELECT id_proposition FROM ligne_bc
                                            WHERE id_bc = $1 AND id_proposition IS NOT NULL)",
            )
            .bind(&id)
            .execute(&mut *tx)
            .await?;
            sqlx::query("UPDATE ligne_bc SET statut = 'ANNULE' WHERE id_bc = $1")
                .bind(&id)
                .execute(&mut *tx)
                .await?;
        }
    }

    tx.commit().await?;
    Ok(Json(json!({ "id_bc": id, "statut": s.statut })))
}

#[derive(Debug, Deserialize)]
pub struct ModifBc {
    pub date_bc: Option<String>,
    pub date_livraison_prevue: Option<String>,
    pub conditions_paiement: Option<String>,
    pub notes: Option<String>,
    pub motif_creation: Option<String>,
    /// Ce que le document fournisseur imprime en face de « SHIPMENT DATE ».
    pub mention_expedition: Option<String>,
    /// Force le nombre de conteneurs annonce, au lieu de le laisser calculer.
    /// Une chaine vide vaut « reprends le calcul » — d'ou `Option<String>` :
    /// un `Option<i64>` ne saurait pas distinguer « efface » de « ne touche pas ».
    pub nombre_conteneurs: Option<String>,
}

/// Modifie l'entete d'un bon de commande tant qu'il n'est pas engage.
///
/// Il manquait purement et simplement : on pouvait creer un bon et changer son
/// statut, mais pas corriger une date de livraison ou une condition de paiement.
/// Un bon se prepare sur des semaines — l'obliger a naitre parfait n'avait aucun
/// sens.
///
/// Le fournisseur, lui, ne se change pas : la devise, le taux engage et les
/// prix des lignes en decoulent. Changer de fournisseur, c'est un autre bon.
pub async fn modifier_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(b): Json<ModifBc>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: String =
        sqlx::query_scalar("SELECT statut FROM bon_commande WHERE id_bc = $1")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("bon de commande {id}")))?;
    if statut != "BROUILLON" && statut != "EN_ATTENTE_VALIDATION" {
        return Err(AppError::RegleMetier(format!(
            "Un bon de commande {statut} ne peut plus etre modifie."
        )));
    }

    sqlx::query(
        "UPDATE bon_commande
            SET date_bc               = COALESCE($2, date_bc),
                date_livraison_prevue = COALESCE($3, date_livraison_prevue),
                conditions_paiement   = COALESCE($4, conditions_paiement),
                notes                 = COALESCE($5, notes),
                motif_creation        = COALESCE($6, motif_creation),
                mention_expedition    = COALESCE($7, mention_expedition),
                -- UNE CHAINE VIDE EFFACE, et c'est la difference qui compte :
                -- vider le champ doit rendre la main au calcul, pas conserver
                -- le dernier chiffre force. `NULLIF` en fait un NULL ; le
                -- `CASE` distingue « champ absent de la requete » — on ne
                -- touche a rien — de « champ present mais vide » — on efface.
                nombre_conteneurs     = CASE WHEN $8::text IS NULL THEN nombre_conteneurs
                                             ELSE NULLIF($8, '')::bigint END
          WHERE id_bc = $1",
    )
    .bind(&id)
    .bind(&b.date_bc)
    .bind(&b.date_livraison_prevue)
    .bind(&b.conditions_paiement)
    .bind(&b.notes)
    .bind(&b.motif_creation)
    .bind(&b.mention_expedition)
    .bind(&b.nombre_conteneurs)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "id_bc": id, "modifie": true })))
}

/// Les references commandables aupres du fournisseur du bon, avec leur contexte.
///
/// La saisie proposait tout le catalogue dans une liste deroulante : deux mille
/// references, celles des autres fournisseurs comprises, sans stock, sans besoin
/// et sans prix. On choisissait un code a l'aveugle.
///
/// Ici chaque reference arrive avec ce qui permet de decider : ce qu'il en reste
/// en projete, ce que le plan d'achat suggere d'en commander, a quelle urgence,
/// et a quel prix. C'est le plan d'achat amene DANS la saisie, plutot qu'un
/// ecran a consulter a cote.
pub async fn references_commandables(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(q): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Lire).await?;

    // Deux appels possibles : depuis un bon existant, ou a la CREATION, quand
    // aucun bon n'existe encore et qu'on vient seulement de choisir le
    // fournisseur. Le second cas est celui qui compte : c'est la que l'acheteur
    // decide quoi commander, pas apres avoir ouvert un document vide.
    let id = q.get("id_bc").cloned().unwrap_or_default();

    // `toutes=1` : TOUT LE CATALOGUE, pas seulement les references rattachees a
    // ce fournisseur. Le rattachement du catalogue est une habitude d'achat, pas
    // une exclusivite : un fournisseur qui propose un meilleur prix sur un fil
    // qu'on achete ailleurs doit pouvoir etre commande. L'ecran reste par defaut
    // sur les siennes — c'est ce qu'on commande neuf fois sur dix — et ouvre le
    // catalogue entier sur demande.
    let toutes: i64 = if q.get("toutes").map(String::as_str) == Some("1") { 1 } else { 0 };

    // LA RECHERCHE SE FAIT ICI, PAS DANS LE NAVIGATEUR.
    //
    // Sur 124 references, charger tout le catalogue et filtrer a l'ecran
    // passait. Sur 1000 — et ce catalogue y va — c'est une seconde d'attente a
    // chaque ouverture d'ecran, et une liste que personne ne peut parcourir.
    // L'acheteur tape « bleu 1500 » : le serveur rend les quelques lignes qui
    // correspondent, avec leur prix et ce que le plan en dit.
    //
    // Chaque mot doit etre trouve, dans n'importe quelle colonne : la reference,
    // la designation, la couleur, le type de fil, ou le nom du fournisseur —
    // ce dernier compte quand on ouvre le catalogue entier.
    let recherche = q.get("recherche").map(|s| s.trim()).filter(|s| !s.is_empty());
    let mots: Vec<String> = recherche
        .map(|r| r.split_whitespace().map(|m| format!("%{m}%")).collect())
        .unwrap_or_default();
    let filtre_recherche = if mots.is_empty() {
        String::new()
    } else {
        // $5 et au-dela : les quatre premiers parametres sont deja pris.
        (0..mots.len())
            .map(|i| {
                let n = i + 5;
                format!(
                    " AND (r.code_reference ILIKE ${n} OR r.designation ILIKE ${n}
                           OR COALESCE(r.couleur, '') ILIKE ${n}
                           OR COALESCE(r.type_fil, '') ILIKE ${n}
                           OR f.nom ILIKE ${n})"
                )
            })
            .collect()
    };
    // Une recherche rend peu de lignes ; sans recherche on garde le plafond
    // d'origine, puisque l'ecran groupe encore par section.
    let plafond: i64 = q
        .get("limite")
        .and_then(|v| v.parse().ok())
        .unwrap_or(if recherche.is_some() { 25 } else { 2000 })
        .clamp(1, 2000);

    let fournisseur: String = match q.get("code_fournisseur") {
        Some(f) if !f.is_empty() => f.clone(),
        _ => sqlx::query_scalar("SELECT code_fournisseur FROM bon_commande WHERE id_bc = $1")
            .bind(&id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| {
                AppError::Invalide("preciser code_fournisseur ou id_bc".into())
            })?,
    };

    // Le taux sert a proposer le prix dans la devise du bon. A la creation il
    // n'y a pas encore de bon : on prend le taux en vigueur pour la devise du
    // fournisseur, celui-la meme qui sera engage a la creation.
    let taux: f64 = sqlx::query_scalar(
        "SELECT COALESCE((SELECT t.taux FROM taux_change t
                           JOIN fournisseur f ON f.code_devise = t.code_devise
                          WHERE f.code_fournisseur = $2
                            AND to_char(current_date, 'YYYY-MM-DD') >= substr(t.date_debut, 1, 10)
                            AND (t.date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(t.date_fin, 1, 10))
                          ORDER BY t.date_debut DESC LIMIT 1),
                        (SELECT bc.taux_change_engage FROM bon_commande bc WHERE bc.id_bc = $1),
                        1.0)::float8",
    )
    .bind(&id)
    .bind(&fournisseur)
    .fetch_one(&state.db)
    .await?;

    let sql_commandables = format!(
        "SELECT r.code_reference, r.designation, r.unite_catalogue, r.prix_catalogue,
                r.code_devise_catalogue, r.classe_abc, r.moq_kg, r.multiple_achat_kg,
                -- LE CONDITIONNEMENT VOYAGE AVEC LA SUGGESTION.
                --
                -- L'ecran convertissait palettes et bobines en kilos grace au
                -- catalogue entier, charge a chaque ouverture. A mille
                -- references ce n'est plus tenable : les parametres partent
                -- desormais avec chaque ligne trouvee, et le catalogue n'est
                -- plus charge du tout.
                r.poids_bobine_kg, r.bobines_par_palette, r.bobines_par_lot,
                r.densite_kg_ml, r.description_commerciale,
                -- CE QUE LE FOURNISSEUR RECONNAIT. Le bon part chez lui : il y
                -- lit SON code article et SON code couleur, pas les notres.
                r.reference_fournisseur, r.couleur, r.code_couleur,
                -- LE FOURNISSEUR HABITUEL, pas une exclusivite. Le catalogue dit
                -- chez qui on achete d'ordinaire ; rien n'empeche de commander
                -- le meme fil ailleurs quand le prix ou le delai l'exigent. Le
                -- bon doit donc pouvoir porter une reference d'un autre, en le
                -- DISANT — d'ou cette colonne, que l'ecran affiche en clair.
                r.code_fournisseur,
                sp.stock_mrp_kg, sp.stock_projete_kg, sp.encours_kg, sp.besoin_12m_kg,
                sp.jours_couverture, sp.statut AS statut_stock,
                sp.besoin_12m_kg, sp.encours_kg AS deja_commande_kg,
                pa.risque_sourcing, f.delai_livraison_jours, f.nom AS fournisseur_nom,
                -- Le minimum vient du plan d'achat : c'est lui qui applique la
                -- formule F3 (couverture, marge, classe ABC), pas la vue stock.
                pa.stock_min_kg,
                pa.qte_a_commander_kg, pa.qte_a_commander_unite, pa.tier,

                -- Prix propose, TOUJOURS renseigne, dans la devise du bon.
                --
                -- Trois sources, dans l'ordre de fiabilite : le prix retenu par
                -- le plan d'achat, sinon le CMUP — ce qu'on a reellement paye —
                -- sinon le catalogue converti. Sans ce repli, la saisie
                -- n'affichait aucun prix des que le stock couvrait les besoins,
                -- puisque le plan d'achat ne proposait plus rien.
                --
                -- La source est dite, jamais devinee (RG-08) : un prix catalogue
                -- est une intention de vendeur, pas un cout constate.
                COALESCE(pa.prix_estime_mad, r.cmup_mad,
                         ROUND(r.prix_catalogue_kg * COALESCE((
                             SELECT t.taux FROM taux_change t
                              WHERE t.code_devise = r.code_devise_catalogue
                                AND to_char(current_date, 'YYYY-MM-DD') >= substr(t.date_debut, 1, 10)
                                AND (t.date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(t.date_fin, 1, 10))
                              ORDER BY t.date_debut DESC LIMIT 1), 1.0), 4)) AS prix_mad_suggere,
                ROUND(COALESCE(pa.prix_estime_mad, r.cmup_mad,
                         r.prix_catalogue_kg * COALESCE((
                             SELECT t.taux FROM taux_change t
                              WHERE t.code_devise = r.code_devise_catalogue
                                AND to_char(current_date, 'YYYY-MM-DD') >= substr(t.date_debut, 1, 10)
                                AND (t.date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(t.date_fin, 1, 10))
                              ORDER BY t.date_debut DESC LIMIT 1), 1.0))
                      -- LE TAUX ARRIVE EN `float8` (il est lie depuis un `f64`).
                      -- Sans ce cast, la division rend un `double precision`,
                      -- et PostgreSQL n'a pas de `round(double precision, int)` :
                      -- la requete entiere echouait en 500, donc l'ecran de
                      -- creation d'un bon n'affichait AUCUNE reference — sans
                      -- un mot expliquant pourquoi.
                      / $3::numeric, 6) AS prix_suggere_devise,
                CASE WHEN pa.prix_estime_mad IS NOT NULL THEN pa.source_prix
                     WHEN r.cmup_mad IS NOT NULL THEN 'CMUP'
                     ELSE 'CATALOGUE' END AS source_prix,
                -- Deja saisie sur ce bon : on la montre barree plutot que de la
                -- masquer, sinon on la cherche sans comprendre pourquoi elle
                -- manque.
                (SELECT COUNT(*) FROM ligne_bc l
                  WHERE l.id_bc = $1 AND l.code_reference = r.code_reference) AS deja_sur_le_bon,

                -- EQUIVALENCE. Le filtre par fournisseur reste : un bon est
                -- adresse a UN fournisseur, et proposer la reference d'un autre
                -- n'aurait aucun sens. Ce qui manquait, c'est le rapprochement :
                -- cette reference-ci, que ce fournisseur livre, est peut-etre
                -- l'equivalent d'une reference en tension qu'on achete ailleurs.
                --
                -- Sans cette colonne, elle se noie dans « les autres references
                -- du fournisseur » et personne ne fait le lien au moment ou il
                -- serait le plus utile — celui de la saisie.
                (SELECT e.code_reference FROM v_equivalence e
                   WHERE e.equivalent_reference = r.code_reference
                     AND e.interchangeable = 1
                     AND COALESCE(e.stock_projete_kg, 0) < COALESCE(e.besoin_12m_kg, 0)
                   ORDER BY COALESCE(e.stock_projete_kg, 0) - COALESCE(e.besoin_12m_kg, 0)
                   LIMIT 1)                                        AS equivalent_de,
                (SELECT ROUND(COALESCE(e.besoin_12m_kg, 0), 3) FROM v_equivalence e
                   WHERE e.equivalent_reference = r.code_reference
                     AND e.interchangeable = 1
                     AND COALESCE(e.stock_projete_kg, 0) < COALESCE(e.besoin_12m_kg, 0)
                   ORDER BY COALESCE(e.stock_projete_kg, 0) - COALESCE(e.besoin_12m_kg, 0)
                   LIMIT 1)                                        AS besoin_equivalent_kg,
                (SELECT COUNT(*) FROM v_equivalence e
                   WHERE e.code_reference = r.code_reference)      AS nb_equivalents
           FROM reference r
           JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
           LEFT JOIN v_stock_projete sp ON sp.code_reference = r.code_reference
           LEFT JOIN v_plan_achat    pa ON pa.code_reference = r.code_reference
          WHERE r.actif = 1 AND ($4 = 1 OR r.code_fournisseur = $2){filtre_recherche}
          -- CE QUE LE PLAN RECLAME D'ABORD, puis ce qui est en tension. Quand on
          -- cherche a la frappe, les premieres lignes doivent etre celles qu'on
          -- avait des raisons de commander.
          ORDER BY CASE WHEN COALESCE(pa.qte_a_commander_kg, 0) > 0 THEN 0 ELSE 1 END,
                   CASE sp.statut WHEN 'RUPTURE' THEN 1 WHEN 'CRITIQUE' THEN 2
                                  WHEN 'ATTENTION' THEN 3 ELSE 4 END,
                   r.code_reference
          LIMIT {plafond}"
    );
    let mut requete = sqlx::query(&sql_commandables)
    .bind(&id)
    .bind(&fournisseur)
    .bind(taux)
    .bind(toutes);
    for mot in &mots {
        requete = requete.bind(mot);
    }
    let rows = requete.fetch_all(&state.db).await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::BONS_COMMANDE, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Modifie une ligne de bon de commande, et la VERROUILLE.
///
/// C'est le geste qui verrouille, pas une case a cocher : toucher a la quantite,
/// au prix ou a la date, c'est arbitrer. La ligne cesse alors de suivre le plan,
/// et le recalcul se contentera de signaler que le besoin a bouge.
pub async fn modifier_ligne_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((id, ligne)): Path<(String, String)>,
    Json(l): Json<ModifLigneBc>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // `Option<String>` POUR LA REFERENCE : une ligne de prestation n'en porte
    // pas. Decodee en `String`, sqlx echouait en erreur interne des qu'on
    // touchait au prix d'un transport.
    let (statut_bc, type_ligne, code_reference, unite, recue): (
        String,
        String,
        Option<String>,
        String,
        f64,
    ) = sqlx::query_as(
            "SELECT bc.statut, lb.type_ligne, lb.code_reference, lb.unite_commande,
                    COALESCE(lb.quantite_recue_kg, 0)::float8
               FROM ligne_bc lb JOIN bon_commande bc ON bc.id_bc = lb.id_bc
              WHERE lb.id_ligne_bc = $1 AND lb.id_bc = $2",
        )
        .bind(&ligne)
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("ligne {ligne}")))?;

    if statut_bc != "BROUILLON" && statut_bc != "EN_ATTENTE_VALIDATION" {
        return Err(AppError::RegleMetier(format!(
            "Un bon de commande {statut_bc} ne peut plus etre modifie."
        )));
    }

    // LA REFERENCE ET L'UNITE SE TRAITENT AVANT LA QUANTITE : elles changent
    // le facteur de conversion, donc les kilos que la quantite represente.
    // Les poser apres recalculerait le poids avec l'ancien facteur.
    let code_reference = match l.code_reference.as_deref().map(str::trim) {
        Some(c) if !c.is_empty() && Some(c) != code_reference.as_deref() => {
            if recue > 0.0 {
                return Err(AppError::RegleMetier(format!(
                    "Deja {recue:.2} kg receptionnes sur cette ligne : sa reference ne peut                      plus changer. Retirez la ligne et saisissez-en une autre."
                )));
            }
            sqlx::query(
                "UPDATE ligne_bc SET code_reference = $2,
                        designation = COALESCE((SELECT r.designation FROM reference r
                                                 WHERE r.code_reference = $2), designation)
                  WHERE id_ligne_bc = $1",
            )
            .bind(&ligne)
            .bind(c)
            .execute(&mut *tx)
            .await?;
            Some(c.to_string())
        }
        _ => code_reference,
    };
    let unite = match l.unite_commande.as_deref().map(str::trim) {
        Some(u) if !u.is_empty() => {
            sqlx::query("UPDATE ligne_bc SET unite_commande = $2 WHERE id_ligne_bc = $1")
                .bind(&ligne)
                .bind(u)
                .execute(&mut *tx)
                .await?;
            u.to_string()
        }
        _ => unite,
    };

    // LE COLISAGE SE GARDE, LIE OU DETACHE. Les trois expressions disent la
    // meme marchandise ; n'en retenir qu'une obligeait a rededuire les autres,
    // et la deduction se trompe des que le colisage reel s'ecarte du theorique.
    if l.nb_palettes.is_some() || l.nb_bobines.is_some() {
        sqlx::query(
            "UPDATE ligne_bc SET nb_palettes_saisi = $2, nb_bobines_saisi = $3
              WHERE id_ligne_bc = $1",
        )
        .bind(&ligne)
        .bind(l.nb_palettes)
        .bind(l.nb_bobines)
        .execute(&mut *tx)
        .await?;
    }

    if let Some(q) = l.quantite_commandee_unite {
        if q <= 0.0 {
            return Err(AppError::Invalide("la quantite doit etre positive".into()));
        }
        // Une prestation garde son poids nul et son facteur de 1 : c'est ce que
        // le CHECK de la table exige, et il n'y a rien a convertir.
        let (kg, facteur) = if type_ligne != "MARCHANDISE" {
            (0.0, 1.0)
        } else {
            let code = code_reference.as_deref().ok_or_else(|| {
                AppError::Invalide("ligne de marchandise sans reference".into())
            })?;
            vers_kg(&state.db, code, q, &unite).await?
        };
        if kg < recue {
            return Err(AppError::RegleMetier(format!(
                "Deja {recue:.2} kg receptionnes sur cette ligne : la quantite ne peut pas \
                 descendre a {kg:.2} kg."
            )));
        }
        sqlx::query(
            "UPDATE ligne_bc SET quantite_commandee_unite = $2, quantite_commandee_kg = $3,
                                 facteur_kg = $4
              WHERE id_ligne_bc = $1",
        )
        .bind(&ligne)
        .bind(q)
        .bind(kg)
        .bind(facteur)
        .execute(&mut *tx)
        .await?;
    }

    if let Some(p) = l.prix_unitaire_devise {
        if p <= 0.0 {
            return Err(AppError::Invalide("le prix doit etre positif".into()));
        }
        sqlx::query("UPDATE ligne_bc SET prix_unitaire_devise = $2 WHERE id_ligne_bc = $1")
            .bind(&ligne)
            .bind(p)
            .execute(&mut *tx)
            .await?;
    }

    if let Some(d) = &l.date_livraison_prevue {
        sqlx::query("UPDATE ligne_bc SET date_livraison_prevue = $2 WHERE id_ligne_bc = $1")
            .bind(&ligne)
            .bind(d)
            .execute(&mut *tx)
            .await?;
    }

    sqlx::query("UPDATE ligne_bc SET arbitree = 1 WHERE id_ligne_bc = $1")
        .bind(&ligne)
        .execute(&mut *tx)
        .await?;

    recalculer_bc(&mut tx, &id).await?;
    tx.commit().await?;

    Ok(Json(json!({ "id_ligne_bc": ligne, "arbitree": true })))
}

// ============================================================================
// Receptions
// ============================================================================

pub async fn lister_receptions(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;
    let rows = sqlx::query(
        // Bloc OTIF, colonnes J a P de la feuille Receptions.
        //
        //   delai_reel  = date de reception  - date du bon
        //   delai_prevu = date prevue        - date du bon
        //   retard      = reel - prevu
        //   on_time     = 1 si reel <= prevu
        //   in_full     = 1 si pese >= commande x (1 - tolerance)
        //   in_spec     = 1 si toutes les lignes sont conformes
        //   OTIF        = on_time x in_full x in_spec
        //
        // Le produit, et non la moyenne : une livraison a l'heure mais incomplete
        // n'est pas « aux deux tiers bonne », elle a manque. C'est ce qui rend
        // l'indicateur exigeant, et c'est pour cela qu'il vaut quelque chose.
        //
        // Tout est calcule a la lecture, jamais stocke : une pesee corrigee ou
        // une ligne passee en quarantaine doit changer l'OTIF sur-le-champ.
        // Les dates de reference ne viennent PAS forcement de l'en-tete : un
        // camion couvre parfois deux bons, et la reception n'en designe alors
        // aucun. On les reprend des lignes, en retenant la promesse la plus
        // ancienne (MIN) : des qu'une seule ligne arrive apres sa date, la
        // livraison a manque quelque chose, et l'affirmer serait faux.
        "WITH promesse AS (
             SELECT l.id_reception,
                    MIN(substr(bc.date_bc, 1, 10))               AS date_bc,
                    MIN(substr(bc.date_livraison_prevue, 1, 10)) AS date_livraison_prevue
               FROM ligne_reception l
               JOIN ligne_bc lb    ON lb.id_ligne_bc = l.id_ligne_bc
               JOIN bon_commande bc ON bc.id_bc = lb.id_bc
              GROUP BY l.id_reception
         )
         SELECT rc.*, f.nom AS fournisseur_nom,
                -- Le bon de l'en-tete quand il y en a un, sinon ceux que les
                -- lignes couvrent : « hors commande » serait un mensonge pour un
                -- camion qui porte deux bons.
                COALESCE(bc.numero_bc,
                         (SELECT string_agg(DISTINCT b2.numero_bc, ', ')
                            FROM ligne_reception l2
                            JOIN ligne_bc lb2     ON lb2.id_ligne_bc = l2.id_ligne_bc
                            JOIN bon_commande b2  ON b2.id_bc = lb2.id_bc
                           WHERE l2.id_reception = rc.id_reception)) AS numero_bc,
                COALESCE(bc.date_bc, p.date_bc)                             AS date_bc,
                COALESCE(bc.date_livraison_prevue, p.date_livraison_prevue) AS date_livraison_prevue,
                up.login AS receptionnaire, uc.login AS controleur,
                (SELECT COUNT(*) FROM ligne_reception l WHERE l.id_reception = rc.id_reception) AS nb_lignes,

                CAST(((rc.date_reception)::date - (COALESCE(substr(bc.date_bc, 1, 10), p.date_bc))::date) AS bigint)
                    AS delai_reel_jours,
                CAST(((COALESCE(substr(bc.date_livraison_prevue, 1, 10), p.date_livraison_prevue))::date - (COALESCE(substr(bc.date_bc, 1, 10), p.date_bc))::date) AS bigint)
                    AS delai_prevu_jours,
                CAST(((rc.date_reception)::date - (COALESCE(substr(bc.date_livraison_prevue, 1, 10), p.date_livraison_prevue))::date)
                     AS bigint)
                    AS retard_jours,

                CASE WHEN COALESCE(bc.date_bc, p.date_bc) IS NULL
                       OR COALESCE(bc.date_livraison_prevue, p.date_livraison_prevue) IS NULL
                     THEN NULL
                     WHEN substr(rc.date_reception, 1, 10)
                          <= COALESCE(substr(bc.date_livraison_prevue, 1, 10), p.date_livraison_prevue)
                     THEN 1
                     ELSE 0 END AS on_time,

                CASE WHEN (SELECT COALESCE(SUM(l.quantite_commandee_kg), 0) FROM ligne_reception l
                            WHERE l.id_reception = rc.id_reception) <= 0 THEN NULL
                     WHEN (SELECT SUM(l.quantite_stock_kg) FROM ligne_reception l
                            WHERE l.id_reception = rc.id_reception)
                          >= (SELECT SUM(l.quantite_commandee_kg) FROM ligne_reception l
                               WHERE l.id_reception = rc.id_reception)
                             * (1 - COALESCE((SELECT CAST(valeur_courante AS numeric) / 100.0
                                                FROM parametre
                                               WHERE code_parametre = 'P_TolerInFull'), 0.02))
                     THEN 1 ELSE 0 END AS in_full,

                CASE WHEN (SELECT COUNT(*) FROM ligne_reception l
                            WHERE l.id_reception = rc.id_reception) = 0 THEN NULL
                     WHEN (SELECT COUNT(*) FROM ligne_reception l
                            WHERE l.id_reception = rc.id_reception
                              AND l.statut_qualite <> 'CONFORME') = 0
                     THEN 1 ELSE 0 END AS in_spec
           FROM reception rc
           JOIN fournisseur f   ON f.code_fournisseur = rc.code_fournisseur
           LEFT JOIN bon_commande bc ON bc.id_bc = rc.id_bc
           LEFT JOIN promesse p      ON p.id_reception = rc.id_reception
           LEFT JOIN utilisateur up  ON up.id_utilisateur = rc.id_utilisateur_reception
           LEFT JOIN utilisateur uc  ON uc.id_utilisateur = rc.id_utilisateur_controle
          WHERE ($1 IS NULL OR rc.statut = $1)
          ORDER BY rc.date_reception DESC LIMIT 200",
    )
    .bind(f.get("statut"))
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::RECEPTIONS, &mut valeur).await?;
    Ok(Json(valeur))
}

#[derive(Debug, Deserialize)]
pub struct NouvelleReception {
    pub id_bc: Option<String>,
    pub code_fournisseur: Option<String>,
    pub num_bon_livraison: Option<String>,
    pub numero_facture: Option<String>,
    pub transporteur: Option<String>,
    pub nombre_colis: Option<i64>,
    pub poids_total_brut_kg: Option<f64>,
    /// Pesees saisies avec l'entete. Tout part dans UNE transaction : une
    /// reception ouverte sans ligne, avec un numero deja attribue, serait un
    /// document fantome au milieu de la numerotation.
    pub lignes: Option<Vec<LigneReception>>,
}

#[derive(Debug, Deserialize)]
pub struct ModifReception {
    pub num_bon_livraison: Option<String>,
    pub numero_facture: Option<String>,
    pub transporteur: Option<String>,
    pub nombre_colis: Option<i64>,
    pub poids_total_brut_kg: Option<f64>,
}

/// Modifie l'entete d'une reception tant qu'elle n'est pas validee.
///
/// Une pesee se prepare : le bon de livraison arrive avec le camion, le nombre
/// de colis se compte, le poids brut se releve au pont-bascule. Rien de tout
/// cela n'est connu a la seconde ou l'on ouvre le document.
pub async fn modifier_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(m): Json<ModifReception>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: String =
        sqlx::query_scalar("SELECT statut FROM reception WHERE id_reception = $1")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("reception {id}")))?;
    if statut != "BROUILLON" && statut != "A_CONTROLER" {
        return Err(AppError::RegleMetier(format!(
            "Une reception {statut} ne peut plus etre modifiee."
        )));
    }

    sqlx::query(
        "UPDATE reception
            SET num_bon_livraison   = COALESCE($2, num_bon_livraison),
                numero_facture      = COALESCE($6, numero_facture),
                transporteur        = COALESCE($3, transporteur),
                nombre_colis        = COALESCE($4, nombre_colis),
                poids_total_brut_kg = COALESCE($5, poids_total_brut_kg)
          WHERE id_reception = $1",
    )
    .bind(&id)
    .bind(&m.num_bon_livraison)
    .bind(&m.transporteur)
    .bind(m.nombre_colis)
    .bind(m.poids_total_brut_kg)
    .bind(&m.numero_facture)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "id_reception": id, "modifie": true })))
}

/// Ce qu'on ATTEND sur cette reception : les lignes du bon encore a livrer.
///
/// Sans cela, le magasinier choisit une reference dans le catalogue et saisit un
/// poids — sans savoir ce qui etait commande, ni combien il en reste a recevoir.
/// C'est ainsi qu'on receptionne la mauvaise couleur, ou deux fois la meme
/// palette.
///
/// La ligne du bon porte le prix engage : le reprendre evite de le ressaisir, et
/// surtout d'en saisir un autre par distraction.
pub async fn lignes_attendues(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(q): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;

    let id_reception = q.get("id_reception").cloned().unwrap_or_default();

    // Trois facons d'interroger, de la plus precise a la plus large :
    //   - un bon designe ;
    //   - une reception ouverte, dont on prend le bon ;
    //   - un FOURNISSEUR, et l'on balaie tous ses bons encore en cours.
    //
    // Le dernier cas est celui de la creation : un camion arrive avec ce qui
    // etait pret, et cela couvre parfois deux bons. Obliger a en choisir un
    // forcerait a saisir deux receptions pour un seul camion.
    let id_bc = q.get("id_bc").filter(|b| !b.is_empty()).cloned();
    let fournisseur = q.get("code_fournisseur").filter(|f| !f.is_empty()).cloned();
    let id_bc = match (&id_bc, &fournisseur) {
        (Some(b), _) => Some(b.clone()),
        (None, Some(_)) => None,
        (None, None) => sqlx::query_scalar("SELECT id_bc FROM reception WHERE id_reception = $1")
            .bind(&id_reception)
            .fetch_optional(&state.db)
            .await?
            .flatten(),
    };

    if id_bc.is_none() && fournisseur.is_none() {
        // Reception sans bon de commande : rien n'est « attendu », le magasinier
        // saisit librement. On le dit par une liste vide plutot que par une
        // erreur — le cas est legitime (retour, don, regularisation).
        return Ok(Json(json!([])));
    }

    let rows = sqlx::query(
        "SELECT lb.id_ligne_bc, lb.code_reference, lb.designation, lb.unite_commande,
                lb.quantite_commandee_kg, lb.quantite_recue_kg, lb.quantite_restante_kg,
                lb.prix_unitaire_devise, lb.prix_kg_devise, lb.code_devise,
                bc.id_bc, bc.numero_bc, bc.date_bc, bc.date_livraison_prevue, bc.statut AS statut_bc,
                r.unite_catalogue, r.suivi_lot, r.densite_kg_ml, r.poids_bobine_kg,
                r.bobines_par_palette, r.bobines_par_lot,
                -- Deja saisie sur CETTE reception : montrer plutot que masquer,
                -- sinon on la cherche sans comprendre pourquoi elle manque.
                (SELECT COALESCE(SUM(lr.quantite_stock_kg), 0) FROM ligne_reception lr
                  WHERE lr.id_reception = $2 AND lr.id_ligne_bc = lb.id_ligne_bc)
                    AS deja_pesee_kg,
                -- Retard sur la date promise : c'est ce qui trie l'urgence au quai.
                CAST((current_date - (bc.date_livraison_prevue)::date) AS bigint)
                    AS retard_jours,
                -- Ce que le fournisseur peut legitimement livrer a la place.
                -- Ramene ici plutot que par un appel separe : au quai on ouvre le
                -- camion, on ne navigue pas dans un referentiel.
                (SELECT string_agg(e.equivalent_reference, ', ') FROM v_equivalence e
                  WHERE e.code_reference = lb.code_reference
                    AND e.interchangeable = 1)                 AS equivalents_recevables
           FROM ligne_bc lb
           JOIN bon_commande bc ON bc.id_bc = lb.id_bc
           JOIN reference r ON r.code_reference = lb.code_reference
          -- LE QUAI N'ATTEND QUE DE LA MARCHANDISE. La jointure interne ci-dessus
          -- suffirait aujourd'hui, mais c'est une protection accidentelle : le
          -- jour ou elle passera en jointure externe — comme celle de la fiche du
          -- bon vient de le faire — « FRET MARITIME » apparaitrait dans l'ecran
          -- de pesee, avec un prix au kilo absurde.
          WHERE lb.type_ligne = 'MARCHANDISE'
            AND lb.statut <> 'ANNULE'
            AND ($1 IS NULL OR lb.id_bc = $1)
            AND ($3 IS NULL OR (bc.code_fournisseur = $3
                                AND bc.statut IN ('ENVOYE','LIVRE_PARTIEL')))
          ORDER BY bc.date_livraison_prevue, bc.numero_bc, lb.ligne_numero",
    )
    .bind(&id_bc)
    .bind(&id_reception)
    .bind(&fournisseur)
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::RECEPTIONS, &mut valeur).await?;
    Ok(Json(valeur))
}

pub async fn creer_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(r): Json<NouvelleReception>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // Le fournisseur vient du BC quand il y en a un : le saisir deux fois,
    // c'est risquer qu'ils divergent.
    let fournisseur = match (&r.id_bc, &r.code_fournisseur) {
        (Some(bc), _) => sqlx::query_scalar("SELECT code_fournisseur FROM bon_commande WHERE id_bc = $1")
            .bind(bc)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("bon de commande {bc}")))?,
        (None, Some(f)) => f.clone(),
        (None, None) => {
            return Err(AppError::Invalide(
                "id_bc ou code_fournisseur est obligatoire".into(),
            ))
        }
    };

    let numero = numeroter(&mut tx, "reception", "numero_reception", "REC").await?;
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO reception
             (id_reception, numero_reception, id_bc, code_fournisseur,
              transporteur, num_bon_livraison, numero_facture, nombre_colis,
              poids_total_brut_kg, id_utilisateur_reception)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(&id)
    .bind(&numero)
    .bind(&r.id_bc)
    .bind(&fournisseur)
    .bind(&r.transporteur)
    .bind(&r.num_bon_livraison)
    .bind(&r.numero_facture)
    .bind(r.nombre_colis)
    .bind(r.poids_total_brut_kg)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    // --- Arrivage sans commande : on cree le bon qui manque -----------------
    //
    // Un camion se presente avec une matiere que personne n'a commandee : un
    // reliquat, un remplacement, un envoi anticipe. Refuser la marchandise
    // n'est pas une option — elle est au quai. La faire entrer sans engagement
    // non plus : le stock serait valorise sans qu'aucun prix ait ete negocie.
    //
    // La sortie est de creer le bon manquant, en BROUILLON. La marchandise se
    // pese tout de suite, mais la reception ne se VALIDERA qu'une fois ce bon
    // regularise (validation puis envoi). C'est ce qui rend la chose visible a
    // l'acheteur au lieu de la noyer dans le stock.
    let mut lignes_creees: std::collections::HashMap<usize, String> =
        std::collections::HashMap::new();
    let mut bc_regularisation: Option<(String, String)> = None;

    let hors_commande: Vec<(usize, &LigneReception)> = r
        .lignes
        .iter()
        .flatten()
        .enumerate()
        .filter(|(_, l)| l.id_ligne_bc.is_none())
        .collect();

    if !hors_commande.is_empty() {
        let (devise_frs, conditions): (String, Option<String>) = sqlx::query_as(
            "SELECT COALESCE(code_devise, 'MAD'), conditions_paiement
               FROM fournisseur WHERE code_fournisseur = $1",
        )
        .bind(&fournisseur)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("fournisseur {fournisseur}")))?;

        let taux_frs: f64 = sqlx::query_scalar(
            "SELECT taux::float8 FROM taux_change
              WHERE code_devise = $1 AND to_char(current_date, 'YYYY-MM-DD') >= substr(date_debut, 1, 10)
                AND (date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(date_fin, 1, 10))
              ORDER BY date_debut DESC LIMIT 1",
        )
        .bind(&devise_frs)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| {
            AppError::RegleMetier(format!("Aucun taux de change en vigueur pour {devise_frs}."))
        })?;

        let numero_bc = numeroter(&mut tx, "bon_commande", "numero_bc", "BC").await?;
        let id_bc_regul = uuid::Uuid::new_v4().to_string();

        // La livraison est deja faite : la date prevue est aujourd'hui, sinon le
        // bon naitrait en retard et fausserait l'OTIF de tout le fournisseur.
        sqlx::query(
            "INSERT INTO bon_commande
                 (id_bc, numero_bc, code_fournisseur, code_devise, taux_change_engage,
                  date_taux_engage, date_livraison_prevue, conditions_paiement,
                  motif_creation, notes, montant_total_devise, montant_total_mad,
                  id_utilisateur_creation)
             VALUES ($1,$2,$3,$4,$5,$6, to_char(current_date, 'YYYY-MM-DD'), $7, 'MANUEL', $8, 0, 0, $9)",
        )
        .bind(&id_bc_regul)
        .bind(&numero_bc)
        .bind(&fournisseur)
        .bind(&devise_frs)
        .bind(taux_frs)
        .bind(maintenant())
        .bind(&conditions)
        .bind(format!(
            "Regularisation de la reception {numero} : marchandise arrivee sans commande."
        ))
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;

        for (rang, (i, l)) in hors_commande.iter().enumerate() {
            let (kg, facteur) = vers_kg(
                &state.db,
                &l.code_reference,
                l.quantite_pesee_unite,
                &l.unite_saisie,
            )
            .await?;

            // Prix au kg : celui saisi, sinon le catalogue. Jamais zero — la
            // table refuse un prix nul, et un stock a valeur nulle fausserait le
            // CMUP de la reference pour longtemps (RG-08).
            let prix_kg: f64 = match l.prix_kg_devise {
                Some(p) if p > 0.0 => p,
                _ => sqlx::query_scalar(
                    "SELECT prix_catalogue_kg::float8 FROM reference WHERE code_reference = $1",
                )
                .bind(&l.code_reference)
                .fetch_optional(&mut *tx)
                .await?
                .filter(|p: &f64| *p > 0.0)
                .ok_or_else(|| {
                    AppError::RegleMetier(format!(
                        "{} arrive sans commande et sans prix : renseignez un prix, \
                         le catalogue n'en propose aucun.",
                        l.code_reference
                    ))
                })?,
            };

            let id_ligne_bc = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO ligne_bc
                     (id_ligne_bc, id_bc, ligne_numero, code_reference, designation,
                      unite_commande, facteur_kg, quantite_commandee_unite,
                      quantite_commandee_kg, prix_unitaire_devise, code_devise,
                      date_livraison_prevue, notes)
                 SELECT $1, $2, $3, $4, r.designation, $5, $6, $7, $8, $9, $10,
                        to_char(current_date, 'YYYY-MM-DD'), 'Cree par la reception ' || $11
                   FROM reference r WHERE r.code_reference = $4",
            )
            .bind(&id_ligne_bc)
            .bind(&id_bc_regul)
            .bind((rang + 1) as i64)
            .bind(&l.code_reference)
            .bind(&l.unite_saisie)
            .bind(facteur)
            .bind(l.quantite_pesee_unite)
            .bind(kg)
            .bind(prix_kg * facteur)
            .bind(&devise_frs)
            .bind(&numero)
            .execute(&mut *tx)
            .await?;

            lignes_creees.insert(*i, id_ligne_bc);
        }

        recalculer_bc(&mut tx, &id_bc_regul).await?;
        bc_regularisation = Some((id_bc_regul, numero_bc));
    }

    // --- Pesees saisies avec l'entete ---------------------------------------
    let mut posees = 0i64;
    for (i, l) in r.lignes.iter().flatten().enumerate() {
        // Une ligne hors commande porte desormais la ligne du bon qu'on vient
        // de creer : tout ce qui suit la traite comme n'importe quelle autre.
        let id_ligne_bc: Option<String> =
            l.id_ligne_bc.clone().or_else(|| lignes_creees.get(&i).cloned());
        if l.quantite_pesee_unite <= 0.0 {
            return Err(AppError::Invalide(format!(
                "{} : la quantite pesee doit etre strictement positive",
                l.code_reference
            )));
        }
        let (kg, facteur) = vers_kg(
            &state.db,
            &l.code_reference,
            l.quantite_pesee_unite,
            &l.unite_saisie,
        )
        .await?;

        // Prix et taux viennent de la ligne du bon, jamais du catalogue : c'est
        // le prix ENGAGE qui sera paye, et le relire ailleurs ouvrirait un ecart
        // entre ce qu'on a commande et ce qu'on valorise.
        // Le taux est NUMERIC en base : sans `::float8`, le decodage echouait et
        // toute reception rattachee a un bon tombait en erreur. Le prix engage
        // est une colonne calculee qui peut etre nulle : `Option`.
        let engage: Option<(Option<f64>, String, f64)> = match &id_ligne_bc {
            Some(idl) => sqlx::query_as(
                "SELECT lb.prix_kg_devise::float8, lb.code_devise,
                        COALESCE((SELECT t.taux FROM taux_change t
                                   WHERE t.code_devise = lb.code_devise
                                     AND to_char(current_date, 'YYYY-MM-DD') >= substr(t.date_debut, 1, 10)
                                     AND (t.date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(t.date_fin, 1, 10))
                                   ORDER BY t.date_debut DESC LIMIT 1), 1.0)::float8
                   FROM ligne_bc lb WHERE lb.id_ligne_bc = $1",
            )
            .bind(idl)
            .fetch_optional(&mut *tx)
            .await?,
            None => None,
        };
        let (prix_devise, devise_ligne, taux) = match engage {
            Some((p, d, t)) => (p, d, t),
            None => (l.prix_kg_devise, "MAD".to_string(), 1.0),
        };
        let prix_mad = prix_devise.map(|p| arrondi_mad(p * taux));

        let qte_commandee: Option<f64> = match &id_ligne_bc {
            Some(idl) => sqlx::query_scalar(
                "SELECT quantite_restante_kg::float8 FROM ligne_bc WHERE id_ligne_bc = $1",
            )
            .bind(idl)
            .fetch_optional(&mut *tx)
            .await?,
            None => None,
        };

        sqlx::query(
            "INSERT INTO ligne_reception
                 (id_ligne_reception, id_reception, id_ligne_bc, ligne_numero, code_reference,
                  designation, unite_saisie, facteur_kg, quantite_pesee_unite, quantite_stock_kg,
                  quantite_commandee_kg, quantite_bl_kg, nb_colis_ligne, prix_kg_devise,
                  code_devise, taux_change, prix_kg_mad, lot_fournisseur, date_fabrication,
                  date_peremption, statut_qualite, code_magasin_dest, notes,
                  substitution_acceptee, motif_substitution)
             SELECT $1, $2, $3, $4, $5, r.designation, $6, $7, $8, $9, $10, $11, $12, $13,
                    $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
               FROM reference r WHERE r.code_reference = $5",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&id)
        .bind(&id_ligne_bc)
        .bind((i + 1) as i64)
        .bind(&l.code_reference)
        .bind(&l.unite_saisie)
        .bind(facteur)
        .bind(l.quantite_pesee_unite)
        .bind(kg)
        .bind(qte_commandee)
        .bind(l.quantite_bl_kg)
        .bind(l.nb_colis_ligne)
        .bind(prix_devise)
        .bind(&devise_ligne)
        .bind(taux)
        .bind(prix_mad)
        .bind(&l.lot_fournisseur)
        .bind(&l.date_fabrication)
        .bind(&l.date_peremption)
        .bind(l.statut_qualite.clone().unwrap_or_else(|| "CONFORME".into()))
        .bind(&l.code_magasin_dest)
        .bind(&l.notes)
        .bind(i64::from(l.substitution_acceptee.unwrap_or(false)))
        .bind(&l.motif_substitution)
        .execute(&mut *tx)
        .await?;
        posees += 1;
    }

    tx.commit().await?;
    Ok(Json(json!({
        "id_reception": id, "numero_reception": numero,
        "code_fournisseur": fournisseur, "lignes": posees,
        "bc_regularisation": bc_regularisation.as_ref().map(|(i, _)| i),
        "numero_bc_regularisation": bc_regularisation.as_ref().map(|(_, n)| n)
    })))
}

pub async fn lignes_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;
    let rows = sqlx::query(
        // Trois ecarts distincts, et les confondre serait une faute d'analyse :
        //   ecart_bl_kg   : ce que le fournisseur ANNONCE contre ce qu'on PESE
        //                   — un litige de transport ou de declaration ;
        //   ecart_cmd_kg  : ce qu'on a COMMANDE contre ce qu'on PESE
        //                   — une livraison incomplete ou excedentaire ;
        //   poids par colis : detecte un conditionnement inattendu.
        "SELECT l.*, r.designation AS reference_designation, r.unite_catalogue, r.suivi_lot,
                lb.code_reference AS reference_commandee,
                CASE WHEN l.id_ligne_bc IS NOT NULL
                      AND lb.code_reference <> l.code_reference
                     THEN 1 ELSE 0 END                                  AS est_substitution,
                ROUND(l.quantite_stock_kg - l.quantite_bl_kg, 4)        AS ecart_bl_kg,
                ROUND(l.quantite_stock_kg - l.quantite_commandee_kg, 4) AS ecart_cmd_kg,
                CASE WHEN l.nb_colis_ligne > 0
                     THEN ROUND(l.quantite_stock_kg / l.nb_colis_ligne, 3) END AS poids_moyen_colis_kg
           FROM ligne_reception l
           JOIN reference r ON r.code_reference = l.code_reference
           LEFT JOIN ligne_bc lb ON lb.id_ligne_bc = l.id_ligne_bc
          WHERE l.id_reception = $1 ORDER BY l.ligne_numero",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::RECEPTIONS, &mut valeur).await?;
    Ok(Json(valeur))
}

#[derive(Debug, Deserialize)]
pub struct LigneReception {
    pub code_reference: String,
    pub id_ligne_bc: Option<String>,
    pub unite_saisie: String,
    pub quantite_pesee_unite: f64,
    /// Quantite annoncee sur le bon de livraison, en kg. L'ecart avec la pesee
    /// est un litige de transport, distinct de l'ecart au commande.
    pub quantite_bl_kg: Option<f64>,
    pub nb_colis_ligne: Option<i64>,
    pub notes: Option<String>,
    pub prix_kg_devise: Option<f64>,
    pub code_magasin_dest: String,
    pub lot_fournisseur: Option<String>,
    pub date_fabrication: Option<String>,
    pub date_peremption: Option<String>,
    pub statut_qualite: Option<String>,
    pub derogation_ecart: Option<bool>,
    pub motif_derogation: Option<String>,
    /// Confirmation explicite d'une reference differente de celle commandee.
    pub substitution_acceptee: Option<bool>,
    pub motif_substitution: Option<String>,
}

pub async fn ajouter_ligne_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(l): Json<LigneReception>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;
    if l.quantite_pesee_unite <= 0.0 {
        return Err(AppError::Invalide("la quantite pesee doit etre positive".into()));
    }

    let (kg, facteur) = vers_kg(
        &state.db,
        &l.code_reference,
        l.quantite_pesee_unite,
        &l.unite_saisie,
    )
    .await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let (statut, devise_bc, id_bc): (String, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT rc.statut,
                (SELECT bc.code_devise FROM bon_commande bc WHERE bc.id_bc = rc.id_bc),
                rc.id_bc
           FROM reception rc WHERE rc.id_reception = $1",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("reception {id}")))?;

    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(format!(
            "Seule une reception en brouillon peut recevoir des lignes (statut : {statut})."
        )));
    }

    // Prix et devise : repris de la ligne de BC quand elle existe, sinon du
    // catalogue. Une reception hors commande reste possible, mais son prix doit
    // etre explicite.
    let (prix_devise, devise, qte_commandee): (f64, String, Option<f64>) =
        match (&l.id_ligne_bc, l.prix_kg_devise) {
            (Some(ligne_bc), _) => {
                // Le RESTE a livrer, pas le total commande : un bon livre en
                // deux camions verrait sinon chaque reception jugee incomplete,
                // et l'OTIF de chacune tomberait a zero sans faute reelle.
                let r: (f64, String, f64) = sqlx::query_as(
                    "SELECT prix_kg_devise::float8, code_devise, quantite_restante_kg::float8
                       FROM ligne_bc WHERE id_ligne_bc = $1",
                )
                .bind(ligne_bc)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| AppError::Introuvable(format!("ligne de BC {ligne_bc}")))?;
                (l.prix_kg_devise.unwrap_or(r.0), r.1, Some(r.2))
            }
            (None, Some(p)) => (
                p,
                devise_bc.unwrap_or_else(|| "MAD".into()),
                None,
            ),
            (None, None) => {
                let r: (f64, String) = sqlx::query_as(
                    "SELECT prix_catalogue_kg::float8, code_devise_catalogue
                       FROM reference WHERE code_reference = $1",
                )
                .bind(&l.code_reference)
                .fetch_one(&mut *tx)
                .await?;
                (r.0, r.1, None)
            }
        };

    // RG-09 : taux du jour de la reception, distinct du taux engage du BC.
    let taux: f64 = sqlx::query_scalar(
        "SELECT taux::float8 FROM taux_change
          WHERE code_devise = $1 AND to_char(current_date, 'YYYY-MM-DD') >= substr(date_debut, 1, 10)
            AND (date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(date_fin, 1, 10))
          ORDER BY date_debut DESC LIMIT 1",
    )
    .bind(&devise)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::RegleMetier(format!("Aucun taux en vigueur pour {devise}.")))?;

    let numero: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(ligne_numero), 0) + 1 FROM ligne_reception WHERE id_reception = $1",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;

    let id_ligne = uuid::Uuid::new_v4().to_string();
    // Le trigger refuse un ecart de pesee hors tolerance sans derogation, et une
    // ligne non conforme dirigee hors zone de quarantaine.
    sqlx::query(
        "INSERT INTO ligne_reception
             (id_ligne_reception, id_reception, id_ligne_bc, ligne_numero, code_reference,
              designation, unite_saisie, facteur_kg, quantite_pesee_unite, quantite_stock_kg,
              quantite_commandee_kg, prix_kg_devise, code_devise, taux_change, prix_kg_mad,
              lot_fournisseur, date_fabrication, date_peremption, statut_qualite,
              code_magasin_dest, derogation_ecart, id_utilisateur_derogation, motif_derogation,
              quantite_bl_kg, nb_colis_ligne, notes,
              substitution_acceptee, motif_substitution)
         SELECT $1, $2, $3, $4, $5, r.designation, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
           FROM reference r WHERE r.code_reference = $5",
    )
    .bind(&id_ligne)
    .bind(&id)
    .bind(&l.id_ligne_bc)
    .bind(numero)
    .bind(&l.code_reference)
    .bind(&l.unite_saisie)
    .bind(facteur)
    .bind(l.quantite_pesee_unite)
    .bind(kg)
    .bind(qte_commandee)
    .bind(prix_devise)
    .bind(&devise)
    .bind(taux)
    .bind(arrondi_mad(prix_devise * taux))
    .bind(&l.lot_fournisseur)
    .bind(&l.date_fabrication)
    .bind(&l.date_peremption)
    .bind(l.statut_qualite.clone().unwrap_or_else(|| "CONFORME".into()))
    .bind(&l.code_magasin_dest)
    .bind(i64::from(l.derogation_ecart.unwrap_or(false)))
    .bind(if l.derogation_ecart.unwrap_or(false) { Some(&user.id) } else { None })
    .bind(&l.motif_derogation)
    .bind(l.quantite_bl_kg)
    .bind(l.nb_colis_ligne)
    .bind(&l.notes)
    .bind(i64::from(l.substitution_acceptee.unwrap_or(false)))
    .bind(&l.motif_substitution)
    .execute(&mut *tx)
    .await?;

    let _ = id_bc;
    tx.commit().await?;

    Ok(Json(json!({
        "id_ligne_reception": id_ligne, "ligne_numero": numero,
        "quantite_stock_kg": kg, "prix_kg_mad": arrondi_mad(prix_devise * taux),
        "taux_change": taux
    })))
}

#[derive(Debug, Deserialize)]
pub struct StatutReception {
    pub statut: String,
}

/// Fait avancer la reception dans son workflow.
///
/// BROUILLON -> A_CONTROLER est l'acte du magasinier : « j'ai fini de peser,
/// au controle qualite de decider ». Le passage a VALIDE n'est PAS traite ici :
/// il declenche la cascade 3-en-1 et passe par /valider, qui verifie la
/// segregation des taches.
pub async fn changer_statut_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(s): Json<StatutReception>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;

    if s.statut == "VALIDE" {
        return Err(AppError::RegleMetier(
            "La validation passe par /valider : elle declenche la cascade de stock.".into(),
        ));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    if s.statut == "A_CONTROLER" {
        let lignes: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM ligne_reception WHERE id_reception = $1")
                .bind(&id)
                .fetch_one(&mut *tx)
                .await?;
        if lignes == 0 {
            return Err(AppError::RegleMetier(
                "Aucune ligne pesee : rien a soumettre au controle qualite.".into(),
            ));
        }
    }

    // Le trigger de transition refuse tout enchainement non prevu.
    let res = sqlx::query("UPDATE reception SET statut = $2 WHERE id_reception = $1")
        .bind(&id)
        .bind(&s.statut)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Introuvable(format!("reception {id}")));
    }
    tx.commit().await?;

    Ok(Json(json!({ "id_reception": id, "statut": s.statut })))
}

pub async fn supprimer_ligne_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((id, ligne)): Path<(String, String)>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: String = sqlx::query_scalar("SELECT statut FROM reception WHERE id_reception = $1")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("reception {id}")))?;
    if statut == "VALIDE" || statut == "CLOTURE" {
        return Err(AppError::RegleMetier(
            "Une reception validee est figee : ses lignes ont deja alimente le stock.".into(),
        ));
    }

    let res = sqlx::query("DELETE FROM ligne_reception WHERE id_ligne_reception = $1")
        .bind(&ligne)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Introuvable(format!("ligne {ligne}")));
    }
    tx.commit().await?;

    Ok(Json(json!({ "supprime": true })))
}

/// Ce qu'une ligne de reception peut encore corriger.
///
/// TOUT EST FACULTATIF : l'ecran n'envoie que ce qu'il a touche. Un champ
/// absent reste tel quel, un champ vide aussi — la convention est celle de
/// `ModifLigneBc`, et deux conventions differentes pour un meme geste
/// finiraient par se contredire.
///
/// CE QUI N'EST PAS CORRIGEABLE : la reference. Elle commande le prix, la
/// devise, le taux du jour et le rattachement a la ligne de commande — quatre
/// valeurs deduites a la creation. Les rededuire ici reviendrait a recreer la
/// ligne en faisant croire qu'on la modifie. Une erreur de reference se corrige
/// en retirant la ligne et en la ressaisissant, ce que l'ecran sait faire.
#[derive(Debug, Deserialize)]
pub struct ModifLigneReception {
    pub unite_saisie: Option<String>,
    pub quantite_pesee_unite: Option<f64>,
    pub quantite_bl_kg: Option<f64>,
    pub nb_colis_ligne: Option<i64>,
    pub lot_fournisseur: Option<String>,
    pub date_fabrication: Option<String>,
    pub date_peremption: Option<String>,
    pub statut_qualite: Option<String>,
    pub code_magasin_dest: Option<String>,
    pub notes: Option<String>,
}

/// Corriger une pesee, sans supprimer ni recreer la ligne.
///
/// POURQUOI CETTE ROUTE N'EXISTAIT PAS, et pourquoi il fallait l'ecrire. Une
/// ligne de reception ne savait qu'etre creee ou supprimee. Corriger un poids
/// obligeait donc l'ecran a effacer la ligne puis a la reposter — trois
/// consequences, toutes mauvaises :
///
///   * le numero de ligne changeait a chaque correction, si bien que le bon
///     imprime ne portait plus le meme ordre d'un tirage a l'autre ;
///   * entre la suppression et la recreation, la reception existait sans sa
///     ligne : une validation concurrente aurait valide une reception amputee ;
///   * le journal d'audit enregistrait une suppression, ce qui se lit comme un
///     retrait de marchandise alors qu'on corrigeait une virgule.
///
/// LE POIDS SE RECALCULE ICI, jamais cote ecran : c'est `vers_kg` qui fait foi,
/// avec les facteurs de la fiche. L'ecran propose, le serveur pese.
pub async fn modifier_ligne_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((id, ligne)): Path<(String, String)>,
    Json(m): Json<ModifLigneReception>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;

    // L'etat AVANT correction, et celui de la reception qui la porte.
    let (statut, code_reference, unite_actuelle, qte_actuelle): (String, String, String, f64) =
        sqlx::query_as(
            "SELECT rc.statut, lr.code_reference, lr.unite_saisie,
                    lr.quantite_pesee_unite::float8
               FROM ligne_reception lr
               JOIN reception rc ON rc.id_reception = lr.id_reception
              WHERE lr.id_ligne_reception = $1 AND lr.id_reception = $2",
        )
        .bind(&ligne)
        .bind(&id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("ligne de reception {ligne}")))?;

    // MEME FRONTIERE QUE LA SUPPRESSION, et non celle de l'ajout. Une reception
    // « a controler » est precisement celle qu'on est en train de verifier :
    // lui interdire la correction obligerait a la supprimer pour la refaire.
    if statut == "VALIDE" || statut == "CLOTURE" {
        return Err(AppError::RegleMetier(
            "Une reception validee est figee : ses lignes ont deja alimente le stock.".into(),
        ));
    }

    let unite = m.unite_saisie.clone().unwrap_or(unite_actuelle);
    let quantite = m.quantite_pesee_unite.unwrap_or(qte_actuelle);
    if quantite <= 0.0 {
        return Err(AppError::Invalide("la quantite pesee doit etre positive".into()));
    }
    let (kg, facteur) = vers_kg(&state.db, &code_reference, quantite, &unite).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // Les declencheurs de la base veillent toujours : ecart de pesee hors
    // tolerance sans derogation, ligne non conforme dirigee hors quarantaine.
    // On ne les contourne pas, on leur donne les valeurs corrigees.
    sqlx::query(
        "UPDATE ligne_reception SET
             unite_saisie = $3,
             facteur_kg = $4,
             quantite_pesee_unite = $5,
             quantite_stock_kg = $6,
             quantite_bl_kg     = COALESCE($7, quantite_bl_kg),
             nb_colis_ligne     = COALESCE($8, nb_colis_ligne),
             lot_fournisseur    = COALESCE(NULLIF(TRIM($9), ''), lot_fournisseur),
             date_fabrication   = COALESCE(NULLIF(TRIM($10), ''), date_fabrication),
             date_peremption    = COALESCE(NULLIF(TRIM($11), ''), date_peremption),
             statut_qualite     = COALESCE(NULLIF(TRIM($12), ''), statut_qualite),
             code_magasin_dest  = COALESCE(NULLIF(TRIM($13), ''), code_magasin_dest),
             notes              = COALESCE(NULLIF(TRIM($14), ''), notes)
          WHERE id_ligne_reception = $1 AND id_reception = $2",
    )
    .bind(&ligne)
    .bind(&id)
    .bind(&unite)
    .bind(facteur)
    .bind(quantite)
    .bind(kg)
    .bind(m.quantite_bl_kg)
    .bind(m.nb_colis_ligne)
    .bind(&m.lot_fournisseur)
    .bind(&m.date_fabrication)
    .bind(&m.date_peremption)
    .bind(&m.statut_qualite)
    .bind(&m.code_magasin_dest)
    .bind(&m.notes)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(json!({
        "id_ligne_reception": ligne,
        "quantite_stock_kg": kg,
        "facteur_kg": facteur
    })))
}
