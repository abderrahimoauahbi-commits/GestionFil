//! Dossiers d'importation : repartition des frais, entree en stock, cloture.
//!
//! PERIMETRE : MRP, stock, CUMP. Pas de comptabilite, pas de paiement.
//!
//! Trois operations, chacune dans UNE transaction :
//!
//!   * `recalculer_repartition` — les frais inclus dans le cout sont repartis
//!     sur les lignes AU PRORATA DE LA VALEUR, au centime pres ;
//!   * `valider_reception` — une facture, plusieurs ou une partie entrent en
//!     stock A LA VALEUR FACTURE (cout reel : reglee par la banque sur l'engagement d'importation, au taux de la facture), par le journal existant ;
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
use std::collections::{BTreeMap, HashMap};

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

/// Recalcule toute la repartition d'un dossier.
///
/// Appelee apres chaque modification d'une ligne ou d'un frais : la
/// repartition n'est jamais saisie, elle se DEDUIT. La base d'une ligne est sa
/// valeur en dirhams (montant devise x taux de sa facture) : avec une seule
/// devise, les parts sont exactement celles du montant en devise ; avec deux,
/// c'est la seule facon de ne pas poser 1 EUR = 1 USD.
pub async fn recalculer_repartition(tx: &mut PgConnection, id_dossier: &str) -> AppResult<()> {
    recalculer_repartition_mode(tx, id_dossier, false).await
}

/// La repartition, et pour un FRAIS POST-CLOTURE (regle 5) sur un dossier clos.
pub async fn recalculer_repartition_mode(tx: &mut PgConnection, id_dossier: &str, post_cloture: bool) -> AppResult<()> {
    let statut: Option<String> =
        sqlx::query_scalar("SELECT statut FROM import_dossiers WHERE id_dossier = $1 FOR UPDATE")
            .bind(id_dossier)
            .fetch_optional(&mut *tx)
            .await?;
    match statut.as_deref() {
        None => return Err(AppError::Introuvable(format!("dossier {id_dossier}"))),
        Some("CLOTURE") if !post_cloture => {
            return Err(AppError::RegleMetier(
                "Dossier clôturé : la répartition est figée.".into(),
            ))
        }
        _ => {}
    }

    // Toutes les lignes, ERP comme hors ERP : chacune porte sa part de frais.
    //
    // Trois bases sont lues d'un coup — la valeur en centimes, le poids et la
    // quantite au millieme — parce que le type de frais choisit LAQUELLE le
    // repartit. En entiers : la repartition au centime ne supporte pas le
    // flottant.
    let lignes: Vec<(String, i64, i64, i64)> = sqlx::query_as(
        "SELECT l.id_ligne,
                (round(l.montant_devise * f.taux_change, 2) * 100)::bigint,
                (round(COALESCE(l.poids_net_kg, 0), 3) * 1000)::bigint,
                (round(COALESCE(l.quantite, 0), 3) * 1000)::bigint
           FROM import_facture_lignes l
           JOIN import_factures f ON f.id_facture = l.id_facture
          WHERE f.id_dossier = $1
          ORDER BY f.date_creation, f.id_facture, l.ligne_numero",
    )
    .bind(id_dossier)
    .fetch_all(&mut *tx)
    .await?;

    /// La base d'une ligne pour une methode donnee.
    ///
    /// PARTS_EGALES vaut 1 par ligne : chaque ligne pese autant, et les restes
    /// tombent alors dans l'ordre des lignes, sans hasard.
    fn base(l: &(String, i64, i64, i64), methode: &str) -> i64 {
        match methode {
            "POIDS" => l.2,
            "QUANTITE" => l.3,
            "PARTS_EGALES" => 1,
            _ => l.1,
        }
    }

    // Une repartition MANUELLE est saisie, pas calculee : on n'y touche pas.
    sqlx::query(
        "DELETE FROM lignes_frais_repartition
          WHERE id_ligne_frais IN (SELECT d.id_ligne_frais FROM dossier_lignes_frais d
                                     JOIN parametres_frais p ON p.id_frais = d.id_frais
                                    WHERE d.id_dossier = $1
                                      AND COALESCE(d.methode_repartition, p.methode_repartition) <> 'MANUEL')",
    )
    .bind(id_dossier)
    .execute(&mut *tx)
    .await?;

    // Seuls les frais INCLUS dans le cout : la TVA a l'importation n'est
    // jamais repartie, c'est le catalogue qui le dit.
    let frais: Vec<(String, i64, String)> = sqlx::query_as(
        "SELECT d.id_ligne_frais, (d.montant_dhs * 100)::bigint,
                COALESCE(d.methode_repartition, p.methode_repartition)
           FROM dossier_lignes_frais d
           JOIN parametres_frais p ON p.id_frais = d.id_frais
          WHERE d.id_dossier = $1 AND p.inclus_dans_cout = 1
            AND COALESCE(d.methode_repartition, p.methode_repartition) <> 'MANUEL'
          ORDER BY d.date_creation, d.id_ligne_frais",
    )
    .bind(id_dossier)
    .fetch_all(&mut *tx)
    .await?;

    for (id_frais, montant, methode) in &frais {
        let cibles: Vec<String> = sqlx::query_scalar(
            "SELECT id_ligne FROM dossier_lignes_frais_cibles WHERE id_ligne_frais = $1",
        )
        .bind(id_frais)
        .fetch_all(&mut *tx)
        .await?;

        // Pas de cible : tout le dossier. Des cibles : elles seules.
        let perimetre: Vec<&(String, i64, i64, i64)> = lignes
            .iter()
            .filter(|(id, ..)| cibles.is_empty() || cibles.contains(id))
            .collect();
        let bases: Vec<i64> = perimetre.iter().map(|l| base(l, methode)).collect();
        let total: i64 = bases.iter().sum();
        if total <= 0 {
            // Rien pour le porter encore (aucune ligne saisie) : la cloture le
            // verra et refusera, ce n'est pas une erreur de saisie.
            continue;
        }

        let parts = repartir_centimes(*montant, &bases);
        let ids: Vec<String> = perimetre.iter().map(|(id, ..)| id.clone()).collect();
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
    let total: i64 = lignes.iter().map(|(_, valeur, _, _)| valeur).sum();
    if total > 0 {
        let ids: Vec<String> = lignes.iter().map(|(id, ..)| id.clone()).collect();
        let pcts: Vec<f64> = lignes
            .iter()
            .map(|(_, valeur, _, _)| *valeur as f64 * 100.0 / total as f64)
            .collect();
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

    let quantite_totale: f64 = entrees.iter().map(|e| e.quantite).sum();
    Ok(json!({
        "id_reception": id_reception,
        "numero": numero,
        "mouvements": mouvements,
        "lignes": entrees.len(),
        "quantite_kg": arrondi_kg(quantite_totale),
    }))
}

/// LES KILOS RECUS D'UN DOSSIER BASCULE, RELUS DEPUIS SES ARRIVAGES.
///
/// ADR-003 phase C. Un dossier en `circuit_reception = 'BON'` ne recoit plus
/// contre ses lignes de facture : sa marchandise se pese dans la reception
/// unifiee, contre les lignes du bon de commande qui l'a engagee. Toute la
/// chaine des frais — le reste a recevoir, la base de repartition, la
/// localisation des lots, le CUMP definitif — lit pourtant
/// `import_facture_lignes.quantite_recue_kg`.
///
/// UN RECALCUL, PAS UN INCREMENT. La facture arrive souvent APRES le camion :
/// un compteur incremente a la validation aurait rate les kilos entres avant
/// qu'elle soit saisie, et le dossier aurait refuse de se cloturer en disant
/// qu'il restait tout a recevoir. On relit donc, a chaque fois, ce que les
/// arrivages valides de ce dossier ont fait entrer sur la ligne de bon.
///
/// Sans effet sur un dossier en `FACTURE` : la, c'est l'ecran des receptions
/// d'import qui tient ce compteur, et lui seul.
pub async fn synchroniser_recu_arrivages(tx: &mut PgConnection, id_dossier: &str) -> AppResult<()> {
    sqlx::query(
        "UPDATE import_facture_lignes fl
            SET quantite_recue_kg = n.kg
           FROM (SELECT fl2.id_ligne,
                        COALESCE((SELECT ROUND(SUM(lr.quantite_stock_kg), 4)
                                    FROM ligne_reception lr
                                    JOIN reception r ON r.id_reception = lr.id_reception
                                   WHERE lr.id_ligne_bc = fl2.id_ligne_bc
                                     AND r.id_dossier_import = $1
                                     AND r.statut IN ('VALIDE', 'CLOTURE')), 0) AS kg
                   FROM import_facture_lignes fl2
                   JOIN import_factures f ON f.id_facture = fl2.id_facture
                  WHERE f.id_dossier = $1 AND fl2.id_ligne_bc IS NOT NULL) n
          WHERE fl.id_ligne = n.id_ligne
            AND fl.quantite_recue_kg IS DISTINCT FROM n.kg
            AND EXISTS (SELECT 1 FROM import_dossiers d
                         WHERE d.id_dossier = $1 AND d.circuit_reception = 'BON')",
    )
    .bind(id_dossier)
    .execute(&mut *tx)
    .await?;
    Ok(())
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
    let resultat = cloturer_dans(&mut tx, user, id_dossier, false, simuler).await?;
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
            // LES DEUX CIRCUITS, D'OU QUE LA MARCHANDISE SOIT ENTREE (phase C) :
            // les lignes de reception d'import pour un dossier en FACTURE, les
            // lignes d'arrivage pour un dossier bascule en BON. L'UNION les
            // reunit ; un dossier n'a jamais les deux (l'etancheite y veille).
            "WITH recu AS (
                 SELECT rl.lot_fournisseur, rl.code_magasin, rl.quantite_recue_kg
                   FROM import_reception_lignes rl
                   JOIN import_receptions r ON r.id_reception = rl.id_reception AND r.statut = 'VALIDEE'
                   JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
                   JOIN import_factures f ON f.id_facture = l.id_facture
                  WHERE f.id_dossier = $1 AND l.code_reference = $2
                 UNION ALL
                 SELECT lr.lot_fournisseur, lr.code_magasin_dest AS code_magasin,
                        lr.quantite_stock_kg AS quantite_recue_kg
                   FROM ligne_reception lr
                   JOIN reception r2 ON r2.id_reception = lr.id_reception
                                    AND r2.statut IN ('VALIDE', 'CLOTURE')
                  WHERE r2.id_dossier_import = $1 AND lr.code_reference = $2
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

/// LE MOTEUR DE CLOTURE, dans la transaction de l'appelant. `post_cloture` :
/// un frais tardif sur un dossier deja clos (regle 5, 09/10/2026) — on ne
/// rouvre pas le dossier, on reporte la seule difference sur le stock restant.
pub async fn cloturer_dans(
    tx: &mut PgConnection,
    user: &Utilisateur,
    id_dossier: &str,
    post_cloture: bool,
    simuler: bool,
) -> AppResult<Value> {
    let (numero, statut): (String, String) = sqlx::query_as(
        "SELECT numero, statut FROM import_dossiers WHERE id_dossier = $1 FOR UPDATE",
    )
    .bind(id_dossier)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("dossier {id_dossier}")))?;

    // LES KILOS RECUS D'ABORD (phase C) : un dossier bascule les tient de ses
    // arrivages, et c'est sur eux que portent toutes les gardes qui suivent.
    synchroniser_recu_arrivages(tx, id_dossier).await?;
    statuer_factures(tx, id_dossier).await?;

    match statut.as_str() {
        "CLOTURE" if !post_cloture => {
            return Err(AppError::RegleMetier(format!("Le dossier {numero} est déjà clôturé.")))
        }
        s if post_cloture && s != "CLOTURE" => {
            return Err(AppError::RegleMetier(format!(
                "Le dossier {numero} n'est pas clôturé : le frais s'ajoute normalement, la clôture le répartira."
            )))
        }
        "BROUILLON" => {
            return Err(AppError::RegleMetier(format!(
                "Le dossier {numero} n'a encore rien reçu : il n'y a pas de stock à ajuster."
            )))
        }
        _ => {}
    }

    // ---- 1. Tout est recu, ou solde ---------------------------------------------
    let manquants: Vec<(String, String, f64)> = if post_cloture { Vec::new() } else { sqlx::query_as(
        "SELECT f.numero_facture, l.code_reference, l.reste_kg::float8
           FROM import_facture_lignes l
           JOIN import_factures f ON f.id_facture = l.id_facture
          WHERE f.id_dossier = $1 AND l.type_ligne = 'ERP' AND l.soldee = 0
            AND l.reste_kg > l.poids_net_kg * fn_tolerance_fournisseur(f.code_fournisseur) / 100.0 + 0.001
          ORDER BY f.numero_facture, l.ligne_numero",
    )
    .bind(id_dossier)
    .fetch_all(&mut *tx)
    .await? };
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
    // entrer du stock APRES la repartition des frais. Les ARRIVAGES rattaches
    // au dossier comptent de la meme facon depuis la phase C — sans eux, un
    // camion encore sur la bascule passait inapercu de la cloture.
    let brouillons: i64 = sqlx::query_scalar(
        "SELECT (SELECT count(DISTINCT r.id_reception)
                   FROM import_receptions r
                   JOIN import_reception_lignes rl ON rl.id_reception = r.id_reception
                   JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
                   JOIN import_factures f ON f.id_facture = l.id_facture
                  WHERE f.id_dossier = $1 AND r.statut IN ('BROUILLON','A_CONTROLER'))
              + (SELECT count(*) FROM reception r2
                  WHERE r2.id_dossier_import = $1
                    AND r2.statut IN ('BROUILLON','A_CONTROLER'))",
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

    recalculer_repartition_mode(tx, id_dossier, post_cloture).await?;

    let non_repartis: Vec<(String, f64)> = sqlx::query_as(
        "SELECT p.libelle || CASE WHEN COALESCE(d.methode_repartition, p.methode_repartition) = 'MANUEL'
                                  THEN ', répartition manuelle' ELSE '' END,
                d.montant_dhs::float8
           FROM dossier_lignes_frais d
           JOIN parametres_frais p ON p.id_frais = d.id_frais
           LEFT JOIN lignes_frais_repartition r ON r.id_ligne_frais = d.id_ligne_frais
          WHERE d.id_dossier = $1 AND p.inclus_dans_cout = 1
          GROUP BY d.id_ligne_frais, p.libelle, p.methode_repartition, d.methode_repartition, d.montant_dhs
         HAVING abs(d.montant_dhs - COALESCE(sum(r.montant_alloue_dhs), 0)) > 0.001",
    )
    .bind(id_dossier)
    .fetch_all(&mut *tx)
    .await?;
    if !non_repartis.is_empty() {
        let liste: Vec<String> = non_repartis.iter().map(|(l, m)| format!("{l} ({m} DH)")).collect();
        return Err(AppError::RegleMetier(format!(
            "Frais non réparti(s) : {}. Vérifiez leurs lignes ciblées, ou complétez la répartition manuelle (onglet Liquidation).",
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

    // UNE CLOTURE QUI SUIT UNE DEVALIDATION n'ajoute que la DIFFERENCE. Le
    // journal garde ce que les clotures precedentes ont deja porte au CUMP ;
    // reprendre le total ajouterait les memes frais une seconde fois.
    let deja: HashMap<String, i64> = sqlx::query_as::<_, (String, i64)>(
        "SELECT code_reference, (sum(montant_dhs) * 100)::bigint
           FROM import_ajustements_cump WHERE id_dossier = $1 AND origine = 'FRAIS'
          GROUP BY code_reference",
    )
    .bind(id_dossier)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .collect();
    let references: Vec<(String, i64, f64)> = references
        .into_iter()
        .map(|(r, f, q)| {
            let d = deja.get(&r).copied().unwrap_or(0);
            (r, f - d, q)
        })
        .collect();

    let horodatage = maintenant();
    let (detail, total_stock_c, total_consomme_c) =
        porter(tx, user, id_dossier, &references, "FRAIS", None, None, &horodatage).await?;

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

    let _ = (simuler, &horodatage);
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
