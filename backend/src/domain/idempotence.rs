//! LE DOUBLE ENVOI D'UNE CREATION (audit P3, 19/10/2026).
//!
//! Le reseau coupe apres que le serveur a enregistre, avant que l'ecran ait lu
//! la reponse : l'utilisateur, qui n'a rien vu, appuie de nouveau sur
//! « Enregistrer ». Avec un identifiant tire par le serveur, ce second envoi
//! etait un SECOND document — deux bons, deux receptions, deux mouvements de
//! stock pour le meme camion.
//!
//! Desormais l'ECRAN tire l'identifiant du document a l'ouverture du formulaire
//! et l'envoie avec chaque tentative. La cle primaire fait le reste :
//! - le second envoi arrive APRES le premier (le cas reel : on ressaie) : le
//!   document existe, on renvoie ce que la creation avait repondu, marque
//!   `deja_enregistre` ; rien n'est ecrit une seconde fois ;
//! - les deux arrivent ENSEMBLE : l'un des deux bute sur la cle primaire, dans
//!   sa transaction, et repond 409 — la base tranche, pas ce module.
//!
//! Un identifiant absent reste permis (les scripts, l'import, les anciens
//! ecrans) : le serveur en tire un, comme avant.

use serde_json::Value;
use sqlx::PgPool;

use crate::error::{AppError, AppResult};

/// Un document dont la creation accepte l'identifiant de l'ecran.
pub struct Document {
    /// Ce qu'on dit a l'utilisateur quand l'identifiant appartient a autrui.
    pub nom: &'static str,
    /// Relit le document deja enregistre (`$1` = identifiant) et rend LES MEMES
    /// CHAMPS que la reponse de sa creation, plus `auteur` (le compte createur),
    /// que ce module retire avant de repondre.
    pub relecture: &'static str,
}

pub const BON_COMMANDE: Document = Document {
    nom: "un bon de commande",
    relecture: "SELECT b.id_bc, b.numero_bc, b.code_devise,
                       b.taux_change_engage::float8 AS taux_change_engage,
                       (SELECT count(*) FROM ligne_bc l WHERE l.id_bc = b.id_bc) AS lignes,
                       b.id_utilisateur_creation AS auteur
                  FROM bon_commande b WHERE b.id_bc = $1",
};

pub const RECEPTION: Document = Document {
    nom: "une reception",
    relecture: "SELECT r.id_reception, r.numero_reception, r.code_fournisseur,
                       (SELECT count(*) FROM ligne_reception l
                         WHERE l.id_reception = r.id_reception) AS lignes,
                       g.id_bc AS bc_regularisation, g.numero_bc AS numero_bc_regularisation,
                       r.id_utilisateur_reception AS auteur
                  FROM reception r
                  LEFT JOIN LATERAL (SELECT id_bc, numero_bc FROM bon_commande
                                      WHERE id_reception_regularisee = r.id_reception
                                      ORDER BY date_creation DESC LIMIT 1) g ON true
                 WHERE r.id_reception = $1",
};

pub const MOUVEMENT: Document = Document {
    nom: "un mouvement",
    relecture: "SELECT m.id_mouvement, m.numero_mouvement,
                       count(l.*) AS lignes,
                       COALESCE(round(sum(l.quantite_kg), 4), 0)::float8 AS quantite_totale_kg,
                       m.id_utilisateur AS auteur
                  FROM mouvement m
                  LEFT JOIN ligne_mouvement l ON l.id_mouvement = m.id_mouvement
                 WHERE m.id_mouvement = $1
                 GROUP BY m.id_mouvement",
};

pub const TRANSFERT: Document = Document {
    nom: "un transfert",
    relecture: "SELECT t.id_transfert, t.numero_transfert,
                       count(l.*) AS lignes,
                       COALESCE(round(sum(l.quantite_kg), 4), 0)::float8 AS quantite_totale_kg,
                       t.id_utilisateur AS auteur
                  FROM transfert t
                  LEFT JOIN ligne_transfert l ON l.id_transfert = t.id_transfert
                 WHERE t.id_transfert = $1
                 GROUP BY t.id_transfert",
};

pub const INVENTAIRE: Document = Document {
    nom: "un inventaire",
    relecture: "SELECT i.id_inventaire, i.numero_inventaire,
                       (SELECT count(*) FROM ligne_inventaire l
                         WHERE l.id_inventaire = i.id_inventaire) AS lignes_a_compter,
                       i.id_utilisateur_responsable AS auteur
                  FROM inventaire i WHERE i.id_inventaire = $1",
};

pub const RETOUR: Document = Document {
    nom: "un retour fournisseur",
    relecture: "SELECT r.id_retour, r.numero, r.statut AS statut_retour,
                       r.id_utilisateur_creation AS auteur
                  FROM retour_fournisseur r WHERE r.id_retour = $1",
};

pub const FACTURE: Document = Document {
    nom: "une facture fournisseur",
    relecture: "SELECT f.id_facture,
                       (SELECT count(*) FROM ligne_facture_fournisseur l
                         WHERE l.id_facture = f.id_facture) AS lignes,
                       f.id_utilisateur_creation AS auteur
                  FROM facture_fournisseur f WHERE f.id_facture = $1",
};

/// L'identifiant du document a creer : celui que l'ecran a tire, sinon un neuf.
///
/// Un identifiant fourni doit etre un UUID. Il devient la cle primaire, et une
/// cle choisie librement (« BC-2026-001 », une chaine vide) se confondrait avec
/// les numeros, ou viderait la garantie.
pub fn identifiant(fourni: Option<&str>) -> AppResult<String> {
    match fourni.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(uuid::Uuid::new_v4().to_string()),
        Some(s) => uuid::Uuid::parse_str(s)
            .map(|u| u.hyphenated().to_string())
            .map_err(|_| {
                AppError::Invalide(format!(
                    "Identifiant de document invalide : « {s} » n'est pas un UUID."
                ))
            }),
    }
}

/// Le document existe-t-il deja ? Alors c'est le meme envoi qui revient : on
/// rend ce que sa creation avait repondu, et l'appelant s'arrete la.
///
/// Un document existant cree par UN AUTRE compte n'est pas un rejeu : un UUID
/// ne se rencontre pas par hasard, c'est un identifiant repris. Refus (409),
/// sans rien dire du document.
pub async fn deja_enregistre(
    db: &PgPool,
    doc: &Document,
    id: &str,
    id_utilisateur: &str,
) -> AppResult<Option<Value>> {
    let Some(ligne) = sqlx::query(doc.relecture).bind(id).fetch_optional(db).await? else {
        return Ok(None);
    };
    let mut v = crate::routes::json::ligne_en_json(&ligne);
    let objet = v.as_object_mut().ok_or_else(|| AppError::Interne(anyhow::anyhow!("relecture sans colonnes")))?;
    let auteur = objet.remove("auteur");
    if auteur.as_ref().and_then(Value::as_str) != Some(id_utilisateur) {
        return Err(AppError::Conflit(format!(
            "Cet identifiant est deja celui d'{} enregistre par un autre compte.",
            doc.nom
        )));
    }
    objet.insert("deja_enregistre".into(), Value::Bool(true));
    Ok(Some(v))
}

#[cfg(test)]
mod tests {
    use super::identifiant;

    #[test]
    fn absent_ou_vide_tire_un_identifiant_neuf() {
        let a = identifiant(None).unwrap();
        let b = identifiant(Some("  ")).unwrap();
        assert_eq!(a.len(), 36);
        assert_ne!(a, b);
    }

    #[test]
    fn fourni_est_garde_sous_sa_forme_canonique() {
        let u = "5E0B6A1C-2F3D-4B5A-9C8D-7E6F5A4B3C2D";
        assert_eq!(identifiant(Some(u)).unwrap(), u.to_lowercase());
    }

    #[test]
    fn une_cle_qui_n_est_pas_un_uuid_est_refusee() {
        assert!(identifiant(Some("BC-2026-001")).is_err());
    }
}
