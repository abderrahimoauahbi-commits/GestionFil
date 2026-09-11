//! Dossiers d'importation : repartition des frais, entree en stock, cloture.
//!
//! PERIMETRE : MRP, stock, CUMP. Pas de comptabilite, pas de paiement.
//!
//! Trois operations, chacune dans UNE transaction :
//!
//!   * `recalculer_repartition` — les frais inclus dans le cout sont repartis
//!     sur les lignes AU PRORATA DE LA VALEUR, au centime pres ;
//!   * `valider_reception` — une facture, plusieurs ou une partie entrent en
//!     stock A LA VALEUR FACTURE (cout provisoire), par le journal existant ;
//!   * `cloturer` — les frais s'ajoutent au CUMP du stock encore present ;
//!     la part de ce qui est deja sorti est tracee, pas reinjectee.
//!
//! LES MONTANTS SE CALCULENT EN CENTIMES ENTIERS. Un frais de 13 951,00 DH
//! reparti sur deux lignes doit donner deux montants dont la somme fait
//! 13 951,00 — pas 13 950,99. Le flottant ne le garantit pas ; l'entier, si.

use crate::auth::Utilisateur;
use crate::db::{arrondi_kg, maintenant, Db};
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use sqlx::{PgConnection, Row};
use std::collections::BTreeMap;

/// Tolerance de reception, en % du poids facture : une ligne dont le reste est
/// sous ce seuil est consideree comme recue. Meme ordre que la tolerance de
/// pesee (E6) des receptions locales.
pub const TOLERANCE_PCT: f64 = 2.0;

// ============================================================================
// 1. La repartition
// ============================================================================

/// Repartit `montant` (en centimes) au prorata de `bases` (en centimes).
///
/// Methode du plus fort reste : chaque part est tronquee, puis les centimes
/// manquants vont aux lignes dont la partie tronquee etait la plus grande ; a
/// egalite, a la premiere. La somme des parts egale `montant`, exactement, et
/// le resultat ne depend que des entrees.
pub fn repartir_centimes(montant: i64, bases: &[i64]) -> Vec<i64> {
    let total: i128 = bases.iter().map(|&b| b.max(0) as i128).sum();
    if total == 0 || montant <= 0 {
        return vec![0; bases.len()];
    }
    let m = montant as i128;
    let mut parts = Vec::with_capacity(bases.len());
    let mut restes = Vec::with_capacity(bases.len());
    for (i, &b) in bases.iter().enumerate() {
        let produit = m * b.max(0) as i128;
        parts.push((produit / total) as i64);
        restes.push((produit % total, i));
    }
    let manque = montant - parts.iter().sum::<i64>();
    restes.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    for &(_, i) in restes.iter().take(manque.max(0) as usize) {
        parts[i] += 1;
    }
    parts
}

/// Recalcule toute la repartition d'un dossier.
///
/// Appelee apres chaque modification d'une ligne ou d'un frais : la
/// repartition n'est jamais saisie, elle se DEDUIT. La base d'une ligne est sa
/// valeur en dirhams (montant devise x taux de sa facture) : avec une seule
/// devise, les parts sont exactement celles du montant en devise ; avec deux,
/// c'est la seule facon de ne pas poser 1 EUR = 1 USD.
pub async fn recalculer_repartition(tx: &mut PgConnection, id_dossier: &str) -> AppResult<()> {
    let statut: Option<String> =
        sqlx::query_scalar("SELECT statut FROM import_dossiers WHERE id_dossier = $1 FOR UPDATE")
            .bind(id_dossier)
            .fetch_optional(&mut *tx)
            .await?;
    match statut.as_deref() {
        None => return Err(AppError::Introuvable(format!("dossier {id_dossier}"))),
        Some("CLOTURE") => {
            return Err(AppError::RegleMetier(
                "Dossier clôturé : la répartition est figée.".into(),
            ))
        }
        _ => {}
    }

    // Toutes les lignes, ERP comme hors ERP : chacune porte sa part de frais.
    let lignes: Vec<(String, i64)> = sqlx::query_as(
        "SELECT l.id_ligne, (round(l.montant_devise * f.taux_change, 2) * 100)::bigint
           FROM import_facture_lignes l
           JOIN import_factures f ON f.id_facture = l.id_facture
          WHERE f.id_dossier = $1
          ORDER BY f.date_creation, f.id_facture, l.ligne_numero",
    )
    .bind(id_dossier)
    .fetch_all(&mut *tx)
    .await?;

    sqlx::query(
        "DELETE FROM lignes_frais_repartition
          WHERE id_ligne_frais IN (SELECT id_ligne_frais FROM dossier_lignes_frais
                                    WHERE id_dossier = $1)",
    )
    .bind(id_dossier)
    .execute(&mut *tx)
    .await?;

    // Seuls les frais INCLUS dans le cout : la TVA a l'importation n'est
    // jamais repartie, c'est le catalogue qui le dit.
    let frais: Vec<(String, i64)> = sqlx::query_as(
        "SELECT d.id_ligne_frais, (d.montant_dhs * 100)::bigint
           FROM dossier_lignes_frais d
           JOIN parametres_frais p ON p.id_frais = d.id_frais
          WHERE d.id_dossier = $1 AND p.inclus_dans_cout = 1
          ORDER BY d.date_creation, d.id_ligne_frais",
    )
    .bind(id_dossier)
    .fetch_all(&mut *tx)
    .await?;

    for (id_frais, montant) in &frais {
        let cibles: Vec<String> = sqlx::query_scalar(
            "SELECT id_ligne FROM dossier_lignes_frais_cibles WHERE id_ligne_frais = $1",
        )
        .bind(id_frais)
        .fetch_all(&mut *tx)
        .await?;

        // Pas de cible : tout le dossier. Des cibles : elles seules.
        let perimetre: Vec<&(String, i64)> = lignes
            .iter()
            .filter(|(id, _)| cibles.is_empty() || cibles.contains(id))
            .collect();
        let bases: Vec<i64> = perimetre.iter().map(|(_, b)| *b).collect();
        let total: i64 = bases.iter().sum();
        if total <= 0 {
            // Rien pour le porter encore (aucune ligne saisie) : la cloture le
            // verra et refusera, ce n'est pas une erreur de saisie.
            continue;
        }

        let parts = repartir_centimes(*montant, &bases);
        let ids: Vec<String> = perimetre.iter().map(|(id, _)| id.clone()).collect();
        let pcts: Vec<f64> = bases.iter().map(|&b| b as f64 * 100.0 / total as f64).collect();

        sqlx::query(
            "INSERT INTO lignes_frais_repartition
                    (id_ligne_frais, id_article_dossier, pourcentage, montant_alloue_dhs)
             SELECT $1, v.id, round(v.pct::numeric, 10), v.centimes / 100.0
               FROM unnest($2::text[], $3::float8[], $4::bigint[]) AS v(id, pct, centimes)",
        )
        .bind(id_frais)
        .bind(&ids)
        .bind(&pcts)
        .bind(&parts)
        .execute(&mut *tx)
        .await?;
    }

    // La part de chaque ligne dans la valeur du dossier — la colonne « % » du
    // classeur.
    let total: i64 = lignes.iter().map(|(_, b)| b).sum();
    if total > 0 {
        let ids: Vec<String> = lignes.iter().map(|(id, _)| id.clone()).collect();
        let pcts: Vec<f64> = lignes.iter().map(|(_, b)| *b as f64 * 100.0 / total as f64).collect();
        sqlx::query(
            "UPDATE import_facture_lignes l
                SET pct_dossier = round(v.pct::numeric, 10)
               FROM unnest($1::text[], $2::float8[]) AS v(id, pct)
              WHERE l.id_ligne = v.id",
        )
        .bind(&ids)
        .bind(&pcts)
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}

// ============================================================================
// 2. L'entree en stock
// ============================================================================

/// Valide une reception : une facture, plusieurs, ou une partie — d'un ou de
/// plusieurs dossiers.
///
/// Chaque ligne entre en stock A LA VALEUR FACTURE (cout provisoire), par un
/// mouvement ENTREE_REC : c'est le declencheur existant qui met a jour le
/// solde, le lot et le CUMP. Aucun circuit de stock parallele.
pub async fn valider_reception(db: &Db, user: &Utilisateur, id_reception: &str) -> AppResult<Value> {
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let (numero, statut, date_reception): (String, String, String) = sqlx::query_as(
        "SELECT numero, statut, date_reception FROM import_receptions
          WHERE id_reception = $1 FOR UPDATE",
    )
    .bind(id_reception)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("reception {id_reception}")))?;

    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(format!("La réception {numero} est déjà {statut}.")));
    }

    // Les dossiers que la reception touche, verrouilles : une cloture ne doit
    // pas repartir les frais pendant que leur marchandise entre en stock.
    let dossiers: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT d.id_dossier, d.numero, d.statut
           FROM import_dossiers d
          WHERE d.id_dossier IN (SELECT f.id_dossier
                                   FROM import_reception_lignes rl
                                   JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
                                   JOIN import_factures f ON f.id_facture = l.id_facture
                                  WHERE rl.id_reception = $1)
          ORDER BY d.numero
          FOR UPDATE",
    )
    .bind(id_reception)
    .fetch_all(&mut *tx)
    .await?;
    if let Some((_, numero_dossier, _)) = dossiers.iter().find(|(_, _, s)| s == "CLOTURE") {
        return Err(AppError::RegleMetier(format!(
            "Le dossier {numero_dossier} est clôturé : il ne reçoit plus rien."
        )));
    }
    let numeros_dossiers: Vec<&str> = dossiers.iter().map(|(_, n, _)| n.as_str()).collect();

    let lignes = sqlx::query(
        "SELECT rl.id_reception_ligne, rl.id_ligne,
                rl.quantite_recue_kg::float8 AS quantite, rl.nb_bobines, rl.nb_palettes,
                rl.lot_fournisseur, rl.code_couleur, rl.code_magasin,
                l.code_reference, l.reste_kg::float8 AS reste, l.poids_net_kg::float8 AS poids_net,
                l.id_ligne_bc, l.soldee, l.montant_devise::float8 AS montant_devise,
                f.code_devise, f.taux_change::float8 AS taux, f.code_fournisseur, f.numero_facture
           FROM import_reception_lignes rl
           JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
           JOIN import_factures f ON f.id_facture = l.id_facture
          WHERE rl.id_reception = $1
          ORDER BY rl.code_magasin, f.numero_facture, l.ligne_numero",
    )
    .bind(id_reception)
    .fetch_all(&mut *tx)
    .await?;

    if lignes.is_empty() {
        return Err(AppError::RegleMetier("Aucune ligne : rien à faire entrer en stock.".into()));
    }

    // ---- Controles, puis prix provisoire de chaque ligne --------------------
    struct Entree {
        id_reception_ligne: String,
        id_ligne: String,
        code_reference: String,
        quantite: f64,
        nb_bobines: i64,
        nb_palettes: i64,
        lot: Option<String>,
        couleur: Option<String>,
        magasin: String,
        id_ligne_bc: Option<String>,
        prix_kg_devise: f64,
        prix_kg_mad: f64,
        code_devise: String,
        taux: f64,
        code_fournisseur: String,
    }
    let mut entrees = Vec::with_capacity(lignes.len());
    for l in &lignes {
        let quantite: f64 = l.try_get("quantite")?;
        let reste: f64 = l.try_get("reste")?;
        let poids_net: f64 = l.try_get("poids_net")?;
        let code_reference: String = l.try_get("code_reference")?;
        let numero_facture: String = l.try_get("numero_facture")?;
        if l.try_get::<i64, _>("soldee")? == 1 {
            return Err(AppError::RegleMetier(format!(
                "{code_reference} (facture {numero_facture}) est soldée : elle ne se reçoit plus."
            )));
        }
        let plafond = reste * (1.0 + TOLERANCE_PCT / 100.0) + 0.001;
        if quantite > plafond {
            return Err(AppError::RegleMetier(format!(
                "{code_reference} (facture {numero_facture}) : {quantite} kg reçus pour {reste} kg \
                 restant à recevoir — au-delà de la tolérance de {TOLERANCE_PCT} %."
            )));
        }
        let montant_devise: f64 = l.try_get("montant_devise")?;
        let taux: f64 = l.try_get("taux")?;
        // Le cout PROVISOIRE : la valeur facture ramenee au kg. Les frais
        // viendront a la cloture.
        let prix_kg_devise = arrondi_kg(montant_devise / poids_net);
        entrees.push(Entree {
            id_reception_ligne: l.try_get("id_reception_ligne")?,
            id_ligne: l.try_get("id_ligne")?,
            code_reference,
            quantite: arrondi_kg(quantite),
            nb_bobines: l.try_get("nb_bobines")?,
            nb_palettes: l.try_get("nb_palettes")?,
            lot: l.try_get("lot_fournisseur")?,
            couleur: l.try_get("code_couleur")?,
            magasin: l.try_get("code_magasin")?,
            id_ligne_bc: l.try_get("id_ligne_bc")?,
            prix_kg_devise,
            prix_kg_mad: arrondi_kg(prix_kg_devise * taux),
            code_devise: l.try_get("code_devise")?,
            taux,
            code_fournisseur: l.try_get("code_fournisseur")?,
        });
    }

    // ---- Un mouvement par magasin destinataire -------------------------------
    let horodatage = maintenant();
    let mut par_magasin: BTreeMap<&str, Vec<&Entree>> = BTreeMap::new();
    for e in &entrees {
        par_magasin.entry(e.magasin.as_str()).or_default().push(e);
    }
    let mut mouvements = Vec::new();
    for (magasin, groupe) in &par_magasin {
        let id_mouvement = uuid::Uuid::new_v4().to_string();
        let numero_mouvement = format!("MVT-{numero}-{magasin}");
        sqlx::query(
            "INSERT INTO mouvement (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt,
                                    code_magasin, code_motif, reference_document, id_utilisateur)
             VALUES ($1, $2, $3, 'ENTREE_REC', $4, 'RECEPTION', $5, $6)",
        )
        .bind(&id_mouvement)
        .bind(&numero_mouvement)
        .bind(&date_reception)
        .bind(magasin)
        .bind(format!(
            "{numero} / {} {}",
            if numeros_dossiers.len() > 1 { "dossiers" } else { "dossier" },
            numeros_dossiers.join(", ")
        ))
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;

        for (i, e) in groupe.iter().enumerate() {
            // Le declencheur trg_lmvt_appliquer fait le reste : solde, lot
            // (avec la couleur), CUMP du magasin et de la fiche.
            sqlx::query(
                "INSERT INTO ligne_mouvement
                        (id_mouvement, ligne_numero, code_reference, quantite_kg, prix_kg_mad,
                         nb_bobines, nb_palettes, lot_fournisseur, code_couleur, statut_qualite)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'CONFORME')",
            )
            .bind(&id_mouvement)
            .bind((i + 1) as i64)
            .bind(&e.code_reference)
            .bind(e.quantite)
            .bind(e.prix_kg_mad)
            .bind(e.nb_bobines)
            .bind(e.nb_palettes)
            .bind(&e.lot)
            .bind(&e.couleur)
            .execute(&mut *tx)
            .await?;

            sqlx::query("UPDATE import_reception_lignes SET id_mouvement = $1 WHERE id_reception_ligne = $2")
                .bind(&id_mouvement)
                .bind(&e.id_reception_ligne)
                .execute(&mut *tx)
                .await?;
        }
        mouvements.push(numero_mouvement);
    }

    // ---- Suivi : facture, historique de prix, bon de commande ---------------
    let mut bons: Vec<String> = Vec::new();
    for e in &entrees {
        sqlx::query(
            "UPDATE import_facture_lignes
                SET quantite_recue_kg = round(quantite_recue_kg + $2::numeric, 4)
              WHERE id_ligne = $1",
        )
        .bind(&e.id_ligne)
        .bind(e.quantite)
        .execute(&mut *tx)
        .await?;

        // Le prix FOURNISSEUR, pour l'historique des achats — comme une
        // reception locale. Les frais n'y entrent pas : ils brouilleraient la
        // comparaison des fournisseurs.
        sqlx::query(
            "INSERT INTO historique_prix
                    (id_ligne_reception, code_reference, code_fournisseur, date_achat,
                     prix_kg_devise, code_devise, taux_change, prix_kg_mad,
                     quantite_achetee_kg, total_mad)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        )
        .bind(&e.id_reception_ligne)
        .bind(&e.code_reference)
        .bind(&e.code_fournisseur)
        .bind(&date_reception)
        .bind(e.prix_kg_devise)
        .bind(&e.code_devise)
        .bind(e.taux)
        .bind(e.prix_kg_mad)
        .bind(e.quantite)
        .bind(crate::db::arrondi_mad(e.prix_kg_mad * e.quantite))
        .execute(&mut *tx)
        .await?;

        if let Some(id_ligne_bc) = &e.id_ligne_bc {
            // Plafonne a la quantite commandee : la contrainte du bon interdit
            // de recevoir plus sans avenant, et la tolerance d'import ne doit
            // pas la faire sauter.
            let id_bc: String = sqlx::query_scalar(
                "UPDATE ligne_bc
                    SET quantite_recue_kg = LEAST(quantite_commandee_kg, round(quantite_recue_kg + $2::numeric, 4))
                  WHERE id_ligne_bc = $1
              RETURNING id_bc",
            )
            .bind(id_ligne_bc)
            .bind(e.quantite)
            .fetch_one(&mut *tx)
            .await?;
            sqlx::query(
                "UPDATE ligne_bc
                    SET statut = CASE WHEN quantite_recue_kg >= quantite_commandee_kg - 0.001
                                      THEN 'SOLDE' ELSE 'PARTIEL' END
                  WHERE id_ligne_bc = $1 AND statut <> 'ANNULE'",
            )
            .bind(id_ligne_bc)
            .execute(&mut *tx)
            .await?;
            if !bons.contains(&id_bc) {
                bons.push(id_bc);
            }
        }
    }

    // Chaque bon avance selon ses propres lignes — seuls ENVOYE et
    // LIVRE_PARTIEL menent a une reception (transition_statut).
    for id_bc in &bons {
        sqlx::query(
            "UPDATE bon_commande b
                SET statut = n.nouveau
               FROM (SELECT CASE WHEN EXISTS (SELECT 1 FROM ligne_bc l
                                               WHERE l.id_bc = $1
                                                 AND l.statut NOT IN ('SOLDE','ANNULE'))
                                 THEN 'LIVRE_PARTIEL' ELSE 'CLOTURE' END AS nouveau) n
              WHERE b.id_bc = $1 AND b.statut IN ('ENVOYE','LIVRE_PARTIEL')
                AND b.statut <> n.nouveau",
        )
        .bind(id_bc)
        .execute(&mut *tx)
        .await?;
    }

    for (id_dossier, _, _) in &dossiers {
        statuer_factures(&mut tx, id_dossier).await?;
        sqlx::query("UPDATE import_dossiers SET statut = 'EN_COURS' WHERE id_dossier = $1 AND statut = 'BROUILLON'")
            .bind(id_dossier)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query(
        "UPDATE import_receptions
            SET statut = 'VALIDEE', id_utilisateur_validation = $2, date_validation = $3
          WHERE id_reception = $1",
    )
    .bind(id_reception)
    .bind(&user.id)
    .bind(&horodatage)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let quantite_totale: f64 = entrees.iter().map(|e| e.quantite).sum();
    Ok(json!({
        "id_reception": id_reception,
        "numero": numero,
        "mouvements": mouvements,
        "lignes": entrees.len(),
        "quantite_kg": arrondi_kg(quantite_totale),
    }))
}

/// Le statut de reception de chaque facture du dossier, deduit de ses lignes
/// ERP : une facture qui n'en porte aucune n'a rien a attendre.
pub async fn statuer_factures(tx: &mut PgConnection, id_dossier: &str) -> AppResult<()> {
    sqlx::query(
        "UPDATE import_factures f
            SET statut_reception = s.statut
           FROM (SELECT f2.id_facture,
                        CASE
                          WHEN bool_and(l.type_ligne <> 'ERP' OR l.soldee = 1
                                        OR l.reste_kg <= l.poids_net_kg * $2 / 100.0 + 0.001)
                            THEN 'RECUE'
                          WHEN sum(l.quantite_recue_kg) > 0 THEN 'PARTIELLE'
                          ELSE 'NON_RECUE'
                        END AS statut
                   FROM import_factures f2
                   JOIN import_facture_lignes l ON l.id_facture = f2.id_facture
                  WHERE f2.id_dossier = $1
                  GROUP BY f2.id_facture) s
          WHERE f.id_facture = s.id_facture AND f.statut_reception <> s.statut",
    )
    .bind(id_dossier)
    .bind(TOLERANCE_PCT)
    .execute(&mut *tx)
    .await?;
    Ok(())
}

// ============================================================================
// 3. La cloture : les frais rejoignent le CUMP
// ============================================================================

/// Cloture un dossier : repartition definitive, puis correction du CUMP.
///
/// Le stock est entre a la valeur facture ; il manque donc exactement les
/// frais repartis. Pour chaque reference, ils vont :
///
///   * au STOCK PRESENT, a hauteur de min(stock, recu) / recu — reparti entre
///     les magasins au prorata de ce qu'ils portent, chacun montant du meme
///     montant au kg ;
///   * en CONSOMME pour le reste : la marchandise deja sortie (tissee, chargee
///     sur un metier) n'est plus au stock valorise, on ne la revalorise pas.
///
/// `simuler` fait tout le calcul et annule : c'est l'apercu avant de signer.
pub async fn cloturer(db: &Db, user: &Utilisateur, id_dossier: &str, simuler: bool) -> AppResult<Value> {
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let (numero, statut): (String, String) = sqlx::query_as(
        "SELECT numero, statut FROM import_dossiers WHERE id_dossier = $1 FOR UPDATE",
    )
    .bind(id_dossier)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("dossier {id_dossier}")))?;

    match statut.as_str() {
        "CLOTURE" => return Err(AppError::RegleMetier(format!("Le dossier {numero} est déjà clôturé."))),
        "BROUILLON" => {
            return Err(AppError::RegleMetier(format!(
                "Le dossier {numero} n'a encore rien reçu : il n'y a pas de stock à ajuster."
            )))
        }
        _ => {}
    }

    // ---- 1. Tout est recu, ou solde ---------------------------------------------
    let manquants: Vec<(String, String, f64)> = sqlx::query_as(
        "SELECT f.numero_facture, l.code_reference, l.reste_kg::float8
           FROM import_facture_lignes l
           JOIN import_factures f ON f.id_facture = l.id_facture
          WHERE f.id_dossier = $1 AND l.type_ligne = 'ERP' AND l.soldee = 0
            AND l.reste_kg > l.poids_net_kg * $2 / 100.0 + 0.001
          ORDER BY f.numero_facture, l.ligne_numero",
    )
    .bind(id_dossier)
    .bind(TOLERANCE_PCT)
    .fetch_all(&mut *tx)
    .await?;
    if !manquants.is_empty() {
        let liste: Vec<String> = manquants
            .iter()
            .take(5)
            .map(|(f, r, q)| format!("{r} (facture {f}) : {q} kg"))
            .collect();
        return Err(AppError::RegleMetier(format!(
            "Reste à recevoir — recevez ou soldez d'abord : {}{}",
            liste.join(" ; "),
            if manquants.len() > 5 { " …" } else { "" }
        )));
    }

    // Une reception en brouillon qui porte une ligne du dossier : elle ferait
    // entrer du stock APRES la repartition des frais.
    let brouillons: i64 = sqlx::query_scalar(
        "SELECT count(DISTINCT r.id_reception)
           FROM import_receptions r
           JOIN import_reception_lignes rl ON rl.id_reception = r.id_reception
           JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
           JOIN import_factures f ON f.id_facture = l.id_facture
          WHERE f.id_dossier = $1 AND r.statut = 'BROUILLON'",
    )
    .bind(id_dossier)
    .fetch_one(&mut *tx)
    .await?;
    if brouillons > 0 {
        return Err(AppError::RegleMetier(format!(
            "{brouillons} réception(s) en brouillon : validez-les ou supprimez-les d'abord."
        )));
    }

    // ---- 2. Des frais, entierement repartis -------------------------------------
    let nb_frais: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM dossier_lignes_frais d
           JOIN parametres_frais p ON p.id_frais = d.id_frais
          WHERE d.id_dossier = $1 AND p.inclus_dans_cout = 1",
    )
    .bind(id_dossier)
    .fetch_one(&mut *tx)
    .await?;
    if nb_frais == 0 {
        return Err(AppError::RegleMetier(
            "Aucun frais inclus dans le coût n'est saisi : la clôture n'aurait rien à ajouter.".into(),
        ));
    }

    recalculer_repartition(&mut tx, id_dossier).await?;

    let non_repartis: Vec<(String, f64)> = sqlx::query_as(
        "SELECT p.libelle, d.montant_dhs::float8
           FROM dossier_lignes_frais d
           JOIN parametres_frais p ON p.id_frais = d.id_frais
           LEFT JOIN lignes_frais_repartition r ON r.id_ligne_frais = d.id_ligne_frais
          WHERE d.id_dossier = $1 AND p.inclus_dans_cout = 1
          GROUP BY d.id_ligne_frais, p.libelle, d.montant_dhs
         HAVING abs(d.montant_dhs - COALESCE(sum(r.montant_alloue_dhs), 0)) > 0.001",
    )
    .bind(id_dossier)
    .fetch_all(&mut *tx)
    .await?;
    if !non_repartis.is_empty() {
        let liste: Vec<String> = non_repartis.iter().map(|(l, m)| format!("{l} ({m} DH)")).collect();
        return Err(AppError::RegleMetier(format!(
            "Frais sans ligne pour les porter : {}. Vérifiez leurs lignes ciblées.",
            liste.join(", ")
        )));
    }

    // ---- 3. Par reference : stock present, puis consomme -------------------------
    let references: Vec<(String, i64, f64)> = sqlx::query_as(
        "SELECT l.code_reference,
                (COALESCE(sum(fr.frais), 0) * 100)::bigint,
                sum(l.quantite_recue_kg)::float8
           FROM import_facture_lignes l
           JOIN import_factures f ON f.id_facture = l.id_facture
           LEFT JOIN (SELECT id_article_dossier, sum(montant_alloue_dhs) AS frais
                        FROM lignes_frais_repartition GROUP BY id_article_dossier) fr
                  ON fr.id_article_dossier = l.id_ligne
          WHERE f.id_dossier = $1 AND l.type_ligne = 'ERP'
          GROUP BY l.code_reference
          ORDER BY l.code_reference",
    )
    .bind(id_dossier)
    .fetch_all(&mut *tx)
    .await?;

    let horodatage = maintenant();
    let mut detail = Vec::new();
    let mut total_stock_c: i64 = 0;
    let mut total_consomme_c: i64 = 0;

    for (code_reference, frais_c, recu) in &references {
        let stocks: Vec<(String, f64, Option<f64>)> = sqlx::query_as(
            "SELECT code_magasin, quantite_kg::float8, cmup_mad::float8
               FROM stock_magasin
              WHERE code_reference = $1 AND quantite_kg > 0
              ORDER BY code_magasin
                FOR UPDATE",
        )
        .bind(code_reference)
        .fetch_all(&mut *tx)
        .await?;
        let q_stock: f64 = stocks.iter().map(|(_, q, _)| q).sum();

        // La part des frais qui revient au stock present.
        let ecart_stock_c: i64 = if *recu > 0.0 {
            ((*frais_c as f64) * q_stock.min(*recu) / recu).round() as i64
        } else {
            0
        };
        let ecart_consomme_c = frais_c - ecart_stock_c;

        // Entre les magasins, au prorata du stock (en dix-milliemes de kg,
        // pour rester en entiers).
        let poids: Vec<i64> = stocks.iter().map(|(_, q, _)| (q * 10_000.0).round() as i64).collect();
        let parts = repartir_centimes(ecart_stock_c, &poids);

        let mut magasins = Vec::new();
        for ((magasin, q, cump), part_c) in stocks.iter().zip(parts.iter()) {
            let avant = cump.unwrap_or(0.0);
            let apres = arrondi_kg(avant + (*part_c as f64 / 100.0) / q);
            sqlx::query(
                "UPDATE stock_magasin SET cmup_mad = $3, date_maj = $4
                  WHERE code_reference = $1 AND code_magasin = $2",
            )
            .bind(code_reference)
            .bind(magasin)
            .bind(apres)
            .bind(&horodatage)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO import_ajustements_cump
                        (id_dossier, code_reference, nature, code_magasin, quantite_recue_kg,
                         stock_kg, cump_avant, cump_apres, montant_dhs, id_utilisateur)
                 VALUES ($1, $2, 'STOCK', $3, $4, $5, $6, $7, $8 / 100.0, $9)",
            )
            .bind(id_dossier)
            .bind(code_reference)
            .bind(magasin)
            .bind(*recu)
            .bind(*q)
            .bind(*cump)
            .bind(apres)
            .bind(*part_c)
            .bind(&user.id)
            .execute(&mut *tx)
            .await?;
            magasins.push(json!({
                "code_magasin": magasin, "stock_kg": q,
                "cump_avant": cump, "cump_apres": apres,
                "montant_dhs": *part_c as f64 / 100.0,
            }));
        }

        sqlx::query(
            "INSERT INTO import_ajustements_cump
                    (id_dossier, code_reference, nature, code_magasin, quantite_recue_kg,
                     stock_kg, montant_dhs, id_utilisateur)
             VALUES ($1, $2, 'CONSOMME', NULL, $3, $4, $5 / 100.0, $6)",
        )
        .bind(id_dossier)
        .bind(code_reference)
        .bind(*recu)
        .bind(q_stock)
        .bind(ecart_consomme_c)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;

        // Le CUMP consolide de la fiche : la meme formule que l'etape (c) de
        // trg_lmvt_appliquer.
        if q_stock > 0.0 {
            sqlx::query(
                "UPDATE reference
                    SET cmup_mad = (SELECT round(SUM(sm.quantite_kg * sm.cmup_mad) / SUM(sm.quantite_kg), 4)
                                      FROM stock_magasin sm
                                     WHERE sm.code_reference = $1 AND sm.quantite_kg > 0
                                       AND sm.cmup_mad IS NOT NULL),
                        date_dernier_cmup = $2
                  WHERE code_reference = $1",
            )
            .bind(code_reference)
            .bind(&horodatage)
            .execute(&mut *tx)
            .await?;
        }

        total_stock_c += ecart_stock_c;
        total_consomme_c += ecart_consomme_c;
        detail.push(json!({
            "code_reference": code_reference,
            "frais_dhs": *frais_c as f64 / 100.0,
            "recu_kg": recu,
            "stock_kg": arrondi_kg(q_stock),
            "ecart_stock_dhs": ecart_stock_c as f64 / 100.0,
            "ecart_consomme_dhs": ecart_consomme_c as f64 / 100.0,
            "magasins": magasins,
        }));
    }

    // La part des lignes hors ERP : leur cout, et rien d'autre.
    let hors_erp: f64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(r.montant_alloue_dhs), 0)::float8
           FROM lignes_frais_repartition r
           JOIN import_facture_lignes l ON l.id_ligne = r.id_article_dossier
           JOIN import_factures f ON f.id_facture = l.id_facture
          WHERE f.id_dossier = $1 AND l.type_ligne = 'HORS_ERP'",
    )
    .bind(id_dossier)
    .fetch_one(&mut *tx)
    .await?;

    let resultat = json!({
        "id_dossier": id_dossier,
        "numero": numero,
        "simulation": simuler,
        "references": detail,
        "ecart_stock_dhs": total_stock_c as f64 / 100.0,
        "ecart_consomme_dhs": total_consomme_c as f64 / 100.0,
        "frais_hors_erp_dhs": hors_erp,
    });

    if simuler {
        tx.rollback().await?;
        return Ok(resultat);
    }

    sqlx::query(
        "UPDATE import_dossiers
            SET statut = 'CLOTURE', id_utilisateur_cloture = $2, date_cloture = $3
          WHERE id_dossier = $1",
    )
    .bind(id_dossier)
    .bind(&user.id)
    .bind(&horodatage)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(resultat)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::repartir_centimes;

    /// Le dossier 01/26 du classeur IMPORTATION 2026 (LOMAT, 12/2 et 12/4) :
    /// l'ERP doit retrouver les montants du classeur au centime.
    #[test]
    fn dossier_01_26_comme_le_classeur() {
        let bases = [19_691_587, 21_952_714]; // 196 915,87 et 219 527,14 DH
        assert_eq!(repartir_centimes(1_395_100, &bases), [659_676, 735_424]); // D.D.
        assert_eq!(repartir_centimes(408_048, &bases), [192_946, 215_102]); // FRET
        assert_eq!(repartir_centimes(220_000, &bases), [104_027, 115_973]); // TREMSA
        assert_eq!(repartir_centimes(20_000, &bases), [9_457, 10_543]); // TIMBRE
        assert_eq!(repartir_centimes(163_700, &bases), [77_406, 86_294]); // INT/OC
    }

    #[test]
    fn la_somme_tombe_juste() {
        let bases = [1, 1, 1];
        let parts = repartir_centimes(100, &bases);
        assert_eq!(parts.iter().sum::<i64>(), 100);
        assert_eq!(parts, [34, 33, 33]); // a egalite, la premiere ligne
    }

    #[test]
    fn sans_base_rien_n_est_reparti() {
        assert_eq!(repartir_centimes(5_000, &[0, 0]), [0, 0]);
        assert_eq!(repartir_centimes(0, &[10, 20]), [0, 0]);
    }
}
