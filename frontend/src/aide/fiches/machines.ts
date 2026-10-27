/**
 * FICHES D'AIDE — MACHINES : FICHES ET PARC.
 *
 * Une partie du catalogue : `../contenu.ts` les assemble, `../types.ts` donne
 * la forme d'une fiche. Chaque `champs[].nom` est l'intitulé EXACT de l'écran :
 * c'est par lui que l'indice ⓘ se pose à côté du champ (`../indice.ts`).
 *
 * Réécrites le 27/10/2026 depuis le code des écrans (`pages/Machines.tsx`,
 * `pages/machines/*`, `pages/ParcMachines.tsx`) et de `domain/decision_machine.rs`.
 * Les blocs partagés ci-dessous servent plusieurs fiches : la saisie d'une
 * décision paraît sur trois adresses (le terrain sous /machines, la fiche neuve,
 * le brouillon repris). Aucun intitulé n'y figure deux fois.
 */
import type { Sujet } from '../types.ts'

type Champs = NonNullable<Sujet['champs']>
type Messages = NonNullable<Sujet['messages']>

// =============================================================================
// LES BLOCS PARTAGÉS DE LA SAISIE D'UNE DÉCISION
// =============================================================================

/** L'en-tête de la fiche, au bureau comme au téléphone. */
const CHAMPS_ENTETE: Champs = [
  {
    nom: 'Date',
    description: 'La date du fait. Une décision ne se date jamais dans le futur.',
    obligatoire: true,
    defaut: 'aujourd’hui',
  },
  {
    nom: 'Magasin d’origine',
    alias: ['Magasin de retour'],
    description:
      'Chargement : le magasin d’où sort le fil. Déchargement : celui où rentrent les bobines envoyées « Retour au magasin ». Le constat ne touche pas le magasin : il n’a pas ce champ.',
    obligatoire: true,
    valeurs: 'les magasins actifs',
  },
  {
    nom: 'Responsable',
    description: 'La personne qui fait le geste devant la machine.',
    obligatoire: true,
  },
  { nom: 'Observations', description: 'Une remarque libre sur la fiche ; elle reste avec elle.' },
]

/** Les colonnes et cases communes au bureau et au téléphone. */
const CHAMPS_COMMUNS: Champs = [
  {
    nom: 'Avant',
    description:
      'Ce que la ligne porte avant la décision : bobines, % moyen et kilos. Il ne se saisit pas ; c’est l’état résultant de la décision précédente.',
  },
  {
    nom: 'Après',
    description:
      'Ce que la ligne portera après la décision, en bobines et en kilos. Pendant la saisie c’est une estimation ; l’aperçu donne le chiffre qui sera enregistré.',
  },
  {
    nom: 'Écart',
    description:
      'Kilos avant + chargés − retirés − kilos après, pour la ligne. Positif : du fil a quitté la ligne, compté selon le motif ; négatif : une régularisation. Son niveau (vert, orange, rouge) vient de l’aperçu.',
    valeurs: 'kg',
  },
  {
    nom: '% théorique',
    description:
      'Le % que la ligne aurait si rien n’avait été consommé : kilos avant + chargés − retirés, divisés par bobines après × poids nominal. Au chargement, c’est la valeur proposée pour le % après.',
  },
  {
    nom: '% constaté',
    description:
      'Constat : le remplissage moyen mesuré des bobines de la ligne, en % du poids nominal. À 0 %, la ligne se ferme : ses bobines vides quittent l’étage et tout ce qui restait devient l’écart.',
    valeurs: '0 à 500 %, au dixième',
    defaut: 'le % de la ligne avant',
  },
  {
    nom: 'Motif',
    alias: ['Motif · destination'],
    description:
      'La raison du geste, propre au type de fiche, pour chaque ligne qui part : il dit ce que compte l’écart et, au déchargement, où peuvent aller les bobines retirées. Au détail d’une fiche validée, le motif enregistré de la ligne.',
    obligatoire: true,
    valeurs:
      'Chargement : Pour production · Complément de production · Autre. Déchargement : Changement de lot · Changement de production · Problème de fil · Déchet · Perte · Casse · Autre. Constat : Constat ordinaire · Correction · Déchet / perte / casse · Autre',
    defaut: 'Pour production, Changement de production ou Constat ordinaire ; Correction quand on arrive par « Corriger »',
  },
  {
    nom: 'L’écart compte comme',
    description:
      'Seulement pour un motif qui ne fixe pas l’effet de l’écart : Correction (consommation ou erreur de saisie) et, au constat, Déchet / perte / casse (déchet, perte ou casse).',
    obligatoire: true,
    valeurs: 'selon le motif',
  },
  {
    nom: 'Précision du motif',
    alias: ['Précision'],
    description:
      'Le commentaire du motif. Obligatoire quand l’écart est rouge. Au chargement, quand le fil qu’on charge serait déjà consommé, il faut y choisir l’une des raisons proposées.',
    valeurs: 'texte libre ; raisons proposées : Saisie décalée · Oubli de constat précédent · Erreur de report',
  },
]

/** Les colonnes de la grille du bureau (écran de 1 024 px et plus). */
const CHAMPS_GRILLE_BUREAU: Champs = [
  {
    nom: 'Référence · lot',
    description:
      'La ligne de la décision : une référence et son lot fournisseur. Une ligne déjà sur l’étage garde son lot ; une référence nouvelle au chargement prend un lot du magasin d’origine (le plus ancien est proposé) ou « sans lot ». « Modifier » ouvre une ligne fermée.',
    obligatoire: true,
  },
  {
    nom: 'À charger',
    description:
      'Le nombre de bobines ajoutées à la ligne. Le lien « charger N » propose de remplir la voie jusqu’à sa capacité ; « voie N » rappelle ce qu’elle tient, suivi de « ! » au-delà.',
    obligatoire: true,
    valeurs: 'bobines, au moins une ligne',
  },
  {
    nom: 'Poids/bob.',
    description:
      'Le poids d’une bobine chargée ; il devient le poids nominal d’une ligne qui arrive sur l’étage. Dessous, l’écart au poids du catalogue, coloré selon les tolérances du lot.',
    obligatoire: true,
    valeurs: 'kg, au millième',
    defaut: 'le poids d’une bobine du lot, sinon celui de la fiche article ; pour une ligne déjà sur l’étage, son poids nominal',
  },
  {
    nom: '% après',
    description:
      'Le remplissage moyen de TOUTE la ligne après le chargement, bobines déjà là comprises, en % du poids nominal. Les kilos de la ligne en découlent.',
    obligatoire: true,
    valeurs: '0 à 500 %, au dixième',
    defaut: 'le % théorique (« th. »), tant qu’on ne l’a pas touché',
  },
  {
    nom: 'À retirer',
    description: 'Le nombre de bobines enlevées de la ligne, au plus celles qu’elle porte. Tout retirer vide la ligne dans la même décision.',
    obligatoire: true,
    valeurs: 'bobines, au moins une ligne',
  },
  {
    nom: '% retirées',
    description: 'Le remplissage des bobines enlevées : il donne les kilos qui partent.',
    obligatoire: true,
    valeurs: '0 à 500 %',
    defaut: 'le % de la ligne avant',
  },
  {
    nom: '% restantes',
    description: 'Le remplissage constaté des bobines qui restent sur l’étage ; « vidée » quand tout est retiré.',
    valeurs: '0 à 500 %',
    defaut: 'le % de la ligne avant',
  },
  {
    nom: 'Présentes',
    description:
      'Le nombre de bobines de la ligne, lu de l’état : le constat ne le change pas (un chargement ou un déchargement le fait), sauf à 0 %, où la ligne se ferme.',
  },
  {
    nom: 'OF · qualité · voie',
    description:
      'L’OF que la ligne servira (« garde … » : celui qu’elle sert déjà ; seuls les OF prévus ou lancés se proposent), sa qualité — celle de l’OF, sinon choisie sur la ligne au chargement — et sa voie en mètres, qui ne se saisit qu’au chargement. Une ligne neuve au chargement se voit proposer l’OF de la ligne chargée juste avant, ou celui de l’étage s’il n’en sert qu’un.',
  },
]

/** Les colonnes de l'aperçu, et du détail d'une fiche validée. */
const CHAMPS_APERCU: Champs = [
  {
    nom: 'Chargé',
    alias: ['Retiré'],
    description: 'Aperçu : les bobines et les kilos chargés ou retirés ; au déchargement, leur destination.',
  },
  {
    nom: 'Constaté',
    description: 'Aperçu d’un constat : les bobines et les kilos de la ligne après le constat ; « ligne fermée » à 0 %.',
  },
  { nom: '% déclaré', description: 'Le % saisi : de toute la ligne après le chargement, des bobines restantes, ou constaté.' },
  {
    nom: 'Compte comme',
    description:
      'Ce que l’écart compte : consommation, déchet, perte, casse, erreur de saisie (hors consommation), écart non qualifié (à revoir), régularisation (constat supérieur), ou aucun écart.',
  },
  {
    nom: 'OF de la période → nouveau',
    description:
      'L’OF que la ligne servait avant la décision — l’OF sortant, à qui l’écart appartient — puis, s’il change, le nouvel OF ; dessous, la voie et le nombre de bobines qu’elle tient.',
  },
]

/** Les cases de l'interface de terrain (écran de moins de 1 024 px). */
const CHAMPS_TERRAIN: Champs = [
  {
    nom: 'Lot',
    description:
      'Le lot fournisseur de la ligne. Au téléphone, pour une référence nouvelle au chargement, il se choisit parmi les lots du magasin d’origine, le plus ancien d’abord (FIFO), ou « Sans lot » ; sur une ligne déjà sur l’étage, il ne change pas.',
    obligatoire: true,
  },
  { nom: 'Dernier état le', description: 'La date du dernier constat de la ligne, sous son état avant.' },
  { nom: 'Bobines à charger', description: 'Au téléphone : le nombre de bobines ajoutées à la ligne.', obligatoire: true },
  {
    nom: 'Poids par bobine chargée (kg)',
    description: 'Au téléphone : le poids d’une bobine chargée ; dessous, le poids du catalogue et l’écart, coloré selon les tolérances du lot.',
    obligatoire: true,
    defaut: 'le poids d’une bobine du lot, sinon celui de la fiche article',
  },
  {
    nom: '% de toute la ligne après le chargement',
    description: 'Au téléphone : le remplissage moyen de toute la ligne après le chargement, bobines déjà là comprises.',
    obligatoire: true,
    defaut: 'le % théorique',
  },
  {
    nom: 'Bobines à retirer',
    description: 'Au téléphone : le nombre de bobines enlevées ; la parenthèse rappelle combien la ligne en porte.',
    obligatoire: true,
  },
  { nom: '% des bobines retirées', description: 'Au téléphone : le remplissage des bobines enlevées, d’où les kilos qui partent.', obligatoire: true },
  { nom: '% des bobines qui restent', description: 'Au téléphone : le remplissage constaté des bobines qui restent ; absent quand tout est retiré.' },
  { nom: 'Bobines présentes', description: 'Au téléphone, au constat : le nombre de bobines de l’état, qui ne se change pas ici.' },
  {
    nom: 'OF de la ligne',
    description:
      'L’OF que sert la ligne : « garde … » laisse celui qu’elle sert déjà, « — aucun OF — » n’en met pas. Seuls les OF prévus ou lancés se proposent.',
  },
  {
    nom: 'Qualité de la ligne',
    description:
      'Avec un OF, sa qualité, en lecture (« (OF) »). Sans OF : au chargement, à choisir — obligatoire, sauf si la ligne garde la qualité qu’elle sert déjà ; au déchargement et au constat, celle que la ligne sert déjà, en lecture.',
  },
  {
    nom: 'Largeur de la voie (m)',
    alias: ['Voie'],
    description:
      'La largeur de la voie de la ligne, en mètres. Elle se saisit au chargement seulement ; ailleurs elle se lit (« Voie »). D’elle vient le nombre de bobines que tient la voie : capacité de l’étage ÷ largeur de la machine × voie, arrondi à l’entier inférieur.',
    valeurs: 'm, au centième',
  },
  {
    nom: 'Destination des bobines retirées',
    alias: ['Destination'],
    description: 'Où vont les bobines retirées. Un motif qui n’admet qu’une destination la pose seul ; seul « Retour au magasin » fait rentrer du fil au stock.',
    obligatoire: true,
    valeurs: 'Retour au magasin · Perte · Déchet · Casse, selon le motif',
  },
]

/** Les deux façons d'ajouter une ligne au chargement. */
const CHAMPS_AJOUT: Champs = [
  {
    nom: 'Scanner une étiquette',
    description:
      'Au chargement, une fois le magasin d’origine choisi : l’étiquette d’une bobine compte 1, celle d’une palette compte ses bobines. La ligne de cette référence et de ce lot reçoit le compte, ou naît.',
  },
  {
    nom: 'Ajouter une référence',
    description:
      'Au chargement : une référence qui n’est pas encore sur l’étage, cherchée au serveur (code — désignation). Au téléphone, elle se choisit dans le stock du magasin d’origine, lot par lot, ou dans tout le catalogue.',
  },
]

/** Le champ de la fenêtre « Dévalider » / « Annuler ». */
const CHAMP_POURQUOI: Champs = [
  {
    nom: 'Pourquoi ?',
    description: 'La raison de la dévalidation ou de l’annulation ; elle reste au journal, à côté du nom et de l’heure.',
    obligatoire: true,
    valeurs: '5 caractères au moins',
  },
]

const REGLES_DECISION: string[] = [
  'Chaque validation est une DÉCISION : état avant, saisie par ligne Référence + Lot, aperçu, validation, état résultant. L’état avant et l’état résultant sont archivés et ne s’effacent pas.',
  'L’aperçu fait exactement le calcul de la validation. Toute saisie modifiée après lui le périme : il faut le refaire avant de valider.',
  'Ni OF ni qualité en en-tête : chaque ligne porte son OF ; sa qualité est celle de l’OF, sinon elle se choisit sur la ligne. Un chargement sans OF ni qualité est refusé ; avec un OF, une autre qualité est refusée. Un OF choisi doit être prévu ou lancé.',
  'Seul le chargement définit la voie d’une ligne et son nombre de bobines : le déchargement et le constat les lisent sans pouvoir les changer.',
  'Le constat ne change pas le nombre de bobines, sauf à 0 % : la ligne se ferme, ses bobines vides quittent l’étage et tout ce qui restait devient l’écart, qualifié par le motif.',
  'Le reste jeté au rebut sort par un déchargement vers « Déchet ». Seule la destination « Retour au magasin » fait rentrer du fil au stock ; perte, déchet et casse sortent de l’étage sans revenir.',
  'Écart = kilos avant + chargés − retirés − kilos après. Positif, il est compté selon le motif (consommation, déchet, perte, casse, erreur de saisie, non qualifié) ; négatif, c’est une régularisation, jamais une consommation.',
  'L’écart appartient à l’OF que la ligne servait AVANT la décision (l’OF sortant), jamais à celui qui commence ; la qualité suit la même frontière. Au premier chargement d’une ligne, un écart éventuel revient à l’OF pour lequel on charge.',
  'Le % se saisit au centième : un écart plus petit que ce que produit l’arrondi compte comme nul, et l’étage garde ses kilos.',
  'Le poids nominal d’une ligne déjà sur l’étage est celui de l’étage, fixé à son chargement ; une ligne qui arrive prend le poids déclaré au chargement.',
  'Seuls les écarts non expliqués se jugent : une consommation, un déchet, une perte ou une casse déclarés restent en vert. Les autres — non qualifié, régularisation, erreur de saisie, et tout écart d’une « Correction » — sont verts jusqu’à MAX(10 kg ; 1 % du poids de la ligne), rouges au-delà de MAX(50 kg ; 5 %), orange entre les deux (paramètres P_MachineEcartVertKg, P_MachineEcartVertPct, P_MachineEcartRougeKg, P_MachineEcartRougePct).',
  'Orange : à confirmer avant de valider (« Valider quand même »). Rouge : la validation revient au droit de valider l’inventaire (Direction), et la précision du motif est obligatoire.',
  'Au chargement, une consommation plus grande que ce que la ligne portait avant voudrait dire que le fil qu’on charge est déjà filé : l’écart passe en orange et la précision doit être l’une des raisons proposées.',
  'Une ligne Référence + Lot ne figure qu’une fois sur la fiche. Le motif est obligatoire et propre au type de fiche ; au déchargement, il limite les destinations.',
  'On ne retire pas plus de bobines qu’une ligne n’en porte, ni plus de kilos ; sur les kilos, seul le droit de valider l’inventaire passe outre, pour corriger un étage faux.',
  'L’étage ne dépasse jamais ses places ; des places libres sont permises.',
  'Un chargement que le stock du magasin, ou celui du lot, ne couvre pas est BLOQUÉ, sans « charger quand même » : le directeur ou l’administrateur fait et valide la correction de stock avant.',
  'Un lot bloqué par la qualité ne se charge pas ; il se décharge vers le magasin. Une dérogation se demande sous le refus de l’aperçu ; accordée dans Lots → Autorisations, elle sert une fois, pour ce lot, cette fiche et au plus ses kilos.',
  'Un inventaire ouvert gèle le magasin (global) ou ses références (tournant, ciblé) : ni chargement, ni déchargement vers le magasin jusqu’à sa clôture. Le constat n’est pas touché.',
  'Signalé sans bloquer (C63) : une ligne au-delà des bobines de sa voie, des voies plus larges, ensemble, que la machine.',
  'Avant de valider un chargement, l’écran fait confirmer un mélange de lots d’une même référence sur l’étage et un lot plus ancien qui attend au magasin (FIFO).',
  'Le premier poste qui valide prend l’étage ; un second, au même moment, est refusé et réessaie à partir de l’état résultant.',
  'Une machine retirée du parc, ou une zone désactivée, ne porte plus de fiche : un brouillon déjà saisi ne s’y valide plus.',
  'Valider un chargement ou un déchargement demande le droit VALIDER du module Mouvements (le magasin bouge) ; valider un constat, le droit d’écrire.',
]

const REGLES_RETRAIT: string[] = [
  'Seule la DERNIÈRE décision d’un étage se retire — « Dévalider » (la fiche revient en brouillon, son étage peut changer) ou « Annuler » (la fiche est close) — ; une plus ancienne se répare par un constat « Correction ».',
  'Retirer une décision demande le droit VALIDER du module Mouvements, et d’être l’auteur de la validation le jour même, ou d’avoir le droit de valider l’inventaire (administrateur, directeur).',
  'L’étage revient exactement à l’état qui précédait, OF et voie compris ; les mouvements du magasin reçoivent une annulation administrative rattachée, à leur valeur d’origine.',
  'Le retrait est refusé si l’étage a changé depuis, si le fil rendu au magasin a déjà servi, ou s’il appartient à un lot bloqué par la qualité.',
  'Les mouvements nés d’une fiche machine ne se contre-passent pas depuis l’écran Mouvements : ils se défont en dévalidant ou en annulant la fiche.',
  'Annuler un brouillon le clôt sans rien changer à l’étage ni au magasin ; il reste consultable.',
]

const MESSAGES_DECISION: Messages = [
  {
    message: '… est en cours de modification par une autre fiche : on ne peut pas y toucher pour l’instant, réessayez dans un moment',
    cause: 'Un autre poste valide une décision sur ce même étage. Réessayez : vous partirez de son état résultant.',
  },
  {
    message: 'Chargement bloqué : stock insuffisant au magasin',
    cause: 'Le magasin d’origine ne porte pas les kilos à charger (STOCK-INSUFFISANT). Prévenez le directeur ou l’administrateur : la correction de stock est faite et validée par eux avant.',
  },
  {
    message: 'Chargement bloqué : ce lot n’est pas au magasin en quantité suffisante',
    cause: 'Le lot choisi ne couvre pas les kilos à charger dans ce magasin (LOT-INSUFFISANT). Même recours : la correction du stock du lot.',
  },
  {
    message: 'LOT-BLOQUE : le lot … de … est bloqué par la qualité : il ne se charge pas',
    cause: 'Le lot est bloqué. Demandez une dérogation sous le refus, ou attendez son déblocage (droit de valider les lots, ou Direction).',
  },
  {
    message: 'DEROGATION-KG : … la dérogation accordée couvre … kg, la fiche en charge … kg',
    cause: 'La dérogation est bornée en kilos : ramenez la quantité, ou demandez une nouvelle dérogation.',
  },
  {
    message: '… : la voie se définit au chargement : elle reste de … m',
    cause: 'Une voie différente de celle de l’état a été envoyée par un déchargement ou un constat.',
  },
  {
    message: '… : le constat ne change pas le nombre de bobines (… sur l’étage, … saisies)',
    cause: 'Le nombre de bobines se change par un chargement ou un déchargement ; seul un constat à 0 % ferme la ligne.',
  },
  {
    message: '… : indiquez la qualité que sert ce chargement (sans OF, elle est obligatoire)',
    cause: 'La ligne chargée n’a ni OF ni qualité, et n’en servait aucune.',
  },
  {
    message: '… : la qualité … ne correspond pas à l’OF …, qui produit la qualité …',
    cause: 'Avec un OF, la qualité est la sienne.',
  },
  {
    message: 'l’OF … est … : choisissez un OF prévu ou lancé',
    cause: 'L’OF choisi a été clôturé ou annulé depuis la saisie.',
  },
  {
    message: '… : écart de … kg, au-delà du seuil rouge (… kg) — la validation revient à la Direction',
    cause: 'L’écart non expliqué dépasse le seuil rouge : seul le droit de valider l’inventaire valide.',
  },
  {
    message: '… : écart rouge de … kg — écrivez ce qui l’explique dans le commentaire du motif',
    cause: 'Un écart rouge exige la précision du motif.',
  },
  {
    message: '… kg du fil qu’on charge seraient déjà consommés (la ligne ne portait que … kg) — choisissez la raison',
    cause: 'Consommation au-delà de ce que la ligne portait : choisissez Saisie décalée, Oubli de constat précédent ou Erreur de report dans la précision.',
  },
  {
    message: '… kg retirés, la ligne n’en porte que … kg',
    cause: 'Vérifiez le % des bobines retirées ; si l’étage est faux, l’administrateur ou le directeur corrige.',
  },
  {
    message: 'l’étage porterait … bobines pour … places : dépassement de …',
    cause: 'La décision ferait déborder l’étage (« Capacité dépassée » à l’écran).',
  },
  {
    message: '… figure deux fois sur la fiche : une seule ligne par référence et lot',
    cause: 'Deux lignes pour la même référence et le même lot.',
  },
  {
    message: '… : ni le lot ni la fiche article ne portent le poids d’une bobine',
    cause: 'Sans poids de bobine, le % ne se convertit pas en kilos : saisissez le poids par bobine au chargement, ou complétez le lot ou la fiche article.',
  },
  {
    message: 'la fiche est datée du … : une décision ne se date pas dans le futur',
    cause: 'La date de la fiche est postérieure à aujourd’hui.',
  },
  {
    message: 'INVENTAIRE-OUVERT : l’inventaire …',
    cause: 'Un inventaire ouvert gèle ce magasin ou ces références ; l’écran le dit en tête de la fiche. Attendez sa clôture.',
  },
  {
    message: '… — cette fiche ne se valide plus. Annulez le brouillon, ou remettez la machine ou la zone en service d’abord.',
    cause: 'La machine a été retirée du parc ou la zone désactivée après la saisie du brouillon.',
  },
  {
    message: 'Saisie modifiée depuis l’aperçu',
    cause: 'Une case a changé après l’aperçu : refaites-le, il doit montrer exactement ce qui sera enregistré.',
  },
]

const MESSAGES_RETRAIT: Messages = [
  {
    message: 'cette décision a servi de base à la fiche … : elle ne se retire pas seule',
    cause: 'Ce n’est plus la dernière décision de l’étage. Procédure : correction de stock si besoin, constat avec le motif « Correction », puis nouveau chargement correct.',
  },
  {
    message: 'seul l’auteur de la validation, le jour même, ou un administrateur ou un directeur peut retirer cette décision',
    cause: 'Vous n’êtes pas l’auteur du jour, et n’avez pas le droit de valider l’inventaire.',
  },
  {
    message: 'l’étage ne correspond plus à l’état issu de cette décision',
    cause: 'L’étage a changé depuis la décision : réparez par un constat « Correction ».',
  },
  {
    message: 'le fil rendu au magasin … a déjà été utilisé',
    cause: 'Le fil que le déchargement a rendu au magasin en est déjà ressorti : correction de stock, puis constat « Correction ».',
  },
  {
    message: 'cette fiche a rendu au magasin du fil d’un lot bloqué par la qualité',
    cause: 'Retirer la fiche remettrait ce fil en production, ce que le blocage interdit.',
  },
  {
    message: 'le motif doit dire pourquoi (5 caractères au moins)',
    cause: 'Le champ « Pourquoi ? » est trop court.',
  },
  {
    message: 'la fiche … a été validée avant le modèle de décisions (05/10/2026)',
    cause: 'Une fiche ancienne ne se dévalide ni ne s’annule : constat avec le motif « Correction ».',
  },
]

// =============================================================================
// LES FICHES
// =============================================================================

export const FICHES_MACHINES: Sujet[] = [
  // ---------------------------------------------------------------- /machines
  {
    route: '/machines',
    titre: 'Machines',
    chemin: 'Stock → Machines',
    objectif:
      'Voir chaque machine et ce qu’elle porte, puis l’ouvrir pour charger, décharger ou constater un étage ; sur un écran de moins de 1 024 px, la même page devient l’interface de terrain : une machine, un étage, une ligne à la fois.',
    prerequis: [
      'Les machines et leurs zones déclarées dans Paramètres → Parc machines.',
      'Pour un chargement : le fil présent au magasin d’origine, dans le lot chargé.',
    ],
    droits:
      'Lecture du module Stock pour voir. Enregistrer une fiche et faire l’aperçu : écriture du module Mouvements ; valider un constat : écriture ; valider un chargement ou un déchargement : droit VALIDER du module Mouvements. Un écart rouge revient au droit de valider l’inventaire. Le lien « Le parc » ne paraît qu’avec l’écriture du module Paramètres.',
    procedures: [
      {
        titre: 'Ouvrir une machine (poste de bureau)',
        etapes: ['Cliquez la ligne de la machine (ou « Ouvrir »).'],
        resultat: 'L’écran de la machine s’ouvre : ses étages, ses fiches, ses mouvements et sa consommation.',
      },
      {
        titre: 'Charger, décharger ou constater sur le terrain (écran de moins de 1 024 px)',
        etapes: [
          'Touchez la machine, puis l’étage (les zones hors étages — fil de chaîne, trame, réserve — sont listées à part).',
          'L’étage montre ses emplacements, son poids constaté, son dernier constat et ses lignes ; touchez une ligne pour son détail.',
          'Touchez « Charger », « Décharger » ou « Constater » dans la barre du bas.',
          'Remplissez l’en-tête : date, responsable, magasin (sauf au constat), observations.',
          'Passez d’une ligne à l’autre par les boutons Référence · lot ; pour chacune, saisissez les bobines et le %, l’OF de la ligne, sa qualité si elle se choisit, et le motif.',
          'Touchez « Aperçu » : il montre ce que la validation enregistrera, ou ce qui la bloque.',
          'Touchez « Valider ».',
        ],
        resultat: '« Décision validée » : le numéro de validation, le mouvement de magasin éventuel et la consommation retenue. « Retour à la zone » ramène à l’étage.',
      },
      {
        titre: 'Ajouter une référence à charger (terrain)',
        etapes: [
          'Choisissez d’abord le magasin d’origine.',
          'Scannez l’étiquette, ou touchez « Ajouter une référence » : le stock du magasin s’affiche par référence, ses lots du plus ancien au plus récent, et « Sans lot » pour ce que les lots n’expliquent pas.',
          'Si le magasin ne connaît pas la référence, « Chercher dans tout le catalogue » : elle se charge sans lot, et la validation dira si le stock manque.',
        ],
      },
    ],
    champs: [
      { nom: 'Machine', description: 'Le nom et le code de la machine ; un clic l’ouvre.' },
      {
        nom: 'Étages',
        description: 'Le nombre d’étages de la machine. Au téléphone, la liste de ses étages ; « Hors étages » regroupe le fil de chaîne, la trame et la réserve.',
      },
      { nom: 'Bobines', description: 'Les bobines portées sur les places de la machine.' },
      { nom: 'Charge', description: 'La jauge de remplissage : bobines portées ÷ places.' },
      { nom: 'État', description: 'En production, en panne, en sommeil ou retirée du parc ; il se change dans Paramètres → Parc machines.' },
      { nom: 'Emplacements', description: 'Au téléphone, sur un étage : les bobines portées sur ses places.' },
      { nom: 'Poids constaté', description: 'Les kilos que l’étage porte, somme de ses lignes.' },
      { nom: 'Dernier constat', description: 'La date du dernier constat de l’étage.' },
      {
        nom: 'Poids par bobine',
        description: 'Détail d’une ligne : le poids nominal d’une bobine sur l’étage, et son écart au catalogue, coloré selon les tolérances du lot.',
        valeurs: 'kg',
      },
      { nom: 'Catalogue', description: 'Le poids d’une bobine à la fiche article.', valeurs: 'kg' },
      { nom: 'Mode du constat', description: 'Comment l’état a été établi.', valeurs: 'Pesée · Estimation' },
      { nom: 'Constaté le', description: 'La date du dernier constat de la ligne.' },
      { nom: 'Par', description: 'Le responsable de ce constat.' },
      ...CHAMPS_ENTETE,
      ...CHAMPS_COMMUNS,
      ...CHAMPS_TERRAIN,
      ...CHAMPS_AJOUT,
    ],
    regles: [
      'Au-dessous de 1 024 px de large, la page se présente en interface de terrain ; au-dessus, en liste de bureau. Les deux font le même calcul et envoient la même fiche.',
      'L’interface de terrain n’a que trois gestes : « Corriger » (constat au motif Correction) se lance depuis l’écran de la machine.',
      ...REGLES_DECISION,
    ],
    messages: MESSAGES_DECISION,
    liens: [
      { route: '/parc-machines', libelle: 'Parc machines' },
      { route: '/mouvements', libelle: 'Mouvements' },
      { route: '/fiche-hors-machine', libelle: 'Fiche hors machine' },
    ],
  },

  // ---------------------------------------------------------- /machines/:code
  {
    route: '/machines/:code',
    titre: 'Une machine',
    chemin: 'Stock → Machines → (une machine)',
    objectif:
      'Voir une machine étage par étage — contenu, fiches, mouvements, consommation —, filtrée par l’étage choisi, et y lancer les gestes : charger, décharger, constater, corriger.',
    prerequis: ['La machine déclarée dans Paramètres → Parc machines.'],
    droits:
      'Lecture du module Stock. Les gestes ouvrent une fiche (écriture du module Mouvements) ; « Dévalider » et « Annuler » une décision validée demandent le droit VALIDER du module Mouvements. « Modifier la machine » ne paraît qu’avec l’écriture du module Paramètres.',
    procedures: [
      {
        titre: 'Choisir un étage',
        etapes: [
          'Touchez la puce de l’étage en tête (avec ses bobines sur ses places), ou cliquez sa ligne dans l’onglet « Étages ».',
          '« Toute la machine » retire le filtre.',
        ],
        resultat: 'Les quatre onglets ne montrent plus que cet étage ; l’adresse le garde (?etage=…) et les gestes paraissent en tête.',
      },
      {
        titre: 'Lancer un geste sur un étage',
        etapes: [
          'L’étage choisi, cliquez « Charger », « Décharger », « Constater » ou « Corriger » en tête — ou l’icône du geste sur la ligne de l’étage.',
          '« Corriger » ouvre un constat dont le motif « Correction » est déjà choisi.',
        ],
        resultat: 'La fiche s’ouvre sur son propre écran.',
      },
      {
        titre: 'Reprendre ou lire une fiche',
        etapes: ['Onglet « Fiches » : « Reprendre » un brouillon, « Ouvrir » une fiche validée ou annulée, ou cliquez sa ligne.'],
      },
      {
        titre: 'Défaire la dernière décision d’un étage',
        etapes: [
          'Onglet « Fiches » : seule la fiche marquée « dernière de l’étage » porte « Dévalider » et « Annuler ».',
          'La fenêtre montre l’état auquel l’étage reviendra et les mouvements de magasin qui seront annulés.',
          'Écrivez la raison dans « Pourquoi ? », puis confirmez.',
        ],
        resultat:
          'L’étage revient exactement à l’état qui précédait ; « Dévalider » remet la fiche en brouillon, « Annuler » la clôt. Les mouvements du magasin reçoivent une annulation administrative.',
      },
      {
        titre: 'Lire les mouvements et la consommation',
        etapes: [
          'Onglet « Mouvements » : chaque décision ligne par ligne, avec le mouvement de magasin qui en est l’autre moitié, et son annulation si la fiche a été retirée.',
          'Onglet « Consommation » : par ligne, du départ à la fin ; le champ « Référence ou lot… » filtre.',
        ],
      },
    ],
    champs: [
      { nom: 'Étage', description: 'L’étage (ou la zone), avec ses bobines portées sur ses places ; un étage vide montre ses emplacements disponibles.' },
      { nom: 'Référence', description: 'La référence montée sur la ligne.' },
      { nom: 'Couleur', description: 'La couleur de la référence.' },
      { nom: 'Lot', description: 'Le lot fournisseur de la ligne.' },
      { nom: 'Bobines', description: 'Le nombre de bobines de la ligne.' },
      { nom: '%', description: 'Le remplissage moyen des bobines de la ligne, en % du poids nominal.' },
      { nom: 'Kg', description: 'Les kilos que porte la ligne.' },
      { nom: 'Constat', description: 'La date du dernier constat de la ligne.' },
      { nom: 'Fiche', description: 'Le numéro de la fiche ; un clic l’ouvre. Dans « Mouvements », avec le type de geste dessous.' },
      { nom: 'Type', description: 'Chargement, déchargement ou constat (« Consommation » : ancienne fiche, plus créée).' },
      { nom: 'Date', description: 'La date de la fiche (dans « Mouvements », de la décision).' },
      { nom: 'Responsable', description: 'La personne qui a fait le geste.' },
      { nom: 'Validée par', description: 'Le compte qui a validé la fiche.' },
      {
        nom: 'Statut',
        description:
          'Fiches : Brouillon, Validée ou Annulée, et « dernière de l’étage » pour la seule qui se retire. Mouvements : active, dévalidée ou annulée (ligne barrée), et « dernière ».',
      },
      { nom: 'Référence · lot', description: 'La ligne de la décision : référence, et son lot dessous.' },
      { nom: 'Avant', description: 'Les kilos de la ligne avant la décision.', valeurs: 'kg' },
      { nom: 'Chargé / retiré', description: 'Les kilos chargés (+) ou retirés (−) ; au déchargement, leur destination dessous.', valeurs: 'kg' },
      { nom: 'Après', description: 'Les kilos de la ligne après la décision.', valeurs: 'kg' },
      { nom: 'Écart', description: 'Kilos avant + chargés − retirés − kilos après ; dessous, ce qu’il compte et son niveau.', valeurs: 'kg' },
      {
        nom: 'Mouvement magasin',
        description: 'Le mouvement de magasin né de la décision (un clic l’ouvre), et l’annulation qui l’a défait ; « aucun (constat) » : le constat ne touche pas le magasin.',
      },
      { nom: 'Zone', description: 'L’étage ou la zone de la ligne de consommation.' },
      { nom: 'Départ', description: 'Les kilos de la ligne au début de la période.', valeurs: 'kg' },
      { nom: 'Chargé', description: 'Les kilos chargés sur la période.', valeurs: 'kg' },
      { nom: 'Retour magasin', description: 'Les kilos rendus au magasin par les déchargements.', valeurs: 'kg' },
      { nom: 'Sorti (perte, déchet…)', description: 'Les kilos déchargés vers la perte, le déchet ou la casse.', valeurs: 'kg' },
      { nom: 'Fin', description: 'Les kilos de la ligne à la dernière décision.', valeurs: 'kg' },
      {
        nom: 'Consommé',
        description: 'La consommation : la somme des écarts qualifiés « consommation » des décisions actives. En rouge si elle est négative.',
        valeurs: 'kg',
      },
      { nom: 'Déchet / perte / casse', description: 'Les écarts qualifiés déchet, perte ou casse : du fil qui n’a pas été tissé.', valeurs: 'kg' },
      { nom: 'Non qualifié', description: 'Les écarts sans qualification, à revoir.', valeurs: 'kg' },
      { nom: 'Régularisation', description: 'Les écarts négatifs : plus de fil constaté qu’attendu.', valeurs: 'kg' },
      { nom: 'Erreur de saisie', description: 'Les écarts d’une Correction déclarés erreur de saisie : hors consommation.', valeurs: 'kg' },
      ...CHAMP_POURQUOI,
    ],
    regles: [
      'L’étage choisi filtre les quatre onglets ; les étages vides figurent dans « Étages » : c’est là qu’on charge.',
      'La consommation est la somme des écarts qualifiés « consommation » des décisions actives ; pertes, déchets, casses, écarts non qualifiés, régularisations et erreurs de saisie sont montrés à part.',
      ...REGLES_RETRAIT,
    ],
    messages: MESSAGES_RETRAIT,
    liens: [
      { route: '/machines', libelle: 'Toutes les machines' },
      { route: '/parc-machines', libelle: 'Parc machines' },
      { route: '/mouvements', libelle: 'Mouvements' },
    ],
  },

  // ------------------------------------------- /machines/:code/fiche/:type/:zone
  {
    route: '/machines/:code/fiche/:type/:zone',
    titre: 'Fiche machine : chargement, déchargement, constat',
    chemin: 'Stock → Machines → (une machine) → Charger · Décharger · Constater · Corriger',
    objectif:
      'Saisir une décision sur un étage — chargement, déchargement ou constat —, ligne par ligne Référence + Lot, la voir en aperçu exactement comme elle sera enregistrée, puis la valider.',
    prerequis: [
      'Un étage d’une machine qui n’est pas retirée du parc.',
      'Au chargement : le fil au magasin d’origine, dans le lot choisi, et un OF prévu ou lancé ou, à défaut, la qualité que sert la ligne.',
    ],
    droits:
      'Écriture du module Mouvements pour enregistrer la fiche et faire l’aperçu, et pour valider un constat. Valider un chargement ou un déchargement : droit VALIDER du module Mouvements. Un écart rouge : droit de valider l’inventaire.',
    procedures: [
      {
        titre: 'Charger un étage',
        etapes: [
          'Choisissez le magasin d’origine et nommez le responsable ; la date est celle du jour.',
          'Pour une ligne déjà sur l’étage : « Modifier », puis le nombre de bobines « À charger ». Pour une référence nouvelle : scannez son étiquette ou « Ajouter une référence », puis son lot.',
          'Vérifiez le poids par bobine (celui du lot est proposé) et le « % après » de toute la ligne : le % théorique est proposé, laissez-le si vous ne constatez rien d’autre.',
          'Choisissez l’OF de la ligne ; sans OF, la qualité. Indiquez la voie en mètres si la ligne en a une : « charger N » propose de la remplir.',
          'Vérifiez le motif, puis « Aperçu », relisez, et « Valider la décision ».',
        ],
        resultat: 'Le fil sort du magasin à son coût moyen, l’étage prend l’état résultant, et l’écart éventuel est classé selon le motif.',
      },
      {
        titre: 'Décharger un étage',
        etapes: [
          'Choisissez le magasin de retour et nommez le responsable.',
          'Pour chaque ligne touchée : les bobines « À retirer », leur %, le motif et la destination, et le % des bobines qui restent.',
          'Tout retirer est permis : la ligne se vide dans la même décision.',
          'Aperçu, relecture, « Valider la décision ».',
        ],
        resultat: 'Seules les bobines envoyées « Retour au magasin » rentrent au stock ; perte, déchet et casse sortent de l’étage sans revenir.',
      },
      {
        titre: 'Constater un étage',
        etapes: [
          'Pour chaque ligne : le % constaté. Le nombre de bobines est celui de l’état : il ne se change pas ici.',
          'Une ligne vide se ferme par un constat à 0 % : ses bobines quittent l’étage.',
          'Aperçu, relecture, « Valider la décision ».',
        ],
        resultat: 'L’écart de chaque ligne est classé par son motif ; aucun mouvement de magasin.',
      },
      {
        titre: 'Corriger une erreur passée',
        etapes: [
          '« Corriger » sur l’étage ouvre un constat au motif « Correction ».',
          'Dites si l’écart est une consommation ou une erreur de saisie (« L’écart compte comme »).',
          'Aperçu : l’écart d’une correction est toujours jugé aux seuils ; validation.',
        ],
      },
      {
        titre: 'Jeter le reste d’une ligne au rebut',
        etapes: ['Faites un déchargement de la ligne vers « Déchet » (motif Déchet, ou Problème de fil / Autre avec la destination Déchet).'],
      },
      {
        titre: 'Quand l’aperçu bloque ou avertit',
        etapes: [
          'Rouge (« La décision ne peut pas être validée ») : corrigez la saisie, ou suivez la consigne — correction de stock par le directeur, dérogation pour un lot bloqué, Direction pour un écart rouge.',
          'Orange (« À vérifier ») : la validation passe ; un écart orange, un mélange de lots ou un lot plus ancien au magasin se confirment par « Valider quand même ».',
        ],
      },
    ],
    exemples: [
      {
        titre: 'le nombre de bobines d’une voie',
        situation: 'Un étage de 1 344 places sur une machine de 4,20 m ; la ligne est chargée sur une voie de 1,20 m.',
        calcul: [
          ['Bobines de la voie', '1 344 ÷ 4,20 × 1,20 = 384'],
          ['Chargement de 400 bobines', 'au-delà de 384 : signalé (C63), la validation passe'],
        ],
        conclusion: 'Une aide au magasinier, jamais une consommation : une bobine ne se coupe pas, l’entier est arrondi vers le bas.',
      },
      {
        titre: 'les seuils d’un écart jugé',
        situation: 'Écarts non expliqués (non qualifié, régularisation, erreur de saisie, correction), seuils livrés : vert jusqu’à MAX(10 kg ; 1 %), rouge au-delà de MAX(50 kg ; 5 %).',
        calcul: [
          ['Ligne de 400 kg, écart 8 kg', 'vert'],
          ['Ligne de 400 kg, écart −30 kg', 'orange : à confirmer'],
          ['Ligne de 400 kg, écart 60 kg', 'rouge : Direction et précision du motif'],
          ['Ligne de 3 000 kg, écart 120 kg', 'orange (vert jusqu’à 30 kg, rouge au-delà de 150 kg)'],
        ],
        conclusion: 'Une consommation, un déchet, une perte ou une casse déclarés restent en vert, quelle que soit leur taille.',
      },
      {
        titre: 'le constat à 0 % ferme la ligne',
        situation: 'La ligne porte 12 bobines de 2,5 kg nominal, à 8 %.',
        calcul: [
          ['Kilos avant', '12 × 2,5 × 8 % = 2,4 kg'],
          ['Constat à 0 %', '0 bobine, 0 kg après'],
          ['Écart', '2,4 + 0 − 0 − 0 = 2,4 kg, motif « Constat ordinaire » : consommation'],
        ],
        conclusion: 'Les bobines vides quittent l’étage ; un reste qu’on jette sort, lui, par un déchargement vers « Déchet ».',
      },
      {
        titre: 'l’écart appartient à l’OF sortant',
        situation: 'La ligne servait l’OF A ; au constat, on la passe sur l’OF B, et le constat mesure 40 kg d’écart.',
        calcul: [
          ['OF de la période → nouveau', 'OF A → OF B'],
          ['Les 40 kg', 'comptés sur l’OF A'],
        ],
        conclusion: 'L’écart mesure la période qui se termine : il n’appartient jamais à l’OF qui commence.',
      },
    ],
    champs: [...CHAMPS_ENTETE, ...CHAMPS_GRILLE_BUREAU, ...CHAMPS_COMMUNS, ...CHAMPS_APERCU, ...CHAMPS_TERRAIN, ...CHAMPS_AJOUT],
    regles: [
      'Sous 1 024 px de large, la fiche prend l’interface de terrain, une ligne à la fois ; la saisie et le corps envoyé sont les mêmes.',
      'Une ligne se lit fermée ; « Modifier » l’ouvre. Une ligne vide, modifiée ou à compléter (motif, effet) s’ouvre d’elle-même.',
      'Après une validation, la saisie repart de l’état résultant : on peut enchaîner une autre décision sur l’étage.',
      ...REGLES_DECISION,
    ],
    messages: MESSAGES_DECISION,
    liens: [
      { route: '/machines', libelle: 'Machines' },
      { route: '/autorisations', libelle: 'Autorisations (dérogations)' },
      { route: '/inventaires', libelle: 'Inventaires' },
    ],
  },

  // ------------------------------------------------------ /machines/fiches/:id
  {
    route: '/machines/fiches/:id',
    titre: 'Une fiche machine',
    chemin: 'Stock → Machines → (une machine) → Fiches → (une fiche)',
    objectif:
      'Reprendre une fiche en brouillon, ou lire une fiche validée ou annulée — ce que la décision a enregistré, l’étage avant et après, ses validations et son journal —, et retirer la dernière décision d’un étage.',
    droits:
      'Lecture du module Stock pour lire. Reprendre ou annuler un brouillon : écriture du module Mouvements. Valider : comme une fiche neuve. Dévalider ou annuler une décision validée : droit VALIDER du module Mouvements, et être l’auteur du jour ou avoir le droit de valider l’inventaire.',
    procedures: [
      {
        titre: 'Reprendre un brouillon',
        etapes: [
          'La fiche s’ouvre en saisie, comme une fiche neuve, avec ses lignes.',
          'Une fiche dévalidée peut changer d’étage (« Étage ») : c’est le cas de l’erreur d’emplacement ; le journal garde l’étage d’origine.',
          'Corrigez, « Aperçu », puis « Valider la décision ».',
        ],
      },
      {
        titre: 'Annuler un brouillon',
        etapes: ['« Annuler la fiche », puis la raison dans « Pourquoi ? ».'],
        resultat: 'Le brouillon est clos sans rien changer à l’étage ni au magasin ; il reste consultable.',
      },
      {
        titre: 'Lire une fiche validée ou annulée',
        etapes: [
          'L’en-tête : statut, machine et étage, date, responsable, magasin, OF, validation, consommation retenue.',
          'Le bloc de la décision : ce qu’elle a enregistré, ligne par ligne.',
          'Les onglets : l’étage avant / après, les validations, le journal.',
        ],
      },
      {
        titre: 'Dévalider ou annuler la dernière décision de l’étage',
        etapes: [
          '« Dévalider » ou « Annuler » en tête (seulement sur la dernière décision de l’étage).',
          'Lisez l’état auquel l’étage reviendra et les mouvements annulés, écrivez la raison, confirmez.',
        ],
        resultat: 'Dévalidée, la fiche revient en brouillon pour être corrigée et revalidée ; annulée, elle est close.',
      },
    ],
    champs: [
      {
        nom: 'Étage',
        description: 'Brouillon repris : l’étage de la fiche, qui peut changer (erreur d’emplacement). Journal : l’étage de l’événement.',
      },
      {
        nom: 'Statut',
        description: 'Validée ou Annulée, et « dernière décision de l’étage » quand elle seule peut se retirer. Validations : Active, Dévalidée ou Annulée.',
      },
      { nom: 'Machine · étage', description: 'La machine et l’étage de la fiche.' },
      { nom: 'Date de la fiche', description: 'La date du fait.' },
      { nom: 'Ordre de fabrication', description: 'Le numéro d’OF que la fiche garde pour l’historique quand toutes ses lignes servaient le même ; « — » sinon. L’OF de chaque ligne est dans la décision.' },
      { nom: 'Validée le', description: 'L’instant de la validation active, et son auteur.' },
      { nom: 'Consommation retenue', description: 'La somme des écarts « consommation » des lignes de la décision.', valeurs: 'kg' },
      { nom: 'Motif d’annulation', description: 'La raison donnée à l’annulation de la fiche.' },
      { nom: 'Référence', description: 'Avant / après : la désignation de la ligne.' },
      { nom: 'Bobines', description: 'Avant / après : le nombre de bobines de la ligne.' },
      { nom: '%', description: 'Avant / après : le remplissage moyen de la ligne.' },
      { nom: 'Kg', description: 'Avant / après : les kilos de la ligne.' },
      { nom: 'N°', description: 'Le numéro de la validation : une fiche dévalidée puis revalidée en compte plusieurs.' },
      { nom: 'Le', description: 'L’instant de la validation ou de l’événement du journal.' },
      { nom: 'Par', description: 'Le compte qui a validé, ou qui a fait l’événement.' },
      { nom: 'Retrait', description: 'Quand une validation a été retirée : l’instant, l’auteur et le motif.' },
      { nom: 'Événement', description: 'Validation, dévalidation, annulation ou changement d’étage.' },
      ...CHAMPS_ENTETE,
      ...CHAMPS_GRILLE_BUREAU,
      ...CHAMPS_COMMUNS,
      ...CHAMPS_APERCU,
      ...CHAMPS_TERRAIN,
      ...CHAMPS_AJOUT,
      ...CHAMP_POURQUOI,
    ],
    regles: [
      'Une fiche validée avant le modèle de décisions (05/10/2026) n’a pas de décision à montrer et ne se retire pas.',
      'Quand une décision plus récente s’est appuyée sur celle-ci, l’écran le dit : on la corrige par un constat « Correction » sur l’étage.',
      ...REGLES_RETRAIT,
      ...REGLES_DECISION,
    ],
    messages: [...MESSAGES_RETRAIT, ...MESSAGES_DECISION],
    liens: [
      { route: '/machines', libelle: 'Machines' },
      { route: '/mouvements', libelle: 'Mouvements' },
    ],
  },

  // ------------------------------------------------------------ /parc-machines
  {
    route: '/parc-machines',
    titre: 'Parc machines',
    chemin: 'Paramètres → Parc machines',
    objectif:
      'Déclarer les machines et leurs zones (étages, fil de chaîne, trame, réserve) avec leurs places, corriger leur configuration, et dire pourquoi une machine ne tourne pas : en production, en panne, en sommeil, retirée.',
    droits: 'Lecture du module Paramètres pour voir ; écriture du module Paramètres pour déclarer, configurer, changer l’état ou supprimer.',
    procedures: [
      {
        titre: 'Déclarer une machine',
        etapes: [
          '« Déclarer une machine ».',
          'Saisissez le code et le nom ; la largeur en mètres si elle est connue.',
          'Indiquez les bobines de chaque zone ; « + Étage » ajoute un étage, les boutons « + Fil de chaîne », « + Trame », « + Réserve » la zone qui manque.',
          '« Déclarer la machine ».',
        ],
        resultat: 'La machine paraît dans le parc et dans Stock → Machines, prête à être chargée.',
      },
      {
        titre: 'Configurer une machine',
        etapes: [
          '« Configurer » sur sa ligne : nom, largeur et zones se corrigent ; le code ne change pas.',
          '« Enregistrer » s’active dès qu’une chose a changé.',
        ],
      },
      {
        titre: 'Changer l’état d’une machine',
        etapes: [
          '« État » sur sa ligne, puis l’un des quatre états.',
          'Écrivez le motif (obligatoire sauf pour « En production »).',
          '« Enregistrer l’état ».',
        ],
        resultat: 'L’état et son motif s’affichent dans la liste.',
      },
      {
        titre: 'Supprimer une machine créée par erreur',
        etapes: ['« État », puis « Supprimer définitivement ».'],
        resultat: 'Refusé dès que la machine a porté une fiche : retirez-la du parc à la place, son historique reste.',
      },
    ],
    exemples: [
      {
        titre: 'une machine décrite par ses zones',
        situation: 'Un métier à six étages de 1 344 bobines, une trame de 6 bobines, sur 4,20 m.',
        calcul: [
          ['Étages', '6 × 1 344 = 8 064 bobines'],
          ['Trame', '6 bobines'],
          ['Total', '8 070 bobines'],
        ],
        conclusion: 'Le total se calcule sous vos yeux ; la largeur sert au nombre de bobines d’une voie.',
      },
    ],
    champs: [
      { nom: 'Machine', description: 'Le nom et le code de la machine.' },
      { nom: 'État', description: 'En production, en panne, en sommeil ou retirée du parc, avec le motif dessous.' },
      { nom: 'Zones', description: 'Le nombre de zones, dont les étages (« ét. »), et la largeur de la machine.' },
      { nom: 'Capacité', description: 'Le total des places de toutes les zones.', valeurs: 'bobines' },
      { nom: 'Portées', description: 'Les bobines que la machine porte ; « vide » sinon.', valeurs: 'bobines' },
      { nom: 'Dernier constat', description: 'La date du dernier constat de la machine.' },
      {
        nom: 'Code',
        description: 'Le code court de la machine, en capitales. Il ne change plus après la déclaration : les fiches validées le citent.',
        obligatoire: true,
      },
      { nom: 'Nom', description: 'Le nom de la machine, tel que l’atelier le dit.', obligatoire: true },
      {
        nom: 'Largeur (m)',
        description: 'Facultative. Sert à dire combien de bobines tient une voie : bobines de l’étage ÷ largeur × voie.',
        valeurs: 'm, positive, moins de 1 000',
      },
      { nom: 'Zone', description: 'Étage n, Fil de chaîne, Trame ou Réserve. Les étages se numérotent seuls, à partir de 1.' },
      { nom: 'Bobines', description: 'Les places de la zone.', obligatoire: true, valeurs: 'au moins 1' },
      {
        nom: 'Motif',
        description: 'Pourquoi la machine change d’état (« Rupture courroie… », « Pas de commande… », « Vendue / ferraillée »).',
        obligatoire: true,
        valeurs: 'facultatif pour « En production »',
      },
    ],
    regles: [
      'Une machine porte au moins une zone ; chaque zone au moins une bobine. Une machine sans étage est valide : un métier qui ne file que chaîne et trame se déclare ainsi.',
      'Les étages se suivent à partir de 1, sans trou ; une machine n’a qu’un fil de chaîne, qu’une trame, qu’une réserve.',
      'On ne retire pas une zone qui porte des bobines, et on ne ramène pas ses places sous ce qu’elle porte : déchargez d’abord.',
      'Une zone retirée qui a un passé se désactive ; seule une zone jamais employée s’efface.',
      'Deux corrections simultanées d’une même machine : la seconde est refusée.',
      'Quatre états, pas un interrupteur : une panne appelle un technicien, un sommeil une commande. Le motif est exigé sauf pour un retour en production. Une machine en panne ou en sommeil se décharge comme les autres.',
      'Retirer une machine du parc exige qu’elle soit vide et sans brouillon ; retirée, elle ne porte plus de fiche.',
      'Une machine qui a travaillé ne se supprime pas : elle se retire, son historique reste. « Voir les retirées » les remontre dans la liste.',
    ],
    messages: [
      { message: 'la zone … doit porter au moins une bobine', cause: 'Une zone à 0 place ne se déclare pas : retirez-la de la liste.' },
      { message: 'les étages se suivent à partir de 1 : l’étage … manque', cause: 'Un trou dans la numérotation des étages.' },
      { message: 'une machine ne porte qu’une zone …', cause: 'Deux fils de chaîne, deux trames ou deux réserves.' },
      {
        message: 'la largeur de la machine est en mètres, positive (ex. 4,20)',
        cause: 'Largeur nulle, négative ou de 1 000 m et plus ; laissez-la vide si elle n’est pas connue.',
      },
      { message: '… porte … bobines : déchargez-la avant de la retirer de la machine', cause: 'La zone retirée de la configuration porte encore du fil.' },
      { message: '… porte … bobines et vous la ramenez à … places : déchargez la différence d’abord', cause: 'Les places saisies sont moins nombreuses que les bobines portées.' },
      {
        message: 'dites pourquoi : une machine arrêtée sans motif ne se comprend plus au bout de quelques jours',
        cause: 'Le motif manque pour « En panne », « En sommeil » ou « Retirée du parc ».',
      },
      {
        message: '… porte encore … bobines : déchargez-la avant de la retirer du parc',
        cause: 'Sinon ce fil disparaîtrait des comptes sans qu’aucun magasin le reçoive.',
      },
      { message: '… a encore … fiche(s) en brouillon : annulez-les ou validez-les avant de la retirer du parc', cause: 'Des brouillons restent ouverts sur la machine.' },
      {
        message: '… porte … fiche(s) : elle a travaillé, on ne l’efface pas',
        cause: 'Supprimer est réservé à une machine jamais employée : retirez-la du parc.',
      },
    ],
    liens: [{ route: '/machines', libelle: 'Machines' }],
  },
]
