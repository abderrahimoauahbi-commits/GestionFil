/**
 * FICHES D'AIDE — IMPORTATION ET COÛT DE REVIENT.
 *
 * Une partie du catalogue : `../contenu.ts` les assemble, `../types.ts` donne
 * la forme d'une fiche. Chaque `champs[].nom` est l'intitulé EXACT de l'écran :
 * c'est par lui que l'indice ⓘ se pose à côté du champ (`../indice.ts`).
 *
 * Réécrites le 27/10/2026 depuis le code des écrans (pages/import/*,
 * CoutRevient.tsx, EcartsPrix.tsx) et des routes (routes/importation.rs,
 * routes/pieces.rs, domain/importation.rs).
 */
import type { Sujet } from '../types.ts'

export const FICHES_IMPORTATION: Sujet[] = [
  /* ======================================================== La liste */
  {
    route: '/import',
    titre: 'Dossiers d’importation',
    chemin: 'Achats → Importation',
    objectif:
      'Retrouver les expéditions importées — fournisseurs, valeur, frais, avancement de la réception — et créer un nouveau dossier.',
    prerequis: [
      'Les fournisseurs de l’expédition existent dans le référentiel (leur devise s’y lit).',
    ],
    droits:
      'Lecture du module Import pour consulter ; écriture pour créer un dossier. Le coefficient de frais n’est montré qu’à qui voit les coûts.',
    procedures: [
      {
        titre: 'Créer un dossier',
        etapes: [
          'Cliquez « Nouveau dossier » : le formulaire s’ouvre au-dessus de la liste.',
          'Laissez « Numéro » vide pour recevoir le rang suivant de l’année ; renseignez si vous les avez le BL, le ou les conteneurs, la date d’arrivée et la DUM.',
          'Cliquez « Créer le dossier ».',
        ],
        resultat:
          'Le dossier naît en Brouillon et s’ouvre : vous y saisissez ses factures, ses frais, ses pièces et ses engagements.',
      },
      {
        titre: 'Retrouver un dossier',
        etapes: [
          'Filtrez par statut avec les boutons Tous / Brouillon / En cours / Clôturé (le nombre de dossiers est à côté).',
          'Tapez dans la recherche un numéro de dossier ou un fournisseur.',
          'Cliquez la ligne pour ouvrir le dossier.',
        ],
      },
    ],
    champs: [
      {
        nom: 'Numéro',
        description: 'Le numéro du dossier. Vide, l’outil donne le rang suivant de l’année au format rang/année.',
        defaut: 'automatique, ex. 06/26',
      },
      { nom: 'Arrivée', description: 'Dans le formulaire : la date d’arrivée prévue ou constatée. Dans la liste : cette même date.' },
      { nom: 'N° BL', description: 'Le numéro du connaissement (bill of lading) de l’expédition.' },
      { nom: 'Conteneur(s)', description: 'Le ou les numéros de conteneur, tels qu’ils figurent sur le BL.' },
      {
        nom: 'N° DUM',
        description:
          'La déclaration en douane de l’expédition — une seule par dossier. Peut se saisir plus tard ; une fois saisie, elle ne se corrige qu’avec le droit de valider et un motif.',
      },
      { nom: 'Dossier', description: 'Le numéro du dossier (rang/année).' },
      { nom: 'Statut', description: 'Brouillon (rien n’est entré en stock), En cours (validé), Clôturé (frais portés au CUMP, dossier figé).' },
      { nom: 'Fournisseurs', description: 'Les fournisseurs des factures du dossier : un dossier en groupage en réunit plusieurs.' },
      {
        nom: 'Engagements (EI)',
        description: 'Les numéros d’engagement d’importation des factures : c’est par eux que la banque ou le transitaire désignent souvent le dossier.',
      },
      { nom: 'Factures', description: 'Le nombre de factures fournisseur du dossier.' },
      { nom: 'Valeur (DH)', description: 'La valeur d’achat des factures, chacune convertie à son propre taux de change.', valeurs: 'dirhams' },
      { nom: 'Frais HT (DH)', description: 'Le total des frais du dossier (fret, transit, douane…), hors TVA.', valeurs: 'dirhams' },
      { nom: 'Frais %', description: 'Les frais rapportés à la valeur d’achat : ce que l’approche ajoute au prix.' },
      { nom: 'Réception', description: 'L’avancement de la réception : kilos reçus sur le poids net facturé. La barre passe au vert à 98 %.' },
      { nom: 'Palettes', description: 'Le nombre de palettes facturées.' },
    ],
    regles: [
      'Pas de devise sur le dossier : en groupage, chaque facture porte sa devise et son taux.',
      'Une seule DUM par dossier.',
      'La marchandise importée entre en stock par la réception unifiée (Achats → Réceptions), contre son bon de commande ; le dossier n’en voit que le reçu.',
      'Le bouton « Depuis un scan » (assistant d’importation) est masqué depuis le 26/09/2026 : la saisie assistée n’est pas en service.',
    ],
    liens: [
      { route: '/receptions', libelle: 'Réceptions' },
      { route: '/landed-cost', libelle: 'Coût de revient complet' },
    ],
  },

  /* ====================================================== Le dossier */
  {
    route: '/import/:id',
    titre: 'Dossier d’importation',
    chemin: 'Achats → Importation → clic sur un dossier',
    objectif:
      'Tenir une expédition de bout en bout : ses factures, ses frais et leur répartition, ses pièces, ses engagements, puis la clôture qui porte les frais au CUMP.',
    prerequis: [
      'Les types de frais existent (Référentiels → Types de frais) : chacun dit sa pièce justificative, s’il entre dans le coût et comment il se répartit.',
      'Pour les droits attendus et la répartition « au taux des droits », chaque référence porte sa position tarifaire (fiche de la référence).',
    ],
    droits:
      'Lecture du module Import pour consulter. Écriture pour les informations, les factures, les frais, la liquidation, les pièces, les engagements et supprimer un brouillon. Validation pour valider le dossier, le clôturer, corriger une DUM déjà saisie, ajouter un frais post-clôture et enregistrer ou supprimer un paiement.',
    procedures: [
      {
        titre: 'Renseigner les informations du dossier',
        etapes: [
          'Complétez en haut le numéro, le BL, les conteneurs, la DUM (bureau · régime · année · série), le régime, la date de la DUM, la date d’arrivée et les notes.',
          'Une DUM déjà saisie qui change demande le droit de valider et un motif, dans la case qui apparaît dessous.',
          'Cliquez « Enregistrer tout » dans la barre du bas : il enregistre aussi l’engagement, le frais et la répartition en cours.',
        ],
        resultat: 'La barre du bas ne liste plus rien « à enregistrer ».',
      },
      {
        titre: 'Onglet Factures',
        etapes: [
          'Cliquez « Ajouter une facture » : l’écran de la facture s’ouvre (en-tête, lignes, totaux).',
          'Cliquez une facture de la liste pour la reprendre ; la colonne Réception dit si elle est reçue.',
          'Sous la liste, le « Coût de revient réel » ajoute à la matière et aux frais l’écart de change de chaque paiement.',
        ],
      },
      {
        titre: 'Onglet Frais',
        etapes: [
          'Sur la ligne de saisie, choisissez le type de frais : la pièce à avoir en main s’affiche dessous.',
          'Tapez la précision (le prestataire), le n° de pièce, la devise, le cours (proposé au cours Bank Al-Maghrib du jour en devise) et le montant.',
          'Cliquez « Ajouter » (ou Entrée dans le montant, ou « Enregistrer tout »).',
          'Changez au besoin la répartition dans la colonne « Coût / répartition » ; l’icône cible ouvre sa liquidation.',
        ],
        resultat:
          'Le frais est réparti selon son type sur tout le dossier, ou attend que vous désigniez ses lignes. Un frais hors coût (TVA) n’est jamais réparti.',
      },
      {
        titre: 'Onglet Liquidation : la répartition d’un frais',
        etapes: [
          'Choisissez le frais en haut, puis sa répartition (valeur, poids, celle du paramétrage, manuelle ; « au taux des droits » pour un frais de douane).',
          'Cochez les factures qu’il vise : cocher une facture affiche ses lignes, la décocher les retire. Tout coché = tout le dossier.',
          'Pour corriger, saisissez les montants ligne par ligne : le frais passe en répartition manuelle.',
          'Lisez le pied : « non réparti : reste … » ou « dépasse le montant » ; puis « Enregistrer tout ».',
        ],
        resultat:
          'La part de chaque ligne est enregistrée. Sous la répartition, « Droits de douane attendus » compare les droits calculés aux frais de douane saisis.',
      },
      {
        titre: 'Onglet Pièces',
        etapes: [
          'Choisissez la nature du document, puis « Choisir des fichiers » ou déposez-les dans le cadre (PDF, JPEG, PNG ou TIFF, 40 Mo au plus).',
          'Lisez « Il manque : » — ce que le dossier réclame d’après ses factures et ses frais.',
          'L’œil ouvre le document ; la corbeille le retire.',
        ],
      },
      {
        titre: 'Onglet Engagements',
        etapes: [
          'Dans « Nouvel engagement », choisissez le fournisseur (sa devise suit), tapez le n° d’engagement, la banque, la date, la quantité et le montant couverts.',
          'Cliquez « Ajouter » (ou « Enregistrer tout »).',
          'Dans le bloc du fournisseur, désignez pour chaque facture l’engagement sur lequel elle s’impute.',
        ],
        resultat: 'Chaque engagement montre ce que les factures du dossier y imputent et ce qui reste.',
      },
      {
        titre: 'Valider puis clôturer le dossier',
        etapes: [
          'Brouillon : « Valider » (droit de valider) le met En cours ; il faut au moins une facture.',
          'Recevez la marchandise par Achats → Réceptions, contre les bons de commande.',
          'Tout reçu ou soldé, frais répartis : « Clôturer » ouvre l’aperçu (au stock présent, déjà consommé, CUMP avant → après par magasin).',
          'Cliquez « Clôturer et ajuster le CUMP ».',
        ],
        resultat:
          'Les frais rejoignent le CUMP du stock encore présent ; la part des kilos déjà sortis est tracée en écart. Le dossier est figé ; l’onglet Récap montre ce que la clôture a fait.',
      },
      {
        titre: 'Ajouter une facture arrivée après la clôture',
        etapes: [
          'Dossier clôturé, droit de valider : dans l’onglet Frais, saisissez le frais sur la ligne de saisie.',
          'Dites dessous quelle facture arrive après la clôture (5 caractères au moins), puis « Aperçu ».',
          'Cliquez « Ajouter ».',
        ],
        resultat: 'Le frais va au stock restant du dossier, la part des kilos déjà consommés en écart ; le dossier ne se rouvre pas.',
      },
      {
        titre: 'Enregistrer un paiement',
        etapes: [
          'Dans « Coût de revient réel » (onglet Factures), choisissez la facture payée, la date, le montant payé en devise et les dirhams débités.',
          'Le cours appliqué par la banque s’affiche ; cliquez « Enregistrer ».',
        ],
        resultat:
          'L’écart de change du paiement s’ajoute au coût réel du dossier. Le stock et le CUMP restent au cours du dédouanement.',
      },
    ],
    exemples: [
      {
        titre: 'répartir les frais',
        situation: 'Dossier 19/26 : A 4 000 kg = 77 600 MAD, B 2 000 kg = 48 500 MAD.',
        calcul: [
          ['Douane 6 000 MAD, à la valeur', 'A 3 692,31 · B 2 307,69'],
          ['Transit 2 300 MAD, au poids', 'A 1 533,33 · B 766,67'],
          ['Transport 1 500 MAD, manuelle', 'A 1 000,00 · B 500,00'],
          ['Total des frais', 'A 6 225,64 (8,02 %) · B 3 574,36 (7,37 %)'],
        ],
        conclusion:
          'Onglet Liquidation : corriger un montant passe le frais en manuelle ; un total plus petit que le frais le laisse « non réparti », et la clôture le refuse.',
      },
      {
        titre: 'la clôture porte les frais',
        situation: 'Référence A : 6 225,64 MAD de frais, 4 010 kg reçus à 19,40 MAD/kg, 1 000 kg déjà sortis, 3 010 kg en stock.',
        calcul: [
          ['Au stock présent (3 010 kg)', '6 225,64 × 3 010 ÷ 4 010 = 4 673,11 MAD'],
          ['En écart (1 000 kg sortis)', '6 225,64 × 1 000 ÷ 4 010 = 1 552,53 MAD'],
          ['Nouveau CUMP de A', '19,40 + 4 673,11 ÷ 3 010 = 20,9525 MAD/kg'],
        ],
        conclusion: 'La clôture est refusée tant qu’un frais est non réparti ou qu’une ligne reste à recevoir.',
      },
    ],
    champs: [
      /* --- Informations du dossier */
      { nom: 'Numéro', description: 'Le numéro du dossier (rang/année), attribué à la création.' },
      { nom: 'N° BL', description: 'Le numéro du connaissement de l’expédition.' },
      { nom: 'Conteneur(s)', description: 'Le ou les numéros de conteneur.' },
      {
        nom: 'N° DUM',
        description:
          'La déclaration en douane du dossier — une seule. Saisie, elle ne s’efface pas ; la corriger demande le droit de valider et un motif.',
        valeurs: 'bureau · régime · année · série',
      },
      { nom: 'Régime', description: 'Le régime douanier de la DUM.', defaut: '010' },
      { nom: 'Date DUM', description: 'La date de la déclaration en douane.' },
      { nom: "Date d'arrivée", description: 'La date d’arrivée de l’expédition au port.' },
      { nom: 'Notes', description: 'Texte libre. C’est le seul champ d’un dossier clôturé qui s’écrit encore.' },
      /* --- Onglet Factures */
      {
        nom: 'Fournisseur / facture',
        description: 'Le fournisseur, et dessous (↳) le numéro, la date et le nombre de lignes de la facture. Un clic ouvre la facture.',
      },
      {
        nom: 'Montant devise',
        description: 'La somme des lignes, dans la devise de la facture ; « imprimé … » en orange quand elle diffère du montant imprimé.',
      },
      { nom: 'Valeur DH', description: 'La valeur d’achat en dirhams, au taux de change de la facture.', valeurs: 'dirhams' },
      { nom: 'Frais alloués', description: 'La part des frais du dossier que les lignes portent. Visible à qui voit les coûts.', valeurs: 'dirhams' },
      { nom: 'Poids net kg', description: 'Le poids net facturé, et dessous (↳) les palettes et bobines.' },
      {
        nom: 'Réception',
        description:
          'Sur une facture : Non reçue, Partielle ou Reçue, relu des arrivages validés. Dans le Récap : kilos reçus sur poids net facturé, avec sa barre.',
      },
      /* --- Coût de revient réel et paiements */
      { nom: 'Facture', description: 'La facture, son montant en devise et le cours du dédouanement qui valorise le stock.' },
      { nom: 'Matière', description: 'La valeur de la matière au cours du dédouanement.', valeurs: 'dirhams' },
      {
        nom: 'Frais',
        description:
          'Selon l’endroit : le frais à répartir (Liquidation), les frais d’une facture (Coût de revient réel), les frais d’une référence (aperçu de clôture).',
      },
      {
        nom: 'Change 2026',
        alias: ['Change 2025', 'Change 2027', 'Change 2028'],
        description:
          'L’écart de change des paiements de l’exercice : + a coûté, − a rapporté. « non payé » sans paiement ; « dont latent au 31/12 » pour une facture d’une année échue encore impayée.',
      },
      { nom: 'Coût réel', description: 'Matière + frais + écarts de change : ce que la facture a vraiment coûté.', valeurs: 'dirhams' },
      { nom: 'Reste à payer', description: 'Ce qui reste dû sur la facture, dans sa devise.' },
      { nom: 'Paiement', description: 'La date du paiement et la facture qu’il règle.' },
      { nom: 'Devise payée', description: 'Le montant réglé, dans la devise de la facture.' },
      { nom: 'MAD débités', description: 'Les dirhams que la banque a débités pour ce paiement. Avec le montant payé, ils donnent le cours de la banque.', obligatoire: true },
      { nom: 'Cours banque', description: 'Dirhams débités ÷ devise payée : le cours réellement appliqué.' },
      { nom: 'Écart', description: 'L’écart de change du paiement, coupé par exercice si le paiement tombe l’année suivant le dédouanement.' },
      { nom: 'Facture payée', description: 'La facture du dossier que ce paiement règle ; la liste dit ce qui reste à payer.', obligatoire: true },
      {
        nom: 'Payé (devise)',
        description: 'Le montant réglé, dans la devise de la facture choisie. Il ne peut pas dépasser ce qui reste à payer.',
        obligatoire: true,
      },
      {
        nom: 'Date',
        description:
          'La date de l’engagement (onglet Engagements), ou la date du paiement (Coût de revient réel) — jamais future ; un paiement daté avant le dédouanement est signalé (C53).',
        defaut: 'aujourd’hui pour un paiement',
      },
      /* --- Onglet Frais */
      { nom: 'Type de frais', description: 'Le type du catalogue (douane, fret, transitaire, TVA…). Il dit sa pièce, s’il entre au coût et sa répartition.', obligatoire: true },
      { nom: 'Précision', description: 'Le prestataire ou le détail du frais, ex. le nom du transitaire.' },
      { nom: 'N° pièce', description: 'Le numéro de la facture ou de la quittance qui justifie le frais.' },
      {
        nom: 'Devise',
        description:
          'La devise du frais (onglet Frais) ou de l’engagement (onglet Engagements). Changer la devise d’un frais vide son cours : celui du jour vient s’y proposer.',
        defaut: 'MAD pour un frais ; celle du fournisseur pour un engagement',
      },
      {
        nom: 'Cours',
        description: 'Le cours de change du frais en devise, proposé au cours Bank Al-Maghrib du jour. Plus de 3 % d’écart se confirme. Inactif en MAD.',
        defaut: '1 en MAD',
      },
      {
        nom: 'Montant',
        description:
          'Le montant du frais dans sa devise (onglet Frais), le montant du frais en dirhams (Liquidation), ou le montant couvert par l’engagement dans sa devise (Engagements).',
        obligatoire: true,
      },
      { nom: 'Montant DH', description: 'Le montant en dirhams : celui du frais (onglet Frais), ou la part d’une ligne, modifiable (Liquidation).', valeurs: 'dirhams' },
      {
        nom: 'Coût / répartition',
        description:
          'Pour un frais inclus au coût : sa répartition (à la valeur, au poids, celle du paramétrage, manuelle), modifiable sur-le-champ, et « tout le dossier » ou le nombre de lignes visées. « hors coût » pour la TVA.',
      },
      /* --- Onglet Liquidation */
      { nom: 'Pièce', description: 'Le numéro de pièce du frais choisi.' },
      {
        nom: 'Répartition',
        description:
          'La méthode qui calcule les parts : à la valeur, au poids, celle du paramétrage, manuelle ; « au taux des droits » pour un frais de douane. Saisir un montant la passe en manuelle.',
        defaut: 'celle du type de frais',
      },
      { nom: 'Factures visées', description: '« Tout le dossier » quand toutes les factures sont cochées, sinon combien le frais en vise.' },
      { nom: 'Ligne', description: 'La facture (cochée ou non) puis chacune de ses lignes : la référence, ou la désignation d’une ligne hors ERP.' },
      { nom: 'Poids kg', description: 'Le poids net facturé de la ligne : l’assiette d’une répartition au poids.' },
      { nom: '%', description: 'La part de la ligne (ou de la facture) dans le montant du frais.' },
      /* --- Droits de douane attendus */
      { nom: 'Position', description: 'La position tarifaire (code SH) de la référence ; « sans position » : droit inconnu (contrôle C56).' },
      { nom: 'Taux', description: 'Le taux de droit de la position tarifaire.' },
      {
        nom: 'Valeur en douane',
        description: 'La valeur de la ligne en dirhams, plus sa part des frais comptés en valeur en douane (fret, assurance).',
      },
      { nom: 'Droits attendus', description: 'Valeur en douane × taux de la position. « — » : pas de position, pas zéro.' },
      { nom: 'Attendus (positions tarifaires)', description: 'La somme des droits attendus du dossier.' },
      { nom: 'Payés (frais de douane saisis)', description: 'La somme des frais de catégorie douane saisis dans l’onglet Frais.' },
      { nom: 'Écart payé − attendu', description: 'Ce qui sépare le payé de l’attendu. Il se lit, il ne bloque rien : la quittance fait foi.' },
      /* --- Onglet Pièces */
      {
        nom: 'Nature',
        description:
          'Ce que contient le document : facture fournisseur, DUM, quittance, fiche de liquidation, facture de frais, connaissement, colisage, engagement, autre.',
        defaut: 'Autre document',
      },
      { nom: 'Document', description: 'Le nom du fichier déposé, et dessous la facture à laquelle il se rattache.' },
      { nom: 'Déposé le', description: 'La date du dépôt, et dessous (↳) qui l’a déposé et le poids du fichier.' },
      /* --- Onglet Engagements */
      {
        nom: 'Fournisseur',
        description: 'Le fournisseur dont la proforma est couverte. Ceux du dossier sont en tête de liste ; sa devise se pose dans « Devise ».',
        obligatoire: true,
      },
      {
        nom: 'N° d’engagement',
        description: 'Le numéro de l’engagement d’importation ouvert en banque (20 chiffres), tel que la DUM le cite.',
        obligatoire: true,
      },
      { nom: 'Banque', description: 'La banque qui a ouvert l’engagement.' },
      { nom: 'Qté couverte (kg)', description: 'La quantité que l’engagement couvre.', valeurs: 'kg' },
      { nom: 'Remarque', description: 'Proforma, conditions… Elle s’affiche sous le numéro de l’engagement.' },
      { nom: 'Qté (kg)', description: 'La quantité couverte par l’engagement.', valeurs: 'kg' },
      { nom: 'Imputé', description: 'La somme des factures du dossier imputées sur cet engagement, dans sa devise.' },
      { nom: 'Reste', description: 'Montant de l’engagement − imputé. En rouge quand les factures le dépassent.' },
      /* --- Récap */
      { nom: "Valeur d'achat", description: 'La valeur d’achat de toutes les lignes du dossier, en dirhams.' },
      { nom: 'Frais HT inclus', description: 'Les frais qui entrent dans le coût de revient, et leur part de la valeur.' },
      { nom: 'Hors coût (TVA)', description: 'Les frais hors coût : récupérables, jamais répartis.' },
      /* --- Ce que la clôture a fait */
      { nom: 'Origine', description: 'Frais (la clôture), Avoir de prix ou Avoir pour retour (avec son numéro).' },
      { nom: 'Référence', description: 'La référence dont le CUMP a été ajusté.' },
      { nom: 'Magasin', description: 'Le magasin où le stock se trouvait ; « déjà consommé » ou « rendu » pour la part hors stock.' },
      { nom: 'Stock (kg)', description: 'Les kilos présents qui ont porté l’ajustement.' },
      { nom: 'Montant (DH)', description: 'Le montant porté au CUMP, ou tracé en écart.' },
      { nom: 'CUMP avant → après', description: 'Le coût moyen du magasin avant et après l’ajustement.' },
      { nom: 'Au stock présent', description: 'Aperçu de clôture : ce qui ira au CUMP du stock encore présent.' },
      { nom: 'Déjà consommé', description: 'Aperçu de clôture : la part des frais revenue à du fil déjà sorti, tracée au journal, pas réinjectée.' },
      { nom: 'Lignes hors ERP', description: 'Aperçu de clôture : les frais portés par les lignes hors ERP.' },
      { nom: 'Reçu / en stock (kg)', description: 'Les kilos reçus de la référence et ceux encore en stock.' },
      { nom: 'Au stock', description: 'La part des frais de la référence qui ira au stock présent.' },
      { nom: 'Consommé', description: 'La part des frais de la référence revenue à des kilos déjà sortis.' },
      { nom: 'CUMP', description: 'Par magasin, le CUMP avant → après la clôture ; « plus de stock » si rien ne reste.' },
      {
        nom: 'Frais post-clôture : quelle facture arrive après la clôture ?',
        description: 'Le motif du frais ajouté après la clôture : quelle facture, reçue quand.',
        obligatoire: true,
        valeurs: '5 caractères au moins',
      },
    ],
    regles: [
      'Pas de devise sur le dossier : chaque facture porte sa devise et son taux (cours Bank Al-Maghrib de sa date).',
      'Les réceptions ne se saisissent pas ici : la marchandise importée entre par la réception unifiée, contre son bon de commande ; le reçu de chaque facture est relu des arrivages validés.',
      'Un frais se répartit par défaut selon son type ; la répartition reste modifiable. Un frais dont la somme répartie n’égale pas le montant est « non réparti » : la clôture le refuse.',
      'Répartition « au taux des droits » : chaque ligne porte la douane au prorata de ses droits attendus. Une ligne visée sans position tarifaire laisse le frais non réparti.',
      'La clôture exige : dossier En cours, chaque ligne reçue ou soldée (à la tolérance du fournisseur), aucune réception en brouillon ou à contrôler, au moins un frais inclus au coût, tous répartis.',
      'La clôture porte les frais au CUMP du stock encore présent, magasin par magasin ; la part des kilos sortis est tracée en écart de prix.',
      'Clôturé, le dossier est figé et ne se rouvre pas : une facture tardive entre en frais post-clôture.',
      'Le change au paiement ne touche jamais le CUMP : il s’ajoute au coût de revient réel. Un dossier à cheval sur deux exercices voit son écart coupé au cours BAM du 31/12.',
      'Jamais d’acompte avant le dédouanement : un paiement daté avant est signalé (contrôle C53), pas refusé.',
      'Les pièces réclamées se déduisent du dossier : une facture fournisseur par facture ; quittance, fiche de liquidation et DUM dès qu’un frais de douane existe ; une facture de frais pour les autres frais ; le connaissement si un BL est saisi.',
      '« Enregistrer tout » enregistre dans l’ordre les informations, l’engagement, le frais puis la répartition en cours ; valider et clôturer attendent que rien ne reste à enregistrer.',
      'Un brouillon se supprime avec ses factures, ses frais et ses engagements : il n’a rien fait entrer en stock.',
    ],
    messages: [
      { message: 'Un dossier sans facture ne se valide pas : ajoutez d’abord ses factures.', cause: 'Validation d’un brouillon vide.' },
      { message: 'Reste à recevoir — recevez ou soldez d’abord : …', cause: 'Une ligne facturée n’est pas entièrement reçue au-delà de la tolérance du fournisseur.' },
      { message: '… réception(s) en brouillon : validez-les ou supprimez-les d’abord.', cause: 'Un arrivage du dossier n’est pas validé : il ferait entrer du stock après la répartition.' },
      { message: 'Aucun frais inclus dans le coût n’est saisi : la clôture n’aurait rien à ajouter.', cause: 'Clôture sans frais au coût.' },
      {
        message: 'Frais non réparti(s) : … Vérifiez leurs lignes ciblées, ou complétez la répartition manuelle (onglet Liquidation).',
        cause: 'La somme répartie d’un frais n’égale pas son montant (manuelle incomplète, ou « au taux des droits » avec une ligne sans position).',
      },
      { message: '… DH répartis : plus que le montant du frais (… DH).', cause: 'La répartition manuelle dépasse le montant du frais.' },
      {
        message: 'Le dossier est cloture : il est fige. Une facture tardive (transitaire, port) s’ajoute en « frais post-cloture » ; il ne se rouvre pas.',
        cause: 'Modification d’un dossier clôturé.',
      },
      { message: 'La DUM … ne s’efface pas : elle prouve le dedouanement.', cause: 'La DUM a été vidée.' },
      { message: 'Corriger une DUM deja saisie demande le droit de valider l’import.', cause: 'Changement de DUM sans le droit de valider.' },
      { message: 'Dites pourquoi la DUM change (faute de frappe, DUM rectificative…).', cause: 'Motif absent ou de moins de 5 caractères.' },
      {
        message: 'TAUX-ECART : le taux saisi … s’ecarte de … % du cours Bank Al-Maghrib …',
        cause: 'Le cours d’un frais ou d’un paiement s’écarte de plus de 3 % de la référence : l’écran demande de le confirmer.',
      },
      { message: 'Dites quelle facture arrive apres la cloture (5 caracteres au moins).', cause: 'Frais post-clôture sans motif.' },
      { message: 'La facture … est de … ; … sont déjà payés : ce paiement la dépasserait.', cause: 'Les paiements dépasseraient le montant de la facture.' },
      { message: 'La date du paiement est obligatoire et ne peut pas être future.', cause: 'Date de paiement vide ou à venir.' },
      {
        message: 'Ce paiement est daté du …, avant le dédouanement de la facture … : vérifiez la date (signalé par le contrôle C53).',
        cause: 'Avis, pas un refus : le paiement est enregistré.',
      },
      { message: 'L’engagement … est deja rattache a ce dossier.', cause: 'Le même numéro d’engagement saisi deux fois.' },
      { message: 'Ce document est déjà dans le dossier, sous « … ».', cause: 'Le même fichier a déjà été déposé (avis).' },
      { message: 'Fichier trop lourd : la limite est de 40 Mo.', cause: 'Pièce de plus de 40 Mo.' },
      { message: 'Ce dossier a ete modifie par … pendant votre saisie.', cause: 'Quelqu’un a enregistré entre-temps : le dossier se relit, refaites votre saisie.' },
    ],
    liens: [
      { route: '/import', libelle: 'Dossiers d’importation' },
      { route: '/receptions', libelle: 'Réceptions' },
      { route: '/catalogue', libelle: 'Références (positions tarifaires)' },
      { route: '/controles', libelle: 'Contrôles de cohérence' },
    ],
  },

  /* ================================================== La facture */
  {
    route: '/import/:id/factures/:idFacture',
    titre: 'Facture d’importation',
    chemin: 'Achats → Importation → dossier → onglet Factures → « Ajouter une facture » ou clic sur une facture',
    objectif:
      'Recopier la facture d’un fournisseur du dossier — en-tête, lignes, totaux — et la rapprocher du bon de commande et du reçu.',
    prerequis: [
      'Le dossier existe et n’est pas clôturé.',
      'Pour rattacher une ligne : un bon de commande du fournisseur envoyé, dont la ligne a encore un reste.',
    ],
    droits: 'Écriture du module Import. Les prix du bon et les coûts sont masqués à qui n’a pas le droit de les voir.',
    procedures: [
      {
        titre: 'Saisir une facture',
        etapes: [
          'Choisissez le fournisseur : sa devise se pose ; en devise, le taux est proposé au cours Bank Al-Maghrib de la date de la facture.',
          'Tapez le n° et la date ; vérifiez le taux (écart affiché sous la case) ; choisissez l’engagement d’importation.',
          'Recopiez le montant, les palettes et les bobines imprimés : les totaux s’y comparent.',
          '« Ligne » : tapez la référence (celles du fournisseur ; « toutes les références » ouvre le catalogue), choisissez la ligne de bon — sa référence et son prix reviennent.',
          'Saisissez le poids net, ou les bobines, ou les palettes : liés, les deux autres se calculent par la référence ; l’icône chaîne les détache.',
          'Complétez prix, remise, lot, couleur ; « Ligne hors ERP » pour une ligne qui n’est pas de la matière suivie.',
          'Lisez « Contrôle » et les totaux, puis « Enregistrer la facture » (barre du bas).',
        ],
        resultat: 'La facture et ses lignes sont enregistrées ; les frais du dossier sont répartis à nouveau.',
      },
      {
        titre: 'Voir la part de frais d’une ligne',
        etapes: ['Cliquez la flèche en bout de ligne (ou « Frais DH » sur la rangée ↳).'],
        resultat: 'La valeur d’achat, la part de chaque frais et le coût de revient de la ligne s’affichent dessous.',
      },
    ],
    champs: [
      { nom: 'Fournisseur', description: 'Le fournisseur de la facture. Il décide des références et des bons proposés. Figé une fois la facture reçue.', obligatoire: true },
      { nom: 'N° de facture', description: 'Le numéro imprimé sur la facture.', obligatoire: true },
      { nom: 'Date', description: 'La date de la facture : elle donne le cours Bank Al-Maghrib de référence.', obligatoire: true },
      {
        nom: 'Devise',
        description: 'La devise de la facture — chaque facture a la sienne. Changer de devise vide le taux. Figée une fois la facture reçue.',
        obligatoire: true,
        defaut: 'celle de la fiche fournisseur',
      },
      {
        nom: 'Taux de change',
        description:
          'Dirhams pour une unité de devise. Proposé au cours BAM de la date (à défaut le taux de l’ERP). Le taux 1 en devise est refusé ; plus de 3 % d’écart se confirme. Figé une fois la facture reçue.',
        obligatoire: true,
        valeurs: '4 décimales, ex. 9,2224',
      },
      {
        nom: 'Engagement d’importation',
        description: 'L’engagement bancaire sur lequel la facture s’impute : ceux du fournisseur, ou sans fournisseur précisé.',
        defaut: 'Sans engagement',
      },
      {
        nom: 'Montant imprimé (devise)',
        description: 'Le total imprimé sur la facture. Il ne valorise rien : la somme des lignes s’y compare. Figé une fois la facture reçue.',
      },
      { nom: 'Palettes imprimées', description: 'Le nombre de palettes annoncé par la facture, comparé au total des lignes.' },
      { nom: 'Bobines imprimées', description: 'Le nombre de bobines annoncé par la facture, comparé au total des lignes.' },
      {
        nom: 'Je confirme ce taux : c’est le taux réel appliqué par la banque',
        description: 'À cocher quand le taux s’écarte de plus de 3 % de la référence et qu’il est juste. Changer le taux retire la confirmation.',
      },
      { nom: 'toutes les références', description: 'Coché, la recherche de référence ouvre tout le catalogue, pas seulement celles du fournisseur.' },
      {
        nom: 'Référence / désignation',
        description: 'La référence de la ligne (tapez pour chercher), ou la désignation d’une ligne hors ERP.',
        obligatoire: true,
      },
      {
        nom: 'Bon de commande',
        description:
          'La ligne de bon commandée : bons envoyés ou livrés en partie du fournisseur, lignes non soldées avec un reste. La choisir reprend sa référence et son prix. « Libre — sans BC » est admis.',
      },
      { nom: 'Lot', description: 'Le lot du fournisseur, tel qu’imprimé.' },
      { nom: 'Code', alias: ['Code coul.'], description: 'Le code couleur du fournisseur. Repris de la référence.' },
      { nom: 'Coul.', alias: ['Couleur'], description: 'Le libellé de la couleur. Repris de la référence.' },
      { nom: 'Unité', description: 'L’unité facturée : kg (le cas courant), mètre ou pièce.', valeurs: 'kg, m, pce', defaut: 'kg' },
      {
        nom: 'Poids kg',
        alias: ['Poids net kg'],
        description: 'Le poids net facturé : il valorise la ligne (au kilo) et porte les frais au poids.',
        obligatoire: true,
        valeurs: 'kg',
      },
      { nom: 'Qté', description: 'La quantité facturée quand l’unité n’est pas le kilo ; « = poids » au kilo.' },
      {
        nom: 'Bob.',
        alias: ['Bobines'],
        description: 'Le nombre de bobines. Lié, il suit le poids par le conditionnement de la référence, et inversement.',
      },
      {
        nom: 'Pal.',
        alias: ['Palettes'],
        description: 'Le nombre de palettes. Lié, il suit le poids et les bobines ; détaché, il se saisit tel que la facture l’annonce.',
      },
      { nom: 'Prix unit.', description: 'Le prix unitaire brut, en devise. Repris du bon quand on choisit sa ligne.', obligatoire: true },
      { nom: 'Rem. %', alias: ['Remise %'], description: 'La remise du fournisseur en % du prix brut.', defaut: '0' },
      { nom: 'Montant', description: 'Quantité × prix × (1 − remise), arrondi au centime : le calcul de la base.' },
      {
        nom: 'Contrôle',
        description:
          '« BC » : le prix facturé contre celui du bon (= ou écart en %, au kilo et à même devise) ; « reçu » : le poids facturé contre le reçu. Rien ne bloque.',
      },
      { nom: '% dossier', description: 'La part de la ligne dans la valeur du dossier.' },
      { nom: 'Frais DH (% dossier)', description: 'Les frais portés par la ligne ; le clic ouvre la part de chaque frais.' },
      { nom: 'Revient /u', description: 'Le coût de revient unitaire de la ligne : achat + frais, par kg (ou m, pièce).' },
      { nom: 'Montant brut (devise)', description: 'La somme des lignes avant remise (affiché s’il y a une remise).' },
      { nom: 'Remise (devise)', description: 'Le total des remises des lignes.' },
      { nom: 'Montant net (devise)', description: 'La somme des lignes, comparée au montant imprimé (= ou écart).' },
      { nom: 'Valeur (DH)', description: 'Montant net × taux de change ; la référence BAM est rappelée.' },
      { nom: 'Poids net (kg)', description: 'Le total du poids net, comparé au reçu dès qu’il y a une réception.' },
      { nom: 'Palettes / bobines', description: 'Les totaux des lignes, comparés aux palettes et bobines imprimées.' },
      { nom: 'Frais alloués (DH)', description: 'Les frais du dossier que la facture porte, et leur part de sa valeur.' },
      { nom: 'Coût de revient (DH)', description: 'Valeur d’achat + frais alloués.' },
    ],
    regles: [
      'Chaque facture porte sa devise et son taux ; le taux ne se replie plus sur celui du dossier.',
      'Une ligne déjà reçue est figée tout entière (cadenas) : référence, bon, poids, prix, lot, couleur, bobines, palettes. Elle ne se retire pas.',
      'Une facture qui a fait entrer de la marchandise garde son fournisseur, sa devise, son taux et son montant ; elle ne se supprime plus.',
      'Le prix du bon revient sur chaque ligne enregistrée, même quand la ligne de bon est soldée : l’écart de prix reste lisible.',
      'Une ligne de facture ne se rattache qu’à une ligne de marchandise d’un bon envoyé : le transport et les commissions se saisissent en frais du dossier.',
      'Un colisage qui ne concorde pas avec le conditionnement de la référence se signale ; il ne bloque jamais.',
      'Une ligne est complète avec sa référence, son poids net et son prix (sa quantité hors kilo) ; hors ERP, avec sa désignation, sa quantité et son prix.',
      'Tout s’enregistre d’un coup par « Enregistrer la facture » : la barre du bas dit ce qui manque.',
    ],
    messages: [
      { message: 'facture en … au taux 1 : c’est le taux du dirham, pas celui du …', cause: 'Taux 1 sur une facture en devise.' },
      { message: 'facture en … : le taux de change est obligatoire', cause: 'Taux vide ou nul.' },
      { message: 'TAUX-ECART : le taux saisi … s’ecarte de … % du …', cause: 'Plus de 3 % d’écart avec la référence, non confirmé.' },
      {
        message: 'IMPORT-FIGEE : la facture … a deja fait entrer de la marchandise : son fournisseur, sa devise, son taux et son montant ne bougent plus.',
        cause: 'Modification de l’en-tête d’une facture reçue. Corrigez par les frais du dossier, ou contre-passez la réception avant la DUM.',
      },
      {
        message: 'IMPORT-FIGEE : la ligne … de la facture est déjà reçue (… kg) : modification refusée.',
        cause: 'Une ligne reçue ne bouge plus ; soldez-la, ou contre-passez la réception avant la DUM.',
      },
      { message: 'Cette facture a déjà des lignes en réception : elle ne se supprime plus.', cause: 'Suppression d’une facture reçue.' },
      { message: 'Quantité facturée obligatoire.', cause: 'Ligne sans poids ni quantité.' },
      { message: 'Prix unitaire obligatoire.', cause: 'Ligne sans prix.' },
      { message: 'Cette facture a ete modifie par … pendant votre saisie.', cause: 'Quelqu’un a enregistré entre-temps : rouvrez, refaites vos changements.' },
    ],
    liens: [
      { route: '/import', libelle: 'Dossiers d’importation' },
      { route: '/bons-commande', libelle: 'Bons de commande' },
    ],
  },

  /* ============================================ La lecture d'une pièce */
  {
    route: '/import/:id/pieces/:idPiece',
    titre: 'Lecture de la pièce',
    chemin: 'Achats → Importation → dossier → onglet Pièces → « Lire » (bouton masqué, saisie assistée hors service)',
    objectif:
      'Relire ce que la lecture automatique (GestionAi) a trouvé dans un scan, le scan sous les yeux, avant de le saisir dans le dossier.',
    prerequis: [
      'La pièce est déposée dans le dossier.',
      'Le service de lecture GestionAi répond sur le serveur.',
    ],
    droits: 'Lecture du module Import pour consulter ; écriture pour lancer la lecture et rattacher un engagement.',
    procedures: [
      {
        titre: 'Lire une pièce',
        etapes: [
          'Cliquez « Lire la pièce » (« Relire » si elle l’a déjà été) : quelques secondes par page.',
          'Relisez d’abord les champs « à vérifier » et « déduit » ; un clic sur un champ ouvre la page d’où il sort.',
          'Sur un engagement lu, « Rattacher » l’ajoute au dossier.',
          'Saisissez le reste dans les onglets du dossier.',
        ],
        resultat: 'Rien n’est enregistré par la lecture, sauf un engagement rattaché à la main.',
      },
    ],
    champs: [
      { nom: 'Désignation', description: 'Ce que la ligne lue désigne (facture), ou l’intitulé d’une rubrique (liquidation).' },
      { nom: 'Lot', description: 'Le lot du fournisseur lu sur la ligne.' },
      { nom: 'Couleur', description: 'Le code et le libellé couleur lus.' },
      { nom: 'Conteneur', description: 'Le conteneur lu sur la ligne.' },
      { nom: 'Quantité', description: 'La quantité lue sur la ligne de facture.' },
      { nom: 'Prix', description: 'Le prix unitaire lu, en devise.' },
      { nom: 'Montant', description: 'Le montant lu de la ligne, en devise.' },
      { nom: 'Engagement cité (case 38)', description: 'Le numéro d’engagement que la DUM cite.' },
      { nom: 'Banque', description: 'La banque de l’engagement cité.' },
      { nom: 'Quantité (kg)', description: 'La quantité de l’engagement cité.' },
      { nom: 'Valeur', description: 'La valeur de l’engagement cité.' },
      { nom: 'Rubrique', description: 'Le code de la rubrique de liquidation (droits, taxes).' },
      { nom: 'Frais proposé', description: 'Le type de frais auquel la rubrique correspondrait.' },
      { nom: 'Montant (MAD)', description: 'Le montant de la rubrique, en dirhams.' },
    ],
    regles: [
      'Statuts d’un champ lu : vérifié (confirmé par un calcul ou une autre pièce), corrigé (le calcul a tranché), lu (aucun contrôle possible), déduit (illisible, calculé), à vérifier (le calcul ne tombe pas juste).',
      'La lecture reste permise sur un dossier clos ; y rattacher un engagement, non.',
      'Le bouton « Lire » de l’onglet Pièces est masqué depuis le 26/09/2026 : l’écran ne s’ouvre que par son adresse.',
    ],
    messages: [
      { message: 'GestionAi ne repond pas (…)', cause: 'Le service de lecture n’est pas joignable.' },
      { message: 'GestionAi n’a pas pu lire la piece : …', cause: 'Scan illisible ou format non reconnu.' },
    ],
    liens: [{ route: '/import', libelle: 'Dossiers d’importation' }],
  },

  /* ================================================== L'assistant */
  {
    route: '/import/assistant',
    titre: 'Assistant d’importation',
    chemin: 'Aucune entrée de menu : le bouton « Depuis un scan » est masqué (saisie assistée hors service depuis le 26/09/2026)',
    objectif:
      'Créer un dossier d’importation à partir de la liasse scannée, le scan restant visible pendant qu’on recopie les informations.',
    prerequis: ['La liasse scannée est sur le poste (PDF, JPG ou PNG).'],
    droits: 'Écriture du module Import.',
    procedures: [
      {
        titre: 'Créer un dossier depuis un scan',
        etapes: [
          'Glissez les fichiers dans le cadre, ou « Parcourir ».',
          'Vérifiez la nature proposée pour chaque fichier (devinée par son nom) et corrigez-la.',
          'Lisez l’avertissement sur ce qui manque (facture, connaissement, colisage) ; vous pouvez continuer.',
          '« Continuer » : le scan s’affiche à côté du formulaire.',
          'Recopiez numéro, connaissement, conteneurs, date d’arrivée, devise, taux et notes.',
          'Cliquez « Créer le dossier et déposer les … document(s) ».',
        ],
        resultat:
          'Le dossier naît en Brouillon, ses documents y sont déposés (un échec de dépôt est signalé, le dossier reste), et sa page s’ouvre pour les factures et les frais.',
      },
    ],
    champs: [
      { nom: 'Numéro', description: 'Laissez vide : l’outil donne le rang suivant de l’année.', defaut: 'automatique, ex. 56/26' },
      { nom: 'Connaissement (BL)', description: 'Le numéro du connaissement, tel qu’il figure sur le document.' },
      { nom: 'Conteneurs', description: 'Le ou les numéros de conteneur.' },
      { nom: "Date d'arrivée", description: 'La date d’arrivée au port.' },
      {
        nom: 'Devise',
        description: 'Gardée sur le dossier comme simple repli : chaque facture saisie ensuite porte sa propre devise.',
        defaut: 'USD',
      },
      {
        nom: 'Taux de change',
        description:
          'Exigé par l’assistant pour créer le dossier. Il ne reste sur le dossier qu’en repli : chaque facture porte son propre taux, proposé au cours BAM de sa date.',
        obligatoire: true,
        valeurs: 'nombre décimal, ex. 9,2224',
      },
      { nom: 'Notes', description: 'Texte libre sur le dossier.' },
      {
        nom: 'Nature du document',
        description: 'Ce que chaque fichier contient : facture fournisseur, DUM, quittance, liquidation, facture de frais, BL, colisage, engagement, autre.',
        defaut: 'devinée par le nom du fichier, sinon Autre document',
      },
    ],
    regles: [
      'L’assistant ne lit pas les documents : il les garde sous les yeux pendant la saisie.',
      'Les fichiers ne partent qu’à la création du dossier : abandonner en cours de route ne laisse rien derrière soi.',
      'Un fichier nommé « dossier… » ou « liasse… » est une liasse entière : il reste « Autre document ».',
    ],
    liens: [{ route: '/import', libelle: 'Dossiers d’importation' }],
  },

  /* ============================================ Le coût de revient */
  {
    route: '/landed-cost',
    titre: 'Coût de revient complet',
    chemin: 'Finance → Coût de revient complet',
    objectif:
      'Voir ce que coûte la matière rendue magasin, réception par réception — prix d’achat plus fret, douane, assurance, manutention — et les écarts de prix que le CMUP n’a pas portés.',
    prerequis: ['La réception est validée : les frais ne se répartissent que sur des poids qui ne bougent plus.'],
    droits:
      'Lecture du module Valorisation ; saisir un frais demande l’écriture. Les montants sont masqués à qui n’a pas le droit de les voir.',
    procedures: [
      {
        titre: 'Saisir un frais d’approche',
        etapes: [
          'Cliquez « + » : le formulaire s’ouvre sur la page.',
          'Cherchez la réception (numéro ou fournisseur), choisissez la nature : la clé se propose (douane et assurance à la valeur, le reste au poids).',
          'Tapez le montant, la devise et le taux ; le libellé et la référence externe si vous les avez.',
          'Cliquez « Enregistrer ».',
        ],
        resultat:
          'Le frais apparaît dans « Frais saisis » et le coût rendu de chaque ligne de la réception se recalcule. Il rejoint le CMUP à la clôture de l’arrivage par sa facture fournisseur.',
      },
      {
        titre: 'Lire les écarts de prix',
        etapes: ['En bas, bornez la période avec Du et Au.', 'Lisez les totaux par référence et par fournisseur, puis le détail.'],
      },
    ],
    exemples: [
      {
        titre: 'deux frais, deux clés',
        situation: 'Réception de deux lignes : A 1 000 kg à 20 MAD/kg (20 000 MAD), B 500 kg à 40 MAD/kg (20 000 MAD).',
        calcul: [
          ['Fret 1 500 MAD, au poids', 'A 1 000 · B 500'],
          ['Assurance 400 MAD, à la valeur', 'A 200 · B 200'],
          ['Frais MAD/kg', 'A 1 200 ÷ 1 000 = 1,20 · B 700 ÷ 500 = 1,40'],
          ['Rendu MAD/kg', 'A 21,20 · B 41,40'],
          ['Part frais', 'A 6,0 % · B 3,5 %'],
        ],
        conclusion: 'La matière lourde porte le fret, la matière chère l’assurance : une clé unique aurait faussé l’un ou l’autre.',
      },
    ],
    champs: [
      {
        nom: 'Réception',
        description:
          'Dans le formulaire : la réception validée qui porte le frais (tapez un numéro ou un fournisseur). Dans les tableaux : son numéro, et sa date dessous.',
        obligatoire: true,
      },
      {
        nom: 'Nature',
        description: 'La nature du frais. Elle propose sa clé : douane et assurance à la valeur, fret, manutention et autre au poids.',
        obligatoire: true,
        valeurs: 'FRET, DOUANE, ASSURANCE, MANUTENTION, AUTRE',
        defaut: 'FRET',
      },
      {
        nom: 'Répartition',
        description: 'La clé qui partage le frais entre les lignes de la réception, modifiable.',
        obligatoire: true,
        valeurs: 'Au poids, À la valeur, Par ligne (parts égales)',
        defaut: 'Au poids',
      },
      {
        nom: 'Montant',
        description: 'Dans le formulaire : le montant du frais dans sa devise. Dans « Frais saisis » : ce montant converti en MAD.',
        obligatoire: true,
      },
      { nom: 'Devise', description: 'La devise du frais.', obligatoire: true, defaut: 'MAD' },
      { nom: 'Taux', description: 'Le taux de change vers le dirham ; 1 en MAD. Doit être positif.', obligatoire: true, defaut: '1' },
      { nom: 'Libelle', description: 'Ce que couvre le frais, ex. « Conteneur 40 pieds Izmir-Casablanca ».' },
      { nom: 'Référence externe', description: 'La pièce du frais : facture du transitaire, DUM…' },
      {
        nom: 'Référence',
        description:
          'Dans le coût de revient et les écarts : la référence de la ligne. Dans « Frais saisis » : la référence externe du frais.',
      },
      { nom: 'Fournisseur', description: 'Le fournisseur de la réception.' },
      { nom: 'Quantité', description: 'Les kilos de la ligne de réception entrés en stock.', valeurs: 'kg' },
      { nom: 'Achat MAD/kg', description: 'Le prix d’achat de la ligne, en dirhams par kilo.' },
      { nom: 'Frais MAD/kg', description: 'Les frais d’approche répartis sur la ligne, par kilo. « — » : aucun frais saisi.' },
      { nom: 'Rendu MAD/kg', description: 'Achat + frais, par kilo : le coût de la matière rendue magasin.' },
      { nom: 'Part frais', description: 'Frais ÷ valeur d’achat de la ligne. Au-delà de 10 %, en orange : comparer sur le seul prix d’achat devient trompeur.' },
      { nom: 'Achat', description: 'La valeur d’achat des lignes affichées, en millions de MAD.' },
      { nom: 'Frais d approche', description: 'Le total des frais répartis, en millions de MAD.' },
      { nom: 'Part des frais', description: 'Frais ÷ achat, sur l’ensemble.' },
      { nom: 'Lignes valorisees', description: 'Le nombre de lignes de réception affichées.' },
      { nom: 'Du', description: 'Début de la période des écarts de prix. Vide : depuis le début.' },
      { nom: 'Au', description: 'Fin de la période des écarts de prix. Vide : jusqu’à aujourd’hui.' },
      { nom: 'Date', description: 'Le jour où l’écart de prix a été constaté.' },
      { nom: 'Document', description: 'Le document de l’écart (réception, dossier…), et son circuit : local, import, retour fournisseur.' },
      { nom: 'Origine', description: 'Ce qui a créé l’écart : facture, frais, avoir, avoir de prix, avoir pour retour, facture nette, retour au prix saisi.' },
      { nom: 'Pièce, motif', description: 'Le numéro de la pièce et le motif de l’écart.' },
      { nom: 'Montant (DH)', description: 'Le montant de l’écart : positif = surcoût (rouge), négatif = gain (vert).' },
    ],
    regles: [
      'Le tableau ne montre que les réceptions validées ; tant qu’aucun frais n’est saisi, le coût rendu est le prix d’achat.',
      'Chaque frais se répartit selon sa propre clé, sur les lignes de sa réception : au poids, à la valeur, ou par ligne (parts égales).',
      'Un frais rejoint le CMUP une seule fois, à la clôture de l’arrivage par sa facture fournisseur : la part du stock présent au CMUP, la part des kilos sortis en écart de prix. Ensuite il est figé.',
      'Les frais d’un dossier d’importation n’y figurent pas : ils se lisent dans le dossier.',
      'Écarts de prix : la part d’une facture, d’un frais ou d’un avoir revenue à des kilos déjà sortis ; elle n’est dans aucun stock (positif = surcoût, négatif = gain).',
    ],
    messages: [
      {
        message: 'la reception est en statut … : les frais ne se repartissent que sur une reception validee, dont les poids ne bougent plus',
        cause: 'La réception choisie n’est pas validée.',
      },
      { message: 'le montant ne peut pas etre negatif', cause: 'Montant négatif.' },
      { message: 'le taux de change doit etre positif', cause: 'Taux nul ou négatif.' },
      {
        message: 'FRAIS-PORTE : ce frais est deja passe au CUMP le … : il ne se supprime plus.',
        cause: 'Le frais a été porté au CMUP par la clôture de l’arrivage ; corrigez par un avoir sur la réception.',
      },
    ],
    liens: [
      { route: '/receptions', libelle: 'Réceptions' },
      { route: '/factures-fournisseur', libelle: 'Factures fournisseur' },
      { route: '/valorisation', libelle: 'Valorisation (CMUP)' },
    ],
  },
]
