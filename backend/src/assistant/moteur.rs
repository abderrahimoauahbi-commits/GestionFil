//! Le moteur de langage, et sa bascule.
//!
//! DEUX MOTEURS, UN SEUL CONTRAT. Le serveur parle a l'un ou a l'autre selon un
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
}

impl Moteur {
    pub fn nom(&self) -> &'static str {
        match self {
            Moteur::Ollama => "ollama",
            Moteur::Claude => "claude",
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
}

impl Reglage {
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
            Moteur::Ollama => "qwen2.5:7b-instruct".into(),
            Moteur::Claude => "claude-sonnet-4-5".into(),
        });

        Self {
            moteur,
            modele,
            url_ollama: std::env::var("OLLAMA_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:11434".into()),
            cle_claude: cle,
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
