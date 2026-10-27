//! Endpoints de consultation.
//!
//! Chaque handler suit le meme contrat :
//!   1. verifier la permission de LECTURE sur le module (CDC D2) ;
//!   2. executer la vue ;
//!   3. retirer les champs interdits a ce role (CDC B4 regle 1).
//!
//! Le masquage est applique a la SORTIE plutot que par une projection SQL par
//! endpoint : une seule regle, impossible a oublier sur un champ.

use super::json::lignes_en_json;
use crate::auth::{rbac, rbac::Action, rbac::module, Utilisateur};
use crate::error::{AppError, AppResult};
use crate::db::arrondi_kg;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct Filtres {
    pub limite: Option<i64>,
    pub statut: Option<String>,
    pub code_reference: Option<String>,
    /// LE MAGASIN, qui etait recu et IGNORE.
    ///
    /// L'ecran de transfert demandait le stock d'un magasin precis ; la requete
    /// ne filtrait que sur la reference. Il recevait donc le stock de TOUS les
    /// magasins et l'additionnait : « disponible » annoncait un total que le
    /// magasin source ne detenait pas. On pouvait preparer un transfert de cinq
    /// tonnes depuis un magasin qui en tenait une, et seule la regle R02 le
    /// refusait — a l'expedition, une fois tout saisi.
    pub code_magasin: Option<String>,
    /// LA RECEPTION, pour les frais d'approche d'un arrivage.
    ///
    /// Ils se filtraient par `code_reference`, qui portait en fait un
    /// identifiant de reception : le nom mentait, et un appelant de bonne foi
    /// y mettait une reference et recevait tout. Le nom juste existe
    /// maintenant ; l'ancien reste accepte, des paquets deployes l'utilisent.
    pub id_reception: Option<String>,
}

impl Filtres {
    fn limite(&self) -> i64 {
        self.limite.unwrap_or(500).clamp(1, 5000)
    }
}

pub async fn sante(State(state): State<AppState>) -> AppResult<Json<Value>> {
    let tables: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "statut": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "tables": tables,
    })))
}

/// Execute une requete sans parametre, applique le masquage et renvoie du JSON.
async fn lister(
    state: &AppState,
    user: &Utilisateur,
    module: &str,
    sql: &str,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module, Action::Lire).await?;
    let rows = sqlx::query(sql).fetch_all(&state.db).await?;
    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Le poste de travail : l'ETAT du stock et les FILES d'attente en un objet.
///
/// Les deux vues repondent a des questions differentes — « ou en est-on » et
/// « qui doit faire quoi ». Les fusionner ici evite deux allers-retours au
/// chargement de l'ecran d'accueil, qui est le plus consulte de l'application.
///
/// Le masquage par champ s'applique a l'ensemble : un compteur non declare dans
/// `champ_configurable` disparait, et c'est voulu — un chiffre qu'on n'a pas le
/// droit de voir ne doit pas transiter, meme grise.
pub async fn cockpit(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::COCKPIT, Action::Lire).await?;

    // L'ETAT DES REFERENCES VIENT DU MOTEUR DE COUVERTURE (27/10/2026) : plan non
    // couvert, sous la securite, couvert, a commander aujourd'hui, classe A au plan
    // non couvert. Le reste (valeur, bons, alertes, fraicheur du plan) se lit en
    // SQL ; « a commander » = les propositions ouvertes, que le moteur a faites.
    let etats = super::couverture::etats(&state.db).await?;
    let etat = sqlx::query(
        "SELECT
            (SELECT max(fn_iso(date_calcul)) FROM besoin_mrp)                       AS besoins_calcules_le,
            (SELECT count(*) FROM plan_production pp
              WHERE pp.statut = 'EN_COURS' AND fn_besoins_perimes(pp.id_plan))     AS besoins_perimes,
            (SELECT round(COALESCE(sum(valeur_mad), 0), 2) FROM stock_magasin)
              + (SELECT COALESCE(sum(valeur_mad), 0) FROM v_stock_transit)          AS valeur_stock_mad,
            (SELECT count(*) FROM plan_achat
              WHERE statut IN ('PROPOSE', 'EN_REVISION', 'VALIDE'))                 AS nb_refs_a_commander,
            (SELECT round(COALESCE(sum(COALESCE(montant_total_mad,
                                                quantite_suggeree_kg * prix_estime_mad)), 0), 2)
               FROM plan_achat WHERE statut IN ('PROPOSE', 'EN_REVISION', 'VALIDE')) AS budget_a_engager_mad,
            (SELECT count(*) FROM plan_achat
              WHERE statut IN ('PROPOSE', 'EN_REVISION', 'VALIDE') AND urgence = 'TIER 1') AS nb_tier1,
            (SELECT count(*) FROM fournisseur WHERE actif = 1)                      AS nb_fournisseurs_actifs,
            (SELECT count(*) FROM bon_commande
              WHERE statut IN ('VALIDE', 'ENVOYE', 'LIVRE_PARTIEL'))                AS nb_bc_ouverts,
            (SELECT round(COALESCE(sum(montant_total_mad), 0), 2) FROM bon_commande
              WHERE statut IN ('VALIDE', 'ENVOYE', 'LIVRE_PARTIEL'))                AS montant_bc_ouverts_mad,
            (SELECT count(*) FROM alerte
              WHERE statut = 'OUVERTE' AND gravite IN ('CRITIQUE', 'BLOQUANT'))      AS nb_alertes_critiques",
    )
    .fetch_all(&state.db)
    .await?;
    let files = sqlx::query("SELECT * FROM v_cockpit_files")
        .fetch_all(&state.db)
        .await?;

    let mut valeur = lignes_en_json(&etat)
        .as_array()
        .and_then(|a| a.first().cloned())
        .unwrap_or(Value::Null);
    if let (Some(objet), Some(compteurs)) = (valeur.as_object_mut(), etats.compteurs().as_object()) {
        for (cle, v) in compteurs {
            objet.insert(cle.clone(), v.clone());
        }
    }
    // Les controles du moteur (C05, C25) comptent avec ceux de v_controles.
    let moteur = super::couverture::controles_moteur(&state.db, &etats).await?;
    let compter_moteur = |criticite: &str| {
        moteur
            .iter()
            .filter(|c| c["criticite"] == criticite && c["anomalies"].as_i64().unwrap_or(0) > 0)
            .count() as i64
    };

    if let (Some(objet), Some(f)) = (
        valeur.as_object_mut(),
        lignes_en_json(&files).as_array().and_then(|a| a.first().cloned()),
    ) {
        if let Some(champs) = f.as_object() {
            for (cle, v) in champs {
                objet.insert(cle.clone(), v.clone());
            }
        }
        for (cle, criticite) in [("nb_controles_critiques", "CRITIQUE"), ("nb_controles_bloquants", "BLOQUANT")] {
            let n = objet.get(cle).and_then(Value::as_i64).unwrap_or(0) + compter_moteur(criticite);
            objet.insert(cle.into(), json!(n));
        }
        // La part de l'import dans « a controler » : la tuile mene aux deux
        // listes, chacune avec son compte (audit v5, F20).
        let import: i64 =
            sqlx::query_scalar("SELECT count(*) FROM import_receptions WHERE statut = 'A_CONTROLER'")
                .fetch_one(&state.db)
                .await?;
        objet.insert("nb_receptions_import_a_controler".into(), json!(import));
    }

    user.masquer(&state.db, module::COCKPIT, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Le mur de risques : les references qui ne tiennent pas les 12 mois a venir.
///
/// Renvoie une ligne par reference a risque, chacune portant sa frise mensuelle.
/// L'ordre est celui de la MARGE DE DECISION — le nombre de jours restants avant
/// le premier mois tendu, delai fournisseur deduit. Trier par gravite du manque
/// mettrait en tete des ruptures lointaines qu'on a tout le temps de couvrir,
/// et enterrerait la tension de le mois prochain sur laquelle il faut agir
/// aujourd'hui.
pub async fn risques_rupture(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::COCKPIT, Action::Lire).await?;

    // LA FRISE EST CELLE DU MOTEUR DE COUVERTURE (27/10/2026) : ses jours,
    // regroupes par mois — plan du mois, arrivages comptes, solde en fin de mois,
    // securite ; un mois est PLAN_NON_COUVERT si une part de son plan n'est pas
    // couverte, SOUS_SECURITE si le solde passe sous la securite. La MARGE DE
    // DECISION est le temps qui reste avant la date limite de commande de la
    // premiere proposition (negative : deja depassee) ; sans proposition, avant le
    // premier passage sous la securite, delai deduit.
    let etats = super::couverture::etats(&state.db).await?;
    let auj = etats.aujourdhui;
    let mut risques: Vec<(i64, u8, i64, Value)> = Vec::new();
    for e in etats.suivies().filter(|e| e.en_tension()) {
        let nb_rupture = e.mois.iter().filter(|m| m.statut == super::couverture::statut::PLAN_NON_COUVERT).count();
        let nb_tendu = e.mois.iter().filter(|m| m.statut == super::couverture::statut::SOUS_SECURITE).count();
        let premier_rupture = e
            .mois
            .iter()
            .find(|m| m.statut == super::couverture::statut::PLAN_NON_COUVERT)
            .map(|m| m.annee_mois.clone());
        let premier_risque = e.mois.iter().find(|m| m.statut != super::couverture::statut::COUVERT);
        let marge = match (e.date_limite_commande, e.premier_passage_securite) {
            (Some(limite), _) => Some((limite - auj).num_days()),
            (None, Some(sous)) => Some((sous - auj).num_days() - e.delai_j),
            (None, None) => None,
        };
        let rang_classe = match e.classe_abc.as_deref().map(str::trim) {
            Some("A") => 0,
            Some("B") => 1,
            _ => 2,
        };
        let mut o = json!({
            "code_reference": e.code_reference,
            "designation": e.designation,
            "classe_abc": e.classe_abc,
            "code_fournisseur": e.code_fournisseur,
            "fournisseur_nom": e.fournisseur_nom,
            "delai_livraison_jours": e.delai_j,
            "stock_initial_kg": e.disponible_kg,
            "stock_min_kg": e.mois.first().map(|m| m.securite_kg),
            "nb_mois_rupture": nb_rupture,
            "nb_mois_tendu": nb_tendu,
            "premier_mois_rupture": premier_rupture,
            "premier_mois_risque": premier_risque.map(|m| m.annee_mois.clone()),
            "rang_premier_risque": premier_risque.map(|m| m.rang_mois),
            "marge_decision_jours": marge,
            "mois": super::couverture::frise_json(e),
        });
        if let Some(m) = o.as_object_mut() {
            m.extend(e.colonnes());
        }
        risques.push((marge.unwrap_or(i64::MAX), rang_classe, -(nb_rupture as i64), o));
    }
    risques.sort_by(|a, b| (a.0, a.1, a.2).cmp(&(b.0, b.1, b.2)));
    risques.truncate(60);
    let mut liste = Value::Array(risques.into_iter().map(|(_, _, _, v)| v).collect());

    // Le sourcing et l'equivalent disponible, pour les seules references retenues.
    let codes: Vec<String> = liste
        .as_array()
        .map(|a| a.iter().filter_map(|r| r["code_reference"].as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    if !codes.is_empty() {
        let complements = lignes_en_json(
            &sqlx::query(
                "SELECT c.code_reference,
                        CASE WHEN EXISTS (
                               SELECT 1 FROM reference_groupe_equiv rge1
                                 JOIN reference_groupe_equiv rge2 ON rge2.code_groupe_equiv = rge1.code_groupe_equiv
                                                                 AND rge2.code_reference <> rge1.code_reference
                                                                 AND rge2.actif = 1
                                 JOIN reference r2 ON r2.code_reference = rge2.code_reference AND r2.actif = 1
                                 JOIN reference r1 ON r1.code_reference = rge1.code_reference
                                WHERE rge1.code_reference = c.code_reference AND rge1.actif = 1
                                  AND r2.code_fournisseur IS DISTINCT FROM r1.code_fournisseur)
                             THEN 'MULTI-SOURCE' ELSE 'MONO-SOURCE' END AS risque_sourcing,
                        (SELECT round(COALESCE(max(e.equivalent_stock_kg), 0), 3) FROM v_equivalence e
                          WHERE e.code_reference = c.code_reference AND e.interchangeable = 1)::float8
                          AS equivalent_dispo_kg,
                        (SELECT e.equivalent_reference FROM v_equivalence e
                          WHERE e.code_reference = c.code_reference AND e.interchangeable = 1
                          ORDER BY e.equivalent_stock_kg DESC LIMIT 1) AS equivalent_reference
                   FROM unnest($1::text[]) AS c(code_reference)",
            )
            .bind(&codes)
            .fetch_all(&state.db)
            .await?,
        );
        if let (Some(tableau), Some(complements)) = (liste.as_array_mut(), complements.as_array()) {
            for r in tableau.iter_mut() {
                let code = r["code_reference"].as_str().unwrap_or_default().to_string();
                if let (Some(o), Some(c)) = (
                    r.as_object_mut(),
                    complements.iter().find(|c| c["code_reference"].as_str() == Some(&code)),
                ) {
                    for cle in ["risque_sourcing", "equivalent_dispo_kg", "equivalent_reference"] {
                        o.insert(cle.into(), c[cle].clone());
                    }
                }
            }
        }
    }

    user.masquer(&state.db, module::COCKPIT, &mut liste).await?;
    Ok(Json(liste))
}

/// Assemble plusieurs requetes en un objet, masque sous UN SEUL module.
///
/// Les statistiques d'une famille tiennent rarement en une table : un cumul et
/// sa serie mensuelle repondent a la meme question et se lisent ensemble. Les
/// servir en un appel evite que l'ecran s'affiche en deux temps.
async fn dossier(
    state: &AppState,
    user: &Utilisateur,
    module: &str,
    volets: &[(&str, &str)],
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module, Action::Lire).await?;
    let mut sortie = serde_json::Map::new();
    for (nom, sql) in volets {
        let rows = sqlx::query(sql).fetch_all(&state.db).await?;
        let mut v = lignes_en_json(&rows);
        user.masquer(&state.db, module, &mut v).await?;
        sortie.insert((*nom).to_string(), v);
    }
    Ok(Json(Value::Object(sortie)))
}

/// Statistiques de MOUVEMENTS : le flux mensuel, et ce qui bouge par reference.
pub async fn stats_mouvements(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    dossier(
        &state,
        &user,
        module::MOUVEMENTS,
        &[
            (
                "mois",
                "SELECT * FROM v_stat_mouvement_mois ORDER BY annee_mois, code_type_mvt",
            ),
            // Les references sans mouvement sont ramenees aussi : une matiere
            // qui n'a jamais bouge est precisement ce qu'on cherche a reperer.
            (
                "references",
                "SELECT * FROM v_stat_mouvement_reference
                  ORDER BY (entrees_kg + sorties_kg) DESC LIMIT 200",
            ),
        ],
    )
    .await
}

/// Statistiques par FAMILLE : la forme que les classeurs tiennent depuis
/// toujours — une feuille par famille, les couleurs en colonnes.
///
/// L'atelier ne raisonne pas par reference mais par famille : on ne demande pas
/// « combien de PP-1500 Dtex-Bleu 6666-Hs », on demande « combien de 1500 dtex,
/// et de quelle couleur ».
///
/// TROIS JEUX, TROIS LECTURES. Les familles pour le poids de chacune ; le
/// croisement famille x couleur, qui est la feuille du classeur ; les
/// categories, pour la lecture de direction.
pub async fn stats_familles(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    dossier(
        &state,
        &user,
        module::MOUVEMENTS,
        &[
            // Les familles sans mouvement remontent aussi : une famille qui
            // dort est precisement ce qu'on cherche a reperer.
            (
                "familles",
                "SELECT * FROM v_stat_famille
                  ORDER BY COALESCE(entrees_kg, 0) DESC, stock_kg DESC, famille_libelle",
            ),
            (
                "croisement",
                "SELECT * FROM v_stat_famille_couleur
                  ORDER BY annee DESC, entrees_kg DESC",
            ),
            (
                "categories",
                "SELECT * FROM v_stat_categorie ORDER BY stock_kg DESC, categorie_libelle",
            ),
        ],
    )
    .await
}

/// Statistiques de PRIX d'achat : serie mensuelle et derive decomposee.
pub async fn stats_prix(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    dossier(
        &state,
        &user,
        module::VALORISATION,
        &[
            (
                "mois",
                "SELECT * FROM v_stat_prix_mois ORDER BY code_reference, annee_mois",
            ),
            // Tri par IMPACT en dirhams, pas par pourcentage : +40 % sur une
            // matiere achetee une fois pese moins qu'un +3 % sur le fil de
            // chaine, et c'est le second qu'il faut renegocier.
            (
                "references",
                "SELECT * FROM v_stat_prix_reference
                  ORDER BY ABS(COALESCE(impact_fournisseur_mad, 0)) DESC LIMIT 200",
            ),
        ],
    )
    .await
}

/// Statistiques FOURNISSEURS : la fiche de performance et sa tendance mensuelle.
pub async fn stats_fournisseurs(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    dossier(
        &state,
        &user,
        module::FOURNISSEURS,
        &[
            (
                "scorecard",
                "SELECT * FROM v_fournisseur_scorecard ORDER BY montant_total_mad DESC",
            ),
            (
                "mois",
                "SELECT * FROM v_stat_fournisseur_mois ORDER BY annee_mois, code_fournisseur",
            ),
        ],
    )
    .await
}

/// Statistiques QUALITES : cout matiere au m2, ventilation par role, realisation.
pub async fn stats_qualites(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    dossier(
        &state,
        &user,
        module::QUALITES,
        &[
            (
                "qualites",
                "SELECT * FROM v_stat_qualite ORDER BY cout_matiere_m2_mad DESC",
            ),
            (
                "roles",
                "SELECT * FROM v_stat_qualite_role ORDER BY code_qualite, cout_m2_mad DESC",
            ),
        ],
    )
    .await
}

/// Les equivalents d'une reference, les membres d'un groupe, ou tout.
///
/// Distincte de `/api/substitutions`, qui ne repond qu'a « ou une rupture est
/// elle couvrable tout de suite ». Ici on interroge le referentiel lui-meme :
/// au moment de commander, de receptionner ou de sortir de la matiere, il faut
/// connaitre les equivalents AVANT que la situation ne se degrade.
pub async fn equivalences(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(q): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::CATALOGUE, Action::Lire).await?;

    let reference = q.get("code_reference").filter(|v| !v.is_empty()).cloned();
    let groupe = q.get("code_groupe_equiv").filter(|v| !v.is_empty()).cloned();

    let rows = sqlx::query(
        "SELECT * FROM v_equivalence
          WHERE ($1 IS NULL OR code_reference     = $1)
            AND ($2 IS NULL OR code_groupe_equiv  = $2)
          ORDER BY code_groupe_equiv, priorite, equivalent_priorite",
    )
    .bind(&reference)
    .bind(&groupe)
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    // L'ETAT DE CHAQUE COTE VIENT DU MOTEUR (27/10/2026) : `statut` pour la
    // reference, `equivalent_statut` pour son equivalent.
    let etats = super::couverture::etats(&state.db).await?;
    if let Some(a) = valeur.as_array_mut() {
        for l in a.iter_mut() {
            let s1 = l["code_reference"].as_str().and_then(|c| etats.get(c)).map(|e| e.statut);
            let s2 = l["equivalent_reference"].as_str().and_then(|c| etats.get(c)).map(|e| e.statut);
            if let Some(o) = l.as_object_mut() {
                o.insert("statut".into(), json!(s1));
                o.insert("equivalent_statut".into(), json!(s2));
            }
        }
    }
    user.masquer(&state.db, module::CATALOGUE, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Les groupes d'equivalence, avec ce qui les qualifie.
pub async fn groupes_equivalence(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    lister(
        &state,
        &user,
        module::CATALOGUE,
        "SELECT * FROM v_groupe_equiv_detail ORDER BY code_groupe_equiv",
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct OrdreGroupe {
    /// Les references du groupe, dans l'ordre de priorite voulu. La premiere
    /// devient preferentielle.
    pub references: Vec<String>,
}

/// Reordonne les references d'un groupe, EN UNE TRANSACTION.
///
/// `ux_grp_equiv_prio` (une seule priorite N par groupe actif) et
/// `ux_grp_equiv_pref` (une seule preferentielle) sont des index UNIQUE
/// partiels : reaffecter les priorites une par une echoue des la premiere
/// collision, sur un message de contrainte que personne ne peut interpreter.
///
/// On passe donc par des valeurs temporaires hors d'atteinte avant d'ecrire
/// l'ordre final. Le detour est laid, mais c'est lui qui rend l'operation
/// possible sans lever les index — et ces index sont ce qui garantit qu'un
/// groupe n'a jamais deux preferentielles.
pub async fn reordonner_groupe(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code_groupe): Path<String>,
    Json(o): Json<OrdreGroupe>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::CATALOGUE, Action::Ecrire).await?;
    if o.references.is_empty() {
        return Err(AppError::Invalide(
            "aucune reference dans l'ordre demande".into(),
        ));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let membres: Vec<String> = sqlx::query_scalar(
        "SELECT code_reference FROM reference_groupe_equiv
          WHERE code_groupe_equiv = $1 AND actif = 1",
    )
    .bind(&code_groupe)
    .fetch_all(&mut *tx)
    .await?;

    if membres.len() != o.references.len() || o.references.iter().any(|r| !membres.contains(r)) {
        return Err(AppError::Invalide(
            "l'ordre doit citer exactement les references actives du groupe".into(),
        ));
    }

    // Decalage vers le HAUT, pas vers le bas : `CHECK (priorite > 0)` interdit
    // les valeurs negatives, qui auraient ete le refuge naturel.
    //
    // L'ecart vaut la plus grande priorite en place. Les valeurs temporaires
    // commencent donc a `min + max`, soit strictement au-dessus de `n` — et les
    // priorites finales, qui vont de 1 a n, ne peuvent en croiser aucune.
    let ecart: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(priorite), 0) FROM reference_groupe_equiv
          WHERE code_groupe_equiv = $1 AND actif = 1",
    )
    .bind(&code_groupe)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE reference_groupe_equiv
            SET priorite = priorite + $2, est_preferentielle = 0
          WHERE code_groupe_equiv = $1 AND actif = 1",
    )
    .bind(&code_groupe)
    .bind(ecart)
    .execute(&mut *tx)
    .await?;

    for (rang, code) in o.references.iter().enumerate() {
        sqlx::query(
            "UPDATE reference_groupe_equiv
                SET priorite = $3, est_preferentielle = $4
              WHERE code_groupe_equiv = $1 AND code_reference = $2 AND actif = 1",
        )
        .bind(&code_groupe)
        .bind(code)
        .bind((rang + 1) as i64)
        .bind(i64::from(rang == 0))
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(Json(json!({
        "code_groupe_equiv": code_groupe,
        "references": o.references,
        "preferentielle": o.references[0]
    })))
}

#[derive(Debug, Deserialize)]
pub struct Substitution {
    pub code_reference_cible: String,
    pub motif: Option<String>,
}

/// Reporte une proposition d'achat sur une reference EQUIVALENTE.
///
/// Le MRP calcule un besoin sur une reference ; il ne mutualise jamais le stock
/// du groupe, precisement pour ne pas masquer le manque de la reference
/// preferentielle derriere du stock qui n'est pas le bon article. La bascule
/// est donc un ACTE : quelqu'un decide, et cela se trace.
pub async fn substituer_proposition(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(sub): Json<Substitution>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let (code_actuel, statut, quantite, origine): (String, String, f64, Option<String>) =
        sqlx::query_as(
            "SELECT code_reference, statut, quantite_suggeree_kg::float8, code_reference_origine
               FROM plan_achat WHERE id_proposition = $1",
        )
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("proposition {id}")))?;

    if statut == "COMMANDE" || statut == "IGNORE" {
        return Err(AppError::RegleMetier(format!(
            "Une proposition {statut} ne peut plus etre arbitree."
        )));
    }
    if code_actuel == sub.code_reference_cible {
        return Err(AppError::Invalide(
            "la reference cible est deja celle de la proposition".into(),
        ));
    }

    // La cible doit etre un equivalent DECLARE, et techniquement interchangeable
    // — meme unite, meme densite, meme categorie. Sans cette verification, on
    // pourrait reporter un besoin de latex sur du fil de jute au motif que
    // quelqu'un les a mis dans le meme groupe par erreur.
    let compat: Option<i64> = sqlx::query_scalar(
        "SELECT interchangeable::bigint FROM v_equivalence
          WHERE code_reference = $1 AND equivalent_reference = $2",
    )
    .bind(&code_actuel)
    .bind(&sub.code_reference_cible)
    .fetch_optional(&mut *tx)
    .await?;

    match compat {
        None => {
            return Err(AppError::RegleMetier(format!(
                "{} et {} ne partagent aucun groupe d'equivalence actif.",
                code_actuel, sub.code_reference_cible
            )))
        }
        Some(0) => {
            return Err(AppError::RegleMetier(format!(
                "{} et {} sont dans le meme groupe mais n'ont pas la meme unite, \
                 la meme densite ou la meme categorie : la substitution fausserait \
                 le calcul kg/m2 des recettes.",
                code_actuel, sub.code_reference_cible
            )))
        }
        _ => {}
    }

    // Le fournisseur suit la reference : une proposition porte le fournisseur de
    // ce qu'elle propose d'acheter, sinon elle irait grossir le bon du mauvais.
    let fournisseur_cible: Option<String> =
        sqlx::query_scalar("SELECT code_fournisseur FROM reference WHERE code_reference = $1")
            .bind(&sub.code_reference_cible)
            .fetch_optional(&mut *tx)
            .await?
            .flatten();
    let Some(fournisseur_cible) = fournisseur_cible else {
        return Err(AppError::RegleMetier(format!(
            "{} n'a pas de fournisseur : impossible d'en faire une proposition d'achat.",
            sub.code_reference_cible
        )));
    };

    // `ux_plan_achat_ouvert` n'admet qu'une proposition ouverte par reference.
    // Si la cible en a deja une, echouer sur la contrainte serait incomprehensible
    // pour l'acheteur : les deux propositions visent le meme achat, on les
    // FUSIONNE, et la proposition d'origine disparait en IGNORE.
    let existante: Option<(String, f64, i64)> = sqlx::query_as(
        "SELECT id_proposition, quantite_suggeree_kg::float8, figee FROM plan_achat
          WHERE code_reference = $1 AND statut IN ('PROPOSE','EN_REVISION','VALIDE')",
    )
    .bind(&sub.code_reference_cible)
    .fetch_optional(&mut *tx)
    .await?;

    // Fusionner DANS une proposition protegee detruirait l'arbitrage qu'elle
    // porte : une quantite arrondie a la palette pleine redeviendrait un nombre
    // quelconque, en silence, par une action menee sur une AUTRE reference.
    // C'est exactement ce que le figement existe pour empecher. On refuse, en
    // nommant la ligne, et l'acheteur tranche : liberer la cible, ou arbitrer
    // ailleurs.
    if let Some((_, _, 1)) = existante {
        return Err(AppError::RegleMetier(format!(
            "La proposition ouverte sur {} est protegee du recalcul : y fusionner \
             un besoin ecraserait la quantite arbitree. Rendez-la au calcul si \
             vous voulez qu'elle absorbe ce besoin.",
            sub.code_reference_cible
        )));
    }

    let resultat = if let Some((id_cible, qte_cible, _)) = existante {
        let total = arrondi_kg(qte_cible + quantite);
        // LA CIBLE FUSIONNEE EST FIGEE (audit v4, 08/10/2026). Laissee au
        // calcul, la generation suivante la supprimait, pendant que l'origine,
        // ecartee, masquait sa reference : le besoin disparaissait des deux
        // cotes (PP-1500 D.Bleu 6665-Hs, en rupture, masquee jusqu'a
        // l'expiration). Figee, elle porte le besoin reporte jusqu'a sa commande.
        sqlx::query(
            "UPDATE plan_achat
                SET quantite_suggeree_kg = $2,
                    statut = 'EN_REVISION',
                    commentaires = TRIM(COALESCE(commentaires || ' | ', '') ||
                                        'Fusion du besoin de ' || $3),
                    figee = 1, id_utilisateur_figement = $4, date_figement = fn_instant($5),
                    motif_figement = 'Fusion du besoin de ' || $3
              WHERE id_proposition = $1",
        )
        .bind(&id_cible)
        .bind(total)
        .bind(&code_actuel)
        .bind(&user.id)
        .bind(crate::db::maintenant())
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE plan_achat
                SET statut = 'IGNORE', figee = 0,
                    commentaires = TRIM(COALESCE(commentaires || ' | ', '') ||
                                        'Besoin reporte sur ' || $2 || COALESCE(' : ' || $3, ''))
              WHERE id_proposition = $1",
        )
        .bind(&id)
        .bind(&sub.code_reference_cible)
        .bind(&sub.motif)
        .execute(&mut *tx)
        .await?;

        json!({
            "fusionnee": true,
            "id_proposition": id_cible,
            "quantite_suggeree_kg": total,
            "message": format!(
                "Le besoin a ete fusionne avec la proposition deja ouverte sur {}.",
                sub.code_reference_cible)
        })
    } else {
        sqlx::query(
            "UPDATE plan_achat
                SET code_reference        = $2,
                    code_fournisseur      = $3,
                    code_reference_origine = COALESCE($4, $5),
                    motif_substitution    = $6,
                    statut                = 'EN_REVISION'
              WHERE id_proposition = $1",
        )
        .bind(&id)
        .bind(&sub.code_reference_cible)
        .bind(&fournisseur_cible)
        // L'origine PREMIERE est conservee : basculer deux fois ne doit pas
        // faire perdre la reference que le MRP avait reellement calculee.
        .bind(&origine)
        .bind(&code_actuel)
        .bind(&sub.motif)
        .execute(&mut *tx)
        .await?;

        json!({
            "fusionnee": false,
            "id_proposition": id,
            "code_reference": sub.code_reference_cible,
            "code_reference_origine": origine.unwrap_or(code_actuel),
            "code_fournisseur": fournisseur_cible
        })
    };

    tx.commit().await?;
    Ok(Json(resultat))
}

/// `GET /api/controles` — `v_controles` ET les controles du moteur de couverture
/// (C05, C25 : 27/10/2026), sous la meme forme, tries par code.
pub async fn controles(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::COCKPIT, Action::Lire).await?;
    let etats = super::couverture::etats(&state.db).await?;
    let mut valeur = Value::Array(super::couverture::tous_les_controles(&state.db, &etats).await?);
    user.masquer(&state.db, module::COCKPIT, &mut valeur).await?;
    Ok(Json(valeur))
}

/// `GET /api/supervision` — les indicateurs de pilotage de la chaine logistique.
///
/// CHAQUE INDICATEUR DIT AUSSI QUAND IL NE SAIT PAS. La vue rend, a cote de la
/// valeur, un drapeau `disponible` et — s'il vaut zero — la phrase qui explique
/// ce qu'il faut enregistrer pour l'allumer. L'ecran affiche alors « en
/// attente : aucune reception enregistree » au lieu de « OTIF 0 % ».
///
/// La difference n'est pas cosmetique. Un zero se lit comme un resultat : un
/// directeur qui voit « OTIF 0 % » conclut que ses fournisseurs sont
/// catastrophiques, alors que l'ERP n'a simplement jamais vu passer une
/// reception. La phrase, elle, transforme le tableau de bord en liste de ce
/// qu'il reste a mettre en route.
pub async fn supervision(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    let Json(mut v) = lister(
        &state,
        &user,
        module::COCKPIT,
        "SELECT s.domaine, s.cle, s.libelle, s.unite, s.definition,
                s.disponible, s.condition, s.sens,
                s.cible::float8     AS cible,
                s.vigilance::float8 AS vigilance,
                v.valeur::float8    AS valeur
           FROM v_supervision s
           LEFT JOIN v_supervision_valeurs v USING (cle)
          ORDER BY s.disponible DESC, s.domaine, s.libelle",
    )
    .await?;
    // LES TROIS INDICATEURS DE COUVERTURE VIENNENT DU MOTEUR (27/10/2026) : taux de
    // rupture (plan non couvert sur l'horizon), taux de disponibilite (couvert sur
    // tout l'horizon) sur les references suivies, couverture mediane (jours
    // couverts jusqu'a la premiere rupture, sinon tout l'horizon) sur celles qui
    // ont un plan. La vue ne les porte plus.
    let etats = super::couverture::etats(&state.db).await?;
    let suivies: Vec<&super::couverture::Etat> = etats.suivies().collect();
    let n = suivies.len();
    let part = |f: &dyn Fn(&super::couverture::Etat) -> bool| -> Option<f64> {
        (n > 0).then(|| (1000.0 * suivies.iter().filter(|e| f(e)).count() as f64 / n as f64).round() / 10.0)
    };
    let horizon_j = etats.fin_horizon.map(|f| (f - etats.aujourdhui).num_days() + 1).unwrap_or(0);
    let mut jours: Vec<i64> = suivies
        .iter()
        .filter(|e| e.plan_horizon_kg > 0.0)
        .map(|e| e.jours_couverture.unwrap_or(horizon_j))
        .collect();
    jours.sort_unstable();
    let mediane = match jours.len() {
        0 => None,
        l if l % 2 == 1 => Some(jours[l / 2] as f64),
        l => Some(((jours[l / 2 - 1] + jours[l / 2]) as f64 / 2.0).round()),
    };
    // Les economies identifiees sont AU PLAN du moteur (27/10/2026) : la vue les
    // laisse vides, la route les calcule (meme regle que le tableau de bord).
    let (economies, nb_opportunites) = total_economies(&economies_au_plan(&state.db, &etats).await?);
    let du_moteur = [
        ("taux_rupture", part(&|e| e.statut == super::couverture::statut::PLAN_NON_COUVERT)),
        ("taux_disponibilite", part(&|e| e.statut == super::couverture::statut::COUVERT)),
        ("couverture_mediane", mediane),
        ("economies", (nb_opportunites > 0).then_some(economies)),
    ];
    if let Some(lignes) = v.as_array_mut() {
        for l in lignes.iter_mut() {
            let cle = l.get("cle").and_then(Value::as_str).unwrap_or_default().to_string();
            if let (Some((_, Some(valeur))), Some(o)) = (du_moteur.iter().find(|(c, _)| *c == cle), l.as_object_mut()) {
                o.insert("valeur".into(), json!(valeur));
                o.insert("disponible".into(), json!(1));
                o.insert("condition".into(), Value::Null);
            }
        }
    }
    // LES INDICATEURS EN DIRHAMS SUIVENT LA VALEUR DU STOCK (regle 16). La
    // colonne generique `valeur` portait la valeur du stock, le budget
    // mono-source et les economies a qui ne voit aucun montant.
    let droits = user.droits(&state.db, module::COCKPIT).await?;
    if droits.get("valeur_stock_mad") == Some(&rbac::Niveau::Masque) {
        if let Some(lignes) = v.as_array_mut() {
            for l in lignes {
                let en_mad = l.get("unite").and_then(|u| u.as_str()).is_some_and(|u| u.starts_with("MAD"));
                if en_mad {
                    if let Some(o) = l.as_object_mut() {
                        for c in ["valeur", "cible", "vigilance"] {
                            o.remove(c);
                        }
                    }
                }
            }
        }
    }
    Ok(Json(v))
}

pub async fn controle_detail(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::COCKPIT, Action::Lire).await?;

    // Le code alimente un nom de vue : il est valide contre une liste blanche
    // stricte, jamais interpole tel quel.
    let code = code.to_lowercase();
    let valide = code.len() == 3
        && code.starts_with('c')
        && code[1..].chars().all(|c| c.is_ascii_digit());
    if !valide {
        return Err(AppError::Invalide(format!("code de controle invalide : {code}")));
    }

    // Les controles du moteur de couverture (C05, C25) n'ont pas de vue.
    if super::couverture::CONTROLES_MOTEUR.iter().any(|(c, _, _)| c.eq_ignore_ascii_case(&code)) {
        let etats = super::couverture::etats(&state.db).await?;
        let mut sortie = super::couverture::controle_moteur_detail(&state.db, &etats, &code)
            .await?
            .unwrap_or(Value::Array(Vec::new()));
        user.masquer(&state.db, module::COCKPIT, &mut sortie).await?;
        return Ok(Json(sortie));
    }

    let vue = format!("v_ctl_{code}");
    let existe: i64 =
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM information_schema.views
              WHERE table_schema = 'public' AND table_name = $1",
        )
            .bind(&vue)
            .fetch_one(&state.db)
            .await?;
    if existe == 0 {
        return Err(AppError::Introuvable(format!("controle {code}")));
    }

    let rows = sqlx::query(&format!("SELECT * FROM {vue}"))
        .fetch_all(&state.db)
        .await?;
    // C12 et C14 listent des prix et des couts : masques comme ailleurs.
    let mut sortie = lignes_en_json(&rows);
    user.masquer(&state.db, module::COCKPIT, &mut sortie).await?;
    Ok(Json(sortie))
}

// Le catalogue et la liste des fournisseurs sont servis par le module
// `referentiels`, qui porte aussi leurs endpoints de modification.

pub async fn scorecard(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    lister(
        &state,
        &user,
        module::FOURNISSEURS,
        "SELECT * FROM v_fournisseur_scorecard ORDER BY montant_total_mad DESC",
    )
    .await
}

pub async fn stock(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<Filtres>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let rows = sqlx::query(
        // LE CONDITIONNEMENT VOYAGE AVEC LE STOCK. Transferer se compte en
        // palettes et en bobines autant qu'en kilos ; sans ces parametres,
        // l'ecran de transfert devait charger le catalogue entier pour
        // convertir trois lignes.
        "SELECT sm.*, r.designation, r.unite_catalogue, r.suivi_lot,
                r.poids_bobine_kg, r.bobines_par_palette, r.bobines_par_lot,
                r.densite_kg_ml,
                -- La saisie d'une consommation directe ne propose que les
                -- articles en mode DIRECTE (21/10/2026).
                r.mode_consommation,
                m.nom AS magasin_nom, m.inclure_mrp
           FROM stock_magasin sm
           JOIN reference r ON r.code_reference = sm.code_reference
           JOIN magasin   m ON m.code_magasin   = sm.code_magasin
          WHERE ($1 IS NULL OR sm.code_reference = $1)
            AND ($3 IS NULL OR sm.code_magasin = $3)
          ORDER BY sm.code_reference, sm.code_magasin
          LIMIT $2",
    )
    .bind(&f.code_reference)
    .bind(f.limite())
    .bind(&f.code_magasin)
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::STOCK, &mut valeur).await?;
    Ok(Json(valeur))
}

/// `GET /api/etat-stock` — UNE LIGNE PAR REFERENCE, ventilee par magasin.
///
/// L'ancien `/api/stock` rendait une ligne par couple (reference, magasin) et
/// laissait l'ecran recomposer le tableau : on ne voyait jamais une reference
/// d'un coup d'oeil, et le total ne s'affichait nulle part. C'est la feuille
/// « Stock » du classeur qui a la bonne forme, et c'est celle-ci.
///
/// LES MACHINES TIENNENT EN UNE COLONNE. Chaque etage est un magasin — juste
/// pour la comptabilite, illisible dans un etat, ou une machine a six zones
/// ferait six colonnes. Le detail reste sur l'ecran des machines.
pub async fn etat_stock(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<Filtres>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    // Le stock vient de la vue ; l'etat de couverture (statut, jours couverts, 1re
    // rupture, plan, arrivages comptes, a commander) vient du moteur (27/10/2026).
    let rows = sqlx::query(
        "SELECT * FROM v_etat_stock
          WHERE ($1 IS NULL OR code_reference = $1)
          ORDER BY designation",
    )
    .bind(&f.code_reference)
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    let etats = super::couverture::etats(&state.db).await?;
    etats.enrichir(&mut valeur, "statut");
    // LE MINIMUM AFFICHE EST UN SEUIL D'AVENIR, AU PLAN (27/10/2026) : la securite du
    // jour du moteur (jours de securite de la classe ABC x plan a venir). L'ancien
    // minimum dynamique lisait le « plus grand » du reel et du plan : il est
    // supprime. « Sous le minimum » = le disponible compte par le moteur sous cette
    // securite, aujourd'hui.
    if let Some(a) = valeur.as_array_mut() {
        for l in a.iter_mut() {
            let code = l["code_reference"].as_str().unwrap_or_default().to_string();
            if let Some(o) = l.as_object_mut() {
                let (min, sous) = match etats.get(&code) {
                    Some(e) => (
                        json!(e.securite_aujourdhui_kg),
                        json!(e.securite_aujourdhui_kg > 0.0 && e.disponible_kg < e.securite_aujourdhui_kg - 1e-6),
                    ),
                    None => (Value::Null, json!(false)),
                };
                o.insert("stock_min_kg".into(), min);
                o.insert("sous_minimum".into(), sous);
            }
        }
    }
    trier_par_etat(&mut valeur, "designation");
    tronquer(&mut valeur, f.limite());
    user.masquer(&state.db, module::STOCK, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Trie un tableau de lignes enrichies par le moteur : le plus grave d'abord
/// (plan non couvert, sous la securite, couvert), puis la rupture la plus proche,
/// puis la cle secondaire (texte).
fn trier_par_etat(v: &mut Value, secondaire: &str) {
    if let Some(a) = v.as_array_mut() {
        a.sort_by(|x, y| {
            let rang = |l: &Value| super::couverture::rang_statut(l["statut"].as_str().unwrap_or(""));
            let jours = |l: &Value| l["jours_couverture"].as_i64().unwrap_or(i64::MAX);
            let texte = |l: &Value| l[secondaire].as_str().unwrap_or("").to_string();
            (rang(x), jours(x), texte(x)).cmp(&(rang(y), jours(y), texte(y)))
        });
    }
}

fn tronquer(v: &mut Value, limite: i64) {
    if let Some(a) = v.as_array_mut() {
        a.truncate(limite.max(0) as usize);
    }
}

/// `GET /api/stock/projete` — LE STOCK PROJETE EST UNE VUE DU MOTEUR DE COUVERTURE
/// (27/10/2026) : une ligne par reference suivie (active, avec une demande au plan,
/// du stock ou un arrivage), ses ressources comptees, sa couverture (1re rupture,
/// couvert jusqu'au, plan non couvert), sa premiere proposition, et ce qui est
/// compte a part — les memes champs que l'onglet « A commander ». `?statut=`
/// filtre sur l'etat du moteur (PLAN_NON_COUVERT, SOUS_SECURITE, COUVERT).
pub async fn stock_projete(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<Filtres>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let etats = super::couverture::etats(&state.db).await?;
    // Ce que le stock dit en plus : le physique, la valeur, l'unite, la regularite,
    // et le fil sur machine total (compte ou non).
    let complements = lignes_en_json(
        &sqlx::query(
            "SELECT s.code_reference, s.classe_xyz, s.unite_catalogue, s.cmup_mad, s.valeur_totale_mad,
                    s.stock_physique_net_kg, s.stock_total_kg,
                    COALESCE(m.kg_sur_machine, 0) AS kg_sur_machine
               FROM v_stock_reference s
               LEFT JOIN v_stock_machine m ON m.code_reference = s.code_reference",
        )
        .fetch_all(&state.db)
        .await?,
    );
    let par_code: HashMap<String, &Value> = complements
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|l| l["code_reference"].as_str().map(|c| (c.to_string(), l)))
                .collect()
        })
        .unwrap_or_default();
    let filtre = f.statut.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let mut lignes: Vec<Value> = etats
        .suivies()
        .filter(|e| filtre.is_none_or(|s| s == e.statut))
        .map(|e| {
            let mut l = e.ligne.clone();
            if let (Some(o), Some(c)) = (l.as_object_mut(), par_code.get(&e.code_reference).and_then(|c| c.as_object())) {
                for (k, v) in c {
                    o.entry(k.clone()).or_insert_with(|| v.clone());
                }
            }
            l
        })
        .collect();
    lignes.sort_by(|x, y| {
        let rang = |l: &Value| super::couverture::rang_statut(l["statut"].as_str().unwrap_or(""));
        let jours = |l: &Value| l["jours_couverture"].as_i64().unwrap_or(i64::MAX);
        let securite = |l: &Value| l["premier_passage_securite"].as_str().unwrap_or("9999").to_string();
        let code = |l: &Value| l["code_reference"].as_str().unwrap_or("").to_string();
        (rang(x), jours(x), securite(x), code(x)).cmp(&(rang(y), jours(y), securite(y), code(y)))
    });
    let mut valeur = Value::Array(lignes);
    tronquer(&mut valeur, f.limite());
    user.masquer(&state.db, module::STOCK, &mut valeur).await?;
    Ok(Json(valeur))
}

pub async fn stock_dormant(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    lister(&state, &user, module::STOCK, "SELECT * FROM v_stock_dormant").await
}

pub async fn lots(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<Filtres>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    // LE STOCK PAR LOT, tel que la base le tient (`stock_lot`) — avec ce qui
    // distingue deux lots au metier : la couleur, les bobines, l'entree. Un lot
    // est une production du fournisseur ; deux lots d'une meme reference
    // peuvent differer de nuance, et cela se voit au tissage (01/10/2026).
    let rows = sqlx::query(
        "SELECT sl.code_reference, r.designation, r.poids_bobine_kg::float8 AS poids_bobine_kg,
                sl.code_magasin, mg.nom AS magasin_nom, mg.type AS magasin_type,
                sl.lot_fournisseur, sl.code_couleur, sl.quantite_kg, sl.nb_bobines,
                sl.prix_entree_mad, sl.date_premiere_entree, sl.date_fabrication, sl.date_peremption,
                -- LE CONDITIONNEMENT DU LOT (23/10/2026) : ce qui convertit ses
                -- palettes, bobines et kilos ; a defaut, celui de la fiche article.
                COALESCE(lo.poids_bobine_kg, r.poids_bobine_kg)::float8 AS poids_bobine_lot_kg,
                COALESCE(lo.bobines_par_palette, r.bobines_par_palette)  AS bobines_par_palette_lot,
                lo.origine_poids_bobine, lo.origine_bobines_palette
           FROM stock_lot sl
           JOIN magasin mg ON mg.code_magasin = sl.code_magasin
           JOIN reference r ON r.code_reference = sl.code_reference
           LEFT JOIN lot lo ON lo.code_reference = sl.code_reference AND lo.lot_fournisseur = sl.lot_fournisseur
          WHERE sl.quantite_kg > 0
            AND ($1::text IS NULL OR sl.code_reference = $1)
            AND ($3::text IS NULL OR sl.code_magasin = $3)
          ORDER BY sl.code_reference, sl.code_magasin, sl.date_premiere_entree
          LIMIT $2",
    )
    .bind(&f.code_reference)
    .bind(f.limite())
    .bind(&f.code_magasin)
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::STOCK, &mut valeur).await?;
    Ok(Json(valeur))
}

pub async fn substitutions(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    // LA TENSION VIENT DU MOTEUR (27/10/2026) : une reference principale au plan
    // non couvert (l'ancien RUPTURE / CRITIQUE), avec ses substituts en stock.
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let etats = super::couverture::etats(&state.db).await?;
    let rows = sqlx::query("SELECT * FROM v_substitution_dispo").fetch_all(&state.db).await?;
    let mut lignes: Vec<Value> = Vec::new();
    for mut l in lignes_en_json(&rows).as_array().cloned().unwrap_or_default() {
        let principale = l["ref_principale"].as_str().and_then(|c| etats.get(c));
        let Some(p) = principale.filter(|p| p.statut == super::couverture::statut::PLAN_NON_COUVERT) else {
            continue;
        };
        let substitut = l["ref_substitut"].as_str().and_then(|c| etats.get(c));
        if let Some(o) = l.as_object_mut() {
            o.insert("statut_principale".into(), json!(p.statut));
            o.insert("premiere_rupture_principale".into(), json!(p.premiere_rupture));
            o.insert("plan_non_couvert_principale_kg".into(), json!(p.plan_non_couvert_kg));
            o.insert("statut_substitut".into(), json!(substitut.map(|s| s.statut)));
        }
        lignes.push(l);
    }
    let mut valeur = Value::Array(lignes);
    user.masquer(&state.db, module::STOCK, &mut valeur).await?;
    Ok(Json(valeur))
}

/// `GET /api/plan-achat/stocks-minimums` — LES STOCKS MINIMUMS A REVOIR (regle 9,
/// 09/10/2026) : ceux qui depassent trois mois du besoin mensuel du plan, avec
/// une valeur proposee (couverture minimale en mois x besoin mensuel). Les 793 t
/// de minimums venaient du classeur ; les achats les revoient ici.
pub async fn stocks_minimums(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    lister(
        &state,
        &user,
        module::PLAN_ACHAT,
        // La version de la fiche : appliquer la proposition la modifie (verrou, 19/10/2026).
        "SELECT v.*, r.version FROM v_stocks_minimums_a_revoir v
           JOIN reference r ON r.code_reference = v.code_reference
          ORDER BY v.stock_min_kg - COALESCE(v.valeur_proposee_kg, 0) DESC",
    )
    .await
}

#[derive(Deserialize)]
pub struct DetailProposition {
    reference: String,
}

/// `GET /api/stock/besoin?reference=…` — LE BESOIN D'UNE REFERENCE, au moteur de
/// couverture (27/10/2026) : le PLAN SEUL sur l'horizon et mois par mois (le mois
/// en cours depuis aujourd'hui), ce qu'il en reste non couvert, la premiere
/// rupture, le delai et la couverture d'une commande. L'ancien calcul (demande
/// pendant le delai, sorties de la couverture de `v_besoin_horizon`) est retire.
/// Lisible depuis le stock comme depuis le plan d'achat.
pub async fn besoin_reference(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(q): Query<DetailProposition>,
) -> AppResult<Json<Value>> {
    let module = if user.exiger(&state.db, module::STOCK, Action::Lire).await.is_ok() {
        module::STOCK
    } else {
        user.exiger(&state.db, module::PLAN_ACHAT, Action::Lire).await?;
        module::PLAN_ACHAT
    };
    let mut v = super::couverture::besoin_reference(&state.db, q.reference.trim()).await?;
    user.masquer(&state.db, module, &mut v).await?;
    Ok(Json(v))
}

/// Les propositions ENREGISTREES, avec leur statut et le bon qu'elles ont produit.
///
/// A ne pas confondre avec `v_plan_achat`, qui est le CALCUL : il se refait a
/// chaque lecture et ne garde aucune trace. Ici on lit ce qui a ete decide —
/// proposee, ecartee, ou convertie en commande. C'est cette table qui porte un
/// cycle de vie, donc c'est elle que l'acheteur manipule.
pub async fn propositions_achat(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Lire).await?;
    let rows = sqlx::query(
        // LECTURE SEULE ET RAPIDE (14/10/2026). La liste RECALCULAIT tout le MRP
        // (v_plan_achat) a chaque ouverture, uniquement pour l'ecart de la
        // « Protection » — retiree le 14/10. On lit donc la seule table
        // `plan_achat` : le complement de palette y est desormais fige a la
        // generation (migration 2026-10-14), les palettes aussi. Les equivalents
        // et le detail du calcul se chargent A LA DEMANDE (bouton, depliage).
        //
        // SANS LE RISQUE (21/10/2026) : la jointure a v_risque_sourcing coutait
        // 270 ms de preparation a elle seule, sur 300 — la liste s'ouvrait en
        // 1 a 2 s. La classe ABC/XYZ est celle de la fiche (figee au calcul de
        // classification), l'action recommandee celle de la proposition (figee
        // a la generation). Le risque d'approvisionnement (sources, budget) se
        // lit au DETAIL de la ligne, une reference a la fois.
        "SELECT pa.*, r.designation, r.unite_catalogue, f.nom AS fournisseur_nom,
                bc.numero_bc, bc.statut AS statut_bc,
                ro.designation AS designation_origine,
                r.classe_abc, r.classe_xyz,
                -- Le conditionnement : la boite « Commander » lie kg, palettes et bobines.
                r.poids_bobine_kg::float8 AS poids_bobine_kg, r.bobines_par_palette
           FROM plan_achat pa
           JOIN reference r    ON r.code_reference     = pa.code_reference
           JOIN fournisseur f  ON f.code_fournisseur   = pa.code_fournisseur
           LEFT JOIN reference ro    ON ro.code_reference = pa.code_reference_origine
           LEFT JOIN bon_commande bc ON bc.id_bc       = pa.id_bc_genere
          ORDER BY CASE pa.urgence WHEN 'TIER 1' THEN 1 WHEN 'TIER 2' THEN 2
                                   WHEN 'TIER 3' THEN 3 ELSE 4 END,
                   pa.code_fournisseur, pa.code_reference",
    )
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    // Le prix au CMUP d'abord : `masquer` peut retirer la source du prix.
    user.masquer_prix_au_cmup(&state.db, &mut valeur).await?;
    user.masquer(&state.db, module::PLAN_ACHAT, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Tableau de bord du plan d'achat, reproduisant les blocs de la feuille.
///
/// UNE SEULE SOURCE (27/10/2026) : la situation du stock est celle du MOTEUR DE
/// COUVERTURE (plan non couvert, sous la securite, couvert, a commander
/// aujourd'hui, classe A au plan non couvert) et « a commander » est la somme des
/// propositions ouvertes, que le moteur a faites. Plus rien ne lit l'ancienne
/// projection.
pub async fn kpi_plan_achat(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Lire).await?;

    // LUS, PAS RECALCULES (21/10/2026) : le calcul prenait 4 a 7 s a chaque
    // ouverture (toute la projection de stock, replanifiee pour chaque compte).
    // Il se fait a la generation du plan (`figer_kpi_plan_achat`) ; l'ecran lit
    // le dernier, avec sa date. Aucun encore : on le calcule une fois ici.
    let fige: Option<(Value, String)> = sqlx::query_as(
        "SELECT valeurs, fn_iso(date_calcul) FROM plan_achat_indicateurs ORDER BY id DESC LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await?;
    let (mut sortie, date_calcul) = match fige {
        // Un releve fige avant le 27/10/2026 parle l'ancien calcul (ruptures,
        // critiques…) : il se recalcule une fois au moteur.
        Some(x) if x.0["globaux"].get("plan_non_couvert").is_some() => x,
        _ => figer_kpi_plan_achat(&state.db, &user).await?,
    };
    if let Some(o) = sortie.as_object_mut() {
        o.insert("calcule_le".into(), Value::from(date_calcul));
    }
    user.masquer(&state.db, module::PLAN_ACHAT, &mut sortie).await?;
    Ok(Json(sortie))
}

/// Calcule les indicateurs du plan d'achat et les enregistre ; rend les valeurs
/// (non masquees) et la date. Appele a la generation du plan.
pub async fn figer_kpi_plan_achat(db: &crate::db::Db, user: &Utilisateur) -> AppResult<(Value, String)> {
    // LE MOTEUR DE COUVERTURE, une fois, avant la transaction (il ne fait que lire).
    let etats = super::couverture::etats(db).await?;
    let suivies: Vec<&super::couverture::Etat> = etats.suivies().collect();
    let codes: Vec<String> = suivies.iter().map(|e| e.code_reference.clone()).collect();
    let statuts: Vec<String> = suivies.iter().map(|e| e.statut.to_string()).collect();

    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // L'etat de chaque reference suivie, tel que le moteur le dit.
    sqlx::query(
        "CREATE TEMP TABLE sp_kpi ON COMMIT DROP AS
         SELECT * FROM unnest($1::text[], $2::text[]) AS s(code_reference, statut)",
    )
    .bind(&codes)
    .bind(&statuts)
    .execute(&mut *tx)
    .await?;

    // CE QUI EST « À COMMANDER » = LES PROPOSITIONS OUVERTES : elles viennent du
    // moteur de couverture depuis 2026-10-27c ; leur etat aussi (27/10/2026).
    sqlx::query(
        "CREATE TEMP TABLE pa_kpi ON COMMIT DROP AS
         SELECT pa.code_reference, pa.code_fournisseur,
                pa.quantite_suggeree_kg AS qte_a_commander_kg,
                pa.montant_total_mad    AS montant_estime_mad,
                pa.urgence              AS tier,
                pa.risque_identifie     AS risque_sourcing,
                COALESCE(sp.statut, 'COUVERT') AS statut
           FROM plan_achat pa
           LEFT JOIN sp_kpi sp ON sp.code_reference = pa.code_reference
          WHERE pa.statut IN ('PROPOSE', 'EN_REVISION', 'VALIDE')",
    )
    .execute(&mut *tx)
    .await?;

    // Bloc « Situation du stock » : les notions du moteur (decide le 27/10/2026).
    let compteurs = etats.compteurs();
    let propositions = sqlx::query(
        "SELECT
            (SELECT COALESCE(ROUND(SUM(montant_estime_mad), 2), 0) FROM pa_kpi) AS budget_mad,
            (SELECT COALESCE(ROUND(SUM(qte_a_commander_kg), 2), 0) FROM pa_kpi) AS quantite_kg,
            (SELECT COUNT(*) FROM pa_kpi)                                AS refs_a_commander",
    )
    .fetch_one(&mut *tx)
    .await?;
    let mut globaux = lignes_en_json(std::slice::from_ref(&propositions))
        .as_array()
        .and_then(|a| a.first().cloned())
        .unwrap_or(Value::Null);
    if let Some(o) = globaux.as_object_mut() {
        for (cle, champ) in [
            ("references", "nb_references"),
            ("plan_non_couvert", "nb_plan_non_couvert"),
            ("sous_securite", "nb_sous_securite"),
            ("couvert", "nb_couvert"),
            ("a_commander_aujourdhui", "nb_a_commander_aujourdhui"),
            ("classe_a_en_rupture", "nb_classe_a_en_rupture"),
        ] {
            o.insert(cle.into(), compteurs[champ].clone());
        }
    }

    // Bloc « tiering urgence » : combien de references dans chaque palier.
    let tiering = sqlx::query(
        "SELECT tier, COUNT(*) AS nb, ROUND(SUM(montant_estime_mad), 2) AS montant_mad
           FROM pa_kpi GROUP BY tier ORDER BY tier",
    )
    .fetch_all(&mut *tx)
    .await?;

    // Bloc « risques identifies » : mono-source et exposition par devise.
    let risques = sqlx::query(
        "SELECT 'MONO-SOURCE' AS risque, COUNT(*) AS nb,
                ROUND(COALESCE(SUM(montant_estime_mad), 0), 2) AS montant_mad
           FROM pa_kpi WHERE risque_sourcing = 'MONO-SOURCE'
         UNION ALL
         SELECT 'DEVISE ' || f.code_devise, COUNT(*),
                ROUND(COALESCE(SUM(pa.montant_estime_mad), 0), 2)
           FROM pa_kpi pa
           JOIN fournisseur f ON f.code_fournisseur = pa.code_fournisseur
          GROUP BY f.code_devise",
    )
    .fetch_all(&mut *tx)
    .await?;

    // Bloc « repartition par fournisseur », classe par budget decroissant.
    let fournisseurs = sqlx::query(
        "SELECT pa.code_fournisseur, f.nom AS fournisseur_nom, f.pays, f.code_devise,
                f.delai_livraison_jours, f.contact_principal, f.ville,
                COUNT(*)                                       AS nb_references,
                ROUND(SUM(pa.qte_a_commander_kg), 2)           AS quantite_kg,
                ROUND(SUM(pa.montant_estime_mad), 2)           AS montant_mad,
                COUNT(*) FILTER (WHERE pa.tier = 'TIER 1')              AS nb_tier1,
                -- Les references au plan non couvert, au sens du moteur.
                COUNT(*) FILTER (WHERE pa.statut = 'PLAN_NON_COUVERT')  AS nb_plan_non_couvert
           FROM pa_kpi pa
           JOIN fournisseur f ON f.code_fournisseur = pa.code_fournisseur
          -- REGROUPER SUR LA CLE DU FOURNISSEUR, pas seulement sur le code
          -- porte par le plan : PostgreSQL n'accepte une colonne hors agregat
          -- que si elle depend fonctionnellement du groupe, et c'est la cle
          -- primaire de `fournisseur` qui le garantit pour `f.nom`, `f.pays`,
          -- `f.code_devise`... SQLite laissait passer ; ici l'ecran du plan
          -- d'achat tombait en « erreur interne ».
          GROUP BY f.code_fournisseur, pa.code_fournisseur
          ORDER BY montant_mad DESC",
    )
    .fetch_all(&mut *tx)
    .await?;

    let sortie = json!({
        // Une seule ligne : on la sort du tableau pour que l'ecran lise
        // `globaux.budget_mad` et non `globaux[0].budget_mad`.
        "globaux": globaux,
        "tiering": lignes_en_json(&tiering),
        "risques": lignes_en_json(&risques),
        "fournisseurs": lignes_en_json(&fournisseurs),
    });
    let date: String = sqlx::query_scalar(
        "INSERT INTO plan_achat_indicateurs (valeurs, id_utilisateur) VALUES ($1, $2)
         RETURNING fn_iso(date_calcul)",
    )
    .bind(&sortie)
    .bind(&user.id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((sortie, date))
}

/// L'analyse ABC / XYZ, reference par reference.
///
/// Les deux classements ne disent pas la meme chose : ABC pese, XYZ mesure la
/// regularite. C'est leur CROISEMENT qui commande une politique — une reference
/// AZ traitee comme une AX se met en rupture, une CZ traitee comme une AX
/// immobilise du capital pour rien. La vue rend donc la politique deduite, pas
/// seulement les deux lettres.
pub async fn analyse_abc_xyz(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let lignes = sqlx::query("SELECT * FROM v_analyse_abc_xyz ORDER BY rang")
        .fetch_all(&state.db)
        .await?;
    let mut valeur = lignes_en_json(&lignes);
    // Le statut et les jours couverts sont ceux du moteur (27/10/2026).
    super::couverture::etats(&state.db).await?.enrichir(&mut valeur, "statut");
    user.masquer(&state.db, module::STOCK, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Le cout de revient rendu magasin, ligne de reception par ligne.
///
/// Prix d'achat plus quote-part des frais d'approche. C'est le seul chiffre qui
/// permette de comparer deux fournisseurs eloignes : un prix depart usine plus
/// bas peut couter plus cher rendu, et le prix d'achat seul ne le montre jamais.
pub async fn cout_revient(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::VALORISATION, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT * FROM v_cout_revient ORDER BY date_reception DESC, code_reference",
    )
    .fetch_all(&state.db)
    .await?;
    let mut valeur = lignes_en_json(&lignes);
    user.masquer(&state.db, module::VALORISATION, &mut valeur).await?;
    Ok(Json(valeur))
}

#[derive(Deserialize)]
pub struct PeriodeEcart {
    du: Option<String>,
    au: Option<String>,
}

/// `GET /api/ecarts-prix?du=&au=` — CE QUE LE CMUP N'A PAS PU PORTER (audit
/// v5, F18) : la part des factures, frais, avoirs et retours qui revenait a des
/// kilos deja sortis, en local et a l'import. Le detail, et les totaux par
/// reference et par fournisseur. Montants masques selon les droits.
pub async fn ecarts_prix(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(p): Query<PeriodeEcart>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::VALORISATION, Action::Lire).await?;
    let du = p.du.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let au = p.au.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let lignes = sqlx::query(
        "SELECT circuit, id_ajustement, date_ecart, document, id_document, code_fournisseur, fournisseur_nom,
                code_reference, designation, origine, numero_piece, motif,
                quantite_recue_kg::float8 AS quantite_recue_kg, montant_mad::float8 AS montant_mad
           FROM v_ecart_prix
          WHERE ($1::text IS NULL OR date_ecart >= $1) AND ($2::text IS NULL OR date_ecart <= $2)
          ORDER BY date_ecart DESC, document, code_reference
          LIMIT 2000",
    )
    .bind(du)
    .bind(au)
    .fetch_all(&state.db)
    .await?;
    let par_reference = sqlx::query(
        "SELECT code_reference, max(designation) AS designation, count(*) AS nb,
                sum(montant_mad)::float8 AS montant_mad
           FROM v_ecart_prix
          WHERE ($1::text IS NULL OR date_ecart >= $1) AND ($2::text IS NULL OR date_ecart <= $2)
          GROUP BY code_reference ORDER BY abs(sum(montant_mad)) DESC",
    )
    .bind(du)
    .bind(au)
    .fetch_all(&state.db)
    .await?;
    let par_fournisseur = sqlx::query(
        "SELECT code_fournisseur, max(fournisseur_nom) AS fournisseur_nom, count(*) AS nb,
                sum(montant_mad)::float8 AS montant_mad
           FROM v_ecart_prix
          WHERE ($1::text IS NULL OR date_ecart >= $1) AND ($2::text IS NULL OR date_ecart <= $2)
          GROUP BY code_fournisseur ORDER BY abs(sum(montant_mad)) DESC",
    )
    .bind(du)
    .bind(au)
    .fetch_all(&state.db)
    .await?;
    let mut v = json!({
        "lignes": lignes_en_json(&lignes),
        "par_reference": lignes_en_json(&par_reference),
        "par_fournisseur": lignes_en_json(&par_fournisseur),
    });
    user.masquer(&state.db, module::VALORISATION, &mut v).await?;
    Ok(Json(v))
}

/// Les frais d'approche saisis, par reception.
pub async fn frais_approche(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<Filtres>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::VALORISATION, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT fa.*, rc.numero_reception, rc.date_reception, fo.nom AS fournisseur_nom
           FROM frais_approche fa
           JOIN reception rc ON rc.id_reception = fa.id_reception
           LEFT JOIN fournisseur fo ON fo.code_fournisseur = rc.code_fournisseur
          WHERE ($1 IS NULL OR fa.id_reception = $1)
          ORDER BY fa.date_frais DESC, fa.type_frais
          LIMIT $2",
    )
    .bind(f.id_reception.as_ref().or(f.code_reference.as_ref()))
    .bind(f.limite())
    .fetch_all(&state.db)
    .await?;
    let mut valeur = lignes_en_json(&lignes);
    user.masquer(&state.db, module::VALORISATION, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Le controle de coherence des recettes, qualite par qualite.
///
/// Le controle C01 rend un COMPTE d'anomalies ; celui-ci rend le DETAIL que le
/// classeur affiche : combien de roles sur combien sont composes a 100 %, et le
/// nom de ceux qui echouent avec leur somme. « 6 anomalies » ne se corrige pas ;
/// « SH : 7 roles sur 8, Franges a 0 % » se corrige.
pub async fn coherence_recettes(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::QUALITES, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT * FROM v_coherence_recette ORDER BY verdict DESC, code_qualite",
    )
    .fetch_all(&state.db)
    .await?;
    let mut valeur = lignes_en_json(&lignes);
    user.masquer(&state.db, module::QUALITES, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Les risques de sourcing, reference par reference.
///
/// Classe ABC, palier de montant, nombre de sources et action recommandee —
/// le bloc « RISQUES IDENTIFIES » du plan d'achat. Le risque n'est PAS
/// l'urgence : une reference calme et mono-source ne presse pas, mais elle
/// merite qu'on qualifie une seconde source avant qu'elle presse.
pub async fn risques_sourcing(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT * FROM v_risque_sourcing
          ORDER BY CASE tier WHEN 'TIER_1' THEN 1 WHEN 'TIER_2' THEN 2
                             WHEN 'TIER_3' THEN 3 ELSE 4 END,
                   budget_annuel_mad DESC",
    )
    .fetch_all(&state.db)
    .await?;
    let mut valeur = lignes_en_json(&lignes);
    // L'ETAT VIENT DU MOTEUR (27/10/2026), et l'action recommandee le suit : la
    // meme grille qu'avant, ou « rupture ou critique » se lit desormais « plan
    // non couvert » et « attention » « sous la securite ».
    super::couverture::etats(&state.db).await?.enrichir(&mut valeur, "statut");
    if let Some(a) = valeur.as_array_mut() {
        for l in a.iter_mut() {
            let mono = l["nb_sources"].as_i64().unwrap_or(1) <= 1;
            let classe_a = l["classe_abc"].as_str() == Some("A");
            let action = match l["statut"].as_str() {
                Some(super::couverture::statut::PLAN_NON_COUVERT) if mono => "Commander et qualifier une seconde source",
                Some(super::couverture::statut::PLAN_NON_COUVERT) => "Commander cette semaine",
                _ if mono && classe_a => "Qualifier une seconde source sous 30 jours",
                Some(super::couverture::statut::SOUS_SECURITE) => "Surveiller, commander au prochain point",
                _ => "Aucune action",
            };
            if let Some(o) = l.as_object_mut() {
                o.insert("action_recommandee".into(), json!(action));
            }
        }
    }
    user.masquer(&state.db, module::PLAN_ACHAT, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Les six zones du cockpit, en un seul appel.
///
/// UN APPEL ET NON SIX. Le poste de travail affiche tout d'un coup ; six
/// requetes paralleles arriveraient dans le desordre et feraient sautiller la
/// page pendant une seconde. Les agregats sont petits — quelques dizaines de
/// lignes chacun — et le cout d'une jointure de plus est nul a cote.
///
/// Chaque bloc est une VUE : la regle de calcul se relit en SQL, pas dans du
/// Rust qui l'aurait reecrite — sauf L'ETAT DE COUVERTURE (tranches de
/// couverture, statuts, alertes, references en alerte), qui vient du MOTEUR DE
/// COUVERTURE depuis le 27/10/2026 : une seule source de verite.
pub async fn cockpit_analyse(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::COCKPIT, Action::Lire).await?;

    async fn bloc(db: &crate::db::Db, sql: &str) -> AppResult<Value> {
        let lignes = sqlx::query(sql).fetch_all(db).await?;
        Ok(lignes_en_json(&lignes))
    }
    use super::couverture::statut as etat;
    let etats = super::couverture::etats(&state.db).await?;

    // LES TRANCHES DE COUVERTURE : les jours couverts par le moteur, de
    // aujourd'hui a la veille de la premiere rupture ; sans rupture, couvert sur
    // tout l'horizon du plan.
    let tranches: [(i64, &str, i64, i64); 6] = [
        (1, "Rupture aujourd'hui", 0, 1),
        (2, "1-30 j", 1, 30),
        (3, "30-60 j", 30, 60),
        (4, "60-90 j", 60, 90),
        (5, "90-180 j", 90, 180),
        (6, ">180 j", 180, i64::MAX),
    ];
    let mut couverture: Vec<Value> = tranches
        .iter()
        .map(|(rang, libelle, min, max)| {
            let n = etats
                .suivies()
                .filter(|e| e.jours_couverture.is_some_and(|j| j >= *min && j < *max))
                .count();
            json!({ "rang": rang, "libelle": libelle, "nb_references": n })
        })
        .collect();
    couverture.push(json!({
        "rang": 7, "libelle": "Couvert sur tout l'horizon",
        "nb_references": etats.suivies().filter(|e| e.jours_couverture.is_none()).count(),
    }));

    let mut mono_source = bloc(&state.db, "SELECT * FROM v_cockpit_mono_source ORDER BY budget_annuel_mad DESC").await?;
    etats.enrichir(&mut mono_source, "statut");
    if let Some(a) = mono_source.as_array_mut() {
        a.retain(|l| l["statut"].as_str().is_some_and(|s| s != etat::COUVERT));
        a.truncate(20);
    }
    let mut pareto = bloc(&state.db, "SELECT * FROM v_cockpit_pareto ORDER BY rang LIMIT 30").await?;
    etats.enrichir(&mut pareto, "statut");

    // L'etat par classe ABC, au sens du moteur.
    let abc_statut: Vec<Value> = ["A", "B", "C"]
        .iter()
        .filter_map(|classe| {
            let de_la_classe: Vec<&super::couverture::Etat> =
                etats.suivies().filter(|e| e.classe_abc.as_deref().map(str::trim) == Some(*classe)).collect();
            (!de_la_classe.is_empty()).then(|| {
                let n = |s: &str| de_la_classe.iter().filter(|e| e.statut == s).count();
                json!({ "classe_abc": classe, "en_alerte": n(etat::PLAN_NON_COUVERT),
                        "attention": n(etat::SOUS_SECURITE), "ok": n(etat::COUVERT) })
            })
        })
        .collect();

    // ZONE 2 DU COCKPIT DU CLASSEUR : les references en tension au moteur, les
    // plus graves et les plus proches de la rupture d'abord, avec ce que le moteur
    // propose de commander.
    let tension: Vec<&super::couverture::Etat> = etats.en_tension().into_iter().take(24).collect();
    let codes_tension: Vec<String> = tension.iter().map(|e| e.code_reference.clone()).collect();
    let complements = bloc_lie(
        &state.db,
        "SELECT sp.code_reference, cat.libelle AS categorie_libelle, r.couleur, sp.unite_catalogue,
                sp.stock_physique_net_kg
           FROM v_stock_reference sp
           JOIN reference r ON r.code_reference = sp.code_reference
           LEFT JOIN categorie_matiere cat ON cat.code_categorie = r.code_categorie
          WHERE sp.code_reference = ANY($1)",
        &codes_tension,
    )
    .await?;
    let alertes: Vec<Value> = tension
        .iter()
        .map(|e| {
            let mut o = json!({
                "code_reference": e.code_reference, "designation": e.designation,
                "fournisseur_nom": e.fournisseur_nom, "delai_livraison_jours": e.delai_j,
            });
            if let (Some(m), Some(c)) = (
                o.as_object_mut(),
                complements
                    .as_array()
                    .and_then(|a| a.iter().find(|c| c["code_reference"].as_str() == Some(e.code_reference.as_str())))
                    .and_then(Value::as_object),
            ) {
                for (k, v) in c {
                    m.entry(k.clone()).or_insert_with(|| v.clone());
                }
                m.extend(e.colonnes());
            }
            o
        })
        .collect();
    let plan_non_couvert: Vec<String> = etats
        .suivies()
        .filter(|e| e.statut == etat::PLAN_NON_COUVERT)
        .map(|e| e.code_reference.clone())
        .collect();

    let economies = economies_au_plan(&state.db, &etats).await?;
    let mut sortie = serde_json::json!({
        "couverture":   couverture,
        "cout_mensuel": bloc(&state.db, "SELECT * FROM v_cockpit_cout_mensuel ORDER BY annee_mois").await?,
        // Les economies : une PROJECTION, au plan du moteur (27/10/2026).
        "economies":    Value::Array(economies.iter().take(20).cloned().collect()),
        "devises":      bloc(&state.db, "SELECT * FROM v_cockpit_devise ORDER BY montant_mad DESC").await?,
        "mono_source":  mono_source,
        // Le Pareto ne montre que le haut de la courbe : au-dela de trente
        // references les barres deviennent illisibles et le cumul plat.
        "pareto":       pareto,
        "fournisseurs": bloc(&state.db,
            "SELECT f.nom AS fournisseur_nom,
                    COUNT(*) AS nb_references,
                    -- La depense REELLE des 12 mois pleins (grand livre, valeur au
                    -- livre, 27/10/2026) : un constat de la concentration.
                    ROUND(SUM(sp.valeur_reel_12m_mad), 2) AS budget_annuel_mad
               FROM v_stock_reference sp
               JOIN fournisseur f ON f.code_fournisseur = sp.code_fournisseur
              GROUP BY f.nom
              -- L'expression est repetee plutot que citee par son alias :
              -- HAVING s'evalue AVANT la projection, donc avant que l'alias
              -- existe. SQLite l'admettait, la norme SQL non. `ORDER BY`, lui,
              -- s'evalue APRES : l'alias y est legitime.
              HAVING SUM(sp.valeur_reel_12m_mad) > 0
              ORDER BY budget_annuel_mad DESC
              LIMIT 10").await?,
        "abc_statut":   abc_statut,
        "alertes":      alertes,
    });

    // LES INDICATEURS DE LA ZONE 5 DU CLASSEUR qui manquaient. Une seule ligne.
    //
    // La couverture du stock est celle du MOTEUR (27/10/2026), ponderee par la
    // valeur du stock physique (couverture_du_stock) : plus une division.
    // Les economies (AU PLAN) sont sommees sur TOUTES les opportunites — l'ecran n'en
    // montre que cinq, et en additionnait vingt — une reference presente dans
    // deux groupes d'equivalence ne compte qu'une fois, a sa meilleure economie.
    let ind = sqlx::query(
        "SELECT
           (SELECT COUNT(*) FROM reference WHERE actif = 1 AND classe_abc = 'A')      AS nb_classe_a,
           (SELECT COUNT(*) FROM reference WHERE actif = 1 AND classe_abc = 'B')      AS nb_classe_b,
           (SELECT COUNT(*) FROM reference WHERE actif = 1 AND classe_abc = 'C')      AS nb_classe_c,
           (SELECT COUNT(*) FROM reference WHERE actif = 1 AND classe_abc IS NULL)    AS nb_non_classees,
           (SELECT ROUND(AVG(ABS(ecart_pct)), 2) FROM v_archive_reception_courante
             WHERE ecart_pct IS NOT NULL)                                             AS ecart_pesee_moyen_pct,
           -- Le budget des propositions ouvertes des references au plan non
           -- couvert (moteur de couverture, 27/10/2026).
           (SELECT ROUND(COALESCE(SUM(COALESCE(montant_total_mad, quantite_suggeree_kg * prix_estime_mad)), 0), 2)
              FROM plan_achat
             WHERE statut IN ('PROPOSE', 'EN_REVISION', 'VALIDE')
               AND code_reference = ANY($1))                                          AS budget_ruptures_mad,
           (SELECT ROUND(COALESCE(SUM(valeur_mad), 0), 2) FROM v_stock_dormant)      AS valeur_dormante_mad,
           (SELECT ROUND(100.0 * COALESCE((SELECT SUM(valeur_mad) FROM v_stock_dormant), 0)
                         / NULLIF(SUM(valeur_mad), 0), 1)
              FROM stock_magasin)                                                     AS pct_valeur_dormante",
    )
    .bind(&plan_non_couvert)
    .fetch_all(&state.db)
    .await?;
    if let Some(mut ligne) = lignes_en_json(&ind).as_array().and_then(|a| a.first()).cloned() {
        if let Some(o) = ligne.as_object_mut() {
            o.insert("nb_refs_en_alerte".into(), json!(etats.suivies().filter(|e| e.en_tension()).count()));
            o.insert("couverture_ponderee_jours".into(), json!(couverture_du_stock(&state.db, &etats).await?));
            let (total, nb) = total_economies(&economies);
            o.insert("economies_total_mad".into(), json!(total));
            o.insert("nb_opportunites".into(), json!(nb));
        }
        sortie["indicateurs"] = ligne;
    }

    // Les indicateurs de tresorerie. DSO vient d'un parametre : sans module de
    // vente, l'ERP ne peut pas le mesurer — il le declare, et l'ecran le dit.
    let kpi: Option<(f64, f64, f64, f64, i64)> = sqlx::query_as(
        // Les quatre premieres colonnes quittent le domaine exact pour le
        // calcul de DIO, DPO et du cycle de conversion — des ratios en jours,
        // ou le flottant convient. `::float8` le dit explicitement.
        // `AS numeric` de SQLite devient `numeric` puis `float8` : deux etapes,
        // parce que le parametre est stocke en TEXTE et qu'un texte ne se
        // convertit pas directement en flottant sans passer par le decimal.
        //
        // LA VALEUR DU STOCK est celle de la tuile « Valeur du stock » et de la
        // Valorisation : tous les magasins, chacun a son CMUP. Trois ecrans
        // donnaient trois chiffres.
        // LE DPO est pondere par le budget annuel : un fournisseur a 180 jours
        // qui porte 40 % des achats pese plus qu'un fournisseur de plastique.
        "SELECT
           (SELECT ROUND(COALESCE(SUM(valeur_mad), 0), 2) FROM stock_magasin)::float8,
           -- LE COUT MATIERE est le REEL des 12 mois pleins (grand livre : consommation
           -- et rebut, retours deduits, valeur au livre ; 27/10/2026) : DIO, rotation et
           -- DPO sont des constats, ils ne lisent plus le « plus grand » du reel et du plan.
           ROUND(COALESCE(SUM(sp.valeur_reel_12m_mad), 0), 2)::float8,
           ROUND(COALESCE(
               SUM(f.delai_paiement_jours * sp.valeur_reel_12m_mad)
               / NULLIF(SUM(CASE WHEN f.delai_paiement_jours IS NOT NULL
                                 THEN sp.valeur_reel_12m_mad END), 0),
               AVG(f.delai_paiement_jours), 0), 1)::float8,
           (SELECT CAST(valeur_courante AS numeric)::float8 FROM parametre
             WHERE code_parametre = 'P_DSODefaut'),
           COUNT(*)
         FROM v_stock_reference sp
         LEFT JOIN fournisseur f ON f.code_fournisseur = sp.code_fournisseur",
    )
    .fetch_optional(&state.db)
    .await?;

    if let Some((valeur_stock, cout_annuel, dpo, dso, _n)) = kpi {
        // DIO : combien de jours de consommation le stock represente.
        // Rotation : combien de fois il tourne dans l'annee.
        // CCC = DIO + DSO - DPO. Negatif, le fournisseur finance le cycle.
        let dio = if cout_annuel > 0.0 { valeur_stock / cout_annuel * 365.0 } else { 0.0 };
        let rotation = if valeur_stock > 0.0 { cout_annuel / valeur_stock } else { 0.0 };
        sortie["tresorerie"] = serde_json::json!({
            "valeur_stock_mad":        valeur_stock,
            "cout_matiere_annuel_mad": cout_annuel,
            "dio_jours":               (dio * 10.0).round() / 10.0,
            "dso_jours":               dso,
            "dpo_jours":               dpo,
            "ccc_jours":               ((dio + dso - dpo) * 10.0).round() / 10.0,
            "rotation_annuelle":       (rotation * 100.0).round() / 100.0,
            "dso_est_un_parametre":    true,
        });
    }

    user.masquer(&state.db, module::COCKPIT, &mut sortie).await?;
    Ok(Json(sortie))
}

/// LES ECONOMIES IDENTIFIEES, AU PLAN (27/10/2026) : une projection — l'ecart entre
/// le prix d'une reference et le moins cher de son groupe d'equivalence, applique
/// au plan des douze prochains mois (plan / mois du moteur x 12). La vue
/// `v_cockpit_economies` rend les prix ; le moteur, le plan. Triees, la plus forte
/// d'abord ; une reference sans plan n'a pas d'economie a faire.
pub async fn economies_au_plan(db: &crate::db::Db, etats: &super::couverture::Etats) -> AppResult<Vec<Value>> {
    let lignes = lignes_en_json(&sqlx::query("SELECT * FROM v_cockpit_economies").fetch_all(db).await?);
    let mut sortie: Vec<Value> = Vec::new();
    for mut l in lignes.as_array().cloned().unwrap_or_default() {
        let code = l["code_reference"].as_str().unwrap_or_default().to_string();
        let plan_mois = etats.get(&code).map(|e| e.plan_mois_kg).unwrap_or(0.0);
        let (kg, economie) = crate::domain::couverture::economie_au_plan(
            l["prix_actuel_mad"].as_f64().unwrap_or(0.0),
            l["prix_min_mad"].as_f64().unwrap_or(0.0),
            plan_mois,
        );
        if economie <= 0.0 {
            continue;
        }
        if let Some(o) = l.as_object_mut() {
            o.insert("plan_mois_kg".into(), json!(plan_mois));
            o.insert("conso_annuelle_kg".into(), json!(kg));
            o.insert("economie_annuelle_mad".into(), json!(economie));
        }
        sortie.push(l);
    }
    sortie.sort_by(|a, b| {
        b["economie_annuelle_mad"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["economie_annuelle_mad"].as_f64().unwrap_or(0.0))
    });
    Ok(sortie)
}

/// Le total des economies et le nombre de references : une reference presente
/// dans deux groupes d'equivalence ne compte qu'une fois, a sa meilleure economie.
pub fn total_economies(economies: &[Value]) -> (f64, usize) {
    let mut par_ref: HashMap<String, f64> = HashMap::new();
    for e in economies {
        let code = e["code_reference"].as_str().unwrap_or_default().to_string();
        let v = e["economie_annuelle_mad"].as_f64().unwrap_or(0.0);
        let m = par_ref.entry(code).or_insert(0.0);
        if v > *m {
            *m = v;
        }
    }
    let total: f64 = par_ref.values().sum();
    ((total * 100.0).round() / 100.0, par_ref.len())
}

/// LA COUVERTURE DU STOCK, AU MOTEUR (27/10/2026) : les jours couverts par le
/// moteur (jusqu'a la 1re rupture, sinon tout l'horizon), en moyenne ponderee par
/// la valeur en stock (physique net x CMUP) des references au plan. Plus une
/// division du stock par une consommation « retenue ».
async fn couverture_du_stock(db: &crate::db::Db, etats: &super::couverture::Etats) -> AppResult<Option<f64>> {
    let poids: Vec<(String, f64)> = sqlx::query_as(
        "SELECT code_reference, (GREATEST(stock_physique_net_kg, 0) * COALESCE(cmup_mad, 0))::float8
           FROM v_stock_reference",
    )
    .fetch_all(db)
    .await?;
    let horizon_j = etats.fin_horizon.map(|f| (f - etats.aujourdhui).num_days() + 1).unwrap_or(0);
    let lignes: Vec<(Option<i64>, f64)> = poids
        .into_iter()
        .filter_map(|(code, p)| {
            etats
                .get(&code)
                .filter(|e| e.suivie && e.plan_horizon_kg > 0.0)
                .map(|e| (e.jours_couverture, p))
        })
        .collect();
    Ok(crate::domain::couverture::couverture_ponderee(&lignes, horizon_j))
}

/// Une requete a un parametre tableau de textes, rendue en JSON.
async fn bloc_lie(db: &crate::db::Db, sql: &str, codes: &[String]) -> AppResult<Value> {
    let lignes = sqlx::query(sql).bind(codes).fetch_all(db).await?;
    Ok(lignes_en_json(&lignes))
}

/// Matrice des prix : une reference par ligne, un mois par colonne.
///
/// C'est la vue croisee de la feuille Matrice du classeur, et elle repond a une
/// question que la liste chronologique ne sait pas poser : « depuis quand cette
/// reference derive-t-elle ? ». En liste, il faut comparer deux lignes eloignees
/// de vingt achats ; en matrice, la ligne se lit d'un trait.
///
/// LE PRIX D'UN MOIS EST PONDERE PAR LES QUANTITES, pas moyenne simplement.
/// Deux achats le meme mois, l'un de 30 tonnes a 25 MAD et l'autre de 200 kg a
/// 40 MAD, donnent 25,1 et non 32,5 : la moyenne simple laisserait un
/// echantillon marginal peser autant qu'une commande de campagne. C'est la
/// formule du classeur, conservee telle quelle.
///
/// Le serveur agrege ; l'ecran ne fait que disposer. Croiser 124 references par
/// 36 mois cote navigateur demanderait de descendre toute la table a chaque
/// ouverture.
pub async fn matrice_prix(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<Filtres>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::CATALOGUE, Action::Lire).await?;

    let lignes = sqlx::query(
        "SELECT hp.code_reference,
                r.designation,
                r.code_fournisseur,
                fo.nom                                   AS fournisseur_nom,
                substr(hp.date_achat, 1, 7)              AS annee_mois,
                ROUND(SUM(hp.prix_kg_mad * hp.quantite_achetee_kg)
                      / NULLIF(SUM(hp.quantite_achetee_kg), 0), 4) AS prix_moyen_mad,
                ROUND(SUM(hp.quantite_achetee_kg), 4)    AS quantite_kg,
                COUNT(*)                                 AS nb_achats
           FROM v_historique_prix_courant hp
           JOIN reference r        ON r.code_reference   = hp.code_reference
           LEFT JOIN fournisseur fo ON fo.code_fournisseur = hp.code_fournisseur
          WHERE ($1 IS NULL OR hp.code_reference = $1)
          -- `r.designation` depend de `code_reference`, deja groupe : la citer
          -- ne change aucun resultat. SQLite la tolerait hors GROUP BY en
          -- prenant une ligne au hasard ; PostgreSQL l'exige.
          GROUP BY hp.code_reference, r.designation, r.code_fournisseur,
                   fo.nom, substr(hp.date_achat, 1, 7)
          ORDER BY hp.code_reference, annee_mois
          LIMIT $2",
    )
    .bind(&f.code_reference)
    .bind(f.limite() * 12)
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&lignes);
    user.masquer(&state.db, module::CATALOGUE, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Historique des prix d'achat : evolution par reference, et prix par bon.
///
/// La table `historique_prix` est immuable et n'enregistre que des prix
/// REELLEMENT payes, a la reception. C'est donc la seule source honnete pour
/// dire si un fournisseur derive — le prix catalogue, lui, est une intention.
pub async fn historique_prix(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<Filtres>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::CATALOGUE, Action::Lire).await?;

    let lignes = sqlx::query(
        // Le bon de commande n'est pas porte par l'historique : on y remonte par
        // la ligne de reception, seul chemin qui relie un prix PAYE a la commande
        // qui l'a engage.
        //
        // LAG donne le prix precedent de la MEME reference : l'evolution se lit
        // alors sans que l'ecran ait a recalculer quoi que ce soit.
        "SELECT hp.*, r.designation, fo.nom AS fournisseur_nom,
                bc.numero_bc, rec.numero_reception,
                LAG(hp.prix_kg_mad) OVER (PARTITION BY hp.code_reference
                                              ORDER BY hp.date_achat) AS prix_precedent_mad
           FROM v_historique_prix_courant hp
           JOIN reference   r  ON r.code_reference   = hp.code_reference
           LEFT JOIN fournisseur fo ON fo.code_fournisseur = hp.code_fournisseur
           LEFT JOIN ligne_reception lr ON lr.id_ligne_reception = hp.id_ligne_reception
           LEFT JOIN reception rec ON rec.id_reception = lr.id_reception
           LEFT JOIN bon_commande bc ON bc.id_bc = rec.id_bc
          WHERE ($1 IS NULL OR hp.code_reference = $1)
          ORDER BY hp.date_achat DESC, hp.code_reference
          LIMIT $2",
    )
    .bind(&f.code_reference)
    .bind(f.limite())
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&lignes);
    user.masquer(&state.db, module::CATALOGUE, &mut valeur).await?;
    Ok(Json(valeur))
}

#[derive(Debug, Deserialize)]
pub struct ModifProposition {
    pub quantite_suggeree_kg: Option<f64>,
    pub prix_estime_mad: Option<f64>,
    pub commentaires: Option<String>,
}

/// Ajuste une proposition avant de la convertir.
///
/// Le calcul propose, l'acheteur dispose : il connait un lot mini non declare,
/// une promotion, une contrainte de camion. Une proposition non modifiable
/// forcerait a convertir puis corriger le bon — donc a engager avant d'ajuster.
///
/// La proposition passe alors en EN_REVISION : elle reste convertible, mais on
/// voit qu'elle ne sort plus telle quelle du calcul.
pub async fn modifier_proposition(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(m): Json<ModifProposition>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Ecrire).await?;

    if let Some(q) = m.quantite_suggeree_kg {
        if q <= 0.0 {
            return Err(AppError::Invalide(
                "la quantite doit etre strictement positive".into(),
            ));
        }
    }
    if let Some(p) = m.prix_estime_mad {
        if p <= 0.0 {
            return Err(AppError::Invalide("le prix doit etre strictement positif".into()));
        }
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: String =
        sqlx::query_scalar("SELECT statut FROM plan_achat WHERE id_proposition = $1")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("proposition {id}")))?;
    if statut == "COMMANDE" || statut == "IGNORE" {
        return Err(AppError::RegleMetier(format!(
            "Une proposition {statut} ne se modifie plus."
        )));
    }

    // Retoucher, c'est deja decider : la ligne se fige d'elle-meme.
    //
    // Exiger un second geste (« modifier » puis « proteger ») garantirait qu'on
    // l'oublie, et le recalcul suivant effacerait le travail sans un mot — c'est
    // exactement ce qui se passait avant. Le motif se deduit de ce qui a change ;
    // l'acheteur peut le corriger ensuite.
    let deja_figee: i64 =
        sqlx::query_scalar("SELECT figee FROM plan_achat WHERE id_proposition = $1")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
    let touche_quantite = m.quantite_suggeree_kg.is_some();
    let motif = if touche_quantite { "QUANTITE_AJUSTEE" } else { "PRIX_NEGOCIE" };

    sqlx::query(
        "UPDATE plan_achat
            SET quantite_suggeree_kg = COALESCE($2, quantite_suggeree_kg),
                quantite_suggeree_unite = CASE
                    WHEN $2 IS NULL THEN quantite_suggeree_unite
                    -- La quantite en unite de conditionnement suit la quantite en
                    -- kg : les laisser diverger ferait commander deux nombres
                    -- differents selon la colonne lue.
                    WHEN unite_saisie = 'kg' OR unite_saisie IS NULL THEN $2
                    -- `round(double precision, integer)` n'existe pas : le `::numeric`
                    -- manquait, et CHAQUE modification de proposition echouait.
                    ELSE ROUND($2::numeric * quantite_suggeree_unite / quantite_suggeree_kg, 4)
                END,
                prix_estime_mad = COALESCE($3, prix_estime_mad),
                -- LE PRIX EN DEVISE SUIT LE PRIX NEGOCIE. L'acheteur discute
                -- en dollars ou en euros ; c'est le montant en dirhams qui en
                -- decoule, jamais l'inverse. Sans cette ligne, negocier un
                -- rabais laissait la colonne « Montant devise » afficher
                -- l'ancien chiffre — celui-la meme qu'on met sur le bon.
                prix_devise = CASE
                    WHEN $3 IS NULL OR COALESCE(taux_devise, 0) <= 0 THEN prix_devise
                    ELSE ROUND($3::numeric / taux_devise, 4)
                END,
                montant_devise = CASE
                    WHEN prix_devise IS NULL THEN montant_devise
                    ELSE ROUND(COALESCE($2::numeric, quantite_suggeree_kg)
                               * CASE WHEN $3 IS NULL OR COALESCE(taux_devise, 0) <= 0
                                      THEN prix_devise ELSE $3::numeric / taux_devise END, 2)
                END,
                palettes_a_commander = CASE
                    WHEN $2 IS NULL OR palettes_a_commander IS NULL
                         OR quantite_suggeree_kg <= 0 THEN palettes_a_commander
                    ELSE CEIL(palettes_a_commander * $2::numeric / quantite_suggeree_kg)::bigint
                END,
                commentaires    = COALESCE($4, commentaires),
                statut          = 'EN_REVISION',
                -- Ce que le calcul proposait AVANT la retouche, garde une seule
                -- fois : une seconde modification ne doit pas effacer le chiffre
                -- d'origine, sinon l'ecart affiche ne se rapporte plus a rien.
                quantite_mrp_kg = COALESCE(quantite_mrp_kg, quantite_suggeree_kg),
                figee                   = 1,
                id_utilisateur_figement = COALESCE(id_utilisateur_figement, $5),
                date_figement           = COALESCE(date_figement, fn_instant($6)),
                motif_figement          = COALESCE(motif_figement, $7)
          WHERE id_proposition = $1",
    )
    .bind(&id)
    .bind(m.quantite_suggeree_kg)
    .bind(m.prix_estime_mad)
    .bind(&m.commentaires)
    .bind(&user.id)
    .bind(crate::db::maintenant())
    .bind(motif)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({
        "id_proposition": id,
        "statut": "EN_REVISION",
        "figee": true,
        "figement_nouveau": deja_figee == 0,
        "motif_figement": motif
    })))
}

#[derive(Debug, Deserialize)]
pub struct DemandeFigement {
    pub motif_figement: Option<String>,
    pub commentaires: Option<String>,
}

/// Protege une proposition du prochain recalcul.
///
/// Le MRP ne connait ni le camion a remplir, ni le lot minimum non declare, ni
/// la remise obtenue au telephone. Quand l'acheteur a arbitre, sa ligne doit
/// survivre au calcul suivant — sans quoi il cesse de s'en servir et refait ses
/// arrondis dans un tableur, hors du systeme.
///
/// Figer ne fige PAS le besoin : le calcul continue de dire ce qu'il faudrait
/// acheter, et l'ecart se lit sur la ligne. Une protection qui rendrait aveugle
/// serait pire que pas de protection du tout.
pub async fn figer_proposition(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(d): Json<DemandeFigement>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Ecrire).await?;

    const MOTIFS: [&str; 5] = [
        "PRIX_NEGOCIE",
        "QUANTITE_AJUSTEE",
        "LIVRAISON_GROUPEE",
        "DELAI_FOURNISSEUR",
        "AUTRE",
    ];
    let motif = d.motif_figement.as_deref().unwrap_or("AUTRE");
    if !MOTIFS.contains(&motif) {
        return Err(AppError::Invalide(format!(
            "motif de figement inconnu : {motif} (attendu : {})",
            MOTIFS.join(", ")
        )));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: String =
        sqlx::query_scalar("SELECT statut FROM plan_achat WHERE id_proposition = $1")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("proposition {id}")))?;
    if statut == "COMMANDE" || statut == "IGNORE" {
        return Err(AppError::RegleMetier(format!(
            "Une proposition {statut} n'a plus rien a proteger : elle est deja engagee ou ecartee."
        )));
    }

    sqlx::query(
        "UPDATE plan_achat
            SET figee = 1,
                id_utilisateur_figement = $2,
                date_figement           = fn_instant($3),
                motif_figement          = $4,
                commentaires            = COALESCE($5, commentaires),
                quantite_mrp_kg         = COALESCE(quantite_mrp_kg, quantite_suggeree_kg)
          WHERE id_proposition = $1",
    )
    .bind(&id)
    .bind(&user.id)
    .bind(crate::db::maintenant())
    .bind(motif)
    .bind(&d.commentaires)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "id_proposition": id, "figee": true, "motif_figement": motif })))
}

/// Rend une proposition au calcul.
///
/// La ligne redevient jetable : le prochain recalcul la remplacera par ce que le
/// MRP dit aujourd'hui. C'est le geste a faire quand l'arbitrage est perime —
/// le plan a change, le fournisseur s'est desiste, la quantite arrondie n'a plus
/// de sens.
pub async fn defiger_proposition(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let ligne: Option<(i64, String)> = sqlx::query_as(
        "SELECT figee, statut FROM plan_achat WHERE id_proposition = $1",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    let (figee, statut) = ligne.ok_or_else(|| AppError::Introuvable(format!("proposition {id}")))?;
    if figee == 0 {
        return Err(AppError::RegleMetier(
            "Cette proposition n'est pas figee : elle suit deja le calcul.".into(),
        ));
    }
    if statut == "COMMANDE" || statut == "IGNORE" {
        return Err(AppError::RegleMetier(format!(
            "Une proposition {statut} ne revient pas au calcul."
        )));
    }

    // L'auteur et la date du figement RESTENT : savoir que cette ligne a ete
    // protegee puis rendue au calcul vaut mieux que de faire disparaitre le
    // passage. Seul le drapeau retombe.
    sqlx::query("UPDATE plan_achat SET figee = 0 WHERE id_proposition = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(Json(json!({ "id_proposition": id, "figee": false })))
}

/// Ecarte une proposition : elle n'engage rien et n'est plus reproposee
/// pendant P_DureeEcartJours (90 j, regle 17), puis le besoin revient.
pub async fn ignorer_proposition(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: String =
        sqlx::query_scalar("SELECT statut FROM plan_achat WHERE id_proposition = $1")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("proposition {id}")))?;
    if statut == "COMMANDE" {
        return Err(AppError::RegleMetier(
            "Cette proposition a produit un bon de commande : annulez le bon pour la liberer."
                .into(),
        ));
    }

    // Ecarter, c'est renoncer : la protection n'a plus d'objet et tombe avec.
    sqlx::query("UPDATE plan_achat SET statut = 'IGNORE', figee = 0 WHERE id_proposition = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_proposition": id, "statut": "IGNORE" })))
}

// Les lignes de recette sont servies par le module `production`, qui porte
// aussi leur creation, leur modification et leur suppression.

pub async fn besoins_mrp(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MRP, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT bm.*, r.designation, r.code_fournisseur
           FROM besoin_mrp bm
           JOIN reference r ON r.code_reference = bm.code_reference
          WHERE bm.id_plan = $1
          ORDER BY bm.mois, bm.code_reference",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::MRP, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Feuille « Production_Besoins » : le plan en m2 et les besoins matiere en kg,
/// tous deux sur les mois de la periode glissante.
///
/// Deux blocs, comme dans le classeur : en haut le rappel de la production par
/// qualite, en bas l'explosion par reference. Les colonnes mensuelles sont
/// renvoyees a plat (une ligne par couple), le pivot se fait a l'affichage : une
/// API qui renverrait « M01..M12 » figerait l'horizon dans son contrat.
pub async fn production_besoins(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MRP, Action::Lire).await?;

    let plan = sqlx::query(
        "SELECT p.id_plan, p.libelle, p.scenario_nom, p.statut, p.date_debut, p.date_fin,
                p.mois_horizon, p.croissance_annuelle_pct, p.taux_perte_pct,
                p.m2_total_annuel, p.date_validation, p.date_cloture,
                (SELECT COUNT(*) FROM besoin_mrp b WHERE b.id_plan = p.id_plan) AS nb_besoins,
                (SELECT MAX(date_calcul) FROM besoin_mrp b WHERE b.id_plan = p.id_plan) AS dernier_calcul
           FROM plan_production p WHERE p.id_plan = $1",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("plan {id}")))?;

    // Les mois de la periode, dans l'ordre glissant : c'est l'ossature des deux
    // tableaux, et elle vient du plan, jamais d'un 1..12 suppose.
    let mois = sqlx::query(
        "SELECT DISTINCT rang_mois, mois, annee_mois FROM ligne_plan_production
          WHERE id_plan = $1 ORDER BY rang_mois",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let production = sqlx::query(
        "SELECT l.code_qualite, q.nom AS qualite_nom, q.poids_commercial_m2,
                l.mois, l.rang_mois, l.annee_mois, l.m2_prevus,
                l.m2_base_mensuel, l.saisonnalite
           FROM ligne_plan_production l
           JOIN qualite q ON q.code_qualite = l.code_qualite
          WHERE l.id_plan = $1
          ORDER BY l.code_qualite, l.rang_mois",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    // Le besoin est deja calcule et fige dans besoin_mrp (perte comprise) ; on
    // le rattache au mois glissant par le mois calendaire.
    let besoins = sqlx::query(
        "SELECT bm.code_reference, r.designation, r.code_categorie, c.libelle AS categorie,
                r.code_fournisseur, f.nom AS fournisseur, r.unite_catalogue, r.facteur_kg,
                bm.mois, lpm.rang_mois, lpm.annee_mois,
                bm.quantite_brute_kg, bm.taux_perte_applique, bm.quantite_kg
           FROM besoin_mrp bm
           JOIN reference r ON r.code_reference = bm.code_reference
           JOIN categorie_matiere c ON c.code_categorie = r.code_categorie
           JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
           LEFT JOIN (SELECT DISTINCT id_plan, mois, rang_mois, annee_mois
                        FROM ligne_plan_production) lpm
                  ON lpm.id_plan = bm.id_plan AND lpm.mois = bm.mois
          WHERE bm.id_plan = $1
          ORDER BY r.code_categorie, bm.code_reference, lpm.rang_mois",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let mut besoins_json = lignes_en_json(&besoins);
    user.masquer(&state.db, module::MRP, &mut besoins_json).await?;

    Ok(Json(json!({
        "plan": lignes_en_json(std::slice::from_ref(&plan)).get(0).cloned().unwrap_or(Value::Null),
        "mois": lignes_en_json(&mois),
        "production": lignes_en_json(&production),
        "besoins": besoins_json,
    })))
}

pub async fn mouvements(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<Filtres>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT m.numero_mouvement, m.date_mouvement::text AS date_mouvement, m.code_type_mvt, m.code_magasin,
                m.code_motif, m.reference_document, m.numero_of, u.login AS utilisateur,
                lm.ligne_numero, lm.code_reference, lm.quantite_kg, lm.prix_kg_mad,
                lm.total_mad, lm.lot_fournisseur, tm.signe
           FROM ligne_mouvement lm
           JOIN mouvement      m  ON m.id_mouvement   = lm.id_mouvement
           JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
           JOIN utilisateur    u  ON u.id_utilisateur = m.id_utilisateur
          WHERE ($1 IS NULL OR lm.code_reference = $1)
          ORDER BY m.date_mouvement DESC, lm.ligne_numero
          LIMIT $2",
    )
    .bind(&f.code_reference)
    .bind(f.limite())
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::MOUVEMENTS, &mut valeur).await?;
    Ok(Json(valeur))
}

pub async fn audit(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<Filtres>,
) -> AppResult<Json<Value>> {
    // Seules la Direction et la DAF ont acces au journal d'audit (CDC D2).
    rbac::exiger(&state.db, &user.role, module::AUDIT, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT a.*, u.login AS auteur
           FROM audit_log a
           LEFT JOIN utilisateur u ON u.id_utilisateur = a.id_utilisateur
          ORDER BY a.date_operation DESC
          LIMIT $1",
    )
    .bind(f.limite())
    .fetch_all(&state.db)
    .await?;

    Ok(Json(lignes_en_json(&rows)))
}

/// Usages d'une reference du catalogue, et verdict de suppression.
///
/// Les cles etrangeres empechent deja de supprimer une reference utilisee, mais
/// elles le disent en « violates foreign key constraint » suivi du nom de la
/// contrainte — une cle technique, qui ne nomme ni la reference ni ce qui la
/// retient. Cet endpoint compte les usages
/// AVANT, pour que l'ecran puisse expliquer, et pour ne proposer le bouton que
/// lorsqu'il aboutira.
///
/// Le stock est traite a part : une reference a stock nul mais ayant deja
/// bouge reste indelebile, parce que son passage figure au grand livre.
pub async fn usages_reference(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::CATALOGUE, Action::Lire).await?;

    let ligne = sqlx::query(
        "SELECT
           (SELECT COUNT(*) FROM ligne_mouvement WHERE code_reference = $1) AS mouvements,
           (SELECT COUNT(*) FROM recette         WHERE code_reference = $1) AS recettes,
           (SELECT COUNT(*) FROM ligne_bc        WHERE code_reference = $1) AS lignes_bc,
           (SELECT COUNT(*) FROM ligne_reception WHERE code_reference = $1) AS receptions,
           (SELECT COUNT(*) FROM plan_achat      WHERE code_reference = $1) AS propositions,
           (SELECT COUNT(*) FROM historique_prix WHERE code_reference = $1) AS prix,
           (SELECT COUNT(*) FROM ligne_inventaire WHERE code_reference = $1) AS inventaires,
           (SELECT COUNT(*) FROM reference_groupe_equiv WHERE code_reference = $1) AS equivalences,
           (SELECT COALESCE(SUM(quantite_kg), 0) FROM stock_magasin
             WHERE code_reference = $1) AS stock_kg,
           (SELECT COUNT(*) FROM reference WHERE code_reference = $1) AS existe",
    )
    .bind(&code)
    .fetch_one(&state.db)
    .await?;

    let mut valeur = lignes_en_json(std::slice::from_ref(&ligne));
    let mut obj = valeur
        .get_mut(0)
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();

    let compte = |cle: &str| obj.get(cle).and_then(|v| v.as_i64()).unwrap_or(0);
    if compte("existe") == 0 {
        return Err(AppError::Introuvable(format!("Reference {code}")));
    }

    /* Le rattachement a un groupe d'equivalence ne retient pas la reference :
       il se defait sans perte. Tout le reste porte de l'histoire. */
    let retenants = [
        ("mouvements", "mouvement(s) de stock"),
        ("recettes", "ligne(s) de recette"),
        ("lignes_bc", "ligne(s) de bon de commande"),
        ("receptions", "ligne(s) de reception"),
        ("propositions", "proposition(s) d'achat"),
        ("prix", "entree(s) d'historique de prix"),
        ("inventaires", "ligne(s) d'inventaire"),
    ];

    let motifs: Vec<String> = retenants
        .iter()
        .filter(|(cle, _)| compte(cle) > 0)
        .map(|(cle, libelle)| format!("{} {libelle}", compte(cle)))
        .collect();

    let stock = obj.get("stock_kg").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let mut motifs = motifs;
    if stock.abs() > 0.0001 {
        motifs.push(format!("{stock} kg en stock"));
    }

    obj.insert("supprimable".into(), json!(motifs.is_empty()));
    obj.insert("motifs".into(), json!(motifs));
    Ok(Json(Value::Object(obj)))
}

/// L'identite de l'entreprise : raison sociale, adresse, mentions legales.
///
/// EN LECTURE POUR TOUT LE MONDE, sans exiger de droit particulier. Ces
/// informations figurent deja sur chaque document qui sort de l'entreprise :
/// les masquer a l'interieur n'aurait aucun sens, et le pied de page en a
/// besoin pour tous les roles.
///
/// Les coordonnees bancaires font exception et sont retirees pour qui n'a pas
/// acces au module ACHAT : elles n'apparaissent que sur les documents
/// commerciaux, et un changement de RIB frauduleux est une fraude classique.
/// `GET /api/actualite` — LE FIL DE CE QUI S'EST PASSE.
///
/// POURQUOI UNE PAGE D'ACCUEIL MONTRE DES FAITS, PAS DES BOUTONS. Elle
/// affichait trente liens ranges par section — le menu de gauche, recopie au
/// milieu de l'ecran. Un accueil qui ne propose que des destinations n'apprend
/// rien a celui qui l'ouvre ; celui-ci dit qui a enregistre quoi, quel bon est
/// parti, quelle reception attend un controle.
///
/// ON NE FILTRE PAS PAR DROITS LIGNE A LIGNE, et c'est un choix : le fil ne
/// porte que des titres de documents et des noms de magasins, jamais un prix ni
/// une quantite en valeur. Le seul montant qui y figure — celui d'un bon de
/// commande — est masque comme ailleurs par la grille de champs.
pub async fn actualite(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    // Tout compte connecte lit le fil : savoir que l'atelier a pese une
    // reception n'est un secret pour personne, et l'ignorer fait travailler
    // deux fois.
    let lignes = sqlx::query("SELECT * FROM v_actualite LIMIT 40")
        .fetch_all(&state.db)
        .await?;
    let mut sortie = lignes_en_json(&lignes);
    user.masquer(&state.db, module::COCKPIT, &mut sortie).await?;
    Ok(Json(sortie))
}

pub async fn entreprise(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    let lignes = sqlx::query("SELECT * FROM entreprise WHERE actif = 1 LIMIT 1")
        .fetch_all(&state.db)
        .await?;

    let mut valeur = lignes_en_json(&lignes);
    let Some(premiere) = valeur.as_array_mut().and_then(|a| a.first_mut()) else {
        return Ok(Json(json!({})));
    };

    // LES COORDONNEES BANCAIRES NE SORTENT QUE POUR QUI TRAITE LES ACHATS.
    // Elles figurent sur les documents commerciaux, donc elles n'ont rien de
    // secret — mais un changement de RIB frauduleux sur des bons de commande
    // est une escroquerie classique, et la premiere etape en est la lecture.
    if user
        .exiger(&state.db, module::BONS_COMMANDE, Action::Lire)
        .await
        .is_err()
    {
        if let Some(o) = premiere.as_object_mut() {
            o.remove("banques");
        }
    }
    Ok(Json(premiere.clone()))
}
