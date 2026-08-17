//! Moteur CRUD generique, pilote par un registre d'entites.
//!
//! POURQUOI UN MOTEUR PLUTOT QUE 20 JEUX D'ENDPOINTS ECRITS A LA MAIN :
//! chaque ecriture doit passer par la meme sequence — permission de module,
//! grille de droits par champ, liste blanche de colonnes, contexte d'audit,
//! transaction. Ecrite vingt fois, cette sequence finit par diverger, et c'est
//! l'oubli d'une seule etape qui ouvre une faille. Ecrite une fois, elle vaut
//! pour tout le referentiel.
//!
//! Les entites porteuses de workflow (recettes, plans, receptions, bons de
//! commande) ont leurs propres modules : leur creation n'est pas un simple
//! INSERT, elle engage des regles metier.

use crate::auth::{rbac::Action, Utilisateur};
use crate::db::{maintenant, Db};
use crate::error::{AppError, AppResult};
use crate::routes::json::lignes_en_json;
use serde_json::{json, Map, Value};

/// Politique de suppression d'une entite.
#[derive(Clone, Copy, PartialEq)]
pub enum Suppression {
    /// Bascule une colonne booleenne a 0. Preserve l'historique : une reference
    /// desactivee reste referencable par les mouvements passes.
    Logique(&'static str),
    /// DELETE reel. Reserve aux tables sans dependance historique.
    Physique,
    /// Aucune suppression possible par l'API. Reserve aux entites dont la
    /// disparition romprait un historique comptable.
    #[allow(dead_code)]
    Interdite,
}

pub struct Entite {
    /// Segment d'URL : /api/{chemin}
    pub chemin: &'static str,
    pub table: &'static str,
    /// Module au sens de la matrice de permissions (CDC D2).
    pub module: &'static str,
    pub cle: &'static str,
    /// La cle est-elle generee par le serveur (UUID) ou fournie par l'appelant ?
    pub cle_generee: bool,
    /// Colonnes acceptees a la creation.
    pub creation: &'static [&'static str],
    /// Colonnes acceptees en modification. Volontairement plus restreinte :
    /// un code de reference ne se change pas apres coup, il est la cle de
    /// toutes les references croisees.
    pub modification: &'static [&'static str],
    pub suppression: Suppression,
    /// Clause SELECT, pour enrichir avec des libelles ou des comptages.
    pub selection: &'static str,
    pub tri: &'static str,
}

/// Registre des entites gerees par le moteur generique.
pub const ENTITES: &[Entite] = &[
    Entite {
        chemin: "categories",
        table: "categorie_matiere",
        module: "CATALOGUE",
        cle: "code_categorie",
        cle_generee: false,
        creation: &["code_categorie", "libelle", "description", "code_role_defaut", "ordre_affichage", "actif"],
        modification: &["libelle", "description", "code_role_defaut", "ordre_affichage", "actif"],
        suppression: Suppression::Logique("actif"),
        selection: "c.*, (SELECT COUNT(*) FROM reference r
                           WHERE r.code_categorie = c.code_categorie AND r.actif = 1) AS nb_references",
        tri: "c.ordre_affichage, c.libelle",
    },
    Entite {
        chemin: "roles-bom",
        table: "role_bom",
        module: "CATALOGUE",
        cle: "code_role",
        cle_generee: false,
        creation: &["code_role", "libelle", "description", "ordre_affichage", "actif"],
        modification: &["libelle", "description", "ordre_affichage", "actif"],
        suppression: Suppression::Logique("actif"),
        selection: "c.*, (SELECT COUNT(DISTINCT lq.code_qualite) FROM ligne_qualite lq
                           WHERE lq.code_role = c.code_role AND lq.actif = 1) AS nb_qualites",
        tri: "c.ordre_affichage",
    },
    Entite {
        chemin: "types-mouvement",
        table: "type_mouvement",
        module: "MOUVEMENTS",
        cle: "code_type_mvt",
        cle_generee: false,
        creation: &[
            "code_type_mvt", "libelle", "signe", "exige_prix", "impacte_cmup",
            "exige_of", "exige_motif_ligne", "couleur", "actif"],
        // Le signe n'est jamais modifiable apres coup : les mouvements deja
        // enregistres ont ete appliques avec, changer le type inverserait
        // retroactivement leur sens dans le grand livre.
        modification: &[
            "libelle", "exige_prix", "exige_of", "exige_motif_ligne", "couleur", "actif",
        ],
        suppression: Suppression::Logique("actif"),
        selection: "c.*, (SELECT COUNT(*) FROM mouvement m
                           WHERE m.code_type_mvt = c.code_type_mvt) AS nb_mouvements",
        tri: "c.signe DESC, c.libelle",
    },
    Entite {
        chemin: "motifs-mouvement",
        table: "motif_mouvement",
        module: "MOUVEMENTS",
        cle: "code_motif",
        cle_generee: false,
        creation: &["code_motif", "libelle", "categorie", "signe_default", "actif"],
        modification: &["libelle", "categorie", "actif"],
        suppression: Suppression::Logique("actif"),
        selection: "c.*",
        tri: "c.categorie, c.libelle",
    },
    Entite {
        chemin: "motifs-ligne",
        table: "motif_ligne",
        module: "MOUVEMENTS",
        cle: "code_motif_ligne",
        cle_generee: false,
        creation: &["code_motif_ligne", "libelle", "categorie", "actif"],
        modification: &["libelle", "categorie", "actif"],
        suppression: Suppression::Logique("actif"),
        selection: "c.*",
        tri: "c.code_motif_ligne",
    },
    Entite {
        chemin: "magasins",
        table: "magasin",
        module: "STOCK",
        cle: "code_magasin",
        cle_generee: false,
        creation: &[
            "code_magasin", "nom", "type", "adresse", "responsable",
            "inclure_mrp", "est_quarantaine", "actif"],
        modification: &[
            "nom", "type", "adresse", "responsable", "inclure_mrp",
            "est_quarantaine", "actif",
        ],
        suppression: Suppression::Logique("actif"),
        selection: "c.*, (SELECT COUNT(*) FROM stock_magasin s
                           WHERE s.code_magasin = c.code_magasin AND s.quantite_kg > 0) AS nb_references_en_stock",
        tri: "c.nom",
    },
    Entite {
        chemin: "groupes-equiv",
        table: "groupe_equiv",
        module: "CATALOGUE",
        cle: "code_groupe_equiv",
        cle_generee: false,
        creation: &["code_groupe_equiv", "libelle", "description", "actif"],
        modification: &["libelle", "description", "actif"],
        suppression: Suppression::Logique("actif"),
        selection: "c.*, (SELECT COUNT(*) FROM reference_groupe_equiv g
                           WHERE g.code_groupe_equiv = c.code_groupe_equiv AND g.actif = 1) AS nb_references",
        tri: "c.code_groupe_equiv",
    },
    Entite {
        chemin: "fournisseurs",
        table: "fournisseur",
        module: "FOURNISSEURS",
        cle: "code_fournisseur",
        cle_generee: false,
        creation: &[
            "code_fournisseur", "nom", "contact_principal", "telephone", "email",
            "adresse", "ville", "pays", "delai_livraison_jours", "conditions_paiement",
            "delai_paiement_jours", "code_devise", "incoterm", "transporteur",
            "note_globale", "tolerance_pesee_pct", "actif"],
        modification: &[
            "nom", "contact_principal", "telephone", "email", "adresse", "ville",
            "pays", "delai_livraison_jours", "conditions_paiement",
            "delai_paiement_jours", "code_devise", "incoterm", "transporteur",
            "note_globale", "tolerance_pesee_pct", "actif",
        ],
        suppression: Suppression::Logique("actif"),
        selection: "c.*, (SELECT COUNT(*) FROM reference r
                           WHERE r.code_fournisseur = c.code_fournisseur AND r.actif = 1) AS nb_references",
        tri: "c.nom",
    },
    Entite {
        chemin: "catalogue",
        table: "reference",
        module: "CATALOGUE",
        cle: "code_reference",
        cle_generee: false,
        creation: &[
            "code_reference", "code_categorie", "code_fournisseur", "designation",
            "type_fil", "couleur", "titrage", "unite_catalogue", "poids_bobine_kg",
            "bobines_par_palette", "densite_kg_ml", "prix_catalogue",
            "code_devise_catalogue", "date_prix_catalogue", "stock_min_kg",
            "couverture_min_mois", "marge_securite_pct", "moq_kg",
            "multiple_achat_kg", "suivi_lot", "actif"],
        modification: &[
            "code_categorie", "code_fournisseur", "designation", "type_fil",
            "couleur", "titrage", "unite_catalogue", "poids_bobine_kg",
            "bobines_par_palette", "densite_kg_ml", "prix_catalogue",
            "code_devise_catalogue", "date_prix_catalogue", "stock_min_kg",
            "couverture_min_mois", "marge_securite_pct", "moq_kg",
            "multiple_achat_kg", "suivi_lot", "actif",
        ],
        suppression: Suppression::Logique("actif"),
        // prix_kg_mad applique la MEME regle que le plan d'achat : le CMUP reel
        // s'il existe, sinon le prix catalogue converti au taux en vigueur. Deux
        // regles de prix dans l'application finiraient par donner deux chiffres.
        selection: "c.*, cat.libelle AS categorie_libelle, cat.code_role_defaut,
                    f.nom AS fournisseur_nom,
                    COALESCE(c.cmup_mad, ROUND(c.prix_catalogue_kg * COALESCE((
                        SELECT t.taux FROM taux_change t
                         WHERE t.code_devise = c.code_devise_catalogue
                           AND date('now') >= t.date_debut
                           AND (t.date_fin IS NULL OR date('now') <= t.date_fin)
                         ORDER BY t.date_debut DESC LIMIT 1), 1.0), 4)) AS prix_kg_mad,
                    CASE WHEN c.cmup_mad IS NOT NULL THEN 'CMUP' ELSE 'CATALOGUE' END AS source_prix,
                    (SELECT COUNT(*) FROM reference_groupe_equiv g
                      WHERE g.code_reference = c.code_reference AND g.actif = 1) AS nb_groupes,
                    (SELECT COUNT(*) FROM recette lr
                      WHERE lr.code_reference = c.code_reference AND lr.actif = 1) AS nb_recettes,
                    (SELECT COALESCE(SUM(s.quantite_kg), 0) FROM stock_magasin s
                      WHERE s.code_reference = c.code_reference) AS stock_total_kg",
        tri: "c.code_reference",
    },
    Entite {
        chemin: "reference-groupes",
        table: "reference_groupe_equiv",
        module: "CATALOGUE",
        cle: "id_ref_grp",
        cle_generee: true,
        creation: &[
            "code_reference", "code_groupe_equiv", "priorite", "est_preferentielle", "actif"],
        modification: &["priorite", "est_preferentielle", "date_fin", "actif"],
        suppression: Suppression::Physique,
        selection: "c.*, r.designation, g.libelle AS groupe_libelle",
        tri: "c.code_groupe_equiv, c.priorite",
    },
];

pub fn entite(chemin: &str) -> AppResult<&'static Entite> {
    ENTITES
        .iter()
        .find(|e| e.chemin == chemin)
        .ok_or_else(|| AppError::Introuvable(format!("entite {chemin}")))
}

/// Jointures d'enrichissement, par table.
fn jointures(table: &str) -> &'static str {
    match table {
        "reference" => {
            "LEFT JOIN categorie_matiere cat ON cat.code_categorie = c.code_categorie
             LEFT JOIN fournisseur       f   ON f.code_fournisseur = c.code_fournisseur"
        }
        "reference_groupe_equiv" => {
            "LEFT JOIN reference    r ON r.code_reference    = c.code_reference
             LEFT JOIN groupe_equiv g ON g.code_groupe_equiv = c.code_groupe_equiv"
        }
        _ => "",
    }
}

/// Lie une valeur JSON, en respectant son type.
pub fn lier<'q>(
    q: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    v: &'q Value,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    match v {
        Value::Null => q.bind(None::<String>),
        Value::Bool(b) => q.bind(i64::from(*b)),
        Value::Number(n) => match n.as_i64() {
            Some(i) => q.bind(i),
            None => q.bind(n.as_f64().unwrap_or(0.0)),
        },
        Value::String(s) => q.bind(s.as_str()),
        autre => q.bind(autre.to_string()),
    }
}

/// Confronte la charge utile a la grille de droits, puis a la liste blanche.
///
/// L'ordre importe : on refuse d'abord ce que l'utilisateur n'a pas le droit
/// d'ecrire, ensuite ce qui n'est pas une colonne modifiable. Le premier
/// message parle de droits, le second de structure.
async fn valider_charge(
    db: &Db,
    user: &Utilisateur,
    module: &str,
    colonnes_permises: &[&str],
    charge: &Map<String, Value>,
) -> AppResult<Vec<(String, Value)>> {
    let retenus = user.filtrer_ecriture(db, module, charge).await?;

    let mut sortie = Vec::new();
    for (nom, valeur) in &retenus {
        if !colonnes_permises.contains(&nom.as_str()) {
            return Err(AppError::Invalide(format!(
                "champ non modifiable sur cette entite : {nom}"
            )));
        }
        sortie.push((nom.clone(), valeur.clone()));
    }
    if sortie.is_empty() {
        return Err(AppError::Invalide(
            "aucun champ exploitable dans la requete".into(),
        ));
    }
    Ok(sortie)
}

// ============================================================================
// Operations
// ============================================================================

pub struct Filtre {
    pub limite: i64,
    pub recherche: Option<String>,
    pub actif: Option<i64>,
    /// Filtres exacts colonne = valeur, valides contre la liste blanche.
    pub egalites: Vec<(String, String)>,
}

pub async fn lister(
    db: &Db,
    user: &Utilisateur,
    e: &Entite,
    f: &Filtre,
) -> AppResult<Value> {
    user.exiger(db, e.module, Action::Lire).await?;

    let mut conditions = Vec::new();
    let mut valeurs: Vec<String> = Vec::new();

    if let Some(a) = f.actif {
        conditions.push(format!("c.actif = {}", if a == 0 { 0 } else { 1 }));
    }
    for (colonne, valeur) in &f.egalites {
        if !e.creation.contains(&colonne.as_str()) && colonne != e.cle {
            return Err(AppError::Invalide(format!("filtre inconnu : {colonne}")));
        }
        valeurs.push(valeur.clone());
        conditions.push(format!("c.{colonne} = ?{}", valeurs.len()));
    }
    if let Some(motif) = &f.recherche {
        // Recherche sur la cle et les colonnes textuelles usuelles.
        let cibles: Vec<String> = ["libelle", "nom", "designation", "couleur"]
            .iter()
            .filter(|c| e.creation.contains(*c))
            .map(|c| format!("c.{c}"))
            .chain(std::iter::once(format!("c.{}", e.cle)))
            .collect();
        valeurs.push(format!("%{motif}%"));
        let i = valeurs.len();
        conditions.push(format!(
            "({})",
            cibles
                .iter()
                .map(|c| format!("{c} LIKE ?{i}"))
                .collect::<Vec<_>>()
                .join(" OR ")
        ));
    }

    let ou = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        "SELECT {} FROM {} c {} {} ORDER BY {} LIMIT {}",
        e.selection,
        e.table,
        jointures(e.table),
        ou,
        e.tri,
        f.limite.clamp(1, 5000)
    );

    let mut q = sqlx::query(&sql);
    for v in &valeurs {
        q = q.bind(v);
    }
    let rows = q.fetch_all(db).await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(db, e.module, &mut valeur).await?;
    Ok(valeur)
}

pub async fn lire(db: &Db, user: &Utilisateur, e: &Entite, id: &str) -> AppResult<Value> {
    user.exiger(db, e.module, Action::Lire).await?;

    let sql = format!(
        "SELECT {} FROM {} c {} WHERE c.{} = ?1",
        e.selection,
        e.table,
        jointures(e.table),
        e.cle
    );
    let rows = sqlx::query(&sql).bind(id).fetch_all(db).await?;
    if rows.is_empty() {
        return Err(AppError::Introuvable(format!("{} {id}", e.chemin)));
    }

    let mut valeur = lignes_en_json(&rows)
        .as_array()
        .and_then(|a| a.first().cloned())
        .unwrap_or(Value::Null);
    user.masquer(db, e.module, &mut valeur).await?;
    Ok(valeur)
}

pub async fn creer(
    db: &Db,
    user: &Utilisateur,
    e: &Entite,
    charge: &Map<String, Value>,
) -> AppResult<Value> {
    user.exiger(db, e.module, Action::Ecrire).await?;

    // La cle est extraite AVANT le filtre de droits : a la creation elle n'est
    // pas un champ que l'on modifie, c'est l'identite que l'on attribue. Les
    // identifiants sont declares en LECTURE pour interdire le renommage
    // ulterieur — les soumettre au meme filtre ici rendrait toute creation
    // impossible. La liste `modification` de l'entite, qui ne contient jamais la
    // cle, est ce qui protege reellement contre le renommage.
    let mut reste = charge.clone();
    let cle_valeur = if e.cle_generee {
        reste.remove(e.cle);
        uuid::Uuid::new_v4().to_string()
    } else {
        let fournie = reste
            .remove(e.cle)
            .and_then(|v| v.as_str().map(str::to_string))
            .ok_or_else(|| AppError::Invalide(format!("{} est obligatoire", e.cle)))?;
        if fournie.trim().is_empty() {
            return Err(AppError::Invalide(format!("{} ne peut pas etre vide", e.cle)));
        }
        fournie.trim().to_string()
    };

    let champs = valider_charge(db, user, e.module, e.creation, &reste).await?;

    let mut colonnes = vec![e.cle.to_string()];
    colonnes.extend(champs.iter().map(|(n, _)| n.clone()));
    let marques: Vec<String> = (1..=colonnes.len()).map(|i| format!("?{i}")).collect();

    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        e.table,
        colonnes.join(", "),
        marques.join(", ")
    );

    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let mut q = sqlx::query(&sql).bind(&cle_valeur);
    for (_, v) in &champs {
        q = lier(q, v);
    }
    q.execute(&mut *tx).await?;
    tx.commit().await?;

    Ok(json!({ e.cle: cle_valeur, "cree": true }))
}

pub async fn modifier(
    db: &Db,
    user: &Utilisateur,
    e: &Entite,
    id: &str,
    charge: &Map<String, Value>,
) -> AppResult<Value> {
    user.exiger(db, e.module, Action::Ecrire).await?;
    let champs = valider_charge(db, user, e.module, e.modification, charge).await?;

    let set: Vec<String> = champs
        .iter()
        .enumerate()
        .map(|(i, (n, _))| format!("{n} = ?{}", i + 2))
        .collect();
    let sql = format!(
        "UPDATE {} SET {} WHERE {} = ?1",
        e.table,
        set.join(", "),
        e.cle
    );

    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let mut q = sqlx::query(&sql).bind(id);
    for (_, v) in &champs {
        q = lier(q, v);
    }
    let res = q.execute(&mut *tx).await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Introuvable(format!("{} {id}", e.chemin)));
    }
    tx.commit().await?;

    Ok(json!({
        e.cle: id,
        "champs_modifies": champs.iter().map(|(n, _)| n).collect::<Vec<_>>(),
    }))
}

pub async fn supprimer(db: &Db, user: &Utilisateur, e: &Entite, id: &str) -> AppResult<Value> {
    user.exiger(db, e.module, Action::Ecrire).await?;

    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let (sql, logique) = match e.suppression {
        Suppression::Interdite => {
            return Err(AppError::RegleMetier(format!(
                "La suppression n'est pas autorisee sur {}.",
                e.chemin
            )))
        }
        // Desactivation plutot que suppression : les mouvements, recettes et
        // commandes passes referencent ces lignes. Les effacer romprait
        // l'historique, que R03 declare immuable.
        Suppression::Logique(col) => (
            format!("UPDATE {} SET {col} = 0 WHERE {} = ?1", e.table, e.cle),
            true,
        ),
        Suppression::Physique => (
            format!("DELETE FROM {} WHERE {} = ?1", e.table, e.cle),
            false,
        ),
    };

    let res = sqlx::query(&sql).bind(id).execute(&mut *tx).await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Introuvable(format!("{} {id}", e.chemin)));
    }
    tx.commit().await?;

    Ok(json!({
        e.cle: id,
        "supprime": true,
        "mode": if logique { "desactivation" } else { "suppression" },
    }))
}

/// Horodatage de derniere modification, pour les entites qui le portent.
#[allow(dead_code)]
pub fn horodatage() -> String {
    maintenant()
}
