//! L'ASSISTANT DE COMPLETION DU CATALOGUE.
//!
//! Une reference interne est une phrase, pas un identifiant opaque :
//!
//!     categorie - famille - couleur (ou origine) - ref fournisseur - fournisseur
//!     PES       - 3000 Deniers    - Khave        - Ssl2279         - Suj
//!
//! Les 124 references existantes portent cette phrase dans leur code, mais pas
//! dans leurs colonnes. Cet ecran les remplit — sans les resaisir une a une.
//!
//! IL PROPOSE, IL N'ECRIT PAS. Chaque ligne part avec un degre de certitude, et
//! c'est l'utilisateur qui accepte. Une reference mal rattachee vaut moins
//! qu'une reference non rattachee : elle se propage en equivalence fausse, donc
//! en achat fausse. La consigne est « le plus proche, et demande le reste » ;
//! « demander » veut dire laisser la case vide avec ses candidats a cote, pas
//! choisir le moins mauvais en silence.
//!
//! TROIS SOURCES, PAR ORDRE DE SURETE :
//!   * la FAMILLE se deduit de (categorie, titrage) — deux colonnes deja
//!     saisies, donc aucune lecture du code ;
//!   * la COULEUR INTERNE se deduit du libelle de couleur deja saisi, puis des
//!     codes couleur du fournisseur ;
//!   * la REFERENCE FOURNISSEUR, elle, ne vit que dans le code : il faut la
//!     lire. C'est la seule partie devinee, et la plus surveillee.

use crate::auth::{rbac::module, Utilisateur};
use crate::error::AppResult;
use crate::AppState;
use axum::extract::State;
use axum::Json;
use serde_json::{json, Value};
use sqlx::Row;

/// Majuscules, sans accent, sans espace : pour comparer « 2650 dtex » a
/// « 2650 Dtex » sans se soucier de la frappe.
fn norme(s: &str) -> String {
    s.chars()
        .filter_map(|c| match c {
            'à' | 'â' | 'ä' => Some('A'),
            'é' | 'è' | 'ê' | 'ë' => Some('E'),
            'î' | 'ï' => Some('I'),
            'ô' | 'ö' => Some('O'),
            'ù' | 'û' | 'ü' => Some('U'),
            'ç' => Some('C'),
            c if c.is_alphanumeric() => Some(c.to_ascii_uppercase()),
            _ => None,
        })
        .collect()
}

/// LA REFERENCE DU FOURNISSEUR, lue dans le code interne.
///
/// On cherche le DERNIER groupe de chiffres du code, puis on l'etend vers la
/// gauche sur son prefixe de lettres (« Ssl », « Fdy », « Cb ») et vers la
/// droite sur une lettre collee (« Cb-7A »).
///
/// TROIS REFUS, chacun paye par un contre-exemple reel :
///   * ce qui suit porte un chiffre — alors le groupe trouve est le titrage et
///     non la reference (« PES-3000 Deniers- Khave Ssl2279-Suj ») ;
///   * le groupe est precede de « / » ou « , » — c'est un titrage de retorsion
///     (« Jute 12/1 », « PES-20/2 GLOBALTEX ») ;
///   * le groupe EST le titrage (« Plastique-100 »).
fn reference_fournisseur(code: &str, titrage: &str) -> Option<String> {
    let c: Vec<char> = code.chars().collect();

    // Le dernier groupe de chiffres.
    let fin = c.iter().rposition(|x| x.is_ascii_digit())?;
    let mut debut = fin;
    while debut > 0 && c[debut - 1].is_ascii_digit() {
        debut -= 1;
    }

    // Ce qui suit ne doit porter aucun chiffre : sinon ce groupe-ci n'est pas
    // le dernier mot du code, c'est le titrage au milieu.
    let mut apres = fin + 1;
    let mut lettres_collees = 0;
    while apres < c.len() && c[apres].is_alphabetic() && lettres_collees < 2 {
        apres += 1;
        lettres_collees += 1;
    }
    if c[apres.min(c.len())..].iter().any(|x| x.is_ascii_digit()) {
        return None;
    }
    // « Cp-1005Turk » : quatre lettres collees, c'est le fournisseur, pas la
    // reference. On ne garde la lettre que si elle est seule ou double.
    if apres < c.len() && c[apres].is_alphabetic() {
        apres = fin + 1;
    }

    // Un chiffre precede de « / » ou « , » appartient a un titrage.
    if debut > 0 && (c[debut - 1] == '/' || c[debut - 1] == ',') {
        return None;
    }

    // Le prefixe de lettres, avec son separateur eventuel (« Fdy-542030 »,
    // « Cb -1005 », « H-2000 », « Dtbc-H69 »).
    let mut gauche = debut;
    if gauche > 0 && c[gauche - 1].is_alphabetic() && c[gauche - 1].is_uppercase() {
        gauche -= 1; // « Dtbc-H69 » : la majuscule interne.
    }
    let mut separateurs = 0;
    let mut avec_tiret = false;
    while gauche > 0 && (c[gauche - 1] == '-' || c[gauche - 1] == ' ') && separateurs < 2 {
        avec_tiret |= c[gauche - 1] == '-';
        gauche -= 1;
        separateurs += 1;
    }
    // LE TIRET FAIT LE PREFIXE, L'ESPACE FAIT UN MOT. « Cp-1432 » est une
    // reference du fournisseur ; « Bleu 1271 » est une couleur suivie d'un
    // numero, et avaler « Bleu » donnerait une reference fausse. Sans aucun
    // separateur, les lettres sont collees au nombre (« WhiteSsl2331 ») : on
    // les prend, en s'arretant a la majuscule.
    let mut lettres = 0;
    if separateurs == 0 || avec_tiret {
        while gauche > 0 && c[gauche - 1].is_alphabetic() && lettres < 4 {
            gauche -= 1;
            lettres += 1;
        }
    }
    // Un prefixe qui touche le debut du mot precedent sans separateur n'est pas
    // sur : « WhiteSsl2331 » donne bien « Ssl2331 » parce qu'on s'arrete a
    // quatre lettres, mais on exige alors que la lettre initiale soit une
    // majuscule — sinon on a coupe un mot en deux.
    while gauche < debut && !c[gauche].is_uppercase() && c[gauche].is_alphabetic() {
        gauche += 1;
    }
    if lettres == 0 && separateurs == 1 && gauche > 0 && c[gauche - 1].is_ascii_digit() {
        // « 1305-129 » : une reference en deux nombres. Le tiret est interne,
        // pas un separateur de mots.
        let mut chiffres = 0;
        while gauche > 0 && c[gauche - 1].is_ascii_digit() && chiffres < 5 {
            gauche -= 1;
            chiffres += 1;
        }
    } else if lettres == 0 && separateurs > 0 {
        gauche = debut; // « Deniers- 61043 » : le separateur seul ne compte pas.
    }

    let chunk: String = c[gauche..apres].iter().collect();
    let chunk = chunk.trim().trim_matches('-').trim().to_string();
    if chunk.is_empty() || norme(&chunk) == norme(titrage) {
        return None;
    }
    Some(chunk)
}

/// `GET /api/catalogue/completion` — ce qu'il manque a chaque reference, et ce
/// que l'assistant propose d'y mettre.
pub async fn completion(
    State(state): State<AppState>,
    user: Utilisateur,
) -> AppResult<Json<Value>> {
    let db = &state.db;
    user.exiger(db, module::CATALOGUE, crate::auth::rbac::Action::Lire).await?;

    let refs = sqlx::query(
        "SELECT r.code_reference, r.code_categorie, r.code_fournisseur, r.designation,
                COALESCE(r.couleur, '')  AS couleur,
                COALESCE(r.titrage, '')  AS titrage,
                r.code_famille, r.code_couleur_interne,
                COALESCE(r.reference_fournisseur, '') AS reference_fournisseur,
                COALESCE(r.origine, '')  AS origine,
                -- LES INFORMATIONS CRITIQUES. Sans elles une reference existe
                -- mais ne sert a rien : on ne peut ni la commander (prix), ni
                -- la peser en bobines (conditionnement), ni la reconnaitre sur
                -- une facture (code couleur du fournisseur).
                COALESCE(r.code_couleur, '') AS code_couleur,
                r.prix_catalogue::float8     AS prix_catalogue,
                r.poids_bobine_kg::float8    AS poids_bobine_kg,
                r.bobines_par_palette,
                COALESCE(r.unite_catalogue, 'kg') AS unite_catalogue,
                cat.libelle AS categorie_libelle
           FROM reference r
           LEFT JOIN categorie_matiere cat ON cat.code_categorie = r.code_categorie
          WHERE r.actif = 1
          ORDER BY r.code_categorie, r.code_reference",
    )
    .fetch_all(db)
    .await?;

    let familles = sqlx::query(
        "SELECT code_famille, libelle, COALESCE(titrage, '') AS titrage, code_categorie
           FROM famille WHERE actif = 1 ORDER BY code_categorie, libelle",
    )
    .fetch_all(db)
    .await?;
    let familles: Vec<(String, String, String, String)> = familles
        .iter()
        .map(|f| {
            (
                f.get::<String, _>("code_famille"),
                f.get::<String, _>("libelle"),
                f.get::<String, _>("titrage"),
                f.get::<Option<String>, _>("code_categorie").unwrap_or_default(),
            )
        })
        .collect();

    let couleurs = sqlx::query("SELECT code_couleur_interne, libelle FROM couleur ORDER BY code_couleur_interne")
        .fetch_all(db)
        .await?;
    let couleurs: Vec<(String, String)> = couleurs
        .iter()
        .map(|c| {
            (
                c.get::<String, _>("code_couleur_interne"),
                c.get::<String, _>("libelle"),
            )
        })
        .collect();

    // LE CONDITIONNEMENT SE DEDUIT DES REFERENCES SOEURS.
    //
    // Le poids d'une bobine et le nombre de bobines par palette sont une
    // propriete du couple (famille, fournisseur) : le meme fil, chez le meme
    // vendeur, arrive dans le meme emballage. Quand toutes les references deja
    // renseignees d'un couple s'accordent sur une valeur, on la propose ; des
    // qu'elles divergent, on ne propose rien — deux emballages coexistent, et
    // c'est a l'humain de dire lequel.
    //
    // `COUNT(DISTINCT)` ignore les NULL : un groupe ou une seule reference porte
    // la valeur compte donc UN, ce qui est exactement le cas a propager.
    let colis = sqlx::query(
        "SELECT code_famille, code_fournisseur,
                COUNT(DISTINCT poids_bobine_kg)     AS n_poids,
                MIN(poids_bobine_kg)::float8        AS poids,
                COUNT(DISTINCT bobines_par_palette) AS n_bobines,
                MIN(bobines_par_palette)            AS bobines
           FROM reference
          WHERE actif = 1 AND code_famille IS NOT NULL AND code_fournisseur IS NOT NULL
          GROUP BY code_famille, code_fournisseur",
    )
    .fetch_all(db)
    .await?;
    let colis: Vec<(String, String, i64, Option<f64>, i64, Option<i64>)> = colis
        .iter()
        .map(|c| {
            (
                c.get::<String, _>("code_famille"),
                c.get::<String, _>("code_fournisseur"),
                c.get::<i64, _>("n_poids"),
                c.get::<Option<f64>, _>("poids"),
                c.get::<i64, _>("n_bobines"),
                c.get::<Option<i64>, _>("bobines"),
            )
        })
        .collect();

    // Les codes couleur de chaque fournisseur : « RED 7612 » chez Hasirci, c'est
    // le C3 de la maison.
    let cf = sqlx::query(
        "SELECT code_fournisseur, code_couleur, COALESCE(libelle, '') AS libelle,
                code_couleur_interne
           FROM couleur_fournisseur",
    )
    .fetch_all(db)
    .await?;

    let mut lignes: Vec<Value> = Vec::new();
    let (mut sur_famille, mut sur_couleur, mut sur_ref) = (0, 0, 0);
    // Ce qui manque encore APRES deduction : c'est le vrai reste a faire.
    let (mut sans_prix, mut sans_colis, mut sans_code_couleur) = (0, 0, 0);

    for r in &refs {
        let code: String = r.get("code_reference");
        let categorie: Option<String> = r.get("code_categorie");
        let categorie = categorie.unwrap_or_default();
        let fournisseur: Option<String> = r.get("code_fournisseur");
        let fournisseur = fournisseur.unwrap_or_default();
        let couleur: String = r.get("couleur");
        let titrage: String = r.get("titrage");

        // --- La famille : (categorie, titrage). Une seule candidate = sure.
        let candidates_famille: Vec<&(String, String, String, String)> = familles
            .iter()
            .filter(|(_, _, _, cat)| *cat == categorie)
            .collect();
        let par_titrage: Vec<&&(String, String, String, String)> = candidates_famille
            .iter()
            .filter(|(_, _, tit, _)| {
                !titrage.is_empty() && !tit.is_empty() && norme(tit).starts_with(&norme(&titrage))
            })
            .collect();
        let (famille_proposee, famille_sure) = match par_titrage.len() {
            1 => (Some(par_titrage[0].0.clone()), true),
            _ => (None, false),
        };
        if famille_sure {
            sur_famille += 1;
        }

        // --- La couleur interne : le libelle deja saisi, puis le code du
        //     fournisseur. Sans correspondance, on ne choisit pas.
        let mut couleur_proposee = couleurs
            .iter()
            .find(|(_, lib)| !couleur.is_empty() && norme(lib) == norme(&couleur))
            .map(|(c, _)| c.clone());
        if couleur_proposee.is_none() && !couleur.is_empty() {
            couleur_proposee = cf
                .iter()
                .find(|x| {
                    x.get::<String, _>("code_fournisseur") == fournisseur
                        && (norme(&x.get::<String, _>("libelle")) == norme(&couleur)
                            || norme(&x.get::<String, _>("code_couleur")) == norme(&couleur))
                })
                .map(|x| x.get::<String, _>("code_couleur_interne"));
        }
        if couleur_proposee.is_some() {
            sur_couleur += 1;
        }

        // --- La reference du fournisseur, lue dans le code.
        let ref_four = reference_fournisseur(&code, &titrage);
        if ref_four.is_some() {
            sur_ref += 1;
        }

        let actuel_famille: Option<String> = r.get("code_famille");
        let actuel_couleur: Option<String> = r.get("code_couleur_interne");
        let actuel_ref: String = r.get("reference_fournisseur");
        let actuel_origine: String = r.get("origine");

        // --- LES INFORMATIONS CRITIQUES ---------------------------------
        //
        // Ce qui manque ici ne se voit pas a l'ecran du catalogue : une
        // reference sans prix ne peut pas etre commandee, une reference sans
        // poids de bobine ne peut pas etre pesee au quai, une reference sans
        // code couleur fournisseur ne peut pas etre reconnue sur une facture.
        // L'assistant propose ce qui se DEDUIT et nomme ce qui ne se deduit pas.
        let actuel_code_couleur: String = r.get("code_couleur");
        let actuel_prix: Option<f64> = r.get("prix_catalogue");
        let actuel_poids: Option<f64> = r.get("poids_bobine_kg");
        let actuel_bobines: Option<i64> = r.get("bobines_par_palette");
        let unite: String = r.get("unite_catalogue");

        // La famille retenue — deja posee, ou proposee a l'instant — sert de
        // socle aux deductions qui suivent.
        let famille_retenue = actuel_famille.clone().or_else(|| famille_proposee.clone());

        // LE TITRAGE VIENT DE LA FAMILLE. C'est elle qui le porte : « 1500 dtex »
        // n'est pas une propriete du fournisseur, c'est la finesse du fil.
        let titrage_propose = if titrage.is_empty() {
            famille_retenue
                .as_ref()
                .and_then(|f| familles.iter().find(|(c, _, _, _)| c == f))
                .map(|(_, _, tit, _)| tit.clone())
                .filter(|t| !t.is_empty())
        } else {
            None
        };

        // LE CODE COULEUR DU FOURNISSEUR se lit dans la table des
        // correspondances : la couleur interne, chez CE vendeur.
        let couleur_retenue = actuel_couleur.clone().or_else(|| couleur_proposee.clone());
        let code_couleur_propose = if actuel_code_couleur.is_empty() {
            couleur_retenue.as_ref().and_then(|ci| {
                cf.iter()
                    .find(|x| {
                        x.get::<String, _>("code_fournisseur") == fournisseur
                            && x.get::<String, _>("code_couleur_interne") == *ci
                    })
                    .map(|x| x.get::<String, _>("code_couleur"))
            })
        } else {
            None
        };

        // LE CONDITIONNEMENT vient des references soeurs — meme famille, meme
        // fournisseur — quand elles s'accordent toutes sur une valeur.
        let groupe = famille_retenue.as_ref().and_then(|f| {
            colis
                .iter()
                .find(|(fam, frs, _, _, _, _)| fam == f && *frs == fournisseur)
        });
        let poids_propose = if actuel_poids.is_none() {
            groupe.filter(|(_, _, n, _, _, _)| *n == 1).and_then(|(_, _, _, p, _, _)| *p)
        } else {
            None
        };
        let bobines_proposees = if actuel_bobines.is_none() {
            groupe.filter(|(_, _, _, _, n, _)| *n == 1).and_then(|(_, _, _, _, _, b)| *b)
        } else {
            None
        };

        // CE QUI NE SE DEDUIT PAS, et qu'il faut donc aller chercher. Un prix ne
        // s'invente pas : le proposer d'apres une reference voisine donnerait un
        // cout de revient faux, et RG-08 interdit ce repli silencieux.
        let mut manque: Vec<&str> = Vec::new();
        if actuel_prix.unwrap_or(0.0) <= 0.0 {
            manque.push("prix_catalogue");
        }
        if actuel_poids.is_none() && poids_propose.is_none() && unite != "ml" {
            manque.push("poids_bobine_kg");
        }
        if actuel_bobines.is_none() && bobines_proposees.is_none() && unite != "ml" {
            manque.push("bobines_par_palette");
        }
        if actuel_code_couleur.is_empty() && code_couleur_propose.is_none() && couleur_retenue.is_some() {
            manque.push("code_couleur");
        }
        if titrage.is_empty() && titrage_propose.is_none() {
            manque.push("titrage");
        }

        // COMPLETE NE VEUT DIRE QUE « IDENTIFIEE ». Une reference peut etre
        // parfaitement classee et rester incommandable faute de prix : ce
        // second manque se lit dans `manque`, pas ici, sinon l'ecran melerait
        // deux questions — qui est cette matiere, et que sait-on d'elle.
        let complete = actuel_famille.is_some()
            && (actuel_couleur.is_some() || !actuel_origine.is_empty())
            && !actuel_ref.is_empty();

        if manque.contains(&"prix_catalogue") {
            sans_prix += 1;
        }
        if manque.contains(&"poids_bobine_kg") || manque.contains(&"bobines_par_palette") {
            sans_colis += 1;
        }
        if manque.contains(&"code_couleur") {
            sans_code_couleur += 1;
        }

        lignes.push(json!({
            "code_reference": code,
            "designation": r.get::<Option<String>, _>("designation"),
            "code_categorie": categorie,
            "categorie_libelle": r.get::<Option<String>, _>("categorie_libelle"),
            "code_fournisseur": fournisseur,
            "couleur": couleur,
            "titrage": titrage,
            "complete": complete,
            "actuel": {
                "code_famille": actuel_famille,
                "code_couleur_interne": actuel_couleur,
                "reference_fournisseur": actuel_ref,
                "origine": actuel_origine,
                "titrage": titrage,
                "code_couleur": actuel_code_couleur,
                "prix_catalogue": actuel_prix,
                "poids_bobine_kg": actuel_poids,
                "bobines_par_palette": actuel_bobines,
                "unite_catalogue": unite,
            },
            "propose": {
                "code_famille": famille_proposee,
                "code_couleur_interne": couleur_proposee,
                "reference_fournisseur": ref_four,
                "titrage": titrage_propose,
                "code_couleur": code_couleur_propose,
                "poids_bobine_kg": poids_propose,
                "bobines_par_palette": bobines_proposees,
            },
            // Ce qu'aucune deduction ne peut fournir : il faut aller le chercher
            // chez le fournisseur ou sur une facture.
            "manque": manque,
            // Les candidats a proposer quand l'assistant ne tranche pas : c'est
            // la forme que prend « je demande ».
            "familles_possibles": candidates_famille.iter()
                .map(|(c, lib, tit, _)| json!({ "code": c, "libelle": lib, "titrage": tit }))
                .collect::<Vec<_>>(),
        }));
    }

    Ok(Json(json!({
        "lignes": lignes,
        "couleurs": couleurs.iter()
            .map(|(c, lib)| json!({ "code": c, "libelle": lib })).collect::<Vec<_>>(),
        "bilan": {
            "references": refs.len(),
            "famille_sure": sur_famille,
            "couleur_sure": sur_couleur,
            "reference_fournisseur_lue": sur_ref,
            "sans_prix": sans_prix,
            "sans_conditionnement": sans_colis,
            "sans_code_couleur": sans_code_couleur,
        },
    })))
}

#[cfg(test)]
mod tests {
    use super::reference_fournisseur as rf;

    /// Les cas viennent tous du catalogue reel : ce sont les codes qui ont
    /// mis en defaut les versions precedentes du lecteur.
    #[test]
    fn lit_la_reference_du_fournisseur() {
        assert_eq!(rf("PES-3000 Deniers- Khave Ssl2279-Suj", "3000"), Some("Ssl2279".into()));
        assert_eq!(rf("PES-3000 Deniers- WhiteSsl2331-Suj", "3000"), Some("Ssl2331".into()));
        assert_eq!(rf("Micro PES-7360 Deniers-Multi Beige 1305-129-Suj", "7360"), Some("1305-129".into()));
        assert_eq!(rf("PES Fdy-1500 Deniers-Gold Fdy-33005-Gzm", "1500"), Some("Fdy-33005".into()));
        assert_eq!(rf("PES Fdy -1800 Deniers-Gold Cf-101 Turk", "1800"), Some("Cf-101".into()));
        assert_eq!(rf("PES Ver-1500 Deniers-BleuTex-8100 Text", "1500"), Some("Tex-8100".into()));
        assert_eq!(rf("PES Sh-1500 Deniers- L.Beige H-2000-Tat", "1500"), Some("H-2000".into()));
        assert_eq!(rf("PES -1200 Deniers-Anty Bordeau 61043-Gzm", "1200"), Some("61043".into()));
        assert_eq!(rf("PES Sh-1200 Deniers-Cream B-Cb -1005 Sf", "1200"), Some("Cb -1005".into()));
    }

    /// LE MOT DE COULEUR N'EST PAS UN PREFIXE. Un espace separe deux mots, un
    /// tiret lie un prefixe a son numero — confondre les deux donnait
    /// « Bleu 1271 » comme reference du fournisseur.
    #[test]
    fn ne_prend_pas_la_couleur_pour_un_prefixe() {
        assert_eq!(rf("PES -1500 Deniers-D.Bleu 1271-Gzm", "1500"), Some("1271".into()));
        assert_eq!(rf("PES -1500 Deniers-Grey 1274-Gzm", "1500"), Some("1274".into()));
        assert_eq!(rf("PES Sh-1200 Deniers-Cpbt Grey 801-Tat", "1200"), Some("801".into()));
        assert_eq!(rf("Micro PES-3600 Deniers Ivory 15-Tat", "3600"), Some("15".into()));
        assert_eq!(rf("PES Sh-1200 Deniers-Beige Cp-1432 Sf", "1200"), Some("Cp-1432".into()));
    }

    /// Ce qu'il doit REFUSER de lire : un titrage n'est pas une reference.
    #[test]
    fn refuse_ce_qui_est_un_titrage() {
        assert_eq!(rf("Plastique-100", "100"), None);
        assert_eq!(rf("Jute 12/1", "12/1"), None);
        assert_eq!(rf("PES-20/2 GLOBALTEX", "20/2"), None);
        assert_eq!(rf("Cuir", ""), None);
        assert_eq!(rf("Bande", ""), None);
    }
}
