---
name: axum-sqlx
description: Architecture des routes Axum 0.8 et des transactions SQLx 0.8 dans le backend de Gestion Fil — State, extracteur Utilisateur, droits, transaction atomique (commit/rollback), verrous, pièges SQL PostgreSQL. À charger avant d'écrire ou de modifier une route, une cascade dans domain/ ou une requête SQL.
---

# Routes Axum et transactions SQLx — Gestion Fil

## Où va le code
- `backend/src/routes/mod.rs` : **un seul `Router`**. Routes spécifiques d'abord, CRUD
  générique `/api/{entite}` **en dernier** (sinon il masque les routes spécifiques).
- Référentiel simple → une entrée dans le registre `ENTITES` de `crud.rs`, pas de handler.
- Document à workflow → module dans `routes/`, cascade transactionnelle dans `domain/`.
- Les **invariants sont en base** (déclencheurs `db/pg/010*.sql`) : le backend ne les
  réimplémente pas, il laisse remonter leurs messages (`error.rs`, `REGLE_METIER` → 422).

## Forme d'un handler
```rust
pub async fn valider_document(
    State(state): State<AppState>,
    user: Utilisateur,                 // authentifié, compte et rôle relus à chaque requête
    Path(id): Path<String>,
    Json(corps): Json<Saisie>,
) -> AppResult<Json<Value>> {
    user.exiger(&state.db, module::MOUVEMENTS, Action::Valider).await?;   // droit d'abord
    let mut tx = state.db.begin().await?;
    user.poser_contexte(&mut tx).await?;   // AVANT la première écriture (audit)
    // 1. verrouiller ce qu'on va changer, 2. relire sous verrou, 3. écrire
    let r = domaine::valider(&mut tx, &user, &id, &corps).await?;
    tx.commit().await?;                    // tout ou rien
    Ok(Json(r))
}
```

## Transactions : la règle
1. **Une écriture métier = une transaction**, ouverte dans le handler, passée au domaine
   en `&mut sqlx::PgConnection` (ou `&mut Transaction`), validée par `tx.commit()` à la fin.
2. **Rollback** : toute erreur propagée par `?` fait tomber la transaction, et
   `sqlx::Transaction` annule à sa destruction. Pas de `commit` partiel, pas d'écriture hors
   transaction au milieu d'une cascade. Un calcul « à blanc » (aperçu) se termine par
   `tx.rollback().await?` explicite.
3. Jamais de `state.db` (pool) pour écrire au milieu d'une transaction ouverte : la ligne
   partirait hors de la transaction (et sans contexte d'audit).
4. `poser_contexte` utilise `set_config(..., true)` : local à la transaction, invisible aux
   autres connexions.

## Concurrence
1. **Verrouiller avant de lire pour décider** : `SELECT … FOR UPDATE` sur le document, puis
   relire son statut sous verrou. Passage de statut conditionnel :
   `UPDATE … SET statut = 'VALIDE' WHERE id = $1 AND statut = 'BROUILLON'` et vérifier
   `rows_affected()`.
2. Saisie concurrente d'un même objet : `FOR UPDATE NOWAIT`, et traduire SQLSTATE `55P03`
   en message clair (« … en cours de modification sur un autre poste »). Ordre : document,
   puis objet (fiche puis étage).
3. Un ordre unique de verrouillage entre tables (référence avant stock), boucles triées
   (`ORDER BY`), pour éviter les interblocages.
4. Numérotation : ne pas inventer de nouveau `MAX()+1` ; réutiliser `stock::numeroter`
   (et viser une séquence à terme).

## Requêtes SQLx (dynamiques, pas de macros `query!`)
- `NUMERIC` lu en Rust : `::float8` si `f64` (voir la skill **erp-finance** pour l'argent).
- `ROUND(x, n)` sur un flottant échoue : `ROUND($1::numeric, 2)`.
- Jamais `?`, `datetime('now')`, `SUM(booléen)` (→ `COUNT(*) FILTER (WHERE …)`), reliquats SQLite.
- Listes : `= ANY($1)`. Paramètre optionnel : `($1::text IS NULL OR col = $1)` (typer le `NULL`).
- Dates : texte ISO-8601 UTC ; comparer par `substr(date, 1, 10)` quand les formats se mêlent.
- Nom de colonne venu du client (tri, filtre) : **liste blanche** uniquement, jamais interpolé brut.
- Vérifier une requête nouvelle par `PREPARE` sur une **copie** de la base.

## Schéma et migrations
- Éditer `db/pg/*.sql` **et** écrire une migration datée, rejouable, dans `db/pg/migrations/`
  (`IF NOT EXISTS`, `CREATE OR REPLACE`, upsert, `OWNER TO gestionfil`, une transaction).
- Si le binaire en dépend : ajouter un témoin dans `MIGRATIONS_REQUISES` (`backend/src/db.rs`).

## Erreurs
- `AppError::Invalide` (400) saisie, `RegleMetier` (422) règle, `Introuvable` (404),
  `NonAutorise` (403). Les messages sont en français et disent quoi faire.
- Une erreur interne ne montre rien de technique au client ; elle se lit dans le journal.

## Avant de livrer
- `cargo build` dans un `CARGO_TARGET_DIR` séparé (le binaire du 8080 est verrouillé).
- Serveur d'essai sur un autre port, base copie ; jamais `gestionfil` ni le 8080 pour essayer.
- Rejouer le scénario chiffré du domaine touché et `v_controles`.
