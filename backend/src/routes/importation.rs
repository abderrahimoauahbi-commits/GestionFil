//! Dossiers d'importation — l'API.
//!
//! Module de droits `IMPORT` pour le dossier, ses factures et ses frais ; la
//! reception physique passe par `RECEPTIONS`, comme toute reception : creer
//! demande ECRIRE, faire entrer en stock demande VALIDER. La cloture — qui
//! change le CUMP — demande `IMPORT` VALIDER.
//!
//! Chaque modification d'une ligne ou d'un frais recalcule la repartition dans
//! la meme transaction : elle n'est jamais saisie, elle se deduit.

use crate::auth::{rbac::Action, Utilisateur};
use crate::domain::importation as metier;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

use super::json::lignes_en_json;

const IMPORT: &str = "IMPORT";

/// Le dossier d'une facture, pour recalculer apres une modification.
async fn dossier_de_facture(tx: &mut sqlx::PgConnection, id_facture: &str) -> AppResult<String> {
    sqlx::query_scalar("SELECT id_dossier FROM import_factures WHERE id_facture = $1")
        .bind(id_facture)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("facture {id_facture}")))
}

async fn dossier_de_ligne(tx: &mut sqlx::PgConnection, id_ligne: &str) -> AppResult<String> {
    sqlx::query_scalar(
        "SELECT f.id_dossier FROM import_facture_lignes l
           JOIN import_factures f ON f.id_facture = l.id_facture
          WHERE l.id_ligne = $1",
    )
    .bind(id_ligne)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("ligne {id_ligne}")))
}

// ============================================================================
// Catalogue des frais
// ============================================================================

/// `GET /api/parametres-frais` — le catalogue tel que l'ecran de saisie en a
/// besoin. Son administration passe par le referentiel `/api/types-frais`
/// (module PARAMETRES) : ici, on lit, avec le module IMPORT.
pub async fn lister_parametres_frais(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT id_frais, libelle, categorie, piece_justificative, recuperable, commun,
                methode_repartition, inclus_dans_cout, ordre, actif
           FROM parametres_frais WHERE actif = 1 ORDER BY ordre, libelle",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&lignes)))
}

// ============================================================================
// Dossiers
// ============================================================================

/// `GET /api/import/dossiers` — la liste, avec ce qu'on veut lire d'un coup
/// d'oeil : fournisseurs, valeur, frais, avancement de la reception.
pub async fn lister_dossiers(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(q): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT d.id_dossier, d.numero, d.numero_bl, d.conteneurs, d.code_devise, d.taux_change,
                d.date_arrivee::text AS date_arrivee, d.statut, d.date_creation, d.date_cloture,
                -- Par quel circuit il recoit sa marchandise (ADR-003 phase A) :
                -- FACTURE pour les dossiers d'avant la bascule, BON depuis.
                d.circuit_reception,
                (SELECT count(*) FROM import_factures f WHERE f.id_dossier = d.id_dossier) AS nb_factures,
                (SELECT string_agg(DISTINCT fo.nom, ', ')
                   FROM import_factures f JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
                  WHERE f.id_dossier = d.id_dossier) AS fournisseurs,
                -- Les numeros d'engagement : c'est souvent par eux que la
                -- banque ou le transitaire designe le dossier.
                (SELECT string_agg(e.numero_ei, ', ' ORDER BY e.numero_ei)
                   FROM import_engagements e WHERE e.id_dossier = d.id_dossier) AS engagements,
                v.valeur_dhs, v.poids_kg, v.recu_kg, v.nb_palettes, v.nb_bobines,
                fr.frais_dhs, fr.tva_dhs,
                CASE WHEN v.valeur_dhs > 0 THEN round(fr.frais_dhs * 100 / v.valeur_dhs, 2) END AS coef_frais_pct
           FROM import_dossiers d
           LEFT JOIN LATERAL (
                SELECT COALESCE(sum(round(l.montant_devise * f.taux_change, 2)), 0) AS valeur_dhs,
                       COALESCE(sum(l.poids_net_kg) FILTER (WHERE l.type_ligne = 'ERP'), 0) AS poids_kg,
                       COALESCE(sum(l.quantite_recue_kg), 0) AS recu_kg,
                       COALESCE(sum(l.nb_palettes), 0) AS nb_palettes,
                       COALESCE(sum(l.nb_bobines), 0) AS nb_bobines
                  FROM import_facture_lignes l JOIN import_factures f ON f.id_facture = l.id_facture
                 WHERE f.id_dossier = d.id_dossier) v ON true
           LEFT JOIN LATERAL (
                SELECT COALESCE(sum(x.montant_dhs) FILTER (WHERE p.inclus_dans_cout = 1), 0) AS frais_dhs,
                       COALESCE(sum(x.montant_dhs) FILTER (WHERE p.inclus_dans_cout = 0), 0) AS tva_dhs
                  FROM dossier_lignes_frais x JOIN parametres_frais p ON p.id_frais = x.id_frais
                 WHERE x.id_dossier = d.id_dossier) fr ON true
          WHERE ($1::text IS NULL OR d.statut = $1)
          ORDER BY d.date_creation DESC",
    )
    .bind(q.get("statut"))
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, IMPORT, &mut v).await?;
    Ok(Json(v))
}

#[derive(Deserialize)]
pub struct DossierSaisie {
    numero: Option<String>,
    numero_bl: Option<String>,
    conteneurs: Option<String>,
    code_devise: Option<String>,
    taux_change: Option<f64>,
    date_arrivee: Option<String>,
    notes: Option<String>,
    /// La DUM du dossier — une seule (groupage, regime 010 par defaut).
    numero_dum: Option<String>,
    regime_douanier: Option<String>,
    date_dum: Option<String>,
    /// Pourquoi une DUM deja saisie change (regle 5) : obligatoire alors.
    #[serde(default)]
    motif_dum: Option<String>,
}

/// Le refus commun : un dossier clos est fige (regle 5, 09/10/2026).
const DOSSIER_CLOS: &str = "Le dossier est cloture : il est fige. Une facture tardive (transitaire, \
     port) s'ajoute en « frais post-cloture » ; il ne se rouvre pas.";

/// Le numero suivant, au format du classeur : « 06/26 ».
async fn prochain_numero(tx: &mut sqlx::PgConnection) -> AppResult<String> {
    let annee = crate::db::jour_casablanca().format("%y").to_string();
    let rang: i64 = sqlx::query_scalar(
        "SELECT COALESCE(max(split_part(numero, '/', 1)::bigint), 0) + 1
           FROM import_dossiers WHERE numero ~ ('^[0-9]+/' || $1 || '$')",
    )
    .bind(&annee)
    .fetch_one(&mut *tx)
    .await?;
    Ok(format!("{rang:02}/{annee}"))
}

/// `POST /api/import/dossiers`
pub async fn creer_dossier(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(d): Json<DossierSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    // LA DEVISE EST CELLE DE CHAQUE FACTURE (groupage, 01/10/2026). Le dossier
    // ne garde devise et taux que comme repli : MAD au taux 1 s'ils manquent.
    let code_devise = d.code_devise.unwrap_or_else(|| "MAD".into());
    let taux = d.taux_change.filter(|t| *t > 0.0).unwrap_or(1.0);

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let numero = match d.numero.filter(|s| !s.trim().is_empty()) {
        Some(n) => n.trim().to_string(),
        None => prochain_numero(&mut tx).await?,
    };
    let id: String = sqlx::query_scalar(
        "INSERT INTO import_dossiers (numero, numero_bl, conteneurs, code_devise, taux_change,
                                      date_arrivee, notes, id_utilisateur_creation,
                                      numero_dum, regime_douanier, date_dum)
         VALUES ($1, $2, $3, $4, $5, fn_jour_casablanca($6), $7, $8, $9, COALESCE($10, '010'), fn_jour_casablanca($11))
         RETURNING id_dossier",
    )
    .bind(&numero)
    .bind(&d.numero_bl)
    .bind(&d.conteneurs)
    .bind(&code_devise)
    .bind(taux)
    .bind(&d.date_arrivee)
    .bind(&d.notes)
    .bind(&user.id)
    .bind(&d.numero_dum)
    .bind(&d.regime_douanier)
    .bind(&d.date_dum)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_dossier": id, "numero": numero })))
}

/// `GET /api/import/dossiers/{id}` — tout le dossier : en-tete, factures,
/// lignes avec leur cout de revient, frais, repartition. Les receptions n'en
/// font pas partie : elles ont leur propre liste.
pub async fn lire_dossier(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Lire).await?;
    let db = &state.db;

    let entete = sqlx::query(
        "SELECT d.*, u.login AS cree_par, uc.login AS cloture_par
           FROM import_dossiers d
           LEFT JOIN utilisateur u  ON u.id_utilisateur  = d.id_utilisateur_creation
           LEFT JOIN utilisateur uc ON uc.id_utilisateur = d.id_utilisateur_cloture
          WHERE d.id_dossier = $1",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;
    if entete.is_empty() {
        return Err(AppError::Introuvable(format!("dossier {id}")));
    }

    let factures = sqlx::query(
        "SELECT f.*, fo.nom AS fournisseur_nom,
                (SELECT COALESCE(sum(l.montant_devise), 0) FROM import_facture_lignes l
                  WHERE l.id_facture = f.id_facture) AS montant_lignes_devise,
                (SELECT count(*) FROM import_facture_lignes l WHERE l.id_facture = f.id_facture) AS nb_lignes
           FROM import_factures f
           JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
          WHERE f.id_dossier = $1
          ORDER BY f.date_creation",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;

    let lignes = sqlx::query(
        "SELECT * FROM v_import_cout_revient WHERE id_dossier = $1
          ORDER BY numero_facture, ligne_numero",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;

    let frais = sqlx::query(
        "SELECT x.id_ligne_frais, x.id_frais, p.libelle AS frais_libelle, p.categorie,
                p.inclus_dans_cout, x.libelle, x.numero_piece, x.montant_devise, x.code_devise,
                x.cours_change, x.montant_dhs, x.date_creation,
                COALESCE(x.methode_repartition, p.methode_repartition) AS methode_repartition,
                p.methode_repartition AS methode_type,
                COALESCE((SELECT sum(r.montant_alloue_dhs) FROM lignes_frais_repartition r
                           WHERE r.id_ligne_frais = x.id_ligne_frais), 0) AS reparti_dhs,
                -- En jsonb : le convertisseur de lignes lit le json, pas les
                -- tableaux PostgreSQL, qui ressortiraient a null.
                COALESCE((SELECT jsonb_agg(c.id_ligne) FROM dossier_lignes_frais_cibles c
                           WHERE c.id_ligne_frais = x.id_ligne_frais), '[]'::jsonb) AS cibles
           FROM dossier_lignes_frais x
           JOIN parametres_frais p ON p.id_frais = x.id_frais
          WHERE x.id_dossier = $1
          ORDER BY p.ordre, x.date_creation",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;

    let repartition = sqlx::query(
        "SELECT r.id_ligne_frais, r.id_article_dossier, r.pourcentage, r.montant_alloue_dhs
           FROM lignes_frais_repartition r
           JOIN dossier_lignes_frais x ON x.id_ligne_frais = r.id_ligne_frais
          WHERE x.id_dossier = $1",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;

    let ajustements = sqlx::query(
        "SELECT code_reference, nature, code_magasin, quantite_recue_kg, stock_kg,
                cump_avant, cump_apres, montant_dhs, date_ajustement, origine, numero_piece, motif
           FROM import_ajustements_cump WHERE id_dossier = $1
          ORDER BY date_ajustement, code_reference, nature DESC, code_magasin",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;

    // Les retours fournisseur des receptions du dossier, et s'ils sont soldes par un avoir.
    let retours = sqlx::query(
        "SELECT id_mouvement, numero_mouvement, numero_reception, date_mouvement, code_reference,
                kg::float8 AS kg, solde
           FROM v_retours_import WHERE id_dossier = $1
          ORDER BY date_mouvement, numero_mouvement, code_reference",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;

    let engagements = sqlx::query(
        "SELECT e.*, fo.nom AS fournisseur_nom
           FROM import_engagements e
           LEFT JOIN fournisseur fo ON fo.code_fournisseur = e.code_fournisseur
          WHERE e.id_dossier = $1
          ORDER BY fo.nom NULLS LAST, e.date_ei NULLS LAST, e.numero_ei",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;

    // LES DROITS ATTENDUS (19/10/2026) : par ligne, valeur en douane x taux de
    // la position tarifaire de sa reference ; par dossier, face aux droits
    // payes. L'ecart se lit ; il ne bloque rien.
    let droits_lignes = sqlx::query(
        "SELECT id_ligne, code_reference, code_sh, libelle_position,
                taux_droit_pct::float8 AS taux_droit_pct,
                valeur_dhs::float8 AS valeur_dhs,
                frais_valeur_douane_dhs::float8 AS frais_valeur_douane_dhs,
                valeur_douane_dhs::float8 AS valeur_douane_dhs,
                droits_attendus_dhs::float8 AS droits_attendus_dhs
           FROM v_import_droits WHERE id_dossier = $1",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;
    let droits_dossier = sqlx::query(
        "SELECT nb_lignes, nb_lignes_sans_position,
                droits_attendus_dhs::float8 AS droits_attendus_dhs,
                droits_payes_dhs::float8 AS droits_payes_dhs
           FROM v_import_droits_dossier WHERE id_dossier = $1",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;

    let pieces = super::pieces::lister_du_dossier(db, &id).await?;
    let attendues = super::pieces::attendues(db, &id).await?;

    let mut v = json!({
        "dossier": lignes_en_json(&entete).get(0).cloned().unwrap_or(Value::Null),
        "pieces": pieces,
        "attendues": attendues,
        "factures": lignes_en_json(&factures),
        "lignes": lignes_en_json(&lignes),
        "frais": lignes_en_json(&frais),
        "repartition": lignes_en_json(&repartition),
        "ajustements": lignes_en_json(&ajustements),
        "retours": lignes_en_json(&retours),
        "engagements": lignes_en_json(&engagements),
        "droits": lignes_en_json(&droits_lignes),
        "droits_dossier": lignes_en_json(&droits_dossier).get(0).cloned().unwrap_or(Value::Null),
    });
    user.masquer(db, IMPORT, &mut v).await?;
    Ok(Json(v))
}

/// `PATCH /api/import/dossiers/{id}` — l'en-tete. Le statut ne se touche pas
/// ici : il avance par les receptions et la cloture.
pub async fn modifier_dossier(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(d): Json<DossierSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    // LA VIE DU DOSSIER (regle 5, 09/10/2026). Clos, il est fige (seules les
    // notes s'ecrivent). Une DUM saisie ne s'efface pas et ne se corrige qu'au
    // droit de valider, avec un motif : l'effacer rouvrait la contre-passation
    // apres dedouanement.
    let (statut, dum_actuelle): (String, Option<String>) =
        sqlx::query_as("SELECT statut, numero_dum FROM import_dossiers WHERE id_dossier = $1 FOR UPDATE")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("dossier {id}")))?;
    // Clos : seules les notes s'ecrivent ; une DUM changee est refusee, le reste
    // de l'en-tete garde sa valeur (le formulaire renvoie tout).
    let clos = statut == "CLOTURE";
    if clos
        && d.numero_dum
            .as_deref()
            .is_some_and(|n| n.trim() != dum_actuelle.as_deref().unwrap_or("").trim())
    {
        return Err(AppError::RegleMetier(DOSSIER_CLOS.into()));
    }
    let garde = |v: &Option<String>| if clos { None } else { v.clone() };
    let actuelle = dum_actuelle.as_deref().map(str::trim).unwrap_or("");
    if let Some(nouvelle) = d.numero_dum.as_deref().map(str::trim) {
        if !actuelle.is_empty() && nouvelle != actuelle {
            if nouvelle.is_empty() {
                return Err(AppError::RegleMetier(format!(
                    "La DUM {actuelle} ne s'efface pas : elle prouve le dedouanement. Une faute de frappe se \
                     corrige (droit de valider, avec un motif)."
                )));
            }
            user.exiger(&state.db, IMPORT, Action::Valider).await.map_err(|_| {
                AppError::RegleMetier("Corriger une DUM deja saisie demande le droit de valider l'import.".into())
            })?;
            if d.motif_dum.as_deref().map(str::trim).unwrap_or("").chars().count() < 5 {
                return Err(AppError::Invalide(
                    "Dites pourquoi la DUM change (faute de frappe, DUM rectificative…).".into(),
                ));
            }
        }
    }
    let n = sqlx::query(
        "UPDATE import_dossiers
            SET numero = COALESCE($2, numero), numero_bl = COALESCE($3, numero_bl),
                conteneurs = COALESCE($4, conteneurs), code_devise = COALESCE($5, code_devise),
                taux_change = COALESCE($6, taux_change), date_arrivee = COALESCE(fn_jour_casablanca($7), date_arrivee),
                notes = COALESCE($8, notes), numero_dum = COALESCE($9, numero_dum),
                regime_douanier = COALESCE($10, regime_douanier), date_dum = COALESCE(fn_jour_casablanca($11), date_dum)
          WHERE id_dossier = $1",
    )
    .bind(&id)
    .bind(garde(&d.numero))
    .bind(garde(&d.numero_bl))
    .bind(garde(&d.conteneurs))
    .bind(garde(&d.code_devise))
    .bind(if clos { None } else { d.taux_change })
    .bind(garde(&d.date_arrivee))
    .bind(&d.notes)
    .bind(garde(&d.numero_dum))
    .bind(garde(&d.regime_douanier))
    .bind(garde(&d.date_dum))
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(AppError::Introuvable(format!("dossier {id}")));
    }
    tx.commit().await?;
    Ok(Json(json!({ "id_dossier": id })))
}

/// `DELETE /api/import/dossiers/{id}` — un brouillon seulement (declencheur).
pub async fn supprimer_dossier(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    // Un dossier en brouillon n'a rien fait entrer en stock : ses lignes ne
    // peuvent etre que dans des receptions en brouillon. Elles en sortent, et
    // une reception qui n'avait qu'elles disparait avec.
    let touchees: Vec<String> = sqlx::query_scalar(
        "DELETE FROM import_reception_lignes rl
          USING import_facture_lignes l, import_factures f, import_receptions r
          WHERE rl.id_ligne = l.id_ligne AND l.id_facture = f.id_facture AND f.id_dossier = $1
            AND r.id_reception = rl.id_reception AND r.statut IN ('BROUILLON','A_CONTROLER')
      RETURNING rl.id_reception",
    )
    .bind(&id)
    .fetch_all(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM import_receptions r
          WHERE r.id_reception = ANY($1) AND r.statut IN ('BROUILLON','A_CONTROLER')
            AND NOT EXISTS (SELECT 1 FROM import_reception_lignes x WHERE x.id_reception = r.id_reception)",
    )
    .bind(&touchees)
    .execute(&mut *tx)
    .await?;
    let n = sqlx::query("DELETE FROM import_dossiers WHERE id_dossier = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::Introuvable(format!("dossier {id}")));
    }
    tx.commit().await?;
    Ok(Json(json!({ "supprime": id })))
}

// ============================================================================
// Factures
// ============================================================================

#[derive(Deserialize)]
pub struct FactureSaisie {
    code_fournisseur: Option<String>,
    numero_facture: Option<String>,
    date_facture: Option<String>,
    code_devise: Option<String>,
    taux_change: Option<f64>,
    montant_devise: Option<f64>,
    nb_palettes: Option<i64>,
    nb_bobines: Option<i64>,
    /// L'engagement sur lequel la facture s'impute. Chaine vide = le retirer.
    id_engagement: Option<String>,
    /// L'operateur confirme un taux qui s'ecarte de la reference : le taux reel
    /// de sa banque, par exemple.
    #[serde(default)]
    taux_confirme: Option<bool>,
}

// =============================================================================
// LE TAUX D'UNE FACTURE EN DEVISE (05/10/2026)
// =============================================================================
//
// Une facture de 12 000 EUR passee au taux 1 entre en stock pour 12 000 DH au
// lieu de 130 000 : le CUMP, la repartition des frais et le plan d'achat sont
// faux d'un facteur dix. Cela arrivait sans bruit — l'ecran gardait le taux 1
// pose pour une devise MAD quand on passait ensuite en EUR, et le serveur
// retombait sur le taux du dossier, 1 par defaut.

/// Au-dela de 3 % d'ecart avec la reference, ce n'est plus la difference entre
/// le cours de la banque et celui de Bank Al-Maghrib : c'est probablement une
/// erreur de saisie. L'operateur corrige, ou confirme.
const ECART_TAUX_MAX: f64 = 0.03;

pub(crate) struct TauxReference {
    pub(crate) valeur: f64,
    /// Ce que l'on montre : « cours Bank Al-Maghrib du 2026-09-22 ».
    pub(crate) source: String,
}

/// Le cours Bank Al-Maghrib du jour de la facture, a defaut le dernier publie
/// avant, a defaut le taux de l'ERP en vigueur. Rien pour une devise inconnue.
pub(crate) async fn taux_reference(
    c: &mut sqlx::PgConnection,
    devise: &str,
    date: &str,
) -> AppResult<Option<TauxReference>> {
    let bam: Option<(f64, String)> = sqlx::query_as(
        "SELECT cours_mad::float8, date_cours::text FROM cours_bam
          WHERE code_devise = $1 AND date_cours <= fn_jour_casablanca($2)
          ORDER BY date_cours DESC LIMIT 1",
    )
    .bind(devise)
    .bind(date)
    .fetch_optional(&mut *c)
    .await?;
    if let Some((valeur, jour)) = bam {
        return Ok(Some(TauxReference { valeur, source: format!("cours Bank Al-Maghrib du {jour}") }));
    }
    let erp: Option<f64> = sqlx::query_scalar(
        "SELECT taux::float8 FROM taux_change
          WHERE code_devise = $1 AND substr(date_debut, 1, 10) <= substr($2, 1, 10)
          ORDER BY date_debut DESC LIMIT 1",
    )
    .bind(devise)
    .bind(date)
    .fetch_optional(&mut *c)
    .await?;
    Ok(erp.map(|valeur| TauxReference { valeur, source: "taux de l'ERP en vigueur".into() }))
}

/// Le taux a enregistrer, ou le refus qui dit quoi faire.
///
/// - MAD : toujours 1.
/// - Autre devise : un taux est obligatoire, et jamais 1 — c'est le taux du
///   dirham, pas celui d'une devise.
/// - Ecart de plus de 3 % avec la reference : refuse tant qu'il n'est pas
///   confirme. Le message commence par `TAUX-ECART` : l'ecran le reconnait et
///   propose la confirmation au lieu d'un refus sec.
pub(crate) async fn controler_taux(
    c: &mut sqlx::PgConnection,
    objet: &str,
    devise: &str,
    taux: Option<f64>,
    date: &str,
    confirme: bool,
) -> AppResult<f64> {
    if devise == "MAD" {
        if taux.is_some_and(|t| (t - 1.0).abs() > 1e-9) {
            return Err(AppError::RegleMetier(
                format!("{objet} en MAD : il se passe au taux 1"),
            ));
        }
        return Ok(1.0);
    }
    let reference = taux_reference(c, devise, date).await?;
    let indication = reference
        .as_ref()
        .map(|r| format!(" ({} : {:.4})", r.source, r.valeur))
        .unwrap_or_default();
    let t = taux.filter(|t| *t > 0.0).ok_or_else(|| {
        AppError::RegleMetier(format!(
            "{objet} en {devise} : le taux de change est obligatoire{indication}"
        ))
    })?;
    if (t - 1.0).abs() < 1e-9 {
        return Err(AppError::RegleMetier(format!(
            "{objet} en {devise} au taux 1 : c'est le taux du dirham, pas celui du {devise}{indication}"
        )));
    }
    if let Some(r) = reference {
        let ecart = t / r.valeur - 1.0;
        if ecart.abs() > ECART_TAUX_MAX && !confirme {
            return Err(AppError::RegleMetier(format!(
                "TAUX-ECART : le taux saisi {t:.4} s'ecarte de {:+.1} % du {} ({:.4}). \
                 Corrigez-le, ou confirmez-le s'il s'agit du taux reel de votre banque.",
                ecart * 100.0,
                r.source,
                r.valeur
            )));
        }
    }
    Ok(t)
}

/// `GET /api/import/taux-reference?devise=EUR&date=2026-09-22` — ce que
/// l'ecran propose dans le champ « Taux de change ».
pub async fn taux_reference_facture(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(q): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Lire).await?;
    let devise = q.get("devise").map(|d| d.trim().to_uppercase()).unwrap_or_default();
    let date = q.get("date").cloned().unwrap_or_else(crate::db::aujourdhui);
    if devise.is_empty() {
        return Err(AppError::Invalide("devise obligatoire".into()));
    }
    if devise == "MAD" {
        return Ok(Json(json!({ "devise": devise, "reference": 1.0, "source": "dirham",
                               "ecart_max_pct": ECART_TAUX_MAX * 100.0 })));
    }
    let mut c = state.db.acquire().await?;
    let r = taux_reference(&mut c, &devise, &date).await?;
    Ok(Json(json!({
        "devise": devise,
        "date": date,
        "reference": r.as_ref().map(|r| r.valeur),
        "source": r.map(|r| r.source),
        "ecart_max_pct": ECART_TAUX_MAX * 100.0,
    })))
}

/// `POST /api/import/dossiers/{id}/factures` — la devise de la fiche
/// fournisseur par defaut ; le taux est controle (voir `controler_taux`).
pub async fn creer_facture(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id_dossier): Path<String>,
    Json(f): Json<FactureSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let fournisseur = f.code_fournisseur
        .ok_or_else(|| AppError::Invalide("Fournisseur obligatoire.".into()))?;
    let numero = f.numero_facture.filter(|s| !s.trim().is_empty())
        .ok_or_else(|| AppError::Invalide("Numéro de facture obligatoire.".into()))?;
    let date = f.date_facture.ok_or_else(|| AppError::Invalide("Date de facture obligatoire.".into()))?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // La devise de la fiche fournisseur par defaut, celle du dossier en repli.
    // Le TAUX, lui, ne se replie plus sur celui du dossier : 1 par defaut, il
    // faisait entrer une facture en devise au cours du dirham.
    let devise = match f.code_devise.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        Some(d) => d.to_uppercase(),
        None => sqlx::query_scalar::<_, Option<String>>(
            "SELECT COALESCE((SELECT code_devise FROM fournisseur WHERE code_fournisseur = $1),
                             (SELECT code_devise FROM import_dossiers WHERE id_dossier = $2))",
        )
        .bind(&fournisseur)
        .bind(&id_dossier)
        .fetch_one(&mut *tx)
        .await?
        .unwrap_or_else(|| "MAD".into()),
    };
    let taux = controler_taux(&mut tx, "facture", &devise, f.taux_change, &date,
                              f.taux_confirme.unwrap_or(false)).await?;

    let id: String = sqlx::query_scalar(
        "INSERT INTO import_factures (id_dossier, code_fournisseur, numero_facture, date_facture,
                                      code_devise, taux_change, montant_devise, nb_palettes,
                                      nb_bobines, id_utilisateur_creation, id_engagement)
         SELECT d.id_dossier, $2, $3, fn_jour_casablanca($4), $5, $6, $7, $8, $9, $10, NULLIF($11, '')
           FROM import_dossiers d WHERE d.id_dossier = $1
         RETURNING id_facture",
    )
    .bind(&id_dossier)
    .bind(&fournisseur)
    .bind(numero.trim())
    .bind(&date)
    .bind(&devise)
    .bind(taux)
    .bind(f.montant_devise)
    .bind(f.nb_palettes)
    .bind(f.nb_bobines)
    .bind(&user.id)
    .bind(&f.id_engagement)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("dossier {id_dossier}")))?;
    tx.commit().await?;
    Ok(Json(json!({ "id_facture": id })))
}

/// `PATCH /api/import/factures/{id}` — le taux change la base : on recalcule.
pub async fn modifier_facture(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(f): Json<FactureSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id_dossier = dossier_de_facture(&mut tx, &id).await?;

    // LE TAUX N'EST CONTROLE QUE S'IL BOUGE : devise, taux ou date. Sans cela, un
    // taux confirme une fois serait redemande a chaque enregistrement de la
    // facture, pour un nombre de palettes corrige.
    let (devise_av, taux_av, date_av): (String, f64, String) = sqlx::query_as(
        "SELECT code_devise, taux_change::float8, date_facture::text FROM import_factures
          WHERE id_facture = $1 FOR UPDATE",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    let devise = f.code_devise.as_deref().map(str::trim).filter(|d| !d.is_empty())
        .map(str::to_uppercase).unwrap_or_else(|| devise_av.clone());
    let date = f.date_facture.clone().unwrap_or_else(|| date_av.clone());
    // Passer en MAD sans dire le taux, c'est vouloir le taux 1.
    let taux_saisi = f.taux_change.or(if devise == "MAD" { Some(1.0) } else { Some(taux_av) });
    let bouge = devise != devise_av
        || taux_saisi.is_some_and(|t| (t - taux_av).abs() > 1e-9)
        || date.get(..10) != date_av.get(..10);
    let taux = if bouge {
        Some(controler_taux(&mut tx, "facture", &devise, taux_saisi, &date, f.taux_confirme.unwrap_or(false)).await?)
    } else {
        f.taux_change
    };

    sqlx::query(
        "UPDATE import_factures
            SET code_fournisseur = COALESCE($2, code_fournisseur),
                numero_facture = COALESCE($3, numero_facture), date_facture = COALESCE(fn_jour_casablanca($4), date_facture),
                code_devise = COALESCE($5, code_devise), taux_change = COALESCE($6, taux_change),
                montant_devise = COALESCE($7, montant_devise), nb_palettes = COALESCE($8, nb_palettes),
                nb_bobines = COALESCE($9, nb_bobines),
                id_engagement = CASE WHEN $10::text IS NULL THEN id_engagement ELSE NULLIF($10, '') END
          WHERE id_facture = $1",
    )
    .bind(&id)
    .bind(&f.code_fournisseur)
    .bind(&f.numero_facture)
    .bind(&f.date_facture)
    .bind(&devise)
    .bind(taux)
    .bind(f.montant_devise)
    .bind(f.nb_palettes)
    .bind(f.nb_bobines)
    .bind(&f.id_engagement)
    .execute(&mut *tx)
    .await?;
    metier::recalculer_repartition(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_facture": id })))
}

/// `DELETE /api/import/factures/{id}` — tant qu'aucune de ses lignes n'est
/// entree en stock.
pub async fn supprimer_facture(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id_dossier = dossier_de_facture(&mut tx, &id).await?;
    let recues: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM import_reception_lignes rl
           JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
          WHERE l.id_facture = $1",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    if recues > 0 {
        return Err(AppError::RegleMetier(
            "Cette facture a déjà des lignes en réception : elle ne se supprime plus.".into(),
        ));
    }
    sqlx::query("DELETE FROM import_factures WHERE id_facture = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    metier::recalculer_repartition(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "supprime": id })))
}

// ============================================================================
// Lignes de facture
// ============================================================================

#[derive(Deserialize)]
pub struct LigneSaisie {
    type_ligne: Option<String>,
    code_reference: Option<String>,
    libelle: Option<String>,
    /// La ligne du bon de commande dont vient cette ligne — s'il y en a une.
    id_ligne_bc: Option<String>,
    lot_fournisseur: Option<String>,
    code_couleur: Option<String>,
    libelle_couleur: Option<String>,
    unite: Option<String>,
    quantite: Option<f64>,
    poids_net_kg: Option<f64>,
    nb_bobines: Option<i64>,
    nb_palettes: Option<i64>,
    prix_unitaire_devise: Option<f64>,
    /// La remise du fournisseur, en % du prix brut. Absente : 0 a la
    /// creation, inchangee a la correction.
    remise_pct: Option<f64>,
}

/// `POST /api/import/factures/{id}/lignes`
///
/// Facturee au kg, la quantite EST le poids net : on ne la demande pas deux
/// fois. Le code couleur, s'il n'est pas saisi, vient de la fiche reference.
pub async fn ajouter_ligne(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id_facture): Path<String>,
    Json(l): Json<LigneSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let type_ligne = l.type_ligne.unwrap_or_else(|| "ERP".into());
    let unite = l.unite.unwrap_or_else(|| "kg".into());
    let quantite = match (unite.as_str(), l.quantite, l.poids_net_kg) {
        (_, Some(q), _) => q,
        ("kg", None, Some(p)) => p,
        _ => return Err(AppError::Invalide("Quantité facturée obligatoire.".into())),
    };
    let prix = l.prix_unitaire_devise
        .ok_or_else(|| AppError::Invalide("Prix unitaire obligatoire.".into()))?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id_dossier = dossier_de_facture(&mut tx, &id_facture).await?;
    let id: String = sqlx::query_scalar(
        "INSERT INTO import_facture_lignes
                (id_facture, ligne_numero, type_ligne, code_reference, libelle, id_ligne_bc,
                 lot_fournisseur, code_couleur, unite, quantite, poids_net_kg,
                 nb_bobines, nb_palettes, prix_unitaire_devise, libelle_couleur, remise_pct)
         SELECT $1,
                COALESCE((SELECT max(ligne_numero) FROM import_facture_lignes WHERE id_facture = $1), 0) + 1,
                -- Chaine vide = rien : une ligne « libre » arrive avec un BC
                -- vide, qui sinon echouerait sur la cle etrangere.
                $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''),
                COALESCE(NULLIF($7, ''), (SELECT code_couleur FROM reference WHERE code_reference = $3)),
                $8, $9, $10, COALESCE($11, 0), COALESCE($12, 0), $13,
                COALESCE(NULLIF($14, ''), (SELECT couleur FROM reference WHERE code_reference = $3)),
                $15
         RETURNING id_ligne",
    )
    .bind(&id_facture)
    .bind(&type_ligne)
    .bind(&l.code_reference)
    .bind(&l.libelle)
    .bind(&l.id_ligne_bc)
    .bind(&l.lot_fournisseur)
    .bind(&l.code_couleur)
    .bind(&unite)
    .bind(quantite)
    .bind(l.poids_net_kg)
    .bind(l.nb_bobines)
    .bind(l.nb_palettes)
    .bind(prix)
    .bind(&l.libelle_couleur)
    .bind(super::bons_commande::remise_valide(l.remise_pct)?)
    .fetch_one(&mut *tx)
    .await?;
    metier::recalculer_repartition(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_ligne": id })))
}

/// `PATCH /api/import/lignes/{id}`
pub async fn modifier_ligne(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(l): Json<LigneSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id_dossier = dossier_de_ligne(&mut tx, &id).await?;
    sqlx::query(
        "UPDATE import_facture_lignes
            SET code_reference = COALESCE($2, code_reference), libelle = COALESCE($3, libelle),
                -- Chaine vide = retirer : c'est ainsi qu'une ligne redevient
                -- un achat libre, ou perd un lot saisi par erreur.
                id_ligne_bc = CASE WHEN $4 IS NULL THEN id_ligne_bc ELSE NULLIF($4, '') END,
                lot_fournisseur = CASE WHEN $5 IS NULL THEN lot_fournisseur ELSE NULLIF($5, '') END,
                code_couleur = CASE WHEN $6 IS NULL THEN code_couleur ELSE NULLIF($6, '') END,
                libelle_couleur = CASE WHEN $13 IS NULL THEN libelle_couleur ELSE NULLIF($13, '') END,
                unite = COALESCE($7, unite),
                quantite = COALESCE($8, CASE WHEN COALESCE($7, unite) = 'kg' THEN $9 END, quantite),
                poids_net_kg = COALESCE($9, poids_net_kg),
                nb_bobines = COALESCE($10, nb_bobines), nb_palettes = COALESCE($11, nb_palettes),
                prix_unitaire_devise = COALESCE($12, prix_unitaire_devise),
                remise_pct = COALESCE($14, remise_pct)
          WHERE id_ligne = $1",
    )
    .bind(&id)
    .bind(&l.code_reference)
    .bind(&l.libelle)
    .bind(&l.id_ligne_bc)
    .bind(&l.lot_fournisseur)
    .bind(&l.code_couleur)
    .bind(&l.unite)
    .bind(l.quantite)
    .bind(l.poids_net_kg)
    .bind(l.nb_bobines)
    .bind(l.nb_palettes)
    .bind(l.prix_unitaire_devise)
    .bind(&l.libelle_couleur)
    .bind(match l.remise_pct { Some(r) => Some(super::bons_commande::remise_valide(Some(r))?), None => None })
    .execute(&mut *tx)
    .await?;
    metier::recalculer_repartition(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_ligne": id })))
}

/// `DELETE /api/import/lignes/{id}` — tant qu'elle n'est pas en reception.
pub async fn supprimer_ligne(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id_dossier = dossier_de_ligne(&mut tx, &id).await?;
    let recue: i64 = sqlx::query_scalar("SELECT count(*) FROM import_reception_lignes WHERE id_ligne = $1")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    if recue > 0 {
        return Err(AppError::RegleMetier(
            "Cette ligne est déjà en réception : soldez-la plutôt que de la supprimer.".into(),
        ));
    }
    sqlx::query("DELETE FROM import_facture_lignes WHERE id_ligne = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    metier::recalculer_repartition(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "supprime": id })))
}

#[derive(Deserialize)]
pub struct Solde {
    motif: Option<String>,
}

/// `POST /api/import/lignes/{id}/solder` — le reliquat ne viendra pas.
pub async fn solder_ligne(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(s): Json<Solde>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let motif = s.motif.filter(|m| !m.trim().is_empty())
        .ok_or_else(|| AppError::Invalide("Le motif du solde est obligatoire.".into()))?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id_dossier = dossier_de_ligne(&mut tx, &id).await?;
    sqlx::query("UPDATE import_facture_lignes SET soldee = 1, motif_solde = $2 WHERE id_ligne = $1")
        .bind(&id)
        .bind(motif.trim())
        .execute(&mut *tx)
        .await?;
    metier::statuer_factures(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_ligne": id, "soldee": 1 })))
}

/// `GET /api/import/lignes-bc?fournisseur=X` — les lignes de commande encore
/// ouvertes d'un fournisseur : c'est la liste ou choisir « de quel bon vient
/// cette ligne ».
pub async fn lignes_bc_ouvertes(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(q): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Lire).await?;
    let fournisseur = q.get("fournisseur")
        .ok_or_else(|| AppError::Invalide("Paramètre fournisseur obligatoire.".into()))?;
    let lignes = sqlx::query(
        "SELECT lb.id_ligne_bc, b.numero_bc, b.date_bc::text AS date_bc, b.statut AS statut_bc, lb.ligne_numero,
                lb.code_reference, r.designation, r.code_couleur, lb.quantite_commandee_kg,
                lb.quantite_restante_kg, lb.prix_kg_devise, lb.code_devise
           FROM ligne_bc lb
           JOIN bon_commande b ON b.id_bc = lb.id_bc
           JOIN reference r ON r.code_reference = lb.code_reference
          -- Une ligne de facture se rattache a de la MARCHANDISE commandee. Le
          -- transport et les commissions se saisissent en frais d'approche du
          -- dossier, ou ils se repartissent sur les poids ; rattaches a une
          -- ligne de bon, ils ne pourraient se repartir sur rien.
          WHERE lb.type_ligne = 'MARCHANDISE'
            AND b.code_fournisseur = $1
            -- Envoye au fournisseur, comme en reception locale (audit v4) : un bon
            -- seulement valide n'a pas encore ete commande.
            AND b.statut IN ('ENVOYE','LIVRE_PARTIEL')
            AND lb.statut NOT IN ('SOLDE','ANNULE')
            -- Deja servie par une reception locale : plus rien a facturer (U1).
            AND lb.quantite_restante_kg > 0
          ORDER BY b.date_bc DESC, lb.ligne_numero",
    )
    .bind(fournisseur)
    .fetch_all(&state.db)
    .await?;
    // Le prix du bon est un montant : masque selon les droits (audit v5, T8).
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, IMPORT, &mut v).await?;
    Ok(Json(v))
}

// ============================================================================
// Frais
// ============================================================================

#[derive(Deserialize)]
pub struct FraisSaisie {
    id_frais: Option<String>,
    libelle: Option<String>,
    numero_piece: Option<String>,
    montant_devise: Option<f64>,
    code_devise: Option<String>,
    cours_change: Option<f64>,
    /// Vide ou absent : tout le dossier.
    cibles: Option<Vec<String>>,
    /// Le taux s'ecarte de plus de 3 % du cours Bank Al-Maghrib, et l'operateur
    /// le confirme (c'est celui de sa banque).
    taux_confirme: Option<bool>,
    /// La repartition de ce frais : vide = celle de son type ; MANUEL = les
    /// montants se saisissent ligne par ligne (onglet Liquidation).
    methode_repartition: Option<String>,
}

const METHODES: &[&str] = &["VALEUR", "POIDS", "QUANTITE", "PARTS_EGALES", "MANUEL", "DROITS"];

/// La methode saisie : vide = celle du type ; sinon une des methodes connues.
fn methode_saisie(m: &Option<String>) -> AppResult<Option<String>> {
    match m.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some(x) if METHODES.contains(&x) => Ok(Some(x.to_string())),
        Some(x) => Err(AppError::Invalide(format!("Répartition inconnue : {x}."))),
    }
}

/// La date du jour a Tanger : la reference du cours d'un frais, qui n'a pas de
/// date de piece.
async fn aujourd_hui(c: &mut sqlx::PgConnection) -> AppResult<String> {
    Ok(sqlx::query_scalar("SELECT to_char(now() AT TIME ZONE 'Africa/Casablanca', 'YYYY-MM-DD')")
        .fetch_one(&mut *c)
        .await?)
}

async fn poser_cibles(tx: &mut sqlx::PgConnection, id_ligne_frais: &str, cibles: &[String]) -> AppResult<()> {
    sqlx::query("DELETE FROM dossier_lignes_frais_cibles WHERE id_ligne_frais = $1")
        .bind(id_ligne_frais)
        .execute(&mut *tx)
        .await?;
    if !cibles.is_empty() {
        sqlx::query(
            "INSERT INTO dossier_lignes_frais_cibles (id_ligne_frais, id_ligne)
             SELECT $1, unnest($2::text[])",
        )
        .bind(id_ligne_frais)
        .bind(cibles)
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}

/// `POST /api/import/dossiers/{id}/frais` — en dirhams par defaut, cours 1.
pub async fn ajouter_frais(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id_dossier): Path<String>,
    Json(f): Json<FraisSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let id_frais = f.id_frais.ok_or_else(|| AppError::Invalide("Type de frais obligatoire.".into()))?;
    let montant = f.montant_devise.filter(|m| *m > 0.0)
        .ok_or_else(|| AppError::Invalide("Montant du frais obligatoire.".into()))?;
    let devise = f.code_devise.clone().unwrap_or_else(|| "MAD".into());

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    // LE MEME CONTROLE QUE LES FACTURES (06/10/2026) : un fret de 4 000 USD au
    // cours 1 entrait au cout de revient pour 4 000 DH au lieu de 39 400.
    let jour = aujourd_hui(&mut tx).await?;
    let cours = controler_taux(&mut tx, "frais", &devise, f.cours_change, &jour,
                               f.taux_confirme.unwrap_or(false)).await?;
    let methode = methode_saisie(&f.methode_repartition)?;
    let id: String = sqlx::query_scalar(
        "INSERT INTO dossier_lignes_frais (id_dossier, id_frais, libelle, numero_piece,
                                           montant_devise, code_devise, cours_change,
                                           id_utilisateur_creation, methode_repartition)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id_ligne_frais",
    )
    .bind(&id_dossier)
    .bind(&id_frais)
    .bind(&f.libelle)
    .bind(&f.numero_piece)
    .bind(montant)
    .bind(&devise)
    .bind(cours)
    .bind(&user.id)
    .bind(&methode)
    .fetch_one(&mut *tx)
    .await?;
    poser_cibles(&mut tx, &id, f.cibles.as_deref().unwrap_or(&[])).await?;
    metier::recalculer_repartition(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_ligne_frais": id })))
}

#[derive(Deserialize)]
pub struct FraisPostCloture {
    #[serde(flatten)]
    frais: FraisSaisie,
    motif: Option<String>,
    #[serde(default)]
    simuler: bool,
}

/// `POST /api/import/dossiers/{id}/frais-post-cloture` — UNE FACTURE TARDIVE
/// (regle 5, 09/10/2026) : le transitaire ou le port facture apres la cloture.
/// On ne rouvre pas le dossier : le frais s'ajoute, se repartit, et la seule
/// difference va au stock restant du dossier, la part consommee en ecart.
/// Acte de valorisation : droit VALIDER, motif obligatoire.
pub async fn frais_post_cloture(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id_dossier): Path<String>,
    Json(p): Json<FraisPostCloture>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Valider).await?;
    let f = p.frais;
    let motif = p.motif.as_deref().map(str::trim).unwrap_or("").to_string();
    if motif.chars().count() < 5 {
        return Err(AppError::Invalide("Dites quelle facture arrive apres la cloture (5 caracteres au moins).".into()));
    }
    let id_frais = f.id_frais.ok_or_else(|| AppError::Invalide("Type de frais obligatoire.".into()))?;
    let montant = f.montant_devise.filter(|m| *m > 0.0)
        .ok_or_else(|| AppError::Invalide("Montant du frais obligatoire.".into()))?;
    let devise = f.code_devise.clone().unwrap_or_else(|| "MAD".into());

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let jour = aujourd_hui(&mut tx).await?;
    let cours = controler_taux(&mut tx, "frais", &devise, f.cours_change, &jour,
                               f.taux_confirme.unwrap_or(false)).await?;
    // La base n'admet un frais sur un dossier clos que marque ainsi.
    sqlx::query("SELECT set_config('gestionfil.frais_post_cloture', 'on', true)")
        .execute(&mut *tx)
        .await?;
    let id: String = sqlx::query_scalar(
        "INSERT INTO dossier_lignes_frais (id_dossier, id_frais, libelle, numero_piece,
                                           montant_devise, code_devise, cours_change,
                                           id_utilisateur_creation, post_cloture, motif_post_cloture)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)
         RETURNING id_ligne_frais",
    )
    .bind(&id_dossier)
    .bind(&id_frais)
    .bind(&f.libelle)
    .bind(&f.numero_piece)
    .bind(montant)
    .bind(&devise)
    .bind(cours)
    .bind(&user.id)
    .bind(&motif)
    .fetch_one(&mut *tx)
    .await?;
    poser_cibles(&mut tx, &id, f.cibles.as_deref().unwrap_or(&[])).await?;
    let mut v = metier::cloturer_dans(&mut tx, &user, &id_dossier, true, p.simuler).await?;
    if p.simuler {
        tx.rollback().await?;
    } else {
        tx.commit().await?;
    }
    v["id_ligne_frais"] = json!(id);
    user.masquer(&state.db, IMPORT, &mut v).await?;
    Ok(Json(v))
}

// ============================================================================
// LE COUT DE REVIENT REEL (09/10/2026) : paiements et change, sans comptabilite
// ============================================================================

/// `GET /api/import/dossiers/{id}/cout-revient-reel` — par facture : matiere au
/// cours du dedouanement, frais, change constate au paiement (coupe au 31/12
/// pour un dossier a cheval sur deux exercices), cout reel. Le CMUP n'en est pas
/// touche : il reste au cours du dedouanement, comme la comptabilite.
pub async fn cout_revient_reel(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id_dossier): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Lire).await?;
    let factures = sqlx::query(
        "SELECT id_facture, numero_facture, code_devise, date_ded, annee_ded,
                montant_devise::float8 AS montant_devise, cours_ded::float8 AS cours_ded,
                matiere_mad::float8 AS matiere_mad, frais_mad::float8 AS frais_mad,
                paye_devise::float8 AS paye_devise, paye_mad::float8 AS paye_mad, nb_paiements,
                reste_devise::float8 AS reste_devise, cours_fin_annee_ded::float8 AS cours_fin_annee_ded,
                change_annee_ded_mad::float8 AS change_annee_ded_mad,
                change_annee_suivante_mad::float8 AS change_annee_suivante_mad, latent
           FROM v_cout_revient_reel WHERE id_dossier = $1 ORDER BY numero_facture",
    )
    .bind(&id_dossier)
    .fetch_all(&state.db)
    .await?;
    let paiements = sqlx::query(
        "SELECT id_paiement, id_facture, numero_facture, date_paiement,
                montant_devise::float8 AS montant_devise, montant_mad::float8 AS montant_mad,
                cours_paiement::float8 AS cours_paiement, cours_fin_annee::float8 AS cours_fin_annee,
                ecart_annee_ded_mad::float8 AS ecart_annee_ded_mad,
                ecart_annee_suivante_mad::float8 AS ecart_annee_suivante_mad, annee_ded, annee_paiement
           FROM v_change_paiement WHERE id_dossier = $1 ORDER BY date_paiement, numero_facture",
    )
    .bind(&id_dossier)
    .fetch_all(&state.db)
    .await?;
    let mut v = json!({
        "factures": crate::routes::json::lignes_en_json(&factures),
        "paiements": crate::routes::json::lignes_en_json(&paiements),
    });
    user.masquer(&state.db, IMPORT, &mut v).await?;
    Ok(Json(v))
}

#[derive(Deserialize)]
pub struct PaiementSaisie {
    date_paiement: String,
    montant_devise: f64,
    /// Les dirhams reellement debites : le cours est celui de la banque.
    montant_mad: f64,
    reference_banque: Option<String>,
    notes: Option<String>,
    #[serde(default)]
    taux_confirme: bool,
}

/// `POST /api/import/factures/{id}/paiements` — un paiement de la facture, au
/// cours que la banque a applique (MAD debites / devise payee). Une facture se
/// paie en plusieurs fois : un ecart par paiement.
pub async fn ajouter_paiement(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id_facture): Path<String>,
    Json(p): Json<PaiementSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Valider).await?;
    if !(p.montant_devise > 0.0) || !(p.montant_mad > 0.0) {
        return Err(AppError::Invalide("Le montant payé et les dirhams débités doivent être positifs.".into()));
    }
    let date = p.date_paiement.trim().get(..10).unwrap_or("").to_string();
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let futur: bool = sqlx::query_scalar("SELECT $1 > to_char(current_date, 'YYYY-MM-DD')")
        .bind(&date)
        .fetch_one(&mut *tx)
        .await?;
    if futur || date.len() != 10 {
        return Err(AppError::Invalide("La date du paiement est obligatoire et ne peut pas être future.".into()));
    }
    let (numero, devise, montant, deja): (String, String, f64, f64) = sqlx::query_as(
        "SELECT f.numero_facture, f.code_devise, f.montant_devise::float8,
                COALESCE((SELECT sum(montant_devise) FROM paiement_facture_import WHERE id_facture = f.id_facture), 0)::float8
           FROM import_factures f WHERE f.id_facture = $1 FOR UPDATE",
    )
    .bind(&id_facture)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("facture {id_facture}")))?;
    if deja + p.montant_devise > montant + 0.01 {
        return Err(AppError::RegleMetier(format!(
            "La facture {numero} est de {montant:.2} {devise} ; {deja:.2} sont déjà payés : ce paiement la dépasserait."
        )));
    }
    // Le cours de la banque, compare au cours BAM du jour du paiement (3 %).
    let cours = p.montant_mad / p.montant_devise;
    controler_taux(&mut tx, &format!("Le paiement de {numero}"), &devise, Some(cours), &date, p.taux_confirme).await?;
    let id: String = sqlx::query_scalar(
        "INSERT INTO paiement_facture_import (id_facture, date_paiement, montant_devise, montant_mad,
                                              reference_banque, notes, id_utilisateur)
         VALUES ($1, fn_jour_casablanca($2), $3, $4, $5, $6, $7) RETURNING id_paiement",
    )
    .bind(&id_facture)
    .bind(&date)
    .bind(p.montant_devise)
    .bind(p.montant_mad)
    .bind(p.reference_banque.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(p.notes.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(&user.id)
    .fetch_one(&mut *tx)
    .await?;
    // A11 (10/10/2026) : jamais d'acompte avant le dedouanement. Un paiement
    // date avant est une erreur de date probable : signale (C53), pas refuse.
    let date_ded: Option<String> =
        sqlx::query_scalar("SELECT date_ded FROM v_change_paiement WHERE id_paiement = $1")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?;
    let avis: Vec<String> = date_ded
        .filter(|d| date.as_str() < d.as_str())
        .map(|d| {
            format!(
                "Ce paiement est daté du {date}, avant le dédouanement de la facture {numero} ({d}) : \
                 vérifiez la date (signalé par le contrôle C53)."
            )
        })
        .into_iter()
        .collect();
    tx.commit().await?;
    Ok(Json(json!({ "id_paiement": id, "avis": avis })))
}

/// `DELETE /api/import/paiements/{id}` — un paiement saisi par erreur. Il ne
/// touche ni le stock ni le CMUP ; sa suppression reste au journal d'audit.
pub async fn supprimer_paiement(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Valider).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let n = sqlx::query("DELETE FROM paiement_facture_import WHERE id_paiement = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::Introuvable(format!("paiement {id}")));
    }
    tx.commit().await?;
    Ok(Json(json!({ "supprime": true })))
}

/// `PATCH /api/import/frais/{id}`
pub async fn modifier_frais(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(f): Json<FraisSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    // Le taux ne se recontrole que si la devise ou le cours changent.
    if f.code_devise.is_some() || f.cours_change.is_some() {
        let actuel: Option<(String, f64)> = sqlx::query_as(
            "SELECT code_devise, cours_change::float8 FROM dossier_lignes_frais WHERE id_ligne_frais = $1",
        )
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some((devise_actuelle, cours_actuel)) = actuel {
            let devise = f.code_devise.clone().unwrap_or(devise_actuelle);
            let cours = if devise == "MAD" { Some(1.0) } else { f.cours_change.or(Some(cours_actuel)) };
            let jour = aujourd_hui(&mut tx).await?;
            controler_taux(&mut tx, "frais", &devise, cours, &jour, f.taux_confirme.unwrap_or(false)).await?;
        }
    }
    let id_dossier: String = sqlx::query_scalar(
        "UPDATE dossier_lignes_frais
            SET id_frais = COALESCE($2, id_frais), libelle = COALESCE($3, libelle),
                numero_piece = COALESCE($4, numero_piece),
                montant_devise = COALESCE($5, montant_devise),
                code_devise = COALESCE($6, code_devise),
                cours_change = CASE WHEN COALESCE($6, code_devise) = 'MAD' THEN 1
                                    ELSE COALESCE($7, cours_change) END
          WHERE id_ligne_frais = $1
      RETURNING id_dossier",
    )
    .bind(&id)
    .bind(&f.id_frais)
    .bind(&f.libelle)
    .bind(&f.numero_piece)
    .bind(f.montant_devise)
    .bind(&f.code_devise)
    .bind(f.cours_change)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("frais {id}")))?;
    if let Some(c) = &f.cibles {
        poser_cibles(&mut tx, &id, c).await?;
    }
    if f.methode_repartition.is_some() {
        sqlx::query("UPDATE dossier_lignes_frais SET methode_repartition = $2 WHERE id_ligne_frais = $1")
            .bind(&id)
            .bind(methode_saisie(&f.methode_repartition)?)
            .execute(&mut *tx)
            .await?;
    }
    metier::recalculer_repartition(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_ligne_frais": id })))
}

#[derive(Deserialize)]
pub struct MontantLigne {
    id_ligne: String,
    montant_dhs: f64,
}

#[derive(Deserialize)]
pub struct RepartitionManuelle {
    montants: Vec<MontantLigne>,
}

/// `PUT /api/import/frais/{id}/repartition` — LA REPARTITION SAISIE d'un
/// frais : le montant de chaque ligne de facture (la douane par nature de
/// reference). Le frais passe en repartition manuelle, quel que soit son type.
/// Tant que la somme n'egale pas le montant, il est « non reparti » et la
/// cloture le refuse.
pub async fn repartir_frais(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(r): Json<RepartitionManuelle>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let (id_dossier, montant): (String, f64) = sqlx::query_as(
        "SELECT id_dossier, montant_dhs::float8 FROM dossier_lignes_frais WHERE id_ligne_frais = $1 FOR UPDATE",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("frais {id}")))?;
    // Meme un frais que le parametrage repartit a la valeur ou au poids se
    // corrige : saisir ses montants le passe en repartition manuelle.
    sqlx::query("UPDATE dossier_lignes_frais SET methode_repartition = 'MANUEL' WHERE id_ligne_frais = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    // Les lignes permises : celles que le frais vise, a defaut tout le dossier.
    let permises: Vec<String> = sqlx::query_scalar(
        "SELECT l.id_ligne FROM import_facture_lignes l JOIN import_factures f ON f.id_facture = l.id_facture
          WHERE f.id_dossier = $1
            AND (NOT EXISTS (SELECT 1 FROM dossier_lignes_frais_cibles c WHERE c.id_ligne_frais = $2)
                 OR l.id_ligne IN (SELECT c.id_ligne FROM dossier_lignes_frais_cibles c WHERE c.id_ligne_frais = $2))",
    )
    .bind(&id_dossier)
    .bind(&id)
    .fetch_all(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM lignes_frais_repartition WHERE id_ligne_frais = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    let mut total = 0.0;
    for m in r.montants.iter().filter(|m| m.montant_dhs != 0.0) {
        if !(m.montant_dhs > 0.0) || !m.montant_dhs.is_finite() {
            return Err(AppError::Invalide("Un montant réparti doit être positif.".into()));
        }
        if !permises.contains(&m.id_ligne) {
            return Err(AppError::Invalide("Une ligne n'est pas visée par ce frais.".into()));
        }
        total += m.montant_dhs;
        sqlx::query(
            "INSERT INTO lignes_frais_repartition (id_ligne_frais, id_article_dossier, pourcentage, montant_alloue_dhs)
             VALUES ($1, $2, LEAST(100, round(($3 * 100.0 / NULLIF($4, 0))::numeric, 10)), round($3::numeric, 2))",
        )
        .bind(&id)
        .bind(&m.id_ligne)
        .bind(m.montant_dhs)
        .bind(montant)
        .execute(&mut *tx)
        .await?;
    }
    if total > montant + 0.005 {
        return Err(AppError::RegleMetier(format!(
            "{total:.2} DH répartis : plus que le montant du frais ({montant:.2} DH)."
        )));
    }
    tx.commit().await?;
    Ok(Json(json!({ "id_ligne_frais": id, "reparti_dhs": (total * 100.0).round() / 100.0, "montant_dhs": montant })))
}

/// `DELETE /api/import/frais/{id}`
pub async fn supprimer_frais(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id_dossier: String = sqlx::query_scalar(
        "DELETE FROM dossier_lignes_frais WHERE id_ligne_frais = $1 RETURNING id_dossier",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("frais {id}")))?;
    metier::recalculer_repartition(&mut tx, &id_dossier).await?;
    tx.commit().await?;
    Ok(Json(json!({ "supprime": id })))
}

// ============================================================================
// Cloture
// ============================================================================

/// `POST /api/import/dossiers/{id}/cloturer?simuler=1`
///
/// Avec `simuler`, tout est calcule et rien n'est ecrit : c'est l'apercu que
/// l'ecran montre avant de demander la confirmation.
pub async fn cloturer(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
    corps: axum::body::Bytes,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Valider).await?;
    // L'APERCU SE DEMANDE DANS L'ADRESSE OU DANS LE CORPS (audit v4). La
    // cloture locale le prend dans le corps : un appel qui suivait la meme
    // forme ici cloturait pour de bon le dossier qu'il croyait seulement
    // simuler.
    let dans_corps = serde_json::from_slice::<Value>(&corps)
        .ok()
        .and_then(|v| v.get("simuler").and_then(Value::as_bool))
        .unwrap_or(false);
    let simuler = dans_corps || matches!(q.get("simuler").map(String::as_str), Some("1" | "true"));
    let mut v = metier::cloturer(&state.db, &user, &id, simuler).await?;
    user.masquer(&state.db, IMPORT, &mut v).await?;
    Ok(Json(v))
}

#[derive(Deserialize)]
pub struct AvoirImport {
    /// AVOIR_PRIX (remise, non-conformite gardee) ou AVOIR_RETOUR.
    nature: String,
    numero_piece: String,
    /// En dirhams, au cours de l'avoir.
    montant_mad: f64,
    motif: String,
    /// Un avoir de prix qui ne vise qu'une reference.
    code_reference: Option<String>,
    #[serde(default)]
    simuler: bool,
}

/// `POST /api/import/dossiers/{id}/avoir` — un avoir du fournisseur sur un
/// dossier recu (regle 3, 09/10/2026). De prix : la valeur baisse au CMUP de la
/// marchandise encore en stock, la part sortie en « consomme ». Pour retour :
/// solde les retours fournisseur du dossier, l'ecart en « consomme ». Avec
/// `simuler`, l'apercu, sans rien ecrire.
pub async fn avoir(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(a): Json<AvoirImport>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Valider).await?;
    let mut v = metier::avoir(
        &state.db,
        &user,
        &id,
        a.nature.trim(),
        &a.numero_piece,
        a.montant_mad,
        &a.motif,
        a.code_reference.as_deref(),
        a.simuler,
    )
    .await?;
    user.masquer(&state.db, IMPORT, &mut v).await?;
    Ok(Json(v))
}

/// `POST /api/import/dossiers/{id}/valider` — le brouillon passe EN COURS.
///
/// DEMANDE DU 30/09/2026 : on valide le dossier a la main, sans attendre la
/// premiere reception (qui le fait toujours d'elle-meme). Valide, il ne se
/// supprime plus — le declencheur ne l'admet qu'en brouillon.
pub async fn valider_dossier(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Valider).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let statut: Option<String> =
        sqlx::query_scalar("SELECT statut FROM import_dossiers WHERE id_dossier = $1")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?;
    match statut.as_deref() {
        None => return Err(AppError::Introuvable(format!("dossier {id}"))),
        Some("BROUILLON") => {}
        Some(s) => {
            return Err(AppError::Invalide(format!(
                "Seul un dossier en brouillon se valide (celui-ci est {}).",
                s.to_lowercase().replace('_', " ")
            )))
        }
    }
    let factures: i64 =
        sqlx::query_scalar("SELECT count(*) FROM import_factures WHERE id_dossier = $1")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
    if factures == 0 {
        return Err(AppError::Invalide(
            "Un dossier sans facture ne se valide pas : ajoutez d'abord ses factures.".into(),
        ));
    }
    sqlx::query("UPDATE import_dossiers SET statut = 'EN_COURS' WHERE id_dossier = $1 AND statut = 'BROUILLON'")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_dossier": id, "statut": "EN_COURS" })))
}


// ============================================================================
// Engagements d'importation (EI)
// ============================================================================

/// Un engagement d'importation, tel que la banque et la DUM le citent.
///
/// REFERENCE SEULEMENT : il sert a retrouver et a classer le dossier. Le suivi
/// du credit — consommation, echeances, reglements — appartient a la
/// tresorerie, et ne se fait pas ici.
#[derive(Deserialize)]
pub struct EngagementSaisi {
    numero_ei: String,
    banque: Option<String>,
    date_ei: Option<String>,
    quantite_kg: Option<f64>,
    montant_devise: Option<f64>,
    code_devise: Option<String>,
    notes: Option<String>,
    /// Le fournisseur dont la proforma est couverte : sa devise est celle de
    /// l'engagement, sauf saisie contraire.
    code_fournisseur: Option<String>,
}

/// `POST /api/import/dossiers/{id}/engagements`
pub async fn ajouter_engagement(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id_dossier): Path<String>,
    Json(e): Json<EngagementSaisi>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    // LE NUMERO SE RECOPIE SANS ESPACES. La banque l'imprime d'un bloc, la DUM
    // parfois en groupes : sans cela, le meme engagement serait saisi deux fois
    // sous deux formes, et la recherche n'en trouverait qu'une.
    let numero: String = e.numero_ei.chars().filter(|c| !c.is_whitespace()).collect();
    if numero.is_empty() {
        return Err(AppError::Invalide("Le numero de l'engagement est obligatoire.".into()));
    }
    let vide = |s: &Option<String>| s.as_deref().map(str::trim).filter(|x| !x.is_empty()).map(String::from);
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let id: String = sqlx::query_scalar(
        "INSERT INTO import_engagements
                (id_dossier, numero_ei, banque, date_ei, quantite_kg, montant_devise,
                 code_devise, notes, id_utilisateur_creation, code_fournisseur)
         VALUES ($1, $2, $3, fn_jour_casablanca($4), $5, $6,
                 COALESCE($7, (SELECT code_devise FROM fournisseur WHERE code_fournisseur = $10),
                          (SELECT code_devise FROM import_dossiers WHERE id_dossier = $1)),
                 $8, $9, $10)
         RETURNING id_engagement",
    )
    .bind(&id_dossier)
    .bind(&numero)
    .bind(vide(&e.banque))
    .bind(vide(&e.date_ei))
    .bind(e.quantite_kg)
    .bind(e.montant_devise)
    .bind(vide(&e.code_devise))
    .bind(vide(&e.notes))
    .bind(&user.id)
    .bind(vide(&e.code_fournisseur))
    .fetch_one(&mut *tx)
    .await
    .map_err(|err| match &err {
        // Le meme engagement deux fois sur le meme dossier : on le dit en clair.
        sqlx::Error::Database(d) if d.code().as_deref() == Some("23505") => AppError::Conflit(
            format!("L'engagement {numero} est deja rattache a ce dossier."),
        ),
        _ => AppError::from(err),
    })?;
    tx.commit().await?;
    Ok(Json(json!({ "id_engagement": id, "numero_ei": numero })))
}

/// `DELETE /api/import/engagements/{id}`
pub async fn supprimer_engagement(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let n = sqlx::query("DELETE FROM import_engagements WHERE id_engagement = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::Introuvable(format!("engagement {id}")));
    }
    tx.commit().await?;
    Ok(Json(json!({ "supprime": id })))
}
