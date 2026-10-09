//! Generation du plan d'achat a partir du MRP (CDC E5 / F7).
//!
//! Le calcul (quantite avec MOQ et multiple, tiering, sourcing, prix retenu) est
//! porte par la vue `v_plan_achat`. Le service la materialise en propositions
//! revisables.
//!
//! `source_prix` est propagee jusque dans la table : quand aucune reception
//! reelle n'existe encore, le prix vient du catalogue. RG-08 interdit le repli
//! SILENCIEUX sur le prix catalogue, pas le repli trace (ADR-001 D-02) — sans
//! quoi le budget a engager vaudrait 0 au demarrage.

use crate::auth::Utilisateur;
use crate::db::{maintenant, Db};
use crate::error::AppResult;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ResultatPlanAchat {
    pub propositions_generees: i64,
    pub propositions_ignorees: i64,
    /// Propositions arbitrees sur une reference equivalente, conservees telles
    /// quelles. Les compter separement evite de laisser croire que le recalcul a
    /// tout refait alors qu'il en a deliberement laisse de cote.
    pub propositions_arbitrees: i64,
    /// Propositions retouchees a la main et protegees du recalcul. Comptees a
    /// part : « 78 propositions generees » sans cette ligne laisserait croire
    /// que le calcul a tout refait, alors qu'il a deliberement laisse en place
    /// le travail de l'acheteur.
    pub propositions_figees: i64,
    pub budget_total_mad: f64,
    pub tier1: i64,
    pub date_generation: String,
}

/// Regenere les propositions d'achat.
///
/// Les propositions deja transformees en bon de commande (`COMMANDE`) ou
/// ecartees (`IGNORE`) sont conservees : elles portent une decision humaine.
/// Seules les propositions ouvertes sont remplacees.
pub async fn generer(
    db: &Db,
    user: &Utilisateur,
    id_plan: Option<&str>,
) -> AppResult<ResultatPlanAchat> {
    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let ignorees: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plan_achat WHERE statut IN ('COMMANDE','IGNORE')",
    )
    .fetch_one(&mut *tx)
    .await?;

    // Les propositions ARBITREES survivent au recalcul. Une bascule sur une
    // reference equivalente est une decision humaine, prise sur des elements que
    // le MRP ignore — un stock dormant, un delai plus court, un prix negocie.
    // La balayer a chaque generation obligerait a la reprendre indefiniment, et
    // l'acheteur cesserait de s'en servir.
    let arbitrees: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plan_achat
          WHERE statut IN ('PROPOSE','EN_REVISION','VALIDE')
            AND code_reference_origine IS NOT NULL",
    )
    .fetch_one(&mut *tx)
    .await?;

    // Les propositions FIGEES survivent pour la meme raison, et cette raison est
    // plus courante encore : l'acheteur arrondit a la palette, avance une date,
    // negocie un prix. Avant le figement, retoucher une proposition la faisait
    // passer en EN_REVISION — precisement l'un des statuts que la purge
    // ci-dessous supprimait. Le travail etait donc detruit au recalcul suivant,
    // en silence.
    let figees: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plan_achat
          WHERE statut IN ('PROPOSE','EN_REVISION','VALIDE')
            AND figee = 1",
    )
    .fetch_one(&mut *tx)
    .await?;

    // LA PURGE SE JOURNALISE EN UNE LIGNE (audit v5, T10) : une ligne
    // d'audit par proposition remplacee noyait le journal a chaque calcul. Le
    // declencheur se tait sous le drapeau ; le resume dit combien.
    sqlx::query("SELECT set_config('gestionfil.purge_plan', 'on', true)")
        .execute(&mut *tx)
        .await?;
    let purgees = sqlx::query(
        "DELETE FROM plan_achat
          WHERE statut IN ('PROPOSE','EN_REVISION','VALIDE')
            AND code_reference_origine IS NULL
            AND figee = 0",
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    sqlx::query("SELECT set_config('gestionfil.purge_plan', '', true)")
        .execute(&mut *tx)
        .await?;
    if purgees > 0 {
        sqlx::query(
            "INSERT INTO audit_log (table_concernee, operation, id_enregistrement, anciennes_valeurs,
                                    id_utilisateur, adresse_ip, session_id)
             VALUES ('plan_achat', 'DELETE', 'RECALCUL',
                     jsonb_build_object('propositions_remplacees', $1::bigint)::text,
                     current_setting('gestionfil.id_utilisateur', true),
                     current_setting('gestionfil.adresse_ip', true),
                     current_setting('gestionfil.session_id', true))",
        )
        .bind(purgees as i64)
        .execute(&mut *tx)
        .await?;
    }

    let horodatage = maintenant();

    // La vue exclut deja les quantites nulles. On ecarte en plus les references
    // dont une proposition est deja engagee, pour ne pas commander deux fois.
    let res = sqlx::query(
        "INSERT INTO plan_achat
             (date_generation, id_plan, code_reference, quantite_suggeree_kg,
              unite_saisie, quantite_suggeree_unite, code_fournisseur,
              prix_estime_mad, source_prix, date_besoin_prevue, urgence,
              risque_identifie, action_recommandee, statut,
              -- CE QU'ON IRA NEGOCIER. On ne discute pas en dirhams avec un
              -- fournisseur turc : le bon de commande se libelle dans SA
              -- devise. La proposition porte donc les deux, et le taux du jour
              -- avec elles — sans quoi le montant en MAD deviendrait
              -- irreproductible des que le taux bouge.
              code_devise, prix_devise, montant_devise, taux_devise,
              palettes_a_commander)
         SELECT $1, $2, pa.code_reference, pa.qte_a_commander_kg,
                pa.unite_catalogue, pa.qte_a_commander_unite, pa.code_fournisseur,
                pa.prix_estime_mad, pa.source_prix, pa.date_besoin_prevue, pa.tier,
                pa.risque_sourcing,
                CASE pa.statut
                    WHEN 'RUPTURE'   THEN 'Commander immediatement'
                    WHEN 'CRITIQUE'  THEN 'Commander sous 7 jours'
                    WHEN 'ATTENTION' THEN 'Planifier la commande'
                    ELSE 'Reapprovisionnement normal'
                END,
                'PROPOSE',
                pa.devise, pa.prix_devise, pa.montant_devise, pa.taux_devise,
                pa.palettes_a_commander
           FROM v_plan_achat pa
          -- UNE REFERENCE COMMANDEE SE REPROPOSE (06/10/2026). Elle etait
          -- ecartee a vie des sa premiere commande. Or un bon VALIDE, ENVOYE ou
          -- LIVRE_PARTIEL est deja deduit par l'en-cours de la vue, et un bon
          -- CLOTURE est en stock : ce qui reste a proposer est un vrai besoin.
          -- Seul un bon pas encore valide (BROUILLON, EN_ATTENTE_VALIDATION),
          -- que l'en-cours ne compte pas, ecarte encore la reference.
          --
          -- UNE PROPOSITION ECARTEE EXPIRE (regle 17, 08/10/2026). Ecartee, elle
          -- masquait la reference A VIE : le besoin ne revenait jamais. Au-dela
          -- de P_DureeEcartJours (90 j), elle cesse de masquer ; elle reste en
          -- base, jamais supprimee, marquee expiree.
          WHERE NOT EXISTS (
                SELECT 1 FROM plan_achat pa2
                 WHERE pa2.code_reference = pa.code_reference
                   AND ((pa2.statut = 'IGNORE'
                         AND substr(COALESCE(pa2.date_ecartee, pa2.date_generation), 1, 10)::date
                             > current_date - COALESCE((SELECT CAST(valeur_courante AS integer) FROM parametre
                                                         WHERE code_parametre = 'P_DureeEcartJours'), 90))
                        OR (pa2.statut = 'COMMANDE'
                            AND EXISTS (SELECT 1 FROM bon_commande bc
                                         WHERE bc.id_bc = pa2.id_bc_genere
                                           AND bc.statut IN ('BROUILLON','EN_ATTENTE_VALIDATION')))))
            -- Une proposition ARBITREE couvre deux references a la fois : celle
            -- qu'on achetera, et celle dont le besoin a ete reporte. Les deux
            -- doivent etre ecartees ici. Oublier la seconde recreerait le besoin
            -- d'origine a chaque recalcul, et l'on commanderait les deux.
            AND NOT EXISTS (
                SELECT 1 FROM plan_achat pa3
                 WHERE pa3.statut IN ('PROPOSE','EN_REVISION','VALIDE')
                   AND pa3.code_reference_origine IS NOT NULL
                   AND (pa3.code_reference        = pa.code_reference
                     OR pa3.code_reference_origine = pa.code_reference))
            -- Une reference deja couverte par une ligne FIGEE ne se repropose
            -- pas : l'index ux_plan_achat_ouvert refuserait le doublon, et la
            -- generation entiere echouerait sur une contrainte que l'acheteur
            -- ne peut pas comprendre. Ce que le calcul a de nouveau a dire sur
            -- cette reference se lit dans l'ecart affiche sur la ligne figee.
            AND NOT EXISTS (
                SELECT 1 FROM plan_achat pa4
                 WHERE pa4.statut IN ('PROPOSE','EN_REVISION','VALIDE')
                   AND pa4.figee = 1
                   AND pa4.code_reference = pa.code_reference)",
    )
    .bind(&horodatage)
    .bind(id_plan)
    .execute(&mut *tx)
    .await?;

    let (budget, tier1): (Option<f64>, i64) = sqlx::query_as(
        // COUNT FILTER et non SUM(CASE) : sans proposition, une somme vaut NULL,
        // que le decodage en entier refusait — « erreur interne » (audit v3-v4).
        "SELECT SUM(montant_total_mad)::float8, COUNT(*) FILTER (WHERE urgence = 'TIER 1')
           FROM plan_achat WHERE statut = 'PROPOSE'",
    )
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(ResultatPlanAchat {
        propositions_generees: res.rows_affected() as i64,
        propositions_ignorees: ignorees,
        propositions_arbitrees: arbitrees,
        propositions_figees: figees,
        budget_total_mad: crate::db::arrondi_mad(budget.unwrap_or(0.0)),
        tier1,
        date_generation: horodatage,
    })
}

#[derive(Debug, Serialize)]
pub struct BonGenere {
    pub id_bc: String,
    pub numero_bc: String,
    pub code_fournisseur: String,
    pub lignes: i64,
    pub montant_total_mad: f64,
}

#[derive(Debug, Serialize)]
pub struct ResultatConversion {
    pub bons: Vec<BonGenere>,
    pub propositions_converties: i64,
}

/// Convertit des propositions d'achat en bons de commande, un par fournisseur.
///
/// La proposition est une photo jetable, le bon de commande un engagement. La
/// conversion est le passage de l'un a l'autre, et elle laisse une trace dans
/// les deux sens : la proposition passe a COMMANDE et pointe son bon, la ligne
/// du bon retient le besoin qui l'a justifiee.
///
/// Ce besoin fige sert de repere : quand la composition d'une qualite change et
/// que le besoin tombe, l'ecran compare ce qui justifiait la ligne a ce que le
/// MRP dit aujourd'hui. Rien n'est stocke comme alerte — la comparaison se fait
/// a la lecture, donc elle ne peut pas etre perimee.
///
/// Le bon nait en BROUILLON : convertir n'est pas commander. L'acheteur negocie,
/// ajuste, puis soumet a validation.
pub async fn convertir(
    db: &Db,
    user: &Utilisateur,
    propositions: Option<&[String]>,
    cibles: Option<&std::collections::HashMap<String, String>>,
) -> AppResult<ResultatConversion> {
    use crate::error::AppError;

    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // Les propositions retenues : celles demandees, ou toutes celles ouvertes.
    // COMMANDE et IGNORE sont exclues — l'une engage deja, l'autre a ete ecartee.
    // `= ANY($1)` et non des `?` a la SQLite ; quantites et prix en `::float8`,
    // sans quoi le decodage des NUMERIC echouait. « Commander » ne marchait pas.
    let ouvertes: Vec<(String, String, f64, f64, Option<String>)> = match propositions {
        Some(ids) if !ids.is_empty() => {
            sqlx::query_as(
                "SELECT id_proposition, code_fournisseur, quantite_suggeree_kg::float8,
                        prix_estime_mad::float8, date_besoin_prevue
                   FROM plan_achat
                  WHERE statut IN ('PROPOSE','EN_REVISION','VALIDE')
                    AND id_proposition = ANY($1)
                  ORDER BY code_fournisseur, code_reference",
            )
            .bind(ids)
            .fetch_all(&mut *tx)
            .await?
        }
        _ => {
            sqlx::query_as(
                "SELECT id_proposition, code_fournisseur, quantite_suggeree_kg::float8,
                        prix_estime_mad::float8, date_besoin_prevue
                   FROM plan_achat
                  WHERE statut IN ('PROPOSE','EN_REVISION','VALIDE')
                  ORDER BY code_fournisseur, code_reference",
            )
            .fetch_all(&mut *tx)
            .await?
        }
    };

    if ouvertes.is_empty() {
        return Err(AppError::RegleMetier(
            "Aucune proposition ouverte a convertir.".into(),
        ));
    }

    let mut converties = 0i64;
    // (fournisseur, id_bc) dans l'ordre d'ouverture. On retient l'identifiant
    // rendu par l'insertion plutot que de le rechercher ensuite : deux bons du
    // meme fournisseur ouverts le meme jour seraient indiscernables.
    let mut ouverts: Vec<(String, String)> = Vec::new();

    for (id_prop, fournisseur, qte_kg, prix_mad, date_besoin) in &ouvertes {
        // Un bon par fournisseur : la liste est triee, on ouvre a chaque rupture.
        let id_bc = match ouverts.last() {
            Some((f, id)) if f == fournisseur => id.clone(),
            _ => {
                // UN BON EXISTANT, si l'acheteur l'a designe : on le complete
                // au lieu d'en ouvrir un second pour le meme fournisseur.
                let id = match cibles.and_then(|c| c.get(fournisseur)) {
                    Some(id_bc) => {
                        let (frs, statut, numero): (String, String, String) = sqlx::query_as(
                            "SELECT code_fournisseur, statut, numero_bc FROM bon_commande
                              WHERE id_bc = $1 FOR UPDATE",
                        )
                        .bind(id_bc)
                        .fetch_optional(&mut *tx)
                        .await?
                        .ok_or_else(|| AppError::Introuvable(format!("bon de commande {id_bc}")))?;
                        if &frs != fournisseur {
                            return Err(AppError::RegleMetier(format!(
                                "Le bon {numero} est d'un autre fournisseur ({frs}) : il ne recoit pas les lignes de {fournisseur}."
                            )));
                        }
                        if statut != "BROUILLON" && statut != "EN_ATTENTE_VALIDATION" {
                            return Err(AppError::RegleMetier(format!(
                                "Le bon {numero} est {statut} : il ne se complete plus. Choisissez un brouillon ou un nouveau bon."
                            )));
                        }
                        id_bc.clone()
                    }
                    None => ouvrir_bon(&mut tx, user, fournisseur, date_besoin.as_deref()).await?,
                };
                ouverts.push((fournisseur.clone(), id.clone()));
                id
            }
        };

        // Le prix de la proposition est en MAD ; le bon s'exprime dans la devise
        // du fournisseur, au taux engage sur ce bon.
        let taux: f64 =
            sqlx::query_scalar(
            "SELECT taux_change_engage::float8 FROM bon_commande WHERE id_bc = $1",
        )
                .bind(&id_bc)
                .fetch_one(&mut *tx)
                .await?;

        let numero: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(ligne_numero), 0) + 1 FROM ligne_bc WHERE id_bc = $1",
        )
        .bind(&id_bc)
        .fetch_one(&mut *tx)
        .await?;

        // La commande se passe en kg : c'est l'unite du besoin, et la seule dont
        // le facteur vaut 1 pour toute reference.
        sqlx::query(
            "INSERT INTO ligne_bc
                 (id_bc, ligne_numero, code_reference, designation, unite_commande,
                  facteur_kg, quantite_commandee_unite, quantite_commandee_kg,
                  prix_unitaire_devise, code_devise, date_livraison_prevue,
                  id_proposition, besoin_kg_origine)
             SELECT $1, $2, pa.code_reference, r.designation, 'kg',
                    1.0, pa.quantite_suggeree_kg, pa.quantite_suggeree_kg,
                    ROUND(pa.prix_estime_mad / $3::numeric, 6), bc.code_devise, pa.date_besoin_prevue,
                    pa.id_proposition,
                    COALESCE((SELECT b.besoin_12m_kg FROM v_besoin_12m b
                               WHERE b.code_reference = pa.code_reference), 0)
               FROM plan_achat pa
               JOIN reference r  ON r.code_reference = pa.code_reference
               JOIN bon_commande bc ON bc.id_bc = $1
              WHERE pa.id_proposition = $4",
        )
        .bind(&id_bc)
        .bind(numero)
        .bind(taux)
        .bind(id_prop)
        .execute(&mut *tx)
        .await?;

        // La protection tombe avec la conversion : ce que la ligne devait
        // proteger est desormais dans le bon de commande, ou d'autres regles le
        // gardent. Laisser le drapeau leve donnerait une proposition COMMANDE et
        // « protegee du recalcul » — un etat qui ne veut rien dire, et que les
        // ecrans compteraient parmi les arbitrages en cours.
        sqlx::query(
            "UPDATE plan_achat SET statut = 'COMMANDE', id_bc_genere = $2, figee = 0
              WHERE id_proposition = $1",
        )
        .bind(id_prop)
        .bind(&id_bc)
        .execute(&mut *tx)
        .await?;

        converties += 1;
        let _ = (qte_kg, prix_mad);
    }

    // Totaux, une fois toutes les lignes posees.
    let mut bons: Vec<BonGenere> = Vec::new();
    for (fournisseur, id_bc) in ouverts {
        recalculer_totaux(&mut tx, &id_bc).await?;
        let (numero_bc, lignes, montant): (String, i64, Option<f64>) = sqlx::query_as(
            "SELECT bc.numero_bc,
                    (SELECT COUNT(*) FROM ligne_bc l WHERE l.id_bc = bc.id_bc),
                    bc.montant_total_mad::float8
               FROM bon_commande bc WHERE bc.id_bc = $1",
        )
        .bind(&id_bc)
        .fetch_one(&mut *tx)
        .await?;
        bons.push(BonGenere {
            id_bc,
            numero_bc,
            code_fournisseur: fournisseur,
            lignes,
            montant_total_mad: crate::db::arrondi_mad(montant.unwrap_or(0.0)),
        });
    }

    tx.commit().await?;
    Ok(ResultatConversion { bons, propositions_converties: converties })
}

/// Ouvre un bon de commande en brouillon pour un fournisseur.
async fn ouvrir_bon(
    tx: &mut sqlx::PgConnection,
    user: &Utilisateur,
    fournisseur: &str,
    date_besoin: Option<&str>,
) -> AppResult<String> {
    use crate::error::AppError;

    let (devise, conditions): (String, Option<String>) = sqlx::query_as(
        "SELECT COALESCE(code_devise, 'MAD'), conditions_paiement
           FROM fournisseur WHERE code_fournisseur = $1",
    )
    .bind(fournisseur)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("fournisseur {fournisseur}")))?;

    let taux: f64 = sqlx::query_scalar(
        "SELECT taux::float8 FROM taux_change
          WHERE code_devise = $1 AND to_char(current_date, 'YYYY-MM-DD') >= substr(date_debut, 1, 10)
            AND (date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(date_fin, 1, 10))
          ORDER BY date_debut DESC LIMIT 1",
    )
    .bind(&devise)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::RegleMetier(format!("Aucun taux de change en vigueur pour {devise}.")))?;

    // Le meme compteur que la saisie d'un bon (audit v4) : deux conversions
    // simultanees ne se disputent plus un numero.
    let numero = crate::routes::stock::numeroter(&mut *tx, "bon_commande", "numero_bc", "BC").await?;

    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO bon_commande
             (id_bc, numero_bc, code_fournisseur, code_devise, taux_change_engage,
              date_taux_engage, date_livraison_prevue, conditions_paiement,
              motif_creation, montant_total_devise, montant_total_mad,
              id_utilisateur_creation)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'MRP',0,0,$9)",
    )
    .bind(&id)
    .bind(&numero)
    .bind(fournisseur)
    .bind(&devise)
    .bind(taux)
    .bind(maintenant())
    .bind(date_besoin)
    .bind(&conditions)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    Ok(id)
}

/// Totaux de l'entete a partir des lignes, au taux engage sur le bon.
async fn recalculer_totaux(tx: &mut sqlx::PgConnection, id: &str) -> AppResult<()> {
    sqlx::query(
        "UPDATE bon_commande
            SET montant_total_devise = (SELECT COALESCE(SUM(total_ligne_devise), 0)
                                          FROM ligne_bc WHERE id_bc = $1),
                montant_total_mad    = ROUND((SELECT COALESCE(SUM(total_ligne_devise), 0)
                                                FROM ligne_bc WHERE id_bc = $1)
                                             * taux_change_engage, 2)
          WHERE id_bc = $1",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    Ok(())
}
