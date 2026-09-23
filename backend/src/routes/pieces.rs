//! Les pieces d'un dossier d'importation : scans, PDF, photos.
//!
//! UN DOSSIER, C'EST UNE DOUZAINE DE DOCUMENTS — la facture du fournisseur, la
//! DUM, la quittance de la douane, la fiche de liquidation, les factures du
//! transitaire et du port. Les ranger avec le dossier, c'est pouvoir verifier
//! une saisie sans se lever, repondre a un controle, et faire lire le document
//! par l'assistant.
//!
//! LES OCTETS NE SONT PAS EN BASE. Une base qui porte des scans grossit sans
//! fin et alourdit chaque sauvegarde. Le fichier vit dans un repertoire du
//! serveur (`GESTIONFIL_PIECES`, par defaut `./pieces`), range par dossier ; la
//! table porte le chemin, la taille, le type et l'empreinte.
//!
//! LE NOM DU CLIENT NE DEVIENT JAMAIS UN CHEMIN. Le fichier est ecrit sous
//! l'identifiant de la piece, avec la seule extension deduite du type reconnu :
//! aucun « ../ » ne peut sortir du repertoire, aucun nom ne peut en ecraser un
//! autre. Le nom d'origine est conserve en base, pour l'affichage et le
//! telechargement.

use crate::auth::{rbac::Action, Utilisateur};
use crate::error::{AppError, AppResult};
use crate::routes::json::lignes_en_json;
use crate::AppState;
use axum::body::Body;
use axum::extract::{Multipart, Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::Row;
use tokio::io::AsyncWriteExt;

const IMPORT: &str = "IMPORT";

/// 40 Mo : un dossier scanne de vingt pages tient largement dedans, et la
/// limite protege le disque d'un envoi accidentel.
pub const TAILLE_MAX: usize = 40 * 1024 * 1024;

/// Ce qu'on accepte de lire. Un document d'import est un PDF ou une photo ;
/// tout le reste (archive, executable, tableur) n'a rien a faire ici.
fn extension_de(type_mime: &str, nom: &str) -> Option<&'static str> {
    match type_mime {
        "application/pdf" => Some("pdf"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/tiff" => Some("tif"),
        "image/webp" => Some("webp"),
        // Certains scanners envoient un type generique : on retombe sur
        // l'extension du nom, jamais sur une acceptation aveugle.
        "application/octet-stream" | "" => match nom.rsplit_once('.').map(|(_, e)| e.to_lowercase()) {
            Some(e) if e == "pdf" => Some("pdf"),
            Some(e) if e == "jpg" || e == "jpeg" => Some("jpg"),
            Some(e) if e == "png" => Some("png"),
            Some(e) if e == "tif" || e == "tiff" => Some("tif"),
            Some(e) if e == "webp" => Some("webp"),
            _ => None,
        },
        _ => None,
    }
}

fn type_reel(extension: &str) -> &'static str {
    match extension {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "tif" => "image/tiff",
        "webp" => "image/webp",
        _ => "image/jpeg",
    }
}

/// Le repertoire des pieces, par dossier.
fn repertoire(id_dossier: &str) -> std::path::PathBuf {
    std::env::var("GESTIONFIL_PIECES")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("./pieces"))
        .join(id_dossier)
}

/// `POST /api/import/dossiers/{id}/pieces` — depose une piece.
///
/// Le corps est un formulaire multipart : le fichier dans `fichier`, et
/// facultativement `nature`, `id_frais`, `id_facture`, `id_reception`,
/// `libelle` pour dire ce que le document est.
pub async fn deposer(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id_dossier): Path<String>,
    mut formulaire: Multipart,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;

    let numero: Option<String> =
        sqlx::query_scalar("SELECT numero FROM import_dossiers WHERE id_dossier = $1")
            .bind(&id_dossier)
            .fetch_optional(&state.db)
            .await?;
    if numero.is_none() {
        return Err(AppError::Introuvable(format!("dossier {id_dossier}")));
    }

    let id_piece = uuid::Uuid::new_v4().to_string();
    let mut nom_fichier = String::new();
    let mut extension = "";
    let mut taille: usize = 0;
    let mut empreinte = Sha256::new();
    let mut chemin: Option<std::path::PathBuf> = None;
    let mut champs: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    while let Some(mut champ) = formulaire
        .next_field()
        .await
        .map_err(|e| AppError::Invalide(format!("Envoi illisible : {e}")))?
    {
        let nom_champ = champ.name().unwrap_or_default().to_string();
        if nom_champ != "fichier" {
            let valeur = champ
                .text()
                .await
                .map_err(|e| AppError::Invalide(format!("Champ {nom_champ} illisible : {e}")))?;
            if !valeur.trim().is_empty() {
                champs.insert(nom_champ, valeur.trim().to_string());
            }
            continue;
        }

        nom_fichier = champ.file_name().unwrap_or("document").to_string();
        let type_mime = champ.content_type().unwrap_or_default().to_string();
        extension = extension_de(&type_mime, &nom_fichier).ok_or_else(|| {
            AppError::Invalide(format!(
                "« {nom_fichier} » n'est ni un PDF ni une image. Déposez le scan en PDF, JPEG, PNG ou TIFF."
            ))
        })?;

        let rep = repertoire(&id_dossier);
        tokio::fs::create_dir_all(&rep)
            .await
            .map_err(|e| AppError::Interne(anyhow::anyhow!("repertoire des pieces : {e}")))?;
        let cible = rep.join(format!("{id_piece}.{extension}"));
        let mut fichier = tokio::fs::File::create(&cible)
            .await
            .map_err(|e| AppError::Interne(anyhow::anyhow!("ecriture de la piece : {e}")))?;

        while let Some(morceau) = champ
            .chunk()
            .await
            .map_err(|e| AppError::Invalide(format!("Envoi interrompu : {e}")))?
        {
            taille += morceau.len();
            if taille > TAILLE_MAX {
                drop(fichier);
                let _ = tokio::fs::remove_file(&cible).await;
                return Err(AppError::Invalide(format!(
                    "Fichier trop lourd : la limite est de {} Mo.",
                    TAILLE_MAX / (1024 * 1024)
                )));
            }
            empreinte.update(&morceau);
            fichier
                .write_all(&morceau)
                .await
                .map_err(|e| AppError::Interne(anyhow::anyhow!("ecriture de la piece : {e}")))?;
        }
        fichier
            .flush()
            .await
            .map_err(|e| AppError::Interne(anyhow::anyhow!("ecriture de la piece : {e}")))?;
        chemin = Some(cible);
    }

    let chemin = chemin.ok_or_else(|| AppError::Invalide("Aucun fichier dans l'envoi.".into()))?;
    if taille == 0 {
        let _ = tokio::fs::remove_file(&chemin).await;
        return Err(AppError::Invalide("Le fichier est vide.".into()));
    }
    let sha = hex::encode(empreinte.finalize());

    // Le meme scan depose deux fois : on le dit, et on garde le premier.
    let deja: Option<(String, String)> = sqlx::query_as(
        "SELECT id_piece, nom_fichier FROM piece_jointe
          WHERE id_dossier = $1 AND empreinte_sha256 = $2 LIMIT 1",
    )
    .bind(&id_dossier)
    .bind(&sha)
    .fetch_optional(&state.db)
    .await?;
    if let Some((id_existante, nom_existant)) = deja {
        let _ = tokio::fs::remove_file(&chemin).await;
        return Ok(Json(json!({
            "id_piece": id_existante,
            "doublon": true,
            "message": format!("Ce document est déjà dans le dossier, sous « {nom_existant} »."),
        })));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let insertion = sqlx::query(
        "INSERT INTO piece_jointe (id_piece, id_dossier, id_facture, id_reception, nature,
                                   id_frais, libelle, nom_fichier, type_mime, taille_octets,
                                   chemin, empreinte_sha256, id_utilisateur)
         VALUES ($1, $2, $3, $4, COALESCE($5, 'AUTRE'), $6, $7, $8, $9, $10, $11, $12, $13)",
    )
    .bind(&id_piece)
    .bind(&id_dossier)
    .bind(champs.get("id_facture"))
    .bind(champs.get("id_reception"))
    .bind(champs.get("nature"))
    .bind(champs.get("id_frais"))
    .bind(champs.get("libelle"))
    .bind(&nom_fichier)
    .bind(type_reel(extension))
    .bind(taille as i64)
    .bind(chemin.to_string_lossy().to_string())
    .bind(&sha)
    .bind(&user.id)
    .execute(&mut *tx)
    .await;
    if let Err(e) = insertion {
        // La base a refuse (dossier clos, facture d'un autre dossier...) : le
        // fichier ne doit pas rester orphelin sur le disque.
        let _ = tokio::fs::remove_file(&chemin).await;
        return Err(e.into());
    }
    tx.commit().await?;

    Ok(Json(json!({ "id_piece": id_piece, "nom_fichier": nom_fichier, "taille_octets": taille })))
}

/// `GET /api/import/pieces/{id}` — le document lui-meme.
pub async fn telecharger(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Response> {
    user.exiger(&state.db, IMPORT, Action::Lire).await?;
    let piece: Option<(String, String, String)> = sqlx::query_as(
        "SELECT chemin, type_mime, nom_fichier FROM piece_jointe WHERE id_piece = $1",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?;
    let (chemin, type_mime, nom) =
        piece.ok_or_else(|| AppError::Introuvable(format!("piece {id}")))?;

    let octets = tokio::fs::read(&chemin).await.map_err(|e| {
        AppError::Introuvable(format!("le fichier de la pièce n'est plus sur le serveur ({e})"))
    })?;
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, type_mime),
            // `inline` : la piece s'affiche a cote de la saisie plutot que de
            // partir dans les telechargements.
            (
                header::CONTENT_DISPOSITION,
                format!("inline; filename=\"{}\"", nom.replace('"', "")),
            ),
        ],
        Body::from(octets),
    )
        .into_response())
}

/// `DELETE /api/import/pieces/{id}` — retire la piece et son fichier.
pub async fn supprimer(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, IMPORT, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let chemin: Option<String> =
        sqlx::query_scalar("DELETE FROM piece_jointe WHERE id_piece = $1 RETURNING chemin")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?;
    let chemin = chemin.ok_or_else(|| AppError::Introuvable(format!("piece {id}")))?;
    tx.commit().await?;
    // Le fichier part APRES la base : si l'effacement echoue, il reste un
    // fichier sans ligne, ce qui ne trompe personne — l'inverse afficherait une
    // piece introuvable.
    let _ = tokio::fs::remove_file(&chemin).await;
    Ok(Json(json!({ "supprime": id })))
}

/// CE QUE LE DOSSIER DEVRAIT CONTENIR, deduit de ce qu'il porte deja.
///
/// La regle vit ICI, et non dans l'ecran, parce qu'elle a deux lecteurs :
/// l'ecran des pieces, qui affiche les manques en tete, et l'assistant, a qui
/// l'on demande « qu'est-ce qui manque au dossier 55/26 ». Deux copies d'une
/// meme regle divergent le jour ou l'une est corrigee seule.
///
/// ON NE RECLAME QUE CE QUI A UNE RAISON D'EXISTER : pas de quittance tant
/// qu'aucun frais de douane n'est saisi, pas de facture fournisseur tant
/// qu'aucune facture ne l'est. Un dossier vide ne doit rien reclamer, sans quoi
/// l'ecran ouvre sur une liste de reproches.
pub async fn attendues(db: &crate::db::Db, id_dossier: &str) -> AppResult<Value> {
    let ligne = sqlx::query(
        "SELECT (SELECT count(*) FROM import_factures f WHERE f.id_dossier = d.id_dossier)
                  AS nb_factures,
                EXISTS (SELECT 1 FROM dossier_lignes_frais x
                          JOIN parametres_frais p ON p.id_frais = x.id_frais
                         WHERE x.id_dossier = d.id_dossier
                           AND p.categorie IN ('DOUANE','TAXE'))            AS douane,
                EXISTS (SELECT 1 FROM dossier_lignes_frais x
                          JOIN parametres_frais p ON p.id_frais = x.id_frais
                         WHERE x.id_dossier = d.id_dossier
                           AND p.categorie NOT IN ('DOUANE','TAXE'))        AS autres_frais,
                COALESCE(d.numero_bl, '') <> ''                             AS a_un_bl
           FROM import_dossiers d WHERE d.id_dossier = $1",
    )
    .bind(id_dossier)
    .fetch_optional(db)
    .await?;
    let Some(l) = ligne else { return Ok(json!([])) };

    let nb_factures: i64 = l.try_get("nb_factures").unwrap_or(0);
    let douane: bool = l.try_get("douane").unwrap_or(false);
    let autres_frais: bool = l.try_get("autres_frais").unwrap_or(false);
    let a_un_bl: bool = l.try_get("a_un_bl").unwrap_or(false);

    let mut liste: Vec<(&str, &str, i64)> = Vec::new();
    if nb_factures > 0 {
        liste.push(("FACTURE_FOURNISSEUR", "Facture fournisseur", nb_factures));
    }
    if douane {
        liste.push(("QUITTANCE_DOUANE", "Quittance de la douane", 1));
        liste.push(("LIQUIDATION", "Fiche de liquidation", 1));
        liste.push(("DUM", "DUM (déclaration)", 1));
    }
    if autres_frais {
        liste.push(("FACTURE_FRAIS", "Facture de frais (transitaire, fret, port)", 1));
    }
    if a_un_bl {
        liste.push(("BL", "Connaissement (BL)", 1));
    }

    // Ce qui est deja depose, par nature : le manque est une soustraction, pas
    // une presence/absence — un dossier a trois factures en veut trois.
    let deposees: Vec<(String, i64)> = sqlx::query_as(
        "SELECT nature, count(*) FROM piece_jointe WHERE id_dossier = $1 GROUP BY nature",
    )
    .bind(id_dossier)
    .fetch_all(db)
    .await?;

    Ok(Value::Array(
        liste
            .into_iter()
            .map(|(nature, libelle, combien)| {
                let n = deposees
                    .iter()
                    .find(|(d, _)| d == nature)
                    .map(|(_, n)| *n)
                    .unwrap_or(0);
                json!({ "nature": nature, "libelle": libelle, "combien": combien,
                        "deposees": n, "manque": (combien - n).max(0) })
            })
            .collect(),
    ))
}

/// Les pieces d'un dossier, pour l'ecran.
pub async fn lister_du_dossier(db: &crate::db::Db, id_dossier: &str) -> AppResult<Value> {
    let lignes = sqlx::query(
        "SELECT p.id_piece, p.id_facture, p.id_reception, p.nature, p.id_frais, p.libelle,
                p.nom_fichier, p.type_mime, p.taille_octets, p.nb_pages, p.date_depot,
                u.login AS depose_par, f.numero_facture, pf.libelle AS frais_libelle
           FROM piece_jointe p
           LEFT JOIN utilisateur u ON u.id_utilisateur = p.id_utilisateur
           LEFT JOIN import_factures f ON f.id_facture = p.id_facture
           LEFT JOIN parametres_frais pf ON pf.id_frais = p.id_frais
          WHERE p.id_dossier = $1
          ORDER BY p.date_depot",
    )
    .bind(id_dossier)
    .fetch_all(db)
    .await?;
    Ok(lignes_en_json(&lignes))
}
