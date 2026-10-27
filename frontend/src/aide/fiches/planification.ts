/**
 * FICHES D'AIDE — PLANIFICATION : PLANS DE PRODUCTION, ORDRES DE FABRICATION, BESOINS.
 *
 * Une partie du catalogue : `../contenu.ts` les assemble, `../types.ts` donne
 * la forme d'une fiche. Chaque `champs[].nom` est l'intitulé EXACT de l'écran :
 * c'est par lui que l'indice ⓘ se pose à côté du champ (`../indice.ts`).
 * Réécrites le 27/10/2026 d'après le code des écrans : le besoin vient du PLAN
 * SEUL, l'OF n'en est plus une source.
 */
import type { Sujet } from '../types.ts'

export const FICHES_PLANIFICATION: Sujet[] = [
  // ==========================================================================
  // /besoins — Production & Besoins (MRP)
  // ==========================================================================
  {
    route: '/besoins',
    titre: 'Production & Besoins (MRP)',
    chemin: 'Production → Besoins (MRP)',
    objectif:
      'Lire, mois par mois, les mètres carrés qu’un plan de production prévoit par qualité et les kilos de matière qu’ils réclament par référence.',
    prerequis: [
      'Un plan de production enregistré (écran Plans de production) ; c’est le plan EN COURS qui compte pour les achats.',
      'Des qualités dont la composition (recette) est renseignée : une qualité sans composition ne produit aucun besoin.',
      'Un calcul MRP lancé sur ce plan (« Recalculer les besoins » ici, ou « Calculer le MRP » sur le plan) : sans lui, le tableau reste vide.',
    ],
    droits:
      'Lecture du module MRP pour consulter, exporter et imprimer ; écriture du module MRP pour « Recalculer les besoins ».',
    procedures: [
      {
        titre: 'Consulter les besoins d’un plan',
        etapes: [
          'À l’ouverture, l’écran montre le plan EN COURS (à défaut, le premier de la liste) ; changez-le dans la liste « Plan de production » en haut à droite.',
          'Le bandeau rappelle le statut du plan, sa période, sa croissance, le taux de perte appliqué et l’heure du dernier calcul.',
          'Onglet « Besoins matière » : une ligne par référence (catégorie et fournisseur dessous), une colonne par mois du plan, le total à droite, la ligne TOTAL kg en bas.',
          'Resserrez avec la recherche (référence, fournisseur…), la catégorie, le fournisseur et la période Du / Au : les totaux sont recalculés sur ce qui reste affiché.',
          'Onglet « Production planifiée » : les m² par qualité et par mois qui expliquent ces kilos, avec le poids au m² de chaque qualité.',
        ],
        resultat: 'Le besoin brut de matière du plan, référence par référence et mois par mois.',
      },
      {
        titre: 'Recalculer les besoins',
        etapes: [
          'Choisissez le plan (un plan clôturé ne se recalcule plus : le bouton n’apparaît pas).',
          'Cliquez « Recalculer les besoins » : le serveur ré-explose la production du plan par les recettes.',
          'Le message donne le nombre de lignes générées et le total en kg ; « Dernier calcul » se met à jour.',
        ],
        resultat:
          'Les besoins du plan sont remplacés (jamais additionnés au calcul précédent) ; pour le plan en cours, le plan d’achat les suit.',
      },
      {
        titre: 'Sortir les besoins',
        etapes: [
          '« Exporter » produit un fichier CSV des lignes affichées (code, désignation, catégorie, fournisseur, unité, un mois par colonne, total kg).',
          '« Imprimer les besoins » ouvre l’état imprimable du plan choisi.',
        ],
      },
    ],
    champs: [
      {
        nom: 'Plan de production',
        description:
          'Le plan dont on lit la production et les besoins : libellé, version et statut. C’est le contexte de tout l’écran.',
        defaut: 'Le plan en cours, sinon le premier de la liste.',
      },
      {
        nom: 'Catégorie',
        description:
          'Ne garder que les références d’une catégorie de matière. Seules les catégories présentes dans ce plan sont proposées.',
        defaut: 'Toutes catégories',
      },
      {
        nom: 'Fournisseur',
        description:
          'Ne garder que les références d’un fournisseur ; la liste se filtre en tapant et ne propose que les fournisseurs présents dans ce plan.',
        defaut: 'Tous fournisseurs',
      },
      {
        nom: 'Du',
        description: 'Premier mois retenu dans le tableau des besoins. Les totaux ne portent que sur la période choisie.',
      },
      { nom: 'Au', description: 'Dernier mois retenu dans le tableau des besoins.' },
      {
        nom: 'Période',
        description:
          'Premier et dernier jour du plan, et son nombre de mois. Les colonnes mensuelles viennent de là, jamais d’un calendrier supposé.',
      },
      {
        nom: 'Croissance',
        description: 'La croissance annuelle enregistrée sur le plan, déjà comprise dans les m² prévus.',
        valeurs: '%',
      },
      {
        nom: 'Taux de perte appliqué',
        description:
          'Le taux de perte figé sur le plan, ajouté à la matière nécessaire : besoin = (1 + taux de perte) × Σ (kg/m² de la composition × m² prévus).',
        valeurs: '%',
      },
      {
        nom: 'Dernier calcul',
        description:
          'Date et heure du dernier calcul MRP de ce plan. Une recette ou un plan modifiés depuis ne sont pris en compte qu’au prochain calcul.',
      },
      {
        nom: 'Référence',
        description: 'La référence de matière réclamée par les compositions ; sa catégorie et son fournisseur sont écrits dessous.',
      },
      {
        nom: 'Total kg',
        description:
          'Le besoin brut de la référence sur les mois affichés, perte comprise. Un tiret dans un mois veut dire aucun besoin ce mois-là.',
        valeurs: 'kg',
      },
      { nom: 'Qualité', description: 'Onglet Production planifiée : la qualité produite, code et nom.' },
      { nom: 'Poids kg/m²', description: 'Le poids commercial au m² de la qualité.', valeurs: 'kg/m²' },
      { nom: 'Total m²', description: 'Les m² prévus de la qualité sur toute la période du plan.', valeurs: 'm²' },
    ],
    regles: [
      'LE BESOIN VIENT DU PLAN DE PRODUCTION SEUL : ni les ordres de fabrication, ni le stock, ni les bons en cours n’y entrent.',
      'CE N’EST PAS UNE PROPOSITION D’ACHAT : le besoin brut ne retire ni le stock ni ce qui est déjà commandé ; c’est le plan d’achat qui fait cette soustraction.',
      'Seul le plan EN COURS alimente le plan d’achat. Un brouillon ou une simulation se calcule, mais ses besoins restent une simulation ; un plan clôturé reste consultable comme historique.',
      'Les quantités sont en kilogrammes, unité canonique : la conversion vers l’unité d’achat se fait au bon de commande.',
      'L’écran ne recalcule rien lui-même : il affiche les besoins que le serveur a calculés et enregistrés.',
      'Un recalcul remplace les besoins du plan, il ne s’ajoute pas au précédent.',
      'Un besoin nul sur une référence attendue signale presque toujours une composition incomplète, pas une absence de besoin.',
    ],
    messages: [
      {
        message: 'Un plan cloture ne peut plus etre recalcule.',
        cause: 'Le plan est clôturé : ses besoins sont figés.',
      },
      {
        message: 'Qualite non figee dans l’entete : … Executer d’abord /figer-recettes.',
        cause:
          'Une qualité a des m² prévus sans figurer dans l’en-tête du plan : ouvrez le plan, puis « Figer les recettes ».',
      },
      {
        message: 'Aucun besoin calculé',
        cause: 'La production est planifiée mais le MRP n’a pas encore tourné : lancez « Recalculer les besoins ».',
      },
    ],
    liens: [
      { route: '/plans', libelle: 'Plans de production' },
      { route: '/qualites', libelle: 'Qualités et compositions' },
      { route: '/plan-achat', libelle: 'Plan d’achat' },
    ],
  },

  // ==========================================================================
  // /plans — Plans de production (liste et document, même route)
  // ==========================================================================
  {
    route: '/plans',
    titre: 'Plans de production',
    chemin: 'Planification → Plans de production',
    objectif:
      'Planifier les mètres carrés à produire par qualité sur une période glissante — base mensuelle, saisonnalité, croissance — et mettre en service le plan qui donne les besoins de matière.',
    prerequis: [
      'Des qualités ACTIVES, avec leur composition : seules elles sont proposées.',
      'Une qualité ne peut être retenue que par un seul plan non clôturé : celles déjà prises par un autre plan ne sont pas proposées.',
    ],
    droits:
      'Lecture du module Plans pour consulter ; écriture pour créer, modifier, passer en simulation, figer les recettes, recalculer la grille et supprimer un brouillon ; validation pour mettre en service (« Valider ») et clôturer. « Calculer le MRP » et « Archiver » demandent l’écriture du module MRP. « Dévalider » est réservé aux rôles Administrateur et Direction, avec le droit de validation.',
    procedures: [
      {
        titre: 'Créer un plan',
        etapes: [
          'Bouton « + » (Nouveau plan) en haut de la liste.',
          'En-tête : saisissez le libellé, au besoin le scénario, le mois de départ, l’horizon et la croissance annuelle ; « Période couverte » affiche le premier et le dernier mois.',
          'Onglet « Qualités produites » : « Choisir des qualités », cochez-en plusieurs (ou « Tout cocher »), puis « Ajouter ».',
          'Onglet « Saisonnalité » : un coefficient par mois de l’année et par qualité (1,00 par défaut, 0 = arrêt de production) ; « Tout à 1,00 » remet la grille à plat.',
          'Onglet « Plan déployé » : saisissez la base mensuelle (m²) de chaque qualité ; les colonnes mensuelles se calculent à chaque frappe.',
          'Le pied de page dit ce qui reste à corriger ; « Enregistrer en-tête et grille » s’active quand il n’y a plus rien à corriger et que quelque chose a changé.',
        ],
        resultat: 'Le plan est enregistré en BROUILLON ; le serveur reconstruit la grille mensuelle.',
      },
      {
        titre: 'Mettre un plan en service',
        etapes: [
          'Ouvrez le plan en brouillon : « Passer en simulation » (impossible tant que le plan a quelque chose à corriger).',
          'En simulation : « Figer les recettes » vérifie que chaque qualité planifiée figure dans l’en-tête et est encore active.',
          '« Valider » (droit de validation) met le plan EN COURS. Un seul plan peut être en cours : clôturez d’abord l’ancien.',
          'Plan en cours : « Calculer le MRP » produit ses besoins de matière ; « Archiver » en garde une photo datée, avec le stock projeté.',
        ],
        resultat: 'Le plan alimente le MRP et le plan d’achat ; son en-tête et sa grille ne se modifient plus.',
      },
      {
        titre: 'Corriger ou arrêter un plan',
        etapes: [
          'Brouillon ou simulation : modifiez directement, puis « Enregistrer en-tête et grille » ; « Recalculer » (onglet Plan déployé) refait la grille côté serveur à partir de ce qui est enregistré.',
          'Plan en cours ou clôturé à corriger : « Dévalider », avec un motif ; le plan revient en brouillon, on corrige, on revalide — puis on recalcule le MRP.',
          'Fin de période : dans la liste, l’icône « Clôturer » sur la ligne du plan, puis confirmez.',
          'Un plan jamais validé (brouillon ou simulation) se supprime par l’icône corbeille de la liste.',
        ],
        resultat:
          'Clôturé, le plan sort du plan d’achat et ses qualités redeviennent disponibles pour un autre plan ; il reste consultable.',
      },
    ],
    champs: [
      { nom: 'Plan', description: 'Liste : le libellé du plan, sa version et son scénario.' },
      { nom: 'Période', description: 'Liste : premier et dernier jour du plan.' },
      { nom: 'Mois', description: 'Liste : l’horizon du plan, en mois.' },
      {
        nom: 'Statut',
        description:
          'Brouillon → Simulation → En cours (en service, verrouillé) → Clôturé. Seul le plan En cours alimente le MRP et le plan d’achat.',
        valeurs: 'Brouillon, Simulation, En cours, Clôturé',
      },
      {
        nom: 'Qualités',
        description:
          'Liste : le nombre de qualités retenues ; un badge rouge signale les qualités qui ne sont plus actives.',
      },
      { nom: 'm² période', description: 'Liste : le total des m² prévus sur toute la période du plan.', valeurs: 'm²' },
      {
        nom: 'Besoins',
        description: 'Liste : le nombre de lignes de besoins calculées par le MRP ; « hors calcul » pour un plan clôturé.',
      },
      { nom: 'Clôture le', description: 'Liste : date et heure de clôture du plan.' },
      {
        nom: 'Libellé',
        description: 'Le nom du plan, tel qu’il apparaîtra dans les listes et sur l’écran des besoins.',
        obligatoire: true,
      },
      {
        nom: 'Scénario',
        description: 'Le nom du scénario, libre : BASE, HAUT, BAS… pour distinguer plusieurs hypothèses.',
      },
      {
        nom: 'Mois de départ',
        description: 'Le premier mois du plan ; la période part toujours du premier jour de ce mois.',
        obligatoire: true,
        defaut: 'Le mois courant.',
      },
      {
        nom: 'Horizon',
        description: 'La durée du plan, en mois.',
        valeurs: '3, 6, 9, 12, 18, 24, 36, 48 ou 60 mois',
        defaut: '12 mois (1 an)',
      },
      {
        nom: 'Croissance annuelle %',
        description:
          'La croissance appliquée au prorata des mois écoulés, composée et non linéaire : facteur = (1 + taux)^(rang / 12).',
        valeurs: '%',
        defaut: '0',
      },
      {
        nom: 'Période couverte',
        description: 'Calculée : le premier et le dernier mois du plan, et leur nombre. Elle ne se saisit pas.',
      },
      {
        nom: 'Qualité',
        description: 'Une qualité retenue par le plan, code et nom (onglets Qualités produites et Plan déployé). Il en faut au moins une.',
        obligatoire: true,
      },
      {
        nom: 'Composition',
        description:
          'Le nombre de lignes de composition actives de la qualité ; un badge rouge si la qualité n’est plus active.',
      },
      { nom: 'Total période', description: 'Les m² prévus de la qualité sur toute la période, calculés.', valeurs: 'm²' },
      {
        nom: 'Mois de l’année',
        description:
          'Saisonnalité : les douze mois du calendrier, un coefficient par qualité. Le profil se répète d’une année sur l’autre ; « hors période » marque un mois que ce plan ne couvre pas (il reste modifiable).',
        valeurs: 'coefficient ≥ 0 (1 = mois normal, > 1 = mois haut, < 1 = mois bas, 0 = arrêt)',
        defaut: '1,00',
      },
      {
        nom: 'Base / mois',
        description:
          'La seule case à saisir de la grille : les m² produits par mois en régime normal. Chaque mois vaut ARRONDI(base × coefficient du mois × facteur de croissance) ; « à saisir » en rouge tant qu’elle est vide.',
        obligatoire: true,
        valeurs: 'm², ≥ 0',
      },
      { nom: 'Total', description: 'Plan déployé : les m² de la qualité sur toute la période.', valeurs: 'm²' },
    ],
    regles: [
      'Le plan de production est la SEULE source du besoin de matière : le MRP et le plan d’achat ne lisent que lui (les ordres de fabrication n’y entrent pas).',
      'Seul le plan EN COURS alimente les besoins ; un brouillon ou une simulation ne compte pas, et un seul plan peut être en cours à la fois.',
      'Les m² ne se saisissent pas mois par mois : ils se déduisent de la base mensuelle, du coefficient du mois et de la croissance ; le résultat est un entier.',
      'La saisonnalité doit être complète : douze coefficients par qualité, sinon l’enregistrement est refusé.',
      'Une qualité ne peut figurer qu’une fois dans un plan, et dans un seul plan non clôturé ; seules les qualités actives sont retenues.',
      'Un plan en cours ou clôturé est figé : on le dévalide (motif obligatoire) pour le corriger ; on ne le supprime pas.',
      'La composition d’une qualité produite par le plan en service est verrouillée : pour la changer, on crée une nouvelle qualité.',
      'Le calcul MRP est une photo : après une correction du plan ou d’une recette, il faut relancer « Calculer le MRP ».',
      'Le plan du classeur (feuille Production_Plan) peut aussi être importé par un script d’administration, qui passe par les mêmes contrôles que l’écran ; cet écran n’a pas de bouton d’import.',
    ],
    messages: [
      {
        message: 'Le plan « … » est deja en service : un seul plan alimente le MRP et le plan d’achat.',
        cause: 'Un autre plan est en cours : clôturez-le avant de valider celui-ci.',
      },
      {
        message: 'Cette qualite figure deja dans un autre plan actif',
        cause: 'La qualité est retenue par un plan non clôturé : clôturez ce plan ou retirez-la de celui-ci.',
      },
      {
        message: 'R08 : seule une qualite ACTIVE peut etre retenue par un plan.',
        cause: 'La qualité choisie a été clôturée ou n’est pas active.',
      },
      {
        message: 'Ces qualites retenues ne sont plus actives : … Remplacez-les dans l’entete du plan.',
        cause:
          '« Figer les recettes » a trouvé des qualités qui ne sont plus actives : retirez-les et choisissez leurs remplaçantes.',
      },
      {
        message: 'Saisonnalite incomplete : … coefficient(s) manquant(s)',
        cause: 'Une qualité n’a pas ses douze coefficients de saisonnalité.',
      },
      {
        message: 'Un plan EN_COURS est fige : creez une nouvelle version pour le modifier.',
        cause: 'On tente d’enregistrer ou de recalculer un plan en service ou clôturé : dévalidez-le d’abord.',
      },
      {
        message: 'Un plan EN_COURS ne peut pas etre supprime. Le cloturer plutot.',
        cause: 'Seul un plan jamais validé (brouillon ou simulation) se supprime.',
      },
      {
        message: 'Transition de statut interdite sur le plan de production.',
        cause: 'Le passage demandé n’est pas prévu (par exemple de brouillon directement à en cours).',
      },
      {
        message: 'Le motif est obligatoire : dites en quelques mots pourquoi ce document revient en arriere.',
        cause: 'La dévalidation demande un motif d’au moins cinq caractères ; il reste au journal.',
      },
    ],
    liens: [
      { route: '/qualites', libelle: 'Qualités et compositions' },
      { route: '/besoins', libelle: 'Besoins (MRP)' },
      { route: '/ordres-fabrication', libelle: 'Ordres de fabrication' },
      { route: '/plan-achat', libelle: 'Plan d’achat' },
    ],
  },

  // ==========================================================================
  // /ordres-fabrication — liste et consommation par qualité
  // ==========================================================================
  {
    route: '/ordres-fabrication',
    titre: 'Ordres de fabrication',
    chemin: 'Planification → Ordres de fabrication',
    objectif:
      'Suivre les ordres de fabrication et comparer, par OF ou par qualité et par mois, la matière prévue par la recette à la matière réellement consommée.',
    prerequis: ['Des qualités déclarées ; une recette active pour que le prévu se calcule.'],
    droits: 'Lecture du module Plans pour consulter ; écriture pour créer un OF (« Nouvel OF »).',
    procedures: [
      {
        titre: 'Onglet « Ordres de fabrication »',
        etapes: [
          'La barre de droite filtre par statut (Tous les OF, Prévu, Lancé, Clôturé, Annulé), avec le nombre de chacun ; les filtres Période, Qualité et Numéro resserrent la liste.',
          'Cliquez une ligne pour ouvrir l’OF sur sa page.',
          '« Nouvel OF » ouvre la saisie d’un ordre de fabrication.',
        ],
        resultat: 'La liste des OF avec, pour chacun, le prévu, le réel et l’écart en kg.',
      },
      {
        titre: 'Onglet « Consommation par qualité »',
        etapes: [
          'Choisissez au besoin une qualité et une plage de mois (Du mois, Au mois).',
          'Chaque ligne donne, pour une qualité et un mois : le nombre d’OF, le métrage, le prévu, le réel et l’écart ; les colonnes « dont » détaillent le réel.',
          'Une ligne « Non attribué » regroupe l’historique consommé sans OF ni qualité (d’avant le 23/10/2026).',
        ],
        resultat: 'La consommation réelle par qualité et par mois, comparée à l’étalon de la recette.',
      },
    ],
    champs: [
      {
        nom: 'N° d’OF',
        description: 'Le numéro de l’OF : celui de l’ERP Production, ou OF-AAAA-NNNN attribué par le serveur.',
      },
      { nom: 'Date', description: 'La date de l’OF ; c’est elle qui le range dans un mois.' },
      {
        nom: 'Qualité',
        description:
          'La qualité à produire (son nom en survol). Dans l’onglet Consommation, « Non attribué » regroupe ce qui a été consommé sans OF ni qualité ; comme filtre, elle restreint la liste.',
        defaut: 'Toutes',
      },
      {
        nom: 'Métrage (m²)',
        description: 'La surface à produire par l’OF (dans l’onglet Consommation : la somme des OF de la ligne).',
        valeurs: 'm²',
      },
      {
        nom: 'Statut',
        description: 'Prévu → Lancé → Clôturé ; Annulé depuis Prévu ou Lancé.',
        valeurs: 'Prévu, Lancé, Clôturé, Annulé',
      },
      {
        nom: 'Prévu (kg)',
        description: 'L’étalon : métrage × recette, perte comprise. Jamais la consommation.',
        valeurs: 'kg',
      },
      {
        nom: 'Réel (kg)',
        description:
          'La consommation constatée : écarts des machines attribués à l’OF qui occupait la portion (corrections exclues), plus les consommations directes portant l’OF, retours déduits. Par qualité, s’y ajoute ce qui a été consommé sans OF sous cette qualité.',
        valeurs: 'kg',
      },
      {
        nom: 'Écart (kg)',
        description:
          'Réel − prévu, signé, avec son pourcentage ; en couleur d’alerte au-delà de 15 %. Par qualité, il ne compare que ce que les OF ont prévu à ce qu’ils ont consommé.',
        valeurs: 'kg',
      },
      { nom: 'Fin prévue', description: 'La date de fin prévue de l’OF, si elle est connue.' },
      {
        nom: 'Déchets · pertes · casses (kg)',
        description: 'Ce que les constats machine ont classé en déchet, perte ou casse, à part du fil consommé.',
        valeurs: 'kg',
      },
      {
        nom: 'Période',
        alias: ['Période — du'],
        description: 'Filtre de la liste : la plage de dates des OF (date de l’OF).',
      },
      { nom: 'Numéro', description: 'Filtre de la liste : une partie du numéro d’OF.' },
      {
        nom: 'Mois',
        description:
          'Consommation par qualité : le mois de l’OF, ou celui du constat / du mouvement pour ce qui a été consommé sans OF.',
      },
      {
        nom: 'OF',
        description: 'Consommation par qualité : le nombre d’OF de la ligne et, entre parenthèses, combien sont clôturés.',
      },
      { nom: 'dont OF (kg)', description: 'La part du réel consommée par des OF.', valeurs: 'kg' },
      { nom: 'dont sans OF (kg)', description: 'La part du réel consommée sans OF, sous cette qualité.', valeurs: 'kg' },
      { nom: 'dont fil (kg)', description: 'La part du réel venue des écarts constatés sur les machines.', valeurs: 'kg' },
      {
        nom: 'dont hors machine (kg)',
        description: 'La part du réel venue des consommations directes, retours déduits.',
        valeurs: 'kg',
      },
      { nom: 'Du mois', description: 'Premier mois retenu dans la consommation par qualité.' },
      { nom: 'Au mois', description: 'Dernier mois retenu dans la consommation par qualité.' },
    ],
    regles: [
      'L’OF PRÉVOIT, ORIENTE ET ANALYSE ; IL NE DÉPLACE JAMAIS LE STOCK. La matière bouge par les fiches machine et les consommations directes, qui portent l’OF.',
      'L’OF n’est pas une source du besoin de matière : le MRP et le plan d’achat ne lisent que le plan de production.',
      'Le réel ne vient jamais de la recette : il est la somme de ce qui a été constaté et sorti. Le prévu n’est qu’un étalon.',
      'Les OF annulés sont exclus des statistiques par qualité.',
      'Un OF clôturé dont le réel s’écarte du prévu de plus de 15 % est signalé (contrôle C61) ; des OF qui dépassent le plan en service sont signalés (contrôle C64). Ce sont des signaux, jamais des refus.',
    ],
    liens: [
      { route: '/ordres-fabrication/nouveau', libelle: 'Nouvel OF' },
      { route: '/plans', libelle: 'Plans de production' },
      { route: '/machines', libelle: 'Machines' },
      { route: '/fiche-hors-machine', libelle: 'Fiche hors machine' },
      { route: '/controles', libelle: 'Contrôles' },
    ],
  },

  // ==========================================================================
  // /ordres-fabrication/:id — un OF (la création, /ordres-fabrication/nouveau,
  // a les mêmes champs d'en-tête)
  // ==========================================================================
  {
    route: '/ordres-fabrication/:id',
    titre: 'Ordre de fabrication',
    chemin: 'Planification → Ordres de fabrication → un OF',
    objectif:
      'Créer un ordre de fabrication, le faire vivre (lancer, clôturer, annuler) et lire sa consommation : prévu par la recette, réel par référence, écart.',
    prerequis: [
      'La qualité à produire ; une recette active pour que le prévu se calcule (sinon un avertissement le dit).',
    ],
    droits:
      'Lecture du module Plans pour consulter ; écriture pour créer, modifier l’en-tête et « Lancer » ; validation pour « Clôturer » et « Annuler l’OF ».',
    procedures: [
      {
        titre: 'Créer un OF',
        etapes: [
          'Depuis la liste, « Nouvel OF ».',
          'Laissez « N° d’OF » vide pour un numéro OF-AAAA-NNNN, ou tapez celui de l’ERP Production.',
          'Renseignez la date (aujourd’hui par défaut), au besoin la fin prévue, la qualité (recherche en tapant) et le métrage en m² ; des notes si utile.',
          '« Créer » s’active quand la qualité, la date et un métrage positif sont saisis.',
        ],
        resultat: 'L’OF naît PRÉVU et s’ouvre sur sa page ; il ne touche pas le stock.',
      },
      {
        titre: 'Faire vivre l’OF',
        etapes: [
          'Tant qu’il est Prévu ou Lancé, l’en-tête se corrige ; « Enregistrer » n’apparaît qu’après un changement.',
          '« Lancer » (Prévu → Lancé) : l’OF est en production. Prévu ou lancé, il est proposé sur les lignes des fiches machine et sur la fiche hors machine.',
          '« Clôturer » (Lancé → Clôturé, droit de validation) : sa consommation est arrêtée et son en-tête figé.',
          '« Annuler l’OF » (depuis Prévu ou Lancé, droit de validation) : il sort des statistiques par qualité ; ce qui a été consommé reste dans les mouvements et les constats.',
        ],
        resultat: 'Un OF clôturé ou annulé ne se modifie plus.',
      },
      {
        titre: 'Lire la consommation',
        etapes: [
          'Les quatre chiffres donnent le prévu, le réel (fil et hors machine), l’écart réel − prévu et les déchets, pertes et casses.',
          'Le tableau détaille par référence ; « Réel hors machine » donne en survol le sorti et le rendu.',
          'Sur un écran étroit, les colonnes secondaires (déchets, autres écarts, lots) passent sur la ligne complémentaire ↳.',
        ],
      },
    ],
    exemples: [
      {
        titre: 'un écart qui se signale',
        situation: 'OF de 1 000 m² ; la recette, perte comprise, prévoit 1 200 kg de matière.',
        calcul: [
          ['Réel fil (écarts machine de l’OF)', '1 300 kg'],
          ['Réel hors machine (sorti 120 − rendu 20)', '100 kg'],
          ['Réel', '1 400 kg'],
          ['Écart réel − prévu', '+200 kg (+16,7 %)'],
        ],
        conclusion:
          'Au-delà de 15 %, l’écart s’affiche en couleur d’alerte, et l’OF clôturé est signalé par le contrôle C61 — sans rien bloquer.',
      },
    ],
    champs: [
      {
        nom: 'N° d’OF',
        description: 'Le numéro de l’ERP Production, unique ; laissé vide à la création, le serveur attribue OF-AAAA-NNNN.',
        defaut: 'OF-AAAA-NNNN',
      },
      {
        nom: 'Date',
        description: 'La date de l’OF : elle le range dans un mois pour les statistiques.',
        obligatoire: true,
        defaut: 'Aujourd’hui',
      },
      { nom: 'Fin prévue', description: 'La date de fin prévue, facultative ; elle ne peut pas précéder la date de l’OF.' },
      {
        nom: 'Qualité',
        description: 'La qualité à produire, cherchée en tapant. Sans recette active, le prévu ne se calcule pas.',
        obligatoire: true,
      },
      {
        nom: 'Métrage (m²)',
        description: 'La surface à produire.',
        obligatoire: true,
        valeurs: 'm², strictement positif',
      },
      { nom: 'Notes', description: 'Texte libre.' },
      {
        nom: 'Prévu',
        description: 'Métrage × recette, perte comprise : un étalon, jamais la consommation.',
        valeurs: 'kg',
      },
      {
        nom: 'Réel',
        description:
          'Fil (écarts machine attribués à l’OF) + hors machine (consommations directes portant l’OF, retours déduits).',
        valeurs: 'kg',
      },
      {
        nom: 'Écart',
        alias: ['Écart réel − prévu'],
        description: 'Réel − prévu, signé, avec son pourcentage ; en couleur d’alerte au-delà de 15 %.',
        valeurs: 'kg',
      },
      {
        nom: 'Déchets · pertes · casses',
        description: 'Ce que les constats ont classé en déchet, perte ou casse ; les autres écarts sont indiqués à part.',
        valeurs: 'kg',
      },
      { nom: 'Référence', description: 'La référence de matière (sa désignation en survol).' },
      {
        nom: 'Réel fil (kg)',
        description:
          'Les écarts à effet consommation des constats machine dont la période appartenait à cet OF ; les corrections sont exclues.',
        valeurs: 'kg',
      },
      {
        nom: 'Réel hors machine (kg)',
        description: 'Les consommations directes portant l’OF, moins les retours au magasin.',
        valeurs: 'kg',
      },
      {
        nom: 'Autres écarts (kg)',
        description: 'Les écarts de constat qui ne sont ni consommation, ni déchet, perte ou casse.',
        valeurs: 'kg',
      },
      { nom: 'Lots', description: 'Les lots concernés par la consommation de la référence.' },
    ],
    regles: [
      'L’OF ne déplace jamais le stock et n’entre pas dans le besoin de matière : il sert la production et les statistiques.',
      'Cycle : Prévu → Lancé → Clôturé ; Annulé depuis Prévu ou Lancé. Aucun retour en arrière ; la base refuse toute autre transition.',
      'Lancer demande l’écriture ; clôturer et annuler demandent la validation.',
      'L’écart d’un constat machine appartient à l’OF qui occupait la portion avant le constat.',
      'Un numéro d’OF ne sert qu’une fois.',
    ],
    messages: [
      {
        message: 'Le numéro d’OF « … » existe déjà : un numéro de l’ERP Production ne sert qu’une fois.',
        cause: 'Le numéro saisi est déjà porté par un autre OF.',
      },
      { message: 'Le métrage de l’OF doit être positif (m²).', cause: 'Métrage vide, nul ou négatif.' },
      { message: 'La fin prévue précède la date de l’OF.', cause: 'Les deux dates sont inversées.' },
      { message: 'Qualité inconnue : « … ».', cause: 'Le code de qualité n’existe pas.' },
      {
        message: 'Cet ordre de fabrication est clôturé : son en-tête ne se modifie plus.',
        cause: 'Un OF clôturé ou annulé est figé.',
      },
      {
        message: 'OF-CYCLE : l’ordre de fabrication … ne passe pas de … à …',
        cause: 'Transition hors du cycle Prévu → Lancé → Clôturé / Annulé.',
      },
      {
        message: 'Cet ordre de fabrication a ete modifie par … pendant votre saisie.',
        cause: 'Quelqu’un l’a enregistré depuis votre lecture : rouvrez-le pour voir ses changements, puis refaites les vôtres.',
      },
    ],
    liens: [
      { route: '/ordres-fabrication', libelle: 'Ordres de fabrication' },
      { route: '/machines', libelle: 'Machines' },
      { route: '/fiche-hors-machine', libelle: 'Fiche hors machine' },
      { route: '/plans', libelle: 'Plans de production' },
    ],
  },
]
