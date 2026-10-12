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
        valeurs: 'Ne se modifié plus après création : il est la clé de toutes les références croisées.',
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
        nom: 'Minimum d’un lot pour produire',
        description:
          'La quantité à partir de laquelle UN lot suffit pour lancer une production. Au-dessus, le lot est « Projet » et le plan d’achat compte dessus ; en dessous, c’est une fin de lot (« Restes ») que le plan d’achat ne compte plus.',
        valeurs: 'dans l’unité du conditionnement (bobines pour le fil) ; en kilos sans poids par unité',
        defaut: 'vide : un étage de machine, 1 344 bobines — ou 5 000 kg pour un article sans poids de bobine',
      },
      {
        nom: 'Supplément de teinture',
        description:
          'Ce que le fournisseur facture EN PLUS pour teindre cette couleur, en devise par tonne (100, 150, 530…). Le prix d’une couleur = prix de base de la famille + ce supplément ramené au kilo. Il varie d’un fournisseur à l’autre : il se tient d’abord sur la couleur du fournisseur (Référentiels → Couleurs).',
        valeurs: 'devise du fournisseur par tonne',
      },
      {
        nom: 'Stock minimum (kg)',
        description: 'Le plancher sous lequel le calcul d’achat déclenche une proposition.',
      },
      {
        nom: 'MOQ (kg)',
        description: 'Quantité minimale que le fournisseur accepte de livrer. Le plan d’achat l’applique.',
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
        valeurs: 'Ne se modifié plus après création : les références le citent.',
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
        valeurs: 'Ne se modifié plus après création.',
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
          'L’EXCÉDENT admis entre le poids pesé et le reste à recevoir, en local comme à l’import. Au-delà, l’excédent demande une dérogation motivée. Un manque dans la tolérance solde la ligne du bon ; au-delà, il laisse un reliquat à recevoir. À défaut de réglage : le paramètre P_TolerEcartPesee (2 %).',
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
          'Saisissez les frais globaux : chaque frais se répartit selon son type (valeur, poids) sur tout le dossier ou sur les lignes choisies.',
          'Onglet Liquidation : vérifiez la répartition de chaque frais ligne par ligne ; corrigez les montants si besoin (la douane par nature de référence) — le frais passe alors en répartition manuelle.',
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
    regles: [
      'La clôture porte les frais aux lots du dossier encore en stock, là où ils sont ; la part sortie va au consommé. Une reclôture à la baisse retire au même prorata.',
      'Par défaut un frais se répartit selon le paramétrage de son type ; la répartition reste modifiable. Un frais dont la somme répartie n’égale pas le montant est « non réparti » : la clôture le refuse.',
      'La facture se saisit au cours Bank Al-Maghrib de sa date ; un taux 1 en devise est refusé, un écart de plus de 3 % se confirme.',
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
          'Soumettez au contrôle : la pesée ne se modifié plus que par le contrôleur, ou en la rouvrant.',
          'Le contrôleur — un autre compte que celui qui a pesé — indique la qualité de chaque ligne et valide : la marchandise entre en stock à la valeur facture.',
        ],
        resultat: 'Le stock monte, le mouvement d’entrée cite les dossiers concernés, et les lignes de facture sont soldées.',
      },
    ],
    champs: [
      { nom: 'Date de réception', description: 'La date du déchargement.', obligatoire: true },
      { nom: 'Quantité reçue (kg)', description: 'Le poids RÉELLEMENT pesé, pas le poids facturé.', obligatoire: true },
      { nom: 'Magasin', description: 'Le magasin où la marchandise est rangée.', obligatoire: true },
      { nom: 'Litige', description: 'À cocher quand la livraison présente un écart ou un dommage à documenter.' },
      { nom: 'Qualité', description: 'Conforme, quarantaine ou non conforme : le verdict du contrôle. Hors « conforme », la ligne va dans un magasin de quarantaine.' },
    ],
    regles: [
      'Une réception est un document À PART : ses lignes peuvent venir de plusieurs dossiers.',
      'Enregistrer garde un brouillon ; SOUMETTRE la passe au contrôle ; VALIDER fait entrer en stock et fige la réception.',
      'Celui qui a saisi la réception ne la valide pas (séparation des tâches).',
      'Une ligne d’un dossier clôturé ne se reçoit plus.',
      'Un excédent au-delà de la tolérance du fournisseur demande une dérogation motivée sur la ligne ; il n’est plus refusé sec.',
      'Pour un fil suivi au lot, les bobines se comptent : ni recopiées de la facture, ni déduites des kilos.',
      'Soumise au contrôle, la pesée est figée : le contrôleur porte la qualité, le magasin, le lot ; pour changer un poids, on rouvre en brouillon.',
      'Une facture dont une ligne est reçue ne change plus de fournisseur, de devise, de taux ni de montant (IMPORT-FIGEE).',
      'Avant la DUM, contre-passer l’entrée annule la réception et rend son reste à la facture et au bon.',
    ],
    messages: [
      {
        message: 'Le dossier … est clôturé : il ne reçoit plus rien.',
        cause: 'La clôture a fixé le coût moyen. Une entrée après coup fausserait les sorties déjà valorisées.',
      },
    ],
    liens: [{ route: '/import', libelle: 'Dossiers d’import' }],
  },
  {
    route: '/retours-fournisseur',
    titre: 'Retours fournisseur',
    chemin: 'Achats → Retours fournisseur',
    objectif: 'Rendre au fournisseur une marchandise qui est en stock — locale ou importée — avec son avoir, comme dans une gestion commerciale.',
    droits: 'Écriture du module Réceptions pour préparer le retour ; validation des réceptions pour le valider. Les prix sont masqués au magasinier.',
    procedures: [
      {
        titre: 'Préparer et valider un retour',
        etapes: [
          'Nouveau retour : choisissez le fournisseur, la date, et dites pourquoi la marchandise repart.',
          'Pour chaque ligne : le magasin, la référence en stock, le lot s’il y en a, la quantité, le motif.',
          'Le prix est proposé au CMUP du magasin : les achats le corrigent au prix convenu avec le fournisseur. Le montant de l’avoir se calcule.',
          'Enregistrez : le retour reste un brouillon, rien ne sort du stock.',
          'Un AUTRE compte, qui a le droit de valider les réceptions, relit et valide.',
        ],
        resultat: 'La marchandise sort du stock et des lots au prix du retour ; le retour se fige.',
      },
    ],
    champs: [
      { nom: 'Fournisseur', description: 'Celui à qui la marchandise repart.', obligatoire: true },
      { nom: 'Motif du retour', description: 'Pourquoi la marchandise repart, en clair.', obligatoire: true },
      { nom: 'Quantité kg', description: 'Les kilos qui repartent ; pas plus que le magasin (ou le lot) n’en porte.', obligatoire: true },
      { nom: 'Prix DH/kg', description: 'Le prix de l’avoir, saisi par les achats. Proposé au CMUP du magasin.' },
      { nom: 'Motif de ligne', description: 'Défaut qualité matière ou erreur de référence.', obligatoire: true },
    ],
    regles: [
      'Un retour est libre : il ne se rattache à aucune réception ni à aucun dossier d’import.',
      'La sortie se fait au prix du retour : la différence avec le CMUP va au stock restant du magasin, sans jamais le faire passer sous zéro ; ce qu’il ne peut pas porter va au journal des écarts de prix.',
      'Celui qui a saisi le retour ne le valide pas (séparation des tâches).',
      'Le retour ne rouvre pas le reste à livrer du bon de commande : une nouvelle livraison se commande.',
      'Un brouillon se modifie et se supprime ; un retour validé ne change plus.',
    ],
    liens: [
      { route: '/etat-stock', libelle: 'État des stocks' },
      { route: '/landed-cost', libelle: 'Coût de revient et écarts de prix' },
    ],
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
      'Régénérer efface les propositions qui n’engagent rien ; celles qui ont produit un bon restent, et celles qu’on a écartées masquent le besoin pendant 90 jours (P_DureeEcartJours) puis expirent : le besoin est reproposé.',
      'La quantité proposée tient compte du stock minimum, du MOQ et de ce qui est déjà en route, puis, si la fiche article le demande (« Arrondi à la palette pleine »), se complète jusqu’à la palette pleine : un besoin de 0,85 palette devient 1 palette. Les 0,15 ajoutés sont le COMPLÉMENT DE PALETTE, affiché dans sa colonne : ce qui est commandé pour la logistique, pas pour produire. Le poids d’une palette est une estimation, les kilos exacts sont ceux de la réception.',
      'Le calcul ne MUTUALISE PAS les équivalents : l’équivalent disponible est affiché, mais la bascule reste un geste explicite et tracé.',
      'Le fil sur machine compte comme stock (P_MrpInclureStockMachine), s’il a été constaté depuis moins de 30 jours ; il se lit à part dans la colonne « sur machine ».',
      'Le mois en cours ne compte que ses jours restants ; au-delà du dernier mois du plan, la demande se prolonge à la moyenne du plan (P_HorizonProlonge).',
      'Une commande en retard reste dans l’en-cours (P_EncoursRetardInclus) : on la relance, on ne la rachète pas. La marchandise d’import facturée et non reçue compte aussi.',
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
      { nom: 'Code Réf', description: 'La référence réclamée par les compositions.' },
      { nom: 'Désignation', description: 'Son libellé, repris du catalogue.' },
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
    objectif: 'Peser ce qui arrive au quai, le faire contrôler avant l’entrée en stock, puis clôturer avec la facture du fournisseur.',
    prerequis: ['Un bon de commande envoyé, sauf arrivage sans commande.', 'Pour un bon en devise : un taux du jour (Référentiels → Taux de change).'],
    droits: 'Écriture du module Réceptions pour peser et soumettre ; validation pour le contrôle, la clôture par facture et l’avoir.',
    procedures: [
      {
        titre: 'Réceptionner une livraison',
        etapes: [
          'Créez une réception et appelez le bon de commande : ses lignes restant à livrer s’ajoutent à la grille.',
          'Saisissez le poids pesé, le lot si la référence est suivie, et — pour un fil suivi au lot — le nombre de bobines COMPTÉES.',
          'Un excédent au-delà de la tolérance du fournisseur se justifie : cochez la dérogation et écrivez son motif.',
          'Soumettez au contrôle : l’écart se rejuge alors contre ce qui reste à recevoir sur le bon à cet instant.',
          'Un autre compte, qui a le droit de valider, contrôle et valide : la marchandise entre au prix du bon (valeur provisoire).',
        ],
        resultat: 'Le stock monte, le coût moyen est recalculé, le prix entre dans l’historique et la ligne de commande avance.',
      },
      {
        titre: 'Clôturer avec la facture',
        etapes: [
          'Sur la réception validée, « Clôturer avec la facture ».',
          'Saisissez le numéro, la date et le montant dans la devise du bon ; le cours Bank Al-Maghrib de la date est proposé.',
          'Cochez les autres réceptions du même fournisseur si la facture les couvre : le montant se répartit au prorata de leur valeur.',
          'Faites l’aperçu : la différence va aux lots de la réception encore en stock ; la part déjà sortie reste en écart de prix.',
          'Clôturez.',
        ],
        resultat: 'La valeur définitive est au stock. La réception ne se dévalide plus : une erreur se corrige par un avoir.',
      },
      {
        titre: 'Corriger après clôture : avoir ou facture complémentaire',
        etapes: ['« Avoir ou facture complémentaire », numéro de pièce, montant en MAD, motif.', 'Aperçu, puis enregistrer.'],
        resultat: 'La valeur baisse (avoir) ou monte (complément) par le même calcul que la clôture ; tout est journalisé.',
      },
    ],
    champs: [
      { nom: 'Quantité pesée', description: 'Le poids réel. C’est lui qui fait foi, pas la quantité commandée.', obligatoire: true },
      { nom: 'Lot fournisseur', description: 'Le numéro de bain de teinture, obligatoire pour les références suivies au lot.' },
      { nom: 'Bobines', description: 'Comptées sur le quai, jamais déduites des kilos : exigées à la soumission pour un fil suivi au lot. Le poids réel par bobine juge le fournisseur.' },
      { nom: 'Dérogation', description: 'Un excédent au-delà de la tolérance du fournisseur, assumé et motivé.' },
      { nom: 'Magasin de destination', description: 'Où la marchandise est rangée.', obligatoire: true },
    ],
    regles: [
      'Seul l’EXCÉDENT au-delà de la tolérance du fournisseur demande une dérogation. Un manque dans la tolérance solde la ligne ; au-delà, il laisse un reliquat.',
      'Peser et valider sont deux gestes, et deux comptes (séparation des tâches).',
      'Validée, l’entrée est au prix du bon (provisoire) ; clôturée avec la facture, elle est à sa valeur définitive.',
      'Une réception clôturée ne se dévalide plus : avoir ou facture complémentaire, motivés.',
      'Une réception dont l’entrée a été contre-passée ne se clôture pas. Une réception contre-passée puis dévalidée se corrige et se revalide.',
      'Une facture qui s’écarte de plus de 10 % de la valeur au prix du bon lève un avis (P_ClotureEcartAvisPct) ; elle ne se bloque pas.',
      'Une ligne de bon servie par un dossier d’import ne se reçoit pas ici (et inversement).',
      'Un bon en devise sans taux du jour ne se reçoit pas : la marchandise entrerait au taux du dirham.',
      'Un colisage incohérent avec la fiche article se signale (contrôle C43), il ne bloque jamais.',
      'Un arrivage SANS COMMANDE se saisit ici : le serveur crée le bon manquant en brouillon, et la réception ne se validera qu’une fois ce bon régularisé.',
    ],
    liens: [
      { route: '/bons-commande', libelle: 'Bons de commande' },
      { route: '/receptions-import', libelle: 'Réceptions import' },
    ],
  },

  /* ============================================================ STOCK ===== */
  {
    route: '/mouvements',
    titre: 'Mouvements',
    chemin: 'Stock → Mouvements',
    objectif: 'Consulter le grand livre des mouvements, et saisir à la main ce qui n’a pas de document : ajustements, déchets, consommation hors machine.',
    droits: 'Écriture du module Mouvements. Ajustement et déchet de plus de 50 kg : validation de l’inventaire. Contre-passer : la Direction.',
    procedures: [
      {
        titre: 'Saisir un mouvement libre',
        etapes: [
          'Choisissez le type : ajustement, déchet, consommation hors machine (sur un OF).',
          'Indiquez le magasin et la date du fait.',
          'Saisissez la référence et la quantité ; la conversion en kilos s’affiche avant validation.',
          'Nommez le responsable — celui qui remet ou reçoit la marchandise, pas vous.',
          'Enregistrez, puis imprimez le bon pour le faire contresigner.',
        ],
        resultat: 'Le mouvement entre au grand livre, où il devient immuable, au coût moyen en cours.',
      },
      {
        titre: 'Défaire un mouvement (contre-passation)',
        etapes: ['Sur le mouvement, « Contre-passer », avec le motif.'],
        resultat: 'L’inverse est posté ; les deux lignes restent. Pour une réception d’import avant DUM, la réception s’annule et facture et bon retrouvent leur reste.',
      },
    ],
    champs: [
      { nom: 'Type de mouvement', description: 'Il porte le sens : entrée ou sortie. Ce n’est pas au signe de la quantité de le dire.', obligatoire: true },
      { nom: 'Date du mouvement', description: 'La date du FAIT. Elle peut être dans le passé, jamais dans le futur.', obligatoire: true },
      { nom: 'Document de référence', description: 'Le bon, l’OF ou la pièce qui justifie le mouvement.' },
      { nom: 'Quantité', description: 'Saisie dans l’unité de manutention ; la conversion en kilos s’affiche avant validation.', obligatoire: true, valeurs: 'kg, Bobine, Palette, ml' },
      { nom: 'Responsable', description: 'La personne qui remet ou reçoit physiquement la marchandise. À ne pas confondre avec le compte qui saisit.' },
    ],
    regles: [
      'La saisie libre se limite aux ajustements, aux déchets et à la consommation hors machine : réceptions, retours fournisseur, transferts, fusions et fiches machine naissent de leur document.',
      'Le prix d’une entrée ou d’une sortie libre est le coût moyen en cours, jamais une saisie.',
      'Un déchet au-delà de 50 kg (P_DechetSeuilValiderKg) se valide comme un ajustement : droit de valider l’inventaire.',
      'Un retour fournisseur se saisit sur son propre document (Achats → Retours fournisseur), plus ici.',
      'La consommation hors machine (colle, jute…) se déclare sur un OF ; un fil qui se charge sur machine se consomme par ses fiches.',
      'Un mouvement validé est IMMUABLE : on le compense par une contre-passation, on ne le corrige pas.',
      'Le stock ne peut pas devenir négatif.',
    ],
    messages: [
      { message: 'R02 : stock insuffisant…', cause: 'Sortir plus que ce qui est là cache toujours autre chose : une entrée oubliée, ou une référence confondue.' },
      { message: 'Un déchet de … kg depasse 50 kg', cause: 'Un déchet important se valide comme un ajustement d’inventaire : faites-le saisir par la Direction.' },
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
    regles: [
      'Les références sous suivi de lot se comptent AU LOT, pas en total abstrait.',
      'L’écart se lit à l’heure du comptage : chaque ligne reprend le stock du moment où elle est comptée ; ce qui entre ou sort ensuite reste acquis. Le magasin n’est pas gelé.',
      'Un seul inventaire en cours par magasin.',
      'Clôturer ou annuler un inventaire demande la validation du module Inventaire : celui qui compte ne clôture pas son propre comptage.',
      'Un inventaire ouvert par erreur ou devenu périmé s’annule, avec un motif ; aucun ajustement n’est passé.',
      'Un seul inventaire en cours par magasin (contrôle C44 si une base en porte deux).',
      'Celui qui compte ne clôture pas : la clôture écrit au stock et revient au droit de valider l’inventaire.',
      'Un inventaire ouvert par erreur s’annule avec un motif.',
    ],
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

  /* ============================================================= LOTS ===== */
  {
    route: '/machines',
    titre: 'Machines',
    chemin: 'Stock → Machines',
    objectif:
      'Voir ce que porte chaque étage, et enregistrer les trois gestes du magasin — charger, décharger, constater — comme des décisions : état avant, saisie, aperçu, validation, état résultant. Choisir un étage en tête de la machine filtre son contenu, ses fiches et sa consommation.',
    prerequis: [
      'La machine et ses étages déclarés dans « Le parc ».',
      'Pour un chargement : le fil présent au magasin d’origine, dans le lot chargé.',
    ],
    droits: 'Écriture du module Mouvements pour saisir et valider un constat ; VALIDER pour valider un chargement ou un déchargement et pour retirer une décision ; un écart rouge revient au droit de valider l’inventaire (Direction).',
    procedures: [
      {
        titre: 'Charger un étage',
        etapes: [
          'Ouvrez la machine, choisissez l’étage, puis « Charger » : la fiche s’ouvre sur son propre écran et reprend ce que l’étage porte déjà (bobines, %, kilos).',
          'Choisissez le magasin d’origine et nommez le responsable.',
          'Saisissez le nombre de bobines à charger et, si besoin, corrigez le poids par bobine (le poids catalogue est proposé).',
          'Indiquez le % de TOUTE la ligne après le chargement : l’outil propose le % théorique, laissez-le si vous ne constatez rien d’autre.',
          'Cliquez « Aperçu » : il montre exactement ce que la validation enregistrera, ligne par ligne.',
          'Relisez, puis « Valider la décision ».',
        ],
        resultat:
          'Le fil sort du magasin à son coût moyen, l’étage prend l’état résultant, et l’écart éventuel est classé selon le motif.',
      },
      {
        titre: 'Décharger un étage',
        etapes: [
          '« Décharger » sur l’étage, puis le magasin de retour et le responsable.',
          'Pour chaque ligne : les bobines à retirer, leur %, la destination, et le % constaté des bobines qui restent.',
          'Tout retirer est permis : l’étage passe à zéro dans la même décision, et l’écart restant est classé selon le motif.',
          'Aperçu, relecture, validation.',
        ],
        resultat: 'Seule la destination « Retour au magasin » fait rentrer du fil en stock ; perte, déchet et casse sortent de l’étage sans revenir.',
      },
      {
        titre: 'Constater un étage, ou corriger une erreur',
        etapes: [
          '« Constater » sur l’étage : pour chaque ligne Réf + Lot, le nombre de bobines présentes et le % constaté.',
          'Pour réparer une erreur passée, prenez le motif « Correction » et dites si l’écart est une consommation ou une erreur de saisie.',
          'Aperçu, relecture, validation.',
        ],
      },
      {
        titre: 'Défaire la dernière décision d’un étage',
        etapes: [
          'Choisissez l’étage, onglet « Fiches de l’étage » : seule la fiche marquée « dernière de l’étage » porte « Dévalider » (elle revient en brouillon, son étage peut changer) et « Annuler » (elle est close). Les mêmes boutons sont en tête de son écran de détail.',
          'Donnez la raison : elle reste au journal.',
        ],
        resultat:
          'L’étage revient exactement à l’état qui précédait ; les mouvements du magasin reçoivent une annulation administrative à leur valeur d’origine.',
      },
    ],
    champs: [
      { nom: 'Avant', description: 'Ce que l’étage porte avant la décision : bobines, % et kilos. Il ne se saisit pas.' },
      { nom: 'À charger', description: 'Le nombre de bobines ajoutées sur la ligne Réf + Lot.', obligatoire: true },
      {
        nom: 'Poids/bob.',
        description: 'Le poids retenu pour une bobine chargée.',
        valeurs: 'kg',
        defaut: 'le poids nominal du catalogue',
      },
      {
        nom: '% ligne après',
        description: 'Le remplissage moyen de toute la ligne après le geste, en % du poids nominal. Les kilos de l’étage en découlent.',
        defaut: 'le % théorique : (kilos avant + kilos chargés) / (bobines après × poids nominal)',
      },
      { nom: 'À retirer', description: 'Le nombre de bobines enlevées de la ligne.', obligatoire: true },
      { nom: '% retirées', description: 'Le remplissage des bobines enlevées : il donne les kilos qui partent.' },
      {
        nom: 'Destination',
        description: 'Où vont les bobines retirées. Le motif limite les destinations possibles.',
        valeurs: 'Retour au magasin · Perte · Déchet · Casse',
      },
      { nom: '% restantes', description: 'Le remplissage constaté des bobines qui restent sur l’étage.' },
      { nom: 'Présentes', description: 'Constat : le nombre de bobines réellement sur l’étage pour cette ligne.' },
      {
        nom: 'Écart',
        description:
          'Kilos avant + chargés − retirés − kilos après. Positif : du fil a disparu de l’étage ; le motif dit s’il compte comme consommation, déchet, perte, casse, erreur de saisie ou écart non qualifié. Négatif : régularisation.',
      },
      { nom: 'Motif', description: 'La raison du geste ; il décide du classement de l’écart.', obligatoire: true },
    ],
    regles: [
      'Une validation est une DÉCISION : son état avant et son état résultant sont archivés, et le journal de la fiche ne s’efface pas.',
      'Le premier poste qui valide prend l’étage : un second qui valide au même moment est refusé et réessaie.',
      'Le nombre de bobines ne dépasse jamais les places de l’étage.',
      'Un chargement à 0 bobine est refusé ; un déchargement complet est permis.',
      'Un chargement plus gros que le stock du magasin est BLOQUÉ : le magasinier prévient le directeur ou l’administrateur, qui fait et valide la correction de stock avant.',
      'Un chargement d’un lot que le magasin ne porte pas en quantité suffisante est bloqué de la même façon : il n’y a pas de « charger quand même ».',
      'Le % se saisit au centième : un écart plus petit que ce que l’arrondi produit sur la ligne compte comme « aucun écart », et l’étage garde ses kilos.',
      'Le poids nominal d’une ligne est celui de l’étage, fixé à son chargement : un poids de bobine qui change au catalogue ne crée pas d’écart sur l’étage.',
      'On ne retire pas plus de kilos qu’une ligne n’en porte ; seuls l’administrateur et le directeur passent outre, pour corriger un étage faux.',
      'Valider un chargement ou un déchargement, et retirer une décision validée, demandent le droit VALIDER (ils font bouger le magasin) ; valider un constat demande le droit d’écrire.',
      'Seule la dernière décision d’un étage se défait, par son auteur le jour même, ou par un administrateur ou un directeur. Si une décision plus récente s’est appuyée sur elle, on passe par un constat « Correction ».',
      'Les mouvements nés d’une fiche machine ne se contre-passent pas depuis l’écran des mouvements : ils se défont en dévalidant ou en annulant la fiche.',
      'VERT, ORANGE, ROUGE (règle 1) ne jugent que les écarts NON EXPLIQUÉS : une consommation, un déchet, une perte ou une casse déclarés restent en vert. Orange : à confirmer avant de valider. Rouge : la Direction (droit de valider l’inventaire) et un commentaire.',
      'Un gain (plus de fil qu’attendu) est une régularisation, jamais une consommation.',
      'Un lot bloqué ne se charge pas ; il se décharge vers le magasin. Une dérogation se demande depuis la fiche refusée : accordée, elle sert une fois, pour ce lot, cette fiche et au plus ses kilos ; la fiche annulée l’emporte.',
      'Une machine retirée ne porte plus de fiche ; une zone retirée qui a un passé se désactive.',
      'La consommation se date à la fiche (le fait), pas à sa validation.',
    ],
    messages: [
      {
        message: 'Étage … est en cours de modification par une autre fiche',
        cause: 'Un autre poste valide une décision sur ce même étage. Réessayez dans un moment : vous partirez de son état résultant.',
      },
      {
        message: 'Chargement bloqué : stock insuffisant',
        cause: 'Le magasin d’origine ne porte pas les kilos à charger. Prévenez le directeur ou l’administrateur.',
      },
      {
        message: 'cette décision a servi de base à la fiche …',
        cause: 'Ce n’est plus la dernière décision de l’étage. Réparez par un constat avec le motif « Correction ».',
      },
    ],
    liens: [
      { route: '/parc-machines', libelle: 'Le parc' },
      { route: '/stock', libelle: 'Stock par magasin' },
      { route: '/mouvements', libelle: 'Mouvements' },
    ],
  },

  {
    route: '/lots',
    titre: 'Lots',
    chemin: 'Stock → Lots',
    objectif:
      'Voir le stock LOT PAR LOT et traiter ce qui demande une décision : lots à basculer en Restes, lots dormants, lots bloqués, poids de bobine anormal.',
    prerequis: [
      'Un lot naît tout seul à la première entrée en stock (réception, import, mouvement) : il n’y a rien à créer à la main.',
    ],
    droits:
      'Lecture du module Lots pour consulter ; écriture pour basculer en Restes ; validation du module Lots (la Direction l’a) pour bloquer, débloquer et décider du sort d’un lot dormant. Un lot qui porte du fil sur machine ne se solde pas. La valeur en MAD n’apparaît que pour un rôle qui a le droit de la voir.',
    procedures: [
      {
        titre: 'Comprendre ce qu’est un lot',
        etapes: [
          'Un lot, c’est une fabrication du fournisseur sous un même numéro : toutes ses bobines sortent du même bain de teinture et ont exactement la même couleur.',
          'Mélanger deux lots sur un même tapis, c’est risquer une différence de teinte visible. D’où le suivi lot par lot.',
          'Quand le fournisseur n’a pas mis de numéro, ou que l’article ne se suit pas par lot, la marchandise est rangée sous « Sans lot ».',
        ],
      },
      {
        titre: 'Lire les onglets',
        etapes: [
          'Comptable — tout le stock, sans exception : bloqués et dormants compris.',
          'Projet — les lots assez gros pour lancer une production : ils remplissent au moins un étage de machine (1 344 bobines par défaut). Le plan d’achat compte sur eux.',
          'Restes — les fins de lot, qui ne remplissent plus un étage. Ils servent aux petits travaux ; le plan d’achat ne compte PAS dessus, et achète donc pour les projets.',
          'Les quatre onglets suivants sont des ALERTES : à 0, il n’y a rien à faire.',
          'À basculer — des lots Projet passés sous le seuil : quelqu’un doit confirmer leur passage en Restes.',
          'Dormants — des lots sans aucun mouvement depuis un an : il faut décider de les garder, de les solder ou de les détruire.',
          'Bloqués — des lots arrêtés par la qualité : ils ne partent ni en production ni sur machine ; ils peuvent aller en quarantaine, revenir d’une machine ou retourner au fournisseur.',
          'Dérive de poids — des lots dont les bobines ne pèsent pas le poids annoncé par le catalogue.',
        ],
      },
      {
        titre: 'Basculer un lot en Restes',
        etapes: [
          'Ouvrez l’onglet « À basculer ».',
          'Cliquez « Basculer en Restes » sur la ligne, ou « Tout basculer » pour traiter toute la liste.',
          'Confirmez.',
        ],
        resultat:
          'Le lot passe dans les Restes : le plan d’achat cesse de compter dessus. Le geste est inscrit dans la vie du lot, avec son auteur.',
      },
      {
        titre: 'Bloquer ou débloquer un lot',
        etapes: [
          'Cliquez « Bloquer » (ou « Débloquer ») sur la ligne ou sur la fiche du lot.',
          'Écrivez le motif : ce que la qualité a constaté, ou pourquoi le lot est libéré.',
          'Confirmez.',
        ],
        resultat:
          'Bloqué, le lot ne part plus en production ni sur machine (sauf dérogation, bornée aux kilos d’une fiche), et le plan d’achat ne compte plus dessus. Il peut aller en quarantaine, revenir d’une machine ou retourner au fournisseur.',
      },
      {
        titre: 'Décider du sort d’un lot dormant',
        etapes: [
          'Ouvrez l’onglet « Dormants » et cliquez « Décider » sur la ligne.',
          'Choisissez : Garder (il reste en stock), Solder (vendu ou cédé) ou Détruire.',
          'Écrivez le motif et confirmez.',
        ],
        resultat:
          'Solder ou détruire sort le lot du stock par un mouvement d’ajustement, magasin par magasin ; le lot passe « Soldé ». Garder le laisse en place.',
      },
    ],
    champs: [
      { nom: 'Article', description: 'La référence du catalogue, avec sa désignation dessous.' },
      {
        nom: 'Lot',
        description: 'Le numéro du lot.',
        valeurs: '« Sans lot » : le fournisseur n’a pas mis de numéro, ou l’article n’est pas suivi par lot.',
      },
      {
        nom: 'Origine',
        description: 'D’où vient ce numéro.',
        valeurs:
          'Fournisseur — écrit sur la marchandise · Numéro attribué — créé par nous à la réception · Fusion — plusieurs lots réunis en un · Sans lot',
      },
      { nom: 'Fournisseur', description: 'Le fournisseur qui a livré ce lot.' },
      { nom: 'Catégorie', description: 'Projet ou Restes, comme les onglets.', valeurs: 'Projet · Restes' },
      {
        nom: 'Statut',
        description: 'Ce qu’on a le droit de faire du lot.',
        valeurs: 'Libre — utilisable · Bloqué — arrêté par la qualité · Soldé — épuisé',
      },
      { nom: 'Solde kg', description: 'Ce qui reste en stock de ce lot, tous magasins confondus.', valeurs: 'kg' },
      {
        nom: 'Bobines',
        description:
          'Le nombre de bobines en stock. Il reste à 0 quand l’article n’a pas de poids de bobine au catalogue (le jute, par exemple).',
      },
      {
        nom: 'Min. pour produire',
        description:
          'La limite entre Projet et Restes pour cet article, dans l’unité où l’atelier la compte. Par défaut, un étage de machine : 1 344 bobines (un étage de CRM1, TINGIS ou CRX). Exemple : 1 882 bobines de 2,2 kg (4 140 kg) remplissent un étage — le lot est Projet.',
        valeurs: 'bobines pour le fil ; kilos pour un article sans poids par unité',
        defaut:
          '1 344 bobines (réglage général) ; 5 000 kg pour un article sans poids de bobine (jute, colle). Réglable par article sur sa fiche du catalogue, carte « Gestion des lots » : « Minimum d’un lot pour produire ».',
      },
      {
        nom: 'Sans activité',
        description: 'Depuis combien de jours le lot n’a pas bougé. À 365 jours, il devient dormant.',
        valeurs: 'jours',
      },
      {
        nom: 'Dérive',
        description:
          'L’écart entre le poids réel des bobines et le poids du catalogue, sur toute la vie du lot. Exemple : des bobines de 2,66 kg pour 2,60 kg au catalogue font +2,31 %.',
        valeurs: 'Vert : moins de 1 % · Orange : de 1 à 3 % · Rouge : plus de 3 %',
      },
      { nom: 'Valeur MAD', description: 'La valeur du lot au coût moyen. Visible seulement si votre rôle y a droit.' },
      { nom: 'Montrer aussi les lots soldés', description: 'Dans l’onglet Comptable, affiche aussi les lots épuisés.' },
    ],
    regles: [
      'Un lot neuf est classé tout seul : Projet s’il atteint le seuil de son article, Restes sinon.',
      'Quand le seuil se compte en bobines et que le lot porte son nombre de bobines, la comparaison se fait EN BOBINES : un fil un peu plus léger que le catalogue ne fait pas passer un lot complet en Restes. Sinon, elle se fait en kilos.',
      'Le passage de Restes à Projet est automatique (une entrée fait remonter le lot au-dessus du seuil) ; le passage de Projet à Restes, lui, se CONFIRME à la main — c’est l’onglet « À basculer ».',
      'Revenir de Restes en Projet demande un motif.',
      'Un lot dormant n’est jamais supprimé en silence : il faut une décision, avec son motif.',
      'Les seuils de couleur de la dérive (1 % et 3 %) se règlent dans les paramètres.',
    ],
    messages: [
      {
        message: 'LOT-BLOQUÉ',
        cause:
          'Le lot est bloqué par la qualité : il ne part ni en production, ni sur machine, ni en fusion. Il peut revenir d’une machine, aller en quarantaine ou retourner au fournisseur. Un chargement exceptionnel se demande en dérogation depuis la fiche machine refusée.',
      },
    ],
    liens: [
      { route: '/autorisations', libelle: 'Autorisations' },
      { route: '/etats/lots', libelle: 'États imprimables des lots' },
    ],
  },
  {
    route: '/lots/fiche',
    titre: 'Fiche d’un lot',
    chemin: 'Stock → Lots → clic sur une ligne',
    objectif:
      'Tout savoir d’un lot : où il se trouve, ce qui lui est arrivé depuis son entrée, et ce qu’il faut en faire.',
    droits: 'Lecture du module Lots ; les actions demandent les mêmes droits que sur la liste des lots.',
    procedures: [
      {
        titre: 'Fusionner d’autres lots dans celui-ci',
        etapes: [
          'Ouvrez la section « Fusionner d’autres lots dans celui-ci ».',
          'Choisissez le magasin, puis cochez les lots à réunir. Seuls les lots du même article, du même fournisseur et de la même couleur, non bloqués, sont proposés ; la raison est donnée pour ceux qui ne le sont pas.',
          'Écrivez le motif et cliquez « Fusionner ».',
        ],
        resultat:
          'Les kilos et les bobines des lots cochés passent dans ce lot, dans le même magasin ; les lots vidés passent « Soldé ». Le stock du magasin et son coût ne changent pas.',
      },
    ],
    champs: [
      {
        nom: 'Variation cumulée',
        description: 'L’écart total entre le poids réel et le poids catalogue, sur toutes les pesées du lot.',
        valeurs: '% et kg',
      },
      { nom: 'Poids moyen d’une bobine', description: 'Le poids réel moyen d’une bobine, face au poids du catalogue.' },
      { nom: 'En magasin', description: 'Le solde du lot dans chaque magasin.' },
      { nom: 'Sur machine', description: 'Les bobines de ce lot actuellement chargées sur une machine.' },
      {
        nom: 'Vie du lot',
        description:
          'Chaque entrée, sortie, chargement, décision et autorisation, du plus ancien au plus récent, avec son document, son lieu, son auteur et son motif.',
      },
    ],
    regles: [
      'Le bandeau du haut dit ce qui demande une action : lot bloqué, dormant, à basculer, ou poids en dérive.',
      'La fiche s’imprime (« Imprimer ») : c’est la traçabilité du lot sur papier.',
    ],
    liens: [{ route: '/lots', libelle: 'Lots' }],
  },
  {
    route: '/autorisations',
    titre: 'Autorisations',
    chemin: 'Stock → Autorisations',
    objectif:
      'Donner ou refuser l’accord demandé quand une opération sort des règles — par exemple un écart de poids hors tolérance.',
    droits:
      'Validation du module Lots, ou la Direction, pour décider. On ne décide pas de sa propre demande : un autre responsable doit répondre (sauf l’administrateur). Demander demande d’écrire sur les lots, ou d’écrire le mouvement refusé.',
    procedures: [
      {
        titre: 'Répondre à une demande',
        etapes: [
          'Ouvrez l’onglet « À décider » : les demandes les plus anciennes viennent en premier.',
          'Cliquez « Accorder » ou « Refuser ».',
          'Écrivez le motif — obligatoire pour un refus — et confirmez.',
        ],
        resultat: 'La décision est inscrite dans la vie du lot concerné, avec son auteur et sa date.',
      },
      {
        titre: 'Retirer sa propre demande',
        etapes: ['Cliquez « Retirer » sur votre demande encore en attente.'],
      },
    ],
    regles: [
      'Une même demande n’est pas créée deux fois tant que la première attend une réponse.',
      'L’onglet « Historique » garde toutes les demandes tranchées, les plus récentes en premier.',
      'Un accord s’explique comme un refus : le motif est obligatoire.',
      'Une seule réponse : si deux responsables répondent en même temps, le second trouve la demande déjà tranchée.',
      'Une dérogation de lot bloqué sert une fois, pour le lot et la fiche qu’elle nomme, et au plus les kilos demandés.',
    ],
    liens: [{ route: '/lots', libelle: 'Lots' }],
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
    titre: 'Accueil',
    chemin: 'Accueil',
    objectif:
      'Ouvrir l’application sur ce que vous pouvez faire : les écrans auxquels votre compte a droit, et rien d’autre.',
    droits: 'Aucun : la page s’ouvre pour tout le monde et ne montre que les écrans permis par vos droits.',
    regles: [
      'Les raccourcis viennent de la même liste que le menu : un écran retiré disparaît des deux à la fois.',
      'Ce qui attend une décision se lit au tableau de bord (droit de lecture du Cockpit).',
    ],
    liens: [{ route: '/tableau-de-bord', libelle: 'Tableau de bord' }],
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
      'La valorisation ne modifié rien : c’est une lecture, jamais une écriture. On peut la rejouer autant de fois qu’on veut.',
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
      'La grille du module fait foi pour les champs qu’elle déclare. Un montant qu’elle ne déclare pas est masqué à qui il est masqué ailleurs (valorisation, tableau de bord).',
      'Changer son mot de passe ferme ses autres sessions ; la session courante continue. Poser la double authentification demande le mot de passe, et un code ne sert qu’une fois.',
      'Le mot de passe fait au minimum douze caractères.',
    ],
  },

  /* ============================================ ÉCRANS SANS FICHE (09/10) == */
  {
    route: '/rapports',
    titre: 'Rapports financiers',
    chemin: 'Analyse → Rapports',
    objectif: 'Lire où va l’argent : achats, consommation, valeur du stock et classement ABC, sur une période.',
    droits: 'Lecture du module Valorisation ; les montants suivent la grille des champs.',
    regles: ['Les chiffres viennent du grand livre et du CMUP : aucun montant n’est ressaisi ici.'],
  },
  {
    route: '/landed-cost',
    titre: 'Coût de revient complet',
    chemin: 'Analyse → Coût de revient',
    objectif:
      'Voir ce que coûte vraiment la matière rendue magasin : prix d’achat plus fret, douane, assurance et manutention ; et les écarts de prix que le CMUP n’a pas pu porter.',
    droits: 'Lecture du module Valorisation ; saisir un frais demande l’écriture.',
    procedures: [
      {
        titre: 'Saisir un frais d’approche',
        etapes: [
          'Cliquez « + » : le formulaire s’ouvre sur la page.',
          'Choisissez la réception, la nature du frais et sa clé de répartition (le fret au poids, la douane à la valeur).',
          'Enregistrez : le coût de revient de chaque ligne se recalcule.',
        ],
      },
    ],
    regles: [
      'Les réceptions clôturées avec leur facture restent au coût de revient.',
      'Écarts de prix : la part d’une facture, d’un frais ou d’un avoir revenue à des kilos déjà sortis ; elle n’est dans aucun stock (positif = surcoût, négatif = gain).',
    ],
  },
  {
    route: '/classification',
    titre: 'Classement ABC / XYZ',
    chemin: 'Analyse → Classification',
    objectif: 'Classer chaque référence par son poids dans la valeur (ABC) et la régularité de sa consommation (XYZ), et en déduire une politique de stock.',
    droits: 'Lecture du module Stock.',
    regles: ['C’est le croisement des deux lettres qui commande la politique : une AZ ne se gère pas comme une AX.'],
  },
  {
    route: '/audit',
    titre: 'Journal d’audit',
    chemin: 'Administration → Audit',
    objectif: 'Retrouver qui a changé quoi, quand, avec l’ancienne et la nouvelle valeur.',
    droits: 'Lecture du module Audit.',
    regles: [
      'Le journal est immuable : rien ne s’y modifié ni ne s’y efface.',
      'Une suppression y garde l’enregistrement entier : il peut se reconstituer.',
      'Le recalcul du plan d’achat s’y résume en une ligne (« RECALCUL »), avec le nombre de propositions remplacées.',
    ],
  },
  {
    route: '/parametres',
    titre: 'Paramètres',
    chemin: 'Administration → Configuration',
    objectif: 'Les réglages de l’application se trouvent dans Configuration : cette adresse y mène.',
    liens: [{ route: '/configuration', libelle: 'Configuration' }],
  },
  {
    route: '/tableau-de-bord',
    titre: 'Tableau de bord',
    chemin: 'Tableau de bord',
    objectif: 'Voir d’un coup d’œil ce qui demande une action : files de documents à traiter, alertes de stock, contrôles en anomalie.',
    droits: 'Lecture du module Cockpit. Les montants n’apparaissent qu’à qui voit la valeur du stock.',
    regles: [
      'Chaque tuile mène à la liste qu’elle compte : on y traite, on ne recopie pas.',
      'Les réceptions locales et d’import à contrôler sont comptées ensemble.',
    ],
    liens: [{ route: '/controles', libelle: 'Contrôles' }],
  },
  {
    route: '/controles',
    titre: 'Contrôles',
    chemin: 'Pilotage → Contrôles',
    objectif: 'Lire les contrôles de cohérence de la base (C01 à C45) et ouvrir le détail de ceux qui sont en anomalie.',
    droits: 'Lecture du module Cockpit.',
    regles: [
      'Un contrôle BLOQUANT ou CRITIQUE en anomalie se traite avant tout : C11 (cache égal au grand livre), C44 (deux inventaires en cours), C45 (une ligne de bon reçue en local et à l’import).',
      'Un contrôle d’ATTENTION signale sans bloquer : C43 (colisage incohérent), C41 (régularisation machine).',
      'C38 (consommation machine négative) est une sentinelle : il doit rester à zéro.',
    ],
  },
  {
    route: '/recettes',
    titre: 'Recettes',
    chemin: 'Production → Recettes',
    objectif: 'Décrire la composition d’une qualité de tapis : quelles références, dans quels rôles, en quels pourcentages.',
    droits: 'Écriture du module Recettes ; validation pour la mettre en service.',
    regles: [
      'La somme des pourcentages fait 100 % : la base refuse une recette qui ne tombe pas juste.',
      'Une recette en service alimente le calcul des besoins ; la figer garde la photo utilisée par un plan.',
    ],
    liens: [{ route: '/qualites', libelle: 'Qualités' }, { route: '/plans', libelle: 'Plans de production' }],
  },
  {
    route: '/plans',
    titre: 'Plans de production',
    chemin: 'Production → Plans',
    objectif: 'Planifier les mètres carrés à produire par qualité et par mois ; le plan en service donne les besoins de matière.',
    droits: 'Écriture du module Plans ; validation pour mettre en service ou clôturer.',
    regles: [
      'Seul le plan EN SERVICE alimente les besoins ; un brouillon ou une simulation ne compte pas.',
      'Clôturer un plan en service arrête ses besoins : c’est un acte de validation.',
      'Au-delà du dernier mois du plan, le plan d’achat prolonge la demande à la moyenne du plan.',
    ],
    liens: [{ route: '/besoins', libelle: 'Besoins' }, { route: '/plan-achat', libelle: 'Plan d’achat' }],
  },
  {
    route: '/parc-machines',
    titre: 'Parc machines',
    chemin: 'Stock → Parc machines',
    objectif: 'Déclarer les machines, leurs étages et leurs places, et changer leur état (active, en panne, en sommeil, retirée).',
    droits: 'Écriture du module Paramètres.',
    regles: [
      'Une machine retirée doit être vide ; retirée, elle ne porte plus de fiche.',
      'Une zone retirée qui a un passé se désactive ; seule une zone jamais employée s’efface.',
      'Une machine qui a travaillé ne se supprime pas : elle se retire, son historique reste.',
    ],
    liens: [{ route: '/machines', libelle: 'Machines' }],
  },
  {
    route: '/matrice-prix',
    titre: 'Matrice des prix',
    chemin: 'Pilotage → Matrice des prix',
    objectif: 'Comparer les prix d’une même matière entre fournisseurs, pour arbitrer un achat.',
    droits: 'Lecture du module Cockpit ; les prix n’apparaissent qu’à qui a le droit de les voir.',
  },
  {
    route: '/historique-prix',
    titre: 'Historique des prix',
    chemin: 'Pilotage → Historique des prix',
    objectif: 'Suivre le prix au kilo payé à chaque réception, par référence et par fournisseur.',
    droits: 'Lecture ; les prix n’apparaissent qu’à qui a le droit de les voir.',
    regles: ['Une réception revalidée garde son entrée d’origine dans l’historique (même prix de bon).'],
  },
  {
    route: '/roles-bom',
    titre: 'Rôles de composition',
    chemin: 'Production → Rôles',
    objectif: 'Les rôles qu’une matière tient dans un tapis — poil, trame, chaîne… — et leur densité, qui convertit les mètres carrés en kilos.',
    droits: 'Écriture du module Recettes.',
  },
  {
    route: '/configuration',
    titre: 'Configuration',
    chemin: 'Réglages → Configuration',
    objectif: 'Régler les paramètres de gestion : tolérances, seuils, délais, horizons.',
    droits: 'Les paramètres marqués « Direction » ne se modifient que par elle.',
    regles: [
      'Réglages du 08/10 : P_TolerEcartPesee (2 %), P_ClotureEcartAvisPct (10 %), P_DechetSeuilValiderKg (50 kg), P_MachineEcartVert/Rouge (kg et %), P_MrpInclureStockMachine, P_JoursInventMachine (30 j), P_DureeEcartJours (90 j), P_AncienneteTauxJours (7 j), P_EncoursRetardInclus, P_HorizonProlonge.',
      'Chaque modification est journalisée avec son auteur.',
    ],
  },
  {
    route: '/etat-stock',
    titre: 'État du stock',
    chemin: 'Stock → État du stock',
    objectif: 'L’état imprimable du stock par magasin et par référence, à une date.',
    droits: 'Lecture du module Stock ; la valeur n’apparaît qu’à qui voit le coût.',
  },
  {
    route: '/receptions/nouvelle',
    titre: 'Nouvelle réception',
    chemin: 'Achats → Réceptions → Nouvelle',
    objectif: 'Saisir la pesée d’un camion : appeler le bon, peser, compter les bobines, ranger.',
    droits: 'Écriture du module Réceptions.',
    regles: [
      'Pour un fil suivi au lot, le champ des bobines part vide : on les compte, on ne les déduit pas.',
      'La tolérance affichée est celle du fournisseur.',
      'L’enregistrement garde un brouillon ; rien n’entre en stock avant le contrôle.',
    ],
    liens: [{ route: '/receptions', libelle: 'Réceptions' }],
  },
  {
    route: '/mouvements/nouveau',
    titre: 'Saisie libre',
    chemin: 'Stock → Mouvements → Nouveau',
    objectif: 'Saisir un ajustement, un déchet ou une consommation hors machine.',
    droits: 'Voir la fiche « Mouvements » : chaque type a son droit.',
    regles: [
      'Le type « Consommation hors machine » demande un OF et refuse un fil qui se charge sur machine.',
      'Le retour fournisseur n’est plus un mouvement libre : il a son document, rattaché à la réception.',
    ],
    liens: [{ route: '/mouvements', libelle: 'Mouvements' }, { route: '/retours-fournisseur', libelle: 'Retours fournisseur' }],
  },
  {
    route: '/telecharger',
    titre: 'Télécharger',
    chemin: 'Télécharger',
    objectif: 'Installer l’application de bureau ou mobile sur un poste de l’usine.',
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
