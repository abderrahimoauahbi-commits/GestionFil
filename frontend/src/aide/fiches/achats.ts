/**
 * FICHES D'AIDE — ACHATS : BONS DE COMMANDE, FACTURES ET RETOURS FOURNISSEUR.
 *
 * Une partie du catalogue : `../contenu.ts` les assemble, `../types.ts` donne
 * la forme d'une fiche. Chaque `champs[].nom` est l'intitulé EXACT de l'écran :
 * c'est par lui que l'indice ⓘ se pose à côté du champ (`../indice.ts`).
 *
 * Relu sur le code le 27/10/2026 : BonsCommande.tsx, BonCommandeNouveau.tsx,
 * BonCommande.tsx, composants/GrilleLignes.tsx (+ GrilleLignesMobile.tsx),
 * TotauxCommande.tsx, FacturesFournisseur.tsx, FactureFournisseur.tsx,
 * pages/retours/*. L'écran des écarts de prix vit dans /landed-cost (fiche
 * de l'importation).
 */
import type { Sujet } from '../types.ts'

/** Les intitulés du prix de la grille, qui suivent la devise du bon. */
const PRIX_GRILLE = ['Prix MAD', 'Prix EUR', 'Prix USD', 'Prix MAD / kg', 'Prix EUR / kg', 'Prix USD / kg']

export const FICHES_ACHATS: Sujet[] = [
  /* ------------------------------------------------------------------ */
  /* BONS DE COMMANDE — LA LISTE                                         */
  /* ------------------------------------------------------------------ */
  {
    route: '/bons-commande',
    titre: 'Bons de commande',
    chemin: 'Achats → Bons de commande',
    objectif:
      'Retrouver chaque bon, voir où il en est dans son circuit (contrôle, demande de prix, validation, envoi) et ce que les réceptions en ont déjà livré.',
    droits:
      'Module Bons de commande. LIRE pour la liste ; ÉCRIRE pour créer un bon, supprimer un brouillon ou annuler un bon qui n’engage pas encore (au contrôle, en demande de prix, en attente de validation) ; VALIDER pour annuler un bon validé, envoyé ou livré en partie.',
    procedures: [
      {
        titre: 'Retrouver et ouvrir un bon',
        etapes: [
          'Tapez un numéro, un fournisseur ou un statut dans la recherche, ou filtrez les colonnes « N° BC », « Fournisseur », « Statut » et l’état de livraison.',
          'Cliquez sur la ligne (ou sur l’icône document) pour ouvrir le bon ; l’icône imprimante ouvre le bon imprimé.',
          'Arrivé depuis une tuile du tableau de bord, la liste est déjà filtrée sur un statut : « Tous les bons » retire le filtre.',
        ],
      },
      {
        titre: 'Créer un bon',
        etapes: ['Bouton « + » en haut à droite : l’écran « Nouveau bon de commande » s’ouvre.'],
        resultat: 'Le bon naît en brouillon ; rien n’est engagé avant sa validation.',
      },
      {
        titre: 'Se défaire d’un bon',
        etapes: [
          'Icône corbeille au bout de la ligne.',
          'Un brouillon se SUPPRIME définitivement : il n’engageait rien, ses propositions d’achat reviennent au plan.',
          'Un bon au contrôle, en demande de prix ou en attente de validation s’ANNULE (droit d’écriture).',
          'Un bon validé, envoyé ou livré en partie s’annule aussi, mais avec le droit de valider : il a engagé l’entreprise.',
        ],
        resultat:
          'Un bon annulé reste visible, marqué « Annulé » ; ses lignes sont annulées et les propositions d’achat qui les ont produites reviennent au plan.',
      },
    ],
    champs: [
      { nom: 'N° BC', description: 'Le numéro du bon, avec sa date d’émission dessous.' },
      { nom: 'Fournisseur', description: 'Le nom du fournisseur, avec son code dessous.' },
      {
        nom: 'Statut',
        description: 'Où le bon en est dans son circuit.',
        valeurs:
          'Brouillon · Au contrôle · Demande de prix · En attente de validation · Validé · Envoyé · Livré en partie · Clôturé · Annulé',
      },
      {
        nom: 'Livraison',
        description:
          'Deux colonnes portent ce titre : la première donne la date de livraison prévue ; la seconde, l’état de la livraison, distinct du statut — un bon envoyé peut déjà être en retard sur cette date.',
        valeurs: 'Attendu · Partiel · Partiel en retard · En retard · Complet ; « — » quand la question ne se pose pas',
      },
      { nom: 'Lignes', description: 'Le nombre de lignes du bon.' },
      { nom: 'Montant devise', description: 'Le total du bon dans la devise du fournisseur, net de remise.' },
      { nom: 'Montant MAD', description: 'Le même total en dirhams, au taux engagé du bon.' },
      { nom: 'Validation', description: 'La date de validation et, dessous, le compte qui a validé.' },
      {
        nom: '% livre',
        description:
          'Les kilos reçus sur les kilos commandés, avec le reste à livrer dessous. Calculé depuis les lignes, il ne peut pas diverger des réceptions. « — » tant que le bon n’est pas validé, ou s’il est annulé.',
      },
    ],
    regles: [
      'Seul un BROUILLON se supprime. Dès qu’un bon a été validé — même dévalidé ensuite — il ne se supprime plus : il s’annule, et la trace reste.',
      'Un bon auquel une réception se rattache ne se supprime pas : il a servi.',
      'Une ligne reçue à au moins « commandé × (1 − tolérance du fournisseur) » est soldée ; un bon dont toutes les lignes de marchandise sont soldées passe en « Clôturé » de lui-même. Les lignes de prestation ou sans référence ne se réceptionnent pas et n’entrent pas dans ce décompte.',
      'Pas d’indicateurs en tête de liste : ils vivent au tableau de bord.',
    ],
    messages: [
      {
        message: '… reception(s) se rattachent a ce bon : il a servi, il ne se supprime pas.',
        cause: 'Une réception cite ce bon. Annulez-le au lieu de le supprimer.',
      },
      {
        message: 'ce bon est … : il a engage l’entreprise et ne se supprime plus. Annulez-le — la trace restera.',
        cause: 'Le bon n’est plus un brouillon : seule l’annulation reste possible.',
      },
      {
        message: 'Ce bon a deja ete valide puis devalide : il a engage l’entreprise et ne se supprime plus.',
        cause: 'Revenu en brouillon par une dévalidation, il garde la trace de son engagement : annulez-le.',
      },
    ],
    liens: [
      { route: '/bons-commande/nouveau', libelle: 'Nouveau bon de commande' },
      { route: '/plan-achat', libelle: 'Plans d’achat' },
      { route: '/receptions', libelle: 'Réceptions' },
    ],
  },

  /* ------------------------------------------------------------------ */
  /* NOUVEAU BON DE COMMANDE                                             */
  /* ------------------------------------------------------------------ */
  {
    route: '/bons-commande/nouveau',
    titre: 'Nouveau bon de commande',
    chemin: 'Achats → Bons de commande → +',
    objectif:
      'Composer une commande chez un fournisseur — ce que le plan d’achat lui réclame, ce qu’on prend au catalogue, et ce qui n’a pas de référence — et la créer en brouillon d’un seul geste.',
    prerequis: [
      'Le fournisseur existe et est actif (la recherche ne propose que les fournisseurs actifs).',
      'Pour saisir en palettes ou en bobines, la référence porte son poids de bobine et ses bobines par palette.',
    ],
    droits: 'Module Bons de commande, droit ÉCRIRE (le bouton « Créer le bon » reste éteint sans lui).',
    procedures: [
      {
        titre: 'Saisir une commande',
        etapes: [
          'Tapez le fournisseur et retenez-le : la devise de sa fiche se pose, et la grille s’ouvre sur une ligne vide.',
          'Vérifiez la date du bon, posez la livraison prévue si elle est connue, la devise si elle diffère, le motif.',
          'Dans la cellule « Notre référence », tapez : la liste propose « Du plan d’achat » (ce que le plan réclame chez ce fournisseur, avec la quantité proposée) ou « Tout le catalogue » (deux caractères au moins).',
          'Retenue, la référence remplit la ligne : quantité proposée par le plan, prix proposé, unité de commande, palettes et bobines.',
          'Corrigez la quantité en kilos, ou tapez les palettes ou les bobines : les trois se répondent. Le petit maillon les détache pour saisir un colisage qui s’écarte de la théorie.',
          'Ajustez « Unité au bon » (ce que le fournisseur lira), le prix au kilo, la remise, et au besoin la référence fournisseur, la couleur ou le code couleur.',
          '« Ajouter une ligne » pour l’article suivant.',
          'Relisez les totaux (poids, palettes, bobines, brut, remise, net HT) et la barre du bas, puis « Créer le bon ».',
        ],
        resultat:
          'Le bon est créé en brouillon, en une seule transaction (numéro et lignes ensemble), et l’écran du bon s’ouvre. Rien n’est engagé : il reste à l’envoyer au contrôle.',
      },
      {
        titre: 'Commander ce qui n’a pas de référence',
        etapes: [
          'Tapez ce que vous cherchez dans « Notre référence ».',
          'Si rien ne correspond : « Chercher dans tout le catalogue » (en mode plan), « Ajouter au catalogue », ou « Garder « … » sans référence ».',
          '« Ajouter au catalogue » rappelle que la fiche se crée à l’écran Catalogue (bouton « Ouvrir le catalogue », dans un autre onglet) ; revenez ensuite, la référence se trouve à la frappe.',
          '« Garder « … » sans référence » fait une ligne libre, marquée « hors catalogue » : unité Forfait, quantité 1, à vous de poser le prix.',
        ],
        resultat:
          'La commande accepte un échantillon, un type nouveau ou un transport sans forcer à créer une référence qu’on ne rachètera pas.',
      },
    ],
    champs: [
      {
        nom: 'Fournisseur',
        description:
          'Chez qui l’on commande ; il se cherche en tapant. LE CHANGER VIDE LA GRILLE : la devise, les prix et les propositions du plan en dépendent.',
        obligatoire: true,
      },
      { nom: 'Date du bon', description: 'La date d’émission de la commande.', obligatoire: true, defaut: 'aujourd’hui' },
      {
        nom: 'Livraison prévue',
        description: 'La date d’arrivée attendue : c’est sur elle que l’état de livraison dit « en retard ».',
      },
      { nom: 'Observations', description: 'Une note libre sur le bon.' },
      {
        nom: 'Devise',
        description:
          'La devise du bon, choisie seulement une fois le fournisseur retenu. Le taux n’est pas engagé ici : il l’est à la validation, au cours du jour.',
        defaut: 'celle de la fiche fournisseur (MAD sinon)',
      },
      {
        nom: 'Motif',
        description: 'Pourquoi cette commande existe ; il est enregistré sur le bon.',
        valeurs: 'Issu du MRP · Manuel · Opportunite de prix · Anticipation de risque',
        defaut: 'Issu du MRP',
      },
      {
        nom: 'Du plan d’achat',
        alias: ['Tout le catalogue'],
        description:
          'L’interrupteur au-dessus de la grille : ce que la liste de « Notre référence » propose. « Du plan d’achat » ne montre que ce que le plan réclame chez CE fournisseur ; « Tout le catalogue » ouvre à tout — le rattachement d’une référence à un fournisseur est une habitude d’achat, pas une exclusivité.',
        defaut: 'Du plan d’achat',
      },
      {
        nom: 'Notre référence',
        alias: ['Référence'],
        description:
          'Le code interne de l’article, cherché dans la cellule même (Flèches pour parcourir, Entrée pour retenir). Une référence habituellement achetée ailleurs le signale ; une référence déjà sur le bon s’ajoute à sa ligne. « changer » rouvre la recherche.',
        obligatoire: true,
        valeurs: 'Une référence du catalogue, ou un libellé libre pour une ligne sans référence.',
      },
      {
        nom: 'Unité au bon',
        alias: ['Unité'],
        description:
          'Comment la ligne s’exprime sur le bon : ce que le fournisseur lira et la base sur laquelle il facturera. La changer ne touche à aucun chiffre ; la conversion se fait à l’envoi.',
        valeurs:
          'kg, et les unités que la référence sait convertir (Bobine, Palette, Lot, ml) ; Forfait, Unite ou Heure pour une ligne sans référence',
        defaut: 'la plus grosse unité que la référence sait convertir : Lot, sinon Palette, sinon Bobine, sinon kg',
      },
      {
        nom: 'Qté (kg)',
        alias: ['Quantité (kg)', 'Quantité'],
        description:
          'Pour une marchandise, TOUJOURS des kilos, quelle que soit l’unité au bon ; dessous, l’équivalent dans l’unité au bon (« non convertible » si la référence n’a pas le facteur). Pour une ligne sans référence, la quantité dans son unité. Un écart avec la quantité proposée par le plan est signalé, pas interdit.',
        obligatoire: true,
        valeurs: 'kg, plus de 0',
        defaut: 'la quantité proposée par le plan',
      },
      {
        nom: 'Pal. · bob.',
        alias: ['Palettes / bobines'],
        description:
          'Le nombre de palettes et de bobines. Liés (maillon), les trois champs se répondent : taper des palettes remplit les bobines et les kilos, et l’inverse. Détachés, chacun se saisit seul — une palette entamée, un reliquat.',
        valeurs: 'Il faut que la référence porte son poids de bobine et ses bobines par palette.',
      },
      {
        nom: 'Remise %',
        description: 'La remise du fournisseur, en % du prix brut. Le prix reste brut ; le total de la ligne est net.',
        valeurs: '0 à 99,99',
      },
      {
        nom: 'Réf. frs',
        alias: ['Réf. fournisseur'],
        description:
          'Le code de l’article chez le fournisseur. Corrigé ici, il est écrit sur la fiche de la référence à la sortie du champ : le bon suivant le trouvera.',
      },
      {
        nom: 'Couleur',
        description: 'La couleur de l’article. Corrigée ici, elle remonte à la fiche de la référence, comme la réf. fournisseur.',
      },
      {
        nom: 'Code coul. frs',
        alias: ['Code couleur frs'],
        description:
          'Le code que CE fournisseur donne à la teinte : c’est lui qui part sur le bon imprimé (COLOR CODE). Corrigé ici, il remonte à la fiche de la référence.',
      },
      {
        nom: 'Prix',
        alias: PRIX_GRILLE,
        description:
          'Le prix brut DANS LA DEVISE DU BON (l’en-tête la rappelle), AU KILO pour une marchandise, à l’unité pour une ligne sans référence. Proposé par le plan ou le catalogue, toujours corrigeable : c’est le prix négocié qui fait foi.',
        obligatoire: true,
        valeurs: 'plus de 0, jusqu’à 4 décimales',
      },
      { nom: 'Total', alias: ['Total ligne'], description: 'Quantité × prix, moins la remise. Il ne se saisit pas.' },
      { nom: 'Poids commandé', description: 'La somme des kilos des lignes prêtes.' },
      { nom: 'Palettes', description: 'La somme des palettes des lignes prêtes.' },
      { nom: 'Bobines', description: 'La somme des bobines des lignes prêtes.' },
      { nom: 'Montant brut', description: 'La somme des lignes avant remise, chacune arrondie au centime.' },
      { nom: 'Remise', description: 'Ce que les remises retirent du brut.' },
      {
        nom: 'Net HT',
        description:
          'Le total du bon, dans sa devise. Pas d’équivalent en dirhams ici : le taux n’est engagé qu’à la validation.',
      },
    ],
    regles: [
      'LA GRILLE S’OUVRE SUR UNE LIGNE VIDE : le plan propose dans la liste déroulante, il ne remplit pas le bon à votre place. (Arrivé par « Commander » sur une référence, sa ligne est déjà posée.)',
      'UNE LIGNE PAR RÉFÉRENCE : une référence saisie deux fois part en une seule ligne, quantités additionnées ; le prix et la remise de la première font foi.',
      'Les cases facultatives (Pal. · bob., Remise %, Réf. frs, Couleur, Code coul. frs) se placent sur la rangée de la ligne tant qu’elles y tiennent ; les autres passent sur la rangée « ↳ » juste dessous, chacune avec son titre. Sur téléphone, chaque ligne s’ouvre en fiche plein écran avec les mêmes champs.',
      'Sous la ligne, un avis signale des kilos, bobines et palettes qui se contredisent avec le conditionnement de la référence : il n’empêche rien.',
      'Une ligne sans référence ne se convertit pas, ne se réceptionne pas, n’entre jamais en stock et ne compte dans aucune statistique par référence.',
      'Une ligne commencée mais incomplète (intitulé, quantité ou prix) bloque « Créer le bon ». Le prix n’est jamais deviné.',
      'Quitter l’écran avec des lignes saisies demande confirmation.',
    ],
    messages: [
      {
        message: 'conversion impossible sur … : renseignez le conditionnement sur la référence, ou commandez en kg',
        cause:
          'L’unité au bon est en palettes, bobines ou lot, mais la référence n’a pas le facteur correspondant. Complétez sa fiche, ou remettez l’unité au bon en kg.',
      },
      {
        message: '… ligne(s) incomplète(s) : intitulé, quantité ou prix',
        cause: 'Une ligne commencée n’a pas tout ce qu’il faut pour partir. Complétez-la ou retirez-la (corbeille).',
      },
      {
        message: 'R-PROP : la proposition d’achat de … est deja commandee dans … (bon cree par …). Ouvrez ce bon plutot que d’en faire un second.',
        cause: 'La proposition du plan qui a amené cette ligne est déjà servie par un autre bon.',
      },
    ],
    liens: [
      { route: '/plan-achat', libelle: 'Plans d’achat' },
      { route: '/catalogue', libelle: 'Catalogue' },
      { route: '/catalogue/completer', libelle: 'Compléter les références' },
      { route: '/bons-commande', libelle: 'Bons de commande' },
    ],
  },

  /* ------------------------------------------------------------------ */
  /* LE BON DE COMMANDE — DOCUMENT ET CIRCUIT                            */
  /* ------------------------------------------------------------------ */
  {
    route: '/bons-commande/:id',
    titre: 'Bon de commande',
    chemin: 'Achats → Bons de commande → (ouvrir un bon)',
    objectif:
      'Corriger le bon tant qu’il est en brouillon, puis le faire passer par son circuit — contrôle, demande de prix, validation, envoi — et suivre ce que les réceptions en livrent.',
    prerequis: ['Le bon existe (créé à la main ou depuis le plan d’achat).'],
    droits:
      'Module Bons de commande. ÉCRIRE : corriger le brouillon, l’envoyer au contrôle, contrôler, saisir la réponse du fournisseur, soumettre à validation, renvoyer en brouillon, annuler avant validation, envoyer au fournisseur, supprimer le brouillon. VALIDER : valider, dans la limite du plafond de validation du compte. Dévalider : ADMIN ou DIRECTION.',
    procedures: [
      {
        titre: 'Corriger un brouillon',
        etapes: [
          'En brouillon, les lignes s’affichent dans la grille de saisie, déjà validées (figées) : le crayon d’une ligne la rouvre.',
          'Corrigez l’en-tête et les lignes comme à la création ; « Ajouter une ligne » pour une de plus, la corbeille pour en retirer une.',
          'Validez chaque ligne retouchée ou ajoutée avec son bouton ✓ : rien n’est encore écrit.',
          '« Enregistrer » (barre du bas) écrit l’en-tête et toutes les lignes ensemble ; « Annuler les modifications » revient à ce qui est en base.',
        ],
        resultat: 'Le bon est à jour en base, toujours en brouillon.',
      },
      {
        titre: 'Envoyer au contrôle, puis contrôler',
        etapes: [
          '« Envoyer au contrôle » : possible dès que le bon a une ligne et que tout est enregistré. Le bon se fige.',
          'Un AUTRE compte que le créateur (l’ADMIN excepté) vérifie quantités et fournisseur.',
          'Puis, au choix : « Contrôlé : demande de prix », ou « Sauter la demande de prix » avec un motif (prix sous contrat, achat local…), ou « Renvoyer en brouillon » avec un motif qui dit quoi corriger.',
        ],
        resultat: 'Le bon passe en demande de prix, en attente de validation, ou revient en brouillon (le motif s’affiche en tête).',
      },
      {
        titre: 'Demande de prix',
        etapes: [
          '« Imprimer la demande de prix » donne le document pour le fournisseur.',
          'Dans « Réponse du fournisseur », saisissez par ligne le prix confirmé et la remise ; l’écart avec le prix d’avant se calcule.',
          '« Enregistrer la réponse », puis « Soumettre à validation ».',
        ],
        resultat:
          'Le bon attend sa validation ; la direction voit les écarts de prix (signal C59, jamais un refus). Les quantités et références ne changent qu’en renvoyant le bon en brouillon.',
      },
      {
        titre: 'Valider',
        etapes: [
          'Bouton « Valider », pour qui a le droit de valider, n’est pas le créateur (l’ADMIN excepté) et dont le plafond couvre le montant.',
          'Bon en MAD : il passe validé aussitôt.',
          'Bon en devise : la carte « Valider le bon : le taux engagé » propose le taux de référence du jour. Gardez-le, ou saisissez celui que la banque confirme avec son motif, puis « Valider à ce taux ».',
          'Un taux à plus de 3 % du cours Bank Al-Maghrib demande une confirmation (« Je confirme ce taux »).',
        ],
        resultat:
          'Le bon est validé et engagé : le taux est figé (avec son jour, sa source et son motif), les montants en dirhams en découlent.',
      },
      {
        titre: 'Envoyer au fournisseur et suivre',
        etapes: [
          '« Imprimer » donne le bon pour le fournisseur (un brouillon s’imprime aussi, pour relecture).',
          '« Envoyer au fournisseur » le passe en « Envoyé ».',
          'Les réceptions le font avancer : « Livré en partie », puis « Clôturé » quand toutes ses lignes de marchandise sont soldées. La colonne « Reçu / reste » suit chaque ligne.',
        ],
      },
      {
        titre: 'Revenir en arrière',
        etapes: [
          '« Renvoyer en brouillon » (avec motif) au contrôle, en demande de prix ou en attente de validation.',
          '« Dévalider » (ADMIN, DIRECTION), avec une raison : un bon validé ou envoyé redevient brouillon et repasse par le contrôle — refusé s’il a déjà reçu de la marchandise. Prévenez le fournisseur si le bon lui est parti.',
          '« Annuler le bon » avant validation ; après, depuis la liste, avec le droit de valider.',
          '« Supprimer le brouillon » : seulement un brouillon qui n’a jamais été validé.',
        ],
      },
    ],
    exemples: [
      {
        titre: 'valider un bon en devise',
        situation: '1 000 kg de PP-1500 Bleu à 2,50 USD/kg, soit 2 500,00 USD net. Taux de référence du jour proposé : 9,7068.',
        calcul: [
          ['Gardé tel quel', '2 500,00 × 9,7068 = 24 267,00 MAD engagés'],
          ['10,05 saisi à la place', 'motif obligatoire (cinq caractères au moins)'],
          ['10,05 ÷ 9,7068 − 1', '+3,5 % du cours BAM : au-delà de 3 %, à confirmer'],
          ['Plafond du valideur', 'jugé au plus haut des deux taux'],
        ],
        conclusion: 'Celui qui a créé le bon ne le valide pas — sauf l’ADMIN, par décision de la direction.',
      },
    ],
    champs: [
      {
        nom: 'Fournisseur',
        description: 'Le fournisseur du bon. Non modifiable : la devise, le taux et les prix du bon en découlent.',
      },
      {
        nom: 'Devise',
        description:
          'La devise du bon, modifiable en brouillon. Les prix des lignes ne sont PAS convertis : vérifiez-les dans la nouvelle devise.',
      },
      { nom: 'Date du bon', description: 'La date d’émission ; modifiable en brouillon.' },
      { nom: 'Livraison prévue', description: 'La date d’arrivée attendue ; c’est sur elle que l’état de livraison dit « en retard ».' },
      { nom: 'Conditions de paiement', description: 'Les conditions convenues avec le fournisseur, en clair.' },
      { nom: 'Observations', description: 'Une note libre sur le bon.' },
      {
        nom: 'Mention d’expédition',
        description:
          'Ce que le bon imprimé porte en face de « SHIPMENT DATE ». Vide, c’est la livraison prévue qui part. Elle ne remplace pas cette date pour le suivi.',
      },
      {
        nom: 'Nombre de conteneurs',
        description:
          'Vide, il se calcule : total des palettes ÷ palettes par conteneur du fournisseur. À saisir seulement quand le transitaire en décide autrement.',
      },
      {
        nom: 'Notre référence',
        description:
          'En brouillon, la référence de la ligne, cherchée à la frappe comme à la création (« Du plan d’achat » ou « Tout le catalogue »).',
        obligatoire: true,
      },
      {
        nom: 'Unité au bon',
        alias: ['Unité'],
        description:
          'Comment la ligne s’exprime sur le bon. La changer ne touche à aucun chiffre ; la conversion se fait à l’enregistrement.',
        valeurs: 'kg et les unités que la référence sait convertir ; Forfait, Unite, Heure sans référence',
      },
      {
        nom: 'Qté (kg)',
        alias: ['Quantité (kg)'],
        description:
          'Les kilos commandés (la quantité dans son unité pour une ligne sans référence). Une ligne déjà reçue ne descend pas sous ce qui a été reçu.',
        obligatoire: true,
      },
      {
        nom: 'Pal. · bob.',
        alias: ['Palettes / bobines'],
        description:
          'Palettes et bobines de la ligne. Liés, les trois champs se répondent ; détachés (maillon), chacun se saisit seul. Une ligne dont le colisage enregistré s’écarte du calcul revient détachée.',
      },
      {
        nom: 'Remise %',
        description:
          'La remise du fournisseur, en % du prix brut. En demande de prix, c’est aussi la remise confirmée, saisie dans « Réponse du fournisseur ».',
        valeurs: '0 à moins de 100',
      },
      { nom: 'Réf. frs', alias: ['Réf. fournisseur'], description: 'Le code chez le fournisseur ; corrigé ici, il remonte à la fiche de la référence.' },
      { nom: 'Couleur', description: 'La couleur ; corrigée ici, elle remonte à la fiche de la référence.' },
      {
        nom: 'Code coul. frs',
        alias: ['Code couleur frs'],
        description: 'Le code couleur du fournisseur, imprimé sur le bon ; corrigé ici, il remonte à la fiche de la référence.',
      },
      {
        nom: 'Prix',
        alias: PRIX_GRILLE,
        description: 'En brouillon, le prix brut au kilo dans la devise du bon (à l’unité sans référence), 4 décimales.',
        obligatoire: true,
      },
      { nom: 'Total', alias: ['Total ligne'], description: 'Quantité × prix, moins la remise.' },
      {
        nom: 'Référence',
        description: 'La référence de la ligne et sa désignation ; une ligne sans référence montre son libellé.',
      },
      { nom: 'Commande', description: 'La quantité commandée, dans l’unité au bon.' },
      {
        nom: 'Prix unitaire',
        alias: ['Prix unitaire MAD', 'Prix unitaire EUR', 'Prix unitaire USD'],
        description: 'Le prix par unité au bon, dans la devise du bon (4 décimales).',
      },
      { nom: 'Type', description: 'La catégorie de la référence (ou « Prestation »), avec la couleur dessous.' },
      {
        nom: 'Palettes',
        description:
          'Dans le tableau, les palettes de la ligne et les bobines par palette ; vide sans conditionnement. Dans les totaux, la somme des palettes.',
      },
      {
        nom: 'Montant devise',
        alias: ['Montant EUR', 'Montant USD'],
        description: 'Le montant de la ligne dans la devise du bon, net de remise, au centime.',
      },
      { nom: 'Montant MAD', description: 'Le montant de la ligne en dirhams, au taux engagé du bon.' },
      { nom: 'Reçu / reste', description: 'Les kilos déjà reçus sur la ligne, et le reste à recevoir dessous.' },
      {
        nom: 'Besoin',
        description:
          'Le besoin d’aujourd’hui pour une ligne venue du plan d’achat, et de combien il a bougé depuis la conversion de la proposition en bon. « saisie manuelle » pour une ligne qui ne vient pas du plan.',
      },
      {
        nom: 'Suivi',
        description:
          '« suit le plan » : ligne venue du plan, jamais retouchée ; « arbitree » : l’acheteur y a touché (quantité, prix, date), le recalcul ne la réaligne plus, il alerte seulement.',
      },
      { nom: 'Ligne', description: 'La référence de la ligne et, dessous, la date de la réponse du fournisseur ou « sans réponse ».' },
      { nom: 'Quantité', description: 'Dans « Réponse du fournisseur », la quantité commandée dans l’unité au bon (rappel). Sur téléphone, la quantité d’une ligne sans référence, dans son unité.' },
      { nom: 'Prix d’avant', description: 'Le prix (et la remise) de la ligne avant la demande de prix : la base de l’écart.' },
      {
        nom: 'Prix confirmé',
        alias: ['Prix confirmé MAD', 'Prix confirmé EUR', 'Prix confirmé USD'],
        description:
          'Le prix que le fournisseur confirme, saisi en demande de prix. Il remplace le prix de la ligne ; le prix d’avant reste pour mesurer l’écart.',
        obligatoire: true,
        valeurs: 'plus de 0 ; saisie à la française (1 234,5)',
      },
      {
        nom: 'Écart',
        description: 'L’écart du prix net confirmé sur le prix net d’avant, en % : rouge à la hausse, vert à la baisse. Un signal, jamais un refus.',
      },
      {
        nom: 'Taux',
        alias: ['Taux EUR/MAD', 'Taux USD/MAD'],
        description:
          'À la validation d’un bon en devise : le taux engagé, proposé au taux de référence du jour. Une fois validé, il est figé sur le bon.',
        obligatoire: true,
      },
      {
        nom: 'Pourquoi ce taux',
        description: 'Demandé seulement si le taux diffère du taux proposé : cours confirmé par la banque, couverture…',
        obligatoire: true,
        valeurs: 'cinq caractères au moins',
      },
      {
        nom: 'Motif',
        description:
          'Pour « Renvoyer en brouillon » : ce que l’acheteur doit corriger. Pour « Sauter la demande de prix » : pourquoi le bon va droit à la validation. Il reste sur le bon.',
        obligatoire: true,
        valeurs: 'cinq caractères au moins',
      },
      { nom: 'Poids commandé', description: 'La somme des kilos des lignes.' },
      { nom: 'Bobines', description: 'La somme des bobines des lignes.' },
      { nom: 'Montant brut', description: 'La somme des lignes avant remise.' },
      { nom: 'Remise', description: 'Ce que les remises retirent du brut.' },
      { nom: 'Net HT', description: 'Le total du bon dans sa devise.' },
      { nom: 'Soit, au taux engagé', description: 'Le net HT en dirhams, pour un bon en devise.' },
    ],
    regles: [
      'Le circuit : Brouillon → Au contrôle → Demande de prix (ou saut motivé) → En attente de validation → Validé → Envoyé → Livré en partie → Clôturé. Annulé à tout moment avant la clôture.',
      'SEUL LE BROUILLON SE MODIFIE. Au contrôle et en attente de validation, le bon est figé ; en demande de prix, seuls le prix et la remise des lignes changent. Pour corriger, on le renvoie en brouillon, et il repasse par le contrôle.',
      'SÉPARATION DES TÂCHES : le créateur ne contrôle pas et ne valide pas son propre bon. L’ADMIN en est dispensé par décision de la direction ; le journal garde qui a validé.',
      'La validation est plafonnée par rôle : au-delà de son plafond, le bouton est éteint et la Direction valide.',
      'Le taux s’engage à la validation, pas à la création : avant, l’en-tête affiche un taux « indicatif du jour ».',
      'Une ligne déjà reçue ne se supprime plus, ne change plus de référence, et sa quantité ne descend pas sous ce qui a été reçu.',
      'Une ligne ne suit le plan que tant que personne n’y touche : retouchée, elle est « arbitrée » et le recalcul se contente d’alerter (« Le besoin a bougé depuis la conversion »).',
    ],
    messages: [
      { message: 'Un bon sans ligne ne part pas au controle.', cause: 'Ajoutez au moins une ligne et enregistrez.' },
      {
        message: 'B4 regle 4 : vous ne pouvez pas controler un bon de commande que vous avez cree.',
        cause: 'Le contrôle demande un autre regard que celui de l’auteur.',
      },
      {
        message: 'B4 regle 4 : vous ne pouvez pas valider un bon de commande que vous avez cree.',
        cause: 'Un autre compte ayant le droit de valider doit le faire (l’ADMIN est dispensé).',
      },
      {
        message: 'Montant de … MAD superieur a votre plafond de validation (… MAD). La Direction doit valider ce bon de commande.',
        cause: 'Le montant réengagé au taux retenu dépasse le plafond de votre rôle.',
      },
      {
        message: 'TAUX-ECART : le taux saisi … s’ecarte de … % du cours Bank Al-Maghrib du …',
        cause: 'Le taux s’écarte de plus de 3 % du cours BAM. Corrigez-le, ou confirmez-le s’il s’agit du taux réel de votre banque.',
      },
      {
        message: 'Le taux retenu differe du cours propose : dites pourquoi (cours confirme par la banque, couverture…).',
        cause: 'Un taux autre que celui proposé se justifie : cinq caractères au moins.',
      },
      {
        message: 'Le bon est en demande de prix : seuls le prix et la remise des lignes se modifient.',
        cause: 'Pour les quantités, les références ou l’en-tête, renvoyez le bon en brouillon.',
      },
      {
        message: 'Ce bon a deja recu de la marchandise : il ne redevient pas brouillon.',
        cause: 'La dévalidation est refusée après une réception. Annulez-le, ou modifiez-le si le fournisseur n’a pas tout livré.',
      },
      {
        message: 'Deja … kg receptionnes sur cette ligne : la quantite ne peut pas descendre a … kg.',
        cause: 'Une ligne reçue garde au moins ce qui est entré.',
      },
      {
        message: 'Cette ligne a deja fait l’objet d’une reception : elle ne peut plus etre supprimee.',
        cause: 'La marchandise est entrée : la ligne en est la preuve.',
      },
      {
        message: 'Sauter la demande de prix demande un motif (prix sous contrat, achat local…).',
        cause: 'Le saut se justifie, cinq caractères au moins.',
      },
    ],
    liens: [
      { route: '/bons-commande', libelle: 'Bons de commande' },
      { route: '/receptions', libelle: 'Réceptions' },
      { route: '/factures-fournisseur', libelle: 'Factures fournisseur' },
      { route: '/plan-achat', libelle: 'Plans d’achat' },
    ],
  },

  /* ------------------------------------------------------------------ */
  /* FACTURES FOURNISSEUR — LA LISTE                                     */
  /* ------------------------------------------------------------------ */
  {
    route: '/factures-fournisseur',
    titre: 'Factures fournisseur',
    chemin: 'Achats → Factures fournisseur',
    objectif:
      'Retrouver les factures saisies et voir combien de pesées validées attendent encore leur facture.',
    droits: 'Module Réceptions : LIRE pour la liste, ÉCRIRE pour « Nouvelle facture ».',
    procedures: [
      {
        titre: 'Retrouver une facture',
        etapes: [
          'Les boutons « Toutes », « Brouillon », « Validée », « Annulée » filtrent par statut.',
          'La recherche porte sur la facture, le fournisseur et l’arrivage.',
          'Cliquez sur la ligne pour ouvrir la facture.',
        ],
      },
      {
        titre: 'Saisir une nouvelle facture',
        etapes: ['« Nouvelle facture » ouvre le document vide.'],
      },
    ],
    champs: [
      { nom: 'Facture', description: 'Le numéro de la facture du fournisseur, et le dossier d’import s’il y en a un.' },
      { nom: 'Date', description: 'La date de la facture.' },
      { nom: 'Fournisseur', description: 'Le nom du fournisseur, avec son code dessous.' },
      { nom: 'Statut', description: 'Où en est la facture.', valeurs: 'Brouillon · Validée · Annulée' },
      {
        nom: 'Arrivages couverts',
        description: 'Les réceptions dont la facture porte des pesées, avec son nombre de lignes et d’arrivages.',
      },
      {
        nom: 'Montant',
        description:
          'La somme des lignes, dans la devise de la facture. Dessous, en alerte, le total imprimé quand il ne retombe pas sur les lignes plus les frais.',
      },
      { nom: 'Devise', description: 'La devise de la facture.' },
      { nom: 'Saisie par', description: 'Le compte qui a saisi la facture.' },
      { nom: 'Validée par', description: 'Le compte qui l’a validée.' },
    ],
    regles: [
      'L’en-tête dit combien de pesées validées, sur combien d’arrivages, attendent encore leur facture.',
    ],
    liens: [
      { route: '/receptions', libelle: 'Réceptions' },
      { route: '/landed-cost', libelle: 'Coût de revient et écarts de prix' },
    ],
  },

  /* ------------------------------------------------------------------ */
  /* LA FACTURE FOURNISSEUR — DOCUMENT                                   */
  /* ------------------------------------------------------------------ */
  {
    route: '/factures-fournisseur/:id',
    titre: 'Facture fournisseur',
    chemin: 'Achats → Factures fournisseur → Nouvelle facture (ou ouvrir une facture)',
    objectif:
      'Saisir la facture en face de ce qui est entré, lire le rapprochement commande / pesée / facture ligne par ligne, et la valider : la valeur définitive part au CMUP et les arrivages entièrement facturés se clôturent.',
    prerequis: [
      'Les arrivages à facturer sont validés : une facture ne porte que des pesées dont les poids ne bougent plus.',
      'En devise, un cours de référence existe pour le jour de la facture (sinon le taux se saisit).',
    ],
    droits:
      'Module Réceptions : ÉCRIRE pour saisir, enregistrer et supprimer le brouillon ; VALIDER pour l’aperçu et la validation — c’est elle qui bouge le CMUP.',
    procedures: [
      {
        titre: 'Saisir la facture',
        etapes: [
          'Nouvelle facture : numéro, fournisseur (il ne change plus une fois la facture enregistrée), date.',
          'En devise, le taux est proposé au cours de référence du jour de la facture ; corrigez-le au besoin, et cochez « Confirmer ce taux » s’il s’écarte de plus de 3 % du cours.',
          'Posez le total imprimé, les frais portés par la facture, et — si des kilos ont été rendus — si la facture est nette ou brute.',
          'Dans « Ce que la facture couvre », une rangée par pesée validée de ce fournisseur, dans cette devise, qu’aucune facture ne couvre. Cochez celles que le papier facture : les kilos pesés et le prix engagé se proposent.',
          'Corrigez ce que le papier dit autrement — facturé kg, prix au kilo, remise. Les écarts se lisent aussitôt sur la rangée ; décochée, la rangée se vide et sort de la facture.',
          '« Enregistrer » : c’est un brouillon, rien n’est au CMUP.',
        ],
        resultat: 'La facture existe en brouillon ; ses lignes pointent les pesées qu’elle facture.',
      },
      {
        titre: 'Aperçu et validation',
        etapes: [
          '« Aperçu » (facture enregistrée, rien de modifié depuis) : valeur provisoire, valeur facturée, différence, part au stock, écart de prix tracé, et les avis à vérifier.',
          '« Valider », puis confirmer.',
        ],
        resultat:
          'L’écart de chaque référence va au CMUP de ce qui reste en stock ; la part des kilos déjà sortis est tracée hors CMUP. Les arrivages entièrement facturés se clôturent ; la facture est figée.',
      },
      {
        titre: 'Supprimer un brouillon',
        etapes: ['« Supprimer le brouillon », puis confirmer : rien n’était au CMUP.'],
      },
    ],
    champs: [
      { nom: 'N° de facture', description: 'Le numéro imprimé par le fournisseur.', obligatoire: true },
      {
        nom: 'Fournisseur',
        description: 'Le fournisseur facturant. Le changer vide les rangées cochées. Il ne se change plus une fois la facture enregistrée.',
        obligatoire: true,
      },
      { nom: 'Date de la facture', description: 'La date imprimée ; elle choisit le cours de référence proposé. Pas dans le futur.', defaut: 'aujourd’hui' },
      { nom: 'Devise', description: 'Celle du fournisseur. Seules les pesées dans cette devise se proposent.' },
      {
        nom: 'Taux',
        alias: ['Taux EUR → MAD', 'Taux USD → MAD'],
        description: 'En devise seulement : le taux de la facture, proposé au cours de référence du jour (sa source est rappelée dessous). Jamais 1.',
        obligatoire: true,
      },
      {
        nom: 'Confirmer ce taux (écart au cours accepté)',
        description: 'À cocher quand le taux saisi s’écarte de plus de 3 % du cours Bank Al-Maghrib et qu’il est bien celui de votre banque.',
      },
      {
        nom: 'Total imprimé',
        description:
          'Ce que le papier annonce. Il contrôle la saisie des lignes sans la remplacer : un écart avec lignes + frais se signale, il ne bloque pas.',
      },
      {
        nom: 'Frais portés par la facture',
        description:
          'Ce que le fournisseur facture en plus de la marchandise ; ils se répartissent sur les lignes. Les frais payés à part — fret, douane, transitaire — se saisissent sur l’arrivage, avec leur clé.',
      },
      {
        nom: 'Kilos rendus',
        description:
          'Si des kilos ont été rendus au fournisseur : la facture porte-t-elle sur les seuls kilos gardés (nette) ou sur toute la livraison (brute, un avoir suivra) ? Obligatoire à la validation dès qu’un retour touche un arrivage facturé.',
        valeurs: '— aucun retour — · Facture nette (kilos gardés) · Facture brute (avoir à venir)',
      },
      { nom: 'Notes', description: 'Ce qu’il faut savoir de cette facture.' },
      {
        nom: 'Pesée',
        description: 'La référence et l’arrivage de la pesée, avec dessous son lot fournisseur, son bon de commande et son dossier d’import. La case à cocher devant la fait entrer sur la facture.',
      },
      { nom: 'Pesés kg', alias: ['kg pesés'], description: 'Les kilos entrés en stock pour cette pesée.' },
      { nom: 'Engagé /kg', alias: ['engagé'], description: 'Le prix au kilo engagé par le bon de commande, dans la devise de la facture.' },
      {
        nom: 'Facturé kg',
        description: 'Les kilos que la facture porte pour cette pesée. Proposé aux kilos pesés ; actif seulement rangée cochée.',
        obligatoire: true,
        valeurs: 'plus de 0 ; saisie à la française (1 234,5)',
      },
      {
        nom: 'Prix /kg',
        alias: ['Prix MAD/kg', 'Prix EUR/kg', 'Prix USD/kg'],
        description: 'Le prix au kilo facturé, dans la devise de la facture. Proposé au prix engagé.',
        obligatoire: true,
        valeurs: 'plus de 0, 4 décimales',
      },
      { nom: 'Remise %', description: 'La remise portée par la facture sur cette ligne.' },
      { nom: 'Montant', description: 'Facturé kg × prix, moins la remise, dans la devise de la facture.' },
      {
        nom: 'Écarts',
        description:
          'Facturé moins pesé, en kg (met en cause la livraison) ; prix facturé contre engagé, en % (met en cause la négociation). « conforme » sans écart. Aucun ne bloque.',
      },
      { nom: 'Valeur provisoire', description: 'Ce que les pesées valaient au stock avant la facture.' },
      { nom: 'Valeur facturée', description: 'Ce qu’elles valent au prix de la facture, en dirhams.' },
      { nom: 'Différence', description: 'Valeur facturée moins valeur provisoire.' },
      { nom: 'Au stock (CMUP)', description: 'La part de la différence portée au CMUP de ce qui reste en stock.' },
      { nom: 'Écart de prix (tracé)', description: 'La part qui tombe sur des kilos déjà sortis : tracée au journal des écarts de prix, hors CMUP.' },
    ],
    regles: [
      'UN SEUL TABLEAU : une rangée par pesée à facturer ; la case cochée active la saisie, décochée la vide. En largeur réduite, la saisie passe sur la rangée « ↳ » de la pesée, chaque case avec son intitulé.',
      'Une facture peut couvrir plusieurs arrivages et plusieurs bons : ce sont ses lignes qui disent ce qu’elle facture. Mais un seul fournisseur et une seule devise.',
      'UNE MÊME PESÉE NE SE FACTURE PAS DEUX FOIS (FACTURE-DOUBLE) : la base le refuse.',
      'UNE RÉFÉRENCE D’UN ARRIVAGE SE FACTURE D’UN BLOC (FACTURE-BLOC) : on peut ne facturer qu’une partie des références d’un arrivage, pas une partie des kilos d’une référence.',
      'L’écart de prix est porté exact, référence par référence : une référence facturée au prix du bon ne bouge pas.',
      'L’ARRIVAGE NE SE CLÔTURE QUE QUAND TOUT EST FACTURÉ : une facture partielle porte sa part au CMUP et laisse l’arrivage validé, en attente du reste.',
      'L’aperçu et la validation portent sur la facture ENREGISTRÉE : tant qu’un champ a changé, ils attendent l’enregistrement — la raison est écrite dans la barre du bas.',
      'Validée, la facture est figée : elle a bougé un CMUP. Une correction passe par un avoir ou une facture complémentaire.',
    ],
    messages: [
      {
        message: 'FACTURE-DOUBLE : cette pesee de la reception … est deja facturee par … : une meme marchandise ne se facture pas deux fois.',
        cause: 'Une autre facture couvre déjà cette pesée. Décochez-la, ou corrigez l’autre facture si elle est en brouillon.',
      },
      {
        message: 'FACTURE-BLOC : une reference d’un arrivage se facture d’un bloc. Ajoutez les pesees manquantes a la facture, ou retirez-les : …',
        cause: 'Toutes les pesées d’une même référence d’un arrivage partent sur la même facture.',
      },
      {
        message: 'FACTURE-PESEE : la reception … est … : une facture ne porte que des pesees validees, dont les poids ne bougent plus.',
        cause: 'L’arrivage n’est pas (ou plus) validé.',
      },
      {
        message: 'FACTURE-FOURNISSEUR : la reception … vient de …, la facture de … : une facture ne couvre que les receptions de son fournisseur.',
        cause: 'La pesée appartient à un autre fournisseur.',
      },
      {
        message: 'FACTURE-DEVISE : cette ligne de reception est en …, la facture en … : une facture ne couvre qu’une devise.',
        cause: 'La pesée est dans une autre devise que la facture.',
      },
      {
        message: 'RETOURS : des kilos de la reception … ont ete rendus au fournisseur (…).',
        cause: 'Choisissez dans « Kilos rendus » si la facture est nette (kilos gardés) ou brute (avoir à venir), enregistrez, puis validez.',
      },
      {
        message: 'TAUX-ECART : le taux saisi … s’ecarte de … % du cours Bank Al-Maghrib du …',
        cause: 'Corrigez le taux, ou cochez « Confirmer ce taux » s’il s’agit du taux réel de votre banque.',
      },
      {
        message: 'Chaque ligne porte une quantite et un prix strictement positifs.',
        cause: 'Une rangée cochée a un « Facturé kg » ou un « Prix /kg » vide ou nul.',
      },
      {
        message: 'FACTURE-FIGEE : la facture … est validee : elle a bouge un CUMP.',
        cause: 'Corrigez par un avoir ou une facture complémentaire sur l’arrivage.',
      },
    ],
    liens: [
      { route: '/factures-fournisseur', libelle: 'Factures fournisseur' },
      { route: '/receptions', libelle: 'Réceptions' },
      { route: '/landed-cost', libelle: 'Coût de revient et écarts de prix' },
    ],
  },

  /* ------------------------------------------------------------------ */
  /* RETOURS FOURNISSEUR — LA LISTE                                      */
  /* ------------------------------------------------------------------ */
  {
    route: '/retours-fournisseur',
    titre: 'Retours fournisseur',
    chemin: 'Achats → Retours fournisseur',
    objectif: 'Retrouver la marchandise rendue au fournisseur, avec son avoir, et les brouillons qui attendent un second compte.',
    droits: 'Module Réceptions : LIRE pour la liste, ÉCRIRE pour « Nouveau retour ». Le montant de l’avoir est masqué au magasinier.',
    procedures: [
      {
        titre: 'Retrouver un retour',
        etapes: [
          'Le rail de droite filtre : « Tous les retours », « Brouillons » (à valider par un autre compte), « Validés » (sortis du stock).',
          'Cliquez sur la ligne pour ouvrir le retour ; « Nouveau retour » en ouvre un vide.',
        ],
      },
    ],
    champs: [
      { nom: 'N° de retour', description: 'Le numéro du retour.' },
      { nom: 'Date', description: 'La date du retour.' },
      { nom: 'Fournisseur', description: 'À qui la marchandise repart.' },
      { nom: 'Kilos rendus', description: 'La somme des kilos du retour.' },
      { nom: 'Avoir (DH)', description: 'Le montant de l’avoir : Σ quantité × prix, en dirhams.' },
      {
        nom: 'État',
        description: 'Brouillon (avec qui l’a saisi) ou Validé (avec qui l’a validé).',
        valeurs: 'Brouillon · Validé',
      },
    ],
    regles: [
      'Un brouillon n’a rien sorti du stock ; un retour validé est sorti et ne change plus.',
    ],
    liens: [
      { route: '/retours-fournisseur/nouveau', libelle: 'Nouveau retour' },
      { route: '/etat-stock', libelle: 'État des stocks' },
    ],
  },

  /* ------------------------------------------------------------------ */
  /* LE RETOUR FOURNISSEUR — DOCUMENT (nouveau et existant)              */
  /* ------------------------------------------------------------------ */
  {
    route: '/retours-fournisseur/:id',
    titre: 'Retour fournisseur',
    chemin: 'Achats → Retours fournisseur → Nouveau retour (ou ouvrir un retour)',
    objectif:
      'Rendre au fournisseur une marchandise en stock — locale ou importée — avec son avoir : préparé en brouillon, validé par un autre compte.',
    prerequis: ['La marchandise est en stock dans un magasin (la liste ne propose que ce qui y est).'],
    droits:
      'Module Réceptions : ÉCRIRE pour saisir, enregistrer et supprimer le brouillon ; VALIDER pour le valider — par un autre compte que celui qui l’a saisi. Les prix sont masqués au magasinier : sans prix saisi, le serveur prend le CMUP du magasin.',
    procedures: [
      {
        titre: 'Préparer le retour',
        etapes: [
          'Fournisseur (cherché en tapant), date du retour, motif du retour en clair, observations au besoin.',
          'Pour chaque ligne : le magasin, puis la référence en stock dans ce magasin, puis le lot (ou « Sans lot » pour la part que les lots ne portent pas).',
          'La quantité en kilos — pas plus que ce que le magasin (ou le lot) porte —, les bobines au besoin, le motif de la ligne.',
          'Le prix au kilo est proposé au CMUP du magasin : les achats le corrigent au prix convenu ; le montant de la ligne et de l’avoir se calculent.',
          '« Ajouter une ligne » reprend le magasin de la ligne précédente. « Enregistrer ».',
        ],
        resultat: 'Le retour est un brouillon : rien n’est sorti du stock. Il se modifie et se supprime encore.',
      },
      {
        titre: 'Valider le retour',
        etapes: [
          'Un AUTRE compte, avec le droit de valider, ouvre le brouillon enregistré.',
          '« Valider », puis confirmer.',
        ],
        resultat:
          'La marchandise sort du stock et des lots (mouvement de retour fournisseur, un par magasin) au prix du retour ; la colonne « CMUP avant → après » le montre. Le retour se fige.',
      },
    ],
    champs: [
      { nom: 'Fournisseur', description: 'Celui à qui la marchandise repart ; il se cherche en tapant.', obligatoire: true },
      { nom: 'Date du retour', description: 'Le jour où la marchandise repart.', obligatoire: true, defaut: 'aujourd’hui' },
      { nom: 'Montant de l’avoir', description: 'Σ quantité × prix des lignes, en dirhams. Masqué au magasinier.' },
      {
        nom: 'Motif du retour',
        description: 'Pourquoi la marchandise repart, en clair (bobines tachées, teinte non conforme…).',
        obligatoire: true,
        valeurs: 'trois caractères au moins',
      },
      { nom: 'Observations', description: 'Transporteur, bon de sortie, accord du fournisseur…' },
      { nom: 'Magasin', description: 'Le magasin d’où la marchandise repart. Le changer vide la référence, le lot et le prix de la ligne.', obligatoire: true },
      {
        nom: 'Référence',
        description: 'La référence rendue, parmi celles que le magasin porte. Choisie, elle propose le premier lot du magasin et le prix au CMUP.',
        obligatoire: true,
      },
      {
        nom: 'Lot',
        description: 'Le lot rendu, avec ses kilos ; « Sans lot » pour la part du stock que les lots ne portent pas.',
      },
      {
        nom: 'Quantité kg',
        description: 'Les kilos qui repartent : pas plus que le magasin (ou le lot) n’en porte — la case passe au rouge au-delà.',
        obligatoire: true,
        valeurs: 'plus de 0 ; saisie à la française (1 234,56)',
      },
      {
        nom: 'Prix DH/kg',
        description: 'Le prix de l’avoir au kilo, en dirhams. Proposé au CMUP du magasin ; vide, c’est le CMUP qui est pris.',
        valeurs: '0 ou plus',
        defaut: 'le CMUP du magasin',
      },
      { nom: 'Bobines', description: 'Le nombre de bobines rendues, facultatif.' },
      {
        nom: 'Motif',
        description: 'Le motif de la ligne.',
        obligatoire: true,
        valeurs: 'Défaut qualité matière · Erreur de référence',
      },
      { nom: 'Magasin, lot', description: 'Retour enregistré : le magasin et le lot (ou « sans lot ») de la ligne.' },
      { nom: 'Rendu kg', description: 'Retour enregistré : les kilos rendus, et les bobines dessous.' },
      { nom: 'Prix, montant', description: 'Retour enregistré : le prix au kilo et le montant de la ligne.' },
      { nom: 'Mouvement', description: 'Le mouvement de stock produit par la validation.' },
      {
        nom: 'CMUP avant → après',
        description: 'Retour validé : le CMUP du magasin avant et après la sortie, et l’écart porté au journal quand le stock restant n’a pas pu l’absorber.',
      },
    ],
    regles: [
      'Un retour est LIBRE : il ne se rattache à aucune réception ni à aucun dossier d’import.',
      'La sortie se fait au prix du retour : la différence avec le CMUP va au stock restant du magasin, sans jamais le faire passer sous zéro ; ce qu’il ne peut pas porter va au journal des écarts de prix.',
      'Celui qui a saisi le retour ne le valide pas, sans exception : un autre compte le contrôle.',
      'Le retour ne rouvre pas le reste à livrer du bon de commande : une nouvelle livraison se commande.',
      'Un inventaire ouvert gèle le magasin — un inventaire global tout le magasin, un tournant ou ciblé ses seules références : la sortie y est refusée tant qu’il n’est pas clôturé.',
      'Une saisie illisible (poids, prix, bobines) se signale sous la ligne et bloque l’enregistrement — jamais lue 0.',
      'Validé, le retour est définitif : son mouvement ne se contre-passe pas.',
    ],
    messages: [
      {
        message: 'Celui qui a saisi le retour … ne peut pas le valider : un autre compte le contrôle.',
        cause: 'Séparation des tâches : un second compte valide.',
      },
      {
        message: '… : … kg rendus, mais le magasin … n’en porte que … kg.',
        cause: 'La quantité dépasse ce que le magasin (ou le lot) porte, toutes lignes de la même référence additionnées.',
      },
      { message: 'Dites pourquoi la marchandise repart (motif).', cause: 'Le motif du retour fait au moins trois caractères.' },
      {
        message: '… : choisissez le motif de la ligne (défaut qualité ou erreur de référence).',
        cause: 'Chaque ligne porte son motif.',
      },
      { message: 'RFO-FIGE : les lignes du retour … valide ne changent plus.', cause: 'Le retour est validé.' },
    ],
    liens: [
      { route: '/retours-fournisseur', libelle: 'Retours fournisseur' },
      { route: '/etat-stock', libelle: 'État des stocks' },
      { route: '/landed-cost', libelle: 'Coût de revient et écarts de prix' },
    ],
  },
]
