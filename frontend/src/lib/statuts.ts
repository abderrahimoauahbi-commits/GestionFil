/**
 * Ou un document s'efface vraiment, et ou il ne fait que s'annuler.
 *
 * UN BROUILLON N'A QUE DEUX ISSUES : on le complete, ou il disparait.
 * L'annuler en le laissant en base ne prouve rien — son numero n'a jamais rien
 * engage — et encombre durablement les listes et les etats d'un document mort
 * que personne ne sait plus pourquoi il est la.
 *
 * L'ANNULATION GARDE TOUT SON SENS PLUS LOIN. Des qu'un bon est VALIDE, son
 * numero est parti chez un fournisseur : l'effacer creerait dans la sequence un
 * trou qu'aucun controle ne saurait expliquer, et c'est exactement ce qu'un
 * auditeur cherche. La frontiere est donc le BROUILLON : un bon soumis (controle,
 * demande de prix, attente de validation) est fige et se renvoie ou s'annule.
 *
 * LE SERVEUR TIENT DEJA CETTE REGLE (`supprimer_bc`, backend/src/routes/stock.rs)
 * et refuse au-dela. Ce qui est ici n'a pas le dernier mot : c'est la politesse
 * de ne pas proposer un geste qui serait refuse, et la raison pour laquelle les
 * deux ecrans ne peuvent plus diverger.
 */

/** `string[]` ET NON `as const` : ces valeurs se comparent a un statut recu du
 *  serveur, donc a une `string`. Fige en tuple litteral, `includes` refuserait
 *  l'argument et obligerait a un transtypage a chaque appel. */
// LE BROUILLON SEUL (21/10/2026) : au controle, en demande de prix ou en attente
// de validation, le bon est fige — il se renvoie en brouillon, ou s'annule.
export const SUPPRIMABLES: string[] = ['BROUILLON']

export const estSupprimable = (statut: string) => SUPPRIMABLES.includes(statut)

// =============================================================================
// LA TABLE DES STATUTS MÉTIER (P2, 24/10/2026)
// =============================================================================

/**
 * UN STATUT S'AFFICHE EN LIBELLÉ + COULEUR, TIRÉS D'ICI ET DE NULLE PART AILLEURS.
 *
 * Avant cette table, vingt-neuf petits dictionnaires disaient chacun à leur
 * façon ce que valait un code : CRITIQUE était rouge sur le stock projeté et
 * ambre sur l'état du stock, CLOTURE vert sur le bon et bleu sur la réception,
 * et plusieurs écrans montraient le code brut (A_CONTROLER, VALIDEE, ACTIF).
 * Le composant `StatutBadge` (composants/StatutBadge.tsx) lit cette table.
 *
 * D'OÙ VIENNENT LES CODES : de la BASE, jamais d'ici. Chaque entité nomme sa
 * source (`SOURCE_STATUTS`) : une contrainte CHECK de `db/pg` (schéma puis
 * migrations, la dernière définition faisant foi ; les passages permis sont
 * dans la table `transition_statut`), ou, pour les deux statuts calculés, la
 * vue ou la route qui les écrit. Le test `tests/statuts.test.ts` relit ces
 * sources et échoue si un code de la base n'a pas son libellé ici. Aucun code
 * n'est inventé ; un code inconnu (une migration à venir) s'affiche HUMANISÉ
 * (« A_CONTROLER » → « A controler ») avec le ton neutre — jamais brut.
 *
 * LA CORRESPONDANCE DES TONS — une même sémantique, un même ton, quelle que
 * soit l'entité :
 *
 *   neutre  brouillon, en saisie, prévu ; clôturé, soldé, terminé, reçu,
 *           complet, écarté — rien à faire, rien d'anormal (l'historique)
 *   info    en cours : demande de prix, envoyé, lancé, livré en partie,
 *           simulation, en révision, proposé
 *   succès  validé, actif, en service, libre, accordé, conforme, stock normal
 *   alerte  à contrôler, en attente d'une décision ou du geste d'un autre
 *           compte (validation, transit), attention, quarantaine
 *   danger  refusé, annulé, critique, rupture, bloqué, en retard, en panne
 *   or      un rang (classe A), pas un état
 *
 * INCOHÉRENCES TRANCHÉES le 24/10/2026 :
 *   - CRITIQUE (stock) : danger partout (était ambre sur l'état du stock).
 *   - CLOTURE : neutre partout (était succès sur le bon, l'OF, l'inventaire et
 *     le dossier d'import ; info sur la réception ; contour sur plans et
 *     qualités). TERMINE (transfert), COMMANDE (plan d'achat), COMPLET
 *     (livraison), RECUE (facture d'import) : neutre, pour la même raison.
 *   - VALIDE : succès partout (était info sur le bon, l'inventaire, le plan
 *     d'achat). Exception assumée : VALIDE d'un transfert veut dire « parti,
 *     pas encore reçu » — en transit, il attend le geste du magasin
 *     destinataire : alerte, comme avant.
 *   - EN_COURS d'un plan de production = mis en service par la direction
 *     (date de validation exigée par la base) : succès ; EN_COURS d'un dossier
 *     d'import = en cours : info.
 *   - ANNULE : danger partout (était neutre sur l'OF).
 *   - LANCE (OF), LIVRE_PARTIEL (bon), PARTIEL (livraison, facture d'import) :
 *     en cours, info (étaient alerte) ; le RETARD a son propre ton, danger.
 *   - Classe ABC : or / info / neutre partout (était rouge / ambre / gris au
 *     catalogue).
 */

/** Les tons que peut prendre un statut : un sous-ensemble de ceux du `Badge`. */
export type TonStatut = 'neutre' | 'info' | 'succes' | 'alerte' | 'danger' | 'or'

export interface DefStatut {
  libelle: string
  ton: TonStatut
}

const d = (libelle: string, ton: TonStatut): DefStatut => ({ libelle, ton })

export const STATUTS = {
  /** bon_commande.statut */
  bon_commande: {
    BROUILLON: d('Brouillon', 'neutre'),
    EN_CONTROLE: d('Au contrôle', 'alerte'),
    DEMANDE_PRIX: d('Demande de prix', 'info'),
    EN_ATTENTE_VALIDATION: d('En attente de validation', 'alerte'),
    VALIDE: d('Validé', 'succes'),
    ENVOYE: d('Envoyé', 'info'),
    LIVRE_PARTIEL: d('Livré en partie', 'info'),
    CLOTURE: d('Clôturé', 'neutre'),
    ANNULE: d('Annulé', 'danger'),
  },
  /** ligne_bc.statut */
  ligne_bc: {
    EN_ATTENTE: d('En attente', 'info'),
    PARTIEL: d('Reçue en partie', 'info'),
    SOLDE: d('Soldée', 'neutre'),
    ANNULE: d('Annulée', 'danger'),
  },
  /** statut_livraison, calculé par la liste des bons (routes/bons_commande.rs). */
  livraison_bc: {
    'SANS OBJET': d('Sans objet', 'neutre'),
    ATTENDU: d('Attendu', 'info'),
    PARTIEL: d('Partiel', 'info'),
    'PARTIEL EN RETARD': d('Partiel en retard', 'danger'),
    'EN RETARD': d('En retard', 'danger'),
    COMPLET: d('Complet', 'neutre'),
  },
  /** reception.statut */
  reception: {
    BROUILLON: d('En saisie', 'neutre'),
    A_CONTROLER: d('À contrôler', 'alerte'),
    VALIDE: d('Validée', 'succes'),
    CLOTURE: d('Clôturée', 'neutre'),
    ANNULE: d('Annulée', 'danger'),
  },
  /** ligne_reception.statut_qualite (même vocabulaire : ligne_mouvement, import_reception_lignes) */
  statut_qualite: {
    CONFORME: d('Conforme', 'succes'),
    QUARANTAINE: d('Quarantaine', 'alerte'),
    NON_CONFORME: d('Non conforme', 'danger'),
  },
  /** facture_fournisseur.statut */
  facture_fournisseur: {
    BROUILLON: d('Brouillon', 'neutre'),
    VALIDEE: d('Validée', 'succes'),
    ANNULEE: d('Annulée', 'danger'),
  },
  /** retour_fournisseur.statut */
  retour_fournisseur: {
    BROUILLON: d('Brouillon', 'neutre'),
    VALIDE: d('Validé', 'succes'),
  },
  /** import_dossiers.statut */
  dossier_import: {
    BROUILLON: d('Brouillon', 'neutre'),
    EN_COURS: d('En cours', 'info'),
    CLOTURE: d('Clôturé', 'neutre'),
  },
  /** import_factures.statut_reception */
  reception_facture_import: {
    NON_RECUE: d('Non reçue', 'neutre'),
    PARTIELLE: d('Partielle', 'info'),
    RECUE: d('Reçue', 'neutre'),
  },
  /** import_receptions.statut (ancien circuit, écran retiré le 16/10) */
  reception_import: {
    BROUILLON: d('En saisie', 'neutre'),
    A_CONTROLER: d('À contrôler', 'alerte'),
    VALIDEE: d('Validée', 'succes'),
    ANNULEE: d('Annulée', 'danger'),
  },
  /** inventaire.statut */
  inventaire: {
    BROUILLON: d('Brouillon', 'neutre'),
    VALIDE: d('Validé', 'succes'),
    CLOTURE: d('Clôturé', 'neutre'),
    ANNULE: d('Annulé', 'danger'),
  },
  /** ligne_inventaire.statut_ligne */
  ligne_inventaire: {
    A_TRAITER: d('À traiter', 'alerte'),
    COMPTE: d('Comptée', 'info'),
    AJUSTE: d('Ajustée', 'succes'),
    IGNORE: d('Ignorée', 'neutre'),
  },
  /** ordre_fabrication.statut */
  ordre_fabrication: {
    PREVU: d('Prévu', 'neutre'),
    LANCE: d('Lancé', 'info'),
    CLOTURE: d('Clôturé', 'neutre'),
    ANNULE: d('Annulé', 'danger'),
  },
  /** plan_production.statut */
  plan_production: {
    BROUILLON: d('Brouillon', 'neutre'),
    SIMULATION: d('Simulation', 'info'),
    EN_COURS: d('En cours', 'succes'),
    CLOTURE: d('Clôturé', 'neutre'),
  },
  /** plan_achat.statut — une proposition d'achat */
  plan_achat: {
    PROPOSE: d('Proposée', 'info'),
    EN_REVISION: d('En révision', 'info'),
    VALIDE: d('Validée', 'succes'),
    COMMANDE: d('Commandée', 'neutre'),
    IGNORE: d('Écartée', 'neutre'),
    /** Close avec son bon annulé (décision du 27/10/2026) : liée à lui, plus ouverte, état final. */
    ANNULE_BC: d('Annulée avec le bon', 'danger'),
  },
  /** plan_achat.urgence */
  urgence_achat: {
    'TIER 1': d('Tier 1', 'danger'),
    'TIER 2': d('Tier 2', 'alerte'),
    'TIER 3': d('Tier 3', 'info'),
    'TIER 4': d('Tier 4', 'neutre'),
  },
  /** transfert.statut — VALIDE se dit « En transit » : la marchandise a quitté
   *  la source et n'est arrivée nulle part ; personne ne doit compter sur un
   *  stock qui roule encore. Le seul état qui attend le geste d'un AUTRE. */
  transfert: {
    BROUILLON: d('En préparation', 'neutre'),
    VALIDE: d('En transit', 'alerte'),
    TERMINE: d('Reçu', 'neutre'),
    ANNULE: d('Annulé', 'danger'),
  },
  /** lot.statut */
  lot: {
    LIBRE: d('Libre', 'succes'),
    BLOQUE: d('Bloqué', 'danger'),
    SOLDE: d('Soldé', 'neutre'),
  },
  /** qualite.statut — c'est aussi le statut qu'affichent les recettes. */
  qualite: {
    BROUILLON: d('Brouillon', 'neutre'),
    ACTIF: d('Active', 'succes'),
    CLOTURE: d('Clôturée', 'neutre'),
  },
  /** machine.etat */
  machine: {
    ACTIVE: d('Active', 'succes'),
    PANNE: d('En panne', 'danger'),
    SOMMEIL: d('En sommeil', 'neutre'),
    RETIREE: d('Retirée', 'neutre'),
  },
  /** machine_fiche.statut */
  fiche_machine: {
    BROUILLON: d('Brouillon', 'neutre'),
    VALIDE: d('Validée', 'succes'),
    ANNULE: d('Annulée', 'danger'),
  },
  /** machine_decision.statut */
  decision_machine: {
    ACTIVE: d('En vigueur', 'succes'),
    RETIREE: d('Retirée', 'neutre'),
    ANNULEE: d('Annulée', 'danger'),
  },
  /** demande_autorisation.statut — la dérogation sur un lot */
  demande_autorisation: {
    EN_ATTENTE: d('En attente', 'alerte'),
    ACCORDEE: d('Accordée', 'succes'),
    REFUSEE: d('Refusée', 'danger'),
    ANNULEE: d('Annulée', 'danger'),
  },
  /** alerte.statut */
  alerte: {
    OUVERTE: d('Ouverte', 'alerte'),
    ACQUITTEE: d('Acquittée', 'info'),
    RESOLUE: d('Résolue', 'neutre'),
    IGNOREE: d('Ignorée', 'neutre'),
  },
  /**
   * L'ÉTAT D'UNE RÉFÉRENCE AU MOTEUR DE COUVERTURE v2 (§ 15.4, 27/10/2026, une
   * seule source de vérité) — le plus grave l'emporte : rupture inévitable (la
   * 1re rupture tombe avant aujourd'hui + délai), sous la sécurité (creux sous le
   * seuil dans le délai), sous la cible (couverture actuelle < couverture cible),
   * couvert. Les signaux sont à part (`signal_couverture`).
   *
   * Et snapshot_mrp.statut_couleur — L'ÉTAT D'UN MOIS de la frise : plan non
   * couvert (une part du plan du mois n'est pas couverte), sous la sécurité,
   * couvert. Les quatre codes de l'ancien calcul (v_stock_projete, retiré) ne
   * restent que pour lire l'historique des photos de plan.
   */
  statut_stock: {
    RUPTURE_INEVITABLE: d('Rupture inévitable', 'danger'),
    SOUS_SECURITE: d('Sous sécurité', 'alerte'),
    SOUS_CIBLE: d('Sous cible', 'info'),
    COUVERT: d('Couvert', 'succes'),
    PLAN_NON_COUVERT: d('Plan non couvert', 'danger'),
    RUPTURE: d('Rupture (ancien calcul)', 'danger'),
    CRITIQUE: d('Critique (ancien calcul)', 'danger'),
    ATTENTION: d('Attention (ancien calcul)', 'alerte'),
    OK: d('OK (ancien calcul)', 'succes'),
  },
  /**
   * LES SIGNAUX DU MOTEUR DE COUVERTURE (§ 15.4) : indépendants de l'état, ils
   * ne bloquent jamais. Affichés en pastilles, à côté de l'état.
   */
  signal_couverture: {
    CIBLE_NON_DEFINIE: d('Cible non définie', 'alerte'),
    SOUS_MINIMUM: d('Sous le minimum', 'alerte'),
    RETARD_CIBLE: d('Retard sur la cible', 'alerte'),
    HORIZON_COURT: d('Horizon court', 'neutre'),
    DEFAUT_DONNEES: d('Donnée manquante', 'neutre'),
  },
  /** alerte.gravite — le même vocabulaire que la criticité des contrôles (v_controles). */
  criticite: {
    INFO: d('Info', 'info'),
    ATTENTION: d('Attention', 'alerte'),
    CRITIQUE: d('Critique', 'danger'),
    BLOQUANT: d('Bloquant', 'danger'),
  },
  /** La qualification d'un groupe d'équivalence, calculée par v_groupe_equiv_detail. */
  qualification_equivalence: {
    ALTERNATIF: d('Alternative réelle', 'succes'),
    'MONO-REFERENCE': d('Une seule réf.', 'neutre'),
    'MEME FOURNISSEUR': d('Même fournisseur', 'alerte'),
    HETEROGENE: d('Hétérogène', 'danger'),
  },
  /** reference.classe_abc — un rang, pas un état. */
  classe_abc: {
    A: d('A', 'or'),
    B: d('B', 'info'),
    C: d('C', 'neutre'),
  },
} satisfies Record<string, Record<string, DefStatut>>

export type EntiteStatut = keyof typeof STATUTS

/**
 * OÙ LA BASE DIT QUELS CODES EXISTENT. `table.colonne` : une contrainte CHECK
 * de db/pg. `calcule:fichier#nom` : un code écrit par une vue ou une route,
 * que le test relit à sa source.
 */
export const SOURCE_STATUTS: Record<EntiteStatut, string> = {
  bon_commande: 'bon_commande.statut',
  ligne_bc: 'ligne_bc.statut',
  livraison_bc: 'calcule:backend/src/routes/bons_commande.rs#statut_livraison',
  reception: 'reception.statut',
  statut_qualite: 'ligne_reception.statut_qualite',
  facture_fournisseur: 'facture_fournisseur.statut',
  retour_fournisseur: 'retour_fournisseur.statut',
  dossier_import: 'import_dossiers.statut',
  reception_facture_import: 'import_factures.statut_reception',
  reception_import: 'import_receptions.statut',
  inventaire: 'inventaire.statut',
  ligne_inventaire: 'ligne_inventaire.statut_ligne',
  ordre_fabrication: 'ordre_fabrication.statut',
  plan_production: 'plan_production.statut',
  plan_achat: 'plan_achat.statut',
  urgence_achat: 'plan_achat.urgence',
  transfert: 'transfert.statut',
  lot: 'lot.statut',
  qualite: 'qualite.statut',
  machine: 'machine.etat',
  fiche_machine: 'machine_fiche.statut',
  decision_machine: 'machine_decision.statut',
  demande_autorisation: 'demande_autorisation.statut',
  alerte: 'alerte.statut',
  // Les états d'un mois (la photo) ET ceux d'une référence (le moteur v2).
  statut_stock: 'snapshot_mrp.statut_couleur+moteur:backend/src/domain/couverture.rs#etat',
  signal_couverture: 'moteur:backend/src/domain/couverture.rs#signal',
  criticite: 'alerte.gravite',
  qualification_equivalence: 'calcule:db/pg/011_vues.sql#qualification',
  classe_abc: 'reference.classe_abc',
}

/**
 * Un code inconnu, lisible : « A_CONTROLER » → « A controler », « MEME
 * FOURNISSEUR » → « Meme fournisseur ». Il ne sait pas remettre les accents —
 * c'est pourquoi chaque code de la base a son libellé dans la table.
 */
export function humaniser(code: string): string {
  const mots = code.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  return mots ? mots.charAt(0).toUpperCase() + mots.slice(1) : ''
}

/** Le libellé et le ton d'un code ; un code inconnu est humanisé, ton neutre. */
export function statutMetier(entite: EntiteStatut, code: string | null | undefined): DefStatut {
  const c = String(code ?? '')
  const table: Record<string, DefStatut> = STATUTS[entite]
  return Object.prototype.hasOwnProperty.call(table, c) ? table[c] : { libelle: humaniser(c), ton: 'neutre' }
}

export const libelleStatut = (entite: EntiteStatut, code: string | null | undefined) =>
  statutMetier(entite, code).libelle

export const tonStatut = (entite: EntiteStatut, code: string | null | undefined) =>
  statutMetier(entite, code).ton

/** Les codes connus d'une entité, dans l'ordre de la table (pour un filtre, un menu). */
export const codesStatut = (entite: EntiteStatut): string[] => Object.keys(STATUTS[entite])

/** La couleur de TEXTE d'un ton (un code de contrôle, un chiffre), en jetons du thème. */
export const TEXTE_TON: Record<TonStatut, string> = {
  neutre: 'text-attenue-texte',
  info: 'text-info',
  succes: 'text-succes',
  alerte: 'text-alerte',
  danger: 'text-danger',
  or: 'text-or',
}

/**
 * Le ton d'une `Alerte` : elle n'a ni neutre ni or — un état calme s'y annonce
 * en information.
 */
export const tonAlerte = (ton: TonStatut): 'info' | 'succes' | 'alerte' | 'danger' =>
  ton === 'neutre' || ton === 'or' ? 'info' : ton
