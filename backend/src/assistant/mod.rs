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

/// Interroge Ollama et rend la liste de ses modeles, ou `None` s'il se tait.
///
/// TROIS SECONDES SUFFISENT : on demande un inventaire, pas une reponse. Si le
/// moteur met plus longtemps a dire ce qu'il detient, l'ecran a raison de le
/// declarer injoignable.
async fn sonder_ollama(url: &str) -> Option<Vec<String>> {
    #[derive(serde::Deserialize)]
    struct Modele {
        name: String,
    }
    #[derive(serde::Deserialize)]
    struct Inventaire {
        models: Vec<Modele>,
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;
    let reponse = client
        .get(format!("{}/api/tags", url.trim_end_matches('/')))
        .send()
        .await
        .ok()?;
    if !reponse.status().is_success() {
        return None;
    }
    let inv: Inventaire = reponse.json().await.ok()?;
    Some(inv.models.into_iter().map(|m| m.name).collect())
}

/// L'etat de GestionAi, ou `None` si elle se tait.
///
/// SA ROUTE DE SANTE EST OUVERTE, sans cle : c'est une sonde, et une sonde qui
/// exige un secret ne sert plus a diagnostiquer quand le secret est justement
/// ce qui manque.
async fn sonder_plateforme(r: &Reglage) -> Option<Value> {
    let url = r.url_plateforme.as_ref()?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;
    let reponse = client.get(format!("{url}/api/sante")).send().await.ok()?;
    if !reponse.status().is_success() {
        return None;
    }
    reponse.json().await.ok()
}

/// Delegue la question a l'agent `erp` de GestionAi.
///
/// LE JETON DE L'UTILISATEUR PART AVEC LA QUESTION, et c'est le point entier :
/// l'agent rappellera cet ERP avec CE jeton, donc la grille de droits — par
/// module et par champ — s'applique exactement comme si la personne avait
/// clique elle-meme. Un compte de service ferait voir les prix d'achat a un
/// magasinier.
async fn deleguer(
    r: &Reglage,
    jeton: &str,
    messages: &[Echange],
) -> AppResult<Json<Value>> {
    let url = r
        .url_plateforme
        .as_ref()
        .ok_or_else(|| AppError::Interne(anyhow::anyhow!("adresse de la plateforme absente")))?;
    let cle = r
        .cle_plateforme
        .as_ref()
        .ok_or_else(|| AppError::Interne(anyhow::anyhow!("cle de la plateforme absente")))?;

    let (derniere, avant) = messages.split_last().ok_or_else(|| {
        AppError::Invalide("aucune question".into())
    })?;
    let historique: Vec<Value> = avant
        .iter()
        .map(|e| {
            json!({
                "role": if e.role == "assistant" { "assistant" } else { "user" },
                "content": e.texte,
            })
        })
        .collect();

    // UN DELAI LONG, ASSUME : la plateforme met la question en file, et un
    // modele local sans carte graphique demande des dizaines de secondes par
    // tour. Couper a trente secondes ferait echouer une question qui allait
    // aboutir.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| AppError::Interne(anyhow::anyhow!("client HTTP : {e}")))?;

    let reponse = client
        .post(format!("{url}/api/agents/erp"))
        .header("X-Cle-Application", cle)
        .json(&json!({
            "question": derniere.texte,
            "historique": historique,
            "jeton": jeton,
        }))
        .send()
        .await
        .map_err(|e| {
            AppError::Interne(anyhow::anyhow!("GestionAi ne repond pas ({url}) : {e}"))
        })?;

    let code = reponse.status();
    let corps: Value = reponse.json().await.unwrap_or_else(|_| json!({}));
    if !code.is_success() {
        // ON RELAIE LE MOTIF DE LA PLATEFORME. « file saturee » et « modele
        // absent » demandent deux gestes differents ; les fondre dans un
        // « erreur 502 » rendrait le diagnostic impossible depuis l'ecran.
        let motif = corps
            .get("detail")
            .and_then(|v| v.as_str())
            .unwrap_or("motif non precise");
        return Err(AppError::Interne(anyhow::anyhow!("GestionAi a refuse ({code}) : {motif}")));
    }

    Ok(Json(json!({
        "reponse": corps.get("reponse").and_then(|v| v.as_str()).unwrap_or(""),
        // La plateforme nomme ses outils ; l'ecran les affiche sous le meme
        // libelle que les competences locales.
        "competences": corps.get("outils").cloned().unwrap_or_else(|| json!([])),
        "brouillon": Value::Null,
        "moteur": format!(
            "plateforme/{}",
            corps.get("modele").and_then(|v| v.as_str()).unwrap_or("?")
        ),
    })))
}

/// Reglage courant : quel moteur, quel modele, et s'il repond.
///
/// L'ecran l'affiche pour que la lenteur du moteur local ne passe pas pour une
/// panne, et que la bascule vers Claude soit un choix eclaire.
pub async fn etat(State(state): State<AppState>, _user: Utilisateur) -> AppResult<Json<Value>> {
    let r = Reglage::depuis_base(&state.db).await;

    // CE CONTROLE NE CONTROLAIT RIEN. Il construisait la requete — `c.get(...)`
    // rend un constructeur — l'enveloppait dans `Some`, puis demandait si ce
    // `Some` etait un `Some`. Reponse : toujours oui. L'ecran affichait donc
    // « joignable » meme moteur eteint, et l'on cherchait la panne ailleurs.
    //
    // ET REPONDRE NE SUFFIT PAS : Ollama repond tres bien quand le modele
    // demande n'est pas installe. Il faut donc verifier les DEUX — le moteur
    // ecoute, et il detient ce qu'on va lui reclamer.
    let (joignable, modele_present, modeles) = match r.moteur {
        moteur::Moteur::Ollama => {
            let liste = sonder_ollama(&r.url_ollama).await;
            match liste {
                Some(m) => {
                    // Ollama accepte « nom » pour « nom:latest » : on compare
                    // sur la partie avant les deux-points quand l'etiquette est
                    // absente, sinon un reglage valide passerait pour fautif.
                    let present = m.iter().any(|x| {
                        x == &r.modele
                            || x.split(':').next() == r.modele.split(':').next()
                                && !r.modele.contains(':')
                    });
                    (true, present, m)
                }
                None => (false, false, Vec::new()),
            }
        }
        moteur::Moteur::Claude => (r.cle_claude.is_some(), r.cle_claude.is_some(), Vec::new()),
        // LA PLATEFORME SE SONDE, ELLE AUSSI. Sa route de sante dit si SON
        // moteur repond et s'il detient son modele : on relaie ce verdict
        // plutot que d'afficher un voyant vert qui ne repose sur rien.
        moteur::Moteur::Plateforme => match sonder_plateforme(&r).await {
            Some(etat) => (
                etat.get("joignable").and_then(|v| v.as_bool()).unwrap_or(false),
                etat.get("modele_present").and_then(|v| v.as_bool()).unwrap_or(false),
                etat.get("modeles_disponibles")
                    .and_then(|v| v.as_array())
                    .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                    .unwrap_or_default(),
            ),
            None => (false, false, Vec::new()),
        },
    };

    Ok(Json(json!({
        "moteur": r.moteur.nom(),
        "modele": r.modele,
        "local": r.moteur == moteur::Moteur::Ollama,
        "joignable": joignable,
        // LE MOTEUR PEUT REPONDRE SANS DETENIR LE MODELE. Le distinguer evite
        // la question sans issue : « le voyant est vert, pourquoi rien ne
        // vient ? »
        "modele_present": modele_present,
        "modeles_disponibles": modeles,
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
            moteur::Moteur::Plateforme =>
                "La question est traitee par GestionAi, le service d'agents de l'entreprise.                  Rien ne sort du reseau local, et vos droits s'appliquent : l'agent interroge                  l'ERP avec votre jeton.",
        },
    })))
}

/// Un tour de conversation.
pub async fn discuter(
    State(state): State<AppState>,
    user: Utilisateur,
    entetes: axum::http::HeaderMap,
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

    // EN MODE PLATEFORME, L'ERP NE MONTE NI CONSIGNE NI OUTILS. C'est l'agent
    // qui les porte, et l'ERP redevient ce qu'il devrait etre : une source de
    // chiffres, pas un orchestrateur de modeles.
    if reglage.moteur == moteur::Moteur::Plateforme {
        let jeton = entetes
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(|| {
                AppError::Interne(anyhow::anyhow!(
                    "mode plateforme : le jeton de l'utilisateur est introuvable dans                      la requete, l'agent ne pourrait pas appliquer vos droits."
                ))
            })?;
        return deleguer(&reglage, jeton, &q.messages).await;
    }

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
    } else if n.starts_with("qwen3") {
        "Modele a raisonnement. Son monologue interieur est desactive, sans quoi il          depasse le delai d'attente sur ce processeur."
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
