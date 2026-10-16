// Applique le theme AVANT le premier rendu : sans cela, un utilisateur en
// mode sombre voit un eclair blanc a chaque chargement.
// FICHIER A PART, ET NON SCRIPT EN LIGNE (13/10/2026) : la politique de
// contenu du serveur (CSP) refuse tout script ecrit dans la page.
;(function () {
  try {
    var choix = localStorage.getItem('gestionfil.theme') || 'systeme'
    var sombre =
      choix === 'sombre' ||
      (choix === 'systeme' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    if (sombre) document.documentElement.classList.add('sombre')
    // Le style choisi, pose avant le premier rendu lui aussi.
    var ap = JSON.parse(localStorage.getItem('gestionfil.apparence') || '{}')
    if (ap.charte) document.documentElement.setAttribute('data-charte', ap.charte)
  } catch (e) {}
})()
