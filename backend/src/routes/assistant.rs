//! Assistant de direction.
//!
//! Un catalogue de questions metier, repondues en interrogeant les vues du
//! systeme. Trois partis pris, qui expliquent tout le reste :
//!
//! **Aucune sortie reseau.** Le serveur n'a jamais eu de client HTTP sortant et
//! n'en gagne pas un ici. Les stocks, les prix et les fournisseurs ne quittent
//! pas la machine. En contrepartie, l'assistant ne comprend que les questions
//! qu'il connait : il apparie la saisie a son catalogue, il ne l'interprete pas.
//!
//! **Lecture seule.** Aucune route d'ecriture. L'assistant repond et pointe vers
//! l'ecran concerne ; il ne valide rien. Un agent qui validerait a la place d'un
//! humain rendrait le journal d'audit mensonger — il dirait « direction a
//! valide » alors que personne n'a lu.
//!
//! **Direction uniquement.** Ce n'est pas une restriction de confort. Toute la
//! securite de cet ERP repose sur une grille de droits par champ ; un assistant
//! qui resume des vues contournerait cette grille. Le reserver au role qui voit
//! deja tout supprime le probleme au lieu de le deplacer.

use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use serde_json::{json, Value};

use super::json::lignes_en_json;

/// Une question du catalogue.
struct Question {
    id: &'static str,
    /// Formulation canonique, affichee comme suggestion.
    libelle: &'static str,
    theme: &'static str,
    /// Mots servant a apparier une saisie libre. Sans accent, en minuscules.
    mots: &'static str,
    /// Renvoie UNE ligne : ses colonnes alimentent le gabarit de reponse.
    resume: &'static str,
    /// Detail facultatif, affiche en tableau sous la reponse.
    detail: Option<&'static str>,
    /// Phrase de reponse. `{colonne}` est remplace par la valeur du resume.
    gabarit: &'static str,
    /// Ecran a ouvrir pour agir.
    lien: &'static str,
}

/// Le catalogue.
///
/// Chaque requete a ete executee contre la base avant d'etre inscrite ici : un
/// assistant qui tombe en panne sur une question est pire qu'un assistant qui
/// ne la connait pas.
const CATALOGUE: &[Question] = &[
    Question {
        id: "tension",
        libelle: "Quelles references sont en tension ?",
        theme: "Stock",
        mots: "tension rupture critique alerte manque risque penurie",
        resume: "SELECT
                   SUM(statut IN ('RUPTURE','CRITIQUE')) AS graves,
                   SUM(statut = 'ATTENTION')             AS attention,
                   COUNT(*)                              AS total
                 FROM v_stock_projete",
        detail: Some(
            "SELECT code_reference, designation, statut,
                    ROUND(jours_couverture) AS jours_couverture,
                    ROUND(stock_physique_net_kg) AS stock_kg,
                    fournisseur_nom
             FROM v_stock_projete
             WHERE statut <> 'OK'
             ORDER BY CASE statut WHEN 'RUPTURE' THEN 0 WHEN 'CRITIQUE' THEN 1 ELSE 2 END,
                      jours_couverture
             LIMIT 30",
        ),
        gabarit: "{graves} reference(s) en rupture ou critique, {attention} en attention, \
                  sur {total} suivies.",
        lien: "/stock",
    },
    Question {
        id: "couverture",
        libelle: "Quelle reference tiendra le moins longtemps ?",
        theme: "Stock",
        mots: "couverture jours tiendra combien temps duree autonomie",
        resume: "SELECT code_reference, designation,
                        ROUND(jours_couverture) AS jours,
                        ROUND(stock_physique_net_kg) AS stock_kg
                 FROM v_stock_projete
                 WHERE jours_couverture IS NOT NULL
                 ORDER BY jours_couverture
                 LIMIT 1",
        detail: Some(
            "SELECT code_reference, designation,
                    ROUND(jours_couverture) AS jours_couverture,
                    ROUND(stock_physique_net_kg) AS stock_kg,
                    ROUND(conso_mensuelle_kg) AS conso_mensuelle_kg,
                    delai_livraison_jours
             FROM v_stock_projete
             WHERE jours_couverture IS NOT NULL
             ORDER BY jours_couverture
             LIMIT 20",
        ),
        gabarit: "{code_reference} — {designation} — tient {jours} jours, \
                  avec {stock_kg} kg en magasin.",
        lien: "/stock",
    },
    Question {
        id: "controles",
        libelle: "Y a-t-il des anomalies de coherence ?",
        theme: "Controle",
        mots: "anomalie controle coherence incoherence probleme verification",
        resume: "SELECT
                   SUM(anomalies > 0) AS en_anomalie,
                   SUM(anomalies > 0 AND criticite IN ('BLOQUANT','CRITIQUE')) AS graves,
                   COUNT(*) AS total
                 FROM v_controles",
        detail: Some(
            "SELECT code, criticite, controle, anomalies
             FROM v_controles
             WHERE anomalies > 0
             ORDER BY CASE criticite WHEN 'BLOQUANT' THEN 0 WHEN 'CRITIQUE' THEN 1 ELSE 2 END,
                      anomalies DESC",
        ),
        gabarit: "{en_anomalie} controle(s) en anomalie sur {total}, dont {graves} \
                  bloquant(s) ou critique(s).",
        lien: "/",
    },
    Question {
        id: "valeur",
        libelle: "Combien vaut le stock, et ou est-il ?",
        theme: "Finance",
        mots: "valeur valorisation combien vaut argent capital magasin ou",
        resume: "SELECT ROUND(SUM(valeur_mad)) AS valeur,
                        ROUND(SUM(quantite_kg)) AS kg,
                        COUNT(DISTINCT code_reference) AS refs,
                        COUNT(DISTINCT code_magasin) AS magasins
                 FROM stock_magasin
                 WHERE quantite_kg > 0",
        detail: Some(
            "SELECT s.code_magasin, m.nom AS magasin,
                    COUNT(*) AS references_en_stock,
                    ROUND(SUM(s.quantite_kg)) AS quantite_kg,
                    ROUND(SUM(s.valeur_mad)) AS valeur_mad
             FROM stock_magasin s
             LEFT JOIN magasin m ON m.code_magasin = s.code_magasin
             WHERE s.quantite_kg > 0
             GROUP BY s.code_magasin, m.nom
             ORDER BY valeur_mad DESC",
        ),
        gabarit: "{valeur} MAD de stock, soit {kg} kg sur {refs} references, \
                  reparties dans {magasins} magasin(s).",
        lien: "/etat-stock",
    },
    Question {
        id: "concentration",
        libelle: "Sur combien de references l'argent est-il immobilise ?",
        theme: "Finance",
        mots: "concentration pareto abc immobilise reparti principales",
        resume: "WITH t AS (
                   SELECT valeur_totale_mad v FROM v_stock_projete
                   WHERE valeur_totale_mad > 0
                 ),
                 c AS (
                   SELECT v,
                          SUM(v) OVER (ORDER BY v DESC) cum,
                          (SELECT SUM(v) FROM t) tot,
                          ROW_NUMBER() OVER (ORDER BY v DESC) r
                   FROM t
                 )
                 SELECT (SELECT MIN(r) FROM c WHERE cum >= 0.8 * tot) AS refs_80,
                        (SELECT COUNT(*) FROM t)                      AS total,
                        ROUND((SELECT SUM(v) FROM t))                 AS valeur",
        detail: Some(
            "SELECT code_reference, designation, classe_abc,
                    ROUND(valeur_totale_mad) AS valeur_mad
             FROM v_stock_projete
             WHERE valeur_totale_mad > 0
             ORDER BY valeur_totale_mad DESC
             LIMIT 20",
        ),
        gabarit: "{refs_80} references sur {total} portent 80 % de la valeur \
                  ({valeur} MAD au total).",
        lien: "/valorisation",
    },
    Question {
        id: "sur_stock",
        libelle: "Ou dort-on sur trop de stock ?",
        theme: "Stock",
        mots: "sur-stock surstock trop excedent dort dormant immobilise inutile",
        resume: "SELECT SUM(sur_stock = 1) AS sur_stock,
                        (SELECT COUNT(*) FROM v_stock_dormant) AS dormantes,
                        COUNT(*) AS total
                 FROM v_stock_projete",
        detail: Some(
            "SELECT code_reference, designation,
                    ROUND(jours_couverture) AS jours_couverture,
                    ROUND(stock_physique_net_kg) AS stock_kg,
                    ROUND(stock_max_kg) AS stock_max_kg,
                    ROUND(valeur_totale_mad) AS valeur_mad
             FROM v_stock_projete
             WHERE sur_stock = 1
             ORDER BY valeur_totale_mad DESC
             LIMIT 30",
        ),
        gabarit: "{sur_stock} reference(s) en sur-stock, et {dormantes} sans mouvement \
                  depuis le seuil de dormance.",
        lien: "/stock",
    },
    Question {
        id: "orphelines",
        libelle: "Quelles references ne servent a aucune recette ?",
        theme: "Catalogue",
        mots: "orpheline recette sans composition inutilisee sert servent",
        resume: "SELECT (SELECT COUNT(*) FROM v_ctl_c17) AS orphelines,
                        (SELECT COUNT(*) FROM reference WHERE actif = 1) AS total",
        detail: Some("SELECT * FROM v_ctl_c17 LIMIT 50"),
        gabarit: "{orphelines} references actives sur {total} n'apparaissent dans aucune \
                  recette.",
        lien: "/catalogue",
    },
    Question {
        id: "fournisseurs",
        libelle: "Quels fournisseurs demandent de l'attention ?",
        theme: "Achats",
        mots: "fournisseur surveiller retard otif conformite note dependance",
        // Mesure la DEPENDANCE, pas le classement : sur cette base les douze
        // fournisseurs portent le meme classement et aucune note n'est etablie.
        // Un gabarit fonde sur le classement annoncerait « 0 strategiques », ce qui
        // se lit comme un constat alors que c'est une absence de donnee.
        resume: "SELECT COUNT(*) AS total,
                        COALESCE(SUM(note_globale IS NOT NULL), 0) AS notes,
                        ROUND(AVG(otif_pct)) AS otif_moyen,
                        ROUND(100.0 * MAX(montant_total_mad)
                              / NULLIF(SUM(montant_total_mad), 0)) AS part_premier
                 FROM v_fournisseur_scorecard",
        detail: Some(
            "SELECT nom, pays, classement, nb_bc,
                    ROUND(montant_total_mad) AS montant_mad,
                    ROUND(otif_pct) AS otif_pct,
                    ROUND(taux_conformite_pct) AS conformite_pct,
                    note_globale
             FROM v_fournisseur_scorecard
             ORDER BY montant_total_mad DESC",
        ),
        gabarit: "{total} fournisseurs, OTIF moyen {otif_moyen} %. Le premier concentre {part_premier} % du montant engage. Notes etablies : {notes} sur {total}.",
        lien: "/fournisseurs",
    },
    Question {
        id: "achats",
        libelle: "Qu'y a-t-il a commander ?",
        theme: "Achats",
        mots: "commander achat commande proposition budget engager approvisionner",
        // Le montant n'est pas stocke : plan_achat porte la quantite suggeree
        // et le prix estime, jamais leur produit.
        resume: "SELECT COUNT(*) AS propositions,
                        COALESCE(ROUND(SUM(quantite_suggeree_kg * COALESCE(prix_estime_mad, 0))), 0)
                          AS montant,
                        COALESCE(SUM(figee = 1), 0) AS figees
                 FROM plan_achat
                 WHERE statut NOT IN ('COMMANDE','IGNOREE')",
        detail: Some(
            "SELECT code_reference, code_fournisseur, statut, urgence,
                    ROUND(quantite_suggeree_kg) AS quantite_kg,
                    prix_estime_mad,
                    ROUND(quantite_suggeree_kg * COALESCE(prix_estime_mad, 0)) AS montant_mad,
                    date_besoin_prevue
             FROM plan_achat
             WHERE statut NOT IN ('COMMANDE','IGNOREE')
             ORDER BY montant_mad DESC
             LIMIT 30",
        ),
        gabarit: "{propositions} proposition(s) d'achat ouvertes pour {montant} MAD, \
                  dont {figees} figee(s) a la main.",
        lien: "/plan-achat",
    },
    Question {
        id: "activite",
        libelle: "Que s'est-il passe dans les magasins ?",
        theme: "Mouvements",
        mots: "mouvement activite entree sortie passe historique livre journal",
        resume: "SELECT (SELECT COUNT(*) FROM mouvement) AS mouvements,
                        (SELECT COUNT(*) FROM ligne_mouvement) AS lignes,
                        (SELECT COUNT(DISTINCT code_type_mvt) FROM mouvement) AS types,
                        (SELECT ROUND(SUM(lm.quantite_kg))
                           FROM ligne_mouvement lm
                           JOIN mouvement m USING (id_mouvement)
                           JOIN type_mouvement t USING (code_type_mvt)
                          WHERE t.signe = -1) AS sorties_kg",
        detail: Some(
            "SELECT m.code_type_mvt, t.libelle, COUNT(DISTINCT m.id_mouvement) AS mouvements,
                    COUNT(lm.id_ligne_mouvement) AS lignes,
                    ROUND(SUM(lm.quantite_kg)) AS quantite_kg
             FROM mouvement m
             JOIN type_mouvement t ON t.code_type_mvt = m.code_type_mvt
             LEFT JOIN ligne_mouvement lm ON lm.id_mouvement = m.id_mouvement
             GROUP BY m.code_type_mvt, t.libelle
             ORDER BY mouvements DESC",
        ),
        gabarit: "{mouvements} mouvements et {lignes} lignes au grand livre, sur {types} \
                  type(s). Sorties cumulees : {sorties_kg} kg.",
        lien: "/mouvements",
    },
    Question {
        id: "inventaires",
        libelle: "Ou en sont les inventaires ?",
        theme: "Inventaire",
        mots: "inventaire comptage ecart compte magasin gel",
        resume: "SELECT COUNT(*) AS total,
                        SUM(statut = 'EN_COURS') AS en_cours,
                        SUM(statut = 'CLOTURE')  AS clotures,
                        SUM(statut = 'BROUILLON') AS brouillons
                 FROM inventaire",
        detail: Some(
            "SELECT numero_inventaire, code_magasin, type_inventaire, statut,
                    date_inventaire, date_cloture
             FROM inventaire
             ORDER BY date_creation DESC
             LIMIT 20",
        ),
        gabarit: "{total} inventaire(s) : {brouillons} en preparation, {en_cours} en cours, \
                  {clotures} cloture(s).",
        lien: "/inventaires",
    },
];

/// Appariement d'une saisie libre au catalogue.
///
/// Comptage de mots communs, pas de distance floue : sur un catalogue d'une
/// dizaine d'entrees, un appariement approximatif produit surtout des faux
/// positifs, et repondre a cote est pire que d'avouer qu'on n'a pas compris.
fn apparier(saisie: &str) -> Option<&'static Question> {
    let s = normaliser(saisie);
    if s.trim().is_empty() {
        return None;
    }
    let saisis: Vec<&str> = s.split_whitespace().filter(|m| m.len() > 2).collect();

    let mut meilleur: Option<(&Question, usize)> = None;
    for q in CATALOGUE {
        let mut score = 0;
        for mot in q.mots.split_whitespace() {
            if saisis.iter().any(|m| m.starts_with(mot) || mot.starts_with(*m)) {
                score += 1;
            }
        }
        if score > 0 && meilleur.map_or(true, |(_, s)| score > s) {
            meilleur = Some((q, score));
        }
    }
    meilleur.map(|(q, _)| q)
}

/// Minuscules sans accents : « références » et « references » doivent apparier.
fn normaliser(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        })
        .collect()
}

/// Met un nombre en forme pour une phrase.
///
/// SQLite renvoie ses REAL avec une decimale — « 64675029.0 » — ce qui se lit
/// mal au milieu d'un texte. On coupe la decimale nulle et on espace les
/// milliers, comme on l'ecrirait a la main.
fn nombre(v: f64) -> String {
    if v.fract().abs() > 0.004 {
        return format!("{v:.2}");
    }
    let chiffres = (v.round().abs() as u64).to_string();
    let mut sortie = String::new();
    for (i, c) in chiffres.chars().enumerate() {
        if i > 0 && (chiffres.len() - i) % 3 == 0 {
            sortie.push('\u{202f}'); // espace fine insecable
        }
        sortie.push(c);
    }
    if v < 0.0 { format!("-{sortie}") } else { sortie }
}

/// Remplit `{colonne}` dans le gabarit avec les valeurs du resume.
fn rendre(gabarit: &str, resume: &Value) -> String {
    let mut sortie = gabarit.to_string();
    if let Some(obj) = resume.as_object() {
        for (cle, valeur) in obj {
            let texte = match valeur {
                Value::Null => "0".to_string(),
                Value::String(s) => s.clone(),
                Value::Number(n) => nombre(n.as_f64().unwrap_or(0.0)),
                v => v.to_string(),
            };
            sortie = sortie.replace(&format!("{{{cle}}}"), &texte);
        }
    }
    // Espaces multiples nes des retours a la ligne du gabarit.
    sortie.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Reserve a la Direction. Voir le commentaire de tete du module.
fn exiger_direction(user: &Utilisateur) -> AppResult<()> {
    if user.role != "DIRECTION" {
        return Err(AppError::NonAutorise {
            module: "ASSISTANT".into(),
            action: "LIRE".into(),
        });
    }
    Ok(())
}

/// Catalogue des questions connues.
pub async fn catalogue(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    exiger_direction(&user)?;
    user.exiger(&state.db, module::COCKPIT, Action::Lire).await?;

    let questions: Vec<Value> = CATALOGUE
        .iter()
        .map(|q| json!({ "id": q.id, "libelle": q.libelle, "theme": q.theme, "lien": q.lien }))
        .collect();
    Ok(Json(json!({ "questions": questions })))
}

/// Reponse a une question, par identifiant ou par saisie libre.
///
/// `id` accepte soit un identifiant du catalogue, soit une phrase : dans ce
/// second cas l'appariement est tente, et un echec est dit franchement plutot
/// que devine.
pub async fn repondre(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    exiger_direction(&user)?;
    user.exiger(&state.db, module::COCKPIT, Action::Lire).await?;

    let question = CATALOGUE
        .iter()
        .find(|q| q.id == id)
        .or_else(|| apparier(&id))
        .ok_or_else(|| {
            AppError::Introuvable(format!(
                "Aucune question connue ne correspond a « {id} ». \
                 L'assistant repond a un catalogue ferme : voir /api/assistant."
            ))
        })?;

    let ligne = sqlx::query(question.resume).fetch_one(&state.db).await?;
    let resume = lignes_en_json(std::slice::from_ref(&ligne));
    let resume = resume.get(0).cloned().unwrap_or(Value::Null);

    let detail = match question.detail {
        Some(sql) => lignes_en_json(&sqlx::query(sql).fetch_all(&state.db).await?),
        None => json!([]),
    };

    Ok(Json(json!({
        "id": question.id,
        "question": question.libelle,
        "theme": question.theme,
        "reponse": rendre(question.gabarit, &resume),
        "chiffres": resume,
        "detail": detail,
        "lien": question.lien,
    })))
}
