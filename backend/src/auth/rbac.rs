//! Controle d'acces.
//!
//! DEUX NIVEAUX, DELIBEREMENT DISTINCTS :
//!
//!   1. ACCES MODULE  -> porte par le ROLE (matrice CDC D2).
//!   2. VISIBILITE CHAMP -> portee par l'UTILISATEUR (table `droit_champ`).
//!
//! Le niveau 2 est applique DANS LES DEUX SENS :
//!   * en sortie, un champ MASQUE n'apparait pas dans le JSON renvoye ;
//!   * en entree, un champ MASQUE ou LECTURE envoye en modification est
//!     REJETE PAR LE SERVEUR. Griser un champ a l'ecran ne protege rien :
//!     n'importe qui peut envoyer la requete a la main.
//!
//! Casbin est ecarte : deux moteurs d'autorisation signifient deux verites
//! possibles sur qui a le droit de faire quoi (ADR-001 D-09).

use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;

/// Modules du CDC D2.
///
/// L'enumeration est volontairement complete : elle documente la matrice des
/// permissions et doit rester alignee sur `db/seed/002_securite.sql`.
#[allow(dead_code)]
pub mod module {
    pub const PARAMETRES: &str = "PARAMETRES";
    pub const FOURNISSEURS: &str = "FOURNISSEURS";
    pub const CATALOGUE: &str = "CATALOGUE";
    pub const QUALITES: &str = "QUALITES";
    pub const RECETTES: &str = "RECETTES";
    pub const PLANS: &str = "PLANS";
    pub const MRP: &str = "MRP";
    pub const PLAN_ACHAT: &str = "PLAN_ACHAT";
    pub const BONS_COMMANDE: &str = "BONS_COMMANDE";
    pub const RECEPTIONS: &str = "RECEPTIONS";
    pub const MOUVEMENTS: &str = "MOUVEMENTS";
    pub const STOCK: &str = "STOCK";
    pub const INVENTAIRE: &str = "INVENTAIRE";
    pub const VALORISATION: &str = "VALORISATION";
    pub const COCKPIT: &str = "COCKPIT";
    pub const AUDIT: &str = "AUDIT";
    pub const UTILISATEURS: &str = "UTILISATEURS";
}

// ============================================================================
// Acces module
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Lire,
    Ecrire,
    /// Distincte de l'ecriture : toute la SoD du CDC B4 repose sur cette
    /// separation (l'acheteur redige un BC, la Direction le valide).
    Valider,
}

impl Action {
    pub fn as_str(self) -> &'static str {
        match self {
            Action::Lire => "LIRE",
            Action::Ecrire => "ECRIRE",
            Action::Valider => "VALIDER",
        }
    }
}

pub async fn a_permission(db: &Db, role: &str, module: &str, action: Action) -> AppResult<bool> {
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM permission
          WHERE code_role_user = ?1 AND module = ?2 AND action = ?3 AND actif = 1",
    )
    .bind(role)
    .bind(module)
    .bind(action.as_str())
    .fetch_one(db)
    .await?;
    Ok(n > 0)
}

pub async fn exiger(db: &Db, role: &str, module: &str, action: Action) -> AppResult<()> {
    if a_permission(db, role, module, action).await? {
        Ok(())
    } else {
        Err(AppError::NonAutorise {
            module: module.to_string(),
            action: action.as_str().to_string(),
        })
    }
}

/// Plafond de validation d'un BC pour ce role (CDC B4 regle 3).
/// `None` = illimite (Direction).
pub async fn plafond_validation_bc(db: &Db, role: &str) -> AppResult<Option<f64>> {
    Ok(sqlx::query_scalar(
        "SELECT plafond_validation_bc_mad FROM role_utilisateur WHERE code_role_user = ?1",
    )
    .bind(role)
    .fetch_optional(db)
    .await?
    .flatten())
}

// ============================================================================
// Visibilite des champs
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Niveau {
    Masque,
    Lecture,
    Ecriture,
}

impl Niveau {
    pub fn depuis(s: &str) -> Self {
        match s {
            "MASQUE" => Niveau::Masque,
            "ECRITURE" => Niveau::Ecriture,
            _ => Niveau::Lecture,
        }
    }
}

/// Grille effective d'un utilisateur pour un module.
///
/// Un champ sans ligne dans `droit_champ` prend le `niveau_defaut` du catalogue.
/// Sans ce repli, l'ajout d'un champ au produit le rendrait invisible pour tout
/// le monde jusqu'a reconfiguration manuelle de chaque compte.
pub async fn droits_champ(
    db: &Db,
    id_utilisateur: &str,
    module: &str,
) -> AppResult<HashMap<String, Niveau>> {
    let lignes: Vec<(String, String)> = sqlx::query_as(
        "SELECT cc.champ, COALESCE(dc.niveau, cc.niveau_defaut)
           FROM champ_configurable cc
           LEFT JOIN droit_champ dc
                  ON dc.module = cc.module AND dc.champ = cc.champ
                 AND dc.id_utilisateur = ?1
          WHERE cc.module = ?2",
    )
    .bind(id_utilisateur)
    .bind(module)
    .fetch_all(db)
    .await?;

    Ok(lignes
        .into_iter()
        .map(|(champ, niveau)| (champ, Niveau::depuis(&niveau)))
        .collect())
}

/// Retire recursivement d'une reponse JSON les champs de niveau MASQUE.
///
/// Le masquage se fait a la sortie plutot que par une projection SQL differente
/// par endpoint : une seule regle, appliquee uniformement, impossible a oublier
/// sur un champ.
pub fn masquer(valeur: &mut Value, droits: &HashMap<String, Niveau>) {
    let masques: Vec<&str> = droits
        .iter()
        .filter(|(_, n)| **n == Niveau::Masque)
        .map(|(c, _)| c.as_str())
        .collect();
    if masques.is_empty() {
        return;
    }
    retirer(valeur, &masques);
}

fn retirer(valeur: &mut Value, champs: &[&str]) {
    match valeur {
        Value::Object(map) => {
            for c in champs {
                map.remove(*c);
            }
            for (_, v) in map.iter_mut() {
                retirer(v, champs);
            }
        }
        Value::Array(items) => {
            for v in items.iter_mut() {
                retirer(v, champs);
            }
        }
        _ => {}
    }
}

/// Ne conserve d'une charge utile que les champs reellement modifiables.
///
/// Deux regimes, volontairement distincts :
///
///   * champ DECLARE dans `champ_configurable` — sa visibilite est pilotee par
///     la grille de l'utilisateur : il faut le niveau ECRITURE ;
///   * champ NON DECLARE — il n'est pas pilote au niveau du champ, seule la
///     permission d'ecriture sur le module le gouverne (deja verifiee par
///     l'appelant).
///
/// Refuser tout champ non declare serait plus strict, mais rendrait toute
/// creation impossible tant que chaque colonne technique n'aurait pas sa ligne
/// dans le catalogue — et la liste blanche de colonnes de l'appelant borne deja
/// ce qui peut atteindre la base. Declarer un champ ne fait donc jamais qu'en
/// RESTREINDRE l'acces, jamais l'ouvrir.
///
/// Renvoie les champs conserves et ceux qui ont ete refuses, pour que
/// l'appelant reponde explicitement plutot que d'ignorer en silence une
/// modification que l'utilisateur croit avoir enregistree.
pub fn filtrer_entree(
    charge: &Map<String, Value>,
    droits: &HashMap<String, Niveau>,
) -> (Map<String, Value>, Vec<String>) {
    let mut retenus = Map::new();
    let mut refuses = Vec::new();

    for (champ, valeur) in charge {
        match droits.get(champ) {
            Some(Niveau::Ecriture) | None => {
                retenus.insert(champ.clone(), valeur.clone());
            }
            // Champ declare, mais en MASQUE ou LECTURE pour cet utilisateur.
            Some(_) => refuses.push(champ.clone()),
        }
    }
    (retenus, refuses)
}

/// Variante stricte : echoue si la charge utile contient un champ interdit.
pub fn exiger_ecriture(
    charge: &Map<String, Value>,
    droits: &HashMap<String, Niveau>,
) -> AppResult<Map<String, Value>> {
    let (retenus, refuses) = filtrer_entree(charge, droits);
    if !refuses.is_empty() {
        return Err(AppError::ChampNonModifiable {
            champs: refuses.join(", "),
        });
    }
    Ok(retenus)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn grille() -> HashMap<String, Niveau> {
        HashMap::from([
            ("code_reference".to_string(), Niveau::Lecture),
            ("quantite_kg".to_string(), Niveau::Ecriture),
            ("prix_kg_mad".to_string(), Niveau::Masque),
            ("total_mad".to_string(), Niveau::Masque),
        ])
    }

    #[test]
    fn masquage_objet_et_tableau_imbriques() {
        let mut v = json!({
            "lignes": [
                { "code_reference": "PP-3430", "quantite_kg": 100.0, "prix_kg_mad": 28.5 },
                { "code_reference": "JUT-961", "quantite_kg": 200.0, "prix_kg_mad": 9.0 }
            ],
            "total_mad": 5000.0
        });
        masquer(&mut v, &grille());

        assert!(v.get("total_mad").is_none());
        let lignes = v["lignes"].as_array().unwrap();
        assert!(lignes[0].get("prix_kg_mad").is_none());
        assert!(lignes[1].get("prix_kg_mad").is_none());
        assert_eq!(lignes[0]["quantite_kg"], 100.0);
        assert_eq!(lignes[0]["code_reference"], "PP-3430");
    }

    #[test]
    fn ecriture_refusee_sur_champ_en_lecture_seule() {
        let charge = json!({ "quantite_kg": 5.0, "code_reference": "X" })
            .as_object()
            .unwrap()
            .clone();
        let (retenus, refuses) = filtrer_entree(&charge, &grille());
        assert_eq!(retenus.len(), 1);
        assert!(retenus.contains_key("quantite_kg"));
        assert_eq!(refuses, vec!["code_reference".to_string()]);
    }

    #[test]
    fn ecriture_refusee_sur_champ_masque() {
        let charge = json!({ "prix_kg_mad": 1.0 }).as_object().unwrap().clone();
        assert!(exiger_ecriture(&charge, &grille()).is_err());
    }

    #[test]
    fn champ_non_declare_gouverne_par_le_module() {
        // Un champ absent du catalogue n'est pas pilote au niveau du champ :
        // seule la permission d'ecriture sur le module le gouverne. La liste
        // blanche de colonnes de l'appelant borne ensuite ce qui atteint la base.
        let charge = json!({ "ordre_affichage": 10 }).as_object().unwrap().clone();
        let (retenus, refuses) = filtrer_entree(&charge, &grille());
        assert!(refuses.is_empty());
        assert_eq!(retenus["ordre_affichage"], 10);
    }

    #[test]
    fn declarer_un_champ_ne_fait_que_restreindre() {
        // Le meme champ, une fois declare en LECTURE, devient refuse.
        let charge = json!({ "ordre_affichage": 10 }).as_object().unwrap().clone();
        let mut g = grille();
        g.insert("ordre_affichage".into(), Niveau::Lecture);
        let (_, refuses) = filtrer_entree(&charge, &g);
        assert_eq!(refuses, vec!["ordre_affichage".to_string()]);
    }

    #[test]
    fn grille_sans_masque_ne_modifie_rien() {
        let mut v = json!({ "prix_kg_mad": 28.5 });
        let g = HashMap::from([("prix_kg_mad".to_string(), Niveau::Lecture)]);
        masquer(&mut v, &g);
        assert_eq!(v["prix_kg_mad"], 28.5);
    }
}
