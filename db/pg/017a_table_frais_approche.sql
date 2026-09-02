-- =============================================================================
-- frais_approche — les frais qui s'ajoutent au prix d'achat
-- -----------------------------------------------------------------------------
-- ECRITE A LA MAIN, ET C'EST DELIBERE. Les autres tables sont produites par
-- `porter.py` depuis leur source SQLite ; celle-ci vivait au milieu d'un
-- fichier de VUES (017_vues_analyse.sql), que le convertisseur de vues traverse
-- sans toucher a la DDL. Plutot que d'apprendre la DDL a un convertisseur de
-- requetes, on ecrit la table ici, dans le dialecte cible.
--
-- Quatre traductions, les memes que celles de `porter.py` :
--
--   * `REAL` -> `numeric(14,4)`. SQLite n'avait pas de decimal exact ; ici on
--     porte l'echelle sur la colonne, et l'arrondi cesse d'etre une discipline
--     pour devenir une garantie. C'est une table de MONTANTS : le flottant y
--     serait une faute.
--
--   * L'identifiant. SQLite fabriquait un UUID a coups de `randomblob` et de
--     `substr` — dix-sept appels de fonction pour ce que `gen_random_uuid()`
--     fait nativement depuis PostgreSQL 13. Le type reste `text` pour rester
--     comparable aux autres cles du schema, qui sont toutes textuelles.
--
--   * La colonne calculee. `GENERATED ... VIRTUAL` de SQLite se recalcule a
--     chaque lecture ; PostgreSQL ne connait que `STORED`, qui l'ecrit. La
--     valeur est identique, l'espace occupe change — negligeable ici.
--
--   * Les horodatages. `strftime('%Y-%m-%dT%H:%M:%fZ','now')` devient son
--     equivalent `to_char`, et les dates restent du TEXTE ISO-8601 : c'est le
--     choix de portage n°3, qui garde la comparaison lexicographique valide
--     partout dans le service.
-- =============================================================================

CREATE TABLE IF NOT EXISTS frais_approche (
    id_frais            text        NOT NULL PRIMARY KEY
                                    DEFAULT gen_random_uuid()::text,
    id_reception        text        NOT NULL REFERENCES reception(id_reception),
    type_frais          text        NOT NULL CHECK (type_frais IN
                                        ('FRET', 'DOUANE', 'ASSURANCE', 'MANUTENTION', 'AUTRE')),
    libelle             text,
    montant_devise      numeric(14,4) NOT NULL CHECK (montant_devise >= 0),
    code_devise         text        NOT NULL REFERENCES devise(code_devise),
    taux_change         numeric(14,6) NOT NULL CHECK (taux_change > 0),
    montant_mad         numeric(14,4) GENERATED ALWAYS AS (montant_devise * taux_change) STORED,

    -- La cle de repartition, choisie par frais : un fret se repartit au poids,
    -- une assurance a la valeur, une manutention au nombre de lignes.
    cle_repartition     text        NOT NULL DEFAULT 'POIDS'
                                    CHECK (cle_repartition IN ('POIDS', 'VALEUR', 'LIGNES')),
    reference_externe   text,       -- numero de facture transitaire, DUM douaniere
    date_frais          text        NOT NULL DEFAULT to_char(current_date, 'YYYY-MM-DD'),
    id_utilisateur      text        REFERENCES utilisateur(id_utilisateur),
    date_creation       text        NOT NULL
                                    DEFAULT to_char(now() AT TIME ZONE 'UTC',
                                                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    notes               text
);

CREATE INDEX IF NOT EXISTS ix_frais_reception ON frais_approche(id_reception);
