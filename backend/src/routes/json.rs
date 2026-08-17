//! Conversion generique des lignes SQLite en JSON.
//!
//! Les vues de pilotage sont nombreuses et evoluent avec le metier ; declarer
//! une structure Rust par vue les figerait sans rien apporter. Ces helpers les
//! exposent telles quelles, le masquage des champs interdits (CDC B4 regle 1)
//! s'appliquant ensuite uniformement a la sortie.

use serde_json::{Map, Value};
use sqlx::sqlite::SqliteRow;
use sqlx::{Column, Row, TypeInfo, ValueRef};

pub fn ligne_en_json(row: &SqliteRow) -> Value {
    let mut map = Map::new();
    for col in row.columns() {
        let i = col.ordinal();
        let valeur = match row.try_get_raw(i) {
            Ok(raw) if raw.is_null() => Value::Null,
            Ok(raw) => match raw.type_info().name() {
                "INTEGER" | "INT" | "BIGINT" | "BOOLEAN" => row
                    .try_get::<i64, _>(i)
                    .map(Value::from)
                    .unwrap_or(Value::Null),
                "REAL" | "FLOAT" | "DOUBLE" | "NUMERIC" => row
                    .try_get::<f64, _>(i)
                    .ok()
                    .and_then(serde_json::Number::from_f64)
                    .map(Value::Number)
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

pub fn lignes_en_json(rows: &[SqliteRow]) -> Value {
    Value::Array(rows.iter().map(ligne_en_json).collect())
}
