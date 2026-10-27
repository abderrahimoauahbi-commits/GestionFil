//! Les bons de commande : saisie, lignes, devise, workflow de validation.
//!
//! Ce sont des ACHATS, pas du stock : un bon n'ecrit jamais au grand livre, il
//! n'y entre qu'a travers la reception. Sortis de `stock.rs` le 17/10/2026
//! (audit B2), ou ils occupaient 1 500 lignes d'un fichier nomme « stock ».

use super::json::lignes_en_json;
use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::db::{maintenant, Db};
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
pub async fn lister_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Lire).await?;
    let rows = sqlx::query(
        // Le pourcentage livre et le statut de livraison sont CALCULES depuis les
        // lignes, comme les colonnes I et K de la feuille Commandes. Les stocker
        // les ferait diverger des receptions a la premiere pesee.
        "SELECT bc.*, f.nom AS fournisseur_nom, f.code_devise AS devise_fournisseur,
                -- CE QUE LE DOCUMENT FOURNISSEUR IMPRIME. Ces trois-la vivent sur la
                -- fiche du fournisseur, et 98 bons sur 109 des archives Excel les
                -- portaient en pied de page. Les recopier sur le bon les figerait ;
                -- on les lit, on ne les stocke pas.
                f.incoterm, f.tolerance_pesee_pct, f.palettes_par_conteneur,
                uc.login AS createur, uv.login AS valideur, uk.login AS controleur,
                -- LE TAUX DU JOUR (regle 10) : indicatif tant que le bon n'est pas
                -- valide ; c'est lui qui sera propose a la validation.
                (SELECT t.taux::float8 FROM taux_change t
                  WHERE t.code_devise = bc.code_devise
                    AND to_char(current_date, 'YYYY-MM-DD') >= substr(t.date_debut, 1, 10)
                    AND (t.date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(t.date_fin, 1, 10))
                  ORDER BY t.date_debut DESC LIMIT 1) AS taux_du_jour,
                (SELECT COUNT(*) FROM ligne_bc l WHERE l.id_bc = bc.id_bc) AS nb_lignes,
                (SELECT COALESCE(SUM(l.quantite_restante_kg), 0) FROM ligne_bc l
                  WHERE l.id_bc = bc.id_bc) AS reste_a_livrer_kg,
                (SELECT COALESCE(SUM(l.quantite_commandee_kg), 0) FROM ligne_bc l
                  WHERE l.id_bc = bc.id_bc) AS quantite_commandee_kg,
                (SELECT COALESCE(SUM(l.quantite_recue_kg), 0) FROM ligne_bc l
                  WHERE l.id_bc = bc.id_bc) AS quantite_recue_kg,
                CASE
                    WHEN (SELECT COALESCE(SUM(l.quantite_commandee_kg), 0) FROM ligne_bc l
                           WHERE l.id_bc = bc.id_bc) <= 0 THEN 0
                    ELSE ROUND(100.0
                         * (SELECT COALESCE(SUM(l.quantite_recue_kg), 0) FROM ligne_bc l
                             WHERE l.id_bc = bc.id_bc)
                         / (SELECT SUM(l.quantite_commandee_kg) FROM ligne_bc l
                             WHERE l.id_bc = bc.id_bc), 1)
                END AS pct_livre,
                CASE
                    WHEN bc.statut IN ('BROUILLON','EN_CONTROLE','DEMANDE_PRIX','EN_ATTENTE_VALIDATION','ANNULE') THEN 'SANS OBJET'
                    WHEN (SELECT COALESCE(SUM(l.quantite_restante_kg), 0) FROM ligne_bc l
                           WHERE l.id_bc = bc.id_bc) <= 0.001 THEN 'COMPLET'
                    WHEN (SELECT COALESCE(SUM(l.quantite_recue_kg), 0) FROM ligne_bc l
                           WHERE l.id_bc = bc.id_bc) > 0 THEN
                         CASE WHEN bc.date_livraison_prevue IS NOT NULL
                                   AND to_char(current_date, 'YYYY-MM-DD') > substr(bc.date_livraison_prevue, 1, 10)
                              THEN 'PARTIEL EN RETARD' ELSE 'PARTIEL' END
                    WHEN bc.date_livraison_prevue IS NOT NULL
                         AND to_char(current_date, 'YYYY-MM-DD') > substr(bc.date_livraison_prevue, 1, 10) THEN 'EN RETARD'
                    ELSE 'ATTENDU'
                END AS statut_livraison
           FROM bon_commande bc
           JOIN fournisseur f  ON f.code_fournisseur = bc.code_fournisseur
           LEFT JOIN utilisateur uc ON uc.id_utilisateur = bc.id_utilisateur_creation
           LEFT JOIN utilisateur uv ON uv.id_utilisateur = bc.id_utilisateur_validation
           LEFT JOIN utilisateur uk ON uk.id_utilisateur = bc.id_utilisateur_controle
          WHERE ($1 IS NULL OR bc.statut = $1)
          ORDER BY bc.date_bc DESC LIMIT 200",
    )
    .bind(f.get("statut"))
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::BONS_COMMANDE, &mut valeur).await?;
    Ok(Json(valeur))
}

#[derive(Debug, Deserialize)]
pub struct NouveauBc {
    /// L'IDENTIFIANT TIRE PAR L'ECRAN a l'ouverture du formulaire (audit P3,
    /// 19/10/2026) : le meme envoi rejoue rend le meme document, pas un second.
    /// Absent : le serveur en tire un.
    #[serde(default)]
    pub id_document: Option<String>,
    pub code_fournisseur: String,
    /// Date du bon. Absente : aujourd'hui. Un bon se saisit parfois apres coup.
    pub date_bc: Option<String>,
    pub date_livraison_prevue: Option<String>,
    pub motif_creation: Option<String>,
    pub notes: Option<String>,
    /// LA DEVISE DU BON, au choix (01/10/2026). Absente : celle de la fiche
    /// fournisseur, comme avant.
    pub code_devise: Option<String>,
    /// Lignes saisies en meme temps que l'entete. Tout part dans UNE
    /// transaction : un bon a moitie cree, avec un numero attribue et aucune
    /// ligne, serait un document fantome que personne ne saurait interpreter.
    pub lignes: Option<Vec<LigneBc>>,
}

pub async fn creer_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(b): Json<NouveauBc>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Ecrire).await?;
    let id = crate::domain::idempotence::identifiant(b.id_document.as_deref())?;
    if let Some(v) = crate::domain::idempotence::deja_enregistre(
        &state.db, &crate::domain::idempotence::BON_COMMANDE, &id, &user.id,
    )
    .await?
    {
        return Ok(Json(v));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let (devise_fiche, conditions): (String, Option<String>) = sqlx::query_as(
        "SELECT COALESCE(code_devise, 'MAD'), conditions_paiement
           FROM fournisseur WHERE code_fournisseur = $1",
    )
    .bind(&b.code_fournisseur)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("fournisseur {}", b.code_fournisseur)))?;
    let devise = b
        .code_devise
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(String::from)
        .unwrap_or(devise_fiche);

    // RG-09 : le taux est fige a la creation puis reevalue a la validation.
    let taux: f64 = taux_au(&mut tx, &devise, &crate::db::aujourdhui())
    .await?
    .ok_or_else(|| {
        AppError::RegleMetier(format!("Aucun taux de change en vigueur pour {devise}."))
    })?;

    let numero = numeroter(&mut tx, "bon_commande", "numero_bc", "BC").await?;

    sqlx::query(
        "INSERT INTO bon_commande
             (id_bc, numero_bc, code_fournisseur, code_devise, taux_change_engage,
              date_taux_engage, date_livraison_prevue, conditions_paiement,
              motif_creation, notes, montant_total_devise, montant_total_mad,
              id_utilisateur_creation, date_bc)
         VALUES ($1,$2,$3,$4,$5,fn_instant($6),fn_jour_casablanca($7),$8,$9,$10,0,0,$11,
                 COALESCE(fn_jour_casablanca($12), (now() AT TIME ZONE 'Africa/Casablanca')::date))",
    )
    .bind(&id)
    .bind(&numero)
    .bind(&b.code_fournisseur)
    .bind(&devise)
    .bind(taux)
    .bind(maintenant())
    .bind(&b.date_livraison_prevue)
    .bind(&conditions)
    .bind(b.motif_creation.clone().unwrap_or_else(|| "MANUEL".into()))
    .bind(&b.notes)
    .bind(&user.id)
    .bind(&b.date_bc)
    .execute(&mut *tx)
    .await?;

    // --- Lignes saisies avec l'entete ---------------------------------------
    let mut posees = 0i64;
    let mut fusions: Vec<String> = Vec::new();
    for l in b.lignes.iter().flatten() {
        valider_ligne_bc(l)?;
        let (kg, facteur) = poids_ligne_bc(&state.db, l).await?;
        // UNE LIGNE PAR REFERENCE (21/10/2026) : la meme reference saisie deux
        // fois fait une seule ligne, dont la quantite s'additionne.
        if let (false, Some(code)) = (l.sans_reference(), l.code_reference.as_deref()) {
            if let Some((existante, numero)) = ligne_meme_reference(&mut tx, &id, code).await? {
                augmenter_ligne_bc(
                    &mut tx,
                    &existante,
                    &AjoutLigne {
                        kg,
                        unite: Some(&l.unite_commande),
                        quantite_unite: Some(l.quantite_commandee_unite),
                        palettes: l.nb_palettes,
                        bobines: l.nb_bobines,
                        id_proposition: l.id_proposition.as_deref().map(str::trim).filter(|s| !s.is_empty()),
                    },
                )
                .await?;
                fusions.push(message_fusion(code, numero));
                continue;
            }
        }
        inserer_ligne_bc(
            &mut tx,
            &uuid::Uuid::new_v4().to_string(),
            &id,
            posees + 1,
            l,
            kg,
            facteur,
            &devise,
            true,
        )
        .await?;
        posees += 1;
    }

    // Les propositions retenues passent a COMMANDE : le lien va dans les deux
    // sens des la creation, sans etape supplementaire.
    //
    // La protection contre le recalcul tombe avec la conversion, ici comme dans
    // domain/plan_achat.rs : ce que la ligne protegeait est desormais dans le
    // bon. Une proposition COMMANDE encore « protegee » serait comptee parmi les
    // arbitrages ouverts alors qu'elle n'engage plus rien.
    if posees > 0 {
        sqlx::query(
            "UPDATE plan_achat SET statut = 'COMMANDE', id_bc_genere = $1, figee = 0
              WHERE id_proposition IN (SELECT id_proposition FROM ligne_bc
                                        WHERE id_bc = $1 AND id_proposition IS NOT NULL)",
        )
        .bind(&id)
        .execute(&mut *tx)
        .await?;
        recalculer_bc(&mut tx, &id).await?;
    }

    tx.commit().await?;
    Ok(Json(json!({
        "id_bc": id, "numero_bc": numero, "code_devise": devise,
        "taux_change_engage": taux, "lignes": posees, "fusions": fusions
    })))
}

pub async fn lignes_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Lire).await?;
    // Le besoin actuel est LU, jamais stocke : une alerte figee serait juste
    // jusqu'au prochain recalcul du MRP, puis mentirait sans le signaler.
    // L'ecart n'existe donc que le temps de l'affichage, et il est toujours vrai.
    let rows = sqlx::query(
        // LE NOM DE LA LIGNE VIENT DE LA REFERENCE, OU DE LA LIGNE ELLE-MEME.
        // Une ligne de service n'a pas de reference : c'est son libelle qui la
        // nomme. Sans ce COALESCE, le transport s'afficherait sans intitule.
        "SELECT l.*, COALESCE(r.designation, l.libelle) AS reference_designation,
                r.unite_catalogue,
                r.couleur, r.code_categorie, cat.libelle AS categorie_libelle,
                -- LES DEUX COLONNES QUE LE FOURNISSEUR LIT EN PREMIER : son code
                -- couleur — « 7612 », « CB-1426 » — et le titrage, qui est chez
                -- nous la FAMILLE : « 2900-DTEX », « 1200-DENIERS-SHRINK ».
                r.code_couleur, r.code_famille,
                -- La version de la fiche, pour la corriger depuis le bon (verrou, 19/10).
                r.version AS version_reference,
                r.poids_bobine_kg, r.bobines_par_palette, r.bobines_par_lot,
                -- Ce que le FOURNISSEUR lit sur le document : sa description
                -- commerciale en anglais, pas notre code interne.
                r.description_commerciale,

                -- Montant de la ligne en DIRHAMS. Il n'est pas stocke, et c'est
                -- volontaire : seul le taux ENGAGE du bon fait foi (RG-09), et le
                -- recopier sur la ligne creerait une seconde verite qui divergerait
                -- des que le taux du bon serait reevalue a la validation.
                ROUND(l.total_ligne_devise * bc.taux_change_engage, 2) AS total_ligne_mad,
                bc.taux_change_engage,

                -- Encombrement, pour la logistique : combien de palettes ce que
                -- l'on commande represente-t-il ? Sans les deux caracteristiques
                -- de conditionnement, la question n'a pas de reponse — et l'on
                -- affiche alors rien plutot qu'un zero qui passerait pour vrai.
                -- LE CONSTAT PRIME SUR LE CALCUL. Renseigne, quelqu'un a vu un
                -- colisage que la regle ne sait pas deviner ; son constat vaut
                -- mieux qu'une division.
                COALESCE(
                    l.nb_palettes_saisi,
                    CASE WHEN r.poids_bobine_kg > 0 AND r.bobines_par_palette > 0
                         THEN ROUND(l.quantite_commandee_kg
                                    / (r.poids_bobine_kg * r.bobines_par_palette), 2)
                    END
                ) AS nb_palettes,
                l.nb_bobines_saisi AS nb_bobines,

                COALESCE(b.besoin_12m_kg, 0) AS besoin_kg_actuel,
                CASE WHEN l.besoin_kg_origine IS NULL THEN NULL
                     ELSE ROUND(COALESCE(b.besoin_12m_kg, 0) - l.besoin_kg_origine, 4)
                END AS ecart_besoin_kg
           FROM ligne_bc l
           -- JOINTURE EXTERNE, et non interne : une ligne de service n'a pas de
           -- reference au catalogue. En interne, elle disparaissait purement et
           -- simplement de la fiche du bon ET du bon imprime — c'est-a-dire du
           -- document qu'on envoie au fournisseur et qu'il facture.
           LEFT JOIN reference r  ON r.code_reference = l.code_reference
           JOIN bon_commande bc  ON bc.id_bc = l.id_bc
           LEFT JOIN categorie_matiere cat ON cat.code_categorie = r.code_categorie
           LEFT JOIN v_besoin_12m b ON b.code_reference = l.code_reference
          WHERE l.id_bc = $1 ORDER BY l.ligne_numero",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(&state.db, module::BONS_COMMANDE, &mut valeur).await?;
    Ok(Json(valeur))
}

#[derive(Debug, Deserialize)]
pub struct LigneBc {
    /// LA VERSION DE L'EN-TETE lue par l'ecran (19/10/2026) : une ligne se modifie
    /// sous le verrou de son document. Ignoree a la creation du document.
    #[serde(default)]
    pub version: Option<i64>,
    /// LA PROPOSITION DU PLAN D'ACHAT que l'ecran affichait (19/10/2026). Presente,
    /// c'est elle que la ligne sert — et la base refuse si un autre bon la sert deja
    /// (R-PROP). Absente : rattachement par la reference, comme avant.
    #[serde(default)]
    pub id_proposition: Option<String>,
    /// `MARCHANDISE` (defaut) ou `SERVICE`. Absent : de la marchandise.
    #[serde(default)]
    pub type_ligne: Option<String>,
    /// Nulle sur une ligne de service : il n'y a pas de reference a commander.
    pub code_reference: Option<String>,
    /// Ce que la ligne designe quand aucune reference ne la nomme.
    pub libelle: Option<String>,
    pub unite_commande: String,
    pub quantite_commandee_unite: f64,
    pub prix_unitaire_devise: f64,
    pub date_livraison_prevue: Option<String>,
    /// LE COLISAGE CONSTATE, quand il s'ecarte du calcul.
    ///
    /// La grille permet de DETACHER palettes, bobines et quantite : un
    /// fournisseur livre une palette entamee, et dix-sept palettes pleines plus
    /// une aux trois quarts ne se deduisent d'aucun poids. Sans ces deux
    /// champs, le nombre saisi partait au serveur qui ne le demandait pas : le
    /// detachement ne detachait rien, et le calcul reprenait la main au
    /// rechargement.
    ///
    /// `None` : on calcule, comme avant. C'est le cas courant.
    /// Decimal : une palette entamee se compte 21,64, pas 22.
    #[serde(default)]
    pub nb_palettes: Option<f64>,
    /// Entier : une bobine ne se coupe pas.
    #[serde(default)]
    pub nb_bobines: Option<i64>,
    /// LA REMISE NEGOCIEE, en % du prix brut — condition de prix de la ligne,
    /// comme dans SAP. Absente : 0. Le prix unitaire reste BRUT ; la base
    /// calcule le net, et c'est le net qui valorise l'entree en stock.
    #[serde(default)]
    pub remise_pct: Option<f64>,
}

impl LigneBc {
    /// Une ligne SANS reference au catalogue : prestation ou ligne libre.
    ///
    /// Les deux se comportent pareil ici — ni poids, ni conversion, ni entree
    /// en stock. Ce qui les separe se joue au quai : un echantillon arrive,
    /// un fret non.
    fn sans_reference(&self) -> bool {
        matches!(self.type_ligne.as_deref(), Some("SERVICE") | Some("LIBRE"))
    }

    /// Ce qui nomme la ligne dans un message d'erreur.
    fn nom(&self) -> String {
        self.code_reference
            .clone()
            .or_else(|| self.libelle.clone())
            .unwrap_or_else(|| "ligne sans intitule".into())
    }
}

/// Ce qu'une ligne doit porter selon son type, dit AVANT d'ecrire.
///
/// La base le verifie aussi — le CHECK `ligne_bc_type_coherent` est la vraie
/// garantie. Mais une violation de contrainte remonte un message de PostgreSQL
/// que personne ne peut interpreter ; ici on nomme ce qui manque.
fn valider_ligne_bc(l: &LigneBc) -> AppResult<()> {
    if l.quantite_commandee_unite <= 0.0 || l.prix_unitaire_devise <= 0.0 {
        return Err(AppError::Invalide(format!(
            "{} : quantite et prix doivent etre strictement positifs",
            l.nom()
        )));
    }
    if l.sans_reference() {
        if l.libelle.as_deref().map(str::trim).unwrap_or("").is_empty() {
            return Err(AppError::Invalide(
                "Une ligne sans reference doit porter un intitule : c'est lui qui la \
                 nomme sur le bon envoye au fournisseur."
                    .into(),
            ));
        }
        if l.code_reference.is_some() {
            return Err(AppError::Invalide(
                "Une prestation ou une ligne libre ne se rattache a aucune reference \
                 du catalogue : elle n'entre jamais en stock."
                    .into(),
            ));
        }
    } else if l.code_reference.is_none() {
        return Err(AppError::Invalide(
            "Une ligne de marchandise exige une reference du catalogue.".into(),
        ));
    }
    Ok(())
}

/// Le poids et le facteur d'une ligne — ou la convention des prestations.
///
/// UNE PRESTATION N'A PAS DE POIDS. Zero kilo la fait sortir d'elle-meme de
/// toutes les vues d'en-cours, qui filtrent `quantite_restante_kg > 0` : il n'y
/// a pas un filtre a ajouter dans chacune. Le facteur vaut 1 pour que la colonne
/// generee `prix_kg_devise` reste calculable sans division par zero.
async fn poids_ligne_bc(db: &Db, l: &LigneBc) -> AppResult<(f64, f64)> {
    if l.sans_reference() {
        return Ok((0.0, 1.0));
    }
    let code = l
        .code_reference
        .as_deref()
        .ok_or_else(|| AppError::Invalide("une ligne de marchandise exige une reference".into()))?;
    vers_kg(db, code, l.quantite_commandee_unite, &l.unite_commande).await
}

/// L'INSERT d'une ligne de bon, marchandise ou prestation.
///
/// `INSERT … VALUES` ET NON `INSERT … SELECT … FROM reference`. L'ancienne forme
/// n'inserait RIEN quand la reference n'existait pas — sans erreur, sans
/// message : le bon sortait avec zero ligne alors que l'utilisateur croyait
/// avoir saisi. Une prestation, qui n'a par definition aucune reference,
/// tombait exactement dans ce piege.
///
/// `rattacher_au_plan` : a la creation, une ligne de marchandise reprend la
/// proposition d'achat qui la justifie et le besoin du moment. Une ligne
/// ajoutee apres coup ne le fait pas — la proposition ne serait alors marquee
/// COMMANDE nulle part, et resterait comptee parmi les arbitrages ouverts.
#[allow(clippy::too_many_arguments)]
/// Une remise se controle avant d'atteindre la base.
///
/// La contrainte CHECK la refuserait aussi, mais avec un message SQL que
/// l'acheteur ne sait pas lire. 100 % est exclu : une ligne gratuite n'est pas
/// une remise, c'est un don, et son prix net nul casserait la valorisation du
/// stock (prix au kilo a zero, donc CUMP tire vers le bas sans raison).
pub(crate) fn remise_valide(r: Option<f64>) -> AppResult<f64> {
    let r = r.unwrap_or(0.0);
    if !(0.0..100.0).contains(&r) {
        return Err(AppError::Invalide(format!(
            "remise de {r} % : elle doit etre comprise entre 0 et 100 % exclus"
        )));
    }
    Ok((r * 100.0).round() / 100.0)
}

#[allow(clippy::too_many_arguments)]
async fn inserer_ligne_bc(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id_ligne: &str,
    id_bc: &str,
    numero: i64,
    l: &LigneBc,
    kg: f64,
    facteur: f64,
    devise: &str,
    rattacher_au_plan: bool,
) -> AppResult<()> {
    let (proposition, besoin) = if rattacher_au_plan {
        (
            "COALESCE($17::text, (SELECT pa.id_proposition FROM plan_achat pa
                WHERE pa.code_reference = $5
                  AND pa.statut IN ('PROPOSE','EN_REVISION','VALIDE')
                ORDER BY pa.id_proposition LIMIT 1))",
            // NULL et non zero sur une prestation : le CHECK de la table exige
            // qu'elle ne porte aucun besoin, et un zero serait un besoin.
            "CASE WHEN $5 IS NULL THEN NULL
                  ELSE COALESCE((SELECT bp.besoin_12m_kg FROM v_besoin_12m bp
                                  WHERE bp.code_reference = $5), 0) END",
        )
    } else {
        // $17 est toujours lie : sans rattachement au plan, il ne sert pas.
        ("NULLIF($17::text, $17::text)", "NULL")
    };

    sqlx::query(&format!(
        "INSERT INTO ligne_bc
             (id_ligne_bc, id_bc, ligne_numero, type_ligne, code_reference, libelle,
              designation, unite_commande, facteur_kg, quantite_commandee_unite,
              quantite_commandee_kg, prix_unitaire_devise, code_devise,
              date_livraison_prevue, nb_palettes_saisi, nb_bobines_saisi,
              remise_pct, id_proposition, besoin_kg_origine)
         VALUES ($1, $2, $3, $4, $5, $6,
                 COALESCE((SELECT r.designation FROM reference r
                            WHERE r.code_reference = $5), $6),
                 $7, $8, $9, $10, $11, $12, fn_jour_casablanca($13), $14, $15, $16, {proposition}, {besoin})"
    ))
    .bind(id_ligne)
    .bind(id_bc)
    .bind(numero)
    .bind(
        l.type_ligne
            .as_deref()
            .filter(|t| *t == "SERVICE" || *t == "LIBRE")
            .unwrap_or("MARCHANDISE"),
    )
    .bind(&l.code_reference)
    .bind(l.libelle.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(&l.unite_commande)
    .bind(facteur)
    .bind(l.quantite_commandee_unite)
    .bind(kg)
    .bind(l.prix_unitaire_devise)
    .bind(devise)
    .bind(&l.date_livraison_prevue)
    // LES TROIS EXPRESSIONS SE STOCKENT, LIEES OU NON. Quantite, palettes et
    // bobines disent la meme marchandise de trois facons ; n'en garder qu'une
    // obligeait a rededuire les autres, et la deduction se trompe des que le
    // colisage reel s'ecarte du theorique.
    .bind(l.nb_palettes)
    .bind(l.nb_bobines)
    .bind(remise_valide(l.remise_pct)?)
    .bind(l.id_proposition.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Modification partielle d'une ligne : seuls les champs fournis changent.
#[derive(Debug, Deserialize)]
pub struct ModifLigneBc {
    /// LA VERSION DE L'EN-TETE lue par l'ecran (19/10/2026) : une ligne se modifie
    /// sous le verrou de son document. Ignoree a la creation du document.
    #[serde(default)]
    pub version: Option<i64>,
    pub quantite_commandee_unite: Option<f64>,
    pub prix_unitaire_devise: Option<f64>,
    pub date_livraison_prevue: Option<String>,
    /// CORRIGER UNE LIGNE DOIT COUTER CE QUE COUTE LA SAISIR, pas davantage.
    ///
    /// Ces trois-la manquaient : on ne pouvait retoucher qu'une quantite et un
    /// prix. Changer la reference, l'unite ou le colisage obligeait a supprimer
    /// la ligne et a la refaire — et l'ecran, lui, les envoyait deja : ils
    /// etaient acceptes puis ignores en silence, ce qui est pire qu'un refus.
    #[serde(default)]
    pub code_reference: Option<String>,
    #[serde(default)]
    pub unite_commande: Option<String>,
    #[serde(default)]
    pub nb_palettes: Option<f64>,
    #[serde(default)]
    pub nb_bobines: Option<i64>,
    /// LA REMISE NEGOCIEE, en % du prix brut — condition de prix de la ligne,
    /// comme dans SAP. Absente : 0. Le prix unitaire reste BRUT ; la base
    /// calcule le net, et c'est le net qui valorise l'entree en stock.
    #[serde(default)]
    pub remise_pct: Option<f64>,
}

/// L'ETAT OU LE BON SE PREPARE ENCORE, et ou tout se modifie (lignes et
/// en-tete) : le brouillon, et lui seul. Au controle et en attente de validation,
/// le bon est fige ; en demande de prix, seuls le prix et la remise des lignes
/// bougent (decisions du 21/10/2026) — la base tient la meme regle
/// (`trg_ligne_bc_figee`, `trg_bc_entete_figee`).
fn se_modifie(statut: &str) -> bool {
    statut == "BROUILLON"
}

/// Le refus qui dit QUOI FAIRE, selon l'etat du bon.
fn refus_modification(statut: &str) -> AppError {
    AppError::RegleMetier(match statut {
        "EN_CONTROLE" => "Le bon est au controle : il ne se modifie pas. Renvoyez-le en brouillon pour le corriger.".into(),
        "EN_ATTENTE_VALIDATION" => "Le bon attend sa validation : il ne se modifie plus. Renvoyez-le en brouillon \
                                    (avec un motif) pour le corriger, ou annulez-le."
            .into(),
        "DEMANDE_PRIX" => "Le bon est en demande de prix : seuls le prix et la remise des lignes se modifient. \
                           Pour les quantites, les references ou l'en-tete, renvoyez-le en brouillon."
            .into(),
        _ => format!("Un bon de commande {statut} ne peut plus etre modifie."),
    })
}

/// Recalcule les totaux de l'entete a partir des lignes.
pub(crate) async fn recalculer_bc(tx: &mut sqlx::PgConnection, id: &str) -> AppResult<()> {
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

/// UNE LIGNE PAR REFERENCE SUR UN BON (decision du 21/10/2026).
///
/// La ligne de marchandise ACTIVE (ni annulee ni soldee) qui porte deja cette
/// reference sur ce bon, verrouillee : c'est elle qu'on augmente au lieu d'en
/// ouvrir une seconde. La base refuse le doublon (`trg_ligne_bc_une_par_reference`).
pub(crate) async fn ligne_meme_reference(
    tx: &mut sqlx::PgConnection,
    id_bc: &str,
    code_reference: &str,
) -> AppResult<Option<(String, i64)>> {
    Ok(sqlx::query_as(
        "SELECT id_ligne_bc, ligne_numero FROM ligne_bc
          WHERE id_bc = $1 AND code_reference = $2 AND type_ligne = 'MARCHANDISE'
            AND statut NOT IN ('ANNULE', 'SOLDE')
          ORDER BY ligne_numero LIMIT 1 FOR UPDATE",
    )
    .bind(id_bc)
    .bind(code_reference)
    .fetch_optional(&mut *tx)
    .await?)
}

/// Ce qu'on ajoute a une ligne existante : des kilos (toujours), la quantite
/// dans l'unite saisie (quand c'est celle de la ligne, elle s'ajoute telle
/// quelle), le colisage saisi, et la proposition du plan qu'elle sert.
pub(crate) struct AjoutLigne<'a> {
    pub kg: f64,
    pub unite: Option<&'a str>,
    pub quantite_unite: Option<f64>,
    pub palettes: Option<f64>,
    pub bobines: Option<i64>,
    pub id_proposition: Option<&'a str>,
}

/// AUGMENTE la ligne existante de ce qu'on voulait ajouter.
///
/// LA QUANTITE dans l'unite de la ligne : additionnee telle quelle si l'ajout est
/// dans la meme unite, sinon reconvertie depuis les kilos ; les kilos se deduisent
/// de la quantite, comme a la saisie (la base exige l'egalite au gramme pres).
///
/// LE COLISAGE SUIT, comme dans la grille : saisi des deux cotes, il s'additionne ;
/// saisi d'un seul cote, l'autre se deduit des kilos par les parametres de la
/// reference ; saisi nulle part, il reste deduit (NULL).
///
/// LE PRIX ET LA REMISE NE BOUGENT PAS : ceux de la ligne existante font foi.
pub(crate) async fn augmenter_ligne_bc(
    tx: &mut sqlx::PgConnection,
    id_ligne_bc: &str,
    a: &AjoutLigne<'_>,
) -> AppResult<()> {
    let unite_qte = "ROUND(CASE WHEN $3::text = lb.unite_commande AND $4::numeric IS NOT NULL
                                THEN lb.quantite_commandee_unite + $4::numeric
                                ELSE (lb.quantite_commandee_kg + $2::numeric) / lb.facteur_kg END, 4)";
    sqlx::query(&format!(
        "UPDATE ligne_bc lb
            SET quantite_commandee_unite = {unite_qte},
                quantite_commandee_kg    = ROUND({unite_qte} * lb.facteur_kg, 4),
                nb_palettes_saisi = CASE WHEN lb.nb_palettes_saisi IS NULL AND $5::numeric IS NULL THEN NULL
                    ELSE ROUND(COALESCE(lb.nb_palettes_saisi,
                                        lb.quantite_commandee_kg / NULLIF(r.poids_bobine_kg * r.bobines_par_palette, 0))
                               + COALESCE($5::numeric,
                                          $2::numeric / NULLIF(r.poids_bobine_kg * r.bobines_par_palette, 0)), 2) END,
                nb_bobines_saisi = CASE WHEN lb.nb_bobines_saisi IS NULL AND $6::bigint IS NULL THEN NULL
                    ELSE ROUND(COALESCE(lb.nb_bobines_saisi::numeric, lb.quantite_commandee_kg / NULLIF(r.poids_bobine_kg, 0))
                               + COALESCE($6::numeric, $2::numeric / NULLIF(r.poids_bobine_kg, 0)))::bigint END,
                id_proposition = COALESCE(lb.id_proposition, $7::text)
           FROM reference r
          WHERE lb.id_ligne_bc = $1 AND r.code_reference = lb.code_reference"
    ))
    .bind(id_ligne_bc)
    .bind(a.kg)
    .bind(a.unite)
    .bind(a.quantite_unite)
    .bind(a.palettes)
    .bind(a.bobines)
    .bind(a.id_proposition)
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Le message qui dit ce qui s'est passe quand une ligne a ete fondue.
fn message_fusion(code: &str, numero: i64) -> String {
    format!(
        "{code} etait deja sur la ligne {numero} : la quantite s'y ajoute (une ligne par reference). \
         Le prix et la remise de cette ligne sont conserves."
    )
}

pub async fn ajouter_ligne_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(l): Json<LigneBc>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Ecrire).await?;
    valider_ligne_bc(&l)?;

    // Le facteur est fige sur la ligne : si le conditionnement du fournisseur
    // change, les commandes passees restent reconstituables.
    let (kg, facteur) = poids_ligne_bc(&state.db, &l).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    // LE DOCUMENT SE PREND A LA VERSION LUE, en premiere ecriture : la ligne
    // se modifie sous le verrou de son en-tete (decision du 19/10/2026).
    crate::domain::concurrence::exiger_version(
        &mut tx, "bon_commande", "id_bc", &id, Some(crate::domain::concurrence::exigee(l.version)?), "Ce bon de commande",
    )
    .await?;

    let (statut, devise): (String, String) =
        sqlx::query_as("SELECT statut, code_devise FROM bon_commande WHERE id_bc = $1")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("bon de commande {id}")))?;
    if !se_modifie(&statut) {
        return Err(refus_modification(&statut));
    }

    // UNE LIGNE PAR REFERENCE (21/10/2026) : la reference deja sur le bon voit
    // sa ligne augmentee, au lieu d'en ouvrir une seconde.
    if let (false, Some(code)) = (l.sans_reference(), l.code_reference.as_deref()) {
        if let Some((existante, numero)) = ligne_meme_reference(&mut tx, &id, code).await? {
            augmenter_ligne_bc(
                &mut tx,
                &existante,
                &AjoutLigne {
                    kg,
                    unite: Some(&l.unite_commande),
                    quantite_unite: Some(l.quantite_commandee_unite),
                    palettes: l.nb_palettes,
                    bobines: l.nb_bobines,
                    id_proposition: l.id_proposition.as_deref().map(str::trim).filter(|s| !s.is_empty()),
                },
            )
            .await?;
            // Toucher a la quantite, c'est arbitrer : la ligne cesse de suivre le plan.
            sqlx::query("UPDATE ligne_bc SET arbitree = 1 WHERE id_ligne_bc = $1")
                .bind(&existante)
                .execute(&mut *tx)
                .await?;
            recalculer_bc(&mut tx, &id).await?;
            let version_entete =
                crate::domain::concurrence::version_actuelle(&mut tx, "bon_commande", "id_bc", &id).await?;
            tx.commit().await?;
            return Ok(Json(json!({ "version": version_entete,
                "id_ligne_bc": existante, "ligne_numero": numero, "fusionnee": true,
                "message": message_fusion(code, numero),
                "quantite_ajoutee_kg": kg, "facteur_kg": facteur
            })));
        }
    }

    let numero: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(ligne_numero), 0) + 1 FROM ligne_bc WHERE id_bc = $1",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;

    let id_ligne = uuid::Uuid::new_v4().to_string();
    inserer_ligne_bc(&mut tx, &id_ligne, &id, numero, &l, kg, facteur, &devise, false).await?;

    recalculer_bc(&mut tx, &id).await?;
    let version_entete = crate::domain::concurrence::version_actuelle(&mut tx, "bon_commande", "id_bc", &id).await?;
    tx.commit().await?;

    Ok(Json(json!({ "version": version_entete, 
        "id_ligne_bc": id_ligne, "ligne_numero": numero,
        "quantite_commandee_kg": kg, "facteur_kg": facteur
    })))
}

pub async fn supprimer_ligne_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((id, ligne)): Path<(String, String)>,
    axum::extract::Query(q): axum::extract::Query<super::entites::VersionLue>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    // LE DOCUMENT SE PREND A LA VERSION LUE, en premiere ecriture : la ligne
    // se modifie sous le verrou de son en-tete (decision du 19/10/2026).
    crate::domain::concurrence::exiger_version(
        &mut tx, "bon_commande", "id_bc", &id, Some(super::entites::version_exigee(q.version.map(serde_json::Value::String).as_ref())?), "Ce bon de commande",
    )
    .await?;

    let (recue, statut_bc): (f64, String) = sqlx::query_as(
        "SELECT COALESCE(l.quantite_recue_kg, 0)::float8, b.statut
           FROM ligne_bc l JOIN bon_commande b ON b.id_bc = l.id_bc
          WHERE l.id_ligne_bc = $1",
    )
    .bind(&ligne)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("ligne {ligne}")))?;
    // Au controle, en demande de prix et en attente de validation, les lignes
    // sont figees (21/10/2026).
    if matches!(statut_bc.as_str(), "EN_CONTROLE" | "DEMANDE_PRIX" | "EN_ATTENTE_VALIDATION") {
        return Err(refus_modification(&statut_bc));
    }
    if recue > 0.0 {
        return Err(AppError::RegleMetier(
            "Cette ligne a deja fait l'objet d'une reception : elle ne peut plus etre supprimee.".into(),
        ));
    }

    // La proposition d'origine retourne au pool AVANT la suppression, tant que
    // la ligne existe encore pour la designer. Le lien est porte par la LIGNE :
    // supprimer une ligne libere sa proposition meme si le reste du bon tient.
    // Rattache au bon entier, la reference serait restee bloquee en COMMANDE,
    // invisible pour le MRP, sans qu'aucune commande ne la couvre.
    let liberee: u64 = sqlx::query(
        "UPDATE plan_achat SET statut = 'PROPOSE', id_bc_genere = NULL
          WHERE statut = 'COMMANDE'
            AND id_proposition = (SELECT id_proposition FROM ligne_bc WHERE id_ligne_bc = $1)",
    )
    .bind(&ligne)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    sqlx::query("DELETE FROM ligne_bc WHERE id_ligne_bc = $1")
        .bind(&ligne)
        .execute(&mut *tx)
        .await?;
    recalculer_bc(&mut tx, &id).await?;
    let version_entete = crate::domain::concurrence::version_actuelle(&mut tx, "bon_commande", "id_bc", &id).await?;
    tx.commit().await?;

    Ok(Json(json!({ "version": version_entete,  "supprime": true, "proposition_liberee": liberee > 0 })))
}

#[derive(Debug, Deserialize)]
pub struct StatutBc {
    pub statut: String,
    /// A la validation d'un bon en devise : le taux retenu, s'il differe du
    /// cours propose (regle 10, 09/10/2026), avec son motif.
    #[serde(default)]
    pub taux_saisi: Option<f64>,
    #[serde(default)]
    pub motif_taux: Option<String>,
    /// Le taux saisi s'ecarte de plus de 3 % du cours BAM, et c'est voulu.
    #[serde(default)]
    pub confirme_taux: bool,
    /// LE MOTIF D'UN RENVOI EN BROUILLON (depuis le controle ou la demande de
    /// prix) ou d'une demande de prix SAUTEE (21/10/2026). Ecrit sur le bon,
    /// donc au journal du changement de statut.
    #[serde(default)]
    pub motif: Option<String>,
}

/// `DELETE /api/bons-commande/{id}` — la vraie suppression d'un bon non engage.
///
/// POURQUOI UNE SUPPRESSION ET NON UNE ANNULATION. Un bon annule reste dans la
/// liste, dans les etats, dans la numerotation. C'est juste pour un document
/// qui a engage quelque chose : on ne fait pas disparaitre un engagement, on
/// le contre-passe. Mais un BROUILLON n'engage rien, et un bon SOUMIS A
/// VALIDATION non plus — personne n'a signe, aucun fournisseur n'a ete
/// prevenu, aucun stock n'a bouge. Le garder « annule » pour la forme encombre
/// la liste de documents qui n'ont jamais existe pour personne.
///
/// LA LIMITE EST NETTE, ET ELLE NE SE NEGOCIE PAS : des qu'un bon est VALIDE,
/// il a engage l'entreprise. Il ne se supprime plus ; il s'annule, et la trace
/// demeure. Voir `changer_statut_bc`.
///
/// CE QUI EST VERIFIE AVANT D'EFFACER :
///   * le statut — brouillon ou en attente de validation, rien d'autre ;
///   * l'absence de reception : une marchandise deja recue contre ce bon en
///     fait un document engage, quel que soit son statut affiche.
///
/// LES PROPOSITIONS D'ACHAT RETOURNENT AU POOL. Sans ce retour, la reference
/// resterait marquee COMMANDE et le MRP ne la reproposerait jamais : un besoin
/// disparaitrait pour un bon qui n'existe plus.
pub async fn supprimer_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Ecrire).await?;

    // LU SOUS VERROU, DANS LA TRANSACTION QUI SUPPRIME (audit v5, U13) : lu
    // avant, le statut pouvait changer entre la lecture et l'effacement — un
    // bon valide a cet instant aurait ete supprime.
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let statut: String = sqlx::query_scalar("SELECT statut FROM bon_commande WHERE id_bc = $1 FOR UPDATE")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("bon de commande {id}")))?;

    // UN BON QUI A ETE VALIDE NE S'EFFACE PAS (audit v4) : devalide, il
    // redevenait brouillon et se supprimait physiquement, alors qu'il avait
    // engage l'entreprise (et parfois ete envoye). Il s'annule, la trace reste.
    let a_engage: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM audit_log
                         WHERE table_concernee = 'bon_commande' AND id_enregistrement = $1
                           AND operation = 'DEVALIDATION')",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    if a_engage {
        return Err(AppError::RegleMetier(
            "Ce bon a deja ete valide puis devalide : il a engage l'entreprise et ne se supprime plus. \
             Annulez-le — la trace restera."
                .into(),
        ));
    }

    // Au controle, en demande de prix ou en attente de validation, ses lignes
    // sont figees (21/10/2026) : il revient d'abord en brouillon (avec son
    // motif), ou il s'annule.
    if matches!(statut.as_str(), "EN_CONTROLE" | "DEMANDE_PRIX" | "EN_ATTENTE_VALIDATION") {
        return Err(AppError::RegleMetier(
            "Ce bon est au controle, en demande de prix ou en attente de validation : renvoyez-le en \
             brouillon pour le supprimer, ou annulez-le."
                .into(),
        ));
    }
    if statut != "BROUILLON" {
        return Err(AppError::RegleMetier(format!(
            "ce bon est {} : il a engage l'entreprise et ne se supprime plus. Annulez-le — la trace restera.",
            statut.to_lowercase().replace('_', " ")
        )));
    }

    let receptions: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM reception WHERE id_bc = $1")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
    if receptions > 0 {
        return Err(AppError::RegleMetier(format!(
            "{receptions} reception(s) se rattachent a ce bon : il a servi, il ne se supprime pas."
        )));
    }

    sqlx::query(
        "UPDATE plan_achat SET statut = 'PROPOSE', id_bc_genere = NULL
          WHERE statut = 'COMMANDE'
            AND id_proposition IN (SELECT id_proposition FROM ligne_bc
                                    WHERE id_bc = $1 AND id_proposition IS NOT NULL)",
    )
    .bind(&id)
    .execute(&mut *tx)
    .await?;

    let lignes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ligne_bc WHERE id_bc = $1")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM ligne_bc WHERE id_bc = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM bon_commande WHERE id_bc = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Json(json!({ "supprime": id, "lignes": lignes, "statut_avant": statut })))
}

pub async fn changer_statut_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(s): Json<StatutBc>,
) -> AppResult<Json<Value>> {
    let action = if s.statut == "VALIDE" { Action::Valider } else { Action::Ecrire };
    user.exiger(&state.db, module::BONS_COMMANDE, action).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let (createur, actuel): (String, String) = sqlx::query_as(
        "SELECT id_utilisateur_creation, statut FROM bon_commande WHERE id_bc = $1 FOR UPDATE",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("bon de commande {id}")))?;

    // Regle 15 : annuler un bon valide ou envoye est un acte de validation ;
    // le remettre en brouillon passe par la devalidation, avec son motif.
    crate::domain::transitions::exiger_transition(
        &state.db, &user, module::BONS_COMMANDE, "bon_commande", &actuel, &s.statut,
    )
    .await?;

    // LE CONTROLE ET LA DEMANDE DE PRIX (decision du 21/10/2026). La base tient
    // les memes gardes (trg_transition_bc, trg_bc_separation_taches) ; ici, le
    // message metier et les colonnes qui accompagnent chaque pas.
    let motif = s.motif.as_deref().map(str::trim).filter(|m| !m.is_empty()).map(String::from);
    let motif_lisible = motif.as_ref().is_some_and(|m| m.chars().count() >= 5);
    match (actuel.as_str(), s.statut.as_str()) {
        ("BROUILLON", "EN_CONTROLE") => {
            let lignes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ligne_bc WHERE id_bc = $1")
                .bind(&id)
                .fetch_one(&mut *tx)
                .await?;
            if lignes == 0 {
                return Err(AppError::RegleMetier("Un bon sans ligne ne part pas au controle.".into()));
            }
            sqlx::query("UPDATE bon_commande SET statut = 'EN_CONTROLE' WHERE id_bc = $1")
                .bind(&id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            return Ok(Json(json!({ "id_bc": id, "statut": s.statut })));
        }
        ("EN_CONTROLE", "DEMANDE_PRIX" | "EN_ATTENTE_VALIDATION") => {
            // UN AUTRE REGARD que celui de l'auteur, comme a la validation ; le
            // superviseur en est dispense pour la meme raison (22/09/2026).
            if createur == user.id && user.role != "ADMIN" {
                return Err(AppError::RegleMetier(
                    "B4 regle 4 : vous ne pouvez pas controler un bon de commande que vous avez cree. \
                     Un autre compte doit verifier quantites et fournisseur."
                        .into(),
                ));
            }
            let saut = s.statut == "EN_ATTENTE_VALIDATION";
            if saut && !motif_lisible {
                return Err(AppError::Invalide(
                    "Sauter la demande de prix demande un motif (prix sous contrat, achat local…).".into(),
                ));
            }
            sqlx::query(
                "UPDATE bon_commande
                    SET statut = $2, id_utilisateur_controle = $3, date_controle = fn_instant($4),
                        date_demande_prix = CASE WHEN $2 = 'DEMANDE_PRIX' THEN fn_instant($4) ELSE date_demande_prix END,
                        motif_saut_demande_prix = $5
                  WHERE id_bc = $1",
            )
            .bind(&id)
            .bind(&s.statut)
            .bind(&user.id)
            .bind(maintenant())
            .bind(if saut { motif.as_deref() } else { None })
            .execute(&mut *tx)
            .await?;
            if !saut {
                // LE PRIX D'AVANT LA DEMANDE : celui du plan ou de la saisie. Pose
                // une fois — un bon renvoye puis redemande garde son prix d'origine.
                sqlx::query(
                    "UPDATE ligne_bc
                        SET prix_unitaire_avant_demande = COALESCE(prix_unitaire_avant_demande, prix_unitaire_devise),
                            remise_pct_avant_demande = COALESCE(remise_pct_avant_demande, remise_pct)
                      WHERE id_bc = $1 AND statut <> 'ANNULE'",
                )
                .bind(&id)
                .execute(&mut *tx)
                .await?;
            }
            tx.commit().await?;
            return Ok(Json(json!({ "id_bc": id, "statut": s.statut })));
        }
        ("EN_CONTROLE" | "DEMANDE_PRIX" | "EN_ATTENTE_VALIDATION", "BROUILLON") => {
            // L'acheteur doit savoir quoi corriger — y compris depuis l'attente de
            // validation, ou le bon est desormais fige (21/10/2026) : le renvoi
            // est le seul chemin vers une correction.
            if !motif_lisible {
                return Err(AppError::Invalide(
                    "Dites pourquoi le bon revient en brouillon : l'acheteur doit savoir quoi corriger.".into(),
                ));
            }
            // Le controle est a refaire : le bon repassera par un second regard.
            sqlx::query(
                "UPDATE bon_commande
                    SET statut = 'BROUILLON', motif_renvoi = COALESCE($2, motif_renvoi),
                        id_utilisateur_controle = NULL, date_controle = NULL, motif_saut_demande_prix = NULL
                  WHERE id_bc = $1",
            )
            .bind(&id)
            .bind(motif.as_deref())
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            return Ok(Json(json!({ "id_bc": id, "statut": s.statut })));
        }
        _ => {}
    }

    if s.statut == "VALIDE" {
        // B4 regle 4 : la separation des taches. Un declencheur de la base la
        // tient aussi, mais un message metier vaut mieux qu'une exception SQL.
        //
        // LE SUPERVISEUR EN EST DISPENSE, sur decision de la direction. Dans
        // une PME il est souvent seul a saisir ET seul a pouvoir engager : lui
        // interdire de valider ne cree pas un second regard, cela cree un bon
        // bloque — et quelqu'un finit par partager un mot de passe pour en
        // sortir. Une regle qu'on contourne protege moins qu'une regle qu'on
        // assume. La TRACE, elle, reste entiere : le journal montre qui a
        // valide, et donc qu'il s'agissait de l'auteur.
        if createur == user.id && user.role != "ADMIN" {
            return Err(AppError::RegleMetier(
                "B4 regle 4 : vous ne pouvez pas valider un bon de commande que vous avez cree.".into(),
            ));
        }

        let lignes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ligne_bc WHERE id_bc = $1")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
        if lignes == 0 {
            return Err(AppError::RegleMetier(
                "Un bon de commande sans ligne ne peut pas etre valide.".into(),
            ));
        }

        // UN TAUX PERIME N'ENGAGE PAS (regle 18, 08/10/2026). Le bon s'engage
        // au taux de reference de l'ERP ; s'il date de plus de
        // P_AncienneteTauxJours (7 j), il ne dit plus le marche : on demande le
        // taux du jour avant de valider. Le taux de chaque facture d'import,
        // lui, reste celui de sa facture (cours BAM du jour).
        let (devise_bc, date_taux): (String, Option<String>) = sqlx::query_as(
            "SELECT bc.code_devise,
                    (SELECT t.date_debut::text FROM taux_change t
                      WHERE t.code_devise = bc.code_devise
                        AND to_char(current_date, 'YYYY-MM-DD') >= substr(t.date_debut, 1, 10)
                        AND (t.date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(t.date_fin, 1, 10))
                      ORDER BY t.date_debut DESC LIMIT 1)
               FROM bon_commande bc WHERE bc.id_bc = $1",
        )
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
        let taux_saisi = s.taux_saisi.filter(|t| *t > 0.0);
        if devise_bc != "MAD" && taux_saisi.is_none() {
            let limite: i64 = sqlx::query_scalar(
                "SELECT COALESCE((SELECT CAST(valeur_courante AS bigint) FROM parametre
                                   WHERE code_parametre = 'P_AncienneteTauxJours'), 7)",
            )
            .fetch_one(&mut *tx)
            .await?;
            let age: Option<i64> = match &date_taux {
                Some(d) => sqlx::query_scalar("SELECT (current_date - substr($1, 1, 10)::date)::bigint")
                    .bind(d)
                    .fetch_one(&mut *tx)
                    .await?,
                None => None,
            };
            match age {
                None => {
                    return Err(AppError::RegleMetier(format!(
                        "Aucun taux {devise_bc} en vigueur : saisissez le taux du jour (cours BAM) avant de valider ce bon."
                    )))
                }
                Some(a) if a > limite => {
                    return Err(AppError::RegleMetier(format!(
                        "Le taux {devise_bc} en vigueur date de {a} jours (au-dela de {limite}) : saisissez le taux \
                         du jour (cours BAM, Configuration → Devises et taux) avant de valider ce bon."
                    )))
                }
                _ => {}
            }
        }

        // RG-09 : le taux retenu est celui du jour de la validation, pas celui de
        // la creation. Un bon de commande se prepare sur des semaines ; le change
        // a bouge entre-temps.
        //
        // Le reengagement precede le controle de plafond, et ce n'est pas un
        // detail d'ordre : le plafond doit porter sur ce qui est REELLEMENT
        // engage. Verifie avant, il jugeait un montant calcule au taux de la
        // creation — un acheteur pouvait donc engager au-dela de son plafond des
        // que la devise montait. Si le controle echoue, la transaction est
        // annulee et le taux revient a sa valeur d'origine.
        //
        // LE TAUX PROPOSE, PUIS RETENU (regle 10, 09/10/2026). Propose : le taux de
        // reference du jour de la validation. Celui qui valide peut en retenir un
        // autre (le cours confirme par la banque), avec un motif ; au-dela de 3 %
        // du cours Bank Al-Maghrib, il le confirme. Le bon garde la justification :
        // le taux, le jour du cours, sa source, le motif.
        let propose: Option<(f64, String)> = sqlx::query_as(
            "SELECT t.taux::float8, substr(t.date_debut, 1, 10)
               FROM taux_change t JOIN bon_commande bc ON bc.code_devise = t.code_devise
              WHERE bc.id_bc = $1
                AND to_char(current_date, 'YYYY-MM-DD') >= substr(t.date_debut, 1, 10)
                AND (t.date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(t.date_fin, 1, 10))
              ORDER BY t.date_debut DESC LIMIT 1",
        )
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?;
        let (taux_retenu, date_cours, source, motif_taux, taux_plafond) = if devise_bc == "MAD" {
            (1.0, None, None, None, 1.0)
        } else {
            let (t_prop, jour_prop) = propose.clone().unzip();
            match taux_saisi.filter(|t| t_prop.is_none_or(|p| (t - p).abs() > 1e-9)) {
                Some(t) => {
                    let motif = s.motif_taux.as_deref().map(str::trim).unwrap_or("").to_string();
                    if motif.chars().count() < 5 {
                        return Err(AppError::Invalide(
                            "Le taux retenu differe du cours propose : dites pourquoi (cours confirme par la \
                             banque, couverture…)."
                                .into(),
                        ));
                    }
                    let jour = crate::db::aujourdhui();
                    let t = crate::routes::importation::controler_taux(
                        &mut tx, "Le taux du bon", &devise_bc, Some(t), &jour, s.confirme_taux,
                    )
                    .await?;
                    (t, Some(jour), Some("SAISI"), Some(motif), t.max(t_prop.unwrap_or(t)))
                }
                None => {
                    let t = t_prop.ok_or_else(|| {
                        AppError::RegleMetier(format!("Aucun taux {devise_bc} en vigueur : saisissez le taux du jour."))
                    })?;
                    (t, jour_prop, Some("REFERENCE"), None, t)
                }
            }
        };
        sqlx::query(
            "UPDATE bon_commande
                SET taux_change_engage = CASE WHEN code_devise = 'MAD' THEN taux_change_engage ELSE $3 END,
                    date_taux_engage = fn_instant($2), date_cours_engage = fn_jour_casablanca($4), source_taux_engage = $5, motif_taux_engage = $6
              WHERE id_bc = $1",
        )
        .bind(&id)
        .bind(maintenant())
        .bind(taux_retenu)
        .bind(&date_cours)
        .bind(source)
        .bind(&motif_taux)
        .execute(&mut *tx)
        .await?;

        recalculer_bc(&mut tx, &id).await?;

        // B4 regle 3 : validation par paliers de montant, sur le montant reengage.
        let montant: f64 =
            sqlx::query_scalar(
        "SELECT COALESCE(montant_total_mad, 0)::float8 FROM bon_commande WHERE id_bc = $1",
    )
                .bind(&id)
                .fetch_one(&mut *tx)
                .await?;
        // LE PLAFOND SE JUGE SUR LE PLUS HAUT DES DEUX TAUX (regle 10) : baisser le
        // taux a la main ne doit pas faire passer un bon sous son plafond.
        let montant = if taux_retenu > 0.0 { montant * taux_plafond / taux_retenu } else { montant };
        if let Some(plafond) =
            crate::auth::rbac::plafond_validation_bc(&state.db, &user.role).await?
        {
            if montant > plafond {
                return Err(AppError::RegleMetier(format!(
                    "Montant de {montant:.2} MAD superieur a votre plafond de validation \
                     ({plafond:.2} MAD). La Direction doit valider ce bon de commande."
                )));
            }
        }

        sqlx::query(
            "UPDATE bon_commande
                SET statut = 'VALIDE', date_validation = fn_instant($2), id_utilisateur_validation = $3
              WHERE id_bc = $1",
        )
        .bind(&id)
        .bind(maintenant())
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;
    } else {
        let date_envoi = if s.statut == "ENVOYE" { Some(maintenant()) } else { None };
        sqlx::query(
            "UPDATE bon_commande SET statut = $2, date_envoi = COALESCE(fn_instant($3), date_envoi)
              WHERE id_bc = $1",
        )
        .bind(&id)
        .bind(&s.statut)
        .bind(date_envoi)
        .execute(&mut *tx)
        .await?;

        // Un bon annule n'engage plus rien : la reference redevient regenerable.
        //
        // LA PROPOSITION SE CLOT AVEC LE BON (decision du 27/10/2026, migration
        // 2026-10-27f). Elle ne retourne plus au pool : rouverte (PROPOSE), elle
        // restait designee par la ligne du bon annule, et la regeneration, qui
        // purge les propositions ouvertes, butait sur fk_ligne_bc_id_proposition
        // (400). Elle passe a ANNULE_BC (« Annulee avec le bon »), garde son lien
        // au bon (id_bc_genere, et la ligne qui la designe) — l'historique est
        // intact —, n'est plus ouverte (ni purgee, ni comptee, hors de l'index
        // ux_plan_achat_ouvert), et la regeneration suivante en cree une NEUVE si
        // le moteur de couverture en propose une. C'est un etat final, garanti en
        // base (PA-ANNULE-BC).
        if s.statut == "ANNULE" {
            // UNE PROPOSITION OUVERTE CALCULEE AVEC CE BON (08/10/2026). Depuis le
            // 06/10, une reference commandee se repropose : quand le bon s'annule,
            // une proposition plus recente est souvent deja ouverte pour elle,
            // calculee en deduisant ce bon, qui n'existe plus. La recente,
            // recalculable, part — le generateur la refait a chaque passage, sans
            // le bon cette fois ; une proposition figee ou arbitree, decision
            // humaine, reste.
            sqlx::query(
                "DELETE FROM plan_achat
                  WHERE statut IN ('PROPOSE','EN_REVISION','VALIDE')
                    AND figee = 0 AND code_reference_origine IS NULL
                    AND NOT EXISTS (SELECT 1 FROM ligne_bc l0 WHERE l0.id_proposition = plan_achat.id_proposition)
                    AND code_reference IN (
                        SELECT pa.code_reference FROM plan_achat pa
                         WHERE pa.statut = 'COMMANDE'
                           AND (pa.id_bc_genere = $1
                                OR pa.id_proposition IN (SELECT l.id_proposition FROM ligne_bc l
                                                          WHERE l.id_bc = $1 AND l.id_proposition IS NOT NULL)))",
            )
            .bind(&id)
            .execute(&mut *tx)
            .await?;
            // Le lien passe par les LIGNES (la granularite a laquelle une
            // proposition est engagee) et par id_bc_genere (une proposition
            // fondue dans une ligne qui en portait deja une autre n'est designee
            // que par lui).
            sqlx::query(
                "UPDATE plan_achat SET statut = 'ANNULE_BC', id_bc_genere = $1
                  WHERE statut = 'COMMANDE'
                    AND (id_bc_genere = $1
                         OR (id_bc_genere IS NULL
                             AND id_proposition IN (SELECT id_proposition FROM ligne_bc
                                                     WHERE id_bc = $1 AND id_proposition IS NOT NULL)))",
            )
            .bind(&id)
            .execute(&mut *tx)
            .await?;
            sqlx::query("UPDATE ligne_bc SET statut = 'ANNULE' WHERE id_bc = $1")
                .bind(&id)
                .execute(&mut *tx)
                .await?;
        }
    }

    tx.commit().await?;
    Ok(Json(json!({ "id_bc": id, "statut": s.statut })))
}

#[derive(Debug, Deserialize)]
pub struct ModifBc {
    /// Version du document telle que le client l'a lue. Absente, la
    /// verification de concurrence est sautee (A2, 17/10/2026).
    pub version: Option<i64>,

    pub date_bc: Option<String>,
    pub date_livraison_prevue: Option<String>,
    pub conditions_paiement: Option<String>,
    pub notes: Option<String>,
    pub motif_creation: Option<String>,
    /// Ce que le document fournisseur imprime en face de « SHIPMENT DATE ».
    pub mention_expedition: Option<String>,
    /// Force le nombre de conteneurs annonce, au lieu de le laisser calculer.
    /// Une chaine vide vaut « reprends le calcul » — d'ou `Option<String>` :
    /// un `Option<i64>` ne saurait pas distinguer « efface » de « ne touche pas ».
    pub nombre_conteneurs: Option<String>,
    /// Changer la devise du bon : le taux engage est repris au taux en vigueur
    /// de la nouvelle devise, les lignes suivent, les totaux sont recalcules.
    pub code_devise: Option<String>,
}

/// Modifie l'entete d'un bon de commande tant qu'il n'est pas engage.
///
/// Il manquait purement et simplement : on pouvait creer un bon et changer son
/// statut, mais pas corriger une date de livraison ou une condition de paiement.
/// Un bon se prepare sur des semaines — l'obliger a naitre parfait n'avait aucun
/// sens.
///
/// Le fournisseur, lui, ne se change pas : la devise, le taux engage et les
/// prix des lignes en decoulent. Changer de fournisseur, c'est un autre bon.
pub async fn modifier_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(b): Json<ModifBc>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // VERROU OPTIMISTE (A2). Si quelqu'un a modifie le document depuis que
    // ce client l'a lu, on refuse en le nommant plutot que d'ecraser sa
    // saisie en silence. Le garde verrouille aussi la ligne pour la suite.
    exiger_version(
        &mut tx, "bon_commande", "id_bc", &id,
        Some(crate::domain::concurrence::exigee(b.version)?), "Ce bon de commande",
    )
    .await?;

    let statut: String =
        sqlx::query_scalar("SELECT statut FROM bon_commande WHERE id_bc = $1")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Introuvable(format!("bon de commande {id}")))?;
    if !se_modifie(&statut) {
        return Err(refus_modification(&statut));
    }

    sqlx::query(
        "UPDATE bon_commande
            SET date_bc               = COALESCE(fn_jour_casablanca($2), date_bc),
                date_livraison_prevue = COALESCE(fn_jour_casablanca($3), date_livraison_prevue),
                conditions_paiement   = COALESCE($4, conditions_paiement),
                notes                 = COALESCE($5, notes),
                motif_creation        = COALESCE($6, motif_creation),
                mention_expedition    = COALESCE($7, mention_expedition),
                -- UNE CHAINE VIDE EFFACE, et c'est la difference qui compte :
                -- vider le champ doit rendre la main au calcul, pas conserver
                -- le dernier chiffre force. `NULLIF` en fait un NULL ; le
                -- `CASE` distingue « champ absent de la requete » — on ne
                -- touche a rien — de « champ present mais vide » — on efface.
                nombre_conteneurs     = CASE WHEN $8::text IS NULL THEN nombre_conteneurs
                                             ELSE NULLIF($8, '')::bigint END
          WHERE id_bc = $1",
    )
    .bind(&id)
    .bind(&b.date_bc)
    .bind(&b.date_livraison_prevue)
    .bind(&b.conditions_paiement)
    .bind(&b.notes)
    .bind(&b.motif_creation)
    .bind(&b.mention_expedition)
    .bind(&b.nombre_conteneurs)
    .execute(&mut *tx)
    .await?;

    // LA DEVISE AU CHOIX (01/10/2026). Les PRIX des lignes ne sont pas
    // convertis : un prix negocie en euros ne devient pas un prix en dollars
    // par un calcul. L'ecran demande de les reverifier.
    if let Some(devise) = b.code_devise.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        let taux: f64 = taux_au(&mut tx, devise, &crate::db::aujourdhui())
        .await?
        .ok_or_else(|| AppError::RegleMetier(format!("Aucun taux de change en vigueur pour {devise}.")))?;
        sqlx::query(
            "UPDATE bon_commande SET code_devise = $2, taux_change_engage = $3, date_taux_engage = fn_instant($4)
              WHERE id_bc = $1 AND code_devise <> $2",
        )
        .bind(&id)
        .bind(devise)
        .bind(taux)
        .bind(maintenant())
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE ligne_bc SET code_devise = $2 WHERE id_bc = $1 AND code_devise <> $2")
            .bind(&id)
            .bind(devise)
            .execute(&mut *tx)
            .await?;
        recalculer_bc(&mut tx, &id).await?;
    }

    let version_entete = crate::domain::concurrence::version_actuelle(&mut tx, "bon_commande", "id_bc", &id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "version": version_entete,  "id_bc": id, "modifie": true })))
}

/// Les references commandables aupres du fournisseur du bon, avec leur contexte.
///
/// La saisie proposait tout le catalogue dans une liste deroulante : deux mille
/// references, celles des autres fournisseurs comprises, sans stock, sans besoin
/// et sans prix. On choisissait un code a l'aveugle.
///
/// Ici chaque reference arrive avec ce qui permet de decider : ce qu'il en reste
/// en projete, ce que le plan d'achat suggere d'en commander, a quelle urgence,
/// et a quel prix. C'est le plan d'achat amene DANS la saisie, plutot qu'un
/// ecran a consulter a cote.
pub async fn references_commandables(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(q): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Lire).await?;

    // Deux appels possibles : depuis un bon existant, ou a la CREATION, quand
    // aucun bon n'existe encore et qu'on vient seulement de choisir le
    // fournisseur. Le second cas est celui qui compte : c'est la que l'acheteur
    // decide quoi commander, pas apres avoir ouvert un document vide.
    let id = q.get("id_bc").cloned().unwrap_or_default();

    // `toutes=1` : TOUT LE CATALOGUE, pas seulement les references rattachees a
    // ce fournisseur. Le rattachement du catalogue est une habitude d'achat, pas
    // une exclusivite : un fournisseur qui propose un meilleur prix sur un fil
    // qu'on achete ailleurs doit pouvoir etre commande. L'ecran reste par defaut
    // sur les siennes — c'est ce qu'on commande neuf fois sur dix — et ouvre le
    // catalogue entier sur demande.
    let toutes: i64 = if q.get("toutes").map(String::as_str) == Some("1") { 1 } else { 0 };

    // LA RECHERCHE SE FAIT ICI, PAS DANS LE NAVIGATEUR.
    //
    // Sur 124 references, charger tout le catalogue et filtrer a l'ecran
    // passait. Sur 1000 — et ce catalogue y va — c'est une seconde d'attente a
    // chaque ouverture d'ecran, et une liste que personne ne peut parcourir.
    // L'acheteur tape « bleu 1500 » : le serveur rend les quelques lignes qui
    // correspondent, avec leur prix et ce que le plan en dit.
    //
    // Chaque mot doit etre trouve, dans n'importe quelle colonne : la reference,
    // la designation, la couleur, le type de fil, ou le nom du fournisseur —
    // ce dernier compte quand on ouvre le catalogue entier.
    let recherche = q.get("recherche").map(|s| s.trim()).filter(|s| !s.is_empty());
    let mots: Vec<String> = recherche
        .map(|r| r.split_whitespace().map(|m| format!("%{m}%")).collect())
        .unwrap_or_default();
    let filtre_recherche = if mots.is_empty() {
        String::new()
    } else {
        // $5 et au-dela : les quatre premiers parametres sont deja pris.
        (0..mots.len())
            .map(|i| {
                let n = i + 5;
                format!(
                    " AND (r.code_reference ILIKE ${n} OR r.designation ILIKE ${n}
                           OR COALESCE(r.couleur, '') ILIKE ${n}
                           OR COALESCE(r.type_fil, '') ILIKE ${n}
                           OR f.nom ILIKE ${n})"
                )
            })
            .collect()
    };
    // Une recherche rend peu de lignes ; sans recherche on garde le plafond
    // d'origine, puisque l'ecran groupe encore par section.
    let plafond: i64 = q
        .get("limite")
        .and_then(|v| v.parse().ok())
        .unwrap_or(if recherche.is_some() { 25 } else { 2000 })
        .clamp(1, 2000);

    let fournisseur: String = match q.get("code_fournisseur") {
        Some(f) if !f.is_empty() => f.clone(),
        _ => sqlx::query_scalar("SELECT code_fournisseur FROM bon_commande WHERE id_bc = $1")
            .bind(&id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| {
                AppError::Invalide("preciser code_fournisseur ou id_bc".into())
            })?,
    };

    // Le taux sert a proposer le prix dans la devise du bon. A la creation il
    // n'y a pas encore de bon : on prend le taux en vigueur pour la devise du
    // fournisseur, celui-la meme qui sera engage a la creation.
    let taux: f64 = sqlx::query_scalar(
        "SELECT COALESCE((SELECT t.taux FROM taux_change t
                           JOIN fournisseur f ON f.code_devise = t.code_devise
                          WHERE f.code_fournisseur = $2
                            AND to_char(current_date, 'YYYY-MM-DD') >= substr(t.date_debut, 1, 10)
                            AND (t.date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(t.date_fin, 1, 10))
                          ORDER BY t.date_debut DESC LIMIT 1),
                        (SELECT bc.taux_change_engage FROM bon_commande bc WHERE bc.id_bc = $1),
                        1.0)::float8",
    )
    .bind(&id)
    .bind(&fournisseur)
    .fetch_one(&state.db)
    .await?;

    // LA TENSION VIENT DU MOTEUR DE COUVERTURE (27/10/2026) : les references au
    // plan non couvert puis sous la securite, les plus proches de la rupture
    // d'abord. Elles ordonnent la liste (apres ce que le plan d'achat propose) et
    // designent les references « en tension » dont celle-ci est l'equivalent.
    let etats = super::couverture::etats(&state.db).await?;
    let en_tension: Vec<String> = etats.en_tension().iter().map(|e| e.code_reference.clone()).collect();
    let n_tension = mots.len() + 5;

    let sql_commandables = format!(
        "SELECT r.code_reference, r.designation, r.unite_catalogue, r.prix_catalogue,
                r.version AS version_reference,
                r.code_devise_catalogue, r.classe_abc, r.moq_kg, r.multiple_achat_kg,
                -- LE CONDITIONNEMENT VOYAGE AVEC LA SUGGESTION.
                --
                -- L'ecran convertissait palettes et bobines en kilos grace au
                -- catalogue entier, charge a chaque ouverture. A mille
                -- references ce n'est plus tenable : les parametres partent
                -- desormais avec chaque ligne trouvee, et le catalogue n'est
                -- plus charge du tout.
                r.poids_bobine_kg, r.bobines_par_palette, r.bobines_par_lot,
                r.densite_kg_ml, r.description_commerciale,
                -- CE QUE LE FOURNISSEUR RECONNAIT. Le bon part chez lui : il y
                -- lit SON code article et SON code couleur, pas les notres.
                r.reference_fournisseur, r.couleur, r.code_couleur,
                -- LE FOURNISSEUR HABITUEL, pas une exclusivite. Le catalogue dit
                -- chez qui on achete d'ordinaire ; rien n'empeche de commander
                -- le meme fil ailleurs quand le prix ou le delai l'exigent. Le
                -- bon doit donc pouvoir porter une reference d'un autre, en le
                -- DISANT — d'ou cette colonne, que l'ecran affiche en clair.
                r.code_fournisseur,
                -- Le stock et la lecture du plan restant ; l'etat de couverture
                -- (statut_stock, jours couverts, 1re rupture, a commander) est
                -- ajoute par le moteur apres la requete (27/10/2026).
                sp.stock_mrp_kg, b12.besoin_12m_kg,
                (SELECT round(COALESCE(sum(lb.quantite_restante_kg), 0), 4) FROM ligne_bc lb
                   JOIN bon_commande bc2 ON bc2.id_bc = lb.id_bc
                  WHERE lb.code_reference = r.code_reference AND bc2.statut IN ('VALIDE','ENVOYE','LIVRE_PARTIEL')
                    AND lb.statut NOT IN ('ANNULE','SOLDE') AND lb.type_ligne = 'MARCHANDISE'
                    AND lb.quantite_restante_kg > 0) AS deja_commande_kg,
                pa.risque_sourcing, f.delai_livraison_jours, f.nom AS fournisseur_nom,
                -- La proposition que la ligne servira : meme regle que le serveur au
                -- rattachement. L'ecran la renvoie ; la base refuse si un autre bon
                -- l'a deja prise entre-temps (R-PROP, 19/10/2026).
                (SELECT p.id_proposition FROM plan_achat p
                  WHERE p.code_reference = r.code_reference
                    AND p.statut IN ('PROPOSE','EN_REVISION','VALIDE')
                  ORDER BY p.id_proposition LIMIT 1) AS id_proposition,
                pa.qte_a_commander_kg, pa.qte_a_commander_unite, pa.tier,

                -- Prix propose, TOUJOURS renseigne, dans la devise du bon.
                --
                -- Trois sources, dans l'ordre de fiabilite : le prix retenu par
                -- le plan d'achat, sinon le CMUP — ce qu'on a reellement paye —
                -- sinon le catalogue converti. Sans ce repli, la saisie
                -- n'affichait aucun prix des que le stock couvrait les besoins,
                -- puisque le plan d'achat ne proposait plus rien.
                --
                -- La source est dite, jamais devinee (RG-08) : un prix catalogue
                -- est une intention de vendeur, pas un cout constate.
                COALESCE(pa.prix_estime_mad, r.cmup_mad,
                         ROUND(r.prix_catalogue_kg * COALESCE((
                             SELECT t.taux FROM taux_change t
                              WHERE t.code_devise = r.code_devise_catalogue
                                AND to_char(current_date, 'YYYY-MM-DD') >= substr(t.date_debut, 1, 10)
                                AND (t.date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(t.date_fin, 1, 10))
                              ORDER BY t.date_debut DESC LIMIT 1), 1.0), 4)) AS prix_mad_suggere,
                -- LE PRIX EN DEVISE DE LA PROPOSITION, tel quel, quand c'est la
                -- devise du bon (21/10/2026) : le prix MAD redivise par le taux
                -- du jour ne rendait pas le prix negocie (3,3395 pour 3,38 USD).
                CASE WHEN pa.prix_devise > 0
                      AND pa.devise = COALESCE((SELECT bc.code_devise FROM bon_commande bc WHERE bc.id_bc = $1),
                                               f.code_devise)
                     THEN ROUND(pa.prix_devise, 6)
                     ELSE
                ROUND(COALESCE(pa.prix_estime_mad, r.cmup_mad,
                         r.prix_catalogue_kg * COALESCE((
                             SELECT t.taux FROM taux_change t
                              WHERE t.code_devise = r.code_devise_catalogue
                                AND to_char(current_date, 'YYYY-MM-DD') >= substr(t.date_debut, 1, 10)
                                AND (t.date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(t.date_fin, 1, 10))
                              ORDER BY t.date_debut DESC LIMIT 1), 1.0))
                      -- LE TAUX ARRIVE EN `float8` (il est lie depuis un `f64`).
                      -- Sans ce cast, la division rend un `double precision`,
                      -- et PostgreSQL n'a pas de `round(double precision, int)` :
                      -- la requete entiere echouait en 500, donc l'ecran de
                      -- creation d'un bon n'affichait AUCUNE reference — sans
                      -- un mot expliquant pourquoi.
                      / $3::numeric, 6) END AS prix_suggere_devise,
                -- LA SOURCE SUIT L'ORDRE DU COALESCE (audit du 13/10/2026) : elle
                -- annoncait « CATALOGUE » pour un prix qui etait le CMUP, et le
                -- masquage du CMUP ne le reconnaissait donc pas.
                CASE WHEN pa.prix_estime_mad IS NOT NULL THEN pa.source_prix
                     WHEN r.cmup_mad IS NOT NULL THEN 'CMUP'
                     WHEN r.prix_catalogue_kg IS NOT NULL THEN 'CATALOGUE'
                     ELSE 'AUCUN' END AS source_prix,
                -- Deja saisie sur ce bon : on la montre barree plutot que de la
                -- masquer, sinon on la cherche sans comprendre pourquoi elle
                -- manque.
                (SELECT COUNT(*) FROM ligne_bc l
                  WHERE l.id_bc = $1 AND l.code_reference = r.code_reference) AS deja_sur_le_bon,

                -- EQUIVALENCE. Le filtre par fournisseur reste : un bon est
                -- adresse a UN fournisseur, et proposer la reference d'un autre
                -- n'aurait aucun sens. Ce qui manquait, c'est le rapprochement :
                -- cette reference-ci, que ce fournisseur livre, est peut-etre
                -- l'equivalent d'une reference en tension qu'on achete ailleurs.
                --
                -- Sans cette colonne, elle se noie dans « les autres references
                -- du fournisseur » et personne ne fait le lien au moment ou il
                -- serait le plus utile — celui de la saisie.
                --
                -- UNE LECTURE DE v_equivalence, PAS DEUX (24/10/2026) : la
                -- reference en tension et son besoin viennent de la meme ligne
                -- (jointure LATERAL plus bas). Chaque sous-requete depliait la
                -- vue, donc le stock projete et le besoin, une fois de plus.
                eq.equivalent_de, eq.besoin_equivalent_kg,
                -- Le nombre d'equivalents ne depend que des groupes : les lignes
                -- de v_equivalence ou `code_reference` est cette reference, sans
                -- ses jointures de stock (une ligne au plus par reference, elles
                -- ne changent pas le compte).
                (SELECT COUNT(*) FROM reference_groupe_equiv q1
                   JOIN groupe_equiv qg ON qg.code_groupe_equiv = q1.code_groupe_equiv AND qg.actif = 1
                   JOIN reference_groupe_equiv q2 ON q2.code_groupe_equiv = q1.code_groupe_equiv
                                                 AND q2.code_reference <> q1.code_reference AND q2.actif = 1
                   JOIN reference qr ON qr.code_reference = q2.code_reference AND qr.actif = 1
                  WHERE q1.code_reference = r.code_reference AND q1.actif = 1 AND r.actif = 1) AS nb_equivalents
           FROM reference r
           JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
           LEFT JOIN v_stock_disponible sp ON sp.code_reference = r.code_reference
           LEFT JOIN v_besoin_12m      b12 ON b12.code_reference = r.code_reference
           -- CE QUE LE PLAN D'ACHAT PROPOSE : la proposition ouverte, faite par le
           -- moteur de couverture (quantite, prix, palier), et non plus l'ancien
           -- calcul v_plan_achat (27/10/2026).
           LEFT JOIN LATERAL (
                SELECT p.risque_identifie AS risque_sourcing,
                       p.quantite_suggeree_kg AS qte_a_commander_kg,
                       p.quantite_suggeree_unite AS qte_a_commander_unite,
                       p.urgence AS tier, p.prix_estime_mad, p.source_prix,
                       p.prix_devise, p.code_devise AS devise
                  FROM plan_achat p
                 WHERE p.code_reference = r.code_reference
                   AND p.statut IN ('PROPOSE','EN_REVISION','VALIDE')
                 ORDER BY p.id_proposition LIMIT 1) pa ON true
           LEFT JOIN LATERAL (
                SELECT e.code_reference AS equivalent_de,
                       ROUND(COALESCE(e.besoin_12m_kg, 0), 3) AS besoin_equivalent_kg
                  FROM v_equivalence e
                 WHERE e.equivalent_reference = r.code_reference
                   AND e.interchangeable = 1
                   AND e.code_reference = ANY(${n_tension}::text[])
                 ORDER BY array_position(${n_tension}::text[], e.code_reference)
                 LIMIT 1) eq ON true
          WHERE r.actif = 1 AND ($4 = 1 OR r.code_fournisseur = $2){filtre_recherche}
          -- CE QUE LE PLAN RECLAME D'ABORD, puis ce qui est en tension. Quand on
          -- cherche a la frappe, les premieres lignes doivent etre celles qu'on
          -- avait des raisons de commander.
          ORDER BY CASE WHEN COALESCE(pa.qte_a_commander_kg, 0) > 0 THEN 0 ELSE 1 END,
                   COALESCE(array_position(${n_tension}::text[], r.code_reference), 2147483647),
                   r.code_reference
          LIMIT {plafond}"
    );
    let mut requete = sqlx::query(&sql_commandables)
    .bind(&id)
    .bind(&fournisseur)
    .bind(taux)
    .bind(toutes);
    for mot in &mots {
        requete = requete.bind(mot);
    }
    requete = requete.bind(&en_tension);
    let rows = requete.fetch_all(&state.db).await?;

    let mut valeur = lignes_en_json(&rows);
    // L'etat du moteur s'ajoute ; la quantite « a commander » reste celle de la
    // proposition ouverte (figee ou arbitree par l'acheteur), pas le calcul brut.
    let proposees: Vec<Value> = valeur
        .as_array()
        .map(|a| a.iter().map(|l| l["qte_a_commander_kg"].clone()).collect())
        .unwrap_or_default();
    etats.enrichir(&mut valeur, "statut_stock");
    if let Some(a) = valeur.as_array_mut() {
        for (l, q) in a.iter_mut().zip(proposees) {
            if let Some(o) = l.as_object_mut() {
                o.insert("qte_a_commander_kg".into(), q);
            }
        }
    }
    // LE PRIX AU CMUP D'ABORD (audit du 13/10/2026) : `masquer` retire la
    // source du prix, et le masquage du CMUP, passe apres, ne la trouvait plus.
    user.masquer_prix_au_cmup(&state.db, &mut valeur).await?;
    user.masquer(&state.db, module::BONS_COMMANDE, &mut valeur).await?;
    Ok(Json(valeur))
}

/// Modifie une ligne de bon de commande, et la VERROUILLE.
///
/// C'est le geste qui verrouille, pas une case a cocher : toucher a la quantite,
/// au prix ou a la date, c'est arbitrer. La ligne cesse alors de suivre le plan,
/// et le recalcul se contentera de signaler que le besoin a bouge.
pub async fn modifier_ligne_bc(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((id, ligne)): Path<(String, String)>,
    Json(l): Json<ModifLigneBc>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::BONS_COMMANDE, Action::Ecrire).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    // LE DOCUMENT SE PREND A LA VERSION LUE, en premiere ecriture : la ligne
    // se modifie sous le verrou de son en-tete (decision du 19/10/2026).
    crate::domain::concurrence::exiger_version(
        &mut tx, "bon_commande", "id_bc", &id, Some(crate::domain::concurrence::exigee(l.version)?), "Ce bon de commande",
    )
    .await?;

    // `Option<String>` POUR LA REFERENCE : une ligne de prestation n'en porte
    // pas. Decodee en `String`, sqlx echouait en erreur interne des qu'on
    // touchait au prix d'un transport.
    let (statut_bc, type_ligne, code_reference, unite, recue): (
        String,
        String,
        Option<String>,
        String,
        f64,
    ) = sqlx::query_as(
            "SELECT bc.statut, lb.type_ligne, lb.code_reference, lb.unite_commande,
                    COALESCE(lb.quantite_recue_kg, 0)::float8
               FROM ligne_bc lb JOIN bon_commande bc ON bc.id_bc = lb.id_bc
              WHERE lb.id_ligne_bc = $1 AND lb.id_bc = $2",
        )
        .bind(&ligne)
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Introuvable(format!("ligne {ligne}")))?;

    // LA REPONSE DU FOURNISSEUR (demande de prix, 21/10/2026) : seuls le prix et
    // la remise de la ligne se saisissent. Le prix d'avant reste sur la ligne
    // (`prix_unitaire_avant_demande`) pour signaler l'ecart (C59).
    let reponse_prix = statut_bc == "DEMANDE_PRIX";
    if reponse_prix {
        if l.code_reference.is_some()
            || l.unite_commande.is_some()
            || l.quantite_commandee_unite.is_some()
            || l.nb_palettes.is_some()
            || l.nb_bobines.is_some()
            || l.date_livraison_prevue.is_some()
        {
            return Err(refus_modification(&statut_bc));
        }
        if l.prix_unitaire_devise.is_none() && l.remise_pct.is_none() {
            return Err(AppError::Invalide("Saisissez le prix confirme par le fournisseur.".into()));
        }
    } else if !se_modifie(&statut_bc) {
        return Err(refus_modification(&statut_bc));
    }

    // LA REFERENCE ET L'UNITE SE TRAITENT AVANT LA QUANTITE : elles changent
    // le facteur de conversion, donc les kilos que la quantite represente.
    // Les poser apres recalculerait le poids avec l'ancien facteur.
    let code_reference = match l.code_reference.as_deref().map(str::trim) {
        Some(c) if !c.is_empty() && Some(c) != code_reference.as_deref() => {
            if recue > 0.0 {
                return Err(AppError::RegleMetier(format!(
                    "Deja {recue:.2} kg receptionnes sur cette ligne : sa reference ne peut plus changer. Retirez la ligne et saisissez-en une autre."
                )));
            }
            sqlx::query(
                "UPDATE ligne_bc SET code_reference = $2,
                        designation = COALESCE((SELECT r.designation FROM reference r
                                                 WHERE r.code_reference = $2), designation)
                  WHERE id_ligne_bc = $1",
            )
            .bind(&ligne)
            .bind(c)
            .execute(&mut *tx)
            .await?;
            Some(c.to_string())
        }
        _ => code_reference,
    };
    let unite = match l.unite_commande.as_deref().map(str::trim) {
        Some(u) if !u.is_empty() => {
            sqlx::query("UPDATE ligne_bc SET unite_commande = $2 WHERE id_ligne_bc = $1")
                .bind(&ligne)
                .bind(u)
                .execute(&mut *tx)
                .await?;
            u.to_string()
        }
        _ => unite,
    };

    // LE COLISAGE SE GARDE, LIE OU DETACHE. Les trois expressions disent la
    // meme marchandise ; n'en retenir qu'une obligeait a rededuire les autres,
    // et la deduction se trompe des que le colisage reel s'ecarte du theorique.
    if let Some(r) = l.remise_pct {
        sqlx::query("UPDATE ligne_bc SET remise_pct = $2 WHERE id_ligne_bc = $1")
            .bind(&ligne)
            .bind(remise_valide(Some(r))?)
            .execute(&mut *tx)
            .await?;
    }
    if l.nb_palettes.is_some() || l.nb_bobines.is_some() {
        sqlx::query(
            "UPDATE ligne_bc SET nb_palettes_saisi = $2, nb_bobines_saisi = $3
              WHERE id_ligne_bc = $1",
        )
        .bind(&ligne)
        .bind(l.nb_palettes)
        .bind(l.nb_bobines)
        .execute(&mut *tx)
        .await?;
    }

    if let Some(q) = l.quantite_commandee_unite {
        if q <= 0.0 {
            return Err(AppError::Invalide("la quantite doit etre positive".into()));
        }
        // Une prestation garde son poids nul et son facteur de 1 : c'est ce que
        // le CHECK de la table exige, et il n'y a rien a convertir.
        let (kg, facteur) = if type_ligne != "MARCHANDISE" {
            (0.0, 1.0)
        } else {
            let code = code_reference.as_deref().ok_or_else(|| {
                AppError::Invalide("ligne de marchandise sans reference".into())
            })?;
            vers_kg(&state.db, code, q, &unite).await?
        };
        if kg < recue {
            return Err(AppError::RegleMetier(format!(
                "Deja {recue:.2} kg receptionnes sur cette ligne : la quantite ne peut pas \
                 descendre a {kg:.2} kg."
            )));
        }
        sqlx::query(
            "UPDATE ligne_bc SET quantite_commandee_unite = $2, quantite_commandee_kg = $3,
                                 facteur_kg = $4
              WHERE id_ligne_bc = $1",
        )
        .bind(&ligne)
        .bind(q)
        .bind(kg)
        .bind(facteur)
        .execute(&mut *tx)
        .await?;
    }

    if let Some(p) = l.prix_unitaire_devise {
        if p <= 0.0 {
            return Err(AppError::Invalide("le prix doit etre positif".into()));
        }
        sqlx::query("UPDATE ligne_bc SET prix_unitaire_devise = $2 WHERE id_ligne_bc = $1")
            .bind(&ligne)
            .bind(p)
            .execute(&mut *tx)
            .await?;
    }

    if let Some(d) = &l.date_livraison_prevue {
        sqlx::query("UPDATE ligne_bc SET date_livraison_prevue = fn_jour_casablanca($2) WHERE id_ligne_bc = $1")
            .bind(&ligne)
            .bind(d)
            .execute(&mut *tx)
            .await?;
    }

    sqlx::query("UPDATE ligne_bc SET arbitree = 1 WHERE id_ligne_bc = $1")
        .bind(&ligne)
        .execute(&mut *tx)
        .await?;
    if reponse_prix {
        sqlx::query("UPDATE ligne_bc SET date_reponse_prix = fn_instant($2) WHERE id_ligne_bc = $1")
            .bind(&ligne)
            .bind(maintenant())
            .execute(&mut *tx)
            .await?;
    }

    recalculer_bc(&mut tx, &id).await?;
    let version_entete = crate::domain::concurrence::version_actuelle(&mut tx, "bon_commande", "id_bc", &id).await?;
    tx.commit().await?;

    Ok(Json(json!({ "version": version_entete,  "id_ligne_bc": ligne, "arbitree": true })))
}

// ============================================================================
// Receptions
// ============================================================================

/// Le cours d'une devise un jour donne (AAAA-MM-JJ), ou None s'il n'y en a pas.
///
/// LA DEVISE PIVOT VAUT 1, TOUJOURS (10/10/2026) : son taux ne se saisit pas (la
/// base refuse toute autre valeur et l'ecran ne l'offre pas), et une base sans
/// la ligne du dirham, ou dont la ligne commence apres le jour cherche, refusait
/// un bon en MAD — « Aucun taux de change en vigueur pour MAD ».
pub(crate) async fn taux_au(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    devise: &str,
    jour: &str,
) -> AppResult<Option<f64>> {
    Ok(sqlx::query_scalar(
        "SELECT taux::float8 FROM (
             SELECT 1.0::numeric AS taux, '9999' AS date_debut FROM devise WHERE code_devise = $1 AND est_pivot = 1
             UNION ALL
             SELECT taux, date_debut::text AS date_debut FROM taux_change
              WHERE code_devise = $1 AND $2 >= substr(date_debut, 1, 10)
                AND (date_fin IS NULL OR $2 < substr(date_fin, 1, 10))) t
          ORDER BY date_debut DESC LIMIT 1",
    )
    .bind(devise)
    .bind(jour)
    .fetch_optional(&mut **tx)
    .await?)
}
