-- =============================================================================
-- Module 9 : PILOTAGE (KPI, Audit, Alertes)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- cockpit_kpi  (historisation des indicateurs pour le suivi de tendance)
-- -----------------------------------------------------------------------------
CREATE TABLE cockpit_kpi (
    id_kpi              text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    periode             text    NOT NULL,           -- 'YYYY-MM' ou 'YYYY-MM-DD'
    indicateur          text    NOT NULL,
    valeur              numeric(18,2)    NOT NULL,
    cible               numeric(18,4),
    seuil_alerte        numeric(12,4),
    tendance            text    CHECK (tendance IS NULL OR tendance IN ('HAUSSE','BAISSE','STABLE')),
    date_calcul         text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    UNIQUE (periode, indicateur)
);

-- -----------------------------------------------------------------------------
-- audit_log
-- CORRECTION CDC : la table existait mais N'ETAIT ALIMENTEE PAR RIEN, alors que
-- A3 exige "100% des actions tracees" et M4 "audit log complet".
-- -> alimentee par les triggers generiques de 010_triggers.sql.
-- Le contexte (utilisateur, IP, session) est fourni par le service Rust via la
-- table de session applicative `_contexte_session` (cf. 010).
-- -----------------------------------------------------------------------------
CREATE TABLE audit_log (
    id_audit            text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    table_concernee     text    NOT NULL,
    operation           text    NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
    id_enregistrement   text    NOT NULL,
    anciennes_valeurs   text    CHECK (anciennes_valeurs IS NULL OR (anciennes_valeurs)::jsonb IS NOT NULL),
    nouvelles_valeurs   text    CHECK (nouvelles_valeurs IS NULL OR (nouvelles_valeurs)::jsonb IS NOT NULL),
    date_operation      text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_utilisateur      text,
    adresse_ip          text,
    session_id          text
);

CREATE INDEX ix_audit_table  ON audit_log(table_concernee, date_operation DESC);
CREATE INDEX ix_audit_enreg  ON audit_log(id_enregistrement);
CREATE INDEX ix_audit_user   ON audit_log(id_utilisateur, date_operation DESC);

-- -----------------------------------------------------------------------------
-- alerte
-- AJOUT (absent du CDC). A3 promet "l'automatisation du MRP et des alertes"
-- sans aucun support de persistance : ni table, ni service.
-- -----------------------------------------------------------------------------
CREATE TABLE alerte (
    id_alerte           text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    type_alerte         text    NOT NULL CHECK (type_alerte IN (
                                    'RUPTURE','STOCK_CRITIQUE','BC_RETARD','ECART_PESEE',
                                    'RECETTE_INVALIDE','STOCK_DORMANT','PEREMPTION','MONO_SOURCE')),
    gravite             text    NOT NULL CHECK (gravite IN ('INFO','ATTENTION','CRITIQUE','BLOQUANT')),
    titre               text    NOT NULL,
    message             text    NOT NULL,
    entite_concernee    text,
    id_entite           text,
    code_role_destinataire text REFERENCES role_utilisateur(code_role_user),
    date_detection      text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    statut              text    NOT NULL DEFAULT 'OUVERTE'
                                CHECK (statut IN ('OUVERTE','ACQUITTEE','RESOLUE','IGNOREE')),
    id_utilisateur_acquittement text REFERENCES utilisateur(id_utilisateur),
    date_acquittement   text,
    commentaire         text
);

CREATE INDEX ix_alerte_statut ON alerte(statut, gravite, date_detection DESC);
CREATE INDEX ix_alerte_entite ON alerte(entite_concernee, id_entite);

-- -----------------------------------------------------------------------------
-- _contexte_session
-- Table technique mono-ligne : porte l'identite de l'appelant pour les triggers
-- d'audit. Le service Rust l'ecrit en debut de transaction.
-- Equivalent SQLite de `SET LOCAL app.id_utilisateur` sous PostgreSQL.
-- -----------------------------------------------------------------------------
CREATE TABLE _contexte_session (
    id                  integer NOT NULL PRIMARY KEY CHECK (id = 1),
    id_utilisateur      text,
    adresse_ip          text,
    session_id          text
);

INSERT INTO _contexte_session (id, id_utilisateur, adresse_ip, session_id)
VALUES (1, NULL, NULL, NULL);
