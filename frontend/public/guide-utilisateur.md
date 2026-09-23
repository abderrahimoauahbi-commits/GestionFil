# Guide utilisateur ERP Gestion Fil

Bienvenue dans le guide utilisateur de l'ERP Gestion Fil pour Polyfashions Carpet Morocco. Ce document vous accompagne dans l'utilisation quotidienne du système de gestion des achats, stocks et production de matières premières.

## Table des matières

1. [Introduction](#introduction)
2. [Connexion et navigation](#connexion-et-navigation)
3. [Modules principaux](#modules-principaux)
   - [Général](#général)
   - [Catalogue](#catalogue)
   - [Production](#production)
   - [Achats](#achats)
   - [Stock](#stock)
   - [Finance](#finance)
4. [Guides par rôle](#guides-par-rôle)
5. [FAQ](#faq)

---

## Introduction

### Qu'est-ce que Gestion Fil ?

Gestion Fil est un ERP (Enterprise Resource Planning) conçu spécifiquement pour Polyfashions Carpet Morocco. Il permet de :

- **Piloter les achats** de matières premières (124 références, 12 fournisseurs)
- **Gérer les stocks** en temps réel avec valorisation CMUP
- **Planifier la production** avec calcul MRP (Material Requirements Planning)
- **Suivre les réceptions** et contrôler la qualité
- **Analyser les performances** via un cockpit de pilotage

### Principes de base

**Le kilogramme est l'unité canonique**. Toutes les quantités sont converties en kg, que vous commandiez en bobines, palettes ou mètres linéaires.

**L'historique est figé**. Les mouvements, réceptions et plans validés sont immuables. Les projections (stock projeté, besoins MRP) sont recalculées à chaque consultation.

**Les paramètres sont embarqués**. Chaque document (recette, plan, bon de commande) copie les paramètres globaux à sa création, garantissant la reconstitubilité du passé.

---

## Connexion et navigation

### Se connecter

1. Ouvrez votre navigateur et accédez à l'URL de l'application
2. Entrez votre **login** et **mot de passe**
3. Cliquez sur "Se connecter"

**Double authentification** : Si votre compte est configuré avec la 2FA, vous devrez entrer un code à 6 chiffres généré par votre application d'authentification.

### Comprendre l'interface

L'interface s'adapte à la taille de votre écran :

- **≥ 1280 px** : Barre latérale avec tous les modules
- **768-1279 px** : Menu compact
- **< 768 px** : Barre d'onglets en bas (mobile/tablette)

### Droits et permissions

L'ERP gère deux niveaux de droits :

1. **Accès module** : LIRE / ÉCRIRE / VALIDER sur 17 modules
2. **Visibilité champ** : MASQUÉ / LECTURE / ÉCRITURE sur 208 champs

Un champ **masqué** n'apparaît pas à l'écran. Un champ en **lecture** est grisé et ne peut pas être modifié.

---

## Modules principaux

### Général

#### Accueil

L'écran d'accueil vous donne une vue d'ensemble de l'ERP avec :
- Les écrans principaux auxquels vous avez accès
- Un résumé de votre profil et de vos droits
- Un accès rapide aux fonctionnalités essentielles

#### Tableau de bord (Cockpit)

Le cockpit présente les indicateurs clés de performance :
- **Alertes** : Contrôles de cohérence en anomalie
- **KPIs** : Valeur du stock, rotation, couverture
- **Risques** : Références en rupture, fournisseurs en retard

#### Assistant

L'assistant IA vous permet de poser des questions en langage naturel sur :
- "Quel est le stock de PP-3430 ?"
- "Quels fournisseurs livrent en retard ?"
- "Combien de kg de JUT-961 sont en stock ?"

---

### Catalogue

#### Références

L'écran des références présente toutes les matières premières :
- **Code référence** : Identifiant unique (ex: PP-3430)
- **Désignation** : Nom de la référence
- **Famille** : Catégorie (Poil, Trame, Cuir, etc.)
- **Couleur** : Nuancier maison
- **Unité catalogue** : bobine, palette, mètre linéaire
- **Prix catalogue** : Prix de référence
- **Fournisseur habituel** : Fournisseur principal

**Actions possibles** :
- Créer une nouvelle référence
- Modifier les informations existantes
- Consulter l'historique des prix
- Voir les équivalences

#### Équivalences

Les équivalences définissent les références substituables :
- **Référence principale** : La référence de référence
- **Équivalents** : Références utilisables en remplacement
- **Taux de conversion** : Facteur entre les références

**Utilisation** : En cas de rupture, le système suggère automatiquement les équivalents disponibles.

#### Fournisseurs

La gestion des fournisseurs comprend :
- **Informations générales** : Nom, pays, devise
- **Délai de livraison** : Délai annoncé en jours
- **Scorecard** : Conformité, ponctualité, OTIF
- **Historique** : Commandes et réceptions

---

### Production

#### Qualités

Les qualités de tapis définissent les produits finis :
- **Code qualité** : SH, LP, etc.
- **Désignation** : Nom de la qualité
- **Densités par rôle** : kg/m² pour chaque rôle BOM
- **Recettes associées** : Composition de la qualité

#### Recettes (BOM)

Les recettes (Bill of Materials) définissent la composition de chaque qualité :
- **Lignes de recette** : Référence + pourcentage + rôle
- **Validation** : Σ % = 100 % obligatoire
- **Versionnage** : Les recettes validées sont immuables

**Workflow** :
1. Sélectionner une qualité
2. Ajouter les lignes de référence
3. Ajuster les pourcentages (somme = 100 %)
4. Valider la recette

#### Plan de production

Le plan de production définit les objectifs de production :
- **Année** : Année du plan
- **Qualités** : Qualités planifiées
- **Saisonnalité** : Variation mensuelle
- **Croissance** : Évolution année par année

**Actions** :
- Créer un nouveau plan
- Saisir les objectifs par qualité et mois
- Figer les recettes (verrouille la version utilisée)
- Lancer le calcul MRP

#### Besoins (MRP)

Le calcul MRP (Material Requirements Planning) détermine :
- **Besoins bruts** : Quantité nécessaire pour la production
- **Stock disponible** : Stock actuel + en-cours
- **Besoins nets** : Quantité à commander
- **Date de besoin** : Quand commander

**Lancement** :
1. Figer les recettes du plan
2. Exécuter le calcul MRP
3. Consulter les besoins par référence
4. Générer le plan d'achat

---

### Achats

#### Bons de commande

**Créer un bon de commande** :

1. Cliquez sur "Nouveau bon"
2. Sélectionnez le **fournisseur**
3. Choisissez le **mode** :
   - **Du plan d'achat** : Ce que le MRP réclame (recommandé)
   - **Tout le catalogue** : Toutes les références du fournisseur
4. Ajoutez les lignes :
   - Cliquez dans la cellule "Référence"
   - Tapez pour rechercher
   - Sélectionnez la référence
   - Saisissez la quantité et le prix
5. Complétez l'en-tête (date livraison, motif, notes)
6. Cliquez sur "Créer le bon"

**Modes de saisie** :
- **Plan** : Propose les références avec un besoin identifié
- **Catalogue** : Toutes les références du fournisseur

**Validation** :
- **Brouillon** : En cours de saisie
- **En attente de validation** : Soumis à la Direction
- **Validé** : Signé, engagement pris
- **Envoyé** : Transmis au fournisseur
- **Livré partiel** : Réception partielle
- **Clôturé** : Livraison complète
- **Annulé** : Annulé avant validation

**Liste des bons** :
- Filtres par statut, fournisseur, date
- Indicateurs de livraison (% livré, reste à livrer)
- Actions : Imprimer, Ouvrir, Annuler/Supprimer

#### Réceptions

**Processus de réception** :

1. Sélectionnez le bon de commande concerné
2. Créez une nouvelle réception
3. Saisissez les pesées :
   - Référence
   - Quantité reçue (en kg)
   - Lot (optionnel)
   - Contrôle qualité
4. Validez la réception

**Cascade 3-en-1** (à la validation) :
- Création d'un mouvement de stock
- Mise à jour du CMUP
- Archivage figé de la réception
- Mise à jour du solde du bon de commande

**Gestion des lots** :
- Numéro de lot
- Date de fabrication
- Contrôle qualité

#### Historique des prix

L'historique des prix montre :
- **Évolution chronologique** : Prix par date
- **Par fournisseur** : Comparaison entre fournisseurs
- **Par référence** : Historique d'une référence

#### Matrice des prix

La matrice des prix présente :
- **Achats croisés** : Référence × mois
- **Tendance** : Évolution des prix
- **Comparaison** : Prix catalogue vs prix réel

---

### Stock

#### État des stocks

L'état des stocks montre :
- **Stock par magasin** : Quantité en kg
- **Valorisation** : Valeur en MAD
- **CMUP** : Coût moyen unitaire pondéré
- **Alertes** : Stock minimum, rupture

#### Stock projeté & alertes

Le stock projeté calcule :
- **Stock actuel** : Quantité disponible
- **En-cours** : Bons de commande envoyés
- **Besoins** : Besoins MRP
- **Stock projeté** : Stock + en-cours - besoins
- **Jours de couverture** : Durée de couverture

**Alertes** :
- Rupture de stock
- Stock dormant (sans mouvement)
- Rotation faible

#### Mouvements

Les mouvements de stock enregistrent :
- **Type** : Entrée, sortie, transfert
- **Référence** : Matière première
- **Quantité** : En kg
- **Magasin** : Origine et destination
- **Motif** : Justification

**Types de mouvements** :
- Réception (entrée)
- Consommation (sortie)
- Transfert (entre magasins)
- Inventaire (ajustement)

#### Transferts

Les transferts déplacent le stock entre magasins :
1. Sélectionnez le magasin source
2. Sélectionnez le magasin destination
3. Ajoutez les lignes (référence + quantité)
4. Validez le transfert

**Validation** : Crée deux mouvements (sortie source, entrée destination).

#### Inventaires

Les inventaires permettent de :
- **Ouvrir** un inventaire (état initial)
- **Saisir** les comptages
- **Clôturer** l'inventaire (génère les ajustements)

**Workflow** :
1. Créer un inventaire
2. Saisir les comptages par référence
3. Comparer au stock théorique
4. Valider les écarts
5. Clôturer l'inventaire

#### Machines

L'écran machines gère le stock sur les métiers :
- **Charger** : Mettre du stock sur un métier
- **Décharger** : Retirer du stock d'un métier
- **Conster** : Enregistrer la consommation

---

### Finance

#### Valorisation (CMUP)

La valorisation montre :
- **CMUP par référence** : Coût moyen unitaire pondéré
- **Valeur du stock** : Valorisation totale
- **Évolution** : Historique du CMUP

**Calcul du CMUP** :
- Initial : Prix catalogue × taux de change
- Après réception : Moyenne pondérée des entrées

#### Analyse ABC / XYZ

L'analyse ABC/XYZ classe les références :
- **ABC** : Classification par valeur (A = haute valeur)
- **XYZ** : Classification par régularité (X = régulier)

**Utilisation** : Optimiser la gestion des stocks.

#### Coût de revient complet

Le coût de revient complet inclut :
- **Coût matière** : Prix d'achat
- **Frais d'importation** : Douane, transport
- **Frais internes** : Manutention, stockage

#### Rapports financiers

Les rapports financiers présentent :
- **Bilan** : État des stocks
- **Résultat** : Variations de stock
- **Analyse** : Par catégorie, fournisseur

---

## Guides par rôle

### Direction

**Principales responsabilités** :
- Valider les bons de commande
- Consulter le cockpit et les KPIs
- Approuver les plans de production
- Analyser les rapports financiers

**Écrans clés** :
- Tableau de bord
- Bons de commande (validation)
- Plans (validation)
- Rapports financiers

### Achats

**Principales responsabilités** :
- Créer les bons de commande
- Suivre les livraisons
- Négocier avec les fournisseurs
- Gérer le plan d'achat

**Écrans clés** :
- Bons de commande
- Plan d'achat
- Fournisseurs
- Réceptions

**Workflow typique** :
1. Consulter le plan d'achat
2. Créer les bons de commande
3. Suivre les livraisons
4. Valider les réceptions

### Magasin

**Principales responsabilités** :
- Réceptionner la marchandise
- Gérer les mouvements de stock
- Effectuer les inventaires
- Charger/décharger les machines

**Écrans clés** :
- Réceptions
- Mouvements
- État des stocks
- Inventaires
- Machines

**Workflow typique** :
1. Réceptionner la marchandise
2. Peser et contrôler
3. Valider la réception
4. Enregistrer les mouvements

### Qualité

**Principales responsabilités** :
- Valider les réceptions
- Contrôler la qualité
- Suivre les non-conformités
- Gérer les échantillons

**Écrans clés** :
- Réceptions (validation)
- Contrôles de cohérence
- Historique des contrôles

**Workflow typique** :
1. Contrôler la marchandise reçue
2. Valider ou rejeter la réception
3. Enregistrer les non-conformités
4. Suivre les actions correctives

### Planification

**Principales responsabilités** :
- Créer les plans de production
- Définir les recettes
- Lancer le calcul MRP
- Analyser les besoins

**Écrans clés** :
- Plans
- Recettes
- Besoins (MRP)
- Plan d'achat

**Workflow typique** :
1. Créer le plan de production
2. Définir les recettes
3. Figer les recettes
4. Lancer le MRP
5. Générer le plan d'achat

---

## FAQ

### Comment créer un bon de commande ?

1. Allez dans "Achats" > "Bons de commande"
2. Cliquez sur "Nouveau bon"
3. Sélectionnez le fournisseur
4. Ajoutez les lignes en cliquant sur "Référence"
5. Saisissez quantité et prix
6. Cliquez sur "Créer le bon"

### Comment valider une réception ?

1. Allez dans "Achats" > "Réceptions"
2. Sélectionnez le bon de commande
3. Créez une nouvelle réception
4. Saisissez les pesées
5. Cliquez sur "Valider"

### Comment consulter le stock d'une référence ?

1. Allez dans "Stock" > "État des stocks"
2. Utilisez le filtre "Référence"
3. Tapez le code de la référence
4. Consultez le stock par magasin

### Comment lancer le calcul MRP ?

1. Allez dans "Production" > "Plans"
2. Sélectionnez le plan
3. Cliquez sur "Figer les recettes"
4. Cliquez sur "MRP"
5. Consultez les résultats dans "Besoins"

### Que signifie le statut "En attente de validation" ?

Le bon de commande est prêt mais doit être validé par la Direction avant d'être envoyé au fournisseur. C'est une étape de contrôle budgétaire.

### Comment annuler un bon de commande ?

1. Allez dans "Achats" > "Bons de commande"
2. Sélectionnez le bon
3. Cliquez sur l'icône de corbeille
4. Confirmez l'annulation

**Note** : Seuls les brouillons et les bons en attente de validation peuvent être supprimés. Les bons validés sont seulement annulés.

### Comment modifier une recette ?

1. Allez dans "Production" > "Recettes"
2. Sélectionnez la qualité
3. Modifiez les lignes (ajout/suppression/modification)
4. Vérifiez que la somme des pourcentages = 100 %
5. Validez la recette

**Note** : Une recette validée est immuable. Pour la modifier, créez une nouvelle version.

### Comment exporter des données ?

La plupart des écrans proposent un bouton d'export :
1. Cliquez sur l'icône d'export
2. Choisissez le format (Excel, CSV)
3. Sélectionnez les colonnes
4. Téléchargez le fichier

### Comment changer mon mot de passe ?

1. Cliquez sur votre nom en haut à droite
2. Sélectionnez "Changer le mot de passe"
3. Entrez l'ancien mot de passe
4. Entrez le nouveau mot de passe
5. Confirmez

### Comment activer la double authentification ?

1. Cliquez sur votre nom en haut à droite
2. Sélectionnez "Double authentification"
3. Scannez le QR code avec votre application
4. Entrez le code de confirmation
5. La 2FA est activée

### Que faire en cas d'erreur de saisie ?

- **Brouillon** : Modifiez directement
- **Validé** : Annulez et créez un nouveau bon
- **Réception** : Contactez l'administrateur pour une correction

---

## Support

Pour toute question ou problème :
- Contactez votre administrateur système
- Consultez le tableau de bord des contrôles de cohérence
- Utilisez l'assistant IA pour poser vos questions

---

*Document version 1.0 - Dernière mise à jour : 2026-09-23*