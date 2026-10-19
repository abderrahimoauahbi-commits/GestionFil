//! Verrou optimiste des documents a workflow (A2, 17/10/2026).
//!
//! LE DEFAUT QUE CE MODULE CORRIGE. Deux utilisateurs ouvrent le meme bon de
//! commande, le modifient, enregistrent l'un apres l'autre : le second ecrasait
//! le premier EN SILENCE. Personne n'etait averti, et la saisie perdue ne
//! laissait de trace que dans le journal d'audit — encore fallait-il penser a
//! l'interroger.
//!
//! LE PRINCIPE. Chaque document a workflow porte une colonne `version`, que le
//! declencheur `trg_aa_version` incremente a chaque modification (migration
//! `2026-10-17d`). Le client lit la version avec le document et la repasse
//! quand il enregistre. Si elle ne correspond plus, quelqu'un est passe avant :
//! on refuse, EN NOMMANT QUI ET QUAND. Un refus qui dit « quelqu'un a modifie
//! cette fiche » sans dire qui n'aide personne a rattraper sa saisie.
//!
//! POURQUOI UN GARDE PLUTOT QU'UN `AND version = $n` DANS CHAQUE `UPDATE`.
//! Trois raisons. Un seul comportement, donc un seul message a maintenir. Les
//! handlers qui font plusieurs `UPDATE` dans la meme transaction — `modifier_bc`
//! en fait trois — sont couverts par une seule verification. Et surtout, le
//! garde prend le verrou de ligne (`FOR UPDATE`) : entre la lecture de la
//! version et l'ecriture, plus personne ne passe. Ce n'est donc pas seulement
//! optimiste, c'est juste.

use crate::error::{AppError, AppResult};

/// Refuse la modification si le document a change depuis sa lecture.
///
/// `version_lue` vient du client. **Absente, la verification est sautee** : les
/// appelants internes (cascades de `domain/`, scripts d'administration, import)
/// ne la fournissent pas, et les ecrans qui ne l'envoient pas encore continuent
/// de fonctionner. La protection s'applique des que le client la transmet.
///
/// La ligne est verrouillee au passage : la suite de la transaction travaille
/// sur un document que personne d'autre ne peut modifier.
pub async fn exiger_version(
    tx: &mut sqlx::PgConnection,
    table: &str,
    colonne_id: &str,
    id: &str,
    version_lue: Option<i64>,
    quoi: &str,
) -> AppResult<()> {
    let Some(attendue) = version_lue else {
        return Ok(());
    };

    // LE NOM DE LA TABLE N'EST JAMAIS DE LA SAISIE. Il vient d'un litteral du
    // code appelant, jamais d'une requete HTTP : ces deux identifiants sont
    // interpoles, les valeurs restent liees.
    // `::bigint` : la colonne est un `integer` (INT4) et sqlx exige une
    // correspondance EXACTE — lire un INT4 en `i64` echoue a l'execution, en
    // « erreur interne », jamais a la compilation. Le scenario de banc
    // `verrou_optimiste` l'a trouve le 17/10 ; aucun des 47 autres ne passait
    // de version, donc aucun n'empruntait ce chemin.
    // `::text` : la cle d'un referentiel n'est pas toujours du texte (le mois
    // d'une saison est un entier, 19/10/2026) ; l'identifiant arrive du chemin,
    // donc en texte. Les tables visees sont petites : le parcours est negligeable.
    let sql = format!("SELECT version::bigint FROM {table} WHERE {colonne_id}::text = $1 FOR UPDATE");
    let actuelle: Option<i64> = sqlx::query_scalar(&sql).bind(id).fetch_optional(&mut *tx).await?;

    let actuelle = actuelle
        .ok_or_else(|| AppError::Introuvable(format!("{quoi} introuvable.")))?;

    if actuelle == attendue {
        return Ok(());
    }

    Err(AppError::Conflit(message_conflit(tx, table, id, quoi).await))
}

/// LA VERSION, OBLIGATOIRE (decision du 19/10/2026) : un ecran qui modifie un
/// document envoie celle qu'il a lue. Absente, on refuse plutot que d'ecraser
/// peut-etre la saisie d'un autre.
pub fn exigee(v: Option<i64>) -> AppResult<i64> {
    v.ok_or_else(|| {
        AppError::Invalide("Version du document manquante : rechargez-le avant d'enregistrer.".into())
    })
}

/// Le message du refus, qui nomme l'auteur et l'heure du changement.
///
/// L'auteur se lit dans le journal d'audit : c'est la seule source qui sache
/// qui a touche la fiche en dernier, quel que soit le chemin emprunte. Si le
/// journal ne dit rien — modification faite hors application —, on le dit
/// plutot que d'inventer un nom.
async fn message_conflit(
    tx: &mut sqlx::PgConnection,
    table: &str,
    id: &str,
    quoi: &str,
) -> String {
    let dernier: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT u.nom, a.date_operation
           FROM audit_log a
           LEFT JOIN utilisateur u ON u.id_utilisateur = a.id_utilisateur
          WHERE a.table_concernee = $1 AND a.id_enregistrement = $2
          ORDER BY a.date_operation DESC
          LIMIT 1",
    )
    .bind(table)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .ok()
    .flatten();

    match dernier {
        Some((Some(nom), Some(quand))) => format!(
            "{quoi} a ete modifie par {nom} le {} pendant votre saisie. \
             Rouvrez-le pour voir ses changements, puis refaites les votres.",
            horodatage_lisible(&quand)
        ),
        Some((Some(nom), None)) => format!(
            "{quoi} a ete modifie par {nom} pendant votre saisie. \
             Rouvrez-le pour voir ses changements, puis refaites les votres."
        ),
        _ => format!(
            "{quoi} a ete modifie pendant votre saisie. \
             Rouvrez-le pour voir les changements, puis refaites les votres."
        ),
    }
}

/// « 2026-10-17T14:32:05.123Z » devient « 17/10/2026 a 14:32 ».
///
/// Les dates sont stockees en texte ISO (dette A1 de l'audit du 17/10) : on
/// decoupe la chaine plutot que d'analyser une date, parce qu'un message
/// d'erreur ne doit jamais echouer a cause de son propre horodatage.
fn horodatage_lisible(iso: &str) -> String {
    let (date, heure) = match iso.split_once('T') {
        Some((d, h)) if d.len() == 10 && h.len() >= 5 => (d, &h[..5]),
        _ => return iso.to_string(),
    };
    match (date.get(0..4), date.get(5..7), date.get(8..10)) {
        (Some(a), Some(m), Some(j)) => format!("{j}/{m}/{a} a {heure}"),
        _ => iso.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::horodatage_lisible;

    #[test]
    fn horodatage_iso_devient_lisible() {
        assert_eq!(horodatage_lisible("2026-10-17T14:32:05.123Z"), "17/10/2026 a 14:32");
    }

    #[test]
    fn horodatage_illisible_est_rendu_tel_quel() {
        // Un message d'erreur ne doit jamais echouer a cause de son horodatage.
        assert_eq!(horodatage_lisible("hier"), "hier");
        assert_eq!(horodatage_lisible(""), "");
    }
}
