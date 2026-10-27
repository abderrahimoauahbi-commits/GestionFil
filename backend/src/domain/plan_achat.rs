//! Generation du plan d'achat (CDC E5 / F7), et conversion en bons de commande.
//!
//! LA QUANTITE ET LES DATES VIENNENT DU MOTEUR DE COUVERTURE (basculement du
//! 27/10/2026, `domain/couverture.rs`) : la premiere proposition de chaque
//! reference — quantite proposee (besoin du plan seul, securite, minimum de
//! commande, arrondi au multiple), D comme date de besoin, date limite de
//! commande, urgence deduite de cette date limite. Avant, elles venaient de la
//! vue `v_plan_achat`, qui ne sert plus qu'aux indicateurs de l'onglet Situation.
//!
//! TOUT LE RESTE EST INCHANGE : le prix (dernier achat chez le fournisseur, puis
//! catalogue converti, puis CMUP — memes formules que `v_plan_achat`), la devise,
//! l'unite, le fournisseur de la fiche, le risque de sourcing ; et le cycle de vie
//! (figer, ecarter, arbitrer, convertir ; la regeneration garde les propositions
//! figees, arbitrees, commandees, ecartees).
//!
//! `source_prix` est propagee jusque dans la table : quand aucune reception
//! reelle n'existe encore, le prix vient du catalogue. RG-08 interdit le repli
//! SILENCIEUX sur le prix catalogue, pas le repli trace (ADR-001 D-02) — sans
//! quoi le budget a engager vaudrait 0 au demarrage.

use crate::auth::Utilisateur;
use crate::db::{maintenant, Db};
use crate::error::{AppError, AppResult};
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
    /// Les references que le moteur propose mais qui ne peuvent pas devenir une
    /// proposition d'achat : sans fournisseur sur la fiche, ou sans aucun prix
    /// (ni dernier achat, ni catalogue, ni CMUP). Dites, jamais ecartees en silence
    /// (27/10/2026 : l'ancien calcul echouait en entier sur la premiere).
    pub references_non_proposees: Vec<String>,
    /// Generation d'UNE reference (bouton « Commander » de l'onglet À commander) :
    /// la proposition ouverte qui la porte desormais — la nouvelle, ou celle que
    /// l'acheteur avait figee ou arbitree.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id_proposition: Option<String>,
}

/// Les references proposees par le moteur, avec ce que la fiche donne pour les
/// acheter : prix (memes formules et meme ordre que `v_plan_achat`), devise,
/// unite, fournisseur. Les cinq tableaux du moteur sont les parametres `$n` a
/// `$n+4`.
fn source_moteur(n: usize) -> String {
    format!(
        "WITH moteur AS (
        SELECT * FROM unnest(${}::text[], ${}::numeric[], ${}::date[], ${}::date[], ${}::numeric[])
               AS m(code_reference, qte_kg, date_d, date_limite, complement_kg)

    ), src AS (
        SELECT m.code_reference, m.qte_kg, m.date_d, m.date_limite, m.complement_kg,
               r.code_fournisseur, r.unite_catalogue, r.facteur_kg,
               r.code_devise_catalogue AS devise, r.prix_catalogue_kg, tc.taux,
               COALESCE(fn_dernier_prix_achat_mad(r.code_reference, r.code_fournisseur),
                        round(r.prix_catalogue_kg * tc.taux, 4), r.cmup_mad) AS prix_mad,
               CASE WHEN fn_dernier_prix_achat_mad(r.code_reference, r.code_fournisseur) IS NOT NULL THEN 'DERNIER_ACHAT'
                    WHEN r.prix_catalogue_kg IS NOT NULL AND tc.taux IS NOT NULL THEN 'CATALOGUE'
                    WHEN r.cmup_mad IS NOT NULL THEN 'CMUP'
                    ELSE 'AUCUN' END AS source_prix
          FROM moteur m
          JOIN reference r ON r.code_reference = m.code_reference
          -- Le taux du jour de la devise du catalogue : UN seul (le plus recent en
          -- vigueur), la ou la jointure de la vue en aurait pris plusieurs.
          LEFT JOIN LATERAL (
                SELECT t.taux FROM taux_change t
                 WHERE t.code_devise = r.code_devise_catalogue
                   AND to_char(current_date, 'YYYY-MM-DD') >= substr(t.date_debut::text, 1, 10)
                   AND (t.date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(t.date_fin::text, 1, 10))
                 ORDER BY t.date_debut DESC LIMIT 1) tc ON true
    )",
        n,
        n + 1,
        n + 2,
        n + 3,
        n + 4
    )
}

/// Regenere les propositions d'achat, toutes (`reference = None`) ou celle d'une
/// seule reference (le bouton « Commander » de l'onglet À commander).
///
/// Les propositions deja transformees en bon de commande (`COMMANDE`) ou
/// ecartees (`IGNORE`) sont conservees : elles portent une decision humaine.
/// Seules les propositions ouvertes, ni figees ni arbitrees, sont remplacees.
pub async fn generer(
    db: &Db,
    user: &Utilisateur,
    id_plan: Option<&str>,
    reference: Option<&str>,
) -> AppResult<ResultatPlanAchat> {
    // LE MOTEUR, avant la transaction (il ne fait que lire) : la premiere
    // proposition de chaque reference, celle que l'onglet « À commander » montre.
    let (aujourdhui, moteur) = crate::routes::couverture::premieres_propositions(db, reference).await?;
    let codes: Vec<String> = moteur.iter().map(|p| p.code_reference.clone()).collect();
    let quantites: Vec<f64> = moteur.iter().map(|p| p.quantite_kg).collect();
    let dates_d: Vec<chrono::NaiveDate> = moteur.iter().map(|p| p.date_disponibilite).collect();
    let limites: Vec<chrono::NaiveDate> = moteur.iter().map(|p| p.date_limite_commande).collect();
    let complements: Vec<f64> = moteur.iter().map(|p| p.complement_multiple_kg).collect();

    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let ignorees: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plan_achat WHERE statut IN ('COMMANDE','IGNORE')
            AND ($1::text IS NULL OR code_reference = $1)",
    )
    .bind(reference)
    .fetch_one(&mut *tx)
    .await?;

    // Les propositions ARBITREES survivent au recalcul. Une bascule sur une
    // reference equivalente est une decision humaine, prise sur des elements que
    // le calcul ignore — un stock dormant, un delai plus court, un prix negocie.
    // La balayer a chaque generation obligerait a la reprendre indefiniment, et
    // l'acheteur cesserait de s'en servir.
    let arbitrees: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plan_achat
          WHERE statut IN ('PROPOSE','EN_REVISION','VALIDE')
            AND code_reference_origine IS NOT NULL
            AND ($1::text IS NULL OR code_reference = $1 OR code_reference_origine = $1)",
    )
    .bind(reference)
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
            AND figee = 1
            AND ($1::text IS NULL OR code_reference = $1)",
    )
    .bind(reference)
    .fetch_one(&mut *tx)
    .await?;

    // LA PURGE SE JOURNALISE EN UNE LIGNE (audit v5, T10) : une ligne
    // d'audit par proposition remplacee noyait le journal a chaque calcul. Le
    // declencheur se tait sous le drapeau ; le resume dit combien. Pour une
    // seule reference, le declencheur journalise la ligne lui-meme.
    if reference.is_none() {
        sqlx::query("SELECT set_config('gestionfil.purge_plan', 'on', true)")
            .execute(&mut *tx)
            .await?;
    }
    let purgees = sqlx::query(
        "DELETE FROM plan_achat
          WHERE statut IN ('PROPOSE','EN_REVISION','VALIDE')
            AND code_reference_origine IS NULL
            AND figee = 0
            AND ($1::text IS NULL OR code_reference = $1)",
    )
    .bind(reference)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if reference.is_none() {
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
    }

    let horodatage = maintenant();

    // Ce que le moteur propose mais qui ne peut pas devenir une proposition : dit.
    let references_non_proposees: Vec<String> = sqlx::query_scalar(&format!(
        "{}
         SELECT code_reference || CASE WHEN code_fournisseur IS NULL THEN ' (sans fournisseur sur la fiche)'
                                       ELSE ' (sans prix : ni dernier achat, ni catalogue, ni CMUP)' END
           FROM src
          WHERE code_fournisseur IS NULL OR COALESCE(prix_mad, 0) <= 0
          ORDER BY 1",
        source_moteur(1)
    ))
    .bind(&codes)
    .bind(&quantites)
    .bind(&dates_d)
    .bind(&limites)
    .bind(&complements)
    .fetch_all(&mut *tx)
    .await?;

    // L'URGENCE SE DEDUIT DE LA DATE LIMITE DE COMMANDE (27/10/2026) : depassee ou
    // aujourd'hui = TIER 1 (commander immediatement) ; sous 7 jours = TIER 2 ;
    // sous 30 jours = TIER 3 ; au-dela = TIER 4.
    let res = sqlx::query(&format!(
        "{}
         INSERT INTO plan_achat
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
              -- Les palettes ne sont qu'un equivalent (decision du 21/10/2026 :
              -- jamais de palette pleine par defaut) : l'acheteur choisit kg ou
              -- palettes dans « Commander ». Le complement est ce que l'arrondi au
              -- multiple de la fiche a ajoute.
              palettes_a_commander, complement_palette_kg, date_limite_commande)
         SELECT fn_instant($1), $2, s.code_reference, s.qte_kg,
                s.unite_catalogue,
                CASE WHEN s.facteur_kg > 0 THEN round(s.qte_kg / s.facteur_kg, 4) END,
                s.code_fournisseur,
                s.prix_mad, s.source_prix, s.date_d, u.urgence,
                CASE WHEN (SELECT COUNT(*)
                             FROM reference_groupe_equiv rge1
                             JOIN reference_groupe_equiv rge2 ON rge2.code_groupe_equiv = rge1.code_groupe_equiv
                                                             AND rge2.code_reference <> rge1.code_reference
                                                             AND rge2.actif = 1
                             JOIN reference r2 ON r2.code_reference = rge2.code_reference AND r2.actif = 1
                             JOIN reference r1 ON r1.code_reference = rge1.code_reference
                            WHERE rge1.code_reference = s.code_reference AND rge1.actif = 1
                              AND r2.code_fournisseur IS DISTINCT FROM r1.code_fournisseur) > 0
                     THEN 'MULTI-SOURCE' ELSE 'MONO-SOURCE' END,
                CASE u.urgence
                    WHEN 'TIER 1' THEN 'Commander immediatement'
                    WHEN 'TIER 2' THEN 'Commander sous 7 jours'
                    WHEN 'TIER 3' THEN 'Planifier la commande'
                    ELSE 'Reapprovisionnement normal'
                END,
                'PROPOSE',
                s.devise, round(s.prix_catalogue_kg, 4), round(s.qte_kg * s.prix_catalogue_kg, 2),
                round(COALESCE(s.taux, 1.0), 4),
                NULL, round(s.complement_kg, 4), s.date_limite
           FROM src s
          CROSS JOIN LATERAL (
                SELECT CASE WHEN s.date_limite <= $8::date      THEN 'TIER 1'
                            WHEN s.date_limite <= $8::date + 7  THEN 'TIER 2'
                            WHEN s.date_limite <= $8::date + 30 THEN 'TIER 3'
                            ELSE 'TIER 4' END AS urgence) u
          WHERE s.code_fournisseur IS NOT NULL AND COALESCE(s.prix_mad, 0) > 0
          -- UNE REFERENCE COMMANDEE SE REPROPOSE (06/10/2026). Un bon VALIDE,
          -- ENVOYE ou LIVRE_PARTIEL est un arrivage du moteur (compte a sa date,
          -- ou montre a part s'il est en retard ou sans date), un bon CLOTURE est
          -- en stock : ce qui reste a proposer est un vrai besoin. Seul un bon pas
          -- encore valide (BROUILLON, au controle, en demande de prix,
          -- EN_ATTENTE_VALIDATION), que le moteur ne compte pas, ecarte encore la
          -- reference.
          --
          -- UNE PROPOSITION ECARTEE EXPIRE (regle 17, 08/10/2026). Ecartee, elle
          -- masquait la reference A VIE : le besoin ne revenait jamais. Au-dela
          -- de P_DureeEcartJours (90 j), elle cesse de masquer ; elle reste en
          -- base, jamais supprimee, marquee expiree.
            AND NOT EXISTS (
                SELECT 1 FROM plan_achat pa2
                 WHERE pa2.code_reference = s.code_reference
                   AND ((pa2.statut = 'IGNORE'
                         AND substr(COALESCE(pa2.date_ecartee, pa2.date_generation), 1, 10)::date
                             > current_date - COALESCE((SELECT CAST(valeur_courante AS integer) FROM parametre
                                                         WHERE code_parametre = 'P_DureeEcartJours'), 90))
                        OR (pa2.statut = 'COMMANDE'
                            AND EXISTS (SELECT 1 FROM bon_commande bc
                                         WHERE bc.id_bc = pa2.id_bc_genere
                                           AND bc.statut IN ('BROUILLON','EN_CONTROLE','DEMANDE_PRIX','EN_ATTENTE_VALIDATION')))))
            -- Une proposition ARBITREE couvre deux references a la fois : celle
            -- qu'on achetera, et celle dont le besoin a ete reporte. Les deux
            -- doivent etre ecartees ici. Oublier la seconde recreerait le besoin
            -- d'origine a chaque recalcul, et l'on commanderait les deux.
            AND NOT EXISTS (
                SELECT 1 FROM plan_achat pa3
                 WHERE pa3.statut IN ('PROPOSE','EN_REVISION','VALIDE')
                   AND pa3.code_reference_origine IS NOT NULL
                   AND (pa3.code_reference        = s.code_reference
                     OR pa3.code_reference_origine = s.code_reference))
            -- Une reference deja couverte par une ligne FIGEE ne se repropose
            -- pas : l'index ux_plan_achat_ouvert refuserait le doublon, et la
            -- generation entiere echouerait sur une contrainte que l'acheteur
            -- ne peut pas comprendre.
            AND NOT EXISTS (
                SELECT 1 FROM plan_achat pa4
                 WHERE pa4.statut IN ('PROPOSE','EN_REVISION','VALIDE')
                   AND pa4.figee = 1
                   AND pa4.code_reference = s.code_reference)",
        source_moteur(3)
    ))
    .bind(&horodatage)
    .bind(id_plan)
    .bind(&codes)
    .bind(&quantites)
    .bind(&dates_d)
    .bind(&limites)
    .bind(&complements)
    .bind(aujourdhui)
    .execute(&mut *tx)
    .await?;

    // UNE SEULE REFERENCE : la proposition ouverte qui la porte, ou pourquoi il n'y
    // en a pas — l'acheteur a clique « Commander », il doit savoir.
    let id_proposition = match reference {
        None => None,
        Some(r) => {
            let id: Option<String> = sqlx::query_scalar(
                "SELECT id_proposition FROM plan_achat
                  WHERE statut IN ('PROPOSE','EN_REVISION','VALIDE')
                    AND (code_reference = $1 OR code_reference_origine = $1)
                  ORDER BY (code_reference = $1) DESC, date_generation DESC
                  LIMIT 1",
            )
            .bind(r)
            .fetch_optional(&mut *tx)
            .await?;
            if id.is_none() {
                return Err(AppError::RegleMetier(pourquoi_rien(&mut tx, r, moteur.is_empty(), &references_non_proposees).await?));
            }
            id
        }
    };

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
        references_non_proposees,
        id_proposition,
    })
}

/// Pourquoi une reference n'a pas de proposition ouverte apres sa generation.
async fn pourquoi_rien(
    tx: &mut sqlx::PgConnection,
    reference: &str,
    moteur_vide: bool,
    non_proposees: &[String],
) -> AppResult<String> {
    if moteur_vide {
        return Ok(format!(
            "Le moteur de couverture ne propose rien pour {reference} aujourd'hui (couverture suffisante, ou référence inactive). Rafraîchissez l'onglet À commander."
        ));
    }
    if let Some(n) = non_proposees.first() {
        return Ok(format!("Aucune proposition possible pour {n}."));
    }
    let bon: Option<(String, String)> = sqlx::query_as(
        "SELECT bc.numero_bc, bc.statut FROM plan_achat pa JOIN bon_commande bc ON bc.id_bc = pa.id_bc_genere
          WHERE pa.code_reference = $1 AND pa.statut = 'COMMANDE'
            AND bc.statut IN ('BROUILLON','EN_CONTROLE','DEMANDE_PRIX','EN_ATTENTE_VALIDATION')
          ORDER BY pa.date_generation DESC LIMIT 1",
    )
    .bind(reference)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((numero, statut)) = bon {
        return Ok(format!(
            "{reference} est déjà sur le bon {numero} ({statut}), pas encore validé : complétez ce bon plutôt que d'en préparer un second."
        ));
    }
    let ecartee: Option<String> = sqlx::query_scalar(
        "SELECT to_char(COALESCE(date_ecartee, date_generation), 'DD/MM/YYYY') FROM plan_achat
          WHERE code_reference = $1 AND statut = 'IGNORE'
          ORDER BY COALESCE(date_ecartee, date_generation) DESC LIMIT 1",
    )
    .bind(reference)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(le) = ecartee {
        return Ok(format!(
            "La proposition de {reference} a été écartée le {le} : elle ne se repropose pas avant P_DureeEcartJours."
        ));
    }
    Ok(format!("Aucune proposition ouverte pour {reference} après le calcul."))
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
    /// UNE LIGNE PAR REFERENCE (21/10/2026) : les propositions dont la reference
    /// etait deja sur le bon vise, et dont la quantite s'est ajoutee a sa ligne
    /// (prix de la ligne existante conserve). Un message par fusion.
    pub fusions: Vec<String>,
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
/// Ce que l'acheteur CONFIRME sur la commande, par proposition : la quantite, le
/// prix, et le colisage (palettes / bobines) qu'il arrete. Absent pour un champ =
/// la valeur du plan telle quelle. On ajuste ICI, pas dans le plan : le plan ne
/// sert qu'a choisir, la commande porte la decision (14/10/2026).
#[derive(Debug, serde::Deserialize)]
pub struct AjustementLigne {
    pub quantite_kg: Option<f64>,
    pub prix_mad: Option<f64>,
    /// LE PRIX DANS LA DEVISE DE LA PROPOSITION, au kg (21/10/2026) : la boite
    /// « Commander » le saisit dans la devise du fournisseur, comme on negocie.
    #[serde(default)]
    pub prix_devise: Option<f64>,
    pub nb_palettes: Option<i64>,
    pub nb_bobines: Option<i64>,
}

/// Le bon nait en BROUILLON : convertir n'est pas commander. L'acheteur negocie,
/// ajuste, puis soumet a validation.
pub async fn convertir(
    db: &Db,
    user: &Utilisateur,
    propositions: Option<&[String]>,
    cibles: Option<&std::collections::HashMap<String, String>>,
    ajustements: Option<&std::collections::HashMap<String, AjustementLigne>>,
) -> AppResult<ResultatConversion> {

    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // Les propositions retenues : celles demandees, ou toutes celles ouvertes.
    // COMMANDE et IGNORE sont exclues — l'une engage deja, l'autre a ete ecartee.
    // `= ANY($1)` et non des `?` a la SQLite ; quantites et prix en `::float8`,
    // sans quoi le decodage des NUMERIC echouait. « Commander » ne marchait pas.
    // UNE PROPOSITION DEJA COMMANDEE N'EST PLUS ECARTEE EN SILENCE (19/10/2026) :
    // celui qui la demande l'a vue ouverte sur son ecran, un autre l'a commandee
    // entre-temps. On le lui dit, avec le bon, au lieu de convertir le reste
    // comme si de rien n'etait.
    if let Some(ids) = propositions.filter(|i| !i.is_empty()) {
        let prises: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT pa.code_reference, b.numero_bc
               FROM plan_achat pa
               LEFT JOIN bon_commande b ON b.id_bc = pa.id_bc_genere
              WHERE pa.id_proposition = ANY($1) AND pa.statut = 'COMMANDE'
              ORDER BY pa.code_reference",
        )
        .bind(ids)
        .fetch_all(&mut *tx)
        .await?;
        if !prises.is_empty() {
            let liste: Vec<String> = prises
                .iter()
                .map(|(r, b)| format!("{r} ({})", b.as_deref().unwrap_or("bon inconnu")))
                .collect();
            return Err(AppError::RegleMetier(format!(
                "R-PROP : deja commandee(s) par un autre bon : {}. Rafraichissez le plan d'achat.",
                liste.join(", ")
            )));
        }
    }

    let ouvertes: Vec<(String, String, f64, f64, Option<String>, Option<i64>)> = match propositions {
        Some(ids) if !ids.is_empty() => {
            sqlx::query_as(
                "SELECT id_proposition, code_fournisseur, quantite_suggeree_kg::float8,
                        prix_estime_mad::float8, date_besoin_prevue::text, palettes_a_commander
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
                        prix_estime_mad::float8, date_besoin_prevue::text, palettes_a_commander
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
    let mut fusions: Vec<String> = Vec::new();
    // (fournisseur, id_bc) dans l'ordre d'ouverture. On retient l'identifiant
    // rendu par l'insertion plutot que de le rechercher ensuite : deux bons du
    // meme fournisseur ouverts le meme jour seraient indiscernables.
    let mut ouverts: Vec<(String, String)> = Vec::new();

    for (id_prop, fournisseur, qte_kg, prix_mad, date_besoin, palettes_plan) in &ouvertes {
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
                        // LE BROUILLON SEUL (21/10/2026) : au controle, en demande
                        // de prix ou en attente de validation, le bon est fige.
                        if statut != "BROUILLON" {
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

        // CE QUE L'ACHETEUR A CONFIRME SUR LA COMMANDE : quantite, prix, et le
        // colisage (palettes / bobines). A defaut : la quantite et le prix du
        // plan, et les palettes calculees. Le plan ne sert qu'a choisir ; la
        // decision se prend ici, sur la commande (14/10/2026).
        let aj = ajustements.and_then(|m| m.get(id_prop));
        let qte_ajustee = aj.and_then(|a| a.quantite_kg).filter(|q| *q > 0.0);
        let qte_final = qte_ajustee.unwrap_or(*qte_kg);
        // LE PRIX DE LA PROPOSITION, PAS UN PRIX RECALCULE (21/10/2026). Le prix
        // MAD redivise par le taux du bon donnait 3,3395 USD pour une proposition
        // a 3,38 USD. Sans ajustement de l'acheteur, la ligne reprend le prix en
        // DEVISE de la proposition quand c'est la devise du bon ; sinon (bon en
        // MAD, ou autre devise), le prix MAD au taux du bon.
        let prix_ajuste = aj.and_then(|a| a.prix_mad).filter(|p| *p >= 0.0);
        let prix_devise_ajuste = aj.and_then(|a| a.prix_devise).filter(|p| *p >= 0.0);
        let prix_mad_final = prix_ajuste.unwrap_or(*prix_mad);
        // Les palettes du plan valent pour SA quantite : une quantite ajustee
        // sans palettes saisies laisse la grille les deduire du poids.
        let palettes_final = aj
            .and_then(|a| a.nb_palettes)
            .or(if qte_ajustee.is_none() { *palettes_plan } else { None });
        let bobines_final = aj.and_then(|a| a.nb_bobines);

        // UNE LIGNE PAR REFERENCE (21/10/2026). Le bon vise porte deja la
        // reference : sa ligne s'augmente de la quantite convertie, au lieu d'en
        // ouvrir une seconde. Le prix est celui de la ligne existante — il a pu
        // etre negocie ; la reponse le dit.
        let (code_ref, numero_bc): (String, String) = sqlx::query_as(
            "SELECT pa.code_reference, bc.numero_bc FROM plan_achat pa, bon_commande bc
              WHERE pa.id_proposition = $1 AND bc.id_bc = $2",
        )
        .bind(id_prop)
        .bind(&id_bc)
        .fetch_one(&mut *tx)
        .await?;
        if let Some((existante, rang)) =
            crate::routes::bons_commande::ligne_meme_reference(&mut tx, &id_bc, &code_ref).await?
        {
            crate::routes::bons_commande::augmenter_ligne_bc(
                &mut tx,
                &existante,
                &crate::routes::bons_commande::AjoutLigne {
                    kg: qte_final,
                    unite: None,
                    quantite_unite: None,
                    palettes: palettes_final.map(|p| p as f64),
                    bobines: bobines_final,
                    id_proposition: Some(id_prop),
                },
            )
            .await?;
            sqlx::query(
                "UPDATE plan_achat SET statut = 'COMMANDE', id_bc_genere = $2, figee = 0
                  WHERE id_proposition = $1",
            )
            .bind(id_prop)
            .bind(&id_bc)
            .execute(&mut *tx)
            .await?;
            fusions.push(format!(
                "{code_ref} : {} kg ajoutes a la ligne {rang} du bon {numero_bc}, qui la portait deja ; \
                 le prix de cette ligne est conserve.",
                crate::db::arrondi_kg(qte_final)
            ));
            converties += 1;
            continue;
        }

        // L'UNITE DE LA PROPOSITION (21/10/2026) : kg, ou l'unite du catalogue
        // (ml) avec son facteur, celui que le plan a applique. Les kilos se
        // deduisent de la quantite dans l'unite : la base exige l'egalite.
        sqlx::query(
            "INSERT INTO ligne_bc
                 (id_bc, ligne_numero, code_reference, designation, unite_commande,
                  facteur_kg, quantite_commandee_unite, quantite_commandee_kg,
                  prix_unitaire_devise, code_devise, date_livraison_prevue,
                  id_proposition, besoin_kg_origine, nb_palettes_saisi, nb_bobines_saisi)
             SELECT $1, $2, pa.code_reference, r.designation, u.unite,
                    u.facteur, q.unite_qte, ROUND(q.unite_qte * u.facteur, 4),
                    ROUND(CASE WHEN $10::numeric IS NOT NULL AND pa.code_devise = bc.code_devise
                               THEN $10::numeric
                               -- Saisi dans la devise de la proposition, autre que celle du
                               -- bon : en MAD au taux de la proposition, puis au taux du bon.
                               WHEN $10::numeric IS NOT NULL
                               THEN $10::numeric * COALESCE(NULLIF(pa.taux_devise, 0), 1) / $3::numeric
                               WHEN $9::boolean AND pa.code_devise = bc.code_devise AND pa.prix_devise > 0
                               THEN pa.prix_devise
                               ELSE $6::numeric / $3::numeric END * u.facteur, 6),
                    bc.code_devise, pa.date_besoin_prevue,
                    pa.id_proposition,
                    COALESCE((SELECT b.besoin_12m_kg FROM v_besoin_12m b
                               WHERE b.code_reference = pa.code_reference), 0),
                    $7::numeric, $8::bigint
               FROM plan_achat pa
               JOIN reference r  ON r.code_reference = pa.code_reference
               JOIN bon_commande bc ON bc.id_bc = $1
              CROSS JOIN LATERAL (
                    SELECT CASE WHEN pa.unite_saisie IS NULL OR pa.unite_saisie = 'kg'
                                  OR COALESCE(pa.quantite_suggeree_unite, 0) <= 0
                                  OR COALESCE(pa.quantite_suggeree_kg, 0) <= 0
                                THEN 'kg' ELSE pa.unite_saisie END AS unite,
                           CASE WHEN pa.unite_saisie IS NULL OR pa.unite_saisie = 'kg'
                                  OR COALESCE(pa.quantite_suggeree_unite, 0) <= 0
                                  OR COALESCE(pa.quantite_suggeree_kg, 0) <= 0
                                THEN 1.0
                                ELSE ROUND(pa.quantite_suggeree_kg / pa.quantite_suggeree_unite, 6) END AS facteur) u
              CROSS JOIN LATERAL (SELECT ROUND($5::numeric / u.facteur, 4) AS unite_qte) q
              WHERE pa.id_proposition = $4",
        )
        .bind(&id_bc)
        .bind(numero)
        .bind(taux)
        .bind(id_prop)
        .bind(qte_final)
        .bind(prix_mad_final)
        .bind(palettes_final)
        .bind(bobines_final)
        .bind(prix_ajuste.is_none())
        .bind(prix_devise_ajuste)
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
    Ok(ResultatConversion { bons, propositions_converties: converties, fusions })
}

/// Ouvre un bon de commande en brouillon pour un fournisseur.
async fn ouvrir_bon(
    tx: &mut sqlx::PgConnection,
    user: &Utilisateur,
    fournisseur: &str,
    date_besoin: Option<&str>,
) -> AppResult<String> {

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
    let numero = crate::domain::numerotation::numeroter(&mut *tx, "bon_commande", "numero_bc", "BC").await?;

    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO bon_commande
             (id_bc, numero_bc, code_fournisseur, code_devise, taux_change_engage,
              date_taux_engage, date_livraison_prevue, conditions_paiement,
              motif_creation, montant_total_devise, montant_total_mad,
              id_utilisateur_creation)
         VALUES ($1,$2,$3,$4,$5,fn_instant($6),fn_jour_casablanca($7),$8,'MRP',0,0,$9)",
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
