/**
 * La marque, dans l'interface.
 *
 * TROIS FORMES, TROIS USAGES — et le choix ne tient pas au gout mais a la place
 * disponible :
 *
 *   MarqueCarree   le bloc « POLYFASHIONS CARPET S.A.R.L. » de la carte de
 *                  visite. Son texte est HORIZONTAL et gros : c'est la seule
 *                  version qui reste reconnaissable a 32 px. Elle sert partout
 *                  ou la place est comptee — barre laterale, entete.
 *
 *   LogoLarge      le tapis avec le nom courbe autour. Beau et fidele, mais
 *                  2,2 fois plus large que haut, et ses lettres suivent une
 *                  courbe : en dessous de 40 px de hauteur, « POLYFASHIONS
 *                  CARPET » devient une bouillie grise. Reserve aux endroits
 *                  qui ont de la place — ecran de connexion, en-tete de
 *                  document imprime.
 *
 *   SigleTapis     le tapis seul, redessine en SVG. Il suit `currentColor` et
 *                  reste net a toute taille, la ou une image reduite bavouille.
 *
 * ON NE MET JAMAIS LE SIGLE ET LE LOGO COTE A COTE : le tapis est deja DANS le
 * logo, les poser ensemble affiche deux fois la meme forme a dix pixels
 * d'ecart.
 */

/**
 * Le bloc carre de la marque.
 *
 * Il porte sa propre couleur de fond — c'est un bloc plein, pas un trait — donc
 * il se pose aussi bien sur un fond clair que sombre, sans variante.
 */
export function MarqueCarree({ className }: { className?: string }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}marque-polyfashions.png`}
      alt="Polyfashions Carpet"
      className={className}
      width={562}
      height={520}
    />
  )
}

/**
 * Le logo large, prune ou blanc selon le fond.
 *
 * Le composant ne devine pas le theme : c'est l'appelant qui sait sur quoi il
 * pose la marque, et une barre peut etre sombre dans un theme clair.
 */
export function LogoLarge({
  sombre = false,
  className,
}: {
  sombre?: boolean
  className?: string
}) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}${
        sombre ? 'logo-polyfashions-blanc.png' : 'logo-polyfashions.png'
      }`}
      alt="Polyfashions Carpet"
      className={className}
      // Les dimensions natives evitent que la mise en page saute pendant le
      // chargement — un decalage de 40 px au demarrage se voit.
      width={988}
      height={458}
    />
  )
}

/** Le tapis du logo, redessine. Il suit `currentColor`. */
export function SigleTapis({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
    >
      <path d="M11.5 6.5 L27 11 L20.5 25.5 L5 21 Z" strokeWidth="4.2" />
      <path d="M1 12.5 L31 20" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
    </svg>
  )
}
