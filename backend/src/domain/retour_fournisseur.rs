//! Le retour fournisseur, document LIBRE (12/10/2026).
//!
//! Comme l'avoir d'une gestion commerciale : on choisit le fournisseur, puis
//! les references en stock (magasin, lot s'il y en a), la quantite et le prix
//! saisi par les achats — propose au CMUP du magasin. Aucun lien avec une
//! reception : on peut rendre sans savoir d'ou vient la marchandise. Le montant
//! de l'avoir est la somme quantite x prix.
//!
//! BROUILLON, puis VALIDE par un autre compte (la base le garantit). La
//! validation produit le mouvement RETOUR_FOURN existant, un par magasin : le
//! stock et les lots baissent. La sortie se fait AU PRIX DU RETOUR : le
//! mouvement sort au CMUP (comme toute sortie), puis la difference avec le prix
//! du retour est portee au CMUP du stock restant du magasin — jamais sous zero ;
//! ce qu'il ne peut pas porter (tout rendu, ou valeur restante negative) va au
//! journal des ecarts. Le retour ne rouvre pas le reste a livrer du bon.

use crate::auth::Utilisateur;
use crate::db::{arrondi_kg, maintenant};
use crate::error::{AppError, AppResult};
use crate::domain::numerotation::numeroter;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgConnection;
use std::collections::BTreeMap;

/// Les motifs de ligne d'un retour au fournisseur (categorie RETOUR, hors
/// production) : defaut qualite, erreur de reference.
pub const MOTIFS_RETOUR: &[&str] = &["R1", "R2"];

#[derive(Debug, Deserialize)]
pub struct LigneRetourSaisie {
    pub code_reference: String,
    pub code_magasin: String,
    pub lot_fournisseur: Option<String>,
    pub quantite_kg: f64,
    /// Absent (champ masque a qui saisit) : le CMUP du magasin.
    pub prix_kg_mad: Option<f64>,
    pub nb_bobines: Option<i64>,
    pub code_motif_ligne: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RetourSaisie {
    /// L'IDENTIFIANT TIRE PAR L'ECRAN a l'ouverture du formulaire (audit P3,
    /// 19/10/2026) : le meme envoi rejoue rend le meme document, pas un second.
    /// Absent : le serveur en tire un.
    #[serde(default)]
    pub id_document: Option<String>,
    pub code_fournisseur: String,
    pub date_retour: Option<String>,
    pub motif: Option<String>,
    pub observations: Option<String>,
    pub lignes: Vec<LigneRetourSaisie>,
}

fn lot_de(l: &LigneRetourSaisie) -> Option<String> {
    l.lot_fournisseur.as_deref().map(str::trim).filter(|x| !x.is_empty()).map(str::to_string)
}

/// Le CMUP d'une reference dans un magasin (a defaut, celui de la fiche).
async fn cmup(c: &mut PgConnection, reference: &str, magasin: &str) -> AppResult<f64> {
    let v: Option<f64> = sqlx::query_scalar(
        "SELECT COALESCE(
             (SELECT NULLIF(cmup_mad, 0) FROM stock_magasin WHERE code_reference = $1 AND code_magasin = $2),
             (SELECT NULLIF(cmup_mad, 0) FROM reference WHERE code_reference = $1))::float8",
    )
    .bind(reference)
    .bind(magasin)
    .fetch_one(&mut *c)
    .await?;
    Ok(v.unwrap_or(0.0))
}

/// Ce que le magasin porte de la reference : tout, ou ce lot.
async fn disponible(c: &mut PgConnection, reference: &str, magasin: &str, lot: Option<&str>) -> AppResult<f64> {
    let v: f64 = match lot {
        Some(lot) => sqlx::query_scalar(
            "SELECT COALESCE((SELECT quantite_kg FROM stock_lot
                               WHERE code_reference = $1 AND code_magasin = $2 AND lot_fournisseur = $3), 0)::float8",
        )
        .bind(reference)
        .bind(magasin)
        .bind(lot)
        .fetch_one(&mut *c)
        .await?,
        None => sqlx::query_scalar(
            "SELECT COALESCE((SELECT quantite_kg FROM stock_magasin
                               WHERE code_reference = $1 AND code_magasin = $2), 0)::float8",
        )
        .bind(reference)
        .bind(magasin)
        .fetch_one(&mut *c)
        .await?,
    };
    Ok(v)
}

/// Controle une saisie : le fournisseur, le motif, et des lignes que le stock
/// porte (cumulees par reference, magasin et lot).
async fn controler(c: &mut PgConnection, s: &RetourSaisie) -> AppResult<()> {
    if s.code_fournisseur.trim().is_empty() {
        return Err(AppError::Invalide("Choisissez le fournisseur.".into()));
    }
    let connu: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM fournisseur WHERE code_fournisseur = $1)")
        .bind(s.code_fournisseur.trim())
        .fetch_one(&mut *c)
        .await?;
    if !connu {
        return Err(AppError::Invalide(format!("Fournisseur inconnu : {}.", s.code_fournisseur)));
    }
    if s.motif.as_deref().map(str::trim).unwrap_or("").chars().count() < 3 {
        return Err(AppError::Invalide("Dites pourquoi la marchandise repart (motif).".into()));
    }
    if s.lignes.is_empty() {
        return Err(AppError::Invalide("Un retour porte au moins une ligne.".into()));
    }
    let mut cumul: BTreeMap<(String, String, Option<String>), f64> = BTreeMap::new();
    for l in &s.lignes {
        if !(l.quantite_kg > 0.0) || !l.quantite_kg.is_finite() {
            return Err(AppError::Invalide(format!("{} : la quantité rendue doit être positive.", l.code_reference)));
        }
        if let Some(p) = l.prix_kg_mad {
            if !(p >= 0.0) || !p.is_finite() {
                return Err(AppError::Invalide(format!("{} : le prix du retour ne peut pas être négatif.", l.code_reference)));
            }
        }
        if !MOTIFS_RETOUR.contains(&l.code_motif_ligne.as_deref().unwrap_or("")) {
            return Err(AppError::Invalide(format!(
                "{} : choisissez le motif de la ligne (défaut qualité ou erreur de référence).",
                l.code_reference
            )));
        }
        *cumul.entry((l.code_reference.clone(), l.code_magasin.clone(), lot_de(l))).or_default() += l.quantite_kg;
    }
    for ((reference, magasin, lot), kg) in &cumul {
        let dispo = disponible(c, reference, magasin, lot.as_deref()).await?;
        if *kg > dispo + 0.0005 {
            return Err(AppError::RegleMetier(format!(
                "{reference}{} : {} kg rendus, mais le magasin {magasin} n'en porte que {} kg.",
                lot.as_ref().map(|l| format!(" (lot {l})")).unwrap_or_default(),
                arrondi_kg(*kg),
                arrondi_kg(dispo)
            )));
        }
    }
    Ok(())
}

async fn poser_lignes(c: &mut PgConnection, id_retour: &str, s: &RetourSaisie) -> AppResult<()> {
    sqlx::query("DELETE FROM ligne_retour_fournisseur WHERE id_retour = $1")
        .bind(id_retour)
        .execute(&mut *c)
        .await?;
    for (i, l) in s.lignes.iter().enumerate() {
        let prix = match l.prix_kg_mad {
            Some(p) => p,
            None => cmup(c, &l.code_reference, &l.code_magasin).await?,
        };
        sqlx::query(
            "INSERT INTO ligne_retour_fournisseur
                    (id_retour, ligne_numero, code_reference, code_magasin, lot_fournisseur,
                     quantite_kg, prix_kg_mad, nb_bobines, code_motif_ligne)
             VALUES ($1, $2, $3, $4, $5, round($6::numeric, 4), round($7::numeric, 4), $8, $9)",
        )
        .bind(id_retour)
        .bind((i + 1) as i32)
        .bind(&l.code_reference)
        .bind(&l.code_magasin)
        .bind(lot_de(l))
        .bind(l.quantite_kg)
        .bind(prix)
        .bind(l.nb_bobines)
        .bind(&l.code_motif_ligne)
        .execute(&mut *c)
        .await?;
    }
    Ok(())
}

/// Cree le brouillon (`id` vide) ou le remplace (en-tete et lignes).
pub async fn enregistrer(c: &mut PgConnection, user: &Utilisateur, id: Option<&str>, s: &RetourSaisie) -> AppResult<Value> {
    controler(c, s).await?;
    let date = s
        .date_retour
        .as_deref()
        .map(str::trim)
        .filter(|d| d.len() >= 10)
        .map(|d| d[..10].to_string())
        .unwrap_or_else(|| maintenant()[..10].to_string());
    let (id, numero) = match id {
        None => {
            let numero = numeroter(c, "retour_fournisseur", "numero", "RFO").await?;
            let id: String = sqlx::query_scalar(
                "INSERT INTO retour_fournisseur
                        (numero, date_retour, code_fournisseur, motif, observations, id_utilisateur_creation,
                         id_retour)
                 VALUES ($1, $2, $3, btrim($4), NULLIF(btrim($5), ''), $6, $7)
                 RETURNING id_retour",
            )
            .bind(&numero)
            .bind(&date)
            .bind(s.code_fournisseur.trim())
            .bind(s.motif.as_deref().unwrap_or(""))
            .bind(&s.observations)
            .bind(&user.id)
            .bind(crate::domain::idempotence::identifiant(s.id_document.as_deref())?)
            .fetch_one(&mut *c)
            .await?;
            (id, numero)
        }
        Some(id) => {
            let numero: String = sqlx::query_scalar(
                "UPDATE retour_fournisseur
                    SET date_retour = $2, code_fournisseur = $3, motif = btrim($4), observations = NULLIF(btrim($5), '')
                  WHERE id_retour = $1
              RETURNING numero",
            )
            .bind(id)
            .bind(&date)
            .bind(s.code_fournisseur.trim())
            .bind(s.motif.as_deref().unwrap_or(""))
            .bind(&s.observations)
            .fetch_optional(&mut *c)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("retour {id}")))?;
            (id.to_string(), numero)
        }
    };
    poser_lignes(c, &id, s).await?;
    Ok(json!({ "id_retour": id, "numero": numero, "statut_retour": "BROUILLON" }))
}

/// La sortie au prix du retour, en centimes : ce que le stock restant porte
/// (jamais sous zero) et l'ecart. `delta_c` = q x (CMUP - prix) : positif
/// quand on rend moins cher que le stock ne vaut, le reste du stock porte
/// alors la difference.
pub fn porter_au_stock(delta_c: i64, cmup_avant: f64, reste_kg: f64) -> (i64, i64) {
    if reste_kg <= 1e-9 {
        return (0, delta_c);
    }
    let plancher_c = -((cmup_avant * reste_kg * 100.0).round() as i64);
    let stock_c = delta_c.max(plancher_c);
    (stock_c, delta_c - stock_c)
}

/// VALIDER : par un autre compte que l'auteur (la base le refuse sinon). Le
/// stock se rejuge sous verrou ; un mouvement RETOUR_FOURN par magasin ; puis,
/// ligne par ligne, la difference entre le CMUP et le prix du retour au CMUP
/// du stock restant.
pub async fn valider(c: &mut PgConnection, user: &Utilisateur, id: &str) -> AppResult<Value> {
    let entete: Option<(String, String, String, String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT numero, statut, code_fournisseur, motif, date_retour, observations, id_utilisateur_creation
           FROM retour_fournisseur WHERE id_retour = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *c)
    .await?;
    let (numero, statut, fournisseur, motif, date_retour, observations, createur) =
        entete.ok_or_else(|| AppError::Introuvable(format!("retour {id}")))?;
    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(format!("Le retour {numero} est déjà validé.")));
    }
    if createur == user.id {
        return Err(AppError::RegleMetier(format!(
            "Celui qui a saisi le retour {numero} ne peut pas le valider : un autre compte le contrôle."
        )));
    }
    type Ligne = (String, String, String, Option<String>, f64, f64, Option<i64>, String);
    let lignes: Vec<Ligne> = sqlx::query_as(
        "SELECT id_ligne_retour, code_reference, code_magasin, lot_fournisseur, quantite_kg::float8,
                prix_kg_mad::float8, nb_bobines, code_motif_ligne
           FROM ligne_retour_fournisseur WHERE id_retour = $1 ORDER BY ligne_numero",
    )
    .bind(id)
    .fetch_all(&mut *c)
    .await?;
    // Le stock, rejuge maintenant : il a pu bouger depuis la saisie.
    let saisie = RetourSaisie {
        id_document: None,
        code_fournisseur: fournisseur,
        date_retour: Some(date_retour.clone()),
        motif: Some(motif.clone()),
        observations,
        lignes: lignes
            .iter()
            .map(|l| LigneRetourSaisie {
                code_reference: l.1.clone(),
                code_magasin: l.2.clone(),
                lot_fournisseur: l.3.clone(),
                quantite_kg: l.4,
                prix_kg_mad: Some(l.5),
                nb_bobines: l.6,
                code_motif_ligne: Some(l.7.clone()),
            })
            .collect(),
    };
    controler(c, &saisie).await?;

    let mut par_magasin: BTreeMap<&str, Vec<&Ligne>> = BTreeMap::new();
    for l in &lignes {
        par_magasin.entry(l.2.as_str()).or_default().push(l);
    }
    let horodatage = maintenant();
    let mut mouvements = Vec::new();
    let mut ecart_total_c: i64 = 0;
    for (magasin, groupe) in par_magasin {
        let id_mvt = uuid::Uuid::new_v4().to_string();
        let numero_mvt = numeroter(c, "mouvement", "numero_mouvement", "MVT").await?;
        sqlx::query(
            "INSERT INTO mouvement
                 (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt, code_magasin,
                  code_motif, reference_document, observations_globales, id_utilisateur)
             VALUES ($1, $2, fn_jour_casablanca($3), 'RETOUR_FOURN', $4, 'RETOUR_FOUR', $5, $6, $7)",
        )
        .bind(&id_mvt)
        .bind(&numero_mvt)
        .bind(&date_retour)
        .bind(magasin)
        .bind(&numero)
        .bind(format!("Retour {numero} — {motif}"))
        .bind(&user.id)
        .execute(&mut *c)
        .await?;
        for (i, l) in groupe.iter().enumerate() {
            let (id_ligne, reference, _, lot, kg, prix, bobines, motif_ligne) = l;
            // L'etat du magasin AVANT la sortie, sous verrou.
            let (stock_avant, cmup_avant): (f64, Option<f64>) = sqlx::query_as(
                "SELECT quantite_kg::float8, cmup_mad::float8 FROM stock_magasin
                  WHERE code_reference = $1 AND code_magasin = $2 FOR UPDATE",
            )
            .bind(reference)
            .bind(magasin)
            .fetch_optional(&mut *c)
            .await?
            .unwrap_or((0.0, None));
            // La sortie : au CMUP, comme toute sortie (le declencheur pose son cout).
            sqlx::query(
                "INSERT INTO ligne_mouvement
                     (id_mouvement, ligne_numero, code_reference, quantite_kg, prix_kg_mad,
                      quantite_saisie, unite_saisie, facteur_conversion, nb_bobines,
                      lot_fournisseur, code_motif_ligne)
                 VALUES ($1, $2, $3, $4, $5, $4, 'kg', 1, $6, $7, $8)",
            )
            .bind(&id_mvt)
            .bind((i + 1) as i64)
            .bind(reference)
            .bind(*kg)
            .bind(cmup_avant)
            .bind(*bobines)
            .bind(lot)
            .bind(motif_ligne)
            .execute(&mut *c)
            .await?;
            // Puis le prix du retour : la difference au stock restant.
            let reste = arrondi_kg(stock_avant - kg);
            let (cmup_apres, stock_c, ecart_c) = match cmup_avant {
                Some(cm) => {
                    let delta_c = (kg * (cm - prix) * 100.0).round() as i64;
                    let (stock_c, ecart_c) = porter_au_stock(delta_c, cm, reste);
                    let apres = if reste > 1e-9 { arrondi_kg((cm + (stock_c as f64 / 100.0) / reste).max(0.0)) } else { cm };
                    (Some(apres), stock_c, ecart_c)
                }
                // Un magasin jamais valorise : rien a corriger.
                None => (None, 0, 0),
            };
            if stock_c != 0 {
                sqlx::query("UPDATE stock_magasin SET cmup_mad = $3, date_maj = $4 WHERE code_reference = $1 AND code_magasin = $2")
                    .bind(reference)
                    .bind(magasin)
                    .bind(cmup_apres)
                    .bind(&horodatage)
                    .execute(&mut *c)
                    .await?;
                sqlx::query(
                    "UPDATE reference
                        SET cmup_mad = (SELECT round(SUM(sm.quantite_kg * sm.cmup_mad) / SUM(sm.quantite_kg), 4)
                                          FROM stock_magasin sm
                                         WHERE sm.code_reference = $1 AND sm.quantite_kg > 0
                                           AND sm.cmup_mad IS NOT NULL),
                            date_dernier_cmup = $2
                      WHERE code_reference = $1",
                )
                .bind(reference)
                .bind(&horodatage)
                .execute(&mut *c)
                .await?;
            }
            sqlx::query(
                "UPDATE ligne_retour_fournisseur
                    SET id_mouvement = $2, cmup_avant = $3, cmup_apres = $4,
                        au_stock_mad = $5 / 100.0, ecart_mad = $6 / 100.0
                  WHERE id_ligne_retour = $1",
            )
            .bind(id_ligne)
            .bind(&id_mvt)
            .bind(cmup_avant)
            .bind(cmup_apres)
            .bind(stock_c)
            .bind(ecart_c)
            .execute(&mut *c)
            .await?;
            ecart_total_c += ecart_c;
        }
        mouvements.push(numero_mvt);
    }
    sqlx::query(
        "UPDATE retour_fournisseur
            SET statut = 'VALIDE', id_utilisateur_validation = $2, date_validation = $3
          WHERE id_retour = $1",
    )
    .bind(id)
    .bind(&user.id)
    .bind(&horodatage)
    .execute(&mut *c)
    .await?;
    let montant: f64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(round(quantite_kg * prix_kg_mad, 2)), 0)::float8
           FROM ligne_retour_fournisseur WHERE id_retour = $1",
    )
    .bind(id)
    .fetch_one(&mut *c)
    .await?;
    Ok(json!({
        "id_retour": id, "numero": numero, "statut_retour": "VALIDE", "mouvements": mouvements,
        "montant_avoir_mad": montant, "ecart_mad": ecart_total_c as f64 / 100.0,
    }))
}

#[cfg(test)]
mod tests {
    use super::porter_au_stock;

    #[test]
    fn rendu_moins_cher_le_stock_restant_porte() {
        // 100 kg a 20, on rend 10 kg a 15 : 50 DH portes par les 90 kg restants.
        assert_eq!(porter_au_stock(5_000, 20.0, 90.0), (5_000, 0));
    }

    #[test]
    fn rendu_plus_cher_jamais_sous_zero() {
        // 100 kg a 20, on rend 90 kg a 50 : -2 700 DH, mais les 10 kg restants ne valent que 200.
        assert_eq!(porter_au_stock(-270_000, 20.0, 10.0), (-20_000, -250_000));
    }

    #[test]
    fn tout_rendu_tout_en_ecart() {
        assert_eq!(porter_au_stock(1_234, 20.0, 0.0), (0, 1_234));
    }
}
