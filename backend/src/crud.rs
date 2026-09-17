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
                           WHERE r.code_categorie = c.code_categorie AND r.actif = 1) AS nb_references,
                    (SELECT COUNT(*) FROM famille f
                      WHERE f.code_categorie = c.code_categorie AND f.actif = 1) AS nb_familles",
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
    // Le catalogue des frais d'importation. Il s'administre comme un
    // referentiel : chaque type dit sa piece justificative, s'il est
    // recuperable, s'il est commun au dossier, et comment il se repartit.
    // Desactive plutot que supprime : un dossier deja clos cite son type.
    Entite {
        chemin: "types-frais",
        table: "parametres_frais",
        module: "PARAMETRES",
        cle: "id_frais",
        cle_generee: false,
        creation: &[
            "id_frais", "libelle", "categorie", "piece_justificative", "recuperable",
            "commun", "methode_repartition", "inclus_dans_cout", "ordre", "actif"],
        modification: &[
            "libelle", "categorie", "piece_justificative", "recuperable", "commun",
            "methode_repartition", "inclus_dans_cout", "ordre", "actif"],
        suppression: Suppression::Logique("actif"),
        selection: "c.*, (SELECT COUNT(*) FROM dossier_lignes_frais d
                           WHERE d.id_frais = c.id_frais) AS nb_utilisations",
        tri: "c.ordre",
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
            "note_globale", "tolerance_pesee_pct", "palettes_par_conteneur", "actif"],
        modification: &[
            "nom", "contact_principal", "telephone", "email", "adresse", "ville",
            "pays", "delai_livraison_jours", "conditions_paiement",
            "delai_paiement_jours", "code_devise", "incoterm", "transporteur",
            "note_globale", "tolerance_pesee_pct", "palettes_par_conteneur", "actif",
        ],
        suppression: Suppression::Logique("actif"),
        selection: "c.*, (SELECT COUNT(*) FROM reference r
                           WHERE r.code_fournisseur = c.code_fournisseur AND r.actif = 1) AS nb_references",
        tri: "c.nom",
    },
    // NOTRE liste de couleurs (C1 = Or, C3 = Rouge…), commune a tous les
    // fournisseurs : c'est elle qui rapproche « RED 7612 » de « OZ 5109 ».
    Entite {
        chemin: "couleurs",
        table: "couleur",
        module: "CATALOGUE",
        cle: "code_couleur_interne",
        cle_generee: false,
        creation: &[
            "code_couleur_interne", "libelle", "classe_teinture", "description",
            "ordre_affichage", "actif"],
        modification: &["libelle", "classe_teinture", "description", "ordre_affichage", "actif"],
        suppression: Suppression::Logique("actif"),
        selection: "c.*, (SELECT COUNT(*) FROM reference r
                           WHERE r.code_couleur_interne = c.code_couleur_interne AND r.actif = 1)
                          AS nb_references,
                    (SELECT COUNT(*) FROM couleur_fournisseur cf
                      WHERE cf.code_couleur_interne = c.code_couleur_interne AND cf.actif = 1)
                          AS nb_fournisseurs",
        tri: "c.ordre_affichage",
    },
    // Le meme rouge, chez chacun : « RED 7612 » chez Hasirci, « OZ 5109 » chez
    // Ozkaralar. C'est ce qui permet a la saisie assistee de reconnaitre une
    // couleur sur une facture, et a l'acheteur de savoir qui sait la fournir.
    Entite {
        chemin: "couleurs-fournisseur",
        table: "couleur_fournisseur",
        module: "CATALOGUE",
        cle: "id_couleur_fournisseur",
        cle_generee: true,
        creation: &[
            "code_couleur_interne", "code_fournisseur", "code_couleur", "libelle",
            "supplement_teinture", "actif"],
        modification: &[
            "code_couleur_interne", "code_fournisseur", "code_couleur", "libelle",
            "supplement_teinture", "actif"],
        suppression: Suppression::Logique("actif"),
        selection: "c.*,
                    (SELECT x.nom FROM fournisseur x WHERE x.code_fournisseur = c.code_fournisseur)
                        AS fournisseur_nom,
                    (SELECT x.libelle FROM couleur x
                      WHERE x.code_couleur_interne = c.code_couleur_interne) AS couleur_libelle",
        tri: "c.code_couleur_interne, c.code_fournisseur",
    },
    // La famille : le produit independamment du vendeur.
    Entite {
        chemin: "familles",
        table: "famille",
        module: "CATALOGUE",
        cle: "code_famille",
        cle_generee: false,
        creation: &[
            "code_famille", "libelle", "code_categorie", "type_fil", "titrage",
            "description", "ordre_affichage", "actif"],
        modification: &[
            "libelle", "code_categorie", "type_fil", "titrage", "description",
            "ordre_affichage", "actif"],
        suppression: Suppression::Logique("actif"),
        // En sous-requete : `jointures()` ne declare d'alias que pour la
        // reference et les groupes d'equivalence.
        selection: "c.*,
                    (SELECT x.libelle FROM categorie_matiere x
                      WHERE x.code_categorie = c.code_categorie) AS categorie_libelle,
                    (SELECT COUNT(*) FROM reference r
                      WHERE r.code_famille = c.code_famille AND r.actif = 1) AS nb_references",
        tri: "c.ordre_affichage",
    },
    Entite {
        chemin: "catalogue",
        table: "reference",
        module: "CATALOGUE",
        cle: "code_reference",
        cle_generee: false,
        creation: &[
            "code_reference", "code_categorie", "code_fournisseur", "designation",
            "type_fil", "couleur", "origine", "titrage", "code_famille", "code_couleur_interne",
            "code_couleur",
            // Le code que le FOURNISSEUR donne a cette couleur. Il existait en
            // base sans etre modifiable par aucune route : l'assistant de
            // completion ne pouvait donc pas le renseigner.
            "code_couleur",
            "reference_fournisseur", "supplement_teinture",
            "unite_catalogue", "poids_bobine_kg",
            "bobines_par_palette", "bobines_par_lot", "densite_kg_ml", "prix_catalogue",
            "description_commerciale",
            "code_devise_catalogue", "date_prix_catalogue", "stock_min_kg",
            "couverture_min_mois", "marge_securite_pct", "moq_kg",
            "multiple_achat_kg", "suivi_lot", "actif"],
        modification: &[
            "code_categorie", "code_fournisseur", "designation", "type_fil",
            "couleur", "origine", "titrage", "code_famille", "code_couleur_interne",
            "code_couleur",
            "reference_fournisseur", "supplement_teinture",
            "unite_catalogue", "poids_bobine_kg",
            "bobines_par_palette", "bobines_par_lot", "densite_kg_ml", "prix_catalogue",
            "description_commerciale",
            "code_devise_catalogue", "date_prix_catalogue", "stock_min_kg",
            "couverture_min_mois", "marge_securite_pct", "moq_kg",
            "multiple_achat_kg", "suivi_lot", "actif",
        ],
        suppression: Suppression::Logique("actif"),
        // prix_kg_mad applique la MEME regle que le plan d'achat : le CMUP reel
        // s'il existe, sinon le prix catalogue converti au taux en vigueur. Deux
        // regles de prix dans l'application finiraient par donner deux chiffres.
        selection: "c.*, cat.libelle AS categorie_libelle, cat.code_role_defaut,
                    (SELECT x.libelle FROM role_bom x WHERE x.code_role = cat.code_role_defaut)
                        AS role_libelle,
                    f.nom AS fournisseur_nom,
                    (SELECT x.libelle FROM famille x WHERE x.code_famille = c.code_famille)
                        AS famille_libelle,
                    (SELECT x.libelle FROM couleur x
                      WHERE x.code_couleur_interne = c.code_couleur_interne)
                        AS couleur_interne_libelle,
                    COALESCE(c.cmup_mad, fn_prix_catalogue_mad(c.code_reference)) AS prix_kg_mad,
                    CASE WHEN c.cmup_mad IS NOT NULL THEN 'CMUP' ELSE 'CATALOGUE' END AS source_prix,
                    -- LE PRIX CATALOGUE SEUL, converti au taux en vigueur (sans repli
                    -- sur un taux de 1). `prix_kg_mad` rend le CMUP des qu'il existe :
                    -- la Valorisation comparait donc le CMUP a lui-meme, et l'ecart
                    -- valait toujours zero.
                    fn_prix_catalogue_mad(c.code_reference) AS prix_catalogue_mad,
                    -- La valeur du stock comme la calcule le cockpit : chaque magasin
                    -- a son CMUP. Un seul chiffre pour les trois ecrans.
                    (SELECT COALESCE(SUM(s.valeur_mad), 0) FROM stock_magasin s
                      WHERE s.code_reference = c.code_reference) AS valeur_stock_mad,
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

/// La charge utile, prete a etre coulee dans les types de la table.
///
/// LE PROBLEME QUE CECI RESOUT. Un champ de formulaire rend TOUJOURS du texte :
/// une quantite saisie « 500 » arrive comme la chaine "500", jamais comme le
/// nombre 500. Liee telle quelle, PostgreSQL recevait un parametre `text` pour
/// une colonne `numeric` et refusait — chaque enregistrement portant un prix, un
/// poids ou un seuil tombait en « erreur interne ». Les champs textuels
/// passaient, les champs chiffres non : l'ecran paraissait capricieux.
///
/// LA SOLUTION N'EST PAS DE DEVINER LE TYPE ICI. Convertir « ce qui ressemble a
/// un nombre » casserait l'inverse : un titrage « 1500 » ou un code « 1234 »
/// deviendrait un entier, refuse par une colonne texte. Seule la BASE connait le
/// type de chaque colonne.
///
/// `jsonb_populate_record(NULL::table, $1)` le lui demande : PostgreSQL coule
/// chaque champ du JSON dans le type reel de la colonne du meme nom, avec la
/// fonction d'entree de ce type. Une seule valeur liee, aucune table de types a
/// tenir a jour, et la conversion est celle de la base — pas la notre.
fn charge_jsonb(champs: &[(String, Value)]) -> String {
    let mut m = Map::new();
    for (nom, v) in champs {
        // UN CHAMP VIDE EST UN CHAMP NON RENSEIGNE, pas la chaine vide. Sans
        // cela, « » atteindrait la fonction d'entree de `numeric`, qui refuse.
        let valeur = match v {
            Value::String(s) if s.trim().is_empty() => Value::Null,
            autre => autre.clone(),
        };
        m.insert(nom.clone(), valeur);
    }
    Value::Object(m).to_string()
}

/// Lie une valeur JSON, en respectant son type.
#[allow(dead_code)]
pub fn lier<'q>(
    q: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    v: &'q Value,
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
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
    /// Rang de depart. Sa PRESENCE fait basculer la reponse en enveloppe
    /// paginee `{ lignes, total }` — les appelants qui l'ignorent continuent de
    /// recevoir un tableau nu, sans rien changer chez eux.
    pub offset: Option<i64>,
    pub recherche: Option<String>,
    pub actif: Option<i64>,
    /// Filtres exacts colonne = valeur, valides contre la liste blanche.
    pub egalites: Vec<(String, String)>,
    /// Colonne de tri, validee contre la liste blanche de l'entite.
    pub tri: Option<String>,
    /// `desc` pour l'ordre inverse ; toute autre valeur vaut ascendant.
    pub sens: Option<String>,
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
        // `$N` ET NON `?N`. Le portage vers PostgreSQL a converti le SQL ecrit
        // en dur ; celui-ci est assemble a l'execution, il lui a echappe.
        // Consequence : tout filtre d'egalite tombait en « erreur interne »,
        // et l'ecran des equivalences n'affichait jamais les references d'un
        // groupe. Vu en production, dans le journal : « l'operateur n'existe
        // pas : ? integer ».
        conditions.push(format!("c.{colonne} = ${}", valeurs.len()));
    }
    if let Some(motif) = &f.recherche {
        // Recherche sur la cle et les colonnes textuelles usuelles.
        //
        // CHAQUE MOT DOIT ETRE TROUVE, pas la chaine entiere. On tape « bleu
        // 1500 » en pensant a la matiere, pas a l'ordre des mots de sa
        // designation ; chercher « bleu 1500 » d'un bloc ne rend rien des que la
        // reference s'appelle « PP-1500 Dtex-Bleu 6666 ». Les mots se cumulent
        // en ET, chacun pouvant tomber dans n'importe quelle colonne : la
        // recherche se resserre a mesure qu'on tape, ce qui est exactement ce
        // qu'on attend d'une saisie a la frappe.
        //
        // `ILIKE` ET NON `LIKE` : PostgreSQL distingue la casse. En `LIKE`,
        // taper « pes » ne trouvait jamais « PES-3000 Deniers » — le champ de
        // recherche paraissait casse alors qu'il obeissait a la lettre.
        let cibles: Vec<String> = ["libelle", "nom", "designation", "couleur", "type_fil"]
            .iter()
            .filter(|c| e.creation.contains(*c))
            .map(|c| format!("c.{c}"))
            .chain(std::iter::once(format!("c.{}", e.cle)))
            .collect();
        for mot in motif.split_whitespace() {
            valeurs.push(format!("%{mot}%"));
            let i = valeurs.len();
            conditions.push(format!(
                "({})",
                cibles
                    .iter()
                    .map(|c| format!("COALESCE({c}, '') ILIKE ${i}"))
                    .collect::<Vec<_>>()
                    .join(" OR ")
            ));
        }
    }

    let ou = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    /* Tri demande par l'appelant, valide contre la liste blanche de l'entite :
       une colonne de tri arrive dans le SQL sans passer par un parametre lie,
       donc elle ne peut jamais venir telle quelle du client. */
    let tri = match &f.tri {
        Some(c) if e.creation.contains(&c.as_str()) || c == e.cle => {
            let sens = if f.sens.as_deref() == Some("desc") { "DESC" } else { "ASC" };
            format!("c.{c} {sens}")
        }
        Some(c) => return Err(AppError::Invalide(format!("tri inconnu : {c}"))),
        None => e.tri.to_string(),
    };

    let limite = f.limite.clamp(1, 5000);
    let offset = f.offset.unwrap_or(0).max(0);

    let sql = format!(
        "SELECT {} FROM {} c {} {} ORDER BY {} LIMIT {} OFFSET {}",
        e.selection,
        e.table,
        jointures(e.table),
        ou,
        tri,
        limite,
        offset
    );

    let mut q = sqlx::query(&sql);
    for v in &valeurs {
        q = q.bind(v);
    }
    let rows = q.fetch_all(db).await?;

    let mut valeur = lignes_en_json(&rows);
    user.masquer(db, e.module, &mut valeur).await?;

    if f.offset.is_none() {
        return Ok(valeur);
    }

    /* Le total porte sur le filtre, pas sur la page : sans lui le client ne
       peut ni afficher « 1 a 25 sur 8 431 », ni savoir s'il reste des pages.
       Il est compte avec exactement les memes conditions et les memes valeurs
       liees, sinon les deux chiffres divergeraient en silence. */
    let sql_total = format!(
        "SELECT COUNT(*) FROM {} c {} {}",
        e.table,
        jointures(e.table),
        ou
    );
    let mut qt = sqlx::query_scalar::<_, i64>(&sql_total);
    for v in &valeurs {
        qt = qt.bind(v);
    }
    let total: i64 = qt.fetch_one(db).await?;

    Ok(json!({ "lignes": valeur, "total": total, "limite": limite, "offset": offset }))
}

pub async fn lire(db: &Db, user: &Utilisateur, e: &Entite, id: &str) -> AppResult<Value> {
    user.exiger(db, e.module, Action::Lire).await?;

    let sql = format!(
        "SELECT {} FROM {} c {} WHERE c.{} = $1",
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

    // LA BASE COULE ELLE-MEME LES VALEURS DANS SES TYPES.
    //
    // `jsonb_populate_record(NULL::table, $1)` rend une ligne de la table dont
    // chaque colonne porte la valeur du champ JSON de meme nom, convertie par la
    // fonction d'entree de SON type. Le « 500 » d'un formulaire devient un
    // `numeric`, le « 1500 » d'un titrage reste du texte : c'est la colonne qui
    // decide, pas nous.
    let colonnes: Vec<String> = champs.iter().map(|(n, _)| n.clone()).collect();
    let sql = if colonnes.is_empty() {
        format!("INSERT INTO {} ({}) VALUES ($2)", e.table, e.cle)
    } else {
        format!(
            "INSERT INTO {} ({}, {}) SELECT $2, {} FROM jsonb_populate_record(NULL::{}, $1::jsonb) p",
            e.table,
            e.cle,
            colonnes.join(", "),
            colonnes
                .iter()
                .map(|c| format!("p.{c}"))
                .collect::<Vec<_>>()
                .join(", "),
            e.table,
        )
    };

    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    sqlx::query(&sql)
        .bind(charge_jsonb(&champs))
        .bind(&cle_valeur)
        .execute(&mut *tx)
        .await?;
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

    // LA BASE COULE ELLE-MEME LES VALEURS DANS SES TYPES — voir `charge_jsonb`.
    // Un « 500 » saisi au clavier est du TEXTE ; lie tel quel a une colonne
    // `numeric`, il faisait echouer l'enregistrement de toute reference portant
    // un prix, un poids ou un seuil.
    let set: Vec<String> = champs.iter().map(|(n, _)| format!("{n} = p.{n}")).collect();
    let sql = format!(
        "UPDATE {} AS c SET {} FROM jsonb_populate_record(NULL::{}, $1::jsonb) AS p
          WHERE c.{} = $2",
        e.table,
        set.join(", "),
        e.table,
        e.cle
    );

    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let res = sqlx::query(&sql)
        .bind(charge_jsonb(&champs))
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Introuvable(format!("{} {id}", e.chemin)));
    }
    tx.commit().await?;

    Ok(json!({
        e.cle: id,
        "champs_modifies": champs.iter().map(|(n, _)| n).collect::<Vec<_>>(),
    }))
}

/// La table qui retient une ligne, d'apres la contrainte qui a cede.
///
/// ON INTERROGE LE CATALOGUE, PAS LE MESSAGE D'ERREUR. Le detail rendu par
/// PostgreSQL nomme bien la table — « is still referenced from table "x" » —
/// mais il est TRADUIT selon la langue du serveur, et le serveur d'ici parle
/// francais. Lire `pg_constraint` donne la meme reponse dans toutes les langues :
/// pour une cle etrangere, `conrelid` designe la table qui REFERENCE.
///
/// La transaction est morte quand on arrive ici : on interroge donc la base
/// directement, pas la transaction avortee.
async fn retenue_par(db: &Db, contrainte: Option<&str>) -> Option<String> {
    let nom = contrainte?;
    sqlx::query_scalar::<_, String>(
        "SELECT conrelid::regclass::text FROM pg_constraint
          WHERE conname = $1 AND contype = 'f' LIMIT 1",
    )
    .bind(nom)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
}

pub async fn supprimer(db: &Db, user: &Utilisateur, e: &Entite, id: &str) -> AppResult<Value> {
    user.exiger(db, e.module, Action::Ecrire).await?;

    let mut tx = db.begin().await?;
    user.poser_contexte(&mut tx).await?;

    let sql = match e.suppression {
        Suppression::Interdite => {
            return Err(AppError::RegleMetier(format!(
                "La suppression n'est pas autorisee sur {}.",
                e.chemin
            )))
        }
        // UNE DONNEE DE BASE QUE PERSONNE N'UTILISE SE SUPPRIME VRAIMENT.
        //
        // Elle etait DESACTIVEE : la ligne restait en base, et les ecrans qui ne
        // filtrent pas les inactives continuaient de l'afficher — le bouton
        // « Retirer » paraissait alors sans le moindre effet, ce qui est pire
        // qu'un refus.
        //
        // C'est la BASE qui decide : une famille qu'aucune reference ne cite
        // s'efface ; une famille citee est retenue par sa cle etrangere, et l'on
        // rapporte alors CE QUI la retient plutot qu'un refus muet. L'historique
        // reste protege sans qu'on ait a le deviner ici — R03 tient par les
        // contraintes, pas par une convention d'ecran.
        //
        // La desactivation reste possible, mais comme un acte a part : on met
        // `actif` a zero. Retirer et desactiver ne sont pas la meme decision.
        Suppression::Logique(_) | Suppression::Physique => {
            format!("DELETE FROM {} WHERE {} = $1", e.table, e.cle)
        }
    };

    let res = match sqlx::query(&sql).bind(id).execute(&mut *tx).await {
        Ok(r) => r,
        // 23503 : violation de cle etrangere. Quelque chose s'appuie sur cette
        // ligne. Le message brut de PostgreSQL ne veut rien dire pour qui
        // administre un referentiel : on nomme la table qui retient.
        Err(sqlx::Error::Database(err)) if err.code().as_deref() == Some("23503") => {
            let qui = retenue_par(db, err.constraint()).await;
            return Err(AppError::RegleMetier(match qui {
                Some(table) => format!(
                    "« {id} » est encore utilise par des lignes de « {table} » : \
                     il ne peut pas etre supprime. Detachez-les d'abord, ou \
                     mettez cette ligne a l'etat inactif."
                ),
                None => format!(
                    "« {id} » est encore utilise ailleurs : il ne peut pas etre \
                     supprime. Detachez d'abord ce qui s'y rattache, ou mettez \
                     cette ligne a l'etat inactif."
                ),
            }));
        }
        Err(autre) => return Err(autre.into()),
    };
    if res.rows_affected() == 0 {
        return Err(AppError::Introuvable(format!("{} {id}", e.chemin)));
    }
    tx.commit().await?;

    Ok(json!({
        e.cle: id,
        "supprime": true,
        "mode": "suppression",
    }))
}

/// Horodatage de derniere modification, pour les entites qui le portent.
#[allow(dead_code)]
pub fn horodatage() -> String {
    maintenant()
}
