//! LE BRIEFING DE CONNEXION — ce que l'assistant dit en ouvrant la journee.
//!
//! Il ne raconte pas l'etat du monde : il dit CE QUI ATTEND CELUI QUI SE
//! CONNECTE, et rien d'autre. Un magasinier n'a que faire du budget d'achat ;
//! la direction n'a pas besoin qu'on lui rappelle une pesee.
//!
//! CHAQUE POINT EST FILTRE PAR LES DROITS, et chacun porte l'adresse de
//! l'ecran ou l'on agit : un briefing qui annonce un probleme sans dire ou le
//! traiter fait perdre le temps qu'il pretend gagner.
//!
//! AUCUN MODELE DE LANGAGE ICI. Le briefing doit s'afficher en moins d'une
//! seconde, a chaque connexion, meme quand le moteur local est arrete. Ce sont
//! des comptes, pas une conversation — l'assistant qui discute, lui, est dans
//! `/api/chat`.

use crate::auth::{rbac::module, Utilisateur};
use crate::error::AppResult;
use crate::AppState;
use axum::extract::State;
use axum::Json;
use serde_json::{json, Value};
use std::collections::HashSet;

/// Un point du briefing.
fn point(cle: &str, titre: &str, nombre: i64, ton: &str, chemin: &str, detail: &str) -> Value {
    json!({ "cle": cle, "titre": titre, "nombre": nombre, "ton": ton,
            "chemin": chemin, "detail": detail })
}

async fn compter(db: &crate::db::Db, sql: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(sql).fetch_one(db).await.unwrap_or(0)
}

/// `GET /api/briefing` — ce qui attend l'utilisateur, maintenant.
pub async fn briefing(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    let db = &state.db;

    // Les modules que cet utilisateur peut LIRE : un point qu'il ne pourrait
    // pas ouvrir n'a pas a lui etre montre.
    let modules: HashSet<String> = sqlx::query_scalar(
        "SELECT p.module FROM permission p
           JOIN utilisateur u ON u.code_role_user = p.code_role_user
          WHERE u.id_utilisateur = $1 AND p.action = 'LIRE'",
    )
    .bind(&user.id)
    .fetch_all(db)
    .await?
    .into_iter()
    .collect();
    let peut = |m: &str| modules.contains(m);

    let mut points: Vec<Value> = Vec::new();

    if peut(module::COCKPIT) {
        let n = compter(db, "SELECT count(*) FROM v_controles WHERE anomalies > 0").await;
        if n > 0 {
            let bloquants = compter(
                db,
                "SELECT count(*) FROM v_controles WHERE anomalies > 0 AND criticite = 'BLOQUANT'",
            )
            .await;
            points.push(point(
                "controles",
                "contrôle(s) de cohérence en anomalie",
                n,
                if bloquants > 0 { "danger" } else { "alerte" },
                "/controles",
                if bloquants > 0 { "dont des anomalies bloquantes" } else { "" },
            ));
        }
    }

    if peut(module::STOCK) {
        let n = compter(
            db,
            "SELECT count(*) FROM v_stock_projete WHERE statut IN ('RUPTURE','CRITIQUE')",
        )
        .await;
        if n > 0 {
            let ruptures =
                compter(db, "SELECT count(*) FROM v_stock_projete WHERE statut = 'RUPTURE'").await;
            points.push(point(
                "stock",
                "référence(s) en rupture ou critique",
                n,
                if ruptures > 0 { "danger" } else { "alerte" },
                "/stock",
                &if ruptures > 0 { format!("{ruptures} en rupture") } else { String::new() },
            ));
        }
    }

    if peut(module::PLAN_ACHAT) {
        let n = compter(db, "SELECT count(*) FROM v_plan_achat").await;
        if n > 0 {
            points.push(point(
                "plan_achat",
                "proposition(s) d'achat à arbitrer",
                n,
                "info",
                "/plan-achat",
                "",
            ));
        }
    }

    if peut(module::BONS_COMMANDE) {
        let n = compter(
            db,
            "SELECT count(*) FROM bon_commande
              WHERE statut IN ('ENVOYE','LIVRE_PARTIEL')
                AND date_livraison_prevue IS NOT NULL
                AND date_livraison_prevue < to_char(current_date, 'YYYY-MM-DD')",
        )
        .await;
        if n > 0 {
            points.push(point("bons_retard", "bon(s) de commande en retard", n, "alerte",
                              "/bons-commande", "livraison prévue dépassée"));
        }
    }

    if peut(module::RECEPTIONS) {
        let n = compter(db, "SELECT count(*) FROM import_receptions WHERE statut = 'BROUILLON'").await;
        if n > 0 {
            points.push(point("receptions_import", "réception(s) d'import en brouillon", n,
                              "alerte", "/receptions-import", "à valider pour entrer en stock"));
        }
        let locales = compter(
            db,
            "SELECT count(*) FROM reception WHERE statut NOT IN ('VALIDEE','ANNULEE')",
        )
        .await;
        if locales > 0 {
            points.push(point("receptions", "réception(s) en cours", locales, "info",
                              "/receptions", ""));
        }
    }

    if peut(module::IMPORT) {
        let n = compter(db, "SELECT count(*) FROM import_dossiers WHERE statut = 'EN_COURS'").await;
        if n > 0 {
            // Pret a cloturer : plus rien a recevoir au-dela de la tolerance, et
            // aucune reception en brouillon sur ses lignes.
            let prets = compter(
                db,
                "SELECT count(*) FROM import_dossiers d
                  WHERE d.statut = 'EN_COURS'
                    AND NOT EXISTS (
                        SELECT 1 FROM import_facture_lignes l
                          JOIN import_factures f ON f.id_facture = l.id_facture
                         WHERE f.id_dossier = d.id_dossier AND l.type_ligne = 'ERP'
                           AND l.soldee = 0 AND l.reste_kg > l.poids_net_kg * 2 / 100.0 + 0.001)
                    AND NOT EXISTS (
                        SELECT 1 FROM import_receptions r
                          JOIN import_reception_lignes rl ON rl.id_reception = r.id_reception
                          JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
                          JOIN import_factures f ON f.id_facture = l.id_facture
                         WHERE f.id_dossier = d.id_dossier AND r.statut = 'BROUILLON')",
            )
            .await;
            points.push(point(
                "dossiers_import",
                "dossier(s) d'import en cours",
                n,
                if prets > 0 { "succes" } else { "info" },
                "/import",
                &if prets > 0 { format!("{prets} prêt(s) à clôturer") } else { String::new() },
            ));
        }
    }

    if peut(module::INVENTAIRE) {
        let n = compter(
            db,
            "SELECT count(*) FROM inventaire WHERE statut NOT IN ('CLOTURE','ANNULE')",
        )
        .await;
        if n > 0 {
            points.push(point("inventaires", "inventaire(s) ouvert(s)", n, "info", "/inventaires", ""));
        }
    }

    Ok(Json(json!({
        "utilisateur": user.login,
        "role": user.role,
        "points": points,
    })))
}
