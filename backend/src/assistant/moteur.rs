//! Le moteur de langage, et sa bascule.
//!
//! TROIS MOTEURS, UN SEUL CONTRAT. Le serveur parle a l'un ou a l'autre selon un
//! reglage, et le reste du code ignore lequel repond :
//!
//!   OLLAMA  un modele qui tourne SUR LE SERVEUR. Rien ne sort de la machine —
//!           ni les questions, ni les chiffres qui servent a y repondre. En
//!           contrepartie, sans carte graphique, une reponse demande des
//!           dizaines de secondes.
//!   CLAUDE  l'API d'Anthropic. Rapide et nettement meilleure en francais, mais
//!           la question ET les donnees necessaires a la reponse quittent
//!           l'entreprise. C'est un choix de direction, pas un detail technique :
//!           il se regle, il ne se subit pas.
//!
//! LE MODELE NE TOUCHE JAMAIS A LA BASE. Il choisit une competence et ses
//! arguments ; le serveur execute. Voir `competences.rs` pour le pourquoi.
//!
//! LA CLE D'API NE SORT PAS DE `.env`. Elle n'est ni en base — ou une sauvegarde
//! l'emporterait — ni dans le depot, ni renvoyee par une route de configuration.

use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::time::Duration;

/// Quel moteur repond.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Moteur {
    Ollama,
    Claude,
    Plateforme,
}

impl Moteur {
    pub fn nom(&self) -> &'static str {
        match self {
            Moteur::Ollama => "ollama",
            Moteur::Claude => "claude",
            Moteur::Plateforme => "plateforme",
        }
    }
}

/// La configuration du moteur, lue a chaque appel.
///
/// RELUE A CHAQUE FOIS, et non mise en cache au demarrage : basculer d'un moteur
/// a l'autre ne doit pas demander un redemarrage du service, sinon la bascule
/// n'est plus un reglage mais une intervention.
pub struct Reglage {
    pub moteur: Moteur,
    pub modele: String,
    pub url_ollama: String,
    pub cle_claude: Option<String>,
    /// L'adresse de GestionAi. En base : ce n'est pas un secret, et la
    /// direction doit pouvoir la changer depuis l'ecran de configuration.
    pub url_plateforme: Option<String>,
    /// La cle d'application. DANS L'ENVIRONNEMENT, jamais en base — une
    /// sauvegarde s'exporte, se copie, se transporte, et un secret qui s'y
    /// trouve part avec elle. Meme regle que la cle Claude.
    pub cle_plateforme: Option<String>,
    /// Ce qui a ete DEMANDE, quand ce n'est pas ce qui repond.
    ///
    /// Un parametre qui dit « claude » alors que le moteur local repond — faute
    /// de cle d'API — est un piege : on cherche pendant une heure pourquoi les
    /// reponses restent lentes. Le repli est donc SIGNALE, pas seulement
    /// applique.
    pub repli_depuis: Option<&'static str>,
}

impl Reglage {
    /// Le reglage, LU EN BASE et complete par l'environnement.
    ///
    /// La base porte QUEL moteur repond — un parametre que la direction change
    /// depuis l'ecran de configuration, sans session SSH. L'environnement porte
    /// la CLE D'API, qui n'a rien a faire en base : une sauvegarde s'exporte,
    /// se copie, se transporte, et un secret qui s'y trouve part avec elle.
    ///
    /// Une base injoignable ou un parametre absent ne bloquent pas : on retombe
    /// sur l'environnement, puis sur le moteur local.
    pub async fn depuis_base(db: &crate::db::Db) -> Self {
        let lire = |code: &'static str| async move {
            sqlx::query_scalar::<_, String>(
                "SELECT valeur_courante FROM parametre
                  WHERE code_parametre = $1 AND actif = 1",
            )
            .bind(code)
            .fetch_optional(db)
            .await
            .ok()
            .flatten()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
        };

        let mut r = Self::depuis_env();
        if let Some(m) = lire("P_AssistantMoteur").await {
            let cle_presente = r.cle_claude.is_some();
            let voulu = m.to_lowercase();
            // LA PLATEFORME EXIGE SES DEUX MOITIES : une adresse et une cle.
            // Avec une seule, on retomberait sur des 401 incomprehensibles ;
            // on replie sur le moteur local et on le SIGNALE.
            let plateforme_prete =
                r.url_plateforme.is_some() && r.cle_plateforme.is_some();
            r.moteur = match voulu.as_str() {
                "claude" | "anthropic" if cle_presente => Moteur::Claude,
                "plateforme" | "gestionai" if plateforme_prete => Moteur::Plateforme,
                _ => Moteur::Ollama,
            };
            r.repli_depuis = match voulu.as_str() {
                "claude" | "anthropic" if !cle_presente => Some("claude"),
                "plateforme" | "gestionai" if !plateforme_prete => Some("plateforme"),
                _ => None,
            };
            // Le modele par defaut suit le moteur : basculer sur Claude avec un
            // nom de modele Ollama donnerait une erreur incomprehensible.
            r.modele = match r.moteur {
                Moteur::Claude => "claude-sonnet-4-5".into(),
                Moteur::Ollama => "qwen2.5:3b-instruct".into(),
                // En mode plateforme, c'est ELLE qui choisit le modele : l'ERP
                // ne le connait pas, et n'a pas a le connaitre.
                Moteur::Plateforme => "(choisi par la plateforme)".into(),
            };
        }
        if let Some(u) = lire("P_AssistantPlateforme").await {
            r.url_plateforme = Some(u.trim_end_matches('/').to_string());
        }
        if let Some(m) = lire("P_AssistantModele").await {
            // Un modele explicitement choisi prime, mais seulement s'il
            // appartient au moteur retenu : « qwen2.5 » demande a Claude ne
            // repondrait jamais.
            let pour_claude = m.starts_with("claude");
            if pour_claude == (r.moteur == Moteur::Claude) {
                r.modele = m;
            }
        }
        r
    }

    pub fn depuis_env() -> Self {
        let demande = std::env::var("ASSISTANT_MOTEUR").unwrap_or_else(|_| "ollama".into());
        let cle = std::env::var("ANTHROPIC_API_KEY").ok().filter(|c| !c.trim().is_empty());

        // ON NE BASCULE PAS SUR CLAUDE SANS CLE. Le faire donnerait une erreur
        // d'authentification illisible ; on retombe sur le moteur local, qui
        // marche toujours, et le message le dit.
        let moteur = match demande.to_lowercase().as_str() {
            "claude" | "anthropic" if cle.is_some() => Moteur::Claude,
            _ => Moteur::Ollama,
        };

        let modele = std::env::var("ASSISTANT_MODELE").unwrap_or_else(|_| match moteur {
            Moteur::Ollama => "qwen2.5:3b-instruct".into(),
            Moteur::Claude => "claude-sonnet-4-5".into(),
            Moteur::Plateforme => "(choisi par la plateforme)".into(),
        });

        let repli_depuis = match demande.to_lowercase().as_str() {
            "claude" | "anthropic" if moteur == Moteur::Ollama => Some("claude"),
            _ => None,
        };

        Self {
            moteur,
            modele,
            url_ollama: std::env::var("OLLAMA_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:11434".into()),
            cle_claude: cle,
            url_plateforme: std::env::var("GESTIONAI_URL").ok().filter(|v| !v.trim().is_empty()),
            cle_plateforme: std::env::var("GESTIONAI_CLE").ok().filter(|v| !v.trim().is_empty()),
            repli_depuis,
        }
    }
}

/// Ce que le modele a decide : parler, ou employer une competence.
#[derive(Debug)]
pub enum Decision {
    /// Une reponse en clair, destinee a l'utilisateur.
    Parole(String),
    /// Une competence a executer, avec ses arguments.
    Competence { nom: String, arguments: Value, identifiant: String },
}

/// Le client HTTP, partage.
///
/// UN DELAI D'ATTENTE GENEREUX : un modele de sept milliards de parametres sur
/// quatre coeurs sans carte graphique met facilement une minute. Couper a trente
/// secondes rendrait le moteur local inutilisable, ce qui reviendrait a forcer
/// la sortie des donnees vers l'exterieur — exactement ce que le reglage doit
/// permettre d'eviter.
fn client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| AppError::Interne(anyhow::anyhow!("client HTTP : {e}")))
}

/// Interroge le moteur configure.
///
/// `messages` suit le format d'Anthropic — role et contenu — parce qu'il porte
/// nativement les appels d'outils. La conversion vers Ollama se fait ici.
pub async fn interroger(
    reglage: &Reglage,
    consigne: &str,
    messages: &[Value],
    outils: &[Value],
) -> AppResult<Decision> {
    match reglage.moteur {
        Moteur::Claude => claude(reglage, consigne, messages, outils).await,
        Moteur::Ollama => ollama(reglage, consigne, messages, outils).await,
        // CE CHEMIN NE DOIT JAMAIS ETRE ATTEINT. En mode plateforme, `discuter`
        // delegue AVANT d'arriver ici : l'ERP n'assemble plus ni consigne ni
        // liste d'outils, c'est l'agent qui s'en charge. Y arriver signifie
        // qu'une branche a ete oubliee en amont — on le dit plutot que de
        // repondre n'importe quoi.
        Moteur::Plateforme => Err(AppError::Interne(anyhow::anyhow!(
            "mode plateforme : la question aurait du etre deleguee a GestionAi \
             avant d'atteindre le moteur local."
        ))),
    }
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------
async fn claude(
    r: &Reglage,
    consigne: &str,
    messages: &[Value],
    outils: &[Value],
) -> AppResult<Decision> {
    let cle = r
        .cle_claude
        .as_ref()
        .ok_or_else(|| AppError::Invalide("ANTHROPIC_API_KEY absente".into()))?;

    let reponse = client()?
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", cle)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({
            "model": r.modele,
            "max_tokens": 1024,
            "system": consigne,
            "messages": messages,
            "tools": outils,
        }))
        .send()
        .await
        .map_err(|e| AppError::Interne(anyhow::anyhow!("appel a Claude impossible : {e}")))?;

    let statut = reponse.status();
    let corps: Value = reponse
        .json()
        .await
        .map_err(|e| AppError::Interne(anyhow::anyhow!("reponse de Claude illisible : {e}")))?;

    if !statut.is_success() {
        let message = corps
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("erreur inconnue");
        return Err(AppError::Interne(anyhow::anyhow!(
            "Claude a refuse la requete ({statut}) : {message}"
        )));
    }

    // Un tour peut porter du texte ET un appel d'outil. L'outil prime : il
    // apporte les chiffres, le texte qui l'accompagne n'est qu'une annonce.
    let vide = Vec::new();
    let blocs = corps.get("content").and_then(Value::as_array).unwrap_or(&vide);
    for b in blocs {
        if b.get("type").and_then(Value::as_str) == Some("tool_use") {
            return Ok(Decision::Competence {
                nom: b.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
                arguments: b.get("input").cloned().unwrap_or(json!({})),
                identifiant: b.get("id").and_then(Value::as_str).unwrap_or("").to_string(),
            });
        }
    }
    let texte = blocs
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(Decision::Parole(texte))
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------
async fn ollama(
    r: &Reglage,
    consigne: &str,
    messages: &[Value],
    outils: &[Value],
) -> AppResult<Decision> {
    // Ollama attend le format d'OpenAI : un objet `function` par outil, et les
    // resultats d'outils en messages de role `tool`.
    let outils_ollama: Vec<Value> = outils
        .iter()
        .map(|o| {
            json!({
                "type": "function",
                "function": {
                    "name": o.get("name").cloned().unwrap_or(Value::Null),
                    "description": o.get("description").cloned().unwrap_or(Value::Null),
                    "parameters": o.get("input_schema").cloned().unwrap_or(json!({})),
                }
            })
        })
        .collect();

    let mut suite = vec![json!({ "role": "system", "content": consigne })];
    for m in messages {
        suite.extend(convertir_pour_ollama(m));
    }

    let reponse = client()?
        .post(format!("{}/api/chat", r.url_ollama.trim_end_matches('/')))
        .json(&json!({
            "model": r.modele,
            "messages": suite,
            "tools": outils_ollama,
            "stream": false,
            // PAS DE MONOLOGUE INTERIEUR. Les modeles « a raisonnement » —
            // qwen3 et sa famille — ecrivent des centaines de jetons de
            // reflexion avant de repondre. Sur une carte graphique c'est
            // quelques secondes ; sur quatre coeurs a cinq jetons par seconde,
            // c'est plusieurs minutes, et le delai d'attente tombe avant la
            // reponse. Mesure : qwen3:4b passait de 210 secondes de moyenne et
            // zero competence employee, a l'inverse exact du but recherche.
            // Le drapeau est ignore par les modeles qui n'y repondent pas.
            "think": false,
            // Temperature basse : on veut un choix de competence fiable, pas de
            // l'invention. Un assistant de gestion qui varie ses reponses a la
            // meme question perd la confiance qu'il met des mois a gagner.
            "options": { "temperature": 0.1 },
        }))
        .send()
        .await
        .map_err(|e| {
            AppError::Interne(anyhow::anyhow!(
                "le moteur local ne repond pas ({e}). Verifier que le service ollama tourne."
            ))
        })?;

    let corps: Value = reponse
        .json()
        .await
        .map_err(|e| AppError::Interne(anyhow::anyhow!("reponse du moteur illisible : {e}")))?;

    if let Some(err) = corps.get("error").and_then(Value::as_str) {
        return Err(AppError::Interne(anyhow::anyhow!("moteur local : {err}")));
    }

    let message = corps.get("message").cloned().unwrap_or(json!({}));
    if let Some(appels) = message.get("tool_calls").and_then(Value::as_array) {
        if let Some(a) = appels.first() {
            let f = a.get("function").cloned().unwrap_or(json!({}));
            // Les arguments arrivent tantot en objet, tantot en chaine JSON
            // selon la version : on accepte les deux plutot que d'echouer sur
            // une difference de forme.
            let arguments = match f.get("arguments") {
                Some(Value::String(s)) => serde_json::from_str(s).unwrap_or(json!({})),
                Some(v) => v.clone(),
                None => json!({}),
            };
            return Ok(Decision::Competence {
                nom: f.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
                arguments,
                identifiant: String::new(),
            });
        }
    }

    Ok(Decision::Parole(
        message.get("content").and_then(Value::as_str).unwrap_or_default().to_string(),
    ))
}

/// Traduit un message du format Anthropic vers celui d'Ollama.
///
/// UN MESSAGE PEUT EN DEVENIR DEUX, d'ou le vecteur. Anthropic met l'appel
/// d'outil et son resultat dans des blocs de contenu ; Ollama suit la
/// convention d'OpenAI, ou l'appel vit dans `tool_calls` sur le message de
/// l'assistant et le resultat dans un message de role `tool`.
///
/// LA PREMIERE VERSION APLATISSAIT TOUT EN TEXTE — « Resultat : {...} » — et le
/// modele repondait « veuillez utiliser la fonction valeur_stock » au lieu de
/// lire le chiffre qu'on venait de lui donner. Il ne reconnaissait pas ce texte
/// comme la reponse a son propre appel. Vu a la mesure, sur le serveur.
fn convertir_pour_ollama(m: &Value) -> Vec<Value> {
    let role = m.get("role").and_then(Value::as_str).unwrap_or("user");
    match m.get("content") {
        Some(Value::String(s)) => vec![json!({ "role": role, "content": s })],
        Some(Value::Array(blocs)) => {
            let mut sortie = Vec::new();
            let mut texte = String::new();
            let mut appels = Vec::new();

            for b in blocs {
                match b.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        if let Some(t) = b.get("text").and_then(Value::as_str) {
                            texte.push_str(t);
                        }
                    }
                    Some("tool_use") => appels.push(json!({
                        "function": {
                            "name": b.get("name").cloned().unwrap_or(Value::Null),
                            "arguments": b.get("input").cloned().unwrap_or(json!({})),
                        }
                    })),
                    Some("tool_result") => {
                        let contenu = match b.get("content") {
                            Some(Value::String(s)) => s.clone(),
                            Some(v) => v.to_string(),
                            None => String::new(),
                        };
                        sortie.push(json!({ "role": "tool", "content": contenu }));
                    }
                    _ => {}
                }
            }

            if !appels.is_empty() {
                sortie.insert(0, json!({
                    "role": "assistant",
                    "content": texte,
                    "tool_calls": appels,
                }));
            } else if !texte.is_empty() && sortie.is_empty() {
                sortie.push(json!({ "role": role, "content": texte }));
            }
            sortie
        }
        _ => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sans_cle_on_reste_en_local() {
        // Sans cle, demander Claude ne doit pas produire une erreur
        // d'authentification illisible : on retombe sur le moteur local.
        std::env::set_var("ASSISTANT_MOTEUR", "claude");
        std::env::remove_var("ANTHROPIC_API_KEY");
        assert_eq!(Reglage::depuis_env().moteur, Moteur::Ollama);
        std::env::remove_var("ASSISTANT_MOTEUR");
    }

    #[test]
    fn un_resultat_d_outil_devient_un_message_tool() {
        // Aplati en texte, le modele ne reconnaissait pas la reponse a son
        // propre appel et redemandait la fonction.
        let m = json!({
            "role": "user",
            "content": [{ "type": "tool_result", "content": "{\"stock_kg\":12.0}" }]
        });
        let c = convertir_pour_ollama(&m);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0]["role"], "tool");
        assert!(c[0]["content"].as_str().unwrap().contains("stock_kg"));
    }

    #[test]
    fn un_appel_d_outil_devient_tool_calls() {
        let m = json!({
            "role": "assistant",
            "content": [{ "type": "tool_use", "id": "x", "name": "valeur_stock",
                          "input": { "a": 1 } }]
        });
        let c = convertir_pour_ollama(&m);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0]["role"], "assistant");
        assert_eq!(c[0]["tool_calls"][0]["function"]["name"], "valeur_stock");
    }
}
