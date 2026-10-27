/**
 * FICHES D'AIDE — FICHES RÉSERVÉES — plan d’achat, stock projeté, transferts, tableau de bord (en cours de refonte ailleurs).
 *
 * Une partie du catalogue : `../contenu.ts` les assemble, `../types.ts` donne
 * la forme d'une fiche. Chaque `champs[].nom` est l'intitulé EXACT de l'écran :
 * c'est par lui que l'indice ⓘ se pose à côté du champ (`../indice.ts`).
 */
import type { Sujet } from '../types.ts'

export const FICHES_RESERVEES: Sujet[] = [
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
      'Le mois en cours ne compte que ses jours restants ; au-delà du dernier mois du plan, la demande se prolonge à la moyenne du plan (P_HorizonProlonge).',
      'Une commande en retard reste dans l’en-cours (P_EncoursRetardInclus) : on la relance, on ne la rachète pas. La marchandise d’import facturée et non reçue compte aussi.',
    ],
    liens: [
      { route: '/besoins', libelle: 'Besoins (MRP)' },
      { route: '/bons-commande', libelle: 'Bons de commande' },
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
]
