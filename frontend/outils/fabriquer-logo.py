# -*- coding: utf-8 -*-
"""
Prepare le logo Polyfashions Carpet pour l'application.

LA SOURCE EST UN BITMAP SUR FOND BLANC. Pose tel quel sur l'ecran de connexion,
il y ferait un rectangle blanc au milieu du verre — exactement ce qu'un logo ne
doit pas faire. Deux versions sont donc produites :

  * `logo-polyfashions.png`        prune sur fond TRANSPARENT, pour les fonds
                                   clairs et les documents imprimes ;
  * `logo-polyfashions-blanc.png`  blanc sur fond transparent, pour l'ecran de
                                   connexion et tout fond sombre.

LE DETOURAGE SE FAIT SUR LA LUMINOSITE, pas sur une couleur exacte. Un bitmap
enregistre depuis un logiciel de dessin porte des pixels d'anti-crenelage —
des gris intermediaires entre le trait et le fond. Les traiter comme du fond
laisserait un liseré blanc autour des lettres ; les traiter comme du trait
laisserait un halo. On les rend donc PARTIELLEMENT transparents, en proportion
de leur clarte : c'est ce qui donne un bord net a n'importe quelle taille.

Usage :
    python outils/fabriquer-logo.py
"""
from pathlib import Path

from PIL import Image

SOURCE = Path(r"C:\Users\vboxuser\Desktop\carte visite\logo.bmp")
SORTIE = Path(__file__).resolve().parent.parent / "public"

# La couleur de la marque, relevee sur le logo d'origine.
PRUNE = (0x59, 0x27, 0x40)


def detourer(im, couleur):
    """Rend le fond transparent, en gardant l'anti-crenelage."""
    im = im.convert("RGB")
    largeur, hauteur = im.size
    sortie = Image.new("RGBA", (largeur, hauteur))
    src = im.load()
    dst = sortie.load()

    for y in range(hauteur):
        for x in range(largeur):
            r, v, b = src[x, y]
            # Clarte perceptuelle : le vert compte plus que le bleu pour l'oeil.
            clarte = (0.299 * r + 0.587 * v + 0.114 * b) / 255.0
            # Un pixel clair est du fond, un pixel sombre est du trait. Entre les
            # deux, l'opacite suit la clarte — c'est l'anti-crenelage conserve.
            alpha = int(round((1.0 - clarte) * 255))
            dst[x, y] = (couleur[0], couleur[1], couleur[2], alpha)
    return sortie


def rogner(im):
    """Retire les marges transparentes : le logo doit remplir son cadre."""
    boite = im.getbbox()
    return im.crop(boite) if boite else im


SORTIE.mkdir(parents=True, exist_ok=True)
source = Image.open(SOURCE)
print("source : %s  %sx%s" % (SOURCE.name, source.size[0], source.size[1]))

for nom, couleur in (
    ("logo-polyfashions.png", PRUNE),
    ("logo-polyfashions-blanc.png", (255, 255, 255)),
):
    im = rogner(detourer(source, couleur))
    # Deux fois la taille d'affichage : net sur un ecran a forte densite.
    im = im.resize((im.size[0] * 2, im.size[1] * 2), Image.LANCZOS)
    chemin = SORTIE / nom
    im.save(chemin, optimize=True)
    print("  %-30s %sx%s  %d octets" % (nom, im.size[0], im.size[1],
                                        chemin.stat().st_size))
