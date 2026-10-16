//! LA GARDE DE LA CONNEXION (audit de securite du 13/10/2026).
//!
//! Trois defauts trouves a l'audit, une seule piece pour les fermer :
//!
//!   * UNE RAFALE PASSAIT LE BLOCAGE. Le blocage etait lu avant le calcul du
//!     mot de passe et ecrit apres l'echec : cinq cents essais simultanes
//!     lisaient tous « pas bloque ». Les essais sur un MEME identifiant passent
//!     desormais un par un (`verrou_login`) : le second lit le blocage pose par
//!     le premier.
//!   * LE CALCUL D'ARGON2 FIGEAIT LE SERVEUR. Il tournait sur les fils de
//!     l'executeur : une rafale les occupait tous, et plus rien ne repondait.
//!     Il passe sur un fil a part, quatre calculs au plus a la fois.
//!   * UN IDENTIFIANT INCONNU SE DEVINAIT : il repondait sans calcul (plus vite)
//!     et n'etait jamais bloque. Il fait maintenant le meme calcul, sur une
//!     empreinte leurre, et compte ses echecs comme un vrai compte.
//!
//! Et une limite par adresse : au-dela de vingt echecs en quinze minutes, la
//! machine qui essaie attend, quel que soit l'identifiant qu'elle tente.
//!
//! Tout est en memoire : un seul processus sert l'ERP, et un redemarrage qui
//! remet ces compteurs a zero ne rouvre rien que la base ne garde (le blocage
//! des comptes reels y est ecrit).

use super::password;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Echecs toleres par adresse dans la fenetre, avant de la faire attendre.
/// Reglable (GESTIONFIL_ECHECS_PAR_ADRESSE) : le banc de tests echoue expres,
/// depuis une seule adresse, bien plus souvent qu'un poste reel.
const ECHECS_PAR_ADRESSE: u32 = 20;
const FENETRE: Duration = Duration::from_secs(15 * 60);

pub struct Garde {
    seuil_adresse: u32,
    calcul: tokio::sync::Semaphore,
    par_login: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    par_adresse: Mutex<HashMap<String, (u32, Instant)>>,
    inconnus: Mutex<HashMap<String, (i64, Instant)>>,
    leurre: String,
}

impl Default for Garde {
    fn default() -> Self {
        Self::new()
    }
}

impl Garde {
    pub fn new() -> Self {
        Self {
            seuil_adresse: std::env::var("GESTIONFIL_ECHECS_PAR_ADRESSE")
                .ok()
                .and_then(|v| v.parse().ok())
                .filter(|n| *n > 0)
                .unwrap_or(ECHECS_PAR_ADRESSE),
            calcul: tokio::sync::Semaphore::new(4),
            par_login: Mutex::new(HashMap::new()),
            par_adresse: Mutex::new(HashMap::new()),
            inconnus: Mutex::new(HashMap::new()),
            // Une empreinte reelle, d'un mot de passe que personne ne connait :
            // le calcul a le meme cout qu'un vrai.
            leurre: password::hacher(&uuid::Uuid::new_v4().to_string()).unwrap_or_default(),
        }
    }

    /// Verifie un mot de passe hors des fils de l'executeur, quatre a la fois.
    pub async fn verifier(&self, mot_de_passe: &str, hash: &str) -> bool {
        let Ok(_permis) = self.calcul.acquire().await else { return false };
        let (m, h) = (mot_de_passe.to_string(), hash.to_string());
        tokio::task::spawn_blocking(move || password::verifier(&m, &h)).await.unwrap_or(false)
    }

    /// Le meme calcul pour un identifiant inconnu : la duree ne le trahit pas.
    pub async fn leurrer(&self, mot_de_passe: &str) {
        let leurre = self.leurre.clone();
        let _ = self.verifier(mot_de_passe, &leurre).await;
    }

    /// Le verrou d'un identifiant : ses essais passent un par un.
    pub fn verrou_login(&self, login: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut carte = self.par_login.lock().unwrap_or_else(|e| e.into_inner());
        if carte.len() > 10_000 {
            // Ne garder que les verrous en cours d'usage.
            carte.retain(|_, v| Arc::strong_count(v) > 1);
        }
        carte.entry(login.to_lowercase()).or_default().clone()
    }

    /// L'adresse a-t-elle trop echoue dans la fenetre ?
    pub fn adresse_bloquee(&self, adresse: Option<&str>) -> bool {
        let Some(a) = adresse else { return false };
        let carte = self.par_adresse.lock().unwrap_or_else(|e| e.into_inner());
        matches!(carte.get(a), Some((n, debut)) if *n >= self.seuil_adresse && debut.elapsed() < FENETRE)
    }

    pub fn noter_echec_adresse(&self, adresse: Option<&str>) {
        let Some(a) = adresse else { return };
        let mut carte = self.par_adresse.lock().unwrap_or_else(|e| e.into_inner());
        if carte.len() > 10_000 {
            carte.retain(|_, (_, debut)| debut.elapsed() < FENETRE);
        }
        let e = carte.entry(a.to_string()).or_insert((0, Instant::now()));
        if e.1.elapsed() >= FENETRE {
            *e = (0, Instant::now());
        }
        e.0 += 1;
    }

    /// Un echec sur un identifiant inconnu : rend la serie, comme pour un vrai
    /// compte (le blocage s'affiche donc aussi pour lui).
    pub fn noter_echec_inconnu(&self, login: &str) -> i64 {
        let mut carte = self.inconnus.lock().unwrap_or_else(|e| e.into_inner());
        if carte.len() > 10_000 {
            carte.retain(|_, (_, t)| t.elapsed() < FENETRE);
        }
        let e = carte.entry(login.to_lowercase()).or_insert((0, Instant::now()));
        if e.1.elapsed() >= FENETRE {
            *e = (0, Instant::now());
        }
        e.0 += 1;
        e.1 = Instant::now();
        e.0
    }

    /// L'identifiant inconnu est-il « bloque » ? Meme attente qu'un vrai compte.
    pub fn inconnu_bloque(&self, login: &str, attente: impl Fn(i64) -> i64) -> Option<i64> {
        let carte = self.inconnus.lock().unwrap_or_else(|e| e.into_inner());
        let (n, dernier) = carte.get(&login.to_lowercase())?;
        let reste = attente(*n) - dernier.elapsed().as_secs() as i64;
        (reste > 0).then_some(reste)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn une_adresse_qui_echoue_trop_attend() {
        let g = Garde::new();
        let ip = Some("10.0.0.9");
        for _ in 0..(g.seuil_adresse - 1) {
            g.noter_echec_adresse(ip);
        }
        assert!(!g.adresse_bloquee(ip));
        g.noter_echec_adresse(ip);
        assert!(g.adresse_bloquee(ip));
        assert!(!g.adresse_bloquee(Some("10.0.0.10")), "une autre adresse n'est pas touchee");
        assert!(!g.adresse_bloquee(None));
    }

    #[test]
    fn un_identifiant_inconnu_se_bloque_comme_un_vrai() {
        let g = Garde::new();
        let attente = |n: i64| if n >= 3 { 30 } else { 0 };
        assert_eq!(g.noter_echec_inconnu("Personne"), 1);
        assert_eq!(g.noter_echec_inconnu("personne"), 2, "la casse ne fait pas un autre identifiant");
        assert!(g.inconnu_bloque("personne", attente).is_none());
        g.noter_echec_inconnu("personne");
        assert!(g.inconnu_bloque("PERSONNE", attente).is_some());
    }

    #[tokio::test]
    async fn le_calcul_du_mot_de_passe_reste_juste() {
        let g = Garde::new();
        let h = password::hacher("Un-mot-de-passe-12").unwrap();
        assert!(g.verifier("Un-mot-de-passe-12", &h).await);
        assert!(!g.verifier("autre-chose-12345", &h).await);
    }
}
