//! Saisie : les mouvements de stock — saisie libre, contre-passation, prets.
//!
//! Toutes les quantites saisies passent par la conversion vers le kilogramme
//! (R01). L'unite de saisie et le facteur employe sont conserves sur la ligne :
//! sans eux, on ne saurait pas relire ce que l'operateur a reellement compte.
//!
//! DECOUPE DU 17/10/2026 (audit B2). Ce fichier faisait 4 713 lignes et tenait
//! cinq domaines : mouvements, transferts, inventaires, bons de commande et
//! receptions. Les bons de commande — 1 500 lignes — sont des ACHATS : ils
//! n'ecrivent au grand livre qu'a travers la reception. Chacun a son module.

use super::json::lignes_en_json;
use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::db::{arrondi_kg, Db};
use crate::domain::numerotation::numeroter;
use crate::domain::unites::{self, Unite};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

/// Convertit une quantite saisie vers le kg, en refusant tout facteur manquant.
pub(crate) async fn vers_kg(
    db: &Db,
    code_reference: &str,
    quantite: f64,
    unite: &str,
) -> AppResult<(f64, f64)> {
    let u = Unite::depuis(unite)
        .ok_or_else(|| AppError::Invalide(format!("unite inconnue : {unite}")))?;
    let facteurs = unites::charger(db, code_reference).await?;
    let facteur = facteurs.facteur(u)?;
    Ok((arrondi_kg(quantite * facteur), facteur))
}

// ============================================================================
// Mouvements de stock
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct LigneMouvement {
    pub code_reference: String,
    pub quantite_saisie: f64,
    pub unite_saisie: String,
    pub prix_kg_mad: Option<f64>,
    /// Les colis REELLEMENT COMPTES sur le quai.
    ///
    /// Ils ne se deduisent pas du poids : `quantite_saisie` en palettes se
    /// convertit en kg par un facteur theorique, alors qu'une palette
    /// incomplete reste une palette a manutentionner. Le bon imprime porte ce
    /// compte, parce que c'est lui que le cariste verifie.
    pub nb_bobines: Option<i64>,
    pub nb_palettes: Option<f64>,
    pub lot_fournisseur: Option<String>,
    pub date_fabrication: Option<String>,
    pub date_peremption: Option<String>,
    pub code_motif_ligne: Option<String>,
    pub numero_of: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NouveauMouvement {
    /// L'IDENTIFIANT TIRE PAR L'ECRAN a l'ouverture du formulaire (audit P3,
    /// 19/10/2026) : le meme envoi rejoue rend le meme document, pas un second.
    /// Absent : le serveur en tire un.
    #[serde(default)]
    pub id_document: Option<String>,
    pub code_type_mvt: String,
    pub code_magasin: String,
    pub code_motif: String,
    /// LA DATE DU FAIT, distincte de la date de saisie.
    ///
    /// Elle etait imposee par la base a l'instant de l'enregistrement, ce qui
    /// obligeait a tout saisir le jour meme sous peine de fausser le journal.
    /// Un mouvement du samedi saisi le lundi porte desormais ses deux dates ;
    /// le declencheur C06 refuse toujours une date future.
    ///
    /// Absente, la base pose l'instant courant, comme avant.
    pub date_mouvement: Option<String>,
    /// La personne qui a physiquement remis ou recu la marchandise.
    ///
    /// Ce n'est pas le compte qui saisit : le magasinier tape souvent pour un
    /// chef d'equipe ou un chauffeur, et c'est ce dernier qu'on cherche quand
    /// un ecart apparait trois jours plus tard.
    pub responsable: Option<String>,
    pub numero_of: Option<String>,
    pub reference_document: Option<String>,
    pub observations_globales: Option<String>,
    /// Pour une sortie production : DECHET (par defaut, motif R4) ou
    /// CONSOMMATION — une matiere hors machine (colle, jute…) consommee sur un
    /// OF (decision 5 de l'audit v4).
    #[serde(default)]
    pub nature_sortie: Option<String>,
    /// L'usine qui emprunte et rend (pret HM_PRET, RETOUR_PRET ; regle 1, 09/10/2026).
    #[serde(default)]
    pub tiers: Option<String>,
    pub lignes: Vec<LigneMouvement>,
}

/// Normalise une date de mouvement vers l'horodatage ISO-8601 du schema.
///
/// Un ecran envoie `2026-09-01` — c'est ce que produit un `<input type="date">`.
/// Le schema stocke `2026-09-01T00:00:00.000Z`, et les vues comparent ces
/// chaines lexicalement : melanger les deux formes ferait passer un mouvement
/// avant ou apres tous les autres du meme jour, selon le sens du tri.
///
/// MINUIT ET NON MIDI : le declencheur C06 refuse une date dans le futur en
/// comparant a l'instant courant. Midi rendrait impossible la saisie du jour
/// meme avant midi — un refus incomprehensible pour celui qui le subit.
fn normaliser_date_mouvement(v: &Option<String>) -> Option<String> {
    v.as_ref().map(|d| {
        let d = d.trim();
        if d.len() == 10 {
            format!("{d}T00:00:00.000Z")
        } else {
            d.to_string()
        }
    })
}

/// LES TYPES QU'ON SAISIT A LA MAIN (06/10/2026). Les autres naissent d'un
/// document — reception, transfert, fusion de lots, fiche machine,
/// contre-passation — qui tient leur contrepartie : saisis seuls, ils creaient
/// du stock sans origine (une « entree de transfert » sans transfert) ou un
/// mouvement que rien ne savait plus defaire.
// REGLE 12 (08/10/2026, confirmee par l'utilisateur) : la saisie libre se
// limite aux ajustements et aux dechets. La sortie production n'y reste que
// comme DECHET (motif R4 impose) ; le retour de production en sort — un
// retour d'atelier passe par le dechargement d'une fiche machine. Le retour
// fournisseur en sort aussi (12/10/2026) : il devient un document a part, sur
// sa page (brouillon, puis validation par un autre compte).
// REGLE 1 (arbitrage du 09/10/2026) : la sortie hors machine — consommation
// d'atelier, echantillon, essai, reparation, pret a une autre usine — et le
// retour du pret, en nature.
pub(crate) const TYPES_SAISIE_LIBRE: &[&str] = &[
    "SORTIE_PROD",
    "SORTIE_HORS_MACHINE",
    "RETOUR_PRET",
    "AJUST_INV_POS",
    "AJUST_INV_NEG",
    "STOCK_INIT",
];

/// Les motifs d'une sortie hors machine (motif_ligne, categorie HORS_MACHINE).
const MOTIFS_HORS_MACHINE: &[&str] =
    &["HM_ATELIER", "HM_ECHANTILLON", "HM_ESSAI", "HM_REPARATION", "HM_PRET", "HM_AUTRE"];

fn document_du_type(t: &str) -> &'static str {
    match t {
        "ENTREE_REC" => "d'une reception (Achats → Receptions)",
        "TRANSFERT_ENTREE" | "TRANSFERT_SORTIE" => "d'un transfert (Stock → Transferts)",
        "FUSION_ENTREE" | "FUSION_SORTIE" => "d'une fusion de lots (fiche du lot)",
        "CHARGE_MACHINE" | "RETOUR_MACHINE" | "ANNUL_CHARGE_MACHINE" | "ANNUL_RETOUR_MACHINE" => {
            "d'une fiche machine (Stock → Machines)"
        }
        "RETOUR_PROD" => "du dechargement d'une fiche machine (Stock → Machines)",
        "RETOUR_FOURN" => "d'un retour fournisseur (Achats → Retours fournisseur)",
        _ => "de son document",
    }
}

/// LE FIL PRETE A D'AUTRES USINES, ce qui reste a rendre (regle 1, 09/10/2026).
/// Les kilos seulement : la valeur reste a l'etat de stock, masque selon les droits.
pub async fn prets_en_cours(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT p.tiers, p.code_reference, r.designation, p.reste_kg::float8 AS reste_kg, p.premier_pret,
                (current_date - substr(p.premier_pret, 1, 10)::date)::bigint AS jours
           FROM v_prets_en_cours p JOIN reference r ON r.code_reference = p.code_reference
          ORDER BY p.tiers, p.code_reference",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(crate::routes::json::lignes_en_json(&lignes)))
}

pub async fn creer_mouvement(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(m): Json<NouveauMouvement>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    let id = crate::domain::idempotence::identifiant(m.id_document.as_deref())?;
    if let Some(v) = crate::domain::idempotence::deja_enregistre(
        &state.db, &crate::domain::idempotence::MOUVEMENT, &id, &user.id,
    )
    .await?
    {
        return Ok(Json(v));
    }
    if !TYPES_SAISIE_LIBRE.contains(&m.code_type_mvt.as_str()) {
        return Err(AppError::RegleMetier(format!(
            "un mouvement « {} » ne se saisit pas a la main : il nait {}, qui tient sa contrepartie",
            m.code_type_mvt,
            document_du_type(&m.code_type_mvt)
        )));
    }
    if m.lignes.is_empty() {
        return Err(AppError::Invalide("au moins une ligne est requise".into()));
    }
    // REGLE 12 (08/10/2026). Un ajustement corrige le stock : c'est un acte de
    // validation de l'inventaire. Le stock initial constitue le stock d'ouverture : il revient
    // a l'administrateur.
    match m.code_type_mvt.as_str() {
        // Un ajustement corrige l'inventaire : il se valide comme une cloture
        // d'inventaire, que le magasinier n'a pas (regle 10).
        "AJUST_INV_POS" | "AJUST_INV_NEG" => {
            user.exiger(&state.db, module::INVENTAIRE, Action::Valider).await?;
        }
        "STOCK_INIT" if user.role != "ADMIN" => {
            return Err(AppError::RegleMetier(
                "Le stock initial est reserve a l'administrateur : il ouvre le stock, il ne le corrige pas. \
                 Pour corriger, saisissez un ajustement."
                    .into(),
            ));
        }
        _ => {}
    }

    // La conversion se fait avant d'ouvrir la transaction : un facteur manquant
    // doit echouer avant toute ecriture, avec un message qui nomme la reference.
    let mut converties = Vec::with_capacity(m.lignes.len());
    for l in &m.lignes {
        let (kg, facteur) =
            vers_kg(&state.db, &l.code_reference, l.quantite_saisie, &l.unite_saisie).await?;
        converties.push((l, kg, facteur));
    }
    // L'ANCIENNE « CONSOMMATION HORS MACHINE » (decision 5 de l'audit v4) etait
    // une sortie production sans seuil ni droit, sur un OF jamais verifie : 61 t
    // de fil pouvaient sortir ainsi. Elle devient la sortie hors machine, avec un
    // motif par ligne et le meme seuil que le dechet (regle 1, 09/10/2026).
    if m.code_type_mvt == "SORTIE_PROD" && m.nature_sortie.as_deref() == Some("CONSOMMATION") {
        return Err(AppError::RegleMetier(
            "La consommation hors machine se saisit desormais en « Sortie hors machine », avec \
             un motif par ligne (atelier, echantillon, essai, reparation, pret)."
                .into(),
        ));
    }
    let tiers = m.tiers.as_deref().map(str::trim).filter(|t| !t.is_empty()).map(str::to_string);
    if m.code_type_mvt == "SORTIE_HORS_MACHINE" {
        for (l, _, _) in &converties {
            let motif = l.code_motif_ligne.as_deref().unwrap_or("");
            if !MOTIFS_HORS_MACHINE.contains(&motif) {
                return Err(AppError::Invalide(format!(
                    "{} : choisissez le motif de la sortie (atelier, echantillon, essai, reparation, \
                     pret, autre).",
                    l.code_reference
                )));
            }
            if motif == "HM_PRET" && tiers.is_none() {
                return Err(AppError::Invalide(
                    "Un pret nomme l'usine qui emprunte : elle rendra le fil en nature.".into(),
                ));
            }
            if motif == "HM_AUTRE"
                && m.observations_globales.as_deref().map(str::trim).unwrap_or("").chars().count() < 5
            {
                return Err(AppError::Invalide(
                    "Motif « Autre » : dites pourquoi dans les observations.".into(),
                ));
            }
        }
    }
    if m.code_type_mvt == "RETOUR_PRET" && tiers.is_none() {
        return Err(AppError::Invalide("Un retour de pret nomme l'usine qui rend le fil.".into()));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // LES SORTIES QUI ENGAGENT LA VALEUR (decision 5 de l'audit v4). Un
    // manquant pouvait sortir par un « dechet » ou un retour fournisseur au
    // seul droit d'ecrire : la sortie la plus discrete du stock.
    match m.code_type_mvt.as_str() {
        "SORTIE_PROD" | "SORTIE_HORS_MACHINE" => {
            let seuil: f64 = sqlx::query_scalar::<_, Option<f64>>(
                "SELECT CAST(valeur_courante AS float8) FROM parametre WHERE code_parametre = 'P_DechetSeuilValiderKg'",
            )
            .fetch_optional(&mut *tx)
            .await?
            .flatten()
            .unwrap_or(50.0);
            // LE SEUIL SE JUGE EN CUMUL, PAR JOUR ET PAR REFERENCE (regle 1,
            // 09/10/2026) : quatre dechets de 49 kg ne font pas quatre petites
            // sorties. Dechets et sorties hors machine du meme jour comptent
            // ensemble, ce mouvement compris.
            let jour = normaliser_date_mouvement(&m.date_mouvement)
                .map(|d| d.chars().take(10).collect::<String>());
            let mut par_ref: std::collections::BTreeMap<String, f64> = std::collections::BTreeMap::new();
            for (l, kg, _) in &converties {
                *par_ref.entry(l.code_reference.clone()).or_default() += kg;
            }
            for (reference, kg) in &par_ref {
                let deja: f64 = sqlx::query_scalar(
                    "SELECT COALESCE(sum(lm.quantite_kg), 0)::float8
                       FROM ligne_mouvement lm JOIN mouvement mv ON mv.id_mouvement = lm.id_mouvement
                      WHERE mv.code_type_mvt IN ('SORTIE_PROD', 'SORTIE_HORS_MACHINE')
                        AND lm.code_reference = $1
                        AND substr(mv.date_mouvement, 1, 10)
                            = COALESCE($2, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
                        AND mv.id_mouvement_contrepasse IS NULL
                        AND NOT EXISTS (SELECT 1 FROM mouvement c WHERE c.id_mouvement_contrepasse = mv.id_mouvement)",
                )
                .bind(reference)
                .bind(&jour)
                .fetch_one(&mut *tx)
                .await?;
                if deja + kg > seuil + 1e-9 {
                    // Comme un ajustement negatif : il faut le droit de cloturer un
                    // inventaire, que le magasinier n'a pas.
                    user.exiger(&state.db, module::INVENTAIRE, Action::Valider).await.map_err(|_| {
                        AppError::RegleMetier(format!(
                            "{reference} : {} kg sortis ce jour (dechets et sorties hors machine, ce \
                             mouvement compris) depassent {seuil} kg : au-dela, la sortie se valide comme \
                             un ajustement d'inventaire (droit VALIDER sur l'inventaire). Faites-la saisir \
                             par la Direction.",
                            arrondi_kg(deja + kg)
                        ))
                    })?;
                }
            }
        }
        "RETOUR_PRET" => {
            // On ne rend pas plus que ce qui a ete prete a cette usine.
            let usine = tiers.clone().unwrap_or_default();
            let mut par_ref: std::collections::BTreeMap<String, f64> = std::collections::BTreeMap::new();
            for (l, kg, _) in &converties {
                *par_ref.entry(l.code_reference.clone()).or_default() += kg;
            }
            for (reference, kg) in &par_ref {
                let reste: f64 = sqlx::query_scalar(
                    "SELECT COALESCE((SELECT reste_kg FROM v_prets_en_cours
                                       WHERE tiers = $1 AND code_reference = $2), 0)::float8",
                )
                .bind(&usine)
                .bind(reference)
                .fetch_one(&mut *tx)
                .await?;
                if *kg > reste + 0.0005 {
                    return Err(AppError::RegleMetier(format!(
                        "{reference} : {} kg rendus par {usine}, mais il ne lui reste que {} kg a rendre. \
                         Un surplus n'est pas un retour de pret : c'est un ajustement d'inventaire.",
                        arrondi_kg(*kg),
                        arrondi_kg(reste)
                    )));
                }
            }
        }
        _ => {}
    }

    let numero = numeroter(&mut tx, "mouvement", "numero_mouvement", "MVT").await?;

    // `COALESCE` plutot qu'une requete conditionnelle : la valeur par defaut du
    // schema est l'instant courant, et la reproduire ici la ferait diverger le
    // jour ou elle changera.
    sqlx::query(
        "INSERT INTO mouvement
             (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt, code_magasin,
              code_motif, reference_document, numero_of, observations_globales,
              responsable, id_utilisateur, tiers)
         VALUES ($1,$2,
                 COALESCE(fn_jour_casablanca($3), (now() AT TIME ZONE 'Africa/Casablanca')::date),
                 $4,$5,$6,$7,$8,$9,$10,$11,$12)",
    )
    .bind(&id)
    .bind(&numero)
    .bind(normaliser_date_mouvement(&m.date_mouvement))
    .bind(&m.code_type_mvt)
    .bind(&m.code_magasin)
    .bind(&m.code_motif)
    .bind(&m.reference_document)
    .bind(&m.numero_of)
    .bind(&m.observations_globales)
    .bind(m.responsable.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(&user.id)
    .bind(&tiers)
    .execute(&mut *tx)
    .await?;

    // Les triggers appliquent le solde, recalculent le CMUP et refusent une
    // sortie superieure au stock, un OF manquant ou un lot absent.
    //
    // LE PRIX EST IMPOSE : LE CMUP EN COURS (regle 12, 08/10/2026). Un prix
    // tape a la main sur une entree libre refaisait le CMUP : seuls les achats
    // valorisent le stock. Une entree au CMUP le laisse ou il est. Une
    // reference jamais recue n'a pas de CMUP : on n'y fait pas entrer de kilos
    // a la main — sauf le stock d'ouverture, au prix catalogue a defaut.
    let entree =
        matches!(m.code_type_mvt.as_str(), "AJUST_INV_POS" | "RETOUR_PROD" | "STOCK_INIT" | "RETOUR_PRET");
    let mut prix_imposes: Vec<Option<f64>> = Vec::with_capacity(converties.len());
    for (l, _, _) in &converties {
        // LE CMUP DU MAGASIN, qui fait foi (U7, 09/10/2026) ; celui de la fiche
        // article n'est qu'une moyenne de tous les magasins, a defaut.
        let cmup: Option<f64> = sqlx::query_scalar(
            "SELECT COALESCE(
                 (SELECT NULLIF(cmup_mad, 0) FROM stock_magasin WHERE code_reference = $1 AND code_magasin = $2),
                 (SELECT NULLIF(cmup_mad, 0) FROM reference WHERE code_reference = $1))::float8",
        )
        .bind(&l.code_reference)
        .bind(&m.code_magasin)
        .fetch_one(&mut *tx)
        .await?;
        let cmup = cmup.filter(|c: &f64| *c > 0.0);
        let prix = if m.code_type_mvt == "STOCK_INIT" { cmup.or(l.prix_kg_mad) } else { cmup };
        if entree && prix.is_none() && m.code_type_mvt != "STOCK_INIT" {
            return Err(AppError::RegleMetier(format!(
                "{} n'a jamais ete recue : elle n'a pas de CMUP. Une entree libre se valorise au CMUP \
                 en cours ; faites d'abord entrer cette reference par une reception.",
                l.code_reference
            )));
        }
        prix_imposes.push(prix);
    }
    for (i, (l, kg, facteur)) in converties.iter().enumerate() {
        sqlx::query(
            "INSERT INTO ligne_mouvement
                 (id_mouvement, ligne_numero, code_reference, quantite_kg, prix_kg_mad,
                  quantite_saisie, unite_saisie, facteur_conversion,
                  nb_bobines, nb_palettes,
                  lot_fournisseur, date_fabrication, date_peremption,
                  code_motif_ligne, numero_of)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
        )
        .bind(&id)
        .bind((i + 1) as i64)
        .bind(&l.code_reference)
        .bind(kg)
        .bind(prix_imposes[i])
        .bind(l.quantite_saisie)
        .bind(&l.unite_saisie)
        .bind(facteur)
        .bind(l.nb_bobines)
        .bind(l.nb_palettes)
        .bind(&l.lot_fournisseur)
        .bind(&l.date_fabrication)
        .bind(&l.date_peremption)
        // Une sortie production libre est un DECHET (regle 12) : rebut, chute
        // non reutilisable. La sortie hors machine porte son propre motif.
        .bind(if m.code_type_mvt == "SORTIE_PROD" {
            Some("R4".to_string())
        } else {
            l.code_motif_ligne.clone()
        })
        .bind(l.numero_of.clone().or_else(|| m.numero_of.clone()))
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(Json(json!({
        "id_mouvement": id,
        "numero_mouvement": numero,
        "lignes": converties.len(),
        "quantite_totale_kg": arrondi_kg(converties.iter().map(|(_, kg, _)| kg).sum()),
    })))
}

// ----------------------------------------------------------------------------
// Le mouvement comme DOCUMENT
// ----------------------------------------------------------------------------
// Le grand livre — une ligne par reference — reste servi par
// `consultation::mouvements` : c'est la vue de l'auditeur, qui cherche ce
// qu'est devenue une reference. Ce n'est pas celle du magasin, qui manipule des
// camions et des equipes. Les deux endpoints coexistent parce que les deux
// lectures sont legitimes ; les confondre obligeait a additionner de tete les
// lignes d'un meme bon pour savoir combien de kilos etaient sortis.
// ----------------------------------------------------------------------------

/// Les totaux d'un document, calcules en SQL et non a l'ecran.
///
/// Le meme fragment sert la liste et le dossier : deux calculs paralleles
/// finissent toujours par diverger d'un arrondi, et c'est le genre d'ecart
/// qu'on ne remarque qu'au moment ou quelqu'un compare deux impressions.
const TOTAUX_MOUVEMENT: &str = "
    LEFT JOIN (
        SELECT l.id_mouvement,
               CAST(COUNT(*) AS bigint)                          AS nb_lignes,
               CAST(COUNT(DISTINCT l.code_reference) AS bigint)  AS nb_references,
               ROUND(SUM(l.quantite_kg), 3)                      AS quantite_totale_kg,
               CAST(SUM(COALESCE(l.nb_bobines, 0))  AS bigint)   AS bobines_totales,
               CAST(SUM(COALESCE(l.nb_palettes, 0)) AS bigint)   AS palettes_totales,
               ROUND(SUM(COALESCE(l.total_mad, 0)), 2)           AS valeur_totale_mad,
               -- LE REBUT, ISOLE DU RESTE. Un retour d'atelier melange de
               -- l'excedent reutilisable (R3) et de la chute perdue (R4) : les
               -- additionner ferait croire que tout revient en stock utile.
               ROUND(SUM(CASE WHEN l.code_motif_ligne = 'R4'
                              THEN l.quantite_kg ELSE 0 END), 3) AS rebut_kg
          FROM ligne_mouvement l
         GROUP BY l.id_mouvement
    ) tot ON tot.id_mouvement = m.id_mouvement";

/// Les colonnes d'entete, communes a la liste et au dossier.
const ENTETE_MOUVEMENT: &str = "
    m.id_mouvement, m.numero_mouvement, m.date_mouvement::text AS date_mouvement, m.date_creation,
    m.code_type_mvt, tm.libelle AS type_libelle, tm.signe, tm.couleur,
    m.code_magasin, mg.nom AS magasin_nom,
    m.code_motif, mo.libelle AS motif_libelle,
    m.reference_document, m.numero_of, m.observations_globales,
    m.responsable, m.est_initial, u.login AS saisi_par,
    CAST((substr(m.date_creation, 1, 10))::date
       - (substr(m.date_mouvement, 1, 10))::date AS bigint) AS jours_de_retard_saisie,
    COALESCE(tot.nb_lignes, 0)          AS nb_lignes,
    COALESCE(tot.nb_references, 0)      AS nb_references,
    COALESCE(tot.quantite_totale_kg, 0) AS quantite_totale_kg,
    COALESCE(tot.bobines_totales, 0)    AS bobines_totales,
    COALESCE(tot.palettes_totales, 0)   AS palettes_totales,
    COALESCE(tot.valeur_totale_mad, 0)  AS valeur_totale_mad,
    COALESCE(tot.rebut_kg, 0)           AS rebut_kg,
    -- LES DEUX SENS DE L'ANNULATION. Un document doit savoir dire qu'il
    -- annule, et savoir dire qu'il a ete annule : sans le second, un bon
    -- defait continue de s'imprimer comme s'il valait encore.
    m.id_mouvement_contrepasse, m.motif_contrepassation,
    (SELECT c.numero_mouvement FROM mouvement c
      WHERE c.id_mouvement_contrepasse = m.id_mouvement) AS contrepasse_par,
    -- LA FICHE MACHINE D'ORIGINE (09/10/2026) : un chargement ou un
    -- dechargement ne se defait que par elle ; l'ecran y renvoie.
    (SELECT d.id_fiche FROM machine_decision d
      WHERE d.id_decision = m.id_decision_machine) AS id_fiche_machine";

const JOINTURES_MOUVEMENT: &str = "
    FROM mouvement m
    JOIN type_mouvement  tm ON tm.code_type_mvt = m.code_type_mvt
    JOIN magasin         mg ON mg.code_magasin  = m.code_magasin
    JOIN motif_mouvement mo ON mo.code_motif    = m.code_motif
    JOIN utilisateur     u  ON u.id_utilisateur = m.id_utilisateur";

#[derive(Debug, Deserialize)]
pub struct FiltresDocuments {
    pub limite: Option<i64>,
    pub code_magasin: Option<String>,
    pub code_type_mvt: Option<String>,
    /// Ne garde que les documents portant cette reference sur l'une de leurs
    /// lignes. C'est ce que demande « voir les bons ou cette matiere apparait ».
    pub code_reference: Option<String>,
    /// Bornes sur la date DU FAIT, pas sur celle de la saisie.
    pub depuis: Option<String>,
    pub jusqu_a: Option<String>,
}

/// La liste des mouvements, un document par ligne.
///
/// L'ECART ENTRE LE FAIT ET SA SAISIE est calcule ici et non a l'ecran. Il ne
/// juge personne : il dit si le journal est tenu au jour le jour, ce qui
/// conditionne la fiabilite du stock projete. Zero est le cas normal.
pub async fn documents_mouvement(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<FiltresDocuments>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Lire).await?;

    let sql = format!(
        "SELECT {ENTETE_MOUVEMENT} {JOINTURES_MOUVEMENT} {TOTAUX_MOUVEMENT}
          WHERE ($1::text IS NULL OR m.code_magasin  = $1)
            AND ($2::text IS NULL OR m.code_type_mvt = $2)
            AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM ligne_mouvement l
                                              WHERE l.id_mouvement   = m.id_mouvement
                                                AND l.code_reference = $3))
            AND ($4::text IS NULL OR m.date_mouvement >= fn_jour_casablanca($4))
            AND ($5::text IS NULL OR m.date_mouvement <= fn_jour_casablanca($5))
          ORDER BY m.date_mouvement DESC, m.numero_mouvement DESC
          LIMIT $6"
    );

    let rows = sqlx::query(&sql)
        .bind(&f.code_magasin)
        .bind(&f.code_type_mvt)
        .bind(&f.code_reference)
        .bind(&f.depuis)
        // Une borne haute sur une date nue exclurait la journee entiere :
        // '2026-09-02' est plus petit que '2026-09-02T08:00:00.000Z'. On la
        // repousse donc a la fin du jour demande.
        .bind(f.jusqu_a.as_ref().map(|d| {
            let d = d.trim();
            if d.len() == 10 { format!("{d}T23:59:59.999Z") } else { d.to_string() }
        }))
        .bind(f.limite.unwrap_or(300).clamp(1, 2000))
        .fetch_all(&state.db)
        .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::MOUVEMENTS, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Le dossier complet d'un mouvement : entete, lignes, totaux.
///
/// Un seul appel, parce que c'est ce qu'imprime un bon d'entree ou de sortie.
/// Assembler le document depuis trois requetes exposerait a l'imprimer a
/// moitie servi — meme raison que pour le dossier de transfert.
#[derive(Deserialize)]
pub struct DemandeContrePassation {
    /// POURQUOI on defait : obligatoire, et conserve sur la ligne inverse.
    pub motif: String,
}

/// `POST /api/mouvements/{id}/contre-passer` — DEFAIRE SANS EFFACER.
///
/// LE GRAND LIVRE NE S'EFFACE PAS (R03), et ce n'est pas une rigidite : un
/// mouvement efface emporte avec lui la reponse a « que s'est-il passe ce
/// jour-la ». SAP, Oracle et Dynamics font tous la meme chose depuis trente
/// ans — on poste l'INVERSE. Les deux lignes restent, le solde redevient juste,
/// et l'histoire se lit encore dans six mois.
///
/// LE MOUVEMENT INVERSE PORTE UN TYPE D'AJUSTEMENT, jamais le type d'origine.
/// Une reception contre-passee n'est pas une « reception negative » : c'est une
/// correction, et les statistiques d'achat ne doivent pas y voir un achat de
/// moins.
///
/// LE CMUP SE REFAIT ENSUITE. Les types d'ajustement ne le touchent pas : sans
/// ce rappel, contre-passer une reception valorisee rendrait la quantite mais
/// laisserait le cout moyen fige sur un achat qui n'a plus lieu.
///
/// CE QUI PEUT REFUSER, ET C'EST VOULU : si la marchandise entree est deja
/// repartie, le declencheur de stock suffisant refuse la sortie inverse. On ne
/// peut pas defaire une entree dont les kilos ne sont plus la — il faut alors
/// un inventaire, qui constate au lieu de pretendre annuler.
pub async fn contre_passer(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(d): Json<DemandeContrePassation>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Valider).await?;
    // DEFAIRE EST UN ACTE DE DIRECTION. Saisir un mouvement se delegue ;
    // annuler celui d'un autre, non — c'est une decision sur le passe.
    if user.role != "ADMIN" && user.role != "DIRECTION" {
        return Err(AppError::NonAutorise {
            module: module::MOUVEMENTS.into(),
            action: "CONTRE_PASSER".into(),
        });
    }
    let motif = d.motif.trim().to_string();
    if motif.chars().count() < 5 {
        return Err(AppError::Invalide(
            "Le motif de la contre-passation est obligatoire : dites en quelques mots \
             pourquoi ce mouvement est annule."
                .into(),
        ));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // L'ORIGINAL, ET LES TROIS RAISONS DE REFUSER.
    let origine: Option<(String, String, String, i64, Option<String>)> = sqlx::query_as(
        "SELECT m.numero_mouvement, m.code_type_mvt, m.code_magasin, tm.signe,
                m.id_mouvement_contrepasse
           FROM mouvement m
           JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
          WHERE m.id_mouvement = $1",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((numero, type_origine, magasin, signe, deja_inverse)) = origine else {
        return Err(AppError::Introuvable(format!("mouvement {id}")));
    };
    if deja_inverse.is_some() {
        return Err(AppError::RegleMetier(
            "Ce mouvement EST deja une contre-passation : on n'annule pas une annulation, \
             on saisit le mouvement qui manque."
                .into(),
        ));
    }
    // UN MOUVEMENT DE FICHE MACHINE NE SE DEFAIT QUE PAR SA FICHE (05/10/2026).
    // Le contre-passer ici recrediterait le magasin alors que l'etage porterait
    // toujours le fil : il serait compte deux fois. La fiche, elle, ramene
    // l'etage a son etat precedent dans la meme decision.
    if matches!(
        type_origine.as_str(),
        "CHARGE_MACHINE" | "RETOUR_MACHINE" | "ANNUL_CHARGE_MACHINE" | "ANNUL_RETOUR_MACHINE"
    ) {
        let fiche: Option<String> =
            sqlx::query_scalar("SELECT reference_document FROM mouvement WHERE id_mouvement = $1")
                .bind(&id)
                .fetch_one(&mut *tx)
                .await?;
        return Err(AppError::RegleMetier(format!(
            "{numero} vient de la fiche machine {} : il se defait en annulant ou en devalidant \
             cette fiche, qui ramene aussi l'etage a son etat precedent.",
            fiche.unwrap_or_else(|| "d'origine".into())
        )));
    }
    // UN TRANSFERT OU UNE FUSION SE DEFONT EN ENTIER (06/10/2026). Contre-passer
    // la seule sortie d'un transfert en transit, puis le receptionner, doublait
    // les kilos ; contre-passer la seule entree les perdait.
    if matches!(
        type_origine.as_str(),
        "TRANSFERT_SORTIE" | "TRANSFERT_ENTREE" | "FUSION_SORTIE" | "FUSION_ENTREE"
    ) {
        return Err(AppError::RegleMetier(format!(
            "{numero} est une moitie de {} : la contre-passer seule desequilibrerait les deux magasins (ou les deux lots). Annulez le document, ou corrigez par un inventaire.",
            if type_origine.starts_with("TRANSFERT") { "transfert" } else { "fusion de lots" }
        )));
    }
    // APRES DEDOUANEMENT, LA RECEPTION D'IMPORT EST FIGEE (regle 8,
    // 08/10/2026). La DUM fixe la valeur en douane, puis la cloture du dossier
    // repartit les frais dans le CMUP : contre-passer l'entree ensuite retirait
    // les kilos mais laissait les frais (environ 12,8 k MAD constates a
    // l'audit). Toute correction passe alors par un avoir ou un retour
    // fournisseur. Avant la DUM, la contre-passation reste possible.
    // LES DEUX CHEMINS D'ENTREE SONT GARDES (17/10/2026). Ce garde-fou ne
    // remontait que par `import_reception_lignes` — l'ancien circuit. Depuis son
    // retrait, la marchandise importee entre par un ARRIVAGE, et la regle 8 ne
    // la couvrait plus : contre-passer l'entree d'un dossier dedouane etait
    // accepte, ce qui est precisement le cas que la regle existe pour refuser.
    // Revele par le portage de `scenario_import` sur le chemin unifie.
    let dedouanes: Option<String> = sqlx::query_scalar(
        "SELECT string_agg(DISTINCT d.numero, ', ' ORDER BY d.numero)
           FROM import_dossiers d
          WHERE (d.statut = 'CLOTURE' OR COALESCE(btrim(d.numero_dum), '') <> ''
                 -- Des frais du dossier au CMUP (regle 5) : quel que soit son statut.
                 OR EXISTS (SELECT 1 FROM import_ajustements_cump a WHERE a.id_dossier = d.id_dossier))
            AND (
                 -- Ancien circuit : la ligne de reception d'import porte le mouvement.
                 EXISTS (SELECT 1
                           FROM import_reception_lignes rl
                           JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
                           JOIN import_factures f ON f.id_facture = l.id_facture
                          WHERE rl.id_mouvement = $1 AND f.id_dossier = d.id_dossier)
                 -- Arrivage : la ligne pege a une ligne de bon, elle-meme facturee.
                 OR EXISTS (SELECT 1
                              FROM ligne_reception lr
                              JOIN import_facture_lignes l2 ON l2.id_ligne_bc = lr.id_ligne_bc
                              JOIN import_factures f2 ON f2.id_facture = l2.id_facture
                             WHERE lr.id_mouvement_genere = $1 AND f2.id_dossier = d.id_dossier))",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    // De meme, une reception locale CLOTUREE avec sa facture : sa valeur
    // definitive est au CMUP ; on la corrige par un avoir (regle 6 et 8).
    let cloturee: Option<String> = sqlx::query_scalar(
        "SELECT rc.numero_reception FROM reception rc
          WHERE rc.statut = 'CLOTURE'
            AND rc.id_reception IN (SELECT lr.id_reception FROM ligne_reception lr WHERE lr.id_mouvement_genere = $1)
          LIMIT 1",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(r) = cloturee {
        return Err(AppError::RegleMetier(format!(
            "{numero} est l'entree de la reception {r}, cloturee avec sa facture : elle ne s'annule plus. \
             Corrigez par un avoir ou un retour fournisseur."
        )));
    }
    if let Some(dossiers) = dedouanes {
        return Err(AppError::RegleMetier(format!(
            "{numero} est l'entree d'une reception d'import dont le dossier {dossiers} est dedouane : \
             elle ne s'annule plus. Corrigez par un avoir ou un retour fournisseur."
        )));
    }

    let deja: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM mouvement WHERE id_mouvement_contrepasse = $1",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    if deja > 0 {
        return Err(AppError::RegleMetier(format!(
            "{numero} a deja ete contre-passe. Le grand livre porte les deux lignes ; \
             une troisieme ne corrigerait rien."
        )));
    }

    // Le sens s'inverse ; le type devient un ajustement.
    let type_inverse = if signe == 1 { "AJUST_INV_NEG" } else { "AJUST_INV_POS" };

    let numero_inverse = numeroter(&mut tx, "mouvement", "numero_mouvement", "MVT").await?;
    let id_inverse = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO mouvement
             (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt, code_magasin,
              code_motif, reference_document, observations_globales,
              id_utilisateur, id_mouvement_contrepasse, motif_contrepassation)
         VALUES ($1, $2,
                 (now() AT TIME ZONE 'Africa/Casablanca')::date,
                 $3, $4, 'CONTREPASSATION', $5, $6, $7, $8, $9)",
    )
    .bind(&id_inverse)
    .bind(&numero_inverse)
    .bind(type_inverse)
    .bind(&magasin)
    .bind(format!("contre-passation de {numero}"))
    .bind(format!("Annule {numero} ({type_origine}) — {motif}"))
    .bind(&user.id)
    .bind(&id)
    .bind(&motif)
    .execute(&mut *tx)
    .await?;

    // LES MEMES LIGNES, AUX MEMES QUANTITES. Le sens vient du TYPE, jamais du
    // signe des nombres : une quantite negative dans le grand livre rendrait
    // toutes les sommes ambigues. Le lot suit, sinon la tracabilite se perdrait
    // sur la ligne qui corrige.
    let lignes: Vec<(i64, String, f64, Option<String>, Option<i64>, Option<f64>)> = sqlx::query_as(
        "SELECT ligne_numero, code_reference, quantite_kg::float8, lot_fournisseur, nb_bobines,
                prix_kg_mad::float8
           FROM ligne_mouvement WHERE id_mouvement = $1 ORDER BY ligne_numero",
    )
    .bind(&id)
    .fetch_all(&mut *tx)
    .await?;
    if lignes.is_empty() {
        return Err(AppError::RegleMetier(format!(
            "{numero} ne porte aucune ligne : il n'y a rien a defaire."
        )));
    }
    // LE MOTIF DE LIGNE EST « R5 — ERREUR DE SAISIE », de categorie CORRECTION.
    // Les types d'ajustement l'exigent, et c'est le seul des six qui decrive ce
    // qui se passe ici : on defait NOTRE propre ecriture. R6 dirait « ecart
    // d'inventaire », c'est-a-dire un ecart constate au magasin — le contraire
    // de ce qu'on fait. La raison veritable, en toutes lettres, est portee par
    // le motif du mouvement ; celui-ci n'est qu'une categorie.
    // Le nombre de bobines suit les kilos (06/10/2026) : sans lui, le stock
    // gardait des bobines sans poids.
    for (numero_ligne, code_reference, kg, lot, bobines, _) in &lignes {
        sqlx::query(
            "INSERT INTO ligne_mouvement
                 (id_mouvement, ligne_numero, code_reference, quantite_kg,
                  lot_fournisseur, nb_bobines, mode_pesee, code_motif_ligne)
             VALUES ($1, $2, $3, $4, $5, $6, 'THEORIQUE', 'R5')",
        )
        .bind(&id_inverse)
        .bind(numero_ligne)
        .bind(code_reference)
        .bind(kg)
        .bind(lot)
        .bind(bobines)
        .execute(&mut *tx)
        .await?;
    }

    // LE COUT MOYEN, A LA MANIERE SAP (06/10/2026). La ligne inverse n'a pas de
    // prix : elle n'a pas touche au CMUP. Annuler une SORTIE en reste la.
    // Annuler une ENTREE valorisee retire sa valeur A SON PRIX, dans son seul
    // magasin. L'ancien recalcul refaisait la moyenne de tout l'historique, tous
    // magasins confondus, et effacait les frais d'import ecrits a la cloture.
    let mut refaits: Vec<Value> = Vec::new();
    let impacte: i64 = sqlx::query_scalar(
        "SELECT impacte_cmup FROM type_mouvement WHERE code_type_mvt = $1",
    )
    .bind(&type_origine)
    .fetch_one(&mut *tx)
    .await?;
    if signe == 1 && impacte == 1 {
        let mut par_ref: Vec<(String, f64, f64)> = Vec::new();
        for (_, code_reference, kg, _, _, prix) in &lignes {
            let Some(p) = prix else { continue };
            match par_ref.iter_mut().find(|(r, _, _)| r == code_reference) {
                Some(x) => {
                    x.1 += kg;
                    x.2 += kg * p;
                }
                None => par_ref.push((code_reference.clone(), *kg, kg * p)),
            }
        }
        for (code_reference, kg, valeur) in par_ref {
            let prix: Option<f64> =
                sqlx::query_scalar("SELECT fn_cmup_annuler_entree($1, $2, $3::numeric, $4::numeric)::float8")
                    .bind(&code_reference)
                    .bind(&magasin)
                    .bind(kg)
                    .bind(valeur / kg)
                    .fetch_one(&mut *tx)
                    .await?;
            refaits.push(json!({ "code_reference": code_reference, "cmup_mad": prix }));
        }
    }

    // LA RECEPTION D'IMPORT SUIT SON ENTREE (audit v4). Avant la DUM, la
    // contre-passation retirait les kilos du stock mais laissait la reception
    // VALIDEE, la facture « 50 kg recus » et le bon servi : le reste a recevoir
    // mentait, et la ligne ne pouvait plus etre recue. Les quantites recues
    // redescendent ; la reception s'annule quand plus rien d'elle n'est en stock.
    let import: Vec<(String, String, f64, Option<String>)> = sqlx::query_as(
        "SELECT rl.id_reception, rl.id_ligne, rl.quantite_recue_kg::float8, l.id_ligne_bc
           FROM import_reception_lignes rl
           JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
          WHERE rl.id_mouvement = $1",
    )
    .bind(&id)
    .fetch_all(&mut *tx)
    .await?;
    let mut receptions_import: Vec<String> = Vec::new();
    // Les lignes de bon touchees : recalees ensemble a la fin (U2).
    let mut lignes_bc: Vec<String> = Vec::new();
    for (id_reception, id_ligne, kg, id_ligne_bc) in &import {
        sqlx::query(
            "UPDATE import_facture_lignes
                SET quantite_recue_kg = GREATEST(0, round(quantite_recue_kg - $2::numeric, 4))
              WHERE id_ligne = $1",
        )
        .bind(id_ligne)
        .bind(kg)
        .execute(&mut *tx)
        .await?;
        if let Some(lb) = id_ligne_bc {
            lignes_bc.push(lb.clone());
        }
        if !receptions_import.contains(id_reception) {
            receptions_import.push(id_reception.clone());
        }
    }
    // De meme pour une reception LOCALE : le bon retrouve son reste a recevoir.
    // Sans cela, une reception contre-passee puis devalidee ne se revalidait
    // plus — le bon la croyait deja recue (impasse relevee aux audits v3 et v4,
    // reproduite par le banc).
    let locales: Vec<String> = sqlx::query_scalar(
        "SELECT lr.id_ligne_bc FROM ligne_reception lr
          WHERE lr.id_mouvement_genere = $1 AND lr.id_ligne_bc IS NOT NULL",
    )
    .bind(&id)
    .fetch_all(&mut *tx)
    .await?;
    lignes_bc.extend(locales);
    // LE RECU SE RECALE SUR CE QUI TIENT (audit v5, U2) : retrancher les kilos
    // contre-passes ignorait le plafond pose a la reception (le recu ne depasse
    // jamais le commande), et le bon restait cloture. La base recompte chaque
    // ligne depuis ses receptions encore valables, puis le statut du bon.
    if !lignes_bc.is_empty() {
        sqlx::query("SELECT fn_recaler_lignes_bc($1)")
            .bind(&lignes_bc)
            .execute(&mut *tx)
            .await?;
    }
    // L'ARRIVAGE D'IMPORT SE DEFAIT COMME LA RECEPTION D'IMPORT (17/10/2026).
    //
    // La boucle qui suit ne connait que l'ANCIEN circuit : elle annule des
    // `import_receptions` et restatue leurs factures. Depuis que ce circuit a
    // ete retire, la marchandise importee entre par un ARRIVAGE — et
    // contre-passer son entree laissait `import_facture_lignes.quantite_recue_kg`
    // INCHANGEE : la facture affichait des kilos recus pour une marchandise
    // sortie du stock, et l'arrivage restait VALIDE. Le banc l'a revele en
    // portant `scenario_import_coherence` sur le chemin unifie.
    //
    // LE STATUT DE L'ARRIVAGE NE BOUGE PAS, ET C'EST VOULU. Une reception
    // VALIDE ne s'annule pas : `transition_statut` n'autorise, depuis VALIDE,
    // que A_CONTROLER (devalidation) et CLOTURE. Defaire une entree est le
    // travail de la contre-passation ; rendre la reception modifiable est
    // celui de la devalidation, qui reste un geste distinct et explicite.
    // (Une premiere version forcait ANNULE et cassait
    // `scenario_reception_devalidee_revalidee` : le declencheur de transition
    // avait raison.)
    //
    // Ce qui doit changer, c'est le COMPTE : le dossier d'import relit ses
    // kilos depuis ce qui tient encore, exactement comme `fn_recaler_lignes_bc`
    // le fait pour les lignes de bon.
    let dossiers_arrivage: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT f.id_dossier
           FROM ligne_reception lr
           JOIN import_facture_lignes fl ON fl.id_ligne_bc = lr.id_ligne_bc
           JOIN import_factures f ON f.id_facture = fl.id_facture
          WHERE lr.id_mouvement_genere = $1 AND lr.id_ligne_bc IS NOT NULL",
    )
    .bind(&id)
    .fetch_all(&mut *tx)
    .await?;
    for d in &dossiers_arrivage {
        crate::domain::importation::synchroniser_recu_arrivages(&mut tx, d).await?;
        crate::domain::importation::statuer_factures(&mut tx, d).await?;
    }

    for id_reception in &receptions_import {
        sqlx::query(
            "UPDATE import_receptions r SET statut = 'ANNULEE'
              WHERE r.id_reception = $1 AND r.statut = 'VALIDEE'
                AND NOT EXISTS (SELECT 1 FROM import_reception_lignes rl
                                 WHERE rl.id_reception = r.id_reception AND rl.id_mouvement IS NOT NULL
                                   AND NOT EXISTS (SELECT 1 FROM mouvement inv
                                                    WHERE inv.id_mouvement_contrepasse = rl.id_mouvement))",
        )
        .bind(id_reception)
        .execute(&mut *tx)
        .await?;
        let dossiers: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT f.id_dossier FROM import_reception_lignes rl
               JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
               JOIN import_factures f ON f.id_facture = l.id_facture
              WHERE rl.id_reception = $1",
        )
        .bind(id_reception)
        .fetch_all(&mut *tx)
        .await?;
        for d in &dossiers {
            crate::domain::importation::statuer_factures(&mut tx, d).await?;
        }
    }

    tx.commit().await?;

    Ok(Json(json!({
        "id_mouvement": id_inverse,
        "numero_mouvement": numero_inverse,
        "annule": numero,
        "type_inverse": type_inverse,
        "lignes": lignes.len(),
        "cmup_refaits": refaits,
    })))
}

pub async fn dossier_mouvement(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Lire).await?;

    let sql = format!(
        "SELECT {ENTETE_MOUVEMENT} {JOINTURES_MOUVEMENT} {TOTAUX_MOUVEMENT}
          WHERE m.id_mouvement = $1"
    );
    let entete = sqlx::query(&sql)
        .bind(&id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("mouvement {id}")))?;

    let lignes = sqlx::query(
        "SELECT l.*, r.designation, r.couleur, r.unite_catalogue,
                ml.libelle AS motif_ligne_libelle
           FROM ligne_mouvement l
           JOIN reference r ON r.code_reference = l.code_reference
           LEFT JOIN motif_ligne ml ON ml.code_motif_ligne = l.code_motif_ligne
          WHERE l.id_mouvement = $1
          ORDER BY l.ligne_numero",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let mut sortie = json!({
        "entete": lignes_en_json(std::slice::from_ref(&entete))
            .as_array().and_then(|a| a.first().cloned()).unwrap_or(Value::Null),
        "lignes": lignes_en_json(&lignes),
    });
    user.masquer(&state.db, module::MOUVEMENTS, &mut sortie).await?;
    Ok(Json(sortie))
}

// ============================================================================
// Transferts
// ============================================================================
