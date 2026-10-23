//! Inventaire physique (CDC G6).
//!
//! Le trigger J6 du CDC etait inoperant sur deux points :
//!   * `ligne_numero` code en dur a 1 sous contrainte `UNIQUE(id_mouvement,
//!     ligne_numero)` : l'inventaire echouait des le deuxieme ecart ;
//!   * `NEW.date_cloture := NOW()` dans un trigger AFTER, ou l'affectation de
//!     NEW n'a aucun effet : la date de cloture n'etait jamais renseignee.
//!
//! Les ecarts positifs et negatifs sont par ailleurs portes par deux types de
//! mouvement distincts (AJUST_INV_POS / AJUST_INV_NEG) : le type `AJUST_INV`
//! "+/-1" du CDC etait instockable sous `CHECK(signe IN (-1,0,1))`.

use crate::auth::Utilisateur;
use crate::db::{arrondi_kg, arrondi_mad, maintenant, Db};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, FromRow)]
struct LigneEcart {
    id_ligne_inv: String,
    code_reference: String,
    lot_fournisseur: Option<String>,
    ecart_kg: f64,
    cmup_mad: Option<f64>,
    /// L'ecart en bobines, quand le comptage les a donnees : il fait le poids
    /// theorique de l'ajustement, donc la variation du lot.
    ecart_bobines: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct ResultatInventaire {
    pub numero_inventaire: String,
    pub lignes_ajustees: usize,
    pub ecart_positif_kg: f64,
    pub ecart_negatif_kg: f64,
    pub impact_valorisation_mad: f64,
    pub mouvements_crees: Vec<String>,
}

/// PREPARE LES LIGNES A COMPTER (13/10/2026) : la photo du stock theorique,
/// prise a la creation de l'inventaire (il n'y a plus d'etape « ouvrir »).
/// Dans la transaction de l'appelant ; l'inventaire reste en brouillon.
/// Rend le nombre de lignes preparees (zero si elles l'etaient deja).
pub async fn preparer(tx: &mut sqlx::PgConnection, id_inventaire: &str) -> AppResult<i64> {
    // VERROUILLE : un double clic preparait deux fois.
    let (statut, magasin, type_inventaire): (String, String, String) = sqlx::query_as(
        "SELECT statut, code_magasin, type_inventaire FROM inventaire
          WHERE id_inventaire = $1 FOR UPDATE",
    )
    .bind(id_inventaire)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("inventaire {id_inventaire}")))?;

    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(format!(
            "Les lignes se preparent sur un inventaire en brouillon (statut actuel : {statut})."
        )));
    }
    let deja: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ligne_inventaire WHERE id_inventaire = $1")
        .bind(id_inventaire)
        .fetch_one(&mut *tx)
        .await?;
    if deja > 0 {
        return Ok(0);
    }

    // Photo du theorique : un inventaire compte ce que la base croit detenir.
    //
    // Le comptage se fait AU LOT pour les references qui en font l'objet : on
    // compte des bobines portant un numero de bain de teinture, pas un total
    // abstrait. Sans cette distinction, l'ajustement genere ensuite serait un
    // mouvement sans lot, que le suivi de lot refuse.
    //
    // LE TYPE D'INVENTAIRE ETAIT IGNORE, et un inventaire GLOBAL ne comptait que
    // ce qui etait deja en stock — exactement comme un TOURNANT. Deux
    // consequences, l'une et l'autre graves :
    //
    //   * UN INVENTAIRE NE POUVAIT RIEN DECOUVRIR. 500 kg poses au fond d'une
    //     allee et ignores de la base ne figuraient sur aucune ligne : on ne
    //     compte que ce qu'on vous demande de compter.
    //   * LE PREMIER INVENTAIRE ETAIT VIDE. Le referentiel a ete charge sans
    //     aucun stock ; l'inventaire initial est precisement ce qui doit le
    //     constituer, et il ouvrait zero ligne.
    //
    // Un inventaire GLOBAL couvre donc TOUT le catalogue actif, avec un theorique
    // a zero la ou la base ne connait rien. TOURNANT et CIBLE gardent le perimetre
    // du stock existant : ce sont des controles, pas des recensements.
    //
    // CE QUI RESTE HORS CHAMP : une reference SUIVIE AU LOT et sans aucun lot en
    // stock. Lui ouvrir une ligne sans lot creerait un ajustement que le suivi de
    // lot refuserait a la cloture. Depuis le 01/10/2026 les fils sont suivis
    // au lot : un lot trouve en rayon se saisit au comptage, qui lui ouvre sa
    // ligne (theorique zero) — voir `saisir_comptage`.
    //
    // LE POIDS D'UNE BOBINE FIGE SUR LA LIGNE EST CELUI DU LOT (2026-10-24a) :
    // `fn_lot_poids_bobine`, le lot sinon la fiche article, jamais 1. C'est lui
    // qui convertit les bobines comptees ; le comptage le relit a son heure.
    //
    // CE QUE GELE L'INVENTAIRE (2026-10-24a) : un GLOBAL, tout le magasin ; un
    // TOURNANT ou un CIBLE, les references de ces lignes (et d'un lot trouve
    // au comptage, des qu'il a sa ligne). Sans aucune ligne, tout le magasin.
    let global = type_inventaire == "GLOBAL";
    let res = sqlx::query(
        "INSERT INTO ligne_inventaire
             (id_inventaire, code_reference, code_magasin, lot_fournisseur, quantite_theorique_kg,
              nb_bobines_theorique, poids_unitaire_theorique_kg)
         SELECT $1, sl.code_reference, sl.code_magasin, sl.lot_fournisseur, sl.quantite_kg,
                sl.nb_bobines, fn_lot_poids_bobine(sl.code_reference, sl.lot_fournisseur)
           FROM stock_lot sl
           JOIN reference r ON r.code_reference = sl.code_reference AND r.suivi_lot = 1
          WHERE sl.code_magasin = $2 AND sl.quantite_kg > 0
         UNION ALL
         SELECT $1, r.code_reference, $2, NULL, COALESCE(sm.quantite_kg, 0),
                sm.nb_bobines, NULLIF(r.poids_bobine_kg, 0)
           FROM reference r
           LEFT JOIN stock_magasin sm ON sm.code_reference = r.code_reference
                                     AND sm.code_magasin   = $2
          WHERE r.suivi_lot = 0
            AND ( ($3 AND r.actif = 1) OR sm.quantite_kg > 0 )",
    )
    .bind(id_inventaire)
    .bind(&magasin)
    .bind(global)
    .execute(&mut *tx)
    .await?;

    Ok(res.rows_affected() as i64)
}

/// Le comptage est-il complet et justifie ? Rend un refus clair sinon. Lu a
/// la validation, et relu a la cloture.
async fn exiger_comptage_complet(tx: &mut sqlx::PgConnection, id_inventaire: &str) -> AppResult<()> {
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ligne_inventaire WHERE id_inventaire = $1")
        .bind(id_inventaire)
        .fetch_one(&mut *tx)
        .await?;
    if total == 0 {
        return Err(AppError::RegleMetier("L'inventaire n'a aucune ligne : rien a valider.".into()));
    }
    let non_comptees: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ligne_inventaire
          WHERE id_inventaire = $1 AND statut_ligne = 'A_TRAITER'",
    )
    .bind(id_inventaire)
    .fetch_one(&mut *tx)
    .await?;
    if non_comptees > 0 {
        return Err(AppError::RegleMetier(format!(
            "{non_comptees} ligne(s) non comptee(s) : comptez-les d'abord."
        )));
    }
    // Un ecart hors tolerance doit etre justifie (CDC G6).
    let injustifiees: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ligne_inventaire
          WHERE id_inventaire = $1
            AND ((ecart_pct IS NOT NULL
                  AND abs(ecart_pct) > (SELECT CAST(valeur_courante AS numeric) FROM parametre
                                         WHERE code_parametre = 'P_TolerEcartPesee'))
                 -- Un theorique nul n'a pas de pourcentage : trouver du stock la
                 -- ou il n'y en avait pas est un ecart, et il s'explique aussi
                 -- (regle 10, reserve de l'audit v4).
                 OR (COALESCE(quantite_theorique_kg, 0) = 0 AND COALESCE(quantite_comptee_kg, 0) > 0))
            AND (motif_ecart IS NULL OR trim(motif_ecart) = '')",
    )
    .bind(id_inventaire)
    .fetch_one(&mut *tx)
    .await?;
    if injustifiees > 0 {
        return Err(AppError::RegleMetier(format!(
            "{injustifiees} ecart(s) hors tolerance sans motif : justification obligatoire."
        )));
    }
    Ok(())
}

/// VALIDER LE COMPTAGE (13/10/2026) : brouillon -> valide. Par un autre compte
/// que ceux qui ont compte (garde en base, l'Administrateur dispense). Rien ne
/// touche encore le stock ; le comptage est fige.
pub async fn valider(db: &Db, user: &Utilisateur, id_inventaire: &str) -> AppResult<String> {
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let (numero, statut): (String, String) = sqlx::query_as(
        "SELECT numero_inventaire, statut FROM inventaire WHERE id_inventaire = $1 FOR UPDATE",
    )
    .bind(id_inventaire)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("inventaire {id_inventaire}")))?;
    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(format!(
            "Seul un inventaire en brouillon se valide (statut actuel : {statut})."
        )));
    }
    exiger_comptage_complet(&mut tx, id_inventaire).await?;
    sqlx::query(
        "UPDATE inventaire
            SET statut = 'VALIDE', id_utilisateur_validation = $2, date_validation = fn_instant($3)
          WHERE id_inventaire = $1",
    )
    .bind(id_inventaire)
    .bind(&user.id)
    .bind(maintenant())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(numero)
}

/// RENVOYER AU COMPTAGE (13/10/2026) : valide -> brouillon, avec un motif.
/// Rien n'a touche le stock ; le comptage redevient saisissable.
pub async fn renvoyer(db: &Db, user: &Utilisateur, id_inventaire: &str, motif: &str) -> AppResult<String> {
    let motif = motif.trim();
    if motif.chars().count() < 5 {
        return Err(AppError::RegleMetier(
            "Le motif du renvoi est obligatoire : dites ce qu'il faut recompter.".into(),
        ));
    }
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let (numero, statut): (String, String) = sqlx::query_as(
        "SELECT numero_inventaire, statut FROM inventaire WHERE id_inventaire = $1 FOR UPDATE",
    )
    .bind(id_inventaire)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("inventaire {id_inventaire}")))?;
    if statut != "VALIDE" {
        return Err(AppError::RegleMetier(format!(
            "Seul un inventaire valide se renvoie au comptage (statut actuel : {statut})."
        )));
    }
    sqlx::query(
        "UPDATE inventaire
            SET statut = 'BROUILLON', motif_renvoi = $2,
                id_utilisateur_validation = NULL, date_validation = NULL
          WHERE id_inventaire = $1",
    )
    .bind(id_inventaire)
    .bind(motif)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(numero)
}

/// ANNULER UN INVENTAIRE (regle 10, 08/10/2026).
///
/// Il n'existait aucune issue a un inventaire ouvert par erreur ou devenu
/// perime : deux inventaires restaient EN_COURS sur le meme magasin, et le
/// seul moyen d'en sortir etait de cloturer — donc d'appliquer des ecarts
/// calcules sur une photo vieille de plusieurs semaines. Un inventaire en
/// brouillon ou en cours n'a encore rien ecrit au stock : l'annuler ne
/// defait aucun mouvement. Le motif est obligatoire et reste sur la fiche ;
/// les lignes comptees restent lisibles.
pub async fn annuler(db: &Db, user: &Utilisateur, id_inventaire: &str, motif: &str) -> AppResult<String> {
    let motif = motif.trim();
    if motif.chars().count() < 5 {
        return Err(AppError::RegleMetier(
            "Le motif d'annulation est obligatoire : dites pourquoi ce comptage ne sera pas clos.".into(),
        ));
    }
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let (numero, statut): (String, String) = sqlx::query_as(
        "SELECT numero_inventaire, statut FROM inventaire WHERE id_inventaire = $1 FOR UPDATE",
    )
    .bind(id_inventaire)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("inventaire {id_inventaire}")))?;

    if statut != "BROUILLON" && statut != "VALIDE" {
        return Err(AppError::RegleMetier(format!(
            "L'inventaire {numero} est {statut} : seul un inventaire en brouillon ou valide s'annule. \
             Un inventaire clos se devalide, apres contre-passation de ses ajustements."
        )));
    }

    sqlx::query(
        "UPDATE inventaire
            SET statut = 'ANNULE', motif_annulation = $2,
                id_utilisateur_annulation = $3, date_annulation = fn_instant($4)
          WHERE id_inventaire = $1",
    )
    .bind(id_inventaire)
    .bind(motif)
    .bind(&user.id)
    .bind(maintenant())
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(numero)
}

/// Cloture l'inventaire et genere les mouvements d'ajustement.
///
/// LE MAGASIN EST GELE PENDANT L'INVENTAIRE (decision du 23/10/2026, garde en
/// base, migrations 2026-10-23g et 2026-10-24a) : de l'ouverture a la cloture ou
/// a l'annulation, aucun mouvement n'y entre ni n'en sort — tout le magasin pour
/// un GLOBAL, les seules references de ses lignes pour un TOURNANT ou un CIBLE
/// (tout le magasin s'il n'a aucune ligne). Seuls passent les ajustements ecrits
/// ici, rattaches a l'inventaire par `mouvement.id_inventaire` ; la base verifie
/// que chaque ligne est un ecart de cet inventaire. Le theorique lu au comptage
/// (`saisir_comptage`, regle 10) ne bouge donc plus jusqu'a la cloture.
pub async fn cloturer(
    db: &Db,
    user: &Utilisateur,
    id_inventaire: &str,
) -> AppResult<ResultatInventaire> {
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // VERROUILLE (08/10/2026) : un double clic sur « Cloturer » lancait deux
    // transactions qui lisaient toutes deux le meme etat et appliquaient deux fois
    // les ecarts. La seconde attend desormais la premiere, puis lit CLOTURE.
    let (numero, statut, magasin): (String, String, String) = sqlx::query_as(
        "SELECT numero_inventaire, statut, code_magasin FROM inventaire
          WHERE id_inventaire = $1 FOR UPDATE",
    )
    .bind(id_inventaire)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("inventaire {id_inventaire}")))?;

    if statut != "VALIDE" {
        return Err(AppError::RegleMetier(format!(
            "Seul un inventaire valide se cloture (statut actuel : {statut}) : faites d'abord valider le comptage."
        )));
    }
    // Relu sous verrou ; la base fige deja le comptage d'un inventaire valide.
    exiger_comptage_complet(&mut tx, id_inventaire).await?;

    let ecarts: Vec<LigneEcart> = sqlx::query_as(
        "SELECT li.id_ligne_inv, li.code_reference, li.lot_fournisseur,
                li.ecart_kg::float8 AS ecart_kg, sm.cmup_mad::float8 AS cmup_mad,
                (li.nb_bobines_comptees - li.nb_bobines_theorique) AS ecart_bobines
           FROM ligne_inventaire li
           LEFT JOIN stock_magasin sm ON sm.code_reference = li.code_reference
                                     AND sm.code_magasin   = li.code_magasin
          WHERE li.id_inventaire = $1
            AND li.ecart_kg IS NOT NULL AND li.ecart_kg <> 0
          ORDER BY li.code_reference",
    )
    .bind(id_inventaire)
    .fetch_all(&mut *tx)
    .await?;

    let horodatage = maintenant();
    let mut mouvements = Vec::new();
    let mut positif = 0.0_f64;
    let mut negatif = 0.0_f64;
    let mut impact = 0.0_f64;

    // Deux mouvements au plus : un pour les excedents, un pour les manquants.
    for (signe, type_mvt, suffixe) in [
        (1.0_f64, "AJUST_INV_POS", "P"),
        (-1.0_f64, "AJUST_INV_NEG", "N"),
    ] {
        let concernees: Vec<&LigneEcart> = ecarts
            .iter()
            .filter(|l| l.ecart_kg.signum() == signe)
            .collect();
        if concernees.is_empty() {
            continue;
        }

        let id_mouvement = uuid::Uuid::new_v4().to_string();
        // Apres une devalidation (ajustements contre-passes), la recloture
        // reprenait le meme numero et butait sur l'unicite : on suffixe.
        let mut numero_mouvement = format!("MVT-INV-{numero}-{suffixe}");
        let mut version = 1;
        while sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM mouvement WHERE numero_mouvement = $1",
        )
        .bind(&numero_mouvement)
        .fetch_one(&mut *tx)
        .await?
            > 0
        {
            version += 1;
            numero_mouvement = format!("MVT-INV-{numero}-{suffixe}{version}");
        }

        // `date_mouvement` est volontairement laissee a la valeur par defaut de
        // la colonne : c'est la base qui horodate. Fournir un instant calcule
        // cote Rust le fait comparer, par le trigger C06, au « maintenant » de
        // SQLite — deux horloges et deux troncatures a la milliseconde, donc un
        // refus intermittent pour datation dans le futur.
        sqlx::query(
            // `id_inventaire` RATTACHE L'AJUSTEMENT A SON INVENTAIRE : c'est ce
            // qui le laisse passer sur un magasin gele (2026-10-23g).
            "INSERT INTO mouvement
                 (id_mouvement, numero_mouvement, code_type_mvt,
                  code_magasin, code_motif, reference_document, id_utilisateur, id_inventaire)
             VALUES ($1, $2, $3, $4, 'INVENTAIRE', $5, $6, $7)",
        )
        .bind(&id_mouvement)
        .bind(&numero_mouvement)
        .bind(type_mvt)
        .bind(&magasin)
        .bind(&numero)
        .bind(&user.id)
        .bind(id_inventaire)
        .execute(&mut *tx)
        .await?;

        // Numerotation sequentielle : c'est precisement ce que le trigger J6 du
        // CDC ne faisait pas (valeur 1 codee en dur).
        for (i, l) in concernees.iter().enumerate() {
            let quantite = arrondi_kg(l.ecart_kg.abs());

            sqlx::query(
                "INSERT INTO ligne_mouvement
                     (id_mouvement, ligne_numero, code_reference, quantite_kg,
                      lot_fournisseur, code_motif_ligne, nb_bobines)
                 VALUES ($1, $2, $3, $4, $5, 'R6', $6)",
            )
            .bind(&id_mouvement)
            .bind((i + 1) as i64)
            .bind(&l.code_reference)
            .bind(quantite)
            .bind(&l.lot_fournisseur)
            // Les bobines ne comptent que si elles vont dans le meme sens que
            // les kilos : sinon l'ecart de poids par bobine n'a pas de sens.
            .bind(l.ecart_bobines.filter(|b| *b != 0 && (*b > 0) == (signe > 0.0)).map(|b| b.abs()))
            .execute(&mut *tx)
            .await?;

            let valeur = arrondi_mad(l.ecart_kg * l.cmup_mad.unwrap_or(0.0));
            impact += valeur;
            if signe > 0.0 {
                positif += quantite;
            } else {
                negatif += quantite;
            }

            sqlx::query(
                "UPDATE ligne_inventaire
                    SET statut_ligne = 'AJUSTE', ecart_mad = $2
                  WHERE id_ligne_inv = $1",
            )
            .bind(&l.id_ligne_inv)
            .bind(valeur)
            .execute(&mut *tx)
            .await?;
        }

        mouvements.push(numero_mouvement);
    }

    sqlx::query(
        "UPDATE stock_magasin SET date_dernier_inventaire = fn_instant($2) WHERE code_magasin = $1",
    )
    .bind(&magasin)
    .bind(&horodatage)
    .execute(&mut *tx)
    .await?;

    // date_cloture est renseignee explicitement : le CHECK de la table l'exige,
    // et le trigger AFTER du CDC ne pouvait pas le faire.
    sqlx::query(
        "UPDATE inventaire SET statut = 'CLOTURE', date_cloture = fn_instant($2) WHERE id_inventaire = $1",
    )
    .bind(id_inventaire)
    .bind(&horodatage)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(ResultatInventaire {
        numero_inventaire: numero,
        lignes_ajustees: ecarts.len(),
        ecart_positif_kg: arrondi_kg(positif),
        ecart_negatif_kg: arrondi_kg(negatif),
        impact_valorisation_mad: arrondi_mad(impact),
        mouvements_crees: mouvements,
    })
}
