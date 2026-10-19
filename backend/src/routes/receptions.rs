//! Les receptions : arrivage, lignes attendues, pesee, controle, validation.
//! Sorties de `stock.rs` le 17/10/2026 (audit B2).

use super::json::lignes_en_json;
use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::db::{arrondi_kg, maintenant};
use crate::domain::concurrence::exiger_version;
use crate::domain::numerotation::numeroter;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use super::stock::vers_kg;
use super::bons_commande::{recalculer_bc, taux_au};
pub async fn lister_receptions(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;
    let rows = sqlx::query(
        // Bloc OTIF, colonnes J a P de la feuille Receptions.
        //
        //   delai_reel  = date de reception  - date du bon
        //   delai_prevu = date prevue        - date du bon
        //   retard      = reel - prevu
        //   on_time     = 1 si reel <= prevu
        //   in_full     = 1 si pese >= commande x (1 - tolerance)
        //   in_spec     = 1 si toutes les lignes sont conformes
        //   OTIF        = on_time x in_full x in_spec
        //
        // Le produit, et non la moyenne : une livraison a l'heure mais incomplete
        // n'est pas « aux deux tiers bonne », elle a manque. C'est ce qui rend
        // l'indicateur exigeant, et c'est pour cela qu'il vaut quelque chose.
        //
        // Tout est calcule a la lecture, jamais stocke : une pesee corrigee ou
        // une ligne passee en quarantaine doit changer l'OTIF sur-le-champ.
        // Les dates de reference ne viennent PAS forcement de l'en-tete : un
        // camion couvre parfois deux bons, et la reception n'en designe alors
        // aucun. On les reprend des lignes, en retenant la promesse la plus
        // ancienne (MIN) : des qu'une seule ligne arrive apres sa date, la
        // livraison a manque quelque chose, et l'affirmer serait faux.
        "WITH promesse AS (
             SELECT l.id_reception,
                    MIN(substr(bc.date_bc, 1, 10))               AS date_bc,
                    MIN(substr(bc.date_livraison_prevue, 1, 10)) AS date_livraison_prevue
               FROM ligne_reception l
               JOIN ligne_bc lb    ON lb.id_ligne_bc = l.id_ligne_bc
               JOIN bon_commande bc ON bc.id_bc = lb.id_bc
              GROUP BY l.id_reception
         )
         SELECT rc.*, f.nom AS fournisseur_nom,
                -- Le bon de l'en-tete quand il y en a un, sinon ceux que les
                -- lignes couvrent : « hors commande » serait un mensonge pour un
                -- camion qui porte deux bons.
                COALESCE(bc.numero_bc,
                         (SELECT string_agg(DISTINCT b2.numero_bc, ', ')
                            FROM ligne_reception l2
                            JOIN ligne_bc lb2     ON lb2.id_ligne_bc = l2.id_ligne_bc
                            JOIN bon_commande b2  ON b2.id_bc = lb2.id_bc
                           WHERE l2.id_reception = rc.id_reception)) AS numero_bc,
                COALESCE(bc.date_bc::text, p.date_bc)                             AS date_bc,
                COALESCE(bc.date_livraison_prevue::text, p.date_livraison_prevue) AS date_livraison_prevue,
                -- L'ARRIVAGE D'IMPORT (ADR-003 phase A) : le dossier rattache,
                -- et ce qu'il porte de douanier.
                d.numero AS dossier_numero, d.numero_dum, d.conteneurs,
                -- LA DEVISE DE L'ARRIVAGE, agregee a la lecture : chaque ligne
                -- tient la sienne de sa ligne de bon. Une colonne d'en-tete ne
                -- pourrait que divergir d'elles.
                (SELECT string_agg(DISTINCT l3.code_devise, ', ')
                   FROM ligne_reception l3 WHERE l3.id_reception = rc.id_reception) AS code_devise,
                up.login AS receptionnaire, uc.login AS controleur,
                -- Le renvoi au magasinier (regle 4) : qui, et le dernier peseur.
                (SELECT u.login FROM utilisateur u WHERE u.id_utilisateur = rc.id_utilisateur_renvoi) AS renvoye_par,
                (SELECT u.login FROM utilisateur u WHERE u.id_utilisateur = rc.id_utilisateur_pesee) AS peseur,
                (SELECT COUNT(*) FROM ligne_reception l WHERE l.id_reception = rc.id_reception) AS nb_lignes,

                CAST(((rc.date_reception)::date - (COALESCE(substr(bc.date_bc, 1, 10), p.date_bc))::date) AS bigint)
                    AS delai_reel_jours,
                CAST(((COALESCE(substr(bc.date_livraison_prevue, 1, 10), p.date_livraison_prevue))::date - (COALESCE(substr(bc.date_bc, 1, 10), p.date_bc))::date) AS bigint)
                    AS delai_prevu_jours,
                CAST(((rc.date_reception)::date - (COALESCE(substr(bc.date_livraison_prevue, 1, 10), p.date_livraison_prevue))::date)
                     AS bigint)
                    AS retard_jours,

                CASE WHEN COALESCE(bc.date_bc::text, p.date_bc) IS NULL
                       OR COALESCE(bc.date_livraison_prevue::text, p.date_livraison_prevue) IS NULL
                     THEN NULL
                     WHEN substr(rc.date_reception, 1, 10)
                          <= COALESCE(substr(bc.date_livraison_prevue, 1, 10), p.date_livraison_prevue)
                     THEN 1
                     ELSE 0 END AS on_time,

                CASE WHEN (SELECT COALESCE(SUM(l.quantite_commandee_kg), 0) FROM ligne_reception l
                            WHERE l.id_reception = rc.id_reception) <= 0 THEN NULL
                     WHEN (SELECT SUM(l.quantite_stock_kg) FROM ligne_reception l
                            WHERE l.id_reception = rc.id_reception)
                          >= (SELECT SUM(l.quantite_commandee_kg) FROM ligne_reception l
                               WHERE l.id_reception = rc.id_reception)
                             * (1 - COALESCE((SELECT CAST(valeur_courante AS numeric) / 100.0
                                                FROM parametre
                                               WHERE code_parametre = 'P_TolerInFull'), 0.02))
                     THEN 1 ELSE 0 END AS in_full,

                CASE WHEN (SELECT COUNT(*) FROM ligne_reception l
                            WHERE l.id_reception = rc.id_reception) = 0 THEN NULL
                     WHEN (SELECT COUNT(*) FROM ligne_reception l
                            WHERE l.id_reception = rc.id_reception
                              AND l.statut_qualite <> 'CONFORME') = 0
                     THEN 1 ELSE 0 END AS in_spec
           FROM reception rc
           JOIN fournisseur f   ON f.code_fournisseur = rc.code_fournisseur
           LEFT JOIN bon_commande bc ON bc.id_bc = rc.id_bc
           LEFT JOIN import_dossiers d ON d.id_dossier = rc.id_dossier_import
           LEFT JOIN promesse p      ON p.id_reception = rc.id_reception
           LEFT JOIN utilisateur up  ON up.id_utilisateur = rc.id_utilisateur_reception
           LEFT JOIN utilisateur uc  ON uc.id_utilisateur = rc.id_utilisateur_controle
          WHERE ($1 IS NULL OR rc.statut = $1)
          ORDER BY rc.date_reception DESC LIMIT 200",
    )
    .bind(f.get("statut"))
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::RECEPTIONS, &mut valeur).await?;
    Ok(Json(valeur))
}

#[derive(Debug, Deserialize)]
pub struct NouvelleReception {
    /// L'IDENTIFIANT TIRE PAR L'ECRAN a l'ouverture du formulaire (audit P3,
    /// 19/10/2026) : le meme envoi rejoue rend le meme document, pas un second.
    /// Absent : le serveur en tire un.
    #[serde(default)]
    pub id_document: Option<String>,
    pub id_bc: Option<String>,
    pub code_fournisseur: Option<String>,
    /// LE DOSSIER D'IMPORT DE CET ARRIVAGE (ADR-003 D2). Il porte la DUM, les
    /// conteneurs, le regime : il se rattache, il ne remplace pas la commande.
    pub id_dossier_import: Option<String>,
    pub num_bon_livraison: Option<String>,
    pub numero_facture: Option<String>,
    pub transporteur: Option<String>,
    pub nombre_colis: Option<i64>,
    pub poids_total_brut_kg: Option<f64>,
    /// LA DATE DU FAIT (10/10/2026) : le jour de la livraison, distinct du jour
    /// de saisie (un BL du samedi saisi le lundi). Jamais dans le futur, jamais
    /// avant le bon. Vide : aujourd'hui. L'entree en stock prend cette date.
    pub date_reception: Option<String>,
    /// Pesees saisies avec l'entete. Tout part dans UNE transaction : une
    /// reception ouverte sans ligne, avec un numero deja attribue, serait un
    /// document fantome au milieu de la numerotation.
    pub lignes: Option<Vec<LigneReception>>,
}

#[derive(Debug, Deserialize)]
pub struct ModifReception {
    /// Version du document telle que le client l'a lue. Absente, la
    /// verification de concurrence est sautee (A2, 17/10/2026).
    pub version: Option<i64>,

    pub num_bon_livraison: Option<String>,
    pub numero_facture: Option<String>,
    pub transporteur: Option<String>,
    pub nombre_colis: Option<i64>,
    pub poids_total_brut_kg: Option<f64>,
    /// Le dossier d'import de l'arrivage. Vide (`""`) le detache ; absent le
    /// laisse tel quel — sans ce signe, un dossier rattache par erreur ne
    /// pourrait plus s'enlever, et le COALESCE le garderait pour toujours.
    pub id_dossier_import: Option<String>,
    /// LA DATE A LAQUELLE LA MARCHANDISE EST ARRIVEE, au format AAAA-MM-JJ.
    ///
    /// Elle n'etait pas modifiable : la base la posait a l'instant ou l'on
    /// ouvrait le document. Or une reception se saisit souvent le lendemain,
    /// quand les papiers du camion arrivent au bureau — et c'est cette date,
    /// pas celle de la saisie, que l'OTIF compare a la livraison promise.
    pub date_reception: Option<String>,
}

/// Modifie l'entete d'une reception tant qu'elle n'est pas validee.
///
/// Une pesee se prepare : le bon de livraison arrive avec le camion, le nombre
/// de colis se compte, le poids brut se releve au pont-bascule. Rien de tout
/// cela n'est connu a la seconde ou l'on ouvre le document.
pub async fn modifier_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(m): Json<ModifReception>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;

    // UNE DATE DE RECEPTION NE PEUT PAS ETRE DANS LE FUTUR : on ne recoit pas
    // demain ce qui n’est pas encore arrive. Et elle doit etre une vraie date —
    // la base la garde en texte, et « 31/02 » y entrerait sans broncher.
    let date = crate::routes::date_du_fait(m.date_reception.as_deref(), "date de reception")?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // VERROU OPTIMISTE (A2). Si quelqu'un a modifie le document depuis que
    // ce client l'a lu, on refuse en le nommant plutot que d'ecraser sa
    // saisie en silence. Le garde verrouille aussi la ligne pour la suite.
    exiger_version(
        &mut tx, "reception", "id_reception", &id,
        Some(crate::domain::concurrence::exigee(m.version)?), "Cette reception",
    )
    .await?;

    let statut: String =
        sqlx::query_scalar("SELECT statut FROM reception WHERE id_reception = $1")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("reception {id}")))?;
    if statut != "BROUILLON" && statut != "A_CONTROLER" {
        return Err(AppError::RegleMetier(format!(
            "Une reception {statut} ne peut plus etre modifiee."
        )));
    }

    sqlx::query(
        "UPDATE reception
            SET num_bon_livraison   = COALESCE($2, num_bon_livraison),
                numero_facture      = COALESCE($6, numero_facture),
                transporteur        = COALESCE($3, transporteur),
                nombre_colis        = COALESCE($4, nombre_colis),
                poids_total_brut_kg = COALESCE($5, poids_total_brut_kg),
                date_reception      = COALESCE(fn_jour_casablanca($7), date_reception),
                -- Vide = detacher, absent = ne pas y toucher (cf. ModifReception).
                id_dossier_import   = CASE WHEN $8::text IS NULL THEN id_dossier_import
                                           WHEN $8 = '' THEN NULL
                                           ELSE $8 END
          WHERE id_reception = $1",
    )
    .bind(&id)
    .bind(&m.num_bon_livraison)
    .bind(&m.transporteur)
    .bind(m.nombre_colis)
    .bind(m.poids_total_brut_kg)
    .bind(&m.numero_facture)
    .bind(&date)
    .bind(&m.id_dossier_import)
    .execute(&mut *tx)
    .await?;

    // LA DATE CORRIGEE CHANGE LE TAUX (RG-09) : les lignes en devise reprennent
    // le cours du nouveau jour, et leur prix en dirhams avec lui. Rien n'est
    // encore entre en stock (brouillon ou a controler) : rien d'autre ne bouge.
    if let Some(jour) = &date {
        let sans_taux: Option<String> = sqlx::query_scalar(
            "SELECT string_agg(DISTINCT lr.code_devise, ', ') FROM ligne_reception lr
              WHERE lr.id_reception = $1 AND lr.code_devise <> 'MAD'
                AND NOT EXISTS (SELECT 1 FROM taux_change t WHERE t.code_devise = lr.code_devise
                                   AND $2 >= substr(t.date_debut, 1, 10)
                                   AND (t.date_fin IS NULL OR $2 < substr(t.date_fin, 1, 10)))",
        )
        .bind(&id)
        .bind(jour)
        .fetch_one(&mut *tx)
        .await?;
        if let Some(d) = sans_taux {
            return Err(AppError::RegleMetier(format!(
                "Aucun taux {d} en vigueur le {jour} : saisissez le cours de ce jour avant de dater la reception."
            )));
        }
        sqlx::query(
            // Taux et prix ensemble : la base exige prix = prix devise x taux a chaque ligne.
            "UPDATE ligne_reception lr
                SET taux_change = n.taux,
                    prix_kg_mad = CASE WHEN lr.prix_kg_devise IS NULL THEN lr.prix_kg_mad
                                       ELSE ROUND(lr.prix_kg_devise * n.taux, 4) END
               FROM (SELECT l.id_ligne_reception,
                            (SELECT t.taux FROM taux_change t
                              WHERE t.code_devise = l.code_devise
                                AND $2 >= substr(t.date_debut, 1, 10)
                                AND (t.date_fin IS NULL OR $2 < substr(t.date_fin, 1, 10))
                              ORDER BY t.date_debut DESC LIMIT 1) AS taux
                       FROM ligne_reception l WHERE l.id_reception = $1 AND l.code_devise <> 'MAD') n
              WHERE lr.id_ligne_reception = n.id_ligne_reception",
        )
        .bind(&id)
        .bind(jour)
        .execute(&mut *tx)
        .await?;
    }

    let version_entete = crate::domain::concurrence::version_actuelle(&mut tx, "reception", "id_reception", &id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "version": version_entete,  "id_reception": id, "modifie": true })))
}

/// LES DOSSIERS D'IMPORT OUVERTS, pour l'en-tete d'un arrivage.
///
/// Garde par RECEPTIONS, pas par IMPORT : c'est le magasinier qui dit quel
/// conteneur il est en train de vider, et il n'a pas a lire les dossiers
/// d'import pour cela. On ne renvoie que ce qui identifie l'arrivage — numero,
/// BL, DUM, conteneurs, date d'arrivee — jamais un montant.
pub async fn dossiers_import_ouverts(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;
    let rows = sqlx::query(
        "SELECT d.id_dossier, d.numero, d.numero_bl, d.numero_dum, d.conteneurs,
                d.date_arrivee, d.statut,
                (SELECT string_agg(DISTINCT fo.nom, ', ')
                   FROM import_factures f
                   JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
                  WHERE f.id_dossier = d.id_dossier) AS fournisseurs
           FROM import_dossiers d
          WHERE d.statut <> 'CLOTURE'
          ORDER BY COALESCE(d.date_arrivee::text, d.date_creation) DESC, d.numero DESC
          LIMIT 100",
    )
    .fetch_all(&state.db)
    .await?;
    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::RECEPTIONS, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Ce qu'on ATTEND sur cette reception : les lignes du bon encore a livrer.
///
/// Sans cela, le magasinier choisit une reference dans le catalogue et saisit un
/// poids — sans savoir ce qui etait commande, ni combien il en reste a recevoir.
/// C'est ainsi qu'on receptionne la mauvaise couleur, ou deux fois la meme
/// palette.
///
/// La ligne du bon porte le prix engage : le reprendre evite de le ressaisir, et
/// surtout d'en saisir un autre par distraction.
pub async fn lignes_attendues(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(q): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;

    let id_reception = q.get("id_reception").cloned().unwrap_or_default();

    // Trois facons d'interroger, de la plus precise a la plus large :
    //   - un bon designe ;
    //   - une reception ouverte, dont on prend le bon ;
    //   - un FOURNISSEUR, et l'on balaie tous ses bons encore en cours.
    //
    // Le dernier cas est celui de la creation : un camion arrive avec ce qui
    // etait pret, et cela couvre parfois deux bons. Obliger a en choisir un
    // forcerait a saisir deux receptions pour un seul camion.
    let id_bc = q.get("id_bc").filter(|b| !b.is_empty()).cloned();
    let fournisseur = q.get("code_fournisseur").filter(|f| !f.is_empty()).cloned();
    let id_bc = match (&id_bc, &fournisseur) {
        (Some(b), _) => Some(b.clone()),
        (None, Some(_)) => None,
        (None, None) => sqlx::query_scalar("SELECT id_bc FROM reception WHERE id_reception = $1")
            .bind(&id_reception)
            .fetch_optional(&state.db)
            .await?
            .flatten(),
    };

    if id_bc.is_none() && fournisseur.is_none() {
        // Reception sans bon de commande : rien n'est « attendu », le magasinier
        // saisit librement. On le dit par une liste vide plutot que par une
        // erreur — le cas est legitime (retour, don, regularisation).
        return Ok(Json(json!([])));
    }

    let rows = sqlx::query(
        "SELECT lb.id_ligne_bc, lb.code_reference, lb.designation, lb.unite_commande,
                lb.quantite_commandee_kg, lb.quantite_recue_kg, lb.quantite_restante_kg,
                -- LE SIGNAL (19/10/2026) : ce que d'AUTRES receptions en cours pesent
                -- deja sur cette ligne, et qui les tient. Le magasinier le voit avant
                -- de peser ; la base refuse au-dela du reste (R-REC).
                (SELECT SUM(lr2.quantite_stock_kg)::float8
                   FROM ligne_reception lr2 JOIN reception r2 ON r2.id_reception = lr2.id_reception
                  WHERE lr2.id_ligne_bc = lb.id_ligne_bc
                    AND r2.statut IN ('BROUILLON', 'A_CONTROLER')
                    AND r2.id_reception IS DISTINCT FROM $2) AS en_cours_kg,
                (SELECT string_agg(DISTINCT r2.numero_reception || ' (' || COALESCE(u2.nom, '?') || ')', ', ')
                   FROM ligne_reception lr2 JOIN reception r2 ON r2.id_reception = lr2.id_reception
                   LEFT JOIN utilisateur u2 ON u2.id_utilisateur = r2.id_utilisateur_reception
                  WHERE lr2.id_ligne_bc = lb.id_ligne_bc
                    AND r2.statut IN ('BROUILLON', 'A_CONTROLER')
                    AND r2.id_reception IS DISTINCT FROM $2) AS en_cours_dans,
                lb.prix_unitaire_devise, lb.prix_kg_devise, lb.code_devise,
                bc.id_bc, bc.numero_bc, bc.date_bc::text AS date_bc, bc.date_livraison_prevue, bc.statut AS statut_bc,
                r.unite_catalogue, r.suivi_lot, r.densite_kg_ml, r.poids_bobine_kg,
                r.bobines_par_palette, r.bobines_par_lot,
                -- Deja saisie sur CETTE reception : montrer plutot que masquer,
                -- sinon on la cherche sans comprendre pourquoi elle manque.
                (SELECT COALESCE(SUM(lr.quantite_stock_kg), 0) FROM ligne_reception lr
                  WHERE lr.id_reception = $2 AND lr.id_ligne_bc = lb.id_ligne_bc)
                    AS deja_pesee_kg,
                -- Retard sur la date promise : c'est ce qui trie l'urgence au quai.
                CAST((current_date - (bc.date_livraison_prevue)::date) AS bigint)
                    AS retard_jours,
                -- Ce que le fournisseur peut legitimement livrer a la place.
                -- Ramene ici plutot que par un appel separe : au quai on ouvre le
                -- camion, on ne navigue pas dans un referentiel.
                (SELECT string_agg(e.equivalent_reference, ', ') FROM v_equivalence e
                  WHERE e.code_reference = lb.code_reference
                    AND e.interchangeable = 1)                 AS equivalents_recevables,
                -- LE DOSSIER D'IMPORT SE DEDUIT, IL NE SE CHOISIT PAS (16/10/2026).
                -- C'est la FACTURE qui relie l'importation au bon de commande et
                -- a la reception : ligne de bon -> ligne de facture -> facture ->
                -- dossier. Le magasinier au quai connait son BL et son bon, pas
                -- le numero de dossier ; le lui faire choisir etait une saisie
                -- redondante et une source d'erreur.
                --
                -- LATERAL avec LIMIT 1 plutot qu'une jointure : une ligne de bon
                -- peut etre coupee en deux lignes de facture, et une jointure
                -- simple dedoublerait la ligne attendue dans l'ecran de pesee.
                -- Le LIMIT est sans perte parce qu'un bon ne mene qu'a un seul
                -- dossier (verifie sur les 126 bons rattaches de la base).
                d.id_dossier, d.numero AS dossier_numero,
                d.numero_dum AS dossier_dum, d.conteneurs AS dossier_conteneurs
           FROM ligne_bc lb
           JOIN bon_commande bc ON bc.id_bc = lb.id_bc
           JOIN reference r ON r.code_reference = lb.code_reference
           LEFT JOIN LATERAL (
               SELECT d2.id_dossier, d2.numero, d2.numero_dum, d2.conteneurs
                 FROM import_facture_lignes ifl
                 JOIN import_factures fi ON fi.id_facture = ifl.id_facture
                 JOIN import_dossiers d2 ON d2.id_dossier = fi.id_dossier
                WHERE ifl.id_ligne_bc = lb.id_ligne_bc
                LIMIT 1
           ) d ON true
          -- LE QUAI N'ATTEND QUE DE LA MARCHANDISE. La jointure interne ci-dessus
          -- suffirait aujourd'hui, mais c'est une protection accidentelle : le
          -- jour ou elle passera en jointure externe — comme celle de la fiche du
          -- bon vient de le faire — « FRET MARITIME » apparaitrait dans l'ecran
          -- de pesee, avec un prix au kilo absurde.
          WHERE lb.type_ligne = 'MARCHANDISE'
            AND lb.statut <> 'ANNULE'
            AND ($1 IS NULL OR lb.id_bc = $1)
            AND ($3 IS NULL OR (bc.code_fournisseur = $3
                                AND bc.statut IN ('ENVOYE','LIVRE_PARTIEL')
                                -- Deja servie (par l'import aussi) : plus rien a recevoir (U1).
                                AND lb.statut <> 'SOLDE' AND lb.quantite_restante_kg > 0))
          ORDER BY bc.date_livraison_prevue, bc.numero_bc, lb.ligne_numero",
    )
    .bind(&id_bc)
    .bind(&id_reception)
    .bind(&fournisseur)
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::RECEPTIONS, &mut valeur).await?;
    Ok(Json(valeur))
}

/// LA LIGNE DE BON QUI MANQUAIT, pour une marchandise arrivee sans commande.
///
/// ADR-003 D2 (14/10/2026) : il n'y a plus de reception « hors commande ».
/// Chaque ligne recue pege a une ligne de bon de commande — c'est ce peg qui
/// porte le prix engage, donc la valeur provisoire du stock.
///
/// Un camion se presente pourtant avec une matiere que personne n'a commandee :
/// un reliquat, un remplacement, un envoi anticipe. Refuser la marchandise
/// n'est pas une option — elle est au quai. La faire entrer sans engagement non
/// plus : le stock serait valorise sans qu'aucun prix ait ete negocie.
///
/// La sortie est de creer le bon qui manque, en BROUILLON. La marchandise se
/// pese tout de suite, mais la reception ne se VALIDERA qu'une fois ce bon
/// regularise (validation puis envoi). C'est ce qui rend la chose visible a
/// l'acheteur au lieu de la noyer dans le stock.
///
/// UN SEUL BON PAR ARRIVAGE : `bon_commande.id_reception_regularisee` le dit,
/// et les lignes suivantes du meme camion s'y ajoutent. Un bon deja valide ou
/// envoye ne se complete plus — il est engage ; on en ouvre alors un autre.
#[allow(clippy::too_many_arguments)]
async fn ligne_bc_regularisation(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id_reception: &str,
    numero_reception: &str,
    fournisseur: &str,
    id_utilisateur: &str,
    jour_taux: &str,
    code_reference: &str,
    unite_saisie: &str,
    quantite_unite: f64,
    quantite_kg: f64,
    facteur: f64,
    prix_kg_saisi: Option<f64>,
) -> AppResult<String> {
    let existant: Option<(String, String)> = sqlx::query_as(
        "SELECT id_bc, code_devise FROM bon_commande
          WHERE id_reception_regularisee = $1 AND statut = 'BROUILLON'
          ORDER BY date_creation DESC LIMIT 1",
    )
    .bind(id_reception)
    .fetch_optional(&mut **tx)
    .await?;

    let (id_bc, devise) = match existant {
        Some((id, devise)) => (id, devise),
        None => {
            let (devise_frs, conditions): (String, Option<String>) = sqlx::query_as(
                "SELECT COALESCE(code_devise, 'MAD'), conditions_paiement
                   FROM fournisseur WHERE code_fournisseur = $1",
            )
            .bind(fournisseur)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("fournisseur {fournisseur}")))?;

            // PAS DE REPLI AU TAUX 1 : sans cours en vigueur, un bon en dollars
            // naitrait au taux du dirham.
            let taux_frs: f64 = taux_au(&mut *tx, &devise_frs, jour_taux).await?.ok_or_else(|| {
                AppError::RegleMetier(format!(
                    "Aucun taux de change en vigueur pour {devise_frs} : saisissez le cours du \
                     jour (Referentiels -> Taux de change) avant de recevoir."
                ))
            })?;

            let numero_bc = numeroter(&mut *tx, "bon_commande", "numero_bc", "BC").await?;
            let id_nouveau = uuid::Uuid::new_v4().to_string();

            // La livraison est deja faite : la date prevue est aujourd'hui,
            // sinon le bon naitrait en retard et fausserait l'OTIF du
            // fournisseur pour une faute qui n'est pas la sienne.
            sqlx::query(
                "INSERT INTO bon_commande
                     (id_bc, numero_bc, code_fournisseur, code_devise, taux_change_engage,
                      date_taux_engage, date_livraison_prevue, conditions_paiement,
                      motif_creation, notes, montant_total_devise, montant_total_mad,
                      id_utilisateur_creation, id_reception_regularisee)
                 VALUES ($1,$2,$3,$4,$5,$6, current_date, $7,
                         'MANUEL', $8, 0, 0, $9, $10)",
            )
            .bind(&id_nouveau)
            .bind(&numero_bc)
            .bind(fournisseur)
            .bind(&devise_frs)
            .bind(taux_frs)
            .bind(maintenant())
            .bind(&conditions)
            .bind(format!(
                "Regularisation de la reception {numero_reception} : marchandise arrivee sans commande."
            ))
            .bind(id_utilisateur)
            .bind(id_reception)
            .execute(&mut **tx)
            .await?;

            (id_nouveau, devise_frs)
        }
    };

    // Prix au kg : celui saisi par qui a le droit de l'ecrire, sinon le
    // catalogue. Jamais zero — la table refuse un prix nul, et un stock a
    // valeur nulle fausserait le CMUP de la reference pour longtemps (RG-08).
    let prix_kg: f64 = match prix_kg_saisi {
        Some(p) if p > 0.0 => p,
        _ => sqlx::query_scalar(
            "SELECT prix_catalogue_kg::float8 FROM reference WHERE code_reference = $1",
        )
        .bind(code_reference)
        .fetch_optional(&mut **tx)
        .await?
        .flatten()
        .filter(|p: &f64| *p > 0.0)
        .ok_or_else(|| {
            AppError::RegleMetier(format!(
                "{code_reference} arrive sans commande et sans prix : renseignez un prix, \
                 le catalogue n'en propose aucun."
            ))
        })?,
    };

    let rang: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(ligne_numero), 0) + 1 FROM ligne_bc WHERE id_bc = $1",
    )
    .bind(&id_bc)
    .fetch_one(&mut **tx)
    .await?;

    let id_ligne_bc = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO ligne_bc
             (id_ligne_bc, id_bc, ligne_numero, code_reference, designation,
              unite_commande, facteur_kg, quantite_commandee_unite,
              quantite_commandee_kg, prix_unitaire_devise, code_devise,
              date_livraison_prevue, notes)
         SELECT $1, $2, $3, $4, r.designation, $5, $6, $7, $8, $9, $10,
                current_date, 'Cree par la reception ' || $11
           FROM reference r WHERE r.code_reference = $4",
    )
    .bind(&id_ligne_bc)
    .bind(&id_bc)
    .bind(rang)
    .bind(code_reference)
    .bind(unite_saisie)
    .bind(facteur)
    .bind(quantite_unite)
    .bind(quantite_kg)
    .bind(prix_kg * facteur)
    .bind(&devise)
    .bind(numero_reception)
    .execute(&mut **tx)
    .await?;

    recalculer_bc(&mut *tx, &id_bc).await?;
    Ok(id_ligne_bc)
}

pub async fn creer_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(r): Json<NouvelleReception>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;
    let id = crate::domain::idempotence::identifiant(r.id_document.as_deref())?;
    if let Some(v) = crate::domain::idempotence::deja_enregistre(
        &state.db, &crate::domain::idempotence::RECEPTION, &id, &user.id,
    )
    .await?
    {
        return Ok(Json(v));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // Le fournisseur vient du BC quand il y en a un : le saisir deux fois,
    // c'est risquer qu'ils divergent.
    let fournisseur = match (&r.id_bc, &r.code_fournisseur) {
        (Some(bc), _) => sqlx::query_scalar("SELECT code_fournisseur FROM bon_commande WHERE id_bc = $1")
            .bind(bc)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("bon de commande {bc}")))?,
        (None, Some(f)) => f.clone(),
        (None, None) => {
            return Err(AppError::Invalide(
                "id_bc ou code_fournisseur est obligatoire".into(),
            ))
        }
    };

    // La date du fait : jamais dans le futur, jamais avant le bon qu'elle livre.
    let date = crate::routes::date_du_fait(r.date_reception.as_deref(), "date de reception")?;
    if let (Some(d), Some(bc)) = (&date, &r.id_bc) {
        let date_bc: Option<String> =
            sqlx::query_scalar("SELECT substr(date_bc, 1, 10) FROM bon_commande WHERE id_bc = $1")
                .bind(bc)
                .fetch_optional(&mut *tx)
                .await?
                .flatten();
        if let Some(b) = date_bc.filter(|b| d.as_str() < b.as_str()) {
            return Err(AppError::RegleMetier(format!(
                "La reception ne peut pas preceder le bon de commande (date du bon : {b})."
            )));
        }
    }

    // LE TAUX DU JOUR DE LA LIVRAISON (RG-09, 10/10/2026) : avec la date du fait,
    // une livraison de mai saisie en octobre entrait au cours d'octobre. Le taux,
    // comme le mouvement d'entree, suit la date de la reception.
    let jour_taux = date.clone().unwrap_or_else(crate::db::aujourdhui);

    let numero = numeroter(&mut tx, "reception", "numero_reception", "REC").await?;

    sqlx::query(
        "INSERT INTO reception
             (id_reception, numero_reception, id_bc, code_fournisseur,
              transporteur, num_bon_livraison, numero_facture, nombre_colis,
              poids_total_brut_kg, id_utilisateur_reception, date_reception,
              id_dossier_import)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                 COALESCE(fn_jour_casablanca($11), (now() AT TIME ZONE 'Africa/Casablanca')::date),
                 NULLIF($12, ''))",
    )
    .bind(&id)
    .bind(&numero)
    .bind(&r.id_bc)
    .bind(&fournisseur)
    .bind(&r.transporteur)
    .bind(&r.num_bon_livraison)
    .bind(&r.numero_facture)
    .bind(r.nombre_colis)
    .bind(r.poids_total_brut_kg)
    .bind(&user.id)
    .bind(&date)
    .bind(&r.id_dossier_import)
    .execute(&mut *tx)
    .await?;

    // --- Pesees saisies avec l'entete ---------------------------------------
    //
    // LE PRIX SAISI NE COMPTE QUE POUR QUI PEUT L'ECRIRE (audit du 13/10/2026) :
    // le magasinier, a qui le prix est masque, imposait le sien a la place de
    // celui du bon. Ignore pour lui : le bon, sinon le catalogue.
    let droits_prix = user.droits(&state.db, module::RECEPTIONS).await?;
    let peut_ecrire_prix = matches!(
        droits_prix.get("prix_kg_devise"),
        Some(crate::auth::rbac::Niveau::Ecriture)
    );

    let mut posees = 0i64;
    for (i, l) in r.lignes.iter().flatten().enumerate() {
        if l.quantite_pesee_unite <= 0.0 {
            return Err(AppError::Invalide(format!(
                "{} : la quantite pesee doit etre strictement positive",
                l.code_reference
            )));
        }
        let (kg, facteur) = vers_kg(
            &state.db,
            &l.code_reference,
            l.quantite_pesee_unite,
            &l.unite_saisie,
        )
        .await?;

        // CHAQUE LIGNE PEGE A UNE LIGNE DE BON (ADR-003 D2). Celle qui arrive
        // sans peg fait naitre le bon qui manquait, en BROUILLON : tout ce qui
        // suit la traite ensuite comme n'importe quelle autre ligne.
        let id_ligne_bc: Option<String> = match &l.id_ligne_bc {
            Some(idl) => Some(idl.clone()),
            None => Some(
                ligne_bc_regularisation(
                    &mut tx,
                    &id,
                    &numero,
                    &fournisseur,
                    &user.id,
                    &jour_taux,
                    &l.code_reference,
                    &l.unite_saisie,
                    l.quantite_pesee_unite,
                    kg,
                    facteur,
                    l.prix_kg_devise.filter(|_| peut_ecrire_prix),
                )
                .await?,
            ),
        };

        // Prix et taux viennent de la ligne du bon, jamais du catalogue : c'est
        // le prix ENGAGE qui sera paye, et le relire ailleurs ouvrirait un ecart
        // entre ce qu'on a commande et ce qu'on valorise.
        // Le taux est NUMERIC en base : sans `::float8`, le decodage echouait et
        // toute reception rattachee a un bon tombait en erreur. Le prix engage
        // est une colonne calculee qui peut etre nulle : `Option`.
        // PAS DE REPLI AU TAUX 1 EN DEVISE (audit v4) : sans taux en vigueur, un
        // bon en dollars entrait au taux du dirham — des USD comptes en MAD.
        let engage: Option<(Option<f64>, String, Option<f64>)> = match &id_ligne_bc {
            Some(idl) => sqlx::query_as(
                "SELECT lb.prix_kg_devise::float8, lb.code_devise,
                        CASE WHEN lb.code_devise = 'MAD' THEN 1.0
                             ELSE (SELECT t.taux FROM taux_change t
                                    WHERE t.code_devise = lb.code_devise
                                      AND $2 >= substr(t.date_debut, 1, 10)
                                      AND (t.date_fin IS NULL OR $2 < substr(t.date_fin, 1, 10))
                                    ORDER BY t.date_debut DESC LIMIT 1) END::float8
                   FROM ligne_bc lb WHERE lb.id_ligne_bc = $1",
            )
            .bind(idl)
            .bind(&jour_taux)
            .fetch_optional(&mut *tx)
            .await?,
            None => None,
        };
        let (prix_devise, devise_ligne, taux) = match engage {
            Some((p, d, Some(t))) => (p, d, t),
            Some((_, d, None)) => {
                return Err(AppError::RegleMetier(format!(
                    "Aucun taux de change en vigueur pour {d} : saisissez le taux du jour (Referentiels → Taux de change) avant de recevoir. Sans lui, la marchandise entrerait au taux du dirham."
                )))
            }
            None => (l.prix_kg_devise, "MAD".to_string(), 1.0),
        };
        // UN PRIX AU KILO GARDE 4 DECIMALES, comme le CMUP (10/10/2026) : arrondi
        // comme un montant, 5,42 USD x 9,30 entrait a 50,41 au lieu de 50,406.
        let prix_mad = prix_devise.map(|p| arrondi_kg(p * taux));

        let qte_commandee: Option<f64> = match &id_ligne_bc {
            Some(idl) => sqlx::query_scalar(
                "SELECT quantite_restante_kg::float8 FROM ligne_bc WHERE id_ligne_bc = $1",
            )
            .bind(idl)
            .fetch_optional(&mut *tx)
            .await?,
            None => None,
        };

        sqlx::query(
            "INSERT INTO ligne_reception
                 (id_ligne_reception, id_reception, id_ligne_bc, ligne_numero, code_reference,
                  designation, unite_saisie, facteur_kg, quantite_pesee_unite, quantite_stock_kg,
                  quantite_commandee_kg, quantite_bl_kg, nb_colis_ligne, prix_kg_devise,
                  code_devise, taux_change, prix_kg_mad, lot_fournisseur, date_fabrication,
                  date_peremption, statut_qualite, code_magasin_dest, notes,
                  substitution_acceptee, motif_substitution,
                  derogation_ecart, id_utilisateur_derogation, motif_derogation,
                  nb_palettes_saisi, nb_bobines_saisi)
             SELECT $1, $2, $3, $4, $5, r.designation, $6, $7, $8, $9, $10, $11, $12, $13,
                    $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
                    $25, $26, $27, $28, $29
               FROM reference r WHERE r.code_reference = $5",
        )
        // LA DEROGATION ET LE COLISAGE PARTENT AUSSI A LA CREATION. Cette
        // insertion les oubliait, quand celle de l'ajout de ligne les portait :
        // une livraison partielle cochee « derogation » etait refusee par C10
        // (28/09/2026), et les palettes et bobines saisies se perdaient.
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&id)
        .bind(&id_ligne_bc)
        .bind((i + 1) as i64)
        .bind(&l.code_reference)
        .bind(&l.unite_saisie)
        .bind(facteur)
        .bind(l.quantite_pesee_unite)
        .bind(kg)
        .bind(qte_commandee)
        .bind(l.quantite_bl_kg)
        .bind(l.nb_colis_ligne)
        .bind(prix_devise)
        .bind(&devise_ligne)
        .bind(taux)
        .bind(prix_mad)
        .bind(&l.lot_fournisseur)
        .bind(&l.date_fabrication)
        .bind(&l.date_peremption)
        .bind(l.statut_qualite.clone().unwrap_or_else(|| "CONFORME".into()))
        .bind(&l.code_magasin_dest)
        .bind(&l.notes)
        .bind(i64::from(l.substitution_acceptee.unwrap_or(false)))
        .bind(&l.motif_substitution)
        .bind(i64::from(l.derogation_ecart.unwrap_or(false)))
        .bind(if l.derogation_ecart.unwrap_or(false) { Some(&user.id) } else { None })
        .bind(&l.motif_derogation)
        .bind(l.nb_palettes)
        .bind(l.nb_bobines)
        .execute(&mut *tx)
        .await?;
        posees += 1;
    }

    // LE BON NE DE CET ARRIVAGE, s'il en a fallu un : l'ecran le dit tout de
    // suite, pour que l'acheteur sache qu'il a un bon a regulariser.
    let bc_regularisation: Option<(String, String)> = sqlx::query_as(
        "SELECT id_bc, numero_bc FROM bon_commande
          WHERE id_reception_regularisee = $1 ORDER BY date_creation DESC LIMIT 1",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({
        "id_reception": id, "numero_reception": numero,
        "code_fournisseur": fournisseur, "lignes": posees,
        "bc_regularisation": bc_regularisation.as_ref().map(|(i, _)| i),
        "numero_bc_regularisation": bc_regularisation.as_ref().map(|(_, n)| n)
    })))
}

pub async fn lignes_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Lire).await?;
    let rows = sqlx::query(
        // Trois ecarts distincts, et les confondre serait une faute d'analyse :
        //   ecart_bl_kg   : ce que le fournisseur ANNONCE contre ce qu'on PESE
        //                   — un litige de transport ou de declaration ;
        //   ecart_cmd_kg  : ce qu'on a COMMANDE contre ce qu'on PESE
        //                   — une livraison incomplete ou excedentaire ;
        //   poids par colis : detecte un conditionnement inattendu.
        // LE CONDITIONNEMENT SUIT LA LIGNE. Sans le poids d'une bobine ni le
        // nombre par palette, l'ecran ne peut pas convertir une pesee en colis
        // — et la grille de saisie affiche des cases vides qu'on croit fausses.
        "SELECT l.*, r.designation AS reference_designation, r.unite_catalogue, r.suivi_lot,
                r.poids_bobine_kg, r.bobines_par_palette, r.bobines_par_lot, r.densite_kg_ml,
                -- LE CONSTAT PRIME SUR LE CALCUL. Renseigne, quelqu'un a compte
                -- sur le quai un colisage que la regle ne sait pas deviner.
                COALESCE(
                    l.nb_palettes_saisi,
                    CASE WHEN r.poids_bobine_kg > 0 AND r.bobines_par_palette > 0
                         THEN ROUND(l.quantite_stock_kg
                                    / (r.poids_bobine_kg * r.bobines_par_palette), 2)
                    END
                ) AS nb_palettes,
                l.nb_bobines_saisi AS nb_bobines,
                lb.code_reference AS reference_commandee,
                -- LE BON DE CETTE LIGNE (ADR-003 D2) : un arrivage en couvre
                -- plusieurs, et le magasinier doit lire, ligne par ligne,
                -- contre quelle commande il pese.
                bc.numero_bc,
                CASE WHEN l.id_ligne_bc IS NOT NULL
                      AND lb.code_reference <> l.code_reference
                     THEN 1 ELSE 0 END                                  AS est_substitution,
                ROUND(l.quantite_stock_kg - l.quantite_bl_kg, 4)        AS ecart_bl_kg,
                ROUND(l.quantite_stock_kg - l.quantite_commandee_kg, 4) AS ecart_cmd_kg,
                CASE WHEN l.nb_colis_ligne > 0
                     THEN ROUND(l.quantite_stock_kg / l.nb_colis_ligne, 3) END AS poids_moyen_colis_kg
           FROM ligne_reception l
           JOIN reference r ON r.code_reference = l.code_reference
           LEFT JOIN ligne_bc lb ON lb.id_ligne_bc = l.id_ligne_bc
           LEFT JOIN bon_commande bc ON bc.id_bc = lb.id_bc
          WHERE l.id_reception = $1 ORDER BY l.ligne_numero",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::RECEPTIONS, &mut valeur).await?;
    Ok(Json(valeur))
}

#[derive(Debug, Deserialize)]
pub struct LigneReception {
    /// LA VERSION DE L'EN-TETE lue par l'ecran (19/10/2026) : une ligne se modifie
    /// sous le verrou de son document. Ignoree a la creation du document.
    #[serde(default)]
    pub version: Option<i64>,
    pub code_reference: String,
    pub id_ligne_bc: Option<String>,
    pub unite_saisie: String,
    pub quantite_pesee_unite: f64,
    /// Quantite annoncee sur le bon de livraison, en kg. L'ecart avec la pesee
    /// est un litige de transport, distinct de l'ecart au commande.
    pub quantite_bl_kg: Option<f64>,
    pub nb_colis_ligne: Option<i64>,
    /// LES COLIS COMPTES SUR LE QUAI, distincts de ceux annonces au BL.
    ///
    /// Ils ne se deduisent pas du poids : une palette entamee reste une
    /// palette a manutentionner, et c'est le receptionnaire qui le sait.
    pub nb_palettes: Option<f64>,
    pub nb_bobines: Option<i64>,
    pub notes: Option<String>,
    pub prix_kg_devise: Option<f64>,
    pub code_magasin_dest: String,
    pub lot_fournisseur: Option<String>,
    pub date_fabrication: Option<String>,
    pub date_peremption: Option<String>,
    pub statut_qualite: Option<String>,
    pub derogation_ecart: Option<bool>,
    pub motif_derogation: Option<String>,
    /// Confirmation explicite d'une reference differente de celle commandee.
    pub substitution_acceptee: Option<bool>,
    pub motif_substitution: Option<String>,
}

pub async fn ajouter_ligne_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(l): Json<LigneReception>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;
    if l.quantite_pesee_unite <= 0.0 {
        return Err(AppError::Invalide("la quantite pesee doit etre positive".into()));
    }

    let (kg, facteur) = vers_kg(
        &state.db,
        &l.code_reference,
        l.quantite_pesee_unite,
        &l.unite_saisie,
    )
    .await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    // LE DOCUMENT SE PREND A LA VERSION LUE, en premiere ecriture : la ligne
    // se modifie sous le verrou de son en-tete (decision du 19/10/2026).
    crate::domain::concurrence::exiger_version(
        &mut tx, "reception", "id_reception", &id, Some(crate::domain::concurrence::exigee(l.version)?), "Cette reception",
    )
    .await?;

    let (statut, numero_reception, fournisseur, jour_reception): (String, String, String, String) =
        sqlx::query_as(
            // LE JOUR DE LA RECEPTION est sa date du fait (10/10/2026), pas
            // celui de la saisie : c'est lui qui donne le taux (RG-09).
            "SELECT rc.statut, rc.numero_reception, rc.code_fournisseur,
                    substr(rc.date_reception, 1, 10)
               FROM reception rc WHERE rc.id_reception = $1",
        )
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("reception {id}")))?;

    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(format!(
            "Seule une reception en brouillon peut recevoir des lignes (statut : {statut})."
        )));
    }

    // LE PRIX SAISI NE COMPTE QUE POUR QUI PEUT L'ECRIRE (audit de securite du
    // 13/10/2026) : le magasinier, a qui le prix est masque, imposait le sien a
    // la place de celui du bon. Ignore pour lui : le bon, sinon le catalogue.
    let droits_prix = user.droits(&state.db, module::RECEPTIONS).await?;
    let prix_saisi = l
        .prix_kg_devise
        .filter(|_| matches!(droits_prix.get("prix_kg_devise"), Some(crate::auth::rbac::Niveau::Ecriture)));

    // CHAQUE LIGNE PEGE A UNE LIGNE DE BON (ADR-003 D2, 14/10/2026). Il n'y a
    // plus de ligne « hors commande » qui entrerait au prix du catalogue, sans
    // qu'aucun prix ait ete negocie : celle qui arrive sans peg fait naitre le
    // bon qui manquait, en BROUILLON, et la reception ne se validera qu'une
    // fois ce bon regularise.
    let id_ligne_bc: String = match &l.id_ligne_bc {
        Some(idl) => idl.clone(),
        None => {
            ligne_bc_regularisation(
                &mut tx,
                &id,
                &numero_reception,
                &fournisseur,
                &user.id,
                &jour_reception,
                &l.code_reference,
                &l.unite_saisie,
                l.quantite_pesee_unite,
                kg,
                facteur,
                prix_saisi,
            )
            .await?
        }
    };

    // Prix et devise viennent de la ligne du bon : c'est le prix ENGAGE qui
    // sera paye. Le RESTE a livrer, pas le total commande : un bon livre en
    // deux camions verrait sinon chaque reception jugee incomplete, et l'OTIF
    // de chacune tomberait a zero sans faute reelle.
    let (prix_devise, devise, qte_commandee): (f64, String, Option<f64>) = {
        let r: (f64, String, f64) = sqlx::query_as(
            "SELECT prix_kg_devise::float8, code_devise, quantite_restante_kg::float8
               FROM ligne_bc WHERE id_ligne_bc = $1",
        )
        .bind(&id_ligne_bc)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("ligne de BC {id_ligne_bc}")))?;
        (prix_saisi.unwrap_or(r.0), r.1, Some(r.2))
    };
    let taux: f64 = taux_au(&mut tx, &devise, &jour_reception)
    .await?
    .ok_or_else(|| AppError::RegleMetier(format!("Aucun taux en vigueur pour {devise}.")))?;

    let numero: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(ligne_numero), 0) + 1 FROM ligne_reception WHERE id_reception = $1",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;

    let id_ligne = uuid::Uuid::new_v4().to_string();
    // Le trigger refuse un ecart de pesee hors tolerance sans derogation, et une
    // ligne non conforme dirigee hors zone de quarantaine.
    sqlx::query(
        "INSERT INTO ligne_reception
             (id_ligne_reception, id_reception, id_ligne_bc, ligne_numero, code_reference,
              designation, unite_saisie, facteur_kg, quantite_pesee_unite, quantite_stock_kg,
              quantite_commandee_kg, prix_kg_devise, code_devise, taux_change, prix_kg_mad,
              lot_fournisseur, date_fabrication, date_peremption, statut_qualite,
              code_magasin_dest, derogation_ecart, id_utilisateur_derogation, motif_derogation,
              quantite_bl_kg, nb_colis_ligne, notes,
              substitution_acceptee, motif_substitution,
              nb_palettes_saisi, nb_bobines_saisi)
         SELECT $1, $2, $3, $4, $5, r.designation, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
           FROM reference r WHERE r.code_reference = $5",
    )
    .bind(&id_ligne)
    .bind(&id)
    .bind(&id_ligne_bc)
    .bind(numero)
    .bind(&l.code_reference)
    .bind(&l.unite_saisie)
    .bind(facteur)
    .bind(l.quantite_pesee_unite)
    .bind(kg)
    .bind(qte_commandee)
    .bind(prix_devise)
    .bind(&devise)
    .bind(taux)
    .bind(arrondi_kg(prix_devise * taux))
    .bind(&l.lot_fournisseur)
    .bind(&l.date_fabrication)
    .bind(&l.date_peremption)
    .bind(l.statut_qualite.clone().unwrap_or_else(|| "CONFORME".into()))
    .bind(&l.code_magasin_dest)
    .bind(i64::from(l.derogation_ecart.unwrap_or(false)))
    .bind(if l.derogation_ecart.unwrap_or(false) { Some(&user.id) } else { None })
    .bind(&l.motif_derogation)
    .bind(l.quantite_bl_kg)
    .bind(l.nb_colis_ligne)
    .bind(&l.notes)
    .bind(i64::from(l.substitution_acceptee.unwrap_or(false)))
    .bind(&l.motif_substitution)
    .bind(l.nb_palettes)
    .bind(l.nb_bobines)
    .execute(&mut *tx)
    .await?;

    let version_entete = crate::domain::concurrence::version_actuelle(&mut tx, "reception", "id_reception", &id).await?;
    tx.commit().await?;

    // Le prix et le taux se masquent dans la reponse aussi.
    let mut v = json!({
        "id_ligne_reception": id_ligne, "ligne_numero": numero,
        "quantite_stock_kg": kg, "prix_kg_mad": arrondi_kg(prix_devise * taux),
        "taux_change": taux
    });
    user.masquer(&state.db, module::RECEPTIONS, &mut v).await?;
    Ok(Json({
        let mut v = v;
        v["version"] = json!(version_entete);
        v
    }))
}

#[derive(Debug, Deserialize)]
pub struct StatutReception {
    pub statut: String,
    /// Le motif du renvoi au magasinier (A_CONTROLER -> BROUILLON).
    #[serde(default)]
    pub motif: Option<String>,
}

/// LE RENVOI AU MAGASINIER (regle 4, 09/10/2026) : un controleur qui voit une
/// erreur de pesee ne la corrige plus lui-meme — il renvoie, avec le motif que
/// le magasinier lira en ouvrant la reception.
pub(crate) fn motif_de_renvoi(motif: Option<&str>) -> AppResult<String> {
    let m = motif.map(str::trim).unwrap_or("");
    if m.chars().count() < 5 {
        return Err(AppError::Invalide(
            "Dites au magasinier ce qu'il doit corriger (5 caracteres au moins) : il le lira en \
             ouvrant la reception."
                .into(),
        ));
    }
    Ok(m.to_string())
}

/// Fait avancer la reception dans son workflow.
///
/// BROUILLON -> A_CONTROLER est l'acte du magasinier : « j'ai fini de peser,
/// au controle qualite de decider ». Le passage a VALIDE n'est PAS traite ici :
/// il declenche la cascade 3-en-1 et passe par /valider, qui verifie la
/// segregation des taches.
pub async fn changer_statut_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(s): Json<StatutReception>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;

    if s.statut == "VALIDE" {
        return Err(AppError::RegleMetier(
            "La validation passe par /valider : elle declenche la cascade de stock.".into(),
        ));
    }
    // La cloture porte la facture et rend la valeur definitive (regle 6) :
    // elle ne se fait que par /cloturer, jamais par un simple changement d'etat.
    if s.statut == "CLOTURE" {
        return Err(AppError::RegleMetier(
            "La cloture passe par « Clôturer avec la facture » : elle porte la valeur definitive au stock.".into(),
        ));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // Regle 15 : une reception validee ne recule pas par cette route — la
    // devalidation verifie d'abord que son stock a ete contre-passe.
    let actuel: String =
        sqlx::query_scalar("SELECT statut FROM reception WHERE id_reception = $1 FOR UPDATE")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("reception {id}")))?;
    crate::domain::transitions::exiger_transition(
        &state.db, &user, module::RECEPTIONS, "reception", &actuel, &s.statut,
    )
    .await?;

    if s.statut == "A_CONTROLER" {
        let lignes: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM ligne_reception WHERE id_reception = $1")
                .bind(&id)
                .fetch_one(&mut *tx)
                .await?;
        if lignes == 0 {
            return Err(AppError::RegleMetier(
                "Aucune ligne pesee : rien a soumettre au controle qualite.".into(),
            ));
        }
        crate::domain::reception::verifier_ecarts_courants(&mut tx, &id).await?;
        crate::domain::reception::exiger_bobines_comptees(&mut tx, &id).await?;
    }

    if actuel == "A_CONTROLER" && s.statut == "BROUILLON" {
        let motif = motif_de_renvoi(s.motif.as_deref())?;
        sqlx::query(
            "UPDATE reception SET motif_renvoi = $2, id_utilisateur_renvoi = $3,
                    date_renvoi = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
              WHERE id_reception = $1",
        )
        .bind(&id)
        .bind(&motif)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;
    }

    // Le trigger de transition refuse tout enchainement non prevu.
    let res = sqlx::query("UPDATE reception SET statut = $2 WHERE id_reception = $1")
        .bind(&id)
        .bind(&s.statut)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Introuvable(format!("reception {id}")));
    }
    tx.commit().await?;

    Ok(Json(json!({ "id_reception": id, "statut": s.statut })))
}

pub async fn supprimer_ligne_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((id, ligne)): Path<(String, String)>,
    axum::extract::Query(q): axum::extract::Query<super::entites::VersionLue>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    // LE DOCUMENT SE PREND A LA VERSION LUE, en premiere ecriture : la ligne
    // se modifie sous le verrou de son en-tete (decision du 19/10/2026).
    crate::domain::concurrence::exiger_version(
        &mut tx, "reception", "id_reception", &id, Some(super::entites::version_exigee(q.version.map(serde_json::Value::String).as_ref())?), "Cette reception",
    )
    .await?;

    let statut: String = sqlx::query_scalar("SELECT statut FROM reception WHERE id_reception = $1")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("reception {id}")))?;
    if statut == "VALIDE" || statut == "CLOTURE" {
        return Err(AppError::RegleMetier(
            "Une reception validee est figee : ses lignes ont deja alimente le stock.".into(),
        ));
    }
    if statut == "A_CONTROLER" {
        return Err(AppError::RegleMetier(PESEE_FIGEE.into()));
    }

    let res = sqlx::query("DELETE FROM ligne_reception WHERE id_ligne_reception = $1")
        .bind(&ligne)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Introuvable(format!("ligne {ligne}")));
    }
    let version_entete = crate::domain::concurrence::version_actuelle(&mut tx, "reception", "id_reception", &id).await?;
    tx.commit().await?;

    Ok(Json(json!({ "version": version_entete,  "supprime": true })))
}

/// Le refus commun : au controle, on renvoie, on ne corrige pas.
const PESEE_FIGEE: &str = "Au controle, la pesee est figee : celui qui valide n'est pas celui qui pese. \
     Renvoyez la reception au magasinier, avec ce qu'il doit corriger ; il la resoumettra.";

/// Ce qu'une ligne de reception peut encore corriger.
///
/// TOUT EST FACULTATIF : l'ecran n'envoie que ce qu'il a touche. Un champ
/// absent reste tel quel, un champ vide aussi — la convention est celle de
/// `ModifLigneBc`, et deux conventions differentes pour un meme geste
/// finiraient par se contredire.
///
/// CE QUI N'EST PAS CORRIGEABLE : la reference. Elle commande le prix, la
/// devise, le taux du jour et le rattachement a la ligne de commande — quatre
/// valeurs deduites a la creation. Les rededuire ici reviendrait a recreer la
/// ligne en faisant croire qu'on la modifie. Une erreur de reference se corrige
/// en retirant la ligne et en la ressaisissant, ce que l'ecran sait faire.
#[derive(Debug, Deserialize)]
pub struct ModifLigneReception {
    /// LA VERSION DE L'EN-TETE lue par l'ecran (19/10/2026) : une ligne se modifie
    /// sous le verrou de son document. Ignoree a la creation du document.
    #[serde(default)]
    pub version: Option<i64>,
    /// La derogation a l'ecart de pesee, posee ou retiree sur une ligne existante
    /// (F11, 09/10/2026) : le message de refus la demandait, rien ne la posait.
    #[serde(default)]
    pub derogation_ecart: Option<bool>,
    #[serde(default)]
    pub motif_derogation: Option<String>,
    pub unite_saisie: Option<String>,
    pub quantite_pesee_unite: Option<f64>,
    pub quantite_bl_kg: Option<f64>,
    pub nb_colis_ligne: Option<i64>,
    pub nb_palettes: Option<f64>,
    pub nb_bobines: Option<i64>,
    pub lot_fournisseur: Option<String>,
    pub date_fabrication: Option<String>,
    pub date_peremption: Option<String>,
    pub statut_qualite: Option<String>,
    pub code_magasin_dest: Option<String>,
    pub notes: Option<String>,
}

/// Corriger une pesee, sans supprimer ni recreer la ligne.
///
/// POURQUOI CETTE ROUTE N'EXISTAIT PAS, et pourquoi il fallait l'ecrire. Une
/// ligne de reception ne savait qu'etre creee ou supprimee. Corriger un poids
/// obligeait donc l'ecran a effacer la ligne puis a la reposter — trois
/// consequences, toutes mauvaises :
///
///   * le numero de ligne changeait a chaque correction, si bien que le bon
///     imprime ne portait plus le meme ordre d'un tirage a l'autre ;
///   * entre la suppression et la recreation, la reception existait sans sa
///     ligne : une validation concurrente aurait valide une reception amputee ;
///   * le journal d'audit enregistrait une suppression, ce qui se lit comme un
///     retrait de marchandise alors qu'on corrigeait une virgule.
///
/// LE POIDS SE RECALCULE ICI, jamais cote ecran : c'est `vers_kg` qui fait foi,
/// avec les facteurs de la fiche. L'ecran propose, le serveur pese.
pub async fn modifier_ligne_reception(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((id, ligne)): Path<(String, String)>,
    Json(m): Json<ModifLigneReception>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::RECEPTIONS, Action::Ecrire).await?;

    // L'etat AVANT correction, et celui de la reception qui la porte.
    #[allow(clippy::type_complexity)]
    let (statut, code_reference, unite_actuelle, qte_actuelle, bob_act, pal_act, lot_act, bl_act, colis_act, derog_act): (
        String, String, String, f64, Option<i64>, Option<f64>, Option<String>, Option<f64>, Option<i64>, i64,
    ) = sqlx::query_as(
            "SELECT rc.statut, lr.code_reference, lr.unite_saisie,
                    lr.quantite_pesee_unite::float8, lr.nb_bobines_saisi::bigint,
                    lr.nb_palettes_saisi::float8, lr.lot_fournisseur, lr.quantite_bl_kg::float8,
                    lr.nb_colis_ligne::bigint, COALESCE(lr.derogation_ecart, 0)::bigint
               FROM ligne_reception lr
               JOIN reception rc ON rc.id_reception = lr.id_reception
              WHERE lr.id_ligne_reception = $1 AND lr.id_reception = $2",
        )
        .bind(&ligne)
        .bind(&id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("ligne de reception {ligne}")))?;

    // MEME FRONTIERE QUE LA SUPPRESSION, et non celle de l'ajout. Une reception
    // « a controler » est precisement celle qu'on est en train de verifier :
    // lui interdire la correction obligerait a la supprimer pour la refaire.
    if statut == "VALIDE" || statut == "CLOTURE" {
        return Err(AppError::RegleMetier(
            "Une reception validee est figee : ses lignes ont deja alimente le stock.".into(),
        ));
    }
    // AU CONTROLE, LA PESEE EST FIGEE (regle 4, 09/10/2026). Le controleur y
    // pose la qualite, la destination, une note ; les quantites, les bobines,
    // le lot et la derogation restent ceux du magasinier. Un formulaire renvoie
    // toute la ligne : seul un CHANGEMENT est refuse.
    if statut == "A_CONTROLER" {
        let change_f = |n: Option<f64>, a: Option<f64>| n.is_some_and(|n| a.is_none_or(|a| (n - a).abs() > 1e-9));
        let change_i = |n: Option<i64>, a: Option<i64>| n.is_some_and(|n| Some(n) != a);
        let change_t = |n: &Option<String>, a: &Option<String>| {
            n.as_deref().map(str::trim).filter(|t| !t.is_empty()).is_some_and(|t| Some(t) != a.as_deref())
        };
        if change_f(m.quantite_pesee_unite, Some(qte_actuelle))
            || m.unite_saisie.as_deref().is_some_and(|u| u != unite_actuelle)
            || change_i(m.nb_bobines, bob_act)
            || change_f(m.nb_palettes, pal_act)
            || change_t(&m.lot_fournisseur, &lot_act)
            || change_f(m.quantite_bl_kg, bl_act)
            || change_i(m.nb_colis_ligne, colis_act)
            || m.derogation_ecart.is_some_and(|d| i64::from(d) != derog_act)
        {
            return Err(AppError::RegleMetier(PESEE_FIGEE.into()));
        }
    }

    let unite = m.unite_saisie.clone().unwrap_or(unite_actuelle);
    let quantite = m.quantite_pesee_unite.unwrap_or(qte_actuelle);
    if quantite <= 0.0 {
        return Err(AppError::Invalide("la quantite pesee doit etre positive".into()));
    }
    let (kg, facteur) = vers_kg(&state.db, &code_reference, quantite, &unite).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    // LE DOCUMENT SE PREND A LA VERSION LUE, en premiere ecriture : la ligne
    // se modifie sous le verrou de son en-tete (decision du 19/10/2026).
    crate::domain::concurrence::exiger_version(
        &mut tx, "reception", "id_reception", &id, Some(crate::domain::concurrence::exigee(m.version)?), "Cette reception",
    )
    .await?;

    // Les declencheurs de la base veillent toujours : ecart de pesee hors
    // tolerance sans derogation, ligne non conforme dirigee hors quarantaine.
    // On ne les contourne pas, on leur donne les valeurs corrigees.
    sqlx::query(
        "UPDATE ligne_reception SET
             unite_saisie = $3,
             facteur_kg = $4,
             quantite_pesee_unite = $5,
             quantite_stock_kg = $6,
             quantite_bl_kg     = COALESCE($7, quantite_bl_kg),
             nb_colis_ligne     = COALESCE($8, nb_colis_ligne),
             nb_palettes_saisi  = COALESCE($15, nb_palettes_saisi),
             nb_bobines_saisi   = COALESCE($16, nb_bobines_saisi),
             lot_fournisseur    = COALESCE(NULLIF(TRIM($9), ''), lot_fournisseur),
             date_fabrication   = COALESCE(NULLIF(TRIM($10), ''), date_fabrication),
             date_peremption    = COALESCE(NULLIF(TRIM($11), ''), date_peremption),
             statut_qualite     = COALESCE(NULLIF(TRIM($12), ''), statut_qualite),
             code_magasin_dest  = COALESCE(NULLIF(TRIM($13), ''), code_magasin_dest),
             notes              = COALESCE(NULLIF(TRIM($14), ''), notes),
             derogation_ecart   = COALESCE($17::bigint, derogation_ecart),
             motif_derogation   = CASE WHEN $17::bigint = 0 THEN NULL
                                       ELSE COALESCE(NULLIF(TRIM($18), ''), motif_derogation) END,
             id_utilisateur_derogation = CASE WHEN $17::bigint = 1 THEN $19
                                              WHEN $17::bigint = 0 THEN NULL
                                              ELSE id_utilisateur_derogation END
          WHERE id_ligne_reception = $1 AND id_reception = $2",
    )
    .bind(&ligne)
    .bind(&id)
    .bind(&unite)
    .bind(facteur)
    .bind(quantite)
    .bind(kg)
    .bind(m.quantite_bl_kg)
    .bind(m.nb_colis_ligne)
    .bind(&m.lot_fournisseur)
    .bind(&m.date_fabrication)
    .bind(&m.date_peremption)
    .bind(&m.statut_qualite)
    .bind(&m.code_magasin_dest)
    .bind(&m.notes)
    .bind(m.nb_palettes)
    .bind(m.nb_bobines)
    .bind(m.derogation_ecart.map(i64::from))
    .bind(&m.motif_derogation)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    let version_entete = crate::domain::concurrence::version_actuelle(&mut tx, "reception", "id_reception", &id).await?;
    tx.commit().await?;

    Ok(Json(json!({ "version": version_entete, 
        "id_ligne_reception": ligne,
        "quantite_stock_kg": kg,
        "facteur_kg": facteur
    })))
}
