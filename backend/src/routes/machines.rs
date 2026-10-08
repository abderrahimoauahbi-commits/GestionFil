//! Machines : le stock se compte, la consommation se journalise.
//!
//! LE MODELE, EN QUATRE PHRASES.
//!
//! 1. LE STOCK D'UNE MACHINE SE COMPTE. Il ne se deduit pas d'un grand livre :
//!    l'operateur constate, par reference et par lot, un nombre de bobines et
//!    un pourcentage de fil restant. Le poids en decoule. C'est un inventaire
//!    permanent, pas un solde.
//!
//! 2. LE JOURNAL DES MOUVEMENTS NE PORTE QUE LES DEPLACEMENTS, et seulement du
//!    cote magasin : `CHARGE_MACHINE` quand le fil part, `RETOUR_MACHINE` quand
//!    il revient. Aucune contre-ecriture cote machine — elle n'est pas un
//!    magasin, c'est un compte constate.
//!
//! 3. LA CONSOMMATION EST LE RESIDU, et elle a son propre journal :
//!
//!        consommation = etat precedent + charge - retourne - etat constate
//!
//!    Personne ne la saisit. Elle apparait quand l'operateur declare ou en est
//!    sa zone : c'est pourquoi un chargement REVELE une consommation sans la
//!    causer. Faute de compteur au metier, le constat est la seule mesure.
//!
//! 4. STOCK GLOBAL = soldes magasins + cliches machines. Une palette envoyee
//!    sort du magasin et entre dans le compte de la machine ; le total ne bouge
//!    pas. Seul le fil tisse le fait baisser.
//!
//! UNE FICHE, TROIS ETATS. Brouillon, valide, annule. Tant qu'elle est en
//! brouillon elle ne touche a rien : le magasinier la corrige comme un papier.
//! C'est la validation qui ecrit, en tout ou rien.

use crate::auth::{rbac::module, rbac::Action, Utilisateur};
use crate::db::arrondi_kg;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use super::json::lignes_en_json;
use super::stock::numeroter;
use crate::domain::decision_machine as dm;

// =============================================================================
// LES FORMES RECUES
// =============================================================================

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TypeFiche {
    /// Magasin vers machine. Debite le magasin.
    Charge,
    /// Machine vers magasin. Credite le magasin.
    Decharge,
    /// Constat pur : seul le pourcentage change. Aucun magasin touche.
    Maj,
    /// Casse, chute, perte — ce qui n'est pas du tissage.
    Conso,
}

impl TypeFiche {
    fn code(self) -> &'static str {
        match self {
            TypeFiche::Charge => "CHARGE",
            TypeFiche::Decharge => "DECHARGE",
            TypeFiche::Maj => "MAJ",
            TypeFiche::Conso => "CONSO",
        }
    }
    fn touche_magasin(self) -> bool {
        matches!(self, TypeFiche::Charge | TypeFiche::Decharge)
    }
}

#[derive(Deserialize)]
pub struct LigneFiche {
    pub code_reference: String,
    pub lot_fournisseur: String,
    /// Ce qui monte sur la machine ou en descend. NE SERT QU'A DEBITER OU
    /// CREDITER LE MAGASIN — jamais a faire l'etat.
    #[serde(default)]
    pub nb_bobines_mouvementees: Option<i64>,
    #[serde(default)]
    pub kg_mouvementes: Option<f64>,
    #[serde(default)]
    pub nb_palettes: Option<i64>,
    /// LE NOMBRE PRESENT, sur un CONSTAT seulement (05/10/2026). Un chargement
    /// ou un dechargement ne le porte pas : l'etat resultant est le resultat de
    /// la decision, jamais un second constat.
    #[serde(default)]
    pub nb_bobines_presentes: i64,
    pub poids_unitaire_kg: Option<f64>,
    pub pourcentage: Option<f64>,
    // Le forcage de lot n'existe plus sur une fiche machine (06/10/2026) :
    // un lot que le magasin ne couvre pas bloque. Un champ envoye est ignore.
    #[serde(default)]
    pub total_kg: f64,
    /// Chargement : le poids retenu par bobine chargee (nominal propose).
    /// Constat : le poids par bobine, a la place du %.
    #[serde(default)]
    pub poids_retenu_kg: Option<f64>,
    /// Dechargement : le % des bobines retirees (pas de pesee).
    #[serde(default)]
    pub pct_retirees: Option<f64>,
    /// Dechargement : MAGASIN, PERTE, DECHET ou CASSE.
    #[serde(default)]
    pub destination: Option<String>,
    #[serde(default)]
    pub code_motif: Option<String>,
    #[serde(default)]
    pub motif_texte: Option<String>,
    /// L'effet de l'ecart, quand le motif le laisse au choix.
    #[serde(default)]
    pub effet_ecart: Option<String>,
    #[serde(default = "estimation")]
    pub mode_constat: String,
    pub notes: Option<String>,
}

fn estimation() -> String {
    "ESTIMATION".into()
}

#[derive(Deserialize)]
pub struct NouvelleFiche {
    pub type_fiche: TypeFiche,
    pub code_machine: String,
    pub code_emplacement: String,
    pub date_fiche: Option<String>,
    pub code_magasin: Option<String>,
    pub nb_bobines_etage: Option<i64>,
    pub nb_palettes: Option<i64>,
    pub numero_of: Option<String>,
    pub responsable: String,
    pub observations: Option<String>,
    #[serde(default)]
    pub lignes: Vec<LigneFiche>,
}

#[derive(Deserialize)]
pub struct Filtre {
    pub code_machine: Option<String>,
    /// Un seul etage : ses fiches, pas celles de toute la machine.
    pub code_emplacement: Option<String>,
    pub statut: Option<String>,
    /// Les bornes de periode. Absentes, le cumul court depuis l'origine
    /// jusqu'a l'etat courant.
    pub debut: Option<String>,
    pub fin: Option<String>,
    pub limite: Option<i64>,
}

#[derive(Deserialize)]
pub struct Annulation {
    pub motif: String,
}

// =============================================================================
// LA CONSULTATION
// =============================================================================

/// `GET /api/machines` — la liste, avec ce que chaque machine porte.
///
/// Le poids vient de `machine_etat`, le compte constate — pas d'un solde de
/// mouvements. C'est toute la difference du modele.
pub async fn lister(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT m.code_machine, m.nom, m.capacite_bobines, m.nb_etages, m.code_atelier,
                m.notes, m.actif, m.etat, m.motif_etat, m.date_etat,
                COALESCE(SUM(e.nb_bobines), 0)::bigint     AS bobines_presentes,
                COALESCE(SUM(e.kg), 0)::float8             AS quantite_kg,
                COUNT(DISTINCT z.code_emplacement)::bigint AS nb_zones,
                MAX(e.date_constat)                        AS dernier_constat
           FROM machine m
           LEFT JOIN machine_emplacement z ON z.code_machine = m.code_machine
           LEFT JOIN machine_etat e ON e.code_emplacement = z.code_emplacement
          GROUP BY m.code_machine, m.nom, m.capacite_bobines, m.nb_etages,
                   m.code_atelier, m.notes, m.actif, m.etat, m.motif_etat, m.date_etat
          ORDER BY m.nom",
    )
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/machines/{code}` — le plan : les zones et ce qu'elles portent.
pub async fn plan(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT z.code_emplacement, z.code_machine, z.role, z.numero_etage, z.libelle,
                z.capacite_bobines, z.actif,
                COALESCE(SUM(e.nb_bobines), 0)::bigint AS bobines_presentes,
                COALESCE(SUM(e.kg), 0)::float8         AS quantite_kg,
                COUNT(e.code_reference)::bigint        AS nb_lots,
                MAX(e.date_constat)                    AS dernier_constat
           FROM machine_emplacement z
           LEFT JOIN machine_etat e ON e.code_emplacement = z.code_emplacement
          WHERE z.code_machine = $1
          GROUP BY z.code_emplacement, z.code_machine, z.role, z.numero_etage,
                   z.libelle, z.capacite_bobines, z.actif
          ORDER BY CASE z.role WHEN 'ETAGE' THEN 0 WHEN 'CHAINE' THEN 1
                               WHEN 'TRAME' THEN 2 ELSE 3 END,
                   z.numero_etage DESC",
    )
    .bind(&code)
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/machines/{code}/zones/{zone}` — le constat courant d'une zone.
///
/// C'est ce que la fiche de mise a jour pre-remplit : l'operateur n'y touche
/// que les pourcentages.
pub async fn etat_zone(
    State(state): State<AppState>,
    user: Utilisateur,
    Path((code, zone)): Path<(String, String)>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT e.code_reference, r.designation, e.lot_fournisseur,
                e.nb_bobines, e.nb_palettes,
                e.poids_unitaire_kg::float8 AS poids_unitaire_kg,
                e.pourcentage::float8       AS pourcentage,
                e.kg::float8                AS kg,
                e.mode_constat, e.date_constat, e.responsable,
                r.poids_bobine_kg::float8   AS poids_catalogue_kg
           FROM machine_etat e
           JOIN machine_emplacement z ON z.code_emplacement = e.code_emplacement
           JOIN reference r ON r.code_reference = e.code_reference
          WHERE z.code_machine = $1 AND e.code_emplacement = $2
          ORDER BY r.designation, e.lot_fournisseur",
    )
    .bind(&code)
    .bind(&zone)
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/machines/{code}/contenu` — TOUT ce que porte la machine.
///
/// POURQUOI CETTE ROUTE MANQUAIT, ET CE QUE CELA COUTAIT. On ne savait lire le
/// contenu que ZONE PAR ZONE. Choisir une machine n'affichait donc que la
/// liste de ses etages — des nombres, aucune matiere — et il fallait cliquer
/// chaque etage l'un apres l'autre pour savoir ce qui etait monte dessus. Sur
/// un metier a huit etages, huit clics pour repondre a « qu'y a-t-il sur cette
/// machine ». C'est la premiere question qu'on pose devant un metier charge,
/// et l'ecran ne savait pas y repondre.
///
/// La zone voyage AVEC chaque ligne : sans elle, on saurait ce que la machine
/// porte sans savoir ou, ce qui ne sert a rien pour aller le chercher.
pub async fn contenu_machine(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT z.code_emplacement, z.libelle AS zone_libelle, z.role,
                z.numero_etage, z.capacite_bobines,
                e.code_reference, r.designation, e.lot_fournisseur,
                e.nb_bobines, e.nb_palettes,
                e.poids_unitaire_kg::float8 AS poids_unitaire_kg,
                e.pourcentage::float8       AS pourcentage,
                e.kg::float8                AS kg,
                e.mode_constat, e.date_constat, e.responsable,
                r.poids_bobine_kg::float8   AS poids_catalogue_kg,
                c.libelle                   AS couleur
           FROM machine_emplacement z
           LEFT JOIN machine_etat e ON e.code_emplacement = z.code_emplacement
           LEFT JOIN reference r ON r.code_reference = e.code_reference
           LEFT JOIN couleur c ON c.code_couleur_interne = r.code_couleur_interne
          WHERE z.code_machine = $1
          -- LES ZONES VIDES RESTENT DANS LA LISTE. Un etage sans fil est une
          -- information : c'est la qu'il faut charger. Le filtrer donnerait un
          -- metier qui parait plein alors qu'il ne l'est pas.
          ORDER BY z.role, z.numero_etage, r.designation, e.lot_fournisseur",
    )
    .bind(&code)
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/machines/consommation` — le cumul, jamais une repartition.
///
///     consommation = tout ce qui a ete charge - ce qui est revenu - l'etat actuel
///
/// Personne ne sait quel chargement a ete tisse quand : repartir la
/// consommation fiche par fiche serait une invention. Le cumul, lui, se
/// verifie a la main.
pub async fn journal_consommation(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<Filtre>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    // LE CLICHE EST LE POINT DE REFERENCE. Sans lui, on ne saurait pas ou en
    // etait la zone au premier jour de la periode, et l'ecart d'un mois serait
    // indiscernable de celui de trois jours.
    let lignes = sqlx::query(
        "SELECT * FROM f_machine_consommation($1, $2, $3)
          ORDER BY machine_nom, zone, designation, lot_fournisseur
          LIMIT $4",
    )
    .bind(&f.code_machine)
    .bind(&f.debut)
    .bind(&f.fin)
    .bind(f.limite.unwrap_or(500).clamp(1, 5000))
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

// =============================================================================
// LES FICHES
// =============================================================================

/// `GET /api/machines/fiches` — la liste, brouillons en tete.
pub async fn lister_fiches(
    State(state): State<AppState>,
    user: Utilisateur,
    Query(f): Query<Filtre>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT f.id_fiche, f.numero_fiche, f.type_fiche, f.statut, f.code_machine,
                m.nom AS machine_nom, f.code_emplacement, z.libelle AS zone,
                f.date_fiche, f.date_constat_precedent, f.code_magasin,
                f.nb_bobines_etage, f.numero_of, f.responsable, f.observations,
                f.date_creation, f.date_validation, f.motif_annulation,
                (SELECT COUNT(*) FROM machine_fiche_ligne l WHERE l.id_fiche = f.id_fiche)
                    ::bigint AS nb_lignes,
                -- LA DERNIERE DECISION DE SON ETAGE : la seule qui se devalide
                -- ou s'annule seule. Les autres se reparent par un constat.
                (CASE WHEN EXISTS (SELECT 1 FROM machine_decision d
                                    WHERE d.id_fiche = f.id_fiche AND d.est_tete = 1)
                      THEN 1 ELSE 0 END)::bigint AS est_tete,
                (SELECT u.nom FROM machine_decision d
                   LEFT JOIN utilisateur u ON u.id_utilisateur = d.id_utilisateur
                  WHERE d.id_fiche = f.id_fiche
                  ORDER BY d.numero_validation DESC LIMIT 1) AS valide_par
           FROM machine_fiche f
           JOIN machine m ON m.code_machine = f.code_machine
           JOIN machine_emplacement z ON z.code_emplacement = f.code_emplacement
          WHERE ($1::text IS NULL OR f.code_machine = $1)
            AND ($2::text IS NULL OR f.statut = $2)
            AND ($4::text IS NULL OR f.code_emplacement = $4)
          ORDER BY CASE f.statut WHEN 'BROUILLON' THEN 0 ELSE 1 END,
                   f.date_fiche DESC, f.date_creation DESC
          LIMIT $3",
    )
    .bind(&f.code_machine)
    .bind(&f.statut)
    .bind(f.limite.unwrap_or(200).clamp(1, 2000))
    .bind(&f.code_emplacement)
    .fetch_all(&state.db)
    .await?;
    let mut v = lignes_en_json(&lignes);
    user.masquer(&state.db, module::STOCK, &mut v).await?;
    Ok(Json(v))
}

/// `GET /api/machines/fiches/{id}` — l'entete et ses lignes.
pub async fn lire_fiche(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;

    let entete = sqlx::query(
        "SELECT f.*, m.nom AS machine_nom, z.libelle AS zone, z.capacite_bobines
           FROM machine_fiche f
           JOIN machine m ON m.code_machine = f.code_machine
           JOIN machine_emplacement z ON z.code_emplacement = f.code_emplacement
          WHERE f.id_fiche = $1",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;
    if entete.is_empty() {
        return Err(AppError::Introuvable(format!("fiche {id}")));
    }

    let lignes = sqlx::query(
        "SELECT l.*, r.designation, r.poids_bobine_kg::float8 AS poids_catalogue_kg
           FROM machine_fiche_ligne l
           JOIN reference r ON r.code_reference = l.code_reference
          WHERE l.id_fiche = $1
          ORDER BY l.ligne_numero",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    // L'HISTORIQUE DE LA FICHE (05/10/2026) : chaque decision, l'etat de
    // l'etage avant et apres la derniere, ses lignes calculees, et le journal.
    let decisions = sqlx::query(
        "SELECT d.id_decision, d.numero_validation, d.nature, d.statut, d.est_tete,
                d.date_decision, d.code_emplacement, u.nom AS auteur,
                d.date_retrait, d.motif_retrait, ur.nom AS auteur_retrait
           FROM machine_decision d
           LEFT JOIN utilisateur u  ON u.id_utilisateur  = d.id_utilisateur
           LEFT JOIN utilisateur ur ON ur.id_utilisateur = d.id_utilisateur_retrait
          WHERE d.id_fiche = $1
          ORDER BY d.numero_validation",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;
    let derniere: Option<String> = sqlx::query_scalar(
        "SELECT id_decision FROM machine_decision WHERE id_fiche = $1
          ORDER BY numero_validation DESC LIMIT 1",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?;
    let etats = sqlx::query(
        "SELECT s.moment, s.code_reference, r.designation, s.lot_fournisseur, s.nb_bobines,
                s.pourcentage::float8 AS pourcentage, s.kg::float8 AS kg
           FROM machine_decision_etat s JOIN reference r ON r.code_reference = s.code_reference
          WHERE s.id_decision = $1
          ORDER BY s.moment DESC, r.designation, s.lot_fournisseur",
    )
    .bind(&derniere)
    .fetch_all(&state.db)
    .await?;
    let calculees = sqlx::query(
        "SELECT l.ligne_numero, l.code_reference, r.designation, l.lot_fournisseur,
                l.nb_avant, l.kg_avant::float8 AS kg_avant, l.nb_mouvementees,
                l.poids_retenu_kg::float8 AS poids_retenu_kg, l.pct_retirees::float8 AS pct_retirees,
                l.kg_mouvementes::float8 AS kg_mouvementes, l.destination, l.nb_apres,
                l.pourcentage_apres::float8 AS pourcentage_apres,
                l.pourcentage_theorique::float8 AS pourcentage_theorique, l.kg_apres::float8 AS kg_apres,
                l.ecart_kg::float8 AS ecart_kg, l.effet_ecart, m.libelle AS motif, l.motif_texte
           FROM machine_decision_ligne l
           JOIN reference r     ON r.code_reference = l.code_reference
           JOIN machine_motif m ON m.code_motif = l.code_motif
          WHERE l.id_decision = $1
          ORDER BY l.ligne_numero",
    )
    .bind(&derniere)
    .fetch_all(&state.db)
    .await?;
    let journal = sqlx::query(
        "SELECT j.evenement, j.horodatage, j.code_emplacement, j.motif, u.nom AS auteur,
                j.detail::text AS detail
           FROM machine_fiche_journal j
           LEFT JOIN utilisateur u ON u.id_utilisateur = j.id_utilisateur
          WHERE j.id_fiche = $1
          ORDER BY j.horodatage",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let mut e = lignes_en_json(&entete);
    let mut l = lignes_en_json(&lignes);
    let mut c = lignes_en_json(&calculees);
    let mut s = lignes_en_json(&etats);
    user.masquer(&state.db, module::STOCK, &mut e).await?;
    user.masquer(&state.db, module::STOCK, &mut l).await?;
    user.masquer(&state.db, module::STOCK, &mut c).await?;
    user.masquer(&state.db, module::STOCK, &mut s).await?;
    Ok(Json(json!({
        "entete": e.get(0).cloned().unwrap_or(Value::Null),
        "lignes": l,
        "decisions": lignes_en_json(&decisions),
        "lignes_decision": c,
        "etats": s,
        "journal": lignes_en_json(&journal),
    })))
}

/// `POST /api/machines/fiches` — un brouillon, entete et lignes d'un coup.
///
/// LE BROUILLON NE TOUCHE A RIEN. Un magasinier saisit six lignes, se trompe
/// sur l'une, la reprend : si chaque frappe touchait le stock, il faudrait
/// annuler pour une faute de doigt, et le grand livre porterait la trace de
/// chaque hesitation.
pub async fn creer_fiche(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(f): Json<NouvelleFiche>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    verifier_entete(&f)?;
    refuser_conso(f.type_fiche.code())?;

    let zone = resoudre_zone(&state.db, &f.code_machine, &f.code_emplacement).await?;
    let precedent = dernier_constat(&state.db, &f.code_emplacement).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let numero = numeroter(&mut tx, "machine_fiche", "numero_fiche", "MCH").await?;
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO machine_fiche
             (id_fiche, numero_fiche, type_fiche, statut, code_machine, code_emplacement,
              date_fiche, date_constat_precedent, code_magasin, nb_bobines_etage,
              nb_palettes, numero_of, responsable, observations, id_utilisateur)
         VALUES ($1,$2,$3,'BROUILLON',$4,$5,
                 COALESCE($6, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')),
                 $7,$8,$9,$10,$11,$12,$13,$14)",
    )
    .bind(&id)
    .bind(&numero)
    .bind(f.type_fiche.code())
    .bind(&f.code_machine)
    .bind(&f.code_emplacement)
    .bind(&f.date_fiche)
    .bind(&precedent)
    .bind(&f.code_magasin)
    .bind(f.nb_bobines_etage.or(Some(zone.capacite)))
    .bind(f.nb_palettes)
    .bind(&f.numero_of)
    .bind(f.responsable.trim())
    .bind(&f.observations)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    ecrire_lignes(&mut tx, &id, &f.lignes).await?;
    tx.commit().await?;

    Ok(Json(json!({
        "id_fiche": id, "numero_fiche": numero, "statut": "BROUILLON",
    })))
}

/// `PUT /api/machines/fiches/{id}` — remplace le brouillon en entier.
pub async fn remplacer_fiche(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(f): Json<NouvelleFiche>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    verifier_entete(&f)?;
    refuser_conso(f.type_fiche.code())?;
    resoudre_zone(&state.db, &f.code_machine, &f.code_emplacement).await?;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    verrouiller_fiche(&mut tx, &id, &["BROUILLON"]).await?;

    // UNE FICHE DEVALIDEE PEUT CHANGER D'ETAGE (05/10/2026) : c'est le cas de
    // l'erreur d'emplacement. Le journal garde l'etage d'origine.
    let (ancien, nb_validations): (String, i64) = sqlx::query_as(
        "SELECT code_emplacement, nb_validations FROM machine_fiche WHERE id_fiche = $1",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    if ancien != f.code_emplacement && nb_validations > 0 {
        dm::journal_changement_etage(&mut tx, &user, &id, &ancien, &f.code_emplacement).await?;
    }

    sqlx::query(
        "UPDATE machine_fiche
            SET date_fiche = COALESCE($2, date_fiche), code_magasin = $3,
                nb_bobines_etage = $4, nb_palettes = $5, numero_of = $6,
                responsable = $7, observations = $8,
                code_machine = $9, code_emplacement = $10
          WHERE id_fiche = $1",
    )
    .bind(&id)
    .bind(&f.date_fiche)
    .bind(&f.code_magasin)
    .bind(f.nb_bobines_etage)
    .bind(f.nb_palettes)
    .bind(&f.numero_of)
    .bind(f.responsable.trim())
    .bind(&f.observations)
    .bind(&f.code_machine)
    .bind(&f.code_emplacement)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM machine_fiche_ligne WHERE id_fiche = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    ecrire_lignes(&mut tx, &id, &f.lignes).await?;
    tx.commit().await?;

    Ok(Json(json!({ "id_fiche": id, "statut": "BROUILLON" })))
}

/// `DELETE /api/machines/fiches/{id}` — jette un brouillon.
pub async fn supprimer_fiche(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    verrouiller_fiche(&mut tx, &id, &["BROUILLON"]).await?;
    let validee: i64 =
        sqlx::query_scalar("SELECT nb_validations FROM machine_fiche WHERE id_fiche = $1")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
    if validee > 0 {
        return Err(AppError::RegleMetier(
            "cette fiche a deja ete validee puis devalidee : son historique la retient. \
             Annulez-la plutot que de la supprimer."
                .into(),
        ));
    }
    sqlx::query("DELETE FROM machine_fiche WHERE id_fiche = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({ "supprime": id })))
}

// =============================================================================
// LA DECISION — le seul endroit qui ecrit (modele valide le 05/10/2026)
// =============================================================================
//
// Le calcul et l'ecriture vivent dans `domain::decision_machine`. Ici : les
// droits, les verrous (fiche puis etage, sans attente), et la transaction.

/// La fiche lue dans la transaction, ses lignes saisies, la capacite et le
/// libelle de son etage.
async fn charger_decision(
    tx: &mut sqlx::PgConnection,
    id: &str,
) -> AppResult<(dm::FicheDecision, Vec<dm::Saisie>, i64, String)> {
    type Entete =
        (String, String, String, String, Option<String>, String, Option<String>, String, i64, i64, String);
    let e: Entete = sqlx::query_as(
        "SELECT f.numero_fiche, f.type_fiche, f.code_machine, f.code_emplacement, f.code_magasin,
                f.date_fiche, f.numero_of, f.responsable, f.nb_validations, z.capacite_bobines, z.libelle
           FROM machine_fiche f
           JOIN machine_emplacement z ON z.code_emplacement = f.code_emplacement
          WHERE f.id_fiche = $1",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Introuvable(format!("fiche {id}")))?;
    type LigneLue = (
        String, String, Option<i64>, Option<f64>, Option<f64>, Option<String>, Option<f64>, i64,
        Option<String>, Option<String>, Option<String>,
    );
    let lignes: Vec<LigneLue> = sqlx::query_as(
        "SELECT code_reference, lot_fournisseur, nb_bobines_mouvementees, poids_retenu_kg::float8,
                pct_retirees::float8, destination, pourcentage::float8, nb_bobines_presentes,
                code_motif, motif_texte, effet_ecart
           FROM machine_fiche_ligne WHERE id_fiche = $1 ORDER BY ligne_numero",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
    let saisies = lignes
        .into_iter()
        .map(|t| dm::Saisie {
            reference: t.0,
            lot: t.1,
            nb_mouvementees: t.2.unwrap_or(0),
            poids_retenu: t.3,
            pct_retirees: t.4,
            destination: t.5,
            pourcentage: t.6,
            nb_present: t.7,
            code_motif: t.8,
            motif_texte: t.9,
            effet_ecart: t.10,
        })
        .collect();
    let f = dm::FicheDecision {
        id_fiche: id.to_string(),
        numero: e.0,
        type_fiche: e.1,
        code_machine: e.2,
        code_emplacement: e.3,
        code_magasin: e.4,
        date_fiche: e.5,
        numero_of: e.6,
        responsable: e.7,
        nb_validations: e.8,
    };
    Ok((f, saisies, e.9, e.10))
}

fn refuser_conso(type_fiche: &str) -> AppResult<()> {
    if type_fiche == "CONSO" {
        return Err(AppError::RegleMetier(
            "la fiche « Consommation » est retiree (05/10/2026) : une perte, un dechet ou une \
             casse se declare par un dechargement, un ecart par un constat"
                .into(),
        ));
    }
    Ok(())
}

/// `POST /api/machines/fiches/{id}/apercu` — ce que la validation enregistrera,
/// ligne par ligne, SANS RIEN ECRIRE : % theorique, % declare, ecart et ce
/// qu'il compte, et ce qui bloquerait.
pub async fn apercu_fiche(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    let (f, saisies, capacite, _) = charger_decision(&mut tx, &id).await?;
    refuser_conso(&f.type_fiche)?;
    let privilegie = matches!(user.role.as_str(), "ADMIN" | "DIRECTION");
    let autorise_rouge = dm::peut_valider_ecart_rouge(&mut tx, &user.role).await?;
    let calc = dm::calculer(&mut tx, &f, &saisies, capacite, privilegie, autorise_rouge).await?;
    let mut blocages = calc.blocages.clone();
    if calc.blocages.is_empty() {
        blocages.extend(dm::controles_complementaires(&mut tx, &f, &calc).await?);
    }
    if f.type_fiche == "CHARGE" {
        if let Some(magasin) = f.code_magasin.as_deref().filter(|m| !m.is_empty()) {
            let manques = dm::controler_stock(&mut tx, magasin, &calc).await?;
            if !manques.is_empty() {
                blocages.push(format!(
                    "STOCK-INSUFFISANT : chargement bloque — {}.",
                    manques.join(" ; ")
                ));
            }
        }
    }
    let derogations = dm::derogations_possibles(&mut tx, &f, &calc).await?;
    tx.rollback().await?;
    Ok(Json(json!({
        "lignes": calc.lignes,
        "avant": calc.avant,
        "apres": calc.apres,
        "capacite": calc.capacite,
        "bobines_apres": calc.bobines_apres,
        "blocages": blocages,
        "derogations": derogations,
    })))
}

/// `POST /api/machines/fiches/{id}/valider` — la decision est prise.
pub async fn valider_fiche(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    corps: axum::body::Bytes,
) -> AppResult<Json<Value>> {
    let confirme_orange = serde_json::from_slice::<Value>(&corps)
        .ok()
        .and_then(|v| v.get("confirme_orange").and_then(Value::as_bool))
        .unwrap_or(false);
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    // LE PREMIER QUI VALIDE L'EMPORTE : la fiche, puis l'etage, sans attente.
    verrouiller_fiche(&mut tx, &id, &["BROUILLON"]).await?;
    let (f, saisies, capacite, libelle) = charger_decision(&mut tx, &id).await?;
    refuser_conso(&f.type_fiche)?;
    // VALIDER UN CHARGEMENT OU UN DECHARGEMENT DEMANDE LE DROIT « VALIDER »
    // (06/10/2026) : il fait bouger le magasin, comme une contre-passation. Un
    // constat, qui ne touche que l'etage, reste au droit d'ecrire.
    if f.type_fiche != "MAJ" {
        user.exiger(&state.db, module::MOUVEMENTS, Action::Valider).await?;
    }
    if f.type_fiche != "MAJ" && f.code_magasin.as_deref().unwrap_or("").is_empty() {
        return Err(AppError::Invalide(
            "le magasin est requis pour un chargement ou un dechargement".into(),
        ));
    }
    verrouiller_zone(&mut tx, &f.code_emplacement, &libelle).await?;
    let r = dm::valider(&mut tx, &user, &f, &saisies, capacite, confirme_orange).await?;
    tx.commit().await?;
    Ok(Json(r))
}

/// Annuler ou devalider : le retour controle a l'etat precedent.
async fn retirer_fiche(
    state: &AppState,
    user: &Utilisateur,
    id: &str,
    mode: dm::Retrait,
    motif: &str,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Ecrire).await?;
    if motif.trim().chars().count() < 5 {
        return Err(AppError::Invalide(
            "le motif doit dire pourquoi (5 caracteres au moins) : sans lui, on efface une \
             erreur sans l'expliquer"
                .into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    let attendus: &[&str] =
        if mode == dm::Retrait::Annulation { &["BROUILLON", "VALIDE"] } else { &["VALIDE"] };
    let statut = verrouiller_fiche(&mut tx, id, attendus).await?;
    let (f, _, _, libelle) = charger_decision(&mut tx, id).await?;
    // RETIRER UNE DECISION DEMANDE « VALIDER » (06/10/2026) : ses mouvements
    // recoivent une annulation. Clore un brouillon reste au droit d'ecrire.
    if statut == "VALIDE" {
        user.exiger(&state.db, module::MOUVEMENTS, Action::Valider).await?;
    }

    // UN BROUILLON N'A RIEN DECIDE : il se clot, sans retour d'etat.
    if statut == "BROUILLON" {
        sqlx::query(
            "UPDATE machine_fiche
                SET statut = 'ANNULE', motif_annulation = $2,
                    date_annulation = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
              WHERE id_fiche = $1 AND statut = 'BROUILLON'",
        )
        .bind(id)
        .bind(motif.trim())
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO machine_fiche_journal (id_fiche, evenement, code_emplacement, motif, id_utilisateur)
             VALUES ($1, 'ANNULATION', $2, $3, $4)",
        )
        .bind(id)
        .bind(&f.code_emplacement)
        .bind(motif.trim())
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(Json(json!({ "id_fiche": id, "statut": "ANNULE" })));
    }

    verrouiller_zone(&mut tx, &f.code_emplacement, &libelle).await?;
    let r = dm::retirer(&mut tx, user, &f, mode, motif).await?;
    tx.commit().await?;
    Ok(Json(r))
}

/// `POST /api/machines/fiches/{id}/annuler` — la fiche est close, l'etage
/// revient a l'etat valide qui precedait sa decision.
pub async fn annuler_fiche(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(a): Json<Annulation>,
) -> AppResult<Json<Value>> {
    retirer_fiche(&state, &user, &id, dm::Retrait::Annulation, &a.motif).await
}

/// `POST /api/machines/fiches/{id}/devalider` — meme retour d'etat, mais la
/// fiche revient en BROUILLON : on la corrige (son etage aussi) et on revalide.
pub async fn devalider_fiche(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(id): Path<String>,
    Json(a): Json<Annulation>,
) -> AppResult<Json<Value>> {
    retirer_fiche(&state, &user, &id, dm::Retrait::Devalidation, &a.motif).await
}

/// `GET /api/machines/motifs` — la matrice des motifs (05/10/2026).
pub async fn lister_motifs(State(state): State<AppState>, user: Utilisateur) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::STOCK, Action::Lire).await?;
    let lignes = sqlx::query(
        "SELECT code_motif, type_fiche, libelle, array_to_string(destinations, ',') AS destinations,
                effet_defaut, array_to_string(effets_permis, ',') AS effets_permis, ordre
           FROM machine_motif WHERE actif = 1 ORDER BY type_fiche, ordre",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lignes_en_json(&lignes)))
}

// =============================================================================
// LES ROUAGES
// =============================================================================

struct Zone {
    capacite: i64,
}

fn verifier_entete(f: &NouvelleFiche) -> AppResult<()> {
    if f.responsable.trim().is_empty() {
        return Err(AppError::Invalide("le responsable est requis".into()));
    }
    if f.type_fiche.touche_magasin() && f.code_magasin.as_deref().unwrap_or("").is_empty() {
        return Err(AppError::Invalide(
            "le magasin d origine ou de retour est requis".into(),
        ));
    }
    Ok(())
}

async fn resoudre_zone(db: &crate::db::Db, machine: &str, zone: &str) -> AppResult<Zone> {
    // UNE MACHINE RETIREE NE SE CHARGE PLUS (audit v4) : sa zone restait
    // ouverte aux fiches.
    let etat: Option<String> = sqlx::query_scalar("SELECT etat FROM machine WHERE code_machine = $1")
        .bind(machine)
        .fetch_optional(db)
        .await?;
    if etat.as_deref() == Some("RETIREE") {
        return Err(AppError::RegleMetier(format!(
            "la machine {machine} est retiree du parc : elle ne porte plus de fiche. Remettez-la en service d'abord"
        )));
    }
    sqlx::query_as::<_, (String, i64)>(
        "SELECT libelle, capacite_bobines FROM machine_emplacement
          WHERE code_machine = $1 AND code_emplacement = $2 AND actif = 1",
    )
    .bind(machine)
    .bind(zone)
    .fetch_optional(db)
    .await?
    .map(|(_, capacite)| Zone { capacite })
    .ok_or_else(|| AppError::Introuvable(format!("la machine {machine} n a pas de zone {zone}")))
}

async fn dernier_constat(db: &crate::db::Db, zone: &str) -> AppResult<Option<String>> {
    Ok(sqlx::query_scalar::<_, Option<String>>(
        "SELECT MAX(date_constat) FROM machine_etat WHERE code_emplacement = $1",
    )
    .bind(zone)
    .fetch_one(db)
    .await?)
}

/// LE PREMIER QUI AGIT L'EMPORTE (03/10/2026).
///
/// Deux postes peuvent viser la meme fiche au meme instant : deux annulations
/// lancees depuis la liste, ou un double clic qui part avant que le bouton ne
/// se grise. Lire le statut AVANT la transaction les laissait passer toutes les
/// deux, et le magasin etait debite — ou recredite — deux fois. La ligne de la
/// fiche est donc verrouillee DANS la transaction.
///
/// LE SECOND N'ATTEND PAS (`NOWAIT`) : il est refuse sur-le-champ, avec un
/// message qui dit que la fiche est en cours de modification ailleurs. S'il
/// revient une fois le premier termine, il lit le statut a jour et apprend ce
/// qui s'est passe et qui l'a fait.
///
/// Renvoie le statut lu sous verrou s'il fait partie de ceux qu'on attend.
async fn verrouiller_fiche(
    tx: &mut sqlx::PgConnection,
    id: &str,
    attendus: &[&str],
) -> AppResult<String> {
    let ligne: Option<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT f.statut, f.numero_fiche, u.nom
           FROM machine_fiche f
           LEFT JOIN utilisateur u ON u.id_utilisateur = f.id_utilisateur_validation
          WHERE f.id_fiche = $1
            FOR UPDATE OF f NOWAIT",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| {
        occupe(
            e,
            "cette fiche est en cours de modification sur un autre poste : \
             on ne peut pas la toucher pour l'instant, reessayez dans un moment",
        )
    })?;
    let (statut, numero, valideur) =
        ligne.ok_or_else(|| AppError::Introuvable(format!("fiche {id}")))?;
    if attendus.contains(&statut.as_str()) {
        return Ok(statut);
    }
    let etat = match statut.as_str() {
        "VALIDE" => "validee",
        "ANNULE" => "annulee",
        autre => return Err(AppError::RegleMetier(format!(
            "la fiche {numero} est {} : cette action ne s'y applique pas",
            autre.to_lowercase()
        ))),
    };
    let par = match (statut.as_str(), valideur) {
        ("VALIDE", Some(nom)) => format!(" par {nom}"),
        _ => String::new(),
    };
    Err(AppError::RegleMetier(format!(
        "la fiche {numero} est deja {etat}{par} : rechargez la liste pour voir son etat a jour"
    )))
}

/// La zone sous verrou : une seule fiche a la fois la modifie. Toujours prise
/// APRES la fiche, dans cet ordre. Meme regle que pour la fiche : celui qui
/// arrive second est refuse sur-le-champ, sans attendre.
async fn verrouiller_zone(
    tx: &mut sqlx::PgConnection,
    zone: &str,
    libelle: &str,
) -> AppResult<()> {
    sqlx::query("SELECT 1 FROM machine_emplacement WHERE code_emplacement = $1 FOR UPDATE NOWAIT")
        .bind(zone)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            occupe(
                e,
                &format!(
                    "{libelle} est en cours de modification par une autre fiche : \
                     on ne peut pas y toucher pour l'instant, reessayez dans un moment"
                ),
            )
        })?;
    Ok(())
}

/// `55P03` : le verrou est pris par une autre transaction et `NOWAIT` a
/// refuse d'attendre. C'est un message pour l'utilisateur, pas une panne.
fn occupe(e: sqlx::Error, message: &str) -> AppError {
    if let sqlx::Error::Database(d) = &e {
        if d.code().as_deref() == Some("55P03") {
            return AppError::RegleMetier(message.to_string());
        }
    }
    e.into()
}

async fn ecrire_lignes(
    tx: &mut sqlx::PgConnection,
    id: &str,
    lignes: &[LigneFiche],
) -> AppResult<()> {
    for (i, l) in lignes.iter().enumerate() {
        if l.lot_fournisseur.trim().is_empty() {
            return Err(AppError::Invalide(format!(
                "le lot est requis pour {} : sans lui le stock ne se suit plus",
                l.code_reference
            )));
        }
        sqlx::query(
            "INSERT INTO machine_fiche_ligne
                 (id_fiche, ligne_numero, code_reference, lot_fournisseur,
                  nb_bobines_mouvementees, kg_mouvementes, nb_palettes,
                  nb_bobines_presentes, poids_unitaire_kg, pourcentage, total_kg,
                  mode_constat, notes, lot_force, motif_lot_force,
                  poids_retenu_kg, pct_retirees, destination, code_motif, motif_texte, effet_ecart)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)",
        )
        .bind(id)
        .bind(i as i64 + 1)
        .bind(&l.code_reference)
        .bind(l.lot_fournisseur.trim())
        .bind(l.nb_bobines_mouvementees)
        .bind(l.kg_mouvementes)
        .bind(l.nb_palettes)
        .bind(l.nb_bobines_presentes)
        .bind(l.poids_unitaire_kg)
        .bind(l.pourcentage)
        .bind(arrondi_kg(l.total_kg))
        .bind(&l.mode_constat)
        .bind(&l.notes)
        // LA CONFIRMATION SE GARDE AVEC LA LIGNE. La fiche se valide parfois
        // des heures plus tard, et par quelqu'un d'autre : une confirmation
        // qui n'aurait vecu que dans l'appel de creation serait perdue, et le
        // chargement se ferait refuser au dernier moment.
        // Le forcage de lot n'existe plus sur une fiche machine (06/10/2026).
        .bind(0_i32)
        .bind(None::<&str>)
        .bind(l.poids_retenu_kg.filter(|p| *p > 0.0))
        .bind(l.pct_retirees)
        .bind(l.destination.as_deref().filter(|d| !d.is_empty()))
        .bind(l.code_motif.as_deref().filter(|m| !m.is_empty()))
        .bind(l.motif_texte.as_deref().map(str::trim).filter(|m| !m.is_empty()))
        .bind(l.effet_ecart.as_deref().filter(|e| !e.is_empty()))
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}


// =============================================================================
// DECLARER ET CORRIGER UNE MACHINE
// -----------------------------------------------------------------------------
// LA MACHINE SE DECRIT PAR SES ZONES, ET RIEN D'AUTRE. La version precedente
// demandait un nombre d'etages, une capacite par etage identique partout, et une
// capacite totale saisie a la main — trois chiffres qui pouvaient se contredire,
// et qui se contredisaient. Ici l'atelier decrit ce qu'il voit, zone par zone :
// six etages de 1344 bobines, six bobines de trame, un fil de chaine, une
// reserve. Le total se calcule, il ne se saisit pas.
//
// CE QUI CHANGE POUR L'ATELIER :
//   - les etages n'ont plus la meme capacite les uns que les autres ;
//   - la chaine et la trame varient d'une machine a l'autre, ce qui est le cas ;
//   - une machine peut n'avoir AUCUN etage — le metier qui ne file que chaine et
//     trame se declare comme les autres.
//
// LES ZONES NE SONT PLUS DES MAGASINS. L'ancienne creation posait un magasin par
// zone : c'est ce qui donnait dix-sept magasins pour deux magasins reels, et le
// magasinier les voyait tous dans sa liste. Une zone est une position sur un
// metier, pas un lieu de stockage.
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct ZoneSaisie {
    /// ETAGE, CHAINE, TRAME ou RESERVE.
    pub role: String,
    /// Requis et strictement positif pour un etage ; ignore sinon.
    pub numero_etage: Option<i64>,
    pub capacite_bobines: i64,
}

#[derive(Debug, Deserialize)]
pub struct MachineSaisie {
    /// Ignore en modification : le code d'une machine ne change pas.
    pub code_machine: Option<String>,
    pub nom: String,
    pub code_atelier: Option<String>,
    pub notes: Option<String>,
    pub zones: Vec<ZoneSaisie>,
}

/// Une zone validee, prete a etre ecrite.
struct ZonePrete {
    code: String,
    role: String,
    numero: i64,
    capacite: i64,
}

// PAS DE LIBELLE ICI. `machine_emplacement.libelle` est une colonne GENERATED :
// la base la compose depuis le role et le numero — « Etage 1 », « Chaine »,
// « Trame », « Reserve ». Lui en fournir un fait echouer l'insertion.

/// Verifie la saisie et compose les zones. Commun a la creation et a la reprise.
fn preparer(code_machine: &str, m: &MachineSaisie) -> AppResult<Vec<ZonePrete>> {
    if m.nom.trim().is_empty() {
        return Err(AppError::Invalide("le nom de la machine est requis".into()));
    }
    if m.zones.is_empty() {
        return Err(AppError::Invalide(
            "une machine porte au moins une zone : un etage, un fil de chaine, \
             une trame ou une reserve"
                .into(),
        ));
    }

    let mut pretes: Vec<ZonePrete> = Vec::new();
    let mut etages: Vec<i64> = Vec::new();
    let mut uniques: Vec<String> = Vec::new();

    for z in &m.zones {
        let role = z.role.trim().to_uppercase();
        if z.capacite_bobines <= 0 {
            return Err(AppError::Invalide(format!(
                "la zone {role} doit porter au moins une bobine : \
                 une zone vide ne se declare pas, elle se supprime"
            )));
        }
        match role.as_str() {
            "ETAGE" => {
                let n = z.numero_etage.unwrap_or(0);
                if n <= 0 {
                    return Err(AppError::Invalide(
                        "un etage porte un numero a partir de 1".into(),
                    ));
                }
                if etages.contains(&n) {
                    return Err(AppError::Invalide(format!(
                        "l etage {n} est declare deux fois"
                    )));
                }
                etages.push(n);
                pretes.push(ZonePrete {
                    code: format!("{code_machine}-E{n}"),
                    role,
                    numero: n,
                    capacite: z.capacite_bobines,
                });
            }
            "CHAINE" | "TRAME" | "RESERVE" => {
                // UNE SEULE PAR MACHINE. Deux reserves rendraient le compte de
                // bobines ambigu, et c'est ce compte qui fait la consommation.
                if uniques.contains(&role) {
                    return Err(AppError::Invalide(format!(
                        "une machine ne porte qu une zone {role}"
                    )));
                }
                let suffixe = match role.as_str() {
                    "CHAINE" => "CH",
                    "TRAME" => "TR",
                    _ => "RS",
                };
                pretes.push(ZonePrete {
                    code: format!("{code_machine}-{suffixe}"),
                    role: role.clone(),
                    numero: 0,
                    capacite: z.capacite_bobines,
                });
                uniques.push(role);
            }
            autre => {
                return Err(AppError::Invalide(format!(
                    "role de zone inconnu : {autre}. \
                     Les roles sont ETAGE, CHAINE, TRAME et RESERVE"
                )))
            }
        }
    }

    // LES ETAGES SE SUIVENT. Un metier n'a pas d'etage 1, 2 puis 5 : un trou
    // signale une saisie incomplete, et le declencheur `trg_empl_numero` le
    // refuserait de toute facon, avec un message bien moins clair.
    etages.sort_unstable();
    for (i, n) in etages.iter().enumerate() {
        if *n != i as i64 + 1 {
            return Err(AppError::Invalide(format!(
                "les etages se suivent a partir de 1 : l etage {} manque",
                i + 1
            )));
        }
    }

    Ok(pretes)
}

async fn ecrire_zone(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    code_machine: &str,
    z: &ZonePrete,
) -> AppResult<()> {
    // `code_magasin` reste NUL : une zone n'est pas un magasin. Voir la
    // migration 2026-09-09_initialisation_exploitation.
    sqlx::query(
        "INSERT INTO machine_emplacement
             (code_emplacement, code_machine, role, numero_etage,
              capacite_bobines, code_magasin, actif)
         VALUES ($1,$2,$3,$4,$5,NULL,1)
         ON CONFLICT (code_emplacement) DO UPDATE
            SET role = excluded.role,
                numero_etage = excluded.numero_etage,
                capacite_bobines = excluded.capacite_bobines,
                actif = 1",
    )
    .bind(&z.code)
    .bind(code_machine)
    .bind(&z.role)
    .bind(z.numero)
    .bind(z.capacite)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// `POST /api/machines` — declarer une machine.
///
/// Reserve a `PARAMETRES/ECRIRE`, c'est-a-dire a la direction et aux
/// super-utilisateurs : le parc machine est du parametrage, pas de la saisie
/// quotidienne. Un magasinier qui se tromperait de capacite fausserait toute la
/// consommation de la machine.
pub async fn creer_machine(
    State(state): State<AppState>,
    user: Utilisateur,
    Json(m): Json<MachineSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Ecrire)
        .await?;

    let code = m
        .code_machine
        .clone()
        .unwrap_or_default()
        .trim()
        .to_uppercase();
    if code.is_empty() {
        return Err(AppError::Invalide("le code de la machine est requis".into()));
    }

    let zones = preparer(&code, &m)?;
    let capacite: i64 = zones.iter().map(|z| z.capacite).sum();
    let nb_etages = zones.iter().filter(|z| z.role == "ETAGE").count() as i64;

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    sqlx::query(
        // `actif` est une colonne GENEREE depuis `etat` : l'ecrire echouerait.
        "INSERT INTO machine (code_machine, nom, capacite_bobines, nb_etages,
                              code_atelier, notes, etat, date_etat)
         VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',
                 to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))",
    )
    .bind(&code)
    .bind(m.nom.trim())
    .bind(capacite)
    .bind(nb_etages)
    .bind(&m.code_atelier)
    .bind(&m.notes)
    .execute(&mut *tx)
    .await?;

    for z in &zones {
        ecrire_zone(&mut tx, &code, z).await?;
    }

    tx.commit().await?;
    Ok(Json(json!({
        "code_machine": code,
        "capacite_bobines": capacite,
        "nb_etages": nb_etages,
        "zones": zones.iter().map(|z| json!({
            "code_emplacement": z.code,
            "role": z.role,
            "capacite_bobines": z.capacite,
        })).collect::<Vec<_>>(),
    })))
}

/// `PUT /api/machines/{code}` — corriger une machine declaree.
///
/// ON NE CORRIGE PAS UNE MACHINE QUI PORTE DU FIL, du moins pas n'importe
/// comment. Deux refus, et ils protegent la meme chose :
///
///   - retirer une zone qui porte des bobines les ferait disparaitre sans
///     qu'aucun magasin les recoive ;
///   - reduire une capacite sous le nombre de bobines constatees mettrait la
///     zone en contradiction avec elle-meme, et la prochaine fiche serait
///     refusee sans que personne comprenne pourquoi.
///
/// Dans les deux cas la reponse est la meme : dechargez d'abord, corrigez
/// ensuite. Le fil qui quitte une machine passe par un mouvement, toujours.
pub async fn modifier_machine(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
    Json(m): Json<MachineSaisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Ecrire)
        .await?;

    let code = code.trim().to_uppercase();
    let existe: Option<(String,)> =
        sqlx::query_as("SELECT code_machine FROM machine WHERE code_machine = $1")
            .bind(&code)
            .fetch_optional(&state.db)
            .await?;
    if existe.is_none() {
        return Err(AppError::Introuvable(format!("machine {code}")));
    }

    let zones = preparer(&code, &m)?;
    let capacite: i64 = zones.iter().map(|z| z.capacite).sum();
    let nb_etages = zones.iter().filter(|z| z.role == "ETAGE").count() as i64;

    // Ce que chaque zone porte reellement, avant de la toucher.
    let portees: Vec<(String, i64)> = sqlx::query_as(
        "SELECT e.code_emplacement,
                -- `sum()` rend du NUMERIC, que sqlx ne sait pas decoder en i64 :
                -- la conversion est explicite, comme partout ailleurs.
                COALESCE((SELECT sum(s.nb_bobines) FROM machine_etat s
                           WHERE s.code_emplacement = e.code_emplacement), 0)::bigint
           FROM machine_emplacement e
          WHERE e.code_machine = $1 AND e.actif = 1",
    )
    .bind(&code)
    .fetch_all(&state.db)
    .await?;

    for (zone, bobines) in &portees {
        match zones.iter().find(|z| &z.code == zone) {
            None if *bobines > 0 => {
                return Err(AppError::RegleMetier(format!(
                    "{zone} porte {bobines} bobines : \
                     dechargez-la avant de la retirer de la machine"
                )))
            }
            Some(z) if z.capacite < *bobines => {
                return Err(AppError::RegleMetier(format!(
                    "{zone} porte {bobines} bobines et vous la ramenez a {} places : \
                     dechargez la difference d abord",
                    z.capacite
                )))
            }
            _ => {}
        }
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    // Les zones retirees — vides, on vient de le verifier. CELLES QUI ONT UN
    // PASSE SE DESACTIVENT (audit v4) : fiches, decisions, consommation et
    // etats les citent ; les effacer emportait l'historique, ou echouait.
    // Seule une zone que personne n'a jamais employee s'efface.
    let gardees: Vec<String> = zones.iter().map(|z| z.code.clone()).collect();
    sqlx::query(
        "UPDATE machine_emplacement e SET actif = 0
          WHERE e.code_machine = $1 AND e.code_emplacement <> ALL($2) AND e.actif = 1
            AND (EXISTS (SELECT 1 FROM machine_fiche x WHERE x.code_emplacement = e.code_emplacement)
              OR EXISTS (SELECT 1 FROM machine_decision x WHERE x.code_emplacement = e.code_emplacement)
              OR EXISTS (SELECT 1 FROM machine_consommation x WHERE x.code_emplacement = e.code_emplacement)
              OR EXISTS (SELECT 1 FROM machine_fiche_journal x WHERE x.code_emplacement = e.code_emplacement)
              OR EXISTS (SELECT 1 FROM machine_cliche x WHERE x.code_emplacement = e.code_emplacement))",
    )
    .bind(&code)
    .bind(&gardees)
    .execute(&mut *tx)
    .await?;
    // Les zones sans passe : leurs lignes d'etat (a zero bobine), puis elles.
    sqlx::query(
        "DELETE FROM machine_etat x USING machine_emplacement e
          WHERE x.code_emplacement = e.code_emplacement
            AND e.code_machine = $1 AND e.code_emplacement <> ALL($2) AND e.actif = 1",
    )
    .bind(&code)
    .bind(&gardees)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM machine_emplacement e
          WHERE e.code_machine = $1 AND e.code_emplacement <> ALL($2) AND e.actif = 1",
    )
    .bind(&code)
    .bind(&gardees)
    .execute(&mut *tx)
    .await?;

    // LE NOMBRE D'ETAGES MONTE AVANT LES ZONES, ET DESCEND APRES. Le declencheur
    // `trg_empl_numero` refuse un etage au-dela de `nb_etages`, et
    // `trg_machine_nb_etages` refuse de descendre sous l'etage le plus haut : il
    // faut donc agrandir d'abord, retrecir ensuite.
    sqlx::query("UPDATE machine SET nb_etages = GREATEST(nb_etages, $2) WHERE code_machine = $1")
        .bind(&code)
        .bind(nb_etages)
        .execute(&mut *tx)
        .await?;

    for z in &zones {
        ecrire_zone(&mut tx, &code, z).await?;
    }

    // L'ETAT NE SE CHANGE PAS ICI. Configurer une machine et la declarer en
    // panne sont deux gestes differents, faits a des moments differents et
    // souvent par des gens differents : voir `changer_etat`.
    sqlx::query(
        "UPDATE machine
            SET nom = $2, capacite_bobines = $3, nb_etages = $4,
                code_atelier = $5, notes = $6
          WHERE code_machine = $1",
    )
    .bind(&code)
    .bind(m.nom.trim())
    .bind(capacite)
    .bind(nb_etages)
    .bind(&m.code_atelier)
    .bind(&m.notes)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({
        "code_machine": code,
        "capacite_bobines": capacite,
        "nb_etages": nb_etages,
        "zones": zones.len(),
    })))
}

#[derive(Debug, Deserialize)]
pub struct ChangementEtat {
    /// ACTIVE, PANNE, SOMMEIL ou RETIREE.
    pub etat: String,
    pub motif: Option<String>,
}

/// `PATCH /api/machines/{code}/etat` — declarer une machine en panne, en
/// sommeil, remise en production ou retiree du parc.
///
/// POURQUOI QUATRE ETATS ET PAS UN INTERRUPTEUR. Devant un metier arrete, la
/// question n'est jamais « est-il actif ? » mais « pourquoi ne tourne-t-il
/// pas ? ». Une panne appelle un technicien, un sommeil appelle une commande,
/// un retrait n'appelle rien. Un booleen efface la difference, et avec elle la
/// seule information utile.
///
/// UNE MACHINE RETIREE NE PORTE PLUS RIEN. C'est le seul etat qui refuse : si
/// le metier sort du parc avec ses bobines dessus, le fil disparait des comptes
/// sans qu'aucun magasin le recoive. Les trois autres etats n'imposent rien —
/// on decharge une machine en panne, cela arrive tous les jours.
///
/// LE MOTIF EST EXIGE SAUF POUR UN RETOUR EN PRODUCTION. « En panne » sans
/// raison ne dit rien a celui qui lira la fiche dans trois semaines ; remettre
/// en marche, en revanche, se passe d'explication.
pub async fn changer_etat(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
    Json(c): Json<ChangementEtat>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Ecrire)
        .await?;

    let code = code.trim().to_uppercase();
    let etat = c.etat.trim().to_uppercase();
    if !["ACTIVE", "PANNE", "SOMMEIL", "RETIREE"].contains(&etat.as_str()) {
        return Err(AppError::Invalide(format!(
            "etat inconnu : {etat}. Les etats sont ACTIVE, PANNE, SOMMEIL et RETIREE"
        )));
    }

    let motif = c.motif.unwrap_or_default().trim().to_string();
    if etat != "ACTIVE" && motif.is_empty() {
        return Err(AppError::Invalide(
            "dites pourquoi : une machine arretee sans motif ne se comprend plus \
             au bout de quelques jours"
                .into(),
        ));
    }

    let machine: Option<(String, String)> =
        sqlx::query_as("SELECT nom, etat FROM machine WHERE code_machine = $1")
            .bind(&code)
            .fetch_optional(&state.db)
            .await?;
    let (nom, ancien) = machine.ok_or_else(|| AppError::Introuvable(format!("machine {code}")))?;

    if etat == "RETIREE" {
        let bobines: i64 = sqlx::query_scalar(
            "SELECT COALESCE(sum(s.nb_bobines), 0)::bigint
               FROM machine_emplacement e
               LEFT JOIN machine_etat s ON s.code_emplacement = e.code_emplacement
              WHERE e.code_machine = $1",
        )
        .bind(&code)
        .fetch_one(&state.db)
        .await?;
        if bobines > 0 {
            return Err(AppError::RegleMetier(format!(
                "{nom} porte encore {bobines} bobines : dechargez-la avant de la retirer du parc, \
                 sinon ce fil disparait des comptes sans qu aucun magasin le recoive"
            )));
        }
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    sqlx::query(
        "UPDATE machine
            SET etat = $2, motif_etat = NULLIF($3, ''),
                date_etat = to_char(now() AT TIME ZONE 'UTC',
                                    'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
          WHERE code_machine = $1",
    )
    .bind(&code)
    .bind(&etat)
    .bind(&motif)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(json!({
        "code_machine": code,
        "etat_precedent": ancien,
        "etat": etat,
        "motif": if motif.is_empty() { Value::Null } else { Value::from(motif) },
    })))
}

/// `DELETE /api/machines/{code}` — supprimer une machine jamais utilisee.
///
/// LA SUPPRESSION N'EST PAS L'ARCHIVAGE, et confondre les deux fait perdre de
/// l'historique. Une machine qui a travaille porte des fiches, des mouvements
/// et une consommation qui la citent : elle se RETIRE (etat RETIREE), son passe
/// reste consultable. Une machine creee par erreur, jamais chargee, sans une
/// seule fiche, ne laisse rien derriere elle : celle-la se supprime pour de
/// bon, et c'est le seul cas.
///
/// On refuse donc des qu'il existe la moindre trace, et le message dit laquelle.
pub async fn supprimer_machine(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::PARAMETRES, Action::Ecrire)
        .await?;

    let code = code.trim().to_uppercase();
    let nom: Option<(String,)> =
        sqlx::query_as("SELECT nom FROM machine WHERE code_machine = $1")
            .bind(&code)
            .fetch_optional(&state.db)
            .await?;
    let (nom,) = nom.ok_or_else(|| AppError::Introuvable(format!("machine {code}")))?;

    let fiches: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM machine_fiche WHERE code_machine = $1",
    )
    .bind(&code)
    .fetch_one(&state.db)
    .await?;
    if fiches > 0 {
        return Err(AppError::RegleMetier(format!(
            "{nom} porte {fiches} fiche(s) : elle a travaille, on ne l efface pas. \
             Retirez-la du parc — son historique restera consultable"
        )));
    }

    let bobines: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(s.nb_bobines), 0)::bigint
           FROM machine_emplacement e
           LEFT JOIN machine_etat s ON s.code_emplacement = e.code_emplacement
          WHERE e.code_machine = $1",
    )
    .bind(&code)
    .fetch_one(&state.db)
    .await?;
    if bobines > 0 {
        return Err(AppError::RegleMetier(format!(
            "{nom} porte {bobines} bobines : dechargez-la d abord"
        )));
    }

    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;
    sqlx::query("DELETE FROM machine_emplacement WHERE code_machine = $1")
        .bind(&code)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM machine WHERE code_machine = $1")
        .bind(&code)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Json(json!({ "code_machine": code, "supprimee": true })))
}
