//! Le chatbot de l'ERP : une conversation, des competences, aucune ecriture.
//!
//! COMMENT UN TOUR SE DEROULE. L'utilisateur pose une question en francais. Le
//! modele lit la liste des competences que CE compte a le droit d'employer, en
//! choisit une avec ses arguments, et le serveur l'execute — requete ecrite a
//! l'avance, bornee, dont le resultat est masque selon la grille de droits. Le
//! modele recoit ce resultat et redige la reponse. Trois allers-retours au plus,
//! parce qu'un modele qui boucle sur ses outils ne s'arrete jamais tout seul.
//!
//! CE QU'IL NE FAIT PAS, ET POURQUOI :
//!
//!   * il n'ecrit pas de SQL — il contournerait la grille de droits, et une
//!     requete inventee rend un chiffre faux sans le dire ;
//!   * il n'enregistre rien — il PREPARE des brouillons que l'utilisateur relit
//!     et valide. Un journal d'audit qui dirait « Mohamed a valide » alors que
//!     personne n'a lu ne vaudrait rien ;
//!   * il n'invente pas de chiffres — la consigne le lui interdit, et surtout il
//!     n'en a aucun tant qu'une competence n'a pas repondu.

pub mod competences;
pub mod moteur;

use crate::auth::rbac::{module, Action};
use crate::auth::Utilisateur;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use moteur::{Decision, Reglage};

/// Nombre maximum d'allers-retours avec le modele pour UNE question.
///
/// Trois suffisent : chercher la reference, lire son stock, repondre. Au-dela,
/// un modele qui n'a pas trouve tourne en rond — mieux vaut le dire que faire
/// attendre une minute de plus a chaque tour.
const TOURS_MAX: usize = 3;

/// La consigne. Elle porte tout ce que le modele ne peut pas deviner.
fn consigne(user: &Utilisateur) -> String {
    format!(
        "Tu es l'assistant de l'ERP Gestion Fil, de Polyfashions Carpet, une usine de tapis \
         mecaniques a Tanger. Tu parles a {login}, dont le role est {role}.\n\
         \n\
         REGLES ABSOLUES :\n\
         - Ne donne JAMAIS un chiffre que tu n'as pas obtenu par une competence. Si tu ne l'as \
           pas, dis-le et propose la competence qui l'apporterait.\n\
         - L'unite de reference est le KILOGRAMME. Les palettes, bobines et metres lineaires \
           sont des unites de manutention, converties a la saisie.\n\
         - La monnaie est le dirham marocain (MAD).\n\
         - Si l'utilisateur nomme une matiere sans son code exact, emploie d'abord \
           `chercher_reference`. Les codes sont longs, personne ne les tape.\n\
         - Tu n'enregistres rien. Pour une saisie, emploie une competence `preparer_*` : elle \
           rend un brouillon que l'utilisateur relira et validera lui-meme.\n\
         - Si une competence te manque ou si le role de l'utilisateur ne la permet pas, dis-le \
           franchement. Ne devine pas.\n\
         \n\
         STYLE : francais, phrases courtes, reponse directe. Donne le chiffre d'abord, \
         l'explication ensuite. Pas de liste a puces pour un seul element.",
        login = user.login,
        role = user.role,
    )
}

#[derive(Debug, Deserialize)]
pub struct Question {
    /// La conversation, du plus ancien au plus recent. Le dernier message est
    /// la question posee.
    pub messages: Vec<Echange>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Echange {
    /// `utilisateur` ou `assistant`.
    pub role: String,
    pub texte: String,
}

/// Reglage courant : quel moteur, quel modele, et s'il repond.
///
/// L'ecran l'affiche pour que la lenteur du moteur local ne passe pas pour une
/// panne, et que la bascule vers Claude soit un choix eclaire.
pub async fn etat(State(state): State<AppState>, _user: Utilisateur) -> AppResult<Json<Value>> {
    let r = Reglage::depuis_base(&state.db).await;
    let joignable = match r.moteur {
        moteur::Moteur::Ollama => reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(3))
            .build()
            .ok()
            .and_then(|c| Some(c.get(format!("{}/api/tags", r.url_ollama.trim_end_matches('/')))))
            .is_some(),
        moteur::Moteur::Claude => r.cle_claude.is_some(),
    };
    Ok(Json(json!({
        "moteur": r.moteur.nom(),
        "modele": r.modele,
        "local": r.moteur == moteur::Moteur::Ollama,
        "joignable": joignable,
        // CE QUI A ETE DEMANDE, quand ce n'est pas ce qui repond. L'ecran le
        // dit franchement : sinon on regle « claude » dans les parametres et
        // l'on cherche pendant une heure pourquoi c'est toujours aussi lent.
        "repli_depuis": r.repli_depuis,
        "manque_cle": r.repli_depuis.is_some(),
        "note": match r.moteur {
            moteur::Moteur::Ollama =>
                "Le modele tourne sur le serveur : aucune donnee ne sort de l'entreprise. \
                 Sans carte graphique, comptez plusieurs dizaines de secondes par reponse.",
            moteur::Moteur::Claude =>
                "Les questions et les chiffres necessaires a la reponse sont envoyes a Anthropic.",
        },
    })))
}

/// Un tour de conversation.
pub async fn discuter(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(q): Json<Question>,
) -> AppResult<Json<Value>> {
    // LE COCKPIT EN LECTURE SUFFIT A DISCUTER. Chaque competence exige ensuite
    // son propre module : l'assistant n'ouvre aucune porte que l'utilisateur
    // n'aurait pas deja.
    user.exiger(&state.db, module::COCKPIT, Action::Lire).await?;

    if q.messages.is_empty() {
        return Err(AppError::Invalide("aucune question".into()));
    }

    let reglage = Reglage::depuis_base(&state.db).await;
    let outils = competences::outils_autorises(&state, &user).await;
    let consigne = consigne(&user);

    let mut messages: Vec<Value> = q
        .messages
        .iter()
        .map(|e| {
            json!({
                "role": if e.role == "assistant" { "assistant" } else { "user" },
                "content": e.texte,
            })
        })
        .collect();

    // Ce que le tour a employe, pour que l'ecran puisse le montrer : un
    // assistant qui repond sans dire d'ou vient le chiffre ne se verifie pas.
    let mut employees: Vec<Value> = Vec::new();
    let mut brouillon: Option<Value> = None;

    for _ in 0..TOURS_MAX {
        match moteur::interroger(&reglage, &consigne, &messages, &outils).await? {
            Decision::Parole(texte) => {
                return Ok(Json(json!({
                    "reponse": texte.trim(),
                    "competences": employees,
                    "brouillon": brouillon,
                    "moteur": reglage.moteur.nom(),
                })));
            }
            Decision::Competence { nom, arguments, identifiant } => {
                // Une competence qui echoue n'interrompt pas la conversation :
                // son message d'erreur est rendu au modele, qui peut corriger
                // son argument ou l'expliquer a l'utilisateur. Une erreur 500
                // ferait perdre la question.
                let resultat = match competences::executer(&state, &user, &nom, &arguments).await {
                    Ok(v) => v,
                    Err(e) => json!({ "erreur": e.to_string() }),
                };

                if resultat.get("brouillon").and_then(Value::as_bool) == Some(true) {
                    brouillon = Some(resultat.clone());
                }
                employees.push(json!({ "nom": nom, "arguments": arguments }));

                messages.push(json!({
                    "role": "assistant",
                    "content": [{
                        "type": "tool_use",
                        "id": if identifiant.is_empty() { nom.clone() } else { identifiant.clone() },
                        "name": nom,
                        "input": arguments,
                    }],
                }));
                messages.push(json!({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": if identifiant.is_empty() { nom.clone() } else { identifiant },
                        "content": resultat.to_string(),
                    }],
                }));
            }
        }
    }

    // Trois tours sans conclusion : on rend ce qu'on a plutot que de boucler.
    Ok(Json(json!({
        "reponse": "Je n'ai pas su conclure. Reformulez la question, ou ouvrez l'ecran concerne.",
        "competences": employees,
        "brouillon": brouillon,
        "moteur": reglage.moteur.nom(),
    })))
}

/// Les modeles disponibles, et celui qui repond.
///
/// POURQUOI DEMANDER LA LISTE A OLLAMA plutot que de l'ecrire ici. Les modeles
/// s'installent et se retirent par `ollama pull` / `ollama rm` sur le serveur ;
/// une liste ecrite dans le code serait fausse le lendemain, et proposer un
/// modele absent donne une erreur que rien n'explique.
///
/// Les modeles de Claude, eux, ne s'installent pas : ils sont connus, et leur
/// disponibilite ne depend que de la cle d'API.
pub async fn modeles(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::COCKPIT, Action::Lire).await?;

    let r = Reglage::depuis_base(&state.db).await;
    let mut locaux: Vec<Value> = Vec::new();

    // Un serveur Ollama arrete n'est pas une erreur : la liste est simplement
    // vide, et l'ecran le dit. Trois secondes d'attente au plus — cette route
    // est appelee a l'ouverture de l'ecran.
    if let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    {
        let url = format!("{}/api/tags", r.url_ollama.trim_end_matches('/'));
        if let Ok(rep) = client.get(&url).send().await {
            if let Ok(corps) = rep.json::<Value>().await {
                if let Some(liste) = corps.get("models").and_then(Value::as_array) {
                    for m in liste {
                        let nom = m.get("model").and_then(Value::as_str).unwrap_or("");
                        if nom.is_empty() {
                            continue;
                        }
                        let octets = m.get("size").and_then(Value::as_u64).unwrap_or(0);
                        locaux.push(json!({
                            "nom": nom,
                            "moteur": "ollama",
                            "taille_go": (octets as f64 / 1e9 * 10.0).round() / 10.0,
                            "note": note_modele(nom),
                        }));
                    }
                }
            }
        }
    }
    locaux.sort_by_key(|m| m["nom"].as_str().unwrap_or("").to_string());

    Ok(Json(json!({
        "moteur_actuel": r.moteur.nom(),
        "modele_actuel": r.modele,
        "cle_claude_presente": r.cle_claude.is_some(),
        "locaux": locaux,
        "distants": [
            { "nom": "claude-sonnet-4-5", "moteur": "claude",
              "note": "Le plus juste et le plus rapide. Deux a cinq secondes." },
            { "nom": "claude-haiku-4-5", "moteur": "claude",
              "note": "Plus economique, un peu moins fin sur les questions tournees." },
        ],
    })))
}

/// Ce qu'on sait d'un modele, pour que le choix ne soit pas a l'aveugle.
///
/// LA TAILLE EST LE FACTEUR DOMINANT sur un processeur sans carte graphique :
/// la vitesse est bornee par la bande passante memoire, donc elle tombe a peu
/// pres comme le nombre de parametres. Mesure sur ce serveur : 4,6 jetons par
/// seconde a sept milliards. Un modele plus gros ne sera pas plus rapide.
fn note_modele(nom: &str) -> &'static str {
    let n = nom.to_lowercase();
    if n.starts_with("qwen2.5:3b") {
        "Le plus rapide. Choisit bien la competence, formulation parfois maladroite."
    } else if n.starts_with("qwen3:4b") {
        "Generation plus recente que qwen2.5 : mieux ecrit pour un quart de temps de plus."
    } else if n.starts_with("mistral-nemo") {
        "Le meilleur francais des modeles locaux — maison francaise. Environ trois fois          plus lent que le 3b."
    } else if n.starts_with("mistral") {
        "Bon francais, appels d'outils fiables. Deux fois plus lent que le 3b."
    } else if n.starts_with("granite") {
        "Concu pour les appels d'outils. Francais correct sans plus."
    } else if n.contains(":7b") || n.contains(":8b") {
        "Mieux ecrit, environ trois fois plus lent que le 3b."
    } else if n.contains(":12b") || n.contains(":13b") || n.contains(":14b") {
        "Nettement mieux ecrit, mais cinq a six fois plus lent que le 3b."
    } else {
        "Modele installe sur le serveur."
    }
}

#[derive(Debug, Deserialize)]
pub struct ChoixModele {
    pub moteur: String,
    pub modele: String,
}

/// Bascule de moteur ou de modele.
///
/// ECRIRE DANS `parametre` PLUTOT QUE DANS `.env` : le reglage est relu a chaque
/// question, donc la bascule prend effet immediatement, sans redemarrer le
/// service. Reservee a qui peut ecrire les parametres — c'est un reglage de
/// direction, pas une preference d'ecran.
pub async fn choisir_modele(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(c): Json<ChoixModele>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Ecrire).await?;

    let moteur = match c.moteur.to_lowercase().as_str() {
        "claude" | "anthropic" => "claude",
        "ollama" => "ollama",
        autre => return Err(AppError::Invalide(format!("moteur inconnu : {autre}"))),
    };
    // Un nom de modele qui n'appartient pas au moteur choisi ne repondrait
    // jamais : on refuse tout de suite plutot que de laisser l'assistant
    // echouer a la premiere question.
    let pour_claude = c.modele.starts_with("claude");
    if pour_claude != (moteur == "claude") {
        return Err(AppError::Invalide(format!(
            "le modele « {} » n'appartient pas au moteur « {moteur} »",
            c.modele
        )));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    for (code, valeur) in [("P_AssistantMoteur", moteur), ("P_AssistantModele", &c.modele)] {
        sqlx::query(
            "UPDATE parametre SET valeur_courante = $2,
                    date_derniere_modif = to_char(now() AT TIME ZONE 'UTC',
                                                  'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),
                    id_utilisateur_modif = $3
              WHERE code_parametre = $1",
        )
        .bind(code)
        .bind(valeur)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    let r = Reglage::depuis_base(&state.db).await;
    Ok(Json(json!({
        "moteur": r.moteur.nom(),
        "modele": r.modele,
        "manque_cle": r.repli_depuis.is_some(),
    })))
}

/// La liste des competences, pour l'ecran d'aide.
pub async fn liste_competences(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::COCKPIT, Action::Lire).await?;

    let mut sortie = Vec::new();
    for c in competences::COMPETENCES {
        let autorisee = user.exiger(&state.db, c.module, Action::Lire).await.is_ok();
        sortie.push(json!({
            "nom": c.nom,
            "description": c.description,
            "module": c.module,
            "ecran": c.ecran,
            "autorisee": autorisee,
        }));
    }
    Ok(Json(json!({ "competences": sortie })))
}
