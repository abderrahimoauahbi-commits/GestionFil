# -*- coding: utf-8 -*-
"""
Fabrique les images de fond de la famille « Verre ».

POURQUOI UNE IMAGE ET NON DES DEGRADES CSS. Un empilement de `radial-gradient`
floute par `filter` coute un repaint sur toute la surface a chaque
redimensionnement, et le flou de 60 px est recalcule par le compositeur en
permanence. Une image est decodee une fois. Sur un poste de magasin modeste,
c'est la difference entre une interface fluide et une interface qui accroche.

Et surtout : c'est ce que fait Glazzed. Le decor est une PHOTOGRAPHIE HORS DE
MISE AU POINT sur laquelle des panneaux translucides se detachent. Un degrade
CSS, aussi soigne soit-il, garde une regularite mathematique que l'oeil detecte.
Une image construite avec du bruit, des nappes irregulieres et un vignettage ne
l'a pas.

CE QUE FAIT CE SCRIPT :
  1. il pose des nappes de lumiere colorees a des positions irregulieres ;
  2. il les floute fortement — c'est le flou qui fait le decor, pas les nappes ;
  3. il ajoute un grain fin, qui casse les bandes de couleur des ecrans 8 bits
     et donne la texture d'une photographie ;
  4. il assombrit les bords (vignettage), ce que fait tout objectif ;
  5. il enregistre en JPEG de qualite 88 — un decor flou se compresse tres bien,
     et le format est decode materiellement partout.

Usage :
    python outils/fabriquer-fonds.py
"""
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

# 1920x1080 suffit : l'image est floue, donc l'etirer sur un ecran plus large ne
# se voit pas. Une 4K pesarait quatre fois plus pour rien.
LARGEUR, HAUTEUR = 1920, 1080

SORTIE = Path(__file__).resolve().parent.parent / "public"


def nappe(forme, centre, rayon, couleur, intensite):
    """Une nappe de lumiere : un halo doux, en chute quadratique.

    La chute en `1 - d**2` donne un bord plus franc au centre et plus doux en
    peripherie qu'une chute lineaire — c'est ainsi que se comporte une source
    lumineuse reelle, et c'est ce qui evite l'aspect « rond peint ».
    """
    h, l = forme
    cx, cy = centre
    y, x = np.ogrid[0:h, 0:l]
    d = np.sqrt(((x - cx * l) / (rayon * l)) ** 2 + ((y - cy * h) / (rayon * h)) ** 2)
    masque = np.clip(1.0 - d ** 2, 0.0, 1.0) ** 1.6
    return masque[..., None] * np.array(couleur, dtype=np.float32) * intensite


def fabriquer(nom, base, nappes, flou, vignettage, grain):
    forme = (HAUTEUR, LARGEUR)
    image = np.zeros((HAUTEUR, LARGEUR, 3), dtype=np.float32)
    image += np.array(base, dtype=np.float32)

    for centre, rayon, couleur, intensite in nappes:
        image += nappe(forme, centre, rayon, couleur, intensite)

    # --- Le flou : c'est lui qui transforme des taches en un decor ------------
    img = Image.fromarray(np.clip(image, 0, 255).astype(np.uint8))
    img = img.filter(ImageFilter.GaussianBlur(radius=flou))
    image = np.asarray(img, dtype=np.float32)

    # --- Le vignettage : tout objectif assombrit les bords --------------------
    y, x = np.ogrid[0:HAUTEUR, 0:LARGEUR]
    dx = (x - LARGEUR / 2) / (LARGEUR / 2)
    dy = (y - HAUTEUR / 2) / (HAUTEUR / 2)
    d = np.sqrt(dx ** 2 + dy ** 2) / math.sqrt(2)
    image *= (1.0 - vignettage * d ** 2)[..., None]

    # --- Le grain : il casse les bandes de couleur ---------------------------
    # Un degrade parfaitement lisse se rend en anneaux visibles sur un ecran
    # 8 bits. Un bruit de quelques niveaux suffit a les dissoudre — c'est le
    # tramage de l'imprimerie, applique a l'ecran.
    rng = np.random.default_rng(7)
    image += rng.normal(0.0, grain, image.shape)

    img = Image.fromarray(np.clip(image, 0, 255).astype(np.uint8))
    chemin = SORTIE / nom
    img.save(chemin, quality=88, optimize=True, progressive=True)
    print(f"  {nom:24} {chemin.stat().st_size // 1024:4} Ko")


SORTIE.mkdir(parents=True, exist_ok=True)
print("Fonds de la famille Verre :")

# --- SOMBRE ------------------------------------------------------------------
# Bleu de nuit profond, traverse de bleu electrique et de cyan. Les nappes les
# plus vives sont a DROITE et au CENTRE : c'est la que se posent la carte de
# connexion et les cartes d'indicateurs, donc la que la refraction doit se lire.
fabriquer(
    "fond-verre-sombre.jpg",
    base=(10, 14, 34),
    nappes=[
        ((0.74, 0.30), 0.52, (37, 99, 235), 1.00),
        ((0.90, 0.70), 0.42, (6, 182, 212), 0.85),
        ((0.16, 0.18), 0.46, (79, 70, 229), 0.90),
        ((0.32, 0.88), 0.38, (124, 58, 237), 0.60),
        ((0.56, 0.56), 0.34, (56, 189, 248), 0.45),
        ((0.04, 0.76), 0.50, (8, 12, 28), 0.90),
    ],
    flou=120,
    vignettage=0.45,
    grain=2.2,
)

# --- CLAIR -------------------------------------------------------------------
# Meme composition, meme geometrie, valeurs inversees : le fond est clair et les
# nappes le teintent au lieu de l'eclairer. Garder la MEME geometrie compte —
# passer du theme clair au sombre ne doit pas donner l'impression de changer
# d'application.
fabriquer(
    "fond-verre-clair.jpg",
    base=(226, 233, 244),
    nappes=[
        ((0.74, 0.30), 0.52, (120, 165, 225), 0.55),
        ((0.90, 0.70), 0.42, (110, 200, 220), 0.45),
        ((0.16, 0.18), 0.46, (140, 140, 225), 0.50),
        ((0.32, 0.88), 0.38, (170, 150, 220), 0.35),
        ((0.56, 0.56), 0.34, (255, 255, 255), 0.55),
        ((0.04, 0.76), 0.50, (196, 208, 226), 0.40),
    ],
    flou=120,
    vignettage=0.18,
    grain=1.8,
)

print("\nReferencees par palettes.css et connexion.css.")
