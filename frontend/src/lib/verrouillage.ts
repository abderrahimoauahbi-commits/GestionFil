/**
 * LE VERROU D'INSPECTION — et ce qu'il vaut vraiment.
 *
 * CE QU'IL FAIT. Il retire les gestes qui ouvrent les outils du navigateur :
 * F12, Ctrl+Maj+I, Ctrl+Maj+C, Ctrl+Maj+J, Ctrl+U (le code source), et le menu
 * du clic droit. Un employe qui tatonne ne tombera pas dessus par curiosite.
 *
 * CE QU'IL NE FAIT PAS, ET IL FAUT LE DIRE. Dans un NAVIGATEUR, ceci est une
 * BARRIERE DE POLITESSE, pas une securite. Les outils s'ouvrent aussi par le
 * menu du navigateur, par un raccourci que l'on n'a pas prevu, ou en desactivant
 * le JavaScript — et rien de ce qui s'execute dans la page ne peut l'empecher.
 * Promettre l'inverse serait mentir sur la protection reelle des donnees.
 *
 * CE QUI PROTEGE VRAIMENT, ce sont trois choses qui ne vivent pas ici :
 *
 *   1. LES DROITS PAR ROLE ET PAR CHAMP, appliques par le SERVEUR. Un prix
 *      masque pour le magasin n'est pas cache a l'ecran : il n'est jamais
 *      envoye. Ouvrir les outils ne le fera pas apparaitre.
 *   2. L'APPLICATION INSTALLEE. Son webview est compile SANS les outils de
 *      developpement : ils n'existent pas dans le programme, il n'y a donc rien
 *      a contourner. C'est la seule fermeture qui en soit une.
 *   3. LE RESEAU. Le serveur n'est joignable que du reseau local ou par le VPN.
 *
 * Ce fichier ferme donc une porte qui ne tient pas toute seule. Il la ferme
 * quand meme, parce qu'une porte fermee dit quelque chose : ceci n'est pas a
 * regarder.
 */

/** Les combinaisons qui ouvrent l'inspecteur, ou le code source. */
function estUnGesteDInspection(e: KeyboardEvent): boolean {
  if (e.key === 'F12') return true
  if (e.ctrlKey && e.shiftKey && ['I', 'C', 'J', 'K'].includes(e.key.toUpperCase())) return true
  // Ctrl+U : afficher la source. Ctrl+S : enregistrer la page, qui revient au
  // meme pour qui veut la lire hors ligne.
  if (e.ctrlKey && !e.shiftKey && ['U', 'S'].includes(e.key.toUpperCase())) return true
  return false
}

/**
 * Pose le verrou. Sans effet si on est deja dans l'application installee, ou
 * plutot : sans effet UTILE, puisque les outils n'y sont pas compiles.
 */
export function poserVerrouInspection(): void {
  if (typeof window === 'undefined') return

  window.addEventListener(
    'keydown',
    (e) => {
      if (!estUnGesteDInspection(e)) return
      e.preventDefault()
      e.stopPropagation()
    },
    // EN CAPTURE, et non en bulle : autrement un champ de saisie qui traite la
    // touche avant nous laisserait passer le geste.
    { capture: true },
  )

  window.addEventListener(
    'contextmenu',
    (e) => {
      // LE MENU CONTEXTUEL DE L'APPLICATION RESTE. Les ecrans qui en posent un
      // — le catalogue, le stock — le declarent eux-memes ; les bloquer tous
      // retirerait des raccourcis de travail pour empecher un clic droit sur du
      // vide, ce qui n'est pas le marche.
      const cible = e.target as HTMLElement | null
      if (cible?.closest('[data-menu-contextuel]')) return
      // Le copier-coller reste possible dans un champ de saisie : on ne
      // complique pas la saisie pour gener la lecture.
      if (cible?.closest('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
    },
    { capture: true },
  )
}
