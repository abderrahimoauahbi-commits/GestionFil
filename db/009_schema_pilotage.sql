-- =============================================================================
-- Module 9 : PILOTAGE (KPI, Audit, Alertes)
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- cockpit_kpi  (historisation des indicateurs pour le suivi de tendance)
-- -----------------------------------------------------------------------------
CREATE TABLE cockpit_kpi (
    id_kpi              TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    periode             TEXT    NOT NULL,           -- 'YYYY-MM' ou 'YYYY-MM-DD'
    indicateur          TEXT    NOT NULL,
    valeur              REAL    NOT NULL,
    cible               REAL,
    seuil_alerte        REAL,
    tendance            TEXT    CHECK (tendance IS NULL OR tendance IN ('HAUSSE','BAISSE','STABLE')),
    date_calcul         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (periode, indicateur)
) STRICT;

-- -----------------------------------------------------------------------------
-- audit_log
-- CORRECTION CDC : la table existait mais N'ETAIT ALIMENTEE PAR RIEN, alors que
-- A3 exige "100% des actions tracees" et M4 "audit log complet".
-- -> alimentee par les triggers generiques de 010_triggers.sql.
-- Le contexte (utilisateur, IP, session) est fourni par le service Rust via la
-- table de session applicative `_contexte_session` (cf. 010).
-- -----------------------------------------------------------------------------
CREATE TABLE audit_log (
    id_audit            TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    table_concernee     TEXT    NOT NULL,
    operation           TEXT    NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
    id_enregistrement   TEXT    NOT NULL,
    anciennes_valeurs   TEXT    CHECK (anciennes_valeurs IS NULL OR json_valid(anciennes_valeurs)),
    nouvelles_valeurs   TEXT    CHECK (nouvelles_valeurs IS NULL OR json_valid(nouvelles_valeurs)),
    date_operation      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    id_utilisateur      TEXT,
    adresse_ip          TEXT,
    session_id          TEXT
) STRICT;

CREATE INDEX ix_audit_table  ON audit_log(table_concernee, date_operation DESC);
CREATE INDEX ix_audit_enreg  ON audit_log(id_enregistrement);
CREATE INDEX ix_audit_user   ON audit_log(id_utilisateur, date_operation DESC);

-- -----------------------------------------------------------------------------
-- alerte
-- AJOUT (absent du CDC). A3 promet "l'automatisation du MRP et des alertes"
-- sans aucun support de persistance : ni table, ni service.
-- -----------------------------------------------------------------------------
CREATE TABLE alerte (
    id_alerte           TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    type_alerte         TEXT    NOT NULL CHECK (type_alerte IN (
                                    'RUPTURE','STOCK_CRITIQUE','BC_RETARD','ECART_PESEE',
                                    'RECETTE_INVALIDE','STOCK_DORMANT','PEREMPTION','MONO_SOURCE')),
    gravite             TEXT    NOT NULL CHECK (gravite IN ('INFO','ATTENTION','CRITIQUE','BLOQUANT')),
    titre               TEXT    NOT NULL,
    message             TEXT    NOT NULL,
    entite_concernee    TEXT,
    id_entite           TEXT,
    code_role_destinataire TEXT REFERENCES role_utilisateur(code_role_user),
    date_detection      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    statut              TEXT    NOT NULL DEFAULT 'OUVERTE'
                                CHECK (statut IN ('OUVERTE','ACQUITTEE','RESOLUE','IGNOREE')),
    id_utilisateur_acquittement TEXT REFERENCES utilisateur(id_utilisateur),
    date_acquittement   TEXT,
    commentaire         TEXT
) STRICT;

CREATE INDEX ix_alerte_statut ON alerte(statut, gravite, date_detection DESC);
CREATE INDEX ix_alerte_entite ON alerte(entite_concernee, id_entite);

-- -----------------------------------------------------------------------------
-- _contexte_session
-- Table technique mono-ligne : porte l'identite de l'appelant pour les triggers
-- d'audit. Le service Rust l'ecrit en debut de transaction.
-- Equivalent SQLite de `SET LOCAL app.id_utilisateur` sous PostgreSQL.
-- -----------------------------------------------------------------------------
CREATE TABLE _contexte_session (
    id                  INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
    id_utilisateur      TEXT,
    adresse_ip          TEXT,
    session_id          TEXT
) STRICT;

INSERT INTO _contexte_session (id, id_utilisateur, adresse_ip, session_id)
VALUES (1, NULL, NULL, NULL);
