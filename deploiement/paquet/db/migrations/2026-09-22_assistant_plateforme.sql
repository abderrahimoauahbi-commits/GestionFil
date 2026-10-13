-- =============================================================================
-- MIGRATION 2026-09-22 — l'assistant peut deleguer a GestionAi
--
-- POURQUOI UN TROISIEME MOTEUR. Chaque application de l'entreprise qui veut un
-- agent refait le meme travail : un client HTTP vers le modele, une consigne,
-- une boucle d'outils, une gestion d'erreurs. Quatre applications, ce sont
-- quatre fois les memes defauts — et quatre modeles qui se disputent la memoire
-- de la meme machine. GestionAi centralise : l'ERP POSE LA QUESTION, un agent
-- decide, execute ses outils et rend une reponse.
--
-- L'ERP N'Y PERD AUCUN DROIT. Le jeton de l'utilisateur part avec la question ;
-- l'agent rappelle cet ERP avec CE jeton. La grille de droits — par module et
-- par champ — s'applique donc exactement comme si la personne avait clique
-- elle-meme. Un compte de service, lui, ferait voir les prix d'achat a un
-- magasinier.
--
-- L'ADRESSE EST EN BASE, LA CLE NON. L'adresse n'est pas un secret et doit se
-- changer depuis l'ecran de configuration. La cle vit dans `GESTIONAI_CLE` du
-- fichier .env du serveur : une sauvegarde s'exporte, se copie, se transporte,
-- et un secret qui s'y trouve part avec elle. Meme regle que la cle Claude.
--
-- SANS L'UNE DES DEUX MOITIES, on ne bascule pas : le serveur retombe sur le
-- moteur local et le SIGNALE dans `repli_depuis`. Un reglage qui dit
-- « plateforme » pendant qu'Ollama repond serait un piege a une heure de
-- recherche.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-09-22_assistant_plateforme.sql
-- =============================================================================

INSERT INTO parametre
    (code_parametre, libelle, valeur_courante, type_donnee, unite, description,
     categorie, modifiable_par, verrouille, actif)
VALUES
    ('P_AssistantPlateforme', 'Adresse de GestionAi', '', 'TEXTE', NULL,
     'L''adresse du service d''agents de l''entreprise, par exemple '
     'http://127.0.0.1:8090 en local ou https://ia.polyfashion.local depuis le reseau. '
     'Laisser vide tant que le service n''est pas installe. La cle d''application, elle, '
     'se pose dans GESTIONAI_CLE du fichier .env du serveur — jamais ici.',
     'SYSTEME', 'DIRECTION', 0, 1)
ON CONFLICT (code_parametre) DO UPDATE SET
    libelle     = excluded.libelle,
    description = excluded.description,
    actif       = 1;

-- Le moteur accepte desormais une troisieme valeur : on le dit dans la
-- description, sinon personne ne devinera qu''elle existe.
UPDATE parametre
   SET description =
       'ollama : le modele tourne sur le serveur, aucune donnee ne sort de l''entreprise, '
       'mais comptez plusieurs dizaines de secondes par reponse. '
       'claude : deux a cinq secondes et bien meilleur en francais, mais la question et les '
       'chiffres necessaires a la reponse sont envoyes a Anthropic. Exige une cle d''API dans '
       'le fichier .env du serveur ; sans elle le moteur local reprend la main. '
       'plateforme : la question est traitee par GestionAi, le service d''agents de '
       'l''entreprise. Rien ne sort du reseau local et vos droits s''appliquent. Exige '
       'P_AssistantPlateforme ET la cle GESTIONAI_CLE ; sans les deux, le moteur local '
       'reprend la main.'
 WHERE code_parametre = 'P_AssistantMoteur';

-- PREUVE : les trois reglages existent et sont actifs.
SELECT code_parametre || ' = [' || COALESCE(valeur_courante, '') || ']'
  FROM parametre
 WHERE code_parametre IN ('P_AssistantMoteur', 'P_AssistantModele', 'P_AssistantPlateforme')
 ORDER BY code_parametre;
