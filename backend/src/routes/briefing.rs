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

    // L'ETAT DES REFERENCES ET LES CONTROLES QUI EN DEPENDENT VIENNENT DU MOTEUR DE
    // COUVERTURE (27/10/2026). Un echec de lecture se tait, comme `compter`.
    let etats = if peut(module::COCKPIT) || peut(module::STOCK) {
        super::couverture::etats(db).await.ok()
    } else {
        None
    };

    if peut(module::COCKPIT) {
        let controles = match &etats {
            Some(e) => super::couverture::tous_les_controles(db, e).await.unwrap_or_default(),
            None => Vec::new(),
        };
        let en_anomalie = |c: &&Value| c["anomalies"].as_i64().unwrap_or(0) > 0;
        let n = controles.iter().filter(en_anomalie).count() as i64;
        if n > 0 {
            let bloquants =
                controles.iter().filter(en_anomalie).filter(|c| c["criticite"] == "BLOQUANT").count() as i64;
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

    if let (true, Some(e)) = (peut(module::STOCK), &etats) {
        let c = e.compteurs();
        let inevitable = c["nb_rupture_inevitable"].as_i64().unwrap_or(0);
        let aujourdhui = c["nb_a_commander_aujourdhui"].as_i64().unwrap_or(0);
        if inevitable > 0 {
            points.push(point(
                "stock",
                "référence(s) en rupture inévitable (avant aujourd'hui + délai)",
                inevitable,
                "danger",
                "/stock",
                &if aujourdhui > 0 { format!("{aujourdhui} à commander aujourd'hui") } else { String::new() },
            ));
        } else if aujourdhui > 0 {
            points.push(point("stock", "référence(s) à commander aujourd'hui", aujourdhui, "alerte", "/plan-achat", ""));
        }
    }

    if peut(module::PLAN_ACHAT) {
        // Les propositions ouvertes, faites par le moteur (27/10/2026).
        let n = compter(
            db,
            "SELECT count(*) FROM plan_achat WHERE statut IN ('PROPOSE', 'EN_REVISION', 'VALIDE')",
        )
        .await;
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
        // Regle 18 : un taux de reference de plus de P_AncienneteTauxJours
        // bloque la validation des bons dans cette devise. On le dit avant.
        let perimes = compter(
            db,
            "SELECT count(DISTINCT t.code_devise) FROM taux_change t
              WHERE t.code_devise <> 'MAD' AND t.date_fin IS NULL
                AND substr(t.date_debut, 1, 10)::date
                    < current_date - COALESCE((SELECT CAST(valeur_courante AS integer) FROM parametre
                                                WHERE code_parametre = 'P_AncienneteTauxJours'), 7)
                AND NOT EXISTS (SELECT 1 FROM taux_change t2
                                 WHERE t2.code_devise = t.code_devise AND t2.date_debut > t.date_debut)",
        )
        .await;
        if perimes > 0 {
            points.push(point("taux_perimes", "taux de change à mettre à jour", perimes, "alerte",
                              "/configuration", "plus de 7 jours : les bons en devise ne se valident pas"));
        }
        let n = compter(
            db,
            "SELECT count(*) FROM bon_commande
              WHERE statut IN ('ENVOYE','LIVRE_PARTIEL')
                AND date_livraison_prevue IS NOT NULL
                AND date_livraison_prevue < current_date",
        )
        .await;
        if n > 0 {
            points.push(point("bons_retard", "bon(s) de commande en retard", n, "alerte",
                              "/bons-commande", "livraison prévue dépassée"));
        }
    }

    if peut(module::RECEPTIONS) {
        let n = compter(db, "SELECT count(*) FROM import_receptions WHERE statut IN ('BROUILLON','A_CONTROLER')").await;
        if n > 0 {
            points.push(point("receptions_import", "réception(s) d'import pas encore en stock", n,
                              "alerte", "/receptions-import", "à soumettre ou à contrôler"));
        }
        let locales = compter(
            db,
            // Les statuts locaux sont VALIDE et ANNULE : « NOT IN VALIDEE » comptait
            // toutes les receptions validees comme « en cours ».
            "SELECT count(*) FROM reception WHERE statut IN ('BROUILLON','A_CONTROLER')",
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
                         WHERE f.id_dossier = d.id_dossier AND r.statut IN ('BROUILLON','A_CONTROLER'))",
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
