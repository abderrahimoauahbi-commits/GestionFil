/**
 * FICHES D'AIDE — CATALOGUE ET DONNÉES DE BASE.
 *
 * Une partie du catalogue : `../contenu.ts` les assemble, `../types.ts` donne
 * la forme d'une fiche. Chaque `champs[].nom` est l'intitulé EXACT de l'écran :
 * c'est par lui que l'indice ⓘ se pose à côté du champ (`../indice.ts`).
 *
 * Réécrites le 27/10/2026 d'après le code des écrans (Catalogue.tsx,
 * CompleterCatalogue.tsx, Referentiels.tsx, MaitreDetail.tsx, Equivalences.tsx,
 * Fournisseurs.tsx, Qualites.tsx, Recettes.tsx, MatricePrix.tsx,
 * HistoriquePrix.tsx, QualiteEtat.tsx).
 */
import type { Sujet } from '../types.ts'

/** Ce que dit le dialogue de suppression commun (DialogueSuppression). */
const REGLE_SUPPRESSION =
  'Supprimer une ligne que rien ne cite l’efface pour de bon (le journal garde la trace). Dès qu’un enregistrement la cite, le dialogue liste ce qui la retient et propose « Mettre de côté » : elle sort des listes de saisie, tout ce qui la cite continue de fonctionner. Une ligne mise de côté se remet en service par « Remettre en service ».'

export const FICHES_CATALOGUE: Sujet[] = [
  /* ======================================================================= */
  /* /catalogue                                                              */
  /* ======================================================================= */
  {
    route: '/catalogue',
    titre: 'Références',
    chemin: 'Fiches de base → Références',
    objectif:
      'Tenir la fiche de chaque matière première : son identité, son classement, son conditionnement, ses règles de lot, ses seuils et son prix d’achat.',
    prerequis: [
      'La catégorie matière existe (Fiches de base → Catégories et familles).',
      'Le fournisseur est déclaré (Fiches de base → Fournisseurs).',
      'La devise du prix existe ; la position tarifaire (SH) existe si la matière s’importe.',
    ],
    droits:
      'Module Catalogue : LIRE pour consulter, ÉCRIRE pour créer, modifier, mettre de côté ou supprimer. Les prix et le CMUP n’apparaissent qu’aux profils qui ont le droit de les voir.',
    procedures: [
      {
        titre: 'Trouver une référence',
        etapes: [
          'Posez les filtres au-dessus du tableau : Catégorie, Fournisseur, Unité, État (Actives par défaut).',
          'Tapez dans la recherche du tableau une partie du code ou de la désignation.',
          '« Effacer (n) » remet les filtres à zéro.',
        ],
        resultat: 'Le serveur filtre et compte : le tableau n’affiche qu’une page, triable par colonne.',
      },
      {
        titre: 'Créer une référence',
        etapes: [
          'Cliquez « Nouveau » : la fiche s’ouvre en page, par sections (Général, Paramètres techniques, Conditionnement et stockage, Gestion des lots, Achat).',
          'Saisissez la Référence (le code interne), la Désignation, la Catégorie matière et le Fournisseur.',
          'Renseignez l’Unité de stock, puis le conditionnement : Conditionnement, Poids par unité (kg), Unités par palette.',
          'Dans Achat : Prix par unité et Devise (obligatoires), date du prix, quantité minimale de commande, arrondi à la palette.',
          'Cliquez « Créer ». Un champ obligatoire vide est nommé dans le message et le curseur y est placé.',
        ],
        resultat: 'La référence existe, active : elle est proposée dans les bons, les réceptions et les compositions.',
      },
      {
        titre: 'Modifier une référence',
        etapes: [
          'Menu « ⋯ » de la ligne → « Modifier ».',
          'Corrigez les champs : la Référence elle-même est grisée (« non modifiable »).',
          '« Enregistrer » ne s’active qu’après un changement ; « Retour à la liste » abandonne.',
        ],
        resultat: 'La fiche est mise à jour. Si quelqu’un l’a modifiée pendant votre saisie, l’enregistrement est refusé.',
      },
      {
        titre: 'Retirer une référence',
        etapes: [
          'Menu « ⋯ » → « Supprimer… » : le dialogue dit ce qui retient la ligne et propose « Mettre de côté ».',
          'Pour une référence créée par erreur et jamais utilisée : menu « ⋯ » → « Supprimer définitivement ».',
          'Une référence mise de côté se retrouve avec le filtre État = Désactivées, et revient par « Remettre en service ».',
        ],
        resultat: 'La matière qu’on n’achète plus sort des listes de saisie sans disparaître de l’historique.',
      },
    ],
    champs: [
      {
        nom: 'Référence',
        description:
          'Le code interne de la matière. Il se lit comme une phrase : catégorie - famille - couleur (ou origine) - réf. fournisseur - fournisseur. Recettes, mouvements et commandes le citent.',
        obligatoire: true,
        valeurs: 'Choisi à la création, il ne se modifie plus ensuite.',
      },
      { nom: 'Désignation', description: 'Le libellé lisible de la matière.', obligatoire: true },
      {
        nom: 'Description commerciale (anglais)',
        description:
          'Ce que le fournisseur lit sur le bon de commande — « 100% POLYPROPYLENE YARN 2900 DTEX ». Vide, c’est la désignation qui part à sa place.',
      },
      {
        nom: 'Catégorie matière',
        alias: ['Catégorie'],
        description:
          'La matière : polypropylène, polyester, jute, colle… En colonne et en filtre, la catégorie de la référence.',
        obligatoire: true,
      },
      {
        nom: 'Rôle',
        description:
          'Le rôle BOM habituel de la catégorie (Poil, Trame, Chaîne, Colle…), réglé sur la catégorie. Il ne se saisit pas ici.',
      },
      {
        nom: 'Famille',
        description:
          'Le produit indépendamment du vendeur, sous sa catégorie (« FIL 2650 dtex FZ »). Deux références de même famille et de même couleur interne sont le même fil chez deux fournisseurs.',
      },
      {
        nom: 'Fournisseur',
        description:
          'Le fournisseur habituel de la matière. Il se cherche à la frappe. En filtre : n’affiche que ses références.',
        obligatoire: true,
      },
      {
        nom: 'Référence fournisseur',
        alias: ['Ref. fournisseur'],
        description:
          'La référence telle que le fournisseur l’écrit sur sa facture — « GOLD 2117 », « SSL2081 ». C’est elle que la saisie assistée lit.',
      },
      {
        nom: 'Actif',
        description: 'Désactivée, la référence sort des listes de saisie mais reste lisible dans l’historique.',
        defaut: 'Oui',
      },
      {
        nom: 'Position tarifaire (SH)',
        description:
          'La nomenclature douanière de la matière, et donc son droit d’importation. Sans elle, les droits attendus d’un dossier d’import ne se calculent pas pour ses lignes.',
        valeurs: 'Positions actives (Référentiels → Positions tarifaires)',
      },
      { nom: 'Nature', description: 'Le type de fil ou de matière, en texte libre.' },
      { nom: 'Titrage', description: 'La finesse du fil, avec son unité — « 1500 dtex », « 3000 Deniers ».' },
      {
        nom: 'Couleur',
        description: 'La couleur telle qu’elle est écrite pour cette référence (texte libre, souvent le libellé du fournisseur).',
      },
      {
        nom: 'Couleur interne',
        description: 'Votre code couleur, commun à tous les fournisseurs (C1, C3, CG…), choisi dans le nuancier.',
      },
      {
        nom: 'Origine',
        description:
          'Quand la matière n’a pas de couleur — jute, colle, plastique, cuir — la provenance prend sa place dans le nom de la référence.',
      },
      {
        nom: 'Densité (kg/ml)',
        description:
          'Les kilos d’un mètre linéaire. Obligatoire pour une unité ml : sans elle, la conversion est refusée, et une qualité qui emploie la référence dans un rôle en ml/m² ne peut pas être mise en service.',
        valeurs: 'kg par mètre linéaire',
      },
      {
        nom: 'Unité de stock',
        alias: ['Unité'],
        description:
          'L’unité dans laquelle on manipule la référence. Le stock reste tenu en kilos : les autres unités sont des masques de saisie. Le lot est le bain du fournisseur, une unité d’achat.',
        obligatoire: true,
        valeurs: 'Kilogramme, Bobine, Palette, Lot (bain de production), Mètre linéaire',
      },
      {
        nom: 'Conditionnement',
        description:
          'Ce dans quoi la matière arrive, et donc le mot employé pour la compter. Tant qu’il n’est pas renseigné, l’état du stock affiche les kilos seuls.',
        valeurs: 'Bobines, Rouleaux sur palette, Petits rouleaux, Cuve IBC 1000 L, Fût 200 L, Sacs, Conteneur, Vrac',
      },
      {
        nom: 'Poids par unité (kg)',
        description:
          'Le poids net d’UNE unité de conditionnement : une bobine, un rouleau, une cuve pleine. C’est la valeur par défaut des lots : le poids mesuré à la réception sur un lot prime pour ce lot. Sans aucun poids, une saisie en bobines est refusée.',
        valeurs: 'kg',
      },
      {
        nom: 'Unités par palette',
        description:
          'Combien d’unités tiennent sur une palette complète : 120 bobines, 480 petits rouleaux, 1 cuve. Valeur par défaut des lots, comme le poids par unité.',
      },
      {
        nom: 'Suivi par lot',
        description:
          'Activé, chaque mouvement porte son lot (le bain de teinture du fournisseur) et les réglages de la section « Gestion des lots » s’appliquent.',
      },
      {
        nom: 'Type de lot',
        description:
          'D’où vient le numéro de lot à la réception. Obligatoire : sans le numéro de l’étiquette, la réception est refusée. Générique : l’ERP attribue FOURNISSEUR-JJMMAA-NN. Optionnel : le numéro du fournisseur s’il est saisi, sinon un numéro généré.',
        valeurs: 'Obligatoire, Générique, Optionnel',
        defaut: 'Optionnel',
      },
      {
        nom: 'Minimum d’un lot pour produire',
        description:
          'La quantité à partir de laquelle un lot suffit pour lancer une production. En dessous, le lot est classé en fin de lot (« Restes »).',
        valeurs: 'dans l’unité du conditionnement (bobines pour le fil) ; en kilos sans poids par unité',
        defaut: 'vide : un étage de machine, 1 344 bobines — ou 5 000 kg sans poids par unité',
      },
      {
        nom: 'Fusion de lots autorisée',
        description:
          'Permet de réunir deux lots de cette matière (même couleur, même fournisseur) en un seul. À refuser pour un fil dont les bains ne doivent jamais se mélanger.',
        defaut: 'Oui',
      },
      {
        nom: 'Mode de consommation',
        description:
          'Comment la matière sort du magasin. Machine : chargée sur les machines, elle sort par leurs fiches. Directe : jute, latex, plastique… sortent par une « Consommation directe », au CMUP du magasin.',
        valeurs: 'Machine, Directe',
        defaut: 'Machine',
      },
      {
        nom: 'Stock minimum (kg)',
        alias: ['Stock min.'],
        description:
          'Le seuil sous lequel la référence est signalée CRITIQUE dans la situation du stock. Vide : un minimum calculé (formule F3, à partir de la couverture minimale, de la consommation, de la marge et du délai) ; la liste affiche alors « dynamique ».',
        valeurs: 'kg',
      },
      {
        nom: 'Couverture minimale (mois)',
        description: 'Le nombre de mois de consommation que le minimum calculé (F3) doit couvrir. Vide : le paramètre général.',
      },
      {
        nom: 'Marge de sécurité (%)',
        description: 'Majore le stock minimum calculé de cette référence. Vide : la valeur générale des paramètres s’applique.',
        valeurs: 'pourcentage',
      },
      {
        nom: 'Prix par unité',
        alias: ['Prix'],
        description:
          'Le tarif du fournisseur, dans SA devise et par unité de stock. Ce n’est pas le coût moyen. En liste, l’unité est écrite : « 2,500 USD/kg ».',
        obligatoire: true,
      },
      { nom: 'Devise', description: 'La devise du prix catalogue.', obligatoire: true },
      {
        nom: 'Date du prix catalogue',
        description: 'Depuis quand ce tarif est annoncé : un prix sans date ne dit pas s’il date du mois dernier ou de trois ans.',
      },
      {
        nom: 'Supplément de teinture',
        description:
          'Ce que le fournisseur facture en plus pour teindre cette couleur, en devise par tonne (100, 150, 530…). Information d’achat : il ne s’ajoute pas tout seul au prix.',
        valeurs: 'devise du fournisseur par tonne',
      },
      {
        nom: 'Quantité minimale de commande (kg)',
        description:
          'La quantité minimale que le fournisseur accepte. Le moteur de couverture (plan d’achat, « Commander ») relève une proposition plus petite à ce minimum.',
        valeurs: 'kg',
      },
      {
        nom: 'Arrondi à la palette pleine',
        description:
          'Coché, le plan d’achat complète la commande jusqu’à la palette pleine ; les kilos ajoutés sont le « complément de palette », affiché à part. Poids d’une palette = poids par unité × unités par palette.',
        defaut: 'Non',
      },
      {
        nom: 'CMUP',
        description:
          'Le coût moyen unitaire pondéré, en MAD. Au kilo ; pour une référence vendue dans une autre unité (ml…), ramené à cette unité, le kilo restant en infobulle.',
      },
      { nom: 'Stock (kg)', description: 'Le stock total de la référence, tous magasins, en kilos.' },
      { nom: 'ABC', description: 'La classe ABC de la référence, suivie de sa classe XYZ (par exemple « AX »).' },
      {
        nom: 'État',
        description: 'Filtre : références actives, désactivées (mises de côté), ou toutes.',
        defaut: 'Actives',
      },
    ],
    regles: [
      'Le kilogramme est l’unité canonique : bobines, palettes, mètres ne sont que des masques de saisie. Un facteur manquant fait échouer la saisie, jamais de repli sur ×1.',
      'Le conditionnement est par lot : le poids de bobine et les bobines par palette d’un lot, mesurés à la réception, priment sur ceux de la fiche ; la fiche donne la valeur par défaut.',
      'La Référence ne se renomme jamais : elle est la clé de toutes les références croisées.',
      'Les colonnes et champs de prix n’existent pas pour un profil qui n’a pas le droit de les voir : ni en-tête, ni cellule, ni donnée envoyée. Un bandeau le dit.',
      REGLE_SUPPRESSION,
      '« Supprimer définitivement » n’aboutit que si la référence n’a jamais servi : ni mouvement, ni recette, ni ligne de bon ou de réception, ni proposition d’achat, ni historique de prix, ni inventaire, ni stock. Son rattachement à un groupe d’équivalence ne la retient pas.',
    ],
    messages: [
      {
        message: '… ne peut pas etre supprimee : elle est retenue par … Desactivez-la plutot, son passage doit rester lisible.',
        cause: '« Supprimer définitivement » sur une référence qui a déjà servi. Utilisez « Supprimer… » → « Mettre de côté ».',
      },
      {
        message: 'Champ obligatoire à renseigner : …',
        cause: 'Un champ marqué * est vide (Référence, Désignation, Catégorie matière, Fournisseur, Unité de stock, Prix par unité, Devise).',
      },
      {
        message: 'La référence … a ete modifie par … pendant votre saisie. Rouvrez-le pour voir ses changements, puis refaites les votres.',
        cause: 'Quelqu’un a enregistré la fiche entre son ouverture et votre enregistrement.',
      },
    ],
    liens: [
      { route: '/catalogue/completer', libelle: 'Compléter les références' },
      { route: '/categories', libelle: 'Catégories et familles' },
      { route: '/couleurs', libelle: 'Couleurs' },
      { route: '/equivalences', libelle: 'Équivalences' },
      { route: '/fournisseurs', libelle: 'Fournisseurs' },
    ],
  },

  /* ======================================================================= */
  /* /catalogue/completer                                                    */
  /* ======================================================================= */
  {
    route: '/catalogue/completer',
    titre: 'Compléter les références',
    chemin: 'Accès par l’adresse /catalogue/completer (aucune entrée de menu)',
    objectif:
      'Remplir la famille, la couleur interne, la référence fournisseur, le titrage, le code couleur du fournisseur et le conditionnement des références, à partir de ce que leur code et leurs références sœurs contiennent déjà.',
    prerequis: [
      'Les familles existent sous leur catégorie, avec leur titrage (Catégories et familles).',
      'Les couleurs internes et leurs codes fournisseur existent (Couleurs).',
    ],
    droits: 'Module Catalogue : LIRE pour voir les propositions, ÉCRIRE pour les enregistrer.',
    procedures: [
      {
        titre: 'Accepter ou corriger les propositions',
        etapes: [
          'Lisez les pastilles en tête : références, familles déduites, couleurs reconnues, réf. fournisseur lues, et ce qui manque (sans prix, sans conditionnement, sans code couleur fournisseur).',
          'Lisez le bandeau : il cite les couleurs écrites sur les références que le nuancier ne connaît pas. Créez-les dans Couleurs, ou choisissez la couleur interne équivalente sur la ligne.',
          'Une case encadrée en bleu est une valeur PROPOSÉE (déduite, à vérifier) ; en rouge, une valeur qui manque. Sous chaque référence, « manque : … » nomme ce qui reste à trouver.',
          'Corrigez au besoin la ligne et sa rangée du dessous (Réf. fournisseur, Origine, Titrage, Code couleur frs).',
          'Enregistrez une ligne par son bouton ✓, ou tout le lot par « Accepter les N propositions ».',
        ],
        resultat: 'Les références portent leur classement ; une ligne complète quitte la vue « À compléter ».',
      },
    ],
    champs: [
      {
        nom: 'Référence',
        description: 'La référence à compléter, avec sa catégorie, sa couleur écrite et son titrage, puis ce qui lui manque.',
      },
      {
        nom: 'Famille',
        description:
          'Déduite de la catégorie et du titrage : proposée seulement quand UNE seule famille de la catégorie correspond. Sinon « — à choisir — » parmi les familles possibles.',
      },
      {
        nom: 'Couleur interne',
        description:
          'Déduite du libellé de couleur déjà saisi, puis des codes couleur de ce fournisseur. Sans correspondance, rien n’est choisi à votre place.',
      },
      {
        nom: 'Prix',
        description:
          'Le prix catalogue. Il ne se déduit jamais d’une référence voisine : la case reste vide et se signale en rouge tant qu’il manque.',
      },
      {
        nom: 'Poids bob.',
        description:
          'Le poids d’une bobine, proposé quand toutes les références de même famille chez le même fournisseur s’accordent sur une valeur.',
        valeurs: 'kg',
      },
      {
        nom: 'Bob./pal.',
        description: 'Le nombre de bobines par palette, proposé de la même façon que le poids de bobine.',
      },
      {
        nom: 'Réf. fournisseur',
        description:
          'Lue dans le code interne : le dernier groupe de chiffres et son préfixe. Un titrage n’est jamais pris pour une référence (« Plastique-100 », « Jute 12/1 » restent vides).',
      },
      { nom: 'Origine', description: 'À saisir quand la matière n’a pas de couleur (jute, colle, plastique, cuir).' },
      { nom: 'Titrage', description: 'Proposé depuis la famille retenue, quand la référence n’en a pas.' },
      {
        nom: 'Code couleur frs',
        description:
          'Le code que le fournisseur donne à cette couleur, lu dans la table des couleurs du fournisseur pour la couleur interne retenue. C’est lui que le bon de commande imprime.',
      },
    ],
    regles: [
      'L’assistant propose, il n’écrit pas : rien ne part tant que vous n’avez pas cliqué.',
      'Une case vide n’efface jamais la valeur existante : seul ce qui est renseigné est envoyé.',
      '« Complète » veut dire « identifiée » : famille, couleur interne (ou origine) et référence fournisseur posées. Une référence complète peut encore manquer de prix ou de conditionnement.',
      'Le filtre « À compléter / Toutes les références » choisit les lignes affichées.',
    ],
    exemples: [
      {
        titre: 'ce que l’assistant écrit, et ce qu’il laisse',
        situation: 'Une référence PP au titrage « 1500 dtex », sans famille, sans prix.',
        calcul: [
          ['Une seule famille PP au titrage 1500 dtex', 'Famille proposée (cadre bleu)'],
          ['Prix', 'vide, en rouge : « manque : prix »'],
          ['« Accepter les propositions »', 'écrit la famille ; le prix reste à saisir'],
        ],
        conclusion: 'Compléter classe la référence ; cela ne la rend pas commandable si son prix manque, et ne crée aucun besoin.',
      },
    ],
    liens: [
      { route: '/catalogue', libelle: 'Références' },
      { route: '/couleurs', libelle: 'Créer une couleur interne' },
      { route: '/categories', libelle: 'Créer une famille' },
    ],
  },

  /* ======================================================================= */
  /* /categories                                                             */
  /* ======================================================================= */
  {
    route: '/categories',
    titre: 'Catégories et familles',
    chemin: 'Fiches de base → Catégories et familles',
    objectif:
      'Tenir les catégories de matière et, sous chacune, ses familles — le titrage sur lequel l’atelier raisonne.',
    droits: 'Module Catalogue : LIRE pour consulter, ÉCRIRE pour créer, modifier ou retirer.',
    procedures: [
      {
        titre: 'Créer une catégorie',
        etapes: [
          'Au bas de la liste de gauche, tapez le Code et le Libellé.',
          'Cliquez « + Catégorie » : la nouvelle catégorie est pointée.',
          'Choisissez son « Rôle BOM habituel » dans l’en-tête de droite.',
        ],
        resultat: 'La catégorie est proposée sur la fiche référence.',
      },
      {
        titre: 'Ajouter une famille à une catégorie',
        etapes: [
          'Pointez la catégorie dans la liste de gauche.',
          'Sur la dernière ligne du tableau de droite, tapez le Code, le Libellé et le Titrage.',
          'Cliquez « + » (ou Entrée) : la ligne est enregistrée aussitôt.',
          'Une cellule existante se corrige en tapant dedans : elle s’enregistre en quittant la case.',
        ],
        resultat: 'La famille est proposée sur la fiche référence et par l’assistant de complétion.',
      },
    ],
    champs: [
      {
        nom: 'Code',
        description: 'L’identifiant de la catégorie ou de la famille (« FIL-2650-FZ »). Il ne se modifie plus après création.',
        obligatoire: true,
      },
      { nom: 'Libellé', description: 'Le nom lisible — « FIL 2650 dtex FZ ».', obligatoire: true },
      {
        nom: 'Rôle BOM habituel',
        description:
          'La place normale de cette matière dans un tapis. Il s’affiche en colonne « Rôle » du catalogue et limite, dans une qualité, le choix des matières d’un rôle à ses catégories.',
        valeurs: 'Poil, Trame, Chaîne, Colle, Cuir, Franges, Plastique, Ruban',
      },
      {
        nom: 'Titrage',
        description:
          'La grosseur du fil, avec son unité. C’est par lui que l’assistant rattache une référence à sa famille.',
        valeurs: 'ex. « 2650 dtex », « 3000 Deniers », « 20/2 »',
      },
    ],
    regles: [
      'Une famille se crée toujours sous la catégorie pointée.',
      'La liste de gauche ne montre que les catégories actives ; le compteur dit combien de familles chacune porte.',
      REGLE_SUPPRESSION,
    ],
    exemples: [
      {
        titre: 'une famille sous sa catégorie',
        situation: 'Catégorie Polypropylène pointée ; dernière ligne : FIL-2900-FRZ, « FIL 2900 dtex FRZ », 2900 dtex.',
        conclusion: 'La famille naît rattachée à la catégorie pointée ; une référence PP au titrage 2900 dtex sera proposée dans cette famille.',
      },
    ],
    liens: [
      { route: '/catalogue/completer', libelle: 'Compléter les références' },
      { route: '/etats/categories', libelle: 'Imprimer catégories et familles' },
    ],
  },

  /* ======================================================================= */
  /* /couleurs                                                               */
  /* ======================================================================= */
  {
    route: '/couleurs',
    titre: 'Couleurs',
    chemin: 'Accès par l’adresse /couleurs (aucune entrée de menu)',
    objectif:
      'Tenir le nuancier de la maison, et rattacher à chaque couleur le code que CHAQUE fournisseur lui donne.',
    droits: 'Module Catalogue : LIRE pour consulter, ÉCRIRE pour créer, modifier ou retirer.',
    procedures: [
      {
        titre: 'Déclarer une couleur et ses codes fournisseur',
        etapes: [
          'Au bas de la liste de gauche, tapez le Code et le Libellé, puis « + Couleur ».',
          'La couleur pointée, choisissez sa « Classe de teinture » dans l’en-tête de droite.',
          'Sur la dernière ligne du tableau : cherchez le Fournisseur, tapez son code et son libellé, le supplément ; cliquez « + ».',
        ],
        resultat:
          'L’assistant de complétion reconnaît cette couleur chez ce fournisseur et propose son code sur les références ; c’est ce code que le bon de commande imprime.',
      },
      {
        titre: 'Imprimer',
        etapes: [
          'Icône imprimante en tête de liste : le nuancier complet.',
          'Icône imprimante sur la couleur pointée : sa fiche avec tous ses codes fournisseur.',
        ],
      },
    ],
    champs: [
      {
        nom: 'Code',
        description: 'Le code interne de la couleur, court et stable — « C3 ». Il ne se modifie plus après création.',
        obligatoire: true,
      },
      { nom: 'Libellé', description: 'Le nom lisible — « Rouge ».', obligatoire: true },
      {
        nom: 'Classe de teinture',
        description: 'Le groupe de teinture de la couleur.',
        valeurs: 'Claire, Moyenne, Sombre, Rouge',
      },
      {
        nom: 'Fournisseur',
        description: 'À qui appartient le code de cette ligne. Il se cherche à la frappe parmi les fournisseurs.',
        obligatoire: true,
      },
      {
        nom: 'Code chez lui',
        description: 'Le code que CE fournisseur emploie pour cette couleur, tel qu’il figure sur sa facture — « RED 7612 ».',
        obligatoire: true,
      },
      { nom: 'Son libellé', description: 'Le nom que le fournisseur donne à la couleur — « ROUGE ».' },
      {
        nom: 'Supplément ($/t)',
        description: 'Le surcoût de teinture annoncé par ce fournisseur, par tonne. Information d’achat : il n’entre dans aucun calcul.',
        valeurs: 'par tonne',
      },
    ],
    regles: [
      'Un même fournisseur peut porter plusieurs codes pour une couleur : chacun est une ligne.',
      'Le code d’un fournisseur arrive sur une référence par l’assistant de complétion (colonne « Code couleur frs ») ; le bon de commande imprime le code porté par la référence.',
      REGLE_SUPPRESSION,
    ],
    liens: [
      { route: '/etats/couleurs', libelle: 'Imprimer le nuancier' },
      { route: '/catalogue/completer', libelle: 'Compléter les références' },
      { route: '/catalogue', libelle: 'Références' },
    ],
  },

  /* ======================================================================= */
  /* /roles-bom                                                              */
  /* ======================================================================= */
  {
    route: '/roles-bom',
    titre: 'Rôles BOM',
    chemin: 'Fiches de base → Rôles BOM',
    objectif:
      'Tenir la liste des rôles qu’une matière peut tenir dans un tapis — poil, trame, chaîne, colle… La densité de chaque rôle se saisit sur la qualité, pas ici.',
    droits: 'Module Catalogue : LIRE pour consulter, ÉCRIRE pour créer, modifier ou retirer.',
    procedures: [
      {
        titre: 'Créer un rôle',
        etapes: [
          'Cliquez « Nouveau ».',
          'Saisissez le Code et le Libellé, une description si utile, l’ordre d’affichage.',
          'Cliquez « Créer ».',
        ],
        resultat: 'Le rôle actif est proposé dans les densités par rôle des qualités.',
      },
    ],
    champs: [
      { nom: 'Code', description: 'L’identifiant du rôle (POIL, TRAME…). Il ne se modifie plus après création.', obligatoire: true },
      { nom: 'Libellé', description: 'Le nom lisible du rôle.', obligatoire: true },
      { nom: 'Description', description: 'Ce que le rôle désigne dans le tapis.' },
      { nom: 'Ordre d’affichage', description: 'Le rang du rôle dans les listes.', valeurs: 'entier' },
      { nom: 'Actif', description: 'Inactif, le rôle n’est plus proposé dans les qualités.', defaut: 'Oui' },
      { nom: 'Qualites', description: 'Le nombre de qualités qui déclarent une densité pour ce rôle.' },
    ],
    regles: [
      'Le choix « Rôle BOM habituel » d’une catégorie propose une liste fixe de huit rôles (Poil, Trame, Chaîne, Colle, Cuir, Franges, Plastique, Ruban) : un rôle créé ici ne s’y ajoute pas.',
      REGLE_SUPPRESSION,
    ],
    liens: [{ route: '/qualites', libelle: 'Qualités' }],
  },

  /* ======================================================================= */
  /* /referentiels                                                           */
  /* ======================================================================= */
  {
    route: '/referentiels',
    titre: 'Référentiels',
    chemin: 'Accès par l’adresse /referentiels (aucune entrée de menu) ; choisir l’onglet dans le rail',
    objectif:
      'Tenir les listes de base, un onglet chacune : catégories, couleurs, rôles BOM, magasins, groupes d’équivalence, types et motifs de mouvement, motifs de retour, types de frais, positions tarifaires ; et consulter les rôles utilisateur et la machine à états.',
    droits:
      'Chaque onglet suit son module : Catalogue (catégories, couleurs, rôles BOM, groupes), Stock (magasins), Mouvements (motifs), Paramètres (types de mouvement, types de frais, positions tarifaires, rôles utilisateur, machine à états). LIRE pour voir, ÉCRIRE pour créer ou modifier.',
    procedures: [
      {
        titre: 'Tenir une liste (magasins, types et motifs de mouvement, motifs de retour, types de frais, positions tarifaires)',
        etapes: [
          'Choisissez l’onglet dans le rail « À tenir ».',
          '« Nouveau » ouvre la fiche en page ; « Modifier » par le menu « ⋯ » de la ligne.',
          'Remplissez les champs marqués *, puis « Créer » ou « Enregistrer ».',
        ],
        resultat: 'La ligne est proposée dans les écrans qui l’emploient.',
      },
      {
        titre: 'Catégories, couleurs, rôles BOM, groupes d’équivalence',
        etapes: [
          'Ces onglets ouvrent les mêmes écrans que Catégories et familles, Couleurs, Rôles BOM et Équivalences : voir leurs fiches.',
        ],
      },
      {
        titre: 'Ouvrir ou fermer une transition (Machine à états)',
        etapes: [
          'Filtrez par « Entite » au besoin.',
          '« Ouvrir une transition » : choisissez l’entité, tapez le statut de départ et le statut d’arrivée (en majuscules), le rôle requis et une description, puis « Ouvrir ».',
          'Pour fermer un chemin, la corbeille de sa ligne, puis « Fermer ce chemin ».',
        ],
        resultat:
          'Le passage est autorisé, ou retiré : le bouton correspondant apparaît ou disparaît dans l’application. Si un statut n’a plus aucune sortie, un avertissement le dit.',
      },
    ],
    champs: [
      {
        nom: 'Code',
        description: 'L’identifiant de la ligne. Il se choisit à la création et ne se modifie plus.',
        obligatoire: true,
      },
      { nom: 'Libellé', description: 'Le nom lisible de la ligne.', obligatoire: true },
      { nom: 'Description', description: 'Une précision libre (rôles BOM, machine à états).' },
      { nom: 'Actif', alias: ['Active'], description: 'Inactive, la ligne n’est plus proposée en saisie mais reste lisible.', defaut: 'Oui' },
      { nom: 'Ordre d’affichage', description: 'Le rang de la ligne dans les listes.', valeurs: 'entier' },
      { nom: 'Nom', description: 'Magasins : le nom du magasin.', obligatoire: true },
      { nom: 'Type', description: 'Magasins : le type du magasin, en texte libre.' },
      { nom: 'Responsable', description: 'Magasins : la personne responsable.' },
      { nom: 'Adresse', description: 'Magasins : l’adresse.' },
      {
        nom: 'Compte dans le stock disponible',
        description: 'Magasins : décoché, le magasin est exclu du calcul de couverture et du plan d’achat.',
      },
      {
        nom: 'Zone de quarantaine',
        description: 'Magasins : destination imposée des réceptions non conformes. Exclut automatiquement du calcul des besoins.',
      },
      { nom: 'Regime', description: 'Magasins : quarantaine, et « compte au MRP » ou « hors MRP ».' },
      { nom: 'En stock', description: 'Magasins : le nombre de références qui y ont du stock.' },
      {
        nom: 'Sens',
        description:
          'Types de mouvement : entrée (+) ou sortie (−). Figé à la création : les mouvements déjà enregistrés ont été appliqués avec ce sens.',
        obligatoire: true,
        valeurs: 'Entrée (+), Sortie (−)',
      },
      { nom: 'Couleur', description: 'Types de mouvement : la couleur d’affichage, en code hexadécimal (#10b981).' },
      { nom: 'Exige un prix', alias: ['Prix exige'], description: 'Types de mouvement : la saisie demande un prix.' },
      {
        nom: 'Impacte le CMUP',
        description: 'Types de mouvement : le mouvement recalcule le coût moyen. Figé à la création.',
      },
      { nom: 'Exige un numéro d’OF', alias: ['OF exige'], description: 'Types de mouvement : la saisie demande un ordre de fabrication.' },
      { nom: 'Exige un motif de ligne', description: 'Types de mouvement : chaque ligne doit porter un motif.' },
      { nom: 'Mouvements', description: 'Types de mouvement : le nombre de mouvements de ce type.' },
      {
        nom: 'Catégorie',
        description:
          'Motifs : le classement du motif (texte libre ; obligatoire pour un motif de mouvement). Types de frais : Douane, Taxe, Transport, Port, Transit ou Autre (obligatoire).',
      },
      {
        nom: 'Sens habituel',
        description: 'Motifs de mouvement : le sens proposé à la saisie. Il n’impose rien : le type de mouvement fait foi. Figé à la création.',
        obligatoire: true,
        valeurs: 'Entrée (+), Sortie (−)',
      },
      {
        nom: 'Pièce justificative',
        description: 'Types de frais : le document qui porte ce frais — quittance de douane, facture du transitaire.',
      },
      {
        nom: 'Recuperable',
        description:
          'Types de frais : la TVA à l’importation se récupère ; elle se saisit pour que le dossier balance mais n’entre jamais dans le coût de revient.',
      },
      {
        nom: 'Entre dans le coût de revient',
        alias: ['Dans le cout'],
        description: 'Types de frais : le frais s’ajoute au coût de la marchandise. Un frais récupérable ne peut pas y entrer.',
        defaut: 'Oui',
      },
      {
        nom: 'Commun au dossier',
        alias: ['Commun'],
        description: 'Types de frais : réparti sur toutes les lignes du dossier ; sinon la saisie demande sur quelles lignes il porte.',
        defaut: 'Oui',
      },
      {
        nom: 'Méthode de répartition',
        alias: ['Repartition'],
        description:
          'Types de frais : comment le frais se partage entre les lignes. Au taux des droits : chaque ligne porte la douane au prorata de ses droits attendus (valeur en douane × taux de sa position tarifaire).',
        valeurs: 'À la valeur, Au poids, À la quantité, À parts égales, Au taux des droits',
        defaut: 'À la valeur',
      },
      {
        nom: 'Entre dans la valeur en douane',
        alias: ['Valeur en douane'],
        description:
          'Types de frais : la part de ce frais s’ajoute à la valeur qui calcule les droits attendus (valeur CAF). Incompatible avec une répartition au taux des droits.',
      },
      { nom: 'Employe', description: 'Types de frais : le nombre de lignes de frais de dossier qui citent ce type.' },
      {
        nom: 'Code SH / NGP',
        alias: ['Code SH'],
        description: 'Positions tarifaires : le code douanier, de 6 à 10 chiffres sans points ni espaces — 5402200000.',
        obligatoire: true,
      },
      {
        nom: 'Droit d’importation (%)',
        alias: ['Droit (%)'],
        description:
          'Positions tarifaires : en pour cent de la valeur en douane. Modifié, il recalcule les droits attendus des dossiers ouverts ; un dossier clôturé garde ce qu’il a porté au CMUP.',
        obligatoire: true,
        valeurs: '0 à 100',
      },
      { nom: 'Notes', description: 'Positions tarifaires : une note libre.' },
      { nom: 'Références', description: 'Le nombre de références qui citent la ligne.' },
      { nom: 'Comptes', description: 'Rôles utilisateur : le nombre de comptes qui portent ce rôle.' },
      { nom: 'Modules', description: 'Rôles utilisateur : le nombre de modules où le rôle a une permission.' },
      { nom: 'Permissions', description: 'Rôles utilisateur : le nombre de permissions accordées.' },
      { nom: 'Entite', description: 'Machine à états : le document concerné (bon de commande, réception, qualité…).', obligatoire: true },
      { nom: 'De', description: 'Machine à états : le statut de départ.' },
      { nom: 'Vers', description: 'Machine à états : le statut d’arrivée.' },
      { nom: 'Statut de départ', description: 'Le statut d’où part le passage, en majuscules (VALIDE).', obligatoire: true },
      { nom: 'Statut d’arrivée', description: 'Le statut où arrive le passage, en majuscules (ENVOYE).', obligatoire: true },
      { nom: 'Rôle requis', description: 'Machine à états : le rôle autorisé à faire le passage. Vide : tout rôle.' },
      { nom: 'Rôle BOM habituel', description: 'Catégories : la place normale de la matière dans un tapis.' },
      { nom: 'Titrage', description: 'Familles : la grosseur du fil, avec son unité.' },
      { nom: 'Classe de teinture', description: 'Couleurs : Claire, Moyenne, Sombre ou Rouge.' },
      { nom: 'Fournisseur', description: 'Couleurs : le fournisseur dont on note le code.', obligatoire: true },
      { nom: 'Code chez lui', description: 'Couleurs : le code de la couleur chez ce fournisseur.', obligatoire: true },
      { nom: 'Son libellé', description: 'Couleurs : le nom de la couleur chez ce fournisseur.' },
      { nom: 'Supplément ($/t)', description: 'Couleurs : le surcoût de teinture annoncé, par tonne.' },
      { nom: 'Qualites', description: 'Rôles BOM : le nombre de qualités qui déclarent une densité pour ce rôle.' },
    ],
    regles: [
      'Les rôles utilisateur se consultent seulement : ils s’attribuent depuis l’écran Utilisateurs.',
      'Retirer une transition fait disparaître un bouton dans l’application sans autre avertissement ; une transition vers un statut que la table ne connaît pas sera refusée par sa contrainte au moment du changement, pas ici.',
      'Un frais récupérable ne peut pas entrer dans le coût de revient, et un frais réparti au taux des droits ne peut pas entrer dans la valeur en douane : la base refuse ces deux combinaisons.',
      'Le sens d’un type de mouvement, son effet sur le CMUP et le sens habituel d’un motif ne se modifient plus après création.',
      REGLE_SUPPRESSION,
    ],
    liens: [
      { route: '/categories', libelle: 'Catégories et familles' },
      { route: '/couleurs', libelle: 'Couleurs' },
      { route: '/roles-bom', libelle: 'Rôles BOM' },
      { route: '/equivalences', libelle: 'Équivalences' },
    ],
  },

  /* ======================================================================= */
  /* /equivalences                                                           */
  /* ======================================================================= */
  {
    route: '/equivalences',
    titre: 'Équivalences de références',
    chemin: 'Fiches de base → Équivalences',
    objectif: 'Voir quelles références sont interchangeables, et dans quel ordre les préférer.',
    prerequis: ['Le groupe d’équivalence existe : l’écran n’en crée pas.'],
    droits: 'Module Catalogue : LIRE pour consulter, ÉCRIRE pour rattacher, détacher et ordonner.',
    procedures: [
      {
        titre: 'Lire l’état des groupes',
        etapes: [
          'Sans groupe pointé, la colonne de droite donne le bilan : combien de groupes sont Alternatifs, Même fournisseur, Hétérogènes, Mono-référence.',
          'Filtrez par état avec les pastilles, ou cherchez un groupe par code ou libellé.',
        ],
      },
      {
        titre: 'Rattacher une référence à un groupe',
        etapes: [
          'Pointez le groupe, cliquez « Rattacher une référence ».',
          'Cherchez la référence, cochez-la, cliquez « Rattacher ».',
        ],
        resultat: 'Elle est ajoutée en dernière position ; la première d’un groupe vide devient préférentielle.',
      },
      {
        titre: 'Ordonner les substituts',
        etapes: [
          'Flèches haut/bas : monter ou descendre une référence dans l’ordre de préférence.',
          'Étoile : la rendre préférentielle (elle passe au rang 1).',
          'Corbeille : la détacher du groupe — aucun stock ni mouvement n’est touché.',
        ],
        resultat: 'La référence de rang 1 est la préférentielle ; les suivantes sont les substituts, dans l’ordre.',
      },
    ],
    champs: [
      { nom: 'Ordre', description: 'Le rang de préférence dans le groupe ; 1 = la préférentielle.' },
      { nom: 'Référence', description: 'La référence rattachée, avec sa désignation.' },
      {
        nom: 'Fournisseur',
        description: 'Son fournisseur. En couleur d’alerte quand tout le groupe vient du même fournisseur.',
      },
      {
        nom: 'Stock',
        description: 'Le stock disponible de la référence (magasins comptés au calcul des besoins), en kilos. « — » si le groupe n’a qu’une référence.',
        valeurs: 'kg',
      },
      {
        nom: 'Besoin 12 m',
        description:
          'Le besoin restant du plan de production en service (mois courant et suivants), en kilos. « stock sans besoin » signale une référence qui dort.',
        valeurs: 'kg',
      },
      { nom: 'Preference', description: '« préférentielle » pour le rang 1, « alternative » pour les autres.' },
    ],
    regles: [
      'MONO-RÉFÉRENCE : une seule référence, le groupe n’offre aucune alternative.',
      'HÉTÉROGÈNE : unité, densité ou catégorie différentes — substituer fausserait le kg/m² de la composition.',
      'MÊME FOURNISSEUR : toutes les références viennent du même fournisseur ; elles tombent ensemble.',
      'ALTERNATIF : références homogènes chez des fournisseurs distincts. Le plan d’achat ne compte une référence « multi-source » que si un équivalent vient d’un AUTRE fournisseur.',
      'Arrivée ciblée : /equivalences?reference=X pointe le groupe de X, ou dit qu’elle n’appartient à aucun groupe.',
    ],
    liens: [
      { route: '/catalogue', libelle: 'Références' },
      { route: '/referentiels', libelle: 'Référentiels' },
    ],
  },

  /* ======================================================================= */
  /* /fournisseurs                                                           */
  /* ======================================================================= */
  {
    route: '/fournisseurs',
    titre: 'Fournisseurs',
    chemin: 'Fiches de base → Fournisseurs',
    objectif:
      'Tenir la fiche de chaque fournisseur : identité, contact, devise et conditions, délais, logistique, et la tolérance accordée à la pesée.',
    droits:
      'Module Fournisseurs : LIRE pour consulter, ÉCRIRE pour créer ou corriger. La tolérance de pesée se fixe avec le droit VALIDER.',
    procedures: [
      {
        titre: 'Créer un fournisseur',
        etapes: [
          'Cliquez « Nouveau ».',
          'Identité : Code et Raison sociale. Contact : Pays (obligatoire) et coordonnées.',
          'Conditions commerciales : devise, conditions et délai de paiement, Incoterm.',
          'Logistique et réception : délai de livraison, transporteur, palettes par conteneur, tolérance de pesée.',
          'Cliquez « Créer ».',
        ],
        resultat: 'Le fournisseur est proposé sur les références, les bons de commande et les couleurs.',
      },
    ],
    champs: [
      {
        nom: 'Code',
        description: 'L’identifiant court du fournisseur, cité par le catalogue et les commandes. Non modifiable ensuite.',
        obligatoire: true,
      },
      { nom: 'Raison sociale', description: 'Le nom légal, repris sur les bons de commande.', obligatoire: true },
      { nom: 'Fournisseur', description: 'En liste : la raison sociale, et dessous le code (« désactivé » le cas échéant).' },
      {
        nom: 'Actif',
        description: 'Décoché, le fournisseur sort des listes de saisie sans rien effacer.',
        defaut: 'Oui',
      },
      { nom: 'Contact', description: 'La personne à joindre.' },
      { nom: 'Téléphone', description: 'Le téléphone du contact.' },
      { nom: 'Email', description: 'L’adresse électronique du contact.' },
      { nom: 'Ville', description: 'La ville du fournisseur.' },
      { nom: 'Pays', description: 'Le pays du fournisseur.', obligatoire: true },
      { nom: 'Adresse', description: 'L’adresse postale.' },
      {
        nom: 'Devise de facturation',
        alias: ['Devise'],
        description: 'La devise dans laquelle il facture.',
      },
      { nom: 'Conditions de paiement', alias: ['Paiement'], description: 'La formule convenue — acompte, lettre de crédit, à vue.' },
      {
        nom: 'Délai de paiement (jours)',
        description: 'Les jours accordés pour régler. Il alimente le DPO du tableau de bord.',
        valeurs: 'jours',
      },
      { nom: 'Incoterm', description: 'Le partage des frais et du risque jusqu’à la livraison — FOB, CIF, EXW.' },
      {
        nom: 'Délai de livraison (jours)',
        alias: ['Délai'],
        description:
          'Les jours entre la commande et l’arrivée. Le moteur de couverture en déduit la date limite de commande, et il entre dans le stock minimum calculé (F3).',
        valeurs: 'jours, au moins 1',
      },
      { nom: 'Transporteur', description: 'Le transporteur habituel.' },
      {
        nom: 'Palettes par conteneur',
        description: 'Combien de palettes entrent dans un conteneur chez ce fournisseur : le bon de commande en déduit le nombre de conteneurs à annoncer.',
        valeurs: 'entier, au moins 1',
      },
      {
        nom: 'Tolérance de pesée (%)',
        description:
          'L’EXCÉDENT admis entre le poids pesé et le reste à recevoir. Au-delà, la réception exige une dérogation nominative. Un manque dans la tolérance solde la ligne du bon ; au-delà, un reliquat reste à recevoir. Vide : le paramètre P_TolerEcartPesee (2 %).',
        valeurs: 'pourcentage',
      },
      { nom: 'Note globale (/100)', description: 'L’appréciation du fournisseur : délais, conformité, réactivité.', valeurs: '0 à 100' },
      { nom: 'Références', description: 'Le nombre de références actives rattachées au fournisseur.' },
    ],
    regles: [
      'La tolérance de pesée est un seuil de contrôle : la modifier exige le droit VALIDER du module. Corriger un autre champ de la fiche ne le demande pas.',
      'Le rattachement d’une référence à un fournisseur est une habitude d’achat, pas une exclusivité.',
      REGLE_SUPPRESSION,
    ],
    messages: [
      {
        message: 'tolerance_pesee_pct est un seuil de controle : il se fixe avec le droit de valider (FOURNISSEURS). Demandez-le a la Direction.',
        cause: 'La tolérance de pesée a été changée par un compte qui n’a pas le droit VALIDER sur les fournisseurs.',
      },
    ],
    liens: [
      { route: '/catalogue', libelle: 'Références' },
      { route: '/etats/fournisseurs', libelle: 'Imprimer la liste' },
    ],
  },

  /* ======================================================================= */
  /* /qualites                                                               */
  /* ======================================================================= */
  {
    route: '/qualites',
    titre: 'Qualités',
    chemin: 'Production → Qualités',
    objectif:
      'Décrire chaque qualité de tapis : combien de matière par m² pour chaque rôle (densités), et quelles références la composent dans quelles proportions.',
    prerequis: [
      'Les rôles BOM existent (Fiches de base → Rôles BOM).',
      'Les références employées existent au catalogue ; une référence d’un rôle en ml/m² porte sa densité (kg/ml).',
    ],
    droits:
      'Module Qualités : LIRE pour consulter, ÉCRIRE pour créer, modifier, dupliquer, supprimer. Ramener une qualité ACTIVE en Brouillon exige VALIDER ; rouvrir une qualité clôturée passe par « Dévalider » (motif, droit VALIDER).',
    procedures: [
      {
        titre: 'Créer une qualité',
        etapes: [
          'Cliquez « + » (Nouvelle qualité).',
          'En-tête : Code qualité et Nom ; les paramètres de planification sont recopiés des paramètres généraux.',
          'Onglet « Densité par rôle » : « Ajouter une ligne » par rôle, puis la densité et l’unité (kg/m² ou ml/m²).',
          'Onglet « Composition » : « Ajouter une matière », choisissez la référence (loupe), le rôle et le pourcentage.',
          'Cliquez « Enregistrer la qualité » : en-tête, densités et composition partent en une seule fois.',
        ],
        resultat: 'La qualité est en Brouillon ; son poids commercial est recalculé par le serveur.',
      },
      {
        titre: 'Mettre une qualité en service',
        etapes: [
          'Statut → Actif.',
          'Vérifiez au pied de page « À corriger » : chaque rôle composé doit totaliser 100 %.',
          '« Enregistrer la qualité ».',
        ],
        resultat: 'La qualité ACTIVE peut être retenue par un plan de production.',
      },
      {
        titre: 'Changer une composition en service',
        etapes: [
          'Dans la liste, icône « Dupliquer » : la copie reprend en-tête, densités et composition, sans code, en Brouillon.',
          'Donnez un nouveau code, corrigez, enregistrez, puis mettez-la en service.',
        ],
        resultat: 'Une qualité = une composition : l’ancienne reste intacte pour les plans qui la citent.',
      },
      {
        titre: 'Retirer une qualité',
        etapes: [
          'Corbeille de la ligne : si aucun plan ne la cite, elle est supprimée avec ses densités et sa composition ; sinon elle est clôturée.',
        ],
      },
    ],
    champs: [
      {
        nom: 'Code qualité',
        alias: ['Code'],
        description: 'L’identifiant de la qualité, cité par les compositions et les plans. Saisi en majuscules ; il ne se renomme pas.',
        obligatoire: true,
      },
      { nom: 'Nom', description: 'La désignation commerciale.', obligatoire: true },
      {
        nom: 'Statut',
        description: 'Brouillon : en préparation. Actif : planifiable. Clôture : consultable, plus modifiable.',
        valeurs: 'Brouillon, Actif, Clôture',
        defaut: 'Brouillon',
      },
      { nom: 'Description', description: 'Usage, machine, particularités de fabrication.' },
      {
        nom: 'Marge sécurité %',
        description: 'Paramètre de planification propre à la qualité, recopié de P_MargeSecurite à la création.',
        valeurs: 'pourcentage',
      },
      {
        nom: 'Taux de perte %',
        alias: ['Perte %'],
        description:
          'Le taux de perte noté sur la qualité, recopié de P_TauxPerte à la création. Le besoin d’un plan applique le taux de perte DU PLAN.',
        valeurs: 'pourcentage',
      },
      { nom: 'Couverture min. (mois)', description: 'Paramètre de planification propre à la qualité, recopié de P_CouvMinMois à la création.' },
      {
        nom: 'Seuil alerte (j)',
        description: 'Paramètre de planification, recopié de P_SeuilAlerte. Doit dépasser le seuil critique.',
        valeurs: 'jours, plus de 0',
      },
      { nom: 'Seuil critique (j)', description: 'Paramètre de planification, recopié de P_SeuilCritique. Inférieur au seuil d’alerte.', valeurs: 'jours, plus de 0' },
      { nom: 'Sécurité (j)', description: 'Stock de sécurité en jours, recopié de P_SecuriteA à la création.', valeurs: 'jours' },
      {
        nom: 'Rôle BOM',
        description:
          'Densités : le rôle (une ligne par rôle). Composition : le rôle de la matière, parmi ceux qui ont une densité.',
        obligatoire: true,
      },
      {
        nom: 'Densité',
        description: 'Combien de matière ce rôle consomme par m² de tapis.',
        obligatoire: true,
        valeurs: 'strictement positive, dans l’unité de la ligne',
      },
      {
        nom: 'Unité',
        description: 'kg/m² : entre dans le poids commercial. ml/m² : consomme de la matière hors poids commercial, convertie en kilos par la densité kg/ml de la référence.',
        valeurs: 'kg/m², ml/m²',
        defaut: 'kg/m²',
      },
      { nom: 'Poids commercial', description: '« inclus » pour une ligne en kg/m², « hors poids » pour une ligne en ml/m².' },
      {
        nom: 'Référence',
        description: 'La matière. Le choix se cherche ; il ne propose d’abord que les matières des catégories du rôle (case à décocher pour tout le catalogue).',
        obligatoire: true,
      },
      { nom: 'Type', description: 'La nature de la matière, lue au catalogue.' },
      { nom: 'Fournisseur', description: 'Le fournisseur de la référence, lu au catalogue.' },
      {
        nom: '%',
        description: 'La part de cette matière dans son rôle. Par rôle, les parts doivent totaliser 100 % (à 0,5 point près) pour la mise en service.',
        obligatoire: true,
        valeurs: 'plus de 0, jusqu’à 100',
      },
      {
        nom: 'kg/m²',
        description:
          'En liste : le poids commercial de la qualité (somme des densités en kg/m²). En composition : densité du rôle × % de la ligne ; vide pour un rôle en ml/m².',
      },
      {
        nom: 'Prix MAD/kg',
        description: 'Le prix de la référence au kilo, en MAD : son CMUP s’il existe, sinon le prix catalogue converti au taux en vigueur.',
      },
      { nom: 'Devise', description: 'La devise du prix catalogue de la référence.' },
      { nom: 'Coût MAD/m²', description: 'kg/m² × prix MAD/kg : ce que la ligne coûte par m². Calculé, il ne se saisit pas.' },
      { nom: 'Couleur', description: 'Une précision de couleur sur la ligne de composition, en texte libre.' },
      { nom: 'Lignes', description: 'Le nombre de rôles déclarés (lignes de densité).' },
      {
        nom: 'Composition',
        description: '« aucune ligne », « n rôle(s) hors 100 % », ou le nombre de lignes et de rôles composés.',
      },
      { nom: 'Modifiee le', description: 'La date de dernière modification, sinon de création.' },
      { nom: 'Roles a 100 %', description: 'Cohérence des recettes : rôles conformes / rôles déclarés.' },
      { nom: 'Roles a corriger', description: 'Cohérence des recettes : les rôles fautifs.' },
      {
        nom: 'Nature',
        description: 'Cohérence des recettes : « composition jamais saisie » (rôle avec densité sans matière) ou « somme différente de 100 % ».',
      },
    ],
    regles: [
      'Une qualité = une composition : pas de versionnement. Pour changer la composition d’une qualité en service, dupliquez-la sous un nouveau code.',
      'Une matière ne figure qu’une seule fois dans une qualité, tous rôles confondus.',
      'On ne compose qu’un rôle qui a une densité, et on ne retire pas la densité d’un rôle encore composé.',
      'Le poids commercial est la somme des densités en kg/m² ; le serveur le recalcule à chaque enregistrement.',
      'Composition verrouillée tant que la qualité est produite par le plan en service.',
      'Une qualité active ou clôturée ne recule pas avec le seul droit ÉCRIRE.',
      'Le bloc « Cohérence des recettes », sous la liste, s’ouvre de lui-même quand une qualité est à corriger.',
    ],
    messages: [
      {
        message: 'R07 : la somme des pourcentages de composition doit valoir 100% pour chaque role BOM.',
        cause: 'Mise en service avec un rôle dont les parts ne totalisent pas 100 % (à 0,5 point près).',
      },
      {
        message: 'Une qualite sans ligne de composition ne peut pas etre mise en service.',
        cause: 'Statut Actif sans aucune ligne de composition.',
      },
      {
        message: 'Role BOM sans densite definie sur la qualite : le MRP calculerait un besoin nul en silence.',
        cause: 'Une ligne de composition porte un rôle sans ligne de densité.',
      },
      {
        message: 'R01 : role en ml/m2 — densite_kg_ml obligatoire sur la reference pour convertir en kg.',
        cause: 'Un rôle en ml/m² emploie une référence sans densité (kg/ml) au catalogue.',
      },
      {
        message: 'Composition verrouillee : cette qualite est produite par le plan en service. Creer une nouvelle qualite pour changer la composition.',
        cause: 'La qualité figure dans le plan de production EN_COURS.',
      },
      {
        message: 'Le role … porte des lignes de composition sur … : retirez-les d’abord.',
        cause: 'Densité retirée pour un rôle encore composé.',
      },
      {
        message: 'La reference … est employee sur deux roles (… et …) : une matiere ne peut figurer qu’une seule fois dans une qualite.',
        cause: 'La même référence sur deux lignes de composition.',
      },
    ],
    exemples: [
      {
        titre: 'du m² au kilo',
        situation:
          'Qualité à deux rôles : POIL 1,80 kg/m² (60 % PP-1500 Grey, 40 % PP-1500 Beige), TRAME 0,35 kg/m² (100 % jute). Plan : 10 000 m², taux de perte du plan 5 %.',
        calcul: [
          ['Poids commercial', '1,80 + 0,35 = 2,15 kg/m²'],
          ['PP-1500 Grey, kg/m²', '1,80 × 60 % = 1,08'],
          ['PP-1500 Grey, besoin du plan', '10 000 × 1,08 × 1,05 = 11 340 kg'],
          ['PP-1500 Beige', '10 000 × 0,72 × 1,05 = 7 560 kg'],
          ['Jute', '10 000 × 0,35 × 1,05 = 3 675 kg'],
        ],
        conclusion: 'La perte appliquée est celle du plan de production ; la qualité fournit les kg/m².',
      },
    ],
    liens: [
      { route: '/recettes', libelle: 'Recettes (BOM) : où une matière est employée' },
      { route: '/roles-bom', libelle: 'Rôles BOM' },
      { route: '/plans', libelle: 'Plans de production' },
      { route: '/besoins', libelle: 'Besoins (MRP)' },
    ],
  },

  /* ======================================================================= */
  /* /recettes                                                               */
  /* ======================================================================= */
  {
    route: '/recettes',
    titre: 'Compositions (Recettes BOM)',
    chemin: 'Production → Recettes (BOM)',
    objectif:
      'Voir toutes les lignes de composition, toutes qualités confondues, pour répondre à « où cette matière est-elle employée ? ».',
    droits: 'Module Recettes : LIRE. L’écran ne modifie rien : la composition se saisit dans la qualité.',
    procedures: [
      {
        titre: 'Trouver où une matière est employée',
        etapes: [
          'Filtrez la colonne Référence (texte), ou cherchez une qualité, une désignation, un rôle.',
          'Filtrez par Qualité, Statut, Rôle BOM ou Fournisseur.',
          'Cliquez le code d’une qualité, ou « Modifier une qualité », pour aller la corriger.',
        ],
        resultat: 'La liste des qualités touchées par une référence, avant de la clôturer ou de changer de fournisseur.',
      },
    ],
    champs: [
      { nom: 'Qualité', description: 'La qualité et son nom.' },
      { nom: 'Statut', description: 'Le statut de la qualité : Brouillon, Actif, Clôture.' },
      { nom: 'Rôle BOM', description: 'Le rôle de la matière dans la qualité.' },
      { nom: 'Référence', description: 'La matière et sa désignation.' },
      { nom: 'Fournisseur', description: 'Le fournisseur de la référence.' },
      { nom: '%', description: 'La part de la matière dans son rôle.' },
      { nom: 'Densité', description: 'La densité du rôle dans la qualité, avec son unité (kg/m² ou ml/m²).' },
      { nom: 'kg/m²', description: 'La consommation de la ligne au m² ; « — » quand elle ne se calcule pas.' },
      { nom: 'Couleur', description: 'La précision de couleur portée par la ligne.' },
    ],
    regles: [
      'Une qualité = une composition : modifier une ligne se fait dans le document de la qualité.',
    ],
    exemples: [
      {
        titre: 'avant de changer de fournisseur',
        situation: 'On filtre la référence PP-1500 Grey : elle figure en POIL dans deux qualités, dont une ACTIVE.',
        conclusion: 'Ce sont ces deux qualités qu’un changement de matière toucherait ; celle en service se duplique plutôt que de se modifier.',
      },
    ],
    liens: [{ route: '/qualites', libelle: 'Qualités' }],
  },

  /* ======================================================================= */
  /* /etats/qualite/:code                                                    */
  /* ======================================================================= */
  {
    route: '/etats/qualite/:code',
    titre: 'Fiche qualité imprimée',
    chemin: 'Production → Qualités → icône imprimante de la ligne',
    objectif: 'Imprimer la fiche d’une qualité : en-tête, densités par rôle avec leur contrôle à 100 %, et composition.',
    droits: 'Module Qualités : LIRE.',
    champs: [
      { nom: 'Rôle', description: 'Le rôle BOM.' },
      { nom: 'Densité', description: 'La densité du rôle.' },
      { nom: 'Unité', description: 'kg/m² ou ml/m².' },
      {
        nom: 'Somme composition',
        description: 'La somme des % des matières de ce rôle ; « ANOMALIE » si elle s’écarte de 100 % de plus de 0,5 point.',
      },
      { nom: 'Référence', description: 'La matière et sa désignation.' },
      { nom: 'Couleur', description: 'La précision de couleur de la ligne.' },
      { nom: '%', description: 'La part de la matière dans son rôle.' },
      { nom: 'kg/m²', description: 'La consommation de la ligne au m² ; le total est en pied de tableau.' },
    ],
    regles: [
      'Le poids commercial imprimé est la somme des densités en kg/m² ; le total composition, la somme des kg/m² des lignes.',
    ],
    liens: [{ route: '/qualites', libelle: 'Qualités' }],
  },

  /* ======================================================================= */
  /* /matrice-prix                                                           */
  /* ======================================================================= */
  {
    route: '/matrice-prix',
    titre: 'Matrice des prix',
    chemin: 'Analyses → Matrice des prix',
    objectif:
      'Lire d’un trait l’évolution du prix payé pour chaque référence : une ligne par référence, une colonne par mois.',
    prerequis: ['Des réceptions validées : la matrice se remplit à leur validation.'],
    droits:
      'Module Catalogue : LIRE. Le prix moyen est un champ sensible : un profil qui ne le voit pas reçoit un message au lieu de la grille.',
    procedures: [
      {
        titre: 'Repérer une dérive',
        etapes: [
          'Choisissez la période en haut à droite : 6, 12, 24 ou 36 derniers mois.',
          'Filtrez par Fournisseur ou par Référence.',
          'Lisez les cases colorées et la colonne Evolution ; survolez une case pour les kilos achetés.',
        ],
        resultat: 'Le compte « n en hausse sur la période » résume les références dont le prix a monté de plus de 1 %.',
      },
    ],
    champs: [
      { nom: 'Fournisseur', description: 'Filtre : les références de ce fournisseur.' },
      { nom: 'Référence', description: 'La référence (et son fournisseur) ; en filtre, une partie du code.' },
      {
        nom: 'Evolution',
        description: 'L’écart entre le premier et le dernier prix connus de la période, en %.',
      },
    ],
    regles: [
      'Le prix d’un mois est la moyenne PONDÉRÉE par les kilos : 30 t à 25 MAD et 200 kg à 40 MAD donnent 25,1, pas 32,5.',
      'Les prix sont en MAD par kilo, pris sur l’historique des prix payés à la réception (dernière version après une revalidation).',
      'Une case colorée signale un écart de plus de 1 % avec le dernier mois d’achat précédent — pas avec la case voisine. Le point « · » marque un mois sans achat.',
    ],
    exemples: [
      {
        titre: 'deux achats le même mois',
        situation: 'PP-1500 Grey en mars : 30 000 kg à 25,00 MAD/kg et 200 kg à 40,00 MAD/kg.',
        calcul: [
          ['Montant', '30 000 × 25 + 200 × 40 = 758 000 MAD'],
          ['Kilos', '30 200 kg'],
          ['Case de mars', '758 000 / 30 200 = 25,10 MAD/kg'],
        ],
        conclusion: 'La petite commande ne pèse que son poids ; la moyenne simple aurait affiché 32,50.',
      },
    ],
    liens: [{ route: '/historique-prix', libelle: 'Historique des prix' }],
  },

  /* ======================================================================= */
  /* /historique-prix                                                        */
  /* ======================================================================= */
  {
    route: '/historique-prix',
    titre: 'Historique des prix',
    chemin: 'Analyses → Historique des prix',
    objectif: 'Suivre le prix réellement payé à chaque réception, par référence, et son écart avec l’achat précédent.',
    prerequis: ['Des réceptions validées : l’historique se remplit à leur validation.'],
    droits: 'Module Catalogue : LIRE ; les colonnes de prix n’apparaissent qu’à qui a le droit de les voir.',
    procedures: [
      {
        titre: 'Suivre une référence',
        etapes: [
          'Filtrez par Fournisseur, Devise, Référence ou Période d’achat.',
          'Venu d’un autre écran avec une référence, le bouton « Référence : … — tout voir » lève ce filtre.',
          'Lisez la colonne Evolution : rouge en hausse, vert en baisse.',
        ],
        resultat: 'Le résumé au-dessus du tableau compte les achats, les hausses, les baisses et l’évolution moyenne de ce qui est affiché.',
      },
    ],
    champs: [
      { nom: 'Fournisseur', description: 'Le fournisseur de l’achat ; en filtre, ses seuls achats.' },
      { nom: 'Devise', description: 'Filtre : les achats dans cette devise.' },
      { nom: 'Référence', description: 'La référence achetée et sa désignation.' },
      { nom: "Période d'achat", description: 'Filtre : les achats dont la date tombe dans la période.' },
      { nom: 'Date', description: 'La date d’achat.' },
      { nom: 'Prix devise', description: 'Le prix au kilo dans la devise de l’achat.' },
      { nom: 'Taux', description: 'Le taux de change appliqué pour passer en MAD.' },
      { nom: 'Prix MAD/kg', description: 'Le prix payé au kilo, en MAD.' },
      { nom: 'Achat precedent', description: 'Le prix MAD/kg de l’achat précédent de la MÊME référence ; « premier achat » s’il n’y en a pas.' },
      {
        nom: 'Evolution',
        description: 'L’écart entre ce prix et l’achat précédent, en % ; il se remplit au deuxième achat d’une même référence.',
      },
      { nom: 'Quantité', description: 'Les kilos achetés.', valeurs: 'kg' },
      { nom: 'Total MAD', description: 'Le montant de l’achat, en MAD.' },
      { nom: 'Origine', description: 'Le numéro du bon de commande, sinon celui de la réception.' },
    ],
    regles: [
      'Ce sont des prix PAYÉS, enregistrés à la réception — pas des tarifs annoncés.',
      'L’historique est immuable : une réception dévalidée, corrigée puis revalidée ajoute une révision, et l’écran montre la dernière version.',
    ],
    liens: [
      { route: '/matrice-prix', libelle: 'Matrice des prix' },
      { route: '/catalogue', libelle: 'Références' },
    ],
  },
]
