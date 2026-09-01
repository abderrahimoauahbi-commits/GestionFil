//! Administration : comptes utilisateurs et grilles de droits par champ.
//!
//! Reserve au module UTILISATEURS (Direction en ecriture, DAF en lecture).

use super::json::lignes_en_json;
use crate::auth::{password, rbac::module, rbac::Action, Utilisateur};
use crate::domain::sauvegarde;
use crate::db::maintenant;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

// ============================================================================
// Comptes
// ============================================================================

pub async fn lister_utilisateurs(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::UTILISATEURS, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT u.id_utilisateur, u.login, u.nom, u.email, u.telephone,
                u.code_role_user, r.libelle AS role_libelle, u.magasin_principal,
                u.mfa_actif, u.derniere_connexion, u.actif, u.date_creation,
                (u.mot_de_passe_hash = '!A_DEFINIR!') AS mot_de_passe_a_definir
           FROM utilisateur u
           JOIN role_utilisateur r ON r.code_role_user = u.code_role_user
          ORDER BY r.niveau_hierarchique DESC, u.login",
    )
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::UTILISATEURS, &mut valeur).await?;
    Ok(Json(valeur))
}

pub async fn lister_roles(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::UTILISATEURS, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT r.*, (SELECT COUNT(*) FROM utilisateur u
                       WHERE u.code_role_user = r.code_role_user AND u.actif = 1) AS nb_utilisateurs
           FROM role_utilisateur r WHERE r.actif = 1
          ORDER BY r.niveau_hierarchique DESC",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&rows)))
}

#[derive(Debug, Deserialize)]
pub struct NouvelUtilisateur {
    pub login: String,
    pub nom: String,
    pub code_role_user: String,
    pub email: Option<String>,
    pub telephone: Option<String>,
    pub magasin_principal: Option<String>,
    pub mot_de_passe: String,
    #[serde(default)]
    pub mfa_actif: bool,
}

pub async fn creer_utilisateur(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(nouveau): Json<NouvelUtilisateur>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::UTILISATEURS, Action::Ecrire).await?;

    if nouveau.mot_de_passe.chars().count() < 12 {
        return Err(AppError::Invalide(
            "mot de passe trop court : 12 caracteres minimum".into(),
        ));
    }
    if nouveau.login.trim().is_empty() || nouveau.nom.trim().is_empty() {
        return Err(AppError::Invalide("login et nom sont obligatoires".into()));
    }

    let hash = password::hacher(&nouveau.mot_de_passe).map_err(AppError::Interne)?;
    let id = uuid::Uuid::new_v4().to_string();

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    sqlx::query(
        "INSERT INTO utilisateur
             (id_utilisateur, code_role_user, login, mot_de_passe_hash, nom,
              email, telephone, magasin_principal, mfa_actif)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
    )
    .bind(&id)
    .bind(&nouveau.code_role_user)
    .bind(nouveau.login.trim())
    .bind(&hash)
    .bind(nouveau.nom.trim())
    .bind(&nouveau.email)
    .bind(&nouveau.telephone)
    .bind(&nouveau.magasin_principal)
    .bind(i64::from(nouveau.mfa_actif))
    .execute(&mut *tx)
    .await?;

    // Sans grille initiale, le nouveau compte n'aurait aucun droit explicite et
    // retomberait sur les valeurs par defaut du catalogue — rarement ce qu'on
    // veut. On applique le modele du role.
    let appliques = appliquer_modele(&mut tx, &id, &nouveau.code_role_user, &user.id).await?;

    tx.commit().await?;

    Ok(Json(json!({
        "id_utilisateur": id,
        "login": nouveau.login,
        "droits_initialises": appliques,
    })))
}

#[derive(Debug, Deserialize)]
pub struct ModificationUtilisateur {
    pub nom: Option<String>,
    pub email: Option<String>,
    pub telephone: Option<String>,
    pub code_role_user: Option<String>,
    pub magasin_principal: Option<String>,
    pub mfa_actif: Option<bool>,
    pub actif: Option<bool>,
    pub mot_de_passe: Option<String>,
}

pub async fn modifier_utilisateur(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(m): Json<ModificationUtilisateur>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::UTILISATEURS, Action::Ecrire).await?;

    // Se desactiver soi-meme fermerait la porte de l'interieur.
    if m.actif == Some(false) && id == user.id {
        return Err(AppError::RegleMetier(
            "Vous ne pouvez pas desactiver votre propre compte.".into(),
        ));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let existe: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM utilisateur WHERE id_utilisateur = ?1")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    if existe == 0 {
        return Err(AppError::Introuvable(format!("utilisateur {id}")));
    }

    sqlx::query(
        "UPDATE utilisateur SET
            nom               = COALESCE(?2, nom),
            email             = COALESCE(?3, email),
            telephone         = COALESCE(?4, telephone),
            code_role_user    = COALESCE(?5, code_role_user),
            magasin_principal = COALESCE(?6, magasin_principal),
            mfa_actif         = COALESCE(?7, mfa_actif),
            actif             = COALESCE(?8, actif)
          WHERE id_utilisateur = ?1",
    )
    .bind(&id)
    .bind(&m.nom)
    .bind(&m.email)
    .bind(&m.telephone)
    .bind(&m.code_role_user)
    .bind(&m.magasin_principal)
    .bind(m.mfa_actif.map(i64::from))
    .bind(m.actif.map(i64::from))
    .execute(&mut *tx)
    .await?;

    if let Some(mdp) = &m.mot_de_passe {
        if mdp.chars().count() < 12 {
            return Err(AppError::Invalide(
                "mot de passe trop court : 12 caracteres minimum".into(),
            ));
        }
        let hash = password::hacher(mdp).map_err(AppError::Interne)?;
        sqlx::query("UPDATE utilisateur SET mot_de_passe_hash = ?2 WHERE id_utilisateur = ?1")
            .bind(&id)
            .bind(&hash)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(Json(json!({ "id_utilisateur": id, "modifie": true })))
}

// ============================================================================
// Grille de droits par champ
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct FiltreDroits {
    pub module: Option<String>,
}

/// Grille complete d'un utilisateur : tous les champs configurables, avec le
/// niveau effectif et son origine (reglage explicite ou valeur par defaut).
pub async fn lire_droits(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Query(f): Query<FiltreDroits>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::UTILISATEURS, Action::Lire).await?;

    let rows = sqlx::query(
        "SELECT cc.module, cc.champ, cc.libelle, cc.sensible, cc.ordre,
                COALESCE(dc.niveau, cc.niveau_defaut) AS niveau,
                (dc.niveau IS NOT NULL)               AS explicite,
                cc.niveau_defaut,
                mdc.niveau                            AS niveau_modele,
                dc.date_modification
           FROM champ_configurable cc
           LEFT JOIN droit_champ dc
                  ON dc.module = cc.module AND dc.champ = cc.champ
                 AND dc.id_utilisateur = ?1
           LEFT JOIN utilisateur u ON u.id_utilisateur = ?1
           LEFT JOIN modele_droit_champ mdc
                  ON mdc.module = cc.module AND mdc.champ = cc.champ
                 AND mdc.code_role_user = u.code_role_user
          WHERE (?2 IS NULL OR cc.module = ?2)
          ORDER BY cc.module, cc.ordre",
    )
    .bind(&id)
    .bind(&f.module)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(lignes_en_json(&rows)))
}

/// Catalogue des modules et champs pilotables, pour construire l'ecran.
pub async fn lister_champs(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::UTILISATEURS, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT module, champ, libelle, niveau_defaut, sensible, ordre
           FROM champ_configurable ORDER BY module, ordre",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&rows)))
}

#[derive(Debug, Deserialize)]
pub struct ReglageDroit {
    pub module: String,
    pub champ: String,
    pub niveau: String,
}

#[derive(Debug, Deserialize)]
pub struct LotDroits {
    pub droits: Vec<ReglageDroit>,
}

/// Enregistre un lot de reglages. Le front envoie l'ecran entier d'un coup.
pub async fn enregistrer_droits(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(lot): Json<LotDroits>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::UTILISATEURS, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let existe: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM utilisateur WHERE id_utilisateur = ?1")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    if existe == 0 {
        return Err(AppError::Introuvable(format!("utilisateur {id}")));
    }

    let horodatage = maintenant();
    let mut n = 0usize;
    for d in &lot.droits {
        if !matches!(d.niveau.as_str(), "MASQUE" | "LECTURE" | "ECRITURE") {
            return Err(AppError::Invalide(format!(
                "niveau invalide '{}' pour {}.{}",
                d.niveau, d.module, d.champ
            )));
        }
        // La cle etrangere vers champ_configurable refuse un champ inexistant :
        // impossible d'enregistrer un droit sur un champ qui n'existe pas.
        sqlx::query(
            "INSERT INTO droit_champ (id_utilisateur, module, champ, niveau,
                                      date_modification, id_utilisateur_modif)
             VALUES (?1,?2,?3,?4,?5,?6)
             ON CONFLICT (id_utilisateur, module, champ) DO UPDATE SET
                 niveau = excluded.niveau,
                 date_modification = excluded.date_modification,
                 id_utilisateur_modif = excluded.id_utilisateur_modif",
        )
        .bind(&id)
        .bind(&d.module)
        .bind(&d.champ)
        .bind(&d.niveau)
        .bind(&horodatage)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;
        n += 1;
    }

    tx.commit().await?;
    Ok(Json(json!({ "id_utilisateur": id, "droits_enregistres": n })))
}

#[derive(Debug, Deserialize)]
pub struct DemandeModele {
    /// Role dont on applique le modele. Par defaut, celui de l'utilisateur.
    pub code_role_user: Option<String>,
    /// Restreindre a un module ; sinon toute la grille est reinitialisee.
    pub module: Option<String>,
}

/// Reinitialise la grille depuis le modele d'un role.
///
/// Sans cette action, chaque nouvel employe demanderait la saisie manuelle de
/// plus de 200 reglages.
pub async fn appliquer_modele_role(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(d): Json<DemandeModele>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::UTILISATEURS, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let role: String = match &d.code_role_user {
        Some(r) => r.clone(),
        None => sqlx::query_scalar("SELECT code_role_user FROM utilisateur WHERE id_utilisateur = ?1")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("utilisateur {id}")))?,
    };

    if let Some(m) = &d.module {
        sqlx::query("DELETE FROM droit_champ WHERE id_utilisateur = ?1 AND module = ?2")
            .bind(&id)
            .bind(m)
            .execute(&mut *tx)
            .await?;
    } else {
        sqlx::query("DELETE FROM droit_champ WHERE id_utilisateur = ?1")
            .bind(&id)
            .execute(&mut *tx)
            .await?;
    }

    let n = sqlx::query(
        "INSERT INTO droit_champ (id_utilisateur, module, champ, niveau,
                                  date_modification, id_utilisateur_modif)
         SELECT ?1, m.module, m.champ, m.niveau, ?4, ?5
           FROM modele_droit_champ m
          WHERE m.code_role_user = ?2
            AND (?3 IS NULL OR m.module = ?3)",
    )
    .bind(&id)
    .bind(&role)
    .bind(&d.module)
    .bind(maintenant())
    .bind(&user.id)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    tx.commit().await?;
    Ok(Json(json!({
        "id_utilisateur": id,
        "modele_applique": role,
        "module": d.module,
        "droits_appliques": n,
    })))
}

/// Applique le modele d'un role dans une transaction en cours (creation de compte).
async fn appliquer_modele(
    tx: &mut sqlx::SqliteConnection,
    id_utilisateur: &str,
    role: &str,
    par: &str,
) -> AppResult<u64> {
    Ok(sqlx::query(
        "INSERT INTO droit_champ (id_utilisateur, module, champ, niveau,
                                  date_modification, id_utilisateur_modif)
         SELECT ?1, m.module, m.champ, m.niveau, ?3, ?4
           FROM modele_droit_champ m WHERE m.code_role_user = ?2",
    )
    .bind(id_utilisateur)
    .bind(role)
    .bind(maintenant())
    .bind(par)
    .execute(&mut *tx)
    .await?
    .rows_affected())
}

/* -------------------------------------------------------------------------- */
/* Sauvegarde                                                                  */
/* -------------------------------------------------------------------------- */

/// Declenche une sauvegarde et rend son emplacement.
///
/// Reservee a l'ecriture sur PARAMETRES, donc a l'administrateur systeme et a
/// la direction. Lire la liste demande seulement la lecture : savoir QUAND la
/// derniere sauvegarde a eu lieu interesse tout le monde, la declencher non.
pub async fn sauvegarder(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Ecrire).await?;
    let r = sauvegarde::creer(&state.db, &state.config.database_url).await?;
    Ok(Json(serde_json::to_value(r)?))
}

pub async fn lister_sauvegardes(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Lire).await?;
    let liste = sauvegarde::lister(&state.config.database_url)?;
    Ok(Json(serde_json::to_value(liste)?))
}
