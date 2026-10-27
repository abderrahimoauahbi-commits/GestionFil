/**
 * FICHES D'AIDE — STOCK : MOUVEMENTS, FICHE HORS MACHINE, INVENTAIRES, LOTS,
 * AUTORISATIONS, ÉTAT DES STOCKS, ANALYSE ABC / XYZ, STOCK PROJETÉ, TRANSFERTS.
 *
 * Une partie du catalogue : `../contenu.ts` les assemble, `../types.ts` donne
 * la forme d'une fiche. Chaque `champs[].nom` est l'intitulé EXACT de l'écran :
 * c'est par lui que l'indice ⓘ se pose à côté du champ (`../indice.ts`).
 *
 * Réécrites le 27/10/2026 d'après le code des écrans (pages/Mouvements.tsx,
 * MouvementNouveau.tsx, BonMouvement.tsx, FicheHorsMachine.tsx, Inventaires.tsx,
 * inventaires/*, lots/*, EtatStock.tsx, AnalyseAbcXyz.tsx) et les refus du
 * serveur et de la base. Stock projeté et transferts (Stock.tsx, Transferts.tsx,
 * TransfertNouveau.tsx, BonTransfert.tsx) écrits le 27/10/2026 sur le moteur de
 * couverture et la date prévue de disponibilité du fil en route.
 */
import type { ChampAide, MessageAide, Procedure, Sujet } from '../types.ts'

/* ==========================================================================
 * LE DOCUMENT DE TRANSFERT : un seul écran (pages/TransfertNouveau.tsx) pour la
 * création (/transferts/nouveau) et la reprise (/transferts/:id/modifier). Ses
 * champs se décrivent une fois et servent aux deux fiches. Réécrites le
 * 27/10/2026 (date prévue de disponibilité, migration 2026-10-27d).
 * ======================================================================== */
const PROCEDURES_TRANSFERT: Procedure[] = [
  {
    titre: 'Préparer un transfert',
    etapes: [
      'Choisissez le « Magasin source » : seules ses références en stock pourront être chargées (le changer vide les lignes).',
      'Choisissez le « Magasin destinataire », différent du premier.',
      'Saisissez « Disponible au magasin destinataire le » si vous la connaissez : facultative en préparation, elle sera exigée à l’expédition.',
      'Ajoutez une ligne, tapez la référence (la liste ne propose que le stock du magasin source), choisissez le lot pour une référence suivie au lot, puis la quantité en kilos — ou en palettes et bobines, liées aux kilos.',
      'Lisez « Dispo » : ce que le magasin source (ou le lot choisi) détient ; « dépassé » en rouge si le document en demande plus.',
      'Validez chaque ligne avec son bouton ✓, puis « Enregistrer le transfert ». La barre du bas dit ce qui bloque encore (ligne à valider, lot obligatoire, au-delà du stock disponible).',
    ],
    resultat:
      'Le transfert est « En préparation » dans la liste, avec son numéro : rien n’a bougé. On l’expédie depuis la liste des transferts.',
  },
]

const CHAMPS_TRANSFERT: ChampAide[] = [
  {
    nom: 'Magasin source',
    description:
      'D’où la matière part. LE CHANGER VIDE LES LIGNES ET RECHARGE LA LISTE DES RÉFÉRENCES : on ne transfère que ce qui est réellement là.',
    obligatoire: true,
  },
  {
    nom: 'Magasin destinataire',
    description: 'Où elle va. Il doit différer du magasin source (« Source et destination doivent différer. »).',
    obligatoire: true,
  },
  {
    nom: 'Date du document',
    description:
      'La date du transfert. La date de sortie sera celle de l’expédition, la date d’arrivée celle de la réception.',
    valeurs: 'date',
    defaut: 'aujourd’hui',
  },
  {
    nom: 'Disponible au magasin destinataire le',
    description:
      'La date prévue de disponibilité au magasin destinataire : le plan d’achat compte le fil en route CE jour-là. Facultative en préparation, OBLIGATOIRE À L’EXPÉDITION (TRF-DATE), pas avant la date du document. Une fois le transfert parti, elle se révise depuis la liste des transferts (« Réviser la date ») tant qu’il est en route ; reçu, elle ne se révise plus.',
    valeurs: 'date',
  },
  { nom: 'Responsable', description: 'Qui répond de la marchandise en route. Le nom s’imprime sur les deux bons.' },
  {
    nom: 'Transporteur',
    description: 'Qui emporte la marchandise. Il s’imprime sur le bon de sortie et signe les deux bons.',
  },
  { nom: 'Observations', description: 'Une note libre, reprise sur les bons imprimés.' },
  {
    nom: 'Référence',
    description:
      'Ce qu’on déplace, cherché à la frappe parmi ce que le MAGASIN SOURCE détient (avec ses kilos en stock). Une même référence peut revenir sur plusieurs lignes : un lot par ligne.',
    obligatoire: true,
  },
  {
    nom: 'Unité',
    description:
      'L’unité dans laquelle la ligne est archivée : kg, Bobine, Palette ou ml (jamais le lot). La quantité se saisit toujours en kilos ; l’unité ne change que l’expression enregistrée.',
    defaut: 'kg',
  },
  {
    nom: 'Qté (kg)',
    description: 'Les kilos transférés. Liés, kilos, palettes et bobines se recalculent ensemble, au conditionnement du lot s’il est connu, sinon de la fiche article.',
    obligatoire: true,
    valeurs: 'kg, plus de 0',
  },
  {
    nom: 'Pal. · bob.',
    alias: ['Palettes / bobines'],
    description:
      'Les palettes et les bobines réellement chargées — c’est ce décompte que le destinataire vérifiera. Liés (maillon), les trois champs se répondent ; détachés, chacun se saisit seul (une palette entamée, quatre bobines isolées). Il faut que le lot ou la fiche porte son poids de bobine et ses bobines par palette.',
  },
  {
    nom: 'Lot',
    description:
      'Le lot qui part, choisi parmi ceux du magasin source, le plus ancien d’abord. OBLIGATOIRE pour une référence suivie au lot : le lot voyage avec la matière.',
  },
  {
    nom: 'Dispo',
    description:
      'Ce que le magasin SOURCE détient de la référence — ou du lot choisi, avec ses bobines —, face à ce que le document en demande (au survol). « dépassé » en rouge : le document demande plus ; « lot absent de la source » : ce lot n’y est pas. Ce n’est pas le stock de la maison.',
    valeurs: 'kg',
  },
  {
    nom: 'Poids / bobine',
    description:
      'Les kilos de la ligne ÷ ses bobines, comparés au poids de bobine du catalogue : un écart hors tolérance se colore (orange, rouge). « — » : pas de bobines saisies.',
    valeurs: 'kg',
  },
  { nom: 'Poids chargé', description: 'Le total des kilos des lignes remplies.', valeurs: 'kg' },
  { nom: 'Palettes', description: 'Le total des palettes déclarées sur les lignes.' },
  { nom: 'Bobines', description: 'Le total des bobines déclarées sur les lignes.' },
]

const REGLES_TRANSFERT: string[] = [
  'LE DOCUMENT NE BOUGE AUCUN STOCK : c’est l’expédition, depuis la liste des transferts, qui sort la marchandise du magasin source ; la réception l’entre au destinataire.',
  'LA DATE PRÉVUE DE DISPONIBILITÉ est exigée à l’expédition (TRF-DATE, garanti par la base) : sans elle, le fil en route ne couvrirait aucun besoin du plan d’achat. Saisie dès la préparation, elle part telle quelle à l’expédition.',
  'La conversion ne DEVINE JAMAIS un facteur manquant : sans poids de bobine ou bobines par palette, la ligne ne se saisit qu’en kilos.',
  'Le disponible est celui du MAGASIN SOURCE seul — sommer les magasins ferait croire à une matière présente ailleurs. Une ligne au-delà du stock disponible bloque l’enregistrement.',
  'Une référence suivie au lot se transfère lot par lot : c’est la traçabilité du bain qui l’exige.',
  'Un inventaire ouvert sur l’un des deux magasins n’empêche pas d’enregistrer le document, mais l’expédition ou la réception attendront sa clôture (avis en tête de l’écran).',
  'Rien ne part au serveur avant « Enregistrer le transfert » ; un second envoi du même formulaire rend le même document.',
]

const MESSAGES_TRANSFERT: MessageAide[] = [
  { message: 'Source et destination doivent différer.', cause: 'Le même magasin est choisi des deux côtés.' },
  { message: 'lot obligatoire : …', cause: 'Une référence suivie au lot n’a pas de lot sur sa ligne.' },
  { message: 'au-dela du stock disponible : …', cause: 'Le document demande plus que le magasin source (ou le lot) n’en détient.' },
  { message: '… : la quantite doit etre strictement positive', cause: 'Une ligne à zéro kilo.' },
]

/* Les deux bons imprimés (pages/BonTransfert.tsx) : même en-tête, mêmes lignes. */
const CHAMPS_BON_TRANSFERT: ChampAide[] = [
  { nom: 'Magasin expediteur', description: 'Le magasin source, son nom et son code.' },
  { nom: 'Magasin destinataire', description: 'Le magasin d’arrivée, son nom et son code.' },
  { nom: 'Date du document', description: 'La date du transfert.', valeurs: 'date' },
  { nom: 'Date de sortie', description: 'Le jour de l’expédition ; « — non expédié — » tant qu’il n’est pas parti.', valeurs: 'date' },
  { nom: 'Responsable', description: 'Qui répond de la marchandise en route.' },
  { nom: 'Expédié par', description: 'Le compte qui a créé et expédié le transfert.' },
  { nom: 'Reçu par', description: 'Le compte qui a constaté l’arrivée ; « — a constater — » tant qu’elle ne l’est pas.' },
  {
    nom: 'Disponible à destination le',
    description:
      'La date prévue de disponibilité au magasin destinataire, « — en retard de N j » si elle est dépassée alors que le transfert roule encore ; « — sans date — » pour un transfert en route expédié avant la règle ; « — à fixer à l’expédition — » en préparation.',
  },
  { nom: 'Référence / designation', description: 'La référence, sa désignation et sa couleur.' },
  { nom: 'Lot', description: 'Le lot transféré.' },
  { nom: 'Bob.', description: 'Les bobines de la ligne (total en pied).' },
  { nom: 'Pal.', description: 'Les palettes de la ligne (total en pied).' },
  { nom: 'Poids (kg)', description: 'Les kilos de la ligne (total en pied).', valeurs: 'kg' },
]

const REGLES_BON_TRANSFERT: string[] = [
  'Le bon de sortie part avec le camion, le bon de réception revient signé : ce sont les deux moitiés d’un même transfert.',
  'Le pied du document porte le numéro, le statut et, une fois arrivé, les jours de transit. La barre d’actions ne s’imprime pas.',
]

export const FICHES_STOCK: Sujet[] = [
  // ==========================================================================
  // MOUVEMENTS — la liste (bons et grand livre)
  // ==========================================================================
  {
    route: '/mouvements',
    titre: 'Mouvements de stock',
    chemin: 'Stock → Mouvements',
    objectif:
      'Consulter les mouvements de stock — un bon par ligne, ou le grand livre ligne par ligne — et ouvrir la saisie d’un mouvement libre.',
    droits:
      'Lecture du module Mouvements pour consulter ; écriture pour « Saisir un mouvement ». Les prix et valeurs n’apparaissent qu’à qui a le droit de les voir.',
    procedures: [
      {
        titre: 'Lire les bons de mouvement',
        etapes: [
          'La vue « Bons » (par défaut) montre un document par ligne, avec ses totaux.',
          'À droite, choisissez un sens (Entrées / Sorties) ou un type, puis affinez par les filtres (période, magasin, responsable, saisi par, document).',
          'Au-dessus du tableau : le nombre de bons affichés et le solde en kilos de ce qui est à l’écran.',
          'Cliquez une ligne pour ouvrir le bon.',
        ],
        resultat: 'Le bon s’ouvre sur sa page : en-tête, lignes, visas, et la contre-passation pour la Direction.',
      },
      {
        titre: 'Interroger le grand livre',
        etapes: [
          'Cliquez « Grand livre » en haut : une ligne par référence et par mouvement.',
          'Tapez une référence exacte dans la recherche du panneau de droite (ou arrivez depuis l’écran de stock, déjà filtré).',
          'Affinez par type, magasin, lot, N° d’OF ou auteur.',
        ],
        resultat: 'Le choix de vue est dans l’adresse : un lien partagé rouvre la même vue.',
      },
      {
        titre: 'Saisir un mouvement',
        etapes: ['Cliquez « Saisir un mouvement » : l’écran de saisie s’ouvre (voir sa fiche).'],
      },
    ],
    champs: [
      { nom: 'Période', description: 'Filtre sur la date du mouvement (la date du fait, pas celle de la saisie).' },
      {
        nom: 'Type',
        description:
          'Le type de mouvement. Le badge porte le sens : « + » le stock monte (vert), « − » il descend (rouge). En filtre : un seul type.',
      },
      { nom: 'Magasin', description: 'Le magasin où le stock a bougé.' },
      {
        nom: 'Responsable',
        description: 'La personne qui a remis ou reçu la marchandise, saisie sur le bon — pas le compte qui a tapé.',
      },
      {
        nom: 'Saisi par',
        description:
          'Le compte qui a enregistré le mouvement. « +3 j » à côté : le mouvement a été saisi trois jours après la date du fait.',
      },
      { nom: 'Document', description: 'Le document de référence noté sur le bon (BL, bon de commande, OF…).' },
      { nom: 'Référence', description: 'Grand livre : la référence du catalogue. En filtre : une seule référence.' },
      { nom: 'Lot', description: 'Grand livre : le numéro de lot de la ligne, s’il y en a un.' },
      { nom: 'N° d’OF', description: 'Filtre du grand livre sur le numéro d’ordre de fabrication porté par la ligne.' },
      { nom: 'Date', description: 'La date du fait.' },
      { nom: 'Numéro', description: 'Le numéro du mouvement (MVT-…), donné par le serveur.' },
      { nom: 'Lignes', description: 'Le nombre de lignes du bon ; au survol, le nombre de références.' },
      { nom: 'Total (kg)', description: 'Le total du bon en kilos, signé : + entrée, − sortie.', valeurs: 'kg' },
      { nom: 'Palettes', description: 'Le total des palettes comptées sur le bon, s’il y en a.' },
      { nom: 'Rebut (kg)', description: 'La part de rebut ou de perte du bon, s’il y en a.', valeurs: 'kg' },
      { nom: 'Valeur', description: 'La valeur du bon en MAD. Visible seulement si votre rôle voit les montants.' },
      { nom: 'Quantité (kg)', description: 'Grand livre : les kilos de la ligne, signés.', valeurs: 'kg' },
      {
        nom: 'Prix (MAD/kg)',
        description: 'Grand livre : le coût porté par la ligne — pour une sortie, le CMUP du magasin au moment de la sortie.',
        valeurs: 'MAD/kg, 4 décimales',
      },
      { nom: 'Total', description: 'Grand livre : kilos × prix de la ligne, en MAD.' },
      { nom: 'OF', description: 'Grand livre : l’ordre de fabrication noté sur la ligne.' },
      { nom: 'Par', description: 'Grand livre : le compte qui a saisi.' },
    ],
    regles: [
      'Le registre est immuable : un mouvement enregistré ne se modifie ni ne se supprime. Il se compense par une contre-passation, et les deux lignes restent.',
      'Les totaux et le solde affichés portent sur ce qui est à l’écran après filtrage, pas sur toute la base. La liste ramène les 300 derniers mouvements.',
      'Réceptions, retours fournisseur, transferts, fusions de lots et fiches machine écrivent leurs mouvements eux-mêmes : on les lit ici, on ne les saisit pas ici.',
    ],
    liens: [
      { route: '/mouvements/nouveau', libelle: 'Saisir un mouvement' },
      { route: '/fiche-hors-machine', libelle: 'Fiche hors machine' },
      { route: '/etat-stock', libelle: 'État des stocks' },
    ],
  },

  // ==========================================================================
  // MOUVEMENTS — la saisie libre
  // ==========================================================================
  {
    route: '/mouvements/nouveau',
    titre: 'Saisir un mouvement',
    chemin: 'Stock → Mouvements → Saisir un mouvement',
    objectif:
      'Saisir à la main ce qui n’a pas de document propre : déchet, consommation directe, sortie hors machine, retour d’un prêt, ajustement, stock initial.',
    prerequis: [
      'La référence existe au catalogue ; pour une sortie, elle a du stock dans le magasin choisi.',
      'Pour une consommation directe : l’article est en mode de consommation « Directe » sur sa fiche (jute, latex, SBR, plastique, cuir…).',
      'Aucun inventaire ouvert ne gèle le magasin (ou, pour un tournant / ciblé, la référence).',
    ],
    droits:
      'Écriture du module Mouvements. Ajustement + / − : droit de valider l’inventaire. Stock initial : l’administrateur seul. Déchets et sorties hors machine au-delà de 50 kg le même jour pour une référence : droit de valider l’inventaire.',
    procedures: [
      {
        titre: 'Saisir l’en-tête',
        etapes: [
          'Choisissez le type de mouvement : l’écran ne propose que ce que vos droits permettent.',
          'Choisissez le magasin et le motif d’en-tête (une consommation directe propose « Production »).',
          'Selon le type : l’ordre de fabrication, la qualité, l’usine du prêt.',
          'Vérifiez la date du fait (aujourd’hui par défaut), le responsable de la marchandise et le document de référence.',
        ],
      },
      {
        titre: 'Saisir les lignes',
        etapes: [
          'Tapez la référence : la recherche cherche d’abord dans le stock du magasin, puis au catalogue. Vous pouvez aussi scanner l’étiquette d’un lot.',
          'Saisissez la quantité en kilos, ou les palettes / bobines : les trois se répondent, au conditionnement du lot choisi (sinon de la fiche article).',
          'Choisissez le lot si la référence est suivie par lot, et le motif de ligne si le type l’exige.',
          'Validez la ligne par son bouton ✓. « Dispo magasin » signale un manque ; des références équivalentes avec du stock sont proposées sous la grille.',
        ],
      },
      {
        titre: 'Enregistrer',
        etapes: [
          'La barre du bas dit ce qui manque encore, ou le nombre de lignes et le total en kilos.',
          'Cliquez « Enregistrer le mouvement » : en-tête et lignes partent ensemble.',
        ],
        resultat:
          'Le mouvement entre au grand livre, au coût moyen du magasin, et l’écran revient à la liste des mouvements. Rien n’est enregistré avant ce clic.',
      },
    ],
    exemples: [
      {
        titre: 'le seuil des déchets, en cumul',
        situation: 'Le même jour, pour la même référence : un déchet de 30 kg, puis une sortie hors machine de 25 kg.',
        calcul: [
          ['Déchet de 30 kg', '30 kg ≤ 50 : le magasinier l’enregistre'],
          ['Sortie hors machine de 25 kg', '30 + 25 = 55 kg > 50 : droit de valider l’inventaire'],
        ],
        conclusion: 'Le seuil (P_DechetSeuilValiderKg) se juge par jour et par référence, déchets et sorties hors machine ensemble.',
      },
      {
        titre: 'de la colle pour un OF',
        situation: '12,5 kg de colle (article en mode « Directe ») pour l’OF 2026-118.',
        conclusion:
          'Type « Consommation directe », OF choisi (sa qualité suit) : sortie au CMUP du magasin, sans seuil. Le reste rendu passe par la Fiche hors machine.',
      },
    ],
    champs: [
      {
        nom: 'Type de mouvement',
        description:
          'Il porte le sens : « + » entrée, « − » sortie. Déchet (rebut, chute non réutilisable) ; Consommation directe ; Sortie hors machine (atelier, échantillon, essai, réparation, prêt) ; Retour d’un prêt ; Ajustement + / − (droit de valider l’inventaire) ; Stock initial (administrateur).',
        obligatoire: true,
      },
      { nom: 'Magasin', description: 'Le magasin où le stock bouge. Son stock alimente la recherche et la colonne « Dispo magasin ».', obligatoire: true },
      {
        nom: 'Motif',
        description:
          'En-tête : la raison du mouvement (liste des motifs). Colonne de ligne, quand le type l’exige (sortie hors machine, ajustement) : le motif de chaque ligne — pour une sortie hors machine, atelier, échantillon, essai, réparation, prêt ou autre.',
        obligatoire: true,
        defaut: '« Production » pour une consommation directe, tant qu’on n’en a pas choisi d’autre.',
      },
      {
        nom: 'Ordre de fabrication',
        alias: ['Numero d ordre de fabrication'],
        description:
          'Consommation directe : l’OF prévu ou lancé que sert la matière (facultatif ; sa qualité s’impose). Déchet : le numéro d’OF en texte libre, exigé. Sortie hors machine : texte libre facultatif.',
      },
      {
        nom: 'Qualité',
        description:
          'Consommation directe : la qualité que sert la sortie. Avec un OF, c’est la sienne, affichée ; sans OF, elle est obligatoire.',
      },
      {
        nom: 'Usine qui emprunte (pour un prêt)',
        alias: ['Usine qui rend le fil'],
        description:
          'Sortie hors machine : l’usine à qui l’on prête (exigée pour une ligne au motif « prêt »). Retour d’un prêt : l’usine qui rend le fil, obligatoire ; l’écran affiche ce qu’elle doit encore rendre.',
      },
      {
        nom: 'Date du mouvement',
        description: 'La date du FAIT, qui peut différer du jour de saisie. Jamais dans le futur.',
        obligatoire: true,
        defaut: 'Aujourd’hui',
      },
      {
        nom: 'Responsable de la marchandise',
        description: 'Qui remet ou reçoit physiquement la marchandise — pas le compte qui saisit. Il est imprimé sur le bon.',
      },
      {
        nom: 'Document de référence',
        description: 'Le papier qui justifie le mouvement : N° de BL, bon de commande, OF…',
      },
      {
        nom: 'Observations',
        description: 'Texte libre, imprimé sur le bon. Obligatoire (5 caractères au moins) pour une sortie hors machine au motif « Autre ».',
      },
      {
        nom: 'Référence',
        description: 'La référence de la ligne : d’abord celles qui ont du stock dans le magasin, puis le catalogue. Une même référence peut revenir sur plusieurs lignes, une par lot.',
        obligatoire: true,
      },
      {
        nom: 'Unité',
        description:
          'Comment la quantité s’archive sur le bon : kg, Bobine, Palette ou ml. Elle ne change pas les kilos. Une unité que la référence ne sait pas convertir retombe sur la plus grosse possible, sinon kg.',
        valeurs: 'kg · Bobine · Palette · ml',
      },
      {
        nom: 'Qté (kg)',
        description: 'La quantité en kilogrammes — l’unité du stock.',
        obligatoire: true,
        valeurs: 'kg',
      },
      {
        nom: 'Pal. · bob.',
        description:
          'Palettes et bobines de la ligne. Liées (icône chaîne), les trois se répondent par le conditionnement du lot, sinon de la fiche article ; détachées, chacune se saisit seule.',
      },
      {
        nom: 'Lot',
        description:
          'Pour une référence suivie par lot : le lot, choisi dans ce que le magasin tient (le plus ancien proposé pour une sortie). « — » : référence non suivie.',
      },
      {
        nom: 'Dispo magasin',
        description: 'Le stock de la référence dans le magasin choisi ; en rouge, « manque … kg » quand la sortie demandée le dépasse.',
        valeurs: 'kg',
      },
      {
        nom: 'Prix MAD/kg',
        description:
          'Stock initial seulement, facultatif : le prix d’ouverture d’une référence qui n’a pas encore de coût moyen. Vide : prix catalogue converti. Si la référence a déjà un CMUP, c’est lui qui s’applique.',
        valeurs: 'MAD/kg',
      },
      {
        nom: 'Poids / bobine',
        description:
          'Le poids réel d’une bobine (kilos ÷ bobines) et son écart au poids catalogue, coloré selon les tolérances de lot (vert, orange, rouge).',
      },
    ],
    regles: [
      'Seuls ces types se saisissent ici : réceptions, retours fournisseur, transferts, fusions et fiches machine naissent de leur document ; le retour de consommation directe passe par la Fiche hors machine.',
      'Le prix n’est pas une saisie : toute entrée ou sortie libre se fait au CMUP du magasin en cours. Une référence jamais reçue n’a pas de CMUP : elle n’entre pas par une saisie libre (sauf le stock initial).',
      'Déchets et sorties hors machine : au-delà de 50 kg (P_DechetSeuilValiderKg) sortis le même jour pour une référence, cumulés, la sortie demande le droit de valider l’inventaire.',
      'La consommation directe ne vaut que pour un article en mode « Directe » ; le fil sort par les fiches machine. Elle n’a pas de seuil.',
      'Un retour de prêt ne rend pas plus que ce qui reste à rendre par cette usine : un surplus est un ajustement d’inventaire.',
      'Une référence suivie par lot exige son lot sur chaque ligne.',
      'Le stock d’un magasin ne devient jamais négatif (R02).',
      'Un inventaire ouvert gèle son magasin (global) ou ses références (tournant, ciblé) : l’écran le dit avant la saisie et la base refuse.',
      'Un second envoi du même formulaire (panne, double clic) rend le même mouvement : rien n’est doublé.',
    ],
    messages: [
      { message: 'R02 : stock insuffisant dans ce magasin…', cause: 'La sortie dépasse le stock du magasin (ou du lot). Une entrée oubliée, une référence confondue ? Réduisez, ou choisissez un équivalent proposé.' },
      { message: '… kg sortis ce jour (dechets et sorties hors machine, ce mouvement compris) depassent 50 kg…', cause: 'Le cumul du jour dépasse le seuil : faites saisir la sortie par un compte qui valide l’inventaire (la Direction).' },
      { message: '… n’a jamais ete recue : elle n’a pas de CMUP…', cause: 'Une entrée libre se valorise au CMUP : faites d’abord entrer la référence par une réception.' },
      { message: 'QUALITE-OBLIGATOIRE : sans OF, une consommation directe ou son retour nomme la qualite…', cause: 'Choisissez l’OF, ou à défaut la qualité.' },
      { message: '… : mode de consommation MACHINE (fiche article) : le fil sort par les fiches machine…', cause: 'L’article n’est pas en mode « Directe » : il se charge par une fiche machine.' },
      { message: 'l’OF … est clôturé : la matière se sort ou se rend sur un OF prévu ou lancé', cause: 'Choisissez un OF prévu ou lancé.' },
      { message: 'Le stock initial est réservé à l’administrateur…', cause: 'Pour corriger un stock, saisissez un ajustement.' },
      { message: 'INVENTAIRE-OUVERT : …', cause: 'Un inventaire ouvert gèle le magasin ou la référence jusqu’à sa clôture ou son annulation.' },
      { message: '… kg rendus par …, mais il ne lui reste que … kg a rendre…', cause: 'Le retour dépasse le prêt restant : le surplus est un ajustement d’inventaire.' },
    ],
    liens: [
      { route: '/mouvements', libelle: 'Mouvements' },
      { route: '/fiche-hors-machine', libelle: 'Fiche hors machine' },
      { route: '/retours-fournisseur', libelle: 'Retours fournisseur' },
    ],
  },

  // ==========================================================================
  // MOUVEMENTS — le bon
  // ==========================================================================
  {
    route: '/mouvements/:id',
    titre: 'Bon de mouvement',
    chemin: 'Stock → Mouvements → clic sur un bon',
    objectif: 'Lire, imprimer et faire contresigner un bon d’entrée ou de sortie ; le contre-passer s’il faut le défaire.',
    droits:
      'Lecture du module Mouvements. « Contre-passer » : validation du module Mouvements ET rôle Direction ou Administrateur. Les prix n’apparaissent qu’à qui voit les montants.',
    procedures: [
      {
        titre: 'Imprimer et faire signer',
        etapes: [
          'Imprimez le bon : il porte deux visas (le livreur et le magasinier pour une entrée ; le magasinier et le preneur pour une sortie).',
          'Faites-le signer par la personne qui a remis ou reçu la marchandise.',
        ],
      },
      {
        titre: 'Défaire un mouvement (contre-passation)',
        etapes: [
          'Cliquez « Contre-passer » et dites pourquoi (5 caractères au moins).',
          'Confirmez.',
        ],
        resultat:
          'Un mouvement inverse (ajustement + ou −) est enregistré aux mêmes quantités ; les deux restent au grand livre. Annuler une entrée retire sa valeur à son prix, dans son magasin. Une réception locale retrouve son reste à recevoir ; une réception d’import avant DUM aussi.',
      },
      {
        titre: 'Défaire un mouvement de fiche machine',
        etapes: ['Cliquez « Annuler par la fiche machine » : il se défait sur la fiche, qui ramène aussi l’étage à son état précédent.'],
      },
    ],
    champs: [
      { nom: 'Magasin', description: 'Le magasin du mouvement.' },
      { nom: 'Motif', description: 'Le motif d’en-tête du mouvement.' },
      { nom: 'Document', description: 'Le document de référence saisi.' },
      { nom: 'Ordre de fabrication', description: 'L’OF porté par le mouvement, s’il y en a un.' },
      { nom: 'Date du mouvement', description: 'La date du fait.' },
      { nom: 'Saisi le', description: 'Affiché seulement quand la saisie est postérieure au fait, avec l’écart en jours : un bon établi après coup le dit.' },
      { nom: 'Sens', description: 'Entrée en stock ou sortie de stock.' },
      { nom: 'Responsable', description: 'Qui a remis ou reçu la marchandise.' },
      { nom: 'Saisi par', description: 'Le compte qui a enregistré le mouvement.' },
      { nom: 'N°', description: 'Le numéro de ligne.' },
      { nom: 'Référence', description: 'Le code de la référence, sa désignation et sa couleur.' },
      { nom: 'Quantité', description: 'Les kilos de la ligne, et dessous la quantité dans l’unité saisie (« soit 3 Palette »).', valeurs: 'kg' },
      { nom: 'Colis comptes', description: 'Les palettes et bobines comptées sur la ligne.' },
      { nom: 'Lot / motif', description: 'Le lot de la ligne et son motif de ligne.' },
      { nom: 'Prix MAD/kg', description: 'Le coût de la ligne (CMUP du moment pour une sortie). Masqué selon les droits.', valeurs: 'MAD/kg' },
      { nom: 'Total MAD', description: 'Kilos × prix. Masqué selon les droits.' },
      { nom: 'Observations', description: 'Les observations saisies avec le mouvement.' },
      { nom: 'Pourquoi ?', description: 'Le motif de la contre-passation, obligatoire (5 caractères au moins). Il est écrit sur le mouvement inverse.', obligatoire: true },
    ],
    regles: [
      'Le bon dit s’il EST une contre-passation, et s’il A ÉTÉ contre-passé : un bon annulé reste au grand livre, son effet sur le stock est défait.',
      'On ne contre-passe pas une contre-passation, ni un mouvement déjà contre-passé.',
      'Un mouvement de fiche machine se défait par sa fiche ; une moitié de transfert ou de fusion se défait avec son document entier.',
      'L’entrée d’une réception clôturée avec sa facture, ou d’une réception d’import dont le dossier est dédouané, ne s’annule plus : avoir ou retour fournisseur.',
      'Un retour fournisseur validé est définitif.',
      'Une consommation directe ne se contre-passe pas tant qu’un retour de son OF en dépend : contre-passez d’abord le retour.',
    ],
    messages: [
      { message: 'Ce mouvement EST deja une contre-passation…', cause: 'On n’annule pas une annulation : saisissez le mouvement qui manque.' },
      { message: '… a deja ete contre-passe…', cause: 'Le grand livre porte déjà les deux lignes.' },
      { message: '… vient de la fiche machine … : il se defait en annulant ou en devalidant cette fiche…', cause: 'Passez par la fiche machine.' },
      { message: '… est une moitie de transfert (ou de fusion de lots)…', cause: 'Annulez le document entier, ou corrigez par un inventaire.' },
      { message: '… est l’entree de la reception …, cloturee avec sa facture…', cause: 'Corrigez par un avoir ou un retour fournisseur.' },
      { message: 'RETOUR-CONSO : l’OF a deja rendu au magasin une partie de … : contre-passez d’abord le retour.', cause: 'La sortie a un retour qui en dépend.' },
    ],
    liens: [{ route: '/mouvements', libelle: 'Mouvements' }],
  },

  // ==========================================================================
  // FICHE HORS MACHINE
  // ==========================================================================
  {
    route: '/fiche-hors-machine',
    titre: 'Fiche hors machine',
    chemin: 'Stock → Fiche hors machine',
    objectif:
      'Sortir pour un OF les matières qui ne vont pas sur machine (colle, latex, jute, bande, plastique…), et rendre au magasin ce qui n’a pas servi.',
    prerequis: [
      'L’article est en mode de consommation « Directe » sur sa fiche, et le magasin en porte du stock.',
      'Un OF prévu ou lancé ; sans OF, la qualité que sert la matière.',
    ],
    droits: 'Écriture du module Mouvements.',
    procedures: [
      {
        titre: 'Remplir la fiche',
        etapes: [
          'En-tête : la date, le responsable (qui a pris ou rendu la matière), le magasin.',
          'Choisissez l’ordre de fabrication ; sa qualité s’affiche. Sans OF, choisissez la qualité.',
          'Pour chaque ligne : le sens (Sortie ou Retour au magasin), la référence, le lot si elle est suivie par lot.',
          'Saisissez la quantité dans la case que vous avez sous les yeux — palettes, bobines ou kilos : les deux autres suivent, au conditionnement du lot (sinon de la fiche article).',
          '« Une sortie » / « Un retour au magasin » ajoutent une ligne.',
          'Cliquez « Enregistrer » ; à côté du bouton, ce qui manque encore.',
        ],
        resultat:
          'Au plus deux mouvements : une consommation directe pour les sorties, un retour de consommation pour les retours, au CMUP du magasin. Leurs numéros s’affichent, et la fiche se vide pour la suivante.',
      },
    ],
    exemples: [
      {
        titre: 'consommation d’un OF',
        situation: 'OF 2026-118 : 120 kg de latex sortis le matin, 15 kg rendus le soir.',
        calcul: [
          ['Sortie (consommation directe)', '120 kg au CMUP du magasin'],
          ['Retour au magasin', '15 kg, au plus ce que l’OF a sorti non rendu'],
          ['Consommation de l’OF', '120 − 15 = 105 kg'],
        ],
        conclusion: 'Le cadre « Déjà sur cet OF » fait le compte : consommation = sorti − rendu.',
      },
    ],
    champs: [
      { nom: 'Date', description: 'La date du fait.', obligatoire: true, defaut: 'Aujourd’hui (Casablanca)' },
      { nom: 'Responsable', description: 'Qui a pris ou rendu la matière.', obligatoire: true },
      { nom: 'Magasin', description: 'Le magasin où la matière sort ou revient. Il commande la liste des références.', obligatoire: true },
      {
        nom: 'Ordre de fabrication',
        description: 'L’OF prévu ou lancé que sert la matière. Sans OF, choisissez la qualité.',
      },
      {
        nom: 'Qualité',
        description: 'Avec un OF, la sienne, imposée. Sans OF, obligatoire : toute consommation de fabrication nomme sa qualité.',
      },
      { nom: 'Sens', description: 'Sortie (consommée) ou Retour au magasin.', valeurs: 'Sortie (consommée) · Retour au magasin', defaut: 'Sortie' },
      {
        nom: 'Référence',
        description:
          'Les seuls articles en mode « Directe » du magasin. Dessous : le stock du magasin, et ce que l’OF (ou la qualité sans OF) a déjà sorti et rendu.',
        obligatoire: true,
      },
      { nom: 'Lot', description: 'Obligatoire pour une référence suivie par lot ; pour une sortie, le plus ancien est proposé.' },
      {
        nom: 'Palettes',
        description: 'Le nombre de palettes. Grisé quand ni le lot ni la fiche article ne disent les bobines par palette.',
      },
      {
        nom: 'Bobines',
        description: 'Le nombre de bobines, entier. Grisé quand ni le lot ni la fiche article ne disent le poids d’une bobine.',
      },
      { nom: 'Quantité (kg)', description: 'Les kilos : c’est eux qui partent au serveur.', valeurs: 'kg' },
    ],
    regles: [
      'Seuls les articles en mode « Directe » sortent ici ; le fil sort et revient par les fiches machine.',
      'Une sortie ne dépasse pas le stock du magasin.',
      'Un retour ne rend pas plus que ce que l’OF — sans OF, la qualité — a sorti de cette référence et pas encore rendu. La base le garantit aussi.',
      'Le retour revient au CMUP courant : il ne change pas le coût moyen.',
      'La case tapée garde sa valeur ; les bobines sont entières ; un facteur manquant laisse seule la case des kilos.',
      'Un inventaire ouvert sur le magasin (ou sur la référence) bloque l’enregistrement.',
      'Renvoyer la fiche après une panne ne double rien.',
    ],
    messages: [
      { message: 'RETOUR-CONSO : … kg de … rendus pour l’OF …, qui n’en a sorti que … kg non encore rendus…', cause: 'Le retour dépasse ce que l’OF a sorti : un surplus est un ajustement d’inventaire.' },
      { message: 'QUALITE-OBLIGATOIRE : …', cause: 'Sans OF, choisissez la qualité.' },
      { message: 'R02 : stock insuffisant dans ce magasin…', cause: 'La sortie dépasse le stock du magasin ou du lot.' },
      { message: 'INVENTAIRE-OUVERT : …', cause: 'Le magasin ou la référence est gelé par un inventaire.' },
    ],
    liens: [
      { route: '/mouvements', libelle: 'Mouvements' },
      { route: '/ordres-fabrication', libelle: 'Ordres de fabrication' },
    ],
  },

  // ==========================================================================
  // INVENTAIRES — la liste
  // ==========================================================================
  {
    route: '/inventaires',
    titre: 'Inventaires',
    chemin: 'Stock → Inventaires',
    objectif:
      'Suivre les inventaires comme des bons — brouillon, validé, clôturé, annulé — et en créer un nouveau.',
    droits: 'Lecture du module Inventaire ; écriture pour « Nouvel inventaire ».',
    procedures: [
      {
        titre: 'Trouver un inventaire',
        etapes: [
          'À droite, choisissez un statut, puis affinez par les filtres.',
          'Cliquez une ligne : l’inventaire s’ouvre sur sa page.',
          'Les icônes de la ligne impriment la feuille de comptage (dès qu’il a des lignes) ou le procès-verbal.',
        ],
      },
    ],
    champs: [
      { nom: 'Période', description: 'Filtre sur la date de l’inventaire.' },
      { nom: 'Magasin', description: 'Le magasin inventorié.' },
      { nom: 'Type d’inventaire', description: 'Filtre sur le type.', valeurs: 'GLOBAL · TOURNANT · CIBLE' },
      { nom: 'Créé par', description: 'Le compte qui a créé l’inventaire.' },
      { nom: 'Numéro', description: 'Le numéro de l’inventaire (INV-…).' },
      { nom: 'Date', description: 'La date de création de l’inventaire.' },
      { nom: 'Type', description: 'Global, tournant ou ciblé.', valeurs: 'GLOBAL · TOURNANT · CIBLE' },
      {
        nom: 'Statut',
        description: 'Où en est l’inventaire.',
        valeurs: 'Brouillon — on compte · Validé — comptage figé, à clôturer · Clôturé — écarts passés au stock · Annulé',
      },
      { nom: 'Comptées', description: 'Lignes comptées sur lignes à compter (« — » : pas encore de ligne).' },
      { nom: 'Validé par', description: 'Le compte qui a validé le comptage.' },
    ],
    regles: [
      'Un seul inventaire ouvert (brouillon ou validé) par magasin.',
      'Tant qu’il est ouvert, ce qu’il compte est gelé : tout le magasin pour un global, ses seules références pour un tournant ou un ciblé.',
    ],
    liens: [{ route: '/inventaires/nouveau', libelle: 'Nouvel inventaire' }],
  },

  // ==========================================================================
  // INVENTAIRES — la création
  // ==========================================================================
  {
    route: '/inventaires/nouveau',
    titre: 'Nouvel inventaire',
    chemin: 'Stock → Inventaires → Nouvel inventaire',
    objectif: 'Créer un inventaire global, tournant ou ciblé, et préparer d’un coup ses lignes de comptage.',
    prerequis: ['Aucun autre inventaire ouvert (brouillon ou validé) sur ce magasin.'],
    droits: 'Écriture du module Inventaire.',
    procedures: [
      {
        titre: 'Créer un inventaire global',
        etapes: ['Choisissez le magasin, laissez le type « Global », cliquez « Créer ».'],
        resultat: 'Les lignes se préparent : la photo du stock du magasin. Le magasin entier est gelé jusqu’à la clôture ou l’annulation.',
      },
      {
        titre: 'Créer un tournant ou un ciblé',
        etapes: [
          'Choisissez le magasin et le type.',
          'Tournant : la liste arrive PROPOSÉE — les références en stock dues selon leur classe ABC. « Reprendre la proposition » revient au calcul.',
          'Ciblé, ou pour retoucher un tournant : ajoutez une référence par recherche (code ou désignation), une famille ou une catégorie entière (ses références en stock dans ce magasin) ; retirez-en par ✕ ou « Tout retirer ».',
          'Cliquez « Valider la liste et créer ».',
        ],
        resultat: 'Seules les références de la liste ont des lignes ; seules elles sont gelées. La liste est figée.',
      },
    ],
    champs: [
      { nom: 'Magasin', description: 'Le magasin à inventorier.', obligatoire: true },
      {
        nom: 'Type',
        description:
          'Global : toutes les références actives du catalogue, théorique à zéro là où la base ne connaît pas de stock — le seul qui découvre une marchandise ignorée. Tournant : les références dues selon leur classe ABC, proposées puis retouchées. Ciblé : les références choisies.',
        obligatoire: true,
        valeurs: 'Global · Tournant · Ciblé',
        defaut: 'Global',
      },
      { nom: 'Ajouter une référence à compter', description: 'Recherche par code ou désignation. La mention dit les kilos en stock ici, ou « pas de stock ici ».' },
      { nom: 'Famille à ajouter', description: 'Une famille : toutes ses références en stock dans ce magasin, par « Ajouter la famille ».' },
      { nom: 'Catégorie à ajouter', description: 'Une catégorie : toutes ses références en stock dans ce magasin, par « Ajouter la catégorie ».' },
    ],
    regles: [
      'Due (tournant) = jamais comptée dans ce magasin, ou pas depuis 30 jours (classe A), 90 (B), 180 (C ou sans classe) — paramètres P_ComptageTournantA / B / C. La classe est celle de la fiche article.',
      'Un tournant ou un ciblé ne se crée pas sans au moins une référence.',
      'Dès la création, ce que l’inventaire compte est gelé (sorties, réceptions, transferts, fiches machine) ; un avis signale ce qui était en route vers le magasin.',
    ],
    messages: [
      { message: 'L’inventaire … est deja ouvert sur le magasin … : cloturez-le (ou annulez-le) avant d’en creer un autre.', cause: 'Un seul inventaire ouvert par magasin.' },
    ],
    liens: [{ route: '/inventaires', libelle: 'Inventaires' }],
  },

  // ==========================================================================
  // INVENTAIRES — le document
  // ==========================================================================
  {
    route: '/inventaires/:id',
    titre: 'Inventaire',
    chemin: 'Stock → Inventaires → clic sur un inventaire',
    objectif:
      'Compter physiquement le stock, comparer au théorique et passer les écarts au stock — comme un bon : Brouillon → Validé → Clôturé.',
    droits:
      'Écriture du module Inventaire pour choisir la liste et compter ; validation pour valider, renvoyer au comptage, clôturer ou annuler. Dévalider un inventaire clôturé : Direction ou Administrateur.',
    procedures: [
      {
        titre: 'Valider la liste d’un tournant ou d’un ciblé encore sans ligne',
        etapes: [
          'Retouchez la liste (recherche, famille, catégorie, ✕).',
          '« Valider la liste et préparer les lignes ».',
        ],
        resultat: 'Les lignes se préparent ; seules ces références sont gelées. Avant, tout le magasin l’est.',
      },
      {
        titre: 'Compter (brouillon)',
        etapes: [
          'Imprimez la feuille de comptage si besoin (icône en haut).',
          'Saisissez sur chaque ligne les kilos comptés, ou les bobines / palettes. Entrée descend au même champ de la ligne suivante.',
          'Un écart au-delà de la tolérance exige un motif.',
          'Un lot trouvé en rayon que la base ne connaît pas : « Lot trouvé au comptage » (référence, N° de lot, kilos), puis « Ajouter le lot ».',
          'Cliquez « Enregistrer le comptage » : toutes les lignes modifiées partent ensemble.',
        ],
        resultat: 'Le comptage est enregistré ; le stock n’a pas bougé.',
      },
      {
        titre: 'Valider le comptage',
        etapes: [
          'Par un AUTRE compte que ceux qui ont compté (l’Administrateur dispensé), avec le droit de valider.',
          '« Valider le comptage », puis confirmer.',
        ],
        resultat: 'Le comptage est figé ; rien n’a encore touché le stock.',
      },
      {
        titre: 'Recompter après validation',
        etapes: ['« Renvoyer au comptage », avec un motif.', 'Il redevient brouillon : on corrige, on enregistre, il se revalide.'],
      },
      {
        titre: 'Clôturer',
        etapes: ['« Clôturer et ajuster », puis confirmer.'],
        resultat:
          'Les écarts passent au stock en mouvements d’ajustement (au plus un pour les excédents, un pour les manquants), au CMUP. Le message donne leur nombre et l’impact en valeur.',
      },
      {
        titre: 'Annuler',
        etapes: ['Sur un brouillon ou un validé : « Annuler », avec un motif.'],
        resultat: 'Aucun ajustement n’est passé ; le magasin est dégelé et un autre inventaire peut être créé.',
      },
    ],
    champs: [
      { nom: 'Magasin', description: 'Le magasin inventorié.' },
      { nom: 'Type', description: 'Global, tournant (proposé selon la classe ABC) ou ciblé (références choisies).' },
      { nom: 'Date', description: 'La date de création.' },
      { nom: 'Créé par', description: 'Le compte qui a créé l’inventaire.' },
      { nom: 'Lignes comptées', description: 'Lignes comptées sur lignes à compter.' },
      { nom: 'Validé par', description: 'Le compte qui a validé le comptage, et la date.' },
      { nom: 'Clôturé le', description: 'La date de clôture.' },
      { nom: 'Statut', description: 'Brouillon, Validé, Clôturé ou Annulé.' },
      { nom: 'Liste validée', description: 'Tournant ou ciblé : le nombre de références choisies, qui a validé la liste et quand.' },
      { nom: 'Référence · lot', description: 'La référence, son lot (ou « Sans lot ») et sa désignation. Une ligne = un lot.' },
      {
        nom: 'Théorique',
        description:
          'Le stock que le grand livre porte pour cette ligne au moment du comptage, et le nombre de bobines. Le magasin étant gelé, il ne bouge plus jusqu’à la clôture.',
        valeurs: 'kg',
      },
      {
        nom: 'Compté kg',
        description:
          'Les kilos comptés. Vide avec des bobines : ils se déduisent au poids d’une bobine du lot (sinon de la fiche article), et l’écran l’indique « déduit des bobines ».',
        valeurs: 'kg',
      },
      { nom: 'Bobines', description: 'Les bobines comptées, nombre entier. Bobines et palettes se répondent par les bobines par palette du lot.' },
      { nom: 'Palettes', description: 'Les palettes comptées (deux décimales pour une palette entamée).' },
      {
        nom: 'Poids / bob.',
        description: 'Kilos ÷ bobines : le poids réel d’une bobine, son écart au poids du lot (ou de la fiche), coloré selon les tolérances de lot.',
      },
      { nom: 'Écart', description: 'Compté − théorique, en kilos et en %. « trouvé » : du stock là où le théorique était à zéro.' },
      {
        nom: 'Motif',
        description: 'La raison de l’écart. Obligatoire au-delà de la tolérance (P_TolerEcartPesee, 2 % par défaut), et pour du stock trouvé là où le théorique était nul.',
      },
      { nom: 'Chercher une référence ou un lot', description: 'Filtre les lignes par code, désignation ou lot.' },
      { nom: 'Lignes affichées', description: 'Toutes, encore à compter, écarts hors tolérance, ou modifiées non enregistrées.' },
      { nom: 'Pourquoi ?', description: 'Le motif d’une annulation ou d’un renvoi au comptage, obligatoire. Il reste affiché sur l’inventaire.', obligatoire: true },
    ],
    regles: [
      'Pendant l’inventaire, ce qu’il compte est gelé : tout le magasin pour un global ; pour un tournant ou un ciblé, ses seules références (sans liste encore, tout le magasin). Seuls passent les ajustements de sa clôture.',
      'Un tournant ou un ciblé ne compte que sa liste : une référence hors liste est refusée, même un lot trouvé ; comptez-la dans un autre inventaire. Une fois les lignes préparées, la liste est figée.',
      'Les références suivies par lot se comptent au lot ; un lot trouvé en rayon ouvre sa ligne au théorique zéro, pour une référence suivie par lot seulement.',
      'Des bobines comptées sans pesée se convertissent au poids d’une bobine du lot, sinon de la fiche article ; sans aucun poids, il faut saisir les kilos.',
      'La validation exige : comptage enregistré, plus aucune ligne à compter, chaque écart hors tolérance justifié.',
      'Celui qui a compté ne valide pas (l’Administrateur dispensé) : la base le refuse.',
      'Validé, le comptage ne se modifie plus ; seul « Renvoyer au comptage » le rouvre.',
      'Clôturé, il ne se défait que par contre-passation de ses ajustements, puis dévalidation : il redevient validé.',
    ],
    messages: [
      { message: 'INV-SEPARATION : vous avez compté des lignes de l’inventaire … : sa validation revient à un autre compte.', cause: 'Ségrégation des tâches : faites valider par un autre compte habilité.' },
      { message: 'INV-SELECTION : la référence … n’est pas dans la liste de l’inventaire…', cause: 'Un tournant ou un ciblé ne compte que sa liste.' },
      { message: 'INV-FIGE : l’inventaire est …, son comptage ne se modifie plus…', cause: 'Renvoyez-le au comptage s’il est validé.' },
      { message: '… ecart(s) hors tolerance sans motif : justification obligatoire.', cause: 'Saisissez le motif de chaque écart signalé.' },
      { message: '… ligne(s) non comptee(s) : comptez-les d’abord.', cause: 'Toutes les lignes doivent être comptées avant la validation.' },
      { message: '… : aucun poids de bobine (ni sur le lot, ni sur la fiche article) — saisissez les kilos comptes.', cause: 'Les bobines ne se convertissent pas sans poids.' },
    ],
    liens: [
      { route: '/inventaires', libelle: 'Inventaires' },
      { route: '/mouvements', libelle: 'Mouvements (ajustements de clôture)' },
    ],
  },

  // ==========================================================================
  // LOTS — la liste
  // ==========================================================================
  {
    route: '/lots',
    titre: 'Lots',
    chemin: 'Stock → Lots',
    objectif:
      'Voir le stock lot par lot et traiter ce qui demande une décision : lots à basculer en Restes, dormants, bloqués, poids en dérive.',
    prerequis: [
      'Un lot naît à sa première entrée en stock (réception, mouvement) : rien à créer à la main.',
    ],
    droits:
      'Lecture du module Lots. Basculer en Restes : écriture des lots. Bloquer, débloquer, décider d’un dormant : validation des lots. La valeur en MAD suit la grille de droits.',
    procedures: [
      {
        titre: 'Lire les onglets',
        etapes: [
          'Comptable — tout le stock, lot par lot, bloqués et dormants compris.',
          'Projet — les lots libres et actifs qui comptent pour le plan d’achat.',
          'Restes — les lots libres passés sous le seuil de leur article : utilisables, mais hors plan d’achat.',
          'Les quatre suivants sont des ALERTES (à 0, rien à faire) : À basculer, Dormants, Bloqués, Dérive de poids.',
        ],
      },
      {
        titre: 'Basculer en Restes',
        etapes: ['Onglet « À basculer » : « Basculer en Restes » sur la ligne, ou « Tout basculer » puis confirmer.'],
        resultat: 'Le lot reste en stock et utilisable, mais ne compte plus pour le plan d’achat. Le geste est inscrit sur sa fiche.',
      },
      {
        titre: 'Bloquer ou débloquer',
        etapes: ['« Bloquer » (ou « Débloquer ») sur la ligne, dites pourquoi, confirmez.'],
        resultat:
          'Bloqué, le lot ne part plus en production (sortie, chargement machine, fusion) ; il peut revenir d’une machine, aller en quarantaine, retourner au fournisseur ou être ajusté à l’inventaire. Il ne se lit plus qu’en vue comptable.',
      },
      {
        titre: 'Décider d’un lot dormant',
        etapes: ['Onglet « Dormants » : « Décider ».', 'Garder, Solder ou Détruire ; dites pourquoi ; « Enregistrer la décision ».'],
        resultat:
          'Garder remet le compteur de dormance à zéro. Solder ou Détruire sort tout le stock du lot, magasin par magasin, par un ajustement d’inventaire motivé.',
      },
    ],
    champs: [
      { nom: 'Article', description: 'Le code de la référence, avec sa désignation dessous. Recherche : article, désignation ou numéro de lot.' },
      { nom: 'Lot', description: 'Le numéro du lot ; « Sans lot » : stock sans numéro. « fusionné dans … » si une partie a été versée dans un autre lot.' },
      {
        nom: 'Origine',
        description: 'D’où vient le numéro.',
        valeurs: 'Fournisseur · Numéro attribué · Retour · Fusion · Sans lot',
      },
      { nom: 'Fournisseur', description: 'Le fournisseur du lot. En filtre : les seuls fournisseurs des lignes affichées.' },
      { nom: 'Catégorie', description: 'Projet (compte pour le plan d’achat) ou Restes.', valeurs: 'Projet · Restes' },
      {
        nom: 'Statut',
        description: 'Ce qu’on peut faire du lot ; « dormant » et « sous le seuil » s’ajoutent en alerte.',
        valeurs: 'Libre · Bloqué · Soldé',
      },
      { nom: 'Solde kg', description: 'Le stock du lot, tous magasins confondus.', valeurs: 'kg' },
      { nom: 'Bobines', description: 'Les bobines en stock ; « — » pour un article géré au kilo (sans poids de bobine).' },
      {
        nom: 'Min. pour produire',
        description:
          'Le seuil Projet / Restes de l’article, dans l’unité où l’atelier le compte : par défaut un étage de machine, 1 344 bobines (P_LotSeuilBobines) ; 5 000 kg pour un article sans poids de bobine (P_LotSeuilRestesKg). Réglable par article sur sa fiche.',
      },
      { nom: 'Sans activité', description: 'Jours depuis la dernière entrée, sortie ou constat. Au-delà d’un an (P_LotDormanceJours, 365), le lot est dormant.', valeurs: 'jours' },
      {
        nom: 'Dérive',
        description: 'L’écart cumulé entre le poids réel des bobines et le poids catalogue, sur toute la vie du lot ; au survol, en kilos.',
        valeurs: 'Vert < 1 % · Orange 1 à 3 % · Rouge > 3 % (P_LotTolOrangePct / P_LotTolRougePct)',
      },
      { nom: 'Valeur MAD', description: 'La valeur du lot au coût moyen. Visible seulement si votre rôle y a droit.' },
      { nom: 'Montrer aussi les lots soldés', description: 'Onglet Comptable : affiche aussi les lots épuisés.' },
      {
        nom: 'Pourquoi ?',
        description: 'Le motif de la décision (bloquer, débloquer, dormant), obligatoire, 5 caractères au moins. Il reste sur la fiche du lot avec votre nom.',
        obligatoire: true,
      },
    ],
    regles: [
      'Un lot neuf est classé seul : Projet s’il atteint le seuil de son article, Restes sinon.',
      'Le passage de Projet en Restes se confirme à la main (onglet « À basculer ») : tant qu’il ne l’est pas, le plan d’achat compte encore le lot.',
      'Un lot dormant n’est jamais soldé en silence : il faut une décision motivée. Un lot bloqué ne se solde pas, ni un lot qui porte encore du fil sur machine.',
    ],
    messages: [
      { message: 'LOT-BLOQUE : le lot … est bloque par la qualite…', cause: 'Il ne part ni en production, ni sur machine, ni en fusion. Un chargement exceptionnel se demande en dérogation (Autorisations).' },
      { message: 'LOT-MACHINE : le lot … porte encore … kg sur machine…', cause: 'Déchargez-le d’abord, ou gardez-le.' },
      { message: 'Ce lot est bloque : la qualite doit d’abord le debloquer.', cause: 'Solder ou détruire demande un lot libre.' },
    ],
    liens: [
      { route: '/autorisations', libelle: 'Autorisations' },
      { route: '/etats/lots', libelle: 'États imprimables des lots' },
    ],
  },

  // ==========================================================================
  // LOTS — la fiche de vie
  // ==========================================================================
  {
    route: '/lots/fiche',
    titre: 'Fiche d’un lot',
    chemin: 'Stock → Lots → clic sur une ligne',
    objectif:
      'Tout savoir d’un lot : identité, conditionnement, où il se trouve, ce qui lui est arrivé — et l’identifier, le fusionner ou corriger son conditionnement.',
    droits:
      'Lecture du module Lots. Corriger le conditionnement : validation des lots. Identifier, fusionner : écriture des mouvements. Bloquer, basculer, dormant : comme sur la liste des lots.',
    procedures: [
      {
        titre: 'Corriger le conditionnement du lot',
        etapes: [
          'Carte « Conditionnement du lot » : saisissez le poids d’une bobine et / ou les bobines par palette mesurés.',
          'Écrivez le motif (pesée de contrôle, comptage d’une palette…), puis « Corriger ».',
        ],
        resultat:
          'Toutes les conversions palettes ↔ bobines ↔ kilos de ce lot se font désormais avec ces valeurs. La correction est inscrite au journal du conditionnement.',
      },
      {
        titre: 'Identifier un stock « Sans lot » ou à numéro attribué',
        etapes: ['Carte « Identifier le lot » : saisissez le numéro lu sur l’étiquette du fournisseur, « Identifier », confirmez.'],
        resultat: 'Tout le stock passe sous ce numéro, magasin par magasin, par mouvements internes ; ni le magasin ni le coût moyen ne bougent.',
      },
      {
        titre: 'Fusionner d’autres lots dans celui-ci',
        etapes: [
          'Ouvrez « Fusionner d’autres lots dans celui-ci », choisissez le magasin.',
          'Cochez les lots à verser ; ceux qui ne peuvent pas l’être disent pourquoi (colonne « Fusion »).',
          'Dites pourquoi fusionner, puis « Fusionner dans ce lot ».',
        ],
        resultat: 'Les kilos passent dans ce lot, dans le même magasin, sans effet sur le coût moyen ; les lots vidés deviennent soldés.',
      },
    ],
    champs: [
      { nom: 'Article', description: 'La référence et sa désignation.' },
      { nom: 'Numéro de lot', description: 'Le numéro du lot (« Sans lot » s’il n’en a pas).' },
      { nom: 'Origine', description: 'Fournisseur, numéro attribué, retour, fusion ou sans lot.' },
      { nom: 'Fournisseur', description: 'Le fournisseur du lot (aussi colonne du tableau de fusion).' },
      { nom: 'Statut', description: 'Libre, Bloqué ou Soldé.' },
      { nom: 'Catégorie', description: 'Projet ou Restes.' },
      { nom: 'Solde', description: 'Le stock du lot en kilos et en bobines.' },
      { nom: 'Minimum d’un lot pour produire', description: 'Le seuil Projet / Restes de l’article, et sa traduction en kilos.' },
      { nom: 'Poids par bobine', description: 'Sans objet pour un article géré au kilo (pas de poids de bobine au catalogue).' },
      { nom: 'Variation cumulée', description: 'L’écart total entre poids réel et poids catalogue sur toutes les pesées du lot.', valeurs: '% et kg' },
      { nom: 'Poids moyen d’une bobine', description: 'Le poids réel moyen d’une bobine face au poids catalogue, et l’écart en %.' },
      { nom: 'Créé le', description: 'La date de naissance du lot.' },
      { nom: 'Dernière activité', description: 'La dernière entrée, sortie ou constat, et les jours écoulés.' },
      { nom: 'Valeur', description: 'La valeur du lot en MAD, si votre rôle la voit.' },
      {
        nom: 'Poids d’une bobine',
        description:
          'Le poids d’une bobine DU LOT, avec sa source (mesuré à la réception, repris, fiche article, corrigé à la main) et celui de la fiche article. En correction : la nouvelle valeur, en kilos.',
        valeurs: 'kg, nombre positif',
      },
      {
        nom: 'Bobines par palette',
        description: 'Les bobines par palette DU LOT, avec leur source et celles de la fiche article. En correction : un entier positif.',
      },
      { nom: 'Une palette du lot', description: 'Poids d’une bobine × bobines par palette.', valeurs: 'kg' },
      { nom: 'Depuis le', description: 'La date du conditionnement en vigueur.' },
      {
        nom: 'Motif',
        description: 'Correction du conditionnement : pourquoi on corrige (obligatoire). Dans les tableaux : le motif de l’événement ou de la mesure.',
      },
      { nom: 'Source', description: 'Journal du conditionnement : réception (avec son numéro) ou correction (avec son auteur).' },
      { nom: 'Poids (kg)', description: 'Journal : poids d’une bobine avant → après ; « mesuré » quand la mesure n’a pas été appliquée.' },
      { nom: 'Bob./palette', description: 'Journal : bobines par palette avant → après ; « observé » quand l’observation n’a pas été appliquée.' },
      { nom: 'Magasin', description: 'En magasin : le magasin qui porte le lot. Fusion : le magasin où se fait la fusion (obligatoire).' },
      { nom: 'Couleur', description: 'Le code couleur du lot dans ce magasin.' },
      { nom: 'Kg', description: 'Les kilos du lot à cet endroit (ou de l’événement, signés).' },
      { nom: 'Bobines', description: 'Les bobines du lot à cet endroit, ou de l’événement.' },
      { nom: 'Date', description: 'Vie du lot et journal du conditionnement : la date de l’événement.' },
      { nom: 'Document', description: 'Vie du lot : le document de l’événement (mouvement, fiche, réception) et son document d’origine.' },
      { nom: 'Machine', description: 'Sur machine : la machine qui porte des bobines du lot.' },
      { nom: 'Zone', description: 'Sur machine : l’étage ou la zone.' },
      { nom: 'Événement', description: 'Vie du lot : mouvement, décision ou autorisation, en clair.' },
      { nom: 'Lieu', description: 'Vie du lot : le magasin ou l’emplacement de l’événement.' },
      { nom: 'Théorique', description: 'Vie du lot : le poids attendu (bobines × poids catalogue) d’une pesée.' },
      { nom: 'Écart', description: 'Vie du lot : l’écart de la pesée au théorique, coloré selon les tolérances.' },
      { nom: 'Par', description: 'Vie du lot : l’auteur de l’événement.' },
      { nom: 'Numéro de lot lu sur l’étiquette du fournisseur', description: 'Identifier : le vrai numéro du lot, lu sur la marchandise.' },
      { nom: 'Fusion', description: 'Tableau de fusion : « Possible », ou la raison du refus (bloqué, soldé, autre fournisseur, autre couleur).' },
      { nom: 'Pourquoi fusionner ?', description: 'Le motif de la fusion, 5 caractères au moins.', obligatoire: true },
      { nom: 'Pourquoi ?', description: 'Le motif d’une décision sur le lot (bloquer, débloquer, Restes / Projet, dormant), obligatoire.', obligatoire: true },
    ],
    regles: [
      'Le bandeau du haut dit ce qui demande une action : lot bloqué, soldé, dormant, à basculer, ou poids en dérive.',
      'Le conditionnement est PAR LOT : mesuré à la réception, à défaut celui de la fiche article. Une réception suivante ne l’écrase pas : sa mesure est notée, non appliquée.',
      'La fusion ne réunit que des lots libres du même article, du même fournisseur et de la même couleur, dans le même magasin, et seulement si la fiche article la permet.',
      'Revenir de Restes en Projet, ou passer en Restes un lot qui n’est pas sous le seuil, demande un motif.',
      'La fiche s’imprime : c’est la traçabilité du lot sur papier.',
    ],
    messages: [
      { message: 'Le lot porte deja ce conditionnement : rien a corriger.', cause: 'Les valeurs saisies sont celles du lot.' },
      { message: 'Le lot … vient d’un autre fournisseur : la fusion est refusee.', cause: 'Deux fournisseurs ne se fusionnent pas.' },
      { message: 'Le lot … n’a pas la meme couleur : la fusion est refusee.', cause: 'Deux couleurs ne se fusionnent pas.' },
      { message: 'Le lot … existe chez un autre fournisseur.', cause: 'Identifier : le numéro saisi appartient déjà à un autre fournisseur.' },
    ],
    liens: [{ route: '/lots', libelle: 'Lots' }],
  },

  // ==========================================================================
  // AUTORISATIONS
  // ==========================================================================
  {
    route: '/autorisations',
    titre: 'Autorisations',
    chemin: 'Stock → Autorisations',
    objectif:
      'Accorder ou refuser l’accord demandé quand une opération sort des règles : écart de poids, mélange de fournisseurs, lot bloqué, restes en production…',
    droits:
      'Lecture du module Lots pour consulter. Accorder ou refuser : validation des lots ; jamais sa propre demande (l’Administrateur dispensé). Retirer : le demandeur seul.',
    procedures: [
      {
        titre: 'Répondre à une demande',
        etapes: [
          'Onglet « À décider » : la plus ancienne demande en premier.',
          '« Accorder » ou « Refuser », écrivez le motif (obligatoire dans les deux cas), confirmez.',
        ],
        resultat: 'Accordée, le document en attente pourra passer, une fois ; la dérogation est inscrite sur la fiche du lot. Refusée, il reste bloqué.',
      },
      {
        titre: 'Retirer sa propre demande',
        etapes: ['« Retirer » sur votre demande en attente, puis confirmer.'],
        resultat: 'Elle quitte la file et reste dans l’historique.',
      },
    ],
    champs: [
      { nom: 'Type de demande', description: 'Filtre : écart de poids, mélange de fournisseurs, lot bloqué, restes en production, retour au magasin principal, lot dormant, fusion, stock insuffisant.' },
      { nom: 'Demandée le', description: 'Date et heure de la demande.' },
      { nom: 'Demande', description: 'Le type, son niveau (Orange / Rouge) et ses détails chiffrés.' },
      { nom: 'Article / lot', description: 'La référence et le lot concernés ; pour une dérogation de lot bloqué, les kilos accordés au plus et ceux déjà employés.' },
      { nom: 'Document', description: 'Le document en attente (fiche, mouvement…).' },
      { nom: 'Par', description: 'Le demandeur ; « (vous) » pour vos propres demandes.' },
      { nom: 'Motif de la demande', description: 'Ce que le demandeur a écrit.' },
      { nom: 'Réponse', description: 'Historique : Accordée, Refusée ou Annulée, et le motif de la décision.' },
      { nom: 'Décidée par', description: 'Historique : qui a tranché, et quand.' },
      { nom: 'Décision', description: 'Les boutons Accorder / Refuser / Retirer selon vos droits.' },
      { nom: 'Pourquoi ?', description: 'Le motif de la décision : obligatoire pour accorder ou refuser (5 caractères au moins), facultatif pour retirer.' },
    ],
    regles: [
      'Une même demande n’est pas créée deux fois tant que la première attend.',
      'Un accord s’explique comme un refus : le motif est obligatoire.',
      'Une seule réponse : si deux responsables répondent en même temps, le second trouve la demande déjà tranchée.',
      'Une dérogation de lot bloqué sert une fois, pour le lot et la fiche qu’elle nomme, et au plus les kilos demandés.',
      'L’onglet « Historique » garde toutes les demandes tranchées, les plus récentes en premier.',
    ],
    messages: [
      { message: 'On n’autorise pas sa propre demande : un autre responsable doit repondre.', cause: 'Ségrégation des tâches.' },
      { message: 'Cette demande vient d’etre tranchee par un autre responsable : rechargez la file.', cause: 'Une seule réponse par demande.' },
      { message: 'Une decision s’explique : le motif est obligatoire (cinq caracteres au moins).', cause: 'Écrivez pourquoi vous accordez ou refusez.' },
    ],
    liens: [{ route: '/lots', libelle: 'Lots' }],
  },

  // ==========================================================================
  // ÉTAT DES STOCKS
  // ==========================================================================
  {
    route: '/etat-stock',
    titre: 'État des stocks',
    chemin: 'Stock → État des stocks',
    objectif:
      'Voir, à l’instant, une ligne par référence : où est le stock (magasins, machines), son comptage en palettes et bobines, ce qu’il annonce et ce qu’il vaut ; l’imprimer ou l’exporter.',
    droits: 'Lecture du module Stock. Les montants (CMUP, valeur) ne s’affichent qu’à qui a le droit de les voir.',
    procedures: [
      {
        titre: 'Trouver et lire',
        etapes: [
          'Filtrez par catégorie, fournisseur, classe ABC, unité ou magasin ; cherchez une référence, une désignation ou un fournisseur ; choisissez un statut.',
          'Cliquez une référence pour déplier son stock par lot, magasin par magasin.',
          '« Imprimer » sort l’état papier (en-tête, date, opérateur) ; « Export » le fichier CSV de ce qui est filtré.',
        ],
      },
    ],
    champs: [
      { nom: 'Stock global', description: 'Tuile : le total des références filtrées, magasins et machines.', valeurs: 'kg' },
      { nom: 'En magasin', description: 'Tuile : la part en magasin.', valeurs: 'kg' },
      { nom: 'Sur machines', description: 'Tuile : le fil chargé sur les machines.', valeurs: 'kg' },
      { nom: 'Valeur', description: 'La valeur au CMUP (tuile : le total filtré).', valeurs: 'MAD' },
      {
        nom: 'Sous la sécurité du jour',
        description:
          'Tuile : le nombre de références dont le disponible compté par le moteur de couverture est, aujourd’hui, sous la sécurité du jour (jours de sécurité de la classe ABC × plan à venir). Un seuil d’avenir, au plan — plus le stock minimum de la fiche.',
      },
      { nom: 'Catégorie', description: 'Filtre : la catégorie de matière.' },
      { nom: 'Fournisseur', description: 'Filtre : le fournisseur habituel.' },
      { nom: 'Classe ABC', description: 'Filtre : la classe ABC de la fiche article.' },
      { nom: 'Unité', description: 'Filtre : l’unité du catalogue.' },
      { nom: 'Magasin', description: 'Filtre : les seules références qui ont du stock dans ce magasin.' },
      { nom: 'Référence', description: 'La désignation, le fournisseur et la classe ABC/XYZ. Clic : le stock par lot.' },
      { nom: 'Global', description: 'Stock total de la référence (magasins + machines).', valeurs: 'kg' },
      { nom: 'Machines', description: 'Le fil chargé sur les machines ; au survol, les bobines et le nombre de machines.', valeurs: 'kg' },
      { nom: 'Palettes', description: 'Le stock global exprimé en palettes, au conditionnement de la fiche article. « — » : poids de bobine ou bobines par palette inconnus.' },
      { nom: 'Bobines', description: 'Le stock global exprimé en bobines (fiche article) ; dans le détail par lot, les bobines du lot.' },
      {
        nom: 'Sécu.',
        alias: ['Sécurité du jour (plan)'],
        description:
          'La sécurité du jour du moteur de couverture : jours de sécurité de la classe ABC × plan moyen à venir sur la fenêtre de couverture. Un seuil d’avenir, au plan ; le stock minimum de la fiche n’entre plus dans aucun calcul (décision du 10/10/2026).',
        valeurs: 'kg',
      },
      {
        nom: 'Couv. j',
        description:
          'Les jours couverts au moteur de couverture : d’aujourd’hui à la veille de la première rupture du plan. « horizon » : aucune rupture jusqu’à la fin du plan en service.',
        valeurs: 'jours',
      },
      {
        nom: 'Statut',
        description:
          'L’état au moteur de couverture (le même que le stock projeté et le plan d’achat) : Plan non couvert (une rupture est prévue sur l’horizon du plan), Sous la sécurité (le solde projeté passe sous la sécurité, sans rupture), Couvert. « SOUS SÉCU. » : le disponible compté est, aujourd’hui, sous la sécurité du jour — une information, qui n’entre pas dans l’état.',
        valeurs: 'Plan non couvert · Sous la sécurité · Couvert',
      },
      { nom: 'CMUP', description: 'Le coût moyen unitaire pondéré.', valeurs: 'MAD/kg' },
      { nom: 'Valeur MAD', description: 'Stock × CMUP.' },
      {
        nom: 'A cder kg',
        description:
          'La quantité de la première proposition du moteur de couverture (celle de l’onglet « À commander » du plan d’achat) ; en rouge quand sa date limite de commande est atteinte. Vide : rien à commander.',
        valeurs: 'kg',
      },
      { nom: 'Disponible', description: 'Téléphone : le stock physique net (hors quarantaine).', valeurs: 'kg' },
      {
        nom: 'Réel / mois',
        description:
          'Téléphone : la consommation RÉELLE du grand livre de la consommation, moyenne des 12 mois pleins glissants (rebut compris, retours déduits). Un constat du passé, à côté du « Plan / mois » du moteur.',
        valeurs: 'kg',
      },
      { nom: 'Couverture', description: 'Téléphone : comme « Couv. j » — les jours couverts, ou « tout l’horizon ».' },
      {
        nom: 'Plan / mois',
        description: 'Téléphone : le plan de l’horizon ramené à un mois de 30 jours, tel que le moteur de couverture le consomme.',
        valeurs: 'kg',
      },
      {
        nom: 'Arrivages comptés',
        description:
          'Téléphone : les arrivages que le moteur compte à leur date (bons validés datés, fil en route à sa date prévue de disponibilité).',
        valeurs: 'kg',
      },
      { nom: 'Plan non couvert', description: 'Téléphone : les kilos du plan que le solde ne couvre pas sur l’horizon.', valeurs: 'kg' },
      { nom: 'A commander', description: 'Téléphone : comme « A cder kg ».', valeurs: 'kg' },
      { nom: 'Sans mouvement', description: 'Téléphone : jours depuis le dernier mouvement.' },
      { nom: 'Equivalents', description: 'Téléphone : le nombre de références équivalentes actives.' },
      { nom: 'Comptage', description: 'Le stock en palettes et bobines, tel qu’on le compte au magasin.' },
      { nom: 'Couleur', description: 'Détail par lot : la couleur du lot.' },
      { nom: 'Kg', description: 'Détail par lot : les kilos du lot dans ce magasin.' },
      { nom: 'Entré le', description: 'Détail par lot : la première entrée du lot, le plus ancien d’abord.' },
    ],
    regles: [
      'C’est l’état à l’instant : il n’y a pas de date à choisir.',
      'Les colonnes de magasin viennent du stock réel : un magasin vide n’a pas de colonne ; les étages de machine tiennent dans la colonne « Machines ».',
      'Les totaux portent sur toutes les références filtrées, pas sur la seule page affichée.',
      '« Sans lot » ferme le compte d’un magasin : c’est le stock que les lots n’expliquent pas ; en rouge, les lots dépassent le stock du magasin.',
    ],
    liens: [
      { route: '/lots', libelle: 'Lots' },
      { route: '/mouvements', libelle: 'Mouvements' },
    ],
  },

  // ==========================================================================
  // ANALYSE ABC / XYZ
  // ==========================================================================
  {
    route: '/classification',
    titre: 'Analyse ABC / XYZ',
    chemin: 'Finance → Analyse ABC / XYZ',
    objectif:
      'Classer chaque référence par son poids dans la dépense (ABC) et la régularité de sa consommation (XYZ), et en déduire une politique de stock.',
    droits:
      'Lecture du module Stock. Le bouton « Recalculer le classement » s’affiche à qui écrit au Stock ; le serveur exige l’écriture au Catalogue. La valeur suit la grille de droits.',
    procedures: [
      {
        titre: 'Lire la matrice',
        etapes: [
          'Chaque case croise une classe ABC (lignes) et XYZ (colonnes) : le nombre de références, et leur valeur réelle sur les 12 mois pleins.',
          'Cliquez une case pour filtrer la liste dessous ; « voir tout » revient à la liste entière.',
          '« Non classées » : les références sans consommation.',
        ],
      },
      {
        titre: 'Recalculer',
        etapes: ['« Recalculer le classement ».'],
        resultat: 'Les classes de chaque fiche article sont réécrites ; le message donne le nombre de références en A, B et C.',
      },
    ],
    champs: [
      { nom: 'Rang', description: 'Le rang de la référence par valeur réelle sur 12 mois décroissante.' },
      { nom: 'Référence', description: 'Le code et la désignation.' },
      { nom: 'Classe', description: 'Les deux lettres : ABC puis XYZ (« ? » : pas de classe XYZ).' },
      { nom: 'Fournisseur', description: 'Le fournisseur habituel.' },
      {
        nom: 'Réel / mois',
        description:
          'La consommation RÉELLE moyenne par mois : le grand livre de la consommation sur les 12 mois pleins glissants (les 12 mois calendaires complets avant le mois en cours) ÷ 12, rebut compris, retours déduits. Le plan n’y entre pas.',
        valeurs: 'kg',
      },
      {
        nom: 'Valeur réelle 12 mois',
        description:
          'La valeur au livre de cette consommation réelle sur les 12 mois pleins : le prix de sortie porté par chaque mouvement, et pour un fait machine le CMUP du jour du fait. Ce n’est plus « conso mensuelle × 12 × CMUP ».',
        valeurs: 'MAD',
      },
      { nom: 'Part', description: 'La part de la référence dans la valeur totale.', valeurs: '%' },
      { nom: 'Cumul', description: 'La part cumulée jusqu’à cette référence : elle fixe la classe ABC.', valeurs: '%' },
      {
        nom: 'Politique deduite',
        description: 'La politique de stock tirée des deux lettres : AX flux tendu, AZ stock de sécurité élevé, BX réapprovisionnement automatique, CZ à la demande…',
      },
    ],
    regles: [
      'ABC : A jusqu’à 80 % de la valeur réelle cumulée (P_SeuilABCA), B jusqu’à 95 % (P_SeuilABCB), C au-delà.',
      'XYZ : coefficient de variation de la consommation RÉELLE (grand livre) sur les 12 mois pleins glissants — X sous 0,25 (P_SeuilXYZ_X), Y sous 0,50 (P_SeuilXYZ_Y), Z au-delà.',
      'Une référence sans consommation ne se classe pas en XYZ : elle est rangée en C et regroupée dans « Non classées ».',
      'La teinte d’une case suit le nombre de références, pas la valeur.',
      'C’est le croisement des deux lettres qui commande la politique : une AZ ne se gère pas comme une AX. La classe ABC sert aussi au tournant des inventaires.',
    ],
    liens: [{ route: '/inventaires', libelle: 'Inventaires (tournant)' }],
  },

  // ==========================================================================
  // STOCK PROJETÉ — trois onglets sur le même moteur de couverture (27/10/2026)
  // ==========================================================================
  {
    route: '/stock',
    titre: 'Stock projeté et alertes',
    chemin: 'Planification → Stock projeté et alertes',
    objectif:
      'Voir, pour chaque matière suivie, ce qui est compté aujourd’hui, ce qui arrive, ce que le plan demande jusqu’à la livraison, jusqu’où il est couvert et ce qu’il faut commander pour combien ; essayer des hypothèses sans rien enregistrer ; surveiller les références à commander. Trois onglets — Stock projeté, Simulation, Surveillance / Alertes — sur LE MÊME moteur de couverture.',
    prerequis: [
      'Un plan de production en service dont le MRP est calculé : c’est sa demande, jour par jour, que le moteur projette.',
    ],
    droits:
      'Lecture du module Stock pour l’onglet Stock projeté. La grande fenêtre de détail, la Simulation et la Surveillance lisent le moteur sous le droit de lecture du Plan d’achat : sans lui, ces onglets sont grisés. Les montants (prix, montant de la commande) suivent la grille de droits, comme au plan d’achat. Les colonnes que votre grille masque ne sont ni affichées ni envoyées.',
    procedures: [
      {
        titre: 'Lire le stock projeté (onglet « Stock projeté »)',
        etapes: [
          'Dans le rail, choisissez un état (Plan non couvert, Sous la sécurité, Couvert), « À commander aujourd’hui » ou une classe ABC : chaque entrée porte le nombre de références derrière elle. Cherchez une référence, une désignation ou un fournisseur ; affinez avec les filtres État, Fournisseur, Classe ABC, Référence.',
          'Lisez la ligne de gauche à droite : Disponible + Sur machine + Restant + Arrivages = Stock total projeté (aucun kilo compté deux fois) ; face à lui, le Besoin jusqu’à livraison ; puis la Couverture planifiée, ce qu’il faut commander et son montant.',
          'Ce qui ne tient pas dans la largeur passe, avec son titre, sur la ligne ↳ sous la référence (Fournisseur, Délai, 1re rupture, Date limite de commande, ABC / XYZ d’abord).',
          'Cliquez une ligne : la GRANDE FENÊTRE du détail s’ouvre — situation, approvisionnement, courbe, projection chronologique, résultat MRP, calcul de la proposition, ressources et arrivages, besoins du plan mois par mois. Échap ou la croix la ferment.',
          'Clic droit sur une ligne : commander la référence (nouveau bon), ouvrir sa fiche, son historique de mouvements, chercher un équivalent, lancer un inventaire.',
        ],
        resultat: 'Vous savez quelles références menacent le plan, depuis quand, et ce qu’il faut commander, pour combien.',
      },
      {
        titre: 'Reconstituer une proposition (fenêtre de détail)',
        etapes: [
          '« Résultat MRP » : la première date sous la sécurité, la première rupture, le besoin non couvert, la quantité proposée, D, la date limite de commande, la prochaine proposition et le montant.',
          'Dessous, la reconstitution au jour déterminant : plan de D au jour déterminant + sécurité − S(D) − arrivages après D = besoin de réapprovisionnement ; + minimum ; + arrondi = quantité proposée. La fenêtre est [D, F[ : D inclus, F exclu.',
          '« Projection chronologique » : « Par événements » (comme la chronologie) ou « Jour par jour » (toute l’horizon, défilement dans le tableau).',
        ],
      },
      {
        titre: 'Essayer une hypothèse (onglet « Simulation »)',
        etapes: [
          'Choisissez la « Référence à simuler » (ou « Simuler cette référence » dans la fenêtre de détail) : la situation réelle s’affiche, et la simulation sans hypothèse la rend à l’identique.',
          'Saisissez une ou plusieurs hypothèses : un délai fournisseur, une couverture d’une commande, des jours de sécurité, un minimum ou un multiple ; changez la date ou les kilos d’un arrivage lu, ou retirez-le ; « Ajouter un arrivage » ; « Simuler une commande » (préremplie avec la première proposition : sa date D et sa quantité).',
          'À chaque changement, le même moteur recalcule : le tableau « Réel / Simulé » met en couleur ce qui change ; la courbe trace le solde simulé, le réel en pointillé ; dessous, le calcul de la proposition simulée, les arrivages simulés et la projection simulée.',
          '« Tout effacer » revient à la situation réelle. Quitter la page efface les hypothèses.',
        ],
        resultat: 'Vous voyez ce que l’hypothèse change — couverture, rupture, besoin non couvert, quantité à commander, date limite — sans que rien soit enregistré.',
      },
      {
        titre: 'Surveiller (onglet « Surveillance / Alertes »)',
        etapes: [
          'C’est exactement la liste « À commander » du plan d’achat : une ligne par référence, la première rupture la plus proche en tête, puis la date limite de commande.',
          'Filtrez par fournisseur, proposition, plan non couvert ; cliquez une ligne pour la même fenêtre de détail qu’au plan d’achat.',
          'Pour commander, passez par le plan d’achat (« Commander ») ou le clic droit du premier onglet.',
        ],
      },
    ],
    champs: [
      /* --- Onglet « Stock projeté » : la liste ------------------------------ */
      {
        nom: 'Référence',
        description:
          'Le code de la référence. Comme filtre, une recherche sur le code. Dans la Surveillance, suivi de la désignation et du fournisseur ; l’icône ⤢ ouvre la fenêtre de détail.',
      },
      {
        nom: 'Désignation',
        description: 'La désignation de la fiche article (« — » quand elle répète le code). Elle passe la première sur la ligne ↳ quand la place manque.',
      },
      {
        nom: 'Disponible',
        description:
          'Stock projeté : les magasins comptés au plan, hors quarantaine, hors magasins exclus du plan, lots bloqués retirés et HORS RESTES (les restes sont dans « Restant »). Surveillance : le disponible compté du moteur, restes compris — magasins comptés + fil sur métiers.',
        valeurs: 'kg (source : moteur, magasin compté − restes en magasin)',
      },
      {
        nom: 'Sur machine',
        description:
          'Le fil sur les machines au dernier constat, quel que soit son âge, lots bloqués exclus, HORS RESTES chargés (comptés dans « Restant »). Dans la fenêtre : tout le fil compté sur machine.',
        valeurs: 'kg (source : moteur, machine_etat au dernier constat)',
      },
      {
        nom: 'Restant',
        description:
          'Les restes que le moteur compte : lots de catégorie RESTES non bloqués, en magasin compté ou chargés sur machine. Comptés une seule fois : ils ne sont ni dans « Disponible » ni dans « Sur machine ».',
        valeurs: 'kg (source : moteur)',
      },
      {
        nom: 'Arrivages',
        description:
          'Les arrivages que le moteur compte à leur date dans l’horizon : lignes de bon validé, envoyé ou livré partiellement, fil en route à sa date prévue de disponibilité. Au survol, le prochain. Un bon ou un transfert en retard ou sans date, un bon non validé, l’import sans bon n’y sont pas. Dans la projection : les arrivages comptés depuis la rangée précédente.',
        valeurs: 'kg (source : moteur, arrivages comptés)',
      },
      {
        nom: 'Stock total projeté',
        description:
          'Disponible + Sur machine + Restant + Arrivages : tout ce que le moteur compte pour couvrir le plan sur l’horizon, sans aucun recouvrement (la somme des trois premières colonnes est exactement le disponible compté du moteur).',
        valeurs: 'kg',
      },
      {
        nom: 'Besoin jusqu’à livraison',
        description:
          'Le PLAN DATÉ des jours [aujourd’hui, aujourd’hui + délai fournisseur[ — ce que le stock d’aujourd’hui doit servir avant qu’une commande passée ce jour puisse arriver (le jour d’arrivée est exclu : son arrivage compte avant son plan). Lu sur la projection journalière du moteur. En orange quand il dépasse le stock compté d’aujourd’hui.',
        valeurs: 'kg (source : moteur, plan jour par jour)',
      },
      {
        nom: 'Couverture planifiée',
        description:
          'Les jours couverts à partir d’aujourd’hui, jusqu’à la veille de la première rupture du plan (0 : rupture aujourd’hui). « horizon » : aucune rupture jusqu’à la fin du plan en service. En rouge : plan non couvert ; en orange : sous la sécurité. Au survol, la cause en une date.',
        valeurs: 'jours (source : moteur, jours_couverture)',
      },
      {
        nom: 'À commander',
        description:
          'La quantité de la première proposition du moteur — celle de l’onglet « À commander » du plan d’achat, que « Commander » enregistre. En rouge quand sa date limite de commande est atteinte ou dépassée. « — » : rien à commander.',
        valeurs: 'kg (source : moteur, 1re proposition)',
      },
      {
        nom: 'Montant commande',
        description:
          'À commander × le prix d’achat estimé — LE MÊME prix que la proposition du plan d’achat : dernier achat chez le fournisseur, sinon catalogue au taux du jour, sinon CMUP (au survol, la source). Masqué selon votre grille de droits, comme les montants du plan d’achat ; au CMUP, masqué à qui ne voit pas le CMUP.',
        valeurs: 'MAD',
      },
      { nom: 'Fournisseur', description: 'Le fournisseur de la fiche article. Comme filtre, la liste se cherche à la frappe.' },
      {
        nom: 'Délai (j)',
        description: 'Le délai de livraison retenu (celui du fournisseur, sinon P_DelaiDefaut) : D − délai donne la date limite de commande.',
        valeurs: 'jours',
      },
      {
        nom: '1re rupture',
        description:
          'Le premier jour où le plan n’est plus couvert (aucune : couvert sur tout l’horizon). Dans la Surveillance, en rouge quand il tombe avant aujourd’hui + délai : une commande passée maintenant arrivera trop tard.',
        valeurs: 'date (source : moteur)',
      },
      {
        nom: 'Date limite de commande',
        description: 'La date limite de commande de la première proposition : D − délai fournisseur. En rouge une fois atteinte.',
        valeurs: 'date (source : moteur)',
      },
      { nom: 'ABC / XYZ', description: 'La classe ABC puis XYZ de la fiche article. La classe ABC fixe les jours de sécurité du moteur.' },
      { nom: 'État', description: 'Filtre : l’état au moteur — Plan non couvert, Sous la sécurité, Couvert.', valeurs: 'Plan non couvert · Sous la sécurité · Couvert' },
      { nom: 'Classe ABC', description: 'Filtre : la classe ABC de la fiche article.' },
      /* --- Onglet « Surveillance / Alertes » : la liste « À commander » ----- */
      {
        nom: 'Couvert jusqu’au',
        description:
          'Le dernier jour où le solde projeté couvre le plan, la veille de la première rupture. « tout l’horizon » : aucune rupture jusqu’à la fin du plan. « non couvert » : la rupture est dès aujourd’hui.',
        valeurs: 'date',
      },
      {
        nom: 'Prochain arrivage',
        description: 'Le premier arrivage COMPTÉ et ses kilos (bon validé daté, transfert en route à sa date prévue de disponibilité).',
      },
      {
        nom: 'Plan non couvert',
        description:
          'Les kilos du plan que le solde ne peut pas servir sur l’horizon, perdus jour par jour : ni reportés, ni rattrapés (le solde ne descend jamais sous zéro). Comme filtre : avant ou après aujourd’hui + délai, ou couvert sur l’horizon.',
        valeurs: 'kg',
      },
      { nom: 'Délai', description: 'Le délai de livraison du fournisseur, en jours (au survol, sa source).', valeurs: 'jours' },
      {
        nom: 'Proposition',
        description:
          'La quantité de la première proposition du moteur, et son équivalent en palettes ordinaires de la fiche (pour information). « rien » : aucune proposition — au survol, la raison.',
        valeurs: 'kg',
      },
      { nom: 'Avant le', description: 'La date limite de commande de la première proposition (D − délai). En rouge une fois dépassée, en orange à 7 jours ou moins.', valeurs: 'date' },
      /* --- La fenêtre de détail : situation ----------------------------------- */
      {
        nom: 'Délai fournisseur',
        description: 'Le délai retenu par le calcul et sa source : le fournisseur, sinon le paramètre global P_DelaiDefaut (« simulation » dans l’espace Simulation).',
        valeurs: 'jours',
      },
      {
        nom: 'Prix d’achat',
        description: 'Le prix au kilo que la proposition du plan d’achat retiendrait, et sa source (dernier achat, catalogue au taux du jour, CMUP). Masqué selon vos droits.',
        valeurs: 'MAD/kg',
      },
      { nom: 'Stock total', description: 'Tout le stock physique de la référence, compté ou non : magasins comptés, sur machine, quarantaine, bloqué, magasins hors plan.', valeurs: 'kg' },
      { nom: 'Disponible (compté)', description: 'Ce que le moteur compte aujourd’hui : magasins comptés + fil sur machine, restes compris, lots bloqués exclus.', valeurs: 'kg' },
      { nom: 'Disponible hors quarantaine', description: 'Les magasins comptés au plan seuls (hors quarantaine, hors magasins exclus, lots bloqués retirés, restes compris).', valeurs: 'kg' },
      { nom: 'Arrivages prévus', description: 'Les arrivages comptés à leur date sur l’horizon (voir « Arrivages »).', valeurs: 'kg' },
      { nom: 'Stock y compris arrivages', description: 'Le disponible compté + les arrivages comptés : le « Stock total projeté » de la liste.', valeurs: 'kg' },
      {
        nom: 'Seuil de sécurité',
        description:
          'La ligne de sécurité du moteur aujourd’hui : jours de sécurité de la classe ABC × plan moyen par jour sur la fenêtre de couverture à venir. Un seuil d’avenir, au plan — pas le stock minimum de la fiche.',
        valeurs: 'kg',
      },
      { nom: 'Plan / mois', description: 'Le plan de l’horizon ramené à un mois de 30 jours, tel que le moteur le consomme (source : plan_mois_kg).', valeurs: 'kg' },
      {
        nom: 'Réel / mois',
        description: 'La consommation RÉELLE, moyenne des 12 mois pleins glissants du grand livre de la consommation. Un constat du passé : le moteur ne la lit pas.',
        valeurs: 'kg',
      },
      { nom: 'Montant de la commande', description: 'Comme « Montant commande » : à commander × prix d’achat. Masqué selon vos droits.', valeurs: 'MAD' },
      /* --- La fenêtre de détail : approvisionnement ------------------------- */
      { nom: 'Couverture d’une commande', description: 'Les jours que couvre une commande, F = D + couverture : celle du fournisseur, sinon P_MargeJours (30 jours pleins).', valeurs: 'jours' },
      { nom: 'Jours de sécurité', description: 'Les jours de sécurité de la classe ABC (P_SecuriteA, B, C) ; sans classe, la plus longue des trois. Une hypothèse de la Simulation peut les remplacer.', valeurs: 'jours' },
      { nom: 'Horizon du plan', description: 'La fin de l’horizon : la date de fin du plan en service, ou la fin de son dernier mois de besoin si elle va plus loin.' },
      { nom: 'Minimum de commande', description: 'Le minimum de commande (MOQ) de la fiche, appliqué après le besoin théorique. « aucun » : pas de minimum.', valeurs: 'kg' },
      { nom: 'Règle d’arrondi', description: 'L’arrondi VERS LE HAUT après le minimum : le multiple d’achat de la fiche, sinon la palette si « Arrondi à la palette pleine » est coché ; sinon pas d’arrondi.' },
      { nom: 'Unité / palette', description: 'La palette ordinaire de la fiche (bobines × poids de bobine) et l’unité du catalogue : pour information, jamais une palette imposée.' },
      {
        nom: 'Stock minimum (fiche)',
        description:
          'Le stock minimum saisi sur la fiche article. UNE ALERTE, PAS UN TERME DU CALCUL (décision du 10/10/2026 : le plan d’achat suit le plan de production seul) ; la sécurité du calcul vient des jours de sécurité de la classe ABC.',
        valeurs: 'kg',
      },
      {
        nom: 'Couverture minimale',
        description:
          'La couverture minimale de la fiche, sinon le paramètre P_CouvMinMois. Une alerte : le moteur ne la lit pas (décision du 10/10/2026).',
        valeurs: 'mois',
      },
      { nom: 'Seuil d’alerte', description: 'Le paramètre P_SeuilAlerte. Une alerte : le moteur ne le lit pas.', valeurs: 'jours' },
      /* --- La fenêtre de détail : projection et résultat MRP --------------- */
      {
        nom: 'Projection chronologique',
        description:
          'Le tableau de la projection du moteur, par événements (aujourd’hui, arrivage, rupture, passage sous la sécurité, aujourd’hui + délai, fins de mois, fin de l’horizon) ou jour par jour. Chaque rangée cumule depuis la précédente.',
      },
      { nom: 'Date', description: 'Projection : le jour de la rangée (et, par événements, ce qui s’y passe).', valeurs: 'date' },
      { nom: 'Stock début', description: 'Projection : le stock projeté de la rangée précédente (la première : le disponible compté d’aujourd’hui).', valeurs: 'kg' },
      {
        nom: 'Besoin planifié',
        description:
          'Projection : le PLAN DATÉ depuis la rangée précédente (kg du mois ÷ jours réels du mois, jour par jour) — un besoin au plan, jamais une consommation réelle.',
        valeurs: 'kg',
      },
      { nom: 'Stock projeté', description: 'Projection : le solde du moteur en fin de journée, jamais négatif.', valeurs: 'kg' },
      { nom: 'Sécurité', description: 'Projection : la ligne de sécurité du moteur ce jour-là.', valeurs: 'kg' },
      { nom: 'Écart à la sécurité', description: 'Projection : stock projeté − sécurité ; en orange sous la sécurité.', valeurs: 'kg' },
      {
        nom: 'Besoin non couvert',
        description: 'Le plan que le solde n’a pas pu servir — depuis la rangée précédente dans la projection, sur tout l’horizon dans le résultat MRP. Perdu, jamais reporté.',
        valeurs: 'kg',
      },
      { nom: '1re date sous la sécurité', description: 'Résultat MRP : le premier jour où le solde projeté passe sous la sécurité.', valeurs: 'date' },
      {
        nom: 'Quantité proposée',
        description: 'Résultat MRP : la quantité de la première proposition, après le minimum et l’arrondi. Elle se reconstitue dessous, au jour déterminant.',
        valeurs: 'kg',
      },
      { nom: 'Disponible le (D)', description: 'D, la date de disponibilité de la commande : MAX(aujourd’hui + délai ; premier passage sous la sécurité).', valeurs: 'date' },
      { nom: 'Prochaine proposition', description: 'La deuxième proposition du moteur, indicative : elle suppose la première commandée.' },
      { nom: 'Montant', description: 'Résultat MRP : quantité proposée × prix d’achat. Masqué selon vos droits.', valeurs: 'MAD' },
      /* --- L'onglet « Simulation » ------------------------------------------- */
      { nom: 'Référence à simuler', description: 'La référence dont on essaie des hypothèses. Tapez au moins deux caractères.' },
      { nom: 'Délai fournisseur (j)', description: 'Simulation : un autre délai fournisseur. Vide : celui du calcul réel (entre parenthèses).', valeurs: 'jours, de 0 à 730' },
      { nom: 'Couverture d’une commande (j)', description: 'Simulation : une autre couverture d’une commande. Vide : celle du calcul réel.', valeurs: 'jours, de 1 à 730' },
      { nom: 'Minimum de commande (kg)', description: 'Simulation : un autre minimum ; 0 = aucun minimum. Vide : celui de la fiche.', valeurs: 'kg' },
      { nom: 'Multiple d’achat (kg)', description: 'Simulation : un autre multiple d’arrondi ; 0 = pas d’arrondi. Vide : celui de la fiche.', valeurs: 'kg' },
      { nom: 'Indicateur', description: 'Simulation : ce que l’on compare, réel et simulé.' },
      { nom: 'Réel', description: 'Simulation : la valeur du calcul réel, sur les données d’aujourd’hui.' },
      { nom: 'Simulé', description: 'Simulation : la valeur recalculée avec les hypothèses ; en couleur quand elle diffère du réel.' },
    ],
    regles: [
      'UN SEUL MOTEUR (27/10/2026) : les trois onglets, la fenêtre de détail et la simulation lisent le moteur de couverture — les mêmes chiffres que l’onglet « À commander » du plan d’achat. Aucune formule de besoin n’est refaite à l’écran.',
      'LE STOCK TOTAL PROJETÉ NE COMPTE RIEN DEUX FOIS : Disponible (hors restes) + Sur machine (hors restes) + Restant (les restes comptés) = le disponible compté du moteur ; + les arrivages comptés.',
      'LES MOTS DU BESOIN : « Plan / mois » (le plan de l’horizon ramené à 30 jours), « Réel / mois » (la consommation réelle du grand livre, 12 mois pleins), « Besoin jusqu’à livraison » (le plan d’aujourd’hui à aujourd’hui + délai), « Besoin de couverture » (le plan sur la fenêtre [D, F[), « Besoin de réapprovisionnement » (le besoin théorique). Le moteur ne lit que le PLAN DATÉ.',
      'La projection se fait jour par jour sur l’horizon du plan en service ; le solde ne descend jamais sous zéro. L’état se calcule SANS les propositions d’achat : une référence reste « plan non couvert » tant que la commande n’est pas validée et datée.',
      'Le fil en route compte à sa date prévue de disponibilité au magasin destinataire ; en retard ou sans date (contrôle C66), il ne compte pas. Un bon en retard ne compte pas non plus (contrôle C28).',
      'Le stock minimum, la couverture minimale et le seuil d’alerte de la fiche sont des ALERTES (décision du 10/10/2026) : ils ne changent ni la sécurité, ni la proposition.',
      'LA SIMULATION N’ÉCRIT JAMAIS RIEN : ni stock, ni bon, ni proposition, ni journal. Ses hypothèses sont des entrées que le moteur reçoit déjà (arrivages datés, délai, couverture, sécurité, minimum, multiple) ; un arrivage simulé est classé par les règles des vrais (daté dans l’horizon : compté ; date passée : en retard, hors couverture). L’import en route sans bon n’a pas de date fiable : une hypothèse ne le date pas.',
      'Sont suivies les références qui ont une demande au plan, du stock ou un arrivage, même hors couverture.',
    ],
    messages: [
      {
        message: 'Requete invalide : hypothèses illisibles : …',
        cause: 'Une hypothèse mal formée (date, nombre) : corrigez la saisie.',
      },
      {
        message: 'Requete invalide : l’import en route sans bon n’a pas de date fiable : la règle le laisse hors couverture, une hypothèse ne le date pas.',
        cause: 'Simulez plutôt un arrivage, à la date que vous attendez.',
      },
      {
        message: 'Requete invalide : délai de … j : entre 0 et 730 jours.',
        cause: 'Une hypothèse de réglage hors bornes (délai, couverture de 1 à 730 j, sécurité de 0 à 365 j).',
      },
    ],
    liens: [
      { route: '/plan-achat', libelle: 'Plan d’achat (onglet À commander)' },
      { route: '/etat-stock', libelle: 'État des stocks' },
      { route: '/etats/stock', libelle: 'État des stocks imprimé' },
      { route: '/transferts', libelle: 'Transferts' },
    ],
  },

  // ==========================================================================
  // TRANSFERTS — la liste : expédier, dater, réceptionner
  // ==========================================================================
  {
    route: '/transferts',
    titre: 'Transferts entre magasins',
    chemin: 'Stock → Transferts',
    objectif:
      'Suivre la matière qui passe d’un magasin à l’autre : la préparer, l’expédier avec sa date prévue de disponibilité, réviser cette date en route, constater l’arrivée, et imprimer les bons qui accompagnent le camion.',
    droits:
      'Lecture du module Mouvements. Écriture pour créer, modifier, abandonner un transfert en préparation et réviser la date prévue ; VALIDER pour expédier, imprimer le bon de réception et réceptionner.',
    procedures: [
      {
        titre: 'Expédier un transfert',
        etapes: [
          'Préparez-le d’abord (bouton « + », Nouveau transfert) : il est « En préparation », rien n’a bougé.',
          'Sur sa ligne, « Bon » imprime le bon de sortie à joindre au chargement.',
          '« Expédier » : si la date prévue de disponibilité est déjà sur le transfert, confirmez ; sinon la saisie s’ouvre SOUS LA LIGNE — « Disponible au magasin destinataire (…) le » —, puis « Expédier avec cette date ».',
          'Confirmez : les lignes quittent le magasin source (mouvement de sortie, immuable).',
        ],
        resultat:
          'Le transfert est « En transit » : la marchandise n’est comptée dans aucun magasin ; le plan d’achat la compte à sa date prévue de disponibilité.',
      },
      {
        titre: 'Réviser la date en route',
        etapes: [
          'Sur un transfert « En transit », cliquez « Réviser la date ».',
          'Saisissez la nouvelle date sous la ligne (aujourd’hui au plus tôt), puis « Enregistrer la date ».',
        ],
        resultat: 'La couverture du plan d’achat compte ce fil à la nouvelle date ; l’ancienne et la nouvelle restent au journal d’audit.',
      },
      {
        titre: 'Constater l’arrivée',
        etapes: [
          '« Bon de réception » imprime le bon à remplir au déchargement (colonne « Reçu » vide).',
          'Une fois la marchandise vue sur place : « Réceptionner », puis « Constater la réception ».',
        ],
        resultat: 'Les lignes entrent en stock au magasin destinataire, valorisées au CMUP figé au départ ; le transfert est « Reçu ».',
      },
    ],
    champs: [
      { nom: 'Numéro', description: 'Le numéro du transfert, attribué à la création et jamais réutilisé. Comme filtre, une recherche sur ce numéro.' },
      { nom: 'Date', description: 'La date du document.', valeurs: 'date' },
      { nom: 'Trajet', description: 'Le magasin source → le magasin destinataire.' },
      { nom: 'Contenu', description: 'Le nombre de lignes et le poids total du transfert.', valeurs: 'kg' },
      {
        nom: 'Ou est la marchandise',
        description:
          'Le statut, dit du point de vue de la marchandise : En préparation (rien n’a bougé), En transit (partie, arrivée non constatée ; « en route depuis N j »), Reçu (entrée en stock à destination), Annulé.',
        valeurs: 'En préparation · En transit · Reçu · Annulé',
      },
      {
        nom: 'Disponible le',
        description:
          'La date prévue de disponibilité au magasin destinataire : le plan d’achat compte le fil en route CE jour-là. « en retard de N j » : la date est dépassée, le fil ne couvre plus le plan tant qu’une nouvelle date n’est pas saisie (« Réviser la date »). « sans date » : expédié avant la règle du 27/10/2026, il ne couvre rien (contrôle C66).',
        valeurs: 'date',
      },
      {
        nom: 'Disponible au magasin destinataire le',
        description:
          'La saisie ouverte sous la ligne : à l’expédition d’un transfert qui n’a pas encore de date (obligatoire), ou pour la réviser tant qu’il est en route. Pas avant aujourd’hui ; en route, elle se révise, elle ne s’efface pas.',
        obligatoire: true,
        valeurs: 'date',
      },
      {
        nom: 'Expédié / reçu par',
        description: 'Qui a créé et expédié le transfert ; dessous, qui a constaté l’arrivée et quand, ou « arrivee non constatee ».',
      },
      { nom: 'Période', description: 'Filtre : les transferts datés de cette période.' },
      { nom: 'Statut', description: 'Filtre : le statut du transfert (le rail de gauche fait de même, avec le nombre de transferts par statut).' },
      { nom: 'Magasin source', description: 'Filtre : les transferts qui partent de ce magasin.' },
      { nom: 'Magasin destinataire', description: 'Filtre : les transferts qui vont vers ce magasin.' },
      { nom: 'Auteur', description: 'Filtre : qui a créé le transfert.' },
    ],
    regles: [
      'Un transfert se valide DEUX FOIS, sur deux sites : l’expédition au magasin source (le mouvement de sortie), la réception au magasin destinataire (le mouvement d’entrée). Entre les deux, la marchandise est EN TRANSIT : comptée dans aucun magasin.',
      'LA DATE PRÉVUE DE DISPONIBILITÉ EST OBLIGATOIRE À L’EXPÉDITION, garantie par la base (TRF-DATE). Elle se révise tant que le transfert est en route, jamais après sa réception ni sur un transfert abandonné ; chaque changement est journalisé.',
      'LE FIL EN ROUTE EST UN ARRIVAGE pour le moteur de couverture : compté à sa date prévue de disponibilité vers un magasin compté au plan ; date dépassée sans nouvelle date = en retard, hors couverture ; sans date = hors couverture et signalé par le contrôle C66, jusqu’à ce qu’une date soit saisie. Jamais une date déduite d’autre chose.',
      'La valeur voyage avec la marchandise : l’entrée est valorisée au CMUP du magasin source figé au départ, pas à celui du jour de l’arrivée. En route, le fil compte dans la valeur du stock.',
      'Un inventaire ouvert gèle le magasin (ou ses seules références pour un tournant ou un ciblé) : ni départ de la source ni arrivée à destination tant qu’il n’est pas clôturé (INVENTAIRE-OUVERT).',
      'Seul un transfert en préparation se modifie ou s’abandonne ; parti, il doit arriver quelque part — le recevoir, ou le faire revenir par un transfert inverse. Un écart constaté à l’arrivée se régularise par un inventaire.',
      'Le contrôle C54 signale un transfert expédié et toujours pas réceptionné au-delà du délai réglé.',
    ],
    messages: [
      {
        message: 'TRF-DATE : le transfert … ne part pas sans date prévue de disponibilité au magasin destinataire. Saisissez-la avant d’expédier.',
        cause: 'Expédition sans date : la saisie s’ouvre sous la ligne.',
      },
      {
        message: 'TRF-DATE : le transfert … est …, sa date prévue de disponibilité ne se révise plus (seulement tant qu’il est en route).',
        cause: 'Le transfert est reçu ou annulé.',
      },
      {
        message: 'TRF-DATE : le transfert … est en route : sa date prévue de disponibilité se révise, elle ne s’efface pas.',
        cause: 'Une date vide a été envoyée pour un transfert en transit.',
      },
      {
        message: 'Seul un transfert au statut … peut etre … (statut actuel : …).',
        cause: 'Un autre poste l’a expédié ou reçu entre-temps : la liste se relit.',
      },
      { message: 'R02 : stock insuffisant…', cause: 'Le magasin source n’a plus ces kilos (de la référence ou du lot) au moment de l’expédition.' },
      { message: 'INVENTAIRE-OUVERT…', cause: 'Un inventaire ouvert gèle le magasin source ou destinataire.' },
    ],
    liens: [
      { route: '/transferts/nouveau', libelle: 'Nouveau transfert' },
      { route: '/plan-achat', libelle: 'Plan d’achat (couverture)' },
      { route: '/stock', libelle: 'Stock projeté' },
      { route: '/controles', libelle: 'Contrôles (C54, C66)' },
    ],
  },

  // ==========================================================================
  // TRANSFERTS — le document (création et reprise d’un brouillon)
  // ==========================================================================
  {
    route: '/transferts/nouveau',
    titre: 'Nouveau transfert',
    chemin: 'Stock → Transferts → « + » (Nouveau transfert)',
    objectif:
      'Préparer le document d’un transfert — deux magasins, une date, la date prévue de disponibilité au destinataire, et ce qu’on charge — sans bouger aucun stock : c’est l’expédition qui sort la marchandise.',
    prerequis: [
      'Les deux magasins actifs.',
      'La matière en stock au magasin source : la grille ne propose que lui.',
    ],
    droits: 'Écriture du module Mouvements.',
    procedures: PROCEDURES_TRANSFERT,
    champs: CHAMPS_TRANSFERT,
    regles: REGLES_TRANSFERT,
    messages: MESSAGES_TRANSFERT,
    liens: [
      { route: '/transferts', libelle: 'Transferts (expédier, réceptionner)' },
      { route: '/stock', libelle: 'Stock projeté' },
    ],
  },
  {
    route: '/transferts/:id/modifier',
    titre: 'Modifier un transfert',
    chemin: 'Stock → Transferts → « Modifier » sur un transfert en préparation',
    objectif:
      'Reprendre un transfert en préparation — en-tête et lignes — tant que rien n’est parti ; une fois expédié, le même écran ne fait plus que le montrer.',
    droits: 'Écriture du module Mouvements ; sans elle, ou une fois le transfert parti, l’écran est en lecture seule.',
    procedures: [
      ...PROCEDURES_TRANSFERT,
      {
        titre: 'Abandonner un transfert en préparation',
        etapes: ['Cliquez « Abandonner », puis confirmez.'],
        resultat: 'Le document reste, marqué « Annulé » ; aucun stock n’a bougé, rien n’est à rattraper.',
      },
    ],
    champs: CHAMPS_TRANSFERT,
    regles: [
      ...REGLES_TRANSFERT,
      '« Enregistrer le transfert » ne s’active qu’après un changement ; la modification remplace TOUTES les lignes par celles de l’écran.',
      'Expédié, le document est figé (« Document figé ») : ses mouvements sont au grand livre, que R03 rend immuable. La date prévue se révise alors depuis la liste des transferts (« Réviser la date »).',
    ],
    messages: [
      ...MESSAGES_TRANSFERT,
      {
        message: 'Un transfert deja expedie ne se modifie plus : ses mouvements sont au grand livre, que R03 rend immuable.',
        cause: 'Le transfert a été expédié pendant la saisie.',
      },
      {
        message: 'Seul un transfert en preparation s’abandonne.',
        cause: 'Une fois partie, la marchandise doit arriver quelque part : la recevoir, ou la faire revenir par un transfert inverse.',
      },
    ],
    liens: [{ route: '/transferts', libelle: 'Transferts' }],
  },

  // ==========================================================================
  // TRANSFERTS — les deux bons imprimés
  // ==========================================================================
  {
    route: '/transferts/:id/bon-sortie',
    titre: 'Bon de sortie d’un transfert',
    chemin: 'Stock → Transferts → « Bon » (en préparation) ou « Bon de sortie » (reçu)',
    objectif: 'Imprimer le bon qui part avec le camion : ce qui quitte le magasin source, signé par l’expéditeur et le transporteur.',
    droits: 'Lecture du module Mouvements.',
    procedures: [
      {
        titre: 'Imprimer le bon de sortie',
        etapes: ['Relisez l’en-tête et les lignes.', 'Cliquez « Imprimer » (ou enregistrez en PDF) ; « Retour » ramène à la liste.'],
        resultat: 'Une feuille A4 avec deux signatures : responsable de l’expédition, chauffeur / transporteur.',
      },
    ],
    champs: [...CHAMPS_BON_TRANSFERT, { nom: 'Transporteur', description: 'Qui emporte la marchandise, tel que saisi sur le transfert.' }],
    regles: REGLES_BON_TRANSFERT,
    liens: [
      { route: '/transferts', libelle: 'Transferts' },
      { route: '/transferts/:id/bon-reception', libelle: 'Bon de réception' },
    ],
  },
  {
    route: '/transferts/:id/bon-reception',
    titre: 'Bon de réception d’un transfert',
    chemin: 'Stock → Transferts → « Bon de réception » (transfert en transit)',
    objectif:
      'Imprimer le bon à remplir au déchargement : on y porte ce qu’on compte réellement, avant de constater la réception dans l’application.',
    droits: 'Lecture du module Mouvements ; le bouton de la liste s’affiche à qui a le droit VALIDER.',
    procedures: [
      {
        titre: 'Recevoir avec le bon',
        etapes: [
          'Imprimez le bon ; au déchargement, écrivez dans « Recu (kg) » ce que vous comptez, sans regarder le poids annoncé.',
          'Signalez tout écart avant de cliquer « Réceptionner » dans la liste des transferts.',
        ],
        resultat: 'Une feuille signée par le chauffeur / transporteur et le responsable de la réception.',
      },
    ],
    champs: [
      ...CHAMPS_BON_TRANSFERT,
      { nom: "Date d'arrivee", description: 'Le jour où l’arrivée a été constatée ; « — a constater — » tant qu’elle ne l’est pas.', valeurs: 'date' },
      {
        nom: 'Recu (kg)',
        description:
          'Colonne VOLONTAIREMENT vide, à remplir à la main : c’est en comptant sur place, sans voir le chiffre attendu, qu’on découvre un manque.',
        valeurs: 'kg',
      },
    ],
    regles: [
      ...REGLES_BON_TRANSFERT,
      'Imprimé avant l’expédition, le bon le dit : rien n’est encore parti du magasin source.',
      'Un écart constaté à l’arrivée se signale avant de réceptionner ; il se régularise ensuite par un inventaire, jamais en retouchant le transfert.',
    ],
    liens: [{ route: '/transferts', libelle: 'Transferts (Réceptionner)' }],
  },
]
