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
//! L'ECRITURE PORTE LA CONDITION (decision du 19/10/2026). Le test se fait
//! dans l'ecriture elle-meme, pas par une lecture prealable :
//! `UPDATE … WHERE id = $1 AND version = $2`. Une ligne touchee : c'est passe ;
//! aucune : quelqu'un est passe avant. Un seul aller-retour, aucun instant entre
//! le test et l'ecriture, et PostgreSQL tient la ligne jusqu'a la fin de la
//! transaction. Les fiches (crud.rs) mettent la condition dans leur `UPDATE` /
//! `DELETE` meme ; les documents, qui ecrivent en-tete puis lignes, la mettent
//! dans leur PREMIERE ecriture — ce module —, qui tient l'en-tete pour la suite.

use crate::error::{AppError, AppResult};

/// Prend le document a la version lue, par une ecriture conditionnelle.
///
/// Premiere ecriture de la transaction : elle tient l'en-tete jusqu'au bout, et
/// les lignes enregistrees ensuite sont couvertes. `version_lue` absente : rien
/// a verifier (appelants internes : cascades, administration, import).
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
    // LE NOM DE LA TABLE N'EST JAMAIS DE LA SAISIE : un litteral du code appelant.
    // `::text` : la cle n'est pas toujours du texte (le mois d'une saison).
    let sql = format!("UPDATE {table} SET version = version WHERE {colonne_id}::text = $1 AND version = $2");
    let touchees = sqlx::query(&sql).bind(id).bind(attendue).execute(&mut *tx).await?.rows_affected();
    if touchees == 1 {
        return Ok(());
    }
    Err(refus(tx, table, colonne_id, id, quoi).await)
}

/// Aucune ligne touchee par une ecriture conditionnelle : supprimee, ou modifiee
/// par quelqu'un — on le dit, en nommant qui et quand. Calcule seulement en cas
/// d'echec.
pub async fn refus(
    tx: &mut sqlx::PgConnection,
    table: &str,
    colonne_id: &str,
    id: &str,
    quoi: &str,
) -> AppError {
    let existe = sqlx::query_scalar::<_, i32>(&format!("SELECT 1 FROM {table} WHERE {colonne_id}::text = $1"))
        .bind(id)
        .fetch_optional(&mut *tx)
        .await;
    match existe {
        Ok(Some(_)) => AppError::Conflit(message_conflit(tx, table, id, quoi).await),
        Ok(None) => AppError::Introuvable(format!("{quoi} introuvable.")),
        Err(e) => e.into(),
    }
}

/// La version a jour d'un document, rendue a l'ecran qui enchaine en-tete puis
/// lignes : chaque enregistrement presente celle que le precedent a laissee.
pub async fn version_actuelle(
    tx: &mut sqlx::PgConnection,
    table: &str,
    colonne_id: &str,
    id: &str,
) -> AppResult<i64> {
    Ok(sqlx::query_scalar(&format!("SELECT version::bigint FROM {table} WHERE {colonne_id}::text = $1"))
        .bind(id)
        .fetch_one(&mut *tx)
        .await?)
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
        "SELECT u.nom, fn_iso(a.date_operation)
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
