//! LA VALORISATION EN DEUX TEMPS D'UNE RECEPTION LOCALE (regle 6, 08/10/2026).
//!
//! A la validation, la marchandise entre au PRIX DU BON : c'est une valeur
//! PROVISOIRE. La facture du fournisseur arrive ensuite, avec ses frais :
//! c'est la valeur DEFINITIVE. La cloture de la reception porte la difference,
//! a la maniere SAP :
//!
//!   * au STOCK ENCORE PRESENT DE CETTE RECEPTION — ses lots, la ou ils sont
//!     (audit v4 : la difference allait a tout le stock de la reference, tous
//!     magasins confondus ; 1 968 MAD d'une reception de Morocco finissaient a
//!     Polyfashions). Sans lot, le magasin ou la reception est entree. Le CMUP
//!     du magasin en tient compte ;
//!   * en ECART DE PRIX pour la part des kilos deja sortis : elle est TRACEE,
//!     pas reinjectee dans le CMUP — on ne revalorise pas un tapis deja tisse.
//!
//! LA FACTURE EST DANS LA DEVISE DU BON (decision 4 de l'audit v4), convertie
//! au cours Bank Al-Maghrib de sa date — le controle est celui des factures
//! d'import. UNE FACTURE PEUT COUVRIR PLUSIEURS RECEPTIONS du meme
//! fournisseur : son montant se repartit entre elles au prorata de leur valeur
//! provisoire.
//!
//! Le journal `reception_ajustements_cmup` est immuable. Une reception
//! cloturee ne se contre-passe ni ne se devalide plus : sa correction passe par
//! un AVOIR (ou une facture complementaire), journalise de la meme facon, avec
//! son motif (regle 8).

use crate::auth::Utilisateur;
use crate::db::{arrondi_kg, maintenant, Db};
// Une facture plus basse que le bon fait baisser le CMUP, au meme prorata :
// la repartition est signee.
use crate::domain::importation::{repartir_centimes, repartir_signe};
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use sqlx::PgConnection;

/// LA DEVISE D'UNE RECEPTION : CELLE DE SES LIGNES.
///
/// Elle se lisait sur le bon de l'EN-TETE. Depuis que la reception est un
/// arrivage (ADR-003 phase A), cet en-tete n'a souvent aucun bon — un camion
/// qui en couvre deux n'en designe aucun —, et la lecture retombait alors sur
/// la devise du FOURNISSEUR : un conteneur paye en dollars se facturait en
/// dirhams, au taux 1. Chaque ligne, elle, tient sa devise de sa ligne de bon ;
/// c'est la seule verite.
///
/// Repli, dans l'ordre : le bon de l'en-tete (reception encore sans ligne),
/// la devise du fournisseur, le dirham.
///
/// Expression partagee avec `cloturer`, pour que les deux ne divergent jamais.
const DEVISE_DE_LA_RECEPTION: &str = "COALESCE(
         (SELECT CASE WHEN count(DISTINCT lr.code_devise) = 1 THEN min(lr.code_devise) END
            FROM ligne_reception lr WHERE lr.id_reception = r.id_reception),
         bc.code_devise, fo.code_devise, 'MAD')";

/// La devise dans laquelle une reception se facture (cf. `DEVISE_DE_LA_RECEPTION`).
///
/// UN ARRIVAGE A PLUSIEURS DEVISES NE SE CLOTURE PAS D'UN BLOC : un conteneur
/// qui porte un bon en dollars et un bon en euros se facture par deux factures,
/// et les melanger au prorata donnerait une valeur fausse au stock. On le dit
/// plutot que de choisir une devise au hasard.
pub async fn devise_reception(c: &mut PgConnection, id_reception: &str) -> AppResult<String> {
    let (devise, devises): (String, Option<String>) = sqlx::query_as(&format!(
        "SELECT {DEVISE_DE_LA_RECEPTION},
                (SELECT string_agg(DISTINCT lr.code_devise, ', ')
                   FROM ligne_reception lr WHERE lr.id_reception = r.id_reception
                  HAVING count(DISTINCT lr.code_devise) > 1)
           FROM reception r
           LEFT JOIN bon_commande bc ON bc.id_bc = r.id_bc
           LEFT JOIN fournisseur fo ON fo.code_fournisseur = r.code_fournisseur
          WHERE r.id_reception = $1"
    ))
    .bind(id_reception)
    .fetch_optional(&mut *c)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("reception {id_reception}")))?;
    if let Some(liste) = devises {
        return Err(AppError::RegleMetier(format!(
            "Cet arrivage porte des lignes en {liste} : une facture ne couvre qu'une devise. \
             Clôturez-le avec une facture par devise."
        )));
    }
    Ok(devise)
}

/// Une facture de fournisseur, deja convertie en MAD par la route (le taux y
/// est controle contre le cours Bank Al-Maghrib).
pub struct FactureLocale {
    /// Des kilos ont ete rendus au fournisseur : la facture porte-t-elle sur les
    /// seuls kilos gardes (nette, `Some(true)`) ou sur toute la livraison
    /// (brute, un avoir pour retour suivra, `Some(false)`) ? Sans retour, `None`.
    pub nette: Option<bool>,
    pub numero_facture: String,
    /// La reception d'ou la facture est saisie, puis les autres qu'elle couvre.
    pub receptions: Vec<String>,
    pub code_devise: String,
    pub montant_devise: f64,
    pub taux: f64,
    pub frais_mad: f64,
}

/// La valeur provisoire d'une reception, par reference : ce que la validation
/// a fait entrer, au prix du bon (l'archive figee de la reception).
pub(crate) async fn provisoire(c: &mut PgConnection, id_reception: &str) -> AppResult<Vec<(String, i64, f64)>> {
    Ok(sqlx::query_as(
        "SELECT a.code_reference, round(sum(a.total_mad) * 100)::bigint, sum(a.quantite_stock_kg)::float8
           FROM v_archive_reception_courante a
           JOIN ligne_reception lr ON lr.id_ligne_reception = a.id_ligne_reception
          WHERE lr.id_reception = $1
          GROUP BY a.code_reference
          ORDER BY a.code_reference",
    )
    .bind(id_reception)
    .fetch_all(&mut *c)
    .await?)
}

/// LES RETOURS FOURNISSEUR NON ENCORE SOLDES d'une reception (regle 3,
/// 09/10/2026) : (mouvement, numero, reference, kg). Un retour se solde une
/// fois, par une facture nette ou par un avoir pour retour.
pub(crate) async fn retours_non_soldes(c: &mut PgConnection, id_reception: &str) -> AppResult<Vec<(String, String, String, f64)>> {
    Ok(sqlx::query_as(
        "SELECT id_mouvement, numero_mouvement, code_reference, kg::float8
           FROM v_retours_reception
          WHERE id_reception = $1 AND NOT solde
          ORDER BY numero_mouvement, code_reference",
    )
    .bind(id_reception)
    .fetch_all(&mut *c)
    .await?)
}

/// La valeur au prix du bon des kilos rendus, par retour et par reference
/// (le prix moyen provisoire de la reference dans la reception).
pub(crate) fn valeur_retours(refs: &[(String, i64, f64)], retours: &[(String, String, String, f64)]) -> Vec<i64> {
    retours
        .iter()
        .map(|(_, _, reference, kg)| {
            refs.iter()
                .find(|(r, _, _)| r == reference)
                .filter(|(_, _, recu)| *recu > 0.0)
                .map(|(_, v, recu)| ((*v as f64) * kg / recu).round() as i64)
                .unwrap_or(0)
        })
        .collect()
}

/// Inscrit au journal les retours soldes (nature RETOUR) : par une facture
/// nette, ou par un avoir pour retour.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn solder_retours(
    c: &mut PgConnection,
    user: &Utilisateur,
    id_reception: &str,
    retours: &[(String, String, String, f64)],
    valeurs: &[i64],
    origine: &str,
    piece: &str,
    motif: &str,
) -> AppResult<()> {
    for ((id_mvt, _, reference, kg), v) in retours.iter().zip(valeurs.iter()) {
        sqlx::query(
            "INSERT INTO reception_ajustements_cmup
                    (id_reception, code_reference, nature, code_magasin, quantite_recue_kg, stock_kg,
                     montant_mad, id_utilisateur, origine, numero_piece, motif, id_mouvement_retour)
             VALUES ($1, $2, 'RETOUR', NULL, $3, 0, $4 / 100.0, $5, $6, $7, $8, $9)",
        )
        .bind(id_reception)
        .bind(reference)
        .bind(*kg)
        .bind(*v)
        .bind(&user.id)
        .bind(origine)
        .bind(piece)
        .bind(motif)
        .bind(id_mvt)
        .execute(&mut *c)
        .await?;
    }
    Ok(())
}

/// Refuse une reception dont une entree en stock a ete contre-passee : il n'y
/// a plus de marchandise a valoriser (audit v4 — la cloture lisait l'archive
/// et revalorisait un stock qui n'etait plus la).
pub(crate) async fn exiger_entrees_vivantes(c: &mut PgConnection, id_reception: &str, numero: &str) -> AppResult<()> {
    let annulees: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT lr.code_magasin_dest
           FROM ligne_reception lr
          WHERE lr.id_reception = $1
            AND NOT EXISTS (
                SELECT 1 FROM mouvement m
                 WHERE m.reference_document = $2 AND m.code_type_mvt = 'ENTREE_REC'
                   AND m.code_magasin = lr.code_magasin_dest
                   AND NOT EXISTS (SELECT 1 FROM mouvement inv
                                    WHERE inv.id_mouvement_contrepasse = m.id_mouvement))
          ORDER BY 1",
    )
    .bind(id_reception)
    .bind(numero)
    .fetch_all(&mut *c)
    .await?;
    if !annulees.is_empty() {
        return Err(AppError::RegleMetier(format!(
            "La reception {numero} a une entree en stock contre-passee ({}) : il n'y a plus de \
             marchandise a valoriser. Saisissez la facture sur la reception qui l'a remplacee.",
            annulees.join(", ")
        )));
    }
    Ok(())
}

/// LE MOTEUR : porte `difference_c` (centimes, signe) sur une reception —
/// au stock encore present de ses lots, le reste en ecart de prix — et le
/// journalise. Commun a la cloture, a l'avoir et a la facture complementaire.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn appliquer(
    c: &mut PgConnection,
    user: &Utilisateur,
    id_reception: &str,
    refs: &[(String, i64, f64)],
    difference_c: i64,
    origine: &str,
    piece: &str,
    motif: Option<&str>,
    horodatage: &str,
) -> AppResult<(Vec<Value>, i64, i64)> {
    let bases: Vec<i64> = refs.iter().map(|(_, v, _)| *v).collect();
    let parts = repartir_signe(difference_c, &bases);
    let mut detail = Vec::new();
    let mut total_stock_c: i64 = 0;
    let mut total_ecart_c: i64 = 0;

    for ((code_reference, valeur_c, recu), part_c) in refs.iter().zip(parts.iter()) {
        // OU EST ENCORE LA MARCHANDISE DE CETTE RECEPTION : ses lots, dans les
        // magasins ou ils se trouvent (un transfert les suit) ; sans lot, le
        // magasin d'entree, a hauteur de ce qui y est entre.
        let stocks: Vec<(String, f64, Option<f64>, f64)> = sqlx::query_as(
            "WITH lots AS (
                 SELECT DISTINCT btrim(lot_fournisseur) AS lot FROM ligne_reception
                  WHERE id_reception = $1 AND code_reference = $2
                    AND COALESCE(btrim(lot_fournisseur), '') <> ''
             ), recu_mag AS (
                 SELECT code_magasin_dest AS code_magasin, sum(quantite_stock_kg) AS kg
                   FROM ligne_reception WHERE id_reception = $1 AND code_reference = $2
                  GROUP BY code_magasin_dest
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
        .bind(id_reception)
        .bind(code_reference)
        .fetch_all(&mut *c)
        .await?;
        let present: f64 = stocks.iter().map(|(_, _, _, p)| p).sum();
        let stock_c: i64 = if *recu > 0.0 {
            ((*part_c as f64) * present.min(*recu) / recu).round() as i64
        } else {
            0
        };
        let mut stock_c = stock_c;
        let mut ecart_c = part_c - stock_c;

        let poids: Vec<i64> = stocks.iter().map(|(_, _, _, p)| (p * 10_000.0).round() as i64).collect();
        let parts_mag = repartir_signe(stock_c, &poids);
        let mut magasins = Vec::new();
        for ((magasin, q, cmup, p), p_c) in stocks.iter().zip(parts_mag.iter()) {
            let avant = cmup.unwrap_or(0.0);
            // LE CMUP NE PASSE JAMAIS SOUS ZERO (U6, 09/10/2026). Un avoir plus
            // gros que la valeur du stock restant ramenait le CMUP a zero en
            // silence, alors que le journal gardait le montant entier. Le stock
            // porte ce qu'il peut ; le reste va en ecart de prix, journalise.
            let plancher_c = -((avant * q * 100.0).round() as i64);
            let p_c = if *p_c < plancher_c {
                let reste = *p_c - plancher_c;
                stock_c -= reste;
                ecart_c += reste;
                plancher_c
            } else {
                *p_c
            };
            // Le CMUP est celui du MAGASIN : la valeur ajoutee se divise par
            // tout ce qu'il porte de la reference.
            let apres = arrondi_kg((avant + (p_c as f64 / 100.0) / q).max(0.0));
            sqlx::query("UPDATE stock_magasin SET cmup_mad = $3, date_maj = fn_instant($4) WHERE code_reference = $1 AND code_magasin = $2")
                .bind(code_reference)
                .bind(magasin)
                .bind(apres)
                .bind(horodatage)
                .execute(&mut *c)
                .await?;
            sqlx::query(
                "INSERT INTO reception_ajustements_cmup
                        (id_reception, code_reference, nature, code_magasin, quantite_recue_kg,
                         stock_kg, cmup_avant, cmup_apres, montant_mad, id_utilisateur,
                         origine, numero_piece, motif)
                 VALUES ($1, $2, 'STOCK', $3, $4, $5, $6, $7, $8 / 100.0, $9, $10, $11, $12)",
            )
            .bind(id_reception)
            .bind(code_reference)
            .bind(magasin)
            .bind(*recu)
            .bind(*p)
            .bind(*cmup)
            .bind(apres)
            .bind(p_c)
            .bind(&user.id)
            .bind(origine)
            .bind(piece)
            .bind(motif)
            .execute(&mut *c)
            .await?;
            magasins.push(json!({
                "code_magasin": magasin, "stock_kg": arrondi_kg(*p), "cmup_avant": cmup, "cmup_apres": apres,
            }));
        }
        sqlx::query(
            "INSERT INTO reception_ajustements_cmup
                    (id_reception, code_reference, nature, code_magasin, quantite_recue_kg,
                     stock_kg, montant_mad, id_utilisateur, origine, numero_piece, motif)
             VALUES ($1, $2, 'ECART_PRIX', NULL, $3, $4, $5 / 100.0, $6, $7, $8, $9)",
        )
        .bind(id_reception)
        .bind(code_reference)
        .bind(*recu)
        .bind(present)
        .bind(ecart_c)
        .bind(&user.id)
        .bind(origine)
        .bind(piece)
        .bind(motif)
        .execute(&mut *c)
        .await?;
        if !stocks.is_empty() {
            sqlx::query(
                "UPDATE reference
                    SET cmup_mad = (SELECT round(SUM(sm.quantite_kg * sm.cmup_mad) / SUM(sm.quantite_kg), 4)
                                      FROM stock_magasin sm
                                     WHERE sm.code_reference = $1 AND sm.quantite_kg > 0
                                       AND sm.cmup_mad IS NOT NULL),
                        date_dernier_cmup = fn_instant($2)
                  WHERE code_reference = $1",
            )
            .bind(code_reference)
            .bind(horodatage)
            .execute(&mut *c)
            .await?;
        }
        total_stock_c += stock_c;
        total_ecart_c += ecart_c;
        detail.push(json!({
            "code_reference": code_reference,
            "valeur_provisoire_mad": *valeur_c as f64 / 100.0,
            "difference_mad": *part_c as f64 / 100.0,
            "recu_kg": recu,
            "stock_kg": arrondi_kg(present),
            "au_stock_mad": stock_c as f64 / 100.0,
            "ecart_prix_mad": ecart_c as f64 / 100.0,
            "magasins": magasins,
        }));
    }
    Ok((detail, total_stock_c, total_ecart_c))
}

/// Le seuil de l'avis d'ecart, en % de la valeur provisoire.
pub(crate) async fn seuil_avis_pct(c: &mut PgConnection) -> AppResult<f64> {
    let v: Option<f64> = sqlx::query_scalar(
        "SELECT CAST(valeur_courante AS float8) FROM parametre WHERE code_parametre = 'P_ClotureEcartAvisPct'",
    )
    .fetch_optional(&mut *c)
    .await?;
    Ok(v.filter(|x| *x > 0.0).unwrap_or(10.0))
}

/// L'AVIS, PAS LE REFUS : une facture tres loin du bon se signale avant de
/// signer (une virgule deplacee, une facture d'un autre camion), elle ne se
/// bloque pas — l'ecart peut etre reel.
pub(crate) fn avis_ecart(numero: &str, provisoire_c: i64, difference_c: i64, seuil: f64) -> Option<String> {
    if provisoire_c <= 0 {
        return None;
    }
    let pct = difference_c as f64 * 100.0 / provisoire_c as f64;
    (pct.abs() > seuil).then(|| {
        format!(
            "{numero} : la facture s'ecarte de {pct:+.1} % de la valeur au prix du bon (seuil {seuil} %). \
             Verifiez le montant, la devise et la facture avant de cloturer."
        )
    })
}

pub async fn cloturer(db: &Db, user: &Utilisateur, f: &FactureLocale, simuler: bool) -> AppResult<Value> {
    let numero_facture = f.numero_facture.trim();
    if numero_facture.is_empty() {
        return Err(AppError::Invalide("Le numero de la facture est obligatoire.".into()));
    }
    if !(f.montant_devise > 0.0) || !(f.taux > 0.0) || f.frais_mad < 0.0 {
        return Err(AppError::Invalide(
            "Le montant de la facture doit etre positif, les frais nuls ou positifs.".into(),
        ));
    }
    let mut ids: Vec<String> = Vec::new();
    for id in &f.receptions {
        if !ids.contains(id) {
            ids.push(id.clone());
        }
    }
    if ids.is_empty() {
        return Err(AppError::Invalide("Aucune reception a cloturer.".into()));
    }

    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let entetes: Vec<(String, String, String, String, String)> = sqlx::query_as(&format!(
        // La devise vient des LIGNES (cf. DEVISE_DE_LA_RECEPTION) : sur un
        // arrivage qui couvre deux bons, l'en-tete n'en designe aucun.
        "SELECT r.id_reception, r.numero_reception, r.statut, r.code_fournisseur,
                {DEVISE_DE_LA_RECEPTION}
           FROM reception r
           LEFT JOIN bon_commande bc ON bc.id_bc = r.id_bc
           LEFT JOIN fournisseur fo ON fo.code_fournisseur = r.code_fournisseur
          WHERE r.id_reception = ANY($1)
          ORDER BY r.numero_reception
            FOR UPDATE OF r"
    ))
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?;
    if entetes.len() != ids.len() {
        return Err(AppError::Introuvable("une des receptions de la facture".into()));
    }
    let fournisseur = &entetes[0].3;
    for (_, numero, statut, frs, devise) in &entetes {
        if statut != "VALIDE" {
            return Err(AppError::RegleMetier(format!(
                "La reception {numero} est {statut} : seule une reception validee se cloture avec sa facture."
            )));
        }
        if frs != fournisseur {
            return Err(AppError::RegleMetier(format!(
                "La reception {numero} vient d'un autre fournisseur : une facture ne couvre que les \
                 receptions de son fournisseur."
            )));
        }
        if *devise != f.code_devise {
            return Err(AppError::RegleMetier(format!(
                "La reception {numero} se facture en {devise}, la facture est en {} : une facture ne \
                 couvre que des receptions de sa devise.",
                f.code_devise
            )));
        }
    }

    // Les valeurs provisoires, reception par reception.
    let mut valeurs = Vec::new();
    let mut retours_a_solder = Vec::new();
    for (id, numero, ..) in &entetes {
        exiger_entrees_vivantes(&mut tx, id, numero).await?;
        let mut refs = provisoire(&mut tx, id).await?;
        if refs.is_empty() {
            return Err(AppError::RegleMetier(format!("La reception {numero} n'a fait entrer aucune ligne.")));
        }
        // LES KILOS RENDUS AU FOURNISSEUR (regle 3, 09/10/2026) : leur valeur est
        // deja sortie du stock. Une facture NETTE ne les porte pas : on la compare
        // a la valeur provisoire diminuee des retours, qui sont alors soldes. Une
        // facture BRUTE les porte : un avoir pour retour les soldera.
        let retours = retours_non_soldes(&mut tx, id).await?;
        if !retours.is_empty() {
            let liste: Vec<String> =
                retours.iter().map(|(_, n, r, kg)| format!("{n} {r} {} kg", arrondi_kg(*kg))).collect();
            match f.nette {
                None => {
                    return Err(AppError::RegleMetier(format!(
                        "RETOURS : des kilos de la reception {numero} ont ete rendus au fournisseur ({}). \
                         Dites si la facture porte sur les seuls kilos gardes (facture nette) ou sur toute \
                         la livraison (facture brute : un avoir pour retour suivra).",
                        liste.join(", ")
                    )));
                }
                Some(true) => {
                    let vals = valeur_retours(&refs, &retours);
                    for ((_, _, reference, kg), v) in retours.iter().zip(vals.iter()) {
                        if let Some(r) = refs.iter_mut().find(|(rf, _, _)| rf == reference) {
                            r.1 -= v;
                            r.2 = (r.2 - kg).max(0.0);
                        }
                    }
                    retours_a_solder.push((id.clone(), retours, vals));
                }
                Some(false) => {}
            }
        }
        let total: i64 = refs.iter().map(|(_, v, _)| v).sum();
        valeurs.push((id.clone(), numero.clone(), refs, total));
    }
    let bases: Vec<i64> = valeurs.iter().map(|v| v.3.max(0)).collect();
    if bases.iter().all(|b| *b == 0) && valeurs.len() > 1 {
        return Err(AppError::RegleMetier(
            "Ces receptions n'ont aucune valeur provisoire : la facture ne peut pas se repartir.".into(),
        ));
    }
    let montant_mad = f.montant_devise * f.taux;
    let montant_c = (montant_mad * 100.0).round() as i64;
    let frais_c = (f.frais_mad * 100.0).round() as i64;
    let devise_c = (f.montant_devise * 100.0).round() as i64;
    let (parts_montant, parts_frais, parts_devise) = if valeurs.len() == 1 {
        (vec![montant_c], vec![frais_c], vec![devise_c])
    } else {
        (
            repartir_centimes(montant_c, &bases),
            repartir_centimes(frais_c, &bases),
            repartir_centimes(devise_c, &bases),
        )
    };

    let horodatage = maintenant();
    let seuil = seuil_avis_pct(&mut tx).await?;
    let mut avis = Vec::new();
    let mut par_reception = Vec::new();
    let mut tout_detail = Vec::new();
    let (mut prov_tot, mut def_tot, mut stock_tot, mut ecart_tot) = (0i64, 0i64, 0i64, 0i64);
    // Les frais d'approche saisis sur les arrivages, portes au CUMP par cette
    // cloture : distincts du `frais_mad` tape sur la facture, qui est ce que la
    // FACTURE porte elle-meme.
    let mut frais_arrivage_tot: i64 = 0;

    for (i, (id, numero, refs, prov_c)) in valeurs.iter().enumerate() {
        let definitif_c = parts_montant[i] + parts_frais[i];
        let difference_c = definitif_c - prov_c;
        let (detail, stock_c, ecart_c) =
            appliquer(&mut tx, user, id, refs, difference_c, "CLOTURE", numero_facture, None, &horodatage).await?;
        avis.extend(avis_ecart(numero, *prov_c, difference_c, seuil));
        sqlx::query(
            "UPDATE reception
                SET statut = 'CLOTURE', numero_facture = $2, montant_facture_mad = $3, frais_facture_mad = $4,
                    code_devise_facture = $5, montant_facture_devise = $6, taux_facture = $7,
                    date_cloture = fn_instant($8), id_utilisateur_cloture = $9
              WHERE id_reception = $1",
        )
        .bind(id)
        .bind(numero_facture)
        .bind(parts_montant[i] as f64 / 100.0)
        .bind(parts_frais[i] as f64 / 100.0)
        .bind(&f.code_devise)
        .bind(parts_devise[i] as f64 / 100.0)
        .bind(f.taux)
        .bind(&horodatage)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;
        par_reception.push(json!({
            "id_reception": id,
            "numero_reception": numero,
            "valeur_provisoire_mad": *prov_c as f64 / 100.0,
            "valeur_definitive_mad": definitif_c as f64 / 100.0,
            "difference_mad": difference_c as f64 / 100.0,
            "au_stock_mad": stock_c as f64 / 100.0,
            "ecart_prix_mad": ecart_c as f64 / 100.0,
        }));
        for mut d in detail {
            d["numero_reception"] = json!(numero);
            tout_detail.push(d);
        }

        // ---- LES FRAIS D'APPROCHE DE L'ARRIVAGE (ADR-003 phase C) ----------
        //
        // CHACUN SELON SA PROPRE CLE. Un fret se repartit au POIDS, une
        // assurance a la VALEUR, une manutention en PARTS EGALES. Les fondre
        // dans le total de la facture les aurait tous repartis a la valeur : la
        // matiere chere aurait porte le transport de la matiere lourde.
        //
        // La base change, le moteur ne change pas : `appliquer` repartit au
        // prorata de ce qu'on lui donne, puis porte au stock encore present et
        // trace le reste en ecart de prix, exactement comme pour la facture.
        let frais_arrivage: Vec<(String, String, String, f64)> = sqlx::query_as(
            "SELECT id_frais, type_frais, cle_repartition, montant_mad::float8
               FROM frais_approche
              WHERE id_reception = $1 AND date_portee IS NULL
              ORDER BY date_frais, type_frais
                FOR UPDATE",
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await?;
        let mut frais_c: i64 = 0;
        for (id_frais, type_frais, cle, montant) in &frais_arrivage {
            let montant_c = (montant * 100.0).round() as i64;
            if montant_c != 0 {
                let bases: Vec<(String, i64, f64)> = match cle.as_str() {
                    // Le poids en dixiemes de gramme : la repartition travaille
                    // en entiers, et arrondir au kilo perdrait les petites
                    // lignes d'un arrivage qui en compte beaucoup.
                    "POIDS" => refs
                        .iter()
                        .map(|(r, _, kg)| (r.clone(), (kg * 10_000.0).round() as i64, *kg))
                        .collect(),
                    "LIGNES" => refs.iter().map(|(r, _, kg)| (r.clone(), 1, *kg)).collect(),
                    _ => refs.clone(),
                };
                let motif = format!("Frais {type_frais} de l'arrivage {numero}");
                let (detail_frais, s_c, e_c) = appliquer(
                    &mut tx, user, id, &bases, montant_c, "FRAIS", numero_facture,
                    Some(&motif), &horodatage,
                )
                .await?;
                for mut d in detail_frais {
                    d["numero_reception"] = json!(numero);
                    d["origine"] = json!("FRAIS");
                    tout_detail.push(d);
                }
                frais_c += montant_c;
                stock_tot += s_c;
                ecart_tot += e_c;
            }
            // PORTE UNE FOIS. Sans cette marque, une re-cloture apres
            // devalidation ajouterait les memes frais une seconde fois.
            sqlx::query("UPDATE frais_approche SET date_portee = fn_instant($2) WHERE id_frais = $1")
                .bind(id_frais)
                .bind(&horodatage)
                .execute(&mut *tx)
                .await?;
        }
        frais_arrivage_tot += frais_c;
        if let Some(obj) = par_reception.last_mut().and_then(|v| v.as_object_mut()) {
            obj.insert("frais_arrivage_mad".into(), json!(frais_c as f64 / 100.0));
            obj.insert(
                "valeur_complete_mad".into(),
                json!((definitif_c + frais_c) as f64 / 100.0),
            );
        }

        prov_tot += prov_c;
        def_tot += definitif_c;
        stock_tot += stock_c;
        ecart_tot += ecart_c;
    }

    for (id, retours, vals) in &retours_a_solder {
        solder_retours(
            &mut tx, user, id, retours, vals, "FACTURE_NETTE", numero_facture,
            "Facture nette : les kilos rendus sont deduits de la valeur provisoire",
        )
        .await?;
    }

    let resultat = json!({
        "id_reception": ids[0],
        "numero_reception": valeurs.iter().find(|v| v.0 == ids[0]).map(|v| v.1.clone()),
        "simulation": simuler,
        "code_devise": f.code_devise,
        "montant_devise": f.montant_devise,
        "taux_change": f.taux,
        "valeur_provisoire_mad": prov_tot as f64 / 100.0,
        "valeur_definitive_mad": def_tot as f64 / 100.0,
        "difference_mad": (def_tot - prov_tot) as f64 / 100.0,
        // LE COUT DE REVIENT COMPLET (ADR-003 phase C) : la marchandise de la
        // facture, plus les frais d'approche de l'arrivage.
        "frais_arrivage_mad": frais_arrivage_tot as f64 / 100.0,
        "valeur_complete_mad": (def_tot + frais_arrivage_tot) as f64 / 100.0,
        "au_stock_mad": stock_tot as f64 / 100.0,
        "ecart_prix_mad": ecart_tot as f64 / 100.0,
        "receptions": par_reception,
        "references": tout_detail,
        "avis": avis,
    });
    if simuler {
        tx.rollback().await?;
    } else {
        tx.commit().await?;
    }
    Ok(resultat)
}

/// AVOIR OU FACTURE COMPLEMENTAIRE SUR UNE RECEPTION CLOTUREE (regle 8,
/// audit v4). Les messages renvoyaient a « un avoir » qui n'existait pas : une
/// facture mal saisie ne se corrigeait plus. Le montant (en MAD, positif) fait
/// baisser (AVOIR) ou monter (COMPLEMENT) la valeur, par le meme moteur que la
/// cloture, et se journalise avec son numero de piece et son motif.
#[allow(clippy::too_many_arguments)]
pub async fn corriger(
    db: &Db,
    user: &Utilisateur,
    id_reception: &str,
    nature: &str,
    numero_piece: &str,
    montant_mad: f64,
    motif: &str,
    code_reference: Option<&str>,
    simuler: bool,
) -> AppResult<Value> {
    // LE TYPE DE L'AVOIR EST OBLIGATOIRE (regle 3, 09/10/2026) : un avoir de PRIX
    // (la marchandise reste en stock : son CMUP baisse) n'est pas un avoir POUR
    // RETOUR (la marchandise est deja sortie : rien ne change au CMUP).
    let signe: i64 = match nature {
        "AVOIR" | "AVOIR_RETOUR" => -1,
        "COMPLEMENT" => 1,
        autre => {
            return Err(AppError::Invalide(format!(
                "nature inconnue : {autre} (AVOIR de prix, AVOIR_RETOUR ou COMPLEMENT)"
            )))
        }
    };
    let numero_piece = numero_piece.trim();
    let motif = motif.trim();
    if numero_piece.is_empty() {
        return Err(AppError::Invalide("Le numero de la piece (avoir, facture) est obligatoire.".into()));
    }
    if motif.chars().count() < 5 {
        return Err(AppError::Invalide("Le motif est obligatoire : dites en quelques mots ce qui est corrige.".into()));
    }
    if !(montant_mad > 0.0) {
        return Err(AppError::Invalide("Le montant doit etre positif.".into()));
    }

    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let (numero, statut): (String, String) = sqlx::query_as(
        "SELECT numero_reception, statut FROM reception WHERE id_reception = $1 FOR UPDATE",
    )
    .bind(id_reception)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("reception {id_reception}")))?;
    if statut != "CLOTURE" {
        return Err(AppError::RegleMetier(format!(
            "La reception {numero} est {statut} : un avoir corrige une reception deja cloturee avec sa facture. \
             Avant, c'est la cloture qui porte le montant de la facture."
        )));
    }
    let mut refs = provisoire(&mut tx, id_reception).await?;
    let horodatage = maintenant();
    if nature == "AVOIR_RETOUR" {
        // L'AVOIR POUR RETOUR SE RAPPROCHE DES RETOURS NON SOLDES : leur valeur au
        // prix du bon est deja sortie du stock. Rien ne change au CMUP ; la
        // difference entre l'avoir et cette valeur est un ecart de prix.
        let retours = retours_non_soldes(&mut tx, id_reception).await?;
        if retours.is_empty() {
            return Err(AppError::RegleMetier(format!(
                "La reception {numero} n'a aucun retour fournisseur non solde : un avoir pour retour se \
                 rapproche d'un retour (saisi en « Retour fournisseur » sur cette reception). Pour une \
                 remise ou une erreur de prix, c'est un avoir de prix."
            )));
        }
        let vals = valeur_retours(&refs, &retours);
        let couvert_c: i64 = vals.iter().sum();
        let montant_c = (montant_mad * 100.0).round() as i64;
        // Signe : le fournisseur credite plus que la valeur rendue -> gain (negatif).
        let ecart_total_c = couvert_c - montant_c;
        solder_retours(&mut tx, user, id_reception, &retours, &vals, "AVOIR_RETOUR", numero_piece, motif).await?;
        let refs_retour: Vec<String> = retours.iter().map(|r| r.2.clone()).collect();
        let bases: Vec<i64> = refs
            .iter()
            .filter(|(r, _, _)| refs_retour.contains(r))
            .map(|(_, v, _)| (*v).max(1))
            .collect();
        let parts = repartir_signe(ecart_total_c, &bases);
        let mut detail = Vec::new();
        for ((reference, _, recu), part) in
            refs.iter().filter(|(r, _, _)| refs_retour.contains(r)).zip(parts.iter())
        {
            sqlx::query(
                "INSERT INTO reception_ajustements_cmup
                        (id_reception, code_reference, nature, code_magasin, quantite_recue_kg, stock_kg,
                         montant_mad, id_utilisateur, origine, numero_piece, motif)
                 VALUES ($1, $2, 'ECART_PRIX', NULL, $3, 0, $4 / 100.0, $5, 'AVOIR_RETOUR', $6, $7)",
            )
            .bind(id_reception)
            .bind(reference)
            .bind(*recu)
            .bind(*part)
            .bind(&user.id)
            .bind(numero_piece)
            .bind(motif)
            .execute(&mut *tx)
            .await?;
            detail.push(json!({ "code_reference": reference, "ecart_prix_mad": *part as f64 / 100.0 }));
        }
        let resultat = json!({
            "id_reception": id_reception,
            "numero_reception": numero,
            "simulation": simuler,
            "nature": nature,
            "numero_piece": numero_piece,
            "retours": retours.iter().map(|(_, n, r, kg)| json!({"numero_mouvement": n, "code_reference": r, "kg": kg}))
                .collect::<Vec<_>>(),
            "valeur_retours_mad": couvert_c as f64 / 100.0,
            "difference_mad": 0.0,
            "au_stock_mad": 0.0,
            "ecart_prix_mad": ecart_total_c as f64 / 100.0,
            "references": detail,
        });
        if simuler {
            tx.rollback().await?;
        } else {
            tx.commit().await?;
        }
        return Ok(resultat);
    }
    // UN AVOIR PEUT VISER UNE REFERENCE (U6) : il se repartissait sur toutes les
    // lignes de la reception.
    if let Some(cible) = code_reference.map(str::trim).filter(|c| !c.is_empty()) {
        refs.retain(|(r, _, _)| r == cible);
        if refs.is_empty() {
            return Err(AppError::Invalide(format!("{cible} n'est pas une reference de la reception {numero}.")));
        }
    }
    let difference_c = signe * (montant_mad * 100.0).round() as i64;
    let (detail, stock_c, ecart_c) =
        appliquer(&mut tx, user, id_reception, &refs, difference_c, nature, numero_piece, Some(motif), &horodatage)
            .await?;
    let resultat = json!({
        "id_reception": id_reception,
        "numero_reception": numero,
        "simulation": simuler,
        "nature": nature,
        "numero_piece": numero_piece,
        "difference_mad": difference_c as f64 / 100.0,
        "au_stock_mad": stock_c as f64 / 100.0,
        "ecart_prix_mad": ecart_c as f64 / 100.0,
        "references": detail,
    });
    if simuler {
        tx.rollback().await?;
    } else {
        tx.commit().await?;
    }
    Ok(resultat)
}

#[cfg(test)]
mod tests {
    use super::{avis_ecart, repartir_signe};

    #[test]
    fn une_facture_plus_basse_se_repartit_en_negatif() {
        let p = repartir_signe(-1001, &[100, 200, 700]);
        assert_eq!(p.iter().sum::<i64>(), -1001);
        assert!(p.iter().all(|x| *x <= 0));
        assert_eq!(repartir_signe(0, &[1, 2]), vec![0, 0]);
    }

    #[test]
    fn l_avis_se_leve_au_dela_du_seuil_dans_les_deux_sens() {
        assert!(avis_ecart("REC-1", 100_000, 9_000, 10.0).is_none());
        assert!(avis_ecart("REC-1", 100_000, 11_000, 10.0).is_some());
        assert!(avis_ecart("REC-1", 100_000, -11_000, 10.0).is_some());
        assert!(avis_ecart("REC-1", 0, 5_000, 10.0).is_none());
    }
}
