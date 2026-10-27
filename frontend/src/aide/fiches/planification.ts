/**
 * FICHES D'AIDE — PLANIFICATION : PLANS DE PRODUCTION, ORDRES DE FABRICATION, BESOINS,
 * PLAN D'ACHAT (moteur de couverture, propositions, conversion en bon).
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
          'Plan en cours : « Calculer le MRP » produit ses besoins de matière ; « Archiver » en garde une photo datée, avec le solde et l’état du moteur de couverture.',
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

  // ==========================================================================
  // /plan-achat — Plans d’achat : le moteur de couverture et les propositions
  // ==========================================================================
  {
    route: '/plan-achat',
    titre: 'Plan d’achat',
    chemin: 'Planification → Plans d’achat',
    objectif:
      'Savoir, référence par référence, jusqu’où le plan de production est couvert et quoi commander avant quelle date (onglet « À commander », le moteur de couverture), puis arbitrer les propositions et les envoyer en bon de commande.',
    prerequis: [
      'Un plan de production EN COURS dont le MRP est calculé : c’est sa photo du besoin, mois par mois, qui fait toute la demande. Sans plan en service, rien ne se projette.',
      'Des références actives avec leur fournisseur et un prix (dernier achat, catalogue ou CMUP) : sans eux, la référence est calculée mais ne devient pas une proposition.',
      'Des fournisseurs dont le délai de livraison et la couverture d’une commande sont à jour : à défaut, les paramètres P_DelaiDefaut (60 j) et P_MargeJours (30 j) s’appliquent, et l’écran le dit.',
      'Une classe ABC sur chaque fiche : elle fixe les jours de sécurité. Sans classe, la plus longue des trois sécurités s’applique et la ligne signale le défaut de données.',
    ],
    droits:
      'Lecture du module Plan d’achat pour consulter. Écriture du module Plan d’achat pour Régénérer, Commander, Écarter et basculer sur un équivalent ; « Envoyer au bon de commande » exige en plus l’écriture du module Bons de commande.',
    procedures: [
      {
        titre: 'Lire la couverture (onglet « À commander »)',
        etapes: [
          'Le bandeau rappelle le plan en service, la fin de son horizon, la date de la photo du besoin et le jour d’où part la projection (aujourd’hui).',
          'Une ligne par référence qui a une demande au plan, du stock ou un arrivage. L’ordre : la première rupture la plus proche d’abord (une rupture aujourd’hui en tête, sans rupture en dernier), puis la date limite de commande.',
          'Resserrez avec les filtres Fournisseur, Proposition (avec / sans) et Plan non couvert (avant ou après aujourd’hui + délai, ou couvert sur l’horizon), ou la recherche (référence, désignation, fournisseur).',
          'La ligne ↳ sous une référence dit ce qui est compté à part (fil sur métiers, restes, fil en route à sa date), ce qui n’est pas compté (quarantaine, bloqué, magasins hors plan) et ce qui est hors couverture (en retard, sans date, bons non validés, après l’horizon).',
          'Cliquez la ligne (ou l’icône ⤢ devant la référence) : le détail s’ouvre dans une GRANDE FENÊTRE (titre : la référence et sa désignation), qui défile en hauteur — les réglages et leur source, la courbe du solde jour par jour, le calcul de la première proposition étape par étape, les propositions suivantes, les ressources et arrivages avec leur raison, la chronologie et les besoins du plan mois par mois par qualité. Échap ou la croix la ferment ; « Commander » reste sur la ligne.',
          '« Règles des dates d’arrivage, de la fenêtre et des réglages par défaut » (au-dessus de la liste) déplie les règles appliquées.',
        ],
        resultat: 'Vous savez jusqu’à quel jour le plan est couvert, combien commander et avant quelle date.',
      },
      {
        titre: 'Commander une référence depuis « À commander »',
        etapes: [
          'Sur la ligne, cliquez « Commander » (l’icône seule sur un écran étroit). Le bouton n’apparaît que si le moteur propose une quantité et si la référence est active.',
          'La proposition de CETTE référence est régénérée depuis le moteur (une proposition figée ou arbitrée reste telle quelle), puis s’ouvre, cochée, dans l’onglet « Lignes à commander ».',
          'Continuez avec « Envoyer au bon de commande » ci-dessous.',
        ],
        resultat: 'La proposition attend dans les lignes à commander ; rien n’est encore engagé.',
      },
      {
        titre: 'Régénérer et arbitrer les propositions (onglet « Besoins »)',
        etapes: [
          '« Régénérer » (confirmation demandée) : les propositions ouvertes sont remplacées par la première proposition du moteur pour chaque référence. Le message donne le nombre de propositions, le budget, les TIER 1, ce qui a été conservé (protégées, arbitrées) et les références non proposées (sans fournisseur ou sans prix).',
          'Lisez les propositions, la plus urgente d’abord ; la flèche en tête de ligne déplie le calcul du moteur pour cette référence.',
          'Écartez ce qui n’est pas à commander (icône ⊘) : la référence n’est plus reproposée pendant P_DureeEcartJours (90 jours).',
          'Pour couvrir le besoin par un équivalent (icône ⇄) : choisissez la référence du groupe d’équivalence, écrivez le « Motif de la bascule », puis « Basculer le besoin ».',
          'Cochez les propositions à commander (ou « Tout cocher »), puis « Lignes à commander ».',
        ],
        resultat: 'Les propositions retenues sont cochées ; la barre « Sélection » donne leur montant et le nombre de fournisseurs.',
      },
      {
        titre: 'Envoyer au bon de commande (onglet « Lignes à commander »)',
        etapes: [
          'Les lignes cochées sont groupées par fournisseur. Pour chaque fournisseur, « Envoyer vers » : « Un nouveau bon », ou un bon BROUILLON du même fournisseur à compléter.',
          'Ajustez au besoin la quantité en kilos, le prix au kilo (dans la devise de la proposition, sinon en MAD), les palettes et les bobines : liés (maillon), les trois se recalculent ensemble ; détachés, chacun se saisit seul.',
          'Retirez une ligne (×) : elle redevient une simple proposition.',
          'Cliquez « Envoyer au bon de commande ».',
        ],
        resultat:
          'Un bon de commande BROUILLON par fournisseur (ou le brouillon choisi, complété) ; les propositions passent « Commandée » et pointent leur bon. La date de besoin D devient la livraison prévue de la ligne. Le bon doit encore être contrôlé et validé.',
      },
    ],
    champs: [
      /* --- Onglet « À commander » : la liste du moteur ---------------------- */
      {
        nom: 'Référence',
        description:
          'La référence, sa désignation (quand elle ne répète pas le code) et son fournisseur. Dans « À commander », un clic sur la ligne (ou l’icône ⤢) ouvre le détail du calcul dans une grande fenêtre ; dans « Besoins », la flèche en tête de ligne le déplie sous la proposition ; dans « Lignes à commander », la ligne rappelle l’urgence, la livraison prévue (D) et la date limite de commande.',
      },
      {
        nom: 'Disponible',
        description:
          'Ce qui couvre le plan aujourd’hui : le stock des magasins comptés au plan (hors quarantaine et magasins exclus du plan, lots bloqués retirés, restes compris) plus le fil sur les métiers au dernier constat, quel que soit son âge.',
        valeurs: 'kg',
      },
      {
        nom: 'Couvert jusqu’au',
        description:
          'Le dernier jour où le solde projeté couvre le plan, la veille de la première rupture. « tout l’horizon » : aucune rupture jusqu’à la fin du plan en service. « non couvert » : la rupture est dès aujourd’hui.',
        valeurs: 'date',
      },
      {
        nom: 'Prochain arrivage',
        description:
          'Le premier arrivage COMPTÉ et ses kilos : une ligne de bon validé, envoyé ou livré partiellement, à sa date de livraison prévue ; un transfert en route, à sa date prévue de disponibilité. Un arrivage en retard, sans date ou d’un bon non validé n’y figure pas (voir la ligne ↳).',
      },
      {
        nom: '1re rupture',
        description:
          'Le premier jour où le plan n’est plus couvert. En rouge quand il tombe avant aujourd’hui + délai : une commande passée maintenant arrivera trop tard pour l’éviter.',
        valeurs: 'date',
      },
      {
        nom: 'Plan non couvert',
        description:
          'Les kilos du plan que le solde ne peut pas servir sur l’horizon. Un déficit n’est jamais une dette : il est perdu jour par jour, ni reporté ni rattrapé — le solde projeté ne descend pas sous zéro. Le même mot est un filtre (avant ou après aujourd’hui + délai, couvert sur l’horizon), une colonne de « Par fournisseur » (le nombre de ses références au plan non couvert) et un compteur de « Situation » (les références dont une rupture est prévue sur l’horizon).',
        valeurs: 'kg (liste) · nombre de références (Par fournisseur, Situation)',
      },
      {
        nom: 'Délai',
        description:
          'Le délai de livraison du fournisseur, en jours (au survol : sa source, fournisseur ou paramètre global P_DelaiDefaut). Il place la date au plus tôt d’une commande (aujourd’hui + délai) et la date limite de commande (D − délai).',
        valeurs: 'jours',
      },
      {
        nom: 'Proposition',
        description:
          'La quantité de la première proposition du moteur, et son équivalent en palettes ordinaires de la fiche (pour information). « rien » : aucune proposition — au survol, la raison (aucun passage sous la sécurité sur l’horizon, ou aujourd’hui + délai au-delà de l’horizon). Comme filtre : « Avec proposition » / « Sans proposition ».',
        valeurs: 'kg',
      },
      {
        nom: 'Avant le',
        description:
          'La date limite de commande de la première proposition : D − délai fournisseur. En rouge une fois dépassée, en orange à 7 jours ou moins ; au survol, le nombre de jours qui restent.',
        valeurs: 'date',
      },
      /* --- Le détail d’une référence ---------------------------------------- */
      {
        nom: 'Solde projeté jour par jour',
        description:
          'La courbe du solde projeté (trait plein), la ligne de sécurité (tirets), les arrivages comptés (triangles), le jour D de la première proposition et, sous zéro, les jours où le plan n’est pas couvert. Survolez un jour pour son solde, sa sécurité, son besoin planifié (le plan du jour) et ses arrivages.',
      },
      {
        nom: 'À commander — le calcul',
        description:
          'Le calcul de la première proposition, étape par étape : D (disponibilité de la commande) et pourquoi, F (fin de la fenêtre, exclue), plan sur la fenêtre, + sécurité, − S(D), − arrivages après D, = besoin théorique (avec son jour déterminant), + minimum de commande, arrondi vers le haut, = quantité proposée, et « À commander avant le ». Dessous, les propositions suivantes, indicatives : elles supposent les précédentes commandées (douze au plus).',
      },
      {
        nom: 'Arrivages',
        description:
          'Chaque bon, import sans bon et transfert en route de la référence, avec ses kilos, sa date (de la ligne, de l’en-tête, ou date prévue de disponibilité), « compté » ou « non compté » et la raison : en retard, sans date, non validé, après l’horizon.',
      },
      {
        nom: 'Chronologie',
        description:
          'Les événements de la projection — aujourd’hui, arrivage, plan non couvert à partir de ce jour, couverture reprise, passage sous la sécurité, aujourd’hui + délai, fins de mois, fin de l’horizon — avec ce qui s’est passé depuis la ligne précédente.',
      },
      { nom: 'Date', description: 'Chronologie : le jour de l’événement.', valeurs: 'date' },
      { nom: 'Événement', description: 'Chronologie : ce qui arrive ce jour-là (plusieurs natures possibles le même jour).' },
      {
        nom: 'Besoin planifié',
        description:
          'Chronologie : le PLAN DATÉ depuis la ligne précédente (kg du mois du plan ÷ jours réels du mois, jour par jour) — un besoin au plan, jamais une consommation réelle.',
        valeurs: 'kg',
      },
      { nom: 'Arrivée', description: 'Chronologie : les arrivages comptés depuis la ligne précédente.', valeurs: 'kg' },
      { nom: 'Solde après', description: 'Chronologie : le solde projeté en fin de journée, jamais négatif.', valeurs: 'kg' },
      {
        nom: 'Ressources d’aujourd’hui',
        description:
          'Fenêtre de détail : chaque magasin et chaque étage de machine qui porte la référence, compté ou non, avec sa raison ; les restes (comptés) et les lots bloqués (non comptés).',
      },
      {
        nom: 'Besoins du plan mois par mois, par qualité',
        description:
          'Fenêtre de détail : les kilos de chaque mois de la photo du besoin du plan en service, leur moyenne par jour, la part qui tombe dans l’horizon (le mois en cours depuis aujourd’hui) et la répartition par qualité selon les recettes actuelles.',
      },
      /* --- Onglet « Besoins » : les propositions ----------------------------- */
      {
        nom: 'ABC',
        description: 'La classe ABC (et XYZ) de la fiche article. Elle fixe les jours de sécurité du moteur (P_SecuriteA, B, C).',
      },
      {
        nom: 'Action',
        description:
          'L’action recommandée, déduite de l’urgence : « Commander immediatement » (TIER 1), « Commander sous 7 jours » (TIER 2), « Planifier la commande » (TIER 3), « Reapprovisionnement normal » (TIER 4).',
      },
      {
        nom: 'Urgence',
        description:
          'Déduite de la date limite de commande : atteinte ou dépassée = TIER 1 ; dans les 7 jours = TIER 2 ; dans les 30 jours = TIER 3 ; au-delà = TIER 4. Dans « Situation », le bloc Urgence compte les propositions ouvertes et leur montant par tier.',
        valeurs: 'Tier 1 · Tier 2 · Tier 3 · Tier 4',
      },
      {
        nom: 'Fournisseur',
        description:
          'Le fournisseur de la fiche article, et son pays : la commande se passe chez lui (un bon par fournisseur). Filtrable ; dans « À commander », filtre de la liste du moteur ; dans « Par fournisseur », une ligne par fournisseur.',
      },
      {
        nom: 'Statut',
        description:
          'Où en est la proposition, avec le numéro du bon qu’elle a produit. « Annulée avec le bon » (ANNULE_BC) : le bon créé par « Commander » ou la conversion a été annulé ; la proposition reste liée à ce bon (l’historique est intact), elle n’est plus ouverte — ni purgée à la régénération, ni comptée dans les indicateurs — et la régénération suivante crée une proposition NEUVE si le moteur en propose une.',
        valeurs: 'Proposée · En révision · Validée · Commandée · Écartée · Annulée avec le bon',
      },
      {
        nom: 'A commander',
        description:
          'Colonne de « Besoins » : la quantité proposée en kilos (et dans l’unité du catalogue quand ce n’est pas le kilo), en lecture seule — elle s’ajuste dans les lignes à commander, pas ici. Bloc de « Situation » : le budget, la quantité et le nombre de références des propositions ouvertes.',
        valeurs: 'kg',
      },
      {
        nom: 'Prix MAD/kg',
        description:
          'Le prix estimé au kilo, et sa source : « dernier achat » chez ce fournisseur, sinon « catalogue » converti au taux du jour, sinon « coût moyen » (CMUP). « prix à saisir » : le prix viendrait du CMUP que votre compte ne voit pas. Hors kilo, le même prix dans l’unité d’achat.',
        valeurs: 'MAD/kg',
      },
      { nom: 'Prix devise', description: 'Le prix catalogue dans la devise du fournisseur : celui qu’on négocie et qui partira sur le bon.' },
      { nom: 'Montant devise', description: 'Quantité × prix devise, dans la devise du fournisseur.' },
      {
        nom: 'Montant MAD',
        description:
          'La valeur en dirhams : quantité × prix estimé (Besoins), la somme du fournisseur (Par fournisseur), ou quantité × prix saisi, au taux de la proposition pour un prix en devise (Lignes à commander). Elle sert au budget, pas à la négociation.',
        valeurs: 'MAD',
      },
      {
        nom: 'Palettes',
        description:
          'Besoins : les palettes de la proposition, sinon « ≈ » l’équivalent en palettes ordinaires de la fiche, pour information — jamais une palette pleine imposée. Lignes à commander : le nombre de palettes confirmé, lié aux kilos et aux bobines tant que le maillon est fermé ; « + N kg palette » signale le complément de palette.',
      },
      {
        nom: 'Complément palette',
        description:
          'Ce que l’arrondi au multiple de la fiche (multiple d’achat, ou palette pleine si « Arrondi à la palette pleine » est coché) a ajouté au besoin après le minimum de commande : commandé pour la logistique, pas pour produire. « — » : aucun arrondi.',
        valeurs: 'kg',
      },
      {
        nom: 'Besoin le',
        description:
          'D, la date de disponibilité de la commande calculée par le moteur. À la conversion, elle devient la date de livraison prévue de la ligne de bon.',
        valeurs: 'date',
      },
      {
        nom: 'Commander avant le',
        description: 'La date limite de commande du moteur : D − délai fournisseur. C’est d’elle que se déduit l’urgence.',
        valeurs: 'date',
      },
      {
        nom: 'Motif de la bascule',
        description:
          'Pourquoi le besoin passe sur une référence équivalente : stock dormant, délai plus court, rupture chez le fournisseur… La référence d’origine reste tracée sur la proposition ; si une proposition est déjà ouverte sur la cible, les quantités sont fusionnées.',
        obligatoire: true,
      },
      /* --- Onglet « Lignes à commander » ------------------------------------ */
      {
        nom: 'Envoyer vers',
        description:
          'Pour chaque fournisseur : « Un nouveau bon », ou un bon du MÊME fournisseur encore en BROUILLON, cherché parmi les siens. Un bon au contrôle, en demande de prix ou en attente de validation est figé : il ne se complète plus.',
        defaut: 'Un nouveau bon',
      },
      {
        nom: 'Qté (kg)',
        description:
          'Les kilos à commander, pré-remplis par la proposition. Ce que vous envoyez fait foi sur le bon. Liés (maillon), kilos, palettes et bobines se recalculent ensemble.',
        valeurs: 'kg',
        defaut: 'la quantité proposée',
      },
      {
        nom: 'Prix / kg',
        description:
          'Le prix au kilo, dans la devise de la proposition (USD/kg, EUR/kg…) quand elle en a une, sinon en MAD/kg. Il part tel quel sur la ligne du bon. Une référence déjà présente sur le bon visé garde le prix de cette ligne.',
        defaut: 'le prix de la proposition',
      },
      { nom: 'Bobines', description: 'Le nombre de bobines confirmé, lié aux kilos et aux palettes tant que le maillon est fermé ; une bobine ne se coupe pas.' },
      /* --- Onglet « Par fournisseur » ---------------------------------------- */
      { nom: 'Pays', description: 'Le pays du fournisseur.' },
      { nom: 'Devise', description: 'La devise du fournisseur : celle du bon qui sera créé.' },
      { nom: 'Refs', description: 'Le nombre de références proposées chez ce fournisseur.' },
      { nom: 'Quantité', description: 'Les kilos proposés chez ce fournisseur.', valeurs: 'kg' },
      { nom: '% budget', description: 'La part du fournisseur dans le montant total des propositions.', valeurs: '%' },
      { nom: 'TIER 1', description: 'Le nombre de ses propositions à commander immédiatement (date limite atteinte ou dépassée).' },
      { nom: 'Contact', description: 'Le contact principal du fournisseur.' },
      /* --- Onglet « Situation » ---------------------------------------------- */
      {
        nom: 'Situation du stock',
        description:
          'Les références suivies (actives, avec un plan, du stock ou un arrivage) comptées par état du moteur de couverture, telles qu’à la dernière génération du plan (« calculée le … »).',
      },
      { nom: 'Références suivies', description: 'Les références actives que le moteur suit : une demande au plan, du stock ou un arrivage.' },
      { nom: 'Sous la sécurité', description: 'Les références dont le solde projeté passe sous la sécurité, sans rupture sur l’horizon.' },
      { nom: 'Couvert', description: 'Les références sans rupture ni passage sous la sécurité sur l’horizon.' },
      {
        nom: 'À commander aujourd’hui',
        description: 'Les références dont la date limite de commande de la première proposition est atteinte ou dépassée.',
      },
      { nom: 'Classe A au plan non couvert', description: 'Les références de classe A dont une rupture est prévue sur l’horizon.' },
      { nom: 'Budget total', description: 'Le montant des propositions ouvertes (proposées, en révision, validées).', valeurs: 'MAD' },
      { nom: 'Quantité totale', description: 'Les kilos des propositions ouvertes.', valeurs: 'kg' },
      { nom: 'Références', description: 'Le nombre de propositions ouvertes, une par référence.' },
      {
        nom: 'Risques identifies',
        description: 'Les propositions ouvertes par risque de sourcing : MONO-SOURCE (aucun équivalent chez un autre fournisseur) ou MULTI-SOURCE, avec leur montant.',
      },
    ],
    regles: [
      'UNE SEULE SOURCE DE VÉRITÉ (27/10/2026) : tout ce qui dit d’une référence qu’elle est couverte, sous la sécurité ou à commander vient du moteur de couverture — cet écran, le stock projeté, le tableau de bord, l’état des stocks, les contrôles C05 et C25.',
      'LA DEMANDE EST LE PLAN SEUL : la photo du besoin du plan en service, mois par mois. Consommation prévue d’un jour = kg du mois ÷ nombre de jours réels du mois. Le mois en cours ne compte qu’à partir d’aujourd’hui : le plan des jours passés est perdu, jamais reporté. Les ordres de fabrication n’y entrent pas.',
      'L’HORIZON est celui du plan en service : sa date de fin, ou la fin de son dernier mois de besoin si elle va plus loin.',
      'LA PROJECTION SE FAIT JOUR PAR JOUR : solde du jour = solde de la veille + arrivages comptés du jour − consommation prévue du jour. Le solde ne descend jamais sous zéro : un déficit est un « plan non couvert », ni reporté ni rattrapé.',
      'CE QUI EST COMPTÉ : le stock des magasins comptés au plan (hors quarantaine), lots libres — restes et dormants compris —, lots bloqués exclus ; le fil sur les machines au dernier constat, quel que soit son âge ; les lignes de bon VALIDÉ, ENVOYÉ ou LIVRÉ PARTIEL à la date de livraison prévue de la ligne, sinon de l’en-tête ; le fil en route (transfert expédié) à sa date prévue de disponibilité.',
      'CE QUI N’EST PAS COMPTÉ, mais montré : quarantaine, bloqué, magasins hors plan ; un bon dont la date est dépassée (en retard, contrôle C28) ou sans date ; un transfert en route en retard ou sans date (contrôle C66) ; un bon non validé (brouillon, contrôle, demande de prix, attente de validation) ; l’import en route sans bon ; ce qui arrive après l’horizon.',
      'LA SÉCURITÉ est une ligne distincte de la rupture : jours de sécurité de la classe ABC (P_SecuriteA, B, C) × consommation moyenne prévue du plan sur la fenêtre. Sans classe ABC, la plus longue des trois, et le défaut de données est signalé sur la ligne.',
      'D, LA DATE DE DISPONIBILITÉ = MAX(aujourd’hui + délai ; premier jour où le solde passe sous la sécurité). Motif « délai » quand D tombe sur aujourd’hui + délai (même si la sécurité est franchie ce jour-là ou avant), « sécurité » sinon.',
      'LA FENÊTRE EST [D, F[ : D inclus, F exclu, F = D + couverture d’une commande (celle du fournisseur, sinon P_MargeJours : 30 jours pleins), bornée à la fin de l’horizon. Le dernier jour couvert est F − 1 ; un arrivage le jour F est hors de la fenêtre.',
      'S(D) = le solde au début de D, arrivages du jour D compris, jamais négatif. BESOIN THÉORIQUE = MAX(0 ; le plus fort, sur chaque jour t de [D, F[, de sécurité + plan de D à t − arrivages après D jusqu’à t − S(D)). Le jour où ce maximum est atteint est le jour déterminant.',
      'PUIS le minimum de commande de la fiche (MOQ), puis l’arrondi VERS LE HAUT au multiple : le multiple d’achat de la fiche, sinon la palette de la fiche si « Arrondi à la palette pleine » est coché ; sinon pas d’arrondi. Un besoin déjà multiple ne prend pas un multiple de plus.',
      'DATE LIMITE DE COMMANDE = D − délai. Les propositions suivantes ajoutent la précédente aux arrivages à son D et recommencent, jusqu’à la fin de l’horizon, douze au plus ; seule la PREMIÈRE devient une proposition d’achat.',
      'Les ÉTATS d’une référence : PLAN NON COUVERT (une rupture est prévue sur l’horizon), SOUS LA SÉCURITÉ (le solde passe sous la sécurité, sans rupture), COUVERT (ni l’un ni l’autre). Ils se calculent sans les propositions : une référence reste « plan non couvert » tant que la commande n’est pas validée et datée.',
      'RÉGÉNÉRER remplace les propositions ouvertes qui n’engagent rien. Restent telles quelles : les commandées, les écartées, les protégées (retouchées) et les arbitrées (basculées sur un équivalent), ainsi que celles annulées avec leur bon. Une écartée masque la référence pendant P_DureeEcartJours (90 j), puis expire : le besoin est reproposé.',
      'Une référence déjà sur un bon pas encore validé (brouillon, contrôle, demande de prix, attente de validation) n’est pas reproposée : complétez ce bon. Un bon validé, envoyé ou livré partiellement est un arrivage du moteur : ce qui reste proposé est un vrai besoin.',
      'QUAND LE BON EST ANNULÉ (décision du 27/10/2026) : la proposition qu’il portait passe « Annulée avec le bon » (ANNULE_BC), reste liée au bon annulé, n’est plus ouverte, n’est ni purgée ni comptée dans les indicateurs ; la régénération suivante crée une proposition neuve si le moteur en propose une.',
      'Le calcul ne MUTUALISE PAS les équivalents : l’équivalent disponible est affiché, la bascule reste un geste explicite, motivé et tracé ; une unité, une densité ou une catégorie différentes la font refuser.',
      'Une référence inactive se lit mais ne se commande pas : pas de bouton « Commander », pas de proposition à la génération.',
      'LA CONVERSION ouvre un bon BROUILLON par fournisseur (ou complète le brouillon choisi) : rien n’est engagé avant sa validation. Une référence déjà sur le bon visé voit sa ligne augmentée, au prix de cette ligne. La quantité, le prix et le colisage envoyés font foi ; la date de besoin D devient la livraison prévue.',
      '« Situation » et « Par fournisseur » sont figés à la génération du plan : régénérez pour les remettre à jour.',
      'LE DÉTAIL S’OUVRE EN GRANDE FENÊTRE (décision du 27/10/2026) : le même tableau et la même fenêtre servent le volet « Surveillance / Alertes » du stock projeté (composants partagés), qui lit le même moteur.',
      'LES MOTS DU BESOIN (27/10/2026) : « Plan / mois » (le plan de l’horizon ramené à 30 jours), « Réel / mois » (la consommation réelle du grand livre, 12 mois pleins), « Besoin jusqu’à livraison » (le plan d’aujourd’hui à aujourd’hui + délai), « Besoin de couverture » (le plan sur la fenêtre [D, F[), « Besoin de réapprovisionnement » (le besoin théorique). Le moteur ne lit que le PLAN DATÉ ; jamais « conso / mois » pour un besoin.',
    ],
    messages: [
      {
        message: 'Le moteur de couverture ne propose rien pour … aujourd’hui (couverture suffisante, ou référence inactive). Rafraîchissez l’onglet À commander.',
        cause: '« Commander » sur une référence que le moteur ne propose plus : la liste affichée était plus ancienne que le calcul.',
      },
      {
        message: '… est déjà sur le bon … (…), pas encore validé : complétez ce bon plutôt que d’en préparer un second.',
        cause: 'Un bon non validé porte déjà la référence : la proposition n’est pas recréée.',
      },
      {
        message: 'La proposition de … a été écartée le … : elle ne se repropose pas avant P_DureeEcartJours.',
        cause: 'La référence a été écartée il y a moins de 90 jours.',
      },
      {
        message: 'Aucune proposition possible pour … (sans fournisseur sur la fiche) / (sans prix : ni dernier achat, ni catalogue, ni CMUP).',
        cause: 'Le moteur propose une quantité, mais la fiche ne permet pas de l’acheter : complétez le fournisseur ou le prix.',
      },
      {
        message: 'R-PROP : deja commandee(s) par un autre bon : … Rafraichissez le plan d’achat.',
        cause: 'Un autre poste a converti la même proposition entre-temps.',
      },
      {
        message: 'Le bon … est … : il ne se complete plus. Choisissez un brouillon ou un nouveau bon.',
        cause: 'Le bon choisi dans « Envoyer vers » n’est plus en brouillon.',
      },
      {
        message: 'Le bon … est d’un autre fournisseur (…) : il ne recoit pas les lignes de ….',
        cause: 'Un bon ne reçoit que les lignes de son fournisseur.',
      },
      { message: 'Aucun taux de change en vigueur pour ….', cause: 'Ouvrez le taux de la devise dans Paramètres → Devises et taux.' },
      { message: 'Aucune proposition ouverte a convertir.', cause: 'Les propositions cochées ont été commandées, écartées ou régénérées entre-temps.' },
    ],
    liens: [
      { route: '/besoins', libelle: 'Besoins (MRP)' },
      { route: '/stock', libelle: 'Stock projeté et alertes' },
      { route: '/bons-commande', libelle: 'Bons de commande' },
      { route: '/equivalences', libelle: 'Équivalences' },
      { route: '/etats/plan-achat', libelle: 'Plan d’achat à engager (imprimé)' },
    ],
  },
]
