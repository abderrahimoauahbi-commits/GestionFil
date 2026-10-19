/**
 * L'IDENTIFIANT D'UN DOCUMENT, TIRE PAR L'ECRAN (audit P3, 19/10/2026).
 *
 * Le formulaire de creation le tire a son ouverture et l'envoie a chaque
 * tentative d'enregistrement. Si le reseau coupe apres que le serveur a ecrit,
 * le second appui sur « Enregistrer » rend le MEME document (le serveur le relit
 * et repond `deja_enregistre`) au lieu d'en creer un second.
 *
 * `crypto.randomUUID` n'existe que dans un contexte sur (https, localhost,
 * Tauri) : un poste qui ouvre l'ecran de developpement par l'adresse du reseau,
 * en http, ne l'a pas. `crypto.getRandomValues`, lui, existe partout ; on en
 * fait un UUID version 4, la forme que le serveur exige.
 *
 * Module PUR, sans React, pour etre teste par `node --test`.
 */
export function nouvelIdentifiant(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const o = c.getRandomValues(new Uint8Array(16))
  o[6] = (o[6] & 0x0f) | 0x40 // version 4
  o[8] = (o[8] & 0x3f) | 0x80 // variante RFC 4122
  const h = Array.from(o, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
