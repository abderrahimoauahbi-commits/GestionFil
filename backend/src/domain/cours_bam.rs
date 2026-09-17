//! Le cours de reference de Bank Al-Maghrib, lu POUR INFORMATION.
//!
//! LE TAUX DE L'ERP NE CHANGE JAMAIS TOUT SEUL. Il valorise les receptions et
//! le CMUP : il reste une decision, saisie et datee (RG-09). Le cours de Bank
//! Al-Maghrib se place a cote, pour que la direction voie d'un coup d'oeil si le
//! taux qu'elle utilise s'est eloigne du marche.
//!
//! LA SOURCE. Le cours de reference MOYEN, publie chaque jour ouvre vers 16 h 15
//! sur https://www.bkam.ma (page « Cours de reference »). Bank Al-Maghrib propose
//! aussi une API, mais elle exige une cle d'abonnement ; la page publique porte
//! les memes chiffres sans cle. Si elle change de forme, la lecture echoue
//! proprement et l'ecran garde le dernier cours connu, en le datant.
//!
//! CHAQUE COURS LU EST GARDE (`cours_bam`) : l'ecran s'affiche meme quand le
//! serveur ne joint pas Internet, et l'historique du marche reste consultable.

use crate::db::Db;
use crate::error::AppResult;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const URL: &str =
    "https://www.bkam.ma/Marches/Principaux-indicateurs/Marche-des-changes/Cours-de-change/Cours-de-reference";

/// Un cours lu : 1 unite de `code_devise` = `cours_mad` dirhams, au `date_cours`.
#[derive(Debug, Clone, PartialEq)]
pub struct Cours {
    pub code_devise: String,
    pub date_cours: String,
    pub cours_mad: f64,
}

/// Lit le tableau de la page.
///
/// L'en-tete porte les dates des colonnes (« 17/09/2026 », « 16/09/2026 ») ;
/// chaque ligne porte `title="1 DOLLAR U.S.A. (USD)"` puis un
/// `<span class="number">9,4964` par colonne. Une devise cotee par 100 unites
/// (« 100 YENS ») est ramenee a l'unite.
pub fn analyser(html: &str) -> Vec<Cours> {
    let Some(debut) = html.find("<table class=\"dynamic_contents_ref") else {
        return Vec::new();
    };
    let table = &html[debut..html[debut..].find("</table>").map_or(html.len(), |f| debut + f)];
    let (entete, corps) = table.split_at(table.find("<tbody>").unwrap_or(table.len()));

    let dates: Vec<String> = entete
        .split("<span class=\"txt-filter\">")
        .skip(1)
        .filter_map(|m| m.split('<').next())
        .filter_map(date_iso)
        .collect();

    let mut cours = Vec::new();
    for ligne in corps.split("<tr>").skip(1) {
        let Some(titre) = entre(ligne, "title=\"", "\"") else {
            continue;
        };
        // « 1 DOLLAR U.S.A. (USD) » : le code entre les dernieres parentheses,
        // l'unite en tete.
        let Some(code) = titre.rsplit('(').next().and_then(|x| x.strip_suffix(')')) else {
            continue;
        };
        let unite: f64 = titre.split_whitespace().next().and_then(|u| u.parse().ok()).unwrap_or(1.0);
        let nombres = ligne
            .split("<span class=\"number\">")
            .skip(1)
            .map(|m| m.split('<').next().unwrap_or("").trim().replace(['\u{a0}', ' '], "").replace(',', "."));
        for (date, n) in dates.iter().zip(nombres) {
            if let Ok(v) = n.parse::<f64>() {
                if v > 0.0 && unite > 0.0 {
                    cours.push(Cours {
                        code_devise: code.trim().to_string(),
                        date_cours: date.clone(),
                        cours_mad: (v / unite * 10_000.0).round() / 10_000.0,
                    });
                }
            }
        }
    }
    cours
}

fn entre<'a>(texte: &'a str, avant: &str, apres: &str) -> Option<&'a str> {
    let d = texte.find(avant)? + avant.len();
    let f = texte[d..].find(apres)?;
    Some(&texte[d..d + f])
}

/// « 17/09/2026 » -> « 2026-09-17 » ; tout autre texte d'en-tete est ignore.
fn date_iso(t: &str) -> Option<String> {
    let p: Vec<&str> = t.trim().split('/').collect();
    match p.as_slice() {
        [j, m, a] if j.len() == 2 && m.len() == 2 && a.len() == 4
            && [j, m, a].iter().all(|x| x.chars().all(|c| c.is_ascii_digit())) =>
        {
            Some(format!("{a}-{m}-{j}"))
        }
        _ => None,
    }
}

/// Derniere TENTATIVE de lecture, reussie ou non. Sans elle, chaque ouverture
/// de l'accueil irait frapper le site de la banque avant 16 h 15, quand le cours
/// du jour n'existe pas encore.
static DERNIERE_TENTATIVE: Mutex<Option<Instant>> = Mutex::new(None);
const INTERVALLE: Duration = Duration::from_secs(30 * 60);

/// Lit la page si le cours du jour manque et qu'on n'a pas essaye recemment.
/// Rend l'erreur en clair quand la lecture a echoue ; `None` sinon.
pub async fn rafraichir(db: &Db) -> AppResult<Option<String>> {
    let aujourd_hui = chrono::Local::now().format("%Y-%m-%d").to_string();
    let deja: i64 = sqlx::query_scalar("SELECT count(*) FROM cours_bam WHERE date_cours = $1")
        .bind(&aujourd_hui)
        .fetch_one(db)
        .await?;
    if deja > 0 {
        return Ok(None);
    }
    {
        let mut t = DERNIERE_TENTATIVE.lock().expect("verrou du cours BAM");
        if t.is_some_and(|i| i.elapsed() < INTERVALLE) {
            return Ok(None);
        }
        *t = Some(Instant::now());
    }

    let html = match lire_page().await {
        Ok(h) => h,
        Err(e) => {
            tracing::warn!(erreur = %e, "cours Bank Al-Maghrib injoignable");
            return Ok(Some(e));
        }
    };
    let cours = analyser(&html);
    if cours.is_empty() {
        tracing::warn!("page Bank Al-Maghrib lue, mais aucun cours reconnu");
        return Ok(Some("la page de Bank Al-Maghrib a change de forme : aucun cours reconnu".into()));
    }

    // Seules les devises de l'ERP sont gardees : la banque en cote une vingtaine.
    let mut tx = db.begin().await?;
    for c in &cours {
        sqlx::query(
            "INSERT INTO cours_bam (code_devise, date_cours, cours_mad)
             SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM devise WHERE code_devise = $1)
             ON CONFLICT (code_devise, date_cours) DO UPDATE
                SET cours_mad = excluded.cours_mad, date_lecture = excluded.date_lecture",
        )
        .bind(&c.code_devise)
        .bind(&c.date_cours)
        .bind(c.cours_mad)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(None)
}

async fn lire_page() -> Result<String, String> {
    // SANS USER-AGENT, LE SITE REPOND 403 : son pare-feu ecarte les requetes
    // anonymes. On se presente sous le nom de l'ERP, sans se faire passer pour
    // un navigateur.
    let client = reqwest::Client::builder()
        .user_agent("GestionFil-ERP/1.0 (Polyfashions Carpet, Tanger)")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("client HTTP : {e}"))?;
    let r = client
        .get(URL)
        .send()
        .await
        .map_err(|e| format!("Bank Al-Maghrib injoignable depuis le serveur ({e})"))?;
    if !r.status().is_success() {
        return Err(format!("Bank Al-Maghrib a repondu {}", r.status()));
    }
    r.text().await.map_err(|e| format!("lecture de la page interrompue ({e})"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Extrait REEL de la page du 17/09/2026, balise fautive `</sapn>` comprise.
    const EXTRAIT: &str = r#"
<table class="dynamic_contents_ref_18">
<thead><tr><th rowspan=2><div class="block-filter"><span class="txt-filter">Devises</span></div></th>
<th colspan="1"><div class="block-filter"><span class="txt-filter">17/09/2026</span></div></th>
<th colspan="1"><div class="block-filter"><span class="txt-filter">16/09/2026</span></div></th></tr>
<tr><th><div class="block-filter"><span class="txt-filter">Moyen</span></div></th>
<th><div class="block-filter"><span class="txt-filter">Moyen</span></div></th></tr></thead>
<tbody>
<tr>
<td><a class="ajax-fanc" title="1 EURO (EUR)"  href="/graph/currency/eur" >1 EURO</a></td>
<td><span class="number">10,8982</sapn>&nbsp;<span class="symbol"></span></td>
<td><span class="number">10,9068</sapn>&nbsp;<span class="symbol"></span></td>
</tr>
<tr>
<td><a class="ajax-fanc" title="1 DOLLAR U.S.A. (USD)"  href="/graph/currency/usd" >1 DOLLAR U.S.A.</a></td>
<td><span class="number">9,4964</sapn>&nbsp;<span class="symbol"></span></td>
<td><span class="number">9,4514</sapn>&nbsp;<span class="symbol"></span></td>
</tr>
<tr>
<td><a class="ajax-fanc" title="100 YENS JAPONAIS (JPY)"  href="/graph/currency/jpy" >100 YENS JAPONAIS</a></td>
<td><span class="number">6,4210</sapn>&nbsp;<span class="symbol"></span></td>
<td><span class="number">6,4000</sapn>&nbsp;<span class="symbol"></span></td>
</tr>
</tbody></table>"#;

    #[test]
    fn lit_le_cours_de_reference_de_bank_al_maghrib() {
        let c = analyser(EXTRAIT);
        let cherche = |code: &str, date: &str| {
            c.iter().find(|x| x.code_devise == code && x.date_cours == date).map(|x| x.cours_mad)
        };
        assert_eq!(cherche("USD", "2026-09-17"), Some(9.4964));
        assert_eq!(cherche("USD", "2026-09-16"), Some(9.4514));
        assert_eq!(cherche("EUR", "2026-09-17"), Some(10.8982));
        // Cote par 100 : ramene a l'unite.
        assert_eq!(cherche("JPY", "2026-09-17"), Some(0.0642));
        assert_eq!(c.len(), 6);
    }

    #[test]
    fn une_page_sans_tableau_ne_donne_rien() {
        assert!(analyser("<html><body>maintenance</body></html>").is_empty());
    }
}
