//! Les inventaires : brouillon, comptage, validation, cloture.
//! Sortis de `stock.rs` le 17/10/2026 (audit B2).

use super::json::lignes_en_json;
use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::db::{arrondi_kg, maintenant};
use crate::domain::numerotation::numeroter;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
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
                  WHERE l.id_inventaire = i.id_inventaire AND l.statut_ligne = 'A_TRAITER') AS nb_a_compter,
                (SELECT COUNT(*) FROM inventaire_reference s WHERE s.id_inventaire = i.id_inventaire) AS nb_references
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
    /// LA LISTE D'UN TOURNANT OU D'UN CIBLE (decision du 23/10/2026,
    /// 2026-10-24b) : les references a compter, validees par cet envoi meme —
    /// pour un tournant, la proposition retouchee a l'ecran. Absente : l'inventaire
    /// nait sans ligne, et gele tout le magasin jusqu'a ce que sa liste soit
    /// validee sur sa page. Refusee pour un global.
    #[serde(default)]
    pub references: Option<Vec<String>>,
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
    // Un TOURNANT ou un CIBLE compte SA LISTE (2026-10-24b) : validee par cet
    // envoi, puis preparee ; sans liste, il attend la sienne (aucune ligne).
    let choisies: Vec<String> = i.references.clone().unwrap_or_default();
    let mut avis_liste: Option<String> = None;
    let n = if i.type_inventaire == "GLOBAL" {
        if choisies.iter().any(|r| !r.trim().is_empty()) {
            return Err(AppError::Invalide(
                "un inventaire global compte tout le magasin : il ne prend pas de liste de références".into(),
            ));
        }
        crate::domain::inventaire::preparer(&mut tx, &id).await?
    } else if choisies.is_empty() {
        avis_liste = Some(format!(
            "L'inventaire {numero} n'a encore aucune référence choisie : tout le magasin est gelé jusqu'à la validation de sa liste, sur sa page."
        ));
        0
    } else {
        crate::domain::inventaire::choisir_references(&mut tx, &user.id, &id, &choisies)
            .await?
            .lignes_a_compter
    };

    // LE MAGASIN EST DESORMAIS GELE (23/10/2026) — tout entier pour un GLOBAL,
    // ses references comptees pour un TOURNANT ou un CIBLE (2026-10-24a) : ce
    // qui etait en route et touche le gel n'entrera plus avant la cloture. On
    // le dit, sans bloquer.
    let mut avis = documents_en_route(&mut tx, &id, &i.code_magasin).await?;
    if let Some(a) = avis_liste {
        avis.insert(0, a);
    }

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
/// encore sans liste, 2026-10-24b) ou REFERENCES (un TOURNANT ou un CIBLE : les
/// references de sa liste, dans `references_gelees`).
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

#[derive(Debug, Deserialize)]
pub struct FiltreCandidats {
    pub magasin: String,
}

/// `GET /api/inventaires/candidats?magasin=…` — LES REFERENCES EN STOCK DANS LE
/// MAGASIN, pour choisir la liste d'un tournant ou d'un cible (decision du
/// 23/10/2026, `v_inventaire_candidat`, 2026-10-24b) : famille, categorie, classe
/// ABC de la fiche (absente : C, `sans_classe`), dernier comptage dans ce magasin,
/// periode de la classe et `du` — la PROPOSITION du tournant. Les periodes des
/// parametres viennent avec, pour que l'ecran dise la regle.
pub async fn candidats_inventaire(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<FiltreCandidats>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::INVENTAIRE, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT c.code_reference, c.designation, c.code_famille, c.famille_libelle,
                c.code_categorie, c.categorie_libelle, c.classe_abc, c.classe_retenue, c.sans_classe,
                c.stock_kg::float8 AS stock_kg, c.dernier_comptage, c.periode_jours, c.jours_depuis, c.du
           FROM v_inventaire_candidat c
          WHERE c.code_magasin = $1
          ORDER BY c.du DESC, c.classe_retenue, c.categorie_libelle NULLS LAST,
                   c.code_famille NULLS LAST, c.code_reference",
    )
    .bind(&f.magasin)
    .fetch_all(&state.db)
    .await?;
    let (a, b, c): (i32, i32, i32) = sqlx::query_as(
        "SELECT fn_comptage_tournant_jours('A'), fn_comptage_tournant_jours('B'), fn_comptage_tournant_jours('C')",
    )
    .fetch_one(&state.db)
    .await?;
    let mut candidats = lignes_en_json(&rows);
    user.masquer(&state.db, module::INVENTAIRE, &mut candidats).await?;
    Ok(Json(json!({
        "periodes": { "A": a, "B": b, "C": c },
        "candidats": candidats,
    })))
}

/// `GET /api/inventaires/{id}/references` — la liste d'un inventaire (2026-10-24b),
/// avec ce qui aide a la relire : designation, famille, classe, stock du magasin,
/// dernier comptage.
pub async fn references_inventaire(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::INVENTAIRE, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT s.code_reference, s.origine, s.classe_abc AS classe_au_choix, s.dernier_comptage AS dernier_au_choix,
                s.date_ajout, u.login AS ajoute_par,
                r.designation, r.code_famille, f.libelle AS famille_libelle,
                r.code_categorie, cat.libelle AS categorie_libelle,
                r.classe_abc, COALESCE(r.classe_abc, 'C') AS classe_retenue, (r.classe_abc IS NULL) AS sans_classe,
                c.stock_kg::float8 AS stock_kg, c.dernier_comptage, c.periode_jours, c.jours_depuis, c.du
           FROM inventaire_reference s
           JOIN inventaire i ON i.id_inventaire = s.id_inventaire
           JOIN reference r ON r.code_reference = s.code_reference
           LEFT JOIN famille f ON f.code_famille = r.code_famille
           LEFT JOIN categorie_matiere cat ON cat.code_categorie = r.code_categorie
           LEFT JOIN utilisateur u ON u.id_utilisateur = s.id_utilisateur
           LEFT JOIN v_inventaire_candidat c ON c.code_magasin = i.code_magasin
                                            AND c.code_reference = s.code_reference
          WHERE s.id_inventaire = $1
          ORDER BY cat.libelle NULLS LAST, r.code_famille NULLS LAST, s.code_reference",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;
    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::INVENTAIRE, &mut valeur).await?;
    Ok(Json(valeur))
}

#[derive(Debug, Deserialize)]
pub struct ListeReferences {
    pub references: Vec<String>,
}

/// `PUT /api/inventaires/{id}/references` — VALIDER LA LISTE d'un tournant ou d'un
/// cible en brouillon, avant ses lignes, puis les preparer (2026-10-24b). La liste
/// remplace la precedente ; une fois les lignes preparees, elle est figee.
pub async fn choisir_references_inventaire(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(l): Json<ListeReferences>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::INVENTAIRE, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let r = crate::domain::inventaire::choisir_references(&mut tx, &user.id, &id, &l.references).await?;
    let magasin: String = sqlx::query_scalar("SELECT code_magasin FROM inventaire WHERE id_inventaire = $1")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    // Ce qui etait en route et touche desormais le gel : un avis, pas un blocage.
    let avis = documents_en_route(&mut tx, &id, &magasin).await?;
    tx.commit().await?;
    Ok(Json(json!({
        "id_inventaire": id,
        "references_choisies": r.references_choisies,
        "lignes_a_compter": r.lignes_a_compter,
        "avis": avis,
    })))
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
                         WHERE l.id_inventaire = i.id_inventaire AND l.id_utilisateur_comptage = $2) AS j_ai_compte,
                (SELECT COUNT(*) FROM inventaire_reference s WHERE s.id_inventaire = i.id_inventaire) AS nb_references,
                us.login AS selection_par
           FROM inventaire i
           LEFT JOIN utilisateur u ON u.id_utilisateur = i.id_utilisateur_responsable
           LEFT JOIN utilisateur v ON v.id_utilisateur = i.id_utilisateur_validation
           LEFT JOIN utilisateur us ON us.id_utilisateur = i.id_utilisateur_selection
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
                -- Le conditionnement DU DERIVE de la ligne (06/11/2026), sinon du lot.
                COALESCE(fn_derive_poids_unitaire(li.code_reference, li.lot_fournisseur, li.code_derive),
                         lo.poids_bobine_kg)::float8 AS poids_bobine_lot_kg,
                COALESCE(fn_derive_unites_palette(li.code_reference, li.lot_fournisseur, li.code_derive),
                         lo.bobines_par_palette) AS bobines_par_palette_lot,
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
    /// Le derive compte (06/11/2026) : obligatoire quand le lot en a plusieurs
    /// (une ligne par derive) ; vide, le derive unique du lot.
    #[serde(default)]
    pub code_derive: Option<String>,
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
        // LE DERIVE COMPTE (06/11/2026) : un lot a plusieurs formes physiques a
        // une ligne par derive ; sans derive, le comptage viserait toutes.
        let derive = c.code_derive.as_deref().map(str::trim).filter(|d| !d.is_empty()).map(str::to_string);
        if derive.is_none() {
            if let Some(lot_c) = c.lot_fournisseur.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
                let n_derives: i64 = sqlx::query_scalar(
                    "SELECT count(*) FROM lot_derive WHERE code_reference = $1 AND lot_fournisseur = $2",
                )
                .bind(&c.code_reference)
                .bind(lot_c)
                .fetch_one(&mut *tx)
                .await?;
                if n_derives > 1 {
                    return Err(AppError::RegleMetier(format!(
                        "DERIVE-REQUIS : le lot {lot_c} de {} a plusieurs conditionnements (dérivés) : \
                         dites lequel vous comptez.",
                        c.code_reference
                    )));
                }
            }
        }
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
                    poids_unitaire_theorique_kg = fn_derive_poids_unitaire(li.code_reference, li.lot_fournisseur, li.code_derive),
                    quantite_theorique_kg = CASE
                        WHEN li.lot_fournisseur IS NULL THEN
                            COALESCE((SELECT sm.quantite_kg FROM stock_magasin sm
                                       WHERE sm.code_reference = li.code_reference
                                         AND sm.code_magasin = li.code_magasin), 0)
                        ELSE
                            COALESCE((SELECT sl.quantite_kg FROM v_stock_lot_derive sl
                                       WHERE sl.code_reference = li.code_reference
                                         AND sl.code_magasin = li.code_magasin
                                         AND sl.lot_fournisseur = li.lot_fournisseur
                                         AND COALESCE(sl.code_derive, 'D1') = COALESCE(li.code_derive, 'D1')), 0)
                        END,
                    nb_bobines_theorique = CASE
                        WHEN li.lot_fournisseur IS NULL THEN
                            (SELECT sm.nb_bobines FROM stock_magasin sm
                              WHERE sm.code_reference = li.code_reference
                                AND sm.code_magasin = li.code_magasin)
                        ELSE
                            (SELECT sl.nb_bobines FROM v_stock_lot_derive sl
                              WHERE sl.code_reference = li.code_reference
                                AND sl.code_magasin = li.code_magasin
                                AND sl.lot_fournisseur = li.lot_fournisseur
                                AND COALESCE(sl.code_derive, 'D1') = COALESCE(li.code_derive, 'D1'))
                        END
              WHERE id_inventaire = $1 AND code_reference = $2 AND code_magasin = $7
                -- `IS $8` etait du SQLite : PostgreSQL le refuse, et chaque saisie
                -- de comptage tombait en erreur interne.
                AND lot_fournisseur IS NOT DISTINCT FROM $8
                -- Le derive compte (06/11/2026) ; vide, le seul du lot (garde plus haut).
                AND ($11::text IS NULL OR COALESCE(li.code_derive, 'D1') = $11)",
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
        .bind(&derive)
        .execute(&mut *tx)
        .await?;

        // UN LOT TROUVE AU COMPTAGE (01/10/2026). Le rayon porte un lot que la
        // base ne connait pas — c'est ainsi que le stock « sans lot » se
        // repartit entre de vrais lots. On ouvre sa ligne, theorique zero ; la
        // cloture l'ajuste comme les autres, et le lot entre au stock par lot.
        // Seulement pour une reference suivie, dans le magasin de l'inventaire.
        let lot_saisi = c.lot_fournisseur.as_deref().map(str::trim).filter(|l| !l.is_empty());
        // UNE REFERENCE HORS DE LA LISTE d'un tournant ou d'un cible (2026-10-24b) :
        // refusee, dite clairement — l'inventaire ne compte que ce qu'il a choisi.
        // La base le garde aussi (INV-SELECTION sur `ligne_inventaire`).
        if res.rows_affected() == 0 {
            let hors_liste: Option<(String, String)> = sqlx::query_as(
                "SELECT i.numero_inventaire, i.type_inventaire FROM inventaire i
                  WHERE i.id_inventaire = $1 AND i.type_inventaire IN ('TOURNANT', 'CIBLE')
                    AND NOT EXISTS (SELECT 1 FROM inventaire_reference s
                                     WHERE s.id_inventaire = i.id_inventaire AND s.code_reference = $2)",
            )
            .bind(&id)
            .bind(&c.code_reference)
            .fetch_optional(&mut *tx)
            .await?;
            if let Some((numero, type_inv)) = hors_liste {
                return Err(AppError::RegleMetier(format!(
                    "INV-SELECTION : la référence {} n'est pas dans la liste de l'inventaire {numero} ({}) : il ne compte que les références choisies. Comptez-la dans un autre inventaire.",
                    c.code_reference,
                    if type_inv == "TOURNANT" { "tournant" } else { "ciblé" }
                )));
            }
        }
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
                              nb_bobines_comptees, nb_palettes_comptees, poids_unitaire_theorique_kg,
                              code_derive)
                         VALUES ($1, $2, $3, $4, $5,
                                 COALESCE((SELECT sl.quantite_kg FROM v_stock_lot_derive sl
                                            WHERE sl.code_reference = $3 AND sl.code_magasin = $4
                                              AND sl.lot_fournisseur = $5
                                              AND COALESCE(sl.code_derive, 'D1') = COALESCE($12, 'D1')), 0),
                                 $6, $7, 'COMPTE', $8, fn_instant($9),
                                 COALESCE((SELECT sl.nb_bobines FROM v_stock_lot_derive sl
                                            WHERE sl.code_reference = $3 AND sl.code_magasin = $4
                                              AND sl.lot_fournisseur = $5
                                              AND COALESCE(sl.code_derive, 'D1') = COALESCE($12, 'D1')), 0),
                                 $10, $11,
                                 fn_derive_poids_unitaire($3, $5, $12), $12)",
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
                    .bind(&derive)
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
