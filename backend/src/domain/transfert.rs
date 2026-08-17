//! Transfert inter-magasins (CDC G5 / R10).
//!
//! Un transfert se valide DEUX FOIS, sur deux sites, et c'est ce qui le rend
//! juste :
//!
//!   1. EXPEDITION, au magasin source — la marchandise sort. Un seul mouvement
//!      est ecrit, la sortie. Le transfert passe en VALIDE, ce qui signifie ici
//!      « parti, pas encore arrive » ;
//!   2. RECEPTION, au magasin destinataire — quelqu'un constate l'arrivee. Le
//!      mouvement d'entree est alors ecrit, et le transfert passe TERMINE.
//!
//! Entre les deux, la marchandise est EN TRANSIT : sortie d'un magasin, pas
//! encore entree dans l'autre. C'est un etat reel, parfois de plusieurs jours,
//! et le confondre avec l'arrivee a une consequence concrete : l'atelier
//! destinataire voit du stock qu'il n'a pas, et lance une production sur une
//! matiere encore dans le camion.
//!
//! La valeur VOYAGE AVEC LA MARCHANDISE. Le CMUP du magasin source est fige sur
//! la ligne au moment du depart, et c'est lui qui valorise l'entree, meme si le
//! CMUP source a change entre-temps — ce qui arrive des qu'une reception
//! fournisseur intervient pendant le trajet. Relire le CMUP a l'arrivee ferait
//! entrer la marchandise a un prix qu'elle n'a jamais eu.
//!
//! Le trigger J3 du CDC inserait les lignes d'entree SANS prix. Comme son unique
//! trigger d'application etait garde par `signe = 1 AND prix > 0`, aucun des
//! deux cotes n'etait applique : un transfert valide ne deplacait rien.

use crate::auth::Utilisateur;
use crate::db::{arrondi_kg, Db};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, FromRow)]
struct EnteteTransfert {
    numero_transfert: String,
    date_transfert: String,
    code_magasin_source: String,
    code_magasin_dest: String,
    statut: String,
    id_utilisateur: String,
}

#[derive(Debug, FromRow)]
struct LigneTransfert {
    ligne_numero: i64,
    code_reference: String,
    quantite_kg: f64,
    quantite_saisie: Option<f64>,
    unite_saisie: Option<String>,
    facteur_conversion: Option<f64>,
    lot_fournisseur: Option<String>,
    /// CMUP du magasin source, fige au depart. Nul tant que rien n'est parti.
    prix_kg_mad: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct ResultatTransfert {
    pub numero_transfert: String,
    pub mouvement: String,
    pub etape: &'static str,
    pub lignes_traitees: usize,
    pub quantite_totale_kg: f64,
    pub valeur_totale_mad: f64,
    /// Renseigne a l'expedition : ce qui reste a constater a destination.
    pub magasin_destinataire: Option<String>,
}

/// Lit l'entete et les lignes, en verifiant le statut attendu.
async fn dossier(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id_transfert: &str,
    statut_attendu: &str,
    action: &str,
) -> AppResult<(EnteteTransfert, Vec<LigneTransfert>)> {
    let entete: EnteteTransfert = sqlx::query_as(
        "SELECT numero_transfert, date_transfert, code_magasin_source,
                code_magasin_dest, statut, id_utilisateur
           FROM transfert WHERE id_transfert = ?1",
    )
    .bind(id_transfert)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("transfert {id_transfert}")))?;

    if entete.statut != statut_attendu {
        return Err(AppError::RegleMetier(format!(
            "Seul un transfert au statut {statut_attendu} peut etre {action} \
             (statut actuel : {}).",
            entete.statut
        )));
    }

    let lignes: Vec<LigneTransfert> = sqlx::query_as(
        "SELECT ligne_numero, code_reference, quantite_kg, quantite_saisie,
                unite_saisie, facteur_conversion, lot_fournisseur, prix_kg_mad
           FROM ligne_transfert WHERE id_transfert = ?1 ORDER BY ligne_numero",
    )
    .bind(id_transfert)
    .fetch_all(&mut **tx)
    .await?;

    if lignes.is_empty() {
        return Err(AppError::RegleMetier(format!(
            "Un transfert sans ligne ne peut pas etre {action}."
        )));
    }

    Ok((entete, lignes))
}

/// Cree l'en-tete d'un mouvement de transfert et renvoie son identifiant.
/// `date = None` laisse la BASE horodater le mouvement.
///
/// C'est necessaire, pas cosmetique : le controle C06 refuse un mouvement date
/// dans le futur, et une date calculee cote Rust devance celle de SQLite de
/// quelques millisecondes. Le mouvement de reception etait rejete pour un ecart
/// d'horloge invisible a l'oeil nu.
async fn ouvrir_mouvement(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    numero: &str,
    date: Option<&str>,
    type_mvt: &str,
    magasin: &str,
    reference_document: &str,
    id_utilisateur: &str,
) -> AppResult<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let sql = if date.is_some() {
        "INSERT INTO mouvement
             (id_mouvement, numero_mouvement, code_type_mvt, code_magasin,
              code_motif, reference_document, id_utilisateur, date_mouvement)
         VALUES (?1, ?2, ?3, ?4, 'TRANSFERT', ?5, ?6, ?7)"
    } else {
        "INSERT INTO mouvement
             (id_mouvement, numero_mouvement, code_type_mvt, code_magasin,
              code_motif, reference_document, id_utilisateur)
         VALUES (?1, ?2, ?3, ?4, 'TRANSFERT', ?5, ?6)"
    };
    let mut q = sqlx::query(sql)
        .bind(&id)
        .bind(numero)
        .bind(type_mvt)
        .bind(magasin)
        .bind(reference_document)
        .bind(id_utilisateur);
    if let Some(d) = date {
        q = q.bind(d);
    }
    q.execute(&mut **tx).await?;
    Ok(id)
}

/// ETAPE 1 — expedition depuis le magasin source.
///
/// Seule la SORTIE est ecrite. La marchandise quitte le magasin source et n'est
/// nulle part ailleurs : elle est en transit, et le restera jusqu'a ce que
/// quelqu'un constate son arrivee.
pub async fn expedier(
    db: &Db,
    user: &Utilisateur,
    id_transfert: &str,
) -> AppResult<ResultatTransfert> {
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let (entete, lignes) = dossier(&mut tx, id_transfert, "BROUILLON", "expedie").await?;

    let numero = format!("MVT-TRF-{}-S", entete.numero_transfert);
    let id_sortie = ouvrir_mouvement(
        &mut tx,
        &numero,
        Some(entete.date_transfert.as_str()),
        "TRANSFERT_SORTIE",
        &entete.code_magasin_source,
        &entete.numero_transfert,
        &user.id,
    )
    .await?;

    let mut total = 0.0_f64;
    let mut valeur = 0.0_f64;
    for l in &lignes {
        // Le CMUP du magasin source, LU MAINTENANT et fige sur la ligne : c'est
        // la valeur que la marchandise emporte avec elle.
        let cmup: Option<f64> = sqlx::query_scalar(
            "SELECT cmup_mad FROM stock_magasin
              WHERE code_reference = ?1 AND code_magasin = ?2",
        )
        .bind(&l.code_reference)
        .bind(&entete.code_magasin_source)
        .fetch_optional(&mut *tx)
        .await?
        .flatten();

        let prix = cmup.ok_or_else(|| {
            AppError::RegleMetier(format!(
                "Reference {} non valorisee au magasin {} : transfert impossible sans CMUP.",
                l.code_reference, entete.code_magasin_source
            ))
        })?;

        sqlx::query("UPDATE ligne_transfert SET prix_kg_mad = ?2 WHERE id_transfert = ?1 AND ligne_numero = ?3")
            .bind(id_transfert)
            .bind(prix)
            .bind(l.ligne_numero)
            .execute(&mut *tx)
            .await?;

        // Sortie sans prix : une sortie ne touche jamais au CMUP (R04).
        sqlx::query(
            "INSERT INTO ligne_mouvement
                 (id_mouvement, ligne_numero, code_reference, quantite_kg,
                  quantite_saisie, unite_saisie, facteur_conversion, lot_fournisseur)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(&id_sortie)
        .bind(l.ligne_numero)
        .bind(&l.code_reference)
        .bind(arrondi_kg(l.quantite_kg))
        .bind(l.quantite_saisie)
        .bind(&l.unite_saisie)
        .bind(l.facteur_conversion)
        .bind(&l.lot_fournisseur)
        .execute(&mut *tx)
        .await?;

        total += l.quantite_kg;
        valeur += l.quantite_kg * prix;
    }

    // La date de SORTIE est celle du depart reel, distincte de la date du
    // document : un transfert prepare lundi peut ne partir que jeudi, et c'est
    // jeudi qui compte pour mesurer le temps de route.
    sqlx::query(
        "UPDATE transfert
            SET statut = 'VALIDE',
                date_sortie = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id_transfert = ?1",
    )
    .bind(id_transfert)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(ResultatTransfert {
        numero_transfert: entete.numero_transfert,
        mouvement: numero,
        etape: "EXPEDIE",
        lignes_traitees: lignes.len(),
        quantite_totale_kg: arrondi_kg(total),
        valeur_totale_mad: crate::db::arrondi_mad(valeur),
        magasin_destinataire: Some(entete.code_magasin_dest),
    })
}

/// ETAPE 2 — reception au magasin destinataire.
///
/// L'ENTREE est ecrite, valorisee au prix fige au depart. Le transfert est
/// termine, et l'on sait qui a constate l'arrivee et quand — ce que la table
/// prevoyait deja sans que rien ne le renseigne.
pub async fn receptionner(
    db: &Db,
    user: &Utilisateur,
    id_transfert: &str,
) -> AppResult<ResultatTransfert> {
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let (entete, lignes) = dossier(&mut tx, id_transfert, "VALIDE", "receptionne").await?;

    let numero = format!("MVT-TRF-{}-E", entete.numero_transfert);
    let id_entree = ouvrir_mouvement(
        &mut tx,
        &numero,
        // Horodatee par la BASE, et non par le transfert : l'entree en stock a lieu
        // maintenant. La dater du depart ferait apparaitre la marchandise a
        // destination pendant tout le temps ou elle etait en route.
        None,
        "TRANSFERT_ENTREE",
        &entete.code_magasin_dest,
        &entete.numero_transfert,
        &user.id,
    )
    .await?;

    let mut total = 0.0_f64;
    let mut valeur = 0.0_f64;
    for l in &lignes {
        let prix = l.prix_kg_mad.ok_or_else(|| {
            AppError::RegleMetier(format!(
                "Ligne {} sans valeur figee au depart : la reception ne peut pas la valoriser.",
                l.ligne_numero
            ))
        })?;

        sqlx::query(
            "INSERT INTO ligne_mouvement
                 (id_mouvement, ligne_numero, code_reference, quantite_kg, prix_kg_mad,
                  quantite_saisie, unite_saisie, facteur_conversion, lot_fournisseur)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .bind(&id_entree)
        .bind(l.ligne_numero)
        .bind(&l.code_reference)
        .bind(arrondi_kg(l.quantite_kg))
        .bind(prix)
        .bind(l.quantite_saisie)
        .bind(&l.unite_saisie)
        .bind(l.facteur_conversion)
        .bind(&l.lot_fournisseur)
        .execute(&mut *tx)
        .await?;

        total += l.quantite_kg;
        valeur += l.quantite_kg * prix;
    }

    sqlx::query(
        "UPDATE transfert
            SET statut = 'TERMINE',
                id_utilisateur_reception = ?2,
                date_reception_dest = ?3
          WHERE id_transfert = ?1",
    )
    .bind(id_transfert)
    .bind(&user.id)
    .bind(crate::db::maintenant())
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let _ = entete.id_utilisateur;

    Ok(ResultatTransfert {
        numero_transfert: entete.numero_transfert,
        mouvement: numero,
        etape: "RECEPTIONNE",
        lignes_traitees: lignes.len(),
        quantite_totale_kg: arrondi_kg(total),
        valeur_totale_mad: crate::db::arrondi_mad(valeur),
        magasin_destinataire: None,
    })
}
