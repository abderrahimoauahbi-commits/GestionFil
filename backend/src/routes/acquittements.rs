//! L'ACQUITTEMENT D'UNE ANOMALIE DE CONTROLE (revue des 22 domaines, point 4 ;
//! arbitrage du 06/11/2026, mis en oeuvre le 07/11/2026).
//!
//! Une anomalie d'un controle ATTENTION ou CRITIQUE peut etre acquittee — vue,
//! comprise, laissee —, jamais celle d'un BLOQUANT ; par le droit VALIDER du
//! module des controles ; l'acquittement vaut TANT QUE L'ANOMALIE EXISTE.
//!
//! Une anomalie est une ligne du detail du controle, reconnue par son
//! EMPREINTE (md5 de la ligne en jsonb, calculee par la base). Une ligne qui
//! change est une autre anomalie. Quand une lecture du controle ne retrouve
//! plus une anomalie acquittee, l'acquittement est leve (DISPARUE) : il ne
//! couvrira pas une anomalie qui reviendrait plus tard. Retirer un
//! acquittement le leve aussi (RETIREE). Rien ne s'efface (`2026-11-07a`).
//!
//! Le compteur `anomalies` des controles reste le compte brut : l'acquittement
//! ne repeint pas la regle, il dit seulement combien de lignes sont deja vues
//! (`acquittees`).

use super::couverture::{controle_moteur_detail, Etats, CONTROLES_MOTEUR};
use super::json::lignes_en_json;
use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

/// La cle technique de l'empreinte, posee sur chaque ligne de detail.
pub const EMPREINTE: &str = "empreinte_anomalie";

/// Le code d'un controle (c01…c99), valide contre une liste blanche stricte :
/// il alimente un nom de vue, jamais interpole tel quel.
pub fn code_valide(code: &str) -> AppResult<String> {
    let c = code.to_lowercase();
    if c.len() == 3 && c.starts_with('c') && c[1..].chars().all(|x| x.is_ascii_digit()) {
        Ok(c)
    } else {
        Err(AppError::Invalide(format!("code de controle invalide : {code}")))
    }
}

fn est_du_moteur(code: &str) -> bool {
    CONTROLES_MOTEUR.iter().any(|(c, _, _)| c.eq_ignore_ascii_case(code))
}

/// LES LIGNES DU DETAIL D'UN CONTROLE, chacune avec son empreinte. `None` :
/// aucun controle de ce code. Les controles du moteur de couverture (C05, C25,
/// C68, C69) n'ont pas de vue : leurs lignes viennent du moteur, et leur
/// empreinte de la meme normalisation jsonb. Non masque : l'appelant masque.
pub async fn lignes_du_controle(db: &Db, etats: Option<&Etats>, code: &str) -> AppResult<Option<Vec<Value>>> {
    let code = code_valide(code)?;
    if est_du_moteur(&code) {
        let calcules;
        let e = match etats {
            Some(e) => e,
            None => {
                calcules = super::couverture::etats(db).await?;
                &calcules
            }
        };
        let Some(Value::Array(mut lignes)) = controle_moteur_detail(db, e, &code).await? else {
            return Ok(Some(Vec::new()));
        };
        let empreintes: Vec<String> = sqlx::query_scalar(
            "SELECT md5(x::text) FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY t(x, n) ORDER BY n",
        )
        .bind(Value::Array(lignes.clone()).to_string())
        .fetch_all(db)
        .await?;
        for (l, e) in lignes.iter_mut().zip(empreintes) {
            if let Some(o) = l.as_object_mut() {
                o.insert(EMPREINTE.into(), json!(e));
            }
        }
        return Ok(Some(lignes));
    }
    let vue = format!("v_ctl_{code}");
    let existe: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.views WHERE table_schema = 'public' AND table_name = $1",
    )
    .bind(&vue)
    .fetch_one(db)
    .await?;
    if existe == 0 {
        return Ok(None);
    }
    let rows = sqlx::query(&format!("SELECT md5(to_jsonb(v)::text) AS {EMPREINTE}, v.* FROM {vue} v"))
        .fetch_all(db)
        .await?;
    Ok(Some(match lignes_en_json(&rows) {
        Value::Array(a) => a,
        _ => Vec::new(),
    }))
}

/// POSE LES ACQUITTEMENTS EN COURS sur les lignes du controle et leve ceux dont
/// l'anomalie a disparu. Rend le nombre de lignes acquittees.
pub async fn annoter(db: &Db, user: &Utilisateur, code: &str, lignes: &mut [Value]) -> AppResult<usize> {
    let code = code.to_uppercase();
    let en_cours: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT a.id_acceptation, a.empreinte, a.motif, COALESCE(u.login, a.id_utilisateur),
                to_char(a.date_acceptation AT TIME ZONE 'Africa/Casablanca', 'YYYY-MM-DD HH24:MI')
           FROM controle_acceptation a
           LEFT JOIN utilisateur u ON u.id_utilisateur = a.id_utilisateur
          WHERE a.code_controle = $1 AND a.date_levee IS NULL",
    )
    .bind(&code)
    .fetch_all(db)
    .await?;
    if en_cours.is_empty() {
        return Ok(0);
    }
    let mut par_empreinte: HashMap<&str, &(String, String, String, String, String)> =
        en_cours.iter().map(|a| (a.1.as_str(), a)).collect();
    let mut acquittees = 0;
    for l in lignes.iter_mut() {
        let Some(o) = l.as_object_mut() else { continue };
        let Some(e) = o.get(EMPREINTE).and_then(Value::as_str).map(str::to_string) else { continue };
        if let Some(a) = par_empreinte.remove(e.as_str()) {
            o.insert("id_acceptation".into(), json!(a.0));
            o.insert("motif_acceptation".into(), json!(a.2));
            o.insert("acquittee_par".into(), json!(a.3));
            o.insert("date_acceptation".into(), json!(a.4));
            acquittees += 1;
        }
    }
    // Ce qui reste n'a plus d'anomalie : l'acquittement est leve, il ne couvrira
    // pas une anomalie qui reviendrait.
    let disparues: Vec<String> = par_empreinte.values().map(|a| a.0.clone()).collect();
    if !disparues.is_empty() {
        let mut tx = db.begin().await?;
        user.poser_contexte(&mut tx).await?;
        sqlx::query(
            "UPDATE controle_acceptation SET date_levee = now(), motif_levee = 'DISPARUE'
              WHERE id_acceptation = ANY($1) AND date_levee IS NULL",
        )
        .bind(&disparues)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
    }
    Ok(acquittees)
}

/// Le nombre de lignes acquittees de chaque controle qui a des acquittements en
/// cours (les autres : zero, sans relire leur detail).
pub async fn acquittees_par_controle(
    db: &Db,
    user: &Utilisateur,
    etats: &Etats,
) -> AppResult<HashMap<String, usize>> {
    let codes: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT code_controle FROM controle_acceptation WHERE date_levee IS NULL",
    )
    .fetch_all(db)
    .await?;
    let mut sortie = HashMap::new();
    for code in codes {
        let mut lignes = lignes_du_controle(db, Some(etats), &code).await?.unwrap_or_default();
        let n = annoter(db, user, &code, &mut lignes).await?;
        sortie.insert(code, n);
    }
    Ok(sortie)
}

/// Le corps d'un acquittement.
#[derive(Debug, Deserialize)]
pub struct Acquittement {
    pub empreinte: String,
    pub motif: String,
}

/// `POST /api/controles/{code}/acquittements` — ACQUITTER UNE ANOMALIE. Droit
/// VALIDER des controles ; jamais un BLOQUANT ; l'anomalie doit exister telle
/// que l'ecran l'a lue (meme empreinte) ; un motif est exige.
pub async fn acquitter(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
    Json(a): Json<Acquittement>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::COCKPIT, Action::Valider).await?;
    let code = code_valide(&code)?.to_uppercase();
    let motif = a.motif.trim();
    if motif.chars().count() < 3 {
        return Err(AppError::Invalide("Le motif de l'acquittement est obligatoire.".into()));
    }
    let criticite: Option<String> = match CONTROLES_MOTEUR.iter().find(|(c, _, _)| c.eq_ignore_ascii_case(&code)) {
        Some((_, _, crit)) => Some((*crit).to_string()),
        None => sqlx::query_scalar("SELECT criticite FROM v_controles WHERE code = $1")
            .bind(&code)
            .fetch_optional(&state.db)
            .await?,
    };
    let criticite = criticite.ok_or_else(|| AppError::Introuvable(format!("controle {code}")))?;
    if criticite == "BLOQUANT" {
        return Err(AppError::RegleMetier(format!(
            "ACQUIT-BLOQUANT : {code} est un controle BLOQUANT : une incoherence qui ne devrait pas exister \
             ne s'acquitte pas, sa cause se cherche."
        )));
    }
    let lignes = lignes_du_controle(&state.db, None, &code)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("controle {code}")))?;
    let mut ligne = lignes
        .into_iter()
        .find(|l| l.get(EMPREINTE).and_then(Value::as_str) == Some(a.empreinte.trim()))
        .ok_or_else(|| {
            AppError::RegleMetier(
                "ACQUIT-ABSENTE : cette anomalie n'existe plus, ou elle a change depuis sa lecture : \
                 relancez le controle."
                    .into(),
            )
        })?;
    if let Some(o) = ligne.as_object_mut() {
        o.remove(EMPREINTE);
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let deja: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM controle_acceptation
                         WHERE code_controle = $1 AND empreinte = $2 AND date_levee IS NULL)",
    )
    .bind(&code)
    .bind(a.empreinte.trim())
    .fetch_one(&mut *tx)
    .await?;
    if deja {
        return Err(AppError::RegleMetier("ACQUIT-DEJA : cette anomalie est deja acquittee.".into()));
    }
    let id: String = sqlx::query_scalar(
        "INSERT INTO controle_acceptation (code_controle, criticite, empreinte, anomalie, motif, id_utilisateur)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         RETURNING id_acceptation",
    )
    .bind(&code)
    .bind(&criticite)
    .bind(a.empreinte.trim())
    .bind(ligne.to_string())
    .bind(motif)
    .bind(&user.id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id_acceptation": id, "code": code })))
}

/// `POST /api/acquittements/{id}/lever` — RETIRER UN ACQUITTEMENT : l'anomalie
/// redevient a traiter. Droit VALIDER des controles. L'acquittement reste, leve.
pub async fn lever(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::COCKPIT, Action::Valider).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let n = sqlx::query(
        "UPDATE controle_acceptation
            SET date_levee = now(), motif_levee = 'RETIREE', id_utilisateur_levee = $2
          WHERE id_acceptation = $1 AND date_levee IS NULL",
    )
    .bind(&id)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(AppError::Introuvable(format!("acquittement en cours {id}")));
    }
    tx.commit().await?;
    Ok(Json(json!({ "id_acceptation": id, "leve": true })))
}
