/**
 * LES EXEMPLES CHIFFRES DE L'AIDE (13/10/2026) — un ou deux par ecran.
 *
 * Ils suivent le « Guide d'utilisation avec exemples » : les memes chiffres
 * d'un ecran a l'autre (la commande de PP-1500 Bleu, le dossier 19/26, le
 * PP FRZ-2900 Grey du plan d'achat), pour qu'on puisse suivre un cas de bout
 * en bout. Ils s'attachent a la fiche de leur ecran par sa route.
 */
import type { Exemple } from './types.ts'

export const EXEMPLES: Record<string, Exemple[]> = {
  /* --------------------------------------------------------- Fiches de base */
  '/catalogue': [
    {
      titre: 'lire un code de référence',
      situation: 'PP-1500 Dtex-Bleu 6666-Hs se lit comme une phrase.',
      calcul: [
        ['Catégorie', 'PP (polypropylène)'],
        ['Famille', '1500 Dtex'],
        ['Couleur', 'Bleu'],
        ['Référence du fournisseur', '6666'],
        ['Fournisseur', 'Hs (HASIRCI)'],
      ],
      conclusion: 'Le code ne se modifie plus après création : tout le reste le cite.',
    },
    {
      titre: 'les unités se convertissent en kilos',
      situation: 'Référence à 2,5 kg la bobine et 192 bobines la palette.',
      calcul: [
        ['474 bobines', '474 × 2,5 = 1 185 kg'],
        ['2 palettes', '2 × 192 × 2,5 = 960 kg'],
        ['1 230,25 kg', '1 230,25 kg'],
      ],
      conclusion: 'Sans poids de bobine, une saisie en bobines est refusée : aucun facteur n’est deviné.',
    },
  ],
  '/referentiels': [
    {
      titre: 'un type de frais d’import',
      situation: 'Type « Transit », catégorie TRANSIT, inclus dans le coût, réparti au poids.',
      conclusion: 'Chaque frais de ce type sera proposé au prorata du poids ; la répartition reste modifiable sur le dossier.',
    },
  ],
  '/equivalences': [
    {
      titre: 'deux sources pour un même fil',
      situation: 'PP-1500 Grey chez HASIRCI et le même titrage chez un second fournisseur, dans un groupe.',
      calcul: [
        ['Sources comptées par le plan d’achat', '2'],
        ['Deux références du même fournisseur', 'comptent pour 1 source'],
      ],
      conclusion: 'Avec deux sources, la ligne du plan d’achat n’est plus « mono-source ».',
    },
  ],
  '/couleurs': [
    {
      titre: 'une couleur, un code par fournisseur',
      situation: 'La couleur interne « Bleu » s’appelle 6666 chez HASIRCI et B-210 chez un autre fournisseur.',
      conclusion: 'C’est le code du fournisseur qui part sur son bon de commande imprimé.',
    },
  ],
  '/fournisseurs': [
    {
      titre: 'ce que les réglages changent',
      situation: 'HASIRCI : USD, délai 65 jours, tolérance de pesée 2 %.',
      calcul: [
        ['Devise USD', 'prix en USD, convertis au cours BAM'],
        ['Délai 65 jours', 'commande 65 jours avant le besoin'],
        ['Tolérance 2 % sur 1 000 kg', 'jusqu’à 1 020 kg sans dérogation'],
      ],
    },
  ],

  /* ------------------------------------------------------------- Production */
  '/plans': [
    {
      titre: 'du plan aux besoins',
      situation: 'Plan : 10 000 m² de Shaggy en novembre, passé en service.',
      conclusion: 'Les besoins (MRP) en déduisent 11 340 kg de Grey, 7 560 kg de Beige… Un brouillon ne compte pas.',
    },
  ],
  '/besoins': [
    {
      titre: 'un besoin brut',
      situation: 'Le plan en service réclame 11 340 kg de PP-1500 Grey.',
      calcul: [['Besoin brut affiché', '11 340 kg']],
      conclusion: 'Ce n’est pas une commande : le stock et les bons en cours sont retirés au plan d’achat.',
    },
  ],

  /* --------------------------------------------------------- Planification */
  '/plan-achat': [
    {
      titre: 'PP FRZ-2900 Dtex-Grey 10575-Hs',
      situation: 'HASIRCI, délai 65 jours, couverture 60 jours, aucun stock, aucun bon en cours.',
      calcul: [
        ['Stock + machine + bons à l’heure', '0 kg'],
        ['− Demande pendant le délai', '6 919 kg'],
        ['= Stock projeté à l’arrivée', '−6 919 → compté 0'],
        ['Sorties de la couverture', '6 703 kg'],
        ['+ Sécurité', '3 351 kg'],
        ['= À commander', '10 054 kg (14 palettes)'],
        ['Montant', '10 054 × 2,670 USD = 26 844 USD = 244 634 MAD'],
      ],
      conclusion:
        'TIER 1 (rupture), mono-source : « Commander et qualifier une seconde source ». Les 6 919 kg consommés avant l’arrivée ne sont pas couverts.',
    },
  ],
  '/stock': [
    {
      titre: 'le projeté, pas le physique',
      calcul: [
        ['Physique', '1 200 kg'],
        ['+ En-cours', '2 000 kg'],
        ['− Besoins de l’horizon', '4 500 kg'],
        ['= Projeté', '−1 300 kg → Rupture'],
      ],
      conclusion: 'Une couverture d’un mois pour un délai de deux mois est le vrai signal.',
    },
  ],

  /* ---------------------------------------------------------------- Achats */
  '/bons-commande': [
    {
      titre: 'le solde d’un bon',
      situation: 'Bon de 1 000 kg de PP-1500 Bleu ; une réception de 1 012 kg (tolérance 2 %).',
      conclusion: 'La ligne est servie, le bon se solde. Une ligne de transport sans référence ne compte pas dans le solde.',
    },
  ],
  '/receptions/:id': [
    {
      titre: 'pesée et tolérance',
      situation: '1 000 kg attendus, tolérance 2 %.',
      calcul: [
        ['1 012 kg pesés', 'acceptés, ligne soldée'],
        ['1 035 kg pesés', 'dérogation motivée exigée'],
        ['990 kg pesés', 'ligne soldée (manque dans la tolérance)'],
        ['900 kg pesés', 'reliquat de 100 kg'],
      ],
    },
    {
      titre: 'clôture avec la facture',
      situation: 'Entrée provisoire 1 012 kg × 24,267 = 24 558,20 MAD ; facture 24 765,00 MAD ; 300 kg déjà sortis.',
      calcul: [
        ['Différence', '+206,80 MAD'],
        ['Au CMUP (712 kg en stock)', '206,80 × 712 ÷ 1 012 = 145,50 MAD'],
        ['En écart de prix (300 kg sortis)', '61,30 MAD'],
      ],
      conclusion: 'Clôturée, la réception ne se dévalide plus : on corrige par un avoir ou une facture complémentaire.',
    },
  ],

  /* ----------------------------------------------------------- Importation */
  '/import/assistant': [
    {
      titre: 'un dossier depuis le scan',
      situation: 'Liasse PDF : facture, connaissement, DUM. Le numéro est laissé vide.',
      conclusion: 'L’outil donne le rang suivant de l’année (ex. 19/26) et dépose les documents dans le dossier.',
    },
  ],
  '/retours-fournisseur': [
    {
      titre: 'rendre moins cher que le CMUP',
      situation: '3 010 kg de A à 20,95 MAD ; on rend 500 kg au prix convenu de 18,00 MAD.',
      calcul: [
        ['Avoir', '500 × 18,00 = 9 000,00 MAD'],
        ['Valeur restante', '63 059,50 − 9 000,00 = 54 059,50 MAD'],
        ['Nouveau CMUP', '54 059,50 ÷ 2 510 = 21,54 MAD/kg'],
      ],
      conclusion: 'Rendu plus cher que le stock ne vaut : le CMUP s’arrête à zéro, le reste va au journal des écarts.',
    },
  ],

  /* ----------------------------------------------------------------- Stock */
  '/mouvements': [
    {
      titre: 'qui peut saisir quoi',
      calcul: [
        ['Déchet de 20 kg', 'magasinier'],
        ['Déchet au-delà de 50 kg le même jour', 'droit de valider l’inventaire'],
        ['Ajustement de −5 kg', 'droit de valider l’inventaire'],
        ['Contre-passation', 'Direction, avec un motif'],
      ],
      conclusion: 'Un mouvement validé ne se corrige pas : son inverse est posté, les deux restent.',
    },
  ],
  '/transferts': [
    {
      titre: 'du fil en route',
      situation: '120,5 kg de Morocco vers Polyfashions.',
      calcul: [
        ['À l’expédition', 'Morocco −120,5 kg, en route +120,5 kg'],
        ['À la réception', 'en route −120,5 kg, Polyfashions +120,5 kg'],
      ],
      conclusion: 'En route, le fil compte dans la valeur et dans les besoins.',
    },
  ],
  '/transferts/nouveau': [
    {
      titre: 'le disponible du magasin source',
      situation: 'Morocco porte 300 kg de la référence ; on tente d’en transférer 350.',
      conclusion: 'Refusé : le disponible est celui du seul magasin source, jamais la somme des magasins.',
    },
  ],
  '/machines': [
    {
      titre: 'charger puis constater',
      calcul: [
        ['Chargement : 600 bobines de 2,5 kg à 100 %', '1 500 kg sortent du magasin'],
        ['Constat : 600 bobines à 60 %', 'étage à 900 kg'],
        ['Écart', '1 500 + 0 − 0 − 900 = 600 kg, motif consommation'],
      ],
      conclusion: 'Seule la dernière décision d’un étage se défait.',
    },
  ],
  '/parc-machines': [
    {
      titre: 'retirer une machine',
      situation: 'Une machine qui a travaillé ne se supprime pas.',
      conclusion: 'On la vide, puis on la passe « retirée » : son historique reste.',
    },
  ],
  '/inventaires': [
    {
      titre: 'un écart de comptage',
      calcul: [
        ['Théorique', '1 200,00 kg'],
        ['Compté', '1 197,75 kg'],
        ['Écart', '−2,25 kg, motif « bobine abîmée au quai »'],
      ],
      conclusion: 'Le magasinier compte et enregistre ; un autre compte valide ; la clôture passe l’écart en ajustement au CMUP.',
    },
    {
      titre: 'renvoyer au comptage',
      situation: 'INV-2026-0004 est validé, mais l’allée 3 a été comptée deux fois.',
      calcul: [
        ['Validé', 'comptage figé, stock intact'],
        ['Renvoyer au comptage', 'motif « recompter l’allée 3 » → brouillon'],
        ['Recompté puis revalidé', 'par un autre compte que le compteur'],
      ],
      conclusion: 'Tant qu’il n’est pas clôturé, rien n’a touché le stock.',
    },
  ],
  '/lots': [
    {
      titre: 'Projet ou Restes',
      situation: 'Seuil de l’article : 1 344 bobines (un étage de machine).',
      calcul: [
        ['Lot de 1 500 bobines', 'Projet : le plan d’achat compte dessus'],
        ['Lot de 200 bobines', 'Restes : le plan d’achat ne le compte plus'],
      ],
    },
  ],
  '/lots/fiche': [
    {
      titre: 'suivre un bain',
      situation: 'Lot LOT-E2E-1 : entré par une réception, 120,5 kg transférés, 600 bobines chargées.',
      conclusion: 'La fiche liste ces événements dans l’ordre et s’imprime pour la traçabilité.',
    },
  ],
  '/autorisations': [
    {
      titre: 'une dérogation de lot bloqué',
      situation: 'Le chargement d’un lot bloqué est refusé ; la demande part depuis la fiche.',
      conclusion: 'Accordée par un autre responsable, elle sert une fois, pour ce lot et cette fiche.',
    },
  ],

  /* ------------------------------------------------- Analyses et finance */
  '/valorisation': [
    {
      titre: 'le CMUP',
      calcul: [
        ['Stock', '500 kg à 23,00 MAD'],
        ['Entrée', '1 012 kg à 24,267 MAD'],
        ['CMUP', '(11 500,00 + 24 558,20) ÷ 1 512 = 23,848 MAD/kg'],
        ['Sortie de 300 kg', '300 × 23,848 = 7 154,40 MAD ; CMUP inchangé'],
      ],
    },
  ],
  '/classification': [
    {
      titre: 'lire « AY »',
      calcul: [
        ['A', 'dans les 80 premiers % de la valeur consommée'],
        ['Y', 'consommation variable (25 % à 50 %)'],
      ],
      conclusion: 'Une référence AY se suit de près ; deux sources si possible.',
    },
  ],
  '/historique-prix': [
    {
      titre: 'le prix payé à chaque réception',
      situation: 'PP-1500 Bleu : 24,267 MAD/kg à la réception du 13/10.',
      conclusion: 'Chaque réception validée ajoute un point ; une hausse se voit avant la facture suivante.',
    },
  ],
  '/statistiques': [
    {
      titre: 'un volet par module',
      situation: 'Le magasinier ne voit pas le volet des prix.',
      conclusion: 'Les chiffres sont calculés à la lecture, sur les données du jour.',
    },
  ],
  '/tableau-de-bord': [
    {
      titre: 'une tuile mène à sa liste',
      situation: 'La tuile « Réceptions à contrôler » affiche 3.',
      conclusion: 'Un clic ouvre ces 3 réceptions, locales et import comptées ensemble.',
    },
  ],

  /* ---------------------------------------------- Paramètres et sécurité */
  '/configuration': [
    {
      titre: 'un seuil réglé',
      situation: 'P_TolerEcartPesee passe de 2 % à 3 %.',
      conclusion: 'Sur 1 000 kg attendus, 1 030 kg passent alors sans dérogation. La modification est journalisée.',
    },
  ],
  '/utilisateurs': [
    {
      titre: 'masquer un champ',
      situation: 'Pour le magasinier, le CMUP est « masqué ».',
      conclusion: 'Le serveur ne l’envoie pas : il n’apparaît ni à l’écran, ni à l’impression, ni à l’export.',
    },
  ],
  '/audit': [
    {
      titre: 'retrouver une valeur',
      situation: 'Un frais de 2 300 MAD a été corrigé à 2 500 MAD.',
      calcul: [
        ['Qui, quand', 'le compte et l’heure'],
        ['Avant / après', '2 300,00 → 2 500,00'],
      ],
      conclusion: 'Le journal ne s’efface pas ; une suppression y garde l’enregistrement entier.',
    },
  ],
  '/controles': [
    {
      titre: 'un contrôle en anomalie',
      situation: 'C11 compare le stock affiché au grand livre des mouvements.',
      conclusion: 'C11 doit rester à zéro ; s’il ne l’est pas, il se traite avant tout le reste.',
    },
  ],
  '/telecharger': [
    {
      titre: 'installer sur un téléphone',
      situation: 'Installer une fois le certificat interne, puis Chrome → ⋮ → « Installer l’application ».',
      conclusion: 'L’application se met à jour seule à chaque nouvelle version du serveur.',
    },
  ],
}
