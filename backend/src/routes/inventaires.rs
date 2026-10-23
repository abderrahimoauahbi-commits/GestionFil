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
    /// L'IDENTIFIANT TIRE PAR L'ECRAN a l'ouverture du formulaire (audit P3,
    /// 19/10/2026) : le meme envoi rejoue rend le meme document, pas un second.
    /// Absent : le serveur en tire un.
    #[serde(default)]
    pub id_document: Option<String>,
    pub code_magasin: String,
    pub type_inventaire: String,
}

pub async fn creer_inventaire(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(i): Json<NouvelInventaire>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::INVENTAIRE, Action::Ecrire).await?;
    let id = crate::domain::idempotence::identifiant(i.id_document.as_deref())?;
    if let Some(v) = crate::domain::idempotence::deja_enregistre(
        &state.db, &crate::domain::idempotence::INVENTAIRE, &id, &user.id,
    )
    .await?
    {
        return Ok(Json(v));
    }

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

    // LE MAGASIN EST DESORMAIS GELE (23/10/2026) — tout entier pour un GLOBAL,
    // ses references comptees pour un TOURNANT ou un CIBLE (2026-10-24a) : ce
    // qui etait en route et touche le gel n'entrera plus avant la cloture. On
    // le dit, sans bloquer.
    let avis = documents_en_route(&mut tx, &id, &i.code_magasin).await?;

    tx.commit().await?;
    Ok(Json(json!({
        "id_inventaire": id, "numero_inventaire": numero, "lignes_a_compter": n, "avis": avis,
    })))
}

/// Les documents qui attendent d'entrer dans un magasin : transferts expedies vers
/// lui, receptions pas encore validees qui y deposent. Sur un magasin gele par un
/// inventaire, leur arrivee sera refusee jusqu'a la cloture (2026-10-23g) — pour
/// un TOURNANT ou un CIBLE, seulement s'ils portent une reference comptee
/// (2026-10-24a, meme regle que la base).
async fn documents_en_route(
    tx: &mut sqlx::PgConnection,
    id_inventaire: &str,
    magasin: &str,
) -> AppResult<Vec<String>> {
    let transferts: Vec<String> = sqlx::query_scalar(
        "SELECT t.numero_transfert FROM transfert t
          WHERE t.code_magasin_dest = $1 AND t.statut = 'VALIDE'
            AND (NOT fn_inventaire_gel_par_reference($2)
                 OR EXISTS (SELECT 1 FROM ligne_transfert l
                             WHERE l.id_transfert = t.id_transfert
                               AND fn_inventaire_compte_reference($2, l.code_reference)))
          ORDER BY t.numero_transfert",
    )
    .bind(magasin)
    .bind(id_inventaire)
    .fetch_all(&mut *tx)
    .await?;
    let receptions: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT r.numero_reception FROM reception r
           JOIN ligne_reception l ON l.id_reception = r.id_reception
          WHERE l.code_magasin_dest = $1 AND r.statut IN ('BROUILLON', 'A_CONTROLER')
            AND (NOT fn_inventaire_gel_par_reference($2)
                 OR fn_inventaire_compte_reference($2, l.code_reference))
          ORDER BY r.numero_reception",
    )
    .bind(magasin)
    .bind(id_inventaire)
    .fetch_all(&mut *tx)
    .await?;
    let mut avis = Vec::new();
    if !transferts.is_empty() {
        avis.push(format!(
            "Transfert(s) en route vers ce magasin : {}. Leur arrivée sera refusée jusqu'à la clôture de l'inventaire.",
            transferts.join(", ")
        ));
    }
    if !receptions.is_empty() {
        avis.push(format!(
            "Réception(s) en cours vers ce magasin : {}. Leur validation sera refusée jusqu'à la clôture de l'inventaire.",
            receptions.join(", ")
        ));
    }
    Ok(avis)
}

/// `GET /api/inventaires/ouverts` — ce que gelent les inventaires ouverts
/// (23/10/2026). Lu par les ecrans qui ecrivent du stock (mouvement, fiche hors
/// machine, reception, transfert, fiche machine) pour le dire AVANT la saisie.
/// Tout compte authentifie : le magasinier qui saisit une sortie n'a pas
/// forcement le module Inventaire, et le gel le concerne. La base refuse de
/// toute facon (INVENTAIRE-OUVERT) ; ceci n'est que l'avertissement.
///
/// L'ETENDUE SELON LE TYPE (2026-10-24a, `v_inventaire_gel`, meme regle que les
/// declencheurs) : `etendue_gel` = MAGASIN (un GLOBAL, ou un tournant / cible
/// encore sans ligne) ou REFERENCES (un TOURNANT ou un CIBLE : ses seules
/// references, dans `references_gelees`).
pub async fn inventaires_ouverts(
    State(state): State<AppState>,
    _user: Utilisateur,
) -> AppResult<Json<Value>> {
    let rows = sqlx::query(
        "SELECT g.id_inventaire, g.numero_inventaire, g.code_magasin, mg.nom AS magasin_nom,
                g.statut, g.type_inventaire, g.date_creation, g.etendue_gel, g.references_gelees
           FROM v_inventaire_gel g
           LEFT JOIN magasin mg ON mg.code_magasin = g.code_magasin
          ORDER BY g.code_magasin",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&rows)))
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
        //
        // LE CONDITIONNEMENT DU LOT (2026-10-24a) : `poids_bobine_kg` et
        // `bobines_par_palette` restent ceux de la fiche article ; ceux du lot
        // de la ligne viennent a cote, et l'ecran convertit au lot, sinon a la
        // fiche (`conditionnementDuLot`) — comme le serveur au comptage.
        "SELECT li.*, r.designation, r.unite_catalogue,
                r.poids_bobine_kg, r.bobines_par_palette,
                lo.poids_bobine_kg::float8 AS poids_bobine_lot_kg,
                lo.bobines_par_palette AS bobines_par_palette_lot,
                r.code_categorie, cat.libelle AS categorie_libelle,
                r.code_famille, r.reference_fournisseur,
                f.nom AS fournisseur_nom
           FROM ligne_inventaire li
           JOIN reference r ON r.code_reference = li.code_reference
           LEFT JOIN categorie_matiere cat ON cat.code_categorie = r.code_categorie
           LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
           LEFT JOIN lot lo ON lo.code_reference = li.code_reference
                           AND lo.lot_fournisseur = li.lot_fournisseur
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
    /// Les kilos comptes (peses). ABSENTS, les bobines comptees les donnent, au
    /// poids d'une bobine DU LOT de la ligne, sinon de la fiche article
    /// (`fn_lot_poids_bobine`, 2026-10-24a) ; sans ce poids, le comptage est
    /// refuse — jamais un facteur 1.
    #[serde(default)]
    pub quantite_comptee_kg: Option<f64>,
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
        // LES KILOS, PESES OU DEDUITS DES BOBINES AU POIDS DU LOT (2026-10-24a).
        // On compte des bobines ; sans pesee, le poids d'une bobine du lot de la
        // ligne (sinon de la fiche article) les convertit. Aucun poids connu : on
        // refuse plutot que de compter une bobine pour un kilo.
        let quantite_kg = match (c.quantite_comptee_kg, c.nb_bobines) {
            (Some(q), _) => q,
            (None, Some(b)) => {
                let poids: Option<f64> = sqlx::query_scalar(
                    "SELECT fn_lot_poids_bobine($1, $2)::float8",
                )
                .bind(&c.code_reference)
                .bind(&c.lot_fournisseur)
                .fetch_one(&mut *tx)
                .await?;
                let poids = poids.filter(|p| *p > 0.0).ok_or_else(|| {
                    AppError::RegleMetier(format!(
                        "{}{} : aucun poids de bobine (ni sur le lot, ni sur la fiche article) — saisissez les kilos comptes.",
                        c.code_reference,
                        c.lot_fournisseur.as_ref().map(|l| format!(" (lot {l})")).unwrap_or_default()
                    ))
                })?;
                b as f64 * poids
            }
            (None, None) => {
                return Err(AppError::Invalide(format!(
                    "{} : saisissez les kilos comptes, ou les bobines.",
                    c.code_reference
                )))
            }
        };
        if quantite_kg < 0.0 || c.nb_bobines.is_some_and(|b| b < 0) {
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
        // instant. Depuis le 23/10/2026 ce que l'inventaire compte est GELE
        // tant qu'il est ouvert (garde en base, 2026-10-23g ; par reference
        // pour un tournant ou un cible, 2026-10-24a) : ce theorique ne bouge
        // plus jusqu'a la cloture.
        let res = sqlx::query(
            "UPDATE ligne_inventaire li
                SET quantite_comptee_kg = $3, motif_ecart = $4, statut_ligne = 'COMPTE',
                    id_utilisateur_comptage = $5, date_comptage = fn_instant($6),
                    nb_bobines_comptees = $9, nb_palettes_comptees = $10,
                    -- Le poids d'une bobine DU LOT, a l'heure du comptage
                    -- (2026-10-24a) : celui qui a converti les bobines.
                    poids_unitaire_theorique_kg = fn_lot_poids_bobine(li.code_reference, li.lot_fournisseur),
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
        .bind(arrondi_kg(quantite_kg))
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
                                 $6, $7, 'COMPTE', $8, fn_instant($9),
                                 COALESCE((SELECT sl.nb_bobines FROM stock_lot sl
                                            WHERE sl.code_reference = $3 AND sl.code_magasin = $4
                                              AND sl.lot_fournisseur = $5), 0),
                                 $10, $11,
                                 fn_lot_poids_bobine($3, $5))",
                    )
                    .bind(uuid::Uuid::new_v4().to_string())
                    .bind(&id)
                    .bind(&c.code_reference)
                    .bind(&c.code_magasin)
                    .bind(lot)
                    .bind(arrondi_kg(quantite_kg))
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
