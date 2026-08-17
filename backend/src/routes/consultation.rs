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
}

impl Filtres {
    fn limite(&self) -> i64 {
        self.limite.unwrap_or(500).clamp(1, 5000)
    }
}

pub async fn sante(State(state): State<AppState>) -> AppResult<Json<Value>> {
    let tables: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
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

    let etat = sqlx::query("SELECT * FROM v_cockpit_stock")
        .fetch_all(&state.db)
        .await?;
    let files = sqlx::query("SELECT * FROM v_cockpit_files")
        .fetch_all(&state.db)
        .await?;

    let mut valeur = lignes_en_json(&etat)
        .as_array()
        .and_then(|a| a.first().cloned())
        .unwrap_or(Value::Null);

    if let (Some(objet), Some(f)) = (
        valeur.as_object_mut(),
        lignes_en_json(&files).as_array().and_then(|a| a.first().cloned()),
    ) {
        if let Some(champs) = f.as_object() {
            for (cle, v) in champs {
                objet.insert(cle.clone(), v.clone());
            }
        }
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

    let refs = sqlx::query(
        "SELECT * FROM v_risque_reference
          ORDER BY marge_decision_jours,
                   CASE classe_abc WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END,
                   nb_mois_rupture DESC
          LIMIT 60",
    )
    .fetch_all(&state.db)
    .await?;

    let mut liste = lignes_en_json(&refs);

    // Les frises ne sont lues que pour les references retenues : la vue couvre
    // tout le catalogue, et en ramener l'integralite pour n'en afficher que
    // soixante serait paye a chaque ouverture de l'accueil.
    let codes: Vec<String> = liste
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|r| r.get("code_reference").and_then(|c| c.as_str()))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    if !codes.is_empty() {
        let trous = std::iter::repeat("?").take(codes.len()).collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT code_reference, annee_mois, rang_mois, besoin_kg, entrees_kg,
                    stock_fin_kg, stock_min_kg, statut
               FROM v_risque_mensuel
              WHERE code_reference IN ({trous})
              ORDER BY code_reference, rang_mois"
        );
        let mut q = sqlx::query(&sql);
        for c in &codes {
            q = q.bind(c);
        }
        let mois = lignes_en_json(&q.fetch_all(&state.db).await?);

        if let (Some(tableau), Some(mois)) = (liste.as_array_mut(), mois.as_array()) {
            for r in tableau.iter_mut() {
                let code = r
                    .get("code_reference")
                    .and_then(|c| c.as_str())
                    .unwrap_or_default()
                    .to_string();
                let frise: Vec<Value> = mois
                    .iter()
                    .filter(|m| m.get("code_reference").and_then(|c| c.as_str()) == Some(&code))
                    .cloned()
                    .collect();
                if let Some(o) = r.as_object_mut() {
                    o.insert("mois".into(), Value::Array(frise));
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
          WHERE (?1 IS NULL OR code_reference     = ?1)
            AND (?2 IS NULL OR code_groupe_equiv  = ?2)
          ORDER BY code_groupe_equiv, priorite, equivalent_priorite",
    )
    .bind(&reference)
    .bind(&groupe)
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
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
          WHERE code_groupe_equiv = ?1 AND actif = 1",
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
          WHERE code_groupe_equiv = ?1 AND actif = 1",
    )
    .bind(&code_groupe)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE reference_groupe_equiv
            SET priorite = priorite + ?2, est_preferentielle = 0
          WHERE code_groupe_equiv = ?1 AND actif = 1",
    )
    .bind(&code_groupe)
    .bind(ecart)
    .execute(&mut *tx)
    .await?;

    for (rang, code) in o.references.iter().enumerate() {
        sqlx::query(
            "UPDATE reference_groupe_equiv
                SET priorite = ?3, est_preferentielle = ?4
              WHERE code_groupe_equiv = ?1 AND code_reference = ?2 AND actif = 1",
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
            "SELECT code_reference, statut, quantite_suggeree_kg, code_reference_origine
               FROM plan_achat WHERE id_proposition = ?1",
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
        "SELECT interchangeable FROM v_equivalence
          WHERE code_reference = ?1 AND equivalent_reference = ?2",
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
        sqlx::query_scalar("SELECT code_fournisseur FROM reference WHERE code_reference = ?1")
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
        "SELECT id_proposition, quantite_suggeree_kg, figee FROM plan_achat
          WHERE code_reference = ?1 AND statut IN ('PROPOSE','EN_REVISION','VALIDE')",
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
        sqlx::query(
            "UPDATE plan_achat
                SET quantite_suggeree_kg = ?2,
                    statut = 'EN_REVISION',
                    commentaires = TRIM(COALESCE(commentaires || ' | ', '') ||
                                        'Fusion du besoin de ' || ?3)
              WHERE id_proposition = ?1",
        )
        .bind(&id_cible)
        .bind(total)
        .bind(&code_actuel)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE plan_achat
                SET statut = 'IGNORE', figee = 0,
                    commentaires = TRIM(COALESCE(commentaires || ' | ', '') ||
                                        'Besoin reporte sur ' || ?2 || COALESCE(' : ' || ?3, ''))
              WHERE id_proposition = ?1",
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
                SET code_reference        = ?2,
                    code_fournisseur      = ?3,
                    code_reference_origine = COALESCE(?4, ?5),
                    motif_substitution    = ?6,
                    statut                = 'EN_REVISION'
              WHERE id_proposition = ?1",
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

pub async fn controles(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    lister(&state, &user, module::COCKPIT, "SELECT * FROM v_controles").await
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

    let vue = format!("v_ctl_{code}");
    let existe: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='view' AND name = ?1")
            .bind(&vue)
            .fetch_one(&state.db)
            .await?;
    if existe == 0 {
        return Err(AppError::Introuvable(format!("controle {code}")));
    }

    let rows = sqlx::query(&format!("SELECT * FROM {vue}"))
        .fetch_all(&state.db)
        .await?;
    Ok(Json(lignes_en_json(&rows)))
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
        "SELECT sm.*, r.designation, m.nom AS magasin_nom, m.inclure_mrp
           FROM stock_magasin sm
           JOIN reference r ON r.code_reference = sm.code_reference
           JOIN magasin   m ON m.code_magasin   = sm.code_magasin
          WHERE (?1 IS NULL OR sm.code_reference = ?1)
          ORDER BY sm.code_reference, sm.code_magasin
          LIMIT ?2",
    )
    .bind(&f.code_reference)
    .bind(f.limite())
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::STOCK, &mut valeur).await?;
    Ok(Json(valeur))
}

pub async fn stock_projete(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<Filtres>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT * FROM v_stock_projete
          WHERE (?1 IS NULL OR statut = ?1)
          ORDER BY CASE statut
                     WHEN 'RUPTURE'   THEN 1
                     WHEN 'CRITIQUE'  THEN 2
                     WHEN 'ATTENTION' THEN 3
                     ELSE 4 END,
                   jours_couverture
          LIMIT ?2",
    )
    .bind(&f.statut)
    .bind(f.limite())
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
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
    let rows = sqlx::query(
        "SELECT * FROM v_lot_fefo
          WHERE (?1 IS NULL OR code_reference = ?1)
          ORDER BY code_reference, rang_fefo
          LIMIT ?2",
    )
    .bind(&f.code_reference)
    .bind(f.limite())
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
    lister(
        &state,
        &user,
        module::STOCK,
        "SELECT * FROM v_substitution_dispo",
    )
    .await
}

pub async fn plan_achat(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    lister(
        &state,
        &user,
        module::PLAN_ACHAT,
        "SELECT * FROM v_plan_achat",
    )
    .await
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
        // `nb_equivalents` et `equivalent_dispo_kg` disent, sans second appel,
        // si un substitut existe et s'il a du stock. Sans ces deux nombres,
        // l'ecran devrait interroger l'equivalence reference par reference, et
        // l'acheteur ne verrait l'alternative qu'apres l'avoir cherchee.
        "SELECT pa.*, r.designation, r.unite_catalogue, f.nom AS fournisseur_nom,
                bc.numero_bc, bc.statut AS statut_bc,
                ro.designation AS designation_origine,
                uf.login AS figee_par,
                (SELECT COUNT(*) FROM v_equivalence e
                  WHERE e.code_reference = pa.code_reference)         AS nb_equivalents,
                (SELECT ROUND(COALESCE(MAX(e.equivalent_stock_kg), 0), 3)
                   FROM v_equivalence e
                  WHERE e.code_reference = pa.code_reference
                    AND e.interchangeable = 1)                        AS equivalent_dispo_kg,

                -- L'ECART se calcule A LA LECTURE, jamais stocke. Le projet
                -- procede deja ainsi pour le besoin fige d'une ligne de commande
                -- (cf. convertir() dans domain/plan_achat.rs) : une alerte
                -- enregistree serait perimee des le recalcul suivant, alors
                -- qu'une comparaison faite maintenant ne peut pas mentir.
                (SELECT ROUND(vpa.qte_a_commander_kg, 3) FROM v_plan_achat vpa
                  WHERE vpa.code_reference = pa.code_reference)       AS quantite_calculee_kg,
                CASE WHEN pa.figee = 1 THEN ROUND(
                    pa.quantite_suggeree_kg
                  - COALESCE((SELECT vpa.qte_a_commander_kg FROM v_plan_achat vpa
                               WHERE vpa.code_reference = pa.code_reference), 0), 3)
                END                                                   AS ecart_calcul_kg,
                CASE
                    WHEN pa.figee = 0 THEN NULL
                    WHEN r.actif = 0 THEN 'REFERENCE_INACTIVE'
                    WHEN NOT EXISTS (SELECT 1 FROM v_plan_achat vpa
                                      WHERE vpa.code_reference = pa.code_reference)
                         THEN 'BESOIN_DISPARU'
                    -- 2 % de tolerance : un arrondi a la palette cree toujours un
                    -- petit ecart, et le signaler noierait les vrais.
                    WHEN ABS(pa.quantite_suggeree_kg
                           - (SELECT vpa.qte_a_commander_kg FROM v_plan_achat vpa
                               WHERE vpa.code_reference = pa.code_reference))
                         <= 0.02 * pa.quantite_suggeree_kg THEN 'COHERENTE'
                    WHEN pa.quantite_suggeree_kg
                       > (SELECT vpa.qte_a_commander_kg FROM v_plan_achat vpa
                           WHERE vpa.code_reference = pa.code_reference)
                         THEN 'SURDIMENSIONNEE'
                    ELSE 'SOUS_DIMENSIONNEE'
                END                                                   AS etat_figement
           FROM plan_achat pa
           JOIN reference r    ON r.code_reference     = pa.code_reference
           JOIN fournisseur f  ON f.code_fournisseur   = pa.code_fournisseur
           LEFT JOIN reference ro    ON ro.code_reference = pa.code_reference_origine
           LEFT JOIN utilisateur uf  ON uf.id_utilisateur = pa.id_utilisateur_figement
           LEFT JOIN bon_commande bc ON bc.id_bc       = pa.id_bc_genere
          ORDER BY CASE pa.urgence WHEN 'TIER 1' THEN 1 WHEN 'TIER 2' THEN 2
                                   WHEN 'TIER 3' THEN 3 ELSE 4 END,
                   pa.code_fournisseur, pa.code_reference",
    )
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::PLAN_ACHAT, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Tableau de bord du plan d'achat, reproduisant les blocs de la feuille.
///
/// Tout se lit dans `v_stock_projete` — c'est le point que la feuille rend
/// evident et que l'ecran avait perdu : le plan d'achat n'est pas une table
/// autonome, c'est une LECTURE DU STOCK. Une reference apparait parce que son
/// stock projete est passe sous son minimum, pas parce que quelqu'un l'a saisie.
pub async fn kpi_plan_achat(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Lire).await?;

    // Bloc « KPI globaux » et bloc « repartition par statut » de la feuille.
    let globaux = sqlx::query(
        "SELECT
            (SELECT COUNT(*) FROM v_stock_projete WHERE statut <> 'OK')        AS refs_en_alerte,
            (SELECT COUNT(*) FROM v_stock_projete WHERE statut = 'RUPTURE')    AS ruptures,
            (SELECT COUNT(*) FROM v_stock_projete WHERE statut = 'CRITIQUE')   AS critiques,
            -- Le sur-stock n'est PAS un statut : c'est un second axe, compte a
            -- part. Le placer dans l'echelle interceptait 72 references sur 124
            -- et eteignait la couche logique.
            (SELECT COUNT(*) FROM v_stock_projete WHERE sur_stock = 1)         AS sur_stock,
            (SELECT COUNT(*) FROM v_stock_projete WHERE statut = 'ATTENTION')  AS attention,
            (SELECT COUNT(*) FROM v_stock_projete WHERE statut = 'OK')         AS ok,
            (SELECT COUNT(*) FROM v_stock_projete
              WHERE statut <> 'OK' AND classe_abc = 'A')                       AS classe_a_en_alerte,
            (SELECT COALESCE(ROUND(SUM(montant_estime_mad), 2), 0) FROM v_plan_achat) AS budget_mad,
            (SELECT COALESCE(ROUND(SUM(qte_a_commander_kg), 2), 0) FROM v_plan_achat) AS quantite_kg,
            (SELECT COUNT(*) FROM v_plan_achat)                                AS refs_a_commander",
    )
    .fetch_one(&state.db)
    .await?;

    // Bloc « tiering urgence » : combien de references dans chaque palier.
    let tiering = sqlx::query(
        "SELECT tier, COUNT(*) AS nb, ROUND(SUM(montant_estime_mad), 2) AS montant_mad
           FROM v_plan_achat GROUP BY tier ORDER BY tier",
    )
    .fetch_all(&state.db)
    .await?;

    // Bloc « risques identifies » : mono-source et exposition par devise.
    let risques = sqlx::query(
        "SELECT 'MONO-SOURCE' AS risque, COUNT(*) AS nb,
                ROUND(COALESCE(SUM(montant_estime_mad), 0), 2) AS montant_mad
           FROM v_plan_achat WHERE risque_sourcing = 'MONO-SOURCE'
         UNION ALL
         SELECT 'DEVISE ' || f.code_devise, COUNT(*),
                ROUND(COALESCE(SUM(pa.montant_estime_mad), 0), 2)
           FROM v_plan_achat pa
           JOIN fournisseur f ON f.code_fournisseur = pa.code_fournisseur
          GROUP BY f.code_devise",
    )
    .fetch_all(&state.db)
    .await?;

    // Bloc « repartition par fournisseur », classe par budget decroissant.
    let fournisseurs = sqlx::query(
        "SELECT pa.code_fournisseur, f.nom AS fournisseur_nom, f.pays, f.code_devise,
                f.delai_livraison_jours, f.contact_principal, f.ville,
                COUNT(*)                                       AS nb_references,
                ROUND(SUM(pa.qte_a_commander_kg), 2)           AS quantite_kg,
                ROUND(SUM(pa.montant_estime_mad), 2)           AS montant_mad,
                SUM(CASE WHEN pa.tier = 'TIER 1' THEN 1 ELSE 0 END) AS nb_tier1,
                SUM(CASE WHEN pa.statut = 'RUPTURE' THEN 1 ELSE 0 END) AS nb_ruptures
           FROM v_plan_achat pa
           JOIN fournisseur f ON f.code_fournisseur = pa.code_fournisseur
          GROUP BY pa.code_fournisseur
          ORDER BY montant_mad DESC",
    )
    .fetch_all(&state.db)
    .await?;

    let mut sortie = json!({
        // Une seule ligne : on la sort du tableau pour que l'ecran lise
        // `globaux.budget_mad` et non `globaux[0].budget_mad`.
        "globaux": lignes_en_json(std::slice::from_ref(&globaux))
            .as_array().and_then(|a| a.first().cloned()).unwrap_or(Value::Null),
        "tiering": lignes_en_json(&tiering),
        "risques": lignes_en_json(&risques),
        "fournisseurs": lignes_en_json(&fournisseurs),
    });
    user.masquer(&state.db, module::PLAN_ACHAT, &mut sortie).await?;
    Ok(Json(sortie))
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
           FROM historique_prix hp
           JOIN reference   r  ON r.code_reference   = hp.code_reference
           LEFT JOIN fournisseur fo ON fo.code_fournisseur = hp.code_fournisseur
           LEFT JOIN ligne_reception lr ON lr.id_ligne_reception = hp.id_ligne_reception
           LEFT JOIN reception rec ON rec.id_reception = lr.id_reception
           LEFT JOIN bon_commande bc ON bc.id_bc = rec.id_bc
          WHERE (?1 IS NULL OR hp.code_reference = ?1)
          ORDER BY hp.date_achat DESC, hp.code_reference
          LIMIT ?2",
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
        sqlx::query_scalar("SELECT statut FROM plan_achat WHERE id_proposition = ?1")
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
        sqlx::query_scalar("SELECT figee FROM plan_achat WHERE id_proposition = ?1")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
    let touche_quantite = m.quantite_suggeree_kg.is_some();
    let motif = if touche_quantite { "QUANTITE_AJUSTEE" } else { "PRIX_NEGOCIE" };

    sqlx::query(
        "UPDATE plan_achat
            SET quantite_suggeree_kg = COALESCE(?2, quantite_suggeree_kg),
                quantite_suggeree_unite = CASE
                    WHEN ?2 IS NULL THEN quantite_suggeree_unite
                    -- La quantite en unite de conditionnement suit la quantite en
                    -- kg : les laisser diverger ferait commander deux nombres
                    -- differents selon la colonne lue.
                    WHEN unite_saisie = 'kg' OR unite_saisie IS NULL THEN ?2
                    ELSE ROUND(?2 * quantite_suggeree_unite / quantite_suggeree_kg, 4)
                END,
                prix_estime_mad = COALESCE(?3, prix_estime_mad),
                commentaires    = COALESCE(?4, commentaires),
                statut          = 'EN_REVISION',
                -- Ce que le calcul proposait AVANT la retouche, garde une seule
                -- fois : une seconde modification ne doit pas effacer le chiffre
                -- d'origine, sinon l'ecart affiche ne se rapporte plus a rien.
                quantite_mrp_kg = COALESCE(quantite_mrp_kg, quantite_suggeree_kg),
                figee                   = 1,
                id_utilisateur_figement = COALESCE(id_utilisateur_figement, ?5),
                date_figement           = COALESCE(date_figement, ?6),
                motif_figement          = COALESCE(motif_figement, ?7)
          WHERE id_proposition = ?1",
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
        sqlx::query_scalar("SELECT statut FROM plan_achat WHERE id_proposition = ?1")
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
                id_utilisateur_figement = ?2,
                date_figement           = ?3,
                motif_figement          = ?4,
                commentaires            = COALESCE(?5, commentaires),
                quantite_mrp_kg         = COALESCE(quantite_mrp_kg, quantite_suggeree_kg)
          WHERE id_proposition = ?1",
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
        "SELECT figee, statut FROM plan_achat WHERE id_proposition = ?1",
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
    sqlx::query("UPDATE plan_achat SET figee = 0 WHERE id_proposition = ?1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(Json(json!({ "id_proposition": id, "figee": false })))
}

/// Ecarte une proposition : elle n'engage rien et ne sera plus reproposee.
pub async fn ignorer_proposition(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLAN_ACHAT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: String =
        sqlx::query_scalar("SELECT statut FROM plan_achat WHERE id_proposition = ?1")
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
    sqlx::query("UPDATE plan_achat SET statut = 'IGNORE', figee = 0 WHERE id_proposition = ?1")
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
          WHERE bm.id_plan = ?1
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
           FROM plan_production p WHERE p.id_plan = ?1",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("plan {id}")))?;

    // Les mois de la periode, dans l'ordre glissant : c'est l'ossature des deux
    // tableaux, et elle vient du plan, jamais d'un 1..12 suppose.
    let mois = sqlx::query(
        "SELECT DISTINCT rang_mois, mois, annee_mois FROM ligne_plan_production
          WHERE id_plan = ?1 ORDER BY rang_mois",
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
          WHERE l.id_plan = ?1
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
          WHERE bm.id_plan = ?1
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
        "SELECT m.numero_mouvement, m.date_mouvement, m.code_type_mvt, m.code_magasin,
                m.code_motif, m.reference_document, m.numero_of, u.login AS utilisateur,
                lm.ligne_numero, lm.code_reference, lm.quantite_kg, lm.prix_kg_mad,
                lm.total_mad, lm.lot_fournisseur, tm.signe
           FROM ligne_mouvement lm
           JOIN mouvement      m  ON m.id_mouvement   = lm.id_mouvement
           JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
           JOIN utilisateur    u  ON u.id_utilisateur = m.id_utilisateur
          WHERE (?1 IS NULL OR lm.code_reference = ?1)
          ORDER BY m.date_mouvement DESC, lm.ligne_numero
          LIMIT ?2",
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
          LIMIT ?1",
    )
    .bind(f.limite())
    .fetch_all(&state.db)
    .await?;

    Ok(Json(lignes_en_json(&rows)))
}
