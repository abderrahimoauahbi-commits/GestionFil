//! CRUD des entites de production : qualites, densites par role, recettes,
//! plans de production.
//!
//! Ces entites ne passent pas par le moteur generique : leur cycle de vie
//! engage des regles metier. Une recette se clone plutot qu'elle ne se modifie
//! (RG-05), un plan fige ses versions de recette avant validation (R08), une
//! qualite embarque les parametres globaux du moment (B3).

use super::json::lignes_en_json;
use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::crud::lier;
use crate::db::maintenant;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Map, Value};

// ============================================================================
// Qualites
// ============================================================================

pub async fn lister_qualites(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::QUALITES, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT q.*,
                (SELECT COUNT(*) FROM ligne_qualite lq
                  WHERE lq.code_qualite = q.code_qualite AND lq.actif = 1) AS nb_roles,
                (SELECT ROUND(SUM(lq.densite), 4) FROM ligne_qualite lq
                  WHERE lq.code_qualite = q.code_qualite AND lq.actif = 1
                    AND lq.entre_poids_commercial = 1)                     AS poids_calcule_m2,
                (SELECT COUNT(*) FROM recette r
                  WHERE r.code_qualite = q.code_qualite AND r.actif = 1) AS nb_composition,
                (SELECT COUNT(DISTINCT r.code_role) FROM recette r
                  WHERE r.code_qualite = q.code_qualite AND r.actif = 1) AS nb_roles_composes,
                -- Roles dont la somme des % s'ecarte de 100 : c'est ce qui
                -- bloquera la mise en service (R07).
                (SELECT COUNT(*) FROM (
                     SELECT r.code_role, SUM(r.pourcentage_composition) AS somme
                       FROM recette r
                      WHERE r.code_qualite = q.code_qualite AND r.actif = 1
                      GROUP BY r.code_role
                     HAVING ABS(somme - 100.0) > 0.5)) AS nb_roles_hors_100,
                (SELECT COUNT(*) FROM ligne_plan_production l
                  WHERE l.code_qualite = q.code_qualite AND l.m2_prevus > 0)     AS nb_lignes_plan,
                uc.login AS cree_par, um.login AS modifie_par
           FROM qualite q
           LEFT JOIN utilisateur uc ON uc.id_utilisateur = q.id_utilisateur_creation
           LEFT JOIN utilisateur um ON um.id_utilisateur = q.id_utilisateur_modification
          ORDER BY q.statut, q.code_qualite",
    )
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::QUALITES, &mut valeur).await?;
    Ok(Json(valeur))
}

// ---------------------------------------------------------------------------
// Enregistrement maitre-detail
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct LigneDensite {
    pub code_role: String,
    pub densite: f64,
    pub unite_densite: String,
}

/// Une ligne de composition : quelle matiere, dans quel role, a quel %.
#[derive(Debug, Deserialize)]
pub struct LigneComposition {
    pub code_reference: String,
    pub code_role: String,
    pub pourcentage_composition: f64,
    pub code_groupe_equiv: Option<String>,
    pub couleur: Option<String>,
    pub code_fournisseur_prefere: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DocumentQualite {
    pub code_qualite: String,
    pub nom: String,
    pub description: Option<String>,
    pub statut: Option<String>,
    pub marge_securite_pct: Option<f64>,
    pub couv_min_mois: Option<f64>,
    pub taux_perte_pct: Option<f64>,
    pub seuil_alerte_jours: Option<i64>,
    pub seuil_critique_jours: Option<i64>,
    pub stock_securite_jours: Option<i64>,
    /// Densites par role. Liste complete : ce qui n'y figure pas est supprime.
    pub lignes: Vec<LigneDensite>,
    /// Composition. Liste complete elle aussi. Absente = inchangee.
    pub composition: Option<Vec<LigneComposition>>,
}

/// Enregistre l'entete, les densites ET la composition en une seule transaction.
///
/// Une qualite = une composition (pas de versionnement) : les trois blocs
/// forment un seul document et se valident ensemble. Un enregistrement par bloc
/// laisserait, en cas d'interruption, une qualite a moitie definie — et le poids
/// commercial, calcule depuis les densites, serait faux entre-temps.
///
/// Les deux listes recues font autorite : ce qui n'y figure pas est retire.
pub async fn enregistrer_qualite(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(d): Json<DocumentQualite>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::QUALITES, Action::Ecrire).await?;

    let code = d.code_qualite.trim();
    if code.is_empty() || d.nom.trim().is_empty() {
        return Err(AppError::Invalide("le code et le nom sont obligatoires".into()));
    }

    let statut_cible = d.statut.clone().unwrap_or_else(|| "BROUILLON".into());
    if !matches!(statut_cible.as_str(), "BROUILLON" | "ACTIF" | "CLOTURE") {
        return Err(AppError::Invalide(format!("statut invalide : {statut_cible}")));
    }

    // Doublons de role : le dernier ecraserait silencieusement le precedent.
    let mut vus = std::collections::HashSet::new();
    for l in &d.lignes {
        if l.densite < 0.0 {
            return Err(AppError::Invalide(format!(
                "densite negative sur le role {}",
                l.code_role
            )));
        }
        if !matches!(l.unite_densite.as_str(), "kg_m2" | "ml_m2") {
            return Err(AppError::Invalide(format!(
                "unite invalide sur le role {} : attendu kg_m2 ou ml_m2",
                l.code_role
            )));
        }
        if !vus.insert(&l.code_role) {
            return Err(AppError::Invalide(format!(
                "le role {} apparait deux fois",
                l.code_role
            )));
        }
    }

    if let Some(comp) = &d.composition {
        // Une matiere ne figure qu'une fois dans une qualite, TOUS ROLES
        // CONFONDUS : deux lignes sur la meme reference additionneraient leurs
        // pourcentages sur la meme matiere, et la composition deviendrait
        // illisible sans que le besoin MRP change.
        let mut refs = std::collections::HashMap::new();
        for c in comp {
            if c.pourcentage_composition <= 0.0 || c.pourcentage_composition > 100.0 {
                return Err(AppError::Invalide(format!(
                    "{} / {} : le pourcentage doit etre compris entre 0 exclu et 100",
                    c.code_role, c.code_reference
                )));
            }
            if let Some(role_precedent) =
                refs.insert(c.code_reference.as_str(), c.code_role.as_str())
            {
                return Err(AppError::Invalide(if role_precedent == c.code_role {
                    format!(
                        "La reference {} apparait deux fois sur le role {} : \
                         une matiere ne peut figurer qu'une seule fois.",
                        c.code_reference, c.code_role
                    )
                } else {
                    format!(
                        "La reference {} est employee sur deux roles ({} et {}) : \
                         une matiere ne peut figurer qu'une seule fois dans une qualite.",
                        c.code_reference, role_precedent, c.code_role
                    )
                }));
            }
        }
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let horodatage = maintenant();
    let existe: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM qualite WHERE code_qualite = ?1")
        .bind(code)
        .fetch_one(&mut *tx)
        .await?;

    if existe == 0 {
        // Creation : les parametres globaux du moment sont embarques (B3). La
        // qualite nait en BROUILLON ; sa mise en service est une transition a
        // part entiere, qui declenche les controles R07 et densites.
        sqlx::query(
            "INSERT INTO qualite
                 (code_qualite, nom, description, statut, poids_commercial_m2,
                  marge_securite_pct, couv_min_mois, taux_perte_pct,
                  seuil_alerte_jours, seuil_critique_jours, stock_securite_jours,
                  id_utilisateur_creation)
             SELECT ?1, ?2, ?3, 'BROUILLON', 0,
                    COALESCE(?4, (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_MargeSecurite')),
                    COALESCE(?5, (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_CouvMinMois')),
                    COALESCE(?6, (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_TauxPerte')),
                    COALESCE(?7, (SELECT CAST(valeur_courante AS INTEGER) FROM parametre WHERE code_parametre='P_SeuilAlerte')),
                    COALESCE(?8, (SELECT CAST(valeur_courante AS INTEGER) FROM parametre WHERE code_parametre='P_SeuilCritique')),
                    COALESCE(?9, (SELECT CAST(valeur_courante AS INTEGER) FROM parametre WHERE code_parametre='P_SecuriteA')),
                    ?10",
        )
        .bind(code)
        .bind(d.nom.trim())
        .bind(&d.description)
        .bind(d.marge_securite_pct)
        .bind(d.couv_min_mois)
        .bind(d.taux_perte_pct)
        .bind(d.seuil_alerte_jours)
        .bind(d.seuil_critique_jours)
        .bind(d.stock_securite_jours)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "UPDATE qualite SET
                 nom = ?2, description = ?3,
                 marge_securite_pct   = COALESCE(?4, marge_securite_pct),
                 couv_min_mois        = COALESCE(?5, couv_min_mois),
                 taux_perte_pct       = COALESCE(?6, taux_perte_pct),
                 seuil_alerte_jours   = COALESCE(?7, seuil_alerte_jours),
                 seuil_critique_jours = COALESCE(?8, seuil_critique_jours),
                 stock_securite_jours = COALESCE(?9, stock_securite_jours),
                 date_modification = ?10,
                 id_utilisateur_modification = ?11
              WHERE code_qualite = ?1",
        )
        .bind(code)
        .bind(d.nom.trim())
        .bind(&d.description)
        .bind(d.marge_securite_pct)
        .bind(d.couv_min_mois)
        .bind(d.taux_perte_pct)
        .bind(d.seuil_alerte_jours)
        .bind(d.seuil_critique_jours)
        .bind(d.stock_securite_jours)
        .bind(&horodatage)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;
    }

    // --- Densites par role : la liste recue fait autorite --------------------
    let roles_recus: Vec<&str> = d.lignes.iter().map(|l| l.code_role.as_str()).collect();

    let a_retirer: Vec<String> =
        sqlx::query_scalar("SELECT code_role FROM ligne_qualite WHERE code_qualite = ?1")
            .bind(code)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .filter(|r: &String| !roles_recus.contains(&r.as_str()))
            .collect();

    // La composition qui sera en vigueur apres cet enregistrement : c'est elle
    // qui decide si un role est encore utilise.
    let roles_composition: std::collections::HashSet<String> = match &d.composition {
        Some(c) => c.iter().map(|l| l.code_role.clone()).collect(),
        None => sqlx::query_scalar("SELECT DISTINCT code_role FROM recette WHERE code_qualite = ?1")
            .bind(code)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .collect(),
    };

    for role in &a_retirer {
        // Retirer la densite d'un role encore compose rendrait le MRP
        // incalculable dessus : on refuse plutot que de casser.
        if roles_composition.contains(role) {
            return Err(AppError::RegleMetier(format!(
                "Le role {role} porte des lignes de composition sur {code} : retirez-les d'abord."
            )));
        }
        sqlx::query("DELETE FROM ligne_qualite WHERE code_qualite = ?1 AND code_role = ?2")
            .bind(code)
            .bind(role)
            .execute(&mut *tx)
            .await?;
    }

    for (i, l) in d.lignes.iter().enumerate() {
        sqlx::query(
            "INSERT INTO ligne_qualite
                 (code_qualite, code_role, densite, unite_densite,
                  entre_poids_commercial, ordre_affichage)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT (code_qualite, code_role) DO UPDATE SET
                 densite = excluded.densite,
                 unite_densite = excluded.unite_densite,
                 entre_poids_commercial = excluded.entre_poids_commercial,
                 ordre_affichage = excluded.ordre_affichage,
                 actif = 1",
        )
        .bind(code)
        .bind(&l.code_role)
        .bind(l.densite)
        .bind(&l.unite_densite)
        // Un role en ml/m2 consomme de la matiere sans entrer dans le poids
        // commercial du tapis.
        .bind(i64::from(l.unite_densite == "kg_m2"))
        .bind((i as i64) * 10)
        .execute(&mut *tx)
        .await?;
    }

    // --- Composition : table refaite a neuf ----------------------------------
    // Les triggers trg_recette_verrou_plan_* refusent l'ecriture si la qualite
    // est produite par le plan en service.
    let mut nb_composition = 0usize;
    if let Some(comp) = &d.composition {
        sqlx::query("DELETE FROM recette WHERE code_qualite = ?1")
            .bind(code)
            .execute(&mut *tx)
            .await?;

        for (i, c) in comp.iter().enumerate() {
            sqlx::query(
                "INSERT INTO recette
                     (code_qualite, ligne_numero, code_reference, code_role,
                      code_groupe_equiv, pourcentage_composition, couleur,
                      code_fournisseur_prefere)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .bind(code)
            .bind(i as i64 + 1)
            .bind(&c.code_reference)
            .bind(&c.code_role)
            .bind(&c.code_groupe_equiv)
            .bind(c.pourcentage_composition)
            .bind(&c.couleur)
            .bind(&c.code_fournisseur_prefere)
            .execute(&mut *tx)
            .await?;
        }
        nb_composition = comp.len();
    }

    // Le poids commercial est la somme des densites en kg/m2 : le recalculer
    // ici evite qu'il derive de sa propre definition.
    sqlx::query(
        "UPDATE qualite
            SET poids_commercial_m2 = COALESCE((
                    SELECT ROUND(SUM(densite), 4) FROM ligne_qualite
                     WHERE code_qualite = ?1 AND actif = 1 AND entre_poids_commercial = 1), 0)
          WHERE code_qualite = ?1",
    )
    .bind(code)
    .execute(&mut *tx)
    .await?;

    // --- Statut, en dernier --------------------------------------------------
    // Les controles d'activation (R07, densites, ml/m2) portent ainsi sur la
    // composition qui vient d'etre ecrite, jamais sur la precedente.
    let statut_actuel: String =
        sqlx::query_scalar("SELECT statut FROM qualite WHERE code_qualite = ?1")
            .bind(code)
            .fetch_one(&mut *tx)
            .await?;

    if statut_actuel != statut_cible {
        sqlx::query(
            "UPDATE qualite SET
                 statut = ?2,
                 date_cloture = CASE WHEN ?2 = 'CLOTURE' THEN COALESCE(date_cloture, ?3) END,
                 id_utilisateur_cloture = CASE WHEN ?2 = 'CLOTURE'
                                               THEN COALESCE(id_utilisateur_cloture, ?4) END,
                 date_modification = ?3, id_utilisateur_modification = ?4
              WHERE code_qualite = ?1",
        )
        .bind(code)
        .bind(&statut_cible)
        .bind(&horodatage)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;
    }

    let poids: f64 =
        sqlx::query_scalar("SELECT poids_commercial_m2 FROM qualite WHERE code_qualite = ?1")
            .bind(code)
            .fetch_one(&mut *tx)
            .await?;

    tx.commit().await?;

    Ok(Json(json!({
        "code_qualite": code,
        "cree": existe == 0,
        "statut": statut_cible,
        "lignes_enregistrees": d.lignes.len(),
        "lignes_retirees": a_retirer.len(),
        "composition_enregistree": nb_composition,
        "poids_commercial_m2": poids,
    })))
}

/// Composition d'une qualite, avec le kg/m2 deduit de la densite du role.
pub async fn composition_qualite(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::QUALITES, Action::Lire).await?;
    // On joint ici ce que la vue ne porte pas : nature de la matiere, fournisseur
    // et prix. Le cout d'une ligne est sa consommation au m2 multipliee par le
    // prix au kg — c'est ce qui permet de voir, en composant, ce que coute le m2.
    let rows = sqlx::query(
        "SELECT rc.*,
                ref.type_fil, ref.code_categorie, cat.libelle AS categorie,
                ref.code_fournisseur, f.nom AS fournisseur,
                ref.code_devise_catalogue, ref.prix_catalogue, ref.unite_catalogue,
                px.prix_kg_mad, px.source_prix,
                ROUND(rc.kg_m2 * px.prix_kg_mad, 4) AS cout_m2_mad
           FROM v_recette_calculee rc
           JOIN reference ref ON ref.code_reference = rc.code_reference
           JOIN categorie_matiere cat ON cat.code_categorie = ref.code_categorie
           JOIN fournisseur f ON f.code_fournisseur = ref.code_fournisseur
           JOIN (SELECT r.code_reference,
                        COALESCE(r.cmup_mad, ROUND(r.prix_catalogue_kg * COALESCE((
                            SELECT t.taux FROM taux_change t
                             WHERE t.code_devise = r.code_devise_catalogue
                               AND date('now') >= t.date_debut
                               AND (t.date_fin IS NULL OR date('now') <= t.date_fin)
                             ORDER BY t.date_debut DESC LIMIT 1), 1.0), 4)) AS prix_kg_mad,
                        CASE WHEN r.cmup_mad IS NOT NULL THEN 'CMUP' ELSE 'CATALOGUE' END AS source_prix
                   FROM reference r) px ON px.code_reference = rc.code_reference
          WHERE rc.code_qualite = ?1
          ORDER BY rc.ligne_numero",
    )
    .bind(&code)
    .fetch_all(&state.db)
    .await?;
    // Les prix sont des champs sensibles : le magasinier ne doit pas les voir
    // sortir par cette porte-la non plus.
    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::QUALITES, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Supprime definitivement une qualite, si rien d'EXTERIEUR ne la reference.
///
/// Ses densites et sa composition ne comptent pas : elles lui appartiennent et
/// disparaissent avec elle. Ce qui la retient, ce sont les plans — les supprimer
/// romprait la justification de besoins deja calcules. On bascule alors en
/// cloture, qui preserve l'historique (RG-03).
pub async fn supprimer_qualite(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::QUALITES, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let plans: i64 = sqlx::query_scalar(
        "SELECT (SELECT COUNT(*) FROM ligne_plan_production WHERE code_qualite = ?1)
              + (SELECT COUNT(*) FROM plan_qualite          WHERE code_qualite = ?1)",
    )
    .bind(&code)
    .fetch_one(&mut *tx)
    .await?;

    if plans == 0 {
        // ON DELETE CASCADE couvre ligne_qualite et recette ; le DELETE explicite
        // sur la saisonnalite reste necessaire, elle n'est rattachee qu'au plan.
        sqlx::query("DELETE FROM ligne_qualite WHERE code_qualite = ?1")
            .bind(&code)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM recette WHERE code_qualite = ?1")
            .bind(&code)
            .execute(&mut *tx)
            .await?;
        let res = sqlx::query("DELETE FROM qualite WHERE code_qualite = ?1")
            .bind(&code)
            .execute(&mut *tx)
            .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::Introuvable(format!("qualite {code}")));
        }
        tx.commit().await?;
        return Ok(Json(json!({ "code_qualite": code, "mode": "SUPPRESSION" })));
    }

    let res = sqlx::query(
        "UPDATE qualite SET statut = 'CLOTURE', date_cloture = ?2,
                            id_utilisateur_cloture = ?3, date_modification = ?2,
                            id_utilisateur_modification = ?3
          WHERE code_qualite = ?1 AND statut <> 'CLOTURE'",
    )
    .bind(&code)
    .bind(maintenant())
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Introuvable(format!("qualite active {code}")));
    }
    tx.commit().await?;

    Ok(Json(json!({
        "code_qualite": code,
        "mode": "CLOTURE",
        "raison": format!("{plans} reference(s) de plan la citent"),
    })))
}

#[derive(Debug, Deserialize)]
pub struct NouvelleQualite {
    pub code_qualite: String,
    pub nom: String,
    pub poids_commercial_m2: Option<f64>,
}

pub async fn creer_qualite(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(q): Json<NouvelleQualite>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::QUALITES, Action::Ecrire).await?;
    if q.code_qualite.trim().is_empty() || q.nom.trim().is_empty() {
        return Err(AppError::Invalide("code et nom sont obligatoires".into()));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // B3 : la qualite embarque les parametres globaux du moment. Les modifier
    // ensuite n'affectera pas cette qualite.
    sqlx::query(
        "INSERT INTO qualite
             (code_qualite, nom, poids_commercial_m2,
              marge_securite_pct, couv_min_mois, taux_perte_pct,
              seuil_alerte_jours, seuil_critique_jours, stock_securite_jours,
              id_utilisateur_creation)
         SELECT ?1, ?2, ?3,
                (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_MargeSecurite'),
                (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_CouvMinMois'),
                (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_TauxPerte'),
                (SELECT CAST(valeur_courante AS INTEGER) FROM parametre WHERE code_parametre='P_SeuilAlerte'),
                (SELECT CAST(valeur_courante AS INTEGER) FROM parametre WHERE code_parametre='P_SeuilCritique'),
                (SELECT CAST(valeur_courante AS INTEGER) FROM parametre WHERE code_parametre='P_SecuriteA'),
                ?4",
    )
    .bind(q.code_qualite.trim())
    .bind(q.nom.trim())
    .bind(q.poids_commercial_m2.unwrap_or(0.0))
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "code_qualite": q.code_qualite, "cree": true })))
}

const COLONNES_QUALITE: &[&str] = &[
    "nom", "poids_commercial_m2", "marge_securite_pct", "couv_min_mois",
    "taux_perte_pct", "seuil_alerte_jours", "seuil_critique_jours",
    "stock_securite_jours",
];

pub async fn modifier_qualite(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
    Json(charge): Json<Map<String, Value>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::QUALITES, Action::Ecrire).await?;
    let retenus = user
        .filtrer_ecriture(&state.db, module::QUALITES, &charge)
        .await?;

    let champs: Vec<(&String, &Value)> = retenus
        .iter()
        .filter(|(n, _)| COLONNES_QUALITE.contains(&n.as_str()))
        .collect();
    if champs.is_empty() {
        return Err(AppError::Invalide("aucun champ modifiable".into()));
    }

    let set: Vec<String> = champs
        .iter()
        .enumerate()
        .map(|(i, (n, _))| format!("{n} = ?{}", i + 2))
        .collect();

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let sql = format!(
        "UPDATE qualite SET {} WHERE code_qualite = ?1",
        set.join(", ")
    );
    let mut q = sqlx::query(&sql).bind(&code);
    for (_, v) in &champs {
        q = lier(q, v);
    }
    if q.execute(&mut *tx).await?.rows_affected() == 0 {
        return Err(AppError::Introuvable(format!("qualite {code}")));
    }
    tx.commit().await?;

    Ok(Json(json!({ "code_qualite": code, "modifie": true })))
}

/// RG-03 : cloturer plutot que supprimer. La qualite reste en base pour
/// l'historique mais ne peut plus servir dans de nouvelles recettes.
pub async fn cloturer_qualite(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::QUALITES, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let plans: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ligne_plan_production lpp
           JOIN plan_production pp ON pp.id_plan = lpp.id_plan
          WHERE lpp.code_qualite = ?1 AND pp.statut = 'VALIDE' AND lpp.m2_prevus > 0",
    )
    .bind(&code)
    .fetch_one(&mut *tx)
    .await?;
    if plans > 0 {
        return Err(AppError::RegleMetier(format!(
            "Cette qualite est planifiee dans {plans} ligne(s) d'un plan valide : cloture impossible."
        )));
    }

    let res = sqlx::query(
        "UPDATE qualite SET actif = 0, date_cloture = ?2, id_utilisateur_cloture = ?3
          WHERE code_qualite = ?1 AND actif = 1",
    )
    .bind(&code)
    .bind(maintenant())
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Introuvable(format!("qualite active {code}")));
    }
    tx.commit().await?;

    Ok(Json(json!({ "code_qualite": code, "cloturee": true })))
}

// ============================================================================
// Densites par role
// ============================================================================

pub async fn lister_densites(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::QUALITES, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT lq.*, rb.libelle AS role_libelle
           FROM ligne_qualite lq
           JOIN role_bom rb ON rb.code_role = lq.code_role
          WHERE lq.code_qualite = ?1
          ORDER BY rb.ordre_affichage",
    )
    .bind(&code)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&rows)))
}

#[derive(Debug, Deserialize)]
pub struct Densite {
    pub code_role: String,
    pub densite: f64,
    pub unite_densite: String,
}

/// Cree ou met a jour la densite d'un role. Une seule route pour les deux :
/// c'est un couple (qualite, role) qui existe ou non, pas une entite a
/// identifiant propre.
pub async fn definir_densite(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
    Json(d): Json<Densite>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::QUALITES, Action::Ecrire).await?;
    if !matches!(d.unite_densite.as_str(), "kg_m2" | "ml_m2") {
        return Err(AppError::Invalide(
            "unite_densite doit valoir kg_m2 ou ml_m2".into(),
        ));
    }
    if d.densite < 0.0 {
        return Err(AppError::Invalide("la densite ne peut pas etre negative".into()));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    sqlx::query(
        "INSERT INTO ligne_qualite
             (code_qualite, code_role, densite, unite_densite, entre_poids_commercial)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (code_qualite, code_role) DO UPDATE SET
             densite = excluded.densite,
             unite_densite = excluded.unite_densite,
             entre_poids_commercial = excluded.entre_poids_commercial,
             actif = 1",
    )
    .bind(&code)
    .bind(&d.code_role)
    .bind(d.densite)
    // Un role en ml/m2 consomme de la matiere mais n'entre pas dans le poids
    // commercial du tapis.
    .bind(&d.unite_densite)
    .bind(i64::from(d.unite_densite == "kg_m2"))
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "code_qualite": code, "code_role": d.code_role, "enregistre": true })))
}

pub async fn supprimer_densite(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((code, role)): Path<(String, String)>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::QUALITES, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // Retirer une densite utilisee par une recette validee rendrait le MRP
    // incalculable sur cette qualite.
    let utilisee: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM recette r
          WHERE r.code_qualite = ?1 AND r.code_role = ?2 AND r.actif = 1",
    )
    .bind(&code)
    .bind(&role)
    .fetch_one(&mut *tx)
    .await?;
    if utilisee > 0 {
        return Err(AppError::RegleMetier(format!(
            "Le role {role} est utilise par la recette validee de {code} : le MRP ne pourrait plus calculer ses besoins."
        )));
    }

    let res = sqlx::query("DELETE FROM ligne_qualite WHERE code_qualite = ?1 AND code_role = ?2")
        .bind(&code)
        .bind(&role)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Introuvable(format!("densite {code}/{role}")));
    }
    tx.commit().await?;

    Ok(Json(json!({ "supprime": true })))
}

// ============================================================================
// Composition (table `recette`)
//
// Une qualite = une composition. Ce module ne porte plus de cycle de vie propre :
// la composition se saisit avec la qualite (PUT /api/qualites) et se verrouille
// des que la qualite est produite par le plan en service. Il ne reste ici que la
// CONSULTATION transversale : ou telle matiere est-elle employee, quelles
// qualites emploient tel role.
// ============================================================================

/// Toutes les lignes de composition, tous articles confondus.
///
/// Filtres : `code_qualite`, `code_reference`, `code_role`, `statut` (celui de
/// la qualite). C'est la vue « ou cette matiere est-elle utilisee ? », qu'aucun
/// ecran de qualite ne peut donner puisqu'il ne montre qu'un article.
pub async fn lister_recettes(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<std::collections::HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECETTES, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT rc.*, ref.code_fournisseur, four.nom AS fournisseur
           FROM v_recette_calculee rc
           JOIN reference    ref  ON ref.code_reference  = rc.code_reference
           JOIN fournisseur  four ON four.code_fournisseur = ref.code_fournisseur
          WHERE (?1 IS NULL OR rc.code_qualite   = ?1)
            AND (?2 IS NULL OR rc.code_reference = ?2)
            AND (?3 IS NULL OR rc.code_role      = ?3)
            AND (?4 IS NULL OR rc.statut_qualite = ?4)
          ORDER BY rc.code_qualite, rc.ligne_numero",
    )
    .bind(f.get("code_qualite"))
    .bind(f.get("code_reference"))
    .bind(f.get("code_role"))
    .bind(f.get("statut"))
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::RECETTES, &mut valeur).await?;
    Ok(Json(valeur))
}

// ============================================================================
// Plans de production
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct Transition {
    pub statut: String,
}

pub async fn lister_plans(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLANS, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT p.*,
                (SELECT COUNT(*) FROM ligne_plan_production l WHERE l.id_plan = p.id_plan) AS nb_lignes,
                (SELECT COUNT(*) FROM plan_qualite pq WHERE pq.id_plan = p.id_plan) AS nb_qualites,
                (SELECT COUNT(*) FROM besoin_mrp b WHERE b.id_plan = p.id_plan) AS nb_besoins,
                (SELECT COALESCE(SUM(l.m2_prevus), 0) FROM ligne_plan_production l
                  WHERE l.id_plan = p.id_plan) AS m2_total,
                -- Qualites du plan sorties du service depuis leur choix : le
                -- plan ne peut plus entrer en service tant qu'elles n'ont pas
                -- ete remplacees.
                (SELECT COUNT(*) FROM plan_qualite pq
                   JOIN qualite q ON q.code_qualite = pq.code_qualite
                  WHERE pq.id_plan = p.id_plan AND q.statut <> 'ACTIF') AS nb_qualites_perimees,
                uc.login AS cree_par, um.login AS modifie_par,
                uv.login AS valide_par, ux.login AS cloture_par
           FROM plan_production p
           LEFT JOIN utilisateur uc ON uc.id_utilisateur = p.id_utilisateur_creation
           LEFT JOIN utilisateur um ON um.id_utilisateur = p.id_utilisateur_modification
           LEFT JOIN utilisateur uv ON uv.id_utilisateur = p.id_utilisateur_validation
           LEFT JOIN utilisateur ux ON ux.id_utilisateur = p.id_utilisateur_cloture
          ORDER BY p.date_debut DESC, p.numero_version DESC",
    )
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::PLANS, &mut valeur).await?;
    Ok(Json(valeur))
}

#[derive(Debug, Deserialize)]
pub struct NouveauPlan {
    pub annee: i64,
    pub libelle: String,
    pub scenario_nom: Option<String>,
}

pub async fn creer_plan(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(p): Json<NouveauPlan>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLANS, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let version: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(numero_version), 0) + 1 FROM plan_production WHERE annee = ?1",
    )
    .bind(p.annee)
    .fetch_one(&mut *tx)
    .await?;

    let id = uuid::Uuid::new_v4().to_string();
    // B3 : le plan embarque les parametres globaux du moment.
    sqlx::query(
        "INSERT INTO plan_production
             (id_plan, annee, numero_version, libelle, scenario_nom, date_debut, date_fin,
              marge_securite_pct, couv_min_mois, taux_perte_pct,
              seuil_alerte_jours, seuil_critique_jours,
              seuil_tier1_mad, seuil_tier2_mad, seuil_tier3_mad,
              id_utilisateur_creation)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_MargeSecurite'),
                (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_CouvMinMois'),
                (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_TauxPerte'),
                (SELECT CAST(valeur_courante AS INTEGER) FROM parametre WHERE code_parametre='P_SeuilAlerte'),
                (SELECT CAST(valeur_courante AS INTEGER) FROM parametre WHERE code_parametre='P_SeuilCritique'),
                (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_SeuilTier1'),
                (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_SeuilTier2'),
                (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_SeuilTier3'),
                ?8",
    )
    .bind(&id)
    .bind(p.annee)
    .bind(version)
    .bind(&p.libelle)
    .bind(&p.scenario_nom)
    .bind(format!("{}-01-01", p.annee))
    .bind(format!("{}-12-31", p.annee))
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "id_plan": id, "annee": p.annee, "numero_version": version })))
}

// ---------------------------------------------------------------------------
// Enregistrement maitre-detail du plan
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct QualitePlan {
    pub code_qualite: String,
    pub m2_base_mensuel: f64,
}

#[derive(Debug, Deserialize)]
pub struct CoefSaison {
    pub code_qualite: String,
    pub mois: u32,
    pub coefficient: f64,
}

#[derive(Debug, Deserialize)]
pub struct DocumentPlan {
    /// Absent = creation.
    pub id_plan: Option<String>,
    pub libelle: String,
    pub scenario_nom: Option<String>,
    /// Mois de depart de la periode glissante, au format AAAA-MM ou AAAA-MM-JJ.
    pub date_debut: String,
    pub mois_horizon: Option<i64>,
    pub croissance_annuelle_pct: Option<f64>,
    /// Qualites retenues : c'est l'entete du plan, chacune avec sa base mensuelle.
    pub qualites: Vec<QualitePlan>,
    /// Grille 12 mois x qualite. Un couple absent vaut 1,0.
    pub saisonnalite: Vec<CoefSaison>,
}

/// Qualites que ce plan peut retenir : ACTIVES et libres de tout autre plan actif.
pub async fn qualites_disponibles(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<std::collections::HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLANS, Action::Lire).await?;
    // Les qualites deja retenues par le plan courant restent proposees : sans
    // cela, rouvrir un plan ferait disparaitre sa propre selection.
    let rows = sqlx::query(
        "SELECT q.code_qualite, q.nom, q.poids_commercial_m2, q.taux_perte_pct,
                (SELECT COUNT(*) FROM recette r
                  WHERE r.code_qualite = q.code_qualite AND r.actif = 1) AS nb_composition,
                pq.id_plan AS deja_dans_plan
           FROM qualite q
           LEFT JOIN plan_qualite pq ON pq.code_qualite = q.code_qualite
                                    AND pq.id_plan = ?1
          WHERE q.statut = 'ACTIF'
            AND NOT EXISTS (
                SELECT 1 FROM plan_qualite px
                  JOIN plan_production pp ON pp.id_plan = px.id_plan
                 WHERE px.code_qualite = q.code_qualite
                   AND pp.statut <> 'CLOTURE'
                   AND (?1 IS NULL OR px.id_plan <> ?1))
          ORDER BY q.code_qualite",
    )
    .bind(f.get("id_plan"))
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&rows)))
}

/// Enregistre l'entete (qualites retenues, periode, croissance), la grille de
/// saisonnalite ET le deploiement mensuel, en une seule transaction.
///
/// Les m2 mensuels ne se saisissent pas : ils se DEDUISENT de la base mensuelle,
/// du coefficient du mois et de la croissance, exactement comme la feuille
/// Production_Plan du classeur. Les saisir a la main les ferait diverger de leur
/// propre formule des que l'un des trois termes change.
pub async fn enregistrer_plan(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(d): Json<DocumentPlan>,
) -> AppResult<Json<Value>> {
    use crate::domain::plan::{deployer, fin_de_mois, BaseQualite};
    use chrono::{Datelike, NaiveDate};

    user.exiger(&state.db, module::PLANS, Action::Ecrire).await?;

    if d.libelle.trim().is_empty() {
        return Err(AppError::Invalide("le libelle du plan est obligatoire".into()));
    }

    // Le mois de depart est ramene a son premier jour : une periode glissante
    // part d'un MOIS, pas d'un jour quelconque.
    let brut = d.date_debut.trim();
    let jour1 = if brut.len() == 7 { format!("{brut}-01") } else { brut.to_string() };
    let depart = NaiveDate::parse_from_str(&jour1, "%Y-%m-%d")
        .map_err(|_| AppError::Invalide(format!("date de debut illisible : {brut}")))?
        .with_day(1)
        .expect("premier du mois");

    let horizon = d.mois_horizon.unwrap_or(12);
    if !(1..=60).contains(&horizon) {
        return Err(AppError::Invalide(
            "l'horizon doit tenir entre 1 et 60 mois (cinq ans)".into(),
        ));
    }
    let croissance = d.croissance_annuelle_pct.unwrap_or(0.0);

    // Une qualite ne peut figurer qu'une fois dans le plan. La cle primaire le
    // refuserait, mais le message serait celui de SQLite : autant nommer
    // la qualite fautive.
    let mut vues = std::collections::HashSet::new();
    for q in &d.qualites {
        if q.m2_base_mensuel < 0.0 {
            return Err(AppError::Invalide(
                "une base mensuelle ne peut pas etre negative".into(),
            ));
        }
        if !vues.insert(q.code_qualite.as_str()) {
            return Err(AppError::Invalide(format!(
                "La qualite {} est selectionnee deux fois : une qualite ne peut figurer qu'une seule fois dans un plan.",
                q.code_qualite
            )));
        }
    }
    for c in &d.saisonnalite {
        if !(1..=12).contains(&c.mois) {
            return Err(AppError::Invalide(format!("mois de saisonnalite invalide : {}", c.mois)));
        }
        if c.coefficient < 0.0 {
            return Err(AppError::Invalide(
                "un coefficient de saisonnalite ne peut pas etre negatif".into(),
            ));
        }
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let horodatage = maintenant();
    let annee = depart.year() as i64;
    let date_fin = fin_de_mois(crate::domain::plan::mois_decale(depart, horizon - 1));

    // Un plan fige se refuse AVANT tout controle de contenu : corriger une
    // saisonnalite sur un plan qu'on n'a de toute facon pas le droit de modifier
    // n'avancerait a rien.
    if let Some(id) = d.id_plan.as_deref().filter(|s| !s.is_empty()) {
        let statut: String =
            sqlx::query_scalar("SELECT statut FROM plan_production WHERE id_plan = ?1")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| AppError::Introuvable(format!("plan {id}")))?;
        if !matches!(statut.as_str(), "BROUILLON" | "SIMULATION") {
            return Err(AppError::RegleMetier(format!(
                "Un plan {statut} est fige : creez une nouvelle version pour le modifier."
            )));
        }
    }

    // --- Qualites visees et completude de la saisonnalite --------------------
    // La saisonnalite est un parametre ANNUEL : douze coefficients par qualite,
    // un par mois calendaire, quelle que soit la duree du plan. Un plan de trois
    // ans reutilise les memes douze valeurs — c'est le propre d'un profil
    // saisonnier, il se repete d'une annee sur l'autre.
    //
    // Resolu AVANT toute ecriture : la grille doit etre complete. Un trou serait
    // interprete comme 1,00 par le deploiement, donc comme un mois a pleine
    // charge — une valeur que personne n'a decidee. Mieux vaut refuser que
    // planifier sur un defaut invisible.
    let mut bases = Vec::with_capacity(d.qualites.len());
    for q in &d.qualites {
        let connue: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM qualite WHERE code_qualite = ?1")
                .bind(&q.code_qualite)
                .fetch_one(&mut *tx)
                .await?;
        if connue == 0 {
            return Err(AppError::Introuvable(format!("qualite {}", q.code_qualite)));
        }
        bases.push(BaseQualite {
            code_qualite: q.code_qualite.clone(),
            m2_base_mensuel: q.m2_base_mensuel,
        });
    }

    let fournis: std::collections::HashSet<(&str, u32)> = d
        .saisonnalite
        .iter()
        .map(|c| (c.code_qualite.as_str(), c.mois))
        .collect();
    let mut manquants = Vec::new();
    for b in &bases {
        for m in 1..=12u32 {
            if !fournis.contains(&(b.code_qualite.as_str(), m)) {
                manquants.push(format!("{} / mois {}", b.code_qualite, m));
            }
        }
    }
    if !manquants.is_empty() {
        return Err(AppError::Invalide(format!(
            "Saisonnalite incomplete : {} coefficient(s) manquant(s) ({}). \
             Chaque qualite doit porter un coefficient pour les douze mois de l'annee.",
            manquants.len(),
            manquants.iter().take(6).cloned().collect::<Vec<_>>().join(", ")
        )));
    }

    // --- Entete --------------------------------------------------------------
    let (id, cree) = match d.id_plan.as_deref().filter(|s| !s.is_empty()) {
        Some(id) => {
            sqlx::query(
                "UPDATE plan_production SET
                     libelle = ?2, scenario_nom = ?3, annee = ?4,
                     date_debut = ?5, date_fin = ?6, mois_horizon = ?7,
                     croissance_annuelle_pct = ?8,
                     date_modification = ?9, id_utilisateur_modification = ?10
                  WHERE id_plan = ?1",
            )
            .bind(id)
            .bind(d.libelle.trim())
            .bind(&d.scenario_nom)
            .bind(annee)
            .bind(depart.to_string())
            .bind(date_fin.to_string())
            .bind(horizon)
            .bind(croissance)
            .bind(&horodatage)
            .bind(&user.id)
            .execute(&mut *tx)
            .await?;
            (id.to_string(), false)
        }
        None => {
            let version: i64 = sqlx::query_scalar(
                "SELECT COALESCE(MAX(numero_version), 0) + 1 FROM plan_production WHERE annee = ?1",
            )
            .bind(annee)
            .fetch_one(&mut *tx)
            .await?;

            let id = uuid::Uuid::new_v4().to_string();
            // B3 : le plan embarque les parametres globaux du moment.
            sqlx::query(
                "INSERT INTO plan_production
                     (id_plan, annee, numero_version, libelle, scenario_nom,
                      date_debut, date_fin, mois_horizon, croissance_annuelle_pct,
                      marge_securite_pct, couv_min_mois, taux_perte_pct,
                      seuil_alerte_jours, seuil_critique_jours,
                      seuil_tier1_mad, seuil_tier2_mad, seuil_tier3_mad,
                      id_utilisateur_creation)
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                        (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_MargeSecurite'),
                        (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_CouvMinMois'),
                        (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_TauxPerte'),
                        (SELECT CAST(valeur_courante AS INTEGER) FROM parametre WHERE code_parametre='P_SeuilAlerte'),
                        (SELECT CAST(valeur_courante AS INTEGER) FROM parametre WHERE code_parametre='P_SeuilCritique'),
                        (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_SeuilTier1'),
                        (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_SeuilTier2'),
                        (SELECT CAST(valeur_courante AS REAL)    FROM parametre WHERE code_parametre='P_SeuilTier3'),
                        ?10",
            )
            .bind(&id)
            .bind(annee)
            .bind(version)
            .bind(d.libelle.trim())
            .bind(&d.scenario_nom)
            .bind(depart.to_string())
            .bind(date_fin.to_string())
            .bind(horizon)
            .bind(croissance)
            .bind(&user.id)
            .execute(&mut *tx)
            .await?;
            (id, true)
        }
    };

    // --- Recettes retenues ---------------------------------------------------
    // Table refaite a neuf : les triggers trg_plan_qualite_* arbitrent la
    // validite (qualite ACTIVE, pas d'autre plan actif).
    sqlx::query("DELETE FROM plan_qualite WHERE id_plan = ?1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    for b in &bases {
        sqlx::query(
            "INSERT INTO plan_qualite (id_plan, code_qualite, m2_base_mensuel, date_figee)
             VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(&id)
        .bind(&b.code_qualite)
        .bind(b.m2_base_mensuel)
        .bind(&horodatage)
        .execute(&mut *tx)
        .await?;
    }

    // --- Saisonnalite --------------------------------------------------------
    sqlx::query("DELETE FROM plan_saisonnalite WHERE id_plan = ?1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    let qualites: std::collections::HashSet<&str> =
        bases.iter().map(|b| b.code_qualite.as_str()).collect();

    let mut coefs = std::collections::HashMap::new();
    for c in &d.saisonnalite {
        // Un coefficient portant sur une qualite qui n'est plus au plan serait
        // du bruit : on l'ignore plutot que d'echouer sur un residu d'edition.
        if !qualites.contains(c.code_qualite.as_str()) {
            continue;
        }
        sqlx::query(
            "INSERT INTO plan_saisonnalite (id_plan, code_qualite, mois, coefficient)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (id_plan, code_qualite, mois) DO UPDATE SET coefficient = excluded.coefficient",
        )
        .bind(&id)
        .bind(&c.code_qualite)
        .bind(c.mois)
        .bind(c.coefficient)
        .execute(&mut *tx)
        .await?;
        coefs.insert((c.code_qualite.clone(), c.mois), c.coefficient);
    }

    // --- Deploiement de la grille -------------------------------------------
    let cases = deployer(depart, horizon, croissance, &bases, |q, mois| {
        coefs.get(&(q.to_string(), mois)).copied()
    });

    sqlx::query("DELETE FROM ligne_plan_production WHERE id_plan = ?1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    for c in &cases {
        sqlx::query(
            "INSERT INTO ligne_plan_production
                 (id_plan, mois, rang_mois, annee_mois, code_qualite,
                  m2_prevus, m2_base_mensuel, saisonnalite, facteur_croissance)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .bind(&id)
        .bind(c.mois)
        .bind(c.rang)
        .bind(&c.annee_mois)
        .bind(&c.code_qualite)
        .bind(c.m2_prevus)
        .bind(c.m2_base_mensuel)
        .bind(c.saisonnalite)
        .bind(c.facteur_croissance)
        .execute(&mut *tx)
        .await?;
    }

    let total: f64 = cases.iter().map(|c| c.m2_prevus).sum();
    sqlx::query("UPDATE plan_production SET m2_total_annuel = ?2 WHERE id_plan = ?1")
        .bind(&id)
        .bind(total)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(Json(json!({
        "id_plan": id,
        "cree": cree,
        "date_debut": depart.to_string(),
        "date_fin": date_fin.to_string(),
        "mois_horizon": horizon,
        "qualites_retenues": d.qualites.len(),
        "lignes_generees": cases.len(),
        "m2_total": total,
    })))
}

/// Redeploie la grille a partir de ce qui est ENREGISTRE.
///
/// L'ecran affiche un apercu calcule dans le navigateur ; ce bouton refait le
/// calcul cote serveur, a partir des bases et coefficients reellement stockes,
/// et renvoie la grille obtenue. C'est le moyen de lever tout doute sur une
/// divergence entre ce qu'on voit et ce qui est en base — et de rattraper une
/// grille laissee incoherente par un enregistrement partiel.
pub async fn recalculer_plan(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    use crate::domain::plan::{deployer, BaseQualite};
    use chrono::NaiveDate;

    user.exiger(&state.db, module::PLANS, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let (statut, date_debut, horizon, croissance): (String, String, i64, f64) = sqlx::query_as(
        "SELECT statut, date_debut, mois_horizon, croissance_annuelle_pct
           FROM plan_production WHERE id_plan = ?1",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("plan {id}")))?;

    if !matches!(statut.as_str(), "BROUILLON" | "SIMULATION") {
        return Err(AppError::RegleMetier(format!(
            "Un plan {statut} est fige : sa grille ne se recalcule plus."
        )));
    }

    let depart = NaiveDate::parse_from_str(&date_debut, "%Y-%m-%d")
        .map_err(|_| AppError::Invalide(format!("date de debut illisible : {date_debut}")))?;

    let bases: Vec<BaseQualite> = sqlx::query_as::<_, (String, f64)>(
        "SELECT code_qualite, m2_base_mensuel FROM plan_qualite
          WHERE id_plan = ?1 ORDER BY code_qualite",
    )
    .bind(&id)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .map(|(code_qualite, m2_base_mensuel)| BaseQualite { code_qualite, m2_base_mensuel })
    .collect();

    if bases.is_empty() {
        return Err(AppError::RegleMetier(
            "Ce plan ne retient aucune qualite : il n'y a rien a deployer.".into(),
        ));
    }

    let coefs: std::collections::HashMap<(String, u32), f64> =
        sqlx::query_as::<_, (String, i64, f64)>(
            "SELECT code_qualite, mois, coefficient FROM plan_saisonnalite WHERE id_plan = ?1",
        )
        .bind(&id)
        .fetch_all(&mut *tx)
        .await?
        .into_iter()
        .map(|(q, m, c)| ((q, m as u32), c))
        .collect();

    let cases = deployer(depart, horizon, croissance, &bases, |q, mois| {
        coefs.get(&(q.to_string(), mois)).copied()
    });

    sqlx::query("DELETE FROM ligne_plan_production WHERE id_plan = ?1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    for c in &cases {
        sqlx::query(
            "INSERT INTO ligne_plan_production
                 (id_plan, mois, rang_mois, annee_mois, code_qualite,
                  m2_prevus, m2_base_mensuel, saisonnalite, facteur_croissance)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .bind(&id)
        .bind(c.mois)
        .bind(c.rang)
        .bind(&c.annee_mois)
        .bind(&c.code_qualite)
        .bind(c.m2_prevus)
        .bind(c.m2_base_mensuel)
        .bind(c.saisonnalite)
        .bind(c.facteur_croissance)
        .execute(&mut *tx)
        .await?;
    }

    let total: f64 = cases.iter().map(|c| c.m2_prevus).sum();
    sqlx::query(
        "UPDATE plan_production SET m2_total_annuel = ?2, date_modification = ?3,
                                    id_utilisateur_modification = ?4
          WHERE id_plan = ?1",
    )
    .bind(&id)
    .bind(total)
    .bind(maintenant())
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(json!({
        "id_plan": id,
        "lignes_generees": cases.len(),
        "m2_total": total,
    })))
}

/// Cloture un plan : il cesse d'alimenter les besoins et libere ses recettes.
pub async fn cloturer_plan(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLANS, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: String =
        sqlx::query_scalar("SELECT statut FROM plan_production WHERE id_plan = ?1")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("plan {id}")))?;
    if statut == "CLOTURE" {
        return Err(AppError::RegleMetier("Ce plan est deja cloture.".into()));
    }

    // Le trigger trg_transition_plan verifie que la transition est declaree.
    sqlx::query(
        "UPDATE plan_production SET statut = 'CLOTURE', date_cloture = ?2,
                                    id_utilisateur_cloture = ?3,
                                    date_modification = ?2, id_utilisateur_modification = ?3
          WHERE id_plan = ?1",
    )
    .bind(&id)
    .bind(&maintenant())
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    let liberees: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plan_qualite WHERE id_plan = ?1",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(json!({
        "id_plan": id,
        "statut": "CLOTURE",
        "statut_precedent": statut,
        "qualites_liberees": liberees,
    })))
}

/// Entete complete d'un plan : qualites retenues et grille de saisonnalite.
pub async fn entete_plan(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLANS, Action::Lire).await?;

    let qualites = sqlx::query(
        "SELECT pq.code_qualite, pq.m2_base_mensuel, pq.date_figee,
                q.nom AS qualite_nom, q.statut AS qualite_statut,
                q.poids_commercial_m2,
                (SELECT COUNT(*) FROM recette r
                  WHERE r.code_qualite = pq.code_qualite AND r.actif = 1) AS nb_composition
           FROM plan_qualite pq
           JOIN qualite q ON q.code_qualite = pq.code_qualite
          WHERE pq.id_plan = ?1
          ORDER BY pq.code_qualite",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let saisons = sqlx::query(
        "SELECT code_qualite, mois, coefficient FROM plan_saisonnalite
          WHERE id_plan = ?1 ORDER BY code_qualite, mois",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "qualites": lignes_en_json(&qualites),
        "saisonnalite": lignes_en_json(&saisons),
    })))
}

pub async fn lignes_plan(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLANS, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT l.*, q.nom AS qualite_nom
           FROM ligne_plan_production l
           JOIN qualite q ON q.code_qualite = l.code_qualite
          WHERE l.id_plan = ?1
          ORDER BY l.rang_mois, l.code_qualite",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::PLANS, &mut valeur).await?;
    Ok(Json(valeur))
}

pub async fn changer_statut_plan(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(t): Json<Transition>,
) -> AppResult<Json<Value>> {
    // Mettre un plan EN_COURS, c'est le mettre en service : il alimentera le MRP
    // et le plan d'achat. C'est l'acte qui exige la permission VALIDER.
    let action = if t.statut == "EN_COURS" { Action::Valider } else { Action::Ecrire };
    user.exiger(&state.db, module::PLANS, action).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    if t.statut == "EN_COURS" {
        // R08 : le trigger refuse la mise en service si une qualite planifiee n'a
        // pas sa recette figee. Le message renvoye guide vers /figer-recettes.
        sqlx::query(
            "UPDATE plan_production SET statut = 'EN_COURS', date_validation = ?2,
                                        id_utilisateur_validation = ?3,
                                        date_modification = ?2,
                                        id_utilisateur_modification = ?3
              WHERE id_plan = ?1",
        )
        .bind(&id)
        .bind(maintenant())
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "UPDATE plan_production SET
                 statut = ?2,
                 date_cloture = CASE WHEN ?2 = 'CLOTURE' THEN COALESCE(date_cloture, ?3) END,
                 id_utilisateur_cloture = CASE WHEN ?2 = 'CLOTURE'
                                               THEN COALESCE(id_utilisateur_cloture, ?4) END,
                 date_modification = ?3, id_utilisateur_modification = ?4
              WHERE id_plan = ?1",
        )
        .bind(&id)
        .bind(&t.statut)
        .bind(maintenant())
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(Json(json!({ "id_plan": id, "statut": t.statut })))
}

pub async fn supprimer_plan(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PLANS, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: String = sqlx::query_scalar("SELECT statut FROM plan_production WHERE id_plan = ?1")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("plan {id}")))?;

    // Un plan valide alimente le MRP et le plan d'achat : le supprimer
    // effacerait la justification des commandes en cours.
    if statut != "BROUILLON" && statut != "SIMULATION" {
        return Err(AppError::RegleMetier(format!(
            "Un plan {statut} ne peut pas etre supprime. Le cloturer plutot."
        )));
    }

    sqlx::query("DELETE FROM plan_production WHERE id_plan = ?1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Json(json!({ "id_plan": id, "supprime": true })))
}
