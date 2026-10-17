//! Les inventaires : brouillon, comptage, validation, cloture.
//! Sortis de `stock.rs` le 17/10/2026 (audit B2).

use super::json::lignes_en_json;
use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::db::{arrondi_kg, maintenant};
use crate::domain::numerotation::numeroter;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
pub async fn lister_inventaires(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::INVENTAIRE, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT i.*, u.login AS responsable, v.login AS valide_par,
                (SELECT COUNT(*) FROM ligne_inventaire l WHERE l.id_inventaire = i.id_inventaire) AS nb_lignes,
                (SELECT COUNT(*) FROM ligne_inventaire l
                  WHERE l.id_inventaire = i.id_inventaire AND l.statut_ligne = 'A_TRAITER') AS nb_a_compter
           FROM inventaire i
           LEFT JOIN utilisateur u ON u.id_utilisateur = i.id_utilisateur_responsable
           LEFT JOIN utilisateur v ON v.id_utilisateur = i.id_utilisateur_validation
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

    // UN SEUL INVENTAIRE OUVERT PAR MAGASIN (06/10/2026, garde en base depuis
    // le 13/10) : deux comptages sur le meme magasin appliquaient deux fois les
    // memes ecarts. On le dit avant de buter sur l'index.
    let ouvert: Option<String> = sqlx::query_scalar(
        "SELECT numero_inventaire FROM inventaire
          WHERE code_magasin = $1 AND statut IN ('BROUILLON', 'VALIDE') LIMIT 1",
    )
    .bind(&i.code_magasin)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(autre) = ouvert {
        return Err(AppError::RegleMetier(format!(
            "L'inventaire {autre} est deja ouvert sur le magasin {} : cloturez-le (ou annulez-le) avant d'en creer un autre.",
            i.code_magasin
        )));
    }

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
    // Les lignes a compter, tout de suite (13/10/2026) : plus d'etape « ouvrir ».
    let n = crate::domain::inventaire::preparer(&mut tx, &id).await?;

    tx.commit().await?;
    Ok(Json(json!({ "id_inventaire": id, "numero_inventaire": numero, "lignes_a_compter": n })))
}

/// `GET /api/inventaires/{id}` — l'en-tete d'un inventaire, pour sa page.
pub async fn lire_inventaire(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::INVENTAIRE, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT i.*, u.login AS responsable, v.login AS valide_par, mg.nom AS magasin_nom,
                (SELECT COUNT(*) FROM ligne_inventaire l WHERE l.id_inventaire = i.id_inventaire) AS nb_lignes,
                (SELECT COUNT(*) FROM ligne_inventaire l
                  WHERE l.id_inventaire = i.id_inventaire AND l.statut_ligne = 'A_TRAITER') AS nb_a_compter,
                EXISTS (SELECT 1 FROM ligne_inventaire l
                         WHERE l.id_inventaire = i.id_inventaire AND l.id_utilisateur_comptage = $2) AS j_ai_compte
           FROM inventaire i
           LEFT JOIN utilisateur u ON u.id_utilisateur = i.id_utilisateur_responsable
           LEFT JOIN utilisateur v ON v.id_utilisateur = i.id_utilisateur_validation
           LEFT JOIN magasin mg ON mg.code_magasin = i.code_magasin
          WHERE i.id_inventaire = $1",
    )
    .bind(&id)
    .bind(&user.id)
    .fetch_all(&state.db)
    .await?;
    let mut valeur = lignes_en_json(&rows)
        .get(0)
        .cloned()
        .ok_or_else(|| AppError::Introuvable(format!("inventaire {id}")))?;
    user.masquer(&state.db, module::INVENTAIRE, &mut valeur).await?;
    Ok(Json(valeur))
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
    /// LE COMPTAGE EN COLIS (02/10/2026) : bobines et palettes comptees, pour
    /// lire l'ecart de poids par bobine au moment meme du comptage.
    pub nb_bobines: Option<i64>,
    pub nb_palettes: Option<f64>,
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

    // FOR SHARE : un comptage ne se glisse pas pendant une cloture, qui tient
    // la fiche en FOR UPDATE.
    let statut: String =
        sqlx::query_scalar("SELECT statut FROM inventaire WHERE id_inventaire = $1 FOR SHARE")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("inventaire {id}")))?;
    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(format!(
            "Le comptage se saisit sur un inventaire en brouillon (statut actuel : {statut})."
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
        //
        // LE THEORIQUE A L'HEURE DU COMPTAGE (regle 10, 08/10/2026). La photo
        // prise a l'ouverture vieillissait avec le magasin : deux inventaires
        // ouverts depuis des semaines avaient des theoriques perimes de 158 t
        // et 65,6 t, et la cloture aurait pris pour ecart tout ce qui etait
        // entre ou sorti depuis. Chaque ligne reprend donc, a l'instant ou on la
        // compte, le stock que le grand livre porte a cet instant (le cache en
        // est le reflet, controle C11). L'ecart = compte - theorique de cet
        // instant ; ce qui bouge ensuite reste acquis. Pas de gel du magasin.
        let res = sqlx::query(
            "UPDATE ligne_inventaire li
                SET quantite_comptee_kg = $3, motif_ecart = $4, statut_ligne = 'COMPTE',
                    id_utilisateur_comptage = $5, date_comptage = $6,
                    nb_bobines_comptees = $9, nb_palettes_comptees = $10,
                    quantite_theorique_kg = CASE
                        WHEN li.lot_fournisseur IS NULL THEN
                            COALESCE((SELECT sm.quantite_kg FROM stock_magasin sm
                                       WHERE sm.code_reference = li.code_reference
                                         AND sm.code_magasin = li.code_magasin), 0)
                        ELSE
                            COALESCE((SELECT sl.quantite_kg FROM stock_lot sl
                                       WHERE sl.code_reference = li.code_reference
                                         AND sl.code_magasin = li.code_magasin
                                         AND sl.lot_fournisseur = li.lot_fournisseur), 0)
                        END,
                    nb_bobines_theorique = CASE
                        WHEN li.lot_fournisseur IS NULL THEN
                            (SELECT sm.nb_bobines FROM stock_magasin sm
                              WHERE sm.code_reference = li.code_reference
                                AND sm.code_magasin = li.code_magasin)
                        ELSE
                            (SELECT sl.nb_bobines FROM stock_lot sl
                              WHERE sl.code_reference = li.code_reference
                                AND sl.code_magasin = li.code_magasin
                                AND sl.lot_fournisseur = li.lot_fournisseur)
                        END
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
        .bind(c.nb_bobines)
        .bind(c.nb_palettes)
        .execute(&mut *tx)
        .await?;

        // UN LOT TROUVE AU COMPTAGE (01/10/2026). Le rayon porte un lot que la
        // base ne connait pas — c'est ainsi que le stock « sans lot » se
        // repartit entre de vrais lots. On ouvre sa ligne, theorique zero ; la
        // cloture l'ajuste comme les autres, et le lot entre au stock par lot.
        // Seulement pour une reference suivie, dans le magasin de l'inventaire.
        let lot_saisi = c.lot_fournisseur.as_deref().map(str::trim).filter(|l| !l.is_empty());
        if res.rows_affected() == 0 {
            if let Some(lot) = lot_saisi {
                let admis: bool = sqlx::query_scalar(
                    "SELECT EXISTS (SELECT 1 FROM inventaire i, reference r
                                     WHERE i.id_inventaire = $1 AND i.code_magasin = $2
                                       AND r.code_reference = $3 AND r.suivi_lot = 1)",
                )
                .bind(&id)
                .bind(&c.code_magasin)
                .bind(&c.code_reference)
                .fetch_one(&mut *tx)
                .await?;
                if admis {
                    sqlx::query(
                        "INSERT INTO ligne_inventaire
                             (id_ligne_inv, id_inventaire, code_reference, code_magasin, lot_fournisseur,
                              quantite_theorique_kg, quantite_comptee_kg, motif_ecart, statut_ligne,
                              id_utilisateur_comptage, date_comptage, nb_bobines_theorique,
                              nb_bobines_comptees, nb_palettes_comptees, poids_unitaire_theorique_kg)
                         VALUES ($1, $2, $3, $4, $5,
                                 COALESCE((SELECT sl.quantite_kg FROM stock_lot sl
                                            WHERE sl.code_reference = $3 AND sl.code_magasin = $4
                                              AND sl.lot_fournisseur = $5), 0),
                                 $6, $7, 'COMPTE', $8, $9,
                                 COALESCE((SELECT sl.nb_bobines FROM stock_lot sl
                                            WHERE sl.code_reference = $3 AND sl.code_magasin = $4
                                              AND sl.lot_fournisseur = $5), 0),
                                 $10, $11,
                                 (SELECT NULLIF(poids_bobine_kg, 0) FROM reference WHERE code_reference = $3))",
                    )
                    .bind(uuid::Uuid::new_v4().to_string())
                    .bind(&id)
                    .bind(&c.code_reference)
                    .bind(&c.code_magasin)
                    .bind(lot)
                    .bind(arrondi_kg(c.quantite_comptee_kg))
                    .bind(c.motif_ecart.clone().or_else(|| Some("Lot trouvé au comptage".into())))
                    .bind(&user.id)
                    .bind(&horodatage)
                    .bind(c.nb_bobines)
                    .bind(c.nb_palettes)
                    .execute(&mut *tx)
                    .await?;
                    n += 1;
                    continue;
                }
            }
        }
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
