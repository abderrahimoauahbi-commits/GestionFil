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
      'Une référence ne se supprime pas, elle se désactive : l’historique doit rester lisible.',
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
