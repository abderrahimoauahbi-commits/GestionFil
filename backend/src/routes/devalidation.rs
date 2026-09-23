//! DEFAIRE UNE VALIDATION, ROUVRIR UNE CLOTURE.
//!
//! POURQUOI CELA N'EXISTAIT PAS, ET POURQUOI IL LE FAUT. Chaque document de
//! l'ERP sait se valider et se cloturer ; aucun ne savait revenir en arriere.
//! Un bon valide par erreur restait valide, un inventaire cloture trop tot
//! restait clos. La seule issue etait d'en creer un second, ce qui double les
//! lignes au lieu de corriger la premiere.
//!
//! LE MODELE EST CELUI DES GRANDS ERP : « reset to draft » chez Odoo et
//! Dynamics, avec trois regles qui ne se negocient pas.
//!
//!   1. C'EST UN ACTE DE DIRECTION. Valider se delegue ; defaire la validation
//!      d'un autre, non.
//!
//!   2. LE MOTIF EST OBLIGATOIRE, en toutes lettres. Un retour en arriere sans
//!      raison ecrite est un trou dans l'histoire du document.
//!
//!   3. ON NE DEFAIT PAS UN PAPIER TANT QUE LE STOCK TIENT. Un document valide
//!      qui a produit des mouvements ne redevient pas brouillon : il laisserait
//!      un magasin qui ne correspond plus a aucun papier. Il faut d'abord
//!      CONTRE-PASSER ses mouvements — l'ERP sait le faire depuis aujourd'hui —
//!      et la devalidation devient alors possible d'elle-meme.
//!
//! LA TRACE EST ECRITE A LA MAIN, dans `audit_log`. Les declencheurs d'audit
//! enregistrent bien l'UPDATE, mais ils ne savent pas POURQUOI : le motif, lui,
//! ne se devine pas.

use crate::auth::{rbac::Action, Utilisateur};
use crate::db::maintenant;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct DemandeDevalidation {
    pub motif: String,
}

/// Un document qu'on sait faire reculer, et ce qui l'en empeche.
struct Reversible {
    /// Segment d'URL, celui que l'ecran connait deja.
    chemin: &'static str,
    table: &'static str,
    cle: &'static str,
    module: &'static str,
    /// Les etats depuis lesquels le retour est possible.
    depuis: &'static [&'static str],
    /// L'etat retrouve.
    vers: &'static str,
    /// Les colonnes de validation ou de cloture a effacer, s'il y en a.
    effacer: &'static [&'static str],
    /// La colonne qui porte la reference utilisee dans `mouvement`, quand ce
    /// document en produit. `None` = ce document ne touche pas au stock.
    document_mouvements: Option<&'static str>,
    /// Un refus supplementaire, propre au document : condition SQL vraie =
    /// interdit, et le message qui l'explique.
    garde: Option<(&'static str, &'static str)>,
}

const REVERSIBLES: &[Reversible] = &[
    Reversible {
        chemin: "bons-commande",
        table: "bon_commande",
        cle: "id_bc",
        module: "BONS_COMMANDE",
        depuis: &["VALIDE", "ENVOYE"],
        vers: "BROUILLON",
        effacer: &["id_utilisateur_validation", "date_validation", "date_envoi"],
        document_mouvements: None,
        // UN BON DEJA SERVI NE REDEVIENT PAS BROUILLON. La marchandise est
        // arrivee ; le bon en est la preuve, et l'effacer laisserait une
        // reception sans commande.
        garde: Some((
            "EXISTS (SELECT 1 FROM ligne_bc l WHERE l.id_bc = d.id_bc \
             AND COALESCE(l.quantite_recue_kg, 0) > 0)",
            "Ce bon a deja recu de la marchandise : il ne redevient pas brouillon. \
             Annulez-le, ou modifiez-le si le fournisseur n'a pas tout livre.",
        )),
    },
    Reversible {
        chemin: "receptions",
        table: "reception",
        cle: "id_reception",
        module: "RECEPTIONS",
        depuis: &["VALIDE", "CLOTURE"],
        vers: "A_CONTROLER",
        effacer: &["id_utilisateur_controle", "date_controle"],
        document_mouvements: Some("numero_reception"),
        garde: None,
    },
    Reversible {
        chemin: "inventaires",
        table: "inventaire",
        cle: "id_inventaire",
        module: "INVENTAIRE",
        depuis: &["CLOTURE"],
        vers: "EN_COURS",
        effacer: &["date_cloture"],
        document_mouvements: Some("id_inventaire"),
        garde: None,
    },
    Reversible {
        chemin: "plans",
        table: "plan_production",
        cle: "id_plan",
        module: "PLANS",
        depuis: &["EN_COURS", "CLOTURE"],
        vers: "BROUILLON",
        effacer: &[
            "id_utilisateur_validation",
            "date_validation",
            "id_utilisateur_cloture",
            "date_cloture",
        ],
        document_mouvements: None,
        garde: None,
    },
    Reversible {
        chemin: "qualites",
        table: "qualite",
        cle: "code_qualite",
        module: "QUALITES",
        depuis: &["CLOTURE"],
        vers: "ACTIF",
        effacer: &["date_cloture"],
        document_mouvements: None,
        garde: None,
    },
    Reversible {
        chemin: "dossiers-import",
        table: "import_dossiers",
        cle: "id_dossier",
        module: "IMPORT",
        depuis: &["CLOTURE"],
        vers: "EN_COURS",
        effacer: &["id_utilisateur_cloture", "date_cloture"],
        document_mouvements: None,
        garde: None,
    },
];

fn reversible(chemin: &str) -> AppResult<&'static Reversible> {
    REVERSIBLES
        .iter()
        .find(|r| r.chemin == chemin)
        .ok_or_else(|| {
            AppError::Invalide(format!(
                "« {chemin} » ne sait pas revenir en arriere. Documents reversibles : {}.",
                REVERSIBLES
                    .iter()
                    .map(|r| r.chemin)
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        })
}

/// `POST /api/devalider/{document}/{id}` — le document recule d'un cran.
pub async fn devalider(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((chemin, id)): Path<(String, String)>,
    Json(d): Json<DemandeDevalidation>,
) -> AppResult<Json<Value>> {
    let r = reversible(&chemin)?;
    user.exiger(&state.db, r.module, Action::Valider).await?;
    if user.role != "ADMIN" && user.role != "DIRECTION" {
        return Err(AppError::NonAutorise {
            module: r.module.into(),
            action: "DEVALIDER".into(),
        });
    }
    let motif = d.motif.trim().to_string();
    if motif.chars().count() < 5 {
        return Err(AppError::Invalide(
            "Le motif est obligatoire : dites en quelques mots pourquoi ce document \
             revient en arriere."
                .into(),
        ));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let statut: Option<String> = sqlx::query_scalar(&format!(
        "SELECT statut FROM {} WHERE {} = $1",
        r.table, r.cle
    ))
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(statut) = statut else {
        return Err(AppError::Introuvable(format!("{} {id}", r.chemin)));
    };
    if !r.depuis.contains(&statut.as_str()) {
        return Err(AppError::RegleMetier(format!(
            "Ce document est « {statut} » : on ne revient en arriere que depuis {}.",
            r.depuis.join(" ou ")
        )));
    }

    // LE STOCK D'ABORD, LE PAPIER ENSUITE.
    if let Some(colonne) = r.document_mouvements {
        let reference: Option<String> = sqlx::query_scalar(&format!(
            "SELECT {colonne}::text FROM {} WHERE {} = $1",
            r.table, r.cle
        ))
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .flatten();
        if let Some(reference) = reference {
            let vivants: Option<(i64, f64)> = sqlx::query_as(
                "SELECT nb_mouvements, kg::float8 FROM v_document_mouvements_vivants
                  WHERE document = $1",
            )
            .bind(&reference)
            .fetch_optional(&mut *tx)
            .await?;
            if let Some((nb, kg)) = vivants {
                if nb > 0 {
                    return Err(AppError::RegleMetier(format!(
                        "Ce document porte encore {nb} mouvement(s) de stock, soit {kg:.0} kg \
                         qui sont dans les magasins. Contre-passez-les d'abord : le papier ne \
                         peut pas reculer pendant que la marchandise avance."
                    )));
                }
            }
        }
    }

    if let Some((condition, message)) = r.garde {
        let interdit: bool = sqlx::query_scalar(&format!(
            "SELECT {condition} FROM {} d WHERE d.{} = $1",
            r.table, r.cle
        ))
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
        if interdit {
            return Err(AppError::RegleMetier(message.to_string()));
        }
    }

    let remises = r
        .effacer
        .iter()
        .map(|c| format!("{c} = NULL"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = if remises.is_empty() {
        format!("UPDATE {} SET statut = $2 WHERE {} = $1", r.table, r.cle)
    } else {
        format!(
            "UPDATE {} SET statut = $2, {remises} WHERE {} = $1",
            r.table, r.cle
        )
    };
    sqlx::query(&sql)
        .bind(&id)
        .bind(r.vers)
        .execute(&mut *tx)
        .await?;

    // LE MOTIF NE SE DEVINE PAS : les declencheurs d'audit voient l'UPDATE,
    // pas la raison. On l'ecrit donc explicitement.
    sqlx::query(
        "INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                                anciennes_valeurs, nouvelles_valeurs,
                                id_utilisateur, adresse_ip, session_id, date_operation)
         VALUES ($1, 'DEVALIDATION', $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(r.table)
    .bind(&id)
    .bind(json!({ "statut": statut }))
    .bind(json!({ "statut": r.vers, "motif": motif }))
    .bind(&user.id)
    .bind(user.adresse_ip.as_deref())
    .bind(&user.session_id)
    .bind(maintenant())
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(json!({
        "document": r.chemin,
        "cle": id,
        "de": statut,
        "vers": r.vers,
        "motif": motif,
    })))
}

/// `GET /api/devalider` — ce que l'ERP sait faire reculer, et depuis quel etat.
///
/// L'ecran s'en sert pour n'afficher le bouton que la ou il aboutira : proposer
/// un geste qui sera refuse est pire que ne rien proposer.
pub async fn documents_reversibles(
    State(_state): State<AppState>,
    _user: Utilisateur,
) -> AppResult<Json<Value>> {
    Ok(Json(json!(REVERSIBLES
        .iter()
        .map(|r| json!({
            "document": r.chemin,
            "module": r.module,
            "depuis": r.depuis,
            "vers": r.vers,
            "touche_le_stock": r.document_mouvements.is_some(),
        }))
        .collect::<Vec<_>>())))
}
