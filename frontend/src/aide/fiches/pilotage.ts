/**
 * FICHES D'AIDE — ANALYSE, ÉTATS ET RÉGLAGES.
 *
 * Une partie du catalogue : `../contenu.ts` les assemble, `../types.ts` donne
 * la forme d'une fiche. Chaque `champs[].nom` est l'intitulé EXACT de l'écran :
 * c'est par lui que l'indice ⓘ se pose à côté du champ (`../indice.ts`).
 *
 * Réécrites le 27/10/2026 d'après le code des écrans (Accueil, Statistiques,
 * Valorisation, Rapports, Audit, Contrôles, Configuration, Utilisateurs,
 * Droits, Rôles, États, Télécharger, Assistant). Tableau de bord, état des stocks
 * imprimé et plan d’achat imprimé : écrits sur le moteur de couverture (27/10/2026). La fiche « /parametres » est
 * retirée : l'adresse redirige vers /configuration, qui a sa propre fiche.
 */
import type { Sujet } from '../types.ts'

export const FICHES_PILOTAGE: Sujet[] = [
  /* ======================================================================= */
  /* Accueil                                                                  */
  /* ======================================================================= */
  {
    route: '/',
    titre: 'Accueil',
    chemin: 'Tableaux de bord → Accueil',
    objectif:
      'Ouvrir l’application sur ce qui s’est passé depuis votre dernier passage et sur les écrans de tous les jours que votre compte peut ouvrir.',
    droits:
      'Aucun module : la page s’ouvre pour tout compte connecté. Elle ne montre que les écrans permis par vos droits ; les taux de change ne s’affichent qu’aux rôles Direction et Administrateur.',
    procedures: [
      {
        titre: 'Reprendre le travail',
        etapes: [
          'Lisez la bannière : la date du jour, votre identifiant et ce que votre rôle fait dans l’outil.',
          'Sous « Pour commencer », cliquez l’écran de tous les jours dont vous avez besoin (Réceptions, Mouvements, Machines, État des stocks…).',
          'Sous « Ce qui s’est passé », lisez les derniers événements : chaque ligne porte sa catégorie, son titre, son auteur et le temps écoulé.',
          'Cliquez une ligne du fil pour ouvrir le document qu’elle cite.',
        ],
        resultat: 'Vous êtes sur l’écran ou le document voulu, sans passer par le menu.',
      },
      {
        titre: 'Surveiller les taux de change (Direction, Administrateur)',
        etapes: [
          'Lisez, pour chaque devise autre que le dirham, le taux utilisé par l’ERP et la date depuis laquelle il vaut.',
          'Comparez-le au cours de référence de Bank Al-Maghrib affiché dessous, et à l’écart calculé entre les deux.',
          'Si le taux doit changer, suivez le lien « historique » : il mène à Paramètres, section Devises et taux.',
        ],
        resultat: 'Vous savez si le taux qui valorise les achats est à jour.',
      },
    ],
    exemples: [
      {
        titre: 'les raccourcis d’un magasinier',
        situation:
          'Un magasinier (rôle Magasin) voit sous « Pour commencer » : Réceptions, Mouvements, Machines, État des stocks, Références et Assistant — pour ceux que ses droits ouvrent.',
        conclusion:
          'Les Inventaires sont dans son menu, pas dans les raccourcis : seuls les écrans « de tous les jours » y figurent. Ni la Valorisation ni les Paramètres n’apparaissent.',
      },
    ],
    champs: [
      {
        nom: 'Pour commencer',
        description:
          'Les écrans de tous les jours (Tableau de bord, Références, Besoins, Réceptions, État des stocks, Mouvements, Machines, Assistant) que vos droits ouvrent. Un rôle à menu réduit (Magasin) n’y voit que les écrans de sa liste.',
      },
      {
        nom: 'Ce qui s’est passé',
        description:
          'Le fil des derniers événements : mouvement, réception, commande, transfert, inventaire, plan, achat, machine. Le montant n’est affiché qu’à qui a le droit de voir les montants.',
      },
      {
        nom: 'Taux de change en vigueur',
        description:
          'Une carte par devise autre que la devise pivot (« 1 USD en MAD », par exemple). Réservée aux rôles Direction et Administrateur.',
      },
      {
        nom: 'Taux utilisé par l’ERP',
        description:
          'Le taux de la période ouverte, celui qui valorise les achats. « N jours sans mise à jour » s’affiche au-delà de 7 jours ; la flèche compare au dernier taux différent (hausse en rouge, baisse en vert).',
        valeurs: 'MAD pour 1 unité de devise, 4 décimales',
      },
      {
        nom: 'Bank Al-Maghrib · cours de référence',
        description:
          'Le cours lu par le serveur sur le site de Bank Al-Maghrib, pour information, avec sa variation. Dessous, l’écart entre le taux de l’ERP et ce cours, en orange à partir de 1 %.',
      },
    ],
    regles: [
      'Les raccourcis viennent de la même liste que le menu : un écran retiré disparaît des deux à la fois.',
      'Le cours de Bank Al-Maghrib ne modifie jamais le taux de l’ERP : un nouveau taux s’ouvre dans Paramètres, Devises et taux.',
      'Le serveur ne relit le cours de la banque qu’au plus une fois par demi-heure ; s’il n’y parvient pas, le dernier cours connu reste affiché avec l’erreur.',
      'Sans aucun écran ouvert, la page le dit : « Aucun écran ne vous est ouvert. Demandez vos droits à la direction. »',
    ],
    liens: [
      { route: '/tableau-de-bord', libelle: 'Tableau de bord' },
      { route: '/configuration?section=devises', libelle: 'Devises et taux' },
    ],
  },

  /* ======================================================================= */
  /* Tableau de bord — la vue d’ensemble                                       */
  /* ======================================================================= */
  {
    route: '/tableau-de-bord',
    titre: 'Tableau de bord — vue d’ensemble',
    chemin: 'Tableaux de bord → Tableau de bord',
    objectif:
      'Voir d’un coup d’œil les chiffres qui comptent, ce qui attend votre décision, le risque de rupture mois par mois et les décisions d’achat les plus urgentes ; chaque bloc mène à l’écran où l’on agit.',
    droits:
      'Lecture du module Cockpit. Les montants n’apparaissent qu’à qui voit la valeur du stock ; une file « À traiter » n’apparaît que si votre rôle peut voir son compteur ET agir dessus ; le flux de matière est réservé aux rôles qui lisent les mouvements.',
    procedures: [
      {
        titre: 'Lire le tableau de bord',
        etapes: [
          'Les onglets mènent aux autres pages : Vue d’ensemble, Risques et files, Analyse, Opportunités, Matière.',
          'Un bandeau rouge « Les alertes reposent sur des besoins périmés » dit que le plan, une recette ou une densité a changé depuis le dernier calcul MRP : relancez-le avant de décider.',
          'Les chiffres clés en tête ; dessous, le flux de matière, ce qui attend une décision, le risque de rupture mois par mois et la santé du catalogue, puis les décisions les plus urgentes.',
          'Cliquez une file de « À traiter », ou le lien d’un bloc, pour ouvrir la liste qu’il compte.',
        ],
        resultat: 'Vous êtes sur l’écran où se traite ce que le tableau de bord signale.',
      },
    ],
    champs: [
      {
        nom: 'Valeur du stock',
        description: 'La valeur du stock au CMUP, fil en route compris, avec le nombre de références ; la courbe montre la valeur des entrées des derniers mois.',
        valeurs: 'MAD',
      },
      {
        nom: 'Engagé chez les fournisseurs',
        description: 'Le montant des bons de commande validés, envoyés ou livrés partiellement, et leur nombre.',
        valeurs: 'MAD',
      },
      {
        nom: 'Reste à engager',
        description:
          'Le montant des propositions d’achat ouvertes (proposées, en révision, validées) et le nombre de références à commander : ce que le plan d’achat propose et qui n’est pas encore sur un bon.',
        valeurs: 'MAD',
      },
      {
        nom: 'Plan non couvert',
        description:
          'Le nombre de références dont une rupture est prévue sur l’horizon du plan, sur les références suivies par le moteur de couverture ; dessous, celles « à commander aujourd’hui » (date limite atteinte) et celles « sous la sécurité ». Les barres : les références au plan non couvert, mois par mois. Dans les graphiques, la même couleur rouge.',
      },
      {
        nom: 'Économies identifiées',
        description: 'L’économie annuelle possible en passant, à qualité égale, au fournisseur le moins cher d’un groupe d’équivalence ; le détail est à la page Opportunités.',
        valeurs: 'MAD/an',
      },
      {
        nom: 'À traiter',
        description:
          'Les files qui attendent une décision de VOTRE rôle — propositions à arbitrer, bons à valider ou à envoyer, livraisons en retard, réceptions à contrôler ou à régulariser, lignes non conformes, lots à basculer, dormants, bloqués ou en dérive, autorisations à donner, contrôles bloquants —, les plus graves d’abord. Un clic ouvre la liste.',
      },
      {
        nom: 'Risque de rupture, mois par mois',
        description:
          'Combien de références, chaque mois de l’horizon, ont un plan non couvert (rouge) ou passent sous la sécurité (orange), au moteur de couverture.',
      },
      {
        nom: 'Santé du catalogue',
        description: 'Les références suivies réparties par état du moteur : Couvert, Sous la sécurité, Plan non couvert.',
      },
      {
        nom: 'Les décisions les plus urgentes',
        description:
          'Les références en tension, triées par la marge qui reste pour commander à temps. Le lien mène au plan d’achat.',
      },
      { nom: 'Référence', description: 'La référence, sa classe ABC et son fournisseur.' },
      {
        nom: 'Sourcing',
        description: '« mono-source » : aucun équivalent actif chez un autre fournisseur ; « multi » sinon.',
      },
      { nom: 'Délai', description: 'Le délai de livraison retenu par le moteur (fournisseur, sinon P_DelaiDefaut).', valeurs: 'jours' },
      {
        nom: 'À risque dès',
        description: 'Le premier mois où la référence n’est plus couverte, ou passe sous la sécurité.',
      },
      {
        nom: 'Équivalent',
        description: 'Le stock disponible d’une référence équivalente (au survol, laquelle) : une bascule possible. « aucun » sinon.',
        valeurs: 'kg',
      },
      {
        nom: 'Marge',
        description:
          'Les jours qui restent avant la date limite de commande de la première proposition du moteur ; sans proposition, avant le premier passage sous la sécurité, délai fournisseur déduit. Négative (rouge) : la date est déjà dépassée — il reste à arbitrer, substituer ou décaler la production. Orange sous 15 jours.',
        valeurs: 'jours',
      },
    ],
    regles: [
      'Chaque bloc dit d’où vient son chiffre et mène à l’écran où l’on agit : on vient ici pour voir, on va là-bas pour faire.',
      'Plan non couvert, sous la sécurité, couvert, à commander aujourd’hui : ce sont les états du moteur de couverture, les mêmes qu’au plan d’achat et au stock projeté.',
      '« Réceptions à contrôler » compte les réceptions soumises au contrôle ; un clic ouvre la liste des réceptions.',
      'Une panne du serveur s’affiche (« Chiffres clés indisponibles ») : un compteur absent n’est jamais montré comme un zéro.',
    ],
    liens: [
      { route: '/tableau-de-bord/situation', libelle: 'Risques et files' },
      { route: '/plan-achat', libelle: 'Plan d’achat' },
      { route: '/stock', libelle: 'Stock projeté et alertes' },
      { route: '/controles', libelle: 'Contrôles' },
    ],
  },

  /* ======================================================================= */
  /* Tableau de bord — les pages : risques et files, analyse, opportunités,    */
  /* matière                                                                   */
  /* ======================================================================= */
  {
    route: '/tableau-de-bord/:vue',
    titre: 'Tableau de bord — risques, analyse, opportunités, matière',
    chemin: 'Tableaux de bord → Risques et files · Analyse · Opportunités · Matière',
    objectif:
      'Le détail du tableau de bord, une page par domaine : ce qui attend une décision et ce qui menace le plan (Risques et files), où va l’argent (Analyse), ce qu’on pourrait gagner (Opportunités), où est la matière (Matière).',
    droits:
      'Lecture du module Cockpit. Les montants n’apparaissent qu’à qui voit la valeur du stock ; une file n’apparaît que si votre rôle peut agir dessus.',
    procedures: [
      {
        titre: 'Risques et files',
        etapes: [
          'Les chiffres clés : Plan non couvert, À commander aujourd’hui, À commander, Budget à engager, et le sourcing des références en risque.',
          '« À traiter — Achats / Stock / Qualité » : les files de votre rôle, par domaine ; un clic ouvre la liste.',
          '« Références en risque, mois par mois » : combien de références passent sous la sécurité ou ont un plan non couvert, chaque mois.',
          '« Mur de risques » : une ligne par référence en tension, une case par mois — survolez une case pour le plan du mois, les arrivages, le solde de fin de mois et la sécurité.',
          '« Références en alerte, les plus urgentes d’abord » : la liste ; le lien mène au stock projeté.',
        ],
      },
      {
        titre: 'Analyse, Opportunités, Matière',
        etapes: [
          'Analyse : où va l’argent, comment tourne le stock, ce que coûte la matière.',
          'Opportunités : les économies possibles à qualité égale dans un groupe d’équivalence, et les dépendances à un seul fournisseur.',
          'Matière : où est le stock par catégorie et par famille, ce qui entre et sort, ce que consomment les qualités.',
        ],
      },
    ],
    champs: [
      {
        nom: 'Plan non couvert',
        description:
          'Le nombre de références suivies dont une rupture est prévue sur l’horizon du plan (moteur de couverture) ; les barres, mois par mois. Dans les graphiques et le mur, la couleur rouge.',
      },
      {
        nom: 'À commander aujourd’hui',
        description: 'Les références dont la date limite de commande est atteinte ou dépassée ; dessous, le nombre de références sous la sécurité sans rupture.',
      },
      {
        nom: 'À commander',
        description: 'Tuile : le nombre de propositions d’achat ouvertes, et celles à arbitrer.',
      },
      {
        nom: 'À commander (kg)',
        description: 'Liste des alertes : la quantité de la première proposition du moteur de couverture.',
        valeurs: 'kg',
      },
      {
        nom: 'Mono-source à risque',
        description: 'Parmi les références en risque, celles qui n’ont aucun équivalent chez un autre fournisseur.',
      },
      {
        nom: 'Mur de risques',
        description:
          'Une ligne par référence en tension (60 au plus), triée par marge de décision : une case par mois de l’horizon — rouge, plan non couvert ; orange, sous la sécurité ; vert pâle, couvert.',
      },
      { nom: 'Référence', description: 'La référence (avec sa classe ABC et son fournisseur dans le mur).' },
      { nom: 'Sourcing', description: '« mono » : aucun équivalent chez un autre fournisseur ; « multi » sinon.' },
      { nom: 'Délai', description: 'Le délai de livraison retenu (fournisseur, sinon P_DelaiDefaut).', valeurs: 'jours' },
      {
        nom: 'Équivalent',
        description: 'Le stock disponible d’une référence équivalente (au survol, laquelle) ; « aucun » sinon.',
        valeurs: 'kg',
      },
      {
        nom: 'Marge',
        description:
          'Les jours qui restent avant la date limite de commande de la première proposition ; sans proposition, avant le premier passage sous la sécurité, délai déduit. Négative : la date est dépassée.',
        valeurs: 'jours',
      },
      { nom: 'Catégorie', description: 'La catégorie de matière de la référence.' },
      { nom: 'Couleur', description: 'La couleur de la référence.' },
      { nom: 'Fournisseur', description: 'Le fournisseur de la fiche article.' },
      { nom: 'Stock (kg)', description: 'Le stock physique net de la référence.', valeurs: 'kg' },
      {
        nom: 'Plan / mois',
        description: 'Le plan de l’horizon ramené à un mois de 30 jours, tel que le moteur de couverture le consomme.',
        valeurs: 'kg',
      },
      {
        nom: 'Couv. (j)',
        description: 'Les jours couverts au moteur : d’aujourd’hui à la veille de la première rupture ; « horizon » sans rupture.',
        valeurs: 'jours',
      },
      { nom: 'Délai (j)', description: 'Le délai de livraison du fournisseur.', valeurs: 'jours' },
      {
        nom: 'Statut',
        description: 'L’état au moteur de couverture.',
        valeurs: 'Plan non couvert · Sous la sécurité · Couvert',
      },
      {
        nom: 'Couverture',
        description: 'Dépendances à un seul fournisseur : les jours couverts au moteur ; « horizon » sans rupture, en rouge sous 30 jours.',
        valeurs: 'jours',
      },
      { nom: 'Fournisseur actuel', description: 'Opportunités : le fournisseur de la fiche.' },
      { nom: 'Prix actuel', description: 'Opportunités : son prix au kilo, en MAD.', valeurs: 'MAD/kg' },
      { nom: 'Alternative', description: 'Opportunités : le fournisseur le moins cher du groupe d’équivalence.' },
      { nom: 'Meilleur prix', description: 'Opportunités : le prix au kilo de l’alternative, en MAD.', valeurs: 'MAD/kg' },
      { nom: 'Écart', description: 'Opportunités : la baisse de prix en %.', valeurs: '%' },
      { nom: 'Économie / an', description: 'Opportunités : l’économie annuelle à qualité égale.', valeurs: 'MAD' },
    ],
    regles: [
      'Une adresse inconnue (/tableau-de-bord/…) ramène à la vue d’ensemble.',
      'Plan non couvert, sous la sécurité, couvert : les états du moteur de couverture, les mêmes partout. Le mur de risques groupe par mois les jours que le moteur projette, arrivages comptés à leur date.',
      'Un bandeau « Anomalies bloquantes » apparaît quand un contrôle bloquant est en anomalie : il se traite avant tout le reste.',
    ],
    liens: [
      { route: '/tableau-de-bord', libelle: 'Vue d’ensemble' },
      { route: '/plan-achat', libelle: 'Plan d’achat' },
      { route: '/stock', libelle: 'Stock projeté et alertes' },
      { route: '/equivalences', libelle: 'Équivalences' },
    ],
  },

  /* ======================================================================= */
  /* Statistiques                                                             */
  /* ======================================================================= */
  {
    route: '/statistiques',
    titre: 'Statistiques',
    chemin: 'Analyses → Statistiques',
    objectif:
      'Lire, en six volets, ce qui bouge et ce qui dort, ce que pèse chaque famille, d’où vient la hausse des prix, qui tient ses promesses, ce que coûte le mètre carré et où sont les lots.',
    prerequis: ['Des mouvements, des réceptions et des recettes enregistrés : les chiffres sont calculés à la lecture.'],
    droits:
      'Lecture du module Mouvements pour ouvrir l’écran. Chaque volet est lu sous son propre module — Mouvements et Familles : Mouvements ; Prix d’achat : Valorisation ; Fournisseurs : Fournisseurs ; Qualités : Qualités ; Lots : Stock. Un volet dont le module vous est fermé n’apparaît pas dans la colonne.',
    procedures: [
      {
        titre: 'Mouvements — ce qui bouge, et ce qui dort',
        etapes: [
          'Choisissez « Mouvements » dans la colonne des familles.',
          'Lisez les quatre chiffres : entrées et sorties cumulées, références sans mouvement depuis 6 mois, références jamais mouvementées.',
          'Lisez le graphique « Ce qui est entré, mois par mois » (à partir de deux mois de mouvements) : un mois en orange a plus de sorties que d’entrées.',
          'Lisez « Flux par mois et par type », puis « Les références qui ont le plus bougé » (les 12 premières ; la liste complète est à l’État des stocks).',
        ],
      },
      {
        titre: 'Familles — la forme des classeurs',
        etapes: [
          'Choisissez « Familles ».',
          'Choisissez l’année dans le sélecteur du tableau « Entrées par famille et par couleur » (affiché s’il y a plusieurs années).',
          'Lisez la matrice : familles en lignes, couleurs en colonnes (les plus lourdes à gauche), kilos entrés dans les cases.',
          'Descendez à « Ce que chaque famille pèse » (stock, valeur, entrées, sorties, prix moyen payé) et à « Par catégorie matière ».',
        ],
      },
      {
        titre: 'Prix d’achat — fournisseur ou change',
        etapes: [
          'Choisissez « Prix d’achat ».',
          'Lisez « Dérive du prix d’achat », triée par impact en dirhams : la colonne Fournisseur dit ce qui se négocie, la colonne Change ce qui vient de la devise.',
          'Cliquez une référence pour ouvrir son historique mensuel (prix en devise, taux, prix en dirhams) ; recliquez pour le fermer.',
        ],
      },
      {
        titre: 'Fournisseurs — qui tient ses promesses',
        etapes: [
          'Choisissez « Fournisseurs ».',
          'Lisez la « Fiche de performance » : délai, ponctualité, conformité, OTIF, note et classement.',
          'Cliquez une ligne pour voir sa tendance mensuelle (réceptions, quantité, conformité, à l’heure, retard moyen).',
        ],
      },
      {
        titre: 'Qualités — ce que coûte le mètre carré',
        etapes: [
          'Choisissez « Qualités ».',
          'Lisez « Coût et production par qualité » : poids au m², écart à la fiche, coût matière au m², m² prévus et réalisés.',
          'Cliquez une qualité pour ouvrir la « Ventilation par rôle » (trame, chaîne, latex…).',
        ],
      },
      {
        titre: 'Lots — où est le stock, depuis quand, et ce que pèsent les bobines',
        etapes: [
          'Choisissez « Lots ».',
          'Cliquez une des quatre cartes (Stock Projet, Restes, Bloqué qualité, Dormant) pour ouvrir la liste des lots correspondante.',
          'Lisez la répartition, l’âge des lots, puis l’écart de poids des bobines par fournisseur, par mois et par article.',
          'Lisez le suivi des autorisations, puis l’évaluation des fournisseurs (poids, colisage, prix) et le suivi réception par réception.',
        ],
      },
    ],
    champs: [
      { nom: 'Année', description: 'L’année des entrées affichées dans la matrice des familles. Par défaut, la plus récente présente dans les données.' },
      { nom: 'Sens', description: 'Entrée ou sortie : le sens du type de mouvement.' },
      { nom: 'Mvts', description: 'Le nombre de mouvements du mois pour ce type.' },
      { nom: 'Part', description: 'La quantité du mois en barre, proportionnelle au plus gros mois du tableau : une lecture visuelle, pas un pourcentage.' },
      { nom: 'ABC', description: 'La classe ABC de la référence (A : la plus grosse part de la valeur consommée).' },
      {
        nom: 'Entrées',
        alias: ['Entrees'],
        description: 'Les kilos entrés en stock : par référence (volet Mouvements) ou par famille sur l’année choisie (volet Familles).',
        valeurs: 'kg',
      },
      { nom: 'Sorties', description: 'Les kilos sortis du stock, par référence ou par famille.', valeurs: 'kg' },
      { nom: 'Flux', description: 'Entrées plus sorties de la référence, en barre proportionnelle à la référence qui a le plus bougé.' },
      { nom: 'Stock', description: 'Le stock actuel, en kilos (référence, famille ou catégorie).', valeurs: 'kg' },
      { nom: 'Rotation', description: 'Les sorties rapportées au stock actuel. C’est une approximation : l’outil ne garde pas l’historique du stock.' },
      {
        nom: 'Immobile',
        description: 'Le nombre de jours depuis le dernier mouvement de la référence ; « jamais » si elle n’a jamais bougé. En orange au-delà de 180 jours.',
        valeurs: 'jours',
      },
      {
        nom: 'Valeur',
        description: 'La valeur en dirhams (flux du mois, stock de la famille ou de la catégorie). La colonne disparaît si votre rôle ne voit pas les montants.',
        valeurs: 'MAD',
      },
      { nom: 'Famille', description: 'La famille de la référence. Les références sans famille sont comptées sous « (sans famille) » : les écarter donnerait un total faux.' },
      { nom: 'Réf.', description: 'Le nombre de références de la famille ou de la catégorie.' },
      { nom: 'Part du stock', description: 'Le stock de la famille en barre, proportionnel à la famille qui en porte le plus.' },
      {
        nom: 'Prix moyen',
        description: 'Volet Familles : le prix moyen PAYÉ à l’entrée, pas un tarif. Volet Prix d’achat : le prix moyen en dirhams de la référence sur ses achats.',
        valeurs: 'MAD/kg',
      },
      { nom: 'Catégorie', description: 'La catégorie matière, qui regroupe des familles.' },
      { nom: 'Familles', description: 'Le nombre de familles de la catégorie.' },
      { nom: 'Dev.', description: 'La devise d’achat de la référence.' },
      { nom: 'Achats', description: 'Le nombre d’achats de la référence (au total, ou dans le mois de l’historique). Avec un seul achat, il n’y a pas encore de tendance.' },
      { nom: 'Dernier', description: 'Le dernier prix payé, en dirhams.', valeurs: 'MAD/kg' },
      { nom: 'Total', description: 'Volet Prix d’achat : la dérive totale du prix en dirhams, en %. Volet Familles : le total des kilos entrés de la famille.' },
      {
        nom: 'Fournisseur',
        description: 'Volet Prix d’achat : la part de la dérive due au tarif du fournisseur (ce qui se négocie). Dans les autres tableaux : le nom du fournisseur.',
      },
      { nom: 'Change', description: 'La part de la dérive due au taux de change : rien à négocier avec le fournisseur, elle se couvre.' },
      { nom: 'Impact MAD', description: 'Ce que la hausse du fournisseur a coûté en dirhams sur les volumes achetés. Le tableau est trié sur cette colonne.', valeurs: 'MAD' },
      { nom: 'Prix devise', description: 'Le prix moyen du mois dans la devise d’achat, pondéré par les quantités.' },
      { nom: 'Taux', description: 'Le taux de change moyen du mois.' },
      { nom: 'Prix MAD', description: 'Le prix moyen du mois converti en dirhams.' },
      { nom: 'Montant', description: 'Le montant acheté (ou reçu) dans le mois, en dirhams.', valeurs: 'MAD' },
      { nom: 'Quantité', description: 'Les kilos du mois (mouvements, achats ou réceptions selon le tableau).', valeurs: 'kg' },
      { nom: 'Pays', description: 'Le pays du fournisseur.' },
      { nom: 'Refs', description: 'Le nombre de références que le fournisseur livre.' },
      { nom: 'Volume d’achat', description: 'Le montant total acheté au fournisseur, en barre et en dirhams. Absent si votre rôle ne voit pas les montants.' },
      { nom: 'Délai', description: 'Le délai réel moyen de livraison constaté.', valeurs: 'jours' },
      { nom: 'Ponctuel', description: 'La part des livraisons arrivées à l’heure.', valeurs: '%' },
      { nom: 'Conforme', description: 'La part des réceptions conformes (au total, ou dans le mois de la tendance).', valeurs: '%' },
      { nom: 'OTIF', description: 'À l’heure, complet et conforme à la fois. Vert à partir de 95 %, orange de 80 à 95 %, rouge en dessous.', valeurs: '%' },
      { nom: 'Note', description: 'La note globale du fournisseur, sur 100.' },
      {
        nom: 'Classement',
        description:
          'Le rang que donne la note : stratégique, standard, à surveiller, challenger en dessous. Les bornes sont les scores réglés dans Paramètres (P_ScoreStrategique, P_ScoreStandard, P_ScoreSurveiller).',
        valeurs: 'STRATEGIQUE · STANDARD · A_SURVEILLER · CHALLENGER',
      },
      { nom: 'Réceptions', description: 'Le nombre de réceptions du fournisseur (dans le mois, ou au total dans l’évaluation des lots).' },
      { nom: 'A l’heure', description: 'Les réceptions du mois arrivées à l’heure, sur celles dont la date était mesurable.' },
      { nom: 'Retard moyen', description: 'Le retard moyen du mois ; « non mesurable » sans date promise.', valeurs: 'jours' },
      { nom: 'Statut', description: 'Le statut de la qualité (ACTIF ou non).' },
      { nom: 'Roles', description: 'Le nombre de rôles de la recette (trame, chaîne, latex…).' },
      {
        nom: 'Matieres',
        description: 'Le nombre de composants de la recette ; entre parenthèses, ceux qui n’ont pas de CMUP — leur part manque au coût, qui est alors sous-estimé.',
      },
      { nom: 'kg/m2', description: 'Le poids de matière par mètre carré tiré de la recette (par qualité, ou par rôle dans la ventilation).', valeurs: 'kg/m²' },
      {
        nom: 'Écart fiche',
        description: 'L’écart entre le poids au m² de la recette et le poids commercial de la qualité. En orange au-delà de 1 % : la recette s’écarte de la fiche.',
        valeurs: '%',
      },
      { nom: 'Coût/m2', description: 'Le coût matière au mètre carré, au CMUP des composants. Absent si votre rôle ne voit pas les coûts.', valeurs: 'MAD/m²' },
      { nom: 'Poids relatif', description: 'Le coût au m² en barre, proportionnel à la qualité la plus chère.' },
      { nom: 'm2 prévus', description: 'Les mètres carrés prévus pour la qualité par le plan de production en cours.', valeurs: 'm²' },
      { nom: 'Realise', description: 'Le taux de réalisation : m² réalisés sur m² prévus du plan en cours.', valeurs: '%' },
      { nom: 'Role', description: 'Un rôle de la recette dans la ventilation par rôle.' },
      {
        nom: 'Somme %',
        description: 'La somme des pourcentages des matières du rôle. Elle doit valoir 100 % (règle R07) ; toute autre valeur s’affiche en rouge.',
        valeurs: '%',
      },
      { nom: 'Part du coût', description: 'Le coût du rôle en barre, proportionnel au rôle le plus cher.' },
      { nom: 'Article', description: 'La référence pesée (articles les plus divergents) ou reçue (suivi réception par réception).' },
      { nom: 'Lignes', description: 'Le nombre de lignes pesées pour l’article.' },
      { nom: 'Bobines', description: 'Le nombre de bobines pesées.' },
      { nom: 'Catalogue', description: 'Le poids d’une bobine selon le catalogue.', valeurs: 'kg' },
      { nom: 'Réel moyen', description: 'Le poids réel moyen d’une bobine, pesé.', valeurs: 'kg' },
      {
        nom: 'Écart',
        description: 'L’écart moyen de poids par bobine, coloré selon les tolérances des lots (P_LotTolOrangePct, P_LotTolRougePct).',
        valeurs: '%',
      },
      { nom: 'Écart kg', description: 'L’écart de poids cumulé de l’article.', valeurs: 'kg' },
      { nom: 'Lots pesés', description: 'Le nombre de lots du fournisseur dont des bobines ont été pesées.' },
      { nom: 'Orange', description: 'Les lots dont l’écart cumulé passe le seuil orange.' },
      { nom: 'Rouge', description: 'Les lots dont l’écart cumulé passe le seuil rouge.' },
      { nom: 'Écart cumulé', description: 'L’écart des lots, toutes pesées additionnées depuis leur entrée.', valeurs: 'kg' },
      { nom: 'Écart moyen', description: 'L’écart moyen par bobine des lots du fournisseur.', valeurs: '%' },
      {
        nom: 'Demande',
        description:
          'Le type d’autorisation : écart de poids hors tolérance, mélange de fournisseurs, utiliser un lot bloqué, restes en production, retour au magasin principal, lot dormant, fusion de lots, stock insuffisant.',
      },
      { nom: 'Niveau', description: 'Orange ou rouge : le niveau de l’autorisation demandée.' },
      { nom: 'En attente', description: 'Les demandes pas encore tranchées.' },
      { nom: 'Accordées', description: 'Les demandes accordées.' },
      { nom: 'Refusées', description: 'Les demandes refusées.' },
      { nom: 'Délai moyen', description: 'Le temps moyen de la demande à la décision.', valeurs: 'heures' },
      { nom: 'Refus', description: 'La part des refus parmi les demandes tranchées.', valeurs: '%' },
      { nom: 'Articles', description: 'Le nombre d’articles reçus du fournisseur.' },
      { nom: 'Variation poids', description: 'La variation moyenne du poids d’une bobine mesuré à la réception face au poids connu avant.', valeurs: '%' },
      { nom: 'Hors tolérance', description: 'Les mesures de poids hors tolérance.' },
      { nom: 'Colisage changé', description: 'Les réceptions où le nombre de bobines par palette a changé.' },
      { nom: 'Variation prix', description: 'La variation moyenne du prix au kilo d’une réception à l’autre ; hausse en rouge, baisse en vert.', valeurs: '%' },
      { nom: 'Hausses', description: 'Le nombre de hausses de prix constatées.' },
      { nom: 'Mesures écartées', description: 'Les mesures de poids gardées mais écartées parce qu’elles s’éloignent de plus de 50 % du poids connu.' },
      { nom: 'Date', description: 'La date de la réception (suivi réception par réception).' },
      { nom: 'Réception', description: 'Le numéro de la réception et son fournisseur.' },
      {
        nom: 'Poids / bobine',
        description: 'Le poids d’une bobine mesuré à cette livraison, avec le poids connu avant et l’écart ; « premier poids » s’il n’y en avait pas, barré s’il est écarté.',
        valeurs: 'kg',
      },
      { nom: 'Bobines / palette', description: 'Les bobines par palette observées à cette livraison ; « avant N » si le nombre a changé.' },
      { nom: 'Prix au kilo', description: 'Le prix au kilo dans la devise de la réception, avec sa variation.' },
    ],
    regles: [
      'Les chiffres sont calculés à la lecture, sur les données du jour : rien n’est figé ni recopié.',
      'Un champ masqué par vos droits n’est pas « à zéro » : la colonne disparaît (valeurs, montants, coûts, prix).',
      'Les moyennes de prix sont pondérées par les quantités : une palette d’essai ne pèse pas autant qu’un conteneur.',
      'Projet et Restes ne comptent que les lots libres et actifs ; un lot bloqué ou dormant n’est compté qu’une fois, dans sa colonne. La somme refait le stock comptable.',
      'Les couleurs d’écart de poids suivent les tolérances réglées dans Paramètres, jamais un seuil écrit dans l’écran.',
      'La carte « OTIF moyen » affiche une cible de 95 %.',
    ],
    liens: [
      { route: '/catalogue/completer', libelle: 'Classer les références sans famille' },
      { route: '/etat-stock', libelle: 'État des stocks (liste complète)' },
      { route: '/lots', libelle: 'Lots' },
      { route: '/autorisations', libelle: 'Autorisations' },
    ],
  },

  /* ======================================================================= */
  /* Valorisation                                                             */
  /* ======================================================================= */
  {
    route: '/valorisation',
    titre: 'Valorisation du stock',
    chemin: 'Finance → Valorisation (CMUP)',
    objectif:
      'Lire ce que vaut aujourd’hui le stock, référence par référence, au CMUP de chaque magasin, et repérer les CMUP qui s’écartent du prix catalogue.',
    prerequis: [
      'Des entrées valorisées (réceptions validées) : ce sont elles qui font le CMUP.',
      'Un taux de change en vigueur pour la devise du catalogue, sans quoi une référence sans achat reste sans CMUP.',
    ],
    droits:
      'Lecture du module Catalogue pour ouvrir l’écran (l’entrée du menu, elle, suit le module Valorisation). Le CMUP et les valeurs suivent votre grille de champs : un champ masqué s’affiche « — ».',
    procedures: [
      {
        titre: 'Lire la valeur du stock',
        etapes: [
          'Lisez les quatre chiffres : valeur totale, quantité, références sans CMUP, écarts supérieurs à 15 %.',
          'Survolez « Valeur totale » ou « Quantité » : la bulle donne la part du fil en route entre deux magasins.',
          'Lisez « Méthode et hypothèses » : la formule, l’assiette, la devise pivot, l’unité et la date.',
          'Lisez le graphique « Où dort la valeur » : les références qui pèsent le plus.',
        ],
      },
      {
        titre: 'Chercher ce qui cloche',
        etapes: [
          'Cliquez « Écart notable » pour ne garder que les références dont le CMUP s’écarte d’au moins 15 % du prix catalogue converti.',
          'Cliquez « Sans CMUP » pour ne garder que les références comptées pour zéro.',
          'Cliquez « Toutes » pour revenir à la liste complète, triée par valeur décroissante.',
        ],
        resultat: 'La liste ne montre que les références à examiner.',
      },
    ],
    champs: [
      {
        nom: 'Valeur totale',
        description: 'La valeur de tout le stock : chaque magasin à son CMUP, plus le fil en route (expédié, pas encore reçu) à son CMUP de départ.',
        valeurs: 'MAD',
      },
      { nom: 'Quantité', description: 'Les kilos en stock, fil en route compris.', valeurs: 'kg' },
      {
        nom: 'Sans CMUP',
        description:
          'Les références qui portent du stock sans CMUP : ni achat, ni prix catalogue convertible (taux absent). Elles comptent pour zéro : le total est alors un plancher.',
      },
      { nom: 'Ecart superieur a 15 %', description: 'Les références dont le CMUP s’écarte d’au moins 15 % du prix catalogue converti au taux du jour.' },
      { nom: 'Methode', description: 'CMUP — coût moyen unitaire pondéré.' },
      { nom: 'Formule', description: '(quantité × CMUP + entrée × prix) ÷ (quantité + entrée), à chaque entrée valorisée.' },
      {
        nom: 'Assiette',
        description:
          'Les entrées valorisées. Sans achat, le CMUP est le prix catalogue au taux en vigueur, et la première réception fait la moyenne avec lui. Une sortie ne modifie jamais le CMUP d’un magasin (règle R04).',
      },
      { nom: 'Devise pivot', description: 'Le dirham : chaque ligne reçue est convertie au taux en vigueur à la date de réception, figé sur la ligne.', valeurs: 'MAD' },
      { nom: 'Date de valorisation', description: 'La date du jour : l’écran valorise le stock présent, il ne reconstitue pas une date passée.' },
      { nom: 'Référence', description: 'Les références actives qui portent du stock ou du fil en route.' },
      { nom: 'Stock (kg)', description: 'Le stock en magasin, hors fil en route.', valeurs: 'kg' },
      { nom: 'CMUP (MAD)', description: 'Le coût moyen unitaire pondéré de la référence ; « — » en orange s’il manque.', valeurs: 'MAD/kg' },
      { nom: 'Catalogue (MAD)', description: 'Le prix catalogue converti en dirhams au taux en vigueur : la seule base comparable au CMUP.', valeurs: 'MAD/kg' },
      {
        nom: 'Écart',
        description:
          '(CMUP − prix catalogue converti) ÷ prix catalogue converti. À partir de 15 % : en rouge si le CMUP est au-dessus, en vert s’il est en dessous.',
        valeurs: '%',
      },
      { nom: 'Valeur (MAD)', description: 'La valeur de la référence, chaque magasin à son CMUP.', valeurs: 'MAD' },
    ],
    regles: [
      'La valorisation ne modifie rien : c’est une lecture, jamais une écriture.',
      'Chaque magasin a son CMUP : la valeur d’une référence est la somme des magasins, comme la tuile « Valeur du stock » du tableau de bord.',
      'Le fil en route compte : sorti d’un magasin, pas encore entré dans l’autre, il reste à l’entreprise à son CMUP de départ.',
      'Un prix au kilo garde 4 décimales, un montant 2.',
    ],
    liens: [
      { route: '/landed-cost', libelle: 'Coût de revient complet' },
      { route: '/classification', libelle: 'Analyse ABC / XYZ' },
      { route: '/rapports', libelle: 'Rapports financiers' },
    ],
  },

  /* ======================================================================= */
  /* Rapports financiers                                                      */
  /* ======================================================================= */
  {
    route: '/rapports',
    titre: 'Rapports financiers',
    chemin: 'Finance → Rapports financiers',
    objectif:
      'Donner à la direction les chiffres matière de l’ERP sous une forme qui s’imprime et s’exporte : synthèse patrimoniale, concentration de la valeur, engagement par fournisseur, coût matière mensuel.',
    droits:
      'Lecture du module Valorisation, et droit de voir la valeur du stock : sans lui, l’écran le dit et n’affiche rien. Les chiffres viennent aussi de l’analyse du tableau de bord (lecture du module Cockpit).',
    procedures: [
      {
        titre: 'Lire et transmettre un rapport',
        etapes: [
          'Choisissez le rapport dans le sélecteur en haut à droite.',
          'Lisez-le à l’écran.',
          'Cliquez « Exporter ce rapport » pour un fichier CSV du rapport affiché.',
          'Cliquez « Imprimer » : la feuille porte TOUS les rapports, pas seulement celui affiché.',
        ],
        resultat: 'Un document imprimé ou un fichier CSV prêt à transmettre.',
      },
    ],
    exemples: [
      {
        titre: 'la dépendance à un fournisseur',
        situation: 'Engagement par fournisseur : un fournisseur porte 34 % du budget annuel.',
        calcul: [
          ['Budget annuel', 'consommation mensuelle × 12 × CMUP, sommé sur ses références'],
          ['Part', 'son budget ÷ le total des fournisseurs affichés'],
        ],
        conclusion: 'Au-delà de 30 %, la part est surlignée : une défaillance toucherait un tiers de l’approvisionnement.',
      },
    ],
    champs: [
      {
        nom: 'Rapport affiché',
        description: 'Le rapport à l’écran.',
        valeurs: 'Synthèse patrimoniale · Concentration de la valeur · Engagement par fournisseur · Coût matière mensuel',
        defaut: 'Synthèse patrimoniale',
      },
      {
        nom: 'Stock immobilisé',
        description: 'La valeur du stock de tous les magasins, chacun à son CMUP (en millions de dirhams dans la synthèse) ; par classe ABC dans la concentration.',
        valeurs: 'MAD',
      },
      { nom: 'Coût matière annuel', description: 'La consommation mensuelle × 12, valorisée au CMUP, sur toutes les références.', valeurs: 'MAD' },
      {
        nom: 'Rotation du stock',
        description: 'Coût matière annuel ÷ valeur du stock. Sous 1 (en orange), le stock représente plus d’une année de consommation.',
        valeurs: 'fois / an',
      },
      {
        nom: 'Cycle de conversion',
        description:
          'DIO + DSO − DPO. Le DIO (jours de stock) et le DPO (délai de paiement fournisseur, pondéré par le budget) sont calculés ; le DSO vient du paramètre P_DSODefaut, faute de module de vente. Négatif, le fournisseur finance le cycle.',
        valeurs: 'jours',
      },
      { nom: 'Classe', description: 'La classe ABC ; « Non classées » pour les références sans classe.' },
      { nom: 'Références', description: 'Le nombre de références de la classe ou du fournisseur.' },
      { nom: 'Consommation annuelle', description: 'La valeur consommée en un an par la classe.', valeurs: 'MAD' },
      {
        nom: 'Part conso',
        description:
          'La part de la classe dans la consommation. À comparer à la part du stock : une classe qui pèse plus dans le stock que dans la consommation immobilise du capital.',
        valeurs: '%',
      },
      { nom: 'Part stock', description: 'La part de la classe dans la valeur du stock.', valeurs: '%' },
      { nom: 'Fournisseur', description: 'Les 10 fournisseurs au plus gros budget annuel.' },
      { nom: 'Budget annuel', description: 'La consommation mensuelle × 12 × CMUP des références du fournisseur.', valeurs: 'MAD' },
      { nom: 'Part', description: 'La part du fournisseur dans le budget des fournisseurs affichés ; surlignée au-delà de 30 %.', valeurs: '%' },
      { nom: 'Mois', description: 'Le mois du coût matière.' },
      { nom: 'Quantité (kg)', description: 'Les kilos de matière du mois.', valeurs: 'kg' },
      { nom: 'Coût (MAD)', description: 'Le coût matière du mois, ce que le plan engage.', valeurs: 'MAD' },
    ],
    regles: [
      'Ce ne sont que des chiffres matière : ni balance, ni grand livre général, ni compte de résultat.',
      'Rien n’est recalculé ici : chaque bloc reprend une vue existante (valorisation, analyse ABC, tableau de bord) et ne peut donc pas diverger d’elle.',
      'Les montants suivent la grille des champs : un rôle qui ne voit pas la valeur du stock ne reçoit aucun rapport.',
    ],
    liens: [
      { route: '/valorisation', libelle: 'Valorisation (CMUP)' },
      { route: '/classification', libelle: 'Analyse ABC / XYZ' },
    ],
  },

  /* ======================================================================= */
  /* Journal d'audit                                                          */
  /* ======================================================================= */
  {
    route: '/audit',
    titre: 'Journal d’audit',
    chemin: 'Paramètres → Paramètres → Paramètres utilisateurs → Journal d’audit',
    objectif: 'Retrouver qui a changé quoi, quand, avec l’ancienne et la nouvelle valeur.',
    droits: 'Lecture du module Audit (Direction et DAF). Le serveur refuse le journal aux autres rôles.',
    procedures: [
      {
        titre: 'Retrouver une modification',
        etapes: [
          'Tapez dans la recherche une table, un auteur ou un identifiant d’enregistrement.',
          'Cliquez une opération (INSERT, UPDATE, DELETE…) pour ne garder qu’elle ; « Toutes » pour revenir.',
          'Cliquez une ligne : le détail « Avant » / « Après » s’ouvre dessous ; recliquez pour le fermer.',
        ],
        resultat: 'Vous lisez l’auteur, l’heure, et les valeurs avant et après.',
      },
    ],
    champs: [
      { nom: 'Date', description: 'Le moment de l’opération (date et heure).' },
      { nom: 'Auteur', description: 'L’identifiant du compte qui a agi ; « — » si l’écriture n’a pas porté d’utilisateur.' },
      { nom: 'Opération', description: 'INSERT (création, en vert), UPDATE (modification, en orange), DELETE (suppression, en rouge).' },
      { nom: 'Table', description: 'La table de la base touchée.' },
      {
        nom: 'Enregistrement',
        description:
          'L’identifiant de la ligne touchée. « RECALCUL » sur plan_achat résume un recalcul du plan d’achat, avec le nombre de propositions remplacées.',
      },
      { nom: 'Avant', description: 'Les valeurs avant l’opération, en JSON.' },
      { nom: 'Après', description: 'Les valeurs après l’opération, en JSON.' },
    ],
    regles: [
      'Le journal est immuable : rien ne s’y modifie ni ne s’y efface.',
      'Une suppression y garde l’enregistrement entier dans « Avant » : il peut se reconstituer.',
      'L’écran lit les 1 000 entrées les plus récentes ; la recherche et le filtre s’appliquent à elles.',
      'Le grand livre des mouvements n’a pas besoin du journal : il est lui-même immuable, une correction se fait par contre-passation.',
    ],
  },

  /* ======================================================================= */
  /* Contrôles                                                                */
  /* ======================================================================= */
  {
    route: '/controles',
    titre: 'Contrôles de cohérence',
    chemin: 'Analyses → Contrôles de cohérence',
    objectif:
      'Voir ce que la base et le moteur de couverture vérifient (contrôles C01 à C66), lesquels sont en anomalie, et les lignes fautives de chacun.',
    droits: 'Lecture du module Cockpit.',
    procedures: [
      {
        titre: 'Traiter une anomalie',
        etapes: [
          'Cliquez « En anomalie » dans la colonne pour ne garder que les contrôles qui trouvent quelque chose (ou un niveau : Bloquants, Critiques, Attention) ; recliquez pour tout revoir.',
          'Cliquez la ligne d’un contrôle en anomalie : ses lignes fautives s’affichent (les 200 premières).',
          'Cliquez « Exporter le détail » pour toutes les lignes, en CSV.',
          'Corrigez dans l’écran concerné (contre-passation, réception, recette…), puis cliquez « Relancer ».',
        ],
        resultat: 'Le compteur du contrôle redescend à zéro une fois la cause corrigée.',
      },
    ],
    champs: [
      { nom: 'En anomalie', description: 'Ne garder que les contrôles dont le compteur n’est pas à zéro.' },
      {
        nom: 'Bloquants',
        description:
          'Une incohérence qui ne devrait pas pouvoir exister : une règle a été contournée, la cause se cherche avant de corriger la ligne (ex. C11 stock contre grand livre, C15 lot contre magasin, C31 réception non répercutée, C39, C42).',
      },
      {
        nom: 'Critiques',
        description:
          'Une situation métier qui demande une décision, pas une correction technique (ex. C05 plan non couvert sur l’horizon, calculé par le moteur de couverture ; C10 écart de pesée sans dérogation ; C38 consommation machine négative ; C44 deux inventaires en cours ; C45).',
      },
      {
        nom: 'Attention',
        description:
          'Un signal à examiner, qui ne bloque rien : il peut être normal ou annoncer un oubli (ex. C25 stock mobilisable face à un équivalent en tension, C28 commande en retard, C43 colisage incohérent, C46 à C65, C66 transfert en route sans date prévue de disponibilité).',
      },
    ],
    regles: [
      'L’écran ne juge pas : la criticité et le décompte viennent de la base. Tri : par niveau, puis les anomalies avant les contrôles au vert, puis par code.',
      'Les contrôles se recalculent à chaque lecture (et toutes les 5 minutes) : ils n’ont pas de mémoire, rien ne dit depuis quand une anomalie dure.',
      'C11 compare le cache du stock au grand livre des mouvements, qui fait foi : il doit rester à zéro, et se traite avant tout le reste.',
      'Les contrôles C46 à C66 sont des signaux : ils montrent, ils n’empêchent jamais une saisie.',
      'C05 (« Plan non couvert sur l’horizon ») et C25 (« Stock mobilisable face à un équivalent en tension ») sont calculés par le moteur de couverture, la même source que le plan d’achat et le stock projeté, et servis sous leurs codes à côté des autres. C27 et C49 sont retirés depuis le 27/10/2026 : le moteur n’a ni seuils de jours ni prolongation du plan.',
      'C28 (« Commande en retard : hors couverture tant qu’aucune nouvelle date n’existe ») compte les lignes de bon validé dont la date de livraison prévue — celle de la ligne, sinon de l’en-tête — est dépassée : le moteur ne les compte plus. Une nouvelle date sur le bon les fait revenir.',
      'C66 (« Transfert en route sans date prevue de disponibilite (hors couverture) », ATTENTION) : un transfert expédié avant que la date ne devienne obligatoire n’en a pas ; le moteur le liste « sans date » et ne le compte pas, jusqu’à ce qu’une date soit saisie (« Réviser la date » dans la liste des transferts).',
      'C64 signale un OF qui va au-delà du plan de production pour une qualité et un mois : le besoin d’achat vient du plan seul, l’OF n’y ajoute rien.',
      'C55 signale un document non validé daté d’une période close ; C65 un mouvement daté de la période de comptage d’un inventaire clôturé.',
    ],
    liens: [{ route: '/tableau-de-bord', libelle: 'Tableau de bord' }],
  },

  /* ======================================================================= */
  /* Configuration                                                            */
  /* ======================================================================= */
  {
    route: '/configuration',
    titre: 'Paramètres',
    chemin: 'Paramètres → Paramètres',
    objectif:
      'Régler les paramètres qui gouvernent les calculs (seuils, tolérances, délais), les devises et leurs taux, les sauvegardes, et ouvrir les comptes, les rôles et le journal d’audit.',
    droits:
      'Lecture du module Paramètres pour ouvrir l’écran ; écriture pour modifier un réglage, ouvrir un taux ou lancer une sauvegarde. Les sections Utilisateurs et droits, Rôles et permissions, Journal d’audit suivent les droits de leurs propres écrans.',
    procedures: [
      {
        titre: 'Modifier un réglage',
        etapes: [
          'Choisissez une section dans la colonne (Alertes et seuils, Production, Chaîne logistique, Réceptions et OTIF, Entreprise…) ou tapez dans « Chercher un réglage… ».',
          'Saisissez la nouvelle valeur à droite de la ligne : elle se marque « modifié ».',
          'Réglez d’autres lignes si besoin, puis relisez la barre « N modification(s) — rien n’est encore enregistré ».',
          'Cliquez « Enregistrer » (ou « Annuler » pour tout abandonner).',
        ],
        resultat: 'Chaque changement est historisé avec son auteur. Les valeurs servent de défaut à la création et ne modifient rien de déjà enregistré.',
      },
      {
        titre: 'Ouvrir un nouveau taux de change',
        etapes: [
          'Section « Devises et taux » : cliquez la devise dans le tableau.',
          'Lisez son historique, puis saisissez le « Nouveau taux » et, si besoin, la date « En vigueur à partir du ».',
          'Cliquez « Ouvrir le taux ».',
        ],
        resultat: 'Le taux précédent est fermé à cette date ; les achats déjà valorisés ne bougent pas.',
      },
      {
        titre: 'Clore une période',
        etapes: [
          'Section « Alertes et seuils », bloc « Autres réglages » : ligne « Période close jusqu’au ».',
          'Saisissez le dernier jour à clore (un jour passé), puis Enregistrer.',
          'Pour rouvrir, reculez la date : l’écran joint un motif, gardé à l’historique du paramètre.',
        ],
        resultat: 'Aucun mouvement de stock ne peut plus être daté de la période close ; une correction se fait par contre-passation datée du jour.',
      },
      {
        titre: 'Faire une sauvegarde',
        etapes: ['Section « Sauvegardes » : cliquez « Sauvegarder ».', 'Lisez le nom et la taille du fichier écrit, puis la liste des sauvegardes présentes.'],
        resultat: 'Une copie de la base est écrite sur le serveur, sans interrompre le travail. La restauration ne se fait pas depuis l’écran.',
      },
    ],
    champs: [
      {
        nom: 'Seuil d’alerte (statut ATTENTION)',
        description:
          'La valeur recopiée par défaut dans le seuil d’alerte (jours) d’une nouvelle qualité ou d’un nouveau plan de production. Depuis le 27/10/2026, l’état d’une référence vient du moteur de couverture (plan non couvert, sous la sécurité, couvert), sans seuil de jours : ce réglage ne classe plus aucune référence.',
        valeurs: 'jours',
        defaut: '90',
      },
      {
        nom: 'Seuil critique (statut CRITIQUE)',
        description:
          'La valeur recopiée par défaut dans le seuil critique (jours) d’une nouvelle qualité ou d’un nouveau plan de production. Comme le seuil d’alerte, il ne classe plus aucune référence depuis que le moteur de couverture donne l’état.',
        valeurs: 'jours',
        defaut: '60',
      },
      {
        nom: 'Couverture minimale cible',
        description:
          'La couverture visée quand la référence n’en déclare pas : elle entre dans le stock minimum (couverture × consommation mensuelle, majorée de la marge de sécurité).',
        valeurs: 'mois',
        defaut: '2',
      },
      { nom: 'Marge de sécurité sur couverture', description: 'La majoration appliquée à la couverture minimale quand la référence n’en déclare pas.', valeurs: '%', defaut: '20' },
      { nom: 'Délai fournisseur par défaut', description: 'Le délai retenu quand le fournisseur n’en déclare aucun.', valeurs: 'jours', defaut: '60' },
      {
        nom: 'Marge en jours sur date de besoin',
        description:
          'La couverture d’une commande quand le fournisseur n’en déclare pas : la fenêtre [D, F[ d’une proposition du moteur de couverture dure ce nombre de jours pleins (F = D + couverture).',
        valeurs: 'jours',
        defaut: '30',
      },
      { nom: 'Taux de perte production', description: 'La perte de matière qui majore chaque besoin calculé par le MRP.', valeurs: '%', defaut: '2' },
      {
        nom: 'Tolérance sur la somme des % d’une recette',
        description: 'De combien la somme des pourcentages d’un rôle de recette peut s’écarter de 100 %.',
        valeurs: '%',
        defaut: '0,5',
      },
      {
        nom: 'Stock de sécurité classe A',
        alias: ['Stock de sécurité classe B', 'Stock de sécurité classe C'],
        description:
          'Les jours de sécurité du moteur de couverture selon la classe ABC de la référence : sécurité = ces jours × consommation moyenne prévue du plan sur la fenêtre de la commande. Une référence sans classe prend la plus longue des trois.',
        valeurs: 'jours',
        defaut: '30',
      },
      { nom: 'Date de la photo de stock initial (figée)', description: 'La date de la reprise : avant elle, les quantités viennent de l’inventaire d’ouverture. Verrouillée.' },
      { nom: 'Nom de l’entreprise', description: 'Figure sur les états d’impression et les bons de commande. N’entre dans aucun calcul.' },
      { nom: 'Secteur d’activité', description: 'Contexte métier, sans effet sur les calculs.' },
      { nom: 'Pays', description: 'Le pays du siège : il distingue achats locaux et imports.' },
      { nom: 'Date de mise en service', description: 'Le début de l’historique exploitable : avant, les données viennent de la reprise.' },
      {
        nom: 'Devise pivot',
        description: 'La monnaie de référence de toute valorisation. Verrouillée : la changer rendrait faux tout le stock déjà valorisé.',
        valeurs: 'MAD',
      },
      {
        nom: 'Seuil cumul classe A',
        alias: ['Seuil cumul classe B'],
        description: 'Le cumul de valeur consommée jusqu’auquel une référence est classée A (puis B) ; au-delà, C.',
        valeurs: '%',
        defaut: 'A : 80 · B : 95',
      },
      {
        nom: 'Seuil CV classe X',
        alias: ['Seuil CV classe Y'],
        description: 'Le coefficient de variation de la consommation jusqu’auquel une référence est X (régulière), puis Y ; au-delà, Z.',
        valeurs: 'ratio',
        defaut: 'X : 0,25 · Y : 0,50',
      },
      {
        nom: 'Seuil montant TIER 1',
        alias: ['Seuil montant TIER 2', 'Seuil montant TIER 3'],
        description: 'Les montants qui classent l’urgence d’un achat (tiering).',
        valeurs: 'MAD',
      },
      { nom: 'Montant BC exigeant validation Direction', description: 'À partir de ce montant, la Direction doit signer le bon de commande.', valeurs: 'MAD', defaut: '300 000' },
      {
        nom: 'Seuil de regroupement des commandes',
        description: 'En dessous, mieux vaut regrouper avec une autre commande du même fournisseur que d’émettre un bon isolé.',
        valeurs: 'MAD',
        defaut: '100 000',
      },
      {
        nom: 'Score fournisseur STRATEGIQUE',
        alias: ['Score fournisseur STANDARD', 'Score fournisseur A SURVEILLER'],
        description: 'Les bornes de la note globale qui rangent un fournisseur en stratégique, standard, à surveiller ; en dessous, challenger.',
        valeurs: '/100',
        defaut: '85 · 65 · 45',
      },
      { nom: 'Seuil de stock dormant', description: 'Au-delà, un stock qui ne bouge plus est signalé dormant.', valeurs: 'jours', defaut: '180' },
      {
        nom: 'Délai de paiement par défaut',
        description: 'Le délai appliqué quand le fournisseur n’en déclare aucun ; il sert aussi de DSO aux rapports financiers.',
        valeurs: 'jours',
        defaut: '60',
      },
      { nom: 'Date de référence des indicateurs', description: 'Le point de départ des cumuls et des comparaisons annuelles.' },
      {
        nom: 'Tolérance écart de pesée en réception',
        description: 'Au-delà de cet écart entre l’annoncé et le pesé, la ligne de réception exige une dérogation nominative (sinon, contrôle C10).',
        valeurs: '%',
        defaut: '2',
      },
      { nom: 'Tolérance In-Full', description: 'À partir de quel manque une livraison cesse d’être complète.', valeurs: '%', defaut: '2' },
      { nom: 'Cible OTIF fournisseurs', description: 'La performance attendue : à l’heure, complet et conforme à la fois.', valeurs: '%', defaut: '95' },
      {
        nom: 'Période close jusqu’au',
        description:
          'Le dernier jour d’une période arrêtée : aucun mouvement de stock ne peut plus y être daté. 2000-01-01 = rien de clos. On ne clôt que des jours passés ; seuls la Direction et l’Administrateur le règlent.',
        valeurs: 'date AAAA-MM-JJ',
      },
      {
        nom: 'Retard au-delà duquel une commande ne compte plus',
        description:
          'Sans effet depuis le 27/10/2026 (gardé, en attente de décision) : le moteur de couverture ne compte jamais une ligne de bon dont la date de livraison prévue est dépassée, dès le premier jour (contrôle C28).',
        valeurs: 'jours',
        defaut: '5',
      },
      {
        nom: 'Compter les commandes en retard dans l’en-cours',
        description:
          'Sans effet depuis le 27/10/2026 (gardé, en attente de décision) : une ligne de bon en retard est toujours hors couverture, jusqu’à ce qu’une nouvelle date existe.',
        valeurs: '0 ou 1',
        defaut: '1',
      },
      {
        nom: 'Prolonger la demande au-delà du plan',
        description:
          'Sans effet depuis le 27/10/2026 (gardé, en attente de décision) : le moteur de couverture s’arrête à la fin de l’horizon du plan en service et ne prolonge pas la demande.',
        valeurs: '0 ou 1',
        defaut: '1',
      },
      {
        nom: 'Durée d’une proposition d’achat écartée',
        description: 'Au-delà, une proposition écartée cesse de masquer la référence : le besoin est reproposé au calcul suivant.',
        valeurs: 'jours',
        defaut: '90',
      },
      {
        nom: 'Ancienneté maximale du taux de référence',
        description: 'Au-delà, un bon de commande en devise ne se valide pas tant que le taux du jour n’est pas saisi.',
        valeurs: 'jours',
        defaut: '7',
      },
      {
        nom: 'Couverture au-delà de laquelle un stock bas est un écart',
        description:
          'Sans effet depuis le 27/10/2026 (gardé, en attente de décision) : il réglait le contrôle C27, retiré avec l’ancien calcul du stock projeté.',
        valeurs: 'jours',
        defaut: '60',
      },
      {
        nom: 'Transfert en route : délai avant alerte',
        description: 'Au-delà, le contrôle C54 signale un transfert expédié et toujours pas réceptionné. Il ne bloque rien.',
        valeurs: 'jours',
        defaut: '7',
      },
      {
        nom: 'Prêt à une autre usine : délai avant alerte',
        description: 'Au-delà, le contrôle C47 signale un prêt de fil non rendu. Il ne bloque rien.',
        valeurs: 'jours',
        defaut: '60',
      },
      {
        nom: 'Dormance d’un lot',
        description: 'Un lot sans aucune activité (entrée, sortie, constat) depuis cette durée est signalé dormant.',
        valeurs: 'jours',
        defaut: '365',
      },
      { nom: 'Écart de poids : seuil orange', description: 'Au-delà, la ligne demande une confirmation (« Je confirme avoir vérifié »).', valeurs: '%', defaut: '1' },
      { nom: 'Écart de poids : seuil rouge', description: 'Au-delà, la ligne demande l’autorisation d’un responsable.', valeurs: '%', defaut: '3' },
      {
        nom: 'Seuil Projet / Restes : bobines d’un étage',
        description: 'Un lot qui remplit au moins un étage de machine est du stock Projet ; en dessous, c’est un Reste.',
        valeurs: 'bobines',
        defaut: '1 344',
      },
      {
        nom: 'Seuil Projet / Restes en kilos',
        description: 'Pour un article sans poids de bobine (jute, colle) : sous ce poids, un lot est un Reste.',
        valeurs: 'kg',
        defaut: '5 000',
      },
      {
        nom: 'Colisage : alerte sur le poids d’une bobine',
        description: 'Au-delà, l’écran signale que kilos et bobines ne s’accordent pas avec le conditionnement connu.',
        valeurs: '%',
        defaut: '10',
      },
      {
        nom: 'Colisage : refus sur le poids d’une bobine',
        description: 'Au-delà, la ligne (bon, facture, réception) est refusée : kilos, bobines et palettes se contredisent.',
        valeurs: '%',
        defaut: '25',
      },
      {
        nom: 'Clôture facture : avis au-delà de l’écart',
        description: 'Au-delà, l’aperçu de clôture signale que la facture s’écarte de la valeur au prix du bon, sans bloquer.',
        valeurs: '%',
        defaut: '10',
      },
      {
        nom: 'Déchet : seuil de validation (kg)',
        description: 'Au-delà, un déchet saisi à la main demande le droit de valider l’inventaire, comme un ajustement négatif.',
        valeurs: 'kg',
        defaut: '50',
      },
      {
        nom: 'Tolérance écart estimation en machine',
        description: 'L’écart d’estimation de poids en machine au-delà duquel le contrôle C35 signale la ligne.',
        valeurs: '%',
        defaut: '10',
      },
      {
        nom: 'Ancienneté max d’inventaire d’un emplacement',
        description: 'Au-delà, le contrôle C36 signale un emplacement de machine sans inventaire récent. Il n’entre pas dans le calcul des besoins.',
        valeurs: 'jours',
        defaut: '30',
      },
      {
        nom: 'Écart machine : vert jusqu’à (kg)',
        alias: ['Écart machine : vert jusqu’à (%)'],
        description: 'Le seuil vert d’un écart de décision machine est le plus grand de ce poids et de ce pourcentage du poids de la ligne.',
        defaut: '10 kg · 1 %',
      },
      {
        nom: 'Écart machine : rouge au-delà de (kg)',
        alias: ['Écart machine : rouge au-delà de (%)'],
        description: 'Le seuil rouge d’un écart de décision machine est le plus grand de ce poids et de ce pourcentage du poids de la ligne.',
        defaut: '50 kg · 5 %',
      },
      {
        nom: 'OF : écart réel / prévu signalé',
        description: 'Un OF clôturé dont la consommation réelle s’écarte du prévu (métrage × recette) de plus de ce pourcentage est signalé (C61). Jamais un blocage.',
        valeurs: '%',
        defaut: '15',
      },
      {
        nom: 'Inventaire tournant : classe A comptée tous les',
        alias: ['Inventaire tournant : classe B comptée tous les', 'Inventaire tournant : classe C comptée tous les'],
        description:
          'Une référence en stock est proposée au tournant si elle n’a pas été comptée dans ce magasin depuis ce nombre de jours (ou jamais), selon sa classe ABC ; sans classe, la règle de C.',
        valeurs: 'jours',
        defaut: 'A : 30 · B : 90 · C : 180',
      },
      { nom: 'Jour de la bascule vers la réception unifiée', description: 'Le jour où la réception est devenue un arrivage. Verrouillé, pour mémoire.' },
      {
        nom: 'Adresse de GestionAi',
        description: 'Ignoré depuis le 13/10/2026 : l’adresse se règle sur le serveur. Les réglages de l’assistant reviennent à l’administrateur.',
      },
      {
        nom: 'Nouveau taux',
        description: 'Combien de dirhams vaut une unité de la devise choisie. Un nouveau taux ferme le précédent, sans jamais le réécrire.',
        obligatoire: true,
        valeurs: 'nombre positif',
      },
      { nom: 'En vigueur à partir du', description: 'La date d’effet du taux.', defaut: 'vide : le taux s’applique immédiatement' },
      { nom: 'En vigueur depuis', description: 'Historique des taux : la date de début de chaque taux.' },
      { nom: 'Jusqu’au', description: 'Historique des taux : la date de fin ; « en vigueur » pour le taux ouvert.' },
      { nom: 'Pivot', description: 'La monnaie de référence : son taux vaut 1 par définition, et la base refuse toute autre valeur.' },
      { nom: 'Fichier', description: 'Le nom de la sauvegarde sur le serveur ; « la plus récente » marque la dernière.' },
      { nom: 'Taille', description: 'La taille de la sauvegarde.', valeurs: 'Mo' },
      {
        nom: 'Nouveau mot de passe',
        description: 'Section Utilisateurs et droits : le mot de passe à poser sur le compte (voir l’écran Utilisateurs).',
        obligatoire: true,
        valeurs: '12 caractères au moins',
      },
      { nom: 'Confirmation', description: 'Le même mot de passe, une seconde fois.', obligatoire: true },
    ],
    regles: [
      'Un réglage verrouillé (date de reprise, devise pivot, jour de bascule) s’affiche grisé et ne se modifie pas.',
      'La ligne indique « réservé à DIRECTION » quand le référentiel le dit. La base l’impose pour la période close (Direction ou Administrateur) ; le serveur réserve les réglages de l’assistant à l’administrateur.',
      'Une valeur est contrôlée par la base selon son type : entier ou nombre positif (avec un point : 2.5), date AAAA-MM-JJ qui existe.',
      'Deux personnes qui règlent le même paramètre en même temps : le second enregistrement est refusé en nommant le premier.',
      'Un paramètre qu’aucun bloc ne nomme n’est pas perdu : il apparaît sous « Autres réglages » de sa catégorie.',
      'Un taux est daté : une réception valorisée hier garde le taux d’hier, quoi qu’il arrive ensuite.',
      'Les sauvegardes vivent sur le même disque que la base : recopiez régulièrement le dossier vers un support externe. Une copie est aussi écrite à chaque arrêt du serveur ; les dix dernières sont gardées.',
      'La section « Mouvement stock » règle les magasins, types et motifs de mouvement, motifs de ligne, types de frais et positions tarifaires.',
    ],
    messages: [
      { message: 'PERIODE : on ne clôt que des jours passés ; le … n’est pas encore terminé.', cause: 'La date de clôture est aujourd’hui ou dans le futur.' },
      { message: 'PERIODE : clore ou rouvrir une période revient à la direction.', cause: 'Votre rôle n’est ni Direction ni Administrateur.' },
      { message: 'PARAMETRE : … attend un nombre positif ou nul, avec un point (2.5), pas « … ».', cause: 'La valeur saisie n’a pas le type du paramètre.' },
      { message: 'Le réglage de l’assistant (moteur, modèle) revient à l’administrateur.', cause: 'Un réglage P_Assistant… modifié par un autre rôle.' },
      {
        message: 'Ce reglage a ete modifie par … pendant votre saisie.',
        cause: 'Quelqu’un a enregistré le même paramètre entre-temps : rouvrez, relisez, refaites votre réglage.',
      },
    ],
    liens: [
      { route: '/utilisateurs', libelle: 'Utilisateurs' },
      { route: '/audit', libelle: 'Journal d’audit' },
      { route: '/controles', libelle: 'Contrôles de cohérence' },
    ],
  },

  /* ======================================================================= */
  /* Utilisateurs                                                             */
  /* ======================================================================= */
  {
    route: '/utilisateurs',
    titre: 'Utilisateurs',
    chemin: 'Paramètres → Paramètres → Paramètres utilisateurs → Utilisateurs et droits',
    objectif: 'Créer les comptes, poser leur mot de passe, les désactiver, et ouvrir la grille des droits par champ de chacun.',
    droits:
      'Lecture du module Utilisateurs pour voir les comptes ; écriture pour créer, réinitialiser un mot de passe ou désactiver. Hors l’Administrateur : pas de rôle Administrateur à donner, pas de compte administrateur à toucher, pas de mot de passe d’autrui à réinitialiser.',
    procedures: [
      {
        titre: 'Créer un compte',
        etapes: [
          'Cliquez « Nouvel utilisateur » : le formulaire s’ouvre sur la page.',
          'Saisissez l’identifiant, le rôle, le nom complet, l’e-mail si besoin, et un mot de passe de 12 caractères au moins.',
          'Cliquez « Créer ».',
          'Si besoin, ajustez ensuite ses droits par le bouton « Droits par champ » de sa ligne.',
        ],
        resultat: 'Le compte existe et sa grille de droits est initialisée depuis le modèle du rôle choisi.',
      },
      {
        titre: 'Poser ou remplacer un mot de passe',
        etapes: [
          'Sur la ligne du compte, cliquez « Définir le mot de passe » ou « Réinitialiser ».',
          'Saisissez le nouveau mot de passe, puis la confirmation.',
          'Notez-le et cliquez « Enregistrer » ; transmettez-le à la personne par un autre canal.',
        ],
        resultat: 'Le compte peut se connecter avec ce mot de passe, qui n’est plus affichable.',
      },
      {
        titre: 'Désactiver ou réactiver un compte',
        etapes: ['Sur la ligne du compte, cliquez « Désactiver » (ou « Réactiver »).'],
        resultat: 'Un compte désactivé ne peut plus se connecter ; il reste dans la liste, avec son historique.',
      },
    ],
    champs: [
      { nom: 'Identifiant', description: 'Le nom de connexion du compte.', obligatoire: true },
      {
        nom: 'Role',
        description: 'Le rôle du compte : il porte les permissions par module (lire, écrire, valider) et le modèle de ses droits par champ.',
        obligatoire: true,
      },
      { nom: 'Nom complet', description: 'Le nom de la personne, tel qu’il s’affiche dans les listes.', obligatoire: true },
      { nom: 'Email', description: 'L’adresse de la personne. Facultative.' },
      { nom: 'Mot de passe', description: 'Le mot de passe initial du compte.', obligatoire: true, valeurs: '12 caractères au moins' },
      {
        nom: 'Nouveau mot de passe',
        description: 'Le mot de passe à poser. Il n’est gardé que sous forme d’empreinte : notez-le avant de valider.',
        obligatoire: true,
        valeurs: '12 caractères au moins',
      },
      { nom: 'Confirmation', description: 'Le même mot de passe, une seconde fois. « Enregistrer » reste grisé tant que les deux diffèrent.', obligatoire: true },
    ],
    regles: [
      'Le mot de passe fait au moins douze caractères : l’écran le dit, le serveur le décide.',
      'Un compte « mot de passe à définir » ne peut pas se connecter tant qu’un mot de passe n’a pas été posé.',
      'On ne désactive pas son propre compte.',
      'Le masquage se fait au serveur : un champ masqué n’est pas seulement grisé, il n’arrive pas.',
    ],
    messages: [
      { message: 'mot de passe trop court : 12 caracteres minimum', cause: 'Le mot de passe a moins de douze caractères.' },
      { message: 'login et nom sont obligatoires', cause: 'L’identifiant ou le nom complet est vide.' },
      { message: 'Seul un administrateur attribue le rôle Administrateur.', cause: 'Un rôle autre qu’Administrateur crée un compte administrateur.' },
      { message: 'Seul un administrateur modifie un compte administrateur.', cause: 'Le compte visé est administrateur.' },
      { message: 'Seul un administrateur réinitialise le mot de passe d’un autre compte.', cause: 'Vous n’êtes pas administrateur et le compte n’est pas le vôtre.' },
      { message: 'Vous ne pouvez pas desactiver votre propre compte.', cause: 'Le compte à désactiver est le vôtre.' },
    ],
    liens: [{ route: '/configuration?section=utilisateurs', libelle: 'Rôles et permissions' }],
  },

  /* ======================================================================= */
  /* Droits par champ d'un utilisateur                                         */
  /* ======================================================================= */
  {
    route: '/utilisateurs/:id/droits',
    titre: 'Droits par champ',
    chemin: 'Paramètres → Paramètres → Utilisateurs et droits → Droits par champ (sur la ligne du compte)',
    objectif: 'Régler, champ par champ et module par module, ce qu’un utilisateur voit et peut modifier.',
    droits:
      'Lecture du module Utilisateurs pour consulter la grille ; écriture pour la régler. On ne règle pas ses propres droits, ni ceux d’un administrateur, sauf à être administrateur.',
    procedures: [
      {
        titre: 'Régler les droits d’un utilisateur',
        etapes: [
          'Choisissez le module dans la rangée d’onglets (le nombre de réglages non enregistrés s’affiche à côté).',
          'Filtrez les champs si besoin.',
          'Pour chaque champ, cliquez Masque, Lecture ou Écriture ; « Tout régler » applique un niveau à tous les champs affichés du module.',
          'Cliquez « Enregistrer (N) ».',
        ],
        resultat: 'Les réglages s’appliquent dès la requête suivante de l’utilisateur.',
      },
      {
        titre: 'Remettre un module au modèle du rôle',
        etapes: ['Choisissez le module.', 'Cliquez « Appliquer le modèle du rôle ».'],
        resultat: 'Tous les champs du module reprennent le niveau du modèle du rôle, réglages à la main compris.',
      },
    ],
    champs: [
      {
        nom: 'Champ',
        description:
          'Le champ réglé. « sensible » : un champ à régler avec soin (montants, prix) ; « par défaut » : aucun réglage propre, il suit le niveau du catalogue ; « à la main » : réglé pour cet utilisateur, le modèle du rôle ne le change plus.',
      },
      { nom: 'Nom technique', description: 'Le nom du champ dans la base (sous le libellé sur petit écran).' },
      {
        nom: 'Niveau',
        description: 'Ce que l’utilisateur peut faire de ce champ.',
        valeurs:
          'Masque — ni envoyé ni affiché · Lecture — visible, toute modification refusée par le serveur · Écriture — modifiable si le rôle a aussi le droit d’écrire sur le module',
      },
    ],
    regles: [
      'Un champ masqué n’est pas envoyé par le serveur ; un champ en lecture est refusé à l’écriture par le serveur, pas seulement grisé à l’écran.',
      'Un réglage égal au modèle du rôle suit le modèle ; un réglage différent devient « à la main », et un changement du modèle ne le touche plus.',
      'L’Administrateur a l’écriture partout, quoi que porte sa grille.',
      'Les réglages non enregistrés restent surlignés jusqu’à l’enregistrement.',
    ],
    messages: [
      { message: 'On ne règle pas ses propres droits : un administrateur le fait.', cause: 'La grille ouverte est la vôtre et vous n’êtes pas administrateur.' },
      { message: 'Seul un administrateur modifie un compte administrateur.', cause: 'Le compte visé est administrateur.' },
      { message: 'Seul un administrateur applique le modèle du rôle Administrateur.', cause: 'Le compte visé a le rôle Administrateur.' },
    ],
    liens: [{ route: '/utilisateurs', libelle: 'Utilisateurs' }],
  },

  /* ======================================================================= */
  /* Un rôle et ses permissions                                               */
  /* ======================================================================= */
  {
    route: '/roles/:code',
    titre: 'Rôle et permissions',
    chemin: 'Paramètres → Paramètres → Paramètres utilisateurs → Rôles et permissions → un rôle (ou Nouveau rôle)',
    objectif:
      'Créer ou régler un rôle : son libellé, son plafond de validation des bons, la double authentification, ses permissions par module et le modèle de visibilité de ses champs.',
    droits: 'Rôle Administrateur seulement : l’écran le dit aux autres rôles, et le serveur le refuse.',
    procedures: [
      {
        titre: 'Créer un rôle',
        etapes: [
          'Dans la liste des rôles, cliquez « Nouveau rôle ».',
          'Saisissez le code (majuscules, chiffres, _) et le libellé ; une description et un plafond si besoin.',
          'Partez d’un rôle vide, ou recopiez un rôle existant avec « À partir du rôle ».',
          'Cochez Lire, Écrire, Valider pour chaque module ; réglez la visibilité des champs module par module.',
          'Cliquez « Enregistrer » (il n’apparaît que si quelque chose a changé).',
        ],
        resultat: 'Le rôle existe ; l’écran s’ouvre sur sa fiche.',
      },
      {
        titre: 'Modifier un rôle',
        etapes: [
          'Ouvrez le rôle depuis la liste.',
          'Changez son libellé, son plafond, ses permissions ou le niveau d’un champ (Masqué, Lecture, Écriture) ; « Tout le module » règle tous les champs du module affiché.',
          'Cliquez « Enregistrer ».',
        ],
        resultat: 'Les utilisateurs du rôle prennent le nouveau modèle, sauf pour les champs réglés à la main pour eux ; le message dit combien de réglages ont suivi.',
      },
      {
        titre: 'Supprimer un rôle',
        etapes: ['Réaffectez d’abord ses utilisateurs : le bouton reste grisé tant que le rôle en porte.', 'Cliquez « Supprimer », puis confirmez.'],
        resultat: 'Le rôle disparaît avec ses permissions et son modèle de champs.',
      },
    ],
    exemples: [
      {
        titre: 'le modèle suit, le réglage à la main reste',
        situation:
          'Le rôle Magasinier passe un champ de Lecture à Masqué. Ahmed et Karim sont magasiniers ; pour Karim, ce champ avait été réglé à la main en Écriture.',
        calcul: [
          ['Ahmed (suit le modèle)', 'Lecture → Masqué'],
          ['Karim (réglé à la main)', 'reste Écriture'],
        ],
        conclusion: 'Pour remettre Karim au modèle : sa grille de droits → Appliquer le modèle du rôle.',
      },
      {
        titre: 'un rôle encore porté',
        situation: 'Le rôle « Acheteur » a encore 2 utilisateurs.',
        conclusion: 'Le bouton Supprimer est grisé (et la base refuserait) : réaffectez les 2 comptes à un autre rôle, puis supprimez.',
      },
    ],
    champs: [
      {
        nom: 'Code',
        description: 'Le code du rôle, à la création seulement : il ne change plus ensuite.',
        obligatoire: true,
        valeurs: 'majuscules, chiffres et _ ; 30 caractères au plus',
      },
      { nom: 'Libellé', description: 'Le nom du rôle tel qu’il s’affiche.', obligatoire: true, valeurs: '3 caractères au moins' },
      { nom: 'Description', description: 'Ce que fait ce rôle, en une phrase. Facultative.' },
      {
        nom: 'Plafond de validation des bons (MAD)',
        description:
          'Le montant au-delà duquel ce rôle ne valide pas un bon de commande ; le montant se juge au plus haut des deux taux (celui retenu et celui proposé).',
        valeurs: 'montant positif ou nul',
        defaut: 'vide — sans plafond',
      },
      {
        nom: 'Double authentification obligatoire',
        description: 'Cochée, un utilisateur du rôle qui n’a pas posé sa double authentification doit le faire avant de travailler.',
        defaut: 'décochée',
      },
      { nom: 'À partir du rôle', description: 'À la création : recopie les permissions et le modèle de champs d’un rôle existant dans la saisie.', defaut: '— rôle vide —' },
      { nom: 'Module', description: 'Un module de l’application, avec ce qu’il couvre.' },
      { nom: 'Lire', description: 'Ouvrir les écrans du module et en lire les données.' },
      { nom: 'Écrire', description: 'Créer et modifier dans le module.' },
      {
        nom: 'Valider',
        description: 'Distinct d’Écrire : c’est la base de la séparation des tâches (celui qui crée un bon ne le valide pas ; l’Administrateur en est dispensé).',
      },
      { nom: 'Tout le module', description: 'Règle d’un coup tous les champs du module affiché sur un niveau.', valeurs: 'Masqué · Lecture · Écriture' },
    ],
    regles: [
      'Un rôle porté par un utilisateur ne se supprime pas ; le rôle Administrateur ne se supprime jamais.',
      'L’Administrateur garde toujours la gestion des utilisateurs (case verrouillée) et voit tous les champs en écriture, quel que soit le modèle.',
      'Un rôle neuf part de tous les modules et de tous les champs, champs au niveau par défaut du catalogue.',
      'Quitter avec des modifications non enregistrées demande confirmation.',
      'Chaque changement de rôle, de permission ou de modèle entre au journal d’audit.',
    ],
    messages: [
      { message: 'ROLE-UTILISE : … utilisateur(s) ont le rôle « … » : réaffectez-les d’abord.', cause: 'Le rôle à supprimer est encore porté.' },
      { message: 'ROLE-ADMIN : le rôle Administrateur ne se supprime pas.', cause: 'Tentative de suppression du rôle Administrateur.' },
      { message: 'Le code d’un rôle s’écrit en majuscules, chiffres et _ (30 caractères au plus).', cause: 'Le code saisi contient un autre caractère ou est trop long.' },
      { message: 'Le rôle … existe déjà.', cause: 'Un rôle porte déjà ce code.' },
      { message: 'Le libellé du rôle compte au moins 3 caractères.', cause: 'Libellé vide ou trop court.' },
      { message: 'Le plafond de validation ne peut pas être négatif.', cause: 'Plafond saisi en dessous de zéro.' },
    ],
    liens: [{ route: '/configuration?section=utilisateurs', libelle: 'Liste des rôles' }],
  },

  /* ======================================================================= */
  /* États imprimables — le centre                                            */
  /* ======================================================================= */
  {
    route: '/etats',
    titre: 'États imprimables',
    chemin: 'Hors menu : adresse /etats ; chaque état s’ouvre aussi depuis le bouton d’impression de son écran',
    objectif:
      'Imprimer les documents qui portent sur une situation (stock, comptage, lots, réceptions, plan, besoins, mouvements, référentiels, manuel) ; ceux qui suivent un objet s’impriment depuis sa fiche.',
    droits:
      'Lecture du module Cockpit pour ouvrir le centre ; chaque état n’apparaît que si vous lisez son module (Stock, Inventaire, Lots, Plan d’achat, Réceptions, Plans, MRP, Mouvements, Catalogue, Fournisseurs). Un champ masqué ne s’imprime pas.',
    procedures: [
      {
        titre: 'Imprimer un état',
        etapes: [
          'Cliquez l’état voulu dans sa famille (Stock, Lots, Achats, Production, Mouvements, Référentiels, Documentation) ; une pastille orange signale ce qui attend (références en alerte, réceptions en cours…).',
          'Réglez le choix proposé au-dessus de l’aperçu (statut, magasin, réception, inventaire, plan…) : il ne s’imprime pas.',
          'Cliquez « Imprimer », ou enregistrez en PDF depuis la boîte d’impression ; « Retour » ramène à l’écran d’où vous venez.',
        ],
        resultat: 'Un document A4 avec l’en-tête de l’entreprise, et en pied la date d’édition et l’auteur.',
      },
    ],
    champs: [
      {
        nom: 'Réception à imprimer',
        description:
          'Bon de réception : la réception à imprimer, cherchée par son numéro. Par défaut, la plus récente. Absent quand l’état s’ouvre depuis la réception elle-même.',
      },
      { nom: 'Inventaire', description: 'Procès-verbal d’inventaire : l’inventaire à imprimer (numéro, date, magasin, statut). Par défaut, le plus récent.' },
      {
        nom: 'N imprimer que les lignes en ecart',
        description: 'Procès-verbal d’inventaire : ne garder que les lignes dont l’écart n’est pas nul ; le nombre de lignes en écart s’affiche à côté.',
        defaut: 'décochée',
      },
      { nom: 'Plan', description: 'Plan de production et besoins matière : le plan à imprimer. Par défaut, le plan en cours, sinon le premier.' },
    ],
    regles: [
      'Un état porte sa date d’édition et son auteur en pied de page, pour qu’on sache plus tard ce qu’on regarde.',
      'Les colonnes de montants disparaissent pour un rôle qui ne les voit pas : imprimer ne contourne pas les droits.',
      'Le bon de commande et les bons de sortie et de réception d’un transfert s’impriment depuis leur fiche, avec le bouton Imprimer.',
      'Le procès-verbal d’inventaire fait foi pour un inventaire clôturé ; un autre statut s’imprime en sous-titre.',
    ],
    liens: [
      { route: '/etats/stock', libelle: 'État des stocks' },
      { route: '/etats/plan-achat', libelle: 'Plan d’achat à engager' },
      { route: '/etats/comptage', libelle: 'Feuille de comptage' },
      { route: '/etats/lots', libelle: 'États des lots' },
      { route: '/etats/mouvements', libelle: 'Grand livre des mouvements' },
      { route: '/etats/catalogue', libelle: 'Catalogue des références' },
      { route: '/etats/manuel', libelle: 'Manuel d’utilisation' },
    ],
  },
  {
    route: '/etats/stock',
    titre: 'État des stocks (imprimé)',
    chemin: 'États imprimables → Stock → État des stocks',
    objectif:
      'Imprimer la photo du jour : par référence, le stock physique, le disponible compté par le moteur de couverture, jusqu’où le plan est couvert, ce qui ne l’est pas, l’état et la valeur.',
    droits: 'Lecture du module Stock. La colonne Valeur MAD et la valeur totale n’apparaissent qu’à qui voit la valeur du stock.',
    procedures: [
      {
        titre: 'Imprimer l’état des stocks',
        etapes: [
          'Choisissez au besoin un état dans « Restreindre à un état » (ce choix ne s’imprime pas ; le sous-titre de la feuille le rappelle).',
          'Relisez l’en-tête : le nombre de références et, si vous la voyez, la valeur totale.',
          'Cliquez « Imprimer ».',
        ],
      },
    ],
    champs: [
      {
        nom: 'Restreindre à un état',
        description: 'Ne garder que les références d’un état du moteur de couverture ; le sous-titre de la feuille le rappelle.',
        valeurs: 'Toutes les références · Plan non couvert · Sous la sécurité · Couvert',
        defaut: 'Toutes les références',
      },
      { nom: 'Référence', description: 'Le code et la désignation.' },
      { nom: 'Fournisseur', description: 'Le fournisseur de la fiche article.' },
      { nom: 'Physique kg', description: 'Le stock physique net de la référence, dans les magasins.', valeurs: 'kg' },
      {
        nom: 'Disponible kg',
        description:
          'Ce que le moteur de couverture compte aujourd’hui : magasins comptés au plan (hors quarantaine, lots bloqués exclus) + fil sur les métiers au dernier constat.',
        valeurs: 'kg',
      },
      {
        nom: 'Couvert jusqu’au',
        description: 'La veille de la première rupture du plan ; « tout l’horizon » sans rupture ; « rupture » si le plan n’est déjà plus couvert aujourd’hui.',
      },
      { nom: 'Non couvert kg', description: 'Les kilos du plan que le solde ne couvre pas sur l’horizon (ni reportés ni rattrapés).', valeurs: 'kg' },
      {
        nom: 'État',
        description:
          'L’état au moteur de couverture : Plan non couvert (une rupture est prévue sur l’horizon), Sous la sécurité (le solde passe sous la sécurité, sans rupture), Couvert.',
        valeurs: 'Plan non couvert · Sous la sécurité · Couvert',
      },
      { nom: 'Valeur MAD', description: 'La valeur du stock de la référence, au CMUP.', valeurs: 'MAD' },
    ],
    regles: [
      'Les chiffres sont ceux de l’écran Stock projeté et alertes, calculés à l’ouverture par le moteur de couverture : l’état imprimé est celui du moment.',
    ],
    liens: [
      { route: '/stock', libelle: 'Stock projeté et alertes' },
      { route: '/etat-stock', libelle: 'État des stocks (écran)' },
    ],
  },
  {
    route: '/etats/plan-achat',
    titre: 'Plan d’achat à engager (imprimé)',
    chemin: 'États imprimables → Achats → Plan d’achat à engager',
    objectif:
      'Imprimer les propositions d’achat groupées par fournisseur, avec leurs quantités, leur urgence et leur montant estimé : le document de la revue d’achats.',
    droits:
      'Lecture du module Plan d’achat. Les colonnes de prix et de montant, et le montant estimé de l’en-tête, n’apparaissent qu’à qui voit le prix estimé.',
    prerequis: ['Des propositions générées dans le plan d’achat (« Régénérer » ou « Commander »).'],
    procedures: [
      {
        titre: 'Imprimer le plan d’achat',
        etapes: [
          'Ouvrez l’état depuis le centre des états imprimables (famille Achats).',
          'Relisez l’en-tête : le nombre de fournisseurs, de propositions et, si vous le voyez, le montant estimé.',
          'Cliquez « Imprimer » : un bloc par fournisseur, qui se détache pour être donné à traiter.',
        ],
      },
    ],
    champs: [
      { nom: 'Fournisseurs', description: 'En-tête : le nombre de fournisseurs qui ont au moins une proposition.' },
      { nom: 'Propositions', description: 'En-tête : le nombre de propositions imprimées.' },
      { nom: 'Montant estime', description: 'En-tête : Σ quantité × prix estimé de toutes les propositions imprimées.', valeurs: 'MAD' },
      { nom: 'Référence', description: 'Le code de la référence et sa désignation.' },
      {
        nom: 'Quantité',
        description: 'La quantité proposée par le moteur de couverture, dans l’unité d’achat quand elle n’est pas le kilo, sinon en kilos.',
      },
      {
        nom: 'Couv. j',
        description:
          'Les jours de couverture que la proposition porte. Les propositions du moteur de couverture n’en portent pas : la colonne affiche « — » ; la date limite de commande se lit à l’écran du plan d’achat.',
        valeurs: 'jours',
      },
      {
        nom: 'Urgence',
        description: 'Déduite de la date limite de commande : TIER 1 (atteinte ou dépassée), TIER 2 (sous 7 jours), TIER 3 (sous 30 jours), TIER 4.',
      },
      { nom: 'Prix MAD/kg', description: 'Le prix estimé au kilo (dernier achat, catalogue converti, ou CMUP).', valeurs: 'MAD/kg' },
      { nom: 'Montant MAD', description: 'Quantité × prix estimé.', valeurs: 'MAD' },
    ],
    regles: [
      'L’état reprend TOUTES les propositions enregistrées, quel que soit leur statut — y compris celles déjà commandées ou écartées : relisez le statut à l’écran avant d’engager.',
      'Les montants sont estimés à partir du dernier prix connu. Ils servent à arbitrer, pas à engager : le prix ferme se fixe au bon de commande.',
    ],
    liens: [{ route: '/plan-achat', libelle: 'Plan d’achat' }],
  },
  {
    route: '/etats/comptage',
    titre: 'Feuille de comptage',
    chemin: 'États imprimables → Stock → Feuille de comptage',
    objectif: 'Imprimer la liste des références avec une colonne VIDE, à remplir à la main dans les allées avant de saisir le comptage.',
    droits: 'Lecture du module Inventaire.',
    procedures: [
      {
        titre: 'Préparer un comptage',
        etapes: [
          'Choisissez le magasin dans « Magasin à compter », ou laissez « à préciser à la main ».',
          'Cliquez « Imprimer ».',
          'Dans les allées, écrivez lot ou emplacement, quantité comptée et observation ; faites signer date, compteur et visa.',
        ],
        resultat: 'Une feuille remplie, à saisir ensuite dans l’inventaire.',
      },
    ],
    champs: [
      {
        nom: 'Magasin à compter',
        description: 'Le magasin inscrit en sous-titre de la feuille. Il ne filtre pas la liste : toutes les références suivies y figurent, par ordre de code.',
        defaut: '— à préciser à la main —',
      },
      { nom: 'Lot / emplacement', description: 'Case vide, à remplir à la main.' },
      { nom: 'Quantité comptee', description: 'Case vide : c’est là qu’on écrit ce qu’on a compté.' },
      { nom: 'Observation', description: 'Case vide pour une remarque.' },
    ],
    regles: [
      'Le stock théorique ne figure pas sur la feuille, même en petit : le comparer avant d’avoir compté fausse le comptage. On le compare après, à l’écran.',
      'Un inventaire imprime aussi sa propre feuille de comptage, depuis l’inventaire lui-même.',
    ],
    liens: [{ route: '/inventaires', libelle: 'Inventaires' }],
  },
  {
    route: '/etats/lots',
    titre: 'États des lots',
    chemin: 'États imprimables → Lots',
    objectif: 'Imprimer, au choix, le stock par lot, les lots dormants, les Restes ou l’écart de poids des bobines par fournisseur.',
    droits: 'Lecture du module Lots. La colonne Valeur MAD n’apparaît qu’à qui voit la valeur des lots.',
    procedures: [
      {
        titre: 'Imprimer un état des lots',
        etapes: [
          'Choisissez l’état dans le sélecteur « État ».',
          'Relisez l’en-tête (nombre de lots, solde, valeur ; ou fournisseurs, bobines pesées et tolérances).',
          'Cliquez « Imprimer ».',
        ],
      },
    ],
    champs: [
      {
        nom: 'État',
        description:
          'Stock par lot : tout lot qui porte du stock, quels que soient sa catégorie et son statut. Lots dormants : sans activité depuis le délai de dormance. Restes : les lots libres de catégorie Restes, à écouler. Écart de poids : le poids pesé d’une bobine face au poids catalogue, par fournisseur.',
        defaut: 'Stock par lot',
      },
      { nom: 'Lot', description: 'Le numéro de lot du fournisseur ; « Sans lot » pour du fil dont le lot est inconnu.' },
      { nom: 'Catégorie', description: 'Projet (compte pour le plan) ou Restes (hors plan d’achat, à écouler).' },
      { nom: 'Statut', description: 'Libre, Bloqué ou Soldé, complété de « dormant » ou « à basculer » quand c’est le cas.' },
      { nom: 'Solde kg', description: 'Le stock du lot.', valeurs: 'kg' },
      { nom: 'Bobines', description: 'Le nombre de bobines du lot (ou pesées, dans l’état des écarts).' },
      { nom: 'Dernière activité', description: 'La date de la dernière entrée, sortie ou constat sur le lot.' },
      { nom: 'Sans activité', description: 'Le nombre de jours depuis la dernière activité.', valeurs: 'jours' },
      { nom: 'Min. pour produire', description: 'Le seuil Projet / Restes du lot : un étage de machine en bobines, ou un poids pour un article sans poids de bobine.' },
      { nom: 'Lignes pesées', description: 'Le nombre de lignes pesées du fournisseur.' },
      { nom: 'Écart moyen', alias: ['Écart mini', 'Écart maxi'], description: 'L’écart de poids par bobine face au catalogue : moyen, plus petit, plus grand.', valeurs: '%' },
      { nom: 'Écart kg', description: 'L’écart de poids cumulé du fournisseur.', valeurs: 'kg' },
      {
        nom: 'Niveau',
        description:
          'Dans la tolérance, Orange ou Rouge, selon les seuils P_LotTolOrangePct et P_LotTolRougePct, écrit en toutes lettres puisque le papier ne porte pas la couleur.',
      },
      { nom: 'Valeur MAD', description: 'La valeur du lot.', valeurs: 'MAD' },
    ],
    liens: [{ route: '/lots', libelle: 'Lots' }],
  },
  {
    route: '/etats/mouvements',
    titre: 'Grand livre des mouvements (imprimé)',
    chemin: 'États imprimables → Mouvements → Grand livre des mouvements',
    objectif: 'Imprimer le registre des derniers mouvements, avec date, numéro, type, référence, quantité, magasin et lot.',
    droits: 'Lecture du module Mouvements.',
    champs: [
      { nom: 'N°', description: 'Le numéro du mouvement.' },
      { nom: 'Type', description: 'Le code du type de mouvement (réception, sortie, transfert, ajustement d’inventaire…).' },
      { nom: 'Quantité kg', description: 'La quantité de la ligne, à 3 décimales.', valeurs: 'kg' },
      { nom: 'Magasin', description: 'Le magasin de la ligne.' },
      { nom: 'Lot', description: 'Le lot fournisseur de la ligne.' },
    ],
    regles: [
      'L’état lit les 1 000 mouvements les plus récents ; la période imprimée en sous-titre va du plus ancien au plus récent d’entre eux.',
      'Le registre est immuable : une correction se fait par un mouvement inverse, jamais en effaçant.',
    ],
    liens: [{ route: '/mouvements', libelle: 'Mouvements' }],
  },
  {
    route: '/etats/catalogue',
    titre: 'Catalogue des références (imprimé)',
    chemin: 'États imprimables → Référentiels → Catalogue des références',
    objectif: 'Imprimer la liste des références actives, avec catégorie, unité, fournisseur, prix et politique de réapprovisionnement.',
    droits: 'Lecture du module Catalogue. La colonne Prix n’apparaît qu’à qui voit le prix catalogue.',
    champs: [
      { nom: 'Unité', description: 'L’unité du catalogue de la référence.' },
      { nom: 'Prix', description: 'Le prix catalogue, dans la devise du fournisseur.' },
      { nom: 'Stock min', description: 'Le stock minimum saisi sur la fiche de la référence.', valeurs: 'kg' },
      { nom: 'Couv. min', description: 'La couverture minimale saisie sur la fiche de la référence.', valeurs: 'mois' },
    ],
    regles: ['Seules les références actives figurent, triées par code.'],
    liens: [{ route: '/catalogue', libelle: 'Références' }],
  },
  {
    route: '/etats/couleur',
    titre: 'Fiche d’une couleur',
    chemin: 'États imprimables → Référentiels → Fiche d’une couleur',
    objectif: 'Imprimer, pour une couleur, ses codes chez chaque fournisseur et les références qui la portent, avec leur stock.',
    droits: 'Lecture du module Catalogue. Le supplément de teinture n’apparaît qu’à qui a le droit de le voir.',
    procedures: [
      {
        titre: 'Imprimer la fiche d’une couleur',
        etapes: ['Choisissez la couleur dans le sélecteur « Couleur » : l’adresse la retient.', 'Cliquez « Imprimer ».'],
      },
    ],
    champs: [
      { nom: 'Couleur', description: 'La couleur interne à imprimer (code — libellé).', obligatoire: true },
      { nom: 'Son code', description: 'Le code de cette couleur chez le fournisseur.' },
      { nom: 'Son libellé', description: 'Le libellé de cette couleur chez le fournisseur.' },
      { nom: 'Supplément /t', description: 'Le supplément de teinture facturé par le fournisseur, par tonne.' },
      { nom: 'Stock kg', description: 'Le stock de chaque référence de la couleur ; le total en pied.', valeurs: 'kg' },
    ],
    regles: ['Sans code fournisseur déclaré, la feuille l’écrit : une facture portant cette couleur ne pourra pas être rapprochée automatiquement.'],
    liens: [{ route: '/couleurs', libelle: 'Couleurs' }],
  },
  {
    route: '/etats/manuel',
    titre: 'Manuel d’utilisation',
    chemin: 'États imprimables → Documentation → Manuel d’utilisation',
    objectif: 'Imprimer la documentation de l’outil : pour chaque écran, son objectif, ses procédures, ses exemples, ses champs, ses règles et ses refus.',
    droits: 'Lecture du module Cockpit.',
    procedures: [
      {
        titre: 'Imprimer un chapitre',
        etapes: ['Choisissez le chapitre dans le sélecteur de l’en-tête, ou laissez « Manuel complet ».', 'Cliquez « Imprimer ».'],
        resultat: 'Une liasse où chaque fiche tient sur une page ou passe à la suivante.',
      },
    ],
    champs: [
      {
        nom: 'Chapitre',
        description: 'La partie du manuel à imprimer. Le sélecteur ne s’imprime pas.',
        valeurs: 'Manuel complet · Catalogue et données de base · Achats · Importation · Réceptions et stock · Analyse · Réglages',
        defaut: 'Manuel complet',
      },
    ],
    regles: ['Le manuel est la même source que l’aide « ? » de chaque écran : corriger une fiche corrige les deux.'],
  },

  /* ======================================================================= */
  /* Télécharger                                                              */
  /* ======================================================================= */
  {
    route: '/telecharger',
    titre: 'Télécharger l’application',
    chemin: 'Paramètres → Télécharger l’application',
    objectif: 'Prendre l’installateur de l’application de bureau, dernière version d’abord, et savoir quel poste a pris quelle version.',
    droits: 'Lecture du module Cockpit pour télécharger (tous les comptes) ; le journal des téléchargements n’est visible qu’avec la lecture du module Paramètres.',
    procedures: [
      {
        titre: 'Installer ou réinstaller un poste',
        etapes: [
          'Repérez la ligne de votre système, marquée « dernière version ».',
          'Cliquez « Télécharger », puis lancez le fichier reçu.',
          'Pour revenir à une version antérieure, dépliez « Versions précédentes ».',
        ],
        resultat: 'L’installateur est sur le poste ; le téléchargement est inscrit au journal.',
      },
    ],
    champs: [
      { nom: 'Telecharge le', description: 'Journal : le moment du téléchargement.' },
      { nom: 'Par', description: 'Journal : le compte qui a téléchargé.' },
      { nom: 'Plateforme', description: 'Journal : le système visé (Windows, Linux…).' },
      { nom: 'Version', description: 'Journal : la version prise.' },
    ],
    regles: [
      'Le bouton est un vrai lien : il s’ouvre dans un onglet, se copie, se colle dans un courriel.',
      'Si l’inscription au journal échoue, le téléchargement part quand même.',
      'Sans paquet publié, l’écran le dit : les installateurs se déposent sur le serveur, nommés avec leur plateforme et leur version.',
    ],
  },

  /* ======================================================================= */
  /* Assistant (chatbot)                                                      */
  /* ======================================================================= */
  {
    route: '/chat',
    titre: 'Assistant',
    chemin: 'Aide → Assistant',
    objectif:
      'Poser une question en langage courant sur le stock, les achats, les fournisseurs : le modèle choisit une compétence, le serveur l’exécute, et la réponse dit d’où vient le chiffre.',
    droits:
      'Lecture du module Cockpit pour discuter ; chaque compétence exige en plus la lecture de son module, et le résultat est masqué selon vos droits. Le choix du moteur revient à l’administrateur.',
    procedures: [
      {
        titre: 'Poser une question',
        etapes: [
          'Tapez la question dans la case du bas (ou cliquez une amorce proposée), puis Entrée ou le bouton d’envoi.',
          'Attendez la réponse : plusieurs dizaines de secondes avec le moteur local, quelques secondes avec Claude.',
          'Lisez, sous la réponse, les compétences employées : survolez-en une pour voir ses arguments.',
          'Posez la question suivante : la conversation garde le fil.',
        ],
        resultat: 'Une réponse chiffrée, dont la source se vérifie.',
      },
      {
        titre: 'Reprendre un brouillon',
        etapes: [
          'Quand la réponse porte « Brouillon — rien n’est enregistré », lisez son résumé.',
          'Cliquez « Relire et valider » : l’écran concerné s’ouvre, pré-rempli.',
          'Relisez et enregistrez vous-même, ou abandonnez.',
        ],
        resultat: 'Rien n’est écrit tant que vous n’avez pas enregistré sur l’écran.',
      },
      {
        titre: 'Voir les compétences, choisir le moteur',
        etapes: [
          'Cliquez « Competences » : la liste de ce que l’assistant sait faire ; celles que votre rôle n’autorise pas sont grisées.',
          'Administrateur : cliquez le bouton du moteur (Local ou Claude) et choisissez un modèle. La bascule vaut dès la question suivante.',
        ],
      },
    ],
    regles: [
      'L’assistant ne produit que des brouillons, jamais d’écriture : l’enregistrement reste un geste humain.',
      'Il n’emploie que ses compétences, et aucune n’ouvre une donnée que votre rôle ne lit pas déjà.',
      'Moteur local : aucune donnée ne sort de l’entreprise. Claude : la question et les chiffres nécessaires partent chez Anthropic.',
      'Si le moteur ne répond pas, ou n’a pas le modèle réglé, un bandeau le dit avant toute question.',
      'Après trois tours sans conclusion, l’assistant le dit plutôt que de tourner en rond.',
    ],
    messages: [
      { message: 'Le choix du moteur de l’assistant revient à l’administrateur.', cause: 'Un compte non administrateur a tenté de changer de modèle.' },
      { message: 'Je n’ai pas su conclure. Reformulez la question, ou ouvrez l’écran concerné.', cause: 'Trois tours de compétences sans réponse finale.' },
      { message: 'Le moteur n’a pas répondu. Vérifiez qu’il est démarré.', cause: 'Le moteur local ou l’API est injoignable.' },
    ],
    liens: [{ route: '/assistant', libelle: 'Questions types (Direction)' }],
  },
  {
    route: '/assistant',
    titre: 'Questions types',
    chemin: 'Aide → Questions types',
    objectif: 'Obtenir, pour une question d’un catalogue fermé, une réponse chiffrée calculée sur les vues de l’ERP et un lien vers l’écran où agir.',
    droits: 'Rôle Direction seulement (et lecture du module Cockpit) : le serveur refuse les autres rôles, l’écran le dit.',
    procedures: [
      {
        titre: 'Poser une question type',
        etapes: [
          'Cliquez une question sous « Ce que je sais répondre », rangée par thème ; ou tapez-la avec un mot du catalogue (rupture, couverture, anomalie, valeur, fournisseur, commander, inventaire), puis « Demander ».',
          'Lisez la réponse et, s’il y en a un, le tableau de détail.',
          'Cliquez « Ouvrir l’écran » pour aller agir.',
        ],
        resultat: 'La réponse et l’écran concerné, sans rien avoir modifié.',
      },
    ],
    regles: [
      'C’est un catalogue fermé : une question inconnue reçoit « Je ne connais pas cette question », jamais une réponse devinée.',
      'Lecture seule : il ne valide rien, ne commande rien, n’écrit rien.',
      'Aucun appel à un service externe : les chiffres viennent des mêmes vues que les écrans.',
    ],
    liens: [{ route: '/chat', libelle: 'Assistant' }],
  },
]
