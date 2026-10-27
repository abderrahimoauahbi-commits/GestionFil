/**
 * FICHES D'AIDE — RÉCEPTIONS.
 *
 * Une partie du catalogue : `../contenu.ts` les assemble, `../types.ts` donne
 * la forme d'une fiche. Chaque `champs[].nom` est l'intitulé EXACT de l'écran :
 * c'est par lui que l'indice ⓘ se pose à côté du champ (`../indice.ts`).
 *
 * Réécrites le 27/10/2026 d'après le code des écrans : `pages/Receptions.tsx`,
 * `ReceptionNouvelle.tsx`, `Reception.tsx` (avec `receptions/GrilleReception`,
 * `BarreReception`, `FraisApproche`, `PeseesMobile`, `ReceptionCloture`) et
 * `EtiquettesReception.tsx`.
 */
import type { Sujet } from '../types.ts'

export const FICHES_RECEPTIONS: Sujet[] = [
  /* ------------------------------------------------------------------ Liste */
  {
    route: '/receptions',
    titre: 'Réceptions',
    chemin: 'Achats → Réceptions',
    objectif: 'Retrouver les arrivages, voir où en est chacun (saisie, contrôle, validée, clôturée) et ouvrir celui qu’on traite.',
    droits: 'Lecture du module Réceptions pour la liste ; écriture pour créer une réception ou annuler un brouillon.',
    procedures: [
      {
        titre: 'Le parcours d’une réception',
        etapes: [
          'Le magasinier crée la réception (bouton +), reprend les bons du fournisseur et pèse sur les lignes : statut « En saisie ».',
          'Il soumet au contrôle : statut « À contrôler » ; la pesée est alors figée.',
          'Un autre compte, qui a le droit de valider, valide le contrôle : la marchandise entre en stock au prix du bon (valeur provisoire) — statut « Validée ».',
          'La facture du fournisseur rend la valeur définitive : statut « Clôturée ».',
        ],
        resultat: 'Chaque arrivage se suit d’un bout à l’autre sur la même ligne de la liste.',
      },
      {
        titre: 'Ouvrir, imprimer ou abandonner une réception',
        etapes: [
          'Cliquez la ligne (ou l’icône document) pour ouvrir la réception.',
          'L’icône imprimante ouvre le bon de réception imprimable.',
          'Sur une réception encore « En saisie », la corbeille l’annule après confirmation : rien n’était entré en stock.',
        ],
        resultat: 'La réception annulée reste dans la liste, au statut « Annulée ».',
      },
    ],
    champs: [
      { nom: 'N° réception', description: 'Le numéro de l’arrivage, avec sa date de réception dessous (le jour où la marchandise est arrivée, pas celui de la saisie).' },
      { nom: 'Fournisseur', description: 'Le fournisseur qui livre, avec son code dessous.' },
      { nom: 'Bon de commande', description: 'Le bon rattaché à l’en-tête. « hors commande » : l’arrivage couvre plusieurs bons, ou des lignes sans bon ; chaque ligne garde alors le sien.' },
      { nom: "Dossier d'import", description: 'Le dossier d’importation de l’arrivage et sa DUM ; « local » pour un achat local. Il se déduit des bons repris, il ne se choisit pas.' },
      { nom: 'Bon de livraison', description: 'Le numéro du BL du fournisseur, avec le numéro de facture dessous s’il a été saisi.' },
      { nom: 'Statut', description: 'Où en est la réception.', valeurs: 'En saisie · À contrôler · Validée · Clôturée · Annulée' },
      { nom: 'Lignes', description: 'Le nombre de lignes pesées.' },
      { nom: 'Colis', description: 'Le nombre de colis relevé à l’en-tête de la réception.' },
      { nom: 'OTIF', description: 'À l’heure, complet et conforme : les trois à la fois, sinon « manque » avec la raison (retard, incomplet, non conforme). « non mesurable » quand il manque un terme de comparaison.' },
      { nom: 'Délai', description: 'Les jours entre le bon et la réception, et dessous le délai promis et le retard éventuel.', valeurs: 'jours' },
      { nom: 'Poids brut', description: 'Le poids relevé au pont-bascule, emballage compris.', valeurs: 'kg' },
      { nom: 'Transporteur', description: 'Le transporteur qui a livré.' },
      { nom: 'Pesee par', description: 'Le compte qui a pesé la réception.' },
      { nom: 'Contrôle', description: 'La date du contrôle qualité et le compte qui l’a validé.' },
    ],
    regles: [
      'Une réception va de « En saisie » à « À contrôler », puis « Validée », puis « Clôturée » ; elle ne recule que par un renvoi au magasinier (avant validation) ou une dévalidation de la direction (validée, pas clôturée).',
      'Seul un brouillon (« En saisie ») s’annule depuis la liste : rien n’est encore entré en stock.',
      'La marchandise importée entre aussi par cet écran : il n’y a plus d’écran de réception d’import à part.',
    ],
    liens: [
      { route: '/receptions/nouvelle', libelle: 'Nouvelle réception' },
      { route: '/bons-commande', libelle: 'Bons de commande' },
      { route: '/factures-fournisseur', libelle: 'Factures fournisseur' },
    ],
  },

  /* ------------------------------------------------------- Nouvelle réception */
  {
    route: '/receptions/nouvelle',
    titre: 'Nouvelle réception',
    chemin: 'Achats → Réceptions → Nouvelle réception (+)',
    objectif: 'Saisir l’arrivage d’un camion : reprendre les bons du fournisseur, peser chaque ligne, compter palettes et bobines, et tout enregistrer en une fois.',
    prerequis: [
      'Un bon de commande ENVOYÉ (ou livré en partie) au fournisseur, pour que ses lignes soient reprenables. Une marchandise sans bon se saisit quand même (« Article hors commande »).',
      'Pour un bon en devise : un taux de change en vigueur à la date de réception (Référentiels → Taux de change).',
    ],
    droits: 'Écriture du module Réceptions.',
    procedures: [
      {
        titre: 'Saisir un arrivage',
        etapes: [
          'Choisissez le fournisseur (tapez pour chercher). Changer de fournisseur vide la grille.',
          'Vérifiez la date de réception (le jour où le camion est arrivé) et notez le bon de livraison, le transporteur, le nombre de colis, le poids brut.',
          'Dans « Reprendre un bon de … », choisissez un bon : ses lignes restant à livrer s’ajoutent à la grille, avec le reste à livrer proposé comme pesée. Reprenez un second bon si le camion en porte deux.',
          'Sur chaque ligne : la quantité annoncée au BL, le poids pesé (toujours en kilos), les palettes et les bobines comptées, le lot fournisseur, le magasin, la qualité. Décochez « OK » pour une ligne qui n’est pas descendue du camion.',
          'Cliquez la ligne (ou son chevron) pour ouvrir son détail : dates de fabrication et de péremption, bon, reste, prix engagé et date promise.',
          'Lisez la barre du bas : un seul message bloquant à la fois, les avis se déplient. « voir la ligne » mène à la ligne concernée.',
          '« Enregistrer la réception ».',
        ],
        resultat: 'La réception est créée « En saisie », avec toutes ses lignes, en une seule transaction. Rien n’est encore entré en stock ; l’écran s’ouvre sur le document.',
      },
      {
        titre: 'Recevoir un article sans commande',
        etapes: [
          '« Article hors commande », puis tapez le début d’un code, d’une désignation ou d’une couleur.',
          'Donnez le poids de chaque référence retenue, puis « Ajouter ».',
          'Sur la ligne, le prix au kilo se saisit si vous le voyez ; à défaut, le prix catalogue sera pris.',
        ],
        resultat: 'À l’enregistrement, un bon de régularisation est créé en brouillon (un seul par arrivage). La réception ne pourra être contrôlée qu’une fois ce bon validé puis envoyé.',
      },
      {
        titre: 'Recevoir un équivalent à la place de la référence commandée',
        etapes: [
          'Sur la ligne, cliquez « équivalent reçu ? » (visible seulement si la référence a des équivalents interchangeables).',
          'Dans « Reçu », choisissez la référence réellement livrée et écrivez le motif de la substitution.',
        ],
        resultat: 'C’est la référence reçue qui entre en stock, contre la ligne du bon commandé.',
      },
    ],
    champs: [
      { nom: 'Fournisseur', description: 'Le fournisseur qui livre : ses bons en attente deviennent reprenables. Le changer vide la grille.', obligatoire: true },
      { nom: 'Date de réception', description: 'Le jour où la marchandise est arrivée (un BL du samedi saisi le lundi garde le samedi). L’entrée en stock et le taux de change prennent cette date.', obligatoire: true, defaut: 'aujourd’hui', valeurs: 'jamais dans le futur, jamais avant la date du bon' },
      { nom: 'Bon de livraison', description: 'Le numéro du BL remis par le chauffeur.' },
      { nom: 'N° de facture', description: 'Souvent absente à la livraison : elle peut se saisir plus tard sur la réception.' },
      { nom: 'Transporteur', description: 'Le transporteur qui livre.' },
      { nom: 'Nombre de colis', description: 'Le nombre total de colis du camion.' },
      { nom: 'Poids brut (kg)', description: 'Relevé au pont-bascule, emballage compris. Il n’entre pas en stock : c’est la pesée de chaque ligne qui compte.', valeurs: 'kg' },
      { nom: 'Reprendre un bon', description: 'Les bons du fournisseur qui attendent encore de la marchandise, avec leurs lignes à reprendre et le reste en kilos. Choisir un bon AJOUTE ses lignes à la grille sans effacer les précédentes ; la croix d’un bon repris retire toutes ses lignes.' },
      { nom: 'OK', description: 'La ligne est retenue pour cette réception. Décochez ce qui n’est pas descendu du camion plutôt que de supprimer la ligne : seules les lignes cochées partent.', defaut: 'cochée' },
      { nom: 'Référence · bon · reste', description: 'La référence reçue, le bon qu’elle sert et ce qu’il reste à y livrer ; « hors commande » sans bon. Une ligne de bon déjà pesée par une autre réception en cours l’affiche (« déjà en cours »). Les dates saisies au détail y restent visibles.' },
      { nom: 'Qté BL', alias: ['Qté BL (kg)', 'BL'], description: 'Ce que le bon de livraison annonce pour la ligne, en kilos. L’écart avec la pesée (« / BL ») signale un litige de transport ; dans la barre, l’indicateur BL totalise cet écart.', valeurs: 'kg', defaut: 'le reste à livrer du bon' },
      { nom: 'Pesé (kg)', alias: ['Pesé'], description: 'Le poids réel posé sur la balance, toujours en kilos : c’est lui qui entre en stock, pas la quantité commandée. Dans la barre, « Pesé » totalise les lignes retenues.', obligatoire: true, valeurs: 'kg, plus que 0', defaut: 'le reste à livrer du bon' },
      { nom: 'Unité', description: 'L’unité dans laquelle la ligne est archivée (kg, Bobine, Palette, ml). Le poids ne change pas, seule son expression change ; « non convertible » si la référence ne porte pas le conditionnement nécessaire.', defaut: 'kg' },
      { nom: 'Écart', description: 'L’écart de la pesée à ce que le bon attend encore, en %, comparé à la tolérance du fournisseur : « conforme », « partielle » (manque) ou « hors tolérance » (excédent, à justifier par une dérogation).', valeurs: '%' },
      { nom: 'Pal. · bob.', description: 'Les palettes et les bobines COMPTÉES sur le quai. Tant que le lien (chaîne) est actif, pesée, palettes et bobines se répondent par le conditionnement du lot s’il est connu, sinon de la fiche article ; détachez-le pour une palette entamée. Une référence suivie au lot n’offre pas le lien : ses bobines se comptent, case vide au départ.' },
      { nom: 'Lot fournisseur', description: 'Le numéro de lot (bain) lu sur l’étiquette du fournisseur. Vide sur une référence suivie au lot : un lot interne FOURNISSEUR-JJMMAA-NN sera généré à la validation, sauf si la fiche article exige le lot du fournisseur. Deux lignes du même bon, de la même référence et du même lot sont additionnées (une ligne par lot).' },
      { nom: 'Magasin', description: 'Le magasin où la ligne est rangée. Une ligne en quarantaine ou non conforme doit aller dans un magasin de quarantaine.', obligatoire: true, defaut: 'le premier magasin actif' },
      { nom: 'Qualité', description: 'Le statut qualité de la ligne à l’entrée.', valeurs: 'Conforme · Quarantaine · Non conforme', defaut: 'Conforme' },
      { nom: 'Observations', description: 'Ce que le quai constate sur la ligne : emballage abîmé, couleur douteuse…' },
      { nom: 'Colis BL', alias: ['Colis (BL)'], description: 'Le nombre de colis que le bon de livraison annonce pour cette ligne ; au survol, le poids moyen par colis.' },
      { nom: 'Fabrication', description: 'La date de fabrication du lot, si le fournisseur la donne. Sur le bureau elle se saisit dans le détail de la ligne (clic sur la ligne).', valeurs: 'date' },
      { nom: 'Péremption', description: 'La date de péremption du lot, si elle existe. Sur le bureau elle se saisit dans le détail de la ligne.', valeurs: 'date' },
      { nom: 'Dérogation à l’excédent', alias: ['Dérogation'], description: 'Paraît seulement quand la pesée dépasse ce que le bon attend au-delà de la tolérance du fournisseur. Cochez-la ET écrivez le motif : sans eux, l’enregistrement est refusé. Un manque ne demande pas de dérogation.' },
      { nom: 'Reçu', description: 'La référence réellement livrée, quand le fournisseur a envoyé un équivalent interchangeable à la place de celle commandée. Le motif de la substitution est alors exigé.' },
      { nom: 'Prix MAD/kg', description: 'Sur une ligne hors commande seulement : le prix au kilo que portera le bon de régularisation. Vide, le prix catalogue est pris ; sans prix catalogue, l’enregistrement est refusé.' },
      { nom: 'Lignes', description: 'Dans la barre du bas : lignes retenues sur lignes de la grille.' },
      { nom: 'Bon', description: 'Dans la barre du bas : ce que les bons attendent encore sur les lignes reprises, et l’écart de la pesée (soldé, reliquat ou excédent).', valeurs: 'kg' },
      { nom: 'Palettes', description: 'Dans la barre du bas : palettes comptées sur palettes attendues (déduites du reste à livrer par le conditionnement).' },
      { nom: 'Bobines', description: 'Dans la barre du bas : bobines comptées sur bobines attendues ; « à compter » signale les lignes suivies au lot encore sans bobines.' },
      { nom: 'Tolérance', description: 'Dans la barre du bas : le nombre de lignes hors tolérance de pesée du fournisseur ; chaque pastille L1, L2… mène à sa ligne.' },
    ],
    regles: [
      'Rien ne part au serveur avant « Enregistrer la réception » : en-tête, lignes et bon de régularisation partent dans une seule transaction.',
      'Le poids pesé est toujours en kilos ; l’unité ne dit que dans quoi la ligne est archivée. Un facteur de conversion manquant bloque l’enregistrement, il n’y a jamais de repli sur 1.',
      'Seul l’EXCÉDENT au-delà de la tolérance du fournisseur (à défaut le paramètre P_TolerEcartPesee, 2 % par défaut) exige une dérogation motivée. Un manque est une livraison partielle.',
      'Pour une référence suivie au lot, les bobines se comptent, elles ne se déduisent pas des kilos : le compte sera exigé à la soumission au contrôle.',
      'Un lot ne va qu’à un magasin, avec un statut qualité : deux pesées du même lot sur la même ligne de bon s’additionnent, mais seulement vers le même magasin et la même qualité.',
      'Une ligne sans bon fait naître le bon de régularisation, en brouillon, dans la devise du fournisseur ; il bloque le contrôle jusqu’à sa validation puis son envoi.',
      'Un colisage incohérent (kilos, bobines, palettes qui se contredisent) ou une dérive du poids par bobine s’affiche sous la ligne : c’est un avis, il ne bloque jamais (contrôle C43).',
      'Un magasin gelé par un inventaire ouvert est annoncé en tête : la pesée s’enregistre, la validation sera refusée.',
    ],
    messages: [
      { message: 'excédent au-delà de la tolérance (… %) : cochez « Dérogation » et donnez le motif', cause: 'La pesée dépasse ce que le bon attend au-delà de la tolérance du fournisseur. Cochez la dérogation de la ligne et motivez-la, ou corrigez la pesée.' },
      { message: 'motif de substitution manquant', cause: 'La référence reçue n’est pas celle commandée : dites pourquoi dans le motif de la substitution.' },
      { message: 'conversion impossible en … : renseignez le conditionnement sur la référence, ou archivez en kg', cause: 'L’unité d’archivage choisie (bobine, palette, mètre) n’a pas de facteur sur la fiche article. Choisissez kg, ou complétez la fiche.' },
      { message: 'La reception ne peut pas preceder le bon de commande (date du bon : …)', cause: 'La date de réception est antérieure à la date du bon repris. Corrigez la date.' },
      { message: 'Aucun taux de change en vigueur pour … : saisissez le taux du jour', cause: 'La ligne est en devise et aucun cours n’est saisi pour la date de réception : la marchandise entrerait au taux du dirham. Saisissez le taux (Référentiels → Taux de change).' },
      { message: '… arrive sans commande et sans prix : renseignez un prix, le catalogue n’en propose aucun', cause: 'Ligne hors commande sans prix saisi, et la fiche article n’a pas de prix catalogue.' },
      { message: '… (lot …) est deja pese sur la ligne …, vers … en … : un lot ne va qu’a un magasin, avec un statut qualite', cause: 'Une seconde pesée du même lot vise un autre magasin ou une autre qualité. Corrigez la ligne, ou saisissez l’autre partie sous son propre lot.' },
      { message: 'R-REC : cette ligne de bon est deja en cours de reception dans …', cause: 'Une autre réception non validée pèse déjà la même ligne de bon, et la somme dépasse la tolérance. Vérifiez qu’il ne s’agit pas du même camion, ou donnez une dérogation motivée.' },
      { message: 'Une ligne non conforme ou en quarantaine doit etre dirigee vers un magasin de quarantaine.', cause: 'Une ligne marquée « Quarantaine » ou « Non conforme » vise un magasin ordinaire.' },
    ],
    exemples: [
      {
        titre: 'compter les bobines',
        situation: '474 bobines comptées pour 1 230 kg pesés ; poids de bobine 2,500 kg (celui du lot s’il est déjà connu, sinon la fiche article).',
        calcul: [
          ['Poids réel par bobine', '1 230 ÷ 474 = 2,595 kg'],
          ['Écart au poids attendu', '+3,8 %'],
          ['Seuils de dérive (par défaut)', 'orange au-delà de 1 %, rouge au-delà de 3 %'],
        ],
        conclusion: 'La dérive du lot s’affiche en rouge sous la ligne ; la réception n’est pas bloquée. À la validation, le lot prend ce poids mesuré (sauf écart de plus de 50 % à la fiche, tenu pour une erreur de saisie).',
      },
    ],
    liens: [
      { route: '/receptions', libelle: 'Réceptions' },
      { route: '/bons-commande', libelle: 'Bons de commande' },
    ],
  },

  /* ------------------------------------------------------ Le document réception */
  {
    route: '/receptions/:id',
    titre: 'Réception',
    chemin: 'Achats → Réceptions → (une réception)',
    objectif: 'Compléter et corriger la pesée d’un arrivage, la soumettre au contrôle, la valider pour faire entrer le stock, puis la clôturer avec la facture et ses frais d’approche.',
    prerequis: [
      'Une réception créée (Nouvelle réception).',
      'Pour valider : chaque bon servi doit être ENVOYÉ au fournisseur — y compris le bon de régularisation d’une ligne sans commande.',
      'Pour clôturer en devise : le cours de la date de facture (proposé depuis Bank Al-Maghrib s’il est connu).',
    ],
    droits: 'Écriture du module Réceptions pour peser, corriger, soumettre et renvoyer au magasinier ; validation du module Réceptions pour valider le contrôle, clôturer avec la facture et saisir un avoir ; module Valorisation pour voir (lecture) et saisir (écriture) les frais d’approche ; dévalider une réception validée est réservé aux rôles ADMIN et DIRECTION.',
    procedures: [
      {
        titre: 'Compléter la pesée (En saisie)',
        etapes: [
          'Dans « Bons de commande de cet arrivage », cochez les bons que ce camion livre : seules leurs lignes seront proposées (rien de coché = tout ce que le fournisseur doit encore). Le dossier d’import se déduit des bons cochés.',
          'Ajoutez une ligne par la recherche au-dessus de la grille : d’abord ce que les bons attendent, puis tout le catalogue (« hors commande »).',
          'Saisissez sur la ligne : quantité au BL, poids pesé, palettes et bobines, lot, magasin, qualité ; les dates de fabrication et de péremption dans le détail (clic sur la ligne).',
          'Validez chaque ligne par ✓ (le crayon la rouvre). Une nouvelle pesée du même lot qu’une ligne existante s’y ajoute.',
          '« Enregistrer » envoie l’en-tête et les lignes ensemble ; « Annuler les modifications » revient à la dernière version enregistrée.',
        ],
        resultat: 'La réception reste « En saisie », à jour en base. Sur téléphone, chaque ligne s’ouvre en feuille plein écran et se valide par « Valider la ligne ».',
      },
      {
        titre: 'Soumettre au contrôle',
        etapes: [
          'Toutes les lignes validées et enregistrées, cliquez « Soumettre au contrôle ».',
          'Le serveur vérifie les bobines comptées (références suivies au lot) et rejuge chaque excédent contre ce qui reste à recevoir sur le bon à cet instant.',
        ],
        resultat: 'Statut « À contrôler ». La pesée est figée : quantités, BL, colis, palettes, bobines, lot et dérogation ne bougent plus ; aucune ligne ne s’ajoute ni ne se retire.',
      },
      {
        titre: 'Contrôler : valider ou renvoyer',
        etapes: [
          'Le contrôleur peut encore corriger la qualité, le magasin, les dates et les observations de chaque ligne (crayon, puis « Enregistrer »), ainsi que l’en-tête.',
          'Une erreur de pesée : « Renvoyer au magasinier », en écrivant ce qu’il doit corriger (5 caractères au moins). La réception revient « En saisie » avec ce motif affiché.',
          'Sinon « Valider le contrôle ». Si des lignes suivies au lot n’ont pas de lot, l’écran annonce les lots internes qui seront générés : confirmez, ou annulez pour saisir le vrai lot.',
        ],
        resultat: 'Validée : stock, CMUP, archive et historique de prix mis à jour en une transaction, au prix du bon et au taux du jour de la réception (valeur provisoire). Chaque lot reçoit le conditionnement mesuré (kilos ÷ bobines comptées, bobines ÷ palettes).',
      },
      {
        titre: 'Saisir les frais d’approche (réception validée)',
        etapes: [
          '« Ajouter un frais » : nature, libellé, pièce, clé de répartition, montant, devise et taux.',
          '« Enregistrer le frais ». Un frais pas encore porté se retire par sa corbeille.',
        ],
        resultat: 'Le frais attend la clôture, qui le porte au CMUP selon sa clé ; il est ensuite figé (« porté au CMUP le … »).',
      },
      {
        titre: 'Clôturer avec la facture',
        etapes: [
          '« Clôturer avec la facture » : numéro, date, montant HT de la marchandise dans la devise de la réception, et le taux (proposé, modifiable).',
          'Ajoutez les frais que la facture porte elle-même, et cochez les autres réceptions validées du même fournisseur, même devise, si la facture les couvre.',
          'Si des kilos ont été rendus au fournisseur, dites si la facture est nette (kilos gardés) ou brute (un avoir pour retour suivra).',
          '« Aperçu » : par référence, la valeur provisoire, la différence, la part au stock (CMUP) et la part en écart de prix. Puis « Clôturer ».',
        ],
        resultat: 'Statut « Clôturée » : la valeur définitive est au stock. La réception ne se dévalide plus ; une erreur se corrige par un avoir.',
      },
      {
        titre: 'Corriger après clôture : avoir ou facture complémentaire',
        etapes: [
          '« Avoir ou facture complémentaire » : nature, référence visée si besoin, numéro de pièce, montant en MAD, motif.',
          '« Aperçu », puis « Enregistrer ».',
        ],
        resultat: 'Un avoir de prix baisse la valeur du stock restant, un complément la monte (même calcul que la clôture) ; un avoir pour retour solde les retours sans toucher au CMUP. Tout est journalisé.',
      },
    ],
    champs: [
      /* En-tête */
      { nom: 'Bon de livraison', description: 'Le numéro du BL du fournisseur. Modifiable jusqu’à la validation.' },
      { nom: 'N° de facture', description: 'À l’en-tête : la facture du fournisseur si on la connaît déjà (souvent plus tard). À la clôture : le numéro de la facture qui rend la valeur définitive — obligatoire.', obligatoire: true },
      { nom: 'Transporteur', description: 'Le transporteur qui a livré.' },
      { nom: 'Date de réception', description: 'Le jour de l’arrivée, que l’OTIF compare à la livraison promise. La changer recalcule le taux des lignes en devise, qui doit exister à cette date.', valeurs: 'jamais dans le futur' },
      { nom: 'Nombre de colis', description: 'Le nombre total de colis du camion.' },
      { nom: 'Poids brut (kg)', description: 'Relevé au pont-bascule, emballage compris.', valeurs: 'kg' },
      { nom: 'Devise de l’arrivage', description: 'Celle des lignes, prise à leur ligne de bon. Le stock entre en dirhams, au taux du jour de la réception.' },
      { nom: 'Bons de commande de cet arrivage', description: 'Les bons du fournisseur qui attendent encore de la marchandise. Cochez ceux que ce camion livre : seules leurs lignes sont proposées à l’ajout. Rien de coché = tout. Le dossier d’import (DUM, conteneurs) se déduit des bons cochés ; plusieurs dossiers : précisez les bons, sinon l’arrivage n’en portera aucun.' },
      { nom: 'Ce que le magasinier doit corriger', description: 'Le motif du renvoi au magasinier, qu’il lira en ouvrant la réception.', obligatoire: true, valeurs: '5 caractères au moins' },
      /* Grille (bureau), feuille (téléphone), tableau (réception validée) */
      { nom: 'Référence · bon · reste', alias: ['Référence'], description: 'La référence pesée, le bon qu’elle sert et ce qu’il en restait à livrer ; « hors commande » sans bon. Le chevron ouvre le détail de la ligne (dates, bon, reste, prix engagé, date promise).' },
      { nom: 'Qté BL', alias: ['Qté BL (kg)', 'Annonce BL', 'Annoncé au BL (kg)', 'BL'], description: 'Ce que le bon de livraison annonce pour la ligne, en kilos. L’écart à la pesée est un litige de transport, distinct de l’écart à la commande. En totaux et dans la barre : la somme, et l’écart.', valeurs: 'kg' },
      { nom: 'Pesé (kg)', alias: ['Pesé', 'Pesee', 'Poids pesé (kg)'], description: 'Le poids réel, toujours en kilos : c’est lui qui entre en stock. Figé au contrôle. Sur la réception validée, la colonne montre la quantité dans l’unité d’archivage et son équivalent en kilos.', obligatoire: true, valeurs: 'kg, plus que 0' },
      { nom: 'Unité', alias: ['Unité d’archivage'], description: 'L’unité dans laquelle la ligne est archivée ; le poids ne change pas. « non convertible » : la fiche article n’a pas le facteur.', defaut: 'kg' },
      { nom: 'Écart', description: 'L’écart de la pesée à ce que le bon attendait, en %, contre la tolérance du fournisseur : « conforme », « partielle » ou « hors tolérance » (excédent à justifier). Sur téléphone, l’écart s’affiche en kilos sous le poids.', valeurs: '%' },
      { nom: 'Pal. · bob.', description: 'Les palettes et les bobines comptées au quai. Liées (chaîne), elles se répondent avec la pesée par le conditionnement du lot s’il est connu, sinon de la fiche ; une ligne qui porte déjà un compte arrive détachée. Une bobine ne se coupe pas : le compte est arrondi à l’entier.' },
      { nom: 'Palettes', description: 'Les palettes comptées au quai (une palette entamée compte). Dans la barre et les totaux : palettes comptées sur palettes attendues.' },
      { nom: 'Bobines', description: 'Les bobines comptées au quai, jamais déduites des kilos : pour une référence suivie au lot, elles sont exigées à la soumission et à la validation. Le poids réel par bobine juge le fournisseur et fixe le conditionnement du lot.' },
      { nom: 'Lot fournisseur', alias: ['Lot'], description: 'Le lot (bain) lu sur l’étiquette du fournisseur. Vide sur une référence suivie au lot : un lot interne FOURNISSEUR-JJMMAA-NN est généré à la validation, sauf si la fiche article exige le lot du fournisseur. Figé au contrôle.' },
      { nom: 'Magasin', description: 'Où la ligne est rangée ; encore modifiable au contrôle. Quarantaine ou non conforme : un magasin de quarantaine.', obligatoire: true, defaut: 'le premier magasin hors quarantaine' },
      { nom: 'Qualité', description: 'Le statut qualité de la ligne ; encore modifiable au contrôle.', valeurs: 'Conforme · Quarantaine · Non conforme', defaut: 'Conforme' },
      { nom: 'Observations', description: 'Ce que le quai ou le contrôle constate sur la ligne ; modifiable au contrôle.' },
      { nom: 'Colis BL', alias: ['Colis (BL)'], description: 'Les colis que le BL annonce pour la ligne ; la réception validée en déduit le poids moyen par colis. Figé au contrôle.' },
      { nom: 'Fabrication', description: 'La date de fabrication du lot, dans le détail de la ligne ; modifiable au contrôle.', valeurs: 'date' },
      { nom: 'Péremption', description: 'La date de péremption du lot, dans le détail de la ligne ; modifiable au contrôle.', valeurs: 'date' },
      { nom: 'Dérogation à l’excédent', alias: ['Dérogation'], description: 'Paraît quand la pesée dépasse l’attendu au-delà de la tolérance. Cochée ET motivée, sinon la soumission est refusée. Figée au contrôle.' },
      { nom: 'Attendu', alias: ['Bon', 'Attendu au BC'], description: 'Ce que la ligne de bon attendait au moment de la pesée, en kilos ; « hors commande » sans bon. Dans la barre et les totaux : la somme, et l’écart de la pesée (soldé, reliquat, excédent).', valeurs: 'kg' },
      { nom: 'Écart commande', description: 'La pesée moins l’attendu du bon, en kilos : négatif = reliquat.', valeurs: 'kg' },
      { nom: 'Prix MAD/kg', description: 'Le prix au kilo de la ligne en dirhams, fixé à l’enregistrement par le prix du bon et le taux du jour de la réception (« à la validation » tant qu’il n’est pas connu).', valeurs: 'MAD/kg, 4 décimales' },
      { nom: 'Poids reçu', description: 'Dans les totaux de la réception validée : la somme des pesées.', valeurs: 'kg' },
      { nom: 'Valeur du stock (HT)', description: 'La valeur entrée en stock, hors taxes : pesée × prix MAD/kg. La TVA est portée par la facture, pas par la réception.', valeurs: 'MAD' },
      { nom: 'Lignes', description: 'Dans la barre du bas : le nombre de lignes pesées.' },
      { nom: 'Tolérance', description: 'Dans la barre du bas : les lignes hors tolérance de pesée du fournisseur, chacune menant à sa ligne.' },
      /* OTIF */
      { nom: 'Délai réel', description: 'Les jours entre le bon et la réception.', valeurs: 'jours' },
      { nom: 'Délai promis', description: 'Les jours promis par le bon (date de livraison prévue).', valeurs: 'jours' },
      { nom: 'Retard', description: 'Les jours au-delà de la date promise.', valeurs: 'jours' },
      { nom: "À l'heure", description: 'Premier critère OTIF : livrée au plus tard à la date promise.' },
      { nom: 'Complet', description: 'Deuxième critère OTIF : le poids pesé atteint le poids commandé, à la tolérance P_TolerInFull près (2 % par défaut).' },
      { nom: 'Conforme', description: 'Troisième critère OTIF : toutes les lignes sont en qualité « Conforme ». L’OTIF est le produit des trois, pas leur moyenne ; il se recalcule à chaque lecture.' },
      /* Frais d'approche */
      { nom: 'Nature', description: 'Frais d’approche : fret / transport, douane, assurance, manutention ou autre ; elle propose sa clé. Correction : avoir de prix (la marchandise reste en stock), avoir pour retour (marchandise rendue) ou facture complémentaire (hausse).', obligatoire: true },
      { nom: 'Libellé', description: 'Ce que couvre le frais, en clair (ex. Transport Tanger-Casablanca).' },
      { nom: 'Pièce', description: 'La pièce justificative : facture du transitaire, DUM…' },
      { nom: 'Répartition', description: 'La clé par laquelle le frais se répartit entre les références de l’arrivage à la clôture.', valeurs: 'Au poids (kilos) · À la valeur (valeur reçue) · En parts égales (par référence)', defaut: 'selon la nature : fret au poids, manutention en parts égales, les autres à la valeur' },
      { nom: 'Montant', description: 'Le montant du frais, dans la devise choisie.', obligatoire: true, valeurs: 'plus que 0' },
      { nom: 'Devise', description: 'La devise du frais.', defaut: 'MAD' },
      { nom: 'Taux', description: 'Le taux vers le dirham du frais en devise ; fixé à 1 en MAD.', defaut: '1' },
      /* Clôture avec la facture */
      { nom: 'Date de la facture', description: 'Elle fixe le cours de référence proposé pour une facture en devise.', obligatoire: true, defaut: 'aujourd’hui' },
      { nom: 'Montant HT de la marchandise', alias: ['Montant HT de la marchandise (MAD)'], description: 'Le montant de la marchandise sur la facture, hors taxes et hors frais, DANS LA DEVISE de la réception.', obligatoire: true, valeurs: 'plus que 0' },
      { nom: 'Taux USD → MAD', alias: ['Taux EUR → MAD', 'Taux GBP → MAD', 'Taux CNY → MAD', 'Taux TRY → MAD', 'Taux CHF → MAD'], description: 'Le taux de la facture en devise. Vide : le cours Bank Al-Maghrib de la date de facture. Un taux à plus de 3 % du cours se confirme (« Confirmer ce taux ») ; un taux de 1 en devise est refusé.', obligatoire: true },
      { nom: 'Frais portés par la facture (MAD)', description: 'Ce que le fournisseur facture en plus de la marchandise. Les frais payés à part (fret, douane, transitaire) se saisissent dans « Frais d’approche », chacun avec sa clé.', valeurs: 'MAD', defaut: '0' },
      { nom: 'La facture couvre aussi (même fournisseur, même devise)', description: 'Les autres réceptions validées du fournisseur, dans la même devise, que cette facture couvre : montant et frais se répartissent au prorata de leur valeur au prix du bon.' },
      { nom: 'Provisoire', description: 'Dans l’aperçu : la valeur entrée au prix du bon.', valeurs: 'MAD' },
      { nom: 'Différence', description: 'Dans l’aperçu : valeur définitive moins valeur provisoire (négative = baisse).', valeurs: 'MAD' },
      { nom: 'Reçu / encore là', description: 'Dans l’aperçu : les kilos reçus et ceux de la réception encore en stock.', valeurs: 'kg' },
      { nom: 'Au stock (CMUP)', description: 'Dans l’aperçu : la part de la différence portée aux lots encore en stock, qui change le coût moyen.', valeurs: 'MAD' },
      { nom: 'Écart de prix', description: 'Dans l’aperçu : la part de la différence qui revient aux kilos déjà sortis ; tracée hors CMUP.', valeurs: 'MAD' },
      /* Avoir ou facture complémentaire */
      { nom: 'Référence visée', description: 'Un avoir de prix ou un complément peut ne viser qu’une référence de la réception.', defaut: 'Toute la réception' },
      { nom: 'N° de la pièce', description: 'Le numéro de l’avoir ou de la facture complémentaire.', obligatoire: true },
      { nom: 'Montant (MAD)', description: 'Le montant de l’avoir ou du complément, en dirhams.', obligatoire: true, valeurs: 'plus que 0' },
      { nom: 'Motif', description: 'Pourquoi la valeur change (remise accordée, erreur de prix…) ; journalisé.', obligatoire: true, valeurs: '5 caractères au moins' },
    ],
    regles: [
      'Rien ne part au serveur pendant la saisie : « Enregistrer » envoie l’en-tête et les lignes, et refuse de partir tant qu’une ligne n’est pas validée (✓).',
      'Peser et valider sont deux comptes : celui qui a pesé ou corrigé la pesée ne valide pas, et le créateur d’un bon servi ne contrôle pas la réception qui le solde (séparation des tâches, sans dispense).',
      'Au contrôle, la pesée est figée : une erreur se renvoie au magasinier, elle ne se corrige pas par celui qui valide.',
      'Seul l’EXCÉDENT au-delà de la tolérance du fournisseur demande une dérogation. Un manque dans la tolérance solde la ligne du bon ; au-delà, il laisse un reliquat.',
      'Validée, l’entrée est au prix du bon (provisoire) ; clôturée avec la facture, elle est à sa valeur définitive. La différence va aux lots de la réception encore en stock ; la part déjà sortie reste en écart de prix.',
      'Les frais d’approche se saisissent sur la réception validée et rejoignent le CMUP à la clôture, une seule fois, chacun selon sa clé.',
      'Une facture qui s’écarte de plus de 10 % de la valeur au prix du bon lève un avis à l’aperçu (P_ClotureEcartAvisPct) ; elle ne se bloque pas.',
      'Une facture ne couvre qu’une devise : un arrivage aux lignes en plusieurs devises se clôture avec une facture par devise. La facture peut aussi se saisir comme document (Factures fournisseur) : l’arrivage ne se clôture que quand tout est facturé.',
      'Une réception clôturée ne se dévalide plus : avoir ou facture complémentaire, motivés. Une réception validée se dévalide (direction) seulement si les entrées de stock qu’elle a créées ont été contre-passées.',
      'Un inventaire ouvert gèle un magasin de destination (tout le magasin pour un global, ses références pour un tournant ou un ciblé) : la validation est refusée jusqu’à sa clôture.',
      'Un colisage incohérent ou une dérive du poids par bobine s’affiche sous la ligne : c’est un avis, jamais un blocage (C43).',
    ],
    messages: [
      { message: 'B4 regle 2 : vous avez pese ou corrige la pesee de la reception … : un autre doit la valider', cause: 'Le compte qui a pesé ou corrigé en dernier ne valide pas. Un autre compte ayant le droit de valider le fait.' },
      { message: 'B4 regle 2 : vous avez cree le bon …, vous ne pouvez pas controler la reception qui le solde', cause: 'Celui qui a créé un bon servi par la réception ne la contrôle pas.' },
      { message: 'Le bon … est au statut … : il n’a pas ete envoye au fournisseur', cause: 'Un bon servi (souvent le bon de régularisation d’une ligne sans commande) n’est pas encore envoyé. Faites-le valider puis envoyer, puis contrôlez.' },
      { message: 'Comptez les bobines avant le controle : …', cause: 'Une référence suivie au lot n’a pas de bobines comptées. Le poids réel par bobine juge le fournisseur ; déduit des kilos, il ne mesure rien.' },
      { message: 'C10 : … kg pesés pour … kg restant à recevoir sur le bon', cause: 'D’autres réceptions ont été validées depuis la saisie : l’excédent dépasse maintenant la tolérance. Renvoyez au magasinier pour corriger la pesée ou ajouter la dérogation.' },
      { message: 'Lot obligatoire : le numero de lot du fournisseur manque pour …', cause: 'La fiche article exige le lot du fournisseur : il ne se génère pas. Lisez-le sur l’étiquette et saisissez-le sur la ligne.' },
      { message: 'Au controle, la pesee est figee : celui qui valide n’est pas celui qui pese', cause: 'Au contrôle, on ne change ni quantité, ni BL, ni colis, ni palettes, ni bobines, ni lot, ni dérogation, et on n’ajoute ni ne retire de ligne. Renvoyez la réception au magasinier.' },
      { message: 'INVENTAIRE-OUVERT : …', cause: 'Un inventaire ouvert gèle le magasin de destination (ou la référence) : aucune entrée de stock jusqu’à sa clôture ou son annulation.' },
      { message: 'Aucune ligne pesee : rien a soumettre au controle qualite.', cause: 'Ajoutez et enregistrez au moins une ligne avant de soumettre.' },
      { message: 'TAUX-ECART', cause: 'Le taux saisi pour la facture s’écarte du cours de référence au-delà du seuil. Cochez « Confirmer ce taux » s’il est celui de la banque.' },
      { message: 'RETOURS : des kilos de la reception … ont ete rendus au fournisseur', cause: 'Dites si la facture porte sur les seuls kilos gardés (nette) ou sur toute la livraison (brute : un avoir pour retour suivra).' },
      { message: 'Cet arrivage porte des lignes en … : une facture ne couvre qu’une devise', cause: 'Clôturez avec une facture par devise.' },
      { message: 'La reception … a une entree en stock contre-passee', cause: 'Il n’y a plus de marchandise à valoriser : saisissez la facture sur la réception qui l’a remplacée.' },
      { message: 'FRAIS-PORTE : ce frais est deja passe au CUMP le …', cause: 'Un frais porté au coût moyen ne se supprime plus : corrigez par un avoir sur la réception.' },
    ],
    liens: [
      { route: '/receptions', libelle: 'Réceptions' },
      { route: '/bons-commande', libelle: 'Bons de commande (régularisation)' },
      { route: '/factures-fournisseur', libelle: 'Factures fournisseur' },
      { route: '/retours-fournisseur', libelle: 'Retours fournisseur' },
    ],
  },

  /* ------------------------------------------------------------- Étiquettes */
  {
    route: '/etats/receptions/:id/etiquettes',
    titre: 'Étiquettes de lot',
    chemin: 'Achats → Réceptions → (une réception) → Étiquettes',
    objectif: 'Imprimer une étiquette code-barres (Code 128) par bobine ou par palette, à coller au quai et à scanner à la sortie et au chargement machine.',
    prerequis: [
      'Une réception non annulée, avec au moins une ligne.',
      'Le colisage de chaque ligne : les bobines (ou palettes) comptées, à défaut le poids de bobine et les bobines par palette de la fiche article.',
    ],
    droits: 'Lecture du module Réceptions pour voir et réimprimer ; écriture pour générer les étiquettes manquantes.',
    procedures: [
      {
        titre: 'Générer et imprimer',
        etapes: [
          'Choisissez « Une étiquette par » bobine ou palette, et le format.',
          '« Générer les étiquettes manquantes » : seules les lignes qui n’en ont pas encore pour cette nature en reçoivent.',
          '« Imprimer » : la page prend le format choisi (planche A4 ou rouleau).',
        ],
        resultat: 'Chaque étiquette porte un code court (E000001234) : au scan, l’écran retrouve la référence et le lot en base.',
      },
      {
        titre: 'Réimprimer',
        etapes: ['Ouvrez la page : les étiquettes déjà générées s’affichent, « Imprimer ».'],
        resultat: 'Les mêmes codes ressortent : une étiquette déjà collée garde son double.',
      },
    ],
    champs: [
      { nom: 'Une étiquette par', description: 'La nature des étiquettes : une par bobine, ou une par palette.', valeurs: 'Bobine · Palette', defaut: 'Bobine' },
      { nom: 'Format', description: 'Le support d’impression.', valeurs: 'Planche A4 — 3 × 8 (70 × 37 mm) · Rouleau thermique — 100 × 50 mm (une étiquette par page)', defaut: 'Planche A4' },
    ],
    regles: [
      'Générer ne fabrique que ce qui manque : une ligne déjà étiquetée garde ses codes, la page sert alors à réimprimer.',
      'Le nombre d’étiquettes d’une ligne vient du colisage compté au quai (bobines, palettes arrondies au-dessus) ; à défaut, du poids de bobine et des bobines par palette de la fiche article. Le poids imprimé est le poids de la ligne divisé par ce nombre.',
      'Au-delà de 5 000 étiquettes pour une ligne, rien n’est généré : vérifiez le colisage.',
      'Le lot imprimé est celui de la ligne au moment de l’impression : une ligne encore sans lot imprime « Lot — » ; le lot interne n’est posé qu’à la validation.',
    ],
    messages: [
      { message: 'colisage inconnu — comptez les bobines sur la ligne, ou complétez le poids de bobine du catalogue', cause: 'Ni bobines comptées, ni poids de bobine sur la fiche article : le nombre d’étiquettes ne peut pas se calculer.' },
      { message: '… étiquettes : au-delà de 5000, vérifiez le colisage', cause: 'Le colisage de la ligne donne un nombre d’étiquettes invraisemblable : c’est une erreur de saisie.' },
      { message: 'Reception annulee : sa marchandise n’est pas entree, il n’y a rien a etiqueter.', cause: 'Une réception annulée ne s’étiquette pas.' },
    ],
    liens: [{ route: '/receptions', libelle: 'Réceptions' }],
  },
]
