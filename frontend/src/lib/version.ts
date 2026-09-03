/**
 * La version de l'application, et les mentions qui l'accompagnent.
 *
 * ELLE VIENT DE `package.json`, PAS D'UNE CONSTANTE ECRITE A LA MAIN. Deux
 * numeros de version dans un depot finissent toujours par diverger, et c'est
 * celui qui s'affiche a l'ecran qui se trompe — celui du paquet, lui, est
 * verifie a chaque publication.
 *
 * Vite remplace `__VERSION__` a la compilation (voir vite.config.ts) : la
 * valeur est donc figee dans le fichier livre, sans lecture au demarrage.
 */

/** Numero de version, ex. « 0.1.0 ». */
export const VERSION: string = __VERSION__

/** Raison sociale, telle qu'elle doit apparaitre sur les ecrans et les etats. */
export const SOCIETE = 'Polyfashions Carpet'

/** Auteur du logiciel. */
export const AUTEUR = 'Abderrahim Ouahabi'
