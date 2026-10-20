//! LA FACTURE FOURNISSEUR COMME DOCUMENT (ADR-003 phase B, 14/10/2026).
//!
//! Jusqu'ici la facture n'existait pas : c'etait un FORMULAIRE accroche a une
//! reception — un numero, un montant, des frais — et sa validation cloturait.
//! Le moteur de valorisation, lui, etait deja bon : il couvre plusieurs
//! receptions, repartit, porte au stock encore present et trace l'ecart de prix
//! hors CUMP. Rien de cela ne change ici ; c'est le MEME moteur
//! (`facture_locale::appliquer`), appele autrement.
//!
//! CE QUE LE DOCUMENT APPORTE :
//!
//!   * DES LIGNES. Chacune pege a une ligne de reception, donc — par elle — a la
//!     ligne de bon (le prix ENGAGE) et a l'arrivage (les kilos PESES). Une
//!     facture couvre ainsi plusieurs receptions ET plusieurs bons de commande
//!     (decision du 14/10 : c'est rare, mais reel) sans rien avoir a declarer.
//!
//!   * LE RAPPROCHEMENT 3-WAY, ligne par ligne : quantite facturee contre
//!     quantite pesee, prix facture contre prix engage. Les deux ecarts ne
//!     disent pas la meme chose — la quantite met en cause la livraison ou la
//!     facture, le prix met en cause la negociation ou la saisie — et aucun ne
//!     bloque : un ecart peut etre reel. Seule la DOUBLE FACTURATION se refuse
//!     sec, en base.
//!
//!   * L'ECART DE PRIX EXACT, PAR REFERENCE. L'ancienne saisie ne connaissait
//!     qu'un total : elle repartissait la difference au prorata de la valeur
//!     provisoire, ce qui etalait sur toutes les references l'ecart d'une
//!     seule. Avec des lignes, l'ecart de chaque reference est CONNU — c'est
//!     lui qu'on porte. Plus juste, et surtout verifiable : le rapprochement
//!     affiche a l'ecran est exactement ce qui bougera le CUMP.
//!
//! UNE REFERENCE SE FACTURE D'UN BLOC. Une facture peut ne couvrir qu'une
//! partie des references d'un arrivage (le reste suivra sur une autre facture),
//! mais pas une partie des kilos d'une reference : la valeur provisoire et les
//! lots se tiennent par reference, et comparer un demi-lot a une facture
//! entiere donnerait un CUMP faux sans que rien ne le dise.
//!
//! LA RECEPTION NE SE CLOTURE QUE QUAND TOUT EST FACTURE. Une facture partielle
//! porte sa part au CUMP et laisse l'arrivage VALIDE : il attend le reste.

use std::collections::HashMap;

use crate::auth::Utilisateur;
use crate::db::{arrondi_kg, maintenant, Db};
use crate::domain::facture_locale::{
    appliquer, avis_ecart, exiger_entrees_vivantes, provisoire, retours_non_soldes, seuil_avis_pct,
    solder_retours, valeur_retours,
};
use crate::domain::importation::repartir_centimes;
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};

/// Une ligne de la facture, relue avec ce qu'elle facture.
struct LigneLue {
    id_reception: String,
    numero_reception: String,
    code_reference: String,
    /// Le montant de la ligne dans la devise de la facture, net de remise.
    montant_devise: f64,
    quantite_facturee_kg: f64,
    quantite_pesee_kg: f64,
}

/// L'en-tete de la facture, verrouille.
struct EnteteFacture {
    numero_facture: String,
    code_fournisseur: String,
    statut: String,
    code_devise: String,
    taux_change: f64,
    montant_devise: Option<f64>,
    frais_devise: f64,
    facture_nette: Option<i16>,
}

/// VALIDER LA FACTURE, C'EST LA CLOTURE.
///
/// `simuler` rend l'apercu sans rien ecrire : on voit ce que le CUMP va faire
/// avant de signer. C'est la meme transaction, annulee a la fin.
pub async fn valider(db: &Db, user: &Utilisateur, id_facture: &str, simuler: bool) -> AppResult<Value> {
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let e: EnteteFacture = sqlx::query_as(
        "SELECT numero_facture, code_fournisseur, statut, code_devise,
                taux_change::float8, montant_devise::float8, frais_devise::float8, facture_nette
           FROM facture_fournisseur WHERE id_facture = $1 FOR UPDATE",
    )
    .bind(id_facture)
    .fetch_optional(&mut *tx)
    .await?
    .map(|(numero_facture, code_fournisseur, statut, code_devise, taux_change, montant_devise, frais_devise, facture_nette): (
        String, String, String, String, f64, Option<f64>, f64, Option<i16>,
    )| EnteteFacture {
        numero_facture,
        code_fournisseur,
        statut,
        code_devise,
        taux_change,
        montant_devise,
        frais_devise,
        facture_nette,
    })
    .ok_or_else(|| AppError::Introuvable(format!("facture {id_facture}")))?;

    if e.statut != "BROUILLON" {
        return Err(AppError::RegleMetier(format!(
            "La facture {} est {} : seule une facture en brouillon se valide.",
            e.numero_facture, e.statut
        )));
    }

    // ---- 1. Les lignes, et ce qu'elles facturent ---------------------------
    let lignes: Vec<LigneLue> = sqlx::query_as(
        "SELECT lr.id_reception, r.numero_reception, lr.code_reference,
                l.montant_devise::float8, l.quantite_facturee_kg::float8,
                lr.quantite_stock_kg::float8
           FROM ligne_facture_fournisseur l
           JOIN ligne_reception lr ON lr.id_ligne_reception = l.id_ligne_reception
           JOIN reception r ON r.id_reception = lr.id_reception
          WHERE l.id_facture = $1
          ORDER BY r.numero_reception, lr.code_reference, l.ligne_numero",
    )
    .bind(id_facture)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .map(
        |(id_reception, numero_reception, code_reference, montant_devise, quantite_facturee_kg, quantite_pesee_kg): (
            String, String, String, f64, f64, f64,
        )| LigneLue {
            id_reception,
            numero_reception,
            code_reference,
            montant_devise,
            quantite_facturee_kg,
            quantite_pesee_kg,
        },
    )
    .collect();

    if lignes.is_empty() {
        return Err(AppError::RegleMetier(format!(
            "La facture {} ne porte aucune ligne : il n'y a rien a valoriser.",
            e.numero_facture
        )));
    }

    // ---- 2. Les receptions couvertes, verrouillees -------------------------
    let mut receptions: Vec<(String, String)> = Vec::new();
    for l in &lignes {
        if !receptions.iter().any(|(id, _)| *id == l.id_reception) {
            receptions.push((l.id_reception.clone(), l.numero_reception.clone()));
        }
    }
    let ids: Vec<String> = receptions.iter().map(|(id, _)| id.clone()).collect();
    let statuts: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id_reception, numero_reception, statut FROM reception
          WHERE id_reception = ANY($1) ORDER BY numero_reception FOR UPDATE",
    )
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?;
    for (_, numero, statut) in &statuts {
        if statut != "VALIDE" {
            return Err(AppError::RegleMetier(format!(
                "La reception {numero} est {statut} : seule une reception validee se facture."
            )));
        }
    }

    // ---- 3. UNE REFERENCE SE FACTURE D'UN BLOC -----------------------------
    // Sinon la valeur provisoire et les lots, qui se tiennent par reference, ne
    // se comparent plus a rien de comparable.
    // CE QUI COMPTE, C'EST L'ENSEMBLE DES FACTURES VIVANTES, pas seulement
    // celle-ci : une reference dont la premiere moitie est deja facturee par
    // une autre facture est complete quand celle-ci porte la seconde.
    let partielles: Vec<(String, String, f64, f64)> = sqlx::query_as(
        "SELECT r.numero_reception, lr.code_reference,
                sum(lr.quantite_stock_kg)::float8,
                sum(CASE WHEN f.id_facture IS NULL THEN 0 ELSE lr.quantite_stock_kg END)::float8
           FROM ligne_reception lr
           JOIN reception r ON r.id_reception = lr.id_reception
           LEFT JOIN (SELECT l.id_ligne_reception, l.id_facture
                        FROM ligne_facture_fournisseur l
                        JOIN facture_fournisseur ff ON ff.id_facture = l.id_facture
                       WHERE ff.statut <> 'ANNULEE') f
                  ON f.id_ligne_reception = lr.id_ligne_reception
          WHERE lr.id_reception = ANY($2)
          GROUP BY r.numero_reception, lr.code_reference
          -- Seules les references que CETTE facture touche.
         HAVING count(*) FILTER (WHERE f.id_facture = $1) > 0
            AND sum(CASE WHEN f.id_facture IS NULL THEN 0 ELSE lr.quantite_stock_kg END)
                < sum(lr.quantite_stock_kg) - 0.0001
          ORDER BY r.numero_reception, lr.code_reference",
    )
    .bind(id_facture)
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?;
    if !partielles.is_empty() {
        let liste: Vec<String> = partielles
            .iter()
            .map(|(n, r, total, facture)| {
                format!("{r} ({n}) : {} kg factures sur {}", arrondi_kg(*facture), arrondi_kg(*total))
            })
            .collect();
        return Err(AppError::RegleMetier(format!(
            "FACTURE-BLOC : une reference d'un arrivage se facture d'un bloc. Ajoutez les pesees \
             manquantes a la facture, ou retirez-les : {}.",
            liste.join(" ; ")
        )));
    }

    // ---- 4. Les frais de la facture, repartis sur ses lignes ---------------
    // Ils sont PORTES PAR LA FACTURE (un transport refacture) : ils suivent la
    // valeur de ses lignes. Les frais payes a part vivent sur l'arrivage, avec
    // leur propre cle (phase C).
    let bases: Vec<i64> = lignes.iter().map(|l| (l.montant_devise * 100.0).round().max(0.0) as i64).collect();
    let frais_parts = repartir_centimes((e.frais_devise * 100.0).round() as i64, &bases);

    // Par (reception, reference) : ce que la facture dit, en centimes de MAD.
    let mut facture_par_ref: HashMap<(String, String), i64> = HashMap::new();
    let mut quantites: HashMap<(String, String), (f64, f64)> = HashMap::new();
    for (i, l) in lignes.iter().enumerate() {
        let devise_c = (l.montant_devise * 100.0).round() as i64 + frais_parts[i];
        let mad_c = ((devise_c as f64 / 100.0) * e.taux_change * 100.0).round() as i64;
        let cle = (l.id_reception.clone(), l.code_reference.clone());
        *facture_par_ref.entry(cle.clone()).or_insert(0) += mad_c;
        let q = quantites.entry(cle).or_insert((0.0, 0.0));
        q.0 += l.quantite_facturee_kg;
        q.1 += l.quantite_pesee_kg;
    }

    // ---- 5. Reception par reception : la difference, reference par reference
    let horodatage = maintenant();
    let seuil = seuil_avis_pct(&mut tx).await?;
    let mut avis: Vec<String> = Vec::new();
    let mut par_reception = Vec::new();
    let mut tout_detail: Vec<Value> = Vec::new();
    let (mut prov_tot, mut def_tot, mut stock_tot, mut ecart_tot) = (0i64, 0i64, 0i64, 0i64);
    let mut cloturees: Vec<String> = Vec::new();

    for (id, numero) in &receptions {
        exiger_entrees_vivantes(&mut tx, id, numero).await?;
        let mut refs = provisoire(&mut tx, id).await?;

        // LES KILOS RENDUS AU FOURNISSEUR (regle 3, 09/10/2026) : une facture
        // NETTE ne les porte pas — on la compare a la valeur provisoire
        // diminuee des retours, qui sont alors soldes. Une BRUTE les porte : un
        // avoir pour retour les soldera.
        let retours = retours_non_soldes(&mut tx, id).await?;
        let mut a_solder = None;
        if !retours.is_empty() {
            let liste: Vec<String> = retours
                .iter()
                .map(|(_, n, r, kg)| format!("{n} {r} {} kg", arrondi_kg(*kg)))
                .collect();
            match e.facture_nette {
                None => {
                    return Err(AppError::RegleMetier(format!(
                        "RETOURS : des kilos de la reception {numero} ont ete rendus au fournisseur ({}). \
                         Dites si la facture porte sur les seuls kilos gardes (facture nette) ou sur toute \
                         la livraison (facture brute : un avoir pour retour suivra).",
                        liste.join(", ")
                    )));
                }
                Some(1) => {
                    let vals = valeur_retours(&refs, &retours);
                    for ((_, _, reference, kg), v) in retours.iter().zip(vals.iter()) {
                        if let Some(r) = refs.iter_mut().find(|(rf, _, _)| rf == reference) {
                            r.1 -= v;
                            r.2 = (r.2 - kg).max(0.0);
                        }
                    }
                    a_solder = Some((retours.clone(), vals));
                }
                _ => {}
            }
        }

        let mut prov_rec = 0i64;
        let mut def_rec = 0i64;
        let mut detail_rec: Vec<Value> = Vec::new();
        for (code_reference, provisoire_c, recu) in &refs {
            let cle = (id.clone(), code_reference.clone());
            // Une reference de l'arrivage absente de la facture n'est PAS
            // facturee : elle garde sa valeur provisoire et attend sa facture.
            let Some(facture_c) = facture_par_ref.get(&cle).copied() else {
                continue;
            };
            let difference_c = facture_c - provisoire_c;
            prov_rec += provisoire_c;
            def_rec += facture_c;

            let (detail, stock_c, ecart_c) = appliquer(
                &mut tx,
                user,
                id,
                std::slice::from_ref(&(code_reference.clone(), *provisoire_c, *recu)),
                difference_c,
                "CLOTURE",
                &e.numero_facture,
                None,
                &horodatage,
            )
            .await?;
            stock_tot += stock_c;
            ecart_tot += ecart_c;
            let (q_fac, q_pes) = quantites.get(&cle).copied().unwrap_or((0.0, 0.0));
            for mut d in detail {
                d["numero_reception"] = json!(numero);
                d["quantite_facturee_kg"] = json!(arrondi_kg(q_fac));
                d["ecart_quantite_kg"] = json!(arrondi_kg(q_fac - q_pes));
                detail_rec.push(d);
            }
        }

        if let Some((retours, vals)) = a_solder {
            solder_retours(
                &mut tx, user, id, &retours, &vals, "FACTURE_NETTE", &e.numero_facture,
                "Facture nette : les kilos rendus sont deduits de la valeur provisoire",
            )
            .await?;
        }

        // ---- 6. L'arrivage ne se cloture que quand TOUT est facture --------
        // Par cette facture ou par une autre, deja validee : ce qui compte,
        // c'est qu'il ne reste rien a facturer.
        let reste: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM ligne_reception lr
              WHERE lr.id_reception = $1
                AND NOT EXISTS (SELECT 1 FROM ligne_facture_fournisseur l
                                  JOIN facture_fournisseur f ON f.id_facture = l.id_facture
                                 WHERE l.id_ligne_reception = lr.id_ligne_reception
                                   AND (f.id_facture = $2 OR f.statut = 'VALIDEE'))",
        )
        .bind(id)
        .bind(id_facture)
        .fetch_one(&mut *tx)
        .await?;

        if reste == 0 {
            sqlx::query(
                "UPDATE reception
                    SET statut = 'CLOTURE', numero_facture = $2,
                        montant_facture_mad = $3, frais_facture_mad = 0,
                        code_devise_facture = $4, montant_facture_devise = $5, taux_facture = $6,
                        date_cloture = fn_instant($7), id_utilisateur_cloture = $8
                  WHERE id_reception = $1",
            )
            .bind(id)
            .bind(&e.numero_facture)
            .bind(def_rec as f64 / 100.0)
            .bind(&e.code_devise)
            .bind(def_rec as f64 / 100.0 / e.taux_change)
            .bind(e.taux_change)
            .bind(&horodatage)
            .bind(&user.id)
            .execute(&mut *tx)
            .await?;
            cloturees.push(numero.clone());
        }

        if let Some(a) = avis_ecart(numero, prov_rec, def_rec - prov_rec, seuil) {
            avis.push(a);
        }
        prov_tot += prov_rec;
        def_tot += def_rec;
        par_reception.push(json!({
            "id_reception": id,
            "numero_reception": numero,
            "valeur_provisoire_mad": prov_rec as f64 / 100.0,
            "valeur_definitive_mad": def_rec as f64 / 100.0,
            "difference_mad": (def_rec - prov_rec) as f64 / 100.0,
            "cloturee": reste == 0,
        }));
        tout_detail.extend(detail_rec);
    }

    // ---- 7. Le total imprime contre la somme des lignes : un AVIS ----------
    let somme_lignes: f64 =
        lignes.iter().map(|l| l.montant_devise).sum::<f64>() + e.frais_devise;
    if let Some(imprime) = e.montant_devise.filter(|m| *m > 0.0) {
        if (imprime - somme_lignes).abs() > 0.05 {
            avis.push(format!(
                "Le total imprime sur la facture ({imprime:.2} {}) ne retombe pas sur la somme de ses \
                 lignes ({somme_lignes:.2}) : verifiez la saisie avant de valider.",
                e.code_devise
            ));
        }
    }

    if !simuler {
        sqlx::query(
            "UPDATE facture_fournisseur
                SET statut = 'VALIDEE', id_utilisateur_validation = $2, date_validation = fn_instant($3)
              WHERE id_facture = $1",
        )
        .bind(id_facture)
        .bind(&user.id)
        .bind(&horodatage)
        .execute(&mut *tx)
        .await?;
    }

    let resultat = json!({
        "id_facture": id_facture,
        "numero_facture": e.numero_facture,
        "code_fournisseur": e.code_fournisseur,
        "simulation": simuler,
        "code_devise": e.code_devise,
        "taux_change": e.taux_change,
        "montant_lignes_devise": somme_lignes,
        "valeur_provisoire_mad": prov_tot as f64 / 100.0,
        "valeur_definitive_mad": def_tot as f64 / 100.0,
        "difference_mad": (def_tot - prov_tot) as f64 / 100.0,
        "au_stock_mad": stock_tot as f64 / 100.0,
        "ecart_prix_mad": ecart_tot as f64 / 100.0,
        "receptions": par_reception,
        "receptions_cloturees": cloturees,
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
