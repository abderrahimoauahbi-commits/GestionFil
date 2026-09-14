/**
 * LE MODELE D'UNE FICHE D'AIDE.
 *
 * Il suit la forme que les grands ERP ont fixee — SAP, Oracle, Odoo — parce
 * qu'elle repond aux questions dans l'ordre ou elles se posent :
 *
 *   1. a quoi sert cet ecran (objectif) ;
 *   2. que faut-il avant d'y venir (prerequis) ;
 *   3. comment fait-on (procedure numerotee, avec son resultat) ;
 *   4. que veut dire ce champ (tableau des champs) ;
 *   5. pourquoi l'outil refuse (regles et messages) ;
 *   6. ou aller ensuite (ecrans lies).
 *
 * UNE SEULE SOURCE, DEUX LECTEURS. Ce catalogue alimente l'aide contextuelle
 * de chaque ecran ET le manuel imprimable. Deux textes qui disent la meme
 * chose divergent le jour ou l'un est corrige seul.
 *
 * LE TABLEAU DES CHAMPS EST LE COEUR. C'est ce qui distingue une documentation
 * d'ERP d'une page de presentation : la personne qui hesite devant une case ne
 * cherche pas un discours, elle cherche ce que cette case attend.
 */

/** Un champ de saisie, tel que la fiche le decrit. */
export interface ChampAide {
  /** L'intitule EXACTEMENT tel qu'il est ecrit a l'ecran. */
  nom: string
  description: string
  /** Vrai quand l'enregistrement est refuse sans lui. */
  obligatoire?: boolean
  /** Les valeurs admises, ou l'unite attendue. */
  valeurs?: string
  /** Ce que l'outil propose quand on ne saisit rien. */
  defaut?: string
}

/** Une marche a suivre, numerotee, avec ce qu'elle produit. */
export interface Procedure {
  titre: string
  etapes: string[]
  /** L'etat dans lequel on se trouve une fois la procedure finie. */
  resultat?: string
}

/** Un refus de l'outil, et sa raison. */
export interface MessageAide {
  message: string
  cause: string
}

/** La fiche d'un ecran. */
export interface Sujet {
  /** La route de l'ecran : c'est par elle que l'aide se trouve. */
  route: string
  titre: string
  /** Le chemin dans le menu, tel qu'on le suit des yeux. */
  chemin: string
  /** Une phrase : ce que l'ecran permet de faire. */
  objectif: string
  /** Ce qui doit exister avant de venir ici. */
  prerequis?: string[]
  /** Le droit necessaire, dit en clair. */
  droits?: string
  procedures?: Procedure[]
  champs?: ChampAide[]
  /** Les regles de gestion que l'ecran applique. */
  regles?: string[]
  messages?: MessageAide[]
  /** Les ecrans ou l'on va avant, ou apres. */
  liens?: { route: string; libelle: string }[]
}
