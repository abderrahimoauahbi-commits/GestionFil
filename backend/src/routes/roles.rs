//! ADMINISTRER LES ROLES ET LEURS PERMISSIONS (13/10/2026).
//!
//! Reserve au role Administrateur. Un role porte :
//!   * ses permissions, module par module : lire, ecrire, valider ;
//!   * le MODELE de visibilite de ses champs (masque, lecture, ecriture) ;
//!   * son plafond de validation des bons de commande.
//! Changer le modele s'applique aux utilisateurs du role, sauf aux champs
//! regles a la main pour une personne (`droit_champ.origine = 'MANUEL'`).
//! Un role porte par un utilisateur ne se supprime pas ; l'Administrateur garde
//! toujours la gestion des utilisateurs (gardes en base).

use crate::auth::{rbac::module, Utilisateur};
use crate::db::maintenant;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use super::json::lignes_en_json;

/// Les modules du controle d'acces, dans l'ordre du menu, avec ce qu'ils couvrent.
const MODULES: &[(&str, &str, &str)] = &[
    (module::COCKPIT, "Tableaux de bord", "Tableau de bord, alertes, files"),
    (module::CATALOGUE, "Références", "Catalogue, catégories, équivalences, couleurs"),
    (module::FOURNISSEURS, "Fournisseurs", "Fiches fournisseur"),
    (module::QUALITES, "Qualités", "Qualités et rôles BOM"),
    (module::RECETTES, "Recettes", "Compositions des qualités"),
    (module::MRP, "Besoins (MRP)", "Calcul des besoins"),
    (module::PLANS, "Plans de production", "Plans et leur mise en service"),
    (module::PLAN_ACHAT, "Plan d’achat", "Propositions et conversion en bons"),
    (module::BONS_COMMANDE, "Bons de commande", "Création, validation, envoi"),
    (module::RECEPTIONS, "Réceptions", "Réceptions locales et import, retours fournisseur"),
    (module::IMPORT, "Importation", "Dossiers, factures, frais"),
    (module::STOCK, "Stock", "État, transferts, machines"),
    (module::MOUVEMENTS, "Mouvements", "Saisie libre, contre-passation"),
    (module::INVENTAIRE, "Inventaire", "Comptages et clôtures"),
    (module::LOTS, "Lots", "Décisions sur un lot, dérogations"),
    (module::VALORISATION, "Valorisation", "CMUP, coût de revient, rapports"),
    (module::AUDIT, "Audit", "Journal des modifications"),
    (module::PARAMETRES, "Paramètres", "Configuration, référentiels, sauvegardes"),
    (module::UTILISATEURS, "Utilisateurs", "Comptes, droits, rôles"),
];

const ACTIONS: &[&str] = &["LIRE", "ECRIRE", "VALIDER"];

fn exiger_admin(user: &Utilisateur) -> AppResult<()> {
    if user.role != "ADMIN" {
        return Err(AppError::NonAutorise {
            module: "UTILISATEURS (rôle Administrateur)".into(),
            action: "ADMINISTRER LES RÔLES".into(),
        });
    }
    Ok(())
}

/// `GET /api/admin/roles/{code}` — le role, ses permissions, le modele de ses
/// champs (tous les champs configurables, au niveau du modele ou par defaut),
/// et la liste des modules.
pub async fn lire(State(state): State<AppState>, user: Utilisateur, Path(code): Path<String>) -> AppResult<Json<Value>> {
    exiger_admin(&user)?;
    let role = sqlx::query(
        "SELECT r.code_role_user, r.libelle, r.description, r.niveau_hierarchique,
                r.plafond_validation_bc_mad::float8 AS plafond_validation_bc_mad,
                (r.exige_totp = 1) AS exige_totp,
                (SELECT count(*) FROM utilisateur u WHERE u.code_role_user = r.code_role_user) AS nb_utilisateurs
           FROM role_utilisateur r WHERE r.code_role_user = $1",
    )
    .bind(&code)
    .fetch_all(&state.db)
    .await?;
    if role.is_empty() {
        return Err(AppError::Introuvable(format!("rôle {code}")));
    }
    let permissions: Vec<(String, String)> = sqlx::query_as(
        "SELECT module, action FROM permission WHERE code_role_user = $1 AND actif = 1 ORDER BY module, action",
    )
    .bind(&code)
    .fetch_all(&state.db)
    .await?;
    let champs = sqlx::query(
        "SELECT cc.module, cc.champ, cc.libelle, cc.sensible, cc.ordre, cc.niveau_defaut,
                COALESCE(m.niveau, cc.niveau_defaut) AS niveau, (m.niveau IS NOT NULL) AS au_modele
           FROM champ_configurable cc
           LEFT JOIN modele_droit_champ m
                  ON m.module = cc.module AND m.champ = cc.champ AND m.code_role_user = $1
          ORDER BY cc.module, cc.ordre, cc.champ",
    )
    .bind(&code)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({
        "role": lignes_en_json(&role).get(0).cloned().unwrap_or(Value::Null),
        "permissions": permissions.iter().map(|(m, a)| json!({"module": m, "action": a})).collect::<Vec<_>>(),
        "champs": lignes_en_json(&champs),
        "modules": MODULES.iter().map(|(c, l, d)| json!({"module": c, "libelle": l, "description": d})).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
pub struct Permission {
    module: String,
    action: String,
}

#[derive(Deserialize)]
pub struct ReglageChamp {
    module: String,
    champ: String,
    niveau: String,
}

#[derive(Deserialize)]
pub struct RoleSaisi {
    /// A la creation seulement : le code du role, en majuscules.
    code_role_user: Option<String>,
    libelle: String,
    description: Option<String>,
    plafond_validation_bc_mad: Option<f64>,
    /// La double authentification est-elle obligatoire pour ce role ?
    exige_totp: Option<bool>,
    /// A la creation : le role dont on part (permissions et modele recopies).
    a_partir_de: Option<String>,
    permissions: Option<Vec<Permission>>,
    champs: Option<Vec<ReglageChamp>>,
}

fn controler(s: &RoleSaisi) -> AppResult<()> {
    if s.libelle.trim().chars().count() < 3 {
        return Err(AppError::Invalide("Le libellé du rôle compte au moins 3 caractères.".into()));
    }
    if let Some(p) = s.plafond_validation_bc_mad {
        if !(p >= 0.0) || !p.is_finite() {
            return Err(AppError::Invalide("Le plafond de validation ne peut pas être négatif.".into()));
        }
    }
    for p in s.permissions.iter().flatten() {
        if !MODULES.iter().any(|(c, ..)| *c == p.module) || !ACTIONS.contains(&p.action.as_str()) {
            return Err(AppError::Invalide(format!("Permission inconnue : {} / {}.", p.module, p.action)));
        }
    }
    for c in s.champs.iter().flatten() {
        if !matches!(c.niveau.as_str(), "MASQUE" | "LECTURE" | "ECRITURE") {
            return Err(AppError::Invalide(format!("Niveau inconnu pour {}.{} : {}.", c.module, c.champ, c.niveau)));
        }
    }
    Ok(())
}

/// Pose les permissions, le modele de champs, et repercute le modele sur les
/// utilisateurs du role (sauf leurs reglages manuels).
async fn poser(tx: &mut sqlx::PgConnection, user: &Utilisateur, code: &str, s: &RoleSaisi) -> AppResult<(u64, u64)> {
    if let Some(perms) = &s.permissions {
        // L'Administrateur garde la gestion des utilisateurs : la base refuse
        // de la lui retirer ; on ne la retire donc jamais ici.
        let voulues: Vec<(String, String)> = perms.iter().map(|p| (p.module.clone(), p.action.clone())).collect();
        let (mods, acts): (Vec<String>, Vec<String>) = voulues.iter().cloned().unzip();
        sqlx::query(
            "DELETE FROM permission
              WHERE code_role_user = $1
                AND NOT (code_role_user = 'ADMIN' AND module = 'UTILISATEURS')
                AND (module, action) NOT IN (SELECT * FROM unnest($2::text[], $3::text[]))",
        )
        .bind(code)
        .bind(&mods)
        .bind(&acts)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO permission (code_role_user, module, action)
             SELECT $1, m, a FROM unnest($2::text[], $3::text[]) AS v(m, a)
             ON CONFLICT (code_role_user, module, action) DO UPDATE SET actif = 1",
        )
        .bind(code)
        .bind(&mods)
        .bind(&acts)
        .execute(&mut *tx)
        .await?;
    }
    let mut modele = 0u64;
    let mut repercutes = 0u64;
    if let Some(champs) = &s.champs {
        let horodatage = maintenant();
        for c in champs {
            modele += sqlx::query(
                "INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (code_role_user, module, champ) DO UPDATE SET niveau = excluded.niveau
                 WHERE modele_droit_champ.niveau IS DISTINCT FROM excluded.niveau",
            )
            .bind(code)
            .bind(&c.module)
            .bind(&c.champ)
            .bind(&c.niveau)
            .execute(&mut *tx)
            .await?
            .rows_affected();
        }
        // Les utilisateurs du role suivent le modele, sauf leurs reglages manuels.
        repercutes += sqlx::query(
            "UPDATE droit_champ d
                SET niveau = m.niveau, date_modification = fn_instant($2), id_utilisateur_modif = $3
               FROM utilisateur u, modele_droit_champ m
              WHERE u.id_utilisateur = d.id_utilisateur AND u.code_role_user = $1
                AND m.code_role_user = $1 AND m.module = d.module AND m.champ = d.champ
                AND d.origine = 'MODELE' AND d.niveau IS DISTINCT FROM m.niveau",
        )
        .bind(code)
        .bind(&horodatage)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        repercutes += sqlx::query(
            "INSERT INTO droit_champ (id_utilisateur, module, champ, niveau, date_modification,
                                      id_utilisateur_modif, origine)
             SELECT u.id_utilisateur, m.module, m.champ, m.niveau, fn_instant($2), $3, 'MODELE'
               FROM utilisateur u JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
              WHERE u.code_role_user = $1
             ON CONFLICT (id_utilisateur, module, champ) DO NOTHING",
        )
        .bind(code)
        .bind(&horodatage)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    }
    Ok((modele, repercutes))
}

/// `POST /api/admin/roles` — un role nouveau, vide ou recopie d'un autre.
pub async fn creer(State(state): State<AppState>, user: Utilisateur, Json(s): Json<RoleSaisi>) -> AppResult<Json<Value>> {
    exiger_admin(&user)?;
    controler(&s)?;
    let code: String = s
        .code_role_user
        .as_deref()
        .map(|c| c.trim().to_uppercase())
        .filter(|c| !c.is_empty())
        .ok_or_else(|| AppError::Invalide("Donnez un code au rôle (ex. ACHETEUR).".into()))?;
    if !code.chars().all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '_') || code.len() > 30 {
        return Err(AppError::Invalide(
            "Le code d’un rôle s’écrit en majuscules, chiffres et _ (30 caractères au plus).".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let existe: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM role_utilisateur WHERE code_role_user = $1)")
        .bind(&code)
        .fetch_one(&mut *tx)
        .await?;
    if existe {
        return Err(AppError::RegleMetier(format!("Le rôle {code} existe déjà.")));
    }
    sqlx::query(
        "INSERT INTO role_utilisateur (code_role_user, libelle, description, niveau_hierarchique,
                                       plafond_validation_bc_mad, exige_totp)
         VALUES ($1, btrim($2), NULLIF(btrim($3), ''), 10, round($4::numeric, 2), $5)",
    )
    .bind(&code)
    .bind(&s.libelle)
    .bind(&s.description)
    .bind(s.plafond_validation_bc_mad)
    .bind(i16::from(s.exige_totp.unwrap_or(false)))
    .execute(&mut *tx)
    .await?;
    if let Some(source) = s.a_partir_de.as_deref().filter(|x| !x.is_empty()) {
        sqlx::query(
            "INSERT INTO permission (code_role_user, module, action)
             SELECT $1, module, action FROM permission WHERE code_role_user = $2 AND actif = 1
             ON CONFLICT DO NOTHING",
        )
        .bind(&code)
        .bind(source)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
             SELECT $1, module, champ, niveau FROM modele_droit_champ WHERE code_role_user = $2
             ON CONFLICT DO NOTHING",
        )
        .bind(&code)
        .bind(source)
        .execute(&mut *tx)
        .await?;
    }
    poser(&mut tx, &user, &code, &s).await?;
    tx.commit().await?;
    Ok(Json(json!({ "code_role_user": code })))
}

/// `PUT /api/admin/roles/{code}` — libelle, plafond, permissions, modele.
pub async fn modifier(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
    Json(s): Json<RoleSaisi>,
) -> AppResult<Json<Value>> {
    exiger_admin(&user)?;
    controler(&s)?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let n = sqlx::query(
        "UPDATE role_utilisateur
            SET libelle = btrim($2), description = NULLIF(btrim($3), ''),
                plafond_validation_bc_mad = round($4::numeric, 2),
                exige_totp = COALESCE($5, exige_totp)
          WHERE code_role_user = $1",
    )
    .bind(&code)
    .bind(&s.libelle)
    .bind(&s.description)
    .bind(s.plafond_validation_bc_mad)
    .bind(s.exige_totp.map(i16::from))
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(AppError::Introuvable(format!("rôle {code}")));
    }
    let (modele, repercutes) = poser(&mut tx, &user, &code, &s).await?;
    tx.commit().await?;
    Ok(Json(json!({ "code_role_user": code, "champs_modifies": modele, "droits_repercutes": repercutes })))
}

/// `DELETE /api/admin/roles/{code}` — un role que personne ne porte (la base
/// refuse sinon, et refuse toujours l'Administrateur).
pub async fn supprimer(State(state): State<AppState>, user: Utilisateur, Path(code): Path<String>) -> AppResult<Json<Value>> {
    exiger_admin(&user)?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let n = sqlx::query("DELETE FROM role_utilisateur WHERE code_role_user = $1")
        .bind(&code)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::Introuvable(format!("rôle {code}")));
    }
    tx.commit().await?;
    Ok(Json(json!({ "supprime": code })))
}
