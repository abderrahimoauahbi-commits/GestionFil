//! Validation d'une reception : cascade 3-en-1 atomique (CDC G3).
//!
//! Une reception validee genere OBLIGATOIREMENT et SIMULTANEMENT :
//!   1. un mouvement de stock ENTREE_REC (par magasin destinataire) ;
//!   2. une archive de reception figee ;
//!   3. une ligne d'historique de prix (base du CMUP).
//! Le tout dans une seule transaction : tout ou rien.
//!
//! Trois defauts du trigger J4 du CDC sont corriges ici :
//!
//!   * MULTI-MAGASIN — J4 creait UN mouvement pour toute la reception, avec le
//!     magasin de la premiere ligne (`LIMIT 1` sans `ORDER BY`, donc non
//!     deterministe), alors que le magasin est defini par ligne. Une reception
//!     ventilee sur deux magasins atterrissait entierement dans le premier.
//!     -> un mouvement par magasin destinataire.
//!
//!   * DEVISE — J4 utilisait `prix_kg_reel` a la fois comme montant en MAD
//!     (pour le CMUP) et comme montant en devise etrangere (pour l'historique).
//!     Le CMUP d'un achat en USD ressortait ~9,5 fois trop faible.
//!     -> `prix_kg_devise` et `prix_kg_mad` sont deux grandeurs distinctes,
//!     dont la coherence est contrainte au niveau de la table.
//!
//!   * UNITES — J4 ajoutait des kilogrammes a `ligne_bc.quantite_recue`, dont
//!     l'unite n'etait pas definie. -> tout est en kg (unite canonique R01).

use crate::auth::Utilisateur;
use crate::db::{arrondi_kg, arrondi_mad, maintenant, Db};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use sqlx::FromRow;
use std::collections::{BTreeMap, HashMap};

const EPSILON_KG: f64 = 0.001;

#[derive(Debug, FromRow)]
struct EnteteReception {
    numero_reception: String,
    date_reception: String,
    statut: String,
    id_bc: Option<String>,
    code_fournisseur: String,
    id_utilisateur_reception: String,
}

#[derive(Debug, FromRow)]
struct LigneReception {
    id_ligne_reception: String,
    id_ligne_bc: Option<String>,
    code_reference: String,
    unite_saisie: String,
    facteur_kg: f64,
    quantite_pesee_unite: f64,
    quantite_stock_kg: f64,
    ecart_pct: Option<f64>,
    prix_kg_devise: f64,
    code_devise: String,
    taux_change: f64,
    prix_kg_mad: f64,
    lot_fournisseur: Option<String>,
    date_fabrication: Option<String>,
    date_peremption: Option<String>,
    statut_qualite: String,
    code_magasin_dest: String,
}

#[derive(Debug, Serialize)]
pub struct ResultatReception {
    pub id_reception: String,
    pub numero_reception: String,
    pub mouvements_crees: Vec<String>,
    pub lignes_traitees: usize,
    pub quantite_totale_kg: f64,
    pub montant_total_mad: f64,
    pub statut_bc: Option<String>,
}

/// Valide une reception et declenche la cascade.
///
/// `id_utilisateur_controle` est le controleur qualite : distinct du magasinier
/// qui a pese (CDC B4 regle 2) et distinct du createur du BC.
pub async fn valider(
    db: &Db,
    user: &Utilisateur,
    id_reception: &str,
) -> AppResult<ResultatReception> {
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // ---- 1. Entete ----------------------------------------------------------
    let entete: EnteteReception = sqlx::query_as(
        "SELECT numero_reception, date_reception, statut, id_bc,
                code_fournisseur, id_utilisateur_reception
           FROM reception WHERE id_reception = ?1",
    )
    .bind(id_reception)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("reception {id_reception}")))?;

    if entete.statut != "A_CONTROLER" {
        return Err(AppError::RegleMetier(format!(
            "Seule une reception au statut A_CONTROLER peut etre validee (statut actuel : {}).",
            entete.statut
        )));
    }

    // ---- 2. Segregation des taches (CDC B4 regle 2) -------------------------
    // Les contraintes de table couvrent aussi ces deux cas ; les verifier ici
    // permet de renvoyer un message metier plutot qu'un echec de CHECK.
    if user.id == entete.id_utilisateur_reception {
        return Err(AppError::RegleMetier(
            "B4 regle 2 : le magasinier qui a pese ne peut pas valider sa propre reception.".into(),
        ));
    }
    // Une reception couvre parfois PLUSIEURS bons : un camion arrive avec ce qui
    // etait pret chez le fournisseur, et l'en-tete n'en designe alors aucun. Tout
    // ce qui suit doit donc se lire depuis les LIGNES. Ne regarder que
    // `entete.id_bc` laisserait le createur d'un bon controler sa propre
    // reception des lors qu'elle en couvre deux — la segregation sauterait
    // precisement dans le cas ou elle compte le plus.
    let bons: Vec<BonCouvert> = sqlx::query_as(
        "SELECT DISTINCT bc.id_bc, bc.numero_bc, bc.statut,
                bc.date_livraison_prevue, bc.id_utilisateur_creation
           FROM bon_commande bc
          WHERE bc.id_bc = ?2
             OR bc.id_bc IN (SELECT lb.id_bc
                               FROM ligne_reception lr
                               JOIN ligne_bc lb ON lb.id_ligne_bc = lr.id_ligne_bc
                              WHERE lr.id_reception = ?1)
          ORDER BY bc.numero_bc",
    )
    .bind(id_reception)
    .bind(&entete.id_bc)
    .fetch_all(&mut *tx)
    .await?;

    // Un bon encore en brouillon, en attente ou seulement valide n'a pas ete
    // envoye au fournisseur : rien n'est engage. Valider la reception ferait
    // entrer en stock, et valoriser, une marchandise sans commande derriere —
    // c'est precisement ce que la regularisation doit empecher de noyer.
    if let Some(b) = bons.iter().find(|b| {
        matches!(
            b.statut.as_str(),
            "BROUILLON" | "EN_ATTENTE_VALIDATION" | "VALIDE" | "ANNULE"
        )
    }) {
        return Err(AppError::RegleMetier(format!(
            "Le bon {} est au statut {} : il n'a pas ete envoye au fournisseur. \
             Faites-le valider puis envoyer avant de controler cette reception.",
            b.numero_bc, b.statut
        )));
    }

    if let Some(b) = bons
        .iter()
        .find(|b| b.id_utilisateur_creation.as_deref() == Some(user.id.as_str()))
    {
        return Err(AppError::RegleMetier(format!(
            "B4 regle 2 : vous avez cree le bon {}, vous ne pouvez pas controler la reception qui le solde.",
            b.numero_bc
        )));
    }

    // ---- 3. Lignes ----------------------------------------------------------
    let lignes: Vec<LigneReception> = sqlx::query_as(
        "SELECT id_ligne_reception, id_ligne_bc, code_reference,
                unite_saisie, facteur_kg, quantite_pesee_unite, quantite_stock_kg, ecart_pct,
                prix_kg_devise, code_devise, taux_change, prix_kg_mad,
                lot_fournisseur, date_fabrication, date_peremption,
                statut_qualite, code_magasin_dest
           FROM ligne_reception
          WHERE id_reception = ?1
          ORDER BY ligne_numero",
    )
    .bind(id_reception)
    .fetch_all(&mut *tx)
    .await?;

    if lignes.is_empty() {
        return Err(AppError::RegleMetier(
            "Une reception sans ligne ne peut pas etre validee.".into(),
        ));
    }

    // Ponctualite : chaque ligne se juge contre la promesse de SON bon. Deux
    // bons du meme fournisseur n'ont pas la meme date, et archiver un retard
    // unique pour toutes les lignes inventerait une avance ici, une faute la.
    let promesses: HashMap<String, Option<String>> = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT lb.id_ligne_bc, bc.date_livraison_prevue
           FROM ligne_reception lr
           JOIN ligne_bc lb     ON lb.id_ligne_bc = lr.id_ligne_bc
           JOIN bon_commande bc ON bc.id_bc = lb.id_bc
          WHERE lr.id_reception = ?1",
    )
    .bind(id_reception)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .collect();

    // Repli pour les lignes hors commande d'une reception qui, elle, designe un
    // bon : la promesse de l'en-tete reste la seule reference disponible.
    let date_prevue_entete: Option<String> = entete
        .id_bc
        .as_ref()
        .and_then(|id| bons.iter().find(|b| &b.id_bc == id))
        .and_then(|b| b.date_livraison_prevue.clone());

    let retard_de = |l: &LigneReception| -> Option<i64> {
        let prevue = l
            .id_ligne_bc
            .as_ref()
            .and_then(|id| promesses.get(id))
            .cloned()
            .flatten()
            .or_else(|| date_prevue_entete.clone())?;
        Some(jours_entre(&prevue, &entete.date_reception).max(0))
    };

    let horodatage = maintenant();
    let mut mouvements_crees = Vec::new();
    let mut quantite_totale = 0.0_f64;
    let mut montant_total = 0.0_f64;

    // ---- 4. Un mouvement par magasin destinataire ---------------------------
    let mut par_magasin: BTreeMap<&str, Vec<&LigneReception>> = BTreeMap::new();
    for l in &lignes {
        par_magasin
            .entry(l.code_magasin_dest.as_str())
            .or_default()
            .push(l);
    }

    for (magasin, lignes_magasin) in &par_magasin {
        let id_mouvement = uuid::Uuid::new_v4().to_string();
        let numero_mouvement = format!("MVT-REC-{}-{}", entete.numero_reception, magasin);

        sqlx::query(
            "INSERT INTO mouvement
                 (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt,
                  code_magasin, code_motif, reference_document, id_utilisateur)
             VALUES (?1, ?2, ?3, 'ENTREE_REC', ?4, 'RECEPTION', ?5, ?6)",
        )
        .bind(&id_mouvement)
        .bind(&numero_mouvement)
        .bind(&entete.date_reception)
        .bind(magasin)
        .bind(&entete.numero_reception)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;

        for (i, l) in lignes_magasin.iter().enumerate() {
            // (1/3) Mouvement de stock — declenche l'application du solde et le
            // recalcul du CMUP par le trigger `trg_lmvt_appliquer`.
            sqlx::query(
                "INSERT INTO ligne_mouvement
                     (id_mouvement, ligne_numero, code_reference, quantite_kg, prix_kg_mad,
                      quantite_saisie, unite_saisie, facteur_conversion,
                      lot_fournisseur, date_fabrication, date_peremption, statut_qualite)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            )
            .bind(&id_mouvement)
            .bind((i + 1) as i64)
            .bind(&l.code_reference)
            .bind(arrondi_kg(l.quantite_stock_kg))
            .bind(arrondi_kg(l.prix_kg_mad))
            .bind(l.quantite_pesee_unite)
            .bind(&l.unite_saisie)
            .bind(l.facteur_kg)
            .bind(&l.lot_fournisseur)
            .bind(&l.date_fabrication)
            .bind(&l.date_peremption)
            .bind(&l.statut_qualite)
            .execute(&mut *tx)
            .await?;

            sqlx::query("UPDATE ligne_reception SET id_mouvement_genere = ?1 WHERE id_ligne_reception = ?2")
                .bind(&id_mouvement)
                .bind(&l.id_ligne_reception)
                .execute(&mut *tx)
                .await?;
        }

        mouvements_crees.push(numero_mouvement);
    }

    // ---- 5. Archive + historique de prix, ligne a ligne ---------------------
    for l in &lignes {
        let total_mad = arrondi_mad(l.quantite_stock_kg * l.prix_kg_mad);
        quantite_totale += l.quantite_stock_kg;
        montant_total += total_mad;

        let conforme_quantite = l
            .ecart_pct
            .map(|e| i64::from(e.abs() <= 0.0001 || e.abs() <= 2.0));
        let jours_retard = retard_de(l);
        let conforme_delai = jours_retard.map(|j| i64::from(j == 0));

        // (2/3) Archive figee — volontairement autonome de ligne_reception, qui
        // reste modifiable tant que la reception n'est pas validee.
        sqlx::query(
            "INSERT INTO archive_reception
                 (id_ligne_reception, numero_reception, code_reference, code_fournisseur,
                  date_reception, lot_fournisseur, quantite_pesee_unite, unite_saisie,
                  quantite_stock_kg, prix_kg_devise, code_devise, taux_change, prix_kg_mad,
                  total_mad, code_magasin_dest, statut_qualite, ecart_pct,
                  conformite_specifications, conformite_quantite, conformite_delai,
                  jours_retard, date_archive, id_utilisateur_archive)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)",
        )
        .bind(&l.id_ligne_reception)
        .bind(&entete.numero_reception)
        .bind(&l.code_reference)
        .bind(&entete.code_fournisseur)
        .bind(&entete.date_reception)
        .bind(&l.lot_fournisseur)
        .bind(l.quantite_pesee_unite)
        .bind(&l.unite_saisie)
        .bind(arrondi_kg(l.quantite_stock_kg))
        .bind(l.prix_kg_devise)
        .bind(&l.code_devise)
        .bind(l.taux_change)
        .bind(arrondi_kg(l.prix_kg_mad))
        .bind(total_mad)
        .bind(&l.code_magasin_dest)
        .bind(&l.statut_qualite)
        .bind(l.ecart_pct)
        .bind(i64::from(l.statut_qualite == "CONFORME"))
        .bind(conforme_quantite)
        .bind(conforme_delai)
        .bind(jours_retard)
        .bind(&horodatage)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;

        // (3/3) Historique de prix — seule source du CMUP (RG-08).
        sqlx::query(
            "INSERT INTO historique_prix
                 (id_ligne_reception, code_reference, code_fournisseur, date_achat,
                  prix_kg_devise, code_devise, taux_change, prix_kg_mad,
                  quantite_achetee_kg, total_mad, date_enregistrement)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        )
        .bind(&l.id_ligne_reception)
        .bind(&l.code_reference)
        .bind(&entete.code_fournisseur)
        .bind(&entete.date_reception)
        .bind(l.prix_kg_devise)
        .bind(&l.code_devise)
        .bind(l.taux_change)
        .bind(arrondi_kg(l.prix_kg_mad))
        .bind(arrondi_kg(l.quantite_stock_kg))
        .bind(total_mad)
        .bind(&horodatage)
        .execute(&mut *tx)
        .await?;

        // ---- 6. Soldes du bon de commande, en kg ---------------------------
        if let Some(id_ligne_bc) = &l.id_ligne_bc {
            sqlx::query(
                "UPDATE ligne_bc
                    SET quantite_recue_kg = ROUND(quantite_recue_kg + ?2, 4)
                  WHERE id_ligne_bc = ?1",
            )
            .bind(id_ligne_bc)
            .bind(arrondi_kg(l.quantite_stock_kg))
            .execute(&mut *tx)
            .await?;

            sqlx::query(
                "UPDATE ligne_bc
                    SET statut = CASE WHEN quantite_recue_kg >= quantite_commandee_kg - ?2
                                      THEN 'SOLDE' ELSE 'PARTIEL' END
                  WHERE id_ligne_bc = ?1",
            )
            .bind(id_ligne_bc)
            .bind(EPSILON_KG)
            .execute(&mut *tx)
            .await?;
        }
    }

    // ---- 7. Statut de CHAQUE bon couvert -----------------------------------
    // Chaque bon avance selon ses propres lignes : un camion peut solder l'un et
    // laisser l'autre partiel. Ne traiter que celui de l'en-tete laisserait le
    // second indefiniment ENVOYE alors que ses lignes sont soldees — et il
    // reapparaitrait a chaque nouvelle reception.
    let mut avances: Vec<String> = Vec::new();
    for b in &bons {
        // Seuls ENVOYE et LIVRE_PARTIEL menent a une reception : les autres
        // etats ne sont pas des sources de transition valides (table
        // transition_statut).
        if b.statut != "ENVOYE" && b.statut != "LIVRE_PARTIEL" {
            avances.push(format!("{} : {}", b.numero_bc, b.statut));
            continue;
        }

        let restantes: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM ligne_bc
              WHERE id_bc = ?1 AND statut NOT IN ('SOLDE','ANNULE')",
        )
        .bind(&b.id_bc)
        .fetch_one(&mut *tx)
        .await?;

        let nouveau = if restantes == 0 { "CLOTURE" } else { "LIVRE_PARTIEL" };
        if nouveau != b.statut {
            sqlx::query("UPDATE bon_commande SET statut = ?2 WHERE id_bc = ?1")
                .bind(&b.id_bc)
                .bind(nouveau)
                .execute(&mut *tx)
                .await?;
        }
        avances.push(format!("{} : {nouveau}", b.numero_bc));
    }

    // Un seul bon : on renvoie son statut nu, comme avant. Plusieurs : on les
    // nomme, sinon l'appelant croirait qu'un seul a bouge.
    let statut_bc = match (bons.len(), bons.first()) {
        (0, _) => None,
        (1, Some(b)) => Some(
            avances
                .first()
                .and_then(|s| s.split(" : ").nth(1))
                .unwrap_or(b.statut.as_str())
                .to_string(),
        ),
        _ => Some(avances.join(" · ")),
    };

    // ---- 8. Cloture de la reception ----------------------------------------
    // Le taux de l'entete est celui de la devise du fournisseur a la date de
    // reception (RG-09) ; chaque ligne porte par ailleurs son propre taux.
    let taux_entete: f64 = lignes.first().map(|l| l.taux_change).unwrap_or(1.0);

    sqlx::query(
        "UPDATE reception
            SET statut = 'VALIDE',
                id_utilisateur_controle = ?2,
                date_controle = ?3,
                taux_change_reception = ?4
          WHERE id_reception = ?1",
    )
    .bind(id_reception)
    .bind(&user.id)
    .bind(&horodatage)
    .bind(taux_entete)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(ResultatReception {
        id_reception: id_reception.to_string(),
        numero_reception: entete.numero_reception,
        mouvements_crees,
        lignes_traitees: lignes.len(),
        quantite_totale_kg: arrondi_kg(quantite_totale),
        montant_total_mad: arrondi_mad(montant_total),
        statut_bc,
    })
}

/// Un bon de commande touche par la reception — celui de l'en-tete, ou tous ceux
/// que les lignes couvrent quand un camion en porte plusieurs.
#[derive(Debug, sqlx::FromRow)]
struct BonCouvert {
    id_bc: String,
    numero_bc: String,
    statut: String,
    date_livraison_prevue: Option<String>,
    id_utilisateur_creation: Option<String>,
}

/// Nombre de jours entiers separant deux horodatages ISO-8601.
fn jours_entre(depuis: &str, jusqu_a: &str) -> i64 {
    let parse = |s: &str| -> Option<chrono::NaiveDate> {
        chrono::NaiveDate::parse_from_str(&s[..s.len().min(10)], "%Y-%m-%d").ok()
    };
    match (parse(depuis), parse(jusqu_a)) {
        (Some(a), Some(b)) => (b - a).num_days(),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calcul_du_retard() {
        assert_eq!(
            jours_entre("2026-07-01", "2026-07-15T10:00:00.000Z"),
            14
        );
        // Livraison en avance : valeur negative, ramenee a 0 par l'appelant.
        assert_eq!(jours_entre("2026-07-20", "2026-07-15"), -5);
        assert_eq!(jours_entre("invalide", "2026-07-15"), 0);
    }
}
