-- ============================================================
-- Cles etrangeres en reference avant
-- ------------------------------------------------------------
-- Posees ici parce que leur cible est creee apres la table qui
-- les porte. SQLite l'acceptait en ligne ; PostgreSQL exige que
-- la cible existe deja.
-- Genere par db/pg/porter.py — ne pas editer a la main.
-- ============================================================

ALTER TABLE categorie_matiere
    ADD CONSTRAINT fk_categorie_matiere_code_role_defaut
    FOREIGN KEY (code_role_defaut) REFERENCES role_bom(code_role);

ALTER TABLE ligne_bc
    ADD CONSTRAINT fk_ligne_bc_id_proposition
    FOREIGN KEY (id_proposition) REFERENCES plan_achat(id_proposition);

ALTER TABLE ligne_reception
    ADD CONSTRAINT fk_ligne_reception_id_mouvement_genere
    FOREIGN KEY (id_mouvement_genere) REFERENCES mouvement(id_mouvement);
