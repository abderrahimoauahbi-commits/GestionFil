//! Conversion generique des lignes PostgreSQL en JSON.
//!
//! Les vues de pilotage sont nombreuses et evoluent avec le metier ; declarer
//! une structure Rust par vue les figerait sans rien apporter. Ces helpers les
//! exposent telles quelles, le masquage des champs interdits (CDC B4 regle 1)
//! s'appliquant ensuite uniformement a la sortie.
//!
//! # Le decimal exact, et pourquoi il ne passe pas par f64
//!
//! Le schema porte les montants et les quantites en `numeric`, avec l'echelle
//! sur la colonne : c'est ce qui rend l'arrondi garanti au lieu d'etre une
//! discipline (ADR-001 D-10, revu au portage). `numeric` ne se decode PAS en
//! `f64` : sqlx refuse, et il a raison — la conversion perdrait la precision
//! exacte que le type existe pour porter.
//!
//! On le decode donc en `BigDecimal`, puis on le rend en JSON par sa
//! REPRESENTATION TEXTUELLE convertie en nombre. Le detour parait inutile ; il
//! ne l'est pas : `serde_json::Number::from_f64` sur un `numeric` converti en
//! f64 ecrirait `1048.4999999999998` la ou la base porte `1048.5`.

use serde_json::{Map, Value};
use sqlx::postgres::PgRow;
use sqlx::{Column, Row, TypeInfo, ValueRef};

pub fn ligne_en_json(row: &PgRow) -> Value {
    let mut map = Map::new();
    for col in row.columns() {
        let i = col.ordinal();
        let valeur = match row.try_get_raw(i) {
            Ok(raw) if raw.is_null() => Value::Null,
            Ok(raw) => match raw.type_info().name() {
                // CHAQUE LARGEUR SE DECODE DANS SON PROPRE TYPE, puis s'elargit.
                //
                // sqlx exige une correspondance EXACTE : `try_get::<i64>` sur
                // une colonne INT2 echoue. Les tables du schema sont toutes en
                // `bigint`, mais les VUES rendent ce que leurs expressions
                // produisent — une soustraction de dates donne un `integer`,
                // un `CASE WHEN ... THEN 1 ELSE 0 END` aussi.
                //
                // Sans ces trois cas, ces colonnes ressortiraient a `null` dans
                // le JSON. Pas d'erreur, pas de trace : un ecart de couverture
                // ou un drapeau de sur-stock simplement absent.
                "INT8" | "BIGINT" => row
                    .try_get::<i64, _>(i)
                    .map(Value::from)
                    .unwrap_or(Value::Null),
                "INT4" | "INTEGER" => row
                    .try_get::<i32, _>(i)
                    .map(|v| Value::from(i64::from(v)))
                    .unwrap_or(Value::Null),
                "INT2" | "SMALLINT" => row
                    .try_get::<i16, _>(i)
                    .map(|v| Value::from(i64::from(v)))
                    .unwrap_or(Value::Null),

                // LE JSON RENDU PAR UNE VUE. `v_etat_stock` ventile le stock
                // par magasin dans un objet jsonb, plutot qu'en inventant une
                // colonne par magasin — la liste des magasins change, la vue
                // non. Sans ce cas, la ventilation ressortirait a `null` sans
                // le moindre message.
                "JSONB" | "JSON" => row
                    .try_get::<Value, _>(i)
                    .unwrap_or(Value::Null),

                // Le decimal exact. Voir le commentaire de tete.
                "NUMERIC" => row
                    .try_get::<sqlx::types::BigDecimal, _>(i)
                    .ok()
                    .and_then(|d| d.to_string().parse::<f64>().ok())
                    .and_then(serde_json::Number::from_f64)
                    .map(Value::Number)
                    .unwrap_or(Value::Null),

                // Les flottants restent des flottants : aucune vue du schema
                // n'en produit, mais une fonction d'agregation peut en rendre.
                "FLOAT4" | "FLOAT8" | "REAL" | "DOUBLE PRECISION" => row
                    .try_get::<f64, _>(i)
                    .ok()
                    .and_then(serde_json::Number::from_f64)
                    .map(Value::Number)
                    .unwrap_or(Value::Null),

                // Un vrai booleen ne devrait pas apparaitre — le schema n'en
                // declare aucun — mais une expression `x > 0` dans une vue en
                // rend un. Sans ce cas, il tomberait dans le repli texte et
                // ressortirait en `"t"`, que l'interface ne sait pas lire.
                "BOOL" | "BOOLEAN" => row
                    .try_get::<bool, _>(i)
                    .map(Value::from)
                    .unwrap_or(Value::Null),

                _ => row
                    .try_get::<String, _>(i)
                    .map(Value::from)
                    .unwrap_or(Value::Null),
            },
            Err(_) => Value::Null,
        };
        map.insert(col.name().to_string(), valeur);
    }
    Value::Object(map)
}

pub fn lignes_en_json(rows: &[PgRow]) -> Value {
    Value::Array(rows.iter().map(ligne_en_json).collect())
}
