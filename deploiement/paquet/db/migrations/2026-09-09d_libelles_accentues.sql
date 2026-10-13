-- =============================================================================
-- Les libelles de la base retrouvent leurs accents — 9 septembre 2026
-- -----------------------------------------------------------------------------
-- UNE GRANDE PART DU TEXTE AFFICHE NE VIENT PAS DE L'INTERFACE. Les en-tetes de
-- colonnes, les intitules de cartes, les noms de parametres et de motifs sont
-- lus dans la base : `champ_configurable.libelle` en porte 616 a lui seul. Les
-- reaccentuer cote React n'y changeait rien — c'est pourquoi « Reference » et
-- « Categorie » subsistaient dans le catalogue apres la passe frontale.
--
-- ON NE TOUCHE QUE DU TEXTE LU PAR UN HUMAIN. Les colonnes `champ`, `code_*`,
-- les statuts et les codes de module ne sont pas concernes : ce sont eux que le
-- serveur compare, et les accentuer casserait les droits en silence.
--
-- La correspondance vit dans une table TEMPORAIRE, detruite a la fin de la
-- transaction. La version precedente empilait cent quatre-vingts appels a
-- `regexp_replace` par colonne — cent quatre-vingt mille octets illisibles, que
-- personne n'aurait pu relire ni corriger.
--
-- `\y` est la frontiere de mot de PostgreSQL : « Etat » ne mord donc ni sur
-- « Etats » ni sur un mot qui le contient.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE accent_mot (faux text PRIMARY KEY, juste text NOT NULL)
  ON COMMIT DROP;

INSERT INTO accent_mot (faux, juste) VALUES
  ('Reapprovisionnement', 'Réapprovisionnement'),
  ('Preferentielle', 'Préférentielle'),
  ('preferentielle', 'préférentielle'),
  ('Telechargement', 'Téléchargement'),
  ('telechargement', 'téléchargement'),
  ('Selectionner', 'Sélectionner'),
  ('selectionner', 'sélectionner'),
  ('Verification', 'Vérification'),
  ('verification', 'vérification'),
  ('Equivalences', 'Équivalences'),
  ('equivalences', 'équivalences'),
  ('Previsionnel', 'Prévisionnel'),
  ('previsionnel', 'prévisionnel'),
  ('Numerotation', 'Numérotation'),
  ('Equivalence', 'Équivalence'),
  ('equivalence', 'équivalence'),
  ('Telecharger', 'Télécharger'),
  ('telecharger', 'télécharger'),
  ('Deconnexion', 'Déconnexion'),
  ('deconnexion', 'déconnexion'),
  ('Repartition', 'Répartition'),
  ('repartition', 'répartition'),
  ('References', 'Références'),
  ('references', 'références'),
  ('Parametres', 'Paramètres'),
  ('parametres', 'paramètres'),
  ('Categories', 'Catégories'),
  ('categories', 'catégories'),
  ('Receptions', 'Réceptions'),
  ('receptions', 'réceptions'),
  ('Precedente', 'Précédente'),
  ('precedente', 'précédente'),
  ('Immobilise', 'Immobilisé'),
  ('immobilise', 'immobilisé'),
  ('Etiquettes', 'Étiquettes'),
  ('Hierarchie', 'Hiérarchie'),
  ('hierarchie', 'hiérarchie'),
  ('Operations', 'Opérations'),
  ('operations', 'opérations'),
  ('Enregistre', 'Enregistré'),
  ('enregistre', 'enregistré'),
  ('Reference', 'Référence'),
  ('reference', 'référence'),
  ('Parametre', 'Paramètre'),
  ('parametre', 'paramètre'),
  ('Controles', 'Contrôles'),
  ('controles', 'contrôles'),
  ('Categorie', 'Catégorie'),
  ('categorie', 'catégorie'),
  ('Reception', 'Réception'),
  ('reception', 'réception'),
  ('Selection', 'Sélection'),
  ('selection', 'sélection'),
  ('Precedent', 'Précédent'),
  ('precedent', 'précédent'),
  ('Quantites', 'Quantités'),
  ('quantites', 'quantités'),
  ('Evolution', 'Évolution'),
  ('evolution', 'évolution'),
  ('Etiquette', 'Étiquette'),
  ('Frequence', 'Fréquence'),
  ('frequence', 'fréquence'),
  ('Operation', 'Opération'),
  ('operation', 'opération'),
  ('Resultats', 'Résultats'),
  ('resultats', 'résultats'),
  ('Coherence', 'Cohérence'),
  ('coherence', 'cohérence'),
  ('Perimetre', 'Périmètre'),
  ('perimetre', 'périmètre'),
  ('Qualites', 'Qualités'),
  ('qualites', 'qualités'),
  ('Controle', 'Contrôle'),
  ('controle', 'contrôle'),
  ('Creation', 'Création'),
  ('creation', 'création'),
  ('Derniere', 'Dernière'),
  ('derniere', 'dernière'),
  ('projetee', 'projetée'),
  ('Quantite', 'Quantité'),
  ('quantite', 'quantité'),
  ('Securite', 'Sécurité'),
  ('securite', 'sécurité'),
  ('Verifier', 'Vérifier'),
  ('verifier', 'vérifier'),
  ('Generale', 'Générale'),
  ('Echeance', 'Échéance'),
  ('echeance', 'échéance'),
  ('Benefice', 'Bénéfice'),
  ('benefice', 'bénéfice'),
  ('Autorise', 'Autorisé'),
  ('autorise', 'autorisé'),
  ('Resultat', 'Résultat'),
  ('resultat', 'résultat'),
  ('Severite', 'Sévérité'),
  ('severite', 'sévérité'),
  ('Decembre', 'Décembre'),
  ('Reglages', 'Réglages'),
  ('reglages', 'réglages'),
  ('Terminee', 'Terminée'),
  ('terminee', 'terminée'),
  ('Qualite', 'Qualité'),
  ('qualite', 'qualité'),
  ('Details', 'Détails'),
  ('details', 'détails'),
  ('projete', 'projeté'),
  ('Projete', 'Projeté'),
  ('General', 'Général'),
  ('Systeme', 'Système'),
  ('systeme', 'système'),
  ('Modeles', 'Modèles'),
  ('modeles', 'modèles'),
  ('Requete', 'Requête'),
  ('requete', 'requête'),
  ('Reserve', 'Réserve'),
  ('reserve', 'réserve'),
  ('Densite', 'Densité'),
  ('densite', 'densité'),
  ('Metiers', 'Métiers'),
  ('metiers', 'métiers'),
  ('Periode', 'Période'),
  ('periode', 'période'),
  ('Prevues', 'Prévues'),
  ('prevues', 'prévues'),
  ('Cumulee', 'Cumulée'),
  ('cumulee', 'cumulée'),
  ('Mediane', 'Médiane'),
  ('mediane', 'médiane'),
  ('Donnees', 'Données'),
  ('donnees', 'données'),
  ('Journee', 'Journée'),
  ('journee', 'journée'),
  ('Cloture', 'Clôture'),
  ('cloture', 'clôture'),
  ('Fevrier', 'Février'),
  ('Reappro', 'Réappro'),
  ('Elimine', 'Éliminé'),
  ('Integre', 'Intégré'),
  ('integre', 'intégré'),
  ('Reglage', 'Réglage'),
  ('reglage', 'réglage'),
  ('Annulee', 'Annulée'),
  ('annulee', 'annulée'),
  ('Numero', 'Numéro'),
  ('numero', 'numéro'),
  ('Depots', 'Dépôts'),
  ('depots', 'dépôts'),
  ('Detail', 'Détail'),
  ('detail', 'détail'),
  ('Unites', 'Unités'),
  ('unites', 'unités'),
  ('Delais', 'Délais'),
  ('delais', 'délais'),
  ('Apercu', 'Aperçu'),
  ('apercu', 'aperçu'),
  ('Modele', 'Modèle'),
  ('modele', 'modèle'),
  ('Etages', 'Étages'),
  ('Chaine', 'Chaîne'),
  ('chaine', 'chaîne'),
  ('Metier', 'Métier'),
  ('metier', 'métier'),
  ('Ecarts', 'Écarts'),
  ('Ecrans', 'Écrans'),
  ('Regles', 'Règles'),
  ('regles', 'règles'),
  ('Prevue', 'Prévue'),
  ('prevue', 'prévue'),
  ('Prevus', 'Prévus'),
  ('prevus', 'prévus'),
  ('Cumule', 'Cumulé'),
  ('cumule', 'cumulé'),
  ('Refuse', 'Refusé'),
  ('refuse', 'refusé'),
  ('Donnee', 'Donnée'),
  ('donnee', 'donnée'),
  ('Annees', 'Années'),
  ('annees', 'années'),
  ('Etapes', 'Étapes'),
  ('etapes', 'étapes'),
  ('Etats', 'États'),
  ('Depot', 'Dépôt'),
  ('depot', 'dépôt'),
  ('Creer', 'Créer'),
  ('creer', 'créer'),
  ('Unite', 'Unité'),
  ('unite', 'unité'),
  ('Delai', 'Délai'),
  ('delai', 'délai'),
  ('Etage', 'Étage'),
  ('Duree', 'Durée'),
  ('duree', 'durée'),
  ('Ecart', 'Écart'),
  ('Ecran', 'Écran'),
  ('Regle', 'Règle'),
  ('regle', 'règle'),
  ('Prevu', 'Prévu'),
  ('prevu', 'prévu'),
  ('Couts', 'Coûts'),
  ('couts', 'coûts'),
  ('Acces', 'Accès'),
  ('acces', 'accès'),
  ('Annee', 'Année'),
  ('annee', 'année'),
  ('Debut', 'Début'),
  ('debut', 'début'),
  ('Etape', 'Étape'),
  ('etape', 'étape'),
  ('Etat', 'État'),
  ('Deja', 'Déjà'),
  ('deja', 'déjà'),
  ('Cles', 'Clés'),
  ('Cout', 'Coût'),
  ('cout', 'coût'),
  ('Aout', 'Août'),
  ('Emis', 'Émis'),
  ('Cle', 'Clé');

CREATE OR REPLACE FUNCTION f_accentuer(t text) RETURNS text AS $$
DECLARE m record;
BEGIN
    IF t IS NULL THEN RETURN NULL; END IF;
    -- Du mot le plus long au plus court : « References » avant « Reference ».
    FOR m IN SELECT faux, juste FROM accent_mot ORDER BY length(faux) DESC LOOP
        t := regexp_replace(t, '\y' || m.faux || '\y', m.juste, 'g');
    END LOOP;
    RETURN t;
END;
$$ LANGUAGE plpgsql;

UPDATE champ_configurable SET libelle = f_accentuer(libelle) WHERE libelle IS NOT NULL;
UPDATE categorie_matiere SET libelle = f_accentuer(libelle) WHERE libelle IS NOT NULL;
UPDATE categorie_matiere SET description = f_accentuer(description) WHERE description IS NOT NULL;
UPDATE devise SET libelle = f_accentuer(libelle) WHERE libelle IS NOT NULL;
UPDATE frais_approche SET libelle = f_accentuer(libelle) WHERE libelle IS NOT NULL;
UPDATE groupe_equiv SET libelle = f_accentuer(libelle) WHERE libelle IS NOT NULL;
UPDATE groupe_equiv SET description = f_accentuer(description) WHERE description IS NOT NULL;
UPDATE motif_ligne SET libelle = f_accentuer(libelle) WHERE libelle IS NOT NULL;
UPDATE motif_mouvement SET libelle = f_accentuer(libelle) WHERE libelle IS NOT NULL;
UPDATE parametre SET libelle = f_accentuer(libelle) WHERE libelle IS NOT NULL;
UPDATE parametre SET description = f_accentuer(description) WHERE description IS NOT NULL;
UPDATE role_bom SET libelle = f_accentuer(libelle) WHERE libelle IS NOT NULL;
UPDATE role_bom SET description = f_accentuer(description) WHERE description IS NOT NULL;
UPDATE role_utilisateur SET libelle = f_accentuer(libelle) WHERE libelle IS NOT NULL;
UPDATE role_utilisateur SET description = f_accentuer(description) WHERE description IS NOT NULL;
UPDATE transition_statut SET description = f_accentuer(description) WHERE description IS NOT NULL;
UPDATE type_mouvement SET libelle = f_accentuer(libelle) WHERE libelle IS NOT NULL;

DROP FUNCTION f_accentuer(text);

COMMIT;
