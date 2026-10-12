//! Dossiers d'importation : factures, entree en stock, fiches de frais, cloture.
//!
//! PERIMETRE : MRP, stock, CUMP. Pas de comptabilite, pas de paiement.
//!
//!   * `valider_reception_dans` — une facture, plusieurs ou une partie entrent en
//!     stock A LA VALEUR FACTURE (cout reel : reglee par la banque sur l'engagement
//!     d'importation, au taux de la facture), par le journal existant ; puis les
//!     fiches de frais validees s'appliquent a ces kilos ;
//!   * `valider_fiche` — une fiche de frais (12/10/2026) : l'allocation decidee est
//!     calculee par le serveur, FIGEE, puis appliquee au stock present et au
//!     consomme, a mesure des receptions, sans jamais etre recalculee ;
//!   * `cloturer` — CONTROLE que tout est decide et applique, puis fige le dossier.
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

// La tolerance de reception est celle du fournisseur (fn_tolerance_fournisseur,
// a defaut P_TolerEcartPesee, 2 %) : une ligne dont le reste est sous ce seuil
// est consideree comme recue, et un excedent au-dela demande une derogation.

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

/// Repartit un montant SIGNE (centimes) au prorata de `bases` : une reclôture
/// a la baisse (frais diminues apres devalidation) retire, au meme prorata, ce
/// que la premiere cloture avait ajoute. `repartir_centimes` seul rendait zero
/// pour un montant negatif : la baisse etait ignoree (audit v4).
pub fn repartir_signe(montant: i64, bases: &[i64]) -> Vec<i64> {
    if montant >= 0 {
        repartir_centimes(montant, bases)
    } else {
        repartir_centimes(-montant, bases).into_iter().map(|p| -p).collect()
    }
}

/// La part de chaque ligne dans la valeur du dossier — la colonne « % » du
/// classeur.
///
/// Appelee apres chaque modification d'une facture ou d'une ligne. ELLE NE
/// REPARTIT PLUS AUCUN FRAIS (12/10/2026) : l'allocation d'un frais est une
/// decision, prise et figee a la validation de sa fiche (`valider_fiche`). Le
/// recalcul d'avant effacait et reecrivait toute la repartition du dossier a
/// chaque saisie, avec la cle imposee par le type.
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
                "Dossier clôturé : ses factures sont figées.".into(),
            ))
        }
        _ => {}
    }

    // La base d'une ligne est sa valeur en dirhams (montant devise x taux de sa
    // facture), en centimes : avec deux devises, c'est la seule facon de ne pas
    // poser 1 EUR = 1 USD.
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
    let total: i64 = lignes.iter().map(|(_, valeur)| valeur).sum();
    if total > 0 {
        let ids: Vec<String> = lignes.iter().map(|(id, _)| id.clone()).collect();
        let pcts: Vec<f64> = lignes.iter().map(|(_, valeur)| *valeur as f64 * 100.0 / total as f64).collect();
        sqlx::query(
            "UPDATE import_facture_lignes l
                SET pct_dossier = round(v.pct::numeric, 10)
               FROM unnest($1::text[], $2::float8[]) AS v(id, pct)
              WHERE l.id_ligne = v.id AND l.pct_dossier IS DISTINCT FROM round(v.pct::numeric, 10)",
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
/// Chaque ligne entre en stock A LA VALEUR FACTURE — un cout REEL, pas une estimation : la facture est reglee par la banque sur l'engagement d'importation, au taux qu'elle porte. Elle entre par un
/// mouvement ENTREE_REC : c'est le declencheur existant qui met a jour le
/// solde, le lot et le CUMP. Aucun circuit de stock parallele.
///
/// DANS LA TRANSACTION DE L'APPELANT, qui pose le contexte : la route y ecrit
/// d'abord le verdict du controleur, d'un bloc (audit v5, U4).
pub async fn valider_reception_dans(
    tx: &mut sqlx::PgConnection,
    user: &Utilisateur,
    id_reception: &str,
) -> AppResult<Value> {
    let (numero, statut, date_reception, createur): (String, String, String, String) = sqlx::query_as(
        "SELECT numero, statut, date_reception, id_utilisateur_creation FROM import_receptions
          WHERE id_reception = $1 FOR UPDATE",
    )
    .bind(id_reception)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("reception {id_reception}")))?;

    // LE CONTROLE AVANT LE STOCK (08/10/2026). La reception d'import passait du
    // brouillon au stock d'un clic, sans controle qualite ni second regard :
    // le magasinier la soumet, un autre compte la controle et la valide.
    match statut.as_str() {
        "A_CONTROLER" => {}
        "BROUILLON" => {
            return Err(AppError::RegleMetier(format!(
                "La réception {numero} est en brouillon : soumettez-la d'abord au contrôle."
            )))
        }
        _ => return Err(AppError::RegleMetier(format!("La réception {numero} est déjà {statut}."))),
    }
    if createur == user.id {
        return Err(AppError::RegleMetier(
            "B4 règle 2 : celui qui a saisi la réception ne peut pas la valider.".into(),
        ));
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

    // LE LOT INTERNE, quand le fournisseur n'en a pas mis : le lot de la ligne
    // de facture s'il y en a un, sinon FOURNISSEUR-JJMMAA-NN (cahier « Gestion
    // des lots ») — le fournisseur de SA facture, la date de la reception, et
    // un rang qui continue la numerotation de ce fournisseur ce jour-la. Deux
    // livraisons ne se rangent jamais sous un meme lot. Un lot saisi n'est
    // jamais touche — sauf pour un article de type GENERIQUE, que l'ERP numerote
    // toujours ; un article de type OBLIGATOIRE refuse une ligne sans numero.
    let manquants: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT l.code_reference
           FROM import_reception_lignes rl
           JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
           JOIN reference r ON r.code_reference = l.code_reference
          WHERE rl.id_reception = $1 AND r.suivi_lot = 1 AND r.type_lot = 'OBLIGATOIRE'
            AND COALESCE(btrim(rl.lot_fournisseur), '') = ''
            AND COALESCE(btrim(l.lot_fournisseur), '') = ''
          ORDER BY 1",
    )
    .bind(id_reception)
    .fetch_all(&mut *tx)
    .await?;
    if !manquants.is_empty() {
        return Err(AppError::RegleMetier(format!(
            "Lot obligatoire : le numero de lot du fournisseur manque pour {}. \
             Saisissez-le sur la ligne de reception ou sur la facture.",
            manquants.join(", ")
        )));
    }
    let lots_generes: Vec<(String, String)> = sqlx::query_as(
        "WITH base AS (
             SELECT rl.id_reception_ligne, l.lot_fournisseur AS lot_facture, f.code_fournisseur, r.type_lot,
                    upper(regexp_replace(split_part(btrim(fo.nom), ' ', 1), '[^A-Za-z0-9]', '', 'g'))
                    || '-' || to_char(substr(ir.date_reception, 1, 10)::date, 'DDMMYY') AS p,
                    f.numero_facture, l.ligne_numero
               FROM import_reception_lignes rl
               JOIN import_receptions ir ON ir.id_reception = rl.id_reception
               JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
               JOIN import_factures f ON f.id_facture = l.id_facture
               JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
               JOIN reference r ON r.code_reference = l.code_reference AND r.suivi_lot = 1
              WHERE rl.id_reception = $1
                AND (r.type_lot = 'GENERIQUE' OR COALESCE(btrim(rl.lot_fournisseur), '') = '')
         ), rangs AS (
             SELECT b.*, row_number() OVER (PARTITION BY b.p ORDER BY b.numero_facture, b.ligne_numero) AS rang,
                    (SELECT count(*) FROM lot WHERE lot.lot_fournisseur LIKE b.p || '-%') AS deja
               FROM base b
         )
         UPDATE import_reception_lignes rl
            SET lot_fournisseur = CASE WHEN g.type_lot = 'GENERIQUE'
                                       THEN g.p || '-' || lpad((g.deja + g.rang)::text, 2, '0')
                                       ELSE COALESCE(NULLIF(btrim(g.lot_facture), ''),
                                                     g.p || '-' || lpad((g.deja + g.rang)::text, 2, '0')) END
           FROM rangs g
          WHERE rl.id_reception_ligne = g.id_reception_ligne
      RETURNING rl.lot_fournisseur, g.code_fournisseur",
    )
    .bind(id_reception)
    .fetch_all(&mut *tx)
    .await?;

    let lignes = sqlx::query(
        "SELECT rl.id_reception_ligne, rl.id_ligne,
                rl.quantite_recue_kg::float8 AS quantite, rl.nb_bobines, rl.nb_palettes,
                rl.lot_fournisseur, rl.code_couleur, rl.code_magasin, rl.statut_qualite,
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
    verifier_ecarts(&mut *tx, id_reception).await?;

    // ---- Controles, puis prix facture (reel) de chaque ligne --------------------
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
        statut_qualite: String,
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
        let poids_net: f64 = l.try_get("poids_net")?;
        let code_reference: String = l.try_get("code_reference")?;
        let numero_facture: String = l.try_get("numero_facture")?;
        if l.try_get::<i64, _>("soldee")? == 1 {
            return Err(AppError::RegleMetier(format!(
                "{code_reference} (facture {numero_facture}) est soldée : elle ne se reçoit plus."
            )));
        }
        let montant_devise: f64 = l.try_get("montant_devise")?;
        let taux: f64 = l.try_get("taux")?;
        // Le cout FACTURE, reel : la valeur facture ramenee au kg. Les frais
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
            statut_qualite: l.try_get("statut_qualite")?,
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
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
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
            .bind(&e.statut_qualite)
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
            // LE BON DOIT ETRE PARTI (audit v5, U1) : un bon annule, repasse en
            // brouillon ou en attente depuis la facture ne recoit rien.
            let (numero_bc, statut_bc): (String, String) = sqlx::query_as(
                "SELECT b.numero_bc, b.statut FROM ligne_bc lb JOIN bon_commande b ON b.id_bc = lb.id_bc
                  WHERE lb.id_ligne_bc = $1 FOR UPDATE OF b",
            )
            .bind(id_ligne_bc)
            .fetch_one(&mut *tx)
            .await?;
            if !matches!(statut_bc.as_str(), "ENVOYE" | "LIVRE_PARTIEL" | "CLOTURE") {
                return Err(AppError::RegleMetier(format!(
                    "IMPORT-BC : le bon {numero_bc} est {}, plus envoye : la reception ne s'y impute pas. Detachez la ligne de facture du bon, ou renvoyez le bon.",
                    statut_bc.to_lowercase()
                )));
            }
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
                // Un reliquat dans la tolerance du fournisseur solde la ligne (regle 6).
                "UPDATE ligne_bc
                    SET statut = CASE WHEN quantite_recue_kg >= quantite_commandee_kg
                                          * (1 - fn_tolerance_fournisseur(
                                                   (SELECT b.code_fournisseur FROM bon_commande b
                                                     WHERE b.id_bc = ligne_bc.id_bc)) / 100.0) - 0.001
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
               -- Seule la MARCHANDISE decide de la cloture : une ligne de
               -- service ne se receptionne jamais, donc rien ne la soldera.
               FROM (SELECT CASE WHEN EXISTS (SELECT 1 FROM ligne_bc l
                                               WHERE l.id_bc = $1
                                                 AND l.statut NOT IN ('SOLDE','ANNULE')
                                                 AND l.type_ligne = 'MARCHANDISE')
                                 THEN 'LIVRE_PARTIEL' ELSE 'CLOTURE' END AS nouveau) n
              WHERE b.id_bc = $1 AND b.statut IN ('ENVOYE','LIVRE_PARTIEL')
                AND b.statut <> n.nouveau",
        )
        .bind(id_bc)
        .execute(&mut *tx)
        .await?;
    }

    for (id_dossier, _, _) in &dossiers {
        statuer_factures(&mut *tx, id_dossier).await?;
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

    // LA FICHE DU LOT DIT D'OU IL VIENT : le fournisseur de sa facture, et
    // « genere » pour ceux que l'ERP a numerotes.
    let generes: Vec<String> = lots_generes.iter().map(|(l, _)| l.clone()).collect();
    sqlx::query(
        "UPDATE lot lo
            SET code_fournisseur = f.code_fournisseur,
                origine = CASE WHEN lo.lot_fournisseur = ANY($2) AND lo.origine = 'FOURNISSEUR'
                               AND lo.lot_fournisseur IS DISTINCT FROM l.lot_fournisseur
                               THEN 'GENERE' ELSE lo.origine END
           FROM import_reception_lignes rl
           JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
           JOIN import_factures f ON f.id_facture = l.id_facture
          WHERE rl.id_reception = $1
            AND lo.code_reference = l.code_reference AND lo.lot_fournisseur = rl.lot_fournisseur",
    )
    .bind(id_reception)
    .bind(&generes)
    .execute(&mut *tx)
    .await?;

    // LE POIDS D'UNE BOBINE ET LES BOBINES PAR PALETTE SUIVENT LA LIVRAISON :
    // la mesure de cette reception est historisee (avec le prix paye) et la
    // fiche article mise a jour — sauf mesure aberrante, gardee mais ecartee.
    // Apres les mouvements : ils ont deja fige l'ancien poids, contre lequel
    // l'ecart de la livraison se lit.
    sqlx::query("SELECT fn_suivi_conditionnement('IMPORT', $1, $2)")
        .bind(id_reception)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;

    // LES FICHES DE FRAIS VALIDEES s'appliquent aux kilos qui viennent
    // d'entrer, sur leur allocation figee (12/10/2026). Une application que la
    // tracabilite ne permet pas est signalee, elle ne bloque pas la reception.
    let avis_frais = appliquer_reception(&mut *tx, user, id_reception).await?;

    let quantite_totale: f64 = entrees.iter().map(|e| e.quantite).sum();
    Ok(json!({
        "id_reception": id_reception,
        "numero": numero,
        "mouvements": mouvements,
        "lignes": entrees.len(),
        "quantite_kg": arrondi_kg(quantite_totale),
        "avis_frais": avis_frais,
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
                                        OR l.reste_kg <= l.poids_net_kg * fn_tolerance_fournisseur(f2.code_fournisseur) / 100.0 + 0.001)
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
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// L'EXCEDENT D'IMPORT SE JUGE CONTRE LA TOLERANCE DU FOURNISSEUR (audit v4).
///
/// Au-dela du reste de la ligne de facture + la tolerance du fournisseur (a
/// defaut P_TolerEcartPesee, 2 %), l'excedent exige une derogation motivee.
/// Le reste est lu a l'instant : une autre reception validee entre-temps sur
/// la meme ligne compte. Joue a la soumission au controle et a la validation.
pub async fn verifier_ecarts(c: &mut PgConnection, id_reception: &str) -> AppResult<()> {
    let excedents: Vec<(String, String, f64, f64, f64)> = sqlx::query_as(
        "SELECT l.code_reference, f.numero_facture, rl.quantite_recue_kg::float8,
                l.reste_kg::float8, fn_tolerance_fournisseur(f.code_fournisseur)::float8
           FROM import_reception_lignes rl
           JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
           JOIN import_factures f ON f.id_facture = l.id_facture
          WHERE rl.id_reception = $1 AND rl.derogation_ecart = 0
            AND rl.quantite_recue_kg
                > GREATEST(l.reste_kg, 0) * (1 + fn_tolerance_fournisseur(f.code_fournisseur) / 100.0) + 0.001
          ORDER BY f.numero_facture, l.ligne_numero",
    )
    .bind(id_reception)
    .fetch_all(&mut *c)
    .await?;
    if let Some((reference, facture, kg, reste, tol)) = excedents.first() {
        return Err(AppError::RegleMetier(format!(
            "{reference} (facture {facture}) : {kg} kg reçus pour {} kg restant à recevoir — \
             au-delà de la tolérance de {tol} % du fournisseur. Corrigez la pesée, ou cochez \
             « Dérogation » sur la ligne avec son motif.",
            arrondi_kg(reste.max(0.0))
        )));
    }
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
    let resultat = cloturer_dans(&mut tx, user, id_dossier, simuler).await?;
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
    .bind(maintenant())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(resultat)
}

/// LE MOTEUR COMMUN DE L'IMPORT : porte un montant signe par reference (en
/// centimes) a la marchandise du dossier encore en stock — ses lots, la ou ils
/// sont — et la part des kilos deja sortis en « consomme », hors CMUP. Sert la
/// cloture (frais), le frais post-cloture et l'avoir de prix (09/10/2026).
#[allow(clippy::too_many_arguments)]
async fn porter(
    tx: &mut PgConnection,
    user: &Utilisateur,
    id_dossier: &str,
    references: &[(String, i64, f64)],
    origine: &str,
    piece: Option<&str>,
    motif: Option<&str>,
    horodatage: &str,
) -> AppResult<(Vec<Value>, i64, i64)> {
    let horodatage = horodatage.to_string();
    let mut detail = Vec::new();
    let mut total_stock_c: i64 = 0;
    let mut total_consomme_c: i64 = 0;

    for (code_reference, frais_c, recu) in references {
        // LES FRAIS VONT A LA MARCHANDISE DU DOSSIER (audit v4) : ses lots, la
        // ou ils sont ; sans lot, les magasins ou ses receptions sont entrees.
        // Ils allaient a tout le stock de la reference : 5 745 MAD finissaient
        // dans un magasin qui n'avait rien recu du dossier.
        let stocks: Vec<(String, f64, Option<f64>, f64)> = sqlx::query_as(
            "WITH recu AS (
                 SELECT rl.lot_fournisseur, rl.code_magasin, rl.quantite_recue_kg
                   FROM import_reception_lignes rl
                   JOIN import_receptions r ON r.id_reception = rl.id_reception AND r.statut = 'VALIDEE'
                   JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
                   JOIN import_factures f ON f.id_facture = l.id_facture
                  WHERE f.id_dossier = $1 AND l.code_reference = $2
             ), lots AS (
                 SELECT DISTINCT btrim(lot_fournisseur) AS lot FROM recu
                  WHERE COALESCE(btrim(lot_fournisseur), '') <> ''
             ), recu_mag AS (
                 SELECT code_magasin, sum(quantite_recue_kg) AS kg FROM recu GROUP BY code_magasin
             ), par_lot AS (
                 SELECT sl.code_magasin, sum(sl.quantite_kg) AS kg
                   FROM stock_lot sl JOIN lots ON lots.lot = sl.lot_fournisseur
                  WHERE sl.code_reference = $2 AND sl.quantite_kg > 0
                  GROUP BY sl.code_magasin
             )
             SELECT sm.code_magasin, sm.quantite_kg::float8, sm.cmup_mad::float8,
                    LEAST(sm.quantite_kg,
                          CASE WHEN EXISTS (SELECT 1 FROM lots) THEN COALESCE(pl.kg, 0)
                               ELSE COALESCE(rm.kg, 0) END)::float8 AS present
               FROM stock_magasin sm
               LEFT JOIN par_lot pl ON pl.code_magasin = sm.code_magasin
               LEFT JOIN recu_mag rm ON rm.code_magasin = sm.code_magasin
              WHERE sm.code_reference = $2 AND sm.quantite_kg > 0
                AND (pl.kg > 0 OR (NOT EXISTS (SELECT 1 FROM lots) AND rm.kg > 0))
              ORDER BY sm.code_magasin
                FOR UPDATE OF sm",
        )
        .bind(id_dossier)
        .bind(code_reference)
        .fetch_all(&mut *tx)
        .await?;
        let q_stock: f64 = stocks.iter().map(|(_, _, _, p)| p).sum();

        // La part des frais qui revient au stock present.
        let ecart_stock_c: i64 = if *recu > 0.0 {
            ((*frais_c as f64) * q_stock.min(*recu) / recu).round() as i64
        } else {
            0
        };
        let ecart_consomme_c = frais_c - ecart_stock_c;

        // Entre les magasins, au prorata de ce qui y reste du dossier (en
        // dix-milliemes de kg, pour rester en entiers). Signe : une reclôture
        // a la baisse retire.
        let poids: Vec<i64> = stocks.iter().map(|(_, _, _, p)| (p * 10_000.0).round() as i64).collect();
        let parts = repartir_signe(ecart_stock_c, &poids);

        let mut magasins = Vec::new();
        let mut ecart_stock_c = ecart_stock_c;
        let mut ecart_consomme_c = ecart_consomme_c;
        for ((magasin, q, cump, present), part_c) in stocks.iter().zip(parts.iter()) {
            let avant = cump.unwrap_or(0.0);
            // LE CMUP NE PASSE JAMAIS SOUS ZERO (U6) : le reste va en consomme.
            let plancher_c = -((avant * q * 100.0).round() as i64);
            let part_c = &(if *part_c < plancher_c {
                ecart_stock_c -= *part_c - plancher_c;
                ecart_consomme_c += *part_c - plancher_c;
                plancher_c
            } else {
                *part_c
            });
            // Le CUMP est celui du MAGASIN : divise par tout ce qu'il porte.
            let apres = arrondi_kg((avant + (*part_c as f64 / 100.0) / q).max(0.0));
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
                         stock_kg, cump_avant, cump_apres, montant_dhs, id_utilisateur,
                         origine, numero_piece, motif)
                 VALUES ($1, $2, 'STOCK', $3, $4, $5, $6, $7, $8 / 100.0, $9, $10, $11, $12)",
            )
            .bind(id_dossier)
            .bind(code_reference)
            .bind(magasin)
            .bind(*recu)
            .bind(*present)
            .bind(*cump)
            .bind(apres)
            .bind(*part_c)
            .bind(&user.id)
            .bind(origine)
            .bind(piece)
            .bind(motif)
            .execute(&mut *tx)
            .await?;
            magasins.push(json!({
                "code_magasin": magasin, "stock_kg": arrondi_kg(*present),
                "cump_avant": cump, "cump_apres": apres,
                "montant_dhs": *part_c as f64 / 100.0,
            }));
        }

        sqlx::query(
            "INSERT INTO import_ajustements_cump
                    (id_dossier, code_reference, nature, code_magasin, quantite_recue_kg,
                     stock_kg, montant_dhs, id_utilisateur, origine, numero_piece, motif)
             VALUES ($1, $2, 'CONSOMME', NULL, $3, $4, $5 / 100.0, $6, $7, $8, $9)",
        )
        .bind(id_dossier)
        .bind(code_reference)
        .bind(*recu)
        .bind(q_stock)
        .bind(ecart_consomme_c)
        .bind(&user.id)
        .bind(origine)
        .bind(piece)
        .bind(motif)
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

    Ok((detail, total_stock_c, total_consomme_c))
}

/// LA CLOTURE, dans la transaction de l'appelant. ELLE NE CALCULE PLUS RIEN
/// (12/10/2026) : chaque fiche de frais s'est appliquee a sa validation et a
/// chaque reception. La cloture CONTROLE que tout est decide et applique, puis
/// le dossier se fige.
pub async fn cloturer_dans(
    tx: &mut PgConnection,
    _user: &Utilisateur,
    id_dossier: &str,
    simuler: bool,
) -> AppResult<Value> {
    let (numero, statut, moteur): (String, String, String) = sqlx::query_as(
        "SELECT numero, statut, moteur_frais FROM import_dossiers WHERE id_dossier = $1 FOR UPDATE",
    )
    .bind(id_dossier)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("dossier {id_dossier}")))?;

    match statut.as_str() {
        "CLOTURE" => return Err(AppError::RegleMetier(format!("Le dossier {numero} est déjà clôturé."))),
        "BROUILLON" => {
            return Err(AppError::RegleMetier(format!(
                "Le dossier {numero} n'a encore rien reçu : il n'y a rien à clôturer."
            )))
        }
        _ => {}
    }
    if moteur != "FICHES" {
        // Les dossiers de l'ancien moteur ont tous ete clos avant la migration
        // 2026-10-12a : celui-ci ne devrait pas exister.
        return Err(AppError::RegleMetier(format!(
            "Le dossier {numero} relève de l'ancien moteur de frais : il ne se clôture plus par l'ERP."
        )));
    }

    let mut refus: Vec<String> = Vec::new();

    // ---- 1. Tout est recu, ou solde -------------------------------------------
    let manquants: Vec<(String, String, f64)> = sqlx::query_as(
        "SELECT f.numero_facture, l.code_reference, l.reste_kg::float8
           FROM import_facture_lignes l
           JOIN import_factures f ON f.id_facture = l.id_facture
          WHERE f.id_dossier = $1 AND l.type_ligne = 'ERP' AND l.soldee = 0
            AND l.reste_kg > l.poids_net_kg * fn_tolerance_fournisseur(f.code_fournisseur) / 100.0 + 0.001
          ORDER BY f.numero_facture, l.ligne_numero",
    )
    .bind(id_dossier)
    .fetch_all(&mut *tx)
    .await?;
    if !manquants.is_empty() {
        let liste: Vec<String> = manquants.iter().take(5)
            .map(|(f, r, q)| format!("{r} (facture {f}) : {q} kg")).collect();
        refus.push(format!(
            "Reste à recevoir — recevez ou soldez d'abord : {}{}",
            liste.join(" ; "),
            if manquants.len() > 5 { " …" } else { "" }
        ));
    }

    // Une reception en brouillon ferait entrer du stock apres la cloture.
    let brouillons: i64 = sqlx::query_scalar(
        "SELECT count(DISTINCT r.id_reception)
           FROM import_receptions r
           JOIN import_reception_lignes rl ON rl.id_reception = r.id_reception
           JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
           JOIN import_factures f ON f.id_facture = l.id_facture
          WHERE f.id_dossier = $1 AND r.statut IN ('BROUILLON','A_CONTROLER')",
    )
    .bind(id_dossier)
    .fetch_one(&mut *tx)
    .await?;
    if brouillons > 0 {
        refus.push(format!("{brouillons} réception(s) en brouillon : validez-les ou supprimez-les d'abord."));
    }

    // ---- 2. Les fiches : decidees, et appliquees -----------------------------
    let fiches: Vec<(String, String, String, Option<i16>, i64, i64)> = sqlx::query_as(
        "SELECT x.id_ligne_frais, p.libelle, x.statut, x.capitalisable,
                COALESCE((SELECT round(sum(a.montant_alloue_dhs) * 100)
                            FROM v_frais_allocation_en_vigueur a
                            JOIN import_facture_lignes l ON l.id_ligne = a.id_article_dossier AND l.type_ligne = 'ERP'
                           WHERE a.id_ligne_frais = x.id_ligne_frais), 0)::bigint,
                COALESCE((SELECT round(sum(j.montant_dhs) * 100) FROM import_ajustements_cump j
                           WHERE j.id_ligne_frais = x.id_ligne_frais), 0)::bigint
           FROM dossier_lignes_frais x
           JOIN parametres_frais p ON p.id_frais = x.id_frais
          WHERE x.id_dossier = $1
          ORDER BY p.ordre, x.date_creation",
    )
    .bind(id_dossier)
    .fetch_all(&mut *tx)
    .await?;

    let en_brouillon: Vec<&str> = fiches.iter().filter(|f| f.2 == "BROUILLON").map(|f| f.1.as_str()).collect();
    if !en_brouillon.is_empty() {
        refus.push(format!("Fiche(s) de frais en brouillon : {} — validez-les ou supprimez-les.", en_brouillon.join(", ")));
    }
    let restes: Vec<String> = fiches
        .iter()
        .filter(|f| f.2 != "BROUILLON" && f.3 == Some(1) && f.4 != f.5)
        .map(|f| format!("{} : {:.2} MAD à appliquer", f.1, (f.4 - f.5) as f64 / 100.0))
        .collect();
    if !restes.is_empty() {
        refus.push(format!(
            "Fiche(s) pas entièrement appliquée(s) — {}. Une ligne soldée demande une décision sur son reste ; \
             une application bloquée (traçabilité) doit être résolue.",
            restes.join(" ; ")
        ));
    }
    let capitalisees = fiches.iter().filter(|f| f.2 != "BROUILLON" && f.3 == Some(1)).count();
    if capitalisees == 0 {
        refus.push("Aucune fiche de frais capitalisable validée : la clôture n'aurait rien à figer.".into());
    }

    let applique_c: i64 = fiches.iter().map(|f| f.5).sum();
    let resultat = json!({
        "id_dossier": id_dossier,
        "numero": numero,
        "simulation": simuler,
        "fiches": fiches.len(),
        "frais_appliques_dhs": applique_c as f64 / 100.0,
        "refus": refus,
    });
    if !refus.is_empty() && !simuler {
        return Err(AppError::RegleMetier(format!("Clôture impossible : {}", refus.join(" — "))));
    }
    Ok(resultat)
}

// ============================================================================
// L'avoir d'import (regle 3, 09/10/2026)
// ============================================================================

/// UN AVOIR SUR UN DOSSIER D'IMPORT. Une facture recue est figee ; un avoir de
/// prix du fournisseur (remise, non-conformite gardee) ne s'enregistrait nulle
/// part. AVOIR_PRIX : la valeur baisse, portee a la marchandise du dossier encore
/// en stock, la part sortie en « consomme » — meme moteur que la cloture.
/// AVOIR_RETOUR : rapproche des retours fournisseur rattaches aux receptions du
/// dossier, deja sortis du stock : rien au CMUP, la difference de prix en
/// « consomme ». Montant en MAD, motif, droit VALIDER (la route).
#[allow(clippy::too_many_arguments)]
pub async fn avoir(
    db: &Db,
    user: &Utilisateur,
    id_dossier: &str,
    nature: &str,
    numero_piece: &str,
    montant_mad: f64,
    motif: &str,
    code_reference: Option<&str>,
    simuler: bool,
) -> AppResult<Value> {
    if !matches!(nature, "AVOIR_PRIX" | "AVOIR_RETOUR") {
        return Err(AppError::Invalide(format!("nature inconnue : {nature} (AVOIR_PRIX ou AVOIR_RETOUR)")));
    }
    let numero_piece = numero_piece.trim();
    let motif = motif.trim();
    if numero_piece.is_empty() || motif.chars().count() < 5 || !(montant_mad > 0.0) {
        return Err(AppError::Invalide(
            "Le numero de l'avoir, un motif (5 caracteres au moins) et un montant positif sont obligatoires.".into(),
        ));
    }
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let (numero, statut): (String, String) =
        sqlx::query_as("SELECT numero, statut FROM import_dossiers WHERE id_dossier = $1 FOR UPDATE")
            .bind(id_dossier)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("dossier {id_dossier}")))?;
    if statut == "BROUILLON" {
        return Err(AppError::RegleMetier(format!(
            "Le dossier {numero} n'a rien recu : un avoir corrige une marchandise entree en stock."
        )));
    }
    // La base de repartition : la valeur recue par reference, au cours de la facture.
    let mut refs: Vec<(String, i64, f64)> = sqlx::query_as(
        "SELECT l.code_reference,
                round(sum(l.montant_devise * l.quantite_recue_kg / NULLIF(l.poids_net_kg, 0) * f.taux_change) * 100)::bigint,
                sum(l.quantite_recue_kg)::float8
           FROM import_facture_lignes l JOIN import_factures f ON f.id_facture = l.id_facture
          WHERE f.id_dossier = $1 AND l.type_ligne = 'ERP' AND l.quantite_recue_kg > 0
          GROUP BY l.code_reference ORDER BY l.code_reference",
    )
    .bind(id_dossier)
    .fetch_all(&mut *tx)
    .await?;
    if let Some(cible) = code_reference.map(str::trim).filter(|c| !c.is_empty()) {
        refs.retain(|(r, _, _)| r == cible);
    }
    if refs.is_empty() {
        return Err(AppError::RegleMetier(format!("Le dossier {numero} n'a rien recu de cette reference.")));
    }
    let montant_c = (montant_mad * 100.0).round() as i64;
    let horodatage = maintenant();
    let resultat = if nature == "AVOIR_PRIX" {
        let bases: Vec<i64> = refs.iter().map(|(_, v, _)| (*v).max(1)).collect();
        let parts = repartir_signe(-montant_c, &bases);
        let a_porter: Vec<(String, i64, f64)> =
            refs.iter().zip(parts.iter()).map(|((r, _, q), p)| (r.clone(), *p, *q)).collect();
        let (detail, stock_c, conso_c) =
            porter(&mut tx, user, id_dossier, &a_porter, "AVOIR_PRIX", Some(numero_piece), Some(motif), &horodatage)
                .await?;
        json!({ "references": detail, "ecart_stock_dhs": stock_c as f64 / 100.0,
                "ecart_consomme_dhs": conso_c as f64 / 100.0 })
    } else {
        // Les retours non soldes des receptions du dossier.
        let retours: Vec<(String, String, String, f64)> = sqlx::query_as(
            "SELECT id_mouvement, numero_mouvement, code_reference, kg::float8
               FROM v_retours_import
              WHERE id_dossier = $1 AND NOT solde
              ORDER BY numero_mouvement, code_reference",
        )
        .bind(id_dossier)
        .fetch_all(&mut *tx)
        .await?;
        if retours.is_empty() {
            return Err(AppError::RegleMetier(format!(
                "Le dossier {numero} n'a aucun retour fournisseur non solde : pour une remise ou une \
                 marchandise gardee, c'est un avoir de prix."
            )));
        }
        let mut couvert_c: i64 = 0;
        for (id_mvt, _, reference, kg) in &retours {
            let v = refs
                .iter()
                .find(|(r, _, _)| r == reference)
                .filter(|(_, _, q)| *q > 0.0)
                .map(|(_, v, q)| ((*v as f64) * kg / q).round() as i64)
                .unwrap_or(0);
            couvert_c += v;
            sqlx::query(
                "INSERT INTO import_ajustements_cump
                        (id_dossier, code_reference, nature, code_magasin, quantite_recue_kg, stock_kg,
                         montant_dhs, id_utilisateur, origine, numero_piece, motif, id_mouvement_retour)
                 VALUES ($1, $2, 'RETOUR', NULL, $3, 0, $4 / 100.0, $5, 'AVOIR_RETOUR', $6, $7, $8)",
            )
            .bind(id_dossier)
            .bind(reference)
            .bind(*kg)
            .bind(v)
            .bind(&user.id)
            .bind(numero_piece)
            .bind(motif)
            .bind(id_mvt)
            .execute(&mut *tx)
            .await?;
        }
        let ecart_c = couvert_c - montant_c;
        if ecart_c != 0 {
            sqlx::query(
                "INSERT INTO import_ajustements_cump
                        (id_dossier, code_reference, nature, code_magasin, quantite_recue_kg, stock_kg,
                         montant_dhs, id_utilisateur, origine, numero_piece, motif)
                 VALUES ($1, $2, 'CONSOMME', NULL, 0, 0, $3 / 100.0, $4, 'AVOIR_RETOUR', $5, $6)",
            )
            .bind(id_dossier)
            .bind(&retours[0].2)
            .bind(ecart_c)
            .bind(&user.id)
            .bind(numero_piece)
            .bind(motif)
            .execute(&mut *tx)
            .await?;
        }
        json!({ "valeur_retours_dhs": couvert_c as f64 / 100.0, "ecart_stock_dhs": 0.0,
                "ecart_consomme_dhs": ecart_c as f64 / 100.0,
                "retours": retours.iter().map(|(_, n, r, kg)| json!({"numero_mouvement": n, "code_reference": r, "kg": kg}))
                    .collect::<Vec<_>>() })
    };
    if simuler {
        tx.rollback().await?;
    } else {
        tx.commit().await?;
    }
    let mut r = resultat;
    r["id_dossier"] = json!(id_dossier);
    r["numero"] = json!(numero);
    r["nature"] = json!(nature);
    r["simulation"] = json!(simuler);
    Ok(r)
}

// ============================================================================
// 4. Les fiches de frais (12/10/2026)
// ============================================================================
//
// TROIS NIVEAUX. Le PARAMETRAGE (le type de frais) dit les cles autorisees et
// propose une cle ; il ne decide rien. La DECISION (la fiche) porte la cle
// choisie, son motif si elle s'ecarte de la proposition, les lignes visees et,
// en MANUEL, les montants saisis. Le MOTEUR (ici) calcule l'allocation UNE
// FOIS, a la validation, puis l'APPLIQUE a mesure des receptions, toujours sur
// cette allocation figee — jamais sur une cle ou une base recalculee.
//
// La base garde les invariants (migration 2026-10-12a) : allocation au
// centime, cle autorisee, decision figee, rectificative liee a l'originale,
// application unique par reception, contre-passation inverse exacte.
//
// LA PART STOCK / CONSOMME se lit dans le grand livre, lot par lot : les kilos
// d'une reception encore presents (stock_lot, par magasin) et ceux deja sortis.
// Sans tracabilite certaine — reference sans lot, lot partage avec une autre
// entree, kilos en transit — RIEN n'est suppose : l'application est bloquee,
// la part reste « a appliquer », et la cloture le refuse.

/// Les mouvements qui font ENTRER des kilos dans un lot (les transferts, retours
/// machine et contre-passations n'en creent pas : ils les deplacent ou les
/// annulent).
const ENTREES_D_ORIGINE: [&str; 6] =
    ["ENTREE_REC", "STOCK_INIT", "AJUST_INV_POS", "RETOUR_PRET", "RETOUR_PROD", "FUSION_ENTREE"];

/// Le kilogramme en dix-milliemes, pour compter en entiers.
fn dmg(kg: f64) -> i64 {
    (kg * 10_000.0).round() as i64
}

/// La part d'une allocation acquise pour `recu` sur `facture` (memes unites),
/// au centime le plus proche, la moitie loin de zero. Plafonnee : un excedent
/// recu n'applique jamais plus que l'allocation.
pub fn part_cumulee(alloc_c: i64, recu: i64, facture: i64) -> i64 {
    if facture <= 0 {
        return alloc_c;
    }
    let r = recu.clamp(0, facture) as i128;
    let num = alloc_c as i128 * r;
    let f = facture as i128;
    let mut q = num / f;
    let reste = num % f;
    if 2 * reste.abs() >= f {
        q += num.signum();
    }
    q as i64
}

/// Une allocation : pour chaque base, le pourcentage, le montant theorique
/// exact et l'arrondi au centime (plus fort reste — la somme egale le montant).
pub fn allouer(montant_c: i64, bases: &[i64]) -> Vec<(f64, f64, i64)> {
    let total: i128 = bases.iter().map(|&b| b.max(0) as i128).sum();
    let parts = repartir_signe(montant_c, bases);
    bases
        .iter()
        .zip(parts)
        .map(|(&b, p)| {
            if total == 0 {
                return (0.0, 0.0, p);
            }
            let poids = b.max(0) as f64 / total as f64;
            (poids * 100.0, montant_c as f64 / 100.0 * poids, p)
        })
        .collect()
}

/// Une fiche, relue sous verrou.
struct Fiche {
    id: String,
    id_dossier: String,
    statut_dossier: String,
    id_frais: String,
    libelle_type: String,
    statut: Option<String>,
    cle: Option<String>,
    motif_cle: Option<String>,
    version: i32,
    montant_c: i64,
    inclus: i64,
    cle_proposee: String,
    cles_autorisees: Vec<String>,
}

/// Verrouille le dossier, PUIS la fiche — l'ordre de la reception et de la
/// cloture (reception, dossier, fiche), qui ne s'interbloquent donc pas.
async fn verrouiller_fiche(tx: &mut PgConnection, id: &str) -> AppResult<Fiche> {
    let id_dossier: String = sqlx::query_scalar("SELECT id_dossier FROM dossier_lignes_frais WHERE id_ligne_frais = $1")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("fiche de frais {id}")))?;
    let statut_dossier: String =
        sqlx::query_scalar("SELECT statut FROM import_dossiers WHERE id_dossier = $1 FOR UPDATE")
            .bind(&id_dossier)
            .fetch_one(&mut *tx)
            .await?;
    let r = sqlx::query(
        "SELECT x.id_frais, p.libelle, x.statut, x.cle_repartition, x.motif_cle, x.version,
                (round(x.montant_devise * x.cours_change, 2) * 100)::bigint AS montant_c,
                p.inclus_dans_cout, p.methode_repartition, p.cles_autorisees
           FROM dossier_lignes_frais x
           JOIN parametres_frais p ON p.id_frais = x.id_frais
          WHERE x.id_ligne_frais = $1
            FOR UPDATE OF x",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    Ok(Fiche {
        id: id.to_string(),
        id_dossier,
        statut_dossier,
        id_frais: r.try_get("id_frais")?,
        libelle_type: r.try_get("libelle")?,
        statut: r.try_get("statut")?,
        cle: r.try_get("cle_repartition")?,
        motif_cle: r.try_get("motif_cle")?,
        version: r.try_get("version")?,
        montant_c: r.try_get("montant_c")?,
        inclus: r.try_get("inclus_dans_cout")?,
        cle_proposee: r.try_get("methode_repartition")?,
        cles_autorisees: r.try_get("cles_autorisees")?,
    })
}

/// Une ligne de l'allocation, telle que l'apercu la montre.
struct LigneAlloc {
    id_ligne: String,
    code_reference: Option<String>,
    designation: Option<String>,
    type_ligne: String,
    quantite: f64,
    poids_net_kg: Option<f64>,
    valeur_c: i64,
    base: f64,
    pourcentage: f64,
    theorique: f64,
    montant_c: i64,
}

impl LigneAlloc {
    fn json(&self) -> Value {
        json!({
            "id_ligne": self.id_ligne, "code_reference": self.code_reference,
            "designation": self.designation, "type_ligne": self.type_ligne,
            "quantite": self.quantite, "poids_net_kg": self.poids_net_kg,
            "valeur_dhs": self.valeur_c as f64 / 100.0,
            "base_repartition": self.base, "pourcentage": self.pourcentage,
            "montant_theorique": self.theorique, "montant_alloue_dhs": self.montant_c as f64 / 100.0,
        })
    }
}

/// L'allocation d'une fiche pour la cle donnee, calculee par le serveur.
async fn calculer_allocation(tx: &mut PgConnection, f: &Fiche, cle: &str) -> AppResult<Vec<LigneAlloc>> {
    let lignes: Vec<(String, Option<String>, Option<String>, String, f64, Option<f64>, i64, Option<f64>)> =
        sqlx::query_as(
            "WITH c AS (SELECT id_ligne, montant_saisi FROM dossier_lignes_frais_cibles WHERE id_ligne_frais = $2)
             SELECT l.id_ligne, l.code_reference, COALESCE(r.designation, l.libelle), l.type_ligne,
                    l.quantite::float8, l.poids_net_kg::float8,
                    (round(l.montant_devise * f.taux_change, 2) * 100)::bigint,
                    c.montant_saisi::float8
               FROM import_facture_lignes l
               JOIN import_factures f ON f.id_facture = l.id_facture
               LEFT JOIN reference r ON r.code_reference = l.code_reference
               LEFT JOIN c ON c.id_ligne = l.id_ligne
              WHERE f.id_dossier = $1
                AND (NOT EXISTS (SELECT 1 FROM c) OR c.id_ligne IS NOT NULL)
              ORDER BY f.date_creation, f.id_facture, l.ligne_numero",
        )
        .bind(&f.id_dossier)
        .bind(&f.id)
        .fetch_all(&mut *tx)
        .await?;
    if lignes.is_empty() {
        return Err(AppError::RegleMetier(
            "Aucune ligne de facture à qui répartir ce frais : saisissez les factures du dossier d'abord.".into(),
        ));
    }

    // La base de chaque ligne, en entiers : centimes (valeur, montant saisi)
    // ou dix-milliemes de kilo (poids net). Jamais de poids brut par ligne :
    // aucun document ne le donne.
    let bases: Vec<i64> = match cle {
        "VALEUR" => lignes.iter().map(|l| l.6).collect(),
        "POIDS" => {
            if let Some(l) = lignes.iter().find(|l| l.5.is_none()) {
                return Err(AppError::RegleMetier(format!(
                    "La ligne {} n'a pas de poids net : la clé POIDS ne peut pas la porter. \
                     Choisissez une autre clé, ou visez d'autres lignes.",
                    l.1.clone().or_else(|| l.2.clone()).unwrap_or_default()
                )));
            }
            lignes.iter().map(|l| dmg(l.5.unwrap_or(0.0))).collect()
        }
        "MANUEL" => {
            if let Some(l) = lignes.iter().find(|l| l.7.is_none()) {
                return Err(AppError::RegleMetier(format!(
                    "Clé MANUEL : saisissez le montant de la ligne {}.",
                    l.1.clone().or_else(|| l.2.clone()).unwrap_or_default()
                )));
            }
            let saisis: Vec<i64> = lignes.iter().map(|l| (l.7.unwrap_or(0.0) * 100.0).round() as i64).collect();
            let somme: i64 = saisis.iter().sum();
            if somme != f.montant_c {
                return Err(AppError::RegleMetier(format!(
                    "FRAIS-MANUEL : les montants saisis font {:.2} MAD pour une fiche de {:.2} MAD.",
                    somme as f64 / 100.0,
                    f.montant_c as f64 / 100.0
                )));
            }
            saisis
        }
        autre => return Err(AppError::Invalide(format!("Clé de répartition inconnue : {autre}."))),
    };

    let parts: Vec<(f64, f64, i64)> = if cle == "MANUEL" {
        // MANUEL : l'utilisateur a decide de chaque montant ; on les reprend tels quels.
        let total: i64 = bases.iter().map(|b| b.abs()).sum();
        bases
            .iter()
            .map(|&b| {
                let pct = if total > 0 { b.abs() as f64 * 100.0 / total as f64 } else { 0.0 };
                (pct, b as f64 / 100.0, b)
            })
            .collect()
    } else {
        if bases.iter().map(|&b| b.max(0)).sum::<i64>() <= 0 {
            return Err(AppError::RegleMetier(format!(
                "La base totale de répartition ({cle}) est nulle : rien ne peut porter ce frais."
            )));
        }
        allouer(f.montant_c, &bases)
    };

    Ok(lignes
        .into_iter()
        .zip(bases)
        .zip(parts)
        .map(|((l, b), (pct, theo, c))| LigneAlloc {
            id_ligne: l.0,
            code_reference: l.1,
            designation: l.2,
            type_ligne: l.3,
            quantite: l.4,
            poids_net_kg: l.5,
            valeur_c: l.6,
            base: if cle == "POIDS" { b as f64 / 10_000.0 } else { b as f64 / 100.0 },
            pourcentage: pct,
            theorique: theo,
            montant_c: c,
        })
        .collect())
}

/// Le reste a appliquer d'une fiche : l'allocation de ses lignes ERP (les
/// lignes hors ERP ne portent aucun stock) moins ce que le journal a applique.
async fn reste_fiche(tx: &mut PgConnection, id: &str) -> AppResult<(i64, i64)> {
    Ok(sqlx::query_as(
        "SELECT COALESCE((SELECT round(sum(a.montant_alloue_dhs) * 100)
                            FROM v_frais_allocation_en_vigueur a
                            JOIN import_facture_lignes l ON l.id_ligne = a.id_article_dossier AND l.type_ligne = 'ERP'
                           WHERE a.id_ligne_frais = $1), 0)::bigint,
                COALESCE((SELECT round(sum(j.montant_dhs) * 100) FROM import_ajustements_cump j
                           WHERE j.id_ligne_frais = $1), 0)::bigint",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?)
}

/// VALIDE <-> APPLIQUE suit le reste a appliquer.
async fn statuer_fiche(tx: &mut PgConnection, id: &str) -> AppResult<(i64, i64)> {
    let (alloue, applique) = reste_fiche(tx, id).await?;
    let (statut, capitalisable): (Option<String>, Option<i16>) =
        sqlx::query_as("SELECT statut, capitalisable FROM dossier_lignes_frais WHERE id_ligne_frais = $1")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if capitalisable == Some(1) {
        let nouveau = if alloue == applique { "APPLIQUE" } else { "VALIDE" };
        if statut.as_deref() != Some(nouveau) {
            sqlx::query(
                "UPDATE dossier_lignes_frais
                    SET statut = $2, date_application = CASE WHEN $2 = 'APPLIQUE' THEN $3 ELSE date_application END
                  WHERE id_ligne_frais = $1",
            )
            .bind(id)
            .bind(nouveau)
            .bind(maintenant())
            .execute(&mut *tx)
            .await?;
        }
    }
    Ok((alloue, applique))
}

/// Applique `montant_c` d'une fiche a une ligne, pour une reception (ou toutes,
/// a la decision de solde) : la part des kilos encore presents au CMUP de leur
/// magasin, la part des kilos sortis au journal des ecarts. `Ok(None)` : la
/// tracabilite ne permet pas de savoir ; rien n'est ecrit, la raison va dans
/// `avis`.
#[allow(clippy::too_many_arguments)]
async fn appliquer_part(
    tx: &mut PgConnection,
    user: &Utilisateur,
    f: &Fiche,
    id_ligne: &str,
    reception: Option<(&str, &str)>,
    montant_c: i64,
    motif: Option<&str>,
    avis: &mut Vec<String>,
) -> AppResult<Option<Value>> {
    if montant_c == 0 {
        return Ok(None);
    }
    let (code_reference, suivi_lot): (String, i64) = sqlx::query_as(
        "SELECT l.code_reference, r.suivi_lot
           FROM import_facture_lignes l JOIN reference r ON r.code_reference = l.code_reference
          WHERE l.id_ligne = $1",
    )
    .bind(id_ligne)
    .fetch_one(&mut *tx)
    .await?;
    let ou = reception.map(|(_, n)| format!(" (réception {n})")).unwrap_or_default();
    let bloquer = |avis: &mut Vec<String>, raison: String| {
        avis.push(format!(
            "{} — {code_reference}{ou} : {raison} La part de {:.2} MAD reste à appliquer.",
            f.libelle_type,
            montant_c as f64 / 100.0
        ));
    };

    // Les kilos recus de la ligne, lot par lot et magasin par magasin.
    let recus: Vec<(Option<String>, String, f64)> = sqlx::query_as(
        "SELECT NULLIF(btrim(rl.lot_fournisseur), ''), rl.code_magasin, sum(rl.quantite_recue_kg)::float8
           FROM import_reception_lignes rl
           JOIN import_receptions r ON r.id_reception = rl.id_reception AND r.statut = 'VALIDEE'
          WHERE rl.id_ligne = $1 AND ($2::text IS NULL OR rl.id_reception = $2)
          GROUP BY 1, 2 ORDER BY 1, 2",
    )
    .bind(id_ligne)
    .bind(reception.map(|(id, _)| id))
    .fetch_all(&mut *tx)
    .await?;
    let q_total: f64 = recus.iter().map(|r| r.2).sum();
    if recus.is_empty() || q_total <= 0.0 {
        return Ok(None);
    }
    if suivi_lot != 1 {
        bloquer(avis, "la référence n'est pas suivie par lot : ses sorties ne disent pas quels kilos du dossier sont partis.".into());
        return Ok(None);
    }
    if recus.iter().any(|r| r.0.is_none()) {
        bloquer(avis, "une réception sans numéro de lot ne se trace pas.".into());
        return Ok(None);
    }

    // Lot par lot : exclusif a cette reception, rien en transit ; puis les
    // kilos presents par magasin.
    let mut presents: BTreeMap<String, i64> = BTreeMap::new();
    let mut presents_total: i64 = 0;
    let mut lots: Vec<String> = recus.iter().filter_map(|r| r.0.clone()).collect();
    lots.dedup();
    for lot in &lots {
        let kg_recus: f64 = recus.iter().filter(|r| r.0.as_deref() == Some(lot.as_str())).map(|r| r.2).sum();
        let (origine, transit): (f64, f64) = sqlx::query_as(
            "SELECT COALESCE(sum(lm.quantite_kg) FILTER (WHERE m.code_type_mvt = ANY ($3)), 0)::float8,
                    COALESCE(sum(CASE WHEN m.code_type_mvt = 'TRANSFERT_SORTIE' THEN lm.quantite_kg
                                      WHEN m.code_type_mvt = 'TRANSFERT_ENTREE' THEN -lm.quantite_kg END), 0)::float8
               FROM ligne_mouvement lm
               JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
              WHERE lm.code_reference = $1 AND lm.lot_fournisseur = $2
                AND m.id_mouvement_contrepasse IS NULL
                AND NOT EXISTS (SELECT 1 FROM mouvement inv WHERE inv.id_mouvement_contrepasse = m.id_mouvement)",
        )
        .bind(&code_reference)
        .bind(lot)
        .bind(&ENTREES_D_ORIGINE[..])
        .fetch_one(&mut *tx)
        .await?;
        // Toutes les entrees du lot doivent etre CES kilos : sinon le lot
        // melange plusieurs arrivees, et ses kilos presents ne disent plus
        // lesquels sont ceux du dossier.
        // (A la decision de solde, `recus` couvre toutes les receptions de la ligne.)
        let attendus = kg_recus;
        if (dmg(origine) - dmg(attendus)).abs() > 1 {
            bloquer(avis, format!(
                "le lot {lot} a reçu {origine:.4} kg en tout, dont {attendus:.4} kg de cette ligne : il est partagé, ses kilos présents ne se rattachent pas au dossier."
            ));
            return Ok(None);
        }
        if transit > 0.0001 {
            bloquer(avis, format!("{transit:.4} kg du lot {lot} sont en transit entre deux magasins."));
            return Ok(None);
        }
        let stock: Vec<(String, f64)> = sqlx::query_as(
            "SELECT code_magasin, quantite_kg::float8 FROM stock_lot
              WHERE code_reference = $1 AND lot_fournisseur = $2 AND quantite_kg > 0
              ORDER BY code_magasin",
        )
        .bind(&code_reference)
        .bind(lot)
        .fetch_all(&mut *tx)
        .await?;
        for (magasin, kg) in stock {
            *presents.entry(magasin).or_default() += dmg(kg);
            presents_total += dmg(kg);
        }
    }
    let sortis = dmg(q_total) - presents_total;
    if sortis < 0 {
        bloquer(avis, "le lot porte plus de kilos que la réception n'en a fait entrer.".into());
        return Ok(None);
    }

    // Le montant entre les « seaux » — chaque magasin present, puis les kilos
    // sortis — au prorata des kilos, au centime (plus fort reste).
    let magasins: Vec<(String, i64)> = presents.into_iter().filter(|(_, kg)| *kg > 0).collect();
    let mut poids: Vec<i64> = magasins.iter().map(|(_, kg)| *kg).collect();
    poids.push(sortis);
    let parts = repartir_signe(montant_c, &poids);
    let mut consomme_c = *parts.last().unwrap_or(&0);
    let horodatage = maintenant();
    let mut detail_magasins = Vec::new();

    for ((magasin, kg), part_c) in magasins.iter().zip(parts.iter()) {
        let (q, cump): (f64, Option<f64>) = sqlx::query_as(
            "SELECT quantite_kg::float8, cmup_mad::float8 FROM stock_magasin
              WHERE code_reference = $1 AND code_magasin = $2 FOR UPDATE",
        )
        .bind(&code_reference)
        .bind(magasin)
        .fetch_one(&mut *tx)
        .await?;
        let avant = cump.unwrap_or(0.0);
        // LE CMUP NE PASSE JAMAIS SOUS ZERO (U6) : l'excedent va au journal.
        let plancher_c = -((avant * q * 100.0).round() as i64);
        let part_c = if *part_c < plancher_c {
            consomme_c += *part_c - plancher_c;
            plancher_c
        } else {
            *part_c
        };
        // Le CMUP est celui du MAGASIN : la valeur ajoutee se divise par tout ce
        // qu'il porte, comme le fait porter() a la cloture de l'ancien moteur.
        let apres = arrondi_kg((avant + (part_c as f64 / 100.0) / q).max(0.0));
        sqlx::query("UPDATE stock_magasin SET cmup_mad = $3, date_maj = $4 WHERE code_reference = $1 AND code_magasin = $2")
            .bind(&code_reference)
            .bind(magasin)
            .bind(apres)
            .bind(&horodatage)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT INTO import_ajustements_cump
                    (id_dossier, code_reference, nature, code_magasin, quantite_recue_kg, stock_kg,
                     cump_avant, cump_apres, montant_dhs, id_utilisateur, origine, motif,
                     type_operation, id_ligne_frais, id_ligne, id_reception, quantite_kg)
             VALUES ($1, $2, 'STOCK', $3, $4, $5, $6, $7, $8 / 100.0, $9, 'FICHE', $10,
                     'APPLICATION', $11, $12, $13, $5)",
        )
        .bind(&f.id_dossier)
        .bind(&code_reference)
        .bind(magasin)
        .bind(q_total)
        .bind(*kg as f64 / 10_000.0)
        .bind(cump)
        .bind(apres)
        .bind(part_c)
        .bind(&user.id)
        .bind(motif)
        .bind(&f.id)
        .bind(id_ligne)
        .bind(reception.map(|(id, _)| id))
        .execute(&mut *tx)
        .await?;
        detail_magasins.push(json!({
            "code_magasin": magasin, "stock_kg": *kg as f64 / 10_000.0,
            "cump_avant": cump, "cump_apres": apres, "montant_dhs": part_c as f64 / 100.0,
        }));
    }
    if sortis > 0 || consomme_c != 0 {
        sqlx::query(
            "INSERT INTO import_ajustements_cump
                    (id_dossier, code_reference, nature, code_magasin, quantite_recue_kg, stock_kg,
                     montant_dhs, id_utilisateur, origine, motif,
                     type_operation, id_ligne_frais, id_ligne, id_reception, quantite_kg)
             VALUES ($1, $2, 'CONSOMME', NULL, $3, $4, $5 / 100.0, $6, 'FICHE', $7,
                     'APPLICATION', $8, $9, $10, $11)",
        )
        .bind(&f.id_dossier)
        .bind(&code_reference)
        .bind(q_total)
        .bind(presents_total as f64 / 10_000.0)
        .bind(consomme_c)
        .bind(&user.id)
        .bind(motif)
        .bind(&f.id)
        .bind(id_ligne)
        .bind(reception.map(|(id, _)| id))
        .bind(sortis as f64 / 10_000.0)
        .execute(&mut *tx)
        .await?;
    }
    // Le CMUP consolide de la fiche article (meme formule que trg_lmvt_appliquer).
    sqlx::query(
        "UPDATE reference
            SET cmup_mad = (SELECT round(SUM(sm.quantite_kg * sm.cmup_mad) / NULLIF(SUM(sm.quantite_kg), 0), 4)
                              FROM stock_magasin sm
                             WHERE sm.code_reference = $1 AND sm.quantite_kg > 0 AND sm.cmup_mad IS NOT NULL),
                date_dernier_cmup = $2
          WHERE code_reference = $1
            AND EXISTS (SELECT 1 FROM stock_magasin sm WHERE sm.code_reference = $1 AND sm.quantite_kg > 0)",
    )
    .bind(&code_reference)
    .bind(&horodatage)
    .execute(&mut *tx)
    .await?;

    Ok(Some(json!({
        "code_reference": code_reference,
        "id_ligne": id_ligne,
        "reception": reception.map(|(_, n)| n),
        "montant_dhs": montant_c as f64 / 100.0,
        "kg_concernes": q_total,
        "kg_presents": presents_total as f64 / 10_000.0,
        "kg_sortis": sortis as f64 / 10_000.0,
        "au_stock_dhs": (montant_c - consomme_c) as f64 / 100.0,
        "consomme_dhs": consomme_c as f64 / 100.0,
        "magasins": detail_magasins,
    })))
}

/// Applique a une ligne ce que ses receptions validees rendent applicable :
/// la part cumulee de l'allocation FIGEE (allocation x recu / facture), moins
/// ce que le journal porte deja. Deux appels de suite n'appliquent rien de plus.
async fn appliquer_ligne(
    tx: &mut PgConnection,
    user: &Utilisateur,
    f: &Fiche,
    id_ligne: &str,
    alloc_c: i64,
    avis: &mut Vec<String>,
) -> AppResult<Vec<Value>> {
    let (type_ligne, poids_net): (String, Option<f64>) =
        sqlx::query_as("SELECT type_ligne, poids_net_kg::float8 FROM import_facture_lignes WHERE id_ligne = $1")
            .bind(id_ligne)
            .fetch_one(&mut *tx)
            .await?;
    if type_ligne != "ERP" {
        return Ok(Vec::new()); // une ligne hors ERP n'entre dans aucun stock
    }
    let receptions: Vec<(String, String, f64)> = sqlx::query_as(
        "SELECT r.id_reception, r.numero, sum(rl.quantite_recue_kg)::float8
           FROM import_reception_lignes rl
           JOIN import_receptions r ON r.id_reception = rl.id_reception AND r.statut = 'VALIDEE'
          WHERE rl.id_ligne = $1
          GROUP BY r.id_reception, r.numero
          ORDER BY min(r.date_validation), r.id_reception",
    )
    .bind(id_ligne)
    .fetch_all(&mut *tx)
    .await?;
    let recu: f64 = receptions.iter().map(|r| r.2).sum();
    let cible = part_cumulee(alloc_c, dmg(recu), dmg(poids_net.unwrap_or(0.0)));
    // UNE LIGNE SOLDEE ne recevra plus rien : ce qui depasse les kilos recus
    // attend une decision explicite (reste-frais), jamais prise ici.
    let soldee: i64 = sqlx::query_scalar("SELECT soldee FROM import_facture_lignes WHERE id_ligne = $1")
        .bind(id_ligne)
        .fetch_one(&mut *tx)
        .await?;
    if soldee == 1 && cible != alloc_c {
        avis.push(format!(
            "{} : la ligne est soldée ; {:.2} MAD dépassent les kilos reçus et attendent votre décision \
             (appliquer aux kilos reçus, ou journal des écarts).",
            f.libelle_type,
            (alloc_c - cible) as f64 / 100.0
        ));
    }
    let (deja, appliquees): (i64, Vec<String>) = {
        let d: i64 = sqlx::query_scalar(
            "SELECT COALESCE(round(sum(montant_dhs) * 100), 0)::bigint FROM import_ajustements_cump
              WHERE id_ligne_frais = $1 AND id_ligne = $2",
        )
        .bind(&f.id)
        .bind(id_ligne)
        .fetch_one(&mut *tx)
        .await?;
        let a: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT id_reception FROM import_ajustements_cump
              WHERE id_ligne_frais = $1 AND id_ligne = $2 AND type_operation = 'APPLICATION' AND id_reception IS NOT NULL",
        )
        .bind(&f.id)
        .bind(id_ligne)
        .fetch_all(&mut *tx)
        .await?;
        (d, a)
    };
    let a_appliquer = cible - deja;
    if a_appliquer == 0 {
        return Ok(Vec::new());
    }
    let nouvelles: Vec<&(String, String, f64)> =
        receptions.iter().filter(|r| !appliquees.contains(&r.0)).collect();
    if nouvelles.is_empty() {
        avis.push(format!(
            "{} : {:.2} MAD restent à appliquer sur une ligne sans réception nouvelle — à traiter au solde.",
            f.libelle_type,
            a_appliquer as f64 / 100.0
        ));
        return Ok(Vec::new());
    }
    // Plusieurs receptions nouvelles d'un coup (fiche validee apres elles) :
    // la part se partage au prorata de leurs kilos.
    let kgs: Vec<i64> = nouvelles.iter().map(|r| dmg(r.2)).collect();
    let parts = repartir_signe(a_appliquer, &kgs);
    let mut faites = Vec::new();
    for (r, part) in nouvelles.iter().zip(parts) {
        if let Some(v) = appliquer_part(tx, user, f, id_ligne, Some((&r.0, &r.1)), part, None, avis).await? {
            faites.push(v);
        }
    }
    Ok(faites)
}

/// Applique tout ce qui est applicable d'une fiche validee, ligne par ligne.
async fn appliquer_fiche(
    tx: &mut PgConnection,
    user: &Utilisateur,
    f: &Fiche,
    avis: &mut Vec<String>,
) -> AppResult<Vec<Value>> {
    let allocations: Vec<(String, i64)> = sqlx::query_as(
        "SELECT id_article_dossier, round(montant_alloue_dhs * 100)::bigint
           FROM lignes_frais_repartition
          WHERE id_ligne_frais = $1 AND version = $2
          ORDER BY id_article_dossier",
    )
    .bind(&f.id)
    .bind(f.version)
    .fetch_all(&mut *tx)
    .await?;
    let mut faites = Vec::new();
    for (id_ligne, alloc_c) in allocations {
        faites.extend(appliquer_ligne(tx, user, f, &id_ligne, alloc_c, avis).await?);
    }
    statuer_fiche(tx, &f.id).await?;
    Ok(faites)
}

/// La decision de l'utilisateur au moment de valider.
#[derive(Debug, Default, serde::Deserialize)]
pub struct DecisionFiche {
    pub cle_repartition: Option<String>,
    pub motif_cle: Option<String>,
}

/// VALIDER UNE FICHE — un seul geste : l'allocation calculee par le serveur
/// est figee, puis appliquee a ce qui est deja recu. Dans la transaction de
/// l'appelant ; l'apercu est le meme appel, annule ensuite.
pub async fn valider_fiche(
    tx: &mut PgConnection,
    user: &Utilisateur,
    id: &str,
    decision: &DecisionFiche,
) -> AppResult<Value> {
    let f = verrouiller_fiche(tx, id).await?;
    if f.statut.as_deref() != Some("BROUILLON") {
        return Err(AppError::RegleMetier(format!(
            "Cette fiche est {} : seule une fiche en brouillon se valide.",
            f.statut.as_deref().map(str::to_lowercase).unwrap_or_else(|| "de l'ancien moteur".into())
        )));
    }
    let cle = decision
        .cle_repartition
        .clone()
        .or_else(|| f.cle.clone())
        .unwrap_or_else(|| f.cle_proposee.clone());
    let motif = decision
        .motif_cle
        .clone()
        .or_else(|| f.motif_cle.clone())
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty());
    if !f.cles_autorisees.contains(&cle) {
        return Err(AppError::RegleMetier(format!(
            "La clé {cle} n'est pas autorisée pour « {} » (autorisées : {}).",
            f.libelle_type,
            f.cles_autorisees.join(", ")
        )));
    }
    if cle != f.cle_proposee && motif.as_deref().map(|m| m.chars().count()).unwrap_or(0) < 5 {
        return Err(AppError::Invalide(format!(
            "La clé proposée est {}, vous avez choisi {cle} : dites pourquoi (motif, 5 caractères au moins).",
            f.cle_proposee
        )));
    }

    let lignes = if f.inclus == 1 { calculer_allocation(tx, &f, &cle).await? } else { Vec::new() };
    if f.inclus == 1 {
        // La version en vigueur, ecrite une fois. Ses lignes sont celles d'un
        // brouillon jusqu'au passage a VALIDE juste apres ; la base les fige.
        sqlx::query("DELETE FROM lignes_frais_repartition WHERE id_ligne_frais = $1 AND version = $2")
            .bind(&f.id)
            .bind(f.version)
            .execute(&mut *tx)
            .await?;
        let ids: Vec<String> = lignes.iter().map(|l| l.id_ligne.clone()).collect();
        let pcts: Vec<f64> = lignes.iter().map(|l| l.pourcentage).collect();
        let montants: Vec<i64> = lignes.iter().map(|l| l.montant_c).collect();
        let bases: Vec<f64> = lignes.iter().map(|l| l.base).collect();
        let theos: Vec<f64> = lignes.iter().map(|l| l.theorique).collect();
        sqlx::query(
            "INSERT INTO lignes_frais_repartition
                    (id_ligne_frais, version, id_article_dossier, pourcentage, montant_alloue_dhs,
                     base_repartition, montant_theorique)
             SELECT $1, $2, v.id, round(v.pct::numeric, 10), v.c / 100.0,
                    round(v.base::numeric, 6), round(v.theo::numeric, 6)
               FROM unnest($3::text[], $4::float8[], $5::bigint[], $6::float8[], $7::float8[])
                    AS v(id, pct, c, base, theo)",
        )
        .bind(&f.id)
        .bind(f.version)
        .bind(&ids)
        .bind(&pcts)
        .bind(&montants)
        .bind(&bases)
        .bind(&theos)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "UPDATE dossier_lignes_frais
            SET cle_repartition = $2, motif_cle = $3, statut = 'VALIDE', capitalisable = $4,
                id_utilisateur_validation = $5, date_validation = $6
          WHERE id_ligne_frais = $1 AND statut = 'BROUILLON'",
    )
    .bind(&f.id)
    .bind(&cle)
    .bind(&motif)
    .bind(f.inclus as i16)
    .bind(&user.id)
    .bind(maintenant())
    .execute(&mut *tx)
    .await?;

    let mut avis = Vec::new();
    let applications = if f.inclus == 1 {
        appliquer_fiche(tx, user, &f, &mut avis).await?
    } else {
        Vec::new()
    };
    let (alloue, applique) = reste_fiche(tx, id).await?;
    let statut: String = sqlx::query_scalar("SELECT statut FROM dossier_lignes_frais WHERE id_ligne_frais = $1")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    let total_c: i64 = lignes.iter().map(|l| l.montant_c).sum();
    Ok(json!({
        "id_ligne_frais": id,
        "statut_fiche": statut,
        "cle_repartition": cle,
        "capitalisable": f.inclus == 1,
        "montant_dhs": f.montant_c as f64 / 100.0,
        "lignes": lignes.iter().map(LigneAlloc::json).collect::<Vec<_>>(),
        "total_reparti_dhs": total_c as f64 / 100.0,
        "equilibre": f.inclus != 1 || total_c == f.montant_c,
        "applications": applications,
        "montant_applique_dhs": applique as f64 / 100.0,
        "reste_a_appliquer_dhs": (alloue - applique) as f64 / 100.0,
        "avis": avis,
    }))
}

/// VALIDE -> BROUILLON, seulement si rien n'a ete applique (la base le
/// garantit) : une nouvelle version s'ouvre, l'allocation validee reste
/// archivee.
pub async fn remettre_en_brouillon(tx: &mut PgConnection, user: &Utilisateur, id: &str, motif: &str) -> AppResult<Value> {
    let motif = motif.trim();
    if motif.chars().count() < 5 {
        return Err(AppError::Invalide("Dites pourquoi la fiche revient en brouillon (5 caractères au moins).".into()));
    }
    let f = verrouiller_fiche(tx, id).await?;
    if f.statut.as_deref() != Some("VALIDE") {
        return Err(AppError::RegleMetier(
            "Seule une fiche validée, dont rien n'est encore appliqué, revient en brouillon. \
             Une fiche appliquée se corrige par une rectificative."
                .into(),
        ));
    }
    sqlx::query(
        "UPDATE dossier_lignes_frais
            SET statut = 'BROUILLON', version = version + 1, motif_brouillon = $2,
                id_utilisateur_brouillon = $3, date_brouillon = $4,
                id_utilisateur_validation = NULL, date_validation = NULL, capitalisable = NULL
          WHERE id_ligne_frais = $1",
    )
    .bind(id)
    .bind(motif)
    .bind(&user.id)
    .bind(maintenant())
    .execute(&mut *tx)
    .await?;
    Ok(json!({ "id_ligne_frais": id, "statut_fiche": "BROUILLON", "version": f.version + 1 }))
}

/// UNE RECTIFICATIVE : une fiche nouvelle, en brouillon, liee a l'ORIGINALE
/// (jamais a une autre rectificative), avec son motif et sa piece. Elle propose
/// l'allocation de l'originale, au prorata ; l'utilisateur la confirme ou en
/// choisit une autre en la validant.
pub async fn rectifier_fiche(
    tx: &mut PgConnection,
    user: &Utilisateur,
    id_origine: &str,
    montant_devise: f64,
    motif: &str,
    numero_piece: &str,
) -> AppResult<Value> {
    let motif = motif.trim();
    let numero_piece = numero_piece.trim();
    if motif.chars().count() < 5 || numero_piece.is_empty() || montant_devise == 0.0 || !montant_devise.is_finite() {
        return Err(AppError::Invalide(
            "Une rectificative demande un montant (signé, non nul), un motif (5 caractères au moins) et la pièce \
             qui la justifie (avoir, facture corrigée)."
                .into(),
        ));
    }
    let f = verrouiller_fiche(tx, id_origine).await?;
    if !matches!(f.statut.as_deref(), Some("VALIDE") | Some("APPLIQUE")) {
        return Err(AppError::RegleMetier("Seule une fiche validée se rectifie ; un brouillon se modifie.".into()));
    }
    let (devise, cours): (String, f64) =
        sqlx::query_as("SELECT code_devise, cours_change::float8 FROM dossier_lignes_frais WHERE id_ligne_frais = $1")
            .bind(id_origine)
            .fetch_one(&mut *tx)
            .await?;
    let clos = f.statut_dossier == "CLOTURE";
    if clos {
        sqlx::query("SELECT set_config('gestionfil.frais_post_cloture', 'on', true)")
            .execute(&mut *tx)
            .await?;
    }
    let rect_c = (montant_devise * cours * 100.0).round() as i64;
    let origine: Vec<(String, i64)> = sqlx::query_as(
        "SELECT id_article_dossier, round(montant_alloue_dhs * 100)::bigint
           FROM v_frais_allocation_en_vigueur WHERE id_ligne_frais = $1 ORDER BY id_article_dossier",
    )
    .bind(id_origine)
    .fetch_all(&mut *tx)
    .await?;
    let proposer_manuel = f.inclus == 1 && !origine.is_empty() && f.cles_autorisees.iter().any(|c| c == "MANUEL");
    let (cle, motif_cle) = if proposer_manuel {
        (Some("MANUEL".to_string()), Some("Proposée : l'allocation de la fiche d'origine, au prorata".to_string()))
    } else {
        (f.cle.clone(), f.motif_cle.clone())
    };
    let id: String = sqlx::query_scalar(
        "INSERT INTO dossier_lignes_frais
                (id_dossier, id_frais, libelle, numero_piece, montant_devise, code_devise, cours_change,
                 id_utilisateur_creation, statut, cle_repartition, motif_cle,
                 id_ligne_frais_origine, motif_rectification, post_cloture, motif_post_cloture)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'BROUILLON', $9, $10, $11, $12, $13, $14)
         RETURNING id_ligne_frais",
    )
    .bind(&f.id_dossier)
    .bind(&f.id_frais)
    .bind(format!("Rectification — {motif}"))
    .bind(numero_piece)
    .bind(montant_devise)
    .bind(&devise)
    .bind(cours)
    .bind(&user.id)
    .bind(&cle)
    .bind(&motif_cle)
    .bind(id_origine)
    .bind(motif)
    .bind(if clos { 1i16 } else { 0 })
    .bind(if clos { Some(motif) } else { None })
    .fetch_one(&mut *tx)
    .await?;
    if proposer_manuel {
        let bases: Vec<i64> = origine.iter().map(|(_, c)| c.abs()).collect();
        let parts = repartir_signe(rect_c, &bases);
        let ids: Vec<String> = origine.iter().map(|(l, _)| l.clone()).collect();
        sqlx::query(
            "INSERT INTO dossier_lignes_frais_cibles (id_ligne_frais, id_ligne, montant_saisi)
             SELECT $1, v.id, v.c / 100.0 FROM unnest($2::text[], $3::bigint[]) AS v(id, c)",
        )
        .bind(&id)
        .bind(&ids)
        .bind(&parts)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "INSERT INTO dossier_lignes_frais_cibles (id_ligne_frais, id_ligne)
             SELECT $1, id_ligne FROM dossier_lignes_frais_cibles WHERE id_ligne_frais = $2",
        )
        .bind(&id)
        .bind(id_origine)
        .execute(&mut *tx)
        .await?;
    }
    Ok(json!({ "id_ligne_frais": id, "statut_fiche": "BROUILLON", "id_ligne_frais_origine": id_origine }))
}

/// LA DECISION AU SOLDE d'une ligne : son reste de frais est applique aux kilos
/// reellement recus (APPLIQUER_RECU), ou porte au journal des ecarts
/// (JOURNAL_ECART). Le moteur ne choisit jamais a la place de l'utilisateur.
pub async fn decider_reste(
    tx: &mut PgConnection,
    user: &Utilisateur,
    id_ligne: &str,
    choix: &str,
    motif: &str,
) -> AppResult<Value> {
    let motif = motif.trim();
    if !matches!(choix, "APPLIQUER_RECU" | "JOURNAL_ECART") {
        return Err(AppError::Invalide("Choix inconnu : APPLIQUER_RECU ou JOURNAL_ECART.".into()));
    }
    if motif.chars().count() < 5 {
        return Err(AppError::Invalide("Dites pourquoi (5 caractères au moins).".into()));
    }
    let id_dossier: String = sqlx::query_scalar(
        "SELECT f.id_dossier FROM import_facture_lignes l JOIN import_factures f ON f.id_facture = l.id_facture
          WHERE l.id_ligne = $1",
    )
    .bind(id_ligne)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("ligne {id_ligne}")))?;
    sqlx::query("SELECT 1 FROM import_dossiers WHERE id_dossier = $1 FOR UPDATE")
        .bind(&id_dossier)
        .execute(&mut *tx)
        .await?;
    let (soldee, deja, code_reference, recu): (i64, Option<String>, Option<String>, f64) = sqlx::query_as(
        "SELECT soldee, traitement_reste_frais, code_reference, quantite_recue_kg::float8
           FROM import_facture_lignes WHERE id_ligne = $1 FOR UPDATE",
    )
    .bind(id_ligne)
    .fetch_one(&mut *tx)
    .await?;
    if soldee != 1 {
        return Err(AppError::RegleMetier(
            "La ligne n'est pas soldée : son reste de frais s'appliquera à mesure des réceptions.".into(),
        ));
    }
    // UNE DECISION PAR RESTE : deja decidee, la ligne n'en reprend une que si
    // une fiche (un frais tardif, une rectificative) y laisse un reste nouveau.
    if let Some(d) = &deja {
        let restant: bool = sqlx::query_scalar(
            "SELECT EXISTS (
                SELECT 1 FROM v_frais_allocation_en_vigueur a
                  JOIN dossier_lignes_frais x ON x.id_ligne_frais = a.id_ligne_frais
                 WHERE a.id_article_dossier = $1 AND x.statut IN ('VALIDE', 'APPLIQUE') AND x.capitalisable = 1
                   AND a.montant_alloue_dhs <> COALESCE((SELECT sum(j.montant_dhs) FROM import_ajustements_cump j
                                                          WHERE j.id_ligne_frais = a.id_ligne_frais
                                                            AND j.id_ligne = a.id_article_dossier), 0))",
        )
        .bind(id_ligne)
        .fetch_one(&mut *tx)
        .await?;
        if !restant {
            return Err(AppError::RegleMetier(format!(
                "Le reste de cette ligne est déjà décidé ({d}) et aucune fiche n'y laisse de reste."
            )));
        }
    }
    sqlx::query(
        "UPDATE import_facture_lignes
            SET traitement_reste_frais = $2, motif_traitement_reste = $3,
                id_utilisateur_traitement_reste = $4, date_traitement_reste = $5
          WHERE id_ligne = $1",
    )
    .bind(id_ligne)
    .bind(choix)
    .bind(motif)
    .bind(&user.id)
    .bind(maintenant())
    .execute(&mut *tx)
    .await?;

    let fiches: Vec<(String, i64)> = sqlx::query_as(
        "SELECT a.id_ligne_frais, round(a.montant_alloue_dhs * 100)::bigint
           FROM v_frais_allocation_en_vigueur a
           JOIN dossier_lignes_frais x ON x.id_ligne_frais = a.id_ligne_frais
          WHERE a.id_article_dossier = $1 AND x.statut IN ('VALIDE', 'APPLIQUE') AND x.capitalisable = 1
          ORDER BY a.id_ligne_frais",
    )
    .bind(id_ligne)
    .fetch_all(&mut *tx)
    .await?;
    let mut faites = Vec::new();
    for (id_fiche, alloc_c) in fiches {
        let f = verrouiller_fiche(tx, &id_fiche).await?;
        let applique_c: i64 = sqlx::query_scalar(
            "SELECT COALESCE(round(sum(montant_dhs) * 100), 0)::bigint FROM import_ajustements_cump
              WHERE id_ligne_frais = $1 AND id_ligne = $2",
        )
        .bind(&id_fiche)
        .bind(id_ligne)
        .fetch_one(&mut *tx)
        .await?;
        let reste_c = alloc_c - applique_c;
        if reste_c == 0 {
            continue;
        }
        if choix == "APPLIQUER_RECU" {
            let mut avis = Vec::new();
            match appliquer_part(tx, user, &f, id_ligne, None, reste_c, Some(motif), &mut avis).await? {
                Some(v) => faites.push(v),
                None => {
                    return Err(AppError::RegleMetier(format!(
                        "Le reste ne peut pas s'appliquer aux kilos reçus : {} Choisissez le journal des écarts, \
                         ou résolvez d'abord la traçabilité.",
                        avis.join(" ")
                    )))
                }
            }
        } else {
            sqlx::query(
                "INSERT INTO import_ajustements_cump
                        (id_dossier, code_reference, nature, code_magasin, quantite_recue_kg, stock_kg,
                         montant_dhs, id_utilisateur, origine, motif,
                         type_operation, id_ligne_frais, id_ligne, id_reception, quantite_kg)
                 VALUES ($1, $2, 'CONSOMME', NULL, $3, 0, $4 / 100.0, $5, 'FICHE', $6,
                         'APPLICATION', $7, $8, NULL, 0)",
            )
            .bind(&f.id_dossier)
            .bind(&code_reference)
            .bind(recu)
            .bind(reste_c)
            .bind(&user.id)
            .bind(motif)
            .bind(&f.id)
            .bind(id_ligne)
            .execute(&mut *tx)
            .await?;
            faites.push(json!({ "id_ligne_frais": f.id, "journal_ecart_dhs": reste_c as f64 / 100.0 }));
        }
        statuer_fiche(tx, &f.id).await?;
    }
    Ok(json!({ "id_ligne": id_ligne, "traitement_reste_frais": choix, "applications": faites }))
}

/// A LA VALIDATION D'UNE RECEPTION : chaque fiche validee qui vise ses lignes
/// applique la part que ces kilos rendent applicable. Une application bloquee
/// (tracabilite) ne bloque pas la reception : elle est signalee.
pub async fn appliquer_reception(tx: &mut PgConnection, user: &Utilisateur, id_reception: &str) -> AppResult<Vec<String>> {
    let fiches: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT a.id_ligne_frais
           FROM import_reception_lignes rl
           JOIN v_frais_allocation_en_vigueur a ON a.id_article_dossier = rl.id_ligne
           JOIN dossier_lignes_frais x ON x.id_ligne_frais = a.id_ligne_frais
          WHERE rl.id_reception = $1 AND x.statut IN ('VALIDE', 'APPLIQUE') AND x.capitalisable = 1
          ORDER BY 1",
    )
    .bind(id_reception)
    .fetch_all(&mut *tx)
    .await?;
    let mut avis = Vec::new();
    for id in fiches {
        let f = verrouiller_fiche(tx, &id).await?;
        appliquer_fiche(tx, user, &f, &mut avis).await?;
    }
    Ok(avis)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::{allouer, part_cumulee, repartir_centimes};

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

    // ---- Les fiches de frais (12/10/2026) ---------------------------------

    /// L'exemple officiel : 519 MAD sur 10 000 / 20 000 / 30 000 MAD.
    #[test]
    fn frais_519_par_valeur() {
        let a = allouer(51_900, &[1_000_000, 2_000_000, 3_000_000]);
        let c: Vec<i64> = a.iter().map(|x| x.2).collect();
        assert_eq!(c, [8_650, 17_300, 25_950]); // 86,50 173,00 259,50
        assert!((a[0].1 - 86.5).abs() < 1e-9 && (a[2].1 - 259.5).abs() < 1e-9);
        assert!((a.iter().map(|x| x.0).sum::<f64>() - 100.0).abs() < 1e-9);
    }

    /// Des centimes qui ne tombent pas juste : la somme egale toujours le montant.
    #[test]
    fn arrondis_au_plus_fort_reste() {
        for montant in [10_000, 10_001, 10_002, 51_900, 1, 7, 99_999_999] {
            for bases in [&[1i64, 1, 1][..], &[3, 7, 11, 13], &[1, 2], &[123_456, 654_321, 1]] {
                let c: i64 = allouer(montant, bases).iter().map(|x| x.2).sum();
                assert_eq!(c, montant, "montant {montant} bases {bases:?}");
            }
        }
        // Egalite des restes : la premiere ligne d'abord, a chaque fois.
        assert_eq!(allouer(10_000, &[1, 1, 1]).iter().map(|x| x.2).collect::<Vec<_>>(), [3_334, 3_333, 3_333]);
        assert_eq!(allouer(1, &[1, 1, 1]).iter().map(|x| x.2).collect::<Vec<_>>(), [1, 0, 0]);
    }

    /// Une rectificative negative se repartit au meme prorata, signe garde.
    #[test]
    fn rectificative_negative() {
        let c: Vec<i64> = allouer(-100_000, &[60, 40]).iter().map(|x| x.2).collect();
        assert_eq!(c, [-60_000, -40_000]);
    }

    /// Mille lignes : exact, et vite.
    #[test]
    fn mille_lignes() {
        let bases: Vec<i64> = (1..=1_000).map(|i| (i * 7_919) % 100_003 + 1).collect();
        let debut = std::time::Instant::now();
        let a = allouer(123_456_789, &bases);
        assert!(debut.elapsed().as_millis() < 200);
        assert_eq!(a.iter().map(|x| x.2).sum::<i64>(), 123_456_789);
    }

    /// Une base totale nulle ne repartit rien (le moteur refuse en amont).
    #[test]
    fn base_nulle() {
        assert!(allouer(5_000, &[0, 0]).iter().all(|x| x.2 == 0 && x.0 == 0.0));
    }

    /// L'application progressive : 40 puis 60 sur 100 -> 400 puis 600 ; la
    /// somme des parts egale l'allocation, sans derive ; plafonnee.
    #[test]
    fn application_progressive() {
        assert_eq!(part_cumulee(100_000, 40, 100), 40_000);
        assert_eq!(part_cumulee(100_000, 100, 100) - part_cumulee(100_000, 40, 100), 60_000);
        // 1 000,01 en trois receptions : la derniere tombe juste.
        let a = 100_001;
        let p1 = part_cumulee(a, 33, 100);
        let p2 = part_cumulee(a, 66, 100) - p1;
        let p3 = part_cumulee(a, 100, 100) - p1 - p2;
        assert_eq!(p1 + p2 + p3, a);
        // Excedent recu : jamais plus que l'allocation.
        assert_eq!(part_cumulee(a, 120, 100), a);
        // Negatif (rectificative) : symetrique.
        assert_eq!(part_cumulee(-100_000, 40, 100), -40_000);
        // Facture sans poids : tout ou rien n'a pas de sens, l'allocation entiere.
        assert_eq!(part_cumulee(500, 10, 0), 500);
    }
}
