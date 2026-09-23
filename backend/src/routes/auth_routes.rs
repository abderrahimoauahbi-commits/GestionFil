//! Connexion et identite de l'appelant.

use crate::auth::{jwt, password, rbac, Utilisateur};
use crate::db::maintenant;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{extract::State, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Debug, Deserialize)]
pub struct DemandeConnexion {
    pub login: String,
    pub mot_de_passe: String,
    /// Le code a six chiffres, quand le compte porte un second facteur. Absent
    /// au premier appel : le client ne sait pas encore qu'il sera demande.
    #[serde(default)]
    pub code: Option<String>,
}

/// LE BLOCAGE EST PROGRESSIF, ET C'EST UN CHOIX.
///
/// Un verrouillage ferme apres N echecs laisse n'importe qui fermer le compte
/// du directeur en tapant cinq fois a cote : on remplace une attaque par une
/// autre. L'attente double a chaque echec et se remet a zero des la premiere
/// reussite ; elle est plafonnee pour que le compte se rouvre toujours seul.
///
/// Les deux premiers echecs ne coutent rien : se tromper deux fois de suite est
/// le lot de tout le monde, et punir cela n'arrete personne.
fn attente_secondes(echecs: i64) -> i64 {
    match echecs {
        0..=2 => 0,
        n => (30 * 2i64.saturating_pow((n - 3).min(20) as u32)).min(900),
    }
}

/// L'adresse du client, telle que nginx la transmet.
///
/// `ConnectInfo` ne voit que 127.0.0.1 : le serveur est derriere un proxy. Sans
/// cet en-tete, le journal des connexions dirait « c'est le serveur qui a
/// essaye », ce qui ne sert a rien.
fn adresse_client(entetes: &axum::http::HeaderMap, direct: Option<String>) -> Option<String> {
    entetes
        .get("x-real-ip")
        .or_else(|| entetes.get("x-forwarded-for"))
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(',').next().unwrap_or(v).trim().to_string())
        .filter(|v| !v.is_empty())
        .or(direct)
}

/// Inscrit la tentative au journal. N'echoue jamais la connexion : un journal
/// indisponible ne doit pas empecher le travail, il doit se plaindre dans les
/// traces.
async fn journaliser(
    db: &crate::db::Db,
    login: &str,
    id: Option<&str>,
    resultat: &str,
    ip: Option<&str>,
    agent: Option<&str>,
) {
    let r = sqlx::query(
        "INSERT INTO journal_connexion (login, id_utilisateur, resultat, adresse_ip, agent)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(login)
    .bind(id)
    .bind(resultat)
    .bind(ip)
    .bind(agent.map(|a| a.chars().take(200).collect::<String>()))
    .execute(db)
    .await;
    if let Err(e) = r {
        tracing::warn!(erreur = %e, "journal de connexion indisponible");
    }
}

pub async fn connexion(
    State(state): State<AppState>,
    axum::extract::ConnectInfo(direct): axum::extract::ConnectInfo<std::net::SocketAddr>,
    entetes: axum::http::HeaderMap,
    Json(demande): Json<DemandeConnexion>,
) -> AppResult<Json<Value>> {
    // L'en-tete de nginx d'abord ; a defaut l'adresse vue par le serveur, pour
    // qu'un appel direct sur le port 8080 laisse tout de meme une trace.
    let ip = adresse_client(&entetes, Some(direct.ip().to_string()));
    let agent = entetes
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok());
    let login = demande.login.trim().to_string();

    let compte: Option<(String, String, String, String, i64, i64, Option<String>, Option<String>, i64)> =
        sqlx::query_as(
            "SELECT id_utilisateur, mot_de_passe_hash, nom, code_role_user, actif,
                    echecs_consecutifs, bloque_jusqu_a, secret_totp, totp_actif
               FROM utilisateur WHERE login = $1",
        )
        .bind(&login)
        .fetch_optional(&state.db)
        .await?;

    // Un compte inconnu et un mot de passe faux renvoient la meme erreur : ne
    // pas reveler quels logins existent.
    let Some((id, hash, nom, role, actif, echecs, bloque, secret, totp_actif)) = compte else {
        journaliser(&state.db, &login, None, "INCONNU", ip.as_deref(), agent).await;
        return Err(AppError::IdentifiantsInvalides);
    };

    // LE BLOCAGE SE VERIFIE AVANT LE MOT DE PASSE, sinon il ne bloque rien :
    // celui qui devine juste au dixieme essai entrerait quand meme.
    if let Some(jusqu_a) = bloque.as_deref() {
        if jusqu_a > maintenant().as_str() {
            journaliser(&state.db, &login, Some(&id), "BLOQUE", ip.as_deref(), agent).await;
            return Err(AppError::TropDeTentatives(
                "Trop de tentatives. Le compte se rouvrira dans quelques minutes."
                    .into(),
            ));
        }
    }

    if actif != 1 {
        journaliser(&state.db, &login, Some(&id), "INACTIF", ip.as_deref(), agent).await;
        return Err(AppError::IdentifiantsInvalides);
    }

    // Un echec, quelle qu'en soit la cause, allonge l'attente et l'inscrit.
    let echouer = |raison: &'static str| {
        let db = state.db.clone();
        let (id, login, ip2, agent2) = (id.clone(), login.clone(), ip.clone(), agent.map(String::from));
        async move {
            let n = echecs + 1;
            let attente = attente_secondes(n);
            let jusqu_a = (attente > 0).then(|| crate::db::dans_secondes(attente));
            let _ = sqlx::query(
                "UPDATE utilisateur
                    SET echecs_consecutifs = $2, bloque_jusqu_a = $3, dernier_echec = $4
                  WHERE id_utilisateur = $1",
            )
            .bind(&id)
            .bind(n)
            .bind(&jusqu_a)
            .bind(maintenant())
            .execute(&db)
            .await;
            journaliser(&db, &login, Some(&id), raison, ip2.as_deref(), agent2.as_deref()).await;
            match jusqu_a {
                Some(_) => AppError::TropDeTentatives(format!(
                    "Trop de tentatives. Réessayez dans {}.",
                    duree_lisible(attente)
                )),
                None => AppError::IdentifiantsInvalides,
            }
        }
    };

    if !password::verifier(&demande.mot_de_passe, &hash) {
        return Err(echouer("MOT_DE_PASSE").await);
    }

    // LE SECOND FACTEUR N'EST ANNONCE QU'APRES LE BON MOT DE PASSE. Le dire
    // avant apprendrait a un inconnu quels comptes en portent un.
    if totp_actif == 1 {
        let Some(code) = demande.code.as_deref().map(str::trim).filter(|c| !c.is_empty()) else {
            return Ok(Json(json!({ "exige_code": true })));
        };
        let secret = secret.unwrap_or_default();
        if !crate::auth::totp::verifier(&secret, code, horodatage_unix()) {
            return Err(echouer("CODE").await);
        }
    }

    let (jeton, claims) = jwt::emettre(
        &state.config.jwt_secret,
        &id,
        &login,
        &role,
        state.config.jwt_ttl_minutes,
    )
    .map_err(AppError::Interne)?;

    // La reussite remet le compteur a zero : c'est la SERIE d'echecs qui
    // compte, pas leur total depuis la creation du compte.
    sqlx::query(
        "UPDATE utilisateur
            SET derniere_connexion = $2, echecs_consecutifs = 0, bloque_jusqu_a = NULL
          WHERE id_utilisateur = $1",
    )
    .bind(&id)
    .bind(maintenant())
    .execute(&state.db)
    .await?;
    journaliser(&state.db, &login, Some(&id), "REUSSITE", ip.as_deref(), agent).await;

    Ok(Json(json!({
        "jeton": jeton,
        "expire_le": claims.exp,
        "utilisateur": { "id": id, "login": login, "nom": nom, "role": role },
    })))
}

/// « 30 secondes », « 2 minutes » — un delai qui se lit.
fn duree_lisible(secondes: i64) -> String {
    if secondes < 60 {
        format!("{secondes} secondes")
    } else {
        let m = secondes / 60;
        format!("{m} minute{}", if m > 1 { "s" } else { "" })
    }
}

/// L'instant present en secondes depuis 1970, pour le calcul du code.
fn horodatage_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}


/* ==========================================================================
   LE SECOND FACTEUR — poser, verifier, retirer.

   TROIS GESTES ET PAS DEUX. Poser le secret et l'EXIGER sont separes, parce
   qu'entre les deux il faut que l'utilisateur prouve que son telephone donne
   bien le bon code. Sans cette etape, un QR code mal scanne enferme la personne
   dehors, et il faut un administrateur pour la faire rentrer.

   RIEN NE SORT DE LA MAISON. Le secret vit dans la base et dans le telephone ;
   le code se calcule des deux cotes. Aucun service tiers, aucun acces internet.
   ========================================================================== */

#[derive(Debug, Deserialize)]
pub struct DemandeCode {
    pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct DemandeMotDePasse {
    pub mot_de_passe: String,
}

/// `POST /api/auth/2fa/preparer` — fabrique un secret et rend le QR a scanner.
///
/// Le secret est ecrit tout de suite mais le second facteur n'est PAS exige :
/// on peut donc preparer, se tromper, recommencer, sans jamais se fermer la
/// porte. Chaque appel remplace le precedent — un QR abandonne ne reste pas
/// valable.
pub async fn preparer_2fa(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    let deja: i64 = sqlx::query_scalar("SELECT totp_actif FROM utilisateur WHERE id_utilisateur = $1")
        .bind(&user.id)
        .fetch_one(&state.db)
        .await?;
    if deja == 1 {
        return Err(AppError::Invalide(
            "La double authentification est déjà active. Retirez-la avant d'en poser une nouvelle."
                .into(),
        ));
    }

    let secret = crate::auth::totp::nouveau_secret();
    sqlx::query("UPDATE utilisateur SET secret_totp = $2 WHERE id_utilisateur = $1")
        .bind(&user.id)
        .bind(&secret)
        .execute(&state.db)
        .await?;

    // L'emetteur est ce que le telephone affiche dans sa liste : il doit
    // nommer l'entreprise, pas le logiciel.
    let emetteur: Option<String> =
        sqlx::query_scalar("SELECT nom FROM entreprise WHERE actif = 1 LIMIT 1")
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();
    let emetteur = emetteur.unwrap_or_else(|| "Gestion Fil".to_string());

    Ok(Json(json!({
        "secret": secret,
        "adresse": crate::auth::totp::adresse_otpauth(&emetteur, &user.login, &secret),
    })))
}

/// `POST /api/auth/2fa/activer` — exige le second facteur, une fois prouve.
pub async fn activer_2fa(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(d): Json<DemandeCode>,
) -> AppResult<Json<Value>> {
    let secret: Option<String> =
        sqlx::query_scalar("SELECT secret_totp FROM utilisateur WHERE id_utilisateur = $1")
            .bind(&user.id)
            .fetch_one(&state.db)
            .await?;
    let Some(secret) = secret else {
        return Err(AppError::Invalide(
            "Aucun secret n'est posé : commencez par scanner le QR code.".into(),
        ));
    };

    if !crate::auth::totp::verifier(&secret, &d.code, horodatage_unix()) {
        return Err(AppError::Invalide(
            "Ce code ne correspond pas. Vérifiez l'heure de votre téléphone, puis réessayez."
                .into(),
        ));
    }

    sqlx::query(
        "UPDATE utilisateur SET totp_actif = 1, totp_active_le = $2 WHERE id_utilisateur = $1",
    )
    .bind(&user.id)
    .bind(maintenant())
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "actif": true })))
}

/// `POST /api/auth/2fa/desactiver` — retire le second facteur.
///
/// LE MOT DE PASSE EST EXIGE. Un poste laisse ouvert suffirait sinon a retirer
/// la protection : c'est precisement le cas contre lequel elle existe.
pub async fn desactiver_2fa(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(d): Json<DemandeMotDePasse>,
) -> AppResult<Json<Value>> {
    let hash: String =
        sqlx::query_scalar("SELECT mot_de_passe_hash FROM utilisateur WHERE id_utilisateur = $1")
            .bind(&user.id)
            .fetch_one(&state.db)
            .await?;
    if !password::verifier(&d.mot_de_passe, &hash) {
        return Err(AppError::IdentifiantsInvalides);
    }

    sqlx::query(
        "UPDATE utilisateur SET totp_actif = 0, secret_totp = NULL, totp_active_le = NULL
          WHERE id_utilisateur = $1",
    )
    .bind(&user.id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "actif": false })))
}

/// `GET /api/auth/connexions` — le journal des tentatives.
///
/// RESERVE AU MODULE UTILISATEURS : il nomme des personnes et des machines.
/// C'est ce qu'on ouvre quand on se demande si quelqu'un insiste.
pub async fn journal_connexions(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, "UTILISATEURS", crate::auth::rbac::Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT horodatage, login, resultat, adresse_ip, agent
           FROM journal_connexion
          ORDER BY horodatage DESC
          LIMIT 300",
    )
    .fetch_all(&state.db)
    .await?;
    let mut v = crate::routes::json::lignes_en_json(&lignes);
    user.masquer(&state.db, "UTILISATEURS", &mut v).await?;
    Ok(Json(v))
}

/// Identite et droits effectifs de l'appelant — la source de verite du frontend
/// pour n'afficher que ce que l'utilisateur peut reellement faire.
pub async fn moi(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<serde_json::Value>> {
    let permissions: Vec<(String, String)> = sqlx::query_as(
        "SELECT module, action FROM permission
          WHERE code_role_user = $1 AND actif = 1
          ORDER BY module, action",
    )
    .bind(&user.role)
    .fetch_all(&state.db)
    .await?;

    // Grille de visibilite complete : le frontend s'en sert pour ne rendre que
    // les champs autorises et pour desactiver ceux en lecture seule. Le serveur
    // applique de toute facon la meme grille — l'interface ne fait qu'eviter a
    // l'utilisateur de saisir ce qui sera refuse.
    let droits: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT cc.module, cc.champ, COALESCE(dc.niveau, cc.niveau_defaut)
           FROM champ_configurable cc
           LEFT JOIN droit_champ dc
                  ON dc.module = cc.module AND dc.champ = cc.champ
                 AND dc.id_utilisateur = $1
          ORDER BY cc.module, cc.ordre",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await?;

    // Regroupe par module : { "CATALOGUE": { "prix_catalogue": "MASQUE", ... } }
    let mut par_module: BTreeMap<String, serde_json::Map<String, serde_json::Value>> =
        BTreeMap::new();
    for (module, champ, niveau) in droits {
        par_module
            .entry(module)
            .or_default()
            .insert(champ, Value::from(niveau));
    }

    let plafond = rbac::plafond_validation_bc(&state.db, &user.role).await?;
    let totp_actif: i64 =
        sqlx::query_scalar("SELECT totp_actif FROM utilisateur WHERE id_utilisateur = $1")
            .bind(&user.id)
            .fetch_one(&state.db)
            .await?;

    Ok(Json(json!({
        "id": user.id,
        "login": user.login,
        "role": user.role,
        "plafond_validation_bc_mad": plafond,
        "verrou_inactivite_secondes": state.config.verrou_inactivite_secondes,
<<<<<<< HEAD
        // L'ecran doit savoir s'il propose « activer » ou « retirer ». Le
        // SECRET, lui, ne sort jamais d'ici : seule l'adresse otpauth le porte,
        // le temps d'un scan.
        "totp_actif": totp_actif == 1,
=======
>>>>>>> b12ddbbaab00dcf9c7e5e767fc70a7998f5a28ca
        "permissions": permissions.iter()
            .map(|(m, a)| json!({ "module": m, "action": a }))
            .collect::<Vec<_>>(),
        "droits_champ": par_module,
    })))
}

#[derive(Debug, Deserialize)]
pub struct DemandeChangement {
    pub ancien: String,
    pub nouveau: String,
}

/// Change SON PROPRE mot de passe.
///
/// Voir le commentaire du module pour les trois gardes. Celle qui compte le
/// plus est la premiere : l'ancien mot de passe est exige, meme si l'appelant
/// est deja authentifie. Un jeton prouve qu'une session est ouverte, pas que
/// la personne devant l'ecran est bien la bonne.
pub async fn changer_mot_de_passe(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(d): Json<DemandeChangement>,
) -> AppResult<Json<Value>> {
    password::valider_longueur(&d.nouveau).map_err(AppError::Invalide)?;

    if d.nouveau == d.ancien {
        return Err(AppError::Invalide(
            "le nouveau mot de passe doit differer de l'ancien".into(),
        ));
    }

    let hash: String = sqlx::query_scalar(
        "SELECT mot_de_passe_hash FROM utilisateur WHERE id_utilisateur = $1",
    )
    .bind(&user.id)
    .fetch_one(&state.db)
    .await?;

    if !password::verifier(&d.ancien, &hash) {
        // Le meme message que pour un compte inconnu a la connexion : ne rien
        // apprendre a qui essaie.
        return Err(AppError::IdentifiantsInvalides);
    }

    let nouveau_hash = password::hacher(&d.nouveau).map_err(AppError::Interne)?;

    // L'ECRITURE PASSE PAR UNE TRANSACTION AVEC CONTEXTE, comme toute ecriture
    // du service : sans `poser_contexte`, le declencheur d'audit enregistrerait
    // un changement de mot de passe sans savoir qui l'a fait.
    let mut tx = state.db.begin().await?;
    crate::db::poser_contexte(&mut tx, &user.id, None, None).await?;
    sqlx::query(
        "UPDATE utilisateur SET mot_de_passe_hash = $2 WHERE id_utilisateur = $1",
    )
    .bind(&user.id)
    .bind(&nouveau_hash)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    // LE JETON RESTE VALIDE. Le revoquer obligerait a se reconnecter
    // immediatement apres avoir change son mot de passe, ce qui n'apporte rien
    // ici : le jeton appartient deja a la bonne personne, qui vient de prouver
    // qu'elle connait l'ancien mot de passe.
    Ok(Json(json!({
        "change": true,
        "le": maintenant(),
    })))
}

#[derive(Debug, Deserialize)]
pub struct DemandeDeverrouillage {
    pub mot_de_passe: String,
}

/// `POST /api/auth/deverrouiller`
///
/// VERIFIE LE MOT DE PASSE SANS EMETTRE DE JETON, et c'est tout le point.
///
/// L'ecran se verrouille apres quelques minutes d'inactivite parce qu'un poste
/// abandonne, session ouverte, donne a n'importe qui le stock, les prix et le
/// droit d'ecrire. Le verrou n'est pas une deconnexion : la saisie en cours est
/// conservee, sinon l'operateur perdrait sa fiche et finirait par contourner le
/// verrou plutot que de le subir.
///
/// Deverrouiller NE PROLONGE DONC PAS la session. Le jeton garde son echeance
/// d'origine : au bout des quatre heures, il expire quoi qu'il arrive et il
/// faut se reconnecter pour de bon. Emettre un jeton neuf ici rendrait la
/// session eternelle — il suffirait de bouger la souris une fois par heure.
///
/// Le compte est relu en base : un compte desactive pendant la session ne se
/// deverrouille plus.
pub async fn deverrouiller(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(demande): Json<DemandeDeverrouillage>,
) -> AppResult<Json<Value>> {
    let compte: Option<(String, i64)> = sqlx::query_as(
        "SELECT mot_de_passe_hash, actif FROM utilisateur WHERE id_utilisateur = $1",
    )
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await?;

    let (hash, actif) = compte.ok_or(AppError::IdentifiantsInvalides)?;
    if actif != 1 || !password::verifier(&demande.mot_de_passe, &hash) {
        return Err(AppError::IdentifiantsInvalides);
    }

    Ok(Json(json!({ "ok": true })))
}
