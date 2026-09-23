/**
 * LE CATALOGUE D'AIDE — une fiche par ecran.
 *
 * Il alimente l'aide contextuelle (le « ? » de chaque ecran) et le manuel
 * imprimable. Voir `types.ts` pour la forme d'une fiche et la raison de cet
 * ordre de sections.
 *
 * UN ECRAN SANS FICHE N'EST PAS UNE ERREUR : le panneau affiche alors ce que
 * l'ecran dit de lui-meme. Mais tout ecran de SAISIE doit avoir son tableau de
 * champs — c'est la que l'aide se gagne.
 */
import type { Sujet } from './types'

export const SUJETS: Sujet[] = [
  /* ======================================================== CATALOGUE ===== */
  {
    route: '/catalogue',
    titre: 'Références',
    chemin: 'Catalogue → Références',
    objectif:
      'Tenir la liste des matières premières : leur code, leur classement, leur fournisseur, leur prix et leurs seuils de réapprovisionnement.',
    prerequis: [
      'La catégorie matière de la référence doit exister (Catalogue → Catégories matière).',
      'Le fournisseur doit être déclaré (Catalogue → Fournisseurs).',
    ],
    droits: 'Lecture du module Catalogue pour consulter ; écriture pour créer ou corriger.',
    procedures: [
      {
        titre: 'Créer une référence',
        etapes: [
          'Cliquez « Nouveau ».',
          'Saisissez le code interne : catégorie, famille, couleur (ou origine), référence du fournisseur, fournisseur.',
          'Choisissez la catégorie, la famille et la couleur interne dans les listes.',
          'Renseignez l’unité du catalogue, le poids d’une bobine et le nombre de bobines par palette.',
          'Posez les seuils : stock minimum, couverture minimale, marge de sécurité.',
          'Enregistrez.',
        ],
        resultat: 'La référence est commandable et apparaît dans le calcul des besoins.',
      },
    ],
    champs: [
      {
        nom: 'Code référence',
        description:
          'L’identifiant interne. Il se lit comme une phrase : catégorie - famille - couleur - réf. fournisseur - fournisseur.',
        obligatoire: true,
        valeurs: 'Ne se modifie plus après création : il est la clé de toutes les références croisées.',
      },
      { nom: 'Désignation', description: 'Le libellé lisible, repris sur les documents imprimés.', obligatoire: true },
      { nom: 'Catégorie', description: 'La matière : polypropylène, polyester, jute, colle…', obligatoire: true },
      {
        nom: 'Famille',
        description: 'Le titrage à l’intérieur de la catégorie — « 1500 dtex », « 3000 Deniers ».',
        valeurs: 'Proposée par l’assistant de complétion.',
      },
      {
        nom: 'Couleur interne',
        description: 'La couleur de la maison. Laissez vide et renseignez l’origine si la référence n’est pas teinte.',
      },
      { nom: 'Origine', description: 'Prend la place de la couleur pour le jute, la colle, le plastique et le cuir.' },
      { nom: 'Référence fournisseur', description: 'Le code que le fournisseur emploie, tel qu’il figure sur sa facture.' },
      {
        nom: 'Unité du catalogue',
        description: 'L’unité dans laquelle on manipule la référence au magasin.',
        valeurs: 'kg, Bobine, Palette, ml',
        defaut: 'kg',
      },
      {
        nom: 'Poids de bobine (kg)',
        description: 'Sert à convertir une saisie en bobines vers des kilos. Le kilo reste l’unité de stock.',
      },
      {
        nom: 'Densité (kg/ml)',
        description: 'Obligatoire pour les références employées dans un rôle compté en mètres linéaires.',
        valeurs: 'kg par mètre linéaire',
      },
      { nom: 'Prix catalogue', description: 'Le tarif du fournisseur, dans SA devise. Ce n’est pas le coût moyen.' },
      {
        nom: 'Stock minimum (kg)',
        description: 'Le plancher sous lequel le calcul d’achat déclenche une proposition.',
      },
      {
        nom: 'MOQ (kg)',
        description: 'Quantité minimale que le fournisseur accepte de livrer. Le plan d’achat l’applique.',
      },
      {
        nom: 'Multiple d’achat (kg)',
        description: 'La quantité se commande par multiples de cette valeur — un conteneur, une palette complète.',
      },
      { nom: 'Suivi de lot', description: 'Quand il est actif, chaque entrée exige un numéro de bain de teinture.' },
    ],
    regles: [
      'Les colonnes de prix n’existent pas pour un rôle qui n’a pas le droit de les voir : ni en-tête, ni cellule, ni donnée envoyée.',
      'Une donnée de base que rien n’utilise se supprime pour de bon. Dès qu’un mouvement, une recette ou une commande la cite, la suppression est refusée et le message nomme ce qui la retient : détachez-le d’abord, ou mettez la ligne à l’état inactif.',
      'Décocher « Actif » ne supprime rien : la référence sort des listes de saisie mais reste lisible dans l’historique. C’est le geste à faire pour une matière qu’on n’achète plus mais qu’on a déjà consommée.',
    ],
    liens: [
      { route: '/catalogue/completer', libelle: 'Compléter les références' },
      { route: '/equivalences', libelle: 'Équivalences' },
      { route: '/categories', libelle: 'Catégories et familles' },
    ],
  },

  {
    route: '/catalogue/completer',
    titre: 'Compléter les références',
    chemin: 'Catalogue → Compléter les références',
    objectif:
      'Remplir la famille, la couleur interne et la référence fournisseur de chaque référence, à partir de ce que son code contient déjà.',
    prerequis: [
      'Les familles doivent exister sous leur catégorie (Catalogue → Catégories matière).',
      'Les couleurs internes doivent exister (Référentiels → Couleurs).',
    ],
    droits: 'Lecture du module Catalogue pour consulter les propositions ; écriture pour les accepter.',
    procedures: [
      {
        titre: 'Accepter les propositions',
        etapes: [
          'Ouvrez l’écran : il affiche ce qu’il a reconnu et sur combien de références.',
          'Lisez le bandeau en tête : il liste les couleurs écrites sur les références que le référentiel ne connaît pas.',
          'Corrigez au besoin une proposition par les listes déroulantes.',
          'Cliquez « Accepter les propositions » pour tout écrire, ou le crochet en bout de ligne pour une seule.',
        ],
        resultat:
          'Les références portent leur classement ; les statistiques par famille et les équivalences deviennent exploitables.',
      },
    ],
    champs: [
      { nom: 'Famille', description: 'Déduite de la catégorie et du titrage. Vide quand plusieurs familles correspondent.' },
      {
        nom: 'Couleur interne',
        description:
          'Déduite du libellé de couleur déjà saisi, puis des codes couleur du fournisseur. Vide quand la couleur est inconnue du référentiel.',
      },
      { nom: 'Réf. fournisseur', description: 'Lue dans le code interne : le groupe qui précède le suffixe du fournisseur.' },
      { nom: 'Origine', description: 'À saisir quand la référence n’a pas de couleur.' },
    ],
    regles: [
      'L’assistant propose, il n’écrit pas : rien ne part tant que vous n’avez pas cliqué.',
      'Une case laissée vide n’efface jamais la valeur existante.',
      'Il refuse de prendre un titrage pour une référence fournisseur : « Plastique-100 » et « Jute 12/1 » restent vides.',
      'Une couleur absente du référentiel n’est jamais devinée : à vous de dire s’il faut la créer ou la rattacher.',
    ],
    liens: [
      { route: '/referentiels?ref=couleurs', libelle: 'Créer une couleur interne' },
      { route: '/categories', libelle: 'Créer une famille' },
    ],
  },

  {
    route: '/categories',
    titre: 'Catégories matière et familles',
    chemin: 'Catalogue → Catégories matière',
    objectif:
      'Tenir les catégories de matière et, pour chacune, ses familles — le titrage sur lequel l’atelier raisonne.',
    droits: 'Écriture du module Catalogue.',
    procedures: [
      {
        titre: 'Ajouter une famille à une catégorie',
        etapes: [
          'Choisissez la catégorie dans la liste de gauche.',
          'Dans la grille de droite, saisissez le code, le libellé et le titrage sur la dernière ligne.',
          'Validez la ligne : elle est enregistrée aussitôt.',
        ],
        resultat: 'La famille est proposée sur la fiche référence et dans l’assistant de complétion.',
      },
    ],
    champs: [
      { nom: 'Code', description: 'L’identifiant de la famille — « FIL-2650-FZ ».', obligatoire: true },
      { nom: 'Libellé', description: 'Le nom lisible — « FIL 2650 dtex FZ ».', obligatoire: true },
      {
        nom: 'Titrage',
        description:
          'La grosseur du fil, avec son unité. C’est par lui que l’assistant rattache une référence à sa famille.',
        valeurs: 'ex. « 2650 dtex », « 3000 Deniers », « 20/2 »',
      },
    ],
    regles: [
      'Une famille appartient toujours à une catégorie : « 2650 dtex FZ » n’a de sens que sous polypropylène.',
      'Une catégorie qui n’avait aucune famille en a reçu une, à son nom : rien ne reste non classé.',
    ],
    liens: [{ route: '/catalogue/completer', libelle: 'Compléter les références' }],
  },

  {
    route: '/referentiels',
    titre: 'Référentiels',
    chemin: 'Référentiels',
    objectif:
      'Tenir les listes de base : catégories et familles, couleurs et codes fournisseur, rôles BOM, magasins, groupes d’équivalence, types et motifs de mouvement, types de frais.',
    droits: 'Écriture du module concerné par l’onglet ouvert.',
    procedures: [
      {
        titre: 'Renseigner les codes couleur d’un fournisseur',
        etapes: [
          'Ouvrez l’onglet « Couleurs » dans la colonne de droite.',
          'Choisissez une couleur de la maison dans la liste de gauche.',
          'Dans la grille de droite, ajoutez une ligne par fournisseur : son code, son libellé, le supplément de teinture.',
        ],
        resultat: 'La couleur est reconnue sur les factures de ce fournisseur, et les équivalences se rapprochent.',
      },
    ],
    champs: [
      { nom: 'Code couleur interne', description: 'Le code de la maison — « C3 » pour le rouge.', obligatoire: true },
      {
        nom: 'Classe de teinture',
        description: 'Le groupe de teinture, qui commande le supplément appliqué par le fournisseur.',
        valeurs: 'Claire, Moyenne, Sombre, Rouge',
      },
      { nom: 'Code chez lui', description: 'Le code que le fournisseur imprime sur sa facture.', obligatoire: true },
      {
        nom: 'Supplément ($/t)',
        description:
          'Le surcoût de la teinte, en DOLLARS PAR TONNE — pas en pourcentage. Un fil à 2,02 $/kg teint à 530 $/t revient à 2,55 $/kg.',
        valeurs: 'dollars par tonne',
      },
    ],
    regles: [
      'Deux référentiels se consultent seulement : les rôles utilisateur et la machine à états. Les rendre modifiables ouvrirait des chemins que le reste du logiciel ne sait pas traiter.',
    ],
  },

  {
    route: '/equivalences',
    titre: 'Équivalences',
    chemin: 'Catalogue → Équivalences',
    objectif:
      'Déclarer que plusieurs références sont interchangeables, pour pouvoir arbitrer un achat ou accepter une livraison de substitution.',
    prerequis: ['Les références à rapprocher doivent exister et avoir la même unité et la même densité.'],
    droits: 'Écriture du module Catalogue.',
    procedures: [
      {
        titre: 'Constituer un groupe',
        etapes: [
          'Créez le groupe et nommez-le par ce qu’il rassemble.',
          'Ajoutez les références à droite.',
          'Ordonnez-les par priorité et désignez la référence préférentielle.',
        ],
        resultat:
          'Le plan d’achat propose l’équivalent disponible, et la réception accepte une substitution déclarée.',
      },
    ],
    regles: [
      'Un groupe MONO-RÉFÉRENCE n’offre aucune alternative : il est signalé.',
      'Un groupe HÉTÉROGÈNE — unités ou densités différentes — fausserait le kg/m² de la recette : il est signalé.',
      'Deux références du MÊME FOURNISSEUR tombent ensemble : ce n’est pas une sécurité d’approvisionnement.',
      'Une seule référence préférentielle par groupe, et une seule priorité par rang.',
    ],
  },

  {
    route: '/couleurs',
    titre: 'Couleurs',
    chemin: 'Catalogue → Couleurs',
    objectif:
      'Tenir le nuancier de la maison, et rattacher à chaque couleur le code que CHAQUE fournisseur lui donne.',
    droits: 'Lecture du module Catalogue pour consulter ; écriture pour créer ou corriger.',
    procedures: [
      {
        titre: 'Déclarer une couleur et ses codes fournisseur',
        etapes: [
          'À gauche, créez la couleur : un code interne court et un libellé — par exemple « C5 — Beige ».',
          'Choisissez sa classe de teinture : elle sert au calcul du supplément et au regroupement des bains.',
          'Sélectionnez la couleur : le volet de droite montre ce que chaque fournisseur appelle cette couleur.',
          'Ajoutez une ligne par fournisseur : choisissez-le dans la liste, puis saisissez SON code et SON libellé.',
        ],
        resultat:
          'Le code fournisseur s’affiche tout seul sur le bon de commande, et la fiche couleur s’imprime avec tous ses équivalents.',
      },
    ],
    champs: [
      {
        nom: 'Code',
        description:
          'L’identifiant interne de la couleur, court et stable — « C5 », « N1 ». Il apparaît dans le code de chaque référence teinte.',
        obligatoire: true,
        valeurs: 'Ne se modifie plus après création : les références le citent.',
      },
      {
        nom: 'Libellé',
        description: 'Le nom lisible — « Beige », « Rouge brique ». C’est lui qui s’imprime sur les documents.',
        obligatoire: true,
      },
      {
        nom: 'Classe de teinture',
        description:
          'Le poids de la teinture sur le coût et sur la conduite du bain. Une couleur sombre ou rouge coûte plus cher à teindre qu’une claire.',
        valeurs: 'Claire · Moyenne · Sombre · Rouge',
      },
      {
        nom: 'Fournisseur',
        description:
          'À qui appartient le code saisi sur cette ligne. Il se CHOISIT dans la liste des fournisseurs actifs — un nom tapé à la main ne se raccrocherait à rien.',
        obligatoire: true,
      },
      {
        nom: 'Code chez lui',
        description:
          'Le code que CE fournisseur emploie pour cette couleur, tel qu’il figure sur sa facture — « RED 7612 ». C’est ce code qui part sur le bon de commande.',
        obligatoire: true,
      },
      { nom: 'Son libellé', description: 'Le nom que le fournisseur donne à la couleur, quand il diffère du nôtre.' },
      {
        nom: 'Supplément ($/t)',
        description:
          'Le surcoût de teinture appliqué par ce fournisseur, par tonne. Il entre dans la valorisation de la référence.',
        valeurs: 'Devise du fournisseur, par tonne',
      },
    ],
    regles: [
      'Une couleur que rien n’utilise se supprime pour de bon. Dès qu’une référence la cite, la suppression est refusée et le message nomme ce qui la retient.',
      'Un même fournisseur peut porter plusieurs codes pour une couleur — deux gammes, deux usines. Ils sont tous conservés.',
      'Le code fournisseur saisi ici est celui que le bon de commande affiche et que la réception reconnaît : c’est le seul point où il se corrige une fois pour toutes.',
    ],
    liens: [
      { route: '/etats/couleurs', libelle: 'Imprimer le nuancier' },
      { route: '/catalogue', libelle: 'Références' },
    ],
  },

  {
    route: '/fournisseurs',
    titre: 'Fournisseurs',
    chemin: 'Catalogue → Fournisseurs',
    objectif:
      'Tenir la fiche de chaque fournisseur : sa devise, ses délais, ses conditions, et la tolérance qu’on lui accorde à la pesée.',
    droits: 'Lecture du module Catalogue pour consulter ; écriture pour créer ou corriger.',
    champs: [
      {
        nom: 'Code',
        description: 'L’identifiant court du fournisseur. Il entre dans le code de chaque référence qu’on lui achète.',
        obligatoire: true,
        valeurs: 'Ne se modifie plus après création.',
      },
      { nom: 'Raison sociale', description: 'Le nom légal, repris sur les bons de commande et les documents d’import.', obligatoire: true },
      {
        nom: 'Devise de facturation',
        description:
          'La devise dans laquelle il facture. Elle commande l’affichage des prix sur le bon de commande et la conversion au débarquement.',
        obligatoire: true,
        defaut: 'USD',
      },
      {
        nom: 'Délai de livraison (jours)',
        description:
          'Le nombre de jours entre la commande et l’arrivée. C’EST LUI QUI TRANSFORME UNE ÉCHÉANCE EN URGENCE dans le plan d’achat : un délai faux déplace toutes les dates de commande.',
        valeurs: 'jours calendaires',
      },
      { nom: 'Délai de paiement (jours)', description: 'Le nombre de jours accordés pour régler la facture.' },
      { nom: 'Conditions de paiement', description: 'La formule convenue — acompte, lettre de crédit, paiement à vue.' },
      {
        nom: 'Incoterm',
        description:
          'Le partage des frais et du risque jusqu’à la livraison — FOB, CIF, EXW. Il commande ce qui entre dans le coût au débarquement.',
      },
      {
        nom: 'Tolérance de pesée (%)',
        description:
          'L’écart admis entre le poids commandé et le poids pesé à la réception. Au-delà, la réception signale l’écart au lieu de le laisser passer.',
        valeurs: 'pourcentage',
      },
      {
        nom: 'Note globale (/100)',
        description: 'L’appréciation de la tenue du fournisseur : délais, conformité, réactivité. Elle sert à l’arbitrage, pas au calcul.',
      },
      {
        nom: 'Actif',
        description:
          'Décocher retire le fournisseur des listes de saisie sans rien effacer : son historique et ses références restent lisibles.',
        defaut: 'coché',
      },
    ],
    regles: [
      'Un fournisseur que rien n’utilise se supprime pour de bon. Dès qu’une référence, un bon ou un dossier d’import le cite, la suppression est refusée et le message nomme ce qui le retient : décochez « Actif » à la place.',
      'Le rattachement d’une référence à un fournisseur est une HABITUDE D’ACHAT, pas une exclusivité : le bon de commande permet de commander chez un autre.',
    ],
    liens: [
      { route: '/catalogue', libelle: 'Références' },
      { route: '/etats/fournisseurs', libelle: 'Imprimer la liste' },
    ],
  },

  {
    route: '/qualites',
    titre: 'Qualités et compositions',
    chemin: 'Production → Qualités',
    objectif:
      'Décrire de quoi chaque qualité de tapis est faite : quelles références, dans quel rôle, à quelle quantité par mètre carré.',
    prerequis: [
      'Les références employées doivent exister au catalogue.',
      'Une référence comptée en mètres linéaires doit porter sa densité (kg/ml), sinon le kg/m² ne se calcule pas.',
    ],
    droits: 'Lecture du module Production pour consulter ; écriture pour modifier une composition.',
    procedures: [
      {
        titre: 'Composer une qualité',
        etapes: [
          'Créez la qualité : son code, son nom, son poids commercial et sa densité.',
          'Ajoutez une ligne par composant : choisissez la référence dans la liste déroulante, puis son rôle BOM.',
          'Saisissez la quantité par mètre carré et le pourcentage de perte.',
          'Vérifiez le coût MAD/m² affiché : c’est la composition qui le produit.',
        ],
        resultat: 'Le plan de production sait traduire des mètres carrés en kilos de matière, référence par référence.',
      },
    ],
    champs: [
      { nom: 'Code', description: 'L’identifiant de la qualité, cité par les plans de production.', obligatoire: true },
      { nom: 'Nom', description: 'Le libellé commercial de la qualité.', obligatoire: true },
      { nom: 'Poids commercial', description: 'Le poids annoncé au client, par mètre carré. Il sert de repère, pas de calcul.', valeurs: 'g/m²' },
      { nom: 'Densité', description: 'La densité de tuftage — nœuds ou points par unité de surface.' },
      {
        nom: 'Référence',
        description: 'Le composant. Il se cherche à la frappe dans la liste déroulante : le catalogue dépasse le millier de lignes.',
        obligatoire: true,
      },
      {
        nom: 'Rôle BOM',
        description:
          'La place du composant dans le tapis — velours, trame, chaîne, latex, envers. C’est lui qui distingue deux lignes portant la même matière.',
        obligatoire: true,
      },
      {
        nom: 'Perte %',
        description:
          'La part de matière perdue à la fabrication. Elle S’AJOUTE à la quantité théorique : 5 % de perte, c’est 5 % de matière à acheter en plus.',
        valeurs: 'pourcentage',
        defaut: '0',
      },
      { nom: 'Coût MAD/m²', description: 'Le coût matière du mètre carré, calculé depuis la composition et les prix. Il ne se saisit pas.' },
      {
        nom: 'Couverture min. (mois)',
        description: 'Le nombre de mois de consommation qu’on veut garder en stock pour cette qualité. Le plan d’achat s’en sert.',
      },
      { nom: 'Marge sécurité %', description: 'Le coussin ajouté au besoin calculé, pour absorber l’aléa de consommation.' },
    ],
    regles: [
      'Une quantité par m² se saisit dans l’unité du composant ; la conversion en kilos passe par la densité de la référence.',
      'Une composition sans ligne ne produit aucun besoin : le plan de production restera muet sur cette qualité.',
    ],
    liens: [
      { route: '/besoins', libelle: 'Besoins (MRP)' },
      { route: '/plans', libelle: 'Plans de production' },
    ],
  },

  /* ====================================================== IMPORTATION ===== */
  {
    route: '/import/assistant',
    titre: 'Assistant d’import',
    chemin: 'Achats → Assistant d’import',
    objectif:
      'Créer un dossier d’importation à partir de la liasse scannée, en gardant le document sous les yeux pendant la saisie.',
    prerequis: [
      'Le scanner doit avoir produit un fichier PDF ou des images sur votre poste.',
      'Le taux de change du jour doit être connu.',
    ],
    droits: 'Écriture du module Import.',
    procedures: [
      {
        titre: 'Créer un dossier depuis un scan',
        etapes: [
          'Glissez le PDF dans la zone de dépôt, ou cliquez « Parcourir ».',
          'Vérifiez la nature proposée pour chaque document et corrigez-la si besoin.',
          'Lisez l’avertissement sur ce qui manque ; vous pouvez continuer et charger le reste plus tard.',
          'Cliquez « Continuer » : le scan s’affiche à droite du formulaire.',
          'Recopiez le connaissement, le conteneur, la date d’arrivée, la devise et le taux de change.',
          'Cliquez « Créer le dossier et déposer les documents ».',
        ],
        resultat:
          'Le dossier existe, porte son numéro de l’année, et ses documents y sont déposés. Vous arrivez sur sa page pour saisir les factures et les frais.',
      },
    ],
    champs: [
      {
        nom: 'Numéro',
        description: 'Laissez vide : l’outil attribue le rang suivant dans l’année.',
        defaut: 'rang suivant, ex. 56/26',
      },
      { nom: 'Connaissement (BL)', description: 'Le numéro du connaissement maritime, tel qu’il figure sur le document.' },
      { nom: 'Conteneurs', description: 'Le ou les numéros de conteneur, séparés par une virgule.' },
      { nom: 'Date d’arrivée', description: 'La date d’arrivée prévue ou constatée au port.' },
      { nom: 'Devise', description: 'La devise des factures du dossier.', defaut: 'USD' },
      {
        nom: 'Taux de change',
        description: 'Le taux appliqué au dossier. C’est lui qui convertit toutes les factures en dirhams.',
        obligatoire: true,
        valeurs: 'nombre décimal, ex. 9,2224',
      },
      { nom: 'Nature du document', description: 'Ce que chaque fichier contient : facture, DUM, quittance, BL, colisage…' },
    ],
    regles: [
      'L’assistant NE LIT PAS les documents : aucune reconnaissance de texte n’est installée.',
      'Les fichiers ne partent qu’à la création du dossier : abandonner en cours de route ne laisse rien derrière soi.',
      'Un fichier nommé « Dossier… » est traité comme une liasse entière et reste « autre document ».',
    ],
    liens: [{ route: '/import', libelle: 'Dossiers d’import' }],
  },

  {
    route: '/import',
    titre: 'Dossiers d’import',
    chemin: 'Achats → Dossiers d’import',
    objectif:
      'Suivre les importations : de quels fournisseurs, pour quelle valeur, avec quels frais, et où en est la réception.',
    droits: 'Lecture du module Import.',
    procedures: [
      {
        titre: 'Traiter un dossier de bout en bout',
        etapes: [
          'Créez le dossier, par l’assistant si vous avez un scan.',
          'Saisissez chaque facture fournisseur et ses lignes.',
          'Saisissez les frais globaux et leur clé de répartition.',
          'Déposez les pièces justificatives.',
          'Recevez la marchandise depuis Réceptions import.',
          'Clôturez le dossier quand tout est reçu.',
        ],
        resultat: 'Le coût de revient est figé et le coût moyen de chaque référence est ajusté.',
      },
    ],
    liens: [
      { route: '/import/assistant', libelle: 'Assistant d’import' },
      { route: '/receptions-import', libelle: 'Réceptions import' },
    ],
  },

  {
    route: '/receptions-import',
    titre: 'Réceptions import',
    chemin: 'Achats → Réceptions import',
    objectif: 'Faire entrer en stock la marchandise importée, en pesant ce que le camion apporte.',
    prerequis: ['Les factures du dossier doivent être saisies : ce sont leurs lignes qu’on reçoit.'],
    droits: 'Écriture du module Réceptions pour préparer ; validation pour faire entrer en stock.',
    procedures: [
      {
        titre: 'Recevoir un camion',
        etapes: [
          'Créez une réception et datez-la.',
          'Dans la liste des lignes à recevoir — tous dossiers non clos — cochez ce que le camion apporte.',
          'Saisissez le poids réellement pesé, le nombre de bobines et de palettes, et le magasin.',
          'Enregistrez : la réception reste un brouillon, rien n’entre en stock.',
          'Faites valider : la marchandise entre en stock à la valeur facture.',
        ],
        resultat: 'Le stock monte, le mouvement d’entrée cite les dossiers concernés, et les lignes de facture sont soldées.',
      },
    ],
    champs: [
      { nom: 'Date de réception', description: 'La date du déchargement.', obligatoire: true },
      { nom: 'Quantité reçue (kg)', description: 'Le poids RÉELLEMENT pesé, pas le poids facturé.', obligatoire: true },
      { nom: 'Magasin', description: 'Le magasin où la marchandise est rangée.', obligatoire: true },
      { nom: 'Litige', description: 'À cocher quand la livraison présente un écart ou un dommage à documenter.' },
    ],
    regles: [
      'Une réception est un document À PART : ses lignes peuvent venir de plusieurs dossiers.',
      'Enregistrer garde un brouillon ; VALIDER fait entrer en stock et fige la réception.',
      'Une ligne d’un dossier clôturé ne se reçoit plus.',
    ],
    messages: [
      {
        message: 'Le dossier … est clôturé : il ne reçoit plus rien.',
        cause: 'La clôture a fixé le coût moyen. Une entrée après coup fausserait les sorties déjà valorisées.',
      },
    ],
    liens: [{ route: '/import', libelle: 'Dossiers d’import' }],
  },

  /* =========================================================== ACHATS ===== */
  {
    route: '/plan-achat',
    titre: 'Plan d’achat',
    chemin: 'Production → Plan d’achat',
    objectif: 'Arbitrer les propositions d’achat issues du calcul des besoins, et les convertir en bons de commande.',
    prerequis: [
      'Un plan de production en service.',
      'Des qualités dont la composition est renseignée.',
      'Des délais fournisseur à jour : c’est ce qui transforme une échéance en urgence.',
    ],
    droits: 'Lecture du module Plan d’achat ; écriture pour arbitrer ; validation pour convertir.',
    procedures: [
      {
        titre: 'Arbitrer et commander',
        etapes: [
          'Régénérez le plan pour reprendre la photo du jour.',
          'Parcourez les propositions, de la plus urgente à la moins urgente.',
          'Corrigez une quantité, écartez ce qui n’est pas à commander, ou basculez le besoin sur un équivalent disponible en indiquant un motif.',
          'Sélectionnez les propositions à commander et convertissez-les en bon.',
        ],
        resultat: 'Un bon de commande par fournisseur, et les propositions converties conservent leur trace.',
      },
    ],
    regles: [
      'Régénérer efface les propositions qui n’engagent rien ; celles qui ont produit un bon et celles qu’on a écartées survivent.',
      'La quantité proposée tient compte du stock minimum, du MOQ, du multiple d’achat et de ce qui est déjà en route.',
      'Le calcul ne MUTUALISE PAS les équivalents : l’équivalent disponible est affiché, mais la bascule reste un geste explicite et tracé.',
    ],
    liens: [
      { route: '/besoins', libelle: 'Besoins (MRP)' },
      { route: '/bons-commande', libelle: 'Bons de commande' },
    ],
  },

  {
    route: '/besoins',
    titre: 'Besoins (MRP)',
    chemin: 'Production → Besoins',
    objectif:
      'Voir ce que les plans de production réclament en matière, référence par référence, avant tout arbitrage d’achat.',
    prerequis: [
      'Un plan de production en service.',
      'Des qualités dont la composition est renseignée : une qualité sans composition ne produit aucun besoin.',
    ],
    droits: 'Lecture du module Production.',
    champs: [
      { nom: 'Code Ref', description: 'La référence réclamée par les compositions.' },
      { nom: 'Designation', description: 'Son libellé, repris du catalogue.' },
      { nom: 'Catégorie', description: 'Le filtre par matière : polypropylène, polyester, jute…' },
      {
        nom: 'Fournisseur',
        description:
          'Le fournisseur habituel de la référence. Le filtre sert à préparer une commande, pas à interdire d’acheter ailleurs.',
      },
      {
        nom: 'Total kg',
        description:
          'Le besoin brut de la période : la somme des mètres carrés planifiés, traduite en kilos par la composition, perte comprise.',
        valeurs: 'kg',
      },
      { nom: 'Unité', description: 'L’unité du catalogue pour cette référence. Le besoin reste exprimé en kilos.' },
    ],
    regles: [
      'CE N’EST PAS UNE PROPOSITION D’ACHAT : le besoin brut ne retire ni le stock, ni ce qui est déjà commandé. C’est le plan d’achat qui fait cette soustraction.',
      'Un besoin nul sur une référence attendue signale presque toujours une composition incomplète, pas une absence de besoin.',
    ],
    liens: [
      { route: '/plan-achat', libelle: 'Plan d’achat' },
      { route: '/qualites', libelle: 'Qualités et compositions' },
      { route: '/plans', libelle: 'Plans de production' },
    ],
  },

  {
    route: '/bons-commande',
    titre: 'Bons de commande',
    chemin: 'Achats → Bons de commande',
    objectif: 'Suivre la vie de chaque commande, de sa création jusqu’à son solde par les réceptions.',
    droits: 'Lecture du module Achats ; écriture pour créer ou corriger ; validation pour envoyer.',
    procedures: [
      {
        titre: 'Suivre une commande',
        etapes: [
          'Ouvrez le bon pour voir ses lignes et ce qu’il reste à recevoir sur chacune.',
          'Corrigez tant qu’il est en brouillon ; une fois envoyé, il engage.',
          'Imprimez-le pour l’adresser au fournisseur.',
          'Les réceptions le soldent ligne par ligne : le reste à recevoir descend à mesure.',
        ],
      },
    ],
    regles: [
      'Un bon se solde quand TOUTES ses lignes de marchandise sont servies. Les lignes de service et les lignes sans référence n’entrent pas dans ce décompte : elles ne se réceptionnent pas.',
      'Un bon cité par une réception ne se supprime pas : la suppression est refusée et le message nomme ce qui le retient.',
    ],
    liens: [
      { route: '/bons-commande/nouveau', libelle: 'Nouveau bon de commande' },
      { route: '/receptions', libelle: 'Réceptions' },
      { route: '/plan-achat', libelle: 'Plan d’achat' },
    ],
  },

  {
    route: '/bons-commande/nouveau',
    titre: 'Nouveau bon de commande',
    chemin: 'Achats → Bons de commande → Nouveau',
    objectif:
      'Composer une commande chez un fournisseur : ce que le plan d’achat réclame, ce qu’on y ajoute du catalogue, et ce qui n’a pas encore de référence.',
    prerequis: ['Le fournisseur doit être déclaré et actif.'],
    droits: 'Écriture du module Achats.',
    procedures: [
      {
        titre: 'Saisir une commande',
        etapes: [
          'Choisissez le fournisseur : la devise et les prix en dépendent.',
          'Posez la date du bon et, si elle est connue, la livraison prévue.',
          'La grille s’ouvre VIDE, sur une seule ligne : rien n’est pré-rempli à votre place.',
          'Dans la cellule « Notre référence », tapez : la liste déroulante filtre à la frappe.',
          'L’interrupteur en haut de la carte décide de ce qu’elle propose — « Du plan d’achat » ou « Tout le catalogue ».',
          'Saisissez la quantité, puis au choix les palettes et les bobines : les trois se répondent.',
          'Corrigez au besoin la référence fournisseur, la couleur ou le code couleur : la correction remonte dans le catalogue.',
          '« Ajouter une ligne » pour l’article suivant. Enregistrez quand le bon est complet.',
        ],
        resultat: 'Le bon est créé en brouillon, ses lignes de marchandise attendues par les réceptions.',
      },
      {
        titre: 'Commander ce qui n’a pas de référence',
        etapes: [
          'Tapez ce que vous cherchez dans la cellule « Notre référence ».',
          'Si rien ne correspond, la liste propose trois issues.',
          '« Chercher dans tout le catalogue » : la référence existe peut-être hors du plan de ce fournisseur.',
          '« Ajouter au catalogue » : pour un article qu’on rachètera — la fiche complète se saisit à l’écran Catalogue, puis la référence est trouvée à la frappe.',
          '« Garder « … » sans référence » : pour un échantillon, un type nouveau, du transport. La ligne porte alors un libellé libre et un montant.',
        ],
        resultat:
          'La commande accepte tout ce qui s’achète, sans forcer à créer une référence pour un échantillon qu’on ne rachètera pas.',
      },
    ],
    champs: [
      {
        nom: 'Fournisseur',
        description:
          'Chez qui l’on commande. LE CHANGER REMET LA SAISIE À ZÉRO : la devise, les prix et les propositions du plan en dépendent tous.',
        obligatoire: true,
      },
      { nom: 'Date du bon', description: 'La date d’émission de la commande.', obligatoire: true, defaut: 'aujourd’hui' },
      {
        nom: 'Livraison prévue',
        description:
          'La date d’arrivée attendue. Elle sert au suivi de l’en-cours : une ligne en retard se voit à cette date, pas à celle du bon.',
      },
      { nom: 'Observations', description: 'Une note libre, reprise sur le bon imprimé adressé au fournisseur.' },
      {
        nom: 'Motif',
        description: 'Pourquoi cette commande existe. Il sert à l’analyse des achats, jamais au calcul.',
        valeurs:
          'Issu du MRP — le plan la réclamait · Manuel — décidée hors plan · Opportunité de prix — un tarif à saisir · Anticipation de risque — une rupture qu’on devance',
        defaut: 'Issu du MRP',
      },
      {
        nom: 'Du plan d’achat / Tout le catalogue',
        description:
          'L’interrupteur qui décide de ce que la liste déroulante propose. « Du plan d’achat » ne montre que ce que le calcul réclame chez CE fournisseur ; « Tout le catalogue » ouvre à tout, parce que le rattachement d’une référence à un fournisseur est une habitude d’achat, pas une exclusivité.',
        defaut: 'Du plan d’achat',
      },
      {
        nom: 'Notre référence',
        description:
          'Le code interne de l’article. IL SE CHERCHE À LA FRAPPE, dans la cellule même : le catalogue dépasse le millier de lignes, une liste à dérouler ne s’y lit plus. Deux caractères suffisent à filtrer.',
        obligatoire: true,
        valeurs: 'Ou bien un libellé libre, pour une ligne qui ne porte aucune référence.',
      },
      {
        nom: 'Quantité',
        description:
          'Ce qu’on commande, dans l’unité de la ligne. Sur une référence issue du plan, l’écart avec la quantité proposée est signalé — sans être interdit.',
        obligatoire: true,
      },
      {
        nom: 'Réf. frs',
        description:
          'Le code que le fournisseur emploie, tel qu’il figure sur sa facture. Modifiable ici : la correction REMONTE DANS LE CATALOGUE, pour ne pas avoir à la refaire au bon suivant.',
      },
      { nom: 'Couleur', description: 'La couleur de la maison. Se corrige ici et remonte au catalogue, comme la réf. fournisseur.' },
      {
        nom: 'Code coul. frs',
        description:
          'Le code que CE fournisseur donne à cette couleur. C’est lui qui part sur le bon imprimé — c’est le code que le fournisseur reconnaît.',
      },
      {
        nom: 'Unité',
        description:
          'L’unité dans laquelle la ligne est commandée : kg, bobine, palette, ml. Le stock reste tenu en kilos ; la conversion se fait ici.',
        defaut: 'l’unité du catalogue de la référence',
      },
      {
        nom: 'Pal. / Bob.',
        description:
          'Le nombre de palettes et de bobines. LES TROIS CHAMPS SE RÉPONDENT : saisir des palettes remplit les bobines et les kilos, saisir des kilos remplit les deux autres. On saisit dans l’unité où l’on compte, sans calculer de tête.',
        valeurs: 'Il faut pour cela que la référence porte son poids de bobine et ses bobines par palette.',
      },
      {
        nom: 'Prix',
        description:
          'Le prix unitaire, DANS LA DEVISE DU FOURNISSEUR — l’en-tête de la colonne la rappelle. Il est proposé depuis le catalogue et reste corrigible : c’est le prix négocié qui fait foi.',
      },
      { nom: 'Total', description: 'Quantité multipliée par le prix. Il ne se saisit pas.' },
    ],
    regles: [
      'LA GRILLE S’OUVRE VIDE. Pré-remplir vingt lignes obligerait à en effacer dix-huit ; c’est la liste déroulante qui apporte ce dont on a besoin.',
      'Une ligne SANS RÉFÉRENCE n’est pas d’une nature spéciale : c’est une ligne qui ne porte pas de référence existante. Elle porte un libellé et un montant.',
      'Une ligne sans référence NE SE RÉCEPTIONNE PAS et n’entre jamais en stock : un échantillon ou du transport n’a pas de poids à peser. Elle ne compte pas non plus dans le solde du bon.',
      'Une ligne sans référence n’entre ni dans le calcul des besoins, ni dans les statistiques d’achat par référence : elle n’a rien à quoi se rattacher.',
      'La conversion palettes / bobines / kilos exige que la référence porte son conditionnement. Sans lui, l’enregistrement est refusé et le message nomme les références à compléter.',
      'Le prix n’est JAMAIS déduit ni deviné : une valeur inventée fausserait le coût de revient sans laisser de trace.',
    ],
    messages: [
      {
        message: 'Conversion impossible sur … : renseignez le conditionnement',
        cause:
          'La ligne est saisie en palettes ou en bobines, mais la référence ne porte pas son poids de bobine ou ses bobines par palette. Complétez-la au catalogue, ou saisissez la ligne en kilos.',
      },
      {
        message: 'Choisissez un fournisseur',
        cause: 'Tant qu’il n’est pas choisi, ni la devise ni les propositions du plan ne sont connues : la grille reste fermée.',
      },
    ],
    liens: [
      { route: '/plan-achat', libelle: 'Plan d’achat' },
      { route: '/catalogue', libelle: 'Références' },
      { route: '/catalogue/completer', libelle: 'Compléter les références' },
      { route: '/receptions', libelle: 'Réceptions' },
    ],
  },

  {
    route: '/receptions',
    titre: 'Réceptions',
    chemin: 'Achats → Réceptions',
    objectif: 'Peser et enregistrer ce qui arrive au quai, puis le faire contrôler avant l’entrée en stock.',
    prerequis: ['Un bon de commande envoyé, sauf arrivage sans commande.'],
    droits: 'Écriture du module Réceptions pour peser ; validation pour le contrôle qualité.',
    procedures: [
      {
        titre: 'Réceptionner une livraison',
        etapes: [
          'Créez une réception et appelez le bon de commande : ses lignes restant à livrer s’ajoutent à la grille.',
          'Appelez un second bon si le camion en porte deux : les lignes s’ajoutent sans effacer les premières.',
          'Décochez « retenue » pour ce qui n’est pas descendu du camion.',
          'Saisissez le poids pesé, les colis, le lot si la référence est suivie.',
          'Enregistrez, puis faites valider par le contrôle qualité.',
        ],
        resultat:
          'Le stock monte, le coût moyen est recalculé, le prix entre dans l’historique et la ligne de commande est soldée.',
      },
    ],
    champs: [
      { nom: 'Quantité pesée', description: 'Le poids réel. C’est lui qui fait foi, pas la quantité commandée.', obligatoire: true },
      { nom: 'Lot fournisseur', description: 'Le numéro de bain de teinture, obligatoire pour les références suivies au lot.' },
      { nom: 'Retenue', description: 'Décochez pour ce qui n’est pas arrivé : la ligne reste visible, mais n’entre pas.' },
      { nom: 'Magasin de destination', description: 'Où la marchandise est rangée.', obligatoire: true },
    ],
    regles: [
      'La saisie propose ce qui est ATTENDU : sans cette liste, on réceptionne la mauvaise couleur.',
      'Un arrivage SANS COMMANDE se saisit ici : le serveur crée le bon manquant en brouillon, et la réception ne se validera qu’une fois ce bon régularisé.',
      'Peser et valider sont deux gestes, et deux rôles : la validation déclenche la cascade stock, coût moyen, archive, historique.',
    ],
  },

  /* ============================================================ STOCK ===== */
  {
    route: '/mouvements',
    titre: 'Mouvements',
    chemin: 'Stock → Mouvements',
    objectif: 'Enregistrer une entrée, une sortie ou un transfert, et consulter le grand livre des mouvements.',
    droits: 'Écriture du module Mouvements.',
    procedures: [
      {
        titre: 'Saisir une sortie pour la production',
        etapes: [
          'Choisissez le type de mouvement et le motif.',
          'Indiquez le magasin et, si le motif l’exige, le numéro d’ordre de fabrication.',
          'Saisissez la référence et la quantité dans l’unité de manutention.',
          'Vérifiez la conversion en kilos affichée avant de valider.',
          'Nommez le responsable — celui qui prend la marchandise, pas vous.',
          'Enregistrez, puis imprimez le bon pour le faire contresigner.',
        ],
        resultat: 'Le stock baisse et le mouvement entre au grand livre, où il devient immuable.',
      },
    ],
    champs: [
      { nom: 'Type de mouvement', description: 'Il porte le sens : entrée ou sortie. Ce n’est pas au signe de la quantité de le dire.', obligatoire: true },
      { nom: 'Motif', description: 'La raison du mouvement. Certains motifs exigent un numéro d’ordre de fabrication.', obligatoire: true },
      { nom: 'Date du mouvement', description: 'La date du FAIT. Elle peut être dans le passé, jamais dans le futur.', obligatoire: true },
      {
        nom: 'Quantité',
        description: 'Saisie dans l’unité de manutention ; la conversion en kilos s’affiche avant validation.',
        obligatoire: true,
        valeurs: 'kg, Bobine, Palette, ml',
      },
      {
        nom: 'Responsable',
        description:
          'La personne qui remet ou reçoit physiquement la marchandise. À ne pas confondre avec le compte qui saisit.',
      },
    ],
    regles: [
      'Un mouvement validé est IMMUABLE : on le compense par un autre mouvement, on ne le corrige pas.',
      'Le stock ne peut pas devenir négatif.',
      'Le bon imprimé porte deux responsables et deux dates ; l’écart entre la date du fait et celle de la saisie est imprimé.',
    ],
    messages: [
      {
        message: 'Le stock ne peut pas devenir négatif.',
        cause: 'Sortir plus que ce qui est là cache toujours autre chose : une entrée oubliée, ou une référence confondue.',
      },
    ],
  },

  {
    route: '/inventaires',
    titre: 'Inventaires',
    chemin: 'Stock → Inventaires',
    objectif: 'Compter physiquement le stock, comparer au théorique, et ajuster l’écart.',
    droits: 'Écriture du module Inventaire ; validation pour passer l’ajustement.',
    procedures: [
      {
        titre: 'Mener un inventaire',
        etapes: [
          'Ouvrez un inventaire sur un magasin et, si besoin, sur une sélection de références.',
          'Imprimez la feuille de comptage depuis le centre des états.',
          'Saisissez les quantités comptées directement dans le tableau — une allée entière avant de valider.',
          'Relisez les écarts et leur pourcentage, qui se recalculent à la frappe.',
          'Validez : l’écart passe en mouvement d’ajustement.',
        ],
        resultat: 'Le stock théorique rejoint le stock réel, et l’ajustement laisse une trace au grand livre.',
      },
    ],
    champs: [
      { nom: 'Quantité comptée', description: 'Ce qui a été physiquement compté.', obligatoire: true },
      { nom: 'Lot', description: 'Pour les références suivies au lot, on compte par numéro de bain.' },
      { nom: 'Justification', description: 'La raison de l’écart. Exigée au-delà du seuil paramétré.' },
    ],
    regles: ['Les références sous suivi de lot se comptent AU LOT, pas en total abstrait.'],
  },

  {
    route: '/transferts',
    titre: 'Transferts entre magasins',
    chemin: 'Stock → Transferts',
    objectif:
      'Déplacer de la matière d’un magasin à un autre, et imprimer le bon de sortie et le bon de réception qui accompagnent le camion.',
    droits: 'Écriture du module Stock ; validation pour confirmer l’arrivée.',
    regles: [
      'Un transfert ne crée ni ne détruit de matière : il sort d’un magasin exactement ce qu’il entre dans l’autre.',
      'Le bon de sortie part avec le camion, le bon de réception revient signé : ce sont les deux moitiés d’un même mouvement.',
    ],
    liens: [
      { route: '/transferts/nouveau', libelle: 'Nouveau transfert' },
      { route: '/stock', libelle: 'Stock par magasin' },
    ],
  },

  {
    route: '/transferts/nouveau',
    titre: 'Nouveau transfert',
    chemin: 'Stock → Transferts → Nouveau',
    objectif: 'Préparer le départ d’une matière d’un magasin vers un autre, en palettes, en bobines ou en kilos.',
    prerequis: ['Les deux magasins doivent exister.', 'La matière doit être présente dans le magasin source.'],
    droits: 'Écriture du module Stock.',
    procedures: [
      {
        titre: 'Préparer un transfert',
        etapes: [
          'Choisissez le magasin source : c’est son stock qui alimente la liste des références.',
          'Choisissez le magasin destinataire — il doit être différent du premier.',
          'Ajoutez une ligne et cherchez la référence à la frappe dans la liste déroulante.',
          'Saisissez la quantité en palettes, en bobines ou en kilos : les trois se répondent.',
          'Vérifiez le disponible affiché en regard : il vient du magasin source, pas du stock global.',
          'Enregistrez, puis imprimez le bon de sortie.',
        ],
        resultat: 'Le transfert est enregistré, et ses deux bons sont imprimables.',
      },
    ],
    champs: [
      {
        nom: 'Magasin source',
        description:
          'D’où la matière part. LE CHANGER RECHARGE LA LISTE DES RÉFÉRENCES : on ne transfère que ce qui est réellement là.',
        obligatoire: true,
      },
      {
        nom: 'Magasin destinataire',
        description: 'Où elle va. Il doit différer du magasin source.',
        obligatoire: true,
      },
      { nom: 'Date du document', description: 'La date du départ.', obligatoire: true, defaut: 'aujourd’hui' },
      { nom: 'Responsable', description: 'Qui répond du transfert. Le nom s’imprime sur les deux bons.' },
      { nom: 'Transporteur', description: 'Qui emporte la marchandise, quand ce n’est pas un véhicule de la maison.' },
      { nom: 'Observations', description: 'Une note libre, reprise sur les bons imprimés.' },
      {
        nom: 'Référence',
        description: 'Ce qu’on déplace. La liste ne propose QUE ce que le magasin source détient, cherché à la frappe.',
        obligatoire: true,
      },
      {
        nom: 'Dispo',
        description:
          'Ce que le magasin SOURCE détient de cette référence, au moment de la saisie. Ce n’est pas le stock de la maison : transférer plus que ce chiffre mettrait le magasin source en négatif.',
        valeurs: 'kg',
      },
      {
        nom: 'Palettes / Bobines / En kg',
        description:
          'La quantité, saisie dans l’unité où l’on compte. LES TROIS SE RÉPONDENT : remplir l’une remplit les deux autres. Le stock reste tenu en kilos — c’est la conversion qui s’adapte, pas le magasinier.',
        obligatoire: true,
        valeurs: 'Il faut pour cela que la référence porte son poids de bobine et ses bobines par palette.',
      },
      {
        nom: 'Lot fournisseur',
        description: 'Le numéro de bain. Obligatoire pour une référence suivie au lot : le lot voyage avec la matière.',
      },
    ],
    regles: [
      'La conversion ne DEVINE JAMAIS un facteur manquant. Si la référence ne porte pas son conditionnement, la ligne refuse la saisie en palettes ou en bobines au lieu de convertir avec un facteur nul — ce qui produirait un transfert de zéro kilo sans le dire.',
      'Le disponible affiché est celui du MAGASIN SOURCE seul. Sommer les magasins ferait croire à une matière présente ailleurs.',
      'Une référence suivie au lot se transfère lot par lot : c’est la traçabilité du bain qui l’exige.',
    ],
    liens: [
      { route: '/stock', libelle: 'Stock par magasin' },
      { route: '/mouvements', libelle: 'Mouvements' },
    ],
  },

  {
    route: '/stock',
    titre: 'Stock et couverture',
    chemin: 'Stock → Situation',
    objectif:
      'Voir, référence par référence, ce qu’on détient, ce qui est en route, ce qui reste à consommer, et depuis quand.',
    droits: 'Lecture du module Stock. Les colonnes de coût n’apparaissent pas pour un rôle qui n’a pas le droit de les voir.',
    champs: [
      { nom: 'Physique (kg)', description: 'Ce qui est réellement dans les magasins, toutes entrées validées.', valeurs: 'kg' },
      {
        nom: 'En-cours (kg)',
        description: 'Ce qui est commandé et pas encore reçu : le reste à livrer des bons de commande envoyés.',
        valeurs: 'kg',
      },
      {
        nom: 'Projeté (kg)',
        description:
          'Le physique plus l’en-cours, moins ce que les plans réclament sur l’horizon. C’EST CE CHIFFRE QUI DIT S’IL FAUT COMMANDER, pas le physique.',
        valeurs: 'kg',
      },
      { nom: 'Minimum (kg)', description: 'Le plancher fixé sur la fiche référence. Le plan d’achat déclenche en dessous.' },
      { nom: 'Besoin horizon', description: 'Ce que les plans de production réclament sur la période regardée.' },
      { nom: 'Conso / mois', description: 'La consommation moyenne constatée, qui sert à calculer la couverture.' },
      {
        nom: 'Couverture',
        description:
          'Combien de mois le stock tient au rythme actuel. Une couverture courte sur un délai long est le vrai signal d’alerte — pas le stock en kilos.',
        valeurs: 'mois',
      },
      { nom: 'Délai (j)', description: 'Le délai du fournisseur. À lire avec la couverture : c’est leur écart qui fait l’urgence.' },
      { nom: 'CMUP', description: 'Le coût moyen unitaire pondéré, recalculé à chaque entrée validée. Ce n’est pas le prix catalogue.' },
      {
        nom: 'Classe ABC',
        description: 'Le poids de la référence dans la valeur consommée : A pèse lourd, C est marginal. Elle oriente l’effort de suivi.',
      },
      {
        nom: 'Statut',
        description: 'La lecture rapide de la situation.',
        valeurs: 'Rupture · Critique · Attention · Situation normale · Sur-stock',
      },
      { nom: 'Dernière sortie', description: 'Quand la référence a bougé pour la dernière fois. Une date ancienne signale un dormant.' },
    ],
    regles: [
      'Le filtre par magasin porte sur le STOCK DE CE MAGASIN. Sans lui, les magasins sont sommés — utile pour la maison, trompeur pour un transfert.',
      'Un rôle sans droit sur le coût ne voit ni la colonne CMUP ni sa donnée : elle n’est pas grisée, elle n’est pas envoyée.',
    ],
    liens: [
      { route: '/etat-stock', libelle: 'État du stock imprimable' },
      { route: '/mouvements', libelle: 'Mouvements' },
      { route: '/valorisation', libelle: 'Valorisation' },
    ],
  },

  /* ========================================================== ANALYSE ===== */
  {
    route: '/statistiques',
    titre: 'Statistiques',
    chemin: 'Général → Statistiques',
    objectif:
      'Lire les flux, les prix, les fournisseurs, les qualités — et les familles, dans la forme des classeurs.',
    droits:
      'Chaque volet est lu sous son propre module. Un volet dont le module vous est fermé n’apparaît pas.',
    procedures: [
      {
        titre: 'Lire le tableau par famille',
        etapes: [
          'Ouvrez le volet « Familles » dans la colonne de gauche.',
          'Choisissez l’année dans le sélecteur, en haut du tableau.',
          'Lisez la matrice : les familles en lignes, les couleurs en colonnes, les kilos entrés dans les cases.',
          'Descendez au tableau « Ce que chaque famille pèse » pour le stock, la valeur et le prix moyen payé.',
        ],
      },
    ],
    regles: [
      'Les chiffres sont calculés à la lecture, sur les données du jour : rien n’est figé ni recopié.',
      'Les références sans famille sont comptées sous « Sans famille » : les écarter donnerait un total faux.',
      'Le prix moyen est celui PAYÉ à l’entrée, pas un tarif fournisseur.',
    ],
    liens: [{ route: '/catalogue/completer', libelle: 'Classer les références sans famille' }],
  },

  {
    route: '/',
    titre: 'Tableau de bord',
    chemin: 'Général → Tableau de bord',
    objectif:
      'Répondre à deux questions en arrivant : qu’est-ce qui m’attend, et est-ce que je tiens le plan ?',
    droits: 'Lecture du module Cockpit. Chaque tuile suit en plus le droit d’agir sur son module.',
    regles: [
      'Une tuile n’apparaît que si vous pouvez VOIR le champ ET AGIR dessus : afficher « 3 bons à valider » à qui ne peut pas valider n’est pas une information.',
      'Une file vide disparaît : un écran couvert de zéros apprend à ne plus être lu.',
      'Le mur de risques trie par le temps qui reste RÉELLEMENT — échéance moins délai fournisseur.',
    ],
  },

  {
    route: '/valorisation',
    titre: 'Valorisation du stock',
    chemin: 'Analyse → Valorisation',
    objectif: 'Chiffrer ce que vaut le stock à une date, dans une devise unique et selon une méthode explicite.',
    prerequis: ['Des mouvements validés : c’est eux qui portent les coûts.', 'Un taux de change à la date demandée.'],
    droits: 'Lecture du module Analyse ET droit de voir les coûts : sans lui, l’écran n’a rien à montrer.',
    champs: [
      {
        nom: 'Date de valorisation',
        description:
          'La date à laquelle on se place. Le stock et les coûts sont reconstitués À CETTE DATE, pas à aujourd’hui : c’est ce qui permet de justifier un arrêté passé.',
        obligatoire: true,
      },
      {
        nom: 'Méthode',
        description:
          'La convention de coût retenue. Elle change le chiffre, pas la quantité — deux méthodes sur le même stock donnent deux valeurs justes.',
      },
      {
        nom: 'Devise pivot',
        description:
          'La devise dans laquelle tout est ramené. Les achats se font en plusieurs devises ; additionner sans pivot ne veut rien dire.',
        obligatoire: true,
      },
      { nom: 'Assiette', description: 'Ce qui entre dans le calcul : quels magasins, quelles catégories.' },
      { nom: 'Stock (kg)', description: 'La quantité retenue à la date, référence par référence.' },
      { nom: 'Formule', description: 'Le détail du calcul appliqué à la ligne. Il est affiché pour que le chiffre soit vérifiable.' },
    ],
    regles: [
      'La valorisation ne modifie rien : c’est une lecture, jamais une écriture. On peut la rejouer autant de fois qu’on veut.',
      'Un taux de change manquant à la date demandée arrête le calcul au lieu de prendre le dernier connu : une valeur fausse est pire qu’une valeur absente.',
    ],
    liens: [
      { route: '/stock', libelle: 'Stock et couverture' },
      { route: '/landed-cost', libelle: 'Coût au débarquement' },
    ],
  },

  {
    route: '/etats',
    titre: 'États imprimables',
    chemin: 'Analyse → États',
    objectif:
      'Sortir sur papier ce qui doit circuler hors de l’écran : listes de référence, bons, comptages, nuanciers.',
    droits: 'Lecture du module dont l’état relève. Un état n’imprime jamais un champ que le rôle n’a pas le droit de voir.',
    procedures: [
      {
        titre: 'Imprimer un état',
        etapes: [
          'Choisissez l’état dans la liste, ou cliquez l’icône d’imprimante depuis l’écran concerné.',
          'Réglez les filtres : ils décident de ce qui figure sur la feuille.',
          'Imprimez, ou enregistrez en PDF depuis la boîte d’impression du navigateur.',
        ],
      },
    ],
    regles: [
      'Un état est une PHOTO : il porte sa date et ses filtres en en-tête, pour qu’on sache plus tard ce qu’on regarde.',
      'Les colonnes de prix disparaissent de l’état pour un rôle qui n’a pas le droit de les voir — imprimer contourne les droits, sinon.',
    ],
    liens: [
      { route: '/etats/categories', libelle: 'Catégories et familles' },
      { route: '/etats/couleurs', libelle: 'Nuancier' },
      { route: '/etats/catalogue', libelle: 'Catalogue' },
      { route: '/etats/stock', libelle: 'État du stock' },
    ],
  },

  /* ========================================================= REGLAGES ===== */
  {
    route: '/utilisateurs',
    titre: 'Utilisateurs et droits',
    chemin: 'Réglages → Utilisateurs',
    objectif: 'Créer les comptes, leur donner un rôle, et régler ce que chacun voit champ par champ.',
    droits: 'Écriture du module Utilisateurs.',
    procedures: [
      {
        titre: 'Ouvrir un compte et régler ses droits',
        etapes: [
          'Créez l’utilisateur et attribuez-lui un rôle : le rôle donne les permissions par module.',
          'Ouvrez sa grille de droits pour affiner champ par champ.',
          'Partez du modèle du rôle, puis ajustez ce qui doit l’être.',
          'Validez explicitement : les réglages non enregistrés restent visibles jusque-là.',
        ],
      },
    ],
    champs: [
      { nom: 'Rôle', description: 'Il porte les permissions par module : lire, écrire, valider.', obligatoire: true },
      {
        nom: 'Niveau du champ',
        description: 'Ce que l’utilisateur peut faire de ce champ précis.',
        valeurs: 'Masqué — ni envoyé ni affiché · Lecture — visible, non modifiable · Écriture — modifiable',
      },
    ],
    regles: [
      'Le masquage se fait au SERVEUR : un champ masqué n’est pas seulement grisé, il n’arrive pas.',
      'Un champ non déclaré dans la grille est masqué pour tout le monde.',
      'Le mot de passe fait au minimum douze caractères.',
    ],
  },
]

/** La fiche d'un écran, trouvée par sa route. */
export function sujetPour(chemin: string): Sujet | undefined {
  // La route la plus PRÉCISE gagne : « /catalogue/completer » ne doit pas
  // tomber sur la fiche de « /catalogue ».
  const candidats = SUJETS.filter(
    (s) => chemin === s.route || chemin.startsWith(s.route + '/') || chemin.startsWith(s.route + '?'),
  )
  if (candidats.length === 0) return undefined
  return candidats.reduce((a, b) => (b.route.length > a.route.length ? b : a))
}
