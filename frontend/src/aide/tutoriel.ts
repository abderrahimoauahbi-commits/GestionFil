/**
 * LE TUTORIEL — le cycle complet du fil, pas à pas, par rôle (27/10/2026).
 *
 * Il se lit dans l'application (menu Aide → Guide utilisateur, `/guide-utilisateur`)
 * et en tête du manuel imprimable (`/etats/manuel`). Il dit OÙ cliquer, QUOI
 * saisir, CE QU'ON OBTIENT et L'ERREUR qu'on fait le plus souvent ; il ne
 * redit jamais ce qu'attend une case : `champs` NOMME les intitulés, et leur
 * description reste dans la fiche de l'écran (`fiches/*.ts`), seule source.
 * `tests/aide.test.ts` refuse un intitulé qui n'existe pas dans la fiche.
 *
 * Les étapes « Décider quoi commander » et « Transférer entre magasins » suivent
 * le moteur de couverture et la date prévue de disponibilité du fil en route
 * (27/10/2026) ; leurs champs sont décrits dans fiches/planification.ts et
 * fiches/stock.ts.
 */
import type { Tutoriel } from './types.ts'

export const TUTORIEL: Tutoriel = {
  titre: 'Guide pas à pas : le cycle du fil, de la référence à l’état',
  introduction:
    'Ce guide suit une même matière de bout en bout : on la déclare, on planifie ce qu’on va produire, on en déduit ce qu’il faut acheter, on commande, on reçoit, on contrôle, on rapproche la facture, on la fait vivre au magasin et sur les machines, on la compte, puis on lit les états. Chaque étape dit qui la fait, où cliquer, ce qu’on obtient et l’erreur la plus fréquente. Pour savoir ce qu’attend une case, survolez ou touchez le ⓘ à côté de son intitulé (ou F1 dans le champ) ; le « ? » en haut de l’écran ouvre la fiche complète.',
  roles: [
    {
      role: 'Acheteur',
      mission:
        'Tient les fournisseurs et les références, lit les besoins, prépare et envoie les bons de commande, saisit les factures fournisseur.',
      droits: 'Écriture sur Catalogue, Fournisseurs, Bons de commande ; lecture des besoins.',
    },
    {
      role: 'Magasinier',
      mission:
        'Pèse et enregistre ce qui arrive, saisit les mouvements, charge, constate et décharge les machines, compte les inventaires.',
      droits: 'Écriture sur Réceptions, Mouvements, Stock (machines) et Inventaire ; les prix lui restent masqués selon sa grille.',
    },
    {
      role: 'Responsable',
      mission:
        'Contrôle ce que d’autres ont saisi : contrôle des bons, contrôle des réceptions, validation des inventaires et des factures. Il ne valide jamais ce qu’il a lui-même créé ou pesé.',
      droits: 'Droit VALIDER sur les modules concernés (VALIDER n’est pas ÉCRIRE : c’est la séparation des tâches).',
    },
    {
      role: 'Direction',
      mission:
        'Décide du plan de production, valide les bons (taux engagé, plafond), tranche les contrôles, lit les états et les signaux de cohérence.',
      droits: 'Droit VALIDER sur Plans, Bons de commande ; lecture de la valorisation et des contrôles.',
    },
  ],
  parties: [
    /* ------------------------------------------------------- 1. RÉFÉRENTIEL */
    {
      titre: '1. Déclarer ce qu’on achète',
      introduction:
        'Rien ne se commande, ne se reçoit ni ne se compte avant d’exister au catalogue. Le fournisseur d’abord, la référence ensuite, la qualité de tapis enfin.',
      etapes: [
        {
          titre: 'Créer le fournisseur',
          role: 'Acheteur',
          route: '/fournisseurs',
          acces: 'Menu Fiches de base → Fournisseurs, bouton « Nouveau ».',
          gestes: [
            'Cliquez « Nouveau » : la fiche s’ouvre sur la page.',
            'Remplissez l’identité, la devise de facturation et les délais.',
            'Enregistrez.',
          ],
          champs: ['Code', 'Raison sociale', 'Pays', 'Devise de facturation', 'Délai de livraison (jours)', 'Tolérance de pesée (%)'],
          resultat: 'Le fournisseur apparaît dans la liste et dans les choix des références et des bons.',
          erreur:
            'Oublier la devise de facturation : le bon de commande la reprend, et un bon en mauvaise devise fausse le taux engagé. La tolérance de pesée, elle, se fixe avec le droit VALIDER.',
        },
        {
          titre: 'Créer la référence',
          role: 'Acheteur',
          route: '/catalogue',
          acces: 'Menu Fiches de base → Références, bouton « Nouveau ».',
          gestes: [
            'Cliquez « Nouveau ».',
            'Section Général : catégorie, famille, fournisseur, référence fournisseur, couleur.',
            'Section Conditionnement : unité de stock, poids par unité, unités par palette, suivi par lot.',
            'Section Achat : prix par unité, devise, quantité minimale de commande.',
            'Enregistrez.',
          ],
          champs: [
            'Référence',
            'Désignation',
            'Catégorie matière',
            'Fournisseur',
            'Référence fournisseur',
            'Unité de stock',
            'Poids par unité (kg)',
            'Unités par palette',
            'Suivi par lot',
            'Prix par unité',
            'Quantité minimale de commande (kg)',
          ],
          resultat: 'La référence se commande, se reçoit, se compte. Le kilogramme reste l’unité du stock ; bobines et palettes ne sont que des façons de saisir.',
          erreur:
            'Laisser le poids par unité vide sur un fil vendu en bobines : toute saisie en bobines est alors refusée (jamais de conversion « ×1 »). Le poids réel se mesure ensuite lot par lot à la réception.',
        },
        {
          titre: 'Décrire la qualité de tapis',
          role: 'Direction',
          route: '/qualites',
          acces: 'Menu Production → Qualités.',
          gestes: [
            'Créez la qualité ou dupliquez-en une proche.',
            'Onglet Densité : la densité (kg/m²) de chaque rôle BOM (poil, trame…).',
            'Onglet Composition : les références de chaque rôle et leur part ; chaque rôle doit faire 100 %.',
            'Passez-la en service.',
          ],
          champs: ['Code qualité', 'Nom', 'Rôle BOM', 'Densité', 'Référence', '%'],
          resultat: 'La qualité peut entrer dans un plan de production : chaque m² planifié s’explose en kilos de chaque référence.',
          erreur: 'Une composition qui ne fait pas 100 % par rôle : la mise en service est refusée (à 0,5 point près).',
        },
      ],
    },

    /* ------------------------------------------------------ 2. PLANIFIER */
    {
      titre: '2. Planifier, puis savoir quoi acheter',
      introduction:
        'Le besoin vient du PLAN DE PRODUCTION SEUL. Les ordres de fabrication servent à suivre la production et ses écarts ; ils ne créent pas de besoin d’achat et ne déplacent jamais le stock.',
      etapes: [
        {
          titre: 'Saisir le plan de production',
          role: 'Direction',
          route: '/plans',
          acces: 'Menu Planification → Plans de production, bouton « + » (Nouveau plan).',
          gestes: [
            'Cliquez « Nouveau plan », donnez-lui un libellé, un mois de départ et un horizon.',
            '« Choisir des qualités » : cochez celles à produire, puis « Ajouter ».',
            'Saisissez les m² par mois de chaque qualité, enregistrez.',
            '« Passer en simulation », puis « Figer les recettes ».',
            '« Valider » : le plan passe en cours (un seul plan en cours à la fois).',
            '« Calculer le MRP » pour exploser le plan en besoins.',
          ],
          champs: ['Libellé', 'Mois de départ', 'Horizon', 'Croissance annuelle %'],
          resultat: 'Le plan est en cours et ses besoins sont calculés, référence par référence et mois par mois.',
          erreur:
            'Valider sans « Calculer le MRP » : le plan est en service mais aucun besoin n’existe encore. « Calculer le MRP » demande l’écriture du module MRP.',
        },
        {
          titre: 'Lire les besoins',
          role: 'Acheteur',
          route: '/besoins',
          acces: 'Menu Production → Besoins (MRP).',
          gestes: [
            'Choisissez le plan de production en haut de l’écran.',
            'Lisez, par référence, les kilos nécessaires mois par mois ; filtrez par catégorie ou fournisseur.',
            '« Imprimer les besoins » ou « Exporter » pour les partager.',
          ],
          champs: ['Plan de production', 'Référence', 'Total kg'],
          resultat: 'On sait, pour chaque référence, combien de kilos le plan consommera et quand.',
          erreur: 'Chercher l’effet d’un ordre de fabrication ici : l’OF n’entre pas dans le besoin, seul le plan compte.',
        },
        {
          titre: 'Décider quoi commander',
          role: 'Direction',
          route: '/plan-achat',
          acces: 'Menu Planification → Plans d’achat, onglet « À commander ».',
          gestes: [
            'L’onglet « À commander » liste chaque référence du plan avec ce qui la couvre : la première rupture la plus proche en tête, puis la date limite de commande.',
            'Lisez « Couvert jusqu’au », « 1re rupture », la « Proposition » du moteur et « Avant le » ; la ligne ↳ dit ce qui n’est pas compté (bon en retard, transfert sans date…).',
            'Cliquez la ligne : le détail montre la courbe du solde, le calcul étape par étape (D, F, sécurité, S(D), besoin théorique, minimum, arrondi) et la chronologie.',
            '« Commander » : la proposition de la référence est régénérée et s’ouvre, cochée, dans « Lignes à commander ».',
            'Choisissez « Envoyer vers » (un nouveau bon ou un brouillon du même fournisseur), ajustez kilos, prix, palettes ou bobines, puis « Envoyer au bon de commande ».',
          ],
          champs: ['Couvert jusqu’au', '1re rupture', 'Proposition', 'Avant le', 'Envoyer vers', 'Qté (kg)', 'Prix / kg', 'Palettes'],
          resultat:
            'Un bon de commande BROUILLON existe pour le fournisseur ; la proposition est « Commandée », et la date de besoin D est devenue la livraison prévue de la ligne.',
          erreur:
            'Croire que la proposition est une commande : c’est un calcul ; le bon doit encore passer le contrôle et la validation, et la référence reste « plan non couvert » tant qu’il n’est pas validé et daté. Si ce bon est annulé, la proposition passe « Annulée avec le bon » et la régénération suivante en propose une neuve.',
        },
      ],
    },

    /* ------------------------------------------------------- 3. COMMANDER */
    {
      titre: '3. Commander',
      introduction:
        'Un bon passe par quatre mains au plus : celui qui le crée, celui qui le contrôle (un autre compte), le fournisseur qui confirme ses prix, la direction qui le valide. Le créateur ne valide jamais son propre bon (B4).',
      etapes: [
        {
          titre: 'Créer le bon de commande',
          role: 'Acheteur',
          route: '/bons-commande/nouveau',
          acces: 'Menu Achats → Bons de commande, bouton « + » (Nouveau bon) ; ou depuis le plan d’achat.',
          gestes: [
            'Choisissez le fournisseur : sa devise se propose.',
            'Ajoutez les lignes : la grille propose d’abord les références « Du plan d’achat », sinon « Tout le catalogue ».',
            'Saisissez la quantité en kilos ; les palettes et bobines se calculent.',
            '« Créer le bon ».',
          ],
          champs: ['Fournisseur', 'Date du bon', 'Livraison prévue', 'Devise', 'Notre référence', 'Unité au bon', 'Qté (kg)', 'Prix'],
          resultat: 'Le bon existe en Brouillon, avec son numéro ; il se modifie encore librement.',
          erreur:
            'Saisir la même référence sur deux lignes : les quantités sont fusionnées en une seule ligne. Une référence absente se crée au catalogue d’abord (lien « Ouvrir le catalogue »).',
        },
        {
          titre: 'Envoyer au contrôle, puis contrôler',
          role: 'Responsable',
          route: '/bons-commande/:id',
          acces: 'Liste des bons de commande, clic sur le bon.',
          gestes: [
            'L’acheteur clique « Envoyer au contrôle » : le bon est figé.',
            'Un AUTRE compte relit quantités et prix, puis clique « Contrôlé : demande de prix » — ou « Sauter la demande de prix », avec un motif.',
            'En demande de prix : « Imprimer la demande de prix », saisir la réponse du fournisseur (prix confirmé), l’enregistrer, puis « Soumettre à validation ».',
            'Une erreur ? « Renvoyer en brouillon », avec le motif à corriger.',
          ],
          champs: ['Prix confirmé', 'Motif'],
          resultat: 'Le bon attend la validation de la direction.',
          erreur: 'Contrôler son propre bon : le bouton reste grisé (« B4 : un autre compte que le créateur contrôle le bon »).',
        },
        {
          titre: 'Valider et envoyer le bon',
          role: 'Direction',
          route: '/bons-commande/:id',
          acces: 'Liste des bons, filtre « En attente de validation ».',
          gestes: [
            '« Valider ». En devise, le taux du jour est proposé ; un autre taux (celui de la banque) se retient avec son motif.',
            '« Valider à ce taux » : le taux est figé sur le bon.',
            'L’acheteur clique ensuite « Envoyer au fournisseur ».',
          ],
          champs: ['Taux', 'Pourquoi ce taux'],
          resultat: 'Le bon est validé puis envoyé : il engage, et ses lignes attendent la livraison.',
          erreur:
            'Un montant au-dessus du plafond du valideur : « Valider » reste grisé. Un bon validé par erreur se dévalide (il redevient brouillon), sauf s’il a déjà été livré.',
        },
      ],
    },

    /* --------------------------------------------------------- 4. RECEVOIR */
    {
      titre: '4. Recevoir, contrôler, facturer',
      introduction:
        'Une réception est un ARRIVAGE : chaque ligne pesée se rattache à une ligne de bon, d’un ou de plusieurs bons. Le magasinier pèse, un autre contrôle et valide ; la facture rend la valeur définitive.',
      etapes: [
        {
          titre: 'Ouvrir la réception',
          role: 'Magasinier',
          route: '/receptions/nouvelle',
          acces: 'Menu Achats → Réceptions, bouton « + » (Nouvelle réception).',
          gestes: [
            'Choisissez le fournisseur et la date ; recopiez le bon de livraison.',
            '« Reprendre un bon » : cochez les lignes livrées (« Tout retenir » pour toutes), puis « Ajouter ».',
            'Un article livré sans bon : « Article hors commande » (un bon de régularisation naîtra, un seul par arrivage).',
            'Pesez sur la ligne, puis « Enregistrer la réception ».',
          ],
          champs: ['Fournisseur', 'Date de réception', 'Bon de livraison', 'Nombre de colis', 'Poids brut (kg)', 'Reprendre un bon', 'Pesé (kg)', 'Lot fournisseur', 'Magasin'],
          resultat: 'La réception existe en Brouillon ; ses lignes se corrigent encore.',
          erreur:
            'Laisser une ligne non validée (✓) : « Enregistrer » reste grisé. Un excédent au-delà de la tolérance du fournisseur exige une dérogation motivée.',
        },
        {
          titre: 'Peser ligne par ligne et soumettre au contrôle',
          role: 'Magasinier',
          route: '/receptions/:id',
          acces: 'Liste des réceptions, clic sur la réception (sur téléphone : la pesée mobile).',
          gestes: [
            'Sur chaque ligne : pesé, unité, palettes et bobines, lot du fournisseur, magasin ; « ✓ Valider la ligne ».',
            'Les dates de fabrication et de péremption s’ouvrent au clic, dans le détail de la ligne.',
            '« Enregistrer », puis « Soumettre au contrôle ».',
          ],
          champs: ['Qté BL', 'Pesé (kg)', 'Pal. · bob.', 'Lot fournisseur', 'Fabrication', 'Péremption', 'Dérogation à l’excédent'],
          resultat: 'La réception est « À contrôler » : la pesée est figée.',
          erreur:
            'Un fil suivi au lot sans bobines comptées : la soumission est bloquée tant qu’on ne les a pas comptées. Un lot fournisseur laissé vide n’est pas une faute : un lot interne FOURNISSEUR-JJMMAA-NN sera proposé à la validation.',
        },
        {
          titre: 'Contrôler et valider la réception',
          role: 'Responsable',
          route: '/receptions/:id',
          acces: 'Liste des réceptions, filtre « À contrôler ».',
          gestes: [
            'Relisez : qualité, magasin, dates et observations se corrigent encore sur la ligne (crayon), pas les quantités.',
            'Une erreur de pesée : « Renvoyer au magasinier », avec ce qu’il doit corriger.',
            '« Valider le contrôle » (confirmez les lots internes proposés s’il en manque).',
            'Après validation : saisir les frais d’approche, chacun avec sa clé (poids, valeur, parts égales).',
          ],
          champs: ['Ce que le magasinier doit corriger', 'Qualité', 'Répartition'],
          resultat:
            'Le fil entre en stock au prix du bon (valeur provisoire) : CMUP, archive, historique de prix et conditionnement du lot sont mis à jour ; les étiquettes de lot (Code 128) s’impriment.',
          erreur:
            'Valider une réception qu’on a pesée : bouton grisé (« B4 : vous avez pesé ou corrigé cette réception — un autre la valide »). Un inventaire ouvert sur le magasin bloque aussi la validation, et un bon de régularisation non envoyé la retient.',
        },
        {
          titre: 'Rapprocher la facture fournisseur',
          role: 'Acheteur',
          route: '/factures-fournisseur/:id',
          acces: 'Menu Achats → Factures fournisseur, bouton « Nouvelle facture ».',
          gestes: [
            'Numéro, fournisseur, date ; en devise, le taux de la facture.',
            'Un seul tableau : cochez chaque pesée que la facture couvre — la case cochée ouvre la saisie du kilo facturé, du prix et de la remise.',
            '« Aperçu » montre l’écart avec la valeur provisoire, puis « Enregistrer ».',
            'Le valideur clique « Valider ».',
          ],
          champs: ['N° de facture', 'Fournisseur', 'Date de la facture', 'Taux', 'Total imprimé', 'Facturé kg', 'Prix /kg'],
          resultat:
            'La valeur définitive part au stock (le CMUP bouge, l’écart sur les kilos déjà sortis est tracé) ; un arrivage entièrement facturé se clôture.',
          erreur:
            'Facturer deux fois la même pesée (FACTURE-DOUBLE) ou couper une référence d’un arrivage entre deux factures (FACTURE-BLOC) : refusé. Une correction après validation passe par un avoir.',
        },
      ],
    },

    /* ----------------------------------------------- 5. FAIRE VIVRE LE STOCK */
    {
      titre: '5. Faire vivre le stock',
      introduction:
        'Le grand livre des mouvements fait foi : on ne l’efface jamais, on contre-passe. Un inventaire ouvert gèle le magasin (ou ses seules références) jusqu’à sa clôture.',
      etapes: [
        {
          titre: 'Saisir un mouvement',
          role: 'Magasinier',
          route: '/mouvements/nouveau',
          acces: 'Menu Stock → Mouvements, bouton « Saisir un mouvement ».',
          gestes: [
            'Choisissez le type (consommation directe, sortie hors machine, ajustement, retour de prêt…), le magasin et le motif.',
            'Consommation directe : l’OF si on en a un, sinon la qualité, obligatoire.',
            'Ajoutez les lignes : référence, lot, quantité (palettes, bobines et kilos se lient).',
            '« Enregistrer le mouvement ».',
          ],
          champs: ['Type de mouvement', 'Magasin', 'Motif', 'Ordre de fabrication', 'Qualité', 'Date du mouvement', 'Référence', 'Lot', 'Qté (kg)'],
          resultat: 'Le mouvement est au grand livre ; chaque sortie porte son coût (le CMUP du moment).',
          erreur:
            'Sortir plus que le stock du lot : « R02 : stock insuffisant » — le stock n’est jamais négatif. Une erreur se corrige par contre-passation (Direction), pas par un mouvement inverse inventé.',
        },
        {
          titre: 'Transférer entre magasins',
          role: 'Magasinier',
          route: '/transferts/nouveau',
          acces: 'Menu Stock → Transferts, bouton « + » (Nouveau transfert) ; l’expédition et la réception se font ensuite dans la liste des transferts.',
          gestes: [
            'Choisissez le magasin source, puis le magasin destinataire ; saisissez la date prévue de disponibilité au destinataire si vous la connaissez.',
            'Ajoutez les lignes : la référence parmi le stock de la source, le lot, les kilos (ou palettes et bobines, liés) ; « Dispo » dit ce que la source détient. « Enregistrer le transfert ».',
            'Dans la liste : « Bon » imprime le bon de sortie ; « Expédier » demande la date prévue de disponibilité si elle manque (obligatoire), puis sort la marchandise du magasin source.',
            'En route, le fil compte dans la valeur du stock, et dans la couverture du plan d’achat à sa date prévue de disponibilité ; « Réviser la date » la déplace tant qu’il roule.',
            'À l’arrivée : « Bon de réception », comptage, puis « Réceptionner » (droit VALIDER).',
          ],
          champs: ['Magasin source', 'Magasin destinataire', 'Disponible au magasin destinataire le', 'Référence', 'Lot', 'Qté (kg)', 'Pal. · bob.', 'Dispo'],
          resultat:
            'Le stock a changé de magasin, valorisé au CMUP figé au départ ; les deux bons s’impriment depuis le transfert.',
          erreur:
            'Expédier sans date prévue : refusé (« TRF-DATE »), la saisie s’ouvre sous la ligne. Laisser la date dépasser sans la réviser : le fil sort de la couverture du plan d’achat. Oublier de réceptionner : le fil reste en route et le magasin d’arrivée ne le voit pas.',
        },
        {
          titre: 'Charger une machine',
          role: 'Magasinier',
          route: '/machines/:code/fiche/:type/:zone',
          acces: 'Menu Stock → Machines, la machine, puis « Charger » sur la ligne de l’étage.',
          gestes: [
            'Ajoutez les références à charger (scan de l’étiquette ou recherche) : une ligne par référence et par lot.',
            'Sur chaque ligne : les bobines à charger, l’OF de la ligne, et sans OF la qualité ; la voie.',
            '« Aperçu » : relisez ce que la validation enregistrera.',
            '« Valider la décision ».',
          ],
          champs: ['À charger', 'Poids/bob.', 'OF · qualité · voie', 'Motif'],
          resultat: 'Le fil passe du magasin à l’étage de la machine ; la décision est archivée avec son état avant et après.',
          erreur:
            'Charger sans qualité ni OF : refusé. Plus de bobines que la capacité de l’étage pour cette voie : un signal C63, pas un refus.',
        },
        {
          titre: 'Constater, puis décharger',
          role: 'Magasinier',
          route: '/machines/:code/fiche/:type/:zone',
          acces: 'Écran de la machine, « Constater » ou « Décharger » sur la ligne de l’étage.',
          gestes: [
            'Constater : saisissez le % constaté de chaque ligne ; le nombre de bobines et la voie ne changent pas (un constat à 0 % ferme la ligne).',
            'Décharger : les bobines retirées et leur destination — retour magasin, ou DÉCHET pour le rebut.',
            'L’écart (avant + chargé − retiré − après) se classe par motif ; il appartient à l’OF sortant.',
            '« Aperçu », puis « Valider la décision ».',
          ],
          champs: ['% constaté', 'À retirer', 'Destination des bobines retirées', 'Écart', 'Précision du motif'],
          resultat: 'La consommation de l’étage est connue et rattachée à l’OF ; le fil retiré est revenu au magasin ou parti en déchet.',
          erreur:
            'Vouloir corriger une ancienne fiche : seule la dernière décision d’un étage se retire (dévalider / annuler). Plus loin dans le temps, on constate l’état réel avec le motif « Correction ».',
        },
      ],
    },

    /* ----------------------------------------------------------- 6. COMPTER */
    {
      titre: '6. Compter : l’inventaire',
      introduction:
        'Un inventaire suit le même chemin qu’un bon : Brouillon → Validé (par un autre compte) → Clôturé. Ouvert, il gèle le magasin : GLOBAL tout le magasin, TOURNANT ou CIBLÉ ses seules références.',
      etapes: [
        {
          titre: 'Ouvrir l’inventaire',
          role: 'Responsable',
          route: '/inventaires/nouveau',
          acces: 'Menu Stock → Inventaires, bouton « Nouvel inventaire ».',
          gestes: [
            'Choisissez le magasin et le type : Global, Tournant (liste proposée selon la classe ABC) ou Ciblé (par recherche, famille ou catégorie).',
            'Tournant ou ciblé : arrêtez la liste des références, puis « Valider la liste et créer ». Global : « Créer », puis « Préparer les lignes ».',
            'Imprimez la feuille de comptage.',
          ],
          champs: ['Magasin', 'Type'],
          resultat: 'L’inventaire est ouvert, ses lignes prêtes ; le magasin (ou sa liste) est gelé : aucune entrée ni sortie n’y passe.',
          erreur: 'Ouvrir un inventaire global en pleine journée de réception : tout le magasin se fige, réceptions comprises.',
        },
        {
          titre: 'Compter, valider, clôturer',
          role: 'Magasinier',
          route: '/inventaires/:id',
          acces: 'Liste des inventaires, clic sur l’inventaire.',
          gestes: [
            'Saisissez le compte de chaque ligne (kilos, ou bobines converties au poids du lot) et le motif d’un écart.',
            '« Enregistrer le comptage ».',
            'Un autre compte, avec le droit VALIDER : « Valider le comptage » (plus de saisie), puis « Clôturer et ajuster ».',
          ],
          champs: ['Compté kg', 'Bobines', 'Écart', 'Motif'],
          resultat: 'Les écarts deviennent des mouvements d’ajustement ; le magasin est dégelé.',
          erreur:
            'Un écart au-delà de la tolérance sans motif : la validation est bloquée. Après clôture, on ne revient en arrière qu’en contre-passant les ajustements puis en dévalidant.',
        },
      ],
    },

    /* ------------------------------------------------------------- 7. LIRE */
    {
      titre: '7. Lire les états',
      etapes: [
        {
          titre: 'Le stock, sa valeur et ses signaux',
          role: 'Direction',
          route: '/etat-stock',
          acces: 'Menu Stock → État des stocks ; puis Finance → Valorisation (CMUP) et Analyses → Contrôles de cohérence.',
          gestes: [
            'État des stocks : ce que chaque magasin et chaque machine porte, en kilos, à l’instant.',
            'Valorisation : la valeur au CMUP, qui suit chaque entrée, frais et facture.',
            'Contrôles de cohérence (C01, C02…) : des signaux à lire, jamais des blocages.',
            'Les états imprimables (adresse /etats, et le bouton « Imprimer » de chaque document) : toutes les impressions, dont ce manuel (/etats/manuel).',
          ],
          champs: ['Stock global', 'En magasin', 'Sur machines', 'Valeur'],
          resultat: 'On sait ce qu’on a, où, pour combien, et ce qui mérite un regard.',
          erreur: 'Chercher un état « à une date » ici : l’état des stocks est celui de l’instant ; l’historique se lit dans les mouvements.',
        },
      ],
    },
  ],
}
