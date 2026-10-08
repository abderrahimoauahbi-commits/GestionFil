-- =============================================================================
-- 2026-10-06 — Les préférences d'affichage suivent le COMPTE, pas le navigateur
-- -----------------------------------------------------------------------------
-- Style, palette, police, taille, fond d'écran, réglages du verre : ils
-- vivaient dans le localStorage du navigateur, à refaire sur chaque poste et
-- après chaque nettoyage du navigateur. Ils sont désormais rangés ici, une
-- ligne par utilisateur, relus à chaque connexion.
--
-- Pas de déclencheur d'audit : ce n'est pas une donnée métier (aucun stock,
-- aucun montant, aucun statut), seulement la façon dont un écran s'affiche.
--
-- Rejouable : IF NOT EXISTS partout.
-- =============================================================================

CREATE TABLE IF NOT EXISTS preference_utilisateur (
    id_utilisateur  text        NOT NULL PRIMARY KEY
                                REFERENCES utilisateur (id_utilisateur) ON DELETE CASCADE,
    -- Les réglages d'apparence, tels que l'interface les range (objet JSON).
    apparence       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    -- L'image de fond choisie par l'utilisateur, réduite par l'interface
    -- (data URL JPEG, quelques centaines de Ko). NULL : le fond du style.
    fond_image      text,
    modifie_le      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_pref_fond_taille CHECK (fond_image IS NULL OR length(fond_image) <= 2000000)
);

ALTER TABLE preference_utilisateur OWNER TO gestionfil;
