//! LA RECHERCHE DES REFERENTIELS, COTE SERVEUR (24/10/2026).
//!
//! `GET /api/recherche/{type}?recherche=&limite=` — le choix d'une valeur dans
//! une liste qui grandit (fournisseur, reference, lot, bon de commande, ligne de
//! bon, OF, qualite, reception, type de frais, reference en stock).
//!
//! POURQUOI UNE ROUTE A PART. Les ecrans chargeaient la liste ENTIERE dans un
//! `<select>` — cinq cents fournisseurs, deux cents receptions, deux cents lots —
//! et la base coupait sans le dire : au-dela, la valeur n'existait plus pour
//! l'ecran. Ici le serveur cherche, rend quelques lignes, et DIT s'il en reste
//! (`plus`, `total`) : l'ecran invite alors a affiner au lieu de mentir.
//!
//! CE QUI NE CHANGE PAS. La permission de LIRE le module (une seule suffit quand
//! le type sert plusieurs ecrans : une qualite se choisit au plan comme a la
//! machine), et le masquage par champ A LA SORTIE, comme partout. On ne cherche
//! pas non plus dans un champ masque : la reponse revelerait ce qu'on ne voit pas.
//!
//! LA RECHERCHE. Chaque mot doit etre trouve (ET), chacun dans n'importe quelle
//! colonne de recherche (OU), sans egard a la casse : « bleu 1500 » trouve
//! « PP-1500 Dtex-Bleu ». Les jokers `%` et `_` tapes se cherchent tels quels.
//!
//! PARAMETRES COMMUNS :
//!   recherche   les mots tapes ;
//!   limite      20 par defaut, 100 au plus ;
//!   valeur      relire UNE valeur ou plusieurs (parametre repete) par sa cle —
//!               sans le filtre par defaut : un fournisseur desactive cite par un
//!               vieux document doit s'afficher ;
//!   exclure     cles a ne pas proposer (parametre repete) ;
//!   tous=1      lever le filtre par defaut (actifs, ouverts, en stock).
//! Les autres parametres sont les filtres propres au type ; un parametre inconnu
//! est refuse plutot qu'ignore (un filtre ignore rend une liste fausse).

use crate::auth::rbac::{self, module, Action, Niveau};
use crate::auth::Utilisateur;
use crate::error::{AppError, AppResult};
use crate::routes::json::lignes_en_json;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde_json::{json, Value};

/// La forme d'un filtre propre au type.
#[derive(Clone, Copy)]
enum Genre {
    /// Une valeur : `expr = $n`.
    Egal,
    /// Une ou plusieurs (parametre repete) : `expr = ANY($n)`.
    Liste,
}

struct Filtre {
    param: &'static str,
    expr: &'static str,
    genre: Genre,
}

struct TypeRecherche {
    nom: &'static str,
    /// Le droit de LIRE l'un de ces modules suffit.
    modules: &'static [&'static str],
    /// La grille de champs appliquee a la sortie (et aux colonnes de recherche).
    grille: &'static str,
    selection: &'static str,
    depuis: &'static str,
    /// L'expression de la cle : ce que l'ecran retient.
    cle: &'static str,
    /// (expression SQL, nom du champ dans la reponse) : le nom sert a savoir
    /// si la colonne est masquee a cet utilisateur.
    cherche: &'static [(&'static str, &'static str)],
    /// Le filtre par defaut (actifs, ouverts…), leve par `tous=1` ou `valeur`.
    defaut: &'static str,
    filtres: &'static [Filtre],
    tri: &'static str,
}

const fn egal(param: &'static str, expr: &'static str) -> Filtre {
    Filtre { param, expr, genre: Genre::Egal }
}
const fn liste(param: &'static str, expr: &'static str) -> Filtre {
    Filtre { param, expr, genre: Genre::Liste }
}

static TYPES: &[TypeRecherche] = &[
    TypeRecherche {
        nom: "fournisseur",
        modules: &[module::FOURNISSEURS],
        grille: module::FOURNISSEURS,
        selection: "f.code_fournisseur, f.nom, f.ville, f.pays, f.code_devise,
                    f.delai_livraison_jours, f.actif",
        depuis: "fournisseur f",
        cle: "f.code_fournisseur",
        cherche: &[("f.code_fournisseur", "code_fournisseur"), ("f.nom", "nom"), ("f.ville", "ville")],
        defaut: "f.actif = 1",
        filtres: &[],
        tri: "f.nom, f.code_fournisseur",
    },
    TypeRecherche {
        nom: "reference",
        modules: &[module::CATALOGUE],
        grille: module::CATALOGUE,
        // Le prix au kilo suit la regle du catalogue et du plan d'achat : le
        // CMUP reel s'il existe, sinon le prix catalogue converti.
        selection: "r.code_reference, r.designation, r.code_categorie, cat.libelle AS categorie_libelle,
                    r.type_fil, r.couleur, r.code_fournisseur, f.nom AS fournisseur_nom,
                    r.reference_fournisseur, r.unite_catalogue, r.code_devise_catalogue, r.actif,
                    COALESCE(r.cmup_mad, fn_prix_catalogue_mad(r.code_reference))::float8 AS prix_kg_mad,
                    CASE WHEN r.cmup_mad IS NOT NULL THEN 'CMUP' ELSE 'CATALOGUE' END AS source_prix",
        depuis: "reference r
                 LEFT JOIN categorie_matiere cat ON cat.code_categorie = r.code_categorie
                 LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur",
        cle: "r.code_reference",
        cherche: &[
            ("r.code_reference", "code_reference"),
            ("r.designation", "designation"),
            ("r.couleur", "couleur"),
            ("r.type_fil", "type_fil"),
            ("r.reference_fournisseur", "reference_fournisseur"),
            ("f.nom", "fournisseur_nom"),
            ("cat.libelle", "categorie_libelle"),
        ],
        defaut: "r.actif = 1",
        filtres: &[
            egal("code_fournisseur", "r.code_fournisseur"),
            liste("code_categorie", "r.code_categorie"),
        ],
        tri: "r.code_reference",
    },
    // LA REFERENCE QU'UN MAGASIN PORTE : une sortie, un retour ne choisissent que
    // ce qui est la. Avec ses kilos et son CMUP (masque selon la grille du stock).
    TypeRecherche {
        nom: "reference-en-stock",
        modules: &[module::STOCK],
        grille: module::STOCK,
        selection: "sm.code_reference, r.designation, r.couleur, sm.code_magasin,
                    sm.quantite_kg::float8 AS quantite_kg, sm.cmup_mad::float8 AS cmup_mad",
        depuis: "stock_magasin sm JOIN reference r ON r.code_reference = sm.code_reference",
        cle: "sm.code_reference",
        cherche: &[
            ("sm.code_reference", "code_reference"),
            ("r.designation", "designation"),
            ("r.couleur", "couleur"),
        ],
        defaut: "sm.quantite_kg > 0",
        filtres: &[egal("code_magasin", "sm.code_magasin")],
        tri: "sm.code_reference, sm.code_magasin",
    },
    // LE LOT, dans l'ordre ou il doit sortir (FEFO, comme `v_lot_fefo` et
    // frontend/src/lib/fefo.ts) : celui qui perime le premier, puis le plus ancien.
    TypeRecherche {
        nom: "lot",
        modules: &[module::STOCK],
        grille: module::STOCK,
        selection: "sl.lot_fournisseur, sl.code_reference, r.designation, sl.code_magasin,
                    sl.quantite_kg::float8 AS quantite_kg, sl.nb_bobines, sl.code_couleur,
                    sl.date_premiere_entree, sl.date_peremption",
        depuis: "stock_lot sl JOIN reference r ON r.code_reference = sl.code_reference",
        cle: "sl.lot_fournisseur",
        cherche: &[
            ("sl.lot_fournisseur", "lot_fournisseur"),
            ("sl.code_reference", "code_reference"),
            ("r.designation", "designation"),
            ("sl.code_couleur", "code_couleur"),
        ],
        defaut: "sl.quantite_kg > 0",
        filtres: &[
            egal("code_reference", "sl.code_reference"),
            egal("code_magasin", "sl.code_magasin"),
        ],
        tri: "COALESCE(NULLIF(sl.date_peremption::text, ''), '9999-12-31'), sl.date_premiere_entree,
              sl.lot_fournisseur, sl.code_magasin",
    },
    // LE BON DE COMMANDE, avec ce qui reste a recevoir (en kilos).
    TypeRecherche {
        nom: "bc",
        modules: &[module::BONS_COMMANDE],
        grille: module::BONS_COMMANDE,
        selection: "b.id_bc, b.numero_bc, b.statut, b.code_fournisseur, f.nom AS fournisseur_nom,
                    b.date_bc, b.code_devise,
                    (SELECT COUNT(*) FROM ligne_bc l WHERE l.id_bc = b.id_bc) AS nb_lignes,
                    (SELECT COALESCE(SUM(GREATEST(l.quantite_restante_kg, 0)), 0)
                       FROM ligne_bc l WHERE l.id_bc = b.id_bc)::float8 AS reste_kg",
        depuis: "bon_commande b JOIN fournisseur f ON f.code_fournisseur = b.code_fournisseur",
        cle: "b.id_bc",
        cherche: &[
            ("b.numero_bc", "numero_bc"),
            ("b.code_fournisseur", "code_fournisseur"),
            ("f.nom", "fournisseur_nom"),
        ],
        defaut: "b.statut NOT IN ('CLOTURE', 'ANNULE')",
        filtres: &[
            egal("code_fournisseur", "b.code_fournisseur"),
            liste("statut", "b.statut"),
        ],
        tri: "b.date_bc DESC, b.numero_bc DESC",
    },
    // LA LIGNE DE BON qui attend encore de la marchandise. Le defaut (reste > 0,
    // bon valide ou envoye) est un affichage : la route qui ENREGISTRE reverifie.
    TypeRecherche {
        nom: "ligne-bc",
        modules: &[module::BONS_COMMANDE],
        grille: module::BONS_COMMANDE,
        selection: "l.id_ligne_bc, l.id_bc, b.numero_bc, l.ligne_numero, l.code_reference,
                    COALESCE(r.designation, l.designation, l.libelle) AS designation,
                    b.code_fournisseur, f.nom AS fournisseur_nom, b.statut,
                    l.quantite_commandee_kg::float8 AS quantite_commandee_kg,
                    l.quantite_recue_kg::float8 AS quantite_recue_kg,
                    l.quantite_restante_kg::float8 AS reste_kg",
        depuis: "ligne_bc l
                 JOIN bon_commande b ON b.id_bc = l.id_bc
                 JOIN fournisseur f ON f.code_fournisseur = b.code_fournisseur
                 LEFT JOIN reference r ON r.code_reference = l.code_reference",
        cle: "l.id_ligne_bc",
        cherche: &[
            ("b.numero_bc", "numero_bc"),
            ("l.code_reference", "code_reference"),
            ("COALESCE(r.designation, l.designation, l.libelle)", "designation"),
            ("f.nom", "fournisseur_nom"),
        ],
        defaut: "l.quantite_restante_kg > 0 AND b.statut IN ('VALIDE', 'ENVOYE', 'LIVRE_PARTIEL')",
        filtres: &[
            egal("id_bc", "l.id_bc"),
            egal("code_fournisseur", "b.code_fournisseur"),
            egal("code_reference", "l.code_reference"),
            liste("statut", "b.statut"),
        ],
        tri: "b.date_bc DESC, b.numero_bc, l.ligne_numero",
    },
    // L'OF : par defaut ceux qu'on peut encore servir (prevus, lances), comme
    // `/api/machines/of-ouverts`, les lances d'abord.
    TypeRecherche {
        nom: "of",
        modules: &[module::PLANS, module::MOUVEMENTS],
        grille: module::PLANS,
        selection: "o.id_of, o.numero, o.statut, o.code_qualite, q.nom AS qualite_nom, o.date_of,
                    o.date_fin_prevue, o.metrage_m2::float8 AS metrage_m2",
        depuis: "ordre_fabrication o LEFT JOIN qualite q ON q.code_qualite = o.code_qualite",
        cle: "o.id_of",
        cherche: &[
            ("o.numero", "numero"),
            ("o.code_qualite", "code_qualite"),
            ("q.nom", "qualite_nom"),
        ],
        defaut: "o.statut IN ('PREVU', 'LANCE')",
        filtres: &[liste("statut", "o.statut"), egal("code_qualite", "o.code_qualite")],
        tri: "CASE o.statut WHEN 'LANCE' THEN 0 ELSE 1 END, o.date_of DESC, o.numero",
    },
    // LA QUALITE non cloturee, comme les listes du plan et de la machine ; avec
    // le drapeau de recette (sans recette, le prevu d'un OF ne se calcule pas).
    TypeRecherche {
        nom: "qualite",
        modules: &[module::QUALITES, module::PLANS, module::MOUVEMENTS],
        grille: module::QUALITES,
        selection: "q.code_qualite, q.nom AS qualite_nom, q.statut,
                    EXISTS (SELECT 1 FROM v_recette_calculee rc
                             WHERE rc.code_qualite = q.code_qualite AND rc.kg_m2 IS NOT NULL) AS a_recette",
        depuis: "qualite q",
        cle: "q.code_qualite",
        cherche: &[("q.code_qualite", "code_qualite"), ("q.nom", "qualite_nom")],
        defaut: "q.statut IS DISTINCT FROM 'CLOTURE'",
        filtres: &[liste("statut", "q.statut")],
        tri: "q.code_qualite",
    },
    // LA RECEPTION, la plus recente d'abord ; les memes colonnes d'en-tete que
    // la liste des receptions (l'etat imprime en a besoin).
    TypeRecherche {
        nom: "reception",
        modules: &[module::RECEPTIONS],
        grille: module::RECEPTIONS,
        selection: "rc.*, f.nom AS fournisseur_nom,
                    COALESCE(bc.numero_bc,
                             (SELECT string_agg(DISTINCT b2.numero_bc, ', ')
                                FROM ligne_reception l2
                                JOIN ligne_bc lb2    ON lb2.id_ligne_bc = l2.id_ligne_bc
                                JOIN bon_commande b2 ON b2.id_bc = lb2.id_bc
                               WHERE l2.id_reception = rc.id_reception)) AS numero_bc,
                    up.login AS receptionnaire, uc.login AS controleur,
                    (SELECT COUNT(*) FROM ligne_reception l WHERE l.id_reception = rc.id_reception) AS nb_lignes,
                    (SELECT COALESCE(SUM(l.quantite_stock_kg), 0) FROM ligne_reception l
                      WHERE l.id_reception = rc.id_reception)::float8 AS kg_recus",
        depuis: "reception rc
                 JOIN fournisseur f ON f.code_fournisseur = rc.code_fournisseur
                 LEFT JOIN bon_commande bc ON bc.id_bc = rc.id_bc
                 LEFT JOIN utilisateur up  ON up.id_utilisateur = rc.id_utilisateur_reception
                 LEFT JOIN utilisateur uc  ON uc.id_utilisateur = rc.id_utilisateur_controle",
        cle: "rc.id_reception",
        cherche: &[
            ("rc.numero_reception", "numero_reception"),
            ("f.nom", "fournisseur_nom"),
            ("rc.num_bon_livraison", "num_bon_livraison"),
            ("bc.numero_bc", "numero_bc"),
        ],
        defaut: "",
        filtres: &[liste("statut", "rc.statut"), egal("code_fournisseur", "rc.code_fournisseur")],
        tri: "rc.date_reception DESC, rc.numero_reception DESC",
    },
    // LE TYPE DE FRAIS D'IMPORT (le parametrage `parametres_frais`), au droit
    // de lire les parametres, comme `/api/types-frais`.
    TypeRecherche {
        nom: "type-frais",
        modules: &[module::PARAMETRES],
        grille: module::PARAMETRES,
        selection: "p.id_frais, p.libelle, p.categorie, p.methode_repartition,
                    p.inclus_dans_cout, p.recuperable, p.actif",
        depuis: "parametres_frais p",
        cle: "p.id_frais",
        cherche: &[("p.id_frais", "id_frais"), ("p.libelle", "libelle"), ("p.categorie", "categorie")],
        defaut: "p.actif = 1",
        filtres: &[liste("categorie", "p.categorie")],
        tri: "p.ordre, p.libelle",
    },
];

/// Ce qu'on lie a la requete : un texte, ou une liste de textes.
#[derive(Debug, PartialEq)]
enum Lien {
    Texte(String),
    Liste(Vec<String>),
}

/// Un mot tape, pret pour `ILIKE` : les jokers tapes se cherchent tels quels.
fn motif_ilike(mot: &str) -> String {
    let mut s = String::with_capacity(mot.len() + 2);
    s.push('%');
    for c in mot.chars() {
        if matches!(c, '\\' | '%' | '_') {
            s.push('\\');
        }
        s.push(c);
    }
    s.push('%');
    s
}

pub const LIMITE_DEFAUT: i64 = 20;
pub const LIMITE_MAX: i64 = 100;
/// Relire au plus ce nombre de valeurs d'un coup (`valeur` repete).
const VALEURS_MAX: usize = 200;

/// La requete assemblee : conditions, valeurs liees, limite.
#[derive(Debug)]
struct Requete {
    ou: String,
    liens: Vec<Lien>,
    limite: i64,
    relecture: bool,
}

/// Assemble les conditions, sans base : testable tel quel.
///
/// `cherchables` : les colonnes de recherche que l'utilisateur VOIT.
fn assembler(
    t: &TypeRecherche,
    params: &[(String, String)],
    cherchables: &[&str],
) -> AppResult<Requete> {
    let mut conditions: Vec<String> = Vec::new();
    let mut liens: Vec<Lien> = Vec::new();
    let tous_valeurs = |cle: &str| -> Vec<String> {
        params
            .iter()
            .filter(|(c, v)| c == cle && !v.trim().is_empty())
            .map(|(_, v)| v.trim().to_string())
            .collect()
    };

    // Un parametre inconnu est refuse : ignore, il rendrait une liste fausse.
    for (c, _) in params {
        let connu = matches!(c.as_str(), "recherche" | "limite" | "valeur" | "exclure" | "tous")
            || t.filtres.iter().any(|f| f.param == c);
        if !connu {
            return Err(AppError::Invalide(format!("filtre inconnu pour « {} » : {c}", t.nom)));
        }
    }

    let valeurs = tous_valeurs("valeur");
    let relecture = !valeurs.is_empty();
    if valeurs.len() > VALEURS_MAX {
        return Err(AppError::Invalide(format!("au plus {VALEURS_MAX} valeurs a relire d'un coup")));
    }
    let tous = params.iter().any(|(c, v)| c == "tous" && (v == "1" || v == "true"));

    if relecture {
        liens.push(Lien::Liste(valeurs.clone()));
        conditions.push(format!("{}::text = ANY(${})", t.cle, liens.len()));
    } else if !tous && !t.defaut.is_empty() {
        conditions.push(format!("({})", t.defaut));
    }

    for f in t.filtres {
        let vs = tous_valeurs(f.param);
        if vs.is_empty() {
            continue;
        }
        match f.genre {
            Genre::Egal => {
                if vs.len() > 1 {
                    return Err(AppError::Invalide(format!("« {} » n'accepte qu'une valeur", f.param)));
                }
                liens.push(Lien::Texte(vs[0].clone()));
                conditions.push(format!("{}::text = ${}", f.expr, liens.len()));
            }
            Genre::Liste => {
                liens.push(Lien::Liste(vs));
                conditions.push(format!("{}::text = ANY(${})", f.expr, liens.len()));
            }
        }
    }

    let exclus = tous_valeurs("exclure");
    if !exclus.is_empty() {
        liens.push(Lien::Liste(exclus));
        conditions.push(format!("NOT ({}::text = ANY(${}))", t.cle, liens.len()));
    }

    let motif = params
        .iter()
        .find(|(c, _)| c == "recherche")
        .map(|(_, v)| v.as_str())
        .unwrap_or("");
    // Huit mots suffisent a toute recherche reelle ; au-dela, on borne la requete.
    for mot in motif.split_whitespace().take(8) {
        if cherchables.is_empty() {
            // Rien de visible ou chercher : on ne trouve rien, on ne devine pas.
            conditions.push("FALSE".into());
            break;
        }
        liens.push(Lien::Texte(motif_ilike(mot)));
        let i = liens.len();
        conditions.push(format!(
            "({})",
            cherchables
                .iter()
                .map(|e| format!("COALESCE(({e})::text, '') ILIKE ${i}"))
                .collect::<Vec<_>>()
                .join(" OR ")
        ));
    }

    let limite = if relecture {
        valeurs.len() as i64
    } else {
        params
            .iter()
            .find(|(c, _)| c == "limite")
            .and_then(|(_, v)| v.trim().parse::<i64>().ok())
            .unwrap_or(LIMITE_DEFAUT)
            .clamp(1, LIMITE_MAX)
    };

    let ou = if conditions.is_empty() { "TRUE".to_string() } else { conditions.join(" AND ") };
    Ok(Requete { ou, liens, limite, relecture })
}

fn lier<'q>(
    mut q: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    liens: &'q [Lien],
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    for l in liens {
        q = match l {
            Lien::Texte(s) => q.bind(s.as_str()),
            Lien::Liste(v) => q.bind(v.as_slice()),
        };
    }
    q
}

/// `GET /api/recherche/{type}`
pub async fn rechercher(
    State(state): State<AppState>,
    user: Utilisateur,
    Path(nom): Path<String>,
    Query(params): Query<Vec<(String, String)>>,
) -> AppResult<Json<Value>> {
    let t = TYPES
        .iter()
        .find(|t| t.nom == nom)
        .ok_or_else(|| AppError::Introuvable(format!("type de recherche {nom}")))?;

    // LIRE l'un des modules suffit ; aucun : le refus nomme le premier.
    let mut permis = false;
    for m in t.modules {
        if rbac::a_permission(&state.db, &user.role, m, Action::Lire).await? {
            permis = true;
            break;
        }
    }
    if !permis {
        return Err(AppError::NonAutorise {
            module: t.modules[0].to_string(),
            action: Action::Lire.as_str().to_string(),
        });
    }

    // ON NE CHERCHE PAS DANS CE QU'ON NE VOIT PAS : la grille du module, et les
    // montants masques partout (meme union que le masquage de sortie).
    let mut droits = user.droits(&state.db, t.grille).await?;
    for (champ, niveau) in rbac::sensibles_masques(&state.db, &user.id).await? {
        droits.entry(champ).or_insert(niveau);
    }
    let cherchables: Vec<&str> = t
        .cherche
        .iter()
        .filter(|(_, champ)| !matches!(droits.get(*champ), Some(Niveau::Masque)))
        .map(|(e, _)| *e)
        .collect();

    let r = assembler(t, &params, &cherchables)?;

    let sql = format!(
        "SELECT {} FROM {} WHERE {} ORDER BY {} LIMIT {}",
        t.selection, t.depuis, r.ou, t.tri, r.limite
    );
    let rows = lier(sqlx::query(&sql), &r.liens).fetch_all(&state.db).await?;
    let rendues = rows.len() as i64;

    // LE TOTAL, compte avec les memes conditions : c'est lui qui dit « il y en a
    // plus, affinez ». Inutile quand la page n'est pas pleine.
    let total = if r.relecture || rendues < r.limite {
        rendues
    } else {
        let sql_total = format!("SELECT COUNT(*) FROM {} WHERE {}", t.depuis, r.ou);
        let mut q = sqlx::query_scalar::<_, i64>(&sql_total);
        for l in &r.liens {
            q = match l {
                Lien::Texte(s) => q.bind(s.as_str()),
                Lien::Liste(v) => q.bind(v.as_slice()),
            };
        }
        q.fetch_one(&state.db).await?
    };

    let mut lignes = lignes_en_json(&rows);
    user.masquer(&state.db, t.grille, &mut lignes).await?;
    Ok(Json(json!({
        "type": t.nom,
        "lignes": lignes,
        "total": total,
        "plus": total > rendues,
        "limite": r.limite,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(nom: &str) -> &'static TypeRecherche {
        TYPES.iter().find(|t| t.nom == nom).unwrap()
    }
    fn p(v: &[(&str, &str)]) -> Vec<(String, String)> {
        v.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect()
    }

    #[test]
    fn chaque_mot_est_cherche_en_et() {
        let ty = t("fournisseur");
        let r = assembler(ty, &p(&[("recherche", "  bleu 1500 ")]), &["f.code_fournisseur", "f.nom"]).unwrap();
        assert_eq!(r.liens, vec![Lien::Texte("%bleu%".into()), Lien::Texte("%1500%".into())]);
        assert!(r.ou.starts_with("(f.actif = 1) AND ("));
        assert!(r.ou.contains("$1") && r.ou.contains("$2"));
        assert_eq!(r.limite, LIMITE_DEFAUT);
    }

    #[test]
    fn les_jokers_tapes_se_cherchent_tels_quels() {
        assert_eq!(motif_ilike("10%_a\\b"), "%10\\%\\_a\\\\b%");
    }

    #[test]
    fn la_limite_est_plafonnee() {
        let ty = t("lot");
        assert_eq!(assembler(ty, &p(&[("limite", "100000")]), &[]).unwrap().limite, LIMITE_MAX);
        assert_eq!(assembler(ty, &p(&[("limite", "0")]), &[]).unwrap().limite, 1);
    }

    #[test]
    fn la_relecture_leve_le_filtre_par_defaut() {
        let ty = t("fournisseur");
        let r = assembler(ty, &p(&[("valeur", "A"), ("valeur", "B")]), &[]).unwrap();
        assert!(!r.ou.contains("actif"));
        assert_eq!(r.limite, 2);
        assert!(r.relecture);
    }

    #[test]
    fn un_filtre_inconnu_est_refuse() {
        assert!(assembler(t("bc"), &p(&[("prix", "1")]), &[]).is_err());
        assert!(assembler(t("bc"), &p(&[("statut", "BROUILLON"), ("statut", "VALIDE")]), &[]).is_ok());
        assert!(assembler(t("lot"), &p(&[("code_magasin", "A"), ("code_magasin", "B")]), &[]).is_err());
    }

    #[test]
    fn sans_colonne_visible_on_ne_trouve_rien() {
        let r = assembler(t("fournisseur"), &p(&[("recherche", "x")]), &[]).unwrap();
        assert!(r.ou.ends_with("FALSE"));
    }

    #[test]
    fn les_types_sont_uniques() {
        let mut noms: Vec<_> = TYPES.iter().map(|t| t.nom).collect();
        noms.sort();
        noms.dedup();
        assert_eq!(noms.len(), TYPES.len());
    }
}
