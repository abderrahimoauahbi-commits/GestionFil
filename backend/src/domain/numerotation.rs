//! Numerotation sequentielle des documents, par prefixe et par annee.
//!
//! CE MODULE VIENT DE `routes/stock.rs` (17/10/2026). Il y etait range par
//! commodite, et trois modules de `domain/` remontaient vers la couche HTTP
//! pour l'appeler — une dependance en retour, petite mais reelle : la couche
//! metier ne doit rien savoir des routes. Le geste n'appartenait pas au stock
//! non plus : il numerote aussi les bons de commande, les retours, les plans
//! d'achat et les decisions machine.

use crate::error::AppResult;

/// Numerotation sequentielle par prefixe et par annee.
pub(crate) async fn numeroter(
    tx: &mut sqlx::PgConnection,
    table: &str,
    colonne: &str,
    prefixe: &str,
) -> AppResult<String> {
    let annee = crate::db::jour_casablanca().format("%Y").to_string();
    let motif = format!("{prefixe}-{annee}-%");
    // `length(?1) + 1` : substr est indexe a 1, donc la position `length(prefixe)`
    // designe le DERNIER caractere du prefixe — le tiret — et non le premier
    // chiffre. Sans le +1, "BC-2026-0001" donnait "-0001", converti en -1 : le
    // 2e document repartait a 0000 et le 3e retombait sur 0001, deja pris.
    //
    // LE COMPTEUR, PAS LE MAXIMUM (audit v4). Deux saisies simultanees lisaient
    // le meme MAX et la seconde tombait sur l'unicite. La ligne du compteur est
    // verrouillee par la transaction du document : la seconde attend, puis
    // prend le suivant. Le MAX reste le plancher (documents venus d'ailleurs).
    let sql = format!(
        "INSERT INTO compteur_numero (cle, valeur)
         SELECT $3, COALESCE(MAX(CAST(substr({colonne}, length($1) + 1) AS bigint)), 0) + 1
           FROM {table} WHERE {colonne} LIKE $2
         ON CONFLICT (cle) DO UPDATE
            SET valeur = GREATEST(compteur_numero.valeur + 1, excluded.valeur)
         RETURNING valeur"
    );
    let suivant: i64 = sqlx::query_scalar(&sql)
        .bind(format!("{prefixe}-{annee}-"))
        .bind(&motif)
        .bind(format!("{table}.{colonne}.{prefixe}-{annee}"))
        .fetch_one(&mut *tx)
        .await?;
    Ok(format!("{prefixe}-{annee}-{suivant:04}"))
}
