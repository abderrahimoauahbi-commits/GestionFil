//! Les COMPETENCES de l'assistant : ce qu'il sait faire, et rien d'autre.
//!
//! POURQUOI LE MODELE N'ECRIT JAMAIS DE SQL. C'est la tentation evidente — lui
//! donner le schema et le laisser composer sa requete. Elle est refusee pour
//! trois raisons qui ne se rattrapent pas apres coup :
//!
//!   * un modele qui redige du SQL contourne la grille de droits par champ, sur
//!     laquelle repose toute la securite de cet ERP ;
//!   * une requete inventee qui *semble* juste rend un chiffre faux sans le
//!     dire, et un chiffre faux dans un ERP se propage en decisions d'achat ;
//!   * une jointure malheureuse sur une table de mouvements bloque la base.
//!
//! Le modele CHOISIT donc une competence et ses arguments ; le serveur execute
//! une requete ecrite ici, verifiee, bornee, et masque le resultat selon les
//! droits de l'appelant. Le modele ne voit que ce que l'appelant aurait vu en
//! ouvrant l'ecran lui-meme.
//!
//! CHAQUE COMPETENCE PORTE SON MODULE. Une question sur les prix d'achat exige
//! `BONS_COMMANDE` en lecture ; un magasinier qui la pose recoit un refus
//! explicite, pas une reponse tronquee qui lui ferait croire a un stock nul.
//!
//! LES DEUX COMPETENCES « PREPARER » N'ECRIVENT RIEN. Elles rendent un brouillon
//! — un formulaire pre-rempli et l'ecran ou le relire. La validation reste un
//! geste humain : sans cela le journal d'audit dirait « Mohamed a valide » alors
//! que personne n'a lu, et un journal qui ment ne vaut rien.

use crate::auth::rbac::{module, Action};
use crate::auth::Utilisateur;
use crate::error::{AppError, AppResult};
use crate::routes::json::lignes_en_json;
use crate::state::AppState;
use serde_json::{json, Value};

/// Une competence : ce que le modele peut demander au serveur d'executer.
pub struct Competence {
    /// Nom expose au modele. En francais, comme le reste du domaine.
    pub nom: &'static str,
    /// Ce qu'elle repond. C'est sur cette phrase que le modele choisit.
    pub description: &'static str,
    /// Module requis en lecture. Le refus est explicite, jamais silencieux.
    pub module: &'static str,
    /// Schema JSON des arguments, au format attendu par les deux moteurs.
    pub parametres: fn() -> Value,
    /// Ecran a ouvrir pour agir, s'il y en a un.
    pub ecran: Option<&'static str>,
}

/// Le texte d'un argument, ou une erreur qui nomme l'argument manquant.
fn texte(args: &Value, nom: &str) -> AppResult<String> {
    args.get(nom)
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Invalide(format!("argument manquant : {nom}")))
}

/// Un entier borne. Le modele propose parfois 10 000 : on ne l'ecoute pas.
fn borne(args: &Value, nom: &str, defaut: i64, max: i64) -> i64 {
    args.get(nom)
        .and_then(Value::as_i64)
        .unwrap_or(defaut)
        .clamp(1, max)
}

fn sans_parametre() -> Value {
    json!({ "type": "object", "properties": {}, "required": [] })
}

/// Ce qu'une resolution de reference donne.
enum Resolution {
    /// Une seule reference correspond : on continue avec son code exact.
    Une(String),
    /// Plusieurs, ou aucune : on rend la liste au modele, qui demandera.
    Ambigue(Value),
}

/// Retrouve le code exact d'une reference nommee approximativement.
///
/// POURQUOI CHAQUE COMPETENCE RESOUT PLUTOT QUE D'EXIGER LE CODE EXACT. La
/// consigne dit au modele de passer par `chercher_reference` avant ; un modele
/// de trois milliards de parametres l'oublie une fois sur deux et appelle
/// directement avec « polypropylene rouge ». Refuser sec est correct — on ne
/// prepare pas un brouillon sur un code invente — mais inutile : la reponse
/// « cette reference n'existe pas » est fausse, elle existe, elle est juste
/// nommee autrement.
///
/// LA RESOLUTION NE DEVINE JAMAIS. Un seul resultat : on l'emploie. Plusieurs :
/// on les rend tous et le modele demande lequel. Aucun : on le dit. Choisir le
/// « meilleur » parmi plusieurs ferait sortir la mauvaise matiere du magasin.
async fn resoudre_reference(state: &AppState, saisie: &str) -> AppResult<Resolution> {
    let saisie = saisie.trim();

    // Le code exact d'abord : c'est le cas courant, et il ne coute qu'une
    // lecture d'index.
    let exact: Option<String> =
        sqlx::query_scalar("SELECT code_reference FROM reference WHERE code_reference = $1")
            .bind(saisie)
            .fetch_optional(&state.db)
            .await?;
    if let Some(code) = exact {
        return Ok(Resolution::Une(code));
    }

    // Sinon, chaque mot de la saisie doit se retrouver dans la reference : une
    // recherche sur la chaine entiere echouerait sur « polypropylene rouge »,
    // dont les deux mots ne sont pas cote a cote dans la designation.
    let mots: Vec<String> = saisie
        .split_whitespace()
        .filter(|m| m.chars().count() > 2)
        .map(|m| format!("%{m}%"))
        .collect();
    if mots.is_empty() {
        return Ok(Resolution::Ambigue(
            json!({ "trouve": false, "cherche": saisie, "candidats": [] }),
        ));
    }

    // LA MATIERE N'EST PAS DANS LA DESIGNATION. « Polypropylene » ne parait
    // nulle part dans « PP FRZ-2900 Dtex- Red 7612-Hs » : il est le LIBELLE DE
    // LA CATEGORIE, dont la designation ne porte que le sigle. Chercher la
    // couleur seule suffisait donc, la matiere seule ne trouvait rien, et
    // « polypropylene rouge » — la facon dont un magasinier nomme sa matiere —
    // ne trouvait rien du tout. On cherche dans les cinq colonnes ou un humain
    // peut avoir mis le mot.
    let conditions: Vec<String> = (1..=mots.len())
        .map(|i| {
            format!(
                "(r.code_reference ILIKE ${i} OR r.designation ILIKE ${i}                   OR COALESCE(r.couleur, '') ILIKE ${i}                   OR COALESCE(r.type_fil, '') ILIKE ${i}                   OR COALESCE(c.libelle, '') ILIKE ${i}                   OR r.code_categorie ILIKE ${i})"
            )
        })
        .collect();
    let sql = format!(
        "SELECT r.code_reference, r.designation, r.couleur, r.unite_catalogue,
                c.libelle AS categorie, f.nom AS fournisseur_nom
           FROM reference r
           LEFT JOIN categorie_matiere c ON c.code_categorie   = r.code_categorie
           LEFT JOIN fournisseur       f ON f.code_fournisseur = r.code_fournisseur
          WHERE r.actif = 1 AND {}
          ORDER BY r.code_reference
          LIMIT 12",
        conditions.join(" AND ")
    );
    let mut q = sqlx::query(&sql);
    for m in &mots {
        q = q.bind(m);
    }
    let rows = q.fetch_all(&state.db).await?;

    if rows.len() == 1 {
        let code: String = sqlx::Row::get(&rows[0], "code_reference");
        return Ok(Resolution::Une(code));
    }
    Ok(Resolution::Ambigue(json!({
        "trouve": false,
        "cherche": saisie,
        "candidats": lignes_en_json(&rows),
        "message": if rows.is_empty() {
            "Aucune reference ne correspond. Demander a l'utilisateur de preciser."
        } else {
            "Plusieurs references correspondent. Demander a l'utilisateur laquelle."
        },
    })))
}

pub const COMPETENCES: &[Competence] = &[
    Competence {
        nom: "chercher_reference",
        description:
            "Trouve des references du catalogue par un morceau de leur nom, de leur couleur \
             ou de leur code. A UTILISER EN PREMIER des que l'utilisateur nomme une matiere \
             sans donner son code exact : les codes sont longs et personne ne les tape.",
        module: module::CATALOGUE,
        parametres: || {
            json!({
                "type": "object",
                "properties": {
                    "texte": { "type": "string",
                        "description": "Morceau de nom, couleur ou code. Ex : « polypropylene rouge »." },
                    "limite": { "type": "integer", "description": "Nombre maximum, defaut 10." }
                },
                "required": ["texte"]
            })
        },
        ecran: Some("/catalogue"),
    },
    Competence {
        nom: "etat_stock",
        description:
            "Etat du stock d'UNE reference : quantite, valeur, jours de couverture, statut \
             et fournisseur. Demande le code exact — passer par chercher_reference avant.",
        module: module::STOCK,
        parametres: || {
            json!({
                "type": "object",
                "properties": {
                    "code_reference": { "type": "string",
                        "description": "Code exact, ou nom approximatif : le serveur
                            resout tout seul s il ne designe qu une seule reference." }
                },
                "required": ["code_reference"]
            })
        },
        ecran: Some("/stock"),
    },
    Competence {
        nom: "references_en_tension",
        description:
            "Les references en rupture, critiques ou sous surveillance, de la plus urgente a \
             la moins urgente. Repond a « qu'est-ce qui manque », « ou est-ce que ca coince ».",
        module: module::STOCK,
        parametres: || {
            json!({
                "type": "object",
                "properties": {
                    "limite": { "type": "integer", "description": "Nombre maximum, defaut 15." }
                },
                "required": []
            })
        },
        ecran: Some("/stock"),
    },
    Competence {
        nom: "equivalents",
        description:
            "Les references declarees interchangeables avec une reference donnee, avec leur \
             stock et leur fournisseur. Repond a « par quoi je peux remplacer ceci ».",
        module: module::CATALOGUE,
        parametres: || {
            json!({
                "type": "object",
                "properties": {
                    "code_reference": { "type": "string" }
                },
                "required": ["code_reference"]
            })
        },
        ecran: Some("/referentiels?ref=groupes-equiv"),
    },
    Competence {
        nom: "fournisseur",
        description:
            "Fiche d'un fournisseur : delai, devise, nombre de references, ponctualite, \
             conformite et note globale. Sans argument, rend le classement de tous.",
        module: module::FOURNISSEURS,
        parametres: || {
            json!({
                "type": "object",
                "properties": {
                    "nom": { "type": "string",
                        "description": "Nom ou code du fournisseur. Omettre pour avoir le classement." }
                },
                "required": []
            })
        },
        ecran: Some("/fournisseurs"),
    },
    Competence {
        nom: "commandes_en_cours",
        description:
            "Les bons de commande ouverts : statut, fournisseur, montant, date de livraison \
             prevue et retard eventuel. Repond a « qu'est-ce qu'on attend ».",
        module: module::BONS_COMMANDE,
        parametres: || {
            json!({
                "type": "object",
                "properties": {
                    "en_retard": { "type": "boolean",
                        "description": "Vrai pour ne garder que les livraisons en retard." }
                },
                "required": []
            })
        },
        ecran: Some("/bons-commande"),
    },
    Competence {
        nom: "plan_achat",
        description:
            "Ce qu'il faut acheter maintenant, d'apres le calcul des besoins : reference, \
             quantite suggeree, fournisseur et montant estime.",
        module: module::PLAN_ACHAT,
        parametres: || {
            json!({
                "type": "object",
                "properties": {
                    "limite": { "type": "integer", "description": "Nombre maximum, defaut 15." }
                },
                "required": []
            })
        },
        ecran: Some("/plan-achat"),
    },
    Competence {
        nom: "mouvements_recents",
        description:
            "Les derniers mouvements de stock, en documents : date, type, magasin, quantite \
             totale, responsable. Filtrable sur une reference.",
        module: module::MOUVEMENTS,
        parametres: || {
            json!({
                "type": "object",
                "properties": {
                    "code_reference": { "type": "string", "description": "Facultatif." },
                    "limite": { "type": "integer", "description": "Nombre maximum, defaut 15." }
                },
                "required": []
            })
        },
        ecran: Some("/mouvements"),
    },
    Competence {
        nom: "valeur_stock",
        description:
            "La valeur du stock en dirhams, au total et par magasin. Repond a « combien vaut \
             ce qu'on a en magasin ».",
        module: module::VALORISATION,
        parametres: sans_parametre,
        ecran: Some("/valorisation"),
    },
    Competence {
        nom: "controles",
        description:
            "Les controles de coherence des donnees en anomalie, du plus grave au moins \
             grave. Repond a « est-ce que les donnees sont saines ».",
        module: module::COCKPIT,
        parametres: sans_parametre,
        ecran: Some("/"),
    },
    Competence {
        nom: "composition_qualite",
        description:
            "La recette d'une qualite de tapis : les matieres qui la composent, leur role et \
             leur consommation au metre carre.",
        module: module::RECETTES,
        parametres: || {
            json!({
                "type": "object",
                "properties": {
                    "qualite": { "type": "string", "description": "Code ou nom de la qualite." }
                },
                "required": ["qualite"]
            })
        },
        ecran: Some("/qualites"),
    },
    Competence {
        nom: "dossiers_import",
        description:
            "Les dossiers d'importation et leur avancement : valeur facturee, poids attendu, \
             poids deja recu, frais engages et coefficient de frais. Repond a « ou en sont les \
             importations », « quels dossiers sont ouverts ».",
        module: module::IMPORT,
        parametres: || {
            json!({
                "type": "object",
                "properties": {
                    "statut": { "type": "string", "enum": ["BROUILLON", "EN_COURS", "CLOTURE"],
                        "description": "Facultatif. Sans lui, les dossiers non clotures." },
                    "limite": { "type": "integer", "description": "Nombre maximum, defaut 15." }
                },
                "required": []
            })
        },
        ecran: Some("/import"),
    },
    Competence {
        nom: "dossier_import",
        description:
            "Le detail d'UN dossier d'importation nomme par son numero (« 55/26 ») : ses \
             factures, ses frais, ce qui reste a recevoir, et LES DOCUMENTS QUI MANQUENT. \
             Repond a « qu'est-ce qui manque au dossier 55/26 », « ou en est ce dossier ».",
        module: module::IMPORT,
        parametres: || {
            json!({
                "type": "object",
                "properties": {
                    "numero": { "type": "string", "description": "Numero du dossier, ex « 55/26 »." }
                },
                "required": ["numero"]
            })
        },
        ecran: Some("/import"),
    },
    Competence {
        nom: "preparer_mouvement",
        description:
            "Prepare un BROUILLON de mouvement de stock, pre-rempli, que l'utilisateur relira \
             et validera lui-meme. N'enregistre RIEN. A utiliser quand on demande de sortir, \
             d'entrer ou de transferer de la matiere.",
        module: module::MOUVEMENTS,
        parametres: || {
            json!({
                "type": "object",
                "properties": {
                    "sens": { "type": "string", "enum": ["ENTREE", "SORTIE"] },
                    "code_reference": { "type": "string" },
                    "quantite": { "type": "number" },
                    "unite": { "type": "string", "enum": ["kg", "Palette", "Bobine", "ml"] },
                    "code_magasin": { "type": "string", "description": "Facultatif." },
                    "responsable": { "type": "string", "description": "Qui remet ou recoit." }
                },
                "required": ["sens", "code_reference", "quantite", "unite"]
            })
        },
        ecran: Some("/mouvements"),
    },
    Competence {
        nom: "preparer_commande",
        description:
            "Prepare un BROUILLON de bon de commande pour un fournisseur, a partir des \
             propositions du plan d'achat. N'enregistre RIEN : l'utilisateur relit et valide.",
        module: module::BONS_COMMANDE,
        parametres: || {
            json!({
                "type": "object",
                "properties": {
                    "fournisseur": { "type": "string", "description": "Nom ou code du fournisseur." }
                },
                "required": ["fournisseur"]
            })
        },
        ecran: Some("/bons-commande/nouveau"),
    },
];

/// Execute une competence pour le compte de l'appelant.
///
/// LE MASQUAGE EST APPLIQUE ICI, sur le resultat, avant qu'il ne parte vers le
/// modele. C'est le point ou la grille de droits protege reellement : plus loin,
/// la donnee serait deja sortie.
pub async fn executer(
    state: &AppState,
    user: &Utilisateur,
    nom: &str,
    args: &Value,
) -> AppResult<Value> {
    let c = COMPETENCES
        .iter()
        .find(|c| c.nom == nom)
        .ok_or_else(|| AppError::Invalide(format!("competence inconnue : {nom}")))?;

    user.exiger(&state.db, c.module, Action::Lire).await?;

    let mut sortie = match nom {
        "chercher_reference" => {
            let motif = format!("%{}%", texte(args, "texte")?);
            let rows = sqlx::query(
                "SELECT r.code_reference, r.designation, r.couleur, r.unite_catalogue,
                        c.libelle AS categorie, f.nom AS fournisseur_nom, r.actif
                   FROM reference r
                   LEFT JOIN categorie_matiere c ON c.code_categorie   = r.code_categorie
                   LEFT JOIN fournisseur       f ON f.code_fournisseur = r.code_fournisseur
                  WHERE r.code_reference ILIKE $1 OR r.designation ILIKE $1
                     OR COALESCE(r.couleur, '')  ILIKE $1
                     OR COALESCE(r.type_fil, '') ILIKE $1
                     OR COALESCE(c.libelle, '')  ILIKE $1
                  ORDER BY r.actif DESC, r.code_reference
                  LIMIT $2",
            )
            .bind(&motif)
            .bind(borne(args, "limite", 10, 50))
            .fetch_all(&state.db)
            .await?;
            json!({ "references": lignes_en_json(&rows) })
        }

        "etat_stock" => {
            let code = match resoudre_reference(state, &texte(args, "code_reference")?).await? {
                Resolution::Une(c) => c,
                Resolution::Ambigue(v) => return Ok(v),
            };
            let rows = sqlx::query(
                "SELECT code_reference, designation, statut,
                        ROUND(stock_physique_net_kg, 2)::float8 AS stock_kg,
                        ROUND(stock_projete_kg, 2)::float8       AS stock_projete_kg,
                        ROUND(jours_couverture)::float8          AS jours_couverture,
                        ROUND(conso_mensuelle_kg, 2)::float8     AS conso_mensuelle_kg,
                        delai_livraison_jours, fournisseur_nom
                   FROM v_stock_projete
                  WHERE code_reference = $1",
            )
            .bind(&code)
            .fetch_all(&state.db)
            .await?;
            if rows.is_empty() {
                json!({ "trouve": false, "code_reference": code })
            } else {
                json!({ "trouve": true, "stock": lignes_en_json(&rows) })
            }
        }

        "references_en_tension" => {
            let rows = sqlx::query(
                "SELECT code_reference, designation, statut,
                        ROUND(stock_physique_net_kg, 2)::float8 AS stock_kg,
                        ROUND(jours_couverture)::float8         AS jours_couverture,
                        delai_livraison_jours, fournisseur_nom
                   FROM v_stock_projete
                  WHERE statut <> 'OK'
                  ORDER BY CASE statut WHEN 'RUPTURE' THEN 0 WHEN 'CRITIQUE' THEN 1 ELSE 2 END,
                           jours_couverture NULLS FIRST
                  LIMIT $1",
            )
            .bind(borne(args, "limite", 15, 60))
            .fetch_all(&state.db)
            .await?;
            json!({ "en_tension": lignes_en_json(&rows) })
        }

        "equivalents" => {
            let code = match resoudre_reference(state, &texte(args, "code_reference")?).await? {
                Resolution::Une(c) => c,
                Resolution::Ambigue(v) => return Ok(v),
            };
            let rows = sqlx::query(
                "SELECT e.code_groupe_equiv, e.equivalent_reference,
                        e.equivalent_designation, e.equivalent_stock_kg::float8 AS stock_kg,
                        e.meme_fournisseur, e.interchangeable
                   FROM v_equivalence e
                  WHERE e.code_reference = $1
                  ORDER BY e.interchangeable DESC, e.equivalent_stock_kg DESC",
            )
            .bind(&code)
            .fetch_all(&state.db)
            .await?;
            json!({ "code_reference": code, "equivalents": lignes_en_json(&rows) })
        }

        "fournisseur" => match args.get("nom").and_then(Value::as_str).map(str::trim) {
            Some(n) if !n.is_empty() => {
                let motif = format!("%{n}%");
                let rows = sqlx::query(
                    "SELECT * FROM v_fournisseur_scorecard
                      WHERE nom ILIKE $1 OR code_fournisseur ILIKE $1
                      LIMIT 5",
                )
                .bind(&motif)
                .fetch_all(&state.db)
                .await?;
                json!({ "fournisseurs": lignes_en_json(&rows) })
            }
            _ => {
                let rows = sqlx::query(
                    "SELECT code_fournisseur, nom, pays, code_devise, delai_livraison_jours,
                            nb_references, note_globale, classement
                       FROM v_fournisseur_scorecard
                      ORDER BY nb_references DESC
                      LIMIT 20",
                )
                .fetch_all(&state.db)
                .await?;
                json!({ "fournisseurs": lignes_en_json(&rows) })
            }
        },

        "commandes_en_cours" => {
            let retard = args.get("en_retard").and_then(Value::as_bool).unwrap_or(false);
            let rows = sqlx::query(
                "SELECT bc.numero_bc, bc.date_bc, bc.statut, f.nom AS fournisseur_nom,
                        bc.montant_total_mad::float8 AS montant_total_mad,
                        bc.date_livraison_prevue,
                        CASE WHEN bc.date_livraison_prevue IS NOT NULL
                                  AND bc.date_livraison_prevue < to_char(current_date,'YYYY-MM-DD')
                             THEN CAST(current_date - (bc.date_livraison_prevue)::date AS bigint)
                        END AS retard_jours
                   FROM bon_commande bc
                   LEFT JOIN fournisseur f ON f.code_fournisseur = bc.code_fournisseur
                  WHERE bc.statut NOT IN ('SOLDE', 'ANNULE')
                    AND ($1 = false OR (bc.date_livraison_prevue IS NOT NULL
                         AND bc.date_livraison_prevue < to_char(current_date,'YYYY-MM-DD')))
                  ORDER BY bc.date_livraison_prevue NULLS LAST
                  LIMIT 25",
            )
            .bind(retard)
            .fetch_all(&state.db)
            .await?;
            json!({ "commandes": lignes_en_json(&rows) })
        }

        "plan_achat" => {
            let rows = sqlx::query(
                "SELECT p.code_reference, r.designation, p.urgence, p.statut,
                        p.quantite_suggeree_kg::float8 AS quantite_suggeree_kg,
                        p.prix_estime_mad::float8      AS prix_estime_mad,
                        p.montant_total_mad::float8    AS montant_total_mad,
                        p.date_besoin_prevue, f.nom AS fournisseur_nom
                   FROM plan_achat p
                   LEFT JOIN reference   r ON r.code_reference   = p.code_reference
                   LEFT JOIN fournisseur f ON f.code_fournisseur = p.code_fournisseur
                  WHERE p.statut NOT IN ('COMMANDE', 'ABANDONNE')
                  ORDER BY p.quantite_suggeree_kg DESC
                  LIMIT $1",
            )
            .bind(borne(args, "limite", 15, 60))
            .fetch_all(&state.db)
            .await?;
            json!({ "propositions": lignes_en_json(&rows) })
        }

        "mouvements_recents" => {
            let code = args.get("code_reference").and_then(Value::as_str).map(str::trim);
            let rows = sqlx::query(
                "SELECT m.numero_mouvement, m.date_mouvement, m.code_type_mvt,
                        tm.libelle AS type_libelle, tm.signe, mg.nom AS magasin_nom,
                        m.responsable, u.login AS saisi_par,
                        ROUND(COALESCE(SUM(l.quantite_kg), 0), 2)::float8 AS quantite_totale_kg,
                        CAST(COUNT(l.id_ligne_mouvement) AS bigint)       AS nb_lignes
                   FROM mouvement m
                   JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
                   JOIN magasin        mg ON mg.code_magasin  = m.code_magasin
                   JOIN utilisateur    u  ON u.id_utilisateur = m.id_utilisateur
                   LEFT JOIN ligne_mouvement l ON l.id_mouvement = m.id_mouvement
                  WHERE $1::text IS NULL OR EXISTS (
                            SELECT 1 FROM ligne_mouvement x
                             WHERE x.id_mouvement = m.id_mouvement AND x.code_reference = $1)
                  GROUP BY m.numero_mouvement, m.date_mouvement, m.code_type_mvt,
                           tm.libelle, tm.signe, mg.nom, m.responsable, u.login
                  ORDER BY m.date_mouvement DESC
                  LIMIT $2",
            )
            .bind(code.filter(|s| !s.is_empty()))
            .bind(borne(args, "limite", 15, 60))
            .fetch_all(&state.db)
            .await?;
            json!({ "mouvements": lignes_en_json(&rows) })
        }

        "valeur_stock" => {
            let rows = sqlx::query(
                "SELECT mg.nom AS magasin_nom,
                        CAST(COUNT(DISTINCT s.code_reference) AS bigint) AS nb_references,
                        ROUND(SUM(s.quantite_kg), 2)::float8             AS quantite_kg,
                        ROUND(SUM(s.valeur_mad), 2)::float8              AS valeur_mad
                   FROM stock_magasin s
                   JOIN magasin mg ON mg.code_magasin = s.code_magasin
                  WHERE s.quantite_kg > 0
                  GROUP BY mg.nom
                  ORDER BY SUM(s.valeur_mad) DESC NULLS LAST",
            )
            .fetch_all(&state.db)
            .await?;
            json!({ "par_magasin": lignes_en_json(&rows) })
        }

        "controles" => {
            let rows = sqlx::query(
                "SELECT code, controle, criticite, anomalies
                   FROM v_controles
                  WHERE anomalies > 0
                  ORDER BY CASE criticite WHEN 'BLOQUANT' THEN 0 WHEN 'CRITIQUE' THEN 1
                                          WHEN 'ATTENTION' THEN 2 ELSE 3 END,
                           anomalies DESC",
            )
            .fetch_all(&state.db)
            .await?;
            json!({ "anomalies": lignes_en_json(&rows) })
        }

        "composition_qualite" => {
            let motif = format!("%{}%", texte(args, "qualite")?);
            let rows = sqlx::query(
                // LA COMPOSITION EST EN DEUX ETAGES, et les melanger donnerait
                // un faux. `ligne_qualite` porte la DENSITE par role — combien
                // de kilos de poil au metre carre ; `recette` porte les
                // MATIERES qui remplissent ce role et leur part. On rend les
                // deux, joints par le role.
                "SELECT q.code_qualite, q.nom AS qualite_nom,
                        lq.code_role, lq.densite::float8 AS densite_kg_m2,
                        lq.unite_densite,
                        rc.code_reference, r.designation, rc.couleur,
                        rc.pourcentage_composition::float8 AS pourcentage
                   FROM qualite q
                   JOIN ligne_qualite lq ON lq.code_qualite = q.code_qualite
                   LEFT JOIN recette   rc ON rc.code_qualite = q.code_qualite
                                         AND rc.code_role    = lq.code_role
                                         AND rc.actif = 1
                   LEFT JOIN reference r  ON r.code_reference = rc.code_reference
                  WHERE (q.code_qualite ILIKE $1 OR q.nom ILIKE $1) AND lq.actif = 1
                  ORDER BY q.code_qualite, lq.ordre_affichage, rc.ligne_numero
                  LIMIT 80",
            )
            .bind(&motif)
            .fetch_all(&state.db)
            .await?;
            json!({ "composition": lignes_en_json(&rows) })
        }

        // ---- Les deux brouillons : ils N'ECRIVENT RIEN -----------------------
        "dossiers_import" => {
            let statut = args.get("statut").and_then(Value::as_str);
            let rows = sqlx::query(
                "SELECT d.numero, d.statut, d.date_arrivee, d.numero_bl, d.code_devise,
                        (SELECT string_agg(DISTINCT fo.nom, ', ')
                           FROM import_factures f
                           JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
                          WHERE f.id_dossier = d.id_dossier) AS fournisseurs,
                        ROUND(v.valeur_dhs, 2)::float8 AS valeur_dhs,
                        ROUND(v.poids_kg, 2)::float8   AS poids_attendu_kg,
                        ROUND(v.recu_kg, 2)::float8    AS poids_recu_kg,
                        ROUND(v.poids_kg - v.recu_kg, 2)::float8 AS reste_kg,
                        ROUND(fr.frais_dhs, 2)::float8 AS frais_dhs,
                        CASE WHEN v.valeur_dhs > 0
                             THEN ROUND(fr.frais_dhs * 100 / v.valeur_dhs, 2)::float8 END
                          AS coef_frais_pct
                   FROM import_dossiers d
                   LEFT JOIN LATERAL (
                        SELECT COALESCE(sum(round(l.montant_devise * f.taux_change, 2)), 0) AS valeur_dhs,
                               COALESCE(sum(l.poids_net_kg) FILTER (WHERE l.type_ligne = 'ERP'), 0) AS poids_kg,
                               COALESCE(sum(l.quantite_recue_kg), 0) AS recu_kg
                          FROM import_facture_lignes l
                          JOIN import_factures f ON f.id_facture = l.id_facture
                         WHERE f.id_dossier = d.id_dossier) v ON true
                   LEFT JOIN LATERAL (
                        SELECT COALESCE(sum(x.montant_dhs) FILTER (WHERE p.inclus_dans_cout = 1), 0) AS frais_dhs
                          FROM dossier_lignes_frais x
                          JOIN parametres_frais p ON p.id_frais = x.id_frais
                         WHERE x.id_dossier = d.id_dossier) fr ON true
                  WHERE ($1::text IS NULL AND d.statut <> 'CLOTURE') OR d.statut = $1
                  ORDER BY d.date_creation DESC
                  LIMIT $2",
            )
            .bind(statut)
            .bind(borne(args, "limite", 15, 60))
            .fetch_all(&state.db)
            .await?;
            json!({ "dossiers": lignes_en_json(&rows) })
        }

        "dossier_import" => {
            // Le numero est ce que l'utilisateur prononce ; l'identifiant technique
            // ne sort jamais de la base.
            let numero = texte(args, "numero")?;
            let id: Option<String> = sqlx::query_scalar(
                "SELECT id_dossier FROM import_dossiers
                  WHERE numero = $1 OR replace(numero, '/', '') = replace($1, '/', '')",
            )
            .bind(&numero)
            .fetch_optional(&state.db)
            .await?;
            let Some(id) = id else {
                let connus: Vec<String> = sqlx::query_scalar(
                    "SELECT numero FROM import_dossiers ORDER BY date_creation DESC LIMIT 10",
                )
                .fetch_all(&state.db)
                .await?;
                return Ok(json!({ "trouve": false, "cherche": numero, "dossiers_connus": connus }));
            };

            let entete = sqlx::query(
                "SELECT numero, statut, numero_bl, conteneurs, code_devise, taux_change,
                        date_arrivee, notes
                   FROM import_dossiers WHERE id_dossier = $1",
            )
            .bind(&id)
            .fetch_all(&state.db)
            .await?;
            let factures = sqlx::query(
                "SELECT f.numero_facture, fo.nom AS fournisseur, f.date_facture,
                        f.code_devise, f.taux_change,
                        (SELECT count(*) FROM import_facture_lignes l
                          WHERE l.id_facture = f.id_facture) AS nb_lignes,
                        (SELECT ROUND(COALESCE(sum(l.poids_net_kg)
                                 FILTER (WHERE l.type_ligne = 'ERP'), 0), 2)::float8
                           FROM import_facture_lignes l WHERE l.id_facture = f.id_facture)
                          AS poids_kg,
                        (SELECT ROUND(COALESCE(sum(l.reste_kg)
                                 FILTER (WHERE l.type_ligne = 'ERP' AND l.soldee = 0), 0), 2)::float8
                           FROM import_facture_lignes l WHERE l.id_facture = f.id_facture)
                          AS reste_kg
                   FROM import_factures f
                   LEFT JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
                  WHERE f.id_dossier = $1
                  ORDER BY f.date_facture, f.numero_facture",
            )
            .bind(&id)
            .fetch_all(&state.db)
            .await?;
            let frais = sqlx::query(
                "SELECT p.libelle, p.categorie, p.inclus_dans_cout,
                        ROUND(x.montant_dhs, 2)::float8 AS montant_dhs
                   FROM dossier_lignes_frais x
                   JOIN parametres_frais p ON p.id_frais = x.id_frais
                  WHERE x.id_dossier = $1
                  ORDER BY p.categorie, p.libelle",
            )
            .bind(&id)
            .fetch_all(&state.db)
            .await?;

            // Les documents manquants viennent de la MEME regle que l'ecran des
            // pieces : une seule definition de ce qu'un dossier doit contenir.
            let attendues = crate::routes::pieces::attendues(&state.db, &id).await?;
            let manquantes: Vec<Value> = attendues
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter(|p| p.get("manque").and_then(Value::as_i64).unwrap_or(0) > 0)
                        .cloned()
                        .collect()
                })
                .unwrap_or_default();

            json!({
                "trouve": true,
                "dossier": lignes_en_json(&entete).get(0).cloned().unwrap_or(Value::Null),
                "factures": lignes_en_json(&factures),
                "frais": lignes_en_json(&frais),
                "documents_attendus": attendues,
                "documents_manquants": manquantes,
            })
        }

        "preparer_mouvement" => {
            let code = match resoudre_reference(state, &texte(args, "code_reference")?).await? {
                Resolution::Une(c) => c,
                Resolution::Ambigue(v) => return Ok(v),
            };
            let sens = texte(args, "sens")?.to_uppercase();
            let unite = texte(args, "unite")?;
            let quantite = args.get("quantite").and_then(Value::as_f64).unwrap_or(0.0);

            // La reference doit exister : preparer un brouillon sur un code
            // invente ferait perdre la saisie au moment de valider.
            let existe = sqlx::query(
                "SELECT r.designation, r.unite_catalogue, r.suivi_lot,
                        (SELECT code_magasin FROM magasin WHERE actif = 1
                          ORDER BY est_quarantaine, code_magasin LIMIT 1) AS magasin_defaut
                   FROM reference r WHERE r.code_reference = $1",
            )
            .bind(&code)
            .fetch_optional(&state.db)
            .await?;

            let Some(ligne) = existe else {
                return Ok(json!({
                    "brouillon": false,
                    "message": format!("La reference « {code} » n'existe pas au catalogue."),
                }));
            };
            let infos = lignes_en_json(std::slice::from_ref(&ligne));
            let infos = infos.get(0).cloned().unwrap_or(Value::Null);

            let type_mvt = if sens == "ENTREE" { "ENTREE_REC" } else { "SORTIE_PROD" };
            let motif = if sens == "ENTREE" { "RECEPTION" } else { "PRODUCTION" };
            let magasin = args
                .get("code_magasin")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| {
                    infos.get("magasin_defaut").and_then(Value::as_str).unwrap_or("").to_string()
                });

            json!({
                "brouillon": true,
                "type": "mouvement",
                "ecran": "/mouvements",
                "resume": format!(
                    "{} de {} {} de « {} »{}",
                    if sens == "ENTREE" { "Entree" } else { "Sortie" },
                    quantite, unite, code,
                    if magasin.is_empty() { String::new() } else { format!(" au magasin {magasin}") }
                ),
                "formulaire": {
                    "code_type_mvt": type_mvt,
                    "code_motif": motif,
                    "code_magasin": magasin,
                    "responsable": args.get("responsable").cloned().unwrap_or(Value::Null),
                    "lignes": [{
                        "code_reference": code,
                        "quantite_saisie": quantite,
                        "unite_saisie": unite,
                    }],
                },
            })
        }

        "preparer_commande" => {
            let motif = format!("%{}%", texte(args, "fournisseur")?);
            let rows = sqlx::query(
                "SELECT f.code_fournisseur, f.nom, p.code_reference, r.designation,
                        p.quantite_suggeree_kg::float8 AS quantite_suggeree_kg,
                        p.prix_estime_mad::float8      AS prix_estime_mad
                   FROM fournisseur f
                   JOIN plan_achat  p ON p.code_fournisseur = f.code_fournisseur
                   LEFT JOIN reference r ON r.code_reference = p.code_reference
                  WHERE (f.nom ILIKE $1 OR f.code_fournisseur ILIKE $1)
                    AND p.statut NOT IN ('COMMANDE', 'ABANDONNE')
                  ORDER BY p.quantite_suggeree_kg DESC
                  LIMIT 40",
            )
            .bind(&motif)
            .fetch_all(&state.db)
            .await?;

            let lignes = lignes_en_json(&rows);
            let vide = lignes.as_array().map(|a| a.is_empty()).unwrap_or(true);
            if vide {
                json!({
                    "brouillon": false,
                    "message": "Aucune proposition d'achat en attente pour ce fournisseur.",
                })
            } else {
                json!({
                    "brouillon": true,
                    "type": "bon_commande",
                    "ecran": "/bons-commande/nouveau",
                    "resume": format!("{} ligne(s) proposees a commander",
                                      lignes.as_array().map(Vec::len).unwrap_or(0)),
                    "formulaire": { "lignes": lignes },
                })
            }
        }

        _ => return Err(AppError::Invalide(format!("competence inconnue : {nom}"))),
    };

    user.masquer(&state.db, c.module, &mut sortie).await?;
    Ok(sortie)
}

/// Les competences que CE compte peut employer, au format des deux moteurs.
///
/// Filtrer ici plutot qu'au moment de l'appel a deux effets : le modele ne
/// propose jamais ce que l'utilisateur n'a pas le droit de voir, et il n'invente
/// pas de reponse a la place — il dit qu'il ne sait pas.
pub async fn outils_autorises(state: &AppState, user: &Utilisateur) -> Vec<Value> {
    let mut outils = Vec::new();
    for c in COMPETENCES {
        if user.exiger(&state.db, c.module, Action::Lire).await.is_ok() {
            outils.push(json!({
                "name": c.nom,
                "description": c.description,
                "input_schema": (c.parametres)(),
            }));
        }
    }
    outils
}
