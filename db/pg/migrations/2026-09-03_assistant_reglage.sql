-- =============================================================================
-- MIGRATION 2026-09-03 — le moteur de l'assistant se regle depuis l'application
-- -----------------------------------------------------------------------------
-- POURQUOI DEPLACER CE REGLAGE DANS LA BASE. Il vivait dans `/opt/gestionfil/.env`,
-- donc changer de moteur demandait une session SSH sur le serveur. Un reglage
-- qu'on ne peut pas changer soi-meme n'est pas un reglage : c'est une decision
-- prise une fois pour toutes par celui qui a installe la machine.
--
-- LA CLE D'API RESTE DANS `.env`, ET ELLE Y RESTERA. Une sauvegarde de base
-- s'exporte, se copie, se transporte ; un secret qui s'y trouve part avec elle.
-- La base porte donc QUEL moteur repond, jamais de quoi s'authentifier aupres
-- de lui.
--
-- Application, sur le serveur :
--
--     cd /tmp
--     cat /home/sysadmin/gestionfil/db/migrations/2026-09-03_assistant_reglage.sql |
--         sudo -u postgres psql -d gestionfil -v ON_ERROR_STOP=1
-- =============================================================================

INSERT INTO parametre
    (code_parametre, libelle, valeur_courante, type_donnee, unite, description,
     categorie, modifiable_par, verrouille, actif)
VALUES
    ('P_AssistantMoteur', 'Moteur de l''assistant', 'ollama', 'TEXTE', NULL,
     'ollama : le modele tourne sur le serveur, aucune donnee ne sort de l''entreprise, '
     'mais comptez plusieurs dizaines de secondes par reponse. '
     'claude : deux a cinq secondes et bien meilleur en francais, mais la question et les '
     'chiffres necessaires a la reponse sont envoyes a Anthropic. Exige une cle d''API dans '
     'le fichier .env du serveur ; sans elle le moteur local reprend la main.',
     'SYSTEME', 'DIRECTION', 0, 1),

    ('P_AssistantModele', 'Modele de l''assistant', 'qwen2.5:3b-instruct', 'TEXTE', NULL,
     'Le nom du modele employe par le moteur choisi. Pour ollama : qwen2.5:3b-instruct '
     '(rapide, formulation parfois maladroite) ou qwen2.5:7b-instruct (mieux ecrit, trois '
     'fois plus lent). Pour claude : claude-sonnet-4-5.',
     'SYSTEME', 'DIRECTION', 0, 1)
ON CONFLICT (code_parametre) DO UPDATE SET
    libelle     = excluded.libelle,
    description = excluded.description,
    categorie   = excluded.categorie;

SELECT code_parametre, valeur_courante
  FROM parametre
 WHERE code_parametre LIKE 'P_Assistant%';
